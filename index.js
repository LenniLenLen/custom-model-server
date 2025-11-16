// index.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const AdmZip = require('adm-zip');
const puppeteer = require('puppeteer');
const buildPack = require('./pack-builder');

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

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').trim();
}

/* ----------------------------
   Upload endpoint
   ---------------------------- */
app.post('/upload', upload.fields([{ name: 'file' }, { name: 'thumbnail' }]), async (req, res) => {
  try {
    const fnField = req.files['file']?.[0];
    const thumbField = req.files['thumbnail']?.[0];
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
      return res.status(400).json({ error: 'Invalid file type.' });
    }

    if (thumbField) {
      const thumbExt = path.extname(thumbField.originalname).toLowerCase();
      if (thumbExt === '.png') fs.renameSync(thumbField.path, path.join(modelFolder, 'thumbnail.png'));
      else fs.unlinkSync(thumbField.path);
    }

    // generate thumbnail
    try { await generateThumbnail(modelName); } catch(e){ console.warn('Thumbnail generation failed', e); }
    try { buildPack(); } catch(e){ console.error('pack build failed', e); }

    res.json({ success: true, model: modelName });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

/* ----------------------------
   List all models
   ---------------------------- */
app.get('/models', (req, res) => {
  try {
    const folders = fs.readdirSync(GLOBAL_MODELS_DIR).filter(f => fs.statSync(path.join(GLOBAL_MODELS_DIR,f)).isDirectory());
    res.json(folders);
  } catch(e){ console.error(e); res.status(500).json([]); }
});

/* ----------------------------
   Delete model
   ---------------------------- */
app.delete('/models/:modelName', (req,res) => {
  try {
    const modelName = sanitizeName(req.params.modelName);
    const folder = path.join(GLOBAL_MODELS_DIR, modelName);
    if (!fs.existsSync(folder)) return res.status(404).json({error:'Not found'});
    fs.rmSync(folder, { recursive: true, force: true });
    try { buildPack(); } catch(e){ console.error('pack build failed', e); }
    res.json({success:true});
  } catch(e){ console.error(e); res.status(500).json({error:'Server error'}); }
});

/* ----------------------------
   Serve preview
   ---------------------------- */
app.get('/preview/:modelName', (req,res)=>{
  try{
    const modelName = sanitizeName(req.params.modelName);
    const folder = path.join(GLOBAL_MODELS_DIR, modelName);
    if (!fs.existsSync(folder)) return res.status(404).send('Not found');
    const thumbPath = path.join(folder,'thumbnail.png');
    if (fs.existsSync(thumbPath)) return res.sendFile(thumbPath);
    // placeholder if missing
    return res.sendFile(path.join(__dirname,'static','placeholder.png'));
  } catch(e){ console.error(e); res.status(500).send('Error'); }
});

/* ----------------------------
   Expose model files for renderer
   ---------------------------- */
app.get('/model-file/:modelName/*?', (req,res)=>{
  try{
    const modelName = sanitizeName(req.params.modelName);
    const rel = req.params[0]||'';
    const folder = path.join(GLOBAL_MODELS_DIR, modelName);
    if (!fs.existsSync(folder)) return res.status(404).json([]);
    // if no rel => return JSON listing
    if(!rel) {
      const walk = (dir, base='')=>{
        return fs.readdirSync(dir).flatMap(f=>{
          const p = path.join(dir,f);
          if(fs.statSync(p).isDirectory()) return walk(p,path.join(base,f));
          return path.join(base,f);
        });
      };
      return res.json(walk(folder));
    }
    if(rel.includes('..')) return res.status(400).send('Invalid path');
    const filePath = path.join(folder,rel);
    if(!fs.existsSync(filePath)) return res.status(404).send('Not found');
    res.sendFile(filePath);
  } catch(e){ console.error(e); res.status(500).send('Error'); }
});

/* ----------------------------
   Render page for Puppeteer
   ---------------------------- */
app.get('/render/:modelName',(req,res)=>{
  res.sendFile(path.join(__dirname,'static','render.html'));
});

/* ----------------------------
   Thumbnail generation using Puppeteer
   ---------------------------- */
async function generateThumbnail(modelName){
  const browser = await puppeteer.launch({ args:['--no-sandbox','--disable-setuid-sandbox'] });
  try{
    const page = await browser.newPage();
    await page.setViewport({ width:512, height:512, deviceScaleFactor:1 });
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    const url = `http://127.0.0.1:${PORT}/render/${encodeURIComponent(modelName)}`;
    await page.goto(url, { waitUntil:'networkidle2', timeout:60000 });
    await page.waitForFunction(()=>window.__THUMB_READY===true,{timeout:30000});
    const canvas = await page.$('canvas');
    if(canvas){
      const buffer = await canvas.screenshot({ type:'png' });
      fs.writeFileSync(path.join(GLOBAL_MODELS_DIR, modelName, 'thumbnail.png'), buffer);
    }
    await page.close();
  } finally { await browser.close(); }
}

/* ----------------------------
   Start server
   ---------------------------- */
app.listen(PORT, ()=>console.log(`Server running on port ${PORT}`));
