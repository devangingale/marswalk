// Written with AI assistance, directed and reviewed by the team.
// The 360° astronaut surface view on the globe's own viewer: an equirectangular panorama
// around a stop, the camera locked inside it, and ground chevrons along the true geodesic
// bearing to the previous and next stops on the same rover traverse. Only the stop's real NASA
// photo is ever shown: it is loaded before entering, and a stop whose photo fails is not entered.
// Entering hides the orbital scene; exiting restores the camera and everything that was shown.
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
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
import { formatMetres, geodesicBearingDeg, geodesicM } from './geodesic';
import {
  EYE_HEIGHT_M,
  FOV_DEFAULT_DEG,
  clampFov,
  enuDirection,
  frameHeadingDeg,
  resolveImageUrl,
  stopById,
  type PanoramaManifest,
  type PanoramaStop,
  type Walkability,
} from './panoramas';

export interface SurfaceTelemetry {
  heading: number;
  pitch: number;
  fov: number;
  /** The panorama stop, or null in orbital recon. */
  stop: PanoramaStop | null;
  /** The known site in orbital recon (no surface mosaic), else null. */
  site: ReconSite | null;
}

/** A known site (known_sites.csv via sites.json) viewed at eye level on the orbital surface. */
export interface ReconSite {
  id: string;
  name: string;
  lat: number;
  lon_east: number;
  /** MOLA elevation from the site finder's evidence, metres, when published. */
  elevation_m: number | null;
}

/**
 * What the recon camera actually stands on: Cesium Mars 3D tiles (built from orbital DEMs and
 * imagery), or, offline, the orbital imagery draped on the smooth ellipsoid with no relief.
 */
export interface ReconGround {
  terrain: 'tiles' | 'ellipsoid';
  /** Ground height under the eye on the rendered surface, metres. */
  groundM: number;
}

