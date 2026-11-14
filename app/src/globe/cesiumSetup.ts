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
  opts: { interactive: boolean },
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
    globe: new Globe(Ellipsoid.MARS),
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

  if (mode === 'offline') return { viewer, tileset: null, mode };
  try {
    const tileset = await Cesium3DTileset.fromIonAssetId(CESIUM_MARS_ASSET_ID);
    viewer.scene.primitives.add(tileset);
    return { viewer, tileset, mode };
  } catch (error) {
    console.warn('Cesium Mars tileset failed to load', error);
    mode = 'offline';
    setOfflineGlobeColour();
    return { viewer, tileset: null, mode };
  }
}
