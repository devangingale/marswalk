// Written with AI assistance, directed and reviewed by the team.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Plan } from '../lib/plan';
import type { GridOrigin } from '../lib/grid';
import type { CommandReceipt, TelemetrySnapshot } from '../lib/telemetry';
import { buildTrack, walkStateAt } from '../walk/track';
import { createSimulatedAdapter } from '../lib/telemetrySim';
import {
  localMetreDistance,
  DEFAULT_ROVER_SPEED_M_S,
  DEAD_RECKON_FRAC,
  FIX_FLOOR_M,
  EVA_SECONDARY_O2_S,
} from '../lib/telemetrySim';
import { getSiteBaseUrl } from '../config';
import { ladderLevel, chooseShelter, type Hazard, type ShelterCandidate } from './ladder';
import { beeperSchedule } from './beeper';
import { parsePasses, relayStripModel, sosEarthArrival, type PassesFile } from './relayStrip';
import { createSosController, type SosController, type SosState, type SosReason, initialSosState } from './sos';
import { createBeeperPlayer } from './beeperPlayer';
import { computeMissionTiming } from './mission';
import { readScenario, scenarioLadderInput } from './scenario';
import { formatLocalClock } from './format';
import type { Pass } from '../lib/relay';
import { RelayStrip } from './RelayStripPanel';
import { WarningLadder } from './WarningLadder';
import { DaylightBeeper } from './DaylightBeeper';
import { SosControl } from './SosControl';
import { RoverPanel } from './RoverPanel';
import './safety.css';

/** Passes window, so a stray device clock cannot land the demo outside real data. */
const WINDOW_START = Date.UTC(2026, 10, 2);
const WINDOW_END = Date.UTC(2026, 11, 28);

function clampBase(nowMs: number): number {
  if (nowMs < WINDOW_START || nowMs > WINDOW_END) return Date.UTC(2026, 10, 14, 12, 0);
  return nowMs;
}

export interface SafetyLayerProps {
  plan: Plan | null;
  origin: GridOrigin | null;
  siteId: string;
  lat: number;
  lonEast: number;
}

/**
 * The Mars-mode safety layer: relay strip, warning ladder, daylight beeper, SOS
 * and the rover panel, over the simulated telemetry adapter. Everything is a
 * simulated-mission value and labelled so. Self-contained: it reads the plan,
 * the sun and the real passes, and never touches the globe, Plan, Walk or Visor.
 */
export const SafetyLayer: React.FC<SafetyLayerProps> = ({ plan, origin, siteId, lat, lonEast }) => {
  const track = useMemo(() => (plan && origin ? buildTrack(plan, origin) : null), [plan, origin]);
  const mountRealRef = useRef<number>(Date.now());
  const scenario = useMemo(() => readScenario(window.location.search), []);

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

  // Simulated telemetry adapter: used for the rover command and the link state.
  const adapterRef = useRef<ReturnType<typeof createSimulatedAdapter> | null>(null);
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null);
  useEffect(() => {
    if (!plan || !track || !timing) return;
    // The adapter runs on the live mission clock, so the rover command's ETA is
    // measured from the crew's live position (not a scenario's distant clock).
    const clock = () => timing.missionNowMs + (Date.now() - mountRealRef.current);
    const adapter = createSimulatedAdapter(plan, track, clock);
    adapterRef.current = adapter;
    const unsub = adapter.subscribe(setSnapshot);
    return () => {
      unsub();
      adapterRef.current = null;
    };
  }, [plan, track, timing]);

  // Real passes (SPICE), fetched from the site bundle.
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

  // One-per-second re-render so the live clock advances.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // SOS controller (real clock for a responsive hold).
  const [sosState, setSosState] = useState<SosState>(() => initialSosState());
  const [sosQueuedExtra, setSosQueuedExtra] = useState(0);
  const sosRef = useRef<SosController | null>(null);
  if (sosRef.current === null) {
    sosRef.current = createSosController({
      clock: () => Date.now(),
      onChange: setSosState,
      onSent: () => setSosQueuedExtra(1),
    });
  }
  useEffect(() => () => sosRef.current?.dispose(), []);

  // Beeper player (audio starts only on a user gesture inside DaylightBeeper).
  const playerRef = useRef(createBeeperPlayer());
  useEffect(() => () => playerRef.current.dispose(), []);

  const [hazard, setHazard] = useState<Hazard>('daylight');

  if (!plan || !track || !timing) return null;

  // The live mission clock drives the crew's walk; a dev scenario only re-times
  // the ladder, beeper and relay, so the crew stays partway out for the demo.
  const liveNow = timing.missionNowMs + (Date.now() - mountRealRef.current);
  const nowWall = scenario ? scenarioNowFor(scenario, timing) : liveNow;

  const trackLengthM = track.vertices.length > 0 ? track.vertices[track.vertices.length - 1].along_m : 0;
  const planSpeedMS = track.durationS > 0 ? trackLengthM / track.durationS : 1;

  // Crew position from the simulated walk model at the live elapsed time.
  const elapsedS = Math.min(Math.max(0, (liveNow - timing.departUtcMs) / 1000), track.durationS);
  const walk = walkStateAt(plan, track, elapsedS);
  const crew = { lon: walk.lon, lat: walk.lat, uncertaintyM: FIX_FLOOR_M + DEAD_RECKON_FRAC * walk.alongM };

  const rover = { lon: plan.start.lon, lat: plan.start.lat };
  const roverToCrewM = localMetreDistance(rover, crew);
  const etaToCrewS = roverToCrewM / DEFAULT_ROVER_SPEED_M_S;

  // Suit consumables on the simulated linear model (telemetrySim).
  const lifeS = track.durationS + EVA_SECONDARY_O2_S;
  const suitTimeLeftS = Math.max(0, lifeS - elapsedS);

  // Shelter candidates at simulated positions; distances measured from the crew.
  const candidates = shelterCandidates(plan, track, crew);
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
        timeToShelterS: shelter ? shelter.shelter.distanceM / planSpeedMS : undefined,
      };
  const ladder = ladderLevel(ladderInput);

  const schedule = beeperSchedule(timing.backByMs, timing.sunsetUtcMs);

  const queued = queuedCount(passes, nowWall, timing.departUtcMs, ladder.level !== 'ok') + sosQueuedExtra;
  const relay = relayStripModel({
    passes,
    nowMs: nowWall,
    lonEastDeg: lonEast,
    habitat: snapshot?.habitatLink ?? 'live',
    queued,
  });

  const earthArrival = sosEarthArrival(passes, nowWall, lonEast);

  const onComeToMe = (): Promise<CommandReceipt> => {
    const adapter = adapterRef.current;
    if (!adapter) return Promise.resolve({ accepted: false, etaS: null, reason: 'no link', logId: 'none' });
    return adapter.command({ kind: 'come_to_me', lon: crew.lon, lat: crew.lat });
  };

  return (
    <div className="s48-safety" data-over-map aria-label="Safety and links">
      <RelayStrip model={relay} simulated />
      <div className="s48-safety__scroll">
        <WarningLadder
          result={ladder}
          hazard={hazard}
          shelter={shelter}
          shelterEtaS={shelterEtaS}
          onHazardChange={setHazard}
        />
        <DaylightBeeper schedule={schedule} nowMs={nowWall} lonEastDeg={lonEast} player={playerRef.current} />
        <SosControl
          controller={sosRef.current}
          state={sosState}
          reason={sosState.reason}
          onReason={(r: SosReason) => sosRef.current?.setReason(r)}
          earthArrival={earthArrival}
          queuedBefore={queued}
        />
        <RoverPanel
          rover={{ lon: rover.lon, lat: rover.lat, batteryPct: snapshot?.rover.batteryPct ?? 100 }}
          crew={crew}
          distanceM={roverToCrewM}
          etaToCrewS={etaToCrewS}
          arrivalLocalHhmm={formatArrival(nowWall + etaToCrewS * 1000, lonEast)}
          simulated
          onComeToMe={onComeToMe}
        />
      </div>
    </div>
  );
};

