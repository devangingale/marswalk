// Written with AI assistance, directed and reviewed by the team.
// Explore map annotations on the globe: the ten ranked candidate sites, cave candidates
// (thinned to one per screen cell, openings first, type labels when close), and numbered
// highest-value markers for each visible whole-planet layer. One object per viewer.

import {
  Cartesian2,
  Cartesian3,
  Color,
  ConstantProperty,
  CustomDataSource,
  Ellipsoid,
  EllipsoidalOccluder,
  Entity,
  HeightReference,
  HorizontalOrigin,
  LabelStyle,
  SceneTransforms,
  VerticalOrigin,
  type Viewer,
} from 'cesium';
import { lonLatToCartesian } from '../frame';
import { globeAssetUrl, readValue, type GlobeLayer, type ValuesGrid } from '../layerManifest';
import { readToken } from '../markerImages';
import type { Site, SitesFile } from '../sites/types';
import { formatScore } from '../sites/format';
import { caveType, type CaveType } from './caveTypes';
import { formatKm } from './geo';
import { computeHotspots, formatHotspotValue, hotspotSpec, type HotspotSpec } from './hotspots';
import { annotationImages, type AnnotationImages } from './markers';
import type { Peak } from './peaks';
import { nearestRanked, topCandidates, type RankedCandidate } from './ranking';
import { placeLabels, thinPoints, type LabelBox, type Rect } from './screen';

export const CAVE_HOVER = 'unexplored, from orbit';
/** Cave type labels appear below this camera height. */
const CAVE_LABEL_HEIGHT_M = 1_500_000;
/** Screen cell for cave thinning: about one entry marker. */
const CAVE_CELL_PX = 14;
/**
 * Marks past the horizon are hidden. The horizon is tested against the Mars ellipsoid shrunk
 * below the deepest ground (Hellas, about 8 km under the datum), so it holds with the camera
 * low inside a basin.
 */
const HORIZON_ELLIPSOID = new Ellipsoid(
  Ellipsoid.MARS.radii.x - 10_000,
  Ellipsoid.MARS.radii.y - 10_000,
  Ellipsoid.MARS.radii.z - 10_000,
);
const LABEL_GAP_PX = 4;
/** Map label size, as --text-sm. */
const LABEL_PX = 13;
const LABEL_HEIGHT_PX = 18;
const ELEVATION_LAYER = 'elevation_m';

export interface HotspotSet {
  layer: GlobeLayer;
  spec: HotspotSpec;
  peaks: Peak[];
}

export interface AnnotationsSnapshot {
  caveCount: number;
  /** Highest values for each visible layer that has them, in manifest order. */
  hotspots: HotspotSet[];
}

export interface AnnotationsInput {
  layers: GlobeLayer[];
  states: Record<string, { enabled: boolean }>;
  caves: boolean;
}

export interface AnnotationsOptions {
  base: string;
  /** Shared value-grid loader (GlobeGlobalLayers.values). */
  values: (layerId: string) => Promise<ValuesGrid>;
  onChange: (snapshot: AnnotationsSnapshot) => void;
  /** Elements over the map (controls, panels) that labels keep clear of. */
  blockers: () => Element[];
}

interface CaveFeature {
  geometry: { coordinates: [number, number] };
  properties: { id: string; name?: string; type?: string };
}

interface Mark {
  entity: Entity;
  lon: number;
  lat: number;
  /** Half the marker width, for the label offset and the marker's own box. */
  half: number;
  label: string;
  priority: number;
  shown: boolean;
  labelShown: boolean;
}

interface CaveMark extends Mark {
  name: string;
  type: CaveType;
}

function setShow(mark: Mark, shown: boolean, labelShown: boolean): void {
  if (mark.shown !== shown) {
    mark.shown = shown;
    mark.entity.show = shown;
  }
  if (mark.labelShown !== labelShown && mark.entity.label) {
    mark.labelShown = labelShown;
    mark.entity.label.show = new ConstantProperty(labelShown);
  }
}

export class ExploreAnnotations {
  private readonly images: AnnotationImages;
  private readonly sources = {
    caves: new CustomDataSource('annotation-caves'),
    ranks: new CustomDataSource('annotation-ranks'),
    hotspots: new CustomDataSource('annotation-hotspots'),
  };
  private readonly font: string;
  private readonly measure = document.createElement('canvas').getContext('2d')!;
  private readonly widths = new Map<string, number>();
  private readonly labelFill: Color;
  private readonly labelHalo: Color;
  private readonly removePostRender: () => void;

