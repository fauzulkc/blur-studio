---
name: blur-studio
description: This skill should be used when the user or an agent asks to "blur this photo", "blur faces in this image", "redact this photo", "blur the license plates in these pictures", "blur out the screen in this screenshot", "pixelate the faces in the background", "anonymize this photo before I post it", "blur everyone except me in this group photo", "process this folder of photos for privacy", or any similar request to selectively obscure sensitive regions of an image. It wraps a coordinate-based selective blur tool — ellipses, rectangles, and sharp-preserve exclusion boxes, all in normalized 0-1 coordinates — that does NOT perform automatic face, plate, or screen detection; the calling agent must look at the image with its own vision and supply the exact region coordinates itself.
metadata:
  requires:
    bins: ["node", "python3"]
    install: "npm install (from the image-blur-studio repo root); pip install -r requirements.txt for the Python side (Pillow, numpy)"
---

# Blur Studio

## Overview

Blur Studio is a coordinate-based selective image blurring tool, not an automatic redaction tool. It has no face detector, no plate detector, no object detector of any kind — it is a Gaussian blur-and-feather compositor that blurs whatever normalized-coordinate regions it is told to blur. This is a deliberate design choice, not a missing feature: the calling agent is expected to look at the image with its own vision, decide what needs to be obscured (faces, license plates, laptop screens, ID cards, whiteboards, anything sensitive), and then supply the precise coordinates of those regions. Treat "look at the image and estimate coordinates" as a required step before touching either the MCP tools or the CLI — the tool will happily blur nothing, blur the wrong spot, or blur the entire image if it is fed coordinates that were guessed rather than observed. Two equivalent entry points exist: an MCP server (`blur-studio`, defined in `.mcp.json`) exposing six tools, and a CLI (`cli.js`, installed as the `blur-studio` bin) exposing five subcommands. Both wrap the same underlying module, `blurService.js`, which in turn shells out to `blur_processor.py` (Pillow/numpy) to do the actual pixel work.

## Coordinate System Reference

Every coordinate this tool accepts is normalized to the 0-1 range relative to the image's own width and height — never raw pixels. `(0, 0)` is the top-left corner of the image and `(1, 1)` is the bottom-right corner, regardless of the image's actual resolution. This means the same target definition works unmodified across a 640×480 thumbnail and an 8000×6000 raw photo of the same scene.

Three coordinate shapes exist:

- **Ellipse target** — `{cx, cy, rx, ry}`. `cx`/`cy` are the normalized center point of the ellipse; `rx`/`ry` are the normalized horizontal and vertical radius (half-width and half-height), not the full diameter. Use this shape for faces and other roughly oval regions — it feathers more naturally around a head than a hard rectangle does.
- **Rectangle target** — `{x1, y1, x2, y2}`. `x1,y1` is the normalized top-left corner and `x2,y2` is the normalized bottom-right corner. Use this shape for license plates, screens, documents, or any region that is naturally rectangular.
- **Exclusion box** — also `{x1, y1, x2, y2}`, same corner convention as a rectangle target, but with the opposite effect: any pixel inside an exclusion box is forced 100% sharp even if it also falls inside a blur target. Use exclusions to carve a VIP or subject out of a blur region they happen to be standing in or near — see `references/examples.md` for a full group-photo example.

All three shapes accept an optional `label` string (e.g. `"Face - man in red shirt"`) purely for human/agent readability in saved configs; it has no effect on the blur itself.

An **ellipse target** can also override the call's global `blurRadius`/`featherRadius` for itself: set `useGlobalBlur: false` and supply its own `blurRadius`/`featherRadius` (e.g. `{"cx":0.4,"cy":0.3,"rx":0.04,"ry":0.06,"useGlobalBlur":false,"blurRadius":30,"featherRadius":4}`) to blur one region much more heavily than the rest of the photo. Omit `useGlobalBlur` (or leave it `true`) to use the global default, which is the right choice for almost every target. Rectangle targets have no per-target override.

**Worked example.** Given a face that, by eye, sits roughly centered at 40% of the way across the image and 30% of the way down, and spans about 8% of the image's width:

```json
{ "cx": 0.4, "cy": 0.3, "rx": 0.04, "ry": 0.06 }
```

`rx` is half of the estimated 8%-of-width span (0.04), and `ry` is estimated separately since faces are usually taller than they are wide in their blurred oval — there is no requirement that `rx` and `ry` match. Estimate radii by eye from the image, not from a fixed formula; the numbers above are illustrative, not a rule to apply verbatim to every face.

