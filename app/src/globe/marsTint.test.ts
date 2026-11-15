import { describe, expect, it } from 'vitest';
import { isGreyscalePixels, MARS_TINT_LUT, tintGreyscalePixels } from './marsTint';

describe('Mars natural tint', () => {
  it('maps black and white to the ramp endpoints', () => {
    expect([...MARS_TINT_LUT.slice(0, 3)]).toEqual([0x1e, 0x14, 0x0e]);
    expect([...MARS_TINT_LUT.slice(255 * 3)]).toEqual([0xec, 0xd3, 0xae]);
  });

  it('keeps luminance monotonic across the lookup table', () => {
    const luminance = (i: number) => 0.2126 * MARS_TINT_LUT[i * 3] + 0.7152 * MARS_TINT_LUT[i * 3 + 1] + 0.0722 * MARS_TINT_LUT[i * 3 + 2];
    for (let i = 1; i < 256; i++) expect(luminance(i)).toBeGreaterThanOrEqual(luminance(i - 1));
  });

  it('detects sampled greyscale with tolerance two and rejects coloured tiles', () => {
    const grey = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < grey.length; i += 4) grey.set([120, 121, 119, 255], i);
    expect(isGreyscalePixels(grey, 4, 4)).toBe(true);
    grey.set([120, 123, 120, 255], (2 * 4 + 2) * 4);
    expect(isGreyscalePixels(grey, 4, 4)).toBe(false);
  });

  it('preserves alpha while applying the grey channel ramp', () => {
    const pixels = new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 127]);
    tintGreyscalePixels(pixels);
    expect([...pixels]).toEqual([0x1e, 0x14, 0x0e, 0, 0xec, 0xd3, 0xae, 127]);
  });
});
