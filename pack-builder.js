const { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const AdmZip = require('adm-zip');
const path = require('path');

// Cloudflare R2 Configuration
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'minecraft-models';
const NAMESPACE = process.env.PACK_NAMESPACE || 'custommodels';

// Helper function to get all model metadata
async function getAllModelMetadata() {
  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: 'metadata/',
    });
    
    const response = await r2Client.send(command);
    const models = [];
    
    if (response.Contents) {
      for (const object of response.Contents) {
        if (object.Key.endsWith('.json')) {
          try {
            const getCommand = new GetObjectCommand({
              Bucket: BUCKET_NAME,
              Key: object.Key,
            });
            
            const response = await r2Client.send(getCommand);
            
            // Convert stream to string
            const chunks = [];
            for await (const chunk of response.Body) {
              chunks.push(chunk);
            }
            
            const metadata = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            
            // Only include model files (not textures)
            if (metadata.fileType === 'model') {
              models.push(metadata);
            }
          } catch (error) {
            console.error(`Error reading metadata ${object.Key}:`, error);
          }
        }
      }
    }
    
    return models;
  } catch (error) {
    console.error('Error getting model metadata:', error);
    return [];
  }
}

// Helper function to get model file content
async function getModelFile(storageKey) {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: storageKey,
    });
    
    const response = await r2Client.send(command);
    
    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks);
  } catch (error) {
    console.error(`Error getting model file ${storageKey}:`, error);
    return null;
  }
}

// Helper function to find texture for model
async function findTextureForModel(modelFilename) {
  try {
    const baseName = modelFilename.toLowerCase().replace(/\.(obj|gltf|glb|json)$/i, '');
    
    // List all texture files
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: 'textures/',
    });
    
    const response = await r2Client.send(command);
    
    if (response.Contents) {
      for (const object of response.Contents) {
        const fileName = object.Key.split('/').pop().toLowerCase();
        
        // Check for matching texture files
        if (fileName === `${baseName}.png` || 
            fileName === `${baseName}_texture.png` ||
            fileName === `${baseName}_diffuse.png` ||
            fileName.includes(baseName)) {
          
          // Get texture content
          const textureContent = await getModelFile(object.Key);
          if (textureContent) {
            return {
              filename: path.basename(object.Key),
              content: textureContent,
            };
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error finding texture:', error);
    return null;
  }
}

// Helper function to convert OBJ to JSON Minecraft model
function convertObjToMinecraftModel(objContent, modelName) {
  // This is a simplified conversion
  // In a real implementation, you'd parse OBJ and create proper JSON model
  
  const minecraftModel = {
    parent: "item/generated",
    textures: {
      layer0: `${NAMESPACE}:item/${modelName}`
    },
    display: {
      thirdperson_righthand: {
        rotation: [ -80, 260, -40 ],
        translation: [ -1, -2, 2.5 ],
        scale: [ 0.9, 0.9, 0.9 ]
      },
      firstperson_righthand: {
        rotation: [ 0, -90, 25 ],
        translation: [ 1.13, 3.2, 0 ],
        scale: [ 0.68, 0.68, 0.68 ]
      },
      ground: {
        rotation: [ 0, 0, 0 ],
        translation: [ 0, 2, 0 ],
        scale: [ 0.5, 0.5, 0.5 ]
      },
      gui: {
        rotation: [ 30, 225, 0 ],
        translation: [ 0, 0, 0 ],
        scale: [ 0.625, 0.625, 0.625 ]
      },
      fixed: {
        rotation: [ 0, 0, 0 ],
        translation: [ 0, 0, 0 ],
        scale: [ 0.5, 0.5, 0.5 ]
      }
    }
  };
  
  return JSON.stringify(minecraftModel, null, 2);
}

// Helper function to create pack.mcmeta
function createPackMcmeta() {
  const packMcmeta = {
    pack: {
      pack_format: 8,
      description: "Custom Minecraft Models - Generated automatically"
    }
  };
  
  return JSON.stringify(packMcmeta, null, 2);
}

// Main pack building function
async function buildPack() {
  console.log('Building Minecraft Resource Pack...');
  
  try {
    // Get all models
    const models = await getAllModelMetadata();
    console.log(`Found ${models.length} models to include in pack`);
    
    // Create ZIP file
    const zip = new AdmZip();
    
    // Add pack.mcmeta
    const packMcmetaContent = createPackMcmeta();
    zip.addFile('pack.mcmeta', Buffer.from(packMcmetaContent));
    
    // Create assets structure
    const assetsPath = `assets/${NAMESPACE}`;
    
    // Add models and textures
    for (const model of models) {
      const modelName = path.basename(model.filename, path.extname(model.filename));
      
      // Get model file content
      const modelContent = await getModelFile(model.storageKey);
      if (!modelContent) {
        console.warn(`Could not get model content for ${model.filename}`);
        continue;
      }
      
      // Find associated texture
      const texture = await findTextureForModel(model.filename);
      
      // Create item model JSON
      let itemModelContent;
      
      if (model.modelFormat === 'json') {
        // If it's already a JSON model, use it directly
        itemModelContent = modelContent.toString('utf-8');
      } else {
        // Convert OBJ/GLTF to Minecraft JSON model format
        itemModelContent = convertObjToMinecraftModel(modelContent.toString('utf-8'), modelName);
      }
      
      // Add item model
      const itemModelPath = `${assetsPath}/models/item/${modelName}.json`;
      zip.addFile(itemModelPath, Buffer.from(itemModelContent));
      
      // Add texture if found
      if (texture) {
        const texturePath = `${assetsPath}/textures/item/${texture.filename}`;
        zip.addFile(texturePath, texture.content);
      }
    }
    
    // Generate ZIP buffer
    const zipBuffer = zip.toBuffer();
    
    // Save to R2
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: 'packs/resourcepack.zip',
      Body: zipBuffer,
      ContentType: 'application/zip',
    });
    
    await r2Client.send(command);
    
    console.log(`Resource pack built successfully with ${models.length} models`);
    console.log(`Pack size: ${(zipBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    return {
      success: true,
      modelCount: models.length,
      packSize: zipBuffer.length,
      packUrl: `/api/download/pack`,
    };
    
  } catch (error) {
    console.error('Error building pack:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = { buildPack };