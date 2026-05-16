import { BitmapLayer } from "@deck.gl/layers";

export interface DiffOverlayPayload {
  caseId: string;
  field: string;
  diffMode: string;
  bbox: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
  rows: number;
  cols: number;
  grid: number[][]; // row-major; row 0 is bbox MAX-lat (north) in image space
  isGeneratedMock: boolean;
  opacity: number;
}

function lerpColor(t: number): [number, number, number, number] {
  // Diverging cool→neutral→warm ramp suitable for signed diffs.
  // t in [-1, 1]; mid (0) is mostly transparent neutral.
  const ct = Math.max(-1, Math.min(1, t));
  if (ct < 0) {
    const k = -ct; // 0 → 1 toward cold
    return [Math.round(40 + (1 - k) * 80), Math.round(160 - k * 80), Math.round(220), Math.round(40 + k * 200)];
  }
  return [
    Math.round(220),
    Math.round(160 - ct * 100),
    Math.round(40 + (1 - ct) * 80),
    Math.round(40 + ct * 200),
  ];
}

function buildImage(grid: number[][]): HTMLCanvasElement {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  // Normalise by max absolute value so the ramp uses the available range.
  let maxAbs = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const v = Math.abs(grid[r][c]);
      if (v > maxAbs) maxAbs = v;
    }
  }
  if (maxAbs <= 0) maxAbs = 1;

  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const img = ctx.createImageData(cols, rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const v = grid[r][c] / maxAbs;
      const [R, G, B, A] = lerpColor(v);
      const i = (r * cols + c) * 4;
      img.data[i] = R;
      img.data[i + 1] = G;
      img.data[i + 2] = B;
      img.data[i + 3] = A;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Build a deck.gl BitmapLayer for the diff grid, or null if data missing. */
export function createDiffBitmapLayer(payload: DiffOverlayPayload): BitmapLayer | null {
  if (!payload.grid || payload.rows === 0 || payload.cols === 0) return null;
  const image = buildImage(payload.grid);
  return new BitmapLayer({
    id: `diff-${payload.caseId}-${payload.field}-${payload.diffMode}`,
    image,
    bounds: payload.bbox,
    opacity: payload.opacity,
    pickable: false,
  });
}
