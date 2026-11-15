// Written with AI assistance, directed and reviewed by the team.
// Whole-planet view: Mars stays fixed in the middle of the screen. Spinning is Cesium's own
// left-drag (north stays up); the wheel zooms straight in and out at the centre instead of
// towards the cursor, and tilt and look are off so the camera never turns away from Mars.
// Below PLANET_VIEW_MIN_HEIGHT_M the normal site controls apply unchanged.
import {
  Cartesian3, Ellipsoid, ScreenSpaceEventHandler, ScreenSpaceEventType, type Viewer,
} from 'cesium';

/** Camera height above the datum from which the globe is held in place. */
export const PLANET_VIEW_MIN_HEIGHT_M = 1_500_000;
/** Each wheel notch changes the height above the surface by this factor. */
const WHEEL_STEP = 1.2;

export function inPlanetView(cameraHeightM: number): boolean {
  return cameraHeightM >= PLANET_VIEW_MIN_HEIGHT_M;
}

/** The camera moved along the line through the planet centre so its height above `radius` scales by `factor`. */
export function radialZoom(position: Cartesian3, radius: number, factor: number): Cartesian3 {
  const distance = Cartesian3.magnitude(position);
  const height = Math.max(0, distance - radius);
  const unit = Cartesian3.normalize(position, new Cartesian3());
  return Cartesian3.multiplyByScalar(unit, radius + height * factor, new Cartesian3());
}

/** Direction to the planet centre and an up vector pointing to north (or a fixed axis above a pole). */
export function aimAtCentre(position: Cartesian3): { direction: Cartesian3; up: Cartesian3 } {
  const direction = Cartesian3.normalize(Cartesian3.negate(position, new Cartesian3()), new Cartesian3());
  const north = Math.abs(direction.z) > 0.999 ? Cartesian3.UNIT_X : Cartesian3.UNIT_Z;
  const along = Cartesian3.multiplyByScalar(direction, Cartesian3.dot(north, direction), new Cartesian3());
  const up = Cartesian3.normalize(Cartesian3.subtract(north, along, new Cartesian3()), new Cartesian3());
  return { direction, up };
}

/** Holds Mars in place at whole-planet heights; returns the uninstall function. */
export function installPlanetView(viewer: Viewer): () => void {
  const { scene, camera } = viewer;
  const controller = scene.screenSpaceCameraController;
  const defaults = {
    tilt: controller.tiltEventTypes,
    look: controller.lookEventTypes,
    zoom: controller.zoomEventTypes,
  };
  let locked = false;

  const update = () => {
    const nowLocked = inPlanetView(camera.positionCartographic.height);
    if (nowLocked === locked) return;
    locked = nowLocked;
    controller.tiltEventTypes = nowLocked ? undefined : defaults.tilt;
    controller.lookEventTypes = nowLocked ? undefined : defaults.look;
    controller.zoomEventTypes = nowLocked ? undefined : defaults.zoom;
  };
  update();
  const removePreUpdate = scene.preUpdate.addEventListener(update);

  const handler = new ScreenSpaceEventHandler(scene.canvas);
  handler.setInputAction((delta: number) => {
    if (!locked || delta === 0) return;
    const radius = Ellipsoid.MARS.maximumRadius;
    const factor = delta > 0 ? 1 / WHEEL_STEP : WHEEL_STEP;
    const destination = radialZoom(camera.positionWC, radius, factor);
    camera.setView({ destination, orientation: aimAtCentre(destination) });
  }, ScreenSpaceEventType.WHEEL);

  return () => {
    removePreUpdate();
    handler.destroy();
    controller.tiltEventTypes = defaults.tilt;
    controller.lookEventTypes = defaults.look;
    controller.zoomEventTypes = defaults.zoom;
  };
}
