# Contributing to Image Blur Studio

Thanks for looking at contributing. This project is a coordinate-based
selective image blurring tool — a web UI, a CLI, and an MCP server, all
sharing one core module (`blurService.js`). This document covers how to get
a dev environment running, how to test your changes, the conventions the
codebase follows, and how to extend the CLI/MCP surface.

## Development setup

**Prerequisites:**

- Node.js >= 20 (see `engines` in `package.json`)
- Python 3.10+ with [Pillow](https://pillow.readthedocs.io/) — the actual
  pixel-blurring work happens in `blur_processor.py`, which Node shells out
  to as a subprocess.

**Install dependencies:**

```bash
npm install
pip install -r requirements.txt
```

**Run the app.** There are two equivalent ways to start it:

1. **One command** — `./start.sh` installs npm dependencies on first run if
   `node_modules/` is missing, then starts the backend (`node server.js`,
   port 3333) in the background and the frontend dev server (`npm run dev`,
   Vite, port 5173) in the foreground. Ctrl-C stops both.

2. **Two processes manually** (useful if you want separate terminals/logs):

   ```bash
   npm run server   # backend: node server.js, http://localhost:3333
   npm run dev      # frontend: vite dev server, http://localhost:5173
   ```

   (`npm start` is an alias for `npm run server`.)

The Vite dev server proxies `/api` and `/raw-image` to the backend on 3333
(see `vite.config.js`), so the frontend expects the backend to already be
running.

## Running the test suite

```bash
npm run test:e2e
```

This runs `tests/e2e/functions.spec.mjs` via plain Playwright (not
`@playwright/test`) against the **real running app** in headless Chromium —
nothing is mocked. **Both servers must already be running before you invoke
this command:**

```bash
node server.js &          # backend, port 3333
npm run dev &              # frontend — Vite defaults to port 5173 per vite.config.js
npm run test:e2e
```

One inconsistency worth knowing about: `tests/e2e/harness.mjs` defaults its
target URL (`BLUR_STUDIO_URL`) to `http://localhost:5178`, which does **not**
match Vite's configured default of `5173` in `vite.config.js`. Until that's
reconciled, either point the tests at your actual Vite port:

```bash
BLUR_STUDIO_URL=http://localhost:5173 npm run test:e2e
```

or start Vite explicitly on the port the tests expect:

```bash
npx vite --port 5178
```

See `tests/e2e/README.md` for full coverage details. Briefly: the suite
exercises every interactive function (tools, ellipse/VIP-box/grid editing,
sliders, view modes, zoom/pan, undo/redo, both modals) and — deliberately,
using only the bundled CC0 `sample-photos/` — actually clicks **Apply
Active**, **Start Batch Processing**, and both **Download** buttons. Output
from those real operations lands only in the gitignored
`sample-photos-blurred/` folder; the tracked `sample-photos/` source images
are never mutated in place. On failure, each failing case saves a screenshot
to `tests/e2e/screenshots/` (gitignored).

## Coding conventions

- **No comments unless the *why* is non-obvious.** Don't add comments that
  restate what a line does. Do add a comment when the reasoning behind a
  choice isn't visible from the code itself — see the existing comments in
  `blurService.js`, `cli.js`, and `mcp-server.js` for the tone/level this
  repo uses (e.g. why a watcher ignores `blur_studio_config.json`, why
  `export-python --raw` is a deliberate exception to the JSON-output
  convention).
- **Per-image state is keyed by filename.** `blur_studio_config.json` stores
  `config.targets[filename]` and `config.exclusions[filename]` — the image's
  filename is the config key throughout the stack (scan results, save,
  apply). If you add new per-image state, key it the same way rather than
  introducing a second identifier scheme.
- **This tool does not do automatic face/plate/subject detection, and that
  is load-bearing, not a gap to fill.** Every blur target and exclusion box
  is an exact normalized 0-1 coordinate supplied by the caller (a human
  dragging in the UI, or an agent that looked at the image and estimated
  coordinates itself). Don't add implicit detection logic, "smart" default
  regions, or anything that guesses what to blur — the whole point of the
  MCP/CLI surface is that the caller stays in control of exactly what gets
  obscured.

## Adding a new MCP tool or CLI command

Both `mcp-server.js` and `cli.js` are thin wrappers around the same
functions in `blurService.js` — add or change the actual business logic
there first, then expose it from one or both entry points.

- **New MCP tool:** follow the existing pattern in `mcp-server.js` —
  `server.registerTool(...)` with a Zod input schema (reuse the shared
  shapes like `ellipseTargetShape`/`rectShape` where they fit), and wrap the
  handler with the existing `handle()` helper so thrown errors become an
  `isError` result instead of crashing the server.
- **New CLI subcommand:** follow the existing pattern in `cli.js` —
  `program.command('name').description(...).option(...).action(run(async
  (opts) => { ... }))`. Use `parseJsonArg()` for any option that accepts
  JSON so it supports both an inline string and the `@file.json` idiom, and
  let `run()` handle catching errors into the standard
  `{"success": false, "error": ...}` failure output.

If your change is user-facing, update `.claude/skills/blur-studio/SKILL.md`
(and `AGENTS.md`, if present) to describe the new tool/command — those docs
are what agents actually read to use this project correctly.

## Pull request checklist

Before opening a PR:

- [ ] `npm run build` succeeds
- [ ] `npm run test:e2e` passes, with both the backend and frontend running
      first (see above)
- [ ] No real or private photo data was added anywhere in the repo,
      including `sample-photos/`. This repo has already had to be scrubbed
      of real client data once — `sample-photos/` must only ever contain
      freely-licensed placeholder images (CC0 or equivalent, credited in
      `sample-photos/CREDITS.md`), never actual photos of real people or
      places from a real job.
- [ ] No absolute local filesystem paths, machine-specific config, or
      secrets/API keys committed
- [ ] No generated/runtime files committed (`blur_studio_config.json` with
      real usage data, `sample-photos-blurred/`, `.bak` backups, `dist/`) —
      these are gitignored for a reason

If you're unsure whether something is safe to commit, ask in the PR rather
than pushing it and finding out later.
