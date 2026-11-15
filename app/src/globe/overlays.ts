// Written with AI assistance, directed and reviewed by the team.
// Plan, rover, chemistry and walker overlays on the globe as entities.
// Route geometry comes from lib/routeShape.ts in the local-metre frame: shared ground is drawn
// once with chevrons for each direction walked, forks are diamonds with branch labels, and
// hovering highlights the whole route or the section under the cursor.
import {
  ArcType,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  ClassificationType,
  Color,
  Cartesian4,
  ColorMaterialProperty,
  DistanceDisplayCondition,
  Ellipsoid,
  Entity,
  EntityCollection,
  HeightReference,
  HorizontalOrigin,
  JulianDate,
  LabelStyle,
  Math as CesiumMath,
  Scene,
  PolylineDashMaterialProperty,
  Matrix4,
  Transforms,
  VerticalOrigin,
} from 'cesium';
import type { ChemistryPositionGroup } from '../lib/chemistry';
import { lonlatToLocalMetres, type GridOrigin, type RouteGrid } from '../lib/grid';
import type { Plan } from '../lib/plan';
import {
  forkPoints,
  sections as routeSections,
  sharedSegments,
  slopeStats,
  type Section,
  type SharedSegment,
  type SlopeStats,
} from '../lib/routeShape';
import { lonLatToCartesian, type Pose } from './frame';
import { cullScreenLabels, type Box } from './graticule';
import { circleRing, crewLabel, labelOnLeft, type CrewMarkerModel } from '../safety/crewMarkers';
import { crewRingImage } from '../safety/crewMarkerImage';
import { canvasMarkerImages, readToken, type MarkerImage, type MarkerImages, type TokenReader } from './markerImages';
import {
  bearingDeg,
  branchAnchor,
  branchLabel,
  branchLabelSides,
  chevronsFor,
  distanceAlong,
  formatLatLon,
  gradeRuns,
  hoverMode,
  needsFinish,
  routeLabel,
  routeLine,
  sectionForLegs,
  sectionLabel,
  slopeLabels,
  screenSpan,
  showSummaryLabels,
  stretchStyles,
  waypointLabel,
  type RouteHover,
  type StretchStyle,
} from './routeLook';

export interface OverlayHost {
  entities: EntityCollection;
}

export interface RoverOverlayState {
  traverse: boolean;
  photos: boolean;
}

export interface PhotoSite {
  lon: number;
  lat: number;
  count: number;
  solMin: number;
  solMax: number;
}

/** Groups photos taken at one position into one site with a count and sol range. */
export function photoSites(photos: { lon: number; lat: number; sol: number }[]): PhotoSite[] {
  const sites = new Map<string, PhotoSite>();
  for (const photo of photos) {
    const key = `${photo.lon.toFixed(6)},${photo.lat.toFixed(6)}`;
    const site = sites.get(key);
    if (site) {
      site.count++;
      site.solMin = Math.min(site.solMin, photo.sol);
      site.solMax = Math.max(site.solMax, photo.sol);
    } else {
      sites.set(key, { lon: photo.lon, lat: photo.lat, count: 1, solMin: photo.sol, solMax: photo.sol });
    }
  }
  return [...sites.values()];
}

export function photoSiteLabel(site: PhotoSite): string {
  const photos = `${site.count} ${site.count === 1 ? 'photo' : 'photos'}`;
  const sols = site.solMin === site.solMax ? `sol ${site.solMin}` : `sol ${site.solMin}–${site.solMax}`;
  return `${photos} · ${sols}`;
}

/** Cesium surface height at a point, using the bundle DEM plus its measured datum offset. */
export function surfaceHeightM(grid: RouteGrid | null, lon: number, lat: number, heightOffsetM: number): number {
  if (!grid) return heightOffsetM;
  const { row, col } = grid.lonlatToRowCol(lon, lat);
  const elevationM = grid.getElevation(row, col);
  return heightOffsetM + (Number.isFinite(elevationM) ? elevationM : 0);
}

export interface OverlayOptions {
  token?: TokenReader;
  images?: MarkerImages;
  /** CESIUM_3D_TILE on Cesium Mars; TERRAIN on the bare-ellipsoid fallback. */
  classification?: ClassificationType;
  onSectionHover?: (sectionId: string | null) => void;
  scene?: Scene;
  /** A separate collection (a data source added after the others) for the crew and rover, so they draw on top. */
  crewHost?: OverlayHost;
  /** The astronaut mark; drawn from tokens on a canvas unless a stub is given (tests). */
  crewImage?: () => MarkerImage;
}

/** Forks closer than this are one fork on screen. */
const FORK_MERGE_M = 15;
/** A split that rejoins within this distance is a planner wobble, not a fork worth marking. */
const FORK_BUBBLE_M = 60;
/** Branch labels sit this far along each branch from the fork. */
const BRANCH_LABEL_M = 45;
/** Gap between a branch and its label, in pixels. */
const BRANCH_LABEL_GAP_PX = 10;

