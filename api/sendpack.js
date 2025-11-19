export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // CloudNord server configuration (would need to be configured)
    const CLOUDNORD_API_URL = process.env.CLOUDNORD_API_URL;
    const CLOUDNORD_API_KEY = process.env.CLOUDNORD_API_KEY;

    if (!CLOUDNORD_API_URL || !CLOUDNORD_API_KEY) {
      return res.status(500).json({ 
        error: 'CloudNord configuration missing',
        message: 'Please set CLOUDNORD_API_URL and CLOUDNORD_API_KEY environment variables'
      });
    }

    // Get the latest pack URL from buildpack endpoint
    const buildPackResponse = await fetch(`${process.env.VERCEL_URL}/api/buildpack`, {
      method: 'POST'
    });
    
    if (!buildPackResponse.ok) {
      throw new Error('Failed to build pack');
    }

    const packData = await buildPackResponse.json();
    
    // Upload to CloudNord (this would depend on CloudNord's API)
    const cloudnordResponse = await fetch(`${CLOUDNORD_API_URL}/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CLOUDNORD_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        packUrl: packData.packUrl,
        namespace: 'custommodels',
        filename: 'resourcepack.zip'
      })
    });

    if (!cloudnordResponse.ok) {
      throw new Error('CloudNord upload failed');
    }

    const cloudnordData = await cloudnordResponse.json();

    // Trigger server reload (if CloudNord supports this)
    if (CLOUDNORD_SERVER_URL && process.env.CLOUDNORD_SERVER_KEY) {
      try {
        await fetch(`${CLOUDNORD_SERVER_URL}/reload`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.CLOUDNORD_SERVER_KEY}`
          }
        });
      } catch (error) {
        console.error('Server reload failed:', error);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Resource pack uploaded to CloudNord successfully',
      packUrl: packData.packUrl,
      cloudnordResponse: cloudnordData
    });

  } catch (error) {
    console.error('Send pack error:', error);
    res.status(500).json({ 
      error: 'Failed to send pack to CloudNord',
      details: error.message 
    });
  }
}