declare global {
  interface Window {
    marswalkTelemetry?: SurfaceTelemetry;
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
  onStop?: (stop: PanoramaStop) => void;
  /** Entered orbital recon at a site, standing on the given ground. */
  onRecon?: (site: ReconSite, ground: ReconGround) => void;
  /** A stop's photo could not be loaded (offline, CORS, not 2:1); the view stays where it was. */
  onError?: (message: string) => void;
  /** True while a photo loads or a step transition has the screen dimmed. */
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
/** Fraction of the way to the target FOV covered each frame. */
const FOV_EASE = 0.2;

/** Chevron tint by the target stop's walkability; 'unknown' where no DEM grid covers it. */
type Tint = Walkability | 'unknown';
const TINTS: Record<Tint, [string, string]> = {
  safe: ['#39e58c', '#38d9f0'],
  caution: ['#ffc152', '#ff9a3c'],
  hazard: ['#ff7a45', '#eb3b4f'],
  unknown: ['#e6eef3', '#a9bcc8'],
};

function chevronImage(walkability: Tint): HTMLCanvasElement {
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
  private step: { phase: 'out' | 'in'; start: number; fov: number; to: PanoramaStop; image: HTMLImageElement } | null = null;
  private pending = false;
  private readonly images = new Map<string, Promise<HTMLImageElement>>();
  private loadId = 0;
  private readonly telemetry: SurfaceTelemetry = { heading: 0, pitch: 0, fov: FOV_DEFAULT_DEG, stop: null, site: null };
  private recon: ReconSite | null = null;
  private lastTelemetryKey = '';
  private readonly chevronImages = new Map<Tint, HTMLCanvasElement>();
  private readonly meta = new Map<Entity, { stopId: string }>();

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

  /**
   * Enters the view at a stop, keeping the orbital camera to restore on exit. The photo is
   * loaded first; if it fails, the orbital view is left as it was and onError reports why.
   */
  async enter(manifest: PanoramaManifest, baseUrl: string, stop: PanoramaStop): Promise<boolean> {
    this.manifest = manifest;
    this.baseUrl = baseUrl;
    const image = await this.load(stop);
    if (!image) return false;
    if (!this.saved) this.hideOrbitalScene();
    this.targetFov = FOV_DEFAULT_DEG;
    this.setFrustumFov(FOV_DEFAULT_DEG);
    this.showStop(stop, image, stop.heading, stop.pitch);
    return true;
  }

  /**
   * Steps to the previous or next stop with a 0.6 s push-in-and-settle: the lens narrows and the
   * screen dims for the first half, the stop swaps, then the lens settles back as it clears.
   * The next photo is loaded before the step starts.
   */
  async walk(stopId: string): Promise<void> {
    const to = this.manifest && stopById(this.manifest, stopId);
    if (!this.active || this.recon || this.step || this.pending || !to) return;
    const image = await this.load(to);
    if (!image || !this.active) return;
    this.step = { phase: 'out', start: performance.now(), fov: this.targetFov, to, image };
    this.options.onStepFade?.(true);
    this.viewer.scene.requestRender();
  }

  /** Jumps to any stop (the mini-map). */
  async goTo(stopId: string): Promise<void> {
    const to = this.manifest && stopById(this.manifest, stopId);
    if (!this.active || this.recon || this.step || this.pending || !to) return;
    const image = await this.load(to);
    if (image && this.active) this.arrive(to, image);
  }

  /**
   * Orbital recon at a site with no surface mosaic: the camera stands 1.8 m above the rendered
   * surface (Cesium Mars 3D tiles when loaded, else the imagery-draped ellipsoid), pitch 0,
   * locked in place so it can only turn and tilt. The globe, tiles and imagery stay visible;
   * pins and overlays are hidden.
   */
  async enterRecon(site: ReconSite): Promise<ReconGround | null> {
    if (this.saved || this.pending) return null;
    this.pending = true;
    this.options.onStepFade?.(true);
    let ground: ReconGround = { terrain: 'ellipsoid', groundM: 0 };
    try {
      ground = await this.groundAt(site);
    } finally {
      this.pending = false;
      this.options.onStepFade?.(false);
    }
    if (this.saved) return null;
    this.recon = site;
    this.telemetry.site = site;
    this.telemetry.stop = null;
    this.hideOrbitalScene(true);
    this.targetFov = FOV_DEFAULT_DEG;
    this.setFrustumFov(FOV_DEFAULT_DEG);
    const eye = Cartesian3.fromDegrees(site.lon_east, site.lat, ground.groundM + EYE_HEIGHT_M, Ellipsoid.MARS);
    this.viewer.camera.lookAtTransform(
      Transforms.eastNorthUpToFixedFrame(eye, Ellipsoid.MARS),
      new HeadingPitchRange(0, 0, LOOK_RANGE_M),
    );
    this.updateRotateRate();
    this.options.onRecon?.(site, ground);
    this.publishTelemetry(true);
    this.viewer.scene.requestRender();
    return ground;
  }

  /** Height of the rendered surface at a site: sampled from loaded 3D tiles, else the ellipsoid (0 m). */
  private async groundAt(site: ReconSite): Promise<ReconGround> {
    const { scene } = this.viewer;
    let tiles = false;
    for (let i = 0; i < scene.primitives.length; i++) {
      const item = scene.primitives.get(i) as unknown;
      if (item instanceof Cesium3DTileset && item.show) tiles = true;
    }
    if (tiles && scene.sampleHeightSupported) {
      try {
        const [sample] = await scene.sampleHeightMostDetailed([Cartographic.fromDegrees(site.lon_east, site.lat)]);
        if (sample && Number.isFinite(sample.height)) return { terrain: 'tiles', groundM: sample.height };
      } catch (error) {
        console.warn('Terrain height sample failed; standing on the ellipsoid', error);
      }
    }
    return { terrain: 'ellipsoid', groundM: 0 };
  }

  /** Shows a stop facing the true geodesic bearing from the one we left, when they differ. */
  private arrive(to: PanoramaStop, image: HTMLImageElement): void {
    const from = this.stop;
    const heading = (from && geodesicBearingDeg(from, to)) ?? this.telemetry.heading;
    this.showStop(to, image, heading, 0);
  }

  /** The stop's photo, cached; null (with onError) when it cannot be used. */
  private async load(stop: PanoramaStop): Promise<HTMLImageElement | null> {
    const url = resolveImageUrl(stop, this.baseUrl);
    let request = this.images.get(url);
    if (!request) {
      request = new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () =>
          image.naturalWidth > 0 && Math.abs(image.naturalWidth / image.naturalHeight - 2) < 0.01
            ? resolve(image)
            : reject(new Error(`${stop.pia_id} panorama is ${image.naturalWidth}x${image.naturalHeight}, not 2:1`));
        image.onerror = () => reject(new Error(`${stop.pia_id} panorama did not load (offline or blocked)`));
        image.src = url;
      });
      this.images.set(url, request);
    }
    this.pending = true;
    this.options.onStepFade?.(true);
    try {
      return await request;
    } catch (error) {
      this.images.delete(url);
      this.options.onError?.(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      this.pending = false;
      if (!this.step) this.options.onStepFade?.(false);
    }
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
    this.recon = null;
    this.telemetry.stop = null;
    this.telemetry.site = null;
    this.lastTelemetryKey = '';
    delete window.marswalkTelemetry;
    scene.requestRender();
  }

  destroy(): void {
    if (this.viewer.isDestroyed()) return;
    this.exit();
    this.handler.destroy();
    this.removers.forEach((remove) => remove());
    void this.viewer.dataSources.remove(this.source, true);
  }

  /** keepSurface (orbital recon) leaves the globe, 3D tiles, imagery and sky; only pins and overlays go. */
  private hideOrbitalScene(keepSurface = false): void {
    const { scene, camera } = this.viewer;
    // A fly-to still running (a site pin click) would otherwise carry the camera off the stop.
    camera.cancelFlight();
    const controller = scene.screenSpaceCameraController as unknown as Record<string, unknown>;
    const primitives: SavedScene['primitives'] = [];
    for (let i = 0; !keepSurface && i < scene.primitives.length; i++) {
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
    if (!keepSurface) {
      if (scene.globe) scene.globe.show = false;
      if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
      if (scene.skyBox) scene.skyBox.show = false;
      if (scene.sun) scene.sun.show = false;
      if (scene.moon) scene.moon.show = false;
      scene.fog.enabled = false;
    }

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
    if (!saved || this.recon) return;
    const primitives = this.viewer.scene.primitives;
    for (let i = 0; i < primitives.length; i++) {
      const item = primitives.get(i) as { show?: boolean };
      if (typeof item.show !== 'boolean' || !item.show || !this.hideable(item)) continue;
      if (!saved.primitives.some(([known]) => known === item)) saved.primitives.push([item as { show: boolean }, true]);
      item.show = false;
    }
  }

  private showStop(stop: PanoramaStop, image: HTMLImageElement, headingDeg: number, pitchDeg: number): void {
    this.stop = stop;
    this.telemetry.stop = stop;
    this.telemetry.site = null;
    const eye = this.eye(stop);
    this.setPanorama(stop, image);
    this.options.onStop?.(stop);

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

  private setPanorama(stop: PanoramaStop, image: HTMLImageElement): void {
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

    // prev_id / next_id only ever link stops on the same rover traverse (build_panoramas.py).
    const links: [PanoramaStop | undefined, '<' | '>'][] = [
      [stopById(manifest, stop.prev_id), '<'],
      [stopById(manifest, stop.next_id), '>'],
    ];
    for (const [target, glyph] of links) {
      if (!target) continue;
      const bearing = geodesicBearingDeg(stop, target);
      if (bearing === null) continue;
      const ground = this.around(eye, bearing, 0, CHEVRON_DISTANCE_M, EYE_HEIGHT_M);
      const ahead = this.around(eye, bearing, 0, CHEVRON_DISTANCE_M + 1, EYE_HEIGHT_M);
      const axis = Cartesian3.normalize(Cartesian3.subtract(ahead, ground, new Cartesian3()), new Cartesian3());
      const tint: Tint = target.walkability ?? 'unknown';
      let image = this.chevronImages.get(tint);
      if (!image) this.chevronImages.set(tint, (image = chevronImage(tint)));
      const leg = `SOL ${target.sol} · ${formatMetres(geodesicM(stop, target))} · ${Math.round(bearing)}°`;
      const text = glyph === '<' ? `<  PREV ${leg}` : `NEXT ${leg}  >`;
      const walk = target.walkability
        ? `${target.walkability.toUpperCase()}${target.slope_deg !== null ? ` · ${target.slope_deg}° slope` : ''}`
        : 'NO DEM GRID AT STOP';
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
          text: `${text}\n${walk}`,
          font: '600 15px Barlow, "Segoe UI", Arial, sans-serif',
          fillColor: Color.fromCssColorString(TINTS[tint][0]),
          outlineColor: Color.fromCssColorString('#0a1828'),
          outlineWidth: 4,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(0, 48),
          verticalOrigin: VerticalOrigin.TOP,
          horizontalOrigin: HorizontalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      this.meta.set(entity, { stopId: target.id });
    }
  }

  private picked(position: Cartesian2) {
    const picked = this.viewer.scene.pick(position) as { id?: unknown } | undefined;
    return picked?.id instanceof Entity ? this.meta.get(picked.id) : undefined;
  }

  private click(position: Cartesian2): void {
    if (!this.active) return;
    const hit = this.picked(position);
    if (hit) void this.walk(hit.stopId);
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
        this.arrive(step.to, step.image);
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
    const id = this.stop?.id ?? (this.recon && `recon:${this.recon.id}`);
    if (!this.active || !id) return;
    const camera = this.viewer.camera;
    this.telemetry.heading = CesiumMath.toDegrees(CesiumMath.zeroToTwoPi(camera.heading));
    this.telemetry.pitch = CesiumMath.toDegrees(camera.pitch);
    this.telemetry.fov = this.currentFov();
    window.marswalkTelemetry = this.telemetry;
    const key = `${id}|${this.telemetry.heading.toFixed(1)}|${this.telemetry.pitch.toFixed(1)}|${this.telemetry.fov.toFixed(1)}`;
    if (!force && key === this.lastTelemetryKey) return;
    this.lastTelemetryKey = key;
    this.options.onTelemetry?.({ ...this.telemetry });
  }
}
