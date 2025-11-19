const { S3Client, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

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

// Helper function to get metadata
async function getMetadata(modelId) {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `metadata/${modelId}.json`,
    });
    
    const response = await r2Client.send(command);
    
    // Convert stream to string
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    
    const metadata = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    return metadata;
  } catch (error) {
    console.error(`Error getting metadata for ${modelId}:`, error);
    return null;
  }
}

// Helper function to delete object
async function deleteObject(key) {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });
    
    await r2Client.send(command);
    return true;
  } catch (error) {
    console.error(`Error deleting object ${key}:`, error);
    return false;
  }
}

// Helper function to find related texture files
async function findRelatedTextures(modelName) {
  try {
    // List all texture files
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: 'textures/',
    });
    
    const response = await r2Client.send(command);
    const relatedTextures = [];
    
    if (response.Contents) {
      const baseName = modelName.toLowerCase().replace(/\.(obj|gltf|glb|json)$/i, '');
      
      for (const object of response.Contents) {
        const fileName = object.Key.split('/').pop().toLowerCase();
        if (fileName.includes(baseName) || fileName === `${baseName}.png`) {
          relatedTextures.push(object.Key);
        }
      }
    }
    
    return relatedTextures;
  } catch (error) {
    console.error('Error finding related textures:', error);
    return [];
  }
}

export default async function handler(req, res) {
  // Only allow DELETE requests
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Extract model ID from URL
  const modelId = req.url.split('/').pop();
  if (!modelId) {
    return res.status(400).json({ error: 'Model ID required' });
  }

  try {
    // Get metadata to find associated files
    const metadata = await getMetadata(modelId);
    if (!metadata) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const deletedFiles = [];
    const errors = [];

    // Delete the main model file
    if (metadata.storageKey) {
      const deleted = await deleteObject(metadata.storageKey);
      if (deleted) {
        deletedFiles.push(metadata.storageKey);
      } else {
        errors.push(`Failed to delete model file: ${metadata.storageKey}`);
      }
    }

    // Delete thumbnail if it exists
    const thumbnailKey = `thumbnails/${modelId}.png`;
    const thumbnailDeleted = await deleteObject(thumbnailKey);
    if (thumbnailDeleted) {
      deletedFiles.push(thumbnailKey);
    }

    // Find and delete related texture files (for models)
    if (metadata.fileType === 'model') {
      const relatedTextures = await findRelatedTextures(metadata.filename);
      for (const textureKey of relatedTextures) {
        const deleted = await deleteObject(textureKey);
        if (deleted) {
          deletedFiles.push(textureKey);
        } else {
          errors.push(`Failed to delete texture: ${textureKey}`);
        }
      }
    }

    // Delete metadata file
    const metadataKey = `metadata/${modelId}.json`;
    const metadataDeleted = await deleteObject(metadataKey);
    if (metadataDeleted) {
      deletedFiles.push(metadataKey);
    } else {
      errors.push(`Failed to delete metadata: ${metadataKey}`);
    }

    // Trigger resource pack rebuild (async, don't wait)
    try {
      const packUrl = `${process.env.VERCEL_URL || 'http://localhost:3000'}/api/buildpack`;
      fetch(packUrl, { method: 'POST' }).catch(error => {
        console.error('Error triggering pack rebuild after delete:', error);
      });
    } catch (error) {
      console.error('Error setting up pack rebuild after delete:', error);
    }

    // Return response
    if (errors.length > 0 && deletedFiles.length === 0) {
      return res.status(500).json({
        error: 'Failed to delete model',
        details: errors,
      });
    }

    res.status(200).json({
      success: true,
      message: `${metadata.fileType === 'model' ? 'Modell' : 'Textur'} "${metadata.filename}" erfolgreich gelöscht`,
      deletedFiles: deletedFiles,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ 
      error: 'Delete failed',
      details: error.message,
    });
  }
}