/** Camera distances (metres) beyond which small route marks are hidden. */
const NEAR = new DistanceDisplayCondition(0, 15_000);
const SITE = new DistanceDisplayCondition(0, 60_000);
const REGION = new DistanceDisplayCondition(0, 1_500_000);
/** Crew circles and the night corridor sit this far above the surface, metres. */
const CREW_LIFT_M = 0.5;

/** A marker that can open the 360° surface view: a waypoint or a rover mark, with its title. */
export interface SurfaceTarget {
  title: string;
  lon: number;
  lat: number;
}

type Meta =
  | { kind: 'route'; stretch: number }
  | { kind: 'text'; lines: string[]; target?: () => SurfaceTarget | undefined };

interface Stretch extends SharedSegment {
  shared: boolean;
}

export class GlobeOverlays {
  private readonly entities: EntityCollection;
  private readonly crewEntities: EntityCollection;
  private readonly crewImage: () => MarkerImage;
  private crewImageCache: MarkerImage | null = null;
  private crewModel: CrewMarkerModel | null = null;
  private crewKey = '';
  private readonly token: TokenReader;
  private images: MarkerImages | null;
  private readonly classification: ClassificationType;
  private readonly onSectionHover?: (sectionId: string | null) => void;
  private readonly scene?: Scene;
  /** Where to request a frame after a change Cesium does not see (callback-driven marks). */
  private readonly renderScene?: Scene;
  private readonly hiddenLabels = new Set<Entity>();
  private readonly removeScreenUpdate?: () => void;
  private readonly meta = new Map<Entity, Meta>();
  private readonly owned = new Set<Entity>();
  private readonly groups: Record<'plan' | 'rover' | 'chemistry' | 'walker' | 'crew', Entity[]> = {
    plan: [],
    rover: [],
    chemistry: [],
    walker: [],
    crew: [],
  };

  private plan: Plan | undefined;
  private origin: GridOrigin | null = null;
  private grid: RouteGrid | null = null;
  private stretches: Stretch[] = [];
  /** Dashed core lines by stretch, hidden while their stretch is dimmed. */
  private cores: Entity[][] = [];
  private sectionList: Section[] = [];
  private stats: SlopeStats | null = null;
  private gradient = false;
  private styles: StretchStyle[] = [];
  private hoveredSection: string | null = null;
  private routeHoverLines: string[] = [];
  private heightOffsetM = 0;
  private useSurfaceHeights = false;
  private roverData: { traverse: GeoJSON.LineString | null; sites: PhotoSite[]; state: RoverOverlayState } | null = null;

  constructor(host: OverlayHost, options: OverlayOptions = {}) {
    this.entities = host.entities;
    this.crewEntities = options.crewHost?.entities ?? host.entities;
    this.crewImage = options.crewImage ?? (() => (this.crewImageCache ??= crewRingImage(this.token)));
    this.token = options.token ?? readToken;
    this.images = options.images ?? null;
    this.classification = options.classification ?? ClassificationType.CESIUM_3D_TILE;
    this.onSectionHover = options.onSectionHover;
    this.scene = options.scene;
    this.renderScene = options.scene ?? (host as { scene?: Scene }).scene;
    this.removeScreenUpdate = this.scene?.preRender.addEventListener((_scene, time) => this.updateScreenLabels(time));
  }

  private markers(): MarkerImages {
    this.images ??= canvasMarkerImages(this.token);
    return this.images;
  }

  private colour(name: string): Color {
    return Color.fromCssColorString(this.token(name) || '#ffffff');
  }

  private surfacePosition(lon: number, lat: number): Cartesian3 {
    const height = this.useSurfaceHeights ? surfaceHeightM(this.grid, lon, lat, this.heightOffsetM) : 0;
    return lonLatToCartesian(lon, lat, height);
  }

  /** Use grid elevations on Cesium Mars where the ellipsoid is deliberately disabled. */
  setHeightOffsetM(heightOffsetM: number): void {
    this.heightOffsetM = heightOffsetM;
    this.useSurfaceHeights = true;
  }

  /** Crew marks go to their own collection when one is given, so they draw above the plan. */
  private collection(group: keyof GlobeOverlays['groups']): EntityCollection {
    return group === 'crew' ? this.crewEntities : this.entities;
  }

  private add(group: keyof GlobeOverlays['groups'], options: Entity.ConstructorOptions, meta?: Meta): Entity {
    const entity = this.collection(group).add(options);
    this.groups[group].push(entity);
    this.owned.add(entity);
    if (meta) this.meta.set(entity, meta);
    if (entity.label) entity.label.show = new CallbackProperty(() => !this.hiddenLabels.has(entity), false);
    return entity;
  }

