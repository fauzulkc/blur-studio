# Blur Studio — Worked Examples

These three examples assume `npm install` has already been run from the `image-blur-studio` repo root, and that `python3 -c "import PIL, numpy"` succeeds (see the Setup section of `SKILL.md`). Coordinates below are illustrative — always derive real coordinates by looking at the actual image, not by reusing these numbers.

## Example A: Single-image ellipse face-blur via the `apply_blur` MCP tool

Scenario: one photo, `./uploads/portrait.jpg`, has a single face that needs blurring before the image can be shared publicly. The face, by eye, sits centered around 52% across and 38% down the frame, and spans roughly 10% of the image's width.

1. Look at the image and estimate the ellipse:
   - `cx = 0.52`, `cy = 0.38`
   - `rx = 0.05` (half of the ~10%-of-width span)
   - `ry = 0.07` (faces are usually taller than wide once you include chin/forehead — estimate this separately by eye, don't derive it from `rx`)

2. Call the `apply_blur` MCP tool directly — no need to `scan_folder` first since this is a single known file, and no need to persist config first since this is a one-off:

```json
{
  "items": [
    {
      "inputPath": "./uploads/portrait.jpg",
      "outputPath": "./uploads/portrait_blurred.jpg",
      "targets": [
        { "cx": 0.52, "cy": 0.38, "rx": 0.05, "ry": 0.07, "label": "Face - subject" }
      ]
    }
  ]
}
```

3. Expected response shape:

```json
{
  "processed": [
    {
      "success": true,
      "image": "portrait.jpg",
      "targets_count": 1,
      "exclusions_count": 0,
      "output": "./uploads/portrait_blurred.jpg"
    }
  ]
}
```

Because `outputPath` was supplied explicitly and `destinationMode` was omitted, the original `portrait.jpg` is never touched — the blurred result is written only to `portrait_blurred.jpg`. `blurRadius`/`featherRadius` were also omitted, so the defaults (`13`/`14`) apply.

## Example B: Batch blur via the CLI using an `@items.json` file

Scenario: an entire folder of five event photos needs faces blurred, and the MCP server isn't connected in this session, so the CLI is used instead. Rather than fighting shell quoting for five images' worth of coordinate arrays inline, write the batch payload to a file and reference it with the `@`-prefix convention.

1. Look at all five images first and build one JSON file listing every item. Save this as `/tmp/items.json` (or any convenient path):

```json
[
  {
    "inputPath": "/path/to/photos/event/IMG_001.jpg",
    "outputPath": "/path/to/photos/event_blurred/IMG_001.jpg",
    "targets": [
      { "cx": 0.22, "cy": 0.41, "rx": 0.03, "ry": 0.045, "label": "Face - left" },
      { "cx": 0.61, "cy": 0.39, "rx": 0.035, "ry": 0.05, "label": "Face - center" }
    ]
  },
  {
    "inputPath": "/path/to/photos/event/IMG_002.jpg",
    "outputPath": "/path/to/photos/event_blurred/IMG_002.jpg",
    "targets": [
      { "cx": 0.48, "cy": 0.33, "rx": 0.04, "ry": 0.06, "label": "Face - center" }
    ]
  },
  {
    "inputPath": "/path/to/photos/event/IMG_003.jpg",
    "outputPath": "/path/to/photos/event_blurred/IMG_003.jpg",
    "targets": [
      { "x1": 0.70, "y1": 0.55, "x2": 0.92, "y2": 0.63, "label": "License plate - parked car" }
    ]
  },
  {
    "inputPath": "/path/to/photos/event/IMG_004.jpg",
    "outputPath": "/path/to/photos/event_blurred/IMG_004.jpg",
    "targets": []
  },
  {
    "inputPath": "/path/to/photos/event/IMG_005.jpg",
    "outputPath": "/path/to/photos/event_blurred/IMG_005.jpg",
    "targets": [
      { "cx": 0.15, "cy": 0.60, "rx": 0.05, "ry": 0.07, "label": "Face - foreground" },
      { "cx": 0.80, "cy": 0.44, "rx": 0.04, "ry": 0.06, "label": "Face - background" }
    ]
  }
]
```

(`IMG_004.jpg` has an empty `targets` array on purpose — nothing in it needed blurring, but it's still listed so it gets copied through to the destination folder rather than left out of the batch.)

2. Run the CLI, pointing `--items` at the file with the `@` prefix, and setting `destinationMode` to `separate_folder` explicitly so originals are never touched:

```bash
node cli.js apply \
  --items @/tmp/items.json \
  --destination-mode separate_folder \
  --blur-radius 13 \
  --feather-radius 14
```

3. Check the output: the command prints `{ "processed": [...] }` to stdout with one entry per item, and exits 0. Since every `outputPath` was already supplied explicitly inside `items.json`, `--destination-mode`/`--destination-folder` only matter for any item that had *omitted* its own `outputPath` — here that's moot, but it's good practice to still pass `--destination-mode separate_folder` so nothing accidentally falls back to overwriting an input if a future edit to the items file drops an `outputPath`.

## Example C: Exclusion box — keep one person sharp in a group photo

Scenario: `./photos/team_photo.jpg` shows six people. Five of them need their faces blurred for a public post, but the sixth (the person giving explicit permission to be shown) must stay fully sharp — and that sixth person's face happens to be close enough to a neighboring face that a naive blur ellipse for the neighbor could bleed onto them after feathering.

1. Estimate an ellipse target for each of the five faces to blur, by eye, the same way as Examples A and B.

2. For the one person who must stay sharp, don't add a target for them — instead add a rectangle **exclusion** box tightly around their face/head, sized generously enough to fully contain the feather bleed from any neighboring blur target (a few percent of margin beyond the visible face outline is usually enough):

```json
{
  "items": [
    {
      "inputPath": "./photos/team_photo.jpg",
      "outputPath": "./photos/team_photo_blurred.jpg",
      "targets": [
        { "cx": 0.10, "cy": 0.45, "rx": 0.04, "ry": 0.06, "label": "Face 1" },
        { "cx": 0.28, "cy": 0.42, "rx": 0.04, "ry": 0.06, "label": "Face 2" },
        { "cx": 0.46, "cy": 0.44, "rx": 0.04, "ry": 0.06, "label": "Face 3 - next to VIP" },
        { "cx": 0.74, "cy": 0.43, "rx": 0.04, "ry": 0.06, "label": "Face 5" },
        { "cx": 0.90, "cy": 0.46, "rx": 0.04, "ry": 0.06, "label": "Face 6" }
      ],
      "exclusions": [
        { "x1": 0.55, "y1": 0.34, "x2": 0.65, "y2": 0.52, "label": "VIP - keep sharp, has given permission" }
      ]
    }
  ],
  "featherRadius": 10
}
```

Notes on this pattern:

- The VIP's face (roughly at `cx: 0.60, cy: 0.43` in this scene) deliberately has **no** target ellipse of its own — it's the exclusion box, not the absence of a target, that protects it from "Face 3"'s feather bleed, since exclusion boxes win even when they overlap a target region.
- `featherRadius` was lowered from the default `14` to `10` here specifically because the VIP's exclusion box sits close to "Face 3"'s target — a smaller feather radius keeps the soft blur-to-sharp transition tighter around Face 3 so it's less likely to visibly wash into the exclusion box's edge. This is a judgment call to make per-image based on how close the VIP is to the nearest blurred region; when there's plenty of clearance, the default feather radius is fine.
- Make the exclusion box noticeably larger than the bare face outline. The exclusion box is a hard rectangle with no feathering of its own — pixels inside it are always 100% sharp — so undersizing it can leave a thin blurred sliver around the VIP's hairline or jaw where a neighboring feathered target still reaches past the box's edge.
