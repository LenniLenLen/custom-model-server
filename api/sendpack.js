const { list } = require('@vercel/blob');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // CloudNord API configuration (you'll need to set these environment variables)
    const CLOUDNORD_API_URL = process.env.CLOUDNORD_API_URL;
    const CLOUDNORD_API_KEY = process.env.CLOUDNORD_API_KEY;
    const CLOUDNORD_SERVER_ID = process.env.CLOUDNORD_SERVER_ID;

    if (!CLOUDNORD_API_URL || !CLOUDNORD_API_KEY || !CLOUDNORD_SERVER_ID) {
      return res.status(500).json({ 
        error: 'CloudNord configuration missing',
        message: 'Please set CLOUDNORD_API_URL, CLOUDNORD_API_KEY, and CLOUDNORD_SERVER_ID environment variables'
      });
    }

    // Get the resource pack from blob storage
    const { blobs } = await list();
    const packBlob = blobs.find(blob => blob.pathname === 'packs/resourcepack.zip');
    
    if (!packBlob) {
      return res.status(404).json({ error: 'Resource pack not found. Please build it first.' });
    }

    // Download the pack
    const packResponse = await fetch(packBlob.url);
    if (!packResponse.ok) {
      throw new Error('Failed to download resource pack');
    }
    
    const packBuffer = await packResponse.arrayBuffer();

    // Upload to CloudNord
    const formData = new FormData();
    const blob = new Blob([packBuffer], { type: 'application/zip' });
    formData.append('file', blob, 'resourcepack.zip');
    formData.append('path', '/resourcepacks/resourcepack.zip');

    const cloudnordResponse = await fetch(`${CLOUDNORD_API_URL}/servers/${CLOUDNORD_SERVER_ID}/files/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDNORD_API_KEY}`,
      },
      body: formData,
    });

    if (!cloudnordResponse.ok) {
      const errorData = await cloudnordResponse.text();
      throw new Error(`CloudNord upload failed: ${errorData}`);
    }

    // Update server.properties to use the new resource pack
    const updatePropertiesResponse = await fetch(`${CLOUDNORD_API_URL}/servers/${CLOUDNORD_SERVER_ID}/properties`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${CLOUDNORD_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        'resource-pack': '/resourcepacks/resourcepack.zip',
        'require-resource-pack': 'true',
      }),
    });

    if (!updatePropertiesResponse.ok) {
      const errorData = await updatePropertiesResponse.text();
      console.warn('Failed to update server.properties:', errorData);
    }

    // Restart the server to apply changes
    const restartResponse = await fetch(`${CLOUDNORD_API_URL}/servers/${CLOUDNORD_SERVER_ID}/restart`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDNORD_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!restartResponse.ok) {
      const errorData = await restartResponse.text();
      console.warn('Failed to restart server:', errorData);
    }

    res.status(200).json({
      success: true,
      message: 'Resource pack uploaded to CloudNord and server updated',
      packSize: packBuffer.byteLength,
      serverRestarted: restartResponse.ok,
    });

  } catch (error) {
    console.error('CloudNord upload error:', error);
    res.status(500).json({ 
      error: 'Failed to upload to CloudNord', 
      message: error.message 
    });
  }
}
