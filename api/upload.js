const formidable = require('formidable');
const fs = require('fs');
const { put, list, del } = require('@vercel/blob');
const { v4: uuidv4 } = require('uuid');

// Helper function to detect file type
function detectFileType(filename, mimetype) {
  const ext = filename.toLowerCase().split('.').pop();
  
  // Model files
  if (['obj', 'gltf', 'glb', 'json'].includes(ext)) {
    return {
      type: 'model',
      format: ext,
      category: 'model'
    };
  }
  
  // Texture files
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(ext)) {
    return {
      type: 'texture',
      format: ext,
      category: 'texture'
    };
  }
  
  return {
    type: 'unknown',
    format: ext,
    category: 'unknown'
  };
}

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse the form data
    const form = formidable({});
    const [fields, files] = await form.parse(req);
    
    const uploadedFiles = [];
    
    // Process each uploaded file
    for (const file of files.file || []) {
      if (!file.originalFilename) continue;
      
      // Detect file type
      const fileInfo = detectFileType(file.originalFilename, file.mimetype);
      
      // Generate unique ID
      const fileId = uuidv4();
      
      // Read file content
      const fileBuffer = fs.readFileSync(file.filepath);
      
      // Determine storage path
      let storagePath;
      if (fileInfo.type === 'model') {
        storagePath = `models/${fileId}.${fileInfo.format}`;
      } else if (fileInfo.type === 'texture') {
        storagePath = `textures/${file.originalFilename}`;
      } else {
        storagePath = `uploads/${file.originalFilename}`;
      }
      
      // Upload to Vercel Blob
      const blob = await put(storagePath, fileBuffer, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        contentType: file.mimetype,
      });
      
      // Create metadata
      const metadata = {
        id: fileId,
        filename: file.originalFilename,
        originalName: file.originalFilename,
        fileType: fileInfo.type,
        modelFormat: fileInfo.format,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        storageKey: storagePath,
        url: blob.url,
        mimetype: file.mimetype
      };
      
      // Save metadata
      const metadataPath = `metadata/${fileId}.json`;
      await put(metadataPath, JSON.stringify(metadata, null, 2), {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        contentType: 'application/json',
      });
      
      uploadedFiles.push(metadata);
      
      // Trigger async thumbnail generation for models
      if (fileInfo.type === 'model') {
        try {
          const thumbnailUrl = `${process.env.VERCEL_URL}/api/thumbnail/${fileId}`;
          fetch(thumbnailUrl, { method: 'POST' }).catch(err => {
            console.error('Thumbnail generation failed:', err);
          });
        } catch (error) {
          console.error('Error triggering thumbnail generation:', error);
        }
      }
    }
    
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
      message: `Successfully uploaded ${uploadedFiles.length} files`,
      files: uploadedFiles
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Upload failed',
      details: error.message 
    });
  }
}
