// Written with AI assistance, directed and reviewed by the team.
import React from 'react';
import type { SosReason } from './sos';
import type { SafetyModel } from './useSafetyModel';
import { RelayStrip } from './RelayStripPanel';
import { WarningLadder } from './WarningLadder';
import { DaylightBeeper } from './DaylightBeeper';
import { SosControl } from './SosControl';
import { PairWarning } from './PairWarning';
import { NightPanel } from './NightPanel';
import './safety.css';
import './safetyField.css';

const Sos: React.FC<{ model: SafetyModel }> = ({ model }) => (
  <SosControl
    controller={model.sos}
    state={model.sosState}
    reason={model.sosState.reason}
    onReason={(r: SosReason) => model.sos.setReason(r)}
    earthArrival={model.earthArrival}
    queuedBefore={model.queuedBeforeSos}
  />
);

/**
 * Walk's Safety panel, in priority order: the warning ladder headline (with the pair
 * warning and the night return when they apply), SOS, the daylight beeper, the relay strip.
 * Sections in the left panel, nothing over the map.
 */
export const SafetyPanel: React.FC<{ model: SafetyModel }> = ({ model }) => (
  <div className="s48-safety s48-safety--compact s48-safety--panel" aria-label="Safety and links">
    <WarningLadder result={model.ladder} shelter={model.shelter} shelterEtaS={model.shelterEtaS} compact />
    <PairWarning pair={model.pair} compact />
    {model.night && (
      <NightPanel
        night={model.night}
        lonEast={model.lonEast}
        compact
        rover={{ distanceM: model.rover.distanceM, arrivalHhmm: model.roverArrivalHhmm, onCall: model.onComeToMe }}
      />
    )}
    <Sos model={model} />
    <DaylightBeeper
      schedule={model.schedule}
      nowMs={model.nowWall}
      lonEastDeg={model.lonEast}
      player={model.player}
      compact
    />
    <RelayStrip model={model.relay} simulated />
  </div>
);

/** Visor: the warning ladder state readout and SOS only; beeper and relay detail live in Walk. */
export const SafetyVisor: React.FC<{ model: SafetyModel; hazard?: string | null }> = ({ model, hazard }) => (
  <>
    <div className="s48-safety s48-safety--visor s48-safety--visor-ladder" aria-label="Warning ladder state">
      <WarningLadder result={model.ladder} shelter={model.shelter} shelterEtaS={model.shelterEtaS} compact />
      {hazard && <p className="s48-visor-hazard-line" role="alert">{hazard}</p>}
    </div>
    <div className="s48-safety s48-safety--visor s48-safety--visor-sos" aria-label="SOS">
      <Sos model={model} />
    </div>
  </>
);