  private removeGroup(group: keyof GlobeOverlays['groups']): void {
    for (const entity of this.groups[group]) {
      this.collection(group).remove(entity);
      this.meta.delete(entity);
      this.owned.delete(entity);
      this.hiddenLabels.delete(entity);
    }
    this.groups[group] = [];
  }

  private updateScreenLabels(time: JulianDate): void {
    const scene = this.scene;
    if (!scene || !this.plan) return;
    const project = (entity: Entity) => {
      const position = entity.position?.getValue(time);
      return position ? scene.cartesianToCanvasCoordinates(position) : undefined;
    };
    const markers = this.groups.plan.filter((entity) => entity.billboard && this.markerPriority(entity) !== null);
    const markerData: { entity: Entity; point: Cartesian2; width: number; height: number; priority: number }[] = [];
    for (const marker of markers) {
      const point = project(marker);
      if (!point) continue;
      const width = marker.billboard?.width?.getValue(time) ?? 20;
      const height = marker.billboard?.height?.getValue(time) ?? 20;
      markerData.push({ entity: marker, point, width, height, priority: this.markerPriority(marker)! });
    }
    const markerBoxes: Box[] = markerData.map(({ point, width, height }) => [
      point.x - width / 2, point.y - height / 2, point.x + width / 2, point.y + height / 2,
    ]);

    const routePoints = routeLine(this.plan).flatMap(([lon, lat]) => {
      const point = scene.cartesianToCanvasCoordinates(this.surfacePosition(lon, lat));
      return point ? [{ x: point.x, y: point.y }] : [];
    });
    const summariesVisible = showSummaryLabels(screenSpan(routePoints));
    const candidates: { id: string; box: Box; priority: number }[] = [];
    const entities: Entity[] = [];
    const hiddenBefore = new Set(this.hiddenLabels);
    this.hiddenLabels.clear();
    for (const entity of this.groups.plan) {
      if (!entity.label) continue;
      this.hiddenLabels.add(entity);
      const priority = this.labelPriority(entity);
      if (priority === null || (priority === 3 && !summariesVisible)) continue;
      const point = project(entity);
      const text = entity.label.text?.getValue(time) ?? '';
      if (!point || !text) continue;
      const font = entity.label.font?.getValue(time) ?? '13px sans-serif';
      const fontSize = Number(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 13);
      const width = [...text].reduce((sum, char) => sum + fontSize * (char === ' ' ? 0.28 : 0.54), 0) + 4;
      const height = fontSize + 4;
      const offset = entity.label.pixelOffset?.getValue(time) ?? Cartesian2.ZERO;
      const horizontal = entity.label.horizontalOrigin?.getValue(time) ?? HorizontalOrigin.CENTER;
      const vertical = entity.label.verticalOrigin?.getValue(time) ?? VerticalOrigin.CENTER;
      const x = point.x + offset.x;
      const y = point.y + offset.y;
      const left = horizontal === HorizontalOrigin.RIGHT ? x - width : horizontal === HorizontalOrigin.CENTER ? x - width / 2 : x;
      const top = vertical === VerticalOrigin.BOTTOM ? y - height : vertical === VerticalOrigin.CENTER ? y - height / 2 : y;
      candidates.push({ id: entity.id, box: [left, top, left + width, top + height], priority });
      entities.push(entity);
    }
    const visibleIds = new Set(cullScreenLabels(candidates, markerBoxes));
    for (const entity of entities) if (visibleIds.has(entity.id)) this.hiddenLabels.delete(entity);
    // Label show reads hiddenLabels through a callback on the next frame: draw one more.
    if (hiddenBefore.size !== this.hiddenLabels.size || [...hiddenBefore].some((e) => !this.hiddenLabels.has(e))) {
      scene.requestRender();
    }
  }

  private markerPriority(entity: Entity): number | null {
    const lines = this.meta.get(entity);
    if (lines?.kind !== 'text') return null;
    if (lines.lines[0].startsWith('Stop ')) return 0;
    if (lines.lines[0] === 'Rover drop-off') return 1;
    if (lines.lines[0] === 'Fork') return 2;
    return null;
  }

  private labelPriority(entity: Entity): number | null {
    const lines = this.meta.get(entity);
    if (lines?.kind !== 'text') return null;
    if (lines.lines[0] === 'Rover drop-off') return 1;
    if (lines.lines[0] === 'Fork' || lines.lines[0].startsWith('to Stop ') || lines.lines[0] === 'back to drop-off') return 2;
    if (/^(High|Low|Steepest)\b/.test(lines.lines[0])) return 3;
    return null;
  }

