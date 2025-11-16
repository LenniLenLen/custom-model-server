// index.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const AdmZip = require('adm-zip');
const buildPack = require('./pack-builder'); // dein existing pack builder
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.static('static'));
app.use(express.json());

const PORT = process.env.PORT || 8080;
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
const GLOBAL_MODELS_DIR = path.join(__dirname, 'models');
if (!fs.existsSync(GLOBAL_MODELS_DIR)) fs.mkdirSync(GLOBAL_MODELS_DIR, { recursive: true });

const allowedSingleExtensions = ['.json', '.obj', '.gltf', '.glb', '.fbx'];

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// sanitize name
function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').trim();
}

/* ----------------------------
   Upload endpoint (zip or file)
   ---------------------------- */
app.post('/upload', upload.fields([{ name: 'file' }, { name: 'thumbnail' }]), async (req, res) => {
  try {
    const fnField = req.files && req.files['file'] && req.files['file'][0];
    const thumbField = req.files && req.files['thumbnail'] && req.files['thumbnail'][0];
    const modelNameRaw = (req.body && req.body.modelName) ? req.body.modelName : null;
    if (!modelNameRaw || !fnField) {
      if (fnField && fs.existsSync(fnField.path)) fs.unlinkSync(fnField.path);
      if (thumbField && fs.existsSync(thumbField.path)) fs.unlinkSync(thumbField.path);
      return res.status(400).json({ error: 'Missing modelName or file' });
    }

    const modelName = sanitizeName(modelNameRaw);
    const fileOrigName = fnField.originalname;
    const ext = path.extname(fileOrigName).toLowerCase();

    const modelFolder = path.join(GLOBAL_MODELS_DIR, modelName);
    if (!fs.existsSync(modelFolder)) fs.mkdirSync(modelFolder, { recursive: true });

    if (ext === '.zip') {
      const zip = new AdmZip(fnField.path);
      zip.extractAllTo(modelFolder, true);
      fs.unlinkSync(fnField.path);
    } else if (allowedSingleExtensions.includes(ext)) {
      const dest = path.join(modelFolder, path.basename(fnField.originalname));
      fs.renameSync(fnField.path, dest);
    } else {
      fs.unlinkSync(fnField.path);
      if (thumbField && fs.existsSync(thumbField.path)) fs.unlinkSync(thumbField.path);
      return res.status(400).json({ error: 'Invalid file type. Use .zip or supported model formats.' });
    }

    if (thumbField) {
      const thumbExt = path.extname(thumbField.originalname).toLowerCase();
      if (thumbExt !== '.png') {
        fs.unlinkSync(thumbField.path);
        return res.status(400).json({ error: 'Thumbnail must be PNG.' });
      }
      fs.renameSync(thumbField.path, path.join(modelFolder, 'thumbnail.png'));
    }

    // Try to auto-generate thumbnail server-side (Puppeteer). This is async but we'll await it.
    try {
      await generateThumbnail(modelName);
    } catch (err) {
      console.warn('Thumbnail generation failed (non-fatal):', err.message || err);
      // continue — thumbnail isn't critical
    }

    // rebuild pack
    try { buildPack(); } catch(e) { console.error('pack build failed', e); }

    return res.json({ success: true, model: modelName });
  } catch (err) {
    console.error('upload error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/* ----------------------------
   List all models (global)
   ---------------------------- */
app.get('/models', (req, res) => {
  try {
    const entries = fs.readdirSync(GLOBAL_MODELS_DIR, { withFileTypes: true });
    const folders = entries.filter(d => d.isDirectory()).map(d => d.name);
    res.json(folders);
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});

/* ----------------------------
   Delete model (trust-based)
   ---------------------------- */
app.delete('/models/:modelName', (req, res) => {
  try {
    const modelName = sanitizeName(req.params.modelName);
    const modelFolder = path.join(GLOBAL_MODELS_DIR, modelName);
    if (!fs.existsSync(modelFolder)) return res.status(404).json({ error: 'Not found' });
    fs.rmSync(modelFolder, { recursive: true, force: true });
    try { buildPack(); } catch(e){ console.error('pack build failed', e); }
    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ----------------------------
   Serve preview (thumbnail or find png)
   ---------------------------- */
app.get('/preview/:modelName', (req, res) => {
  try {
    const modelName = sanitizeName(req.params.modelName);
    const modelFolder = path.join(GLOBAL_MODELS_DIR, modelName);
    if (!fs.existsSync(modelFolder)) return res.status(404).send('Not found');
    const thumbPath = path.join(modelFolder, 'thumbnail.png');
    if (fs.existsSync(thumbPath)) return res.sendFile(thumbPath);
    // find first png
    const found = findFirstFileRecursive(modelFolder, (n) => n.toLowerCase().endsWith('.png'));
    if (found) return res.sendFile(found);
    return res.status(404).send('No preview');
  } catch (e) {
    console.error(e);
    res.status(500).send('Error');
  }
});

/* ----------------------------
   Expose model file to renderer (safe)
   e.g. /model-file/<modelName>/path/inside.zip/file.png
   ---------------------------- */
app.get('/model-file/:modelName/*', (req, res) => {
  try {
    const modelName = sanitizeName(req.params.modelName);
    const rel = req.params[0] || '';
    if (rel.includes('..')) return res.status(400).send('Invalid path');
    const filePath = path.join(GLOBAL_MODELS_DIR, modelName, rel);
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
    return res.sendFile(filePath);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error');
  }
});

/* ----------------------------
   Render page for puppeteer to open:
   /render/<modelName>
   static render.html loads model via /model-file/<modelName>/...
   ---------------------------- */
app.get('/render/:modelName', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'render.html'));
});

/* ----------------------------
   Pack download (existing)
   ---------------------------- */
app.get('/pack.zip', (req, res) => {
  const packPath = path.join(__dirname, 'public-pack', 'pack.zip');
  if (fs.existsSync(packPath)) return res.sendFile(packPath);
  return res.status(404).send('Pack not built yet');
});

/* ----------------------------
   Utilities
   ---------------------------- */
function findFirstFileRecursive(dir, predicate) {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isFile() && predicate(it.name)) return p;
    if (it.isDirectory()) {
      const found = findFirstFileRecursive(p, predicate);
      if (found) return found;
    }
  }
  return null;
}

/* ----------------------------
   Thumbnail generator using Puppeteer
   - opens /render/<modelName>
   - waits for window.postMessage({ready:true})
   - captures canvas element and saves to thumbnail.png
   ---------------------------- */
async function generateThumbnail(modelName) {
  // Launch puppeteer
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    // headless:true default
  });
  try {
    const page = await browser.newPage();
    // set viewport to match desired thumbnail size
    await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });

    // intercept console from page for debugging
    page.on('console', msg => {
      console.log('PAGE LOG:', msg.text());
    });

    const url = `http://127.0.0.1:${PORT}/render/${encodeURIComponent(modelName)}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });

    // wait for the page to signal ready via window.__THUMB_READY = true
    await page.waitForFunction(() => window.__THUMB_READY === true, { timeout: 30_000 });

    // find canvas element and screenshot it (clip to element)
    const canvas = await page.$('canvas');
    if (!canvas) throw new Error('No canvas found in render page');

    const screenshotBuffer = await canvas.screenshot({ type: 'png' });
    const thumbPath = path.join(GLOBAL_MODELS_DIR, modelName, 'thumbnail.png');
    fs.writeFileSync(thumbPath, screenshotBuffer);

    await page.close();
  } finally {
    await browser.close();
  }
}

/* ----------------------------
   Start server
   ---------------------------- */
app.listen(PORT, () => console.log(`Server online on port ${PORT}`));