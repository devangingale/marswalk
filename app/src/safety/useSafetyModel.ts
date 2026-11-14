// Written with AI assistance, directed and reviewed by the team.

/**
 * The safety model shared by the globe page (Mars mode), Walk and Visor: the
 * telemetry adapter's crew and rover, the warning ladder, pair tracking, the
 * night contingency, the beeper schedule, the relay strip and SOS. Everything
 * is a simulated-mission value. On the globe page the crew follows the live
 * mission clock; in Walk and Visor it follows the playback.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Plan } from '../lib/plan';
import { loadGrid, type GridOrigin, type RouteGrid } from '../lib/grid';
import type { CommandReceipt, TelemetryAdapter, TelemetrySnapshot } from '../lib/telemetry';
import { createSimulatedAdapter, localMetreDistance, EVA_SECONDARY_O2_S } from '../lib/telemetrySim';
import type { Pass } from '../lib/relay';
import { buildTrack, walkStateAt, type RouteTrack } from '../walk/track';
import { hazardFlags } from '../walk/hazard';
import { getSiteBaseUrl } from '../config';
import { ladderLevel, chooseShelter, type Hazard, type LadderResult, type ShelterCandidate, type ShelterChoice } from './ladder';
import { beeperSchedule, type BeeperStep } from './beeper';
import {
  parsePasses,
  relayStripModel,
  simulatedRelayQueue,
  sosEarthArrival,
  type EarthArrivalEstimate,
  type PassesFile,
  type RelayStripModel,
} from './relayStrip';
import { createSosController, initialSosState, type SosController, type SosState } from './sos';
import { createBeeperPlayer, type BeeperPlayer } from './beeperPlayer';
import { computeMissionTiming } from './mission';
import { readPairSpread, readScenario, scenarioLadderInput } from './scenario';
import { formatLocalClock } from './format';
import { pairSeparation, hazardMarginM, type PairSeparation } from './pair';
import { distanceBearing, nextHazardOnReturn, nightReturnRoute, nightTrigger, type LonLat, type NightTrigger } from './navigate';
import { applyCrewSpread, roverLabel, type CrewMarker, type CrewMarkerModel } from './crewMarkers';
import { buildHabitatAlert, createSimulatedHabitat, type HabitatReceipt } from './habitatAlert';

/** Passes window, so a stray device clock cannot land the demo outside real data. */
const WINDOW_START = Date.UTC(2026, 10, 2);
const WINDOW_END = Date.UTC(2026, 11, 28);
/** How far before the layer opened the simulated relay queue's first fix sits. */
const QUEUE_LEAD_MS = 60000;
/** Hazard margins are bucketed to this step so the flags are not recomputed every second. */
const MARGIN_STEP_M = 10;

function clampBase(nowMs: number): number {
  if (nowMs < WINDOW_START || nowMs > WINDOW_END) return Date.UTC(2026, 10, 14, 12, 0);
  return nowMs;
}

export interface SafetyModelOptions {
  plan: Plan | null;
  origin: GridOrigin | null;
  siteId: string;
  lat: number;
  lonEast: number;
  /** Walk and Visor: the playback position drives the crew. Omitted on the globe page. */
  elapsedS?: number;
}

export interface NightModel {
  trigger: NightTrigger;
  /** Straight line from the lead to the end of the way back (the rover drop-off). */
  shelter: { distanceM: number; bearingDeg: number };
  /** The way back over the walked track. */
  wayBackM: number;
  /** Next hazard along the way back; null when none, undefined while the grid loads. */
  hazard: { alongM: number; bearingDeg: number; marginM: number } | null | undefined;
  habitat: HabitatReceipt | null;
}

export interface SafetyModel {
  nowWall: number;
  lonEast: number;
  ladder: LadderResult;
  shelter: ShelterChoice | null;
  shelterEtaS: number | null;
  hazard: Hazard;
  setHazard: (h: Hazard) => void;
  schedule: BeeperStep[];
  relay: RelayStripModel;
  earthArrival: EarthArrivalEstimate | null;
  queuedBeforeSos: number;
  sos: SosController;
  sosState: SosState;
  player: BeeperPlayer;
  crew: CrewMarker[];
  lead: CrewMarker;
  pair: PairSeparation | null;
  rover: { lon: number; lat: number; batteryPct: number; distanceM: number; etaToCrewS: number | null };
  roverArrivalHhmm: string;
  onComeToMe: () => Promise<CommandReceipt>;
  night: NightModel | null;
  markers: CrewMarkerModel;
}