  /** Bundle elevation grid for slopes; without it the gradient view and slope markers stay off. */
  setGrid(grid: RouteGrid | null): void {
    if (this.grid === grid) return;
    this.grid = grid;
    if (this.roverData) this.drawRover();
    this.setPlan(this.plan, this.origin ?? undefined);
  }

  /** Colours the route by gradient and shows the high, low and steepest points. */
  setGradient(on: boolean): void {
    if (this.gradient === on) return;
    this.gradient = on;
    this.setPlan(this.plan, this.origin ?? undefined);
  }

  /** Whether slopes can be shown: every route vertex has a bundle elevation. */
  get slopesAvailable(): boolean {
    return this.stats !== null;
  }

  /**
   * Draws a plan. Distances use the local-metre frame at origin (the site's), or at the
   * drop-off when no origin is given.
   */
  setPlan(plan: Plan | undefined, origin?: GridOrigin): void {
    this.removeGroup('plan');
    this.plan = plan;
    this.stretches = [];
    this.cores = [];
    this.sectionList = [];
    this.stats = null;
    this.routeHoverLines = [];
    if (!plan) return;
    const frame = origin ?? { lon0: plan.start.lon, lat0: plan.start.lat, lat_c: plan.start.lat };
    this.origin = origin ?? null;

    if (!plan.route.legs.length) {
      this.drawStops(plan);
      return;
    }

    const legs = plan.route.legs;
    this.stretches = sharedSegments(legs, frame).map((s) => ({ ...s, shared: s.legs.length > 1 }));
    this.sectionList = routeSections(plan, frame);
    this.styles = this.stretches.map(() => 'normal');
    this.cores = this.stretches.map(() => []);
    this.stats = this.routeStats(plan);

    this.drawStretches(frame);
    this.drawForks(plan, frame);
    this.drawStops(plan);
    if (this.gradient && this.stats) this.drawSlopeMarkers(plan, frame, this.stats);
  }

  private routeStats(plan: Plan): SlopeStats | null {
    const grid = this.grid;
    if (!grid) return null;
    const line = routeLine(plan);
    const inside = line.every(([lon, lat]) => {
      const { row, col } = grid.lonlatToRowCol(lon, lat);
      return grid.isInside(row, col) && Number.isFinite(grid.getElevation(row, col));
    });
    return inside ? slopeStats(line, grid) : null;
  }

  private drawStretches(frame: GridOrigin): void {
    const casing = this.colour('--map-route-casing');
    const dash = this.colour('--map-route-dash');
    const dimAlpha = parseFloat(this.token('--map-route-dim-opacity')) || 0.35;
    const coreWidth = parseFloat(this.token('--map-route-core-width')) || 4;
    const casingWidth = parseFloat(this.token('--map-route-casing-width')) || 8;
    const grades = [1, 2, 3, 4, 5].map((n) => this.colour(`--map-grade-${n}`));
    const highlight = this.colour('--map-route-highlight');

    this.stretches.forEach((stretch, index) => {
      const base = this.colour(stretch.shared ? '--map-route-shared' : '--map-route-core');
      const meta: Meta = { kind: 'route', stretch: index };
      const styleColour = (colour: Color, highlighted: Color) =>
        new ColorMaterialProperty(
          new CallbackProperty(() => {
            const style = this.styles[index];
            if (style === 'dim') return colour.withAlpha(dimAlpha);
            return style === 'highlight' ? highlighted : colour;
          }, false),
        );
      // Put the A3 route above rover traverses, then order casing, body, and dashed core.
      const polyline = (
        line: [number, number][],
        width: number,
        zIndex: number,
        material: Entity.ConstructorOptions['polyline'],
      ) => ({
        polyline: {
          positions: line.map(([lon, lat]) => this.surfacePosition(lon, lat)),
          width,
          zIndex,
          clampToGround: true,
          arcType: ArcType.GEODESIC,
          classificationType: this.classification,
          ...material,
        },
      });

      this.add('plan', polyline(stretch.line, casingWidth + 2, 400, { material: styleColour(casing, casing) }), meta);
      const grade = this.gradient && this.stats ? this.stretchGrades(stretch) : null;
      if (grade) {
        for (const run of grade) {
          const c = grades[run.bin - 1];
          this.add('plan', polyline(run.line, coreWidth + 2, 410, { material: styleColour(c, c) }), meta);
        }
      } else {
        this.add('plan', polyline(stretch.line, coreWidth + 2, 410, { material: styleColour(base, highlight) }), meta);
        this.cores[index].push(
          this.add(
            'plan',
            polyline(stretch.line, 2, 420, {
              material: new PolylineDashMaterialProperty({ color: dash, gapColor: Color.TRANSPARENT, dashLength: 12 }),
            }),
            meta,
          ),
        );
      }

      for (const c of chevronsFor(stretch.line, stretch.directions, frame)) {
        const position = this.surfacePosition(c.lon, c.lat);
        this.add(
          'plan',
          {
            position,
            billboard: {
              ...this.billboard(this.markers().chevron()),
              rotation: -CesiumMath.toRadians(c.bearingDeg),
              alignedAxis: northAt(position),
            },
          },
          meta,
        );
      }
    });
  }

