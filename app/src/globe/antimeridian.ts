// Written with AI assistance, directed and reviewed by the team.
// Imagery draped on 3D Tiles across the 180 degree meridian.
//
// Cesium 1.146 maps imagery onto each tileset primitive through the primitive's longitude
// bounding box, taken as plain min and max. A primitive that straddles 180 degrees gets a box
// spanning the whole planet, so the full 360 degrees of imagery is squeezed into that one tile:
// a stretched band along the meridian. The patch below unwraps longitudes for those primitives
// (west side plus 360 degrees), splits the imagery lookup at 180 degrees and shifts the
// western half's imagery tiles by 360 degrees, so the texture runs continuously over the seam.
import * as Cesium from 'cesium';
import { Rectangle } from 'cesium';

const TWO_PI = 2 * Math.PI;
/** Vertices this close to a pole (radians) carry no usable longitude. */
const POLE_EPSILON = 1e-6;

export function isPolar(lat: number): boolean {
  return Math.abs(lat) > Math.PI / 2 - POLE_EPSILON;
}

/**
 * Unwrapped longitude span (radians) of a primitive that straddles 180 degrees, or null.
 * It straddles when the widest gap between its longitudes contains 0 and is wider than a half turn;
 * east is then above pi (the western longitudes plus a full turn). Leave polar vertices out.
 */
export function antimeridianSpan(longitudes: Iterable<number>): { west: number; east: number } | null {
  let minPositive = Infinity;
  let maxNegative = -Infinity;
  let any = false;
  for (const lon of longitudes) {
    any = true;
    if (lon >= 0) minPositive = Math.min(minPositive, lon);
    else maxNegative = Math.max(maxNegative, lon);
  }
  if (!any || minPositive === Infinity || maxNegative === -Infinity) return null;
  if (minPositive - maxNegative <= Math.PI) return null;
  return { west: minPositive, east: maxNegative + TWO_PI };
}

/** Longitude unwrapped into [west, west + 2 pi) for a span from antimeridianSpan. */
export function unwrapLongitude(lon: number, west: number): number {
  return lon < west - 1e-12 ? lon + TWO_PI : lon;
}

/**
 * Rebases a texture coordinate from one half of a split span onto the whole unwrapped span.
 * All tiling-scheme native x coordinates are linear in longitude, so radians serve here.
 */
export function rebaseU(u: number, partWest: number, partWidth: number, west: number, width: number): number {
  return (partWest + u * partWidth - west) / width;
}

interface CartographicLike {
  longitude: number;
  latitude: number;
  height: number;
}
interface CartesianRectangleLike {
  minX: number;
  maxX: number;
}
interface CoverageLike {
  textureCoordinateRectangle: CartesianRectangleLike;
}
type Fn = (...args: never[]) => unknown;

/** Cesium's internal model-imagery classes; exported by the package but absent from its types. */
interface Internals {
  ModelImageryMapping: {
    computeCartographicBoundingRectangle: (positions: Iterable<CartographicLike>, result?: Rectangle) => Rectangle;
    _createTextureCoordinates: (
      positions: Iterable<CartographicLike>,
      count: number,
      rectangle: Rectangle,
      projection: unknown,
    ) => unknown;
    map: <T, U>(items: Iterable<T>, fn: (item: T) => U) => Iterable<U>;
  };
  ImageryCoverage: {
    createImageryCoverages: (rectangle: Rectangle, layer: unknown, level: number) => CoverageLike[];
  };
  ImageryPipelineStage: {
    _createImageryInput: (layer: unknown, coverage: CoverageLike, rectangle: Rectangle, index: number) => unknown;
    _computeTextureTranslationAndScale: (layer: unknown, bounding: Rectangle, imagery: Rectangle) => unknown;
  };
}

let patched = false;

