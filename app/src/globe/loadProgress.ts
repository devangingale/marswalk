export type LoadSource = 'terrain' | 'imagery' | 'bundles' | 'layers';
export type LoadSourceState = { status: 'pending' | 'loading' | 'ready' | 'failed'; progress: number };
export type MapLoadState = {
  sources: Record<LoadSource, LoadSourceState>;
  firstFrame: boolean;
  streaming: boolean;
};

const SOURCE_LABELS: Record<LoadSource, string> = {
  terrain: 'Mars terrain',
  imagery: 'site imagery',
  bundles: 'site data',
  layers: 'layers',
};

export function initialMapLoadState(): MapLoadState {
  const pending = (): LoadSourceState => ({ status: 'pending', progress: 0 });
  return {
    sources: { terrain: pending(), imagery: pending(), bundles: pending(), layers: pending() },
    firstFrame: false,
    streaming: false,
  };
}

export function updateLoadSource(state: MapLoadState, source: LoadSource, status: LoadSourceState['status'], progress?: number): MapLoadState {
  const boundedProgress = status === 'ready' || status === 'failed'
    ? 1
    : Math.max(0, Math.min(1, progress ?? state.sources[source].progress));
  return { ...state, sources: { ...state.sources, [source]: { status, progress: boundedProgress } } };
}

export function markFirstFrame(state: MapLoadState): MapLoadState {
  return { ...state, firstFrame: true };
}

export function setStreaming(state: MapLoadState, streaming: boolean): MapLoadState {
  return state.streaming === streaming ? state : { ...state, streaming };
}

export function mapLoadView(state: MapLoadState): { percent: number; line: string; failureLine: string | null; showOverlay: boolean; showSpinner: boolean } {
  const sources = Object.entries(state.sources) as [LoadSource, LoadSourceState][];
  const percent = Math.round(sources.reduce((sum, [, value]) => sum + value.progress, 0) / sources.length * 100);
  const active = sources.filter(([, value]) => value.status === 'pending' || value.status === 'loading').map(([source]) => SOURCE_LABELS[source]);
  const failed = sources.filter(([, value]) => value.status === 'failed').map(([source]) => SOURCE_LABELS[source]);
  const showOverlay = !state.firstFrame;
  return {
    percent,
    line: active.length ? `Loading ${active.join(' · ')}` : 'Preparing map',
    failureLine: failed.length ? `Could not load ${failed.join(' · ')}` : null,
    showOverlay,
    showSpinner: !showOverlay && state.streaming,
  };
}