  private stretchGrades(stretch: Stretch) {
    if (!this.grid) return null;
    const { gradientDeg } = slopeStats(stretch.line, this.grid);
    return gradientDeg.every(Number.isFinite) ? gradeRuns(stretch.line, gradientDeg) : null;
  }

  private billboard(image: MarkerImage, show?: DistanceDisplayCondition): Entity.ConstructorOptions['billboard'] {
    return {
      image: image.image,
      width: image.width,
      height: image.height,
      heightReference: this.useSurfaceHeights ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      ...(show ? { distanceDisplayCondition: show } : {}),
    };
  }

  private label(
    text: string,
    show: DistanceDisplayCondition,
    offset: [number, number],
    left = false,
    vertical: VerticalOrigin = VerticalOrigin.CENTER,
  ) {
    return {
      text,
      font: `600 13px ${this.token('--font-data') || 'sans-serif'}`,
      fillColor: this.colour('--map-label-text'),
      outlineColor: this.colour('--map-label-halo'),
      outlineWidth: 3,
      style: LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: left ? HorizontalOrigin.RIGHT : HorizontalOrigin.LEFT,
      verticalOrigin: vertical,
      pixelOffset: new Cartesian2(offset[0], offset[1]),
      heightReference: this.useSurfaceHeights ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      distanceDisplayCondition: show,
    };
  }

  private drawForks(plan: Plan, frame: GridOrigin): void {
    const forks = dropBubbles(mergeForks(forkPoints(plan.route.legs, frame), frame), frame);
    for (const fork of forks) {
      const lines = fork.branches.map((b) => branchLabel(b.toLabel, plan));
      this.add(
        'plan',
        { position: this.surfacePosition(fork.lon, fork.lat), billboard: this.billboard(this.markers().fork()) },
        { kind: 'text', lines: ['Fork', ...lines] },
      );
      const at: [number, number] = [fork.lon, fork.lat];
      const anchors = fork.branches.map((b) => branchAnchor(plan.route.legs[b.legIndex].line, at, BRANCH_LABEL_M, frame));
      const sides = branchLabelSides(anchors.map((anchor) => bearingDeg(at, anchor, frame)));
      anchors.forEach(([lon, lat], i) => {
        const side = CesiumMath.toRadians(sides[i]);
        const dx = Math.sin(side) * BRANCH_LABEL_GAP_PX;
        const dy = -Math.cos(side) * BRANCH_LABEL_GAP_PX;
        this.add('plan', {
          position: this.surfacePosition(lon, lat),
          label: this.label(lines[i], NEAR, [dx, dy], dx < 0),
        }, { kind: 'text', lines: [lines[i]] });
      });
    }
  }

  private drawStops(plan: Plan): void {
    const images = this.markers();
    const start = plan.start;
    this.add(
      'plan',
      {
        position: this.surfacePosition(start.lon, start.lat),
        billboard: this.billboard(images.dropOff(), REGION),
        label: this.label('Rover drop-off', SITE, [-20, 0], true),
      },
      { kind: 'text', lines: ['Rover drop-off', formatLatLon(start.lon, start.lat)], target: () => ({ title: 'Rover drop-off', lon: start.lon, lat: start.lat }) },
    );
    plan.stops.forEach((stop) => {
      const number = waypointLabel(stop.id, plan);
      this.add(
        'plan',
        {
          position: this.surfacePosition(stop.lon, stop.lat),
          billboard: this.billboard(images.stop(number, false), REGION),
        },
        {
          kind: 'text',
          lines: [`Stop ${number} · ${stop.name}`, formatLatLon(stop.lon, stop.lat)],
          target: () => ({ title: `Stop ${number} · ${stop.name}`, lon: stop.lon, lat: stop.lat }),
        },
      );
    });
    if (needsFinish(plan) && plan.route.legs.at(-1)?.line.length) {
      const end = plan.route.legs.at(-1)!.line.at(-1)!;
      this.add(
        'plan',
        { position: this.surfacePosition(end[0], end[1]), billboard: this.billboard(images.finish(), REGION) },
        { kind: 'text', lines: ['Finish', formatLatLon(end[0], end[1])], target: () => ({ title: 'Finish', lon: end[0], lat: end[1] }) },
      );
    }
  }

