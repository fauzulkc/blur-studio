#!/usr/bin/env node
// MCP server wrapper around blurService.js — exposes the same in-process
// business logic that server.js exposes over HTTP (and that cli.js exposes
// to a terminal) as MCP tools over stdio, so AI agents can trigger selective
// photo blurring directly.
//
// This app blurs COORDINATE-BASED regions of images (ellipse or rectangular,
// normalized 0-1) with optional VIP sharp-preserve exclusion boxes. It does
// NOT perform face detection — the calling agent must supply coordinates
// itself (e.g. using its own vision to look at a photo and decide what to
// blur). That is an intentional design constraint, not a gap.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as blurService from './blurService.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Wraps blurService results as MCP tool content (JSON text block). Wraps
// thrown errors as an isError result instead of letting them crash the
// server or surface as a raw JSON-RPC error, so the calling agent gets a
// readable message it can act on.
function toolResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function toolError(err) {
  return {
    content: [{ type: 'text', text: `Error: ${err.message}` }],
    isError: true
  };
}

function handle(fn) {
  return async (args) => {
    try {
      const result = await fn(args);
      return toolResult(result);
    } catch (err) {
      return toolError(err);
    }
  };
}

// ---------------------------------------------------------------------------
// Shared zod shapes (mirror the coordinate contracts blurService.js expects)
// ---------------------------------------------------------------------------

// Ellipse blur target: normalized 0-1 CENTER point + radius (not corners).
const ellipseTargetShape = z.object({
  cx: z.number().min(0).max(1).describe('Normalized (0-1) X coordinate of the ellipse CENTER'),
  cy: z.number().min(0).max(1).describe('Normalized (0-1) Y coordinate of the ellipse CENTER'),
  rx: z.number().min(0).max(1).describe('Normalized (0-1) horizontal radius'),
  ry: z.number().min(0).max(1).describe('Normalized (0-1) vertical radius'),
  label: z.string().optional().describe('Optional human-readable label, e.g. "Face - man in red shirt"')
});

// Rectangular/grid blur target OR exclusion box: normalized 0-1 corners.
const rectShape = z.object({
  x1: z.number().min(0).max(1).describe('Normalized (0-1) X of the top-left corner'),
  y1: z.number().min(0).max(1).describe('Normalized (0-1) Y of the top-left corner'),
  x2: z.number().min(0).max(1).describe('Normalized (0-1) X of the bottom-right corner'),
  y2: z.number().min(0).max(1).describe('Normalized (0-1) Y of the bottom-right corner'),
  label: z.string().optional().describe('Optional human-readable label')
});

// A blur target may be an ellipse ({cx,cy,rx,ry}) or a rectangle ({x1,y1,x2,y2}).
const targetShape = z.union([ellipseTargetShape, rectShape]);

const applyBlurItemShape = z.object({
  inputPath: z.string().describe('Absolute or relative path to the source image'),
  outputPath: z.string().optional().describe(
    'Where to write the result. If omitted, derived from destinationMode: ' +
    "'replace' writes back to inputPath; 'separate_folder' writes to destinationFolder (or a sibling 'blurred_output' folder) using the same basename."
  ),
  targets: z.array(targetShape).describe('Regions to blur for this image — ellipses ({cx,cy,rx,ry}) and/or rectangles ({x1,y1,x2,y2}), all normalized 0-1'),
  exclusions: z.array(rectShape).optional().describe('Rectangular regions ({x1,y1,x2,y2}, normalized 0-1) that stay 100% sharp even if a target overlaps them')
});

const destinationModeEnum = z.enum(['replace', 'separate_folder']);

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'blur-studio',
  version: '1.0.0'
});

// 1. list_presets — {} -> presets
server.registerTool(
  'list_presets',
  {
    title: 'List quick-access folder presets',
    description:
      'Lists the quick-access image folder presets (id, name, path) configured for this app. Takes no arguments.',
    inputSchema: {}
  },
  handle(async () => blurService.listPresets())
);

// 2. scan_folder — { folderPath } -> folderPath/count/images/config
server.registerTool(
  'scan_folder',
  {
    title: 'Scan a folder for images',
    description:
      'Scans a folder for images (.jpg/.jpeg/.png/.webp/.avif/.gif) and returns each image\'s filename, ' +
      'full path, size, whether a .bak backup exists, and its currently-configured blur targets/exclusions ' +
      '(from the persisted config, keyed by filename). Also returns the current global blurRadius/featherRadius/' +
      'destinationMode/lastDestinationFolder defaults. If folderPath is omitted, the last-used source folder is scanned instead.',
    inputSchema: {
      folderPath: z.string().optional().describe('Absolute or relative path to the folder to scan. Defaults to the last-used source folder if omitted.')
    }
  },
  handle(async ({ folderPath } = {}) => blurService.scanFolder({ folderPath }))
);

// 3. get_config — {} -> full persisted config
server.registerTool(
  'get_config',
  {
    title: 'Get the full persisted app configuration',
    description:
      'Returns the full persisted configuration object as-is: per-filename blur targets, per-filename exclusion boxes, ' +
      'lastSourceFolder, lastDestinationFolder, destinationMode, blurRadius, and featherRadius. Takes no arguments.',
    inputSchema: {}
  },
  handle(async () => blurService.getFullConfig())
);

