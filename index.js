const express = require('express');
const multer = require('multer');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const buildPack = require('./pack-builder');


const app = express();
app.use(cors());
app.use(express.static('static'));


const upload = multer({ dest: 'models/' });


// Upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
if (!req.file) return res.status(400).send('No file uploaded');


console.log("Uploaded model:", req.file.originalname);


// Pack rebuild
await buildPack();


res.send('OK');
});


// Model list
enumFiles = () => fs.readdirSync('models').filter(f => f.endsWith('.json'));
app.get('/models', (req, res) => {
res.json(enumFiles());
});


// Pack download
app.get('/pack.zip', (req, res) => {
res.sendFile(path.join(__dirname, 'public-pack', 'pack.zip'));
});


const PORT = process.env.PORT || 3000;  // use Railway port if available

app.listen(PORT, () => console.log(`Server online on port ${PORT}`));
