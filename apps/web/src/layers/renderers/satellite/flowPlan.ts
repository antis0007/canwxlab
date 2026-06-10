/** Pyramid level selection capped by native satellite resolution so dense
 * optical flow never "discovers" motion finer than the data supports.
 *
 * GOES ABI visible/IR products are ~2 km effective GSD. When the viewport is
 * zoomed past native resolution the WMS image is an upsampled blur; running
 * Lucas-Kanade at full texture resolution there locks onto resampling noise
 * and invents small-scale swirls. The fix: never run a pyramid level whose
 * texel is finer than one native satellite pixel.
 */

export const NATIVE_GSD_M = 2_000;
export const FLOW_PYRAMID = [64, 128, 256, 512] as const;

function pow2Floor(v: number): number {
  return Math.pow(2, Math.floor(Math.log2(Math.max(1, v))));
}

export function pyramidLevelsFor(input: { mercWidthM: number; texWidthPx: number }): number[] {
  const nativePx = Math.max(1, input.mercWidthM / NATIVE_GSD_M);
  const cap = Math.max(FLOW_PYRAMID[0], pow2Floor(nativePx));
  const levels = FLOW_PYRAMID.filter((level) => level <= cap);
  return levels.length > 0 ? [...levels] : [FLOW_PYRAMID[0]];
}