// 4. save_image_config — { filename, targets?, exclusions?, blurRadius?, featherRadius?, destinationMode?, lastDestinationFolder? }
server.registerTool(
  'save_image_config',
  {
    title: 'Save per-image blur config and/or global blur defaults',
    description:
      'Persists blur targets and/or exclusion boxes for a specific image filename, and/or updates the global ' +
      'defaults (blurRadius, featherRadius, destinationMode, lastDestinationFolder). This only writes configuration — ' +
      'it does not blur any pixels; call apply_blur to actually produce blurred output. targets are ellipses ' +
      '({cx,cy,rx,ry}, normalized 0-1 center+radius) and/or rectangles ({x1,y1,x2,y2}, normalized 0-1 corners); ' +
      'exclusions are rectangles ({x1,y1,x2,y2}, normalized 0-1) that mark regions to keep sharp.',
    inputSchema: {
      filename: z.string().describe('Image filename these targets/exclusions apply to (used as the config key, e.g. "IMG_1234.jpg")'),
      targets: z.array(targetShape).optional().describe('Blur target ellipses/rectangles to save for this filename (replaces any previously saved targets for it)'),
      exclusions: z.array(rectShape).optional().describe('Sharp-preserve exclusion boxes to save for this filename (replaces any previously saved exclusions for it)'),
      blurRadius: z.number().optional().describe('New global default blur radius'),
      featherRadius: z.number().optional().describe('New global default feather (edge softness) radius'),
      destinationMode: destinationModeEnum.optional().describe("New global default destination mode: 'replace' or 'separate_folder'"),
      lastDestinationFolder: z.string().optional().describe('New global default destination folder path')
    }
  },
  handle(async (args) => blurService.saveImageConfig(args))
);

// 5. apply_blur — { items, blurRadius?, featherRadius?, destinationMode?, destinationFolder?, makeBackup? } -> { processed }
server.registerTool(
  'apply_blur',
  {
    title: 'Apply selective blur to one or more images',
    description:
      'Actually blurs pixels in the given images at the supplied coordinate regions and writes output files. ' +
      'This tool does NOT perform face detection or any other automatic subject detection — it has no idea what ' +
      "a face, license plate, or screen looks like. The CALLER (you, the agent) must first look at each image " +
      '(with your own vision) and decide what needs to be blurred — faces, license plates, screens, documents, ' +
      'anything — then supply the exact coordinates for those regions. ' +
      '\n\n' +
      'Each item.targets entry is one of two shapes: ' +
      '(1) an ELLIPSE: {cx, cy, rx, ry} where cx/cy are the normalized 0-1 CENTER point of the ellipse (NOT pixel ' +
      'coordinates — 0,0 is the top-left corner of the image and 1,1 is the bottom-right corner) and rx/ry are the ' +
      'normalized 0-1 horizontal/vertical radius; or ' +
      '(2) a RECTANGLE/grid box: {x1, y1, x2, y2}, the normalized 0-1 coordinates of the top-left (x1,y1) and ' +
      'bottom-right (x2,y2) corners. ' +
      '\n\n' +
      'Each item.exclusions entry is a rectangle {x1, y1, x2, y2} (same normalized 0-1 corner convention). Any pixel ' +
      'inside an exclusion box is kept 100% sharp even if it also falls inside a blur target — use this to carve out ' +
      'a VIP/subject who must stay unblurred even though they are standing inside (or next to) a region you are blurring. ' +
      '\n\n' +
      "destinationMode controls where output goes: 'replace' overwrites the original file at inputPath in place " +
      '(the original is backed up first, to "<inputPath>.bak", unless makeBackup is explicitly set to false); ' +
      "'separate_folder' leaves the original untouched and writes a new file into " +
      'destinationFolder, reusing the same basename as inputPath. If an item omits outputPath, it is derived from ' +
      'destinationMode this way automatically. Per-item outputPath (if supplied) always takes precedence over the ' +
      'destinationMode-derived path. Returns { processed } describing what was written.',
    inputSchema: {
      items: z.array(applyBlurItemShape).min(1).describe('One entry per image to process — each with its own inputPath, targets, and optional outputPath/exclusions'),
      blurRadius: z.number().optional().default(13).describe('Gaussian blur radius applied inside each target region (default 13)'),
      featherRadius: z.number().optional().default(14).describe('Feather/edge-softness radius blending the blur into the surrounding sharp image (default 14)'),
      destinationMode: destinationModeEnum.optional().describe("'replace' (overwrite inputPath, optionally backed up) or 'separate_folder' (write a copy into destinationFolder). Ignored for items that supply their own outputPath."),
      destinationFolder: z.string().optional().describe("Folder to write output into when destinationMode is 'separate_folder' and an item has no explicit outputPath. Defaults to a 'blurred_output' sibling folder next to each input."),
      makeBackup: z.boolean().optional().describe("When destinationMode is 'replace', back up the original file to '<inputPath>.bak' before overwriting it. Default true — pass false explicitly to overwrite with no backup.")
    }
  },
  handle(async (args) => blurService.applyBlur(args))
);

// 6. export_python_snippet — {} -> pythonCode
server.registerTool(
  'export_python_snippet',
  {
    title: 'Export the current config as a Python snippet',
    description:
      'Renders the currently persisted exclusion boxes and blur targets (from the full app config) as a standalone ' +
      'Python source snippet (EXCLUSION_BOXES and EXPLICIT_BLUR_TARGETS dicts) suitable for copy-pasting into ' +
      'another Python pipeline. Returns { pythonCode }. Takes no arguments.',
    inputSchema: {}
  },
  handle(async () => blurService.exportPythonSnippet())
);

// ---------------------------------------------------------------------------
// Connect over stdio
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
