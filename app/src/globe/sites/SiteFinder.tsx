// Written with AI assistance, directed and reviewed by the team.
// Site-finder: candidate and known-site pins on the globe, a ranked "Sites"
// tab, adjustable weights, filter chips and a detail card. One mount point.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BoundingSphere,
  Cartographic,
  Color,
  CustomDataSource,
  Entity,
  HeadingPitchRange,
  HeightReference,
  Math as CesiumMath,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer,
} from 'cesium';
import { GLOBE_BASE } from '../../config';
import { lonLatToCartesian } from '../frame';
import { GroupKey, Site, SitesFile, Veto, Weights } from './types';
import { RankedSite, rescore } from './scoring';
import { DEFAULT_FILTERS, FilterState, filterSites } from './filters';
import { formatScore, scoreBucket } from './format';
import { nearestPlaceName, PlaceFeature } from './nearestPlace';
import { SitesPanel } from './SitesPanel';
import { isInSurfaceView } from '../../surface360/SurfaceView';
import { SiteCard } from './SiteCard';
import './sites.css';

interface SiteFinderProps {
  viewer: Viewer | null;
  active: boolean;
  /** Extra action shown on the selected site's card. */
  siteAction?: (site: Site) => React.ReactNode;
  registerHover: (fn: ((entity: Entity | null) => string[] | null) | null) => void;
  onHide: () => void;
}

const PIN_ID = (id: string) => `site:${id}`;

