import { describe, expect, it } from 'vitest';
import { playbackKeyAction, PlaybackKeyTarget, playbackSeekTarget } from './playbackKeys';

describe('playbackKeyAction', () => {
  const body: PlaybackKeyTarget = { tagName: 'body' };

  it('toggles playback on Space whether or not the track has a route', () => {
    expect(playbackKeyAction(' ', body, true)).toBe('toggle');
    expect(playbackKeyAction(' ', body, false)).toBe('toggle');
  });

  it('ignores Space, arrows and page keys in text editing controls', () => {
    const targets: PlaybackKeyTarget[] = [
      { tagName: 'input', type: 'text' },
      { tagName: 'textarea' },
      { tagName: 'select' },
      { tagName: 'div', isContentEditable: true },
    ];
    for (const target of targets) {
      for (const key of [' ', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']) {
        expect(playbackKeyAction(key, target, true)).toBeNull();
      }
    }
  });

  it('steps with the arrows and jumps by stop with the page keys', () => {
    expect(playbackKeyAction('ArrowLeft', body, true)).toBe('step-back');
    expect(playbackKeyAction('ArrowRight', body, true)).toBe('step-forward');
    expect(playbackKeyAction('PageUp', body, true)).toBe('previous-stop');
    expect(playbackKeyAction('PageDown', body, true)).toBe('next-stop');
    expect(playbackKeyAction('ArrowRight', body, false)).toBeNull();
    expect(playbackKeyAction('PageDown', body, false)).toBeNull();
  });

  it('handles the keys on the scrubber itself', () => {
    expect(playbackKeyAction(' ', { tagName: 'input', type: 'range' }, true)).toBe('toggle');
    expect(playbackKeyAction('ArrowRight', { tagName: 'input', type: 'range' }, true)).toBe('step-forward');
    expect(playbackKeyAction('Enter', body, true)).toBeNull();
  });
});

describe('playbackSeekTarget', () => {
  const stops = [1000, 2500];
  const duration = 4000;

  it('steps 1 % of the walk and stops at the ends', () => {
    expect(playbackSeekTarget('step-forward', 100, duration, stops)).toBe(140);
    expect(playbackSeekTarget('step-back', 100, duration, stops)).toBe(60);
    expect(playbackSeekTarget('step-back', 20, duration, stops)).toBe(0);
    expect(playbackSeekTarget('step-forward', 3990, duration, stops)).toBe(4000);
    expect(playbackSeekTarget('step-forward', 4000, duration, stops)).toBeNull();
    expect(playbackSeekTarget('step-back', 0, duration, stops)).toBeNull();
  });

  it('jumps stop to stop and reaches the finish', () => {
    expect(playbackSeekTarget('next-stop', 0, duration, stops)).toBe(1000);
    expect(playbackSeekTarget('next-stop', 1000, duration, stops)).toBe(2500);
    expect(playbackSeekTarget('next-stop', 2500, duration, stops)).toBe(4000);
    expect(playbackSeekTarget('next-stop', 4000, duration, stops)).toBeNull();
  });

  it('jumps back to the previous stop and then the start', () => {
    expect(playbackSeekTarget('previous-stop', 4000, duration, stops)).toBe(2500);
    expect(playbackSeekTarget('previous-stop', 1500, duration, stops)).toBe(1000);
    expect(playbackSeekTarget('previous-stop', 1000, duration, stops)).toBe(0);
    expect(playbackSeekTarget('previous-stop', 0, duration, stops)).toBeNull();
  });

  it('does nothing without a route', () => {
    expect(playbackSeekTarget('next-stop', 0, 0, [])).toBeNull();
    expect(playbackSeekTarget('step-forward', 0, 0, [])).toBeNull();
  });
});
