// Written with AI assistance, directed and reviewed by the team.
// Our 1 m HiRISE terrain mesh for the site, from <site base>/terrain3d/ (pipeline/site_terrain3d.py).
import {
  Cartesian3,
  Cesium3DTileset,
  ClippingPolygon,
  ClippingPolygonCollection,
  Color,
  CustomShader,
  Ellipsoid,
  ImageryLayer,
  ImageryLayerCollection,
  LightingModel,
  Matrix4,
  Rectangle,
  Transforms,
  UniformType,
  UrlTemplateImageryProvider,
  Viewer,
} from 'cesium';
import { getSiteBaseUrl } from '../config';
import type { SiteData } from '../types';
import { readToken } from './markerImages';

export interface SiteTerrainMesh {
  tileset: Cesium3DTileset;
  /** Add to a bundle elevation to reach the mesh surface in the current mode. */
  heightOffsetM: number;
  destroy(): void;
}

interface TerrainExtras {
  height_offset_m: number;
  edge_min_height_m: number;
}

function terrainExtras(value: unknown): TerrainExtras | null {
  if (typeof value !== 'object' || value === null) return null;
  const { height_offset_m: offset, edge_min_height_m: edgeMin } = value as Record<string, unknown>;
  return typeof offset === 'number' && typeof edgeMin === 'number'
    ? { height_offset_m: offset, edge_min_height_m: edgeMin }
    : null;
}

/** Site rectangle corners at the datum, counter-clockwise from the south-west. */
export function siteCorners(bounds: SiteData['bounds_lonlat']): Cartesian3[] {
  const [west, south, east, north] = bounds;
  return Cartesian3.fromDegreesArray([west, south, east, south, east, north, west, north], Ellipsoid.MARS);
}

/**
 * Moves a small patch around lon/lat at heightM by liftM along each point's own surface normal:
 * the up step plus the east and north stretch that the larger radii of curvature give.
 * Second-order error over a 4 km site is about a millimetre.
 */
export function liftMatrix(lonDeg: number, latDeg: number, heightM: number, liftM: number): Matrix4 {
  const ellipsoid = Ellipsoid.MARS;
  const enu = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lonDeg, latDeg, heightM, ellipsoid), ellipsoid);
  const a = ellipsoid.radii.x;
  const e2 = 1 - (ellipsoid.radii.z * ellipsoid.radii.z) / (a * a);
  const sinLat = Math.sin((latDeg * Math.PI) / 180);
  const w = 1 - e2 * sinLat * sinLat;
  const primeVertical = a / Math.sqrt(w);
  const meridian = (a * (1 - e2)) / (w * Math.sqrt(w));
  const local = Matrix4.multiply(
    Matrix4.fromTranslation(new Cartesian3(0, 0, liftM)),
    Matrix4.fromScale(new Cartesian3(1 + liftM / (primeVertical + heightM), 1 + liftM / (meridian + heightM), 1)),
    new Matrix4(),
  );
  const toLocal = Matrix4.inverseTransformation(enu, new Matrix4());
  return Matrix4.multiply(Matrix4.multiply(enu, local, local), toLocal, new Matrix4());
}

/** How far the hillshade moves brightness from the unlit imagery: 0 none, 1 full Lambert. */
const HILLSHADE_STRENGTH = 0.6;

/** Unit vector towards a light in the north-west, 45 degrees up, at the given point (Earth-fixed). */
export function hillshadeLight(lonDeg: number, latDeg: number): Cartesian3 {
  const enu = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lonDeg, latDeg, 0, Ellipsoid.MARS), Ellipsoid.MARS);
  const local = new Cartesian3(-0.5, 0.5, Math.SQRT1_2);
  return Cartesian3.normalize(Matrix4.multiplyByPointAsVector(enu, local, new Cartesian3()), new Cartesian3());
}

/**
 * Unlit like Cesium Mars, so flat ground matches it at the site edge, with a fixed hillshade from
 * the mesh normals: slopes towards the light brighten, slopes away darken, whatever the clock time.
 * Skirts (the _SKIRT vertex flag) take the --map-background ground colour rather than imagery
 * smeared down the wall.
 */
