// Written with AI assistance, directed and reviewed by the team.
import { Cesium3DTileset, Ellipsoid, Ion, Viewer } from 'cesium';

export const CESIUM_MARS_ASSET_ID = 3644333;

let mode: 'ion' | 'offline' = 'offline';

export function initCesium(token: string | undefined): 'ion' | 'offline' {
  globalThis.CESIUM_BASE_URL = '/cesium/';
  Ellipsoid.default = Ellipsoid.MARS;
  if (token) {
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
): Promise<{ viewer: Viewer; tileset: Cesium3DTileset | null }> {
  const viewer = new Viewer(container, {
    timeline: false,
    animation: false,
    geocoder: false,
    baseLayerPicker: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    selectionIndicator: false,
    globe: false,
    ellipsoid: Ellipsoid.MARS,
  });
  viewer.scene.screenSpaceCameraController.enableInputs = opts.interactive;

  if (mode === 'offline') return { viewer, tileset: null };
  try {
    const tileset = await Cesium3DTileset.fromIonAssetId(CESIUM_MARS_ASSET_ID);
    viewer.scene.primitives.add(tileset);
    return { viewer, tileset };
  } catch (error) {
    console.warn('Cesium Mars tileset failed to load', error);
    return { viewer, tileset: null };
  }
}
