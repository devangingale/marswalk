// Written with AI assistance, directed and reviewed by the team.
// Throwaway go/no-go spike for the Cesium Mars globe, reached with ?spike=1.
import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cartographic,
  ClassificationType,
  Color,
  Ellipsoid,
  HeadingPitchRange,
  ImageryLayer,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { createMarsViewer, initCesium } from './cesiumSetup';
import { PMTilesImageryProvider } from './pmtilesImagery';

const SITES = [
  { name: 'Gale', lon: 137.4, lat: -4.75, range: 6000 },
  { name: 'Jezero', lon: 77.45, lat: 18.44, range: 6000 },
];

const POSES = [
  { name: 'Gale', lon: 137.441633, lat: -4.589467, elevation: -4501.04 },
  { name: 'Jezero', lon: 77.4508857, lat: 18.4446271, elevation: -2569.91 },
];

const TRAVERSES = [
  { url: '/data/gale/traverse.geojson', color: Color.CYAN },
  { url: '/data/jezero/traverse.geojson', color: Color.ORANGE },
];

interface LineFeatures {
  features: { geometry: { type: 'LineString'; coordinates: number[][] } }[];
}

async function surfaceHeights(viewer: Viewer, points: { lon: number; lat: number }[]) {
  const sampled = await viewer.scene.sampleHeightMostDetailed(points.map((p) => Cartographic.fromDegrees(p.lon, p.lat)));
  return sampled.map((c) => c?.height);
}

async function flyTo(viewer: Viewer, lon: number, lat: number, range: number, pitch: number) {
  const [surface] = await surfaceHeights(viewer, [{ lon, lat }]);
  if (surface === undefined) console.warn(`spike: no surface height at ${lon},${lat}; flying relative to the ellipsoid`);
  const center = Cartesian3.fromDegrees(lon, lat, surface ?? 0, Ellipsoid.MARS);
  viewer.camera.flyToBoundingSphere(new BoundingSphere(center, 1), {
    offset: new HeadingPitchRange(0, CesiumMath.toRadians(pitch), range),
  });
}

async function addTraverse(viewer: Viewer, url: string, color: Color) {
  const data = (await (await fetch(url)).json()) as LineFeatures;
  for (const feature of data.features) {
    viewer.entities.add({
      polyline: {
        positions: Cartesian3.fromDegreesArray(feature.geometry.coordinates.flat(), Ellipsoid.MARS),
        width: 3,
        material: color,
        clampToGround: true,
        classificationType: ClassificationType.CESIUM_3D_TILE,
      },
    });
  }
}

function toDegrees(position: Cartesian3) {
  const c = Ellipsoid.MARS.cartesianToCartographic(position);
  return { lon: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude), height: c.height };
}

export async function mountSpike(root: HTMLElement) {
  initCesium(import.meta.env.VITE_CESIUM_ION_TOKEN);
  const { viewer, tileset } = await createMarsViewer(root, { interactive: true });
  console.info('spike: tileset', tileset ? 'loaded' : 'unavailable');

  await Promise.all(TRAVERSES.map(({ url, color }) => addTraverse(viewer, url, color)));

  const sample = new ImageryLayer(await PMTilesImageryProvider.fromUrl('/sample/gale/image.pmtiles'));
  if (tileset) tileset.imageryLayers.add(sample);

  new ScreenSpaceEventHandler(viewer.scene.canvas).setInputAction(
    (event: ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pickPosition(event.position);
      console.info('spike: pick', picked ? JSON.stringify(toDegrees(picked)) : 'none');
    },
    ScreenSpaceEventType.LEFT_CLICK,
  );

  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;top:8px;left:8px;display:flex;gap:6px;z-index:1';
  const button = (label: string, onClick: () => void) => {
    const el = document.createElement('button');
    el.textContent = label;
    el.addEventListener('click', onClick);
    panel.append(el);
  };
  for (const site of SITES) {
    button(site.name, () => void flyTo(viewer, site.lon, site.lat, site.range, -60));
  }
  button('Sample image', () => {
    sample.show = !sample.show;
  });
  // Logs Cesium surface height against each rover pose, and where the pose lands on screen.
  const logPoses = async () => {
    const heights = await surfaceHeights(viewer, POSES);
    POSES.forEach((pose, i) => {
      const height = heights[i];
      if (height === undefined) {
        console.info(`spike: height ${pose.name} unavailable`);
        return;
      }
      console.info(`spike: height ${pose.name} cesium=${height.toFixed(2)} pose=${pose.elevation} diff=${(height - pose.elevation).toFixed(2)}`);
      const point = Cartesian3.fromDegrees(pose.lon, pose.lat, height, Ellipsoid.MARS);
      const screen = viewer.scene.cartesianToCanvasCoordinates(point, new Cartesian2());
      if (screen) console.info(`spike: screen ${pose.name} ${screen.x.toFixed(1)} ${screen.y.toFixed(1)}`);
    });
  };
  button('Poses', () => void logPoses());
  root.append(panel);

  // ?view=lon,lat,range flies straight down onto a spot for close-up checks.
  const view = new URLSearchParams(window.location.search).get('view')?.split(',').map(Number);
  if (view?.length === 3 && view.every(Number.isFinite)) {
    const [lon, lat, range] = view as [number, number, number];
    await flyTo(viewer, lon, lat, range, -90);
  }
}
