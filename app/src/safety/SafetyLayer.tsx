// Written with AI assistance, directed and reviewed by the team.
import React, { useEffect, useId, useState } from 'react';
import type { Plan } from '../lib/plan';
import type { GridOrigin } from '../lib/grid';
import type { SosReason } from './sos';
import type { CrewMarkerModel } from './crewMarkers';
import { useSafetyModel } from './useSafetyModel';
import { RelayStrip } from './RelayStripPanel';
import { LadderDetail, WarningLadder } from './WarningLadder';
import { DaylightBeeper } from './DaylightBeeper';
import { SosControl } from './SosControl';
import { RoverPanel } from './RoverPanel';
import { PairWarning } from './PairWarning';
import { NightPanel } from './NightPanel';
import './safety.css';
import './safetyField.css';

export interface SafetyLayerProps {
  plan: Plan | null;
  origin: GridOrigin | null;
  siteId: string;
  lat: number;
  lonEast: number;
  /** Receives the crew, rover and night corridor for the globe; null on unmount. */
  onMarkers?: (model: CrewMarkerModel | null) => void;
  /** True while the night contingency is active, so the page can switch to the night theme. */
  onNight?: (active: boolean) => void;
}

/**
 * The Mars-mode safety column: relay strip, warning ladder, pair tracking, the
 * night contingency, daylight beeper, rover and SOS, over the simulated
 * telemetry adapter. Everything is a simulated-mission value and labelled so.
 */
export const SafetyLayer: React.FC<SafetyLayerProps> = ({ plan, origin, siteId, lat, lonEast, onMarkers, onNight }) => {
  const model = useSafetyModel({ plan, origin, siteId, lat, lonEast });
  const [ladderDetailOpen, setLadderDetailOpen] = useState(false);
  const ladderDetailId = useId();

  const markers = model?.markers ?? null;
  useEffect(() => onMarkers?.(markers), [onMarkers, markers]);
  useEffect(() => () => onMarkers?.(null), [onMarkers]);
  const nightActive = model?.night != null;
  useEffect(() => {
    onNight?.(nightActive);
  }, [onNight, nightActive]);
  useEffect(() => () => onNight?.(false), [onNight]);

  if (!model) return null;
  const { night } = model;

  return (
    <div className="s48-safety" data-over-map aria-label="Safety and links">
      <RelayStrip model={model.relay} simulated />
      <WarningLadder
        result={model.ladder}
        shelter={model.shelter}
        shelterEtaS={model.shelterEtaS}
        detailOpen={ladderDetailOpen}
        detailId={ladderDetailId}
        onDetailToggle={() => setLadderDetailOpen((v) => !v)}
      />
      <PairWarning pair={model.pair} />
      {night && <NightPanel night={night} lonEast={model.lonEast} />}
      <div className="s48-safety__scroll">
        {ladderDetailOpen && (
          <LadderDetail id={ladderDetailId} result={model.ladder} hazard={model.hazard} onHazardChange={model.setHazard} />
        )}
        <RoverPanel
          key={night ? 'night' : 'day'}
          defaultOpen={night !== null}
          rover={model.rover}
          crew={model.lead}
          distanceM={model.rover.distanceM}
          etaToCrewS={model.rover.etaToCrewS ?? 0}
          arrivalLocalHhmm={model.roverArrivalHhmm}
          simulated
          onComeToMe={model.onComeToMe}
        />
        <DaylightBeeper schedule={model.schedule} nowMs={model.nowWall} lonEastDeg={model.lonEast} player={model.player} />
      </div>
      <SosControl
        controller={model.sos}
        state={model.sosState}
        reason={model.sosState.reason}
        onReason={(r: SosReason) => model.sos.setReason(r)}
        earthArrival={model.earthArrival}
        queuedBefore={model.queuedBeforeSos}
      />
    </div>
  );
};
