// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import * as Cesium from 'cesium';
import {
  Cartographic,
  Ellipsoid,
  GeographicProjection,
  GeographicTilingScheme,
  ImageryLayer,
  Math as CesiumMath,
  UrlTemplateImageryProvider,
} from 'cesium';
import { antimeridianSpan, isPolar, patchAntimeridianImagery, rebaseU, unwrapLongitude } from './antimeridian';

const deg = CesiumMath.toRadians;
const PI = Math.PI;

describe('antimeridianSpan', () => {
  it('unwraps a primitive from 179 E to 179 W into 179 to 181 degrees', () => {
    const span = antimeridianSpan([deg(179), deg(179.5), deg(-179.5), deg(-179)]);
    expect(span!.west).toBeCloseTo(deg(179), 12);
    expect(span!.east).toBeCloseTo(deg(181), 12);
  });

  it('leaves a primitive on one side of 180 degrees alone', () => {
    expect(antimeridianSpan([deg(170), deg(179)])).toBeNull();
    expect(antimeridianSpan([deg(-179), deg(-170)])).toBeNull();
  });

  it('leaves a primitive across the prime meridian alone', () => {
    expect(antimeridianSpan([deg(-1), deg(1)])).toBeNull();
  });

  it('leaves a polar cap that covers every longitude alone', () => {
    expect(antimeridianSpan([deg(-180), deg(-90), deg(0), deg(90), deg(180)])).toBeNull();
  });

  it('returns null for no positions', () => {
    expect(antimeridianSpan([])).toBeNull();
  });
});

describe('isPolar', () => {
  it('flags only vertices on a pole', () => {
    expect(isPolar(PI / 2)).toBe(true);
    expect(isPolar(-PI / 2)).toBe(true);
    expect(isPolar(deg(89.9))).toBe(false);
  });
});

describe('unwrapLongitude', () => {
  it('adds a full turn west of the span start only', () => {
    expect(unwrapLongitude(deg(-179), deg(179))).toBeCloseTo(deg(181), 12);
    expect(unwrapLongitude(deg(179.5), deg(179))).toBeCloseTo(deg(179.5), 12);
  });
});

describe('rebaseU', () => {
  it('maps each half of a 179 to 181 degree span onto its half of the whole', () => {
    // East half 179..180 is the first half; west half (unwrapped 180..181) is the second.
    expect(rebaseU(0, deg(179), deg(1), deg(179), deg(2))).toBeCloseTo(0, 12);
    expect(rebaseU(1, deg(179), deg(1), deg(179), deg(2))).toBeCloseTo(0.5, 12);
    expect(rebaseU(0, PI, deg(1), deg(179), deg(2))).toBeCloseTo(0.5, 12);
    expect(rebaseU(1, PI, deg(1), deg(179), deg(2))).toBeCloseTo(1, 12);
  });
});

describe('patchAntimeridianImagery', () => {
  patchAntimeridianImagery();
  const internals = Cesium as unknown as {
    ModelImageryMapping: {
      computeCartographicBoundingRectangle: (p: Iterable<Cartographic>) => Cesium.Rectangle;
      _createTextureCoordinates: (
        p: Iterable<Cartographic>,
        n: number,
        r: Cesium.Rectangle,
        proj: unknown,
      ) => Float32Array;
    };
    ImageryCoverage: {
      createImageryCoverages: (
        r: Cesium.Rectangle,
        layer: ImageryLayer,
        level: number,
      ) => { x: number; textureCoordinateRectangle: { minX: number; maxX: number } }[];
    };
  };
  const positions = [Cartographic.fromDegrees(179, 0), Cartographic.fromDegrees(-179, 1)];

  it('gives a straddling primitive a 2 degree box, not the whole planet', () => {
    const r = internals.ModelImageryMapping.computeCartographicBoundingRectangle(positions);
    expect(CesiumMath.toDegrees(r.east - r.west)).toBeCloseTo(2, 9);
  });

  it('still finds the straddle in a tile that reaches the north pole', () => {
    const withPole = [...positions, Cartographic.fromDegrees(0, 90)];
    const r = internals.ModelImageryMapping.computeCartographicBoundingRectangle(withPole);
    expect(CesiumMath.toDegrees(r.east - r.west)).toBeCloseTo(2, 9);
  });

  it('gives the vertices either side of 180 degrees texture coordinates 0 and 1', () => {
    const r = internals.ModelImageryMapping.computeCartographicBoundingRectangle(positions);
    const uv = internals.ModelImageryMapping._createTextureCoordinates(
      positions,
      2,
      r,
      new GeographicProjection(Ellipsoid.MARS),
    );
    expect(uv[0]).toBeCloseTo(0, 6);
    expect(uv[2]).toBeCloseTo(1, 6);
  });

  it('covers the box with the last and first level-1 tiles, each on its own half', () => {
    const r = internals.ModelImageryMapping.computeCartographicBoundingRectangle(positions);
    const layer = new ImageryLayer(
      new UrlTemplateImageryProvider({
        url: 'tiles/{z}/{x}/{y}.png',
        tilingScheme: new GeographicTilingScheme({ ellipsoid: Ellipsoid.MARS }),
        maximumLevel: 2,
      }),
    );
    const covers = internals.ImageryCoverage.createImageryCoverages(r, layer, 1);
    expect(covers.map((c) => c.x)).toEqual([3, 0]);
    expect(covers[0].textureCoordinateRectangle.maxX).toBeCloseTo(0.5, 9);
    expect(covers[1].textureCoordinateRectangle.minX).toBeCloseTo(0.5, 9);
  });
});
