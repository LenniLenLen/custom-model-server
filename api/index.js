const express = require('express');
const serverless = require('serverless-http');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const cors = require('cors');
const puppeteer = require('puppeteer');
const buildPack = require('../pack-builder'); // your existing pack builder

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../static')));

const TEMP_DIR = path.join(__dirname, '../temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
const GLOBAL_MODELS_DIR = path.join(__dirname, '../models');
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
app.post('/api/upload', upload.fields([{ name: 'file' }, { name: 'thumbnail' }]), async (req, res) => {
  try {
    const fnField = req.files?.file?.[0];
    const thumbField = req.files?.thumbnail?.[0];
    const modelNameRaw = req.body?.modelName;
    if (!modelNameRaw || !fnField) return res.status(400).json({ error: 'Missing modelName or file' });

    const modelName = sanitizeName(modelNameRaw);
    const ext = path.extname(fnField.originalname).toLowerCase();
    const modelFolder = path.join(GLOBAL_MODELS_DIR, modelName);
    if (!fs.existsSync(modelFolder)) fs.mkdirSync(modelFolder, { recursive: true });

    if (ext === '.zip') {
      const zip = new AdmZip(fnField.path);
      zip.extractAllTo(modelFolder, true);
      fs.unlinkSync(fnField.path);
    } else if (allowedSingleExtensions.includes(ext)) {
      fs.renameSync(fnField.path, path.join(modelFolder, fnField.originalname));
    } else {
      fs.unlinkSync(fnField.path);
      if (thumbField) fs.unlinkSync(thumbField.path);
      return res.status(400).json({ error: 'Invalid file type.' });
    }

    if (thumbField) {
      if (path.extname(thumbField.originalname).toLowerCase() === '.png') {
        fs.renameSync(thumbField.path, path.join(modelFolder, 'thumbnail.png'));
      }
    }

    // generate thumbnail async
    generateThumbnail(modelName).catch(err => console.warn('Thumbnail failed', err));

    try { buildPack(); } catch(e){ console.error('pack build failed', e); }
    return res.json({ success: true, model: modelName });
  } catch (err) {
    console.error('upload error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/* ----------------------------
   List all models
---------------------------- */
app.get('/api/models', (req, res) => {
  try {
    const folders = fs.readdirSync(GLOBAL_MODELS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
    res.json(folders);
  } catch(e) { console.error(e); res.status(500).json([]); }
});

/* ----------------------------
   Delete model
---------------------------- */
app.delete('/api/models/:modelName', (req, res) => {
  try {
    const modelFolder = path.join(GLOBAL_MODELS_DIR, sanitizeName(req.params.modelName));
    if (!fs.existsSync(modelFolder)) return res.status(404).json({ error: 'Not found' });
    fs.rmSync(modelFolder, { recursive: true, force: true });
    try { buildPack(); } catch(e){ console.error('pack build failed', e); }
    return res.json({ success: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

/* ----------------------------
   Serve preview
---------------------------- */
app.get('/api/preview/:modelName', (req, res) => {
  try {
    const folder = path.join(GLOBAL_MODELS_DIR, sanitizeName(req.params.modelName));
    const thumb = path.join(folder, 'thumbnail.png');
    if (fs.existsSync(thumb)) return res.sendFile(thumb);
    return res.status(404).send('No preview');
  } catch(e) { console.error(e); res.status(500).send('Error'); }
});

/* ----------------------------
   Puppeteer thumbnail
---------------------------- */
async function generateThumbnail(modelName) {
  const browser = await puppeteer.launch({ args:['--no-sandbox','--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 512, height: 512 });
    const url = `http://localhost:3000/static/render.html?model=${encodeURIComponent(modelName)}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(() => window.__THUMB_READY === true, { timeout: 60000 });
    const canvas = await page.$('canvas');
    if (!canvas) throw new Error('No canvas found');
    const buffer = await canvas.screenshot({ type: 'png' });
    fs.writeFileSync(path.join(GLOBAL_MODELS_DIR, modelName, 'thumbnail.png'), buffer);
    await page.close();
  } finally { await browser.close(); }
}

// export for Vercel
module.exports = app;
module.exports.handler = serverless(app);
