const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

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

// Helper function to get object content
async function getObjectContent(key) {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });
    
    const response = await r2Client.send(command);
    
    // Convert stream to string
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks).toString('utf-8');
  } catch (error) {
    console.error(`Error getting object ${key}:`, error);
    return null;
  }
}

// Helper function to list metadata files
async function listMetadataFiles() {
  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: 'metadata/',
    });
    
    const response = await r2Client.send(command);
    return response.Contents || [];
  } catch (error) {
    console.error('Error listing metadata files:', error);
    return [];
  }
}

// Helper function to check if thumbnail exists
async function thumbnailExists(modelId) {
  try {
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `thumbnails/${modelId}.png`,
      MaxKeys: 1,
    });
    
    const response = await r2Client.send(command);
    return response.Contents && response.Contents.length > 0;
  } catch (error) {
    return false;
  }
}

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get all metadata files
    const metadataFiles = await listMetadataFiles();
    const models = [];
    
    // Process each metadata file
    for (const file of metadataFiles) {
      if (file.Key.endsWith('.json')) {
        try {
          const metadataContent = await getObjectContent(file.Key);
          if (metadataContent) {
            const metadata = JSON.parse(metadataContent);
            
            // Add thumbnail URL if it exists
            const hasThumbnail = await thumbnailExists(metadata.id);
            if (hasThumbnail) {
              metadata.thumbnailUrl = `/api/thumbnail/${metadata.id}`;
            }
            
            models.push(metadata);
          }
        } catch (parseError) {
          console.error(`Error parsing metadata file ${file.Key}:`, parseError);
        }
      }
    }
    
    // Sort models by upload date (newest first)
    models.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    
    res.status(200).json(models);
    
  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({ 
      error: 'Failed to list models',
      details: error.message,
    });
  }
}