/** Effective scenario "now" for a dev-forced rung. */
function scenarioNowFor(
  scenario: ReturnType<typeof readScenario>,
  timing: { backByMs: number; sunsetUtcMs: number },
): number {
  if (!scenario) return 0;
  return scenarioLadderInput(scenario, { backByMs: timing.backByMs, sunsetMs: timing.sunsetUtcMs }).nowMs;
}

function formatArrival(utcMs: number, lonEast: number): string {
  return formatLocalClock(utcMs, lonEast);
}

/**
 * Simulated store-and-forward depth: one position fix per 30 s per astronaut
 * (design) since the last completed pass, plus a small science baseline and the
 * active warning. Real cadence, simulated volume.
 */
function queuedCount(passes: Pass[], nowMs: number, departMs: number, warning: boolean): number {
  let lastSet = departMs;
  for (const p of passes) {
    if (p.setUtcMs <= nowMs && p.setUtcMs > lastSet) lastSet = p.setUtcMs;
  }
  const sinceS = Math.max(0, (nowMs - lastSet) / 1000);
  const positions = Math.floor(sinceS / 30) * 2;
  const science = 4;
  // One pass clears most of the backlog, so a believable depth caps near 99.
  return Math.min(99, positions + science + (warning ? 1 : 0));
}

/** Simulated shelter candidates near the walk, distances measured from the crew. */
function shelterCandidates(
  plan: Plan,
  track: ReturnType<typeof buildTrack>,
  crew: { lon: number; lat: number },
): ShelterCandidate[] {
  const start = { lon: plan.start.lon, lat: plan.start.lat };
  const toDrop = localMetreDistance(crew, start);
  // A habitat offset roughly 1.2 km north of the drop-off (simulated position).
  const habitat = { lon: start.lon, lat: start.lat + 1200 / 59000 };
  // A habitat node sited on the planned route, ~70 % along.
  const mid = track.vertices[Math.floor(track.vertices.length * 0.7)] ?? track.vertices[0];
  // A crater-wall shelter near the route, ~40 % along.
  const shield = track.vertices[Math.floor(track.vertices.length * 0.4)] ?? track.vertices[0];
  return [
    { id: 'dropoff', kind: 'dropoff', distanceM: toDrop },
    { id: 'rover', kind: 'rover', distanceM: toDrop },
    { id: 'habitat', kind: 'habitat', distanceM: localMetreDistance(crew, habitat) },
    { id: 'habitat-route', kind: 'habitat', distanceM: localMetreDistance(crew, mid), onRoute: true },
    {
      id: 'shield',
      kind: 'terrain-shield',
      distanceM: localMetreDistance(crew, shield),
      skyBlockedFrac: 0.55,
    },
    { id: 'cave', kind: 'cave', distanceM: 90, accessible: false },
  ];
}
