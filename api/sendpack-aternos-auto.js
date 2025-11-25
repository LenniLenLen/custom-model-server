import { AternosAPI } from './aternos-helper.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Aternos API configuration
    const ATERNOS_USERNAME = process.env.ATERNOS_USERNAME;
    const ATERNOS_PASSWORD = process.env.ATERNOS_PASSWORD;
    const ATERNOS_SERVER = process.env.ATERNOS_SERVER_ID;

    if (!ATERNOS_USERNAME || !ATERNOS_PASSWORD || !ATERNOS_SERVER) {
      return res.status(500).json({ 
        error: 'Aternos configuration missing',
        message: 'Please set ATERNOS_USERNAME, ATERNOS_PASSWORD, and ATERNOS_SERVER_ID environment variables'
      });
    }

    // Get the resource pack from blob storage
    const { list } = require('@vercel/blob');
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

    // Initialize Aternos API
    const aternos = new AternosAPI(ATERNOS_USERNAME, ATERNOS_PASSWORD, ATERNOS_SERVER);

    // Step 1: Login to Aternos
    console.log('Logging into Aternos...');
    const loginSuccess = await aternos.login();
    if (!loginSuccess) {
      throw new Error('Failed to login to Aternos');
    }

    // Step 2: Upload resource pack
    console.log('Uploading resource pack to Aternos...');
    const uploadSuccess = await aternos.uploadFile(packBuffer, 'resourcepack.zip');
    if (!uploadSuccess) {
      throw new Error('Failed to upload resource pack to Aternos');
    }

    // Step 3: Update server properties
    console.log('Updating server properties...');
    const propertiesSuccess = await aternos.updateServerProperties({
      'resource-pack': 'resourcepack.zip',
      'require-resource-pack': 'true'
    });
    if (!propertiesSuccess) {
      console.warn('Failed to update server properties - you may need to do this manually');
    }

    // Step 4: Restart server
    console.log('Restarting Aternos server...');
    const restartSuccess = await aternos.restartServer();
    if (!restartSuccess) {
      throw new Error('Failed to restart Aternos server');
    }

    res.status(200).json({
      success: true,
      message: 'Resource pack automatically uploaded to Aternos and server restarted!',
      packSize: packBuffer.byteLength,
      steps: {
        login: loginSuccess,
        upload: uploadSuccess,
        properties: propertiesSuccess,
        restart: restartSuccess
      }
    });

  } catch (error) {
    console.error('Aternos auto upload error:', error);
    res.status(500).json({ 
      error: 'Failed to upload to Aternos automatically', 
      message: error.message 
    });
  }
}
