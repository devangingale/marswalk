// Written with AI assistance, directed and reviewed by the team.
// The 360° astronaut surface view on the globe's own viewer: an equirectangular panorama
// around a stop, the camera locked inside it, ground chevrons to the previous and next stops
// and science markers at their bearings. Entering hides the orbital scene; exiting restores
// the camera and everything that was shown.
import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  Ellipsoid,
  Entity,
  EquirectangularPanorama,
  HeadingPitchRange,
  HeadingPitchRoll,
  HorizontalOrigin,
  LabelStyle,
  Math as CesiumMath,
  Matrix4,
  PerspectiveFrustum,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Transforms,
  VerticalOrigin,
  type Viewer,
} from 'cesium';
import { fallbackPanorama } from './fallbackPanorama';
import { legBetween, legLabel } from './steps';
import {
  EYE_HEIGHT_M,
  FOV_DEFAULT_DEG,
  bearingDeg,
  clampFov,
  distanceM,
  enuDirection,
  frameHeadingDeg,
  resolveImageUrl,
  stopById,
  stopLonLat,
  type PanoramaManifest,
  type PanoramaPoi,
  type PanoramaStop,
  type Walkability,
} from './panoramas';

export interface SurfaceTelemetry {
  heading: number;
  pitch: number;
  fov: number;
  stop: PanoramaStop | null;
}

declare global {
  interface Window {
    marswalkTelemetry?: SurfaceTelemetry;
  }
  interface WindowEventMap {
    'marswalk:poi-select': CustomEvent<PanoramaPoi>;
  }
}

/** Viewers currently inside a panorama; scripted camera flights on them must wait. */
const lockedViewers = new WeakSet<Viewer>();

/** True while a viewer's camera is locked inside a 360° panorama. */
export function isInSurfaceView(viewer: Viewer): boolean {
  return lockedViewers.has(viewer);
}

export interface SurfaceViewOptions {
  onTelemetry?: (t: SurfaceTelemetry) => void;
  onStop?: (stop: PanoramaStop, imageState: 'loading' | 'photo' | 'synthetic') => void;
  onPoi?: (poi: PanoramaPoi | null) => void;
  /** A step walked to a neighbouring stop with < or >, with its surface distance. */
  onWalk?: (metres: number, to: PanoramaStop) => void;
  /** True while a step transition has the screen dimmed. */
  onStepFade?: (on: boolean) => void;
}

/** Each half of the 0.6 s step transition, ms. */
export const STEP_HALF_MS = 300;
/** The lens pushes in to this fraction of the FOV on the way out and settles from the inverse on arrival. */
const STEP_PUSH = 0.72;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Sphere radius: well beyond the markers, well inside the far plane. */
const PANORAMA_RADIUS_M = 1000;
/** The camera orbits the eye point at this distance, so rotating looks around in place. */
const LOOK_RANGE_M = 0.01;
const CHEVRON_DISTANCE_M = 5;
const POI_DISTANCE_M = 40;
/** Fraction of the way to the target FOV covered each frame. */
const FOV_EASE = 0.2;

const TINTS: Record<Walkability, [string, string]> = {
  safe: ['#39e58c', '#38d9f0'],
  caution: ['#ffc152', '#ff9a3c'],
  hazard: ['#ff7a45', '#eb3b4f'],
};

const POI_COLOURS: Record<string, string> = {
  hazard: '#eb517c',
  geology: '#8ec1f5',
  terrain: '#e8c27a',
  comms: '#6fd3e8',
};

function chevronImage(walkability: Walkability): HTMLCanvasElement {
  const size = 96;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const [a, b] = TINTS[walkability];
  const fill = ctx.createLinearGradient(0, 0, 0, size);
  fill.addColorStop(0, a);
  fill.addColorStop(1, b);
  // Two stacked chevrons pointing up the image; the billboard's aligned axis turns them toward the stop.
  for (const offset of [0, 26]) {
    ctx.beginPath();
    ctx.moveTo(size / 2, 10 + offset);
    ctx.lineTo(size - 12, 40 + offset);
    ctx.lineTo(size - 24, 50 + offset);
    ctx.lineTo(size / 2, 30 + offset);
    ctx.lineTo(24, 50 + offset);
    ctx.lineTo(12, 40 + offset);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.strokeStyle = 'rgba(10, 18, 28, 0.85)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fill();
  }
  return c;
}

