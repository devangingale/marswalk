// Written with AI assistance, directed and reviewed by the team.
import React, { useState } from 'react';
import type { CommandReceipt } from '../lib/telemetry';
import { useHold } from './useHold';
import type { NightModel } from './useSafetyModel';
import { formatBearing, formatLocalClock, formatWalkDistance, formatDistance } from './format';
import { DotFilled, DotHollow } from './glyphs';
import { shelterKindName } from './WarningLadder';

/** Closer than this to the shelter (or the rover to the crew), metres, it is here. */
const AT_SHELTER_M = 5;

/**
 * Night contingency display (design: "Night display: dark, route corridor,
 * distance and bearing to shelter, next hazard in large type"). The way back is
 * the walked track reversed; the habitat is alerted automatically.
 */
export const NightPanel: React.FC<{
  night: NightModel;
  lonEast: number;
  compact?: boolean;
  rover: { distanceM: number; arrivalHhmm: string; onCall: () => Promise<CommandReceipt> };
}> = ({ night, lonEast, compact, rover }) => {
  const { shelter, hazard, habitat } = night;
  // Within the fix floor of the shelter: there is nothing to steer by.
  const atShelter = shelter.distanceM < AT_SHELTER_M;
  return (
    <section className={`s48-night ${compact ? 's48-night--compact' : ''}`} aria-label="Night return">
      <h3 className="s48-night__title">Night return</h3>
      <div className="s48-night__nav">
        <div className="s48-night__row">
          <span className="s48-night__label">{shelterKindName(shelter.kind)}</span>
          {atShelter ? (
            <span className="s48-night__none">Here</span>
          ) : (
            <>
              <strong className="s48-night__dist">{formatWalkDistance(shelter.distanceM)}</strong>
              <span className="s48-night__bearing">{formatBearing(shelter.bearingDeg)}</span>
            </>
          )}
        </div>
        <div className="s48-night__row">
          <span className="s48-night__label">Next hazard</span>
          {hazard === undefined ? (
            <span className="s48-night__none">Loading</span>
          ) : hazard === null ? (
            <span className="s48-night__none">None on the way back</span>
          ) : hazard.alongM < AT_SHELTER_M ? (
            <span className="s48-night__none">Impassable ground within {formatDistance(hazard.marginM)}</span>
          ) : (
            <>
              <strong className="s48-night__dist">{formatWalkDistance(hazard.alongM)}</strong>
              <span className="s48-night__bearing">{formatBearing(hazard.bearingDeg)}</span>
            </>
          )}
        </div>
      </div>
      {!atShelter && (
        <dl className="s48-night__figs">
          <div>
            <dt>Way back</dt>
            <dd>{formatDistance(night.wayBackM)} on the walked track</dd>
          </div>
          {hazard && hazard.alongM >= AT_SHELTER_M ? (
            <div>
              <dt>Hazard margin</dt>
              <dd>{formatDistance(hazard.marginM)}</dd>
            </div>
          ) : null}
        </dl>
      )}
      <p className={`s48-night__habitat ${habitat?.received ? 'is-received' : ''}`}>
        {habitat?.received ? <DotFilled /> : <DotHollow />}
        {habitat?.received && habitat.atMs !== null
          ? `Habitat alerted ${formatLocalClock(habitat.atMs, lonEast)}`
          : 'Habitat alert queued until the link returns'}
      </p>
      {rover.distanceM >= AT_SHELTER_M && (
        <RoverCall distanceM={rover.distanceM} arrivalHhmm={rover.arrivalHhmm} onCall={rover.onCall} />
      )}
    </section>
  );
};

/**
 * Hold-to-send rover call in the night return (design: "Rover command safety:
 * hold-to-send confirmation showing the effect"). The rover's own hazard checks
 * decide; the call goes through the telemetry adapter.
 */
const RoverCall: React.FC<{
  distanceM: number;
  arrivalHhmm: string;
  onCall: () => Promise<CommandReceipt>;
}> = ({ distanceM, arrivalHhmm, onCall }) => {
  const [receipt, setReceipt] = useState<CommandReceipt | null>(null);
  const [sending, setSending] = useState(false);
  const hold = useHold(() => {
    setSending(true);
    void onCall().then((r) => {
      setReceipt(r);
      setSending(false);
    });
  }, 1200);
  if (receipt?.accepted) {
    return <p className="s48-night__called">Rover called · arrives {arrivalHhmm}</p>;
  }
  return (
    <div className="s48-night__call">
      <button
        type="button"
        className={`s48-rover__send ${hold.holding ? 'is-holding' : ''}`}
        style={{ ['--hold' as string]: hold.progress }}
        onPointerDown={hold.onPointerDown}
        onPointerUp={hold.onPointerUp}
        onPointerLeave={hold.onPointerLeave}
        disabled={sending}
      >
        <span className="s48-rover__send-fill" />
        <span className="s48-rover__send-text">{hold.holding ? 'Keep holding to send' : 'Hold to call the rover'}</span>
      </button>
      <p className="s48-night__effect">
        Drives {formatDistance(distanceM)}, arrives {arrivalHhmm}
        {receipt && !receipt.accepted ? `. Not accepted: ${receipt.reason ?? 'no reason given'}` : ''}
      </p>
    </div>
  );
};
