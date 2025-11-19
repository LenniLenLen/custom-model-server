const { del, list } = require('@vercel/blob');

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;
    
    if (!id) {
      return res.status(400).json({ error: 'Model ID is required' });
    }

    // First, get the metadata to find all associated files
    const { blobs } = await list({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      prefix: `metadata/${id}.json`,
    });

    if (blobs.length === 0) {
      return res.status(404).json({ error: 'Model not found' });
    }

    // Get metadata
    const metadataResponse = await fetch(blobs[0].url);
    const metadata = await metadataResponse.json();

    // Delete all associated files
    const filesToDelete = [
      // Metadata file
      `metadata/${id}.json`,
      // Model file
      metadata.storageKey,
      // Thumbnail (if exists)
      metadata.thumbnailKey || `thumbnails/${id}.png`,
    ];

    // Delete files
    const deletePromises = filesToDelete.map(async (fileKey) => {
      try {
        const { blobs } = await list({
          token: process.env.BLOB_READ_WRITE_TOKEN,
          prefix: fileKey,
        });
        
        if (blobs.length > 0) {
          await del(blobs, { token: process.env.BLOB_READ_WRITE_TOKEN });
        }
      } catch (error) {
        console.error(`Failed to delete ${fileKey}:`, error);
      }
    });

    await Promise.all(deletePromises);

    // Trigger resource pack rebuild
    try {
      const buildPackUrl = `${process.env.VERCEL_URL}/api/buildpack`;
      fetch(buildPackUrl, { method: 'POST' }).catch(err => {
        console.error('Pack build failed:', err);
      });
    } catch (error) {
      console.error('Error triggering pack build:', error);
    }

    res.status(200).json({
      success: true,
      message: 'Model and all associated files deleted successfully',
      deletedFiles: filesToDelete
    });
    
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ 
      error: 'Failed to delete model',
      details: error.message 
    });
  }
}