function poiImage(type: string): HTMLCanvasElement {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const colour = POI_COLOURS[type.toLowerCase()] ?? '#f4ede4';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(10, 18, 28, 0.55)';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = colour;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 7, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
  return c;
}

interface SavedScene {
  position: Cartesian3;
  direction: Cartesian3;
  up: Cartesian3;
  transform: Matrix4;
  fov: number | undefined;
  controller: Record<string, unknown>;
  globe: boolean | undefined;
  skyAtmosphere: boolean | undefined;
  skyBox: boolean | undefined;
  sun: boolean | undefined;
  moon: boolean | undefined;
  fog: boolean;
  entities: boolean;
  primitives: [{ show: boolean }, boolean][];
  dataSources: [{ show: boolean }, boolean][];
}

/** Private rotate-rate fields: Cesium scales drag speed by distance from the planet, which is nonsense at 1 cm. */
type RotateRates = { _minimumRotateRate: number; _maximumRotateRate: number };

const CONTROLLER_KEYS = [
  'enableRotate',
  'enableTilt',
  'enableTranslate',
  'enableZoom',
  'enableLook',
  'enableCollisionDetection',
  '_minimumRotateRate',
  '_maximumRotateRate',
] as const;

export class SurfaceView {
  private readonly viewer: Viewer;
  private readonly options: SurfaceViewOptions;
  private readonly source = new CustomDataSource('surface360');
  private readonly handler: ScreenSpaceEventHandler;
  private readonly removers: (() => void)[] = [];
  private manifest: PanoramaManifest | null = null;
  private baseUrl = '';
  private stop: PanoramaStop | null = null;
  private panorama: EquirectangularPanorama | null = null;
  private saved: SavedScene | null = null;
  private targetFov = FOV_DEFAULT_DEG;
  private step: { phase: 'out' | 'in'; start: number; fov: number; to: string } | null = null;
  private loadId = 0;
  private readonly telemetry: SurfaceTelemetry = { heading: 0, pitch: 0, fov: FOV_DEFAULT_DEG, stop: null };
  private lastTelemetryKey = '';
  private readonly chevronImages = new Map<Walkability, HTMLCanvasElement>();
  private readonly poiImages = new Map<string, HTMLCanvasElement>();
  private readonly meta = new Map<Entity, { kind: 'go'; stopId: string } | { kind: 'poi'; poi: PanoramaPoi }>();

  constructor(viewer: Viewer, options: SurfaceViewOptions = {}) {
    this.viewer = viewer;
    this.options = options;
    this.source.show = false;
    void viewer.dataSources.add(this.source);
    this.handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    this.handler.setInputAction((e: ScreenSpaceEventHandler.PositionedEvent) => this.click(e.position), ScreenSpaceEventType.LEFT_CLICK);
    this.handler.setInputAction((e: ScreenSpaceEventHandler.MotionEvent) => this.hover(e.endPosition), ScreenSpaceEventType.MOUSE_MOVE);
    const wheel = (event: WheelEvent) => {
      if (!this.active) return;
      event.preventDefault();
      event.stopPropagation();
      this.zoomBy(event.deltaY > 0 ? 5 : -5);
    };
    viewer.scene.canvas.addEventListener('wheel', wheel, { passive: false, capture: true });
    this.removers.push(() => viewer.scene.canvas.removeEventListener('wheel', wheel, { capture: true }));
    this.removers.push(
      viewer.scene.preRender.addEventListener(() => {
        this.hideLatePrimitives();
        this.easeFov();
      }),
    );
    this.removers.push(viewer.scene.postRender.addEventListener(() => this.publishTelemetry()));
  }

  get active(): boolean {
    return this.saved !== null;
  }

  get currentStop(): PanoramaStop | null {
    return this.stop;
  }

  get fov(): number {
    return this.targetFov;
  }

  /** Enters the view at a stop, keeping the orbital camera to restore on exit. */
  enter(manifest: PanoramaManifest, baseUrl: string, stop: PanoramaStop): void {
    this.manifest = manifest;
    this.baseUrl = baseUrl;
    if (!this.saved) this.hideOrbitalScene();
    this.targetFov = FOV_DEFAULT_DEG;
    this.setFrustumFov(FOV_DEFAULT_DEG);
    this.showStop(stop, stop.heading, stop.pitch);
  }

