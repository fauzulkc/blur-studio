import express from 'express';
import cors from 'cors';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import * as blurService from './blurService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3333;

app.use(cors());
app.use(express.json({ limit: '100mb' }));

// 1. Quick presets endpoint
app.get('/api/presets', async (req, res) => {
  try {
    const result = await blurService.listPresets();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// 2. Scan folder endpoint
app.post('/api/scan-folder', async (req, res) => {
  try {
    const result = await blurService.scanFolder(req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// 3. Raw image stream endpoint
app.get('/raw-image', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send('Image file not found');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  };

  res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(filePath).pipe(res);
});

// 4. Save Targets / Exclusions Config
app.post('/api/save-config', async (req, res) => {
  try {
    const result = await blurService.saveImageConfig(req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// 5. Apply Blur Endpoint (Calls Python blur_processor.py)
app.post('/api/apply-blur', async (req, res) => {
  try {
    const result = await blurService.applyBlur(req.body);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// 6. Export Python Code Snippet
app.get('/api/export-python', async (req, res) => {
  try {
    const result = await blurService.exportPythonSnippet();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// 7. Download a single processed file (forces a browser download rather than
// the inline `/raw-image` preview stream)
app.get('/api/download', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }
  res.download(filePath, path.basename(filePath));
});

// 8. Download several processed files as a single zip (shells out to the
// system `zip` binary — avoids adding a new dependency for one feature).
// `-j` junks each entry's directory path so the zip holds flat filenames.
app.post('/api/download-batch', (req, res) => {
  const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
  const existing = paths.filter((p) => typeof p === 'string' && fs.existsSync(p));

  if (existing.length === 0) {
    return res.status(400).json({ error: 'No valid file paths provided' });
  }

  const tmpZipPath = path.join(os.tmpdir(), `blur-studio-batch-${Date.now()}-${Math.round(Math.random() * 1e6)}.zip`);
  const zipProcess = spawn('zip', ['-j', tmpZipPath, ...existing]);

  let stderrData = '';
  zipProcess.stderr.on('data', (d) => { stderrData += d.toString(); });

  zipProcess.on('error', (err) => {
    res.status(500).json({ error: 'zip command not available: ' + err.message });
  });

  zipProcess.on('close', (code) => {
    if (code !== 0 || !fs.existsSync(tmpZipPath)) {
      console.error('zip failed:', stderrData);
      return res.status(500).json({ error: 'Failed to create zip archive' });
    }
    res.download(tmpZipPath, 'blurred-photos.zip', (err) => {
      fs.unlink(tmpZipPath, () => {});
      if (err) console.error('Error sending zip:', err);
    });
  });
});

// Serve frontend build if dist exists
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  🎨 Image Blur Studio Backend Running on Port ${PORT}`);
  console.log(`  🔗 API: http://localhost:${PORT}/api/scan-folder`);
  console.log(`======================================================\n`);
});
