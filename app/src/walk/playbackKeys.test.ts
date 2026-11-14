import { describe, expect, it } from 'vitest';
import { playbackKeyAction, PlaybackKeyTarget } from './playbackKeys';

describe('playbackKeyAction', () => {
  const body: PlaybackKeyTarget = { tagName: 'body' };

  it('toggles playback on Space whether or not the track has stops', () => {
    expect(playbackKeyAction(' ', body, true)).toBe('toggle');
    expect(playbackKeyAction(' ', body, false)).toBe('toggle');
  });

  it('ignores Space and arrows in text editing controls', () => {
    const targets: PlaybackKeyTarget[] = [
      { tagName: 'input', type: 'text' },
      { tagName: 'textarea' },
      { tagName: 'select' },
      { tagName: 'div', isContentEditable: true },
    ];
    for (const target of targets) {
      expect(playbackKeyAction(' ', target, true)).toBeNull();
      expect(playbackKeyAction('ArrowLeft', target, true)).toBeNull();
      expect(playbackKeyAction('ArrowRight', target, true)).toBeNull();
    }
  });

  it('steps to adjacent stops only when the track has stops', () => {
    expect(playbackKeyAction('ArrowLeft', body, true)).toBe('previous-stop');
    expect(playbackKeyAction('ArrowRight', body, true)).toBe('next-stop');
    expect(playbackKeyAction('ArrowLeft', body, false)).toBeNull();
    expect(playbackKeyAction('ArrowRight', body, false)).toBeNull();
  });

  it('leaves other keys and non-text inputs alone', () => {
    expect(playbackKeyAction('Enter', body, true)).toBeNull();
    expect(playbackKeyAction(' ', { tagName: 'input', type: 'range' }, true)).toBe('toggle');
  });
});
