import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SAMPLE_PHOTOS_DIR = path.join(__dirname, 'sample-photos');

// Demo targets/exclusions for the bundled sample photos (see sample-photos/),
// so the app has something to show on first run without touching real data.
const INITIAL_PRESET_TARGETS = {
  'sample-1.jpg': [
    { cx: 0.25, cy: 0.425, rx: 0.06, ry: 0.09, label: 'Person 1' },
    { cx: 0.5, cy: 0.45, rx: 0.065, ry: 0.1, label: 'Person 2' }
  ]
};

const INITIAL_EXCLUSIONS = {
  'sample-1.jpg': [{ x1: 0.033, y1: 0.05, x2: 0.967, y2: 0.175, label: 'Banner (protected)' }]
};

const CONFIG_PATH = path.join(__dirname, 'blur_studio_config.json');

// Helper to load or init config
function getAppConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
      console.error('Error reading config file:', e);
    }
  }
  const defaultConf = {
    targets: INITIAL_PRESET_TARGETS,
    exclusions: INITIAL_EXCLUSIONS,
    lastSourceFolder: SAMPLE_PHOTOS_DIR,
    lastDestinationFolder: path.join(__dirname, 'sample-photos-blurred'),
    destinationMode: 'separate_folder', // 'replace' | 'separate_folder'
    blurRadius: 13.0,
    featherRadius: 14.0
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConf, null, 2));
  return defaultConf;
}

// Runs blur_processor.py with the given CLI args and resolves with its
// stdout/stderr/exit code once the process closes (promisified spawn).
function runPythonProcessor(args) {
  return new Promise((resolve, reject) => {
    const pyProcess = spawn('python3', args);

    let stdoutData = '';
    let stderrData = '';

    pyProcess.stdout.on('data', data => {
      stdoutData += data.toString();
    });

    pyProcess.stderr.on('data', data => {
      stderrData += data.toString();
    });

    pyProcess.on('error', reject);

    pyProcess.on('close', code => {
      resolve({ stdout: stdoutData, stderr: stderrData, code });
    });
  });
}

// 1. Quick presets — folder shortcuts shown in the source-folder dropdown.
// Only the bundled sample folder ships by default; add your own project
// folders here (or just paste a path into the source folder field directly).
export async function listPresets() {
  const presets = [
    { id: 'sample', name: 'Sample Photos', path: SAMPLE_PHOTOS_DIR }
  ];
  return { presets };
}