  private caves: CaveMark[] = [];
  private readonly caveByEntity = new Map<Entity, CaveMark>();
  private ranked: RankedCandidate[] = [];
  private ranks: Mark[] = [];
  private hotspotMarks: Mark[] = [];
  private readonly peaks = new Map<string, Peak[]>();
  private elevation: ValuesGrid | null = null;
  private input: AnnotationsInput = { layers: [], states: {}, caves: false };
  private frameKey = '';
  private destroyed = false;

  constructor(
    private readonly viewer: Viewer,
    private readonly options: AnnotationsOptions,
  ) {
    this.images = annotationImages();
    // Labels rasterise at twice their size and draw at half scale, so they stay crisp.
    const family = readToken('--font-data') || 'sans-serif';
    this.font = `600 ${LABEL_PX * 2}px ${family}`;
    this.measure.font = `600 ${LABEL_PX}px ${family}`;
    this.labelFill = Color.fromCssColorString(readToken('--map-label-text'));
    this.labelHalo = Color.fromCssColorString(readToken('--map-label-halo'));
    this.sources.caves.show = false;
    // Caves under the ranked sites, the highest values above both.
    for (const source of [this.sources.caves, this.sources.ranks, this.sources.hotspots]) void viewer.dataSources.add(source);
    this.removePostRender = viewer.scene.postRender.addEventListener(() => this.frame());
    this.load();
  }

  update(input: AnnotationsInput): void {
    this.input = input;
    this.sources.caves.show = input.caves;
    if (input.layers.some((l) => l.id === ELEVATION_LAYER) && !this.elevation) {
      this.options
        .values(ELEVATION_LAYER)
        .then((grid) => {
          this.elevation = grid;
          this.redraw();
        })
        .catch(() => undefined);
    }
    for (const layer of this.visibleHotspotLayers()) {
      if (this.peaks.has(layer.id)) continue;
      const spec = hotspotSpec(layer)!;
      this.peaks.set(layer.id, []);
      this.options
        .values(layer.id)
        .then((grid) => {
          this.peaks.set(layer.id, computeHotspots(spec, grid));
          this.rebuildHotspots();
        })
        .catch(() => this.peaks.delete(layer.id));
    }
    this.rebuildHotspots();
  }

  /** Hover lines for a picked cave, or null when the pick is not one. */
  hover(picked: unknown): string[] | null {
    const id = (picked as { id?: unknown } | undefined)?.id;
    const cave = id instanceof Entity ? this.caveByEntity.get(id) : undefined;
    if (!cave) return null;
    const lines = [`${cave.type.label} · ${cave.name}`, CAVE_HOVER];
    const near = nearestRanked(this.ranked, cave.lon, cave.lat);
    if (near) lines.push(`${formatKm(near.km)} to rank ${near.ranked.rank}, ${near.ranked.site.name}`);
    return lines;
  }

  /** Fly to a point from high enough to see its surroundings. */
  focus(lon: number, lat: number): void {
    this.viewer.camera.flyTo({ destination: lonLatToCartesian(lon, lat, 2_500_000) });
  }

  destroy(): void {
    this.destroyed = true;
    this.removePostRender();
    if (!this.viewer.isDestroyed()) {
      for (const source of Object.values(this.sources)) this.viewer.dataSources.remove(source, true);
    }
  }

