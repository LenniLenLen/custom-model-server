const { del } = require('@vercel/blob');
const { list } = require('@vercel/blob');
const { buildPack } = require('../pack-builder');

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { modelName } = req.query;
    
    if (!modelName) {
      return res.status(400).json({ error: 'Model name is required' });
    }

    // Sanitize model name
    const sanitizedModelName = modelName.replace(/[^a-zA-Z0-9._-]/g, '_').trim();
    
    // Find all files for this model
    const { blobs } = await list();
    const modelBlobs = blobs.filter(blob => 
      blob.pathname.startsWith(`${sanitizedModelName}/`)
    );
    
    if (modelBlobs.length === 0) {
      return res.status(404).json({ error: 'Model not found' });
    }
    
    // Delete all files
    const deletePromises = modelBlobs.map(blob => del(blob.url));
    await Promise.all(deletePromises);
    
    // Rebuild pack
    try {
      await buildPack();
    } catch (error) {
      console.error('Pack rebuild failed:', error);
    }
    
    res.status(200).json({ 
      success: true, 
      message: `Deleted ${modelBlobs.length} files for model ${sanitizedModelName}` 
    });
    
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
}
