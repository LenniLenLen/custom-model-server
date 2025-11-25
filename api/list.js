const { list } = require('@vercel/blob');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { blobs } = await list();
    
    // Group files by model folder
    const models = {};
    const modelExtensions = ['.obj', '.gltf', '.glb', '.json'];
    
    blobs.forEach(blob => {
      const parts = blob.pathname.split('/');
      if (parts.length === 2) {
        const modelName = parts[0];
        const filename = parts[1];
        const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
        
        if (!models[modelName]) {
          models[modelName] = {
            name: modelName,
            files: [],
            thumbnail: null,
            createdAt: blob.uploadedAt
          };
        }
        
        if (filename === 'thumbnail.png') {
          models[modelName].thumbnail = blob.url;
        } else if (modelExtensions.includes(ext)) {
          models[modelName].files.push({
            filename,
            url: blob.url,
            type: 'model'
          });
        } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
          models[modelName].files.push({
            filename,
            url: blob.url,
            type: 'texture'
          });
        }
      }
    });
    
    // Convert to array and sort by creation date
    const modelList = Object.values(models).sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );
    
    res.status(200).json(modelList);
    
  } catch (error) {
    console.error('List error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
}
