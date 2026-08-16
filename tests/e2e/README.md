# E2E tests

Drives the real running app in headless Chromium — not mocked, not simulated.

## Run

```bash
node server.js &          # backend, port 3333
npx vite --port 5173 &    # frontend — check the printed port, may differ
npm run test:e2e          # defaults to http://localhost:5178; override with BLUR_STUDIO_URL
```

```bash
BLUR_STUDIO_URL=http://localhost:5173 npm run test:e2e
```

## What's covered

Every interactive function in the app: image browsing/search/filter, all 4
tools (click + keyboard 1-4), ellipse create/select/edit/delete (button +
Delete key), VIP box create/select/edit/delete, grid density/paint/convert/
clear, blur and feather sliders, all 4 view modes, peek-original, zoom/pan,
undo/redo (button + Ctrl+Z/Ctrl+Shift+Z), destination-mode toggle, the
Python/Batch modals, and — for real, not just presence checks — **Apply
Active**, **Start Batch Processing**, and both **Download** buttons.

## Why Apply/Batch are safe to actually click here

The app's default folder is the bundled `sample-photos/` — two CC0
(public-domain) photos checked into the repo (see `sample-photos/CREDITS.md`),
not anyone's real/private photos. The destination-mode test deliberately ends on **Export
Folder** before any real apply/batch test runs, so output only ever lands in
the gitignored `sample-photos-blurred/` folder; the tracked `sample-photos/`
source images are never mutated in place. If you add a source folder of your
own real photos, be mindful before running these tests against it — point
`BLUR_STUDIO_URL`/the source-folder field at the bundled sample folder, or
your own disposable copy, rather than real originals.

## On failure

Each failing case saves a screenshot to `tests/e2e/screenshots/` (gitignored)
named after the test, plus any console/page errors captured during that case.
