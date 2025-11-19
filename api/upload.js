const { put } = require('@vercel/blob');
const { v4: uuidv4 } = require('uuid');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Simple test to see if Vercel Blob works
    const testMetadata = {
      id: uuidv4(),
      filename: 'test.obj',
      uploadedAt: new Date().toISOString(),
      message: 'Upload endpoint working!'
    };

    // Save test metadata
    await put(`metadata/test.json`, JSON.stringify(testMetadata, null, 2), {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      contentType: 'application/json',
    });

    res.status(200).json({
      success: true,
      message: 'Upload endpoint is working!',
      test: testMetadata
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ 
      error: 'Upload failed',
      details: error.message 
    });
  }
}