  /**
   * Steps to a neighbouring stop with a 0.6 s push-in-and-settle: the lens narrows and the
   * screen dims for the first half, the stop swaps, then the lens settles back as it clears.
   * Counts as walked distance (onWalk).
   */
  walk(stopId: string): void {
    if (!this.active || this.step || !this.manifest || !stopById(this.manifest, stopId)) return;
    this.step = { phase: 'out', start: performance.now(), fov: this.targetFov, to: stopId };
    this.options.onStepFade?.(true);
    this.viewer.scene.requestRender();
  }

  /** Jumps to any stop (the mini-map), keeping the direction of travel as the view heading. */
  goTo(stopId: string): void {
    const from = this.stop;
    const to = this.manifest && stopById(this.manifest, stopId);
    if (!to) return;
    const heading = from && distanceM(stopLonLat(from), stopLonLat(to)) > 1 ? bearingDeg(stopLonLat(from), stopLonLat(to)) : this.telemetry.heading;
    this.showStop(to, heading, 0);
  }

  zoomBy(deltaDeg: number): void {
    this.targetFov = clampFov(this.targetFov + deltaDeg);
    this.viewer.scene.requestRender();
  }

  exit(): void {
    const saved = this.saved;
    if (!saved) return;
    this.loadId++;
    if (this.step) this.options.onStepFade?.(false);
    this.step = null;
    this.removePanorama();
    this.source.entities.removeAll();
    this.meta.clear();
    this.source.show = false;
    const { scene, camera } = this.viewer;
    camera.lookAtTransform(Matrix4.IDENTITY);
    if (camera.frustum instanceof PerspectiveFrustum && saved.fov !== undefined) camera.frustum.fov = saved.fov;
    camera.setView({ destination: saved.position, orientation: { direction: saved.direction, up: saved.up } });
    if (!Matrix4.equals(saved.transform, Matrix4.IDENTITY)) camera.lookAtTransform(saved.transform);
    const controller = scene.screenSpaceCameraController as unknown as Record<string, unknown>;
    for (const key of CONTROLLER_KEYS) controller[key] = saved.controller[key];
    if (scene.globe && saved.globe !== undefined) scene.globe.show = saved.globe;
    if (scene.skyAtmosphere && saved.skyAtmosphere !== undefined) scene.skyAtmosphere.show = saved.skyAtmosphere;
    if (scene.skyBox && saved.skyBox !== undefined) scene.skyBox.show = saved.skyBox;
    if (scene.sun && saved.sun !== undefined) scene.sun.show = saved.sun;
    if (scene.moon && saved.moon !== undefined) scene.moon.show = saved.moon;
    scene.fog.enabled = saved.fog;
    this.viewer.entities.show = saved.entities;
    for (const [item, show] of saved.primitives) item.show = show;
    for (const [item, show] of saved.dataSources) item.show = show;
    this.saved = null;
    lockedViewers.delete(this.viewer);
    this.stop = null;
    this.telemetry.stop = null;
    this.lastTelemetryKey = '';
    delete window.marswalkTelemetry;
    this.options.onPoi?.(null);
    scene.requestRender();
  }

  destroy(): void {
    if (this.viewer.isDestroyed()) return;
    this.exit();
    this.handler.destroy();
    this.removers.forEach((remove) => remove());
    void this.viewer.dataSources.remove(this.source, true);
  }

