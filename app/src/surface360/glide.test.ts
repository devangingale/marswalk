// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { ARRIVE_BACK, BLUR_PEAK, GLIDE_MS, aimAt, easeInOut, glideAt, groundHit, turn, turnToward } from './glide';

describe('ground cursor', () => {
  it('meets the ground plane 1.8 m below the eye along the view ray', () => {
    // Looking north and 45 degrees down: the ground is 1.8 m ahead.
    const s = Math.SQRT1_2;
    const hit = groundHit([0, s, -s])!;
    expect(hit.north).toBeCloseTo(1.8);
    expect(hit.east).toBeCloseTo(0);
    expect(hit.bearingDeg).toBeCloseTo(0);
    // East-north-east, shallower: further out, bearing follows the ray.
    const far = groundHit([Math.sin(1.2) * 0.99, Math.cos(1.2) * 0.99, -0.14])!;
    expect(far.bearingDeg).toBeCloseTo((1.2 * 180) / Math.PI, 0);
    expect(far.distanceM).toBeCloseTo((1.8 / 0.14) * 0.99, 1);
  });

  it('shows nothing at or above the horizon, or too far out', () => {
    expect(groundHit([0, 1, 0])).toBeNull();
    expect(groundHit([0, 0.8, 0.6])).toBeNull();
    expect(groundHit([0, 1, -0.01])).toBeNull(); // 180 m out
  });

  it('aims at the linked stop nearest the pointer bearing, within 35 degrees', () => {
    const stops = [{ id: 'next', bearingDeg: 10 }, { id: 'prev', bearingDeg: 190 }];
    expect(aimAt(350, stops)?.id).toBe('next'); // across north
    expect(aimAt(215, stops)?.id).toBe('prev');
    expect(aimAt(100, stops)).toBeNull();
  });
});

describe('glide', () => {
  it('turns the short way round', () => {
    expect(turn(350, 10)).toBe(20);
    expect(turn(10, 350)).toBe(-20);
    expect(turnToward(350, 10, 0.5)).toBeCloseTo(0);
  });

});

describe('continuous glide', () => {
  const D = 20;

  it('lasts about 0.85 s and eases in and out (easeInOutCubic)', () => {
    expect(GLIDE_MS).toBe(850);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(0.1)).toBeLessThan(0.01);
    expect(glideAt(GLIDE_MS, D, D).done).toBe(true);
    expect(glideAt(GLIDE_MS - 1, D, D).done).toBe(false);
  });

  it('draws both panoramas throughout: the outgoing one warps forward and fades out as the incoming one pulls in to rest', () => {
    const start = glideAt(0, D, D);
    const mid = glideAt(GLIDE_MS / 2, D, D);
    const end = glideAt(GLIDE_MS, D, D);
    expect(start).toMatchObject({ outgoingOffsetM: 0, outgoingAlpha: 1, incomingOffsetM: -D * ARRIVE_BACK });
    expect(mid.outgoingAlpha).toBeCloseTo(0.5);
    expect(mid.outgoingOffsetM).toBeCloseTo(D / 2);
    expect(end.outgoingAlpha).toBe(0);
    expect(end.outgoingOffsetM).toBe(D);
    expect(end.incomingOffsetM).toBeCloseTo(0);
    // No cut: every quantity moves smoothly frame to frame.
    for (let ms = 0; ms < GLIDE_MS; ms += 16) {
      const a = glideAt(ms, D, D);
      const b = glideAt(ms + 16, D, D);
      expect(Math.abs(b.outgoingAlpha - a.outgoingAlpha)).toBeLessThan(0.05);
      expect(Math.abs(b.incomingOffsetM - a.incomingOffsetM)).toBeLessThan(1);
      expect(b.outgoingAlpha).toBeLessThanOrEqual(a.outgoingAlpha);
    }
  });

  it('blurs gently, peaking at mid-glide and clear at both ends', () => {
    expect(glideAt(0, D, D).blur).toBe(0);
    expect(glideAt(GLIDE_MS / 2, D, D).blur).toBeCloseTo(BLUR_PEAK);
    expect(glideAt(GLIDE_MS, D, D).blur).toBeCloseTo(0);
    expect(glideAt(GLIDE_MS * 0.25, D, D).blur).toBeLessThan(BLUR_PEAK);
    expect(BLUR_PEAK).toBeLessThanOrEqual(0.5);
  });
});
