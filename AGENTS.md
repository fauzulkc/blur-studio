# AGENTS.md — Blur Studio

This file gives any AI coding agent (Claude Code, Cursor, OpenAI Codex CLI,
Gemini CLI/Antigravity, Amp, or a plain shell-driven agent) everything needed
to *operate* this tool correctly — not just read its code. It stands on its
own: you do not need `.claude/skills/blur-studio/SKILL.md` (a Claude-specific
packaged skill covering the same ground) to use anything described here.

Repo: https://github.com/fauzulkc/blur-studio · License: MIT · Author:
Fauzul Chowdhury.

## What this repo is

Blur Studio is a coordinate-based selective image blurring tool: give
it normalized 0-1 regions of an image (ellipses or rectangles) and it applies
Gaussian blur with a feathered edge inside those regions, optionally
protecting other regions ("exclusions") so they stay 100% sharp even if a
blur region overlaps them. It ships three parallel entry points into the same
business logic (`blurService.js`):

- **`cli.js`** — a `commander`-based CLI, installed as the `blur-studio` bin.
- **`mcp-server.js`** — an MCP server (`@modelcontextprotocol/sdk`, STDIO
  transport) registered in `.mcp.json` under the name `blur-studio`.
- **`server.js`** — an Express HTTP API (default port `3333`, override via the
  `PORT` env var) that the React/Vite web UI (`src/`) talks to.

All three are thin wrappers: they parse their respective input format,
call the same functions exported from `blurService.js`, and format the
result. `blurService.js` itself shells out to `blur_processor.py` (Pillow +
numpy) to do the actual pixel work via `spawn('python3', [...])`.

## THE load-bearing fact: no auto-detection

**This tool does not detect faces, license plates, screens, or any other
subject.** It has no computer-vision model of any kind — it is a
coordinate-in, blurred-pixels-out compositor. There is no "auto-blur faces"
mode, no `--detect` flag, nothing.

If you are an agent being asked to blur faces/plates/screens/etc. in a photo,
**you** must look at the image with your own vision, decide what needs
obscuring, and supply the exact normalized coordinates of those regions
yourself. Skipping this and guessing coordinates, or hoping the tool infers
them, will blur the wrong region, blur nothing, or blur the whole image.
Always view the image (read it as an image input, not just a file listing)
before constructing any `targets`/`exclusions` array.

## Choosing an entry point

| Entry point | Use when | Notes |
|---|---|---|
| **MCP** (`mcp-server.js`, `.mcp.json`) | Your host supports MCP tool-calling directly (the tools appear in your available-tools list, however your host names/prefixes them — e.g. Claude Code shows `mcp__blur-studio__apply_blur`; other hosts may show the bare tool name `apply_blur`). | Structured JSON in and out, zod-validated inputs, no subprocess/quoting to manage. **Prefer this over the CLI whenever it's available.** |
| **CLI** (`cli.js` / `blur-studio` bin) | MCP isn't wired into your host/session (plain shell, CI, an agent harness without `.mcp.json` loaded). | Same underlying functions as MCP, but JSON payloads are passed as strings or `@file.json` paths (see below) and there is **no schema validation** before the JSON hits `blurService.js` — malformed coordinates fail later, inside Python, with a less specific error. |
| **HTTP API** (`server.js`) | Essentially never, for an agent. It exists to serve the browser UI. | No auth, no input validation (raw `req.body` passed straight to `blurService.js`), and you'd have to start/manage the Express process yourself. Only reach for this directly if neither MCP nor a Node subprocess (CLI) is available to you at all — e.g. you're a browser-side script with only `fetch`. |

Practical rule: **MCP if your host does MCP tool-calling; CLI otherwise.**
Don't hand-roll HTTP calls to `server.js` unless you have a specific reason
the first two don't work for your environment.

## Coordinate system (verified against the zod schemas in `mcp-server.js`)

