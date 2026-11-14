export type PlaybackKeyAction = 'toggle' | 'previous-stop' | 'next-stop';

export interface PlaybackKeyTarget {
  tagName?: string | null;
  type?: string | null;
  isContentEditable?: boolean;
}

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

export function playbackKeyAction(
  key: string,
  target: PlaybackKeyTarget | null,
  hasStops: boolean,
): PlaybackKeyAction | null {
  if (isEditableTarget(target)) return null;
  if (key === ' ' || key === 'Spacebar') return 'toggle';
  if (!hasStops) return null;
  if (key === 'ArrowLeft') return 'previous-stop';
  if (key === 'ArrowRight') return 'next-stop';
  return null;
}
