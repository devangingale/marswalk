// Written with AI assistance, directed and reviewed by the team.
// Keeps the camera above Cesium Mars where Cesium's own collision cannot. Its collision test
// takes the globe's height, and online the only globe is the backdrop, which reports the datum:
// it would stop the camera 2.6 km above Jezero's floor, so Plan turns that collision off. Without
// it, wheel zoom carried the camera under the terrain and the view filled with backdrop colour.
// This measures the real ground under the camera each frame instead.
import { Cartographic, Matrix4, type Viewer } from 'cesium';

/** The height to move the camera up to, or null when it already clears the ground. */
export function clampedCameraHeight(cameraHeightM: number, groundHeightM: number | undefined, clearanceM: number): number | null {
  if (groundHeightM === undefined) return null;
  const lowest = groundHeightM + clearanceM;
  return cameraHeightM < lowest ? lowest : null;
}

/** The highest of the surfaces that reported a height under a point. */
export function highestGround(heights: readonly (number | undefined)[]): number | undefined {
  let highest: number | undefined;
  for (const height of heights) {
    if (height === undefined || !Number.isFinite(height)) continue;
    if (highest === undefined || height > highest) highest = height;
  }
  return highest;
}

/**
 * Lifts the camera to `clearanceM` above `groundHeightM(point)` whenever it gets closer, run after
 * Cesium's camera controller each frame. Returns the remover.
 */
export function installGroundClamp(
  viewer: Viewer,
  groundHeightM: (point: Cartographic) => number | undefined,
  clearanceM: () => number,
): () => void {
  const { scene, camera } = viewer;
  const remove = scene.preUpdate.addEventListener(() => {
    // Orbiting a fixed point uses a camera transform; its positions are not in world space.
    if (!Matrix4.equals(camera.transform, Matrix4.IDENTITY)) return;
    const here = camera.positionCartographic;
    const height = clampedCameraHeight(here.height, groundHeightM(here), clearanceM());
    if (height === null) return;
    camera.setView({
      destination: scene.ellipsoid.cartographicToCartesian(new Cartographic(here.longitude, here.latitude, height)),
      orientation: { heading: camera.heading, pitch: camera.pitch, roll: camera.roll },
    });
  });
  return () => remove();
}
