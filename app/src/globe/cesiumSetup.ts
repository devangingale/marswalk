// Written with AI assistance, directed and reviewed by the team.
import { Cesium3DTileset, ClassificationType, Color, Ellipsoid, Globe, Ion, RequestErrorEvent, Viewer } from 'cesium';
import { patchAntimeridianImagery } from './antimeridian';

export const CESIUM_MARS_ASSET_ID = 3644333;

/** Why Cesium Mars did not load while the user had chosen online. */
export type CesiumFailure = 'invalid-token' | 'forbidden' | 'no-connection' | 'server-error' | 'no-token';

const FAILURE_REASONS: Record<CesiumFailure, string> = {
  'invalid-token': 'invalid token',
  forbidden: 'token not allowed here',
  'no-connection': 'no connection',
  'server-error': 'server error',
  'no-token': 'no token',
};

/** The one line the map notice shows. */
export function cesiumFailureMessage(failure: CesiumFailure): string {
  return `Cesium Mars did not load (${FAILURE_REASONS[failure]})`;
}

/**
 * Maps a failed Cesium Mars load to its cause: 401 (or an INVALID_TOKEN body) is the token,
 * 403 a token without access to the asset or this site's URL, a request with no HTTP status (or the browser reporting offline) is the network, anything
 * else is the server.
 */
export function cesiumFailure(error: unknown, connected = true): CesiumFailure {
  if (!connected) return 'no-connection';
  if (error instanceof RequestErrorEvent) {
    const body = typeof error.response === 'string' ? error.response : JSON.stringify(error.response ?? '');
    if (error.statusCode === 401 || /INVALID_?TOKEN|InvalidCredentials/i.test(body ?? '')) return 'invalid-token';
    if (error.statusCode === 403) return 'forbidden';
    if (error.statusCode === undefined || error.statusCode === 0) return 'no-connection';
    return 'server-error';
  }
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) return 'no-connection';
  return 'server-error';
}

function browserConnected(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

let mode: 'ion' | 'offline' = 'offline';
let pendingFailure: CesiumFailure | null = null;

/**
 * online is the user's choice (see surfaceMode). Online never turns offline silently: without
 * a token or a connection the globe falls back to the plain surface and the failure is reported.
 */
export function initCesium(token: string | undefined, online = true, connected = browserConnected()): 'ion' | 'offline' {
  globalThis.CESIUM_BASE_URL = '/cesium/';
  Ellipsoid.default = Ellipsoid.MARS;
  patchAntimeridianImagery();
  pendingFailure = null;
  if (!online) {
    mode = 'offline';
  } else if (!token) {
    mode = 'offline';
    pendingFailure = 'no-token';
  } else if (!connected) {
    mode = 'offline';
    pendingFailure = 'no-connection';
  } else {
    Ion.defaultAccessToken = token;
    mode = 'ion';
  }
  return mode;
}

export async function createMarsViewer(
  container: HTMLElement,
  opts: { interactive: boolean; globe?: Globe | false },
): Promise<{ viewer: Viewer; tileset: Cesium3DTileset | null; mode: 'ion' | 'offline'; failure: CesiumFailure | null }> {
  const failure = pendingFailure;
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

  if (mode === 'offline') return { viewer, tileset: null, mode, failure };
  try {
    const tileset = await Cesium3DTileset.fromIonAssetId(CESIUM_MARS_ASSET_ID);
    // Draped imagery takes its resolution from the tile it lies on; Cesium's default (16) keeps
    // tiles coarse, so 0.25 m HiRISE looked smeared. 4 is visibly sharp; 2 adds little more.
    tileset.maximumScreenSpaceError = 4;
    viewer.scene.primitives.add(tileset);
    return { viewer, tileset, mode, failure: null };
  } catch (error) {
    // Reported to the user (the map notice offers the offline view); the plain globe keeps our
    // layers usable meanwhile.
    console.warn('Cesium Mars tileset failed to load', error);
    mode = 'offline';
    // The viewer was built for Cesium Mars without a globe; offline imagery and overlays need one.
    if (!viewer.scene.globe && opts.globe !== false) viewer.scene.globe = new Globe(Ellipsoid.MARS);
    setOfflineGlobeColour();
    viewer.scene.requestRender();
    return { viewer, tileset: null, mode, failure: cesiumFailure(error, browserConnected()) };
  }
}

/**
 * Where ground-clamped lines drape: Cesium Mars online; offline, the ellipsoid globe and our
 * site terrain mesh (a 3D tileset) when one is attached.
 */
export function surfaceClassification(tileset: Cesium3DTileset | null): ClassificationType {
  return tileset ? ClassificationType.CESIUM_3D_TILE : ClassificationType.BOTH;
}
