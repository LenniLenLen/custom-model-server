const AdmZip = require('adm-zip');
const { list, put } = require('@vercel/blob');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get all models metadata
    const { blobs } = await list({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      prefix: 'metadata/',
    });

    const models = [];
    
    for (const blob of blobs) {
      if (!blob.pathname.endsWith('.json')) continue;
      
      try {
        const response = await fetch(blob.url);
        const metadata = await response.json();
        
        if (metadata.fileType === 'model') {
          models.push(metadata);
        }
      } catch (error) {
        console.error('Error processing metadata:', error);
      }
    }

    // Create resource pack
    const zip = new AdmZip();
    
    // Add pack metadata
    const packMeta = {
      pack: {
        pack_format: 8,
        description: 'Custom Models Resource Pack - Generated on ' + new Date().toISOString()
      }
    };
    
    zip.addFile('pack.mcmeta', Buffer.from(JSON.stringify(packMeta, null, 2)));
    
    // Create assets structure
    const assetsPath = 'assets/minecraft/models/item/';
    
    // Add each model
    for (const model of models) {
      try {
        // Get model file content
        const modelResponse = await fetch(model.url);
        const modelContent = await modelResponse.text();
        
        // Generate item model JSON
        const itemModel = {
          parent: "item/generated",
          textures: {
            layer0: "item/custom_model_" + model.id
          }
        };
        
        // Add to pack
        zip.addFile(`${assetsPath}custom_model_${model.id}.json`, Buffer.from(JSON.stringify(itemModel, null, 2)));
        
        // Add model file to custom namespace
        const customModelPath = `assets/custommodels/models/item/custom_model_${model.id}.${model.modelFormat}`;
        zip.addFile(customModelPath, Buffer.from(modelContent));
        
      } catch (error) {
        console.error(`Error processing model ${model.id}:`, error);
      }
    }

    // Generate pack.zip
    const packBuffer = zip.toBuffer();
    
    // Upload to Vercel Blob
    const blob = await put('packs/resourcepack.zip', packBuffer, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      contentType: 'application/zip',
    });

    res.status(200).json({
      success: true,
      packUrl: blob.url,
      modelCount: models.length,
      message: 'Resource pack generated successfully'
    });

  } catch (error) {
    console.error('Build pack error:', error);
    res.status(500).json({ 
      error: 'Failed to build resource pack',
      details: error.message 
    });
  }
}
