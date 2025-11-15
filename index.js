const express = require('express');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const buildPack = require('./pack-builder');

const app = express();
app.use(cors());
app.use(express.static('static'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessions to track users
app.use(session({
  secret: 'supersecretkey',
  resave: false,
  saveUninitialized: true
}));

// Ensure models folder exists
if (!fs.existsSync('models')) fs.mkdirSync('models');

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'models/'),
  filename: (req, file, cb) => {
    // filename will be set after getting custom name
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

// Upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
  const customName = req.body.name?.trim();
  if (!req.file || !customName) return res.status(400).send('File and name required');

  const ext = path.extname(req.file.originalname);
  const newFileName = customName + ext;
  const newPath = path.join('models', newFileName);

  // Rename uploaded file
  fs.renameSync(req.file.path, newPath);

  // Save uploader in session
  if (!req.session.uploaded) req.session.uploaded = [];
  req.session.uploaded.push(newFileName);

  // Rebuild pack
  await buildPack();

  res.json({ message: 'Uploaded', file: newFileName });
});

// List models
app.get('/models', (req, res) => {
  const files = fs.readdirSync('models').filter(f => f.endsWith('.json'));
  // Include a flag if the session owns it
  const sessionUploads = req.session.uploaded || [];
  const list = files.map(f => ({
    name: f,
    owned: sessionUploads.includes(f)
  }));
  res.json(list);
});

// Delete model
app.post('/delete', async (req, res) => {
  const { file } = req.body;
  if (!file) return res.status(400).send('File required');

  const sessionUploads = req.session.uploaded || [];
  if (!sessionUploads.includes(file)) return res.status(403).send('Not allowed');

  const filePath = path.join('models', file);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  // Remove from session
  req.session.uploaded = sessionUploads.filter(f => f !== file);

  await buildPack();
  res.json({ message: 'Deleted', file });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server online on port ${PORT}`));