  private drawSlopeMarkers(plan: Plan, frame: GridOrigin, stats: SlopeStats): void {
    const images = this.markers();
    const labels = slopeLabels(
      stats,
      stats.steepestAt ? distanceAlong(routeLine(plan), stats.steepestAt, frame) : 0,
    );
    const marks: [number, number, MarkerImage, string][] = [];
    // A flat or zero-length route has its high and low on one vertex: two labels on one spot, so neither.
    const samePoint = !!stats.highAt && !!stats.lowAt && stats.highAt[0] === stats.lowAt[0] && stats.highAt[1] === stats.lowAt[1];
    if (!samePoint && stats.highAt && labels.high) marks.push([stats.highAt[0], stats.highAt[1], images.high(), labels.high]);
    if (!samePoint && stats.lowAt && labels.low) marks.push([stats.lowAt[0], stats.lowAt[1], images.low(), labels.low]);
    if (stats.steepestAt && labels.steepest) {
      marks.push([stats.steepestAt[0], stats.steepestAt[1], images.steepest(), labels.steepest]);
    }
    for (const [lon, lat, image, text] of marks) {
      this.add(
        'plan',
        {
          position: this.surfacePosition(lon, lat),
          billboard: this.billboard(image, SITE),
          // Above and right of the glyph, clear of the route line through it.
          label: this.label(text, SITE, [8, -8], false, VerticalOrigin.BOTTOM),
        },
        { kind: 'text', lines: [text, formatLatLon(lon, lat)] },
      );
    }
  }

  /** Rover traverse and photo sites. */
  setRover(traverse: GeoJSON.LineString | null, sites: PhotoSite[], state: RoverOverlayState): void {
    this.roverData = { traverse, sites, state };
    this.drawRover();
    // Keep the planned route above rover overlays in Cesium.
    this.setPlan(this.plan, this.origin ?? undefined);
  }

  private drawRover(): void {
    this.removeGroup('rover');
    const data = this.roverData;
    if (!data) return;
    const { traverse, sites, state } = data;
    if (traverse && state.traverse) {
      const positions = traverse.coordinates.map(([lon, lat]) => this.surfacePosition(lon, lat));
      for (const [name, width] of [['--map-label-halo', 3.5], ['--map-label-text', 1.5]] as const) {
        this.add('rover', {
          polyline: {
            positions,
            width,
            clampToGround: true,
            material: this.colour(name),
            classificationType: this.classification,
          },
        });
      }
    }
    if (state.photos) {
      for (const site of sites) {
        this.add(
          'rover',
          {
            position: this.surfacePosition(site.lon, site.lat),
            billboard: { ...this.billboard(this.markers().photo(site.count), SITE), scale: 1.5 },
          },
          { kind: 'text', lines: [photoSiteLabel(site)], target: () => ({ title: `Rover photos · ${photoSiteLabel(site)}`, lon: site.lon, lat: site.lat }) },
        );
      }
    }
  }

  setChemistry(groups: ChemistryPositionGroup[], visible: boolean): void {
    this.removeGroup('chemistry');
    if (!visible) return;
    const fill = this.colour('--ramp-seq-4');
    const ring = this.colour('--map-label-halo');
    for (const group of groups) {
      const targets = [...new Set(group.measurements.map((m) => m.target))];
      const sols = group.measurements.map((m) => m.sol);
      const solText =
        Math.min(...sols) === Math.max(...sols) ? `sol ${sols[0]}` : `sol ${Math.min(...sols)}–${Math.max(...sols)}`;
      this.add(
        'chemistry',
        {
          position: lonLatToCartesian(group.lon, group.lat, 0),
          point: {
            pixelSize: 6,
            color: fill,
            outlineColor: ring,
            outlineWidth: 1,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: SITE,
          },
        },
        { kind: 'text', lines: [targets.join(', '), `${group.measurements.length} measurements · ${solText}`] },
      );
    }
  }

  setWalker(pose: Pose | null): void {
    this.removeGroup('walker');
    if (!pose) return;
    this.add('walker', {
      position: lonLatToCartesian(pose.lon, pose.lat, 0),
      billboard: this.billboard(this.markers().walker(), REGION),
    });
  }

