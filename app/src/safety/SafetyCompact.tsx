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

/**
 * The safety layer for Walk and Visor: relay strip, the ladder's headline and
 * shelter, pair tracking, the night return, the beeper's live step and SOS,
 * stacked at the top left of the view. The ladder and SOS never scroll away;
 * the rest scrolls between them when the view is short.
 */
export const SafetyCompact: React.FC<{ model: SafetyModel; surface: 'walk' | 'visor' }> = ({ model, surface }) => (
  <div className={`s48-safety s48-safety--compact s48-safety--${surface}`} data-over-map aria-label="Safety and links">
    <WarningLadder result={model.ladder} shelter={model.shelter} shelterEtaS={model.shelterEtaS} compact />
    <div className="s48-safety__scroll">
      <PairWarning pair={model.pair} compact />
      {model.night && (
        <NightPanel
          night={model.night}
          lonEast={model.lonEast}
          compact
          rover={{ distanceM: model.rover.distanceM, arrivalHhmm: model.roverArrivalHhmm, onCall: model.onComeToMe }}
        />
      )}
      <DaylightBeeper
        schedule={model.schedule}
        nowMs={model.nowWall}
        lonEastDeg={model.lonEast}
        player={model.player}
        compact
      />
      <RelayStrip model={model.relay} simulated />
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