Every coordinate is normalized **0 to 1** relative to the image's own width
and height, never raw pixels. `(0,0)` is the top-left corner, `(1,1)` is the
bottom-right corner — this holds regardless of the image's actual resolution.
Three shapes exist, defined by these zod schemas in `mcp-server.js`
(`ellipseTargetShape`, `rectShape`; both enforce `min(0).max(1)` on every
coordinate field):

**Ellipse target** — for faces and other roughly oval regions:
```json
{ "cx": 0.4, "cy": 0.3, "rx": 0.04, "ry": 0.06, "label": "Face - optional" }
```
`cx`/`cy` = normalized center point. `rx`/`ry` = normalized horizontal/vertical
*radius* (half-width/half-height), not full diameter. `label` is optional,
free text, cosmetic only (shown in saved configs, has no effect on blurring).

**Rectangle target** — for plates, screens, documents, or any naturally
rectangular region:
```json
{ "x1": 0.70, "y1": 0.55, "x2": 0.92, "y2": 0.63, "label": "License plate" }
```
`x1,y1` = top-left corner, `x2,y2` = bottom-right corner, both normalized.

**Exclusion box** — same `{x1,y1,x2,y2}` shape as a rectangle target, but
opposite effect: any pixel inside an exclusion box stays 100% sharp even if a
blur target also covers it. Exclusions live in their own `exclusions` array
(per apply-blur item, or per filename in saved config), never mixed into
`targets`. Use this to carve a VIP/subject out of a blur region they're
standing in or near — size the box generously beyond the visible outline,
since it has no feathering of its own and a too-tight box can leave a thin
blurred sliver at the edge where a neighboring feathered target still reaches.

A `targets` array can freely mix ellipses and rectangles in the same call —
the zod schema is `z.union([ellipseTargetShape, rectShape])`, disambiguated
by which required fields are present (`cx/cy/rx/ry` vs `x1/y1/x2/y2`).

### Per-target blur/feather override — ellipse targets only

Verified in `mcp-server.js`'s `ellipseTargetShape`: an ellipse target (not a
rectangle — rectangles have no override fields) can carry its own
`useGlobalBlur` / `blurRadius` / `featherRadius`:

```json
{
  "cx": 0.4, "cy": 0.3, "rx": 0.04, "ry": 0.06,
  "useGlobalBlur": false,
  "blurRadius": 30,
  "featherRadius": 4
}
```

- `useGlobalBlur` (boolean, optional) — defaults to `true`. Leave it out (or
  `true`) to use the call's top-level `blurRadius`/`featherRadius`, which is
  correct for almost every target.
- `blurRadius` / `featherRadius` (numbers, optional) — this region's own
  Gaussian blur / feather radius in pixels. **Only take effect when
  `useGlobalBlur` is explicitly `false`.** Setting them without also setting
  `useGlobalBlur: false` silently does nothing — the region still uses the
  global defaults.

Under the hood (`blur_processor.py`), targets are grouped by their effective
`(blurRadius, featherRadius)` pair and each group is composited as its own
blur pass — so mixing overridden and default-strength targets in one call is
safe and correctly isolated per region.

Global defaults, when omitted entirely: **`blurRadius: 13`, `featherRadius:
14`** (pixels), set both in the zod schema defaults and in `blurService.js`'s
own function defaults. A very small target (e.g. `rx: 0.01`) combined with
the default `featherRadius: 14` can feather past the target's own edges,
softening but not fully obscuring it — lower `featherRadius` or grow `rx`/`ry`
slightly for small regions.

## `destinationMode` and safety

`destinationMode` (used by `apply_blur`/`apply`, and stored as a global
default via `save_image_config`/`save-config`) has two values:

- **`separate_folder`** (the default whenever `destinationMode` is omitted,
  both in `blurService.js`'s function signature and in the persisted config)
  — the original file at `inputPath` is never touched. Output is written to
  `destinationFolder` (or, if that's also omitted, a sibling `blurred_output`
  folder next to each input), reusing the input's basename.
- **`replace`** — **overwrites the source file at `inputPath` in place.**
  A `.bak` backup is created first by default (`makeBackup` defaults to
  `true`) — pass `makeBackup: false` (MCP) / `--no-backup` (CLI) to skip it
  explicitly.

**Footgun to know about:** the backup decision is tied to `destinationMode`
being explicitly `'replace'`, *not* to whether an item's `outputPath` happens
to equal its `inputPath`. Concretely, in `blurService.js`:
`payload.backup = destinationMode === 'replace' && makeBackup`, computed once
for the whole batch and passed to `blur_processor.py`. If you manually set an
item's `outputPath` to the same path as its `inputPath` while
`destinationMode` is left at `separate_folder` (the default), **no `.bak`
backup is created**, even though the original will still be overwritten when
Python writes to that path. If you intend an in-place overwrite, set
`destinationMode: 'replace'` explicitly (and leave `makeBackup` at its `true`
default, or set it deliberately) — don't rely on matching paths under the
default mode.

For anything irreplaceable (a folder of someone's real photos, mounted into a
container, etc.), default to `separate_folder` and only use `replace` when
overwriting in place is genuinely intended and a backup strategy is in place.
This applies identically whether you're invoking the CLI/MCP locally or from
inside a Docker container with a real photo folder bind-mounted in — the
`.bak` file lands next to the original inside that same mounted folder.

`save_image_config`/`save-config` and `get_config`/`config` never touch
pixels — they only read/write `blur_studio_config.json`. Calling
`save_image_config` and then forgetting to also call `apply_blur` is a
no-op mistake: the config looks correct but no image is produced.

## Quick reference: operation → interface

| Operation | MCP tool | CLI subcommand | HTTP route |
|---|---|---|---|
| List folder presets | `list_presets` `{}` | `presets` | `GET /api/presets` |
| Scan a folder | `scan_folder` `{folderPath?}` | `scan --folder <path>` | `POST /api/scan-folder` |
| Read full persisted config | `get_config` `{}` | `config` | *(no route — MCP/CLI only)* |
| Save targets/exclusions/defaults (no pixels touched) | `save_image_config` `{filename, targets?, exclusions?, blurRadius?, featherRadius?, destinationMode?, lastDestinationFolder?}` | `save-config --filename <name> [--targets ...] [--exclusions ...] [--blur-radius <n>] [--feather-radius <n>] [--destination-mode <mode>] [--last-destination-folder <path>]` | `POST /api/save-config` |
| Actually blur pixels | `apply_blur` `{items, blurRadius?, featherRadius?, destinationMode?, destinationFolder?, makeBackup?}` | `apply --items <jsonOrFile>` **or** `--input/--output/--targets [--exclusions]` `[--blur-radius <n>] [--feather-radius <n>] [--destination-mode <mode>] [--destination-folder <path>] [--no-backup]` | `POST /api/apply-blur` |
| Export config as Python snippet | `export_python_snippet` `{}` | `export-python [--raw]` | `GET /api/export-python` |
| Stream a raw image / download result(s) | *(not exposed — UI only)* | *(not exposed — UI only)* | `GET /raw-image?path=`, `GET /api/download?path=`, `POST /api/download-batch` |

Every flag that takes JSON on the CLI (`--targets`, `--exclusions`,
`--items`) accepts either an inline JSON string or an `@`-prefixed path to a
file containing that JSON (curl's `@file` idiom) — use `@file.json` for
anything beyond a couple of coordinates, since shells mangle nested-quote
JSON fast.

CLI output convention: success prints `JSON.stringify(result, null, 2)` to
stdout and exits 0; failure prints `{"success": false, "error": "..."}` to
stderr and exits 1. The one exception is `export-python --raw`, which prints
the bare Python source to stdout for piping into a `.py` file.

## Setup

```bash
npm install                              # pulls in commander, @modelcontextprotocol/sdk, zod, express, etc.
python3 -c "import PIL, numpy" || true   # verify the Python side before calling apply
```

Node.js **>=20.0.0** is required (`package.json` `engines`). Python **3.10+**
is required by `blur_processor.py`. `requirements.txt` at the repo root pins
both dependencies `blur_processor.py` actually imports —
`Pillow>=10.0.0` and `numpy>=1.24.0` — so a plain
`pip install -r requirements.txt` is sufficient; there's no separate numpy
install step needed.

Dev ports — **verify against `vite.config.js`/`package.json`, not memory,
since this repo's own docs disagree with each other in places**:
- Backend (`node server.js` / `npm run server` / `npm run start`): port
  `3333` by default, override with the `PORT` env var.
- Frontend dev server (`npm run dev` → `vite`): `vite.config.js` pins
  `server.port: 5173`, and proxies `/api` and `/raw-image` to
  `http://localhost:3333`. **However**, `tests/e2e/harness.mjs` defaults its
  `BASE_URL` to `http://localhost:5178` (`BLUR_STUDIO_URL` env var
  overrides it) — that default does not match the Vite config. Either start
  Vite with `npx vite --port 5178` to match the test default, or set
  `BLUR_STUDIO_URL=http://localhost:5173` when running the e2e suite against
  a normally-started dev server. Don't assume one port for both purposes.
- Production-style single process: `npm run build` (`vite build` → `dist/`),
  then `node server.js` serves the built frontend and the API from the same
  port (`3333` by default) — `server.js` checks for `dist/` and falls back to
  `express.static` + SPA catch-all if it exists.

## Running it via Docker (optional, no local Node/Python needed)

The repo-root `Dockerfile` is multi-target — two independent images share one
Node + Python/Pillow/numpy base:

| Target | `ENTRYPOINT` | Transport | Use when |
|---|---|---|---|
| `mcp` | `node mcp-server.js` | stdio, no port | An MCP client should spawn the tool without a local Node/Python install. |
| `web` | `node server.js` | HTTP, port `3333` | You want the full app (API + built React UI) running as a normal network service — e.g. an agent driving it purely over HTTP, or hosting it for a human. |

`docker-compose.yml` defines both as named services (`mcp` and `web`):

```bash
docker compose run --rm -i mcp   # -i keeps stdin open for the MCP client to attach to
docker compose up -d web         # full app at http://localhost:3333
```

Configure an MCP client's server "command" as `docker compose run --rm -i mcp`
(with this repo as the working directory) exactly as you would `node
mcp-server.js` for a local install. For the `web` target, an agent restricted
to HTTP tools can call the same routes `server.js` exposes locally (see the
"HTTP API" row in the entry-point table above) against
`http://localhost:3333` once the container is up — `GET /health` confirms
it's actually serving before you do.

**Nothing outside either image is visible to its container unless you
bind-mount it in** — by default both only ever see the baked-in
`sample-photos/`. To operate on real photos, mount the folder yourself (see
the commented-out example lines in `docker-compose.yml`), e.g.
`-v ~/Photos:/photos`, then pass container-side paths like
`/photos/whatever.jpg` as `inputPath`/`folderPath` (or the UI's source-folder
field for `web`). **The `destinationMode: 'replace'` vs `'separate_folder'`
distinction above applies identically inside either container**: `replace`
overwrites the bind-mounted original file in place (backed up to
`<file>.bak` first unless `makeBackup: false`) — mount the folder read-only
(`~/Photos:/photos:ro`) or stick to `separate_folder` if the source photos
must never be touched. Separately, `blur_studio_config.json` (saved
targets/exclusions/defaults) is **not** persisted across container runs
unless the relevant named volume in `docker-compose.yml`
(`blur_studio_config_mcp:/app/config-volume` or
`blur_studio_config_web:/app/config-volume`) is also mounted — without it,
every fresh container restarts from the bundled sample config. The `web`
image also has **no authentication of its own** — see `SECURITY.md` before
exposing it beyond your own machine/network.

## Examples (derived from actually running this code)

**CLI — single image, ellipse target, separate output path** (verified: this
exact command, run against `sample-photos/sample-1.jpg`, produced
`{"processed":[{"success":true,"image":"sample-1.jpg","targets_count":1,"exclusions_count":0,"output":"./sample-photos-blurred/out.jpg"}]}` on stdout, exit 0):

```bash
node cli.js apply \
  --input ./sample-photos/sample-1.jpg \
  --output ./sample-photos-blurred/out.jpg \
  --targets '[{"cx":0.15,"cy":0.2,"rx":0.055,"ry":0.075,"label":"Person 1"}]'
```

**CLI — batch via `@file.json`, explicit safe destination mode:**

```bash
cat > /tmp/items.json <<'EOF'
[
  {
    "inputPath": "./sample-photos/sample-1.jpg",
    "outputPath": "./sample-photos-blurred/sample-1.jpg",
    "targets": [
      { "cx": 0.15, "cy": 0.2, "rx": 0.055, "ry": 0.075, "label": "Person 1" },
      { "cx": 0.32, "cy": 0.22, "rx": 0.055, "ry": 0.075, "label": "Person 2" }
    ],
    "exclusions": [
      { "x1": 0.43, "y1": 0.16, "x2": 0.56, "y2": 0.33, "label": "Woman in red (protected)" }
    ]
  }
]
EOF

node cli.js apply --items @/tmp/items.json --destination-mode separate_folder
```

**CLI — read the full persisted config (no pixels touched):**

```bash
node cli.js config
```

**MCP — equivalent of the first CLI example, as an `apply_blur` tool call**
(the tool's input schema was pulled live from a running `mcp-server.js` via
`tools/list` and matches exactly what's shown here):

```json
{
  "items": [
    {
      "inputPath": "./sample-photos/sample-1.jpg",
      "outputPath": "./sample-photos-blurred/out.jpg",
      "targets": [
        { "cx": 0.15, "cy": 0.2, "rx": 0.055, "ry": 0.075, "label": "Person 1" }
      ]
    }
  ]
}
```

Expect a response shaped like:

```json
{
  "processed": [
    {
      "success": true,
      "image": "sample-1.jpg",
      "targets_count": 1,
      "exclusions_count": 0,
      "output": "./sample-photos-blurred/out.jpg"
    }
  ]
}
```

`sample-photos/` (two CC0 photos — see `sample-photos/CREDITS.md`) and
`sample-photos-blurred/` (gitignored) are safe to experiment against without
touching anyone's real data.

## If you're working ON this codebase (not just driving it)

- See `CONTRIBUTING.md` at the repo root for the contribution workflow
  (branch/commit conventions, review expectations) before opening a PR.
- The real verification loop is the Playwright e2e suite at
  `tests/e2e/functions.spec.mjs` (`npm run test:e2e`, driven by
  `tests/e2e/harness.mjs`). It drives the actual running app in headless
  Chromium — not mocked — and needs both the backend (`node server.js`) and
  the frontend (`vite`) running first; see the port caveat above before
  wiring up `BLUR_STUDIO_URL`. It uses plain `playwright`
  (`import { chromium } from 'playwright'`), **not** the `@playwright/test`
  runner — don't reach for `npx playwright test` here, run it with
  `npm run test:e2e` / `node tests/e2e/functions.spec.mjs` directly.
  `tests/e2e/README.md` documents exactly what's covered and why it's safe
  to let the suite actually click Apply/Batch against the bundled sample
  photos (output only ever lands in the gitignored
  `sample-photos-blurred/`).
- `blurService.js` is the one place all three interfaces converge — if you
  change a function's signature or defaults there, re-check `cli.js`,
  `mcp-server.js`, and `server.js` for drift, and update this file's Quick
  Reference table if a tool/subcommand/route name changes.
