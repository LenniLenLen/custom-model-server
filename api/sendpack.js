const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const FormData = require('form-data');

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

// CloudNord Server Configuration
const CLOUDNORD_CONFIG = {
  apiUrl: process.env.CLOUDNORD_API_URL,
  apiKey: process.env.CLOUDNORD_API_KEY,
  serverId: process.env.CLOUDNORD_SERVER_ID,
  resourcePackPath: process.env.CLOUDNORD_RESOURCEPACK_PATH || '/resourcepack.zip',
};

// Helper function to get resource pack from R2
async function getResourcePack() {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: 'packs/resourcepack.zip',
    });
    
    const response = await r2Client.send(command);
    
    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks);
  } catch (error) {
    console.error('Error getting resource pack:', error);
    return null;
  }
}

// Helper function to upload to CloudNord via FTP/API
async function uploadToCloudNord(packBuffer) {
  // This is a placeholder implementation
  // You'll need to implement the actual CloudNord API integration
  
  if (!CLOUDNORD_CONFIG.apiUrl || !CLOUDNORD_CONFIG.apiKey) {
    console.warn('CloudNord configuration missing - skipping upload');
    return { success: false, reason: 'Missing configuration' };
  }
  
  try {
    // Example implementation using HTTP API (adjust to CloudNord's actual API)
    const formData = new FormData();
    formData.append('file', packBuffer, {
      filename: 'resourcepack.zip',
      contentType: 'application/zip',
    });
    formData.append('path', CLOUDNORD_CONFIG.resourcePackPath);
    formData.append('server_id', CLOUDNORD_CONFIG.serverId);
    
    const response = await fetch(`${CLOUDNORD_CONFIG.apiUrl}/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDNORD_CONFIG.apiKey}`,
        ...formData.getHeaders(),
      },
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error(`CloudNord upload failed: ${response.statusText}`);
    }
    
    const result = await response.json();
    return { success: true, result };
    
  } catch (error) {
    console.error('CloudNord upload error:', error);
    return { success: false, error: error.message };
  }
}

// Alternative implementation using FTP (if CloudNord supports FTP)
async function uploadViaFTP(packBuffer) {
  try {
    // This would require an FTP client library
    // For now, this is just a placeholder
    console.log('FTP upload not implemented yet');
    return { success: false, reason: 'FTP not implemented' };
  } catch (error) {
    console.error('FTP upload error:', error);
    return { success: false, error: error.message };
  }
}

// Helper function to trigger server resource pack reload
async function triggerResourcePackReload() {
  try {
    if (!CLOUDNORD_CONFIG.apiUrl || !CLOUDNORD_CONFIG.apiKey) {
      console.warn('CloudNord configuration missing - skipping reload');
      return { success: false, reason: 'Missing configuration' };
    }
    
    // Call CloudNord API to reload resource pack
    const response = await fetch(`${CLOUDNORD_CONFIG.apiUrl}/servers/${CLOUDNORD_CONFIG.serverId}/reload-resourcepack`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDNORD_CONFIG.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        resourcepack_path: CLOUDNORD_CONFIG.resourcePackPath,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Resource pack reload failed: ${response.statusText}`);
    }
    
    const result = await response.json();
    return { success: true, result };
    
  } catch (error) {
    console.error('Resource pack reload error:', error);
    return { success: false, error: error.message };
  }
}

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Starting resource pack upload to CloudNord...');
    
    // Get the resource pack from R2
    const packBuffer = await getResourcePack();
    if (!packBuffer) {
      return res.status(404).json({
        error: 'Resource pack not found',
        details: 'Please build the resource pack first',
      });
    }
    
    console.log(`Resource pack size: ${(packBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    // Upload to CloudNord
    const uploadResult = await uploadToCloudNord(packBuffer);
    
    if (!uploadResult.success) {
      console.warn('CloudNord upload failed:', uploadResult.reason || uploadResult.error);
      
      // Don't fail the request, just warn
      return res.status(200).json({
        success: true,
        message: 'Resource pack built successfully, but upload to CloudNord failed',
        uploadError: uploadResult.reason || uploadResult.error,
        packSize: packBuffer.length,
        note: 'Please manually upload the resource pack or check CloudNord configuration',
      });
    }
    
    // Trigger resource pack reload on the server
    const reloadResult = await triggerResourcePackReload();
    
    if (!reloadResult.success) {
      console.warn('Resource pack reload failed:', reloadResult.error);
      
      return res.status(200).json({
        success: true,
        message: 'Resource pack uploaded to CloudNord, but reload failed',
        uploadSuccess: true,
        reloadError: reloadResult.error,
        packSize: packBuffer.length,
        note: 'Resource pack uploaded - you may need to manually restart the server or reload resource packs',
      });
    }
    
    console.log('Resource pack successfully uploaded and reloaded on CloudNord');
    
    res.status(200).json({
      success: true,
      message: 'Resource pack successfully uploaded to CloudNord and reloaded',
      uploadSuccess: true,
      reloadSuccess: true,
      packSize: packBuffer.length,
      timestamp: new Date().toISOString(),
      serverId: CLOUDNORD_CONFIG.serverId,
    });
    
  } catch (error) {
    console.error('Send pack error:', error);
    res.status(500).json({ 
      error: 'Failed to send resource pack to CloudNord',
      details: error.message,
    });
  }
}
