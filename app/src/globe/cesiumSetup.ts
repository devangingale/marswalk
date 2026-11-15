// Written with AI assistance, directed and reviewed by the team.
import { Cesium3DTileset, Color, Ellipsoid, Globe, Ion, Viewer } from 'cesium';
import { patchAntimeridianImagery } from './antimeridian';

export const CESIUM_MARS_ASSET_ID = 3644333;

let mode: 'ion' | 'offline' = 'offline';

export function initCesium(token: string | undefined, online = true): 'ion' | 'offline' {
  globalThis.CESIUM_BASE_URL = '/cesium/';
  Ellipsoid.default = Ellipsoid.MARS;
  patchAntimeridianImagery();
  if (token && online) {
    Ion.defaultAccessToken = token;
    mode = 'ion';
  } else {
    mode = 'offline';
  }
  return mode;
}

export async function createMarsViewer(
  container: HTMLElement,
  opts: { interactive: boolean; globe?: Globe | false },
): Promise<{ viewer: Viewer; tileset: Cesium3DTileset | null; mode: 'ion' | 'offline' }> {
  const viewer = new Viewer(container, {
    timeline: false,
    animation: false,
    baseLayer: false,
    geocoder: false,
    baseLayerPicker: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    selectionIndicator: false,
    // Draw at the screen's real pixel density; Cesium's default draws at CSS pixels and the
    // browser stretches the result, which blurs the globe on scaled displays (150 % = 1.5x).
    useBrowserRecommendedResolution: false,
    // Offline draws our tiles on a plain ellipsoid; online, Cesium Mars is the surface
    // (an ellipsoid at datum height would hide terrain below it, such as Gale).
    globe: opts.globe ?? (mode === 'offline' ? new Globe(Ellipsoid.MARS) : false),
    ellipsoid: Ellipsoid.MARS,
  });
  const setOfflineGlobeColour = () => {
    if (mode !== 'offline' || !viewer.scene.globe) return;
    const styles = getComputedStyle(document.documentElement);
    const ground = styles.getPropertyValue('--color-surface-raised').trim();
    const background = styles.getPropertyValue('--color-bg').trim();
    if (ground) viewer.scene.globe.baseColor = Color.fromCssColorString(ground);
    if (background) viewer.scene.backgroundColor = Color.fromCssColorString(background);
  };
  setOfflineGlobeColour();
  viewer.scene.screenSpaceCameraController.enableInputs = opts.interactive;
  // Zoom steps measure distance to the picked ground. Cesium stops picking during wheel inertia
  // and falls back to height above the datum, which stalls zoom 3.6 km above Gale's floor.
  const controller = viewer.scene.screenSpaceCameraController;
  controller.minimumPickingTerrainDistanceWithInertia = Number.POSITIVE_INFINITY;
  // About 1.5 to 2 times per wheel notch both ways (Cesium's default 5 jumps 5 times inward);
  // stop 30 m above the ground so the closest view still shows a walkable patch.
  controller.zoomFactor = 3;
  controller.minimumZoomDistance = 30;

  if (mode === 'offline') return { viewer, tileset: null, mode };
  try {
    const tileset = await Cesium3DTileset.fromIonAssetId(CESIUM_MARS_ASSET_ID);
    // Draped imagery takes its resolution from the tile it lies on; Cesium's default (16) keeps
    // tiles coarse, so 0.25 m HiRISE looked smeared. 4 is visibly sharp; 2 adds little more.
    tileset.maximumScreenSpaceError = 4;
    viewer.scene.primitives.add(tileset);
    return { viewer, tileset, mode };
  } catch (error) {
    console.warn('Cesium Mars tileset failed to load', error);
    mode = 'offline';
    setOfflineGlobeColour();
    return { viewer, tileset: null, mode };
  }
}
