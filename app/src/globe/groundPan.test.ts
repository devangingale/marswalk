// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { Cartesian3, Ray } from 'cesium';
import { GROUND_PAN_MAX_HEIGHT_M, panRotation, raySphereHit, usesGroundPan } from './groundPan';

describe('raySphereHit', () => {
  it('returns the near hit when the ray starts outside the sphere', () => {
    const ray = new Ray(new Cartesian3(0, 0, 10), new Cartesian3(0, 0, -1));
    const hit = raySphereHit(ray, 4);
    expect(hit?.z).toBeCloseTo(4, 9);
  });

  it('returns the exit point when the ray starts inside the sphere', () => {
    const ray = new Ray(new Cartesian3(0, 0, 1), new Cartesian3(0, 0, -1));
    const hit = raySphereHit(ray, 4);
    expect(hit?.z).toBeCloseTo(-4, 9);
  });

  it('returns null when the ray misses', () => {
    const ray = new Ray(new Cartesian3(10, 0, 10), new Cartesian3(0, 0, -1));
    expect(raySphereHit(ray, 4)).toBeNull();
  });
});

describe('panRotation', () => {
  it('turns from onto to about the planet centre', () => {
    const rotation = panRotation(new Cartesian3(1, 0, 0), new Cartesian3(0, 1, 0));
    expect(rotation?.angle).toBeCloseTo(Math.PI / 2, 12);
    expect(rotation?.axis.x).toBeCloseTo(0, 12);
    expect(rotation?.axis.y).toBeCloseTo(0, 12);
    expect(rotation?.axis.z).toBeCloseTo(1, 12);
  });

  it('ignores the length of the two points', () => {
    const rotation = panRotation(new Cartesian3(3, 0, 0), new Cartesian3(0, 0, 5));
    expect(rotation?.angle).toBeCloseTo(Math.PI / 2, 12);
    expect(rotation?.axis.y).toBeCloseTo(-1, 12);
  });

  it('returns null when the points are the same direction', () => {
    expect(panRotation(new Cartesian3(2, 0, 0), new Cartesian3(5, 0, 0))).toBeNull();
  });
});

describe('usesGroundPan', () => {
  it('anchors to the ground near the surface and leaves planet scale to Cesium', () => {
    expect(GROUND_PAN_MAX_HEIGHT_M).toBe(40000);
    expect(usesGroundPan(-3600)).toBe(true);
    expect(usesGroundPan(39999)).toBe(true);
    expect(usesGroundPan(40000)).toBe(false);
    expect(usesGroundPan(5_000_000)).toBe(false);
  });
});
