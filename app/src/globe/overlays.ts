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
  LabelStyle,
  Math as CesiumMath,
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
import { canvasMarkerImages, readToken, type MarkerImage, type MarkerImages, type TokenReader } from './markerImages';
import {
  branchAnchor,
  branchLabel,
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

export interface OverlayOptions {
  token?: TokenReader;
  images?: MarkerImages;
  /** CESIUM_3D_TILE on Cesium Mars; TERRAIN on the bare-ellipsoid fallback. */
  classification?: ClassificationType;
  onSectionHover?: (sectionId: string | null) => void;
}

/** Tolerance for legs sharing ground, in metres. */
const SHARED_TOLERANCE_M = 3;
/** Forks closer than this are one fork on screen. */
const FORK_MERGE_M = 15;
/** Branch labels sit this far along each branch from the fork. */
const BRANCH_LABEL_M = 35;

/** Camera distances (metres) beyond which small route marks are hidden. */
const NEAR = new DistanceDisplayCondition(0, 6_000);
const SITE = new DistanceDisplayCondition(0, 60_000);
const REGION = new DistanceDisplayCondition(0, 1_500_000);

type Meta = { kind: 'route'; stretch: number } | { kind: 'text'; lines: string[] };

interface Stretch extends SharedSegment {
  shared: boolean;
}

export class GlobeOverlays {
  private readonly entities: EntityCollection;
  private readonly token: TokenReader;
  private images: MarkerImages | null;
  private readonly classification: ClassificationType;
  private readonly onSectionHover?: (sectionId: string | null) => void;
  private readonly meta = new Map<Entity, Meta>();
  private readonly owned = new Set<Entity>();
  private readonly groups: Record<'plan' | 'rover' | 'chemistry' | 'walker', Entity[]> = {
    plan: [],
    rover: [],
    chemistry: [],
    walker: [],
  };

  private plan: Plan | undefined;
  private origin: GridOrigin | null = null;
  private grid: RouteGrid | null = null;
  private stretches: Stretch[] = [];
  private sectionList: Section[] = [];
  private stats: SlopeStats | null = null;
  private gradient = false;
  private styles: StretchStyle[] = [];
  private hoveredSection: string | null = null;
  private routeHoverLines: string[] = [];

  constructor(host: OverlayHost, options: OverlayOptions = {}) {
    this.entities = host.entities;
    this.token = options.token ?? readToken;
    this.images = options.images ?? null;
    this.classification = options.classification ?? ClassificationType.CESIUM_3D_TILE;
    this.onSectionHover = options.onSectionHover;
  }

  private markers(): MarkerImages {
    this.images ??= canvasMarkerImages(this.token);
    return this.images;
  }

  private colour(name: string): Color {
    return Color.fromCssColorString(this.token(name) || '#ffffff');
  }

  private add(group: keyof GlobeOverlays['groups'], options: Entity.ConstructorOptions, meta?: Meta): Entity {
    const entity = this.entities.add(options);
    this.groups[group].push(entity);
    this.owned.add(entity);
    if (meta) this.meta.set(entity, meta);
    return entity;
  }

  private removeGroup(group: keyof GlobeOverlays['groups']): void {
    for (const entity of this.groups[group]) {
      this.entities.remove(entity);
      this.meta.delete(entity);
      this.owned.delete(entity);
    }
    this.groups[group] = [];
  }

  /** Bundle elevation grid for slopes; without it the gradient view and slope markers stay off. */
  setGrid(grid: RouteGrid | null): void {
    this.grid = grid;
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
    this.sectionList = [];
    this.stats = null;
    this.routeHoverLines = [];
    if (!plan || !plan.route.legs.length) return;
    const frame = origin ?? { lon0: plan.start.lon, lat0: plan.start.lat, lat_c: plan.start.lat };
    this.origin = origin ?? null;

    const legs = plan.route.legs;
    this.stretches = sharedSegments(legs, frame, SHARED_TOLERANCE_M).map((s) => ({ ...s, shared: s.legs.length > 1 }));
    this.sectionList = routeSections(plan, frame);
    this.styles = this.stretches.map(() => 'normal');
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
      const polyline = (line: [number, number][], width: number, material: Entity.ConstructorOptions['polyline']) => ({
        polyline: {
          positions: line.map(([lon, lat]) => lonLatToCartesian(lon, lat, 0)),
          width,
          clampToGround: true,
          arcType: ArcType.GEODESIC,
          classificationType: this.classification,
          ...material,
        },
      });

      this.add('plan', polyline(stretch.line, casingWidth + 2, { material: styleColour(casing, casing) }), meta);
      const grade = this.gradient && this.stats ? this.stretchGrades(stretch) : null;
      if (grade) {
        for (const run of grade) {
          const c = grades[run.bin - 1];
          this.add('plan', polyline(run.line, coreWidth + 2, { material: styleColour(c, c) }), meta);
        }
      } else {
        this.add('plan', polyline(stretch.line, coreWidth + 2, { material: styleColour(base, highlight) }), meta);
        this.add(
          'plan',
          polyline(stretch.line, 2, {
            material: new PolylineDashMaterialProperty({ color: dash, gapColor: Color.TRANSPARENT, dashLength: 12 }),
          }),
          meta,
        );
      }

      for (const c of chevronsFor(stretch.line, stretch.directions, frame)) {
        const position = lonLatToCartesian(c.lon, c.lat, 0);
        this.add(
          'plan',
          {
            position,
            billboard: {
              ...this.billboard(this.markers().chevron(), NEAR),
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

  private billboard(image: MarkerImage, show: DistanceDisplayCondition): Entity.ConstructorOptions['billboard'] {
    return {
      image: image.image,
      width: image.width,
      height: image.height,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      distanceDisplayCondition: show,
    };
  }

  private label(text: string, show: DistanceDisplayCondition, offset: [number, number], left = false) {
    return {
      text,
      font: `600 13px ${this.token('--font-data') || 'sans-serif'}`,
      fillColor: this.colour('--map-label-text'),
      outlineColor: this.colour('--map-label-halo'),
      outlineWidth: 3,
      style: LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: left ? HorizontalOrigin.RIGHT : HorizontalOrigin.LEFT,
      verticalOrigin: VerticalOrigin.CENTER,
      pixelOffset: new Cartesian2(offset[0], offset[1]),
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
      distanceDisplayCondition: show,
    };
  }

  private drawForks(plan: Plan, frame: GridOrigin): void {
    const forks = mergeForks(forkPoints(plan.route.legs, frame, SHARED_TOLERANCE_M), frame);
    for (const fork of forks) {
      const lines = fork.branches.map((b) => branchLabel(b.toLabel, plan));
      this.add(
        'plan',
        { position: lonLatToCartesian(fork.lon, fork.lat, 0), billboard: this.billboard(this.markers().fork(), SITE) },
        { kind: 'text', lines: ['Fork', ...lines] },
      );
      fork.branches.forEach((branch, i) => {
        const [lon, lat] = branchAnchor(plan.route.legs[branch.legIndex].line, [fork.lon, fork.lat], BRANCH_LABEL_M, frame);
        this.add('plan', {
          position: lonLatToCartesian(lon, lat, 0),
          label: this.label(lines[i], NEAR, [8, 0]),
        });
      });
    }
  }

  private drawStops(plan: Plan): void {
    const images = this.markers();
    const start = plan.start;
    this.add(
      'plan',
      {
        position: lonLatToCartesian(start.lon, start.lat, 0),
        billboard: this.billboard(images.dropOff(), REGION),
        label: this.label('Rover drop-off', SITE, [-20, 0], true),
      },
      { kind: 'text', lines: ['Rover drop-off', formatLatLon(start.lon, start.lat)] },
    );
    plan.stops.forEach((stop) => {
      const number = waypointLabel(stop.id, plan);
      this.add(
        'plan',
        {
          position: lonLatToCartesian(stop.lon, stop.lat, 0),
          billboard: this.billboard(images.stop(number, false), REGION),
        },
        { kind: 'text', lines: [`Stop ${number} · ${stop.name}`, formatLatLon(stop.lon, stop.lat)] },
      );
    });
    if (needsFinish(plan)) {
      const end = plan.route.legs.at(-1)!.line.at(-1)!;
      this.add(
        'plan',
        { position: lonLatToCartesian(end[0], end[1], 0), billboard: this.billboard(images.finish(), REGION) },
        { kind: 'text', lines: ['Finish', formatLatLon(end[0], end[1])] },
      );
    }
  }

  private drawSlopeMarkers(plan: Plan, frame: GridOrigin, stats: SlopeStats): void {
    const images = this.markers();
    const labels = slopeLabels(stats, distanceAlong(routeLine(plan), stats.steepestAt, frame));
    const marks: [[number, number], MarkerImage, string][] = [
      [stats.highAt, images.high(), labels.high],
      [stats.lowAt, images.low(), labels.low],
      [stats.steepestAt, images.steepest(), labels.steepest],
    ];
    for (const [[lon, lat], image, text] of marks) {
      this.add(
        'plan',
        {
          position: lonLatToCartesian(lon, lat, 0),
          billboard: this.billboard(image, SITE),
          label: this.label(text, SITE, [12, 0]),
        },
        { kind: 'text', lines: [text, formatLatLon(lon, lat)] },
      );
    }
  }

  /** Rover traverse and photo sites. */
  setRover(traverse: GeoJSON.LineString | null, sites: PhotoSite[], state: RoverOverlayState): void {
    this.removeGroup('rover');
    if (traverse && state.traverse) {
      const positions = traverse.coordinates.map(([lon, lat]) => lonLatToCartesian(lon, lat, 0));
      for (const [name, width] of [['--map-label-halo', 3.5], ['--map-label-text', 1.5]] as const) {
        this.add('rover', {
          polyline: {
            positions,
            width,
            clampToGround: true,
            classificationType: this.classification,
            material: this.colour(name),
          },
        });
      }
    }
    if (state.photos) {
      for (const site of sites) {
        this.add(
          'rover',
          {
            position: lonLatToCartesian(site.lon, site.lat, 0),
            billboard: this.billboard(this.markers().photo(site.count), SITE),
          },
          { kind: 'text', lines: [photoSiteLabel(site)] },
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
    const sectionId = section?.id ?? null;
    if (sectionId !== this.hoveredSection) {
      this.hoveredSection = sectionId;
      this.onSectionHover?.(sectionId);
    }
    if (meta?.kind === 'text') return meta.lines;
    return this.routeHoverLines;
  }

  /** Positions along the route for measuring its size on screen. */
  routeSamples(count = 48): Cartesian3[] {
    if (!this.plan) return [];
    const line = routeLine(this.plan);
    const step = Math.max(1, Math.floor(line.length / count));
    return line.filter((_, i) => i % step === 0).map(([lon, lat]) => lonLatToCartesian(lon, lat, 0));
  }

  get sections(): Section[] {
    return this.sectionList;
  }

  private metaFor(picked: unknown): Meta | null {
    const id = (picked as { id?: unknown } | undefined)?.id;
    return id instanceof Entity && this.owned.has(id) ? (this.meta.get(id) ?? null) : null;
  }

  clear(): void {
    for (const group of Object.keys(this.groups) as (keyof GlobeOverlays['groups'])[]) this.removeGroup(group);
    this.plan = undefined;
    this.stretches = [];
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

