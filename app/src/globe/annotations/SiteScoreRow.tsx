// Written with AI assistance, directed and reviewed by the team.
// Rank, score and the five group scores as one compact row of bars in the site-score green.

import React from 'react';
import { formatScore, scoreBucket } from '../sites/format';
import { GROUP_KEYS, GROUP_LABELS, type GroupKey } from '../sites/types';
import './annotations.css';

interface SiteScoreRowProps {
  score: number;
  rank: number | null;
  groups: Record<GroupKey, number>;
}

export const SiteScoreRow: React.FC<SiteScoreRowProps> = ({ score, rank, groups }) => (
  <div className="xa-score">
    <dl className="xa-score__head">
      {rank !== null && (
        <div>
          <dt>Rank</dt>
          <dd>{rank}</dd>
        </div>
      )}
      <div>
        <dt>Score</dt>
        <dd>
          {formatScore(score)}
          <span className="xa-score__of"> of 100</span>
        </dd>
      </div>
    </dl>
    <dl className="xa-score__groups">
      {GROUP_KEYS.map((key) => {
        const value = Math.max(0, Math.min(100, groups[key]));
        return (
          <div key={key} className="xa-score__group">
            <dt>{GROUP_LABELS[key]}</dt>
            <dd className="xa-score__val">{formatScore(value)}</dd>
            <dd className="xa-score__bar" aria-hidden="true">
              <span className={`xa-score__fill xa-score__fill--${scoreBucket(value)}`} style={{ height: `${value}%` }} />
            </dd>
          </div>
        );
      })}
    </dl>
  </div>
);
