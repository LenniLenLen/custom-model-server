# 🎮 Minecraft Custom Model Server

Eine Vercel-Web-App zum Hochladen von Minecraft 3D-Modellen mit automatischer Resourcepack-Generierung und CloudNord-Integration.

## 🚀 Features

- **📁 Modell-Upload**: Unterstützt .obj, .gltf, .glb, .json Modelle und .png Texturen
- **🖼️ 3D-Thumbnails**: Automatische Generierung mit Puppeteer und Three.js
- **☁️ Cloud Storage**: Persistente Speicherung mit Cloudflare R2
- **📦 Resourcepack-Automatisierung**: Automatische Generierung von Minecraft Resourcepacks
- **🔄 Server-Integration**: Automatischer Upload zu CloudNord Minecraft-Server
- **📱 Responsive UI**: Modernes Frontend mit Drag-and-Drop

## 🏗️ Architektur

- **Hosting**: Vercel (Serverless Functions)
- **Storage**: Cloudflare R2
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Backend**: Node.js mit AWS SDK
- **3D Rendering**: Three.js + Puppeteer

## 📋 Voraussetzungen

### Cloudflare R2 Storage
- R2 Bucket erstellen
- Access Keys generieren
- Environment Variables setzen

### CloudNord Server (Optional)
- API-Zugangsdaten
- Server-ID

## ⚙️ Environment Variables

```bash
# Cloudflare R2
R2_ENDPOINT=https://your-account.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=minecraft-models

# CloudNord (Optional)
CLOUDNORD_API_URL=https://api.cloudnord.com
CLOUDNORD_API_KEY=your-api-key
CLOUDNORD_SERVER_ID=your-server-id
CLOUDNORD_RESOURCEPACK_PATH=/resourcepack.zip

# Pack Configuration
PACK_NAMESPACE=custommodels
VERCEL_URL=https://your-app.vercel.app
```

## 🛠️ Installation

1. **Repository klonen**
   ```bash
   git clone <repository-url>
   cd custom-model-server
   ```

2. **Dependencies installieren**
   ```bash
   npm install
   ```

3. **Environment Variables konfigurieren**
   - In Vercel Dashboard unter "Settings" → "Environment Variables"
   - Oder lokal in `.env` Datei

4. **Deployen**
   ```bash
   # Vercel CLI
   vercel --prod
   
   # Oder über GitHub Integration
   ```

## 📁 Projektstruktur

```
custom-model-server/
├── api/                    # Vercel Serverless Functions
│   ├── upload.js           # Modell-Upload
│   ├── list.js             # Modelle auflisten
│   ├── delete.js           # Modell löschen
│   ├── thumbnail.js        # 3D Thumbnail-Generierung
│   ├── buildpack.js        # Resourcepack erstellen
│   └── sendpack.js         # Upload zu CloudNord
├── public/                 # Statische Dateien
│   ├── index.html          # Haupt-Webseite
│   └── render.html         # 3D Renderer für Puppeteer
├── pack-builder.js         # Resourcepack Builder Helper
├── package.json            # Dependencies
├── vercel.json            # Vercel Konfiguration
└── README.md              # Diese Datei
```

## 🎯 API Endpoints

### Modell-Upload
```
POST /api/upload
Content-Type: multipart/form-data
```

### Modelle auflisten
```
GET /api/list
```

### Modell löschen
```
DELETE /api/delete/{modelId}
```

### Thumbnail generieren
```
POST /api/thumbnail/{modelId}
GET  /api/thumbnail/{modelId}  # Bild servieren
```

### Resourcepack erstellen
```
POST /api/buildpack
```

### Upload zu CloudNord
```
POST /api/sendpack
```

## 🎨 Frontend

Die Web-App bietet:

- **Drag-and-Drop Upload** für Modelle und Texturen
- **3D Thumbnail Vorschau** mit automatischer Generierung
- **Modell-Verwaltung** mit Löschfunktion
- **Progress Indicators** während Uploads
- **Responsive Design** für Mobile und Desktop

## 🔧 Entwicklung

### Lokal entwickeln
```bash
npm run dev
```

### Build für Production
```bash
npm run build
```

## 📦 Minecraft Integration

### Resourcepack Struktur
```
resourcepack.zip
├── pack.mcmeta
└── assets/
    └── custommodels/
        ├── models/
        │   └── item/
        │       ├── model1.json
        │       └── model2.json
        └── textures/
            └── item/
                ├── texture1.png
                └── texture2.png
```

### In-Minecraft Verwendung (später)
1. Invisible Item Frames craftable machen
2. Item mit bestimmtem Namen im Amboss umbenennen
3. Item in invisible Item Frame platzieren
4. 3D-Modell erscheint statt normalem Item

## 🐛 Troubleshooting

### Puppeteer Timeout
- Erhöhe Timeout in `thumbnail.js`
- Prüfe Modell-URLs und R2 Konfiguration

### Upload-Fehler
- Prüfe R2 Access Keys
- Kontrolliere File Size Limits (50MB)

### CloudNord Integration
- API-URL und Keys überprüfen
- Server-ID korrekt konfigurieren

## 📝 Lizenz

MIT License

## 🤝 Contributing

1. Fork erstellen
2. Feature Branch entwickeln
3. Pull Request einreichen

---

**Hinweis**: Dieses Projekt ist für Vercel optimiert und nutzt Serverless Functions. Für lokale Entwicklung müssen die Environment Variables entsprechend gesetzt werden.