  private hideOrbitalScene(): void {
    const { scene, camera } = this.viewer;
    const controller = scene.screenSpaceCameraController as unknown as Record<string, unknown>;
    const primitives: SavedScene['primitives'] = [];
    for (let i = 0; i < scene.primitives.length; i++) {
      const item = scene.primitives.get(i) as { show?: boolean };
      if (typeof item.show === 'boolean' && this.hideable(item)) primitives.push([item as { show: boolean }, item.show]);
    }
    const dataSources: SavedScene['dataSources'] = [];
    for (let i = 0; i < this.viewer.dataSources.length; i++) {
      const source = this.viewer.dataSources.get(i);
      if (source !== this.source) dataSources.push([source, source.show]);
    }
    this.saved = {
      position: Cartesian3.clone(camera.positionWC),
      direction: Cartesian3.clone(camera.directionWC),
      up: Cartesian3.clone(camera.upWC),
      transform: Matrix4.clone(camera.transform),
      fov: camera.frustum instanceof PerspectiveFrustum ? camera.frustum.fov : undefined,
      controller: Object.fromEntries(CONTROLLER_KEYS.map((key) => [key, controller[key]])),
      globe: scene.globe?.show,
      skyAtmosphere: scene.skyAtmosphere?.show,
      skyBox: scene.skyBox?.show,
      sun: scene.sun?.show,
      moon: scene.moon?.show,
      fog: scene.fog.enabled,
      entities: this.viewer.entities.show,
      primitives,
      dataSources,
    };
    for (const [item] of primitives) item.show = false;
    for (const [item] of dataSources) item.show = false;
    this.viewer.entities.show = false;
    if (scene.globe) scene.globe.show = false;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
    if (scene.skyBox) scene.skyBox.show = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    scene.fog.enabled = false;

    // Look around only: drag to turn, no panning, no dolly. The wheel is FOV zoom (see constructor).
    const c = scene.screenSpaceCameraController;
    c.enableRotate = true;
    c.enableTilt = true;
    c.enableTranslate = false;
    c.enableZoom = false;
    c.enableLook = false;
    c.enableCollisionDetection = false;
    this.source.show = true;
    lockedViewers.add(this.viewer);
  }

  /**
   * Whether a scene primitive belongs to the orbital view. The data-source display's own
   * collection draws every entity, the 360° markers included, so it stays on; the other data
   * sources are hidden one by one instead. The panorama is ours.
   */
  private hideable(item: unknown): boolean {
    const display = this.viewer.dataSourceDisplay as unknown as { _primitives?: unknown; _groundPrimitives?: unknown };
    return item !== this.panorama && item !== display._primitives && item !== display._groundPrimitives;
  }

  /** Hides orbital primitives added while the view is open (a site mesh landing late), and restores them on exit. */
  private hideLatePrimitives(): void {
    const saved = this.saved;
    if (!saved) return;
    const primitives = this.viewer.scene.primitives;
    for (let i = 0; i < primitives.length; i++) {
      const item = primitives.get(i) as { show?: boolean };
      if (typeof item.show !== 'boolean' || !item.show || !this.hideable(item)) continue;
      if (!saved.primitives.some(([known]) => known === item)) saved.primitives.push([item as { show: boolean }, true]);
      item.show = false;
    }
  }

  private showStop(stop: PanoramaStop, headingDeg: number, pitchDeg: number): void {
    this.stop = stop;
    this.telemetry.stop = stop;
    this.options.onPoi?.(null);
    const eye = this.eye(stop);

    const id = ++this.loadId;
    this.setPanorama(stop, fallbackPanorama(stop));
    this.options.onStop?.(stop, 'loading');
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (id !== this.loadId) return;
      if (image.naturalWidth > 0 && Math.abs(image.naturalWidth / image.naturalHeight - 2) < 0.05) {
        this.setPanorama(stop, image);
        this.options.onStop?.(stop, 'photo');
      } else {
        console.warn(`Panorama ${stop.image_url} is not 2:1; keeping the synthetic horizon`);
        this.options.onStop?.(stop, 'synthetic');
      }
    };
    image.onerror = () => {
      if (id === this.loadId) this.options.onStop?.(stop, 'synthetic');
    };
    image.src = resolveImageUrl(stop, this.baseUrl);

