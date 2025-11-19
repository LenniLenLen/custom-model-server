const { buildPack } = require('../pack-builder');

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Starting resource pack build...');
    
    // Build the pack
    const result = await buildPack();
    
    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to build resource pack',
        details: result.error,
      });
    }
    
    // Trigger automatic pack sending to Minecraft server (async, don't wait)
    try {
      const sendPackUrl = `${process.env.VERCEL_URL || 'http://localhost:3000'}/api/sendpack`;
      fetch(sendPackUrl, { method: 'POST' }).catch(error => {
        console.error('Error triggering pack sending:', error);
      });
    } catch (error) {
      console.error('Error setting up pack sending:', error);
    }
    
    res.status(200).json({
      success: true,
      message: 'Resource pack built successfully',
      modelCount: result.modelCount,
      packSize: result.packSize,
      packUrl: result.packUrl,
      timestamp: new Date().toISOString(),
    });
    
  } catch (error) {
    console.error('Build pack error:', error);
    res.status(500).json({ 
      error: 'Failed to build resource pack',
      details: error.message,
    });
  }
}
