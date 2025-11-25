const { put } = require('@vercel/blob');
const formidable = require('formidable');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const { buildPack } = require('../pack-builder');

export const config = {
  api: {
    bodyParser: false,
  },
};

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').trim();
}

async function saveFileToBlob(file, modelName, type) {
  const buffer = fs.readFileSync(file.filepath);
  const filename = `${sanitizeName(modelName)}/${type === 'model' ? file.originalFilename : file.originalFilename}`;
  
  const blob = await put(filename, buffer, {
    access: 'public',
    contentType: type === 'model' ? 'application/octet-stream' : 'image/png',
  });
  
  fs.unlinkSync(file.filepath);
  return blob;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const form = formidable({
      uploadDir: '/tmp',
      keepExtensions: true,
      maxFileSize: 50 * 1024 * 1024, // 50MB
    });

    const [fields, files] = await form.parse(req);
    const modelName = fields.modelName?.[0];
    const uploadedFiles = files.file || [];

    if (!modelName || uploadedFiles.length === 0) {
      return res.status(400).json({ error: 'Missing modelName or file' });
    }

    const sanitizedModelName = sanitizeName(modelName);
    const results = [];

    // Process uploaded files
    for (const file of uploadedFiles) {
      const ext = path.extname(file.originalFilename).toLowerCase();
      
      if (ext === '.zip') {
        // Handle ZIP files
        const zip = new AdmZip(file.filepath);
        const tempDir = `/tmp/${Date.now()}`;
        zip.extractAllTo(tempDir, true);
        
        // Find model and texture files in ZIP
        const extractedFiles = fs.readdirSync(tempDir);
        for (const extractedFile of extractedFiles) {
          const filePath = path.join(tempDir, extractedFile);
          const stat = fs.statSync(filePath);
          
          if (stat.isFile()) {
            const fileExt = path.extname(extractedFile).toLowerCase();
            const type = ['.obj', '.gltf', '.glb', '.json'].includes(fileExt) ? 'model' : 
                        ['.png', '.jpg', '.jpeg'].includes(fileExt) ? 'texture' : null;
            
            if (type) {
              const fileObj = {
                filepath: filePath,
                originalFilename: extractedFile,
                mimetype: type === 'model' ? 'application/octet-stream' : 'image/png'
              };
              const blob = await saveFileToBlob(fileObj, sanitizedModelName, type);
              results.push({ type, filename: extractedFile, url: blob.url });
            }
          }
        }
        
        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true });
      } else if (['.obj', '.gltf', '.glb', '.json'].includes(ext)) {
        // Handle individual model files
        const blob = await saveFileToBlob(file, sanitizedModelName, 'model');
        results.push({ type: 'model', filename: file.originalFilename, url: blob.url });
      } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
        // Handle texture files
        const blob = await saveFileToBlob(file, sanitizedModelName, 'texture');
        results.push({ type: 'texture', filename: file.originalFilename, url: blob.url });
      }
    }

    // Trigger pack building
    try {
      await buildPack();
    } catch (error) {
      console.error('Pack build failed:', error);
    }

    // Trigger thumbnail generation
    const modelFiles = results.filter(r => r.type === 'model');
    if (modelFiles.length > 0) {
      // This would trigger the thumbnail generation
      // We'll implement this in the thumbnail endpoint
    }

    res.status(200).json({ 
      success: true, 
      modelName: sanitizedModelName,
      files: results 
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
}
