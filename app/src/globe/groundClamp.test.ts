// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it, vi } from 'vitest';
import { Cartographic, Ellipsoid } from 'cesium';
import { clampedCameraHeight, highestGround, installMarsGroundClamp, marsGroundHeight } from './groundClamp';
import { backdropEllipsoid } from './cesiumSetup';

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

describe('marsGroundHeight', () => {
  const scene = {} as any;
  const point = Cartographic.fromDegrees(77.4, 18.4);

  it('reads height from the tileset when available', () => {
    const tileset = { getHeight: () => -2_630 };
    expect(marsGroundHeight(point, { tileset, scene })).toBe(-2_630);
  });

  it('takes the highest between tileset and site grid', () => {
    const tileset = { getHeight: () => -2_630 };
    const grid: any = {
      lonlatToLocalMetres: () => ({ x_m: 50, y_m: 50 }),
      width_m: 100,
      height_m: 100,
      lonlatToRowCol: () => ({ row: 0, col: 0 }),
      getElevation: () => -2_550,
    };
    expect(marsGroundHeight(point, { tileset, scene, grid, heightOffsetM: -10 })).toBe(-2_560);
  });

  it('ignores the site grid when the point is outside the site', () => {
    const tileset = { getHeight: () => -2_630 };
    const grid: any = {
      lonlatToLocalMetres: () => ({ x_m: 500, y_m: 50 }),
      width_m: 100,
      height_m: 100,
      lonlatToRowCol: () => ({ row: 0, col: 0 }),
      getElevation: () => -2_000,
    };
    expect(marsGroundHeight(point, { tileset, scene, grid })).toBe(-2_630);
  });

  it('falls back to the offline datum globe when tileset is absent', () => {
    const globe = { getHeight: () => 0 };
    expect(marsGroundHeight(point, { globe })).toBe(0);
  });

  it('returns undefined when no surface answered', () => {
    expect(marsGroundHeight(point, {})).toBeUndefined();
  });
});

describe('installMarsGroundClamp', () => {
  it('disables Cesium collision detection when the backdrop globe is online', () => {
    const viewer: any = {
      scene: {
        globe: { ellipsoid: backdropEllipsoid() },
        screenSpaceCameraController: { enableCollisionDetection: true, minimumZoomDistance: 30 },
        preUpdate: { addEventListener: vi.fn(() => vi.fn()) },
        camera: { transform: {}, positionCartographic: new Cartographic(0, 0, 0) },
      },
    };
    installMarsGroundClamp(viewer);
    expect(viewer.scene.screenSpaceCameraController.enableCollisionDetection).toBe(false);
  });

  it('leaves Cesium collision detection enabled on the datum globe offline', () => {
    const viewer: any = {
      scene: {
        globe: { ellipsoid: Ellipsoid.MARS },
        screenSpaceCameraController: { enableCollisionDetection: true, minimumZoomDistance: 30 },
        preUpdate: { addEventListener: vi.fn(() => vi.fn()) },
        camera: { transform: {}, positionCartographic: new Cartographic(0, 0, 0) },
      },
    };
    installMarsGroundClamp(viewer);
    expect(viewer.scene.screenSpaceCameraController.enableCollisionDetection).toBe(true);
  });
});