function cssColour(name: string): Color {
  return Color.fromCssColorString(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}

/** Fly the camera straight down onto a site. */
async function flyToSite(viewer: Viewer, lon: number, lat: number): Promise<void> {
  if (isInSurfaceView(viewer)) return;
  const [sampled] = await viewer.scene.sampleHeightMostDetailed([Cartographic.fromDegrees(lon, lat)]);
  // The height sample can resolve after the surface view has been entered.
  if (isInSurfaceView(viewer)) return;
  const centre = lonLatToCartesian(lon, lat, sampled?.height ?? 0);
  viewer.camera.flyToBoundingSphere(new BoundingSphere(centre, 1), {
    offset: new HeadingPitchRange(0, CesiumMath.toRadians(-75), 60_000),
  });
}

export const SiteFinder: React.FC<SiteFinderProps> = ({ viewer, active, registerHover, onHide, siteAction }) => {
  const [data, setData] = useState<{ sites: Site[]; vetoes: Veto[]; fileWeights: Weights } | null>(null);
  const [places, setPlaces] = useState<PlaceFeature[] | null>(null);
  const [weights, setWeights] = useState<Weights | null>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sourceRef = useRef<CustomDataSource | null>(null);
  const entitiesRef = useRef<Map<string, Entity>>(new Map());
  // Live scores by id, kept in a ref so the hover callback reads the latest.
  const scoreRef = useRef<Map<string, number>>(new Map());

  // Load the site-finder file.
  useEffect(() => {
    let cancelled = false;
    fetch(`${GLOBE_BASE}/sites.json`)
      .then((r) => (r.ok ? (r.json() as Promise<SitesFile>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((file) => {
        if (cancelled) return;
        setData({ sites: file.sites, vetoes: file.vetoes, fileWeights: file.weights.group_weights });
        setWeights(file.weights.group_weights);
      })
      .catch((error) => console.warn('Site-finder data did not load', error));
    fetch('/data/globe/names.geojson')
      .then((r) => (r.ok ? (r.json() as Promise<{ features: PlaceFeature[] }>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((geo) => {
        if (!cancelled) setPlaces(geo.features);
      })
      .catch((error) => console.warn('IAU place names did not load', error));
    return () => {
      cancelled = true;
    };
  }, []);

  // Nearest IAU place name per candidate, computed once.
  const placeNames = useMemo(() => {
    const map = new Map<string, string | null>();
    if (!data || !places) return map;
    for (const site of data.sites) {
      if (site.kind === 'new') map.set(site.id, nearestPlaceName(site.lon, site.lat, places));
    }
    return map;
  }, [data, places]);

  // Live ranking under the current weights.
  const ranked: RankedSite[] = useMemo(
    () => (data && weights ? rescore(data.sites, weights) : []),
    [data, weights],
  );
  const rankById = useMemo(() => {
    const map = new Map<string, RankedSite>();
    ranked.forEach((r) => map.set(r.site.id, r));
    return map;
  }, [ranked]);

  useEffect(() => {
    scoreRef.current = new Map(ranked.map((r) => [r.site.id, r.score]));
  }, [ranked]);

  // Visible rows: filtered sites, in live-score order, with their global rank.
  const rows: RankedSite[] = useMemo(() => {
    if (!data) return [];
    const visible = new Set(filterSites(data.sites, filters).map((s) => s.id));
    return ranked.filter((r) => visible.has(r.site.id));
  }, [data, ranked, filters]);

  const selected = selectedId && data ? data.sites.find((s) => s.id === selectedId) ?? null : null;

  // Build the pins once the viewer and data are ready.
  useEffect(() => {
    if (!viewer || !data) return;
    const source = new CustomDataSource('sites');
    sourceRef.current = source;
    const map = new Map<string, Entity>();
    const halo = cssColour('--map-label-halo');
    for (const site of data.sites) {
      const entity = source.entities.add({
        id: PIN_ID(site.id),
        name: site.name,
        position: lonLatToCartesian(site.lon, site.lat, 0),
        point: {
          pixelSize: 9,
          color: halo,
          outlineColor: halo,
          outlineWidth: 1,
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
      });
      map.set(site.id, entity);
    }
    entitiesRef.current = map;
    void viewer.dataSources.add(source);
    return () => {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(source, true);
      sourceRef.current = null;
      entitiesRef.current = new Map();
    };
  }, [viewer, data]);

  // Paint pins from the live scores, selection and the show-vetoed toggle.
  useEffect(() => {
    if (!data) return;
    const ramp = [0, 1, 2, 3, 4].map((i) => cssColour(`--sites-score-${i}`));
    const halo = cssColour('--map-label-halo');
    const knownFill = cssColour('--sites-known-fill');
    const knownRing = cssColour('--sites-known-ring');
    const zoneRing = cssColour('--sites-zone-ring');
    const vetoRing = cssColour('--sites-veto-ring');
    const selectedRing = cssColour('--map-stop-selected-fill');
    for (const site of data.sites) {
      const entity = entitiesRef.current.get(site.id);
      if (!entity?.point) continue;
      const score = scoreRef.current.get(site.id) ?? site.score;
      const isSelected = site.id === selectedId;
      entity.show = site.vetoed ? filters.showVetoed : true;

      let fill = knownFill;
      let ring = knownRing;
      let size = 9;
      if (site.kind === 'new') {
        fill = ramp[scoreBucket(score)];
        ring = halo;
      } else if (site.kind === 'zone2015') {
        ring = zoneRing;
        size = 8;
      } else {
        size = 10;
      }
      if (site.vetoed) ring = vetoRing;
      if (isSelected) {
        ring = selectedRing;
        size += 5;
      }
      entity.point.color = fill as never;
      entity.point.outlineColor = ring as never;
      entity.point.outlineWidth = (isSelected ? 3 : site.kind === 'new' ? 1 : 2) as never;
      entity.point.pixelSize = size as never;
    }
    // `viewer` is a dep so the first paint runs once the pins exist (the pins
    // are built only after the viewer is ready, which is after the data loads).
  }, [viewer, data, ranked, selectedId, filters.showVetoed]);

  // Register the hover-line resolver with the globe page's single tooltip.
  useEffect(() => {
    const fn = (entity: Entity | null): string[] | null => {
      if (!entity || typeof entity.id !== 'string' || !entity.id.startsWith('site:')) return null;
      const id = entity.id.slice('site:'.length);
      const site = data?.sites.find((s) => s.id === id);
      if (!site) return null;
      const score = scoreRef.current.get(id) ?? site.score;
      return [site.name, `Score ${formatScore(score)}`];
    };
    registerHover(fn);
    return () => registerHover(null);
  }, [data, registerHover]);

  const select = useCallback(
    (site: Site) => {
      setSelectedId(site.id);
      if (viewer) void flyToSite(viewer, site.lon, site.lat);
    },
    [viewer],
  );

  // Click a pin to select and fly to it.
  useEffect(() => {
    if (!viewer || !data) return;
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((event: ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(event.position) as { id?: unknown } | undefined;
      const id = picked?.id;
      if (id instanceof Entity && typeof id.id === 'string' && id.id.startsWith('site:')) {
        const site = data.sites.find((s) => s.id === id.id.slice('site:'.length));
        if (site) select(site);
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
    return () => handler.destroy();
  }, [viewer, data, select]);

  const weightsAreDefault = useMemo(() => {
    if (!data || !weights) return true;
    return (Object.keys(data.fileWeights) as GroupKey[]).every((k) => weights[k] === data.fileWeights[k]);
  }, [data, weights]);

  const toggleChip = (chip: keyof FilterState) =>
    setFilters((prev) => ({ ...prev, [chip]: !prev[chip] }));

  if (!data || !weights) return null;

  const selectedRank = selected ? rankById.get(selected.id)?.rank ?? null : null;

  return (
    <>
      {active && (
        <SitesPanel
          rows={rows}
          placeNames={placeNames}
          selectedId={selectedId}
          onSelect={select}
          filters={filters}
          onKind={(kind) => setFilters((prev) => ({ ...prev, kind }))}
          onToggle={(chip) => toggleChip(chip)}
          weights={weights}
          onWeight={(key, value) => setWeights((prev) => ({ ...(prev as Weights), [key]: value }))}
          onResetWeights={() => setWeights(data.fileWeights)}
          weightsAreDefault={weightsAreDefault}
          onHide={onHide}
        />
      )}
      {selected && (
        <div className="sites-card-wrap" data-over-map>
          <SiteCard
            site={selected}
            vetoes={data.vetoes}
            placeName={placeNames.get(selected.id) ?? null}
            rank={selectedRank}
            onClose={() => setSelectedId(null)}
            action={siteAction?.(selected)}
          />
        </div>
      )}
    </>
  );
};
