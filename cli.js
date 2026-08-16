#!/usr/bin/env node
// CLI wrapper around blurService.js — runs the same in-process business logic
// that server.js exposes over HTTP, but from the terminal (or from a script).
//
// Output convention:
//   success -> JSON.stringify(result, null, 2) on stdout, exit 0
//   failure -> JSON.stringify({ success: false, error }) on stderr, exit 1
// (export-python --raw is the one deliberate exception: it prints the plain
// pythonCode string on stdout so it can be piped straight into a .py file.)

import fs from 'fs';
import { Command } from 'commander';
import * as blurService from './blurService.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Accepts either an inline JSON string, or an @-prefixed path to a file
// containing JSON (curl's @file idiom) — used by every flag that takes JSON
// (--targets, --exclusions, --items) so agents never have to fight shell
// quoting on large coordinate arrays.
function parseJsonArg(value, flagName) {
  if (value === undefined) return undefined;

  let raw = value;
  if (typeof value === 'string' && value.startsWith('@')) {
    const filePath = value.slice(1);
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new Error(`Could not read file for --${flagName} (${filePath}): ${err.message}`);
    }
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Could not parse JSON for --${flagName}: ${err.message}`);
  }
}

function printSuccess(result) {
  console.log(JSON.stringify(result, null, 2));
}

function printRaw(text) {
  process.stdout.write(text.endsWith('\n') ? text : text + '\n');
}

function printError(err) {
  console.error(JSON.stringify({ success: false, error: err.message }));
  process.exitCode = 1;
}

// Wraps an async action body so any throw (from blurService, JSON parsing,
// or manual validation) lands on the standard failure output instead of an
// uncaught rejection or Commander's own error formatting.
function run(work) {
  return async (...args) => {
    try {
      await work(...args);
    } catch (err) {
      printError(err);
    }
  };
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name('blur-studio')
  .description('CLI for Image Blur Studio — wraps blurService.js for humans and scripts')
  .version('1.0.0');

program
  .command('presets')
  .description('List quick-access image folder presets')
  .action(run(async () => {
    const result = await blurService.listPresets();
    printSuccess(result);
  }));

program
  .command('scan')
  .description('Scan a folder for images along with their configured targets/exclusions')
  .option('--folder <path>', 'folder to scan (defaults to the last-used source folder)')
  .action(run(async (opts) => {
    const result = await blurService.scanFolder({ folderPath: opts.folder });
    printSuccess(result);
  }));

program
  .command('config')
  .description('Print the full persisted app configuration')
  .action(run(async () => {
    const result = await blurService.getFullConfig();
    printSuccess(result);
  }));

program
  .command('save-config')
  .description('Save per-image targets/exclusions and/or global blur settings')
  .option('--filename <name>', 'image filename these targets/exclusions apply to')
  .option('--targets <jsonOrFile>', 'JSON array of target ellipses, or @file.json')
  .option('--exclusions <jsonOrFile>', 'JSON array of exclusion boxes, or @file.json')
  .option('--blur-radius <n>', 'global blur radius', parseFloat)
  .option('--feather-radius <n>', 'global feather radius', parseFloat)
  .option('--destination-mode <mode>', 'replace | separate_folder')
  .option('--last-destination-folder <path>', 'last-used destination folder')
  .action(run(async (opts) => {
    if (!opts.filename) {
      throw new Error("required option '--filename <name>' not specified");
    }
    const result = await blurService.saveImageConfig({
      filename: opts.filename,
      targets: parseJsonArg(opts.targets, 'targets'),
      exclusions: parseJsonArg(opts.exclusions, 'exclusions'),
      blurRadius: opts.blurRadius,
      featherRadius: opts.featherRadius,
      destinationMode: opts.destinationMode,
      lastDestinationFolder: opts.lastDestinationFolder
    });
    printSuccess(result);
  }));

program
  .command('apply')
  .description('Apply blur processing to a single image, or a batch of items')
  .option('--input <path>', 'input image path (single-item mode)')
  .option('--output <path>', 'output image path (single-item mode)')
  .option('--targets <jsonOrFile>', 'JSON array of target ellipses (single-item mode), or @file.json')
  .option('--exclusions <jsonOrFile>', 'JSON array of exclusion boxes (single-item mode), or @file.json')
  .option('--items <jsonOrFile>', 'JSON array of {inputPath,outputPath,targets,exclusions} (batch mode), or @file.json')
  .option('--blur-radius <n>', 'blur radius', parseFloat, 13)
  .option('--feather-radius <n>', 'feather radius', parseFloat, 14)
  .option('--destination-mode <mode>', 'replace | separate_folder')
  .option('--destination-folder <path>', 'destination folder (separate_folder mode)')
  .option('--no-backup', 'skip the .bak backup when destination-mode=replace (default: back up)')
  .action(run(async (opts) => {
    let items;

    if (opts.items) {
      items = parseJsonArg(opts.items, 'items');
      if (!Array.isArray(items)) {
        throw new Error('--items must resolve to a JSON array');
      }
    } else if (opts.input || opts.output || opts.targets) {
      if (!opts.input || !opts.output || !opts.targets) {
        throw new Error('Single-item mode requires --input, --output, and --targets together (or use --items for batch mode)');
      }
      items = [{
        inputPath: opts.input,
        outputPath: opts.output,
        targets: parseJsonArg(opts.targets, 'targets'),
        exclusions: opts.exclusions ? parseJsonArg(opts.exclusions, 'exclusions') : []
      }];
    } else {
      throw new Error('apply requires either --items <jsonOrFile>, or --input/--output/--targets together');
    }

    const result = await blurService.applyBlur({
      items,
      blurRadius: opts.blurRadius,
      featherRadius: opts.featherRadius,
      destinationMode: opts.destinationMode,
      destinationFolder: opts.destinationFolder,
      makeBackup: opts.backup
    });
    printSuccess(result);
  }));

program
  .command('export-python')
  .description('Export the current config as a Python snippet')
  .option('--raw', 'print only the raw pythonCode string, unwrapped (for piping to a .py file)')
  .action(run(async (opts) => {
    const result = await blurService.exportPythonSnippet();
    if (opts.raw) {
      printRaw(result.pythonCode);
    } else {
      printSuccess(result);
    }
  }));

program.parseAsync(process.argv);
