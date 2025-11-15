const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const AdmZip = require('adm-zip');
const buildPack = require('./pack-builder');

const app = express();
app.use(cors());
app.use(express.static('static'));
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Allowed extensions for single file uploads
const allowedSingleExtensions = ['.json', '.obj', '.gltf', '.glb', '.fbx'];

// Create user folder if not exists
function ensureUserFolder(username) {
  const folder = path.join(__dirname, 'models', username);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  return folder;
}

// Multer setup
const upload = multer({ dest: 'temp/' });

// Upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  const { username, modelName } = req.body;
  if (!username || !modelName || !req.file) return res.status(400).send('Missing info');

  const ext = path.extname(req.file.originalname).toLowerCase();
  const userFolder = ensureUserFolder(username);
  const modelFolder = path.join(userFolder, modelName);

  if (!fs.existsSync(modelFolder)) fs.mkdirSync(modelFolder, { recursive: true });

  if (ext === '.zip') {
    // Extract ZIP
    const zip = new AdmZip(req.file.path);
    zip.extractAllTo(modelFolder, true);
    fs.unlinkSync(req.file.path);
  } else if (allowedSingleExtensions.includes(ext)) {
    // Single file upload
    const destPath = path.join(modelFolder, req.file.originalname);
    fs.renameSync(req.file.path, destPath);
  } else {
    fs.unlinkSync(req.file.path);
    return res.status(400).send(`Invalid file type. Allowed: ${allowedSingleExtensions.join(', ')}, .zip`);
  }

  buildPack(); // rebuild pack.zip
  res.send({ success: true });
});

// List user models
app.get('/models/:username', (req, res) => {
  const userFolder = path.join(__dirname, 'models', req.params.username);
  if (!fs.existsSync(userFolder)) return res.json([]);
  const folders = fs.readdirSync(userFolder, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => dirent.name);
  res.json(folders);
});

// Delete a model
app.delete('/models/:username/:modelName', (req, res) => {
  const { username, modelName } = req.params;
  const modelFolder = path.join(__dirname, 'models', username, modelName);
  if (!fs.existsSync(modelFolder)) return res.status(404).send('Not found');

  fs.rmSync(modelFolder, { recursive: true, force: true });
  buildPack(); // rebuild pack.zip
  res.send({ success: true });
});

// Pack download
app.get('/pack.zip', (req, res) => {
  res.sendFile(path.join(__dirname, 'public-pack', 'pack.zip'));
});

app.listen(PORT, () => console.log(`Server online on port ${PORT}`));
