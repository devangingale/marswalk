import { describe, expect, it } from 'vitest';
import { initialMapLoadState, mapLoadView, markFirstFrame, setStreaming, updateLoadSource } from './loadProgress';

describe('map load progress', () => {
  it('reports only observed source progress and names pending work', () => {
    let state = initialMapLoadState();
    state = updateLoadSource(state, 'terrain', 'loading', 0.5);
    expect(mapLoadView(state)).toMatchObject({ percent: 13, line: 'Loading Mars terrain · site imagery · site data · layers', showOverlay: true });
    state = updateLoadSource(state, 'imagery', 'ready');
    expect(mapLoadView(state).percent).toBe(38);
  });

  it('keeps failures visible while waiting for the first frame and reports them after it', () => {
    let state = initialMapLoadState();
    state = updateLoadSource(state, 'layers', 'failed');
    expect(mapLoadView(state)).toMatchObject({ showOverlay: true, failureLine: 'Could not load layers' });
    state = markFirstFrame(state);
    expect(mapLoadView(state)).toMatchObject({ showOverlay: false, failureLine: 'Could not load layers' });
  });

  it('shows a text-free spinner only after the initial overlay is gone', () => {
    let state = initialMapLoadState();
    for (const source of ['terrain', 'imagery', 'bundles', 'layers'] as const) state = updateLoadSource(state, source, 'ready');
    state = setStreaming(markFirstFrame(state), true);
    expect(mapLoadView(state)).toMatchObject({ showOverlay: false, showSpinner: true });
  });
});