## Primary Path: MCP Tools

When the `blur-studio` MCP server is connected in the current session (check for tools prefixed `mcp__blur-studio__` or equivalent in the available tools list), prefer it over the CLI — it returns structured JSON directly with no subprocess/JSON-argument-file plumbing to manage. The server is defined in `.mcp.json` at the repo root and registers six tools:

| Tool | Input shape | Purpose |
|---|---|---|
| `list_presets` | `{}` | Lists quick-access folder presets (id, name, path) baked into this deployment. Only the bundled `sample-photos/` folder ships by default — for any other image or folder, use `scan_folder` or `apply_blur` with an explicit path instead. |
| `scan_folder` | `{ folderPath? }` | Scans a folder for images (`.jpg`/`.jpeg`/`.png`/`.webp`/`.avif`/`.gif`), returning each image's filename, full path, size, whether a `.bak` backup already exists, and any blur targets/exclusions already saved for it. Omit `folderPath` to scan the last-used source folder. Also returns the current global `blurRadius`/`featherRadius`/`destinationMode`/`lastDestinationFolder` defaults. |
| `get_config` | `{}` | Returns the full persisted config object as-is: per-filename `targets`, per-filename `exclusions`, `lastSourceFolder`, `lastDestinationFolder`, `destinationMode`, `blurRadius`, `featherRadius`. |
| `save_image_config` | `{ filename, targets?, exclusions?, blurRadius?, featherRadius?, destinationMode?, lastDestinationFolder? }` | Persists blur targets and/or exclusion boxes for a specific image filename (used as the config key), and/or updates global defaults. This only writes configuration — it does **not** blur any pixels. `targets`/`exclusions` fully replace whatever was previously saved for that filename. |
| `apply_blur` | `{ items: [{ inputPath, outputPath?, targets, exclusions? }], blurRadius?, featherRadius?, destinationMode?, destinationFolder?, makeBackup? }` | The tool that actually blurs pixels and writes output files. `items` is an array so one call can process a whole batch. Each `item.targets` entry is an ellipse or a rectangle (see above); `item.exclusions` entries are rectangles. Returns `{ processed: [...] }` describing what was written per item. |
| `export_python_snippet` | `{}` | Renders the currently persisted exclusions and targets as a standalone Python snippet (`EXCLUSION_BOXES` and `EXPLICIT_BLUR_TARGETS` dicts) for pasting into another Python pipeline. Returns `{ pythonCode }`. |

**Recommended flow.**

1. If working across a whole directory of images, call `scan_folder` first to enumerate what's there and see what (if anything) already has saved targets/exclusions. If working on a single already-known image path, skip straight to step 2 — there is no need to scan a folder for one file.
2. Look at each image (own vision) and build the `targets` array (and `exclusions` array, if any subject must stay sharp) for it.
3. Call `apply_blur` with one `items` entry per image to actually produce blurred output. This is the only tool in the set that touches pixels — nothing before this step writes an image file.
4. Optionally, call `save_image_config` first (or instead, for a dry run) to persist the target/exclusion definitions under the image's filename before or without calling `apply_blur` — useful when the coordinates should be reusable later (e.g. re-applying after a re-crop, or handing off to `export_python_snippet`) without re-deriving them by eye again.
5. Optionally, call `export_python_snippet` afterward if the destination pipeline is a Python script rather than another call to this tool.

## Fallback Path: CLI

