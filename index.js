// index.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const AdmZip = require('adm-zip');
const buildPack = require('./pack-builder'); // dein bestehender pack-builder
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.static('static'));
app.use(express.json());

// ------------------------
// Config
// ------------------------
const PORT = process.env.PORT || 8080;

// Persistent storage path (so uploads bleiben auch nach Deployment)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MODELS_DIR = path.join(DATA_DIR, 'models');
if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });

// Temp path für Uploads
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// erlaubte Einzel-Dateien
const allowedSingleExtensions = ['.json', '.obj', '.gltf', '.glb', '.fbx'];

// ------------------------
// Multer
// ------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ------------------------
// Hilfsfunktionen
// ------------------------
function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').trim();
}

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

// ------------------------
// Thumbnail generator (async)
// ------------------------
async function generateThumbnailAsync(modelName) {
  const modelFolder = path.join(MODELS_DIR, modelName);
  const thumbPath = path.join(modelFolder, 'thumbnail.png');

  // Wenn Thumbnail existiert, nichts tun
  if (fs.existsSync(thumbPath)) return;

  try {
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    const url = `http://127.0.0.1:${PORT}/render/${encodeURIComponent(modelName)}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 120_000 });

    // max 60s warten auf canvas
    await page.waitForFunction(() => window.__THUMB_READY === true, { timeout: 60_000 });

    const canvas = await page.$('canvas');
    if (canvas) {
      const screenshotBuffer = await canvas.screenshot({ type: 'png' });
      fs.writeFileSync(thumbPath, screenshotBuffer);
      console.log(`Thumbnail generated: ${modelName}`);
    } else {
      console.warn(`Thumbnail failed: No canvas for ${modelName}`);
    }

    await page.close();
    await browser.close();
  } catch (e) {
    console.warn('Thumbnail generation error (non-fatal):', e.message || e);
  }
}

// ------------------------
// Upload
// ------------------------
app.post('/upload', upload.fields([{ name: 'file' }, { name: 'thumbnail' }]), async (req, res) => {
  try {
    const fnField = req.files?.['file']?.[0];
    const thumbField = req.files?.['thumbnail']?.[0];
    const modelNameRaw = req.body?.modelName;

    if (!modelNameRaw || !fnField) {
      if (fnField?.path) fs.unlinkSync(fnField.path);
      if (thumbField?.path) fs.unlinkSync(thumbField.path);
      return res.status(400).json({ error: 'Missing modelName or file' });
    }

    const modelName = sanitizeName(modelNameRaw);
    const fileExt = path.extname(fnField.originalname).toLowerCase();
    const modelFolder = path.join(MODELS_DIR, modelName);
    if (!fs.existsSync(modelFolder)) fs.mkdirSync(modelFolder, { recursive: true });

    if (fileExt === '.zip') {
      const zip = new AdmZip(fnField.path);
      zip.extractAllTo(modelFolder, true);
      fs.unlinkSync(fnField.path);
    } else if (allowedSingleExtensions.includes(fileExt)) {
      const dest = path.join(modelFolder, fnField.originalname);
      fs.renameSync(fnField.path, dest);
    } else {
      fs.unlinkSync(fnField.path);
      if (thumbField?.path) fs.unlinkSync(thumbField.path);
      return res.status(400).json({ error: 'Invalid file type' });
    }

    // user-uploaded thumbnail
    if (thumbField) {
      const thumbExt = path.extname(thumbField.originalname).toLowerCase();
      if (thumbExt === '.png') fs.renameSync(thumbField.path, path.join(modelFolder, 'thumbnail.png'));
    }

    // Thumbnail generation async (fire-and-forget)
    generateThumbnailAsync(modelName);

    // rebuild pack async
    try { buildPack(); } catch(e){ console.error('pack build failed', e); }

    return res.json({ success: true, model: modelName });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ------------------------
// List all models
// ------------------------
app.get('/models', (req, res) => {
  try {
    const folders = fs.readdirSync(MODELS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    res.json(folders);
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});

// ------------------------
// Delete model (everyone allowed)
// ------------------------
app.delete('/models/:modelName', (req, res) => {
  try {
    const modelName = sanitizeName(req.params.modelName);
    const folder = path.join(MODELS_DIR, modelName);
    if (!fs.existsSync(folder)) return res.status(404).json({ error: 'Not found' });
    fs.rmSync(folder, { recursive: true, force: true });
    try { buildPack(); } catch(e){ console.error('pack build failed', e); }
    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ------------------------
// Serve preview (thumbnail or placeholder)
// ------------------------
app.get('/preview/:modelName', (req, res) => {
  try {
    const modelName = sanitizeName(req.params.modelName);
    const folder = path.join(MODELS_DIR, modelName);
    if (!fs.existsSync(folder)) return res.status(404).send('Not found');

    const thumbPath = path.join(folder, 'thumbnail.png');
    if (fs.existsSync(thumbPath)) return res.sendFile(thumbPath);

    // fallback placeholder (loading)
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72">
      <rect width="100%" height="100%" fill="#f5f5f5"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#999" font-size="10">Rendering...</text>
    </svg>`);
  } catch(e){
    console.error(e);
    res.status(500).send('Error');
  }
});

// ------------------------
// Start server
// ------------------------
app.listen(PORT, () => console.log(`Server online on port ${PORT}`));