  /**
   * Both astronauts with their position uncertainty circles, the pressurised rover with
   * its arrival time, and the night way back as a corridor (Mars mode and Walk). Null
   * clears them.
   */
  setCrew(model: CrewMarkerModel | null): void {
    this.crewModel = model;
    // Positions follow the model through callbacks, which Cesium does not watch.
    if (this.renderScene && !this.renderScene.isDestroyed()) this.renderScene.requestRender();
    // Positions, radii and labels follow the latest model through callbacks; the entities are
    // rebuilt only when the set of marks changes, so the circle geometry is not rebuilt every tick.
    const key = model
      ? `${model.crew.map((c) => c.id).join(',')}|${model.rover ? 1 : 0}|${model.returnLine && model.returnLine.length > 1 ? 1 : 0}`
      : '';
    if (key === this.crewKey) return;
    this.crewKey = key;
    this.removeGroup('crew');
    if (!model) return;
    const ring = this.colour('--map-position-ring');
    const live = <T,>(read: (m: CrewMarkerModel) => T, fallback: T) =>
      new CallbackProperty(() => (this.crewModel ? read(this.crewModel) : fallback), false);
    // Lines and circles sit just above the surface rather than clamped, so they also draw on the
    // bare ellipsoid; the depth-fail material keeps them visible behind terrain.
    const lifted = (p: { lon: number; lat: number }) =>
      lonLatToCartesian(p.lon, p.lat, this.surfaceHeight(p.lon, p.lat) + CREW_LIFT_M);
    const line = (positions: CallbackProperty, width: number, colour: Color) =>
      this.add('crew', {
        polyline: { positions, width, arcType: ArcType.NONE, material: colour, depthFailMaterial: colour },
      });
    if (model.returnLine && model.returnLine.length > 1) {
      const positions = live((m) => (m.returnLine ?? []).map(lifted), []);
      line(positions, 12, this.colour('--map-route-casing'));
      line(positions, 6, this.colour('--map-route-highlight'));
    }
    model.crew.forEach((first, i) => {
      const member = (m: CrewMarkerModel) => m.crew[i] ?? first;
      const radius = live((m) => Math.max(member(m).uncertaintyM, 0.1), 0.1);
      this.add('crew', {
        position: live((m) => lifted(member(m)), lifted(first)) as never,
        ellipse: {
          semiMajorAxis: radius,
          semiMinorAxis: radius,
          height: live((m) => this.surfaceHeight(member(m).lon, member(m).lat) + CREW_LIFT_M, 0),
          material: ring.withAlpha(0.18),
          show: live((m) => member(m).uncertaintyM > 0, false),
        },
      });
      line(live((m) => (member(m).uncertaintyM > 0 ? circleRing(member(m), member(m).uncertaintyM).map(lifted) : []), []), 2, ring);
      this.add(
        'crew',
        {
          position: live((m) => this.surfacePosition(member(m).lon, member(m).lat), this.surfacePosition(first.lon, first.lat)) as never,
          billboard: this.billboard(this.crewImage(), REGION),
          // Each label faces away from the rest of the crew, so a separated pair's labels never meet.
          label: {
            ...this.label(crewLabel(first), REGION, [24, 0]),
            text: live((m) => crewLabel(member(m)), ''),
            pixelOffset: live((m) => new Cartesian2(labelOnLeft(m.crew)[i] ? -24 : 24, 0), new Cartesian2(24, 0)),
            horizontalOrigin: live(
              (m) => (labelOnLeft(m.crew)[i] ? HorizontalOrigin.RIGHT : HorizontalOrigin.LEFT),
              HorizontalOrigin.LEFT,
            ),
          },
        },
        { kind: 'text', lines: [first.id, formatLatLon(first.lon, first.lat)] },
      );
    });
    if (model.rover) {
      const rover = model.rover;
      this.add(
        'crew',
        {
          position: live((m) => (m.rover ? this.surfacePosition(m.rover.lon, m.rover.lat) : undefined), undefined) as never,
          billboard: this.billboard(this.markers().dropOff(), REGION),
          label: { ...this.label(rover.label, REGION, [20, 0]), text: live((m) => m.rover?.label ?? '', '') },
        },
        {
          kind: 'text',
          lines: ['Rover', formatLatLon(rover.lon, rover.lat)],
          target: () => {
            const live = this.crewModel?.rover;
            return live ? { title: 'Rover', lon: live.lon, lat: live.lat } : undefined;
          },
        },
      );
    }
  }

  private surfaceHeight(lon: number, lat: number): number {
    return this.useSurfaceHeights ? surfaceHeightM(this.grid, lon, lat, this.heightOffsetM) : 0;
  }

  /** Hover text for a picked marker (stop, drop-off, fork, slope point, photo site), else null. */
  hoverLabel(picked: unknown): string | null {
    const meta = this.metaFor(picked);
    if (!meta) return null;
    if (meta.kind === 'text') return meta.lines.join('\n');
    return this.routeHoverLines.join('\n') || null;
  }

