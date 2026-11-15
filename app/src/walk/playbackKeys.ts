export type PlaybackKeyAction = 'toggle' | 'step-back' | 'step-forward' | 'previous-stop' | 'next-stop';

export interface PlaybackKeyTarget {
  tagName?: string | null;
  type?: string | null;
  isContentEditable?: boolean;
}

/** Arrow keys move the walk by this share of its duration. */
export const STEP_FRACTION = 0.01;

const nonTextInputTypes = new Set([
  'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range',
  'reset', 'submit',
]);

function isEditableTarget(target: PlaybackKeyTarget | null): boolean {
  if (!target) return false;
  const tagName = target.tagName?.toLowerCase();
  if (target.isContentEditable || tagName === 'textarea' || tagName === 'select') return true;
  if (tagName !== 'input') return false;
  return !nonTextInputTypes.has((target.type ?? 'text').toLowerCase());
}

/**
 * Space plays or pauses; Left and Right step 1 % of the walk; Page Up and Page Down
 * jump to the previous or next stop, and Page Down from the last stop reaches the finish.
 */
export function playbackKeyAction(
  key: string,
  target: PlaybackKeyTarget | null,
  hasStops: boolean,
): PlaybackKeyAction | null {
  if (isEditableTarget(target)) return null;
  if (key === ' ' || key === 'Spacebar') return 'toggle';
  if (!hasStops) return null;
  if (key === 'ArrowLeft') return 'step-back';
  if (key === 'ArrowRight') return 'step-forward';
  if (key === 'PageUp') return 'previous-stop';
  if (key === 'PageDown') return 'next-stop';
  return null;
}

/**
 * Where a seek action lands. `stopTimes` are the arrival times at each stop; the start
 * (0) and the finish (`durationS`) are always targets, so the last jump reaches the end.
 * Null when there is nowhere to go.
 */
export function playbackSeekTarget(
  action: Exclude<PlaybackKeyAction, 'toggle'>,
  currentS: number,
  durationS: number,
  stopTimes: number[],
): number | null {
  if (durationS <= 0) return null;
  const clamp = (s: number) => Math.min(Math.max(s, 0), durationS);
  if (action === 'step-back' || action === 'step-forward') {
    const step = durationS * STEP_FRACTION;
    const next = clamp(currentS + (action === 'step-back' ? -step : step));
    return next === currentS ? null : next;
  }
  const marks = [...new Set([0, ...stopTimes.map(clamp), durationS])].sort((a, b) => a - b);
  const target = action === 'previous-stop'
    ? marks.filter((time) => time < currentS - 0.01).at(-1)
    : marks.find((time) => time > currentS + 0.01);
  return target ?? null;
}
