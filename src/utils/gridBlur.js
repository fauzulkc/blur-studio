// Shared grid geometry so CanvasStudio's live render, single Apply,
// and Bulk Apply all compute the exact same blur regions from painted cells.

export const DEFAULT_GRID_DENSITY = 20;
export const DEFAULT_GRID_BLUR_ENABLED = true;

export function defaultGridSettings() {
  return { density: DEFAULT_GRID_DENSITY, blurEnabled: DEFAULT_GRID_BLUR_ENABLED, cells: new Set() };
}

export function computeGridDimensions(density, image) {
  const cols = density;
  const rows = image?.aspectRatio ? Math.max(1, Math.round(density / image.aspectRatio)) : density;
  return { cols, rows };
}

// Merges an image's ellipse targets with its painted grid tiles (converted to box targets).
export function buildCombinedTargets(image, targets, gridSettings) {
  const combined = [...targets];
  if (!gridSettings || !gridSettings.blurEnabled || !gridSettings.cells || gridSettings.cells.size === 0) {
    return combined;
  }

  const { cols, rows } = computeGridDimensions(gridSettings.density, image);
  gridSettings.cells.forEach((cellKey) => {
    const [c, r] = cellKey.split('_').map(Number);
    combined.push({
      x1: c / cols,
      y1: r / rows,
      x2: (c + 1) / cols,
      y2: (r + 1) / rows,
      label: `Grid [${c},${r}]`
    });
  });

  return combined;
}