Fall back to the CLI when the MCP server is not connected in the current environment or session (e.g. running from a plain shell, a CI job, or an agent harness without this repo's `.mcp.json` loaded). The CLI is `cli.js` at the repo root (installed as the `blur-studio` bin via `package.json`); invoke it directly with `node cli.js <subcommand>` or via the installed bin name. It exposes five subcommands, mirroring the same `blurService.js` functions the MCP tools call:

- `presets` — list quick-access folder presets. No options.
- `scan --folder <path>` — scan a folder for images and their saved targets/exclusions. `--folder` is optional; omit it to scan the last-used source folder.
- `config` — print the full persisted app configuration. No options.
- `save-config --filename <name> [--targets <jsonOrFile>] [--exclusions <jsonOrFile>] [--blur-radius <n>] [--feather-radius <n>] [--destination-mode <replace|separate_folder>] [--last-destination-folder <path>]` — persist config only; does not blur pixels. `--filename` is required.
- `apply [--input <path> --output <path> --targets <jsonOrFile> [--exclusions <jsonOrFile>]] | [--items <jsonOrFile>] [--blur-radius <n>] [--feather-radius <n>] [--destination-mode <replace|separate_folder>] [--destination-folder <path>] [--no-backup]` — actually blurs pixels. Use `--input`/`--output`/`--targets` together for a single image, or `--items` for a batch (an array of `{inputPath, outputPath, targets, exclusions}` objects). These two modes are mutually exclusive. `--destination-mode replace` backs up the original to `.bak` by default; pass `--no-backup` to skip that.
- `export-python [--raw]` — export the current config as a Python snippet. `--raw` prints only the bare `pythonCode` string (unwrapped from the JSON envelope), so it can be piped straight into a `.py` file.

Every flag that takes JSON (`--targets`, `--exclusions`, `--items`) accepts either an inline JSON string or an `@`-prefixed path to a file containing that JSON — the same idiom curl uses for `@file`. Use the `@file.json` form for anything beyond a couple of coordinates; shells mangle unescaped JSON with nested quotes fast, and this convention exists specifically so agents don't have to fight that.

Example invocation, single image, ellipse face-blur, writing to a separate output path:

```bash
node cli.js apply \
  --input ./photos/group1.jpg \
  --output ./photos/group1_blurred.jpg \
  --targets '[{"cx":0.4,"cy":0.3,"rx":0.04,"ry":0.06,"label":"Face - center"}]'
```

Every subcommand prints `JSON.stringify(result, null, 2)` to stdout and exits 0 on success; on failure it prints `{"success": false, "error": "..."}` to stderr and exits 1. The one exception is `export-python --raw`, which prints the plain Python source on stdout for piping.

## Setup / Prerequisites

Run `npm install` from the `image-blur-studio` repo root before using either path — this pulls in `commander`, `@modelcontextprotocol/sdk`, `zod`, and the other Node dependencies both `cli.js` and `mcp-server.js` need.

The pixel-processing step is Python, not Node: `blurService.js` shells out to `blur_processor.py`, which imports `PIL` (Pillow) and `numpy`. Run `pip install -r requirements.txt` from the repo root to install both. Confirm `python3 -c "import PIL, numpy"` succeeds in whatever Python environment `python3` resolves to before calling `apply_blur`/`apply` — if it fails despite the install, `python3` is probably resolving to a different interpreter than the one `pip` installed into.

## Common Pitfalls

- **Coordinates are normalized 0-1, never raw pixels.** `cx: 400` (meant as "400 pixels across") instead of `cx: 0.4` will be silently clamped/misread by the zod schema (`min(0).max(1)`) on the MCP path, or will produce a nonsensical blur region via the CLI path where no such validation runs. Always divide by the image's actual width/height first, or simply estimate the 0-1 fraction directly by eye.
- **`destinationMode: 'replace'` overwrites the original file in place.** A `.bak` backup is created automatically by default (`makeBackup` defaults to `true` in `blurService.js`) — pass `makeBackup: false` (MCP) or `--no-backup` (CLI) to explicitly skip it. For anything irreplaceable, prefer `destinationMode: 'separate_folder'` so the original is never touched in the first place.
- **Unspecified `blurRadius`/`featherRadius` default to `13` and `14` respectively**, both in the MCP tool schema and in `blurService.js`'s own function defaults. These are Gaussian blur radii in pixels of the *blur*, not of the feather edge width alone — a very small target region (e.g. `rx: 0.01`) combined with the default `featherRadius: 14` can feather past the edges of the target entirely, softening but not fully obscuring it. For small targets, consider lowering `featherRadius` or increasing `rx`/`ry` slightly so the fully-blurred core is large enough to matter.
- **`save_image_config`/`save-config` never touches pixels.** It only writes to `blur_studio_config.json`. Calling it and then forgetting to also call `apply_blur`/`apply` is a common no-op mistake — the config will look correct but no output image will exist or change.
- **`list_presets`/`presets` only ships the bundled sample folder by default.** For any other folder or image, pass the path explicitly to `scan_folder`/`scan` or `apply_blur`/`apply` instead of expecting a matching preset to exist.

## Additional Resources

See `references/examples.md` for three fully worked examples: a single-image ellipse face-blur via the `apply_blur` MCP tool, a batch blur via the CLI using an `@items.json` file, and a group-photo example that uses an exclusion box to keep one person sharp while blurring everyone else.
