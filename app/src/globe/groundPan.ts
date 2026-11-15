// Written with AI assistance, directed and reviewed by the team.
// Left-drag pan that keeps the grabbed ground point under the cursor.
// Cesium's own pan tests the datum ellipsoid first; with the camera below the
// datum (Gale's floor is about 3.6 km under it) that test misses and the drag
// turns the camera instead of moving it. Above GROUND_PAN_MAX_HEIGHT_M the datum
// problem does not arise, so Cesium's own spin (which keeps north up) takes over.
import {
  BoundingSphere, Cartesian2, Cartesian3, CameraEventType, Ellipsoid, IntersectionTests, Ray,
  ScreenSpaceEventHandler, ScreenSpaceEventType, type Viewer,
} from 'cesium';

/** Camera height above the datum below which the ground-anchored pan replaces Cesium's. */
export const GROUND_PAN_MAX_HEIGHT_M = 40_000;

/** Ground pan near the surface; Cesium's spin at planet scale. */
export function usesGroundPan(cameraHeightM: number): boolean {
  return cameraHeightM < GROUND_PAN_MAX_HEIGHT_M;
}

/** Where the ray meets a planet-centred sphere: the near hit, or the exit when the ray starts inside. */
export function raySphereHit(ray: Ray, radius: number): Cartesian3 | null {
  const hit = IntersectionTests.raySphere(ray, new BoundingSphere(Cartesian3.ZERO, radius));
  if (!hit) return null;
  const t = hit.start > 0 ? hit.start : hit.stop;
  if (!(t > 0)) return null;
  return Ray.getPoint(ray, t, new Cartesian3());
}

/** Right-handed axis and angle about the planet centre that carry `from` onto `to`. */
export function panRotation(from: Cartesian3, to: Cartesian3): { axis: Cartesian3; angle: number } | null {
  const axis = Cartesian3.cross(from, to, new Cartesian3());
  if (Cartesian3.magnitude(axis) === 0) return null;
  return { axis: Cartesian3.normalize(axis, axis), angle: Cartesian3.angleBetween(from, to) };
}

/** Replaces Cesium's left-drag with a ground-anchored pan; `isBusy` skips moves while a marker is dragged. */
export function installGroundPan(viewer: Viewer, isBusy: () => boolean): () => void {
  const { scene, camera } = viewer;
  const controller = scene.screenSpaceCameraController;
  const handler = new ScreenSpaceEventHandler(scene.canvas);
  let grab: Cartesian3 | null = null;
  let low: boolean | null = null;

  // Hand left-drag to whichever pan fits the current height; set before Cesium reads it each frame.
  const chooseMode = () => {
    const nowLow = usesGroundPan(camera.positionCartographic.height);
    if (nowLow === low) return;
    low = nowLow;
    controller.rotateEventTypes = nowLow ? undefined : CameraEventType.LEFT_DRAG;
  };
  chooseMode();
  const removePreUpdate = scene.preUpdate.addEventListener(() => { if (!grab) chooseMode(); });

  handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
    chooseMode();
    if (!low) { grab = null; return; }
    const position = Cartesian2.clone(event.position);
    grab = (scene.pickPositionSupported ? scene.pickPosition(position) : undefined)
      ?? camera.pickEllipsoid(position, Ellipsoid.MARS)
      ?? null;
  }, ScreenSpaceEventType.LEFT_DOWN);

  handler.setInputAction((event: ScreenSpaceEventHandler.MotionEvent) => {
    if (!grab || isBusy()) return;
    const hit = raySphereHit(camera.getPickRay(event.endPosition) ?? new Ray(), Cartesian3.magnitude(grab));
    const rotation = hit && panRotation(hit, grab);
    if (!rotation) return;
    // Camera.rotate turns by the negated angle. The rotation axis is arbitrary, so it adds roll:
    // level the camera after each step (same heading and pitch, roll 0) so it never tips over.
    camera.rotate(rotation.axis, -rotation.angle);
    camera.setView({ orientation: { heading: camera.heading, pitch: camera.pitch, roll: 0 } });
  }, ScreenSpaceEventType.MOUSE_MOVE);

  handler.setInputAction(() => { grab = null; }, ScreenSpaceEventType.LEFT_UP);

  return () => {
    removePreUpdate();
    handler.destroy();
  };
}
