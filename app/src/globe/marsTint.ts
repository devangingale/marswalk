/** Approximation of Mars surface colour, not measured colour. */
const STOPS: readonly [number, string][] = [
  [0, '#1e140e'],
  [70, '#5a3a26'],
  [140, '#a26a43'],
  [200, '#c99a6b'],
  [255, '#ecd3ae'],
];

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16);
}

/** A 256-entry RGB lookup table, indexed by source grey value. */
export const MARS_TINT_LUT: Uint8Array = (() => {
  const lut = new Uint8Array(256 * 3);
  for (let value = 0; value <= 255; value++) {
    let upper = STOPS.findIndex(([at]) => at >= value);
    if (upper <= 0) upper = Math.max(1, upper);
    const [loValue, loHex] = STOPS[upper - 1];
    const [hiValue, hiHex] = STOPS[upper];
    const t = (value - loValue) / (hiValue - loValue);
    for (let c = 0; c < 3; c++) {
      const lo = channel(loHex, 1 + c * 2);
      const hi = channel(hiHex, 1 + c * 2);
      lut[value * 3 + c] = Math.round(lo + (hi - lo) * t);
    }
  }
  return lut;
})();

/** Samples a pixel buffer to determine whether its image is greyscale within tolerance. */
export function isGreyscalePixels(pixels: ArrayLike<number>, width: number, height: number, tolerance = 2): boolean {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return false;
  const points = [
    [0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8],
    [0.5, 0.15], [0.5, 0.85], [0.15, 0.5], [0.85, 0.5],
  ];
  return points.every(([x, y]) => {
    const i = (Math.min(height - 1, Math.floor(y * height)) * width + Math.min(width - 1, Math.floor(x * width))) * 4;
    return Math.abs(pixels[i] - pixels[i + 1]) <= tolerance && Math.abs(pixels[i] - pixels[i + 2]) <= tolerance;
  });
}

/** Converts greyscale RGB channels through the Mars ramp while retaining alpha. */
export function tintGreyscalePixels(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const lutIndex = pixels[i] * 3;
    pixels[i] = MARS_TINT_LUT[lutIndex];
    pixels[i + 1] = MARS_TINT_LUT[lutIndex + 1];
    pixels[i + 2] = MARS_TINT_LUT[lutIndex + 2];
  }
}
