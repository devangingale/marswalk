// Written with AI assistance, directed and reviewed by the team.
import React, { useEffect, useState } from 'react';
import {
  SOS_REASONS,
  holdProgress,
  cancelRemainingMs,
  type SosController,
  type SosState,
  type SosReason,
} from './sos';
import type { EarthArrivalEstimate } from './relayStrip';
import { NBSP } from './format';
import { DotFilled, Alert } from './glyphs';

/**
 * SOS control (design: "SOS and relay scheduler"). Hold 2 s to arm, 10 s to
 * cancel, then sent. On sending, the always-on habitat link marks it received at
 * once (simulated adapter), and the packet enters the relay queue at top
 * priority with the next real pass and an estimated Earth arrival.
 */
export const SosControl: React.FC<{
  controller: SosController;
  state: SosState;
  reason: SosReason;
  onReason: (r: SosReason) => void;
  earthArrival: EarthArrivalEstimate | null;
  queuedBefore: number;
}> = ({ controller, state, reason, onReason, earthArrival, queuedBefore }) => {
  const [, setFrame] = useState(0);

  // While holding or armed, re-render often so the progress and countdown move.
  useEffect(() => {
    if (state.phase !== 'holding' && state.phase !== 'armed') return;
    const id = setInterval(() => setFrame((f) => f + 1), 100);
    return () => clearInterval(id);
  }, [state.phase]);

  const now = Date.now();
  const progress = holdProgress(state, now);
  const cancelLeftS = Math.ceil(cancelRemainingMs(state, now) / 1000);

  return (
    <section className="s48-sos" aria-label="SOS">
      <div className="s48-sos__head">
        <h3>SOS</h3>
        {/* Once sent, the sent line names the reason; the picker steps aside. */}
        {state.phase !== 'sent' && (
          <div className="s48-seg s48-seg--sm s48-sos__reasons" role="group" aria-label="SOS reason">
            {SOS_REASONS.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={reason === r.id}
                onClick={() => onReason(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {state.phase !== 'sent' ? (
        <>
          <button
            type="button"
            className={`s48-sos__btn ${state.phase === 'armed' ? 'is-armed' : ''} ${
              state.phase === 'holding' ? 'is-holding' : ''
            }`}
            style={{ ['--hold' as string]: progress }}
            onPointerDown={() => controller.press()}
            onPointerUp={() => controller.release()}
            onPointerLeave={() => controller.release()}
          >
            <span className="s48-sos__btn-fill" />
            <span className="s48-sos__btn-text">
              <Alert />
              {state.phase === 'armed'
                ? 'SOS armed'
                : state.phase === 'holding'
                  ? 'Keep holding; release to cancel'
                  : 'Hold 2 s to send SOS'}
            </span>
          </button>

          {state.phase === 'armed' && (
            <div className="s48-sos__armed">
              <p>
                Sending in {cancelLeftS}
                {NBSP}s
              </p>
              <button
                type="button"
                className="s48-btn s48-btn--secondary s48-btn--sm"
                onClick={() => controller.cancel()}
              >
                Cancel
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="s48-sos__sent">
          <p className="s48-sos__sent-head">
            <Alert /> SOS sent · {reasonLabel(reason)}
          </p>
          <ul className="s48-sos__links">
            <li className="is-received">
              <DotFilled /> Habitat received now over the local link
            </li>
            <li>
              Relay queue: top priority, ahead of {queuedBefore} item{queuedBefore === 1 ? '' : 's'}
            </li>
            {earthArrival ? (
              <li>
                Earth via {earthArrival.pass.orbiter} pass {earthArrival.sendLocalHhmm} · receives
                {NBSP}~{earthArrival.earthUtcHhmm}
                {NBSP}UTC (+{earthArrival.lightMin}
                {NBSP}min light time)
              </li>
            ) : (
              <li>No orbiter pass left this sol; held for the next window.</li>
            )}
          </ul>
          <button
            type="button"
            className="s48-btn s48-btn--secondary s48-btn--sm"
            onClick={() => controller.reset()}
          >
            Stand down
          </button>
        </div>
      )}
    </section>
  );
};

function reasonLabel(reason: SosReason): string {
  return SOS_REASONS.find((r) => r.id === reason)?.label ?? reason;
}
