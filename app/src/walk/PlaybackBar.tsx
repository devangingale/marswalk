import { formatDuration } from './format';
import { Playback } from './usePlayback';
import '../components/walk.css';

export function PlaybackBar({ playback, durationS, elapsedS }: { playback: Playback; durationS: number; elapsedS: number }) {
  return <div className="s48-playback">
    <button type="button" className="s48-walk-play" onClick={playback.toggle}
      aria-label={playback.playing ? 'Pause (Space)' : 'Play (Space)'}
      aria-keyshortcuts="Space ArrowLeft ArrowRight"
      title="Space: play or pause · Left/Right: previous or next stop">
      {playback.playing ? 'Pause' : 'Play'}
    </button>
    <input aria-label="Walk position" type="range" min={0} max={durationS} step={1} value={elapsedS} onChange={(event) => playback.seek(Number(event.target.value))} />
    <output>{formatDuration(elapsedS)} / {formatDuration(durationS)}</output><span>x60</span>
  </div>;
}
