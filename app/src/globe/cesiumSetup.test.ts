// Written with AI assistance, directed and reviewed by the team.
import { afterEach, describe, expect, it } from 'vitest';
import { ClassificationType, Ellipsoid } from 'cesium';
import { initCesium, surfaceClassification } from './cesiumSetup';

describe('initCesium', () => {
  afterEach(() => {
    Ellipsoid.default = Ellipsoid.WGS84;
  });

  it('returns offline without a token', () => {
    expect(initCesium(undefined)).toBe('offline');
    expect(Ellipsoid.default.radii.x).toBe(3396190);
  });

  it('returns offline for an empty token', () => {
    expect(initCesium('')).toBe('offline');
    expect(Ellipsoid.default.radii.x).toBe(3396190);
  });

  it('returns ion for a non-empty token', () => {
    expect(initCesium('abc')).toBe('ion');
    expect(Ellipsoid.default.radii.x).toBe(3396190);
  });
});

describe('surfaceClassification', () => {
  it('drapes on Cesium Mars online and on the globe and site mesh offline', () => {
    expect(surfaceClassification({} as never)).toBe(ClassificationType.CESIUM_3D_TILE);
    expect(surfaceClassification(null)).toBe(ClassificationType.BOTH);
  });
});
