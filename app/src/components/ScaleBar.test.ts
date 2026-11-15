// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { pickScaleStep, SCALE_STEPS } from './ScaleBar';

describe('pickScaleStep', () => {
  it('picks a 1-2-5 step near 120 px', () => {
    expect(pickScaleStep(1, null)).toBe(100);
    expect(pickScaleStep(4, null)).toBe(500);
    expect(SCALE_STEPS).toContain(pickScaleStep(13.7, null));
  });

  it('keeps the shown step for small scale changes', () => {
    // 500 m at 4.6 m/px is 109 px: still fits, so no flip to 1 km or 200 m.
    expect(pickScaleStep(4.6, 500)).toBe(500);
    expect(pickScaleStep(3.2, 500)).toBe(500);
  });

  it('moves on once the bar leaves the wider band', () => {
    expect(pickScaleStep(1, 500)).toBe(100);
    expect(pickScaleStep(20, 500)).toBe(2000);
  });

  it('survives a bad scale', () => {
    expect(pickScaleStep(Number.NaN, null)).toBe(100);
    expect(pickScaleStep(0, null)).toBe(100);
  });
});