/** One fresh snapshot: the adapter delivers the current one on subscribe. */
function readSnapshot(adapter: TelemetryAdapter): TelemetrySnapshot | null {
  let snap: TelemetrySnapshot | null = null;
  adapter.subscribe((s) => (snap = s))();
  return snap;
}

export function useSafetyModel({ plan, origin, siteId, lat, lonEast, elapsedS }: SafetyModelOptions): SafetyModel | null {
  const track = useMemo<RouteTrack | null>(() => (plan && origin ? buildTrack(plan, origin) : null), [plan, origin]);
  const mountRealRef = useRef<number>(Date.now());
  const scenario = useMemo(() => readScenario(window.location.search), []);
  const pairSpread = useMemo(() => readPairSpread(window.location.search), []);

  const timing = useMemo(() => {
    if (!plan || !track) return null;
    return computeMissionTiming({
      lat,
      lonEastDeg: lonEast,
      baseUtcMs: clampBase(Date.now()),
      walkDurationS: track.durationS,
      timeLimitS: plan.params.time_limit_s,
    });
  }, [plan, track, lat, lonEast]);

  // The simulated adapter measures its walk from the clock value at creation, so it is
  // created at the departure time and then read at the crew's current time.
  const adapterClockRef = useRef(0);
  const adapter = useMemo(() => {
    if (!plan || !track || !timing) return null;
    adapterClockRef.current = timing.departUtcMs;
    return createSimulatedAdapter(plan, track, () => adapterClockRef.current);
  }, [plan, track, timing]);

  const [passes, setPasses] = useState<Pass[]>([]);
  useEffect(() => {
    let live = true;
    fetch(`${getSiteBaseUrl(siteId)}/passes.json`)
      .then((r) => (r.ok ? (r.json() as Promise<PassesFile>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((file) => {
        if (live) setPasses(parsePasses(file));
      })
      .catch((error) => console.warn('Passes did not load', error));
    return () => {
      live = false;
    };
  }, [siteId]);

  const [grid, setGrid] = useState<RouteGrid | null>(null);
  const [gridFailed, setGridFailed] = useState(false);
  useEffect(() => {
    if (!origin) return;
    let live = true;
    loadGrid(getSiteBaseUrl(siteId), origin)
      .then((g) => live && setGrid(g))
      .catch(() => live && setGridFailed(true));
    return () => {
      live = false;
    };
  }, [siteId, origin]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const [sosState, setSosState] = useState<SosState>(() => initialSosState());
  const [sosSentAtMs, setSosSentAtMs] = useState<number | null>(null);
  const sosRef = useRef<SosController | null>(null);
  if (sosRef.current === null) {
    sosRef.current = createSosController({
      clock: () => Date.now(),
      onChange: setSosState,
      onSent: () => setSosSentAtMs((t) => t ?? Date.now()),
    });
  }
  useEffect(() => () => sosRef.current?.dispose(), []);

  const playerRef = useRef<BeeperPlayer | null>(null);
  playerRef.current ??= createBeeperPlayer();
  useEffect(() => () => playerRef.current?.dispose(), []);

  const [hazard, setHazard] = useState<Hazard>('daylight');
  const [calledArrivalMs, setCalledArrivalMs] = useState<number | null>(null);
  // The simulated habitat stamps receipts on the mission clock.
  const missionNowRef = useRef(0);
  const habitatRef = useRef(createSimulatedHabitat(() => missionNowRef.current));
  const [habitatReceipt, setHabitatReceipt] = useState<HabitatReceipt | null>(null);

  // Hazard flags along the track at the night margin, bucketed by uncertainty.
  const flagsCache = useRef<{ key: string; flags: boolean[] } | null>(null);

  const ready = plan && track && timing && adapter;
  const liveNow = timing ? timing.missionNowMs + (Date.now() - mountRealRef.current) : 0;
  const crewNowMs = timing ? (elapsedS !== undefined ? timing.departUtcMs + elapsedS * 1000 : liveNow) : 0;
  const nowWall =
    scenario && timing
      ? scenarioLadderInput(scenario, { backByMs: timing.backByMs, sunsetMs: timing.sunsetUtcMs }).nowMs
      : crewNowMs;

  missionNowRef.current = nowWall;

  let model: SafetyModel | null = null;
  let trigger: NightTrigger | null = null;
  let alertInput: Parameters<typeof buildHabitatAlert>[0] | null = null;

  if (ready) {
    adapterClockRef.current = crewNowMs;
    const snapshot = readSnapshot(adapter);
    const elapsed = Math.min(Math.max(0, (crewNowMs - timing.departUtcMs) / 1000), track.durationS);
    const walk = walkStateAt(plan, track, elapsed);
    const crew = applyCrewSpread(
      (snapshot?.crew ?? []).map((c) => ({ id: c.id, lon: c.lon, lat: c.lat, uncertaintyM: c.uncertaintyM })),
      pairSpread,
    );
    const lead: CrewMarker = crew[0] ?? { id: 'EV1', lon: walk.lon, lat: walk.lat, uncertaintyM: 0 };
    const pair = pairSeparation(crew);

    const roverPos = snapshot?.rover ?? { lon: plan.start.lon, lat: plan.start.lat, batteryPct: 100, etaToCrewS: null };
    const roverDistanceM = localMetreDistance(roverPos, lead);
    const etaToCrewS = snapshot?.rover.etaToCrewS ?? null;

    const trackLengthM = track.vertices.length > 0 ? track.vertices[track.vertices.length - 1].along_m : 0;
    const planSpeedMS = track.durationS > 0 ? trackLengthM / track.durationS : 1;
    const suitTimeLeftS = Math.max(0, track.durationS + EVA_SECONDARY_O2_S - elapsed);

    const candidates = shelterCandidates(plan, track, lead);
    const shelter = chooseShelter(hazard, candidates);
    const shelterEtaS = shelter ? shelter.shelter.distanceM / planSpeedMS : null;

    const ladderInput = scenario
      ? scenarioLadderInput(scenario, { backByMs: timing.backByMs, sunsetMs: timing.sunsetUtcMs }).input
      : {
          nowMs: nowWall,
          backByMs: timing.backByMs,
          sunsetMs: timing.sunsetUtcMs,
          projectedArrivalMs: timing.departUtcMs + track.durationS * 1000,
          behindPaceMin: 0,
          suitTimeLeftS,
          timeToShelterS: shelterEtaS ?? undefined,
        };
    const ladder = ladderLevel(ladderInput);
    trigger = nightTrigger(ladder);

    let night: NightModel | null = null;
    let returnLine: LonLat[] | null = null;
    if (trigger) {
      const wayBack = nightReturnRoute(track.vertices, walk.alongM, lead);
      returnLine = wayBack.line;
      const marginM = hazardMarginM(lead.uncertaintyM, 'night');
      const bucket = Math.ceil(marginM / MARGIN_STEP_M) * MARGIN_STEP_M;
      let hazardNav: NightModel['hazard'];
      if (grid) {
        const key = `${track.vertices.length}:${bucket}`;
        if (flagsCache.current?.key !== key) flagsCache.current = { key, flags: hazardFlags(track.vertices, grid, bucket) };
        const next = nextHazardOnReturn(track.vertices, flagsCache.current.flags, walk.alongM);
        hazardNav = next
          ? { alongM: next.alongReturnM, bearingDeg: distanceBearing(lead, next).bearingDeg, marginM: bucket }
          : null;
      } else {
        hazardNav = gridFailed ? null : undefined;
      }
      night = {
        trigger,
        shelter: distanceBearing(lead, { lon: plan.start.lon, lat: plan.start.lat }),
        wayBackM: wayBack.lengthM,
        hazard: hazardNav,
        habitat: habitatReceipt,
      };
      alertInput = {
        nowMs: nowWall,
        trigger,
        crew,
        headingDeg: walk.headingDeg,
        paceMS: planSpeedMS,
        suitTimeLeftS,
      };
    }

    const schedule = beeperSchedule(timing.backByMs, timing.sunsetUtcMs);
    const queue = simulatedRelayQueue({
      startMs: mountRealRef.current - QUEUE_LEAD_MS,
      nowMs: Date.now(),
      warning: ladder.level !== 'ok' ? ladder.level : null,
      sosAtMs: sosSentAtMs,
    });
    const relay = relayStripModel({
      passes,
      nowMs: nowWall,
      lonEastDeg: lonEast,
      habitat: snapshot?.habitatLink ?? 'live',
      queued: queue.length,
    });

    const arrivalMs = calledArrivalMs ?? (etaToCrewS !== null ? nowWall + etaToCrewS * 1000 : nowWall);
    const roverArrivalHhmm = formatLocalClock(arrivalMs, lonEast);

    const onComeToMe = (): Promise<CommandReceipt> =>
      adapter.command({ kind: 'come_to_me', lon: lead.lon, lat: lead.lat }).then((r) => {
        if (r.accepted && r.etaS !== null) setCalledArrivalMs(nowWall + r.etaS * 1000);
        return r;
      });

    model = {
      nowWall,
      lonEast,
      ladder,
      shelter,
      shelterEtaS,
      hazard,
      setHazard,
      schedule,
      relay,
      earthArrival: sosEarthArrival(passes, nowWall, lonEast),
      queuedBeforeSos: queue.filter((i) => i.kind !== 'sos').length,
      sos: sosRef.current,
      sosState,
      player: playerRef.current,
      crew,
      lead,
      pair,
      rover: { lon: roverPos.lon, lat: roverPos.lat, batteryPct: snapshot?.rover.batteryPct ?? 100, distanceM: roverDistanceM, etaToCrewS },
      roverArrivalHhmm,
      onComeToMe,
      night,
      markers: {
        crew,
        separated: pair !== null && pair.level !== 'together',
        rover: {
          lon: roverPos.lon,
          lat: roverPos.lat,
          label: roverLabel(etaToCrewS, calledArrivalMs !== null ? roverArrivalHhmm : null),
        },
        returnLine,
      },
    };
  }

  // Alert the habitat once at the onset of the night contingency; resend while the link is lost.
  const alertRef = useRef(alertInput);
  alertRef.current = alertInput;
  const link = model?.relay.habitat ?? 'live';
  useEffect(() => {
    if (!trigger) {
      setHabitatReceipt(null);
      return;
    }
    if (habitatReceipt?.received) return;
    const input = alertRef.current;
    if (!input) return;
    setHabitatReceipt(habitatRef.current.send(buildHabitatAlert(input), link));
  }, [trigger, link, habitatReceipt?.received]);

  return model;
}

/** Simulated shelter candidates near the walk, distances measured from the lead. */
function shelterCandidates(plan: Plan, track: RouteTrack, crew: LonLat): ShelterCandidate[] {
  const start = { lon: plan.start.lon, lat: plan.start.lat };
  const toDrop = localMetreDistance(crew, start);
  // A habitat offset roughly 1.2 km north of the drop-off (simulated position).
  const habitat = { lon: start.lon, lat: start.lat + 1200 / 59000 };
  // A habitat node sited on the planned route, about 70 % along.
  const mid = track.vertices[Math.floor(track.vertices.length * 0.7)] ?? track.vertices[0];
  // A crater-wall shelter near the route, about 40 % along.
  const shield = track.vertices[Math.floor(track.vertices.length * 0.4)] ?? track.vertices[0];
  return [
    { id: 'dropoff', kind: 'dropoff', distanceM: toDrop },
    { id: 'rover', kind: 'rover', distanceM: toDrop },
    { id: 'habitat', kind: 'habitat', distanceM: localMetreDistance(crew, habitat) },
    { id: 'habitat-route', kind: 'habitat', distanceM: localMetreDistance(crew, mid), onRoute: true },
    { id: 'shield', kind: 'terrain-shield', distanceM: localMetreDistance(crew, shield), skyBlockedFrac: 0.55 },
    { id: 'cave', kind: 'cave', distanceM: 90, accessible: false },
  ];
}
