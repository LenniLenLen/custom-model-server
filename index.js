// index.js (updated - no puppeteer, quick sharp thumbnails)
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const AdmZip = require('adm-zip');
const sharp = require('sharp'); // new: used for thumbnail generation
const buildPack = require('./pack-builder'); // keep your pack builder

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
    } else {
      // No user-provided thumbnail: try to auto-generate a quick plane thumbnail from textures
      try {
        await generatePlaneThumbnail(modelName);
      } catch (err) {
        console.warn('Thumbnail generation (plane) failed (non-fatal):', err.message || err);
      }
    }

    // rebuild pack (keep async-safe)
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
   QUICK plane thumbnail generation using sharp
   - picks first referenced texture (from model JSON) or first PNG in folder
   - composes into a 256x256 PNG with a soft background + border
   ---------------------------- */
async function generatePlaneThumbnail(modelName) {
  const modelFolder = path.join(GLOBAL_MODELS_DIR, modelName);

  // find a model JSON to inspect textures
  const jsonPath = findFirstFileRecursive(modelFolder, (n) => n.toLowerCase().endsWith('.json'));
  let texturePath = null;

  if (jsonPath) {
    try {
      const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      if (j.textures) {
        // pick first texture value
        const vals = Object.values(j.textures).filter(v => typeof v === 'string');
        if (vals.length > 0) {
          let texRef = vals[0];
          if (texRef.startsWith('#')) texRef = texRef.substring(1);
          // try common locations
          const candidates = [
            path.join(modelFolder, texRef + '.png'),
            path.join(modelFolder, 'textures', texRef + '.png'),
            path.join(modelFolder, 'assets', 'minecraft', 'textures', texRef + '.png'),
            path.join(modelFolder, texRef),
          ];
          for (const c of candidates) {
            if (fs.existsSync(c)) { texturePath = c; break; }
          }
        }
      }
    } catch (e) {
      // ignore JSON parse errors
    }
  }

  // fallback: first png in folder
  if (!texturePath) {
    const found = findFirstFileRecursive(modelFolder, (n) => n.toLowerCase().endsWith('.png'));
    if (found) texturePath = found;
  }

  // If still no texture, create simple placeholder
  const outPath = path.join(modelFolder, 'thumbnail.png');
  const SIZE = 256;

  if (!texturePath) {
    // create placeholder PNG with text
    const buffer = await sharp({
      create: {
        width: SIZE,
        height: SIZE,
        channels: 4,
        background: { r: 245, g: 245, b: 245, alpha: 1 }
      }
    })
    .composite([{
      input: Buffer.from(
        `<svg width="${SIZE}" height="${SIZE}">
          <rect width="100%" height="100%" fill="#f5f5f5"/>
          <text x="50%" y="50%" font-size="20" text-anchor="middle" fill="#999" dominant-baseline="middle">no preview</text>
        </svg>`
      ),
      top: 0, left: 0
    }])
    .png()
    .toBuffer();
    fs.writeFileSync(outPath, buffer);
    return;
  }

  // Compose texture into a nice thumbnail: background + centered texture with border
  // Load texture and resize to fit into a square while preserving aspect
  const texture = sharp(texturePath).ensureAlpha();

  // get metadata to compute scale
  const meta = await texture.metadata();
  // scale to fit within 200x200
  const maxInner = 200;
  let width = meta.width || maxInner;
  let height = meta.height || maxInner;
  const scale = Math.min(maxInner / width, maxInner / height, 1);
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  const resizedTexBuffer = await texture.resize(width, height).toBuffer();

  // build base SVG background (subtle gradient)
  const svgBg = Buffer.from(`
    <svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#fff"/>
          <stop offset="100%" stop-color="#ededed"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
    </svg>
  `);

  // create shadow & border by composing several layers
  // Center position for texture:
  const left = Math.round((SIZE - width) / 2);
  const top = Math.round((SIZE - height) / 2);

  // create thumbnail by compositing background + shadow + texture + border
  let composed = sharp(svgBg)
    .composite([
      // soft shadow (a blurred rect behind the texture)
      {
        input: Buffer.from(`<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
          <rect x="${left-6}" y="${top-6}" rx="8" ry="8" width="${width+12}" height="${height+12}" fill="#000" fill-opacity="0.12"/>
        </svg>`),
        blend: 'over'
      },
      // the texture image
      {
        input: resizedTexBuffer,
        left: left,
        top: top
      },
      // subtle border around texture
      {
        input: Buffer.from(`<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
          <rect x="${left-1}" y="${top-1}" width="${width+2}" height="${height+2}" fill="none" stroke="#ddd" stroke-width="2" rx="4" ry="4"/>
        </svg>`),
        blend: 'over'
      }
    ])
    .png();

  const outBuffer = await composed.toBuffer();
  fs.writeFileSync(outPath, outBuffer);
}

/* ----------------------------
   Start server
   ---------------------------- */
app.listen(PORT, () => console.log(`Server online on port ${PORT}`));
