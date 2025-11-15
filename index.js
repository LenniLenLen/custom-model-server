const express = require('express');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const buildPack = require('./pack-builder');

const app = express();
app.use(cors());
app.use(express.static('static'));
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Middleware to create user folder
function ensureUserFolder(username) {
  const folder = path.join(__dirname, 'models', username);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  return folder;
}

// Upload setup
const upload = multer({ dest: 'temp/' });

app.post('/upload', upload.single('file'), (req, res) => {
  const { username, modelName } = req.body;
  if (!username || !modelName || !req.file) return res.status(400).send('Missing info');

  const userFolder = ensureUserFolder(username);

  const destPath = path.join(userFolder, `${modelName}.json`);
  fs.renameSync(req.file.path, destPath);

  buildPack(); // rebuild pack.zip

  res.send({ success: true, modelName });
});

// List user models
app.get('/models/:username', (req, res) => {
  const userFolder = path.join(__dirname, 'models', req.params.username);
  if (!fs.existsSync(userFolder)) return res.json([]);
  const files = fs.readdirSync(userFolder).filter(f => f.endsWith('.json'));
  res.json(files);
});

// Delete a model
app.delete('/models/:username/:modelName', (req, res) => {
  const { username, modelName } = req.params;
  const userFolder = path.join(__dirname, 'models', username);
  const filePath = path.join(userFolder, modelName);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  fs.unlinkSync(filePath);

  buildPack(); // rebuild pack.zip
  res.send({ success: true });
});

// Pack download
app.get('/pack.zip', (req, res) => {
  res.sendFile(path.join(__dirname, 'public-pack', 'pack.zip'));
});

app.listen(PORT, () => console.log(`Server online on port ${PORT}`));
