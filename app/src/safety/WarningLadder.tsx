// Written with AI assistance, directed and reviewed by the team.
import React from 'react';
import type { LadderLevel, LadderResult, ShelterChoice, Hazard } from './ladder';
import { formatDuration, formatSignedDuration, formatDistance, NBSP } from './format';
import { CheckCircle, Notch, Alert } from './glyphs';

const RUNGS: { level: LadderLevel; label: string }[] = [
  { level: 'ok', label: 'On pace' },
  { level: 'behind-pace', label: 'Behind pace' },
  { level: 'turn-back', label: 'Turn back' },
  { level: 'return-to-shelter', label: 'Return to shelter' },
];

const TONE_CLASS: Record<LadderLevel, string> = {
  ok: 'is-ok',
  'behind-pace': 'is-caution',
  'turn-back': 'is-danger',
  'return-to-shelter': 'is-danger',
};

function LevelGlyph({ level }: { level: LadderLevel }): React.ReactElement {
  if (level === 'ok') return <CheckCircle />;
  if (level === 'return-to-shelter') return <Alert />;
  return <Notch />;
}

const HAZARDS: { id: Hazard; label: string }[] = [
  { id: 'daylight', label: 'Daylight' },
  { id: 'pace', label: 'Pace' },
  { id: 'radiation', label: 'Radiation' },
  { id: 'dust', label: 'Dust' },
];

/**
 * The warning ladder in Mars mode: large-type headline in the rung's colour, the
 * supporting numbers, the four-rung ladder, and the shelter the hazard selects.
 */
export const WarningLadder: React.FC<{
  result: LadderResult;
  hazard: Hazard;
  shelter: ShelterChoice | null;
  shelterEtaS: number | null;
  onHazardChange: (h: Hazard) => void;
}> = ({ result, hazard, shelter, shelterEtaS, onHazardChange }) => {
  const rank = RUNGS.findIndex((r) => r.level === result.level);
  return (
    <section className={`s48-ladder ${TONE_CLASS[result.level]}`} aria-label="Warning ladder">
      <div className="s48-ladder__head">
        <span className="s48-ladder__glyph">
          <LevelGlyph level={result.level} />
        </span>
        <h2 className="s48-ladder__headline">{result.headline}</h2>
      </div>
      <p className="s48-ladder__detail">{result.detail}</p>

      <dl className="s48-ladder__figs">
        <div>
          <dt>Sunset</dt>
          <dd>
            {result.minutesToSunset >= 0
              ? `in ${formatDuration(result.minutesToSunset * 60000)}`
              : `${formatDuration(-result.minutesToSunset * 60000)} ago`}
          </dd>
        </div>
        <div>
          <dt>Back-by</dt>
          <dd>
            {result.minutesToBackBy >= 0
              ? `in ${formatDuration(result.minutesToBackBy * 60000)}`
              : `${formatDuration(-result.minutesToBackBy * 60000)} ago`}
          </dd>
        </div>
        <div>
          <dt>Arrival vs back-by</dt>
          <dd>{formatSignedDuration(result.arrivalAfterBackByMin)}</dd>
        </div>
      </dl>

      <ol className="s48-ladder__rungs" aria-label="Escalation">
        {RUNGS.map((r, i) => (
          <li
            key={r.level}
            className={`${TONE_CLASS[r.level]} ${i === rank ? 'is-current' : ''} ${
              i < rank ? 'is-passed' : ''
            }`}
          >
            <span className="s48-ladder__rung-dot" />
            {r.label}
          </li>
        ))}
      </ol>

      <div className="s48-ladder__shelter">
        <div className="s48-seg s48-seg--sm" role="group" aria-label="Hazard">
          {HAZARDS.map((h) => (
            <button
              key={h.id}
              type="button"
              aria-pressed={hazard === h.id}
              onClick={() => onHazardChange(h.id)}
            >
              {h.label}
            </button>
          ))}
        </div>
        {shelter ? (
          <p className="s48-ladder__shelter-line">
            <span className="s48-ladder__shelter-name">{shelterName(shelter)}</span>
            <span className="s48-ladder__shelter-dist">
              {formatDistance(shelter.shelter.distanceM)}
              {shelterEtaS !== null ? (
                <>
                  {NBSP}·{NBSP}
                  {formatDuration(shelterEtaS * 1000)}
                </>
              ) : null}
            </span>
          </p>
        ) : (
          <p className="s48-ladder__shelter-line s48-ladder__shelter-line--none">
            No shelter of this kind in range.
          </p>
        )}
        {shelter && <p className="s48-ladder__shelter-reason">{shelter.reason}</p>}
      </div>
    </section>
  );
};

function shelterName(choice: ShelterChoice): string {
  switch (choice.shelter.kind) {
    case 'habitat':
      return 'Habitat';
    case 'rover':
      return 'Pressurised rover';
    case 'dropoff':
      return 'Rover drop-off';
    case 'cave':
      return 'Surveyed cave';
    case 'terrain-shield':
      return 'Terrain-shielded spot';
  }
}
