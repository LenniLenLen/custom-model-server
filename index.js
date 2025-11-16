const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const AdmZip = require('adm-zip');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.static('static'));
app.use(express.json());

const PORT = process.env.PORT || 8080;
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
const MODELS_DIR = path.join(__dirname, 'models');
if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });

const allowedModelExts = ['.json', '.obj', '.gltf', '.glb', '.fbx'];

// Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// sanitize name
const sanitize = (n) => n.replace(/[^a-zA-Z0-9._-]/g, '_').trim();

/* ------------------ Upload ------------------ */
app.post('/upload', upload.fields([{ name: 'file' }, { name: 'thumbnail' }]), async (req, res) => {
  try {
    const fileField = req.files?.file?.[0];
    const thumbField = req.files?.thumbnail?.[0];
    const rawName = req.body?.modelName;
    if (!fileField || !rawName) return res.status(400).json({ error: 'Missing name or file' });

    const modelName = sanitize(rawName);
    const folder = path.join(MODELS_DIR, modelName);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    const ext = path.extname(fileField.originalname).toLowerCase();

    // unzip or move
    if (ext === '.zip') {
      const zip = new AdmZip(fileField.path);
      zip.extractAllTo(folder, true);
      fs.unlinkSync(fileField.path);
    } else if (allowedModelExts.includes(ext)) {
      fs.renameSync(fileField.path, path.join(folder, fileField.originalname));
    } else {
      fs.unlinkSync(fileField.path);
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    // optional thumbnail upload
    if (thumbField) {
      const tExt = path.extname(thumbField.originalname).toLowerCase();
      if (tExt === '.png') fs.renameSync(thumbField.path, path.join(folder, 'thumbnail.png'));
      else fs.unlinkSync(thumbField.path);
    }

    // generate thumbnail (async, wait for Puppeteer)
    try { await generateThumbnail(modelName); } catch(e){ console.warn('Thumbnail failed', e); }

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ------------------ List models ------------------ */
app.get('/models', (req, res) => {
  try {
    const folders = fs.readdirSync(MODELS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
    res.json(folders);
  } catch(e){ res.status(500).json([]); }
});

/* ------------------ Delete model ------------------ */
app.delete('/models/:name', (req,res)=>{
  try {
    const model = sanitize(req.params.name);
    const folder = path.join(MODELS_DIR, model);
    if (!fs.existsSync(folder)) return res.status(404).json({ error:'Not found' });
    fs.rmSync(folder,{recursive:true,force:true});
    res.json({success:true});
  } catch(e){ console.error(e); res.status(500).json({error:'Server error'}); }
});

/* ------------------ Serve thumbnail ------------------ */
app.get('/preview/:name', (req,res)=>{
  const model = sanitize(req.params.name);
  const folder = path.join(MODELS_DIR, model);
  const thumb = path.join(folder,'thumbnail.png');
  if (fs.existsSync(thumb)) return res.sendFile(thumb);
  return res.status(404).send('No thumbnail');
});

/* ------------------ Serve model files ------------------ */
app.get('/model-file/:name/*', (req,res)=>{
  try {
    const model = sanitize(req.params.name);
    const rel = req.params[0]||'';
    if (rel.includes('..')) return res.status(400).send('Invalid path');
    const filePath = path.join(MODELS_DIR, model, rel);
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
    res.sendFile(filePath);
  } catch(e){ res.status(500).send('Error'); }
});

/* ------------------ Render for Puppeteer ------------------ */
app.get('/render/:name',(req,res)=>{
  res.sendFile(path.join(__dirname,'static','render.html'));
});

/* ------------------ Thumbnail generator ------------------ */
async function generateThumbnail(modelName){
  const browser = await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
  try {
    const page = await browser.newPage();
    await page.setViewport({width:512,height:512});
    page.on('console', msg=>console.log('PAGE LOG:',msg.text()));
    const url = `http://127.0.0.1:${PORT}/render/${encodeURIComponent(modelName)}`;
    await page.goto(url,{waitUntil:'networkidle2'});
    await page.waitForFunction(()=>window.__THUMB_READY===true);
    const canvas = await page.$('canvas');
    if(!canvas) throw new Error('No canvas found');
    const buffer = await canvas.screenshot({type:'png'});
    fs.writeFileSync(path.join(MODELS_DIR,modelName,'thumbnail.png'), buffer);
    await page.close();
  } finally { await browser.close(); }
}

/* ------------------ Start ------------------ */
app.listen(PORT,()=>console.log(`Server running on ${PORT}`));
