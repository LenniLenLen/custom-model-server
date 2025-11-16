// index.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const AdmZip = require('adm-zip');
const buildPack = require('./pack-builder'); // bleibt wie gehabt - pack builder sollte die models/ folder einlesen

const app = express();
app.use(cors());
app.use(express.static('static'));
app.use(express.json());

const PORT = process.env.PORT || 8080;
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Allowed single-file extensions
const allowedSingleExtensions = ['.json', '.obj', '.gltf', '.glb', '.fbx'];

// Multer - accepts two fields: file (zip or single model) and optional thumbnail
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Ensure global models folder exists
const GLOBAL_MODELS_DIR = path.join(__dirname, 'models');
if (!fs.existsSync(GLOBAL_MODELS_DIR)) fs.mkdirSync(GLOBAL_MODELS_DIR, { recursive: true });

// Helper: sanitize model name (avoid ../ etc.)
function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').trim();
}

// Upload endpoint
// Accept multipart with 'file' and optional 'thumbnail'
app.post('/upload', upload.fields([{ name: 'file' }, { name: 'thumbnail' }]), (req, res) => {
  try {
    const fields = req.body || {};
    const fnField = req.files && req.files['file'] && req.files['file'][0];
    const thumbField = req.files && req.files['thumbnail'] && req.files['thumbnail'][0];

    const modelNameRaw = fields.modelName;
    if (!modelNameRaw || !fnField) {
      // cleanup uploaded temp files if any
      if (fnField && fs.existsSync(fnField.path)) fs.unlinkSync(fnField.path);
      if (thumbField && fs.existsSync(thumbField.path)) fs.unlinkSync(thumbField.path);
      return res.status(400).json({ error: 'Missing modelName or file' });
    }

    const modelName = sanitizeName(modelNameRaw);
    const fileOrigName = fnField.originalname;
    const ext = path.extname(fileOrigName).toLowerCase();

    const modelFolder = path.join(GLOBAL_MODELS_DIR, modelName);
    if (!fs.existsSync(modelFolder)) fs.mkdirSync(modelFolder, { recursive: true });

    // If zip -> extract into model folder
    if (ext === '.zip') {
      const zip = new AdmZip(fnField.path);
      zip.extractAllTo(modelFolder, true);
      // try to extract a thumbnail inside zip: look for thumbnail.png or preview.png
      const candidates = ['thumbnail.png','preview.png','icon.png'];
      let foundThumb = false;
      for (const c of candidates) {
        const inside = path.join(modelFolder, c);
        if (fs.existsSync(inside)) { foundThumb = true; break; }
      }
      // if external thumbnail uploaded, prefer that (below)
      // remove temp zip
      fs.unlinkSync(fnField.path);
    }
    // Single file model uploads: copy file into model folder
    else if (allowedSingleExtensions.includes(ext)) {
      const dest = path.join(modelFolder, path.basename(fnField.originalname));
      fs.renameSync(fnField.path, dest);
    } else {
      // invalid type
      fs.unlinkSync(fnField.path);
      if (thumbField && fs.existsSync(thumbField.path)) fs.unlinkSync(thumbField.path);
      return res.status(400).json({ error: 'Invalid file type. Use .zip or supported model formats.' });
    }

    // If user provided a separate thumbnail file, move it to modelFolder/thumbnail.png
    if (thumbField) {
      const thumbDest = path.join(modelFolder, 'thumbnail.png');
      // if uploaded thumbnail is not png, try to convert? For now require png.
      const thumbExt = path.extname(thumbField.originalname).toLowerCase();
      if (thumbExt !== '.png') {
        // delete and return error
        fs.unlinkSync(thumbField.path);
        return res.status(400).json({ error: 'Thumbnail must be a PNG file.' });
      } else {
        fs.renameSync(thumbField.path, thumbDest);
      }
    }

    // Rebuild pack (async ok)
    try { buildPack(); } catch (e) { console.error('pack build error', e); }

    return res.json({ success: true, model: modelName });
  } catch (err) {
    console.error('upload error', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// List all models (global)
app.get('/models', (req, res) => {
  try {
    if (!fs.existsSync(GLOBAL_MODELS_DIR)) return res.json([]);
    const entries = fs.readdirSync(GLOBAL_MODELS_DIR, { withFileTypes: true });
    const folders = entries.filter(d => d.isDirectory()).map(d => d.name);
    res.json(folders);
  } catch (e) {
    console.error(e);
    res.status(500).json([]);
  }
});

// Delete a model (trust-based: anyone can delete)
app.delete('/models/:modelName', (req, res) => {
  try {
    const modelName = sanitizeName(req.params.modelName);
    const modelFolder = path.join(GLOBAL_MODELS_DIR, modelName);
    if (!fs.existsSync(modelFolder)) return res.status(404).json({ error: 'Not found' });

    fs.rmSync(modelFolder, { recursive: true, force: true });
    try { buildPack(); } catch (e) { console.error('pack build error', e); }
    return res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Serve preview images: prefer thumbnail.png, else first png, else 404 or placeholder
app.get('/preview/:modelName', (req, res) => {
  try {
    const modelName = sanitizeName(req.params.modelName);
    const modelFolder = path.join(GLOBAL_MODELS_DIR, modelName);
    if (!fs.existsSync(modelFolder)) return res.status(404).send('Not found');

    const thumbPath = path.join(modelFolder, 'thumbnail.png');
    if (fs.existsSync(thumbPath)) return res.sendFile(thumbPath);

    // find first png in folder recursively
    const png = findFirstFileRecursive(modelFolder, (f) => f.toLowerCase().endsWith('.png'));
    if (png) return res.sendFile(png);

    // else return placeholder 1x1 transparent or a bundled placeholder
    return res.status(404).send('No preview');
  } catch (e) {
    console.error(e);
    res.status(500).send('Error');
  }
});

// Utility: find first file recursively matching predicate
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

// Serve raw model files if needed (optional)
// app.use('/models-files', express.static(GLOBAL_MODELS_DIR));

app.get('/pack.zip', (req, res) => {
  const packPath = path.join(__dirname, 'public-pack', 'pack.zip');
  if (fs.existsSync(packPath)) return res.sendFile(packPath);
  return res.status(404).send('Pack not built yet');
});

app.listen(PORT, () => console.log(`Server online on port ${PORT}`));