    const camera = this.viewer.camera;
    camera.lookAtTransform(
      Transforms.eastNorthUpToFixedFrame(eye, Ellipsoid.MARS),
      new HeadingPitchRange(CesiumMath.toRadians(headingDeg), CesiumMath.toRadians(pitchDeg), LOOK_RANGE_M),
    );
    this.updateRotateRate();
    this.drawMarkers(stop, eye);
    this.publishTelemetry(true);
    this.viewer.scene.requestRender();
  }

  private eye(stop: PanoramaStop): Cartesian3 {
    return Cartesian3.fromDegrees(stop.lon_east, stop.lat, stop.height + EYE_HEIGHT_M, Ellipsoid.MARS);
  }

  private setPanorama(stop: PanoramaStop, image: HTMLImageElement | HTMLCanvasElement): void {
    this.removePanorama();
    const transform = Transforms.headingPitchRollToFixedFrame(
      this.eye(stop),
      new HeadingPitchRoll(
        CesiumMath.toRadians(frameHeadingDeg(stop.heading)),
        CesiumMath.toRadians(stop.pitch),
        CesiumMath.toRadians(stop.roll),
      ),
      Ellipsoid.MARS,
    );
    this.panorama = this.viewer.scene.primitives.add(
      new EquirectangularPanorama({ transform, image, radius: PANORAMA_RADIUS_M } as EquirectangularPanorama.ConstructorOptions),
    ) as EquirectangularPanorama;
    this.viewer.scene.requestRender();
  }

  private removePanorama(): void {
    if (this.panorama) this.viewer.scene.primitives.remove(this.panorama);
    this.panorama = null;
  }

  /** A point at a compass bearing and pitch from the eye, metres away. */
  private around(eye: Cartesian3, headingDeg: number, pitchDeg: number, metres: number, dropM = 0): Cartesian3 {
    const [e, n, u] = enuDirection(headingDeg, pitchDeg);
    const enu = Transforms.eastNorthUpToFixedFrame(eye, Ellipsoid.MARS);
    return Matrix4.multiplyByPoint(enu, new Cartesian3(e * metres, n * metres, u * metres - dropM), new Cartesian3());
  }

  private drawMarkers(stop: PanoramaStop, eye: Cartesian3): void {
    const manifest = this.manifest;
    this.source.entities.removeAll();
    this.meta.clear();
    if (!manifest) return;

    const links: [PanoramaStop | undefined, '<' | '>', number][] = [
      [stopById(manifest, stop.prev_id), '<', stop.heading + 180],
      [stopById(manifest, stop.next_id), '>', stop.heading],
    ];
    for (const [target, glyph, fallbackBearing] of links) {
      if (!target) continue;
      const d = distanceM(stopLonLat(stop), stopLonLat(target));
      const bearing = d > 1 ? bearingDeg(stopLonLat(stop), stopLonLat(target)) : fallbackBearing;
      const ground = this.around(eye, bearing, 0, CHEVRON_DISTANCE_M, EYE_HEIGHT_M);
      const ahead = this.around(eye, bearing, 0, CHEVRON_DISTANCE_M + 1, EYE_HEIGHT_M);
      const axis = Cartesian3.normalize(Cartesian3.subtract(ahead, ground, new Cartesian3()), new Cartesian3());
      let image = this.chevronImages.get(target.walkability);
      if (!image) this.chevronImages.set(target.walkability, (image = chevronImage(target.walkability)));
      const leg = legLabel(legBetween(stop, target));
      const text = glyph === '<' ? `<  PREV SOL ${target.sol} · ${leg}` : `NEXT SOL ${target.sol} · ${leg}  >`;
      const entity = this.source.entities.add({
        position: ground,
        billboard: {
          image,
          width: 72,
          height: 72,
          alignedAxis: axis,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `${text}\n${target.walkability.toUpperCase()}`,
          font: '600 15px Barlow, "Segoe UI", Arial, sans-serif',
          fillColor: Color.fromCssColorString(TINTS[target.walkability][0]),
          outlineColor: Color.fromCssColorString('#0a1828'),
          outlineWidth: 4,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(0, 48),
          verticalOrigin: VerticalOrigin.TOP,
          horizontalOrigin: HorizontalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      this.meta.set(entity, { kind: 'go', stopId: target.id });
    }

    for (const poi of stop.pois) {
      const key = poi.type.toLowerCase();
      let image = this.poiImages.get(key);
      if (!image) this.poiImages.set(key, (image = poiImage(poi.type)));
      const entity = this.source.entities.add({
        position: this.around(eye, poi.heading, poi.pitch, POI_DISTANCE_M),
        billboard: { image, width: 34, height: 34, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: {
          text: poi.title,
          font: '600 14px Barlow, "Segoe UI", Arial, sans-serif',
          fillColor: Color.fromCssColorString('#f4ede4'),
          outlineColor: Color.fromCssColorString('#0a1828'),
          outlineWidth: 4,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(0, -26),
          verticalOrigin: VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      this.meta.set(entity, { kind: 'poi', poi });
    }
  }

  private picked(position: Cartesian2) {
    const picked = this.viewer.scene.pick(position) as { id?: unknown } | undefined;
    return picked?.id instanceof Entity ? this.meta.get(picked.id) : undefined;
  }

  private click(position: Cartesian2): void {
    if (!this.active) return;
    const hit = this.picked(position);
    if (!hit) return;
    if (hit.kind === 'go') {
      this.walk(hit.stopId);
      return;
    }
    window.dispatchEvent(new CustomEvent('marswalk:poi-select', { detail: hit.poi }));
    this.options.onPoi?.(hit.poi);
  }

  private hover(position: Cartesian2): void {
    if (!this.active) return;
    this.viewer.scene.canvas.style.cursor = this.picked(position) ? 'pointer' : '';
  }

  private setFrustumFov(deg: number): void {
    const frustum = this.viewer.camera.frustum;
    if (frustum instanceof PerspectiveFrustum) frustum.fov = CesiumMath.toRadians(deg);
  }

  private currentFov(): number {
    const frustum = this.viewer.camera.frustum;
    return frustum instanceof PerspectiveFrustum && frustum.fov !== undefined ? CesiumMath.toDegrees(frustum.fov) : FOV_DEFAULT_DEG;
  }

  /** Eases the lens toward the target FOV, for a smooth optical zoom. */
  private easeFov(): void {
    if (!this.active) return;
    if (this.step) {
      this.animateStep();
      return;
    }
    const fov = this.currentFov();
    if (Math.abs(fov - this.targetFov) < 0.05) return;
    this.setFrustumFov(Math.abs(fov - this.targetFov) < 0.2 ? this.targetFov : fov + (this.targetFov - fov) * FOV_EASE);
    this.updateRotateRate();
    this.viewer.scene.requestRender();
  }

  private animateStep(): void {
    const step = this.step!;
    const t = Math.min(1, (performance.now() - step.start) / STEP_HALF_MS);
    const e = easeInOut(t);
    if (step.phase === 'out') {
      this.setFrustumFov(step.fov * (1 - (1 - STEP_PUSH) * e));
      if (t >= 1) {
        const from = this.stop;
        const to = this.manifest && stopById(this.manifest, step.to);
        if (from && to) this.options.onWalk?.(legBetween(from, to), to);
        this.goTo(step.to);
        this.step = { ...step, phase: 'in', start: performance.now() };
        this.options.onStepFade?.(false);
      }
    } else {
      this.setFrustumFov(step.fov * (1 / STEP_PUSH - (1 / STEP_PUSH - 1) * e));
      if (t >= 1) {
        this.setFrustumFov(step.fov);
        this.step = null;
      }
    }
    this.updateRotateRate();
    this.viewer.scene.requestRender();
  }

  /**
   * One screen width of drag turns the view by about one screen of field of view, so the
   * scene tracks the pointer at every zoom. Negative rates turn the orbit into a grab-the-sky drag.
   */
  private updateRotateRate(): void {
    const rate = -CesiumMath.toRadians(this.currentFov()) / (2 * Math.PI);
    const c = this.viewer.scene.screenSpaceCameraController as unknown as RotateRates;
    c._minimumRotateRate = rate;
    c._maximumRotateRate = rate;
  }

  private publishTelemetry(force = false): void {
    if (!this.active || !this.stop) return;
    const camera = this.viewer.camera;
    this.telemetry.heading = CesiumMath.toDegrees(CesiumMath.zeroToTwoPi(camera.heading));
    this.telemetry.pitch = CesiumMath.toDegrees(camera.pitch);
    this.telemetry.fov = this.currentFov();
    window.marswalkTelemetry = this.telemetry;
    const key = `${this.stop.id}|${this.telemetry.heading.toFixed(1)}|${this.telemetry.pitch.toFixed(1)}|${this.telemetry.fov.toFixed(1)}`;
    if (!force && key === this.lastTelemetryKey) return;
    this.lastTelemetryKey = key;
    this.options.onTelemetry?.({ ...this.telemetry });
  }
}
