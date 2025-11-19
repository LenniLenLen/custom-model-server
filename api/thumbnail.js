const puppeteer = require('puppeteer');
const { put, list } = require('@vercel/blob');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { id } = req.query;
    
    if (!id) {
      return res.status(400).json({ error: 'Model ID is required' });
    }

    // Find metadata
    const { blobs } = await list({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      prefix: `metadata/${id}.json`,
    });

    if (blobs.length === 0) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const metadataResponse = await fetch(blobs[0].url);
    const metadata = await metadataResponse.json();

    if (metadata.fileType !== 'model') {
      return res.status(400).json({ error: 'Not a model file' });
    }

    // Launch Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewport({ width: 800, height: 600 });
    
    // Create HTML content for rendering
    const renderHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/OBJLoader.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
        <style>
          body { margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
          canvas { display: block; }
        </style>
      </head>
      <body>
        <script>
          let scene, camera, renderer, model;
          
          function init() {
            scene = new THREE.Scene();
            camera = new THREE.PerspectiveCamera(75, 800/600, 0.1, 1000);
            renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
            renderer.setSize(800, 600);
            renderer.setClearColor(0x000000, 0);
            document.body.appendChild(renderer.domElement);
            
            // Lighting
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambientLight);
            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(1, 1, 1);
            scene.add(directionalLight);
            
            // Load model
            const loader = new THREE.${metadata.modelFormat.toUpperCase()}Loader();
            loader.load('${metadata.url}', function(object) {
              model = object;
              
              // Center and scale model
              const box = new THREE.Box3().setFromObject(object);
              const center = box.getCenter(new THREE.Vector3());
              object.position.sub(center);
              
              const size = box.getSize(new THREE.Vector3());
              const maxDim = Math.max(size.x, size.y, size.z);
              const scale = 2 / maxDim;
              object.scale.multiplyScalar(scale);
              
              scene.add(object);
              
              camera.position.set(0, 0, 5);
              camera.lookAt(0, 0, 0);
              
              render();
            });
          }
          
          function render() {
            renderer.render(scene, camera);
          }
          
          init();
        </script>
      </body>
      </html>
    `;

    // Set page content
    await page.setContent(renderHtml);
    
    // Wait for model to load (timeout after 10 seconds)
    try {
      await page.waitForFunction(() => {
        return window.model !== undefined;
      }, { timeout: 10000 });
    } catch (error) {
      console.log('Model load timeout, proceeding anyway');
    }

    // Wait a bit for rendering
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Take screenshot
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false
    });

    await browser.close();

    // Upload thumbnail to Vercel Blob
    const thumbnailPath = `thumbnails/${id}.png`;
    const blob = await put(thumbnailPath, screenshot, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      contentType: 'image/png',
    });

    // Update metadata with thumbnail URL
    metadata.thumbnailUrl = blob.url;
    metadata.thumbnailKey = thumbnailPath;
    
    await put(`metadata/${id}.json`, JSON.stringify(metadata, null, 2), {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      contentType: 'application/json',
    });

    res.status(200).json({
      success: true,
      thumbnailUrl: blob.url,
      message: 'Thumbnail generated successfully'
    });

  } catch (error) {
    console.error('Thumbnail generation error:', error);
    res.status(500).json({ 
      error: 'Failed to generate thumbnail',
      details: error.message 
    });
  }
}