  /**
   * Updates route highlighting for a pick under the cursor and returns its hover lines.
   * routeSpanPx is the route's on-screen size: under 400 px the whole route highlights,
   * above it the section under the cursor does and the rest dims.
   */
  hover(picked: unknown, routeSpanPx: number): string[] {
    const meta = this.metaFor(picked);
    let next: RouteHover = null;
    let section: Section | null = null;
    if (meta?.kind === 'route' && this.plan) {
      if (hoverMode(routeSpanPx) === 'route') {
        next = { mode: 'route' };
        this.routeHoverLines = [routeLabel(this.plan)];
      } else {
        section = sectionForLegs(this.sectionList, this.stretches[meta.stretch].legs);
        next = section ? { mode: 'section', legIndices: section.legIndices } : { mode: 'route' };
        this.routeHoverLines = [section ? sectionLabel(section, this.plan) : routeLabel(this.plan)];
      }
    } else {
      this.routeHoverLines = [];
    }
    this.styles = stretchStyles(
      this.stretches.map((s) => s.legs),
      next,
    );
    this.cores.forEach((cores, i) => cores.forEach((core) => (core.show = this.styles[i] !== 'dim')));
    const sectionId = section?.id ?? null;
    if (sectionId !== this.hoveredSection) {
      this.hoveredSection = sectionId;
      this.onSectionHover?.(sectionId);
    }
    if (meta?.kind === 'text') return meta.lines;
    return this.routeHoverLines;
  }

  /** Positions along the route at a ground height, for measuring its size on screen. */
  routeSamples(heightM: number, count = 48): Cartesian3[] {
    if (!this.plan) return [];
    const line = routeLine(this.plan);
    const step = Math.max(1, Math.floor(line.length / count));
    return line.filter((_, i) => i % step === 0).map(([lon, lat]) => lonLatToCartesian(lon, lat, heightM));
  }

  get sections(): Section[] {
    return this.sectionList;
  }

  /** The waypoint or rover mark under a pick, for the 360° surface view; null for anything else. */
  surfaceTarget(picked: unknown): SurfaceTarget | null {
    const meta = this.metaFor(picked);
    return meta?.kind === 'text' ? (meta.target?.() ?? null) : null;
  }

  private metaFor(picked: unknown): Meta | null {
    const id = (picked as { id?: unknown } | undefined)?.id;
    return id instanceof Entity && this.owned.has(id) ? (this.meta.get(id) ?? null) : null;
  }

  clear(): void {
    this.removeScreenUpdate?.();
    this.crewKey = '';
    this.crewModel = null;
    for (const group of Object.keys(this.groups) as (keyof GlobeOverlays['groups'])[]) this.removeGroup(group);
    this.plan = undefined;
    this.stretches = [];
    this.cores = [];
    this.sectionList = [];
    this.stats = null;
    if (this.hoveredSection !== null) {
      this.hoveredSection = null;
      this.onSectionHover?.(null);
    }
  }
}

/** Local north at a surface point, so billboard rotation reads as a compass bearing. */
function northAt(position: Cartesian3): Cartesian3 {
  const north = Matrix4.getColumn(Transforms.eastNorthUpToFixedFrame(position, Ellipsoid.MARS), 1, new Cartesian4());
  return Cartesian3.normalize(new Cartesian3(north.x, north.y, north.z), new Cartesian3());
}

/**
 * Drops pairs of forks with the same branches that lie close together: legs that part and
 * rejoin a few metres later (an out-and-back path that wanders off itself), not a real fork.
 */
export function dropBubbles<T extends { lon: number; lat: number; branches: { toLabel: string }[] }>(
  forks: T[],
  origin: GridOrigin,
  withinM = FORK_BUBBLE_M,
): T[] {
  const key = (f: T) => [...new Set(f.branches.map((b) => b.toLabel))].sort().join('|');
  const metres = (a: T, b: T) => {
    const pa = lonlatToLocalMetres(a.lon, a.lat, origin);
    const pb = lonlatToLocalMetres(b.lon, b.lat, origin);
    return Math.hypot(pb.x_m - pa.x_m, pb.y_m - pa.y_m);
  };
  return forks.filter((f, i) => !forks.some((g, j) => j !== i && key(g) === key(f) && metres(f, g) <= withinM));
}

/** Joins forks within a few metres of each other, keeping each branch once. */
export function mergeForks<T extends { lon: number; lat: number; branches: { legIndex: number; toLabel: string }[] }>(
  forks: T[],
  origin: GridOrigin,
  withinM = FORK_MERGE_M,
): T[] {
  const metres = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => {
    const pa = lonlatToLocalMetres(a.lon, a.lat, origin);
    const pb = lonlatToLocalMetres(b.lon, b.lat, origin);
    return Math.hypot(pb.x_m - pa.x_m, pb.y_m - pa.y_m);
  };
  const out: T[] = [];
  for (const fork of forks) {
    const near = out.find((f) => metres(f, fork) <= withinM);
    if (!near) {
      out.push({ ...fork, branches: [...fork.branches] });
      continue;
    }
    for (const b of fork.branches) {
      if (!near.branches.some((x) => x.legIndex === b.legIndex && x.toLabel === b.toLabel)) near.branches.push(b);
    }
  }
  for (const fork of out) {
    const seen = new Set<string>();
    fork.branches = fork.branches.filter((b) => {
      const key = `${b.legIndex}:${b.toLabel}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return out;
}