function hillshadeShader(lonDeg: number, latDeg: number): CustomShader {
  const ground = Color.fromCssColorString(readToken('--map-background'));
  return new CustomShader({
    lightingModel: LightingModel.UNLIT,
    uniforms: {
      u_lightWC: { type: UniformType.VEC3, value: hillshadeLight(lonDeg, latDeg) },
      u_ground: { type: UniformType.VEC3, value: new Cartesian3(ground.red, ground.green, ground.blue) },
    },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        if (fsInput.attributes.skirt > 0.0) material.diffuse = czm_srgbToLinear(u_ground);
        vec3 n = normalize(fsInput.attributes.normalEC);
        vec3 l = normalize(czm_viewRotation * u_lightWC);
        float relative = max(dot(n, l), 0.0) / ${Math.SQRT1_2.toFixed(6)};
        material.diffuse *= mix(1.0, relative, ${HILLSHADE_STRENGTH.toFixed(2)});
      }
    `,
  });
}

/**
 * A ground colour under all imagery, so mesh without imagery reads as ground.
 * It reaches 1 % past the site so texels on the site edge still land inside it.
 */
function groundLayer([west, south, east, north]: SiteData['bounds_lonlat'], groundToken: string): ImageryLayer {
  const padLon = (east - west) / 100;
  const padLat = (north - south) / 100;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = readToken(groundToken);
    context.fillRect(0, 0, 1, 1);
  }
  // One pixel served at every level: model imagery draws levels up to maximumLevel - 1 only,
  // so a single-tile provider (maximum level 0) would never show.
  const provider = new UrlTemplateImageryProvider({
    url: canvas.toDataURL(),
    tileWidth: 1,
    tileHeight: 1,
    maximumLevel: 24,
    rectangle: Rectangle.fromDegrees(west - padLon, south - padLat, east + padLon, north + padLat),
  });
  return new ImageryLayer(provider);
}

/** Copies every ready layer of one imagery collection onto another above its first `below` layers, in the same order and style. */
class ImageryMirror {
  private readonly copies = new Map<ImageryLayer, ImageryLayer>();

  constructor(
    private readonly source: ImageryLayerCollection,
    private readonly target: ImageryLayerCollection,
    private readonly below: number,
  ) {}

  sync(): void {
    for (const [layer, copy] of this.copies) {
      if (this.source.contains(layer)) continue;
      this.target.remove(copy, true);
      this.copies.delete(layer);
    }
    let at = this.below;
    for (let i = 0; i < this.source.length; i++) {
      const layer = this.source.get(i);
      if (!layer.ready) continue;
      let copy = this.copies.get(layer);
      if (!copy) {
        copy = new ImageryLayer(layer.imageryProvider, { rectangle: layer.rectangle });
        this.target.add(copy);
        this.copies.set(layer, copy);
      }
      while (this.target.indexOf(copy) > at) this.target.lower(copy);
      while (this.target.indexOf(copy) < at) this.target.raise(copy);
      copy.show = layer.show;
      copy.alpha = layer.alpha;
      copy.brightness = layer.brightness;
      copy.contrast = layer.contrast;
      copy.hue = layer.hue;
      copy.saturation = layer.saturation;
      copy.gamma = layer.gamma;
      at++;
    }
  }

  clear(): void {
    for (const copy of this.copies.values()) this.target.remove(copy, true);
    this.copies.clear();
  }
}

/**
 * Shows the site's own terrain mesh when the bundle has one, else resolves null and changes nothing.
 * Online it replaces Cesium Mars inside the site rectangle; offline it sits on the plain ellipsoid,
 * lifted so its lowest edge point meets it. Imagery on the surface (Cesium Mars or the offline globe)
 * is mirrored onto the mesh in the same draw order.
 */
export async function attachSiteTerrain(
  viewer: Viewer,
  marsTileset: Cesium3DTileset | null,
  site: SiteData,
): Promise<SiteTerrainMesh | null> {
  let tileset: Cesium3DTileset;
  try {
    tileset = await Cesium3DTileset.fromUrl(`${getSiteBaseUrl(site.id)}/terrain3d/tileset.json`, {
      ellipsoid: Ellipsoid.MARS,
      enableCollision: true,
    });
  } catch {
    return null;
  }
  const extras = terrainExtras(tileset.extras);
  const surface = marsTileset ?? viewer.scene.globe;
  if (!extras || viewer.isDestroyed() || !surface) {
    tileset.destroy();
    return null;
  }

  const [west, south, east, north] = site.bounds_lonlat;
  const centreLon = (west + east) / 2;
  const centreLat = (south + north) / 2;
  tileset.customShader = hillshadeShader(centreLon, centreLat);
  let heightOffsetM = extras.height_offset_m;
  if (!marsTileset) {
    const lift = -extras.edge_min_height_m;
    tileset.modelMatrix = liftMatrix(centreLon, centreLat, extras.edge_min_height_m, lift);
    heightOffsetM += lift;
  }
  surface.clippingPolygons = new ClippingPolygonCollection({
    polygons: [new ClippingPolygon({ positions: siteCorners(site.bounds_lonlat), ellipsoid: Ellipsoid.MARS })],
  });
  viewer.scene.primitives.add(tileset);

  // Without imagery the mesh reads as ground in Cesium Mars online, and as the plain globe offline.
  const groundToken = marsTileset ? '--map-background' : '--color-surface-raised';
  tileset.imageryLayers.add(groundLayer(site.bounds_lonlat, groundToken));
  const mirror = new ImageryMirror(marsTileset ? marsTileset.imageryLayers : viewer.imageryLayers, tileset.imageryLayers, 1);
  const removeSync = viewer.scene.preRender.addEventListener(() => mirror.sync());

  return {
    tileset,
    heightOffsetM,
    destroy() {
      removeSync();
      if (viewer.isDestroyed()) return;
      mirror.clear();
      if (!surface.isDestroyed()) surface.clippingPolygons = new ClippingPolygonCollection();
      viewer.scene.primitives.remove(tileset);
    },
  };
}