// 2. Scan folder
export async function scanFolder({ folderPath } = {}) {
  const targetDir = folderPath ? path.resolve(folderPath) : getAppConfig().lastSourceFolder;

  if (!fs.existsSync(targetDir)) {
    const err = new Error(`Directory not found: ${targetDir}`);
    err.statusCode = 404;
    throw err;
  }

  const stat = fs.statSync(targetDir);
  if (!stat.isDirectory()) {
    const err = new Error(`Path is not a directory: ${targetDir}`);
    err.statusCode = 400;
    throw err;
  }

  const config = getAppConfig();
  const files = fs.readdirSync(targetDir);
  const validExts = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'];

  const images = files
    .filter(f => validExts.includes(path.extname(f).toLowerCase()) && !f.endsWith('.bak'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(filename => {
      const fullPath = path.join(targetDir, filename);
      const fileStat = fs.statSync(fullPath);
      const targets = config.targets[filename] || [];
      const exclusions = config.exclusions[filename] || [];

      return {
        id: filename,
        filename,
        fullPath,
        sizeBytes: fileStat.size,
        modified: fileStat.mtime,
        hasBackup: fs.existsSync(fullPath + '.bak'),
        targets,
        exclusions,
        streamUrl: `/raw-image?path=${encodeURIComponent(fullPath)}`
      };
    });

  // Update last used folder
  config.lastSourceFolder = targetDir;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  return {
    folderPath: targetDir,
    count: images.length,
    images,
    config: {
      blurRadius: config.blurRadius || 13.0,
      featherRadius: config.featherRadius || 14.0,
      destinationMode: config.destinationMode || 'separate_folder',
      lastDestinationFolder: config.lastDestinationFolder || targetDir + '_blurred'
    }
  };
}

// The full persisted config object, as-is (no existing route uses this today —
// it exists for future CLI/MCP callers that need the raw config).
export async function getFullConfig() {
  return getAppConfig();
}

// 4. Save targets / exclusions config
export async function saveImageConfig({
  filename,
  targets,
  exclusions,
  blurRadius,
  featherRadius,
  destinationMode,
  lastDestinationFolder
} = {}) {
  const config = getAppConfig();

  if (filename) {
    if (targets !== undefined) config.targets[filename] = targets;
    if (exclusions !== undefined) config.exclusions[filename] = exclusions;
  }
  if (blurRadius !== undefined) config.blurRadius = blurRadius;
  if (featherRadius !== undefined) config.featherRadius = featherRadius;
  if (destinationMode !== undefined) config.destinationMode = destinationMode;
  if (lastDestinationFolder !== undefined) config.lastDestinationFolder = lastDestinationFolder;

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  return { message: 'Configuration saved' };
}

// 5. Apply blur (calls out to Python blur_processor.py)
export async function applyBlur({
  items, // array of { inputPath, outputPath, targets, exclusions }
  blurRadius = 13.0,
  featherRadius = 14.0,
  destinationMode = 'separate_folder',
  destinationFolder,
  makeBackup = true
} = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error('No items provided for blurring');
    err.statusCode = 400;
    throw err;
  }

  // Prepare batch processing payload
  const processedItems = items.map(item => {
    let finalOutputPath = item.outputPath;
    if (!finalOutputPath) {
      if (destinationMode === 'replace') {
        finalOutputPath = item.inputPath;
      } else {
        const destDir = destinationFolder || path.join(path.dirname(item.inputPath), 'blurred_output');
        finalOutputPath = path.join(destDir, path.basename(item.inputPath));
      }
    }
    return {
      inputPath: item.inputPath,
      outputPath: finalOutputPath,
      targets: item.targets || [],
      exclusions: item.exclusions || []
    };
  });

  const payload = {
    blurRadius,
    featherRadius,
    backup: destinationMode === 'replace' && makeBackup,
    items: processedItems
  };

  const pythonScript = path.join(__dirname, 'blur_processor.py');
  const { stdout, stderr, code } = await runPythonProcessor([pythonScript, '--json', JSON.stringify(payload)]);

  if (code !== 0) {
    console.error('Python processor error:', stderr);
    const err = new Error('Processing failed in Python engine');
    err.statusCode = 500;
    err.details = stderr;
    throw err;
  }

  try {
    const result = JSON.parse(stdout);
    return { processed: result.processed };
  } catch (err) {
    return { rawOutput: stdout };
  }
}

// 6. Export Python code snippet
export async function exportPythonSnippet() {
  const config = getAppConfig();
  let pyCode = `# Auto-generated from Image Blur Studio\n\n`;
  pyCode += `EXCLUSION_BOXES = {\n`;
  for (const [fname, boxes] of Object.entries(config.exclusions || {})) {
    if (boxes && boxes.length > 0) {
      const b = boxes[0];
      const x1 = b.x1 ?? b[0];
      const y1 = b.y1 ?? b[1];
      const x2 = b.x2 ?? b[2];
      const y2 = b.y2 ?? b[3];
      pyCode += `    "${fname}": (${Number(x1).toFixed(2)}, ${Number(y1).toFixed(2)}, ${Number(x2).toFixed(2)}, ${Number(y2).toFixed(2)}),\n`;
    }
  }
  pyCode += `}\n\n`;

  pyCode += `EXPLICIT_BLUR_TARGETS = {\n`;
  for (const [fname, targets] of Object.entries(config.targets || {})) {
    if (targets && targets.length > 0) {
      pyCode += `    "${fname}": [\n`;
      for (const t of targets) {
        const cx = t.cx ?? t[0];
        const cy = t.cy ?? t[1];
        const rx = t.rx ?? t[2];
        const ry = t.ry ?? t[3];
        const label = t.label ? ` # ${t.label}` : '';
        pyCode += `        (${Number(cx).toFixed(4)}, ${Number(cy).toFixed(4)}, ${Number(rx).toFixed(4)}, ${Number(ry).toFixed(4)}),${label}\n`;
      }
      pyCode += `    ],\n`;
    }
  }
  pyCode += `}\n`;

  return { pythonCode: pyCode };
}
