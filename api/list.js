const { list } = require('@vercel/blob');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // List all metadata files
    const { blobs } = await list({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      prefix: 'metadata/',
    });

    const models = [];
    
    // Process each metadata file
    for (const blob of blobs) {
      if (!blob.pathname.endsWith('.json')) continue;
      
      try {
        // Fetch metadata content
        const response = await fetch(blob.url);
        const metadata = await response.json();
        
        // Only include models, not other files
        if (metadata.fileType === 'model') {
          models.push({
            id: metadata.id,
            filename: metadata.filename,
            modelFormat: metadata.modelFormat,
            size: metadata.size,
            uploadedAt: metadata.uploadedAt,
            url: metadata.url,
            thumbnailUrl: metadata.thumbnailUrl || null
          });
        }
      } catch (error) {
        console.error('Error processing metadata:', error);
      }
    }
    
    // Sort by upload date (newest first)
    models.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    
    res.status(200).json({
      success: true,
      models: models,
      count: models.length
    });
    
  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({ 
      error: 'Failed to list models',
      details: error.message 
    });
  }
}
