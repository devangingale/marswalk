// Written with AI assistance, directed and reviewed by the team.
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { currentBeeperStep, type BeeperStep } from './beeper';
import type { BeeperPlayer } from './beeperPlayer';
import { formatLocalClock, formatDuration, NBSP } from './format';
import { DisclosureButton } from './Disclosure';

/**
 * Daylight beeper (design: "Daylight beeper"). Shows the four-step countdown to
 * nightfall and plays the tone that matches the live warning level. No sound
 * before a user gesture: the player's AudioContext starts only when the crew
 * turns sound on. Advisory tones can be muted; the turn-back and sunset tones
 * can only be acknowledged.
 */
export const DaylightBeeper: React.FC<{
  schedule: BeeperStep[];
  nowMs: number;
  lonEastDeg: number;
  player: BeeperPlayer;
}> = ({ schedule, nowMs, lonEastDeg, player }) => {
  const [audioOn, setAudioOn] = useState(false);
  const [mutedAdvisory, setMutedAdvisory] = useState(false);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(() => new Set());
  const lastKeyRef = useRef<string>('');
  const [open, setOpen] = useState(false);
  const stepsId = useId();

  const current = useMemo(
    () => currentBeeperStep(schedule, nowMs, acknowledged),
    [schedule, nowMs, acknowledged],
  );

  const silenced =
    current === null ||
    (current.control === 'mutable' && mutedAdvisory) ||
    (current.control === 'acknowledge' && acknowledged.has(current.id));

  // Drive the player when the audible step (or its silencing) changes.
  useEffect(() => {
    const key = `${audioOn ? '1' : '0'}:${current ? current.id : 'none'}:${silenced ? 's' : 'a'}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    if (!audioOn || silenced || current === null) {
      player.stop();
      return;
    }
    player.play(current.level, current.tones, current.repeating);
  }, [audioOn, current, silenced, player]);

  const toggleAudio = () => {
    if (!audioOn) void player.resume();
    else player.suspend();
    setAudioOn((v) => !v);
  };

  const acknowledge = (id: string) =>
    setAcknowledged((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  return (
    <section className="s48-beeper" aria-label="Daylight beeper">
      <div className="s48-beeper__head">
        <h3 className="s48-panel-head">
          <DisclosureButton open={open} onToggle={() => setOpen((v) => !v)} controls={stepsId}>
            Daylight beeper
          </DisclosureButton>
        </h3>
        <button
          type="button"
          className="s48-btn s48-btn--secondary s48-btn--sm"
          aria-pressed={audioOn}
          onClick={toggleAudio}
        >
          {audioOn ? 'Sound on' : 'Turn sound on'}
        </button>
      </div>

      <ol className="s48-beeper__steps" id={stepsId}>
        {(open ? schedule : focusStep(schedule, nowMs, current)).map((step) => {
          const live = current?.id === step.id && !silenced;
          const past = step.atMs <= nowMs;
          const acked = acknowledged.has(step.id);
          const toNow = step.atMs - nowMs;
          return (
            <li
              key={step.id}
              className={`s48-beeper__step is-${step.level} ${live ? 'is-live' : ''} ${
                past ? 'is-past' : ''
              } ${acked ? 'is-acked' : ''}`}
            >
              <span className="s48-beeper__time">{formatLocalClock(step.atMs, lonEastDeg)}</span>
              <span className="s48-beeper__label">{step.label}</span>
              <span className="s48-beeper__tones" aria-label={`${step.tones} tone`}>
                {Array.from({ length: step.tones }).map((_, i) => (
                  <span key={i} className="s48-beeper__pip" />
                ))}
                {step.repeating && <span className="s48-beeper__rep">repeats</span>}
              </span>
              <span className="s48-beeper__when">
                {live ? 'now' : past ? 'passed' : `in${NBSP}${formatDuration(toNow)}`}
              </span>
            </li>
          );
        })}
      </ol>

      {current && (
        <div className="s48-beeper__controls">
          {current.control === 'mutable' ? (
            <button
              type="button"
              className="s48-btn s48-btn--secondary s48-btn--sm"
              aria-pressed={mutedAdvisory}
              onClick={() => setMutedAdvisory((v) => !v)}
            >
              {mutedAdvisory ? 'Advisory muted' : 'Mute advisory'}
            </button>
          ) : acknowledged.has(current.id) ? (
            <span className="s48-beeper__acked">Acknowledged</span>
          ) : (
            <button
              type="button"
              className={`s48-btn s48-btn--sm s48-beeper__ack is-${current.level}`}
              onClick={() => acknowledge(current.id)}
            >
              Acknowledge
            </button>
          )}
          {!audioOn && <span className="s48-beeper__note">No sound until you turn it on.</span>}
        </div>
      )}
    </section>
  );
};

/**
 * The one step the collapsed beeper shows: the sounding step, else the next one
 * to come, else the last (all passed).
 */
function focusStep(schedule: BeeperStep[], nowMs: number, current: BeeperStep | null): BeeperStep[] {
  if (current) return [current];
  const next = schedule.find((s) => s.atMs > nowMs);
  if (next) return [next];
  return schedule.length > 0 ? [schedule[schedule.length - 1]] : [];
}
