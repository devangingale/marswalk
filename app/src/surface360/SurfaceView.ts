// Written with AI assistance, directed and reviewed by the team.
// The 360° astronaut surface view on the globe's own viewer: an equirectangular panorama
// around a stop, the camera locked inside it, and ground chevrons along the true geodesic
// bearing to the previous and next stops on the same rover traverse. Only the stop's real NASA
// photo is ever shown: it is loaded before entering, and a stop whose photo fails is not entered.
// Entering hides the orbital scene; exiting restores the camera and everything that was shown.
import {
  BoundingSphere,
  CallbackProperty,
  PolygonHierarchy,
  PostProcessStage,
  SceneTransforms,
  Cartesian2,
  Cartesian3,
  CameraEventType,
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
import { FadingPanorama } from './fadingPanorama';
import { GroundOverlay, type GroundShape } from './groundOverlay';
import { formatMetres, geodesicBearingDeg, geodesicM } from './geodesic';
import { GLIDE_MAX_M, GROUND_DROP_M, MOTION_BLUR_GLSL, aimAt, glideAt, groundHit, turnToward } from './glide';
import {
  EYE_HEIGHT_M,
  bundledUrl,
  FOV_DEFAULT_DEG,
  clampFov,
  frameHeadingDeg,
  resolveImageUrl,
  resolveUrl,
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
 * What the recon camera actually stands on: 3D terrain tiles built from orbital DEMs that cover
 * the site (Cesium Mars, or a site terrain mesh), or, with none covering it, the orbital imagery
 * draped on the smooth ellipsoid with no relief.
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
  /**
   * Width in pixels of the texture now showing for the stop (the base, then the high-resolution
   * one); `final` once no better texture is coming (loaded, unsupported or failed).
   */
  onTexture?: (stop: PanoramaStop, widthPx: number, final: boolean) => void;
  /** A stop's photo could not be loaded (offline, CORS, not 2:1); the view stays where it was. */
  onError?: (message: string) => void;
  /** True while a photo loads or a step transition has the screen dimmed. */
  onStepFade?: (on: boolean) => void;
}

/**
 * Longest step of the glide clock per frame. A slow frame (the swap builds the incoming texture and
 * the fading sphere) then stretches the transition instead of skipping the crossfade.
 */
const MAX_GLIDE_STEP_MS = 50;

const prefersReducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Sphere radius. From its centre any radius looks the same; a small sphere makes a glide toward a
 * stop (the camera translated up to GLIDE_MAX_M through it) warp the ground ahead and sweep the
 * sides past, like moving through the scene.
 */
const PANORAMA_RADIUS_M = 50;
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
  // The globe page's ground pan clears this (it drives left-drag itself); the surface view needs it back.
  'rotateEventTypes',
  '_minimumRotateRate',
  '_maximumRotateRate',
] as const;

