// Written with AI assistance, directed and reviewed by the team.
import React, { useId, useState } from 'react';
import { DisclosureButton } from './Disclosure';
import type { CommandReceipt } from '../lib/telemetry';
import { useHold } from './useHold';
import { formatDistance, formatDuration, NBSP } from './format';

/** Lat/lon with hemisphere letters, four decimals (design README section 2). */
function latLon(lon: number, lat: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${NBSP}${ns}, ${Math.abs(lon).toFixed(4)}°${NBSP}${ew}`;
}

/**
 * Rover panel (design: "Hardware links"). The simulated pressurised rover waits
 * at the drop-off; the panel shows its state, the crew's fix with its
 * uncertainty, and a hold-to-send "Come to me" command whose effect is shown
 * before and after sending. Commands go through the telemetry adapter only.
 */
export const RoverPanel: React.FC<{
  rover: { lon: number; lat: number; batteryPct: number };
  crew: { lon: number; lat: number; uncertaintyM: number };
  distanceM: number;
  etaToCrewS: number;
  arrivalLocalHhmm: string;
  simulated: boolean;
  onComeToMe: () => Promise<CommandReceipt>;
  /** Opens with the command showing, for the night contingency. */
  defaultOpen?: boolean;
}> = ({ rover, crew, distanceM, etaToCrewS, arrivalLocalHhmm, simulated, onComeToMe, defaultOpen }) => {
  const [receipt, setReceipt] = useState<CommandReceipt | null>(null);
  const [sending, setSending] = useState(false);
  const [open, setOpen] = useState(defaultOpen ?? false);
  const bodyId = useId();

  const send = () => {
    setSending(true);
    void onComeToMe().then((r) => {
      setReceipt(r);
      setSending(false);
    });
  };
  const hold = useHold(send, 1200);

  return (
    <section className="s48-rover" aria-label="Rover">
      <h3 className="s48-panel-head">
        <DisclosureButton open={open} onToggle={() => setOpen((v) => !v)} controls={bodyId}>
          <span className="s48-rover__head">
            <span>Rover</span>
            {simulated && <span className="s48-rover__sim">simulated</span>}
            <span className="s48-rover__summary">
              {formatDistance(distanceM)} · {formatDuration(etaToCrewS * 1000)}
            </span>
          </span>
        </DisclosureButton>
      </h3>

      {open && (
        <div className="s48-rover__body" id={bodyId}>
          <dl className="s48-rover__grid">
            <div>
              <dt>Position</dt>
              <dd>{latLon(rover.lon, rover.lat)}</dd>
            </div>
            <div>
              <dt>Battery</dt>
              <dd>
                {Math.round(rover.batteryPct)}
                {NBSP}%
              </dd>
            </div>
            <div>
              <dt>To crew</dt>
              <dd>
                {formatDistance(distanceM)} · {formatDuration(etaToCrewS * 1000)}
              </dd>
            </div>
            <div>
              <dt>Crew fix</dt>
              <dd>
                {latLon(crew.lon, crew.lat)}{' '}
                <span className="s48-rover__pm">± {Math.round(crew.uncertaintyM)}{NBSP}m</span>
              </dd>
            </div>
          </dl>

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
            <span className="s48-rover__send-text">
              {hold.holding ? 'Keep holding to send' : 'Hold to send: come to me'}
            </span>
          </button>

          <p className="s48-rover__effect">
            {receipt && receipt.accepted ? (
              <>
                Command sent. Rover drives {formatDistance(distanceM)}, arrives {arrivalLocalHhmm}.
              </>
            ) : (
              <>
                Rover drives {formatDistance(distanceM)}, arrives {arrivalLocalHhmm}.
              </>
            )}
          </p>
          {receipt && receipt.accepted && (
            <p className="s48-rover__log">
              Logged {receipt.logId}; copied to the habitat. The rover&rsquo;s own hazard checks decide.
            </p>
          )}
        </div>
      )}
    </section>
  );
};