/** Installs the antimeridian handling once; later calls do nothing. */
export function patchAntimeridianImagery(): void {
  if (patched) return;
  const internals = Cesium as unknown as Partial<Internals>;
  const { ModelImageryMapping: mapping, ImageryCoverage: coverage, ImageryPipelineStage: stage } = internals;
  const needed: [object | undefined, string][] = [
    [mapping, 'computeCartographicBoundingRectangle'],
    [mapping, '_createTextureCoordinates'],
    [mapping, 'map'],
    [coverage, 'createImageryCoverages'],
    [stage, '_createImageryInput'],
    [stage, '_computeTextureTranslationAndScale'],
  ];
  if (needed.some(([owner, key]) => typeof (owner as Record<string, Fn> | undefined)?.[key] !== 'function')) {
    console.warn('Cesium imagery internals changed; layers may show a band along the 180 degree meridian');
    return;
  }
  patched = true;
  const m = mapping!;
  const c = coverage!;
  const s = stage!;

  const boundingRectangle = m.computeCartographicBoundingRectangle;
  m.computeCartographicBoundingRectangle = (positions, result) => {
    const rectangle = boundingRectangle(positions, result);
    if (rectangle.east - rectangle.west <= Math.PI) return rectangle;
    const lons: number[] = [];
    for (const p of positions) if (!isPolar(p.latitude)) lons.push(p.longitude);
    const span = antimeridianSpan(lons);
    if (span) {
      rectangle.west = span.west;
      rectangle.east = span.east;
    }
    return rectangle;
  };

  const textureCoordinates = m._createTextureCoordinates;
  m._createTextureCoordinates = (positions, count, rectangle, projection) => {
    if (rectangle.east <= Math.PI) return textureCoordinates(positions, count, rectangle, projection);
    const unwrapped = { longitude: 0, latitude: 0, height: 0 };
    const shifted = m.map(positions, (p: CartographicLike) => {
      // A pole vertex sits on every meridian; put it mid-span so its triangles do not smear.
      unwrapped.longitude = isPolar(p.latitude)
        ? (rectangle.west + rectangle.east) / 2
        : unwrapLongitude(p.longitude, rectangle.west);
      unwrapped.latitude = p.latitude;
      unwrapped.height = p.height;
      return unwrapped;
    });
    return textureCoordinates(shifted, count, rectangle, projection);
  };

  // Coverages on the western half, whose imagery tiles sit one full turn west of the unwrapped span.
  const western = new WeakSet<CoverageLike>();
  const coverages = c.createImageryCoverages;
  c.createImageryCoverages = (rectangle, layer, level) => {
    if (rectangle.east <= Math.PI) return coverages(rectangle, layer, level);
    const width = rectangle.east - rectangle.west;
    const parts = [
      { rect: new Rectangle(rectangle.west, rectangle.south, Math.PI, rectangle.north), unwrappedWest: rectangle.west },
      { rect: new Rectangle(-Math.PI, rectangle.south, rectangle.east - TWO_PI, rectangle.north), unwrappedWest: Math.PI },
    ];
    return parts.flatMap(({ rect, unwrappedWest }, index) => {
      const partWidth = rect.east - rect.west;
      return coverages(rect, layer, level).map((cov) => {
        const t = cov.textureCoordinateRectangle;
        t.minX = rebaseU(t.minX, unwrappedWest, partWidth, rectangle.west, width);
        t.maxX = rebaseU(t.maxX, unwrappedWest, partWidth, rectangle.west, width);
        if (index === 1) western.add(cov);
        return cov;
      });
    });
  };

  let shiftNext = false;
  const imageryInput = s._createImageryInput;
  s._createImageryInput = (layer, cov, rectangle, index) => {
    shiftNext = western.has(cov);
    try {
      return imageryInput(layer, cov, rectangle, index);
    } finally {
      shiftNext = false;
    }
  };

  const translationAndScale = s._computeTextureTranslationAndScale;
  s._computeTextureTranslationAndScale = (layer, bounding, imagery) => {
    if (!shiftNext) return translationAndScale(layer, bounding, imagery);
    const moved = new Rectangle(imagery.west + TWO_PI, imagery.south, imagery.east + TWO_PI, imagery.north);
    return translationAndScale(layer, bounding, moved);
  };
}
