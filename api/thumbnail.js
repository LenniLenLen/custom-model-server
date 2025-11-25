const puppeteer = require('puppeteer-core');
const chrome = require('chrome-aws-lambda');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { modelName, modelUrl, textureUrl } = req.body;
    
    if (!modelName || !modelUrl) {
      return res.status(400).json({ error: 'Model name and model URL are required' });
    }

    let browser;
    try {
      browser = await puppeteer.launch({
        args: chrome.args,
        executablePath: await chrome.executablePath,
        headless: chrome.headless,
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 512, height: 512 });

      // Create a simple renderer page
      const rendererHtml = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { margin: 0; background: #1a1a1a; }
        canvas { display: block; }
    </style>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
</head>
<body>
    <script>
        let scene, camera, renderer, model;
        
        function init() {
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x1a1a1a);
            
            camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
            camera.position.set(0, 0, 5);
            
            renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
            renderer.setSize(512, 512);
            document.body.appendChild(renderer.domElement);
            
            // Lighting
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambientLight);
            
            const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
            directionalLight.position.set(1, 1, 1);
            scene.add(directionalLight);
            
            // Load model
            const loader = new THREE.ObjectLoader();
            loader.load('${modelUrl}', function(object) {
                model = object;
                scene.add(object);
                
                // Center and scale model
                const box = new THREE.Box3().setFromObject(object);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                
                object.position.sub(center);
                const maxDim = Math.max(size.x, size.y, size.z);
                const scale = 2 / maxDim;
                object.scale.multiplyScalar(scale);
                
                window.__THUMB_READY = true;
            });
            
            animate();
        }
        
        function animate() {
            requestAnimationFrame(animate);
            
            if (model) {
                model.rotation.y += 0.01;
            }
            
            renderer.render(scene, camera);
        }
        
        init();
    </script>
</body>
</html>
      `;

      await page.setContent(rendererHtml);
      
      // Wait for model to load and render
      await page.waitForFunction(() => window.__THUMB_READY === true, { timeout: 30000 });
      
      // Wait a bit more for rotation animation
      await page.waitForTimeout(1000);
      
      // Take screenshot
      const screenshot = await page.screenshot({ type: 'png' });
      
      // Save thumbnail to blob storage
      const { put } = require('@vercel/blob');
      const thumbnailBlob = await put(`${modelName}/thumbnail.png`, screenshot, {
        access: 'public',
        contentType: 'image/png',
      });
      
      await browser.close();
      
      res.status(200).json({ 
        success: true, 
        thumbnailUrl: thumbnailBlob.url 
      });
      
    } catch (browserError) {
      if (browser) await browser.close();
      throw browserError;
    }
    
  } catch (error) {
    console.error('Thumbnail generation error:', error);
    res.status(500).json({ error: 'Thumbnail generation failed', message: error.message });
  }
}
