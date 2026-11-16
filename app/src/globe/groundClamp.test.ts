// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { clampedCameraHeight, highestGround } from './groundClamp';

describe('clampedCameraHeight', () => {
  it('lifts a camera that zoomed below the ground back to the clearance above it', () => {
    // Jezero's floor is about 2.6 km below the datum; wheel zoom took the camera under it.
    expect(clampedCameraHeight(-2_700, -2_630, 30)).toBe(-2_600);
  });

  it('lifts a camera that is above the ground but closer than the clearance', () => {
    expect(clampedCameraHeight(-2_620, -2_630, 30)).toBe(-2_600);
  });

  it('leaves a camera with enough clearance where it is', () => {
    expect(clampedCameraHeight(-2_600, -2_630, 30)).toBeNull();
    expect(clampedCameraHeight(1_000, -2_630, 30)).toBeNull();
  });

  it('leaves the camera alone when the ground under it is unknown', () => {
    expect(clampedCameraHeight(-5_000, undefined, 30)).toBeNull();
  });
});

describe('highestGround', () => {
  it('takes the highest surface that answered', () => {
    expect(highestGround([undefined, -2_630, -2_700])).toBe(-2_630);
  });

  it('is unknown when no surface answered', () => {
    expect(highestGround([undefined, undefined])).toBeUndefined();
    expect(highestGround([])).toBeUndefined();
  });

  it('ignores non-finite heights', () => {
    expect(highestGround([Number.NaN, -2_630])).toBe(-2_630);
  });
});