  private load(): void {
    fetch(globeAssetUrl(this.options.base, 'caves.geojson'))
      .then((r) => (r.ok ? (r.json() as Promise<{ features: CaveFeature[] }>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (this.destroyed) return;
        this.buildCaves(data.features);
        this.emit();
      })
      .catch((error) => console.warn('Cave candidates did not load', error));
    fetch(globeAssetUrl(this.options.base, 'sites.json'))
      .then((r) => (r.ok ? (r.json() as Promise<SitesFile>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((file) => {
        if (this.destroyed) return;
        this.buildRanks(file.sites);
      })
      .catch((error) => console.warn('Ranked sites did not load', error));
  }

  private label(text: string, half: number): Entity.ConstructorOptions['label'] {
    return {
      text,
      font: this.font,
      fillColor: this.labelFill,
      outlineColor: this.labelHalo,
      outlineWidth: 5,
      scale: 0.5,
      style: LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: HorizontalOrigin.LEFT,
      verticalOrigin: VerticalOrigin.CENTER,
      pixelOffset: new Cartesian2(half + LABEL_GAP_PX, 0),
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      show: false,
    };
  }

  private buildCaves(features: CaveFeature[]): void {
    for (const f of features) {
      const [lon, lat] = f.geometry.coordinates;
      const type = caveType(f.properties.type ?? '');
      const image = this.images.cave(type.entry);
      const entity = this.sources.caves.entities.add({
        id: `cave:${f.properties.id}`,
        position: lonLatToCartesian(lon, lat, 0),
        billboard: {
          image: image.image,
          width: image.width,
          height: image.height,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: this.label(type.label, image.width / 2),
      });
      const mark: CaveMark = {
        entity,
        lon,
        lat,
        half: image.width / 2,
        label: type.label,
        priority: type.entry ? 1 : 0,
        shown: true,
        labelShown: false,
        name: f.properties.name ?? f.properties.id,
        type,
      };
      this.caves.push(mark);
      this.caveByEntity.set(entity, mark);
    }
    this.redraw();
  }

  private buildRanks(sites: Site[]): void {
    this.ranked = topCandidates(sites);
    this.ranks = this.ranked.map(({ rank, site }) => {
      const image = this.images.rank(rank, site.score);
      const text = `${site.name} · ${formatScore(site.score)}`;
      // The site-finder resolves hover and click by a "site:" id, so the rank disc answers as its site.
      const entity = this.sources.ranks.entities.add({
        id: `site:${site.id}`,
        name: site.name,
        position: lonLatToCartesian(site.lon, site.lat, 0),
        billboard: {
          image: image.image,
          width: image.width,
          height: image.height,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: this.label(text, image.width / 2),
      });
      return { entity, lon: site.lon, lat: site.lat, half: image.width / 2, label: text, priority: 30 - rank, shown: true, labelShown: false };
    });
    this.redraw();
  }

  private visibleHotspotLayers(): GlobeLayer[] {
    return this.input.layers.filter((l) => this.input.states[l.id]?.enabled && hotspotSpec(l));
  }

  private rebuildHotspots(): void {
    this.sources.hotspots.entities.removeAll();
    this.hotspotMarks = [];
    for (const layer of this.visibleHotspotLayers()) {
      const spec = hotspotSpec(layer)!;
      (this.peaks.get(layer.id) ?? []).forEach((peak, i) => {
        const image = this.images.hotspot(i + 1);
        const text = `${spec.label} ${formatHotspotValue(spec, peak.value)}`;
        const entity = this.sources.hotspots.entities.add({
          position: lonLatToCartesian(peak.lon, peak.lat, 0),
          billboard: {
            image: image.image,
            width: image.width,
            height: image.height,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: this.label(text, image.width / 2),
        });
        this.hotspotMarks.push({ entity, lon: peak.lon, lat: peak.lat, half: image.width / 2, label: text, priority: 20 - i, shown: true, labelShown: false });
      });
    }
    this.emit();
    this.redraw();
  }

  private emit(): void {
    this.options.onChange({
      caveCount: this.caves.length,
      hotspots: this.visibleHotspotLayers().flatMap((layer) => {
        const peaks = this.peaks.get(layer.id);
        return peaks?.length ? [{ layer, spec: hotspotSpec(layer)!, peaks }] : [];
      }),
    });
  }

  private redraw(): void {
    this.frameKey = '';
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  private textWidth(text: string): number {
    let w = this.widths.get(text);
    if (w === undefined) {
      w = this.measure.measureText(text).width;
      this.widths.set(text, w);
    }
    return w;
  }

  /** Screen visibility of marks and labels, recomputed only when the view changes. */
  private frame(): void {
    const { scene, camera } = this.viewer;
    const width = scene.canvas.clientWidth;
    const height = scene.canvas.clientHeight;
    const key = `${camera.viewMatrix.toString()}|${width}|${height}|${this.input.caves}`;
    if (key === this.frameKey) return;
    this.frameKey = key;

    const cameraHeight = camera.positionCartographic.height;
    const occluder = new EllipsoidalOccluder(HORIZON_ELLIPSOID, camera.positionWC);
    const toPoint = new Cartesian3();
    // Offline the planet is the plain ellipsoid globe; online it is the Cesium Mars tileset,
    // whose ground the whole-planet elevation grid approximates.
    const offline = !!scene.globe?.show;
    const project = (lon: number, lat: number): Cartesian2 | null => {
      const ground = !offline && this.elevation ? readValue(this.elevation, lon, lat) ?? 0 : 0;
      const world = lonLatToCartesian(lon, lat, ground);
      if (!occluder.isPointVisible(world)) return null;
      if (Cartesian3.dot(Cartesian3.subtract(world, camera.positionWC, toPoint), camera.directionWC) <= 0) return null;
      const p = SceneTransforms.worldToWindowCoordinates(scene, world);
      return p && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height ? p : null;
    };

    // Everything beyond the canvas edges counts as blocked, so no label is cut off.
    const far = 1e6;
    const blocked: Rect[] = [
      ...this.panelRects(),
      [width, -far, far, far],
      [-far, height, far, far],
      [-far, -far, 0, far],
      [-far, -far, far, 0],
    ];
    const labels: { mark: Mark; box: LabelBox }[] = [];
    const place = (mark: Mark, p: Cartesian2) => {
      const left = p.x + mark.half + LABEL_GAP_PX;
      labels.push({
        mark,
        // A gap's width of clear space after the text keeps neighbouring labels apart.
        box: {
          rect: [left, p.y - LABEL_HEIGHT_PX / 2, left + this.textWidth(mark.label) + LABEL_GAP_PX, p.y + LABEL_HEIGHT_PX / 2],
          priority: mark.priority,
        },
      });
    };

    // Ranked sites and highest values never overlap each other: the better one stays.
    const marks = [...this.ranks, ...this.hotspotMarks];
    const markRect = (mark: Mark, p: Cartesian2): Rect => [p.x - mark.half, p.y - mark.half, p.x + mark.half, p.y + mark.half];
    const onScreenMarks = marks.flatMap((mark) => {
      const p = project(mark.lon, mark.lat);
      return p ? [{ mark, p }] : [];
    });
    const keptMarks = new Set(placeLabels(onScreenMarks.map(({ mark, p }) => ({ rect: markRect(mark, p), priority: mark.priority }))));
    const shownMarks = new Set<Mark>();
    onScreenMarks.forEach(({ mark, p }, i) => {
      if (!keptMarks.has(i)) return;
      shownMarks.add(mark);
      blocked.push(markRect(mark, p));
      place(mark, p);
    });

    const caveLabels = this.input.caves && cameraHeight < CAVE_LABEL_HEIGHT_M;
    if (this.input.caves) {
      const onScreen: { mark: CaveMark; p: Cartesian2 }[] = [];
      for (const mark of this.caves) {
        const p = project(mark.lon, mark.lat);
        if (p) onScreen.push({ mark, p });
        else setShow(mark, false, false);
      }
      const kept = new Set(
        thinPoints(
          onScreen.map(({ mark, p }) => ({ x: p.x, y: p.y, priority: mark.priority })),
          CAVE_CELL_PX,
        ),
      );
      onScreen.forEach(({ mark, p }, i) => {
        setShow(mark, kept.has(i), false);
        if (!kept.has(i)) return;
        // Labels never cover a drawn triangle.
        blocked.push(markRect(mark, p));
        if (caveLabels) place(mark, p);
      });
    }

    const placed = new Set(placeLabels(labels.map((l) => l.box), blocked));
    labels.forEach(({ mark }, i) => setShow(mark, true, placed.has(i)));
    for (const mark of marks) if (!shownMarks.has(mark)) setShow(mark, false, false);
    scene.requestRender();
  }

  /** Elements drawn over the map and the map credits, in canvas pixels, so labels stay clear of them. */
  private panelRects(): Rect[] {
    const canvas = this.viewer.scene.canvas.getBoundingClientRect();
    const credits = this.viewer.container.querySelector('.cesium-widget-credits');
    return [...this.options.blockers(), ...(credits ? [credits] : [])].map((el) => {
      const r = el.getBoundingClientRect();
      return [r.left - canvas.left, r.top - canvas.top, r.right - canvas.left, r.bottom - canvas.top];
    });
  }
}
