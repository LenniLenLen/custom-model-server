const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const puppeteer = require('puppeteer');

// Cloudflare R2 Configuration
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'minecraft-models';

// Helper function to get metadata
async function getMetadata(modelId) {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `metadata/${modelId}.json`,
    });
    
    const response = await r2Client.send(command);
    
    // Convert stream to string
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    
    const metadata = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    return metadata;
  } catch (error) {
    console.error(`Error getting metadata for ${modelId}:`, error);
    return null;
  }
}

// Helper function to get signed URL for model file
function getPublicUrl(storageKey) {
  // For Cloudflare R2, you might need to set up a custom domain
  // For now, we'll use the R2 direct URL format
  const endpoint = process.env.R2_ENDPOINT || '';
  const baseUrl = endpoint.replace('https://', 'https://').replace('http://', 'https://');
  return `${baseUrl}/${BUCKET_NAME}/${storageKey}`;
}

// Helper function to save thumbnail to R2
async function saveThumbnail(modelId, imageBuffer) {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `thumbnails/${modelId}.png`,
      Body: imageBuffer,
      ContentType: 'image/png',
    });
    
    await r2Client.send(command);
    return true;
  } catch (error) {
    console.error(`Error saving thumbnail for ${modelId}:`, error);
    return false;
  }
}

// Helper function to get signed URL for rendering (temporary access)
async function getSignedUrl(storageKey, expiresIn = 300) {
  try {
    // For now, return the public URL
    // In production, you'd use AWS SDK's getSignedUrl
    return getPublicUrl(storageKey);
  } catch (error) {
    console.error('Error getting signed URL:', error);
    return null;
  }
}

// Helper function to find texture for model
async function findTextureForModel(modelFilename) {
  try {
    const baseName = modelFilename.toLowerCase().replace(/\.(obj|gltf|glb|json)$/i, '');
    
    // Try different texture naming patterns
    const possibleTextureNames = [
      `${baseName}.png`,
      `${baseName}_texture.png`,
      `${baseName}_diffuse.png`,
      `${baseName}_color.png`,
      'texture.png',
      'diffuse.png',
    ];
    
    // For now, return null - texture finding would require listing objects
    // This is a simplified implementation
    return null;
  } catch (error) {
    console.error('Error finding texture:', error);
    return null;
  }
}

export default async function handler(req, res) {
  // Extract model ID from URL
  const modelId = req.url.split('/').pop();
  
  // Handle both GET (serve thumbnail) and POST (generate thumbnail)
  if (req.method === 'GET') {
    return serveThumbnail(req, res, modelId);
  } else if (req.method === 'POST') {
    return generateThumbnail(req, res, modelId);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

// Serve existing thumbnail
async function serveThumbnail(req, res, modelId) {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: `thumbnails/${modelId}.png`,
    });
    
    const response = await r2Client.send(command);
    
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    
    // Stream the image
    response.Body.pipe(res);
    
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      // Thumbnail doesn't exist, trigger generation
      console.log(`Thumbnail not found for ${modelId}, triggering generation`);
      
      // Trigger generation async
      generateThumbnail(req, res, modelId).catch(generateError => {
        console.error('Error in async thumbnail generation:', generateError);
      });
      
      // Return a placeholder or error image
      res.status(404).json({ error: 'Thumbnail not found' });
    } else {
      console.error('Error serving thumbnail:', error);
      res.status(500).json({ error: 'Failed to serve thumbnail' });
    }
  }
}

// Generate new thumbnail
async function generateThumbnail(req, res, modelId) {
  try {
    console.log(`Starting thumbnail generation for model: ${modelId}`);
    
    // Get model metadata
    const metadata = await getMetadata(modelId);
    if (!metadata) {
      throw new Error('Model not found');
    }
    
    if (metadata.fileType !== 'model') {
      throw new Error('Not a model file');
    }
    
    // Get URLs for rendering
    const modelUrl = await getSignedUrl(metadata.storageKey);
    if (!modelUrl) {
      throw new Error('Failed to get model URL');
    }
    
    // Try to find associated texture
    const textureUrl = await findTextureForModel(metadata.filename);
    
    // Launch Puppeteer with Vercel-specific settings
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });
    
    try {
      const page = await browser.newPage();
      
      // Set viewport
      await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 });
      
      // Build render URL with parameters
      const renderUrl = `${process.env.VERCEL_URL || 'http://localhost:3000'}/render.html?model=${encodeURIComponent(modelUrl)}&type=${metadata.modelFormat}`;
      
      if (textureUrl) {
        renderUrl += `&texture=${encodeURIComponent(textureUrl)}`;
      }
      
      console.log(`Loading render page: ${renderUrl}`);
      
      // Navigate to render page
      await page.goto(renderUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
      
      // Wait for the model to load (wait for render-ready class or timeout)
      try {
        await page.waitForFunction(
          () => document.body.classList.contains('render-ready'),
          { timeout: 20000 }
        );
      } catch (waitError) {
        console.log('Render-ready timeout, proceeding anyway');
      }
      
      // Additional wait to ensure rendering is complete
      await page.waitForTimeout(2000);
      
      console.log('Taking screenshot...');
      
      // Take screenshot
      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: false,
        clip: { x: 0, y: 0, width: 800, height: 600 },
      });
      
      // Save thumbnail to R2
      const saved = await saveThumbnail(modelId, screenshot);
      if (!saved) {
        console.warn('Failed to save thumbnail to R2');
      }
      
      console.log(`Thumbnail generated successfully for ${modelId}`);
      
      // If this is a POST request, return success
      if (req.method === 'POST') {
        res.status(200).json({
          success: true,
          message: 'Thumbnail generated successfully',
          thumbnailUrl: `/api/thumbnail/${modelId}`,
        });
      }
      
    } finally {
      await browser.close();
    }
    
  } catch (error) {
    console.error('Thumbnail generation error:', error);
    
    if (req.method === 'POST') {
      res.status(500).json({
        error: 'Failed to generate thumbnail',
        details: error.message,
      });
    }
  }
}
