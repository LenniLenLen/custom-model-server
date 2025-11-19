const { S3Client, PutObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const formidable = require('formidable');
const { v4: uuidv4 } = require('uuid');
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

// Helper function to determine file type
function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const modelExtensions = ['.obj', '.gltf', '.glb', '.json'];
  const textureExtensions = ['.png', '.jpg', '.jpeg', '.gif'];
  
  if (modelExtensions.includes(ext)) return 'model';
  if (textureExtensions.includes(ext)) return 'texture';
  return 'unknown';
}

// Helper function to get model format from extension
function getModelFormat(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ext.substring(1); // Remove the dot
}

// Helper function to format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper function to store metadata
async function storeMetadata(metadata) {
  const metadataKey = `metadata/${metadata.id}.json`;
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: metadataKey,
    Body: JSON.stringify(metadata),
    ContentType: 'application/json',
  });
  
  await r2Client.send(command);
}

// Helper function to list existing metadata
async function listMetadata() {
  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: 'metadata/',
    });
    
    const response = await r2Client.send(command);
    const metadata = [];
    
    if (response.Contents) {
      for (const object of response.Contents) {
        if (object.Key.endsWith('.json')) {
          try {
            const getCommand = new PutObjectCommand({
              Bucket: BUCKET_NAME,
              Key: object.Key,
            });
            
            // Note: In a real implementation, you'd use GetObjectCommand
            // For now, we'll store metadata in a simple way
            metadata.push({
              id: path.basename(object.Key, '.json'),
              key: object.Key,
              lastModified: object.LastModified,
            });
          } catch (error) {
            console.error('Error reading metadata:', error);
          }
        }
      }
    }
    
    return metadata;
  } catch (error) {
    console.error('Error listing metadata:', error);
    return [];
  }
}

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse the multipart form data
    const form = formidable({
      maxFileSize: 50 * 1024 * 1024, // 50MB limit
      keepExtensions: true,
    });

    const [fields, files] = await form.parse(req);
    
    if (!files.file || files.file.length === 0) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = files.file[0];
    const fileType = getFileType(file.originalFilename);
    
    if (fileType === 'unknown') {
      return res.status(400).json({ 
        error: 'Unsupported file type',
        supportedTypes: ['Model files: .obj, .gltf, .glb, .json', 'Texture files: .png, .jpg, .jpeg, .gif']
      });
    }

    // Generate unique ID and file paths
    const modelId = uuidv4();
    const fileExtension = path.extname(file.originalFilename);
    const fileName = `${modelId}${fileExtension}`;
    const storageKey = fileType === 'model' ? `models/${fileName}` : `textures/${fileName}`;

    // Upload file to R2
    const upload = new Upload({
      client: r2Client,
      params: {
        Bucket: BUCKET_NAME,
        Key: storageKey,
        Body: require('fs').createReadStream(file.filepath),
        ContentType: file.mimetype || 'application/octet-stream',
      },
    });

    await upload.done();

    // Create metadata
    const metadata = {
      id: modelId,
      filename: file.originalFilename,
      storageKey: storageKey,
      fileType: fileType,
      modelFormat: fileType === 'model' ? getModelFormat(file.originalFilename) : null,
      mimeType: file.mimetype,
      fileSize: formatFileSize(file.size),
      uploadedAt: new Date().toISOString(),
      thumbnailUrl: null, // Will be generated later
    };

    // Store metadata
    await storeMetadata(metadata);

    // Clean up temporary file
    try {
      require('fs').unlinkSync(file.filepath);
    } catch (cleanupError) {
      console.error('Error cleaning up temp file:', cleanupError);
    }

    // Trigger thumbnail generation (async, don't wait)
    if (fileType === 'model') {
      try {
        // Call thumbnail generation endpoint
        const thumbnailUrl = `${process.env.VERCEL_URL || 'http://localhost:3000'}/api/thumbnail/${modelId}`;
        
        // Don't wait for thumbnail generation, just trigger it
        fetch(thumbnailUrl, { method: 'POST' }).catch(error => {
          console.error('Error triggering thumbnail generation:', error);
        });
      } catch (error) {
        console.error('Error setting up thumbnail generation:', error);
      }
    }

    // Trigger resource pack rebuild (async, don't wait)
    try {
      const packUrl = `${process.env.VERCEL_URL || 'http://localhost:3000'}/api/buildpack`;
      fetch(packUrl, { method: 'POST' }).catch(error => {
        console.error('Error triggering pack rebuild:', error);
      });
    } catch (error) {
      console.error('Error setting up pack rebuild:', error);
    }

    res.status(200).json({
      success: true,
      model: metadata,
      message: `${fileType === 'model' ? 'Modell' : 'Textur'} erfolgreich hochgeladen`,
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Upload failed',
      details: error.message,
    });
  }
}
