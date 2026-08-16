# Security Policy

## Reporting a vulnerability

This project doesn't have a dedicated security email. To report a
vulnerability, please use **[GitHub Security
Advisories](https://github.com/fauzulkc/blur-studio/security/advisories/new)**
to open a private report on the
[`fauzulkc/blur-studio`](https://github.com/fauzulkc/blur-studio)
repository. This lets you share details privately with the maintainer
before anything is disclosed publicly.

If private reporting isn't available to you for some reason, opening a
regular GitHub issue is the fallback — just avoid including exploit details
or real personal data in that case, and note in the issue that it's a
security report so it can be triaged appropriately.

Please include:

- A description of the issue and its potential impact
- Steps to reproduce (a minimal example is ideal)
- Which entry point is affected (web UI, `server.js`, `cli.js`,
  `mcp-server.js`, or `blur_processor.py`)

There's no fixed SLA, but reports will be acknowledged and looked at as
promptly as possible.

## Security model — what's expected, what isn't

Blur Studio is a **local, single-user, desktop-style tool**, not a
multi-tenant service. That shapes what counts as "working as intended"
versus an actual vulnerability:

- **It reads and writes arbitrary local file paths by design.** The CLI,
  the MCP server, and the Express backend all accept file and folder paths
  from their caller and act on them directly — that's the whole point of a
  tool meant to blur photos wherever they live on disk. This is expected
  behavior for a local tool, not a path-traversal bug to be "fixed" by
  restricting it to some sandboxed directory.
- **The MCP/CLI/API surfaces trust their caller.** There's no
  authentication, authorization, or input sandboxing between "a request
  arrived" and "the corresponding file operation runs." Again, this is
  by design for a tool meant to be driven by you, your own scripts, or an
  AI agent acting on your behalf on your own machine — not a gap versus
  some assumed access-control model.
- **What would be inappropriate:** exposing `server.js` (the Express
  backend, default port 3333) to an untrusted network — including the
  `web` Docker image (`docker build --target web`), which is exactly
  `server.js` in a container and has **no authentication of its own** — or
  running the `mcp` Docker image with a mounted photo folder reachable by
  untrusted parties. Because the trust model above assumes a trusted local
  caller, doing either of those would hand that same file-path trust to
  whoever can reach the port/container. If you deploy the `web` image
  anywhere beyond your own machine, put it behind your own authentication
  and network isolation (a reverse proxy with auth, a private network, a
  platform-level access gate) — this project does not provide either.

## Data-loss risk: `destinationMode: 'replace'`

Setting `destinationMode` to `'replace'` (in the UI, via `--destination-mode
replace` on the CLI, or via the MCP `apply_blur`/`save_image_config` tools)
overwrites the original source image **in place**. By default, a `.bak`
backup of the original is written alongside it first (`makeBackup` defaults
to `true` in `blurService.js`) — but that backup can be explicitly disabled
(`--no-backup` on the CLI, or `makeBackup: false` via MCP/API), and even
with a backup, `replace` mode is still mutating your original files on
disk. This isn't a vulnerability in the traditional sense, but it is a
real data-loss risk worth being deliberate about:

- For anything irreplaceable, prefer the default `separate_folder` mode,
  which never touches the source file.
- If you do use `replace`, leave backups enabled unless you've specifically
  verified you don't need them.
- `.bak` files are gitignored by default — they're a local safety net, not
  a substitute for your own backups of originals you actually care about.