/** One 2:1 panorama image; rejects with a readable reason. */
function loadPanoramaImage(stop: PanoramaStop, url: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () =>
      image.naturalWidth > 0 && Math.abs(image.naturalWidth / image.naturalHeight - 2) < 0.01
        ? resolve(image)
        : reject(new Error(`${stop.pia_id} panorama is ${image.naturalWidth}x${image.naturalHeight}, not 2:1`));
    image.onerror = () => reject(new Error(`${stop.pia_id} panorama did not load (offline or blocked)`));
    image.src = url;
  });
}

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
  private glide: {
    /** Glide clock, ms: advanced by at most MAX_GLIDE_STEP_MS a frame (see animateGlide). */
    elapsed: number;
    lastFrame: number;
    /** The outgoing stop, drawn as a fading sphere over the incoming one for the whole glide. */
    from: PanoramaStop;
    travelDeg: number;
    fromHeadingDeg: number;
    fromPitchDeg: number;
    /** Glide distance through each sphere, metres. */
    distanceM: number;
  } | null = null;
  private blurStage: PostProcessStage | null = null;
  private blur = 0;
  private readonly blurFocus = new Cartesian2(0.5, 0.5);
  /** Photo URLs already decoded, so a walk to them starts on the next frame. */
  private readonly ready = new Set<string>();
  private inputsBefore = true;
  /** The current stop's base image (the 2048 px one), kept for the next crossfade. */
  private baseImage: HTMLImageElement | null = null;
  private fade: FadingPanorama | null = null;
  /** Linked stops from the current one, with their true bearings, for aiming the ground cursor. */
  private links: { stop: PanoramaStop; bearingDeg: number; legM: number }[] = [];
  private cursor: {
    east: number;
    north: number;
    distanceM: number;
    bearingDeg: number;
    target: { stop: PanoramaStop; bearingDeg: number; legM: number } | null;
  } | null = null;
  private readonly cursorSource = new CustomDataSource('surface360-cursor');
  /** Flat walk arrows for the current stop (one primitive per arrow, picked by stop id). */
  private arrows: GroundOverlay[] = [];
  private readonly puck: GroundOverlay;
  private puckKey = '';
  private pending = false;
  private hiLoad = 0;
  private readonly images = new Map<string, Promise<HTMLImageElement>>();
  private loadId = 0;
  private readonly telemetry: SurfaceTelemetry = { heading: 0, pitch: 0, fov: FOV_DEFAULT_DEG, stop: null, site: null };
  private recon: ReconSite | null = null;
  private lastTelemetryKey = '';
  private readonly meta = new Map<Entity, { stopId: string }>();

  constructor(viewer: Viewer, options: SurfaceViewOptions = {}) {
    this.viewer = viewer;
    this.options = options;
    this.source.show = false;
    void viewer.dataSources.add(this.source);
    this.cursorSource.show = false;
    void viewer.dataSources.add(this.cursorSource);
    this.puck = new GroundOverlay(viewer.scene);
    this.buildCursor();
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
   * Walks to a linked stop in one continuous glide: both panoramas are drawn the whole time. The
   * camera moves forward through the outgoing one (warping it) while it fades out over the incoming
   * one, which pulls in from behind its centre to rest; a gentle directional blur peaks mid-glide.
   * Neighbouring photos are pre-loaded, so a click usually starts the glide on the next frame.
   * With reduced motion requested, a short fade instead.
   */
  async walk(stopId: string): Promise<void> {
    const to = this.manifest && stopById(this.manifest, stopId);
    if (!this.active || this.recon || this.glide || this.pending || !to || !this.stop) return;
    const image = await this.load(to);
    const from = this.stop;
    const fromImage = this.baseImage;
    if (!image || !this.active || !from || !fromImage || this.glide) return;
    if (prefersReducedMotion()) {
      this.options.onStepFade?.(true);
      this.arrive(to, image);
      window.setTimeout(() => this.options.onStepFade?.(false), 150);
      return;
    }
    const travelDeg = geodesicBearingDeg(from, to) ?? this.telemetry.heading;
    const fromHeadingDeg = this.telemetry.heading;
    const fromPitchDeg = this.telemetry.pitch;
    this.glide = {
      elapsed: 0,
      lastFrame: performance.now(),
      from,
      travelDeg,
      fromHeadingDeg,
      fromPitchDeg,
      distanceM: Math.min(GLIDE_MAX_M, Math.max(4, geodesicM(from, to))),
    };
    this.cursor = null;
    const controller = this.viewer.scene.screenSpaceCameraController;
    this.inputsBefore = controller.enableInputs;
    controller.enableInputs = false;
    // Both spheres from the first frame: the incoming stop underneath, the outgoing one over it.
    this.endFade();
    this.fade = new FadingPanorama(this.viewer.scene, fromImage, PANORAMA_RADIUS_M);
    this.arrive(to, image);
    this.source.show = false;
    this.arrows.forEach((a) => (a.show = false));
    this.drawPuck();
    this.ensureBlurStage();
    this.animateGlide();
  }

  /** Jumps to any stop (the mini-map). */
  async goTo(stopId: string): Promise<void> {
    const to = this.manifest && stopById(this.manifest, stopId);
    if (!this.active || this.recon || this.glide || this.pending || !to) return;
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

  /**
   * Height of the rendered surface at a site, sampled only from 3D tilesets whose bounds contain
   * it (a site terrain mesh elsewhere on the planet must not count); else the ellipsoid (0 m).
   */
  private async groundAt(site: ReconSite): Promise<ReconGround> {
    const { scene } = this.viewer;
    const surface = Cartesian3.fromDegrees(site.lon_east, site.lat, 0, Ellipsoid.MARS);
    const covering: Cesium3DTileset[] = [];
    const others: Cesium3DTileset[] = [];
    for (let i = 0; i < scene.primitives.length; i++) {
      const item = scene.primitives.get(i) as unknown;
      if (!(item instanceof Cesium3DTileset) || !item.show) continue;
      (BoundingSphere.distanceSquaredTo(item.boundingSphere, surface) === 0 ? covering : others).push(item);
    }
    if (covering.length && scene.sampleHeightSupported) {
      try {
        const [sample] = await scene.sampleHeightMostDetailed([Cartographic.fromDegrees(site.lon_east, site.lat)], others);
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
    const request = this.request(stop);
    if (this.ready.has(url)) return request;
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
      if (!this.glide) this.options.onStepFade?.(false);
    }
  }

  /** Starts (or reuses) the download of a stop's photo; it is checked to be 2:1. */
  private request(stop: PanoramaStop): Promise<HTMLImageElement> {
    const url = resolveImageUrl(stop, this.baseUrl);
    let request = this.images.get(url);
    if (!request) {
      // If the CDN copy fails, the same photo bundled with the app (2048 px) stands in.
      const bundled = bundledUrl(stop.image_url);
      request = loadPanoramaImage(stop, url).catch((error: unknown) => {
        if (bundled === url) throw error;
        console.warn(`${stop.pia_id}: ${url} did not load, using the bundled copy`);
        return loadPanoramaImage(stop, bundled);
      });
      this.images.set(url, request);
      void request.then(() => this.ready.add(url), () => this.images.delete(url));
    }
    return request;
  }

  /** Downloads the photos of the stops linked to this one, quietly, so walking to them is instant. */
  private prefetchNeighbours(stop: PanoramaStop): void {
    if (!this.manifest) return;
    for (const id of [stop.next_id, stop.prev_id]) {
      const neighbour = stopById(this.manifest, id);
      if (neighbour) void this.request(neighbour).catch(() => undefined);
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
    this.hiLoad++;
    if (this.glide) this.viewer.scene.screenSpaceCameraController.enableInputs = this.inputsBefore;
    this.glide = null;
    this.endFade();
    this.setBlur(0);
    this.cursor = null;
    this.cursorSource.show = false;
    this.removePanorama();
    this.source.entities.removeAll();
    this.meta.clear();
    this.arrows.forEach((a) => a.clear());
    this.arrows = [];
    this.puckKey = '';
    this.puck.clear();
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
    void this.viewer.dataSources.remove(this.cursorSource, true);
    if (this.blurStage) this.viewer.scene.postProcessStages.remove(this.blurStage);
    this.blurStage = null;
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
      if (source !== this.source && source !== this.cursorSource) dataSources.push([source, source.show]);
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
    c.rotateEventTypes = CameraEventType.LEFT_DRAG;
    this.source.show = true;
    this.cursorSource.show = !keepSurface;
    lockedViewers.add(this.viewer);
  }

  /**
   * Whether a scene primitive belongs to the orbital view. The data-source display's own
   * collection draws every entity, the 360° markers included, so it stays on; the other data
   * sources are hidden one by one instead. The panorama is ours.
   */
  private hideable(item: unknown): boolean {
    const display = this.viewer.dataSourceDisplay as unknown as { _primitives?: unknown; _groundPrimitives?: unknown };
    return item !== this.panorama && item !== display._primitives && item !== display._groundPrimitives && !this.fade?.owns(item) && !this.puck.owns(item) && !this.arrows.some((a) => a.owns(item));
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
    this.baseImage = image;
    this.setPanorama(stop, image);
    this.options.onStop?.(stop);
    this.options.onTexture?.(stop, image.naturalWidth, !this.upgrade(stop));

    const camera = this.viewer.camera;
    camera.lookAtTransform(
      Transforms.eastNorthUpToFixedFrame(eye, Ellipsoid.MARS),
      new HeadingPitchRange(CesiumMath.toRadians(headingDeg), CesiumMath.toRadians(pitchDeg), LOOK_RANGE_M),
    );
    this.updateRotateRate();
    this.drawMarkers(stop);
    this.prefetchNeighbours(stop);
    this.publishTelemetry(true);
    this.viewer.scene.requestRender();
  }

  private eye(stop: PanoramaStop): Cartesian3 {
    // Without a published elevation the panorama sits on the ellipsoid: the orbital scene is
    // hidden inside a panorama, so only the relative eye height matters.
    return Cartesian3.fromDegrees(stop.lon_east, stop.lat, (stop.height ?? 0) + EYE_HEIGHT_M, Ellipsoid.MARS);
  }

  /** The largest texture this GPU accepts, read from the scene's own WebGL context. */
  private maxTextureSize(): number {
    const canvas = this.viewer.scene.canvas;
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    return gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 4096;
  }

  /**
   * Swaps in the stop's high-resolution texture once it has loaded, if the GPU can hold it.
   * The new sphere is drawn before the old one is removed, so the swap never shows a gap.
   */
  private upgrade(stop: PanoramaStop): boolean {
    const id = ++this.hiLoad;
    if (!stop.image_url_hi || !stop.image_hi_width || stop.image_hi_width > this.maxTextureSize()) return false;
    const baseWidth = this.baseImage?.naturalWidth ?? 0;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (id !== this.hiLoad || !this.active || this.stop?.id !== stop.id) return;
      if (Math.abs(image.naturalWidth / image.naturalHeight - 2) > 0.01) return;
      const old = this.panorama;
      this.panorama = null;
      this.setPanorama(stop, image, true);
      let frames = 0;
      const remove = this.viewer.scene.postRender.addEventListener(() => {
        if (++frames < 2) return;
        remove();
        if (old && this.viewer.scene.primitives.contains(old)) this.viewer.scene.primitives.remove(old);
      });
      this.options.onTexture?.(stop, image.naturalWidth, true);
    };
    // A missing or blocked 8192 px file is not an error: the 2048 px sphere simply stays.
    image.onerror = () => {
      if (id !== this.hiLoad || this.stop?.id !== stop.id) return;
      console.info(`${stop.pia_id}: high-resolution texture unavailable, keeping ${baseWidth} px`);
      this.options.onTexture?.(stop, baseWidth, true);
    };
    image.src = resolveUrl(stop.image_url_hi, this.baseUrl);
    return true;
  }

  /** The panorama sphere's frame for a stop, centred at `centre` (its eye by default). */
  private panoramaFrame(stop: PanoramaStop, centre: Cartesian3 = this.eye(stop)): Matrix4 {
    return Transforms.headingPitchRollToFixedFrame(
      centre,
      new HeadingPitchRoll(
        CesiumMath.toRadians(frameHeadingDeg(stop.heading)),
        CesiumMath.toRadians(stop.pitch),
        CesiumMath.toRadians(stop.roll),
      ),
      Ellipsoid.MARS,
    );
  }

  private setPanorama(stop: PanoramaStop, image: HTMLImageElement, keepOld = false): void {
    if (!keepOld) this.removePanorama();
    const transform = this.panoramaFrame(stop);
    this.panorama = this.viewer.scene.primitives.add(
      new EquirectangularPanorama({ transform, image, radius: PANORAMA_RADIUS_M } as EquirectangularPanorama.ConstructorOptions),
    ) as EquirectangularPanorama;
    this.viewer.scene.requestRender();
  }

  private removePanorama(): void {
    if (this.panorama) this.viewer.scene.primitives.remove(this.panorama);
    this.panorama = null;
  }

  private drawMarkers(stop: PanoramaStop): void {
    const manifest = this.manifest;
    this.source.entities.removeAll();
    this.meta.clear();
    this.arrows.forEach((a) => a.clear());
    this.arrows = [];
    if (!manifest) return;

    // prev_id / next_id only ever link stops on the same rover traverse (build_panoramas.py).
    const links: [PanoramaStop | undefined, '<' | '>'][] = [
      [stopById(manifest, stop.prev_id), '<'],
      [stopById(manifest, stop.next_id), '>'],
    ];
    this.links = [];
    for (const [target, glyph] of links) {
      if (!target) continue;
      const bearing = geodesicBearingDeg(stop, target);
      if (bearing === null) continue;
      this.links.push({ stop: target, bearingDeg: bearing, legM: geodesicM(stop, target) });
      const tint: Tint = target.walkability ?? 'unknown';
      const leg = `SOL ${target.sol} · ${formatMetres(geodesicM(stop, target))} · ${Math.round(bearing)}°`;
      const text = glyph === '<' ? `<  PREV ${leg}` : `NEXT ${leg}  >`;
      const walk = target.walkability
        ? `${target.walkability.toUpperCase()}${target.slope_deg !== null ? ` · ${target.slope_deg}° slope` : ''}`
        : 'NO DEM GRID AT STOP';
      // A flat white arrow on the ground plane, pointing along the true bearing, over a dark edge.
      const b = (bearing * Math.PI) / 180;
      const arrow = (scale: number, liftM: number) => {
        const at = (fwd: number, side: number) =>
          this.groundPoint(
            stop,
            Math.sin(b) * (CHEVRON_DISTANCE_M + fwd * scale) + Math.cos(b) * side * scale,
            Math.cos(b) * (CHEVRON_DISTANCE_M + fwd * scale) - Math.sin(b) * side * scale,
            liftM,
          );
        return new PolygonHierarchy([at(0.95, 0), at(0.05, 0.6), at(0.35, 0), at(0.05, -0.6)]);
      };
      const overlay = new GroundOverlay(this.viewer.scene);
      overlay.set(
        [
          { hierarchy: arrow(1.18, 0.005), colour: Color.fromCssColorString('#0a1828').withAlpha(0.6) },
          { hierarchy: arrow(1, 0.012), colour: Color.WHITE.withAlpha(0.95) },
        ],
        { stopId: target.id },
      );
      this.arrows.push(overlay);
      const entity = this.source.entities.add({
        position: this.groundPoint(stop, Math.sin(b) * (CHEVRON_DISTANCE_M + 1.2), Math.cos(b) * (CHEVRON_DISTANCE_M + 1.2), 0.05),
        label: {
          text: `${text}\n${walk}`,
          font: '600 15px Barlow, "Segoe UI", Arial, sans-serif',
          fillColor: Color.fromCssColorString(TINTS[tint][0]),
          outlineColor: Color.fromCssColorString('#0a1828'),
          outlineWidth: 4,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(0, -10),
          verticalOrigin: VerticalOrigin.BOTTOM,
          horizontalOrigin: HorizontalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      this.meta.set(entity, { stopId: target.id });
    }
  }

  private picked(position: Cartesian2): { stopId: string } | undefined {
    const id = (this.viewer.scene.pick(position) as { id?: unknown } | undefined)?.id;
    if (id instanceof Entity) return this.meta.get(id);
    return id && typeof id === 'object' && typeof (id as { stopId?: unknown }).stopId === 'string' ? (id as { stopId: string }) : undefined;
  }

  private click(position: Cartesian2): void {
    if (!this.active || this.glide) return;
    const hit = this.picked(position);
    if (hit) void this.walk(hit.stopId);
    else if (this.cursor?.target) void this.walk(this.cursor.target.stop.id);
  }

  /**
   * Ground cursor: where the pointer's view ray meets the ground plane under the eye. Aimed
   * within AIM_TOLERANCE_DEG of a linked stop, it points at that stop and a click walks there.
   */
  private hover(position: Cartesian2): void {
    const canvas = this.viewer.scene.canvas;
    if (!this.active || this.recon || this.glide || !this.stop) {
      if (this.cursor) {
        this.cursor = null;
        this.drawPuck();
      }
      return;
    }
    const onMarker = !!this.picked(position);
    const ray = this.viewer.camera.getPickRay(position);
    let next: typeof this.cursor = null;
    if (ray && !onMarker) {
      const enu = Transforms.eastNorthUpToFixedFrame(this.eye(this.stop), Ellipsoid.MARS);
      const d = Cartesian3.normalize(
        Matrix4.multiplyByPointAsVector(Matrix4.inverseTransformation(enu, new Matrix4()), ray.direction, new Cartesian3()),
        new Cartesian3(),
      );
      const hit = groundHit([d.x, d.y, d.z]);
      if (hit) next = { ...hit, target: aimAt(hit.bearingDeg, this.links) };
    }
    this.cursor = next;
    this.drawPuck();
    canvas.style.cursor = onMarker || next?.target ? 'pointer' : '';
    this.viewer.scene.requestRender();
  }

  /** A ground point at east/north metres from the current stop's eye, on the plane under it. */
  private groundPoint(stop: PanoramaStop, east: number, north: number, liftM = 0.01): Cartesian3 {
    const enu = Transforms.eastNorthUpToFixedFrame(this.eye(stop), Ellipsoid.MARS);
    return Matrix4.multiplyByPoint(enu, new Cartesian3(east, north, -GROUND_DROP_M + liftM), new Cartesian3());
  }

  /** The cursor puck: a white ring lying flat on the ground, with a chevron when aimed at a stop. */
  private drawPuck(): void {
    const c = this.cursor;
    const stop = this.stop;
    const key = c && stop && !this.glide
      ? `${stop.id}|${c.east.toFixed(2)}|${c.north.toFixed(2)}|${c.target?.stop.id ?? ''}|${this.currentFov().toFixed(1)}`
      : '';
    if (key === this.puckKey) return;
    this.puckKey = key;
    if (!key || !c || !stop) {
      this.puck.clear();
      return;
    }
    // Grows with distance so it stays visible far off, and shrinks as the lens zooms in so it
    // keeps about the same size on screen instead of filling the view.
    const zoom = Math.min(1, this.currentFov() / FOV_DEFAULT_DEG);
    const k = Math.min(2.2, Math.max(0.6, c.distanceM / 6)) * zoom;
    const ring = (radius: number) =>
      Array.from({ length: 40 }, (_, i) => {
        const a = (i / 40) * Math.PI * 2;
        return this.groundPoint(stop, c.east + Math.sin(a) * radius, c.north + Math.cos(a) * radius);
      });
    const shapes: GroundShape[] = [
      { hierarchy: new PolygonHierarchy(ring(0.42 * k), [new PolygonHierarchy(ring(0.3 * k))]), colour: Color.WHITE.withAlpha(c.target ? 0.95 : 0.55) },
    ];
    if (c.target) {
      const b = (c.target.bearingDeg * Math.PI) / 180;
      const at = (fwd: number, side: number) =>
        this.groundPoint(stop, c.east + (Math.sin(b) * fwd + Math.cos(b) * side) * k, c.north + (Math.cos(b) * fwd - Math.sin(b) * side) * k, 0.02);
      shapes.push({ hierarchy: new PolygonHierarchy([at(0.62, 0), at(0.14, 0.32), at(0.3, 0), at(0.14, -0.32)]), colour: Color.WHITE.withAlpha(0.95) });
    }
    this.puck.set(shapes);
  }

  /** The label over the cursor puck when it is aimed at a stop. */
  private buildCursor(): void {
    const visible = () => !!this.cursor && !!this.stop && !this.glide;
    this.cursorSource.entities.add({
      position: new CallbackProperty(() => (visible() ? this.groundPoint(this.stop!, this.cursor!.east, this.cursor!.north, 0.05) : undefined), false) as never,
      label: {
        text: new CallbackProperty(() => {
          const t = this.cursor?.target;
          return t ? `SOL ${t.stop.sol} · ${formatMetres(t.legM)}` : '';
        }, false),
        show: new CallbackProperty(() => visible() && !!this.cursor?.target, false),
        font: '600 14px Barlow, "Segoe UI", Arial, sans-serif',
        fillColor: Color.WHITE,
        outlineColor: Color.fromCssColorString('#0a1828'),
        outlineWidth: 4,
        style: LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cartesian2(0, -28),
        verticalOrigin: VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  /** Puts the camera `offsetM` along the travel bearing from the stop's eye, looking at heading/pitch. */
  private placeCamera(stop: PanoramaStop, travelDeg: number, offsetM: number, headingDeg: number, pitchDeg: number): void {
    const t = (travelDeg * Math.PI) / 180;
    const origin = Matrix4.multiplyByPoint(
      Transforms.eastNorthUpToFixedFrame(this.eye(stop), Ellipsoid.MARS),
      new Cartesian3(Math.sin(t) * offsetM, Math.cos(t) * offsetM, 0),
      new Cartesian3(),
    );
    this.viewer.camera.lookAtTransform(
      Transforms.eastNorthUpToFixedFrame(origin, Ellipsoid.MARS),
      new HeadingPitchRange(CesiumMath.toRadians(headingDeg), CesiumMath.toRadians(pitchDeg), LOOK_RANGE_M),
    );
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
    if (this.glide) {
      this.animateGlide();
      return;
    }
    const fov = this.currentFov();
    if (Math.abs(fov - this.targetFov) < 0.05) return;
    this.setFrustumFov(Math.abs(fov - this.targetFov) < 0.2 ? this.targetFov : fov + (this.targetFov - fov) * FOV_EASE);
    this.updateRotateRate();
    this.drawPuck();
    this.viewer.scene.requestRender();
  }

  private animateGlide(): void {
    const g = this.glide!;
    const now = performance.now();
    g.elapsed += Math.min(now - g.lastFrame, MAX_GLIDE_STEP_MS);
    g.lastFrame = now;
    const m = glideAt(g.elapsed, g.distanceM, g.distanceM);
    const stop = this.stop!;
    const heading = turnToward(g.fromHeadingDeg, g.travelDeg, m.eased);
    const pitch = g.fromPitchDeg * (1 - m.eased);
    this.placeCamera(stop, g.travelDeg, m.incomingOffsetM, heading, pitch);
    if (this.fade) {
      // The outgoing sphere sits so that the camera is m.outgoingOffsetM along the travel bearing
      // from its centre: as the camera advances, that panorama warps forward around it.
      const t = (g.travelDeg * Math.PI) / 180;
      const back = m.incomingOffsetM - m.outgoingOffsetM;
      const centre = Matrix4.multiplyByPoint(
        Transforms.eastNorthUpToFixedFrame(this.eye(stop), Ellipsoid.MARS),
        new Cartesian3(Math.sin(t) * back, Math.cos(t) * back, 0),
        new Cartesian3(),
      );
      this.fade.transform = this.panoramaFrame(g.from, centre);
      this.fade.alpha = m.outgoingAlpha;
    }
    this.setBlur(m.blur, stop, g.travelDeg, m.incomingOffsetM);
    if (m.done) {
      this.placeCamera(stop, g.travelDeg, 0, g.travelDeg, 0);
      this.endFade();
      this.setBlur(0);
      this.glide = null;
      this.source.show = true;
      this.arrows.forEach((a) => (a.show = true));
      this.viewer.scene.screenSpaceCameraController.enableInputs = this.inputsBefore;
    }
    this.updateRotateRate();
    this.viewer.scene.requestRender();
  }

  private ensureBlurStage(): void {
    if (this.blurStage) return;
    const stage = new PostProcessStage({
      fragmentShader: MOTION_BLUR_GLSL,
      uniforms: { strength: () => this.blur, focus: () => this.blurFocus },
    });
    stage.enabled = false;
    this.viewer.scene.postProcessStages.add(stage);
    this.blurStage = stage;
  }

  /** Motion-blur strength, radiating from the screen point straight ahead along the travel bearing. */
  private setBlur(strength: number, stop?: PanoramaStop, travelDeg?: number, offsetM = 0): void {
    this.blur = strength;
    if (this.blurStage) this.blurStage.enabled = strength > 0.002;
    if (!stop || travelDeg === undefined || strength <= 0.002) return;
    const t = (travelDeg * Math.PI) / 180;
    const ahead = Matrix4.multiplyByPoint(
      Transforms.eastNorthUpToFixedFrame(this.eye(stop), Ellipsoid.MARS),
      new Cartesian3(Math.sin(t) * (offsetM + 30), Math.cos(t) * (offsetM + 30), 0),
      new Cartesian3(),
    );
    const p = SceneTransforms.worldToWindowCoordinates(this.viewer.scene, ahead);
    const canvas = this.viewer.scene.canvas;
    const onScreen = p && p.x >= 0 && p.y >= 0 && p.x <= canvas.clientWidth && p.y <= canvas.clientHeight;
    this.blurFocus.x = onScreen ? p.x / canvas.clientWidth : 0.5;
    this.blurFocus.y = onScreen ? 1 - p.y / canvas.clientHeight : 0.5;
  }

  private endFade(): void {
    this.fade?.destroy();
    this.fade = null;
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
