// Written with AI assistance, directed and reviewed by the team.
// Functional status glyphs (design README section 3: "Colour is never alone.
// Every state also has a shape and a word"). Shapes only, drawn in currentColor;
// no decorative icons. 1em square so they sit on the text baseline.
import React from 'react';

const base = {
  width: '1em',
  height: '1em',
  flex: 'none',
  'aria-hidden': true,
} as const;

/** Filled dot: a live link. */
export const DotFilled: React.FC = () => (
  <svg {...base} viewBox="0 0 16 16" role="img">
    <circle cx="8" cy="8" r="5" fill="currentColor" />
  </svg>
);

/** Hollow dot: a link that is queued or not live. */
export const DotHollow: React.FC = () => (
  <svg {...base} viewBox="0 0 16 16" role="img">
    <circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

/** Check in a circle: feasible / on pace. */
export const CheckCircle: React.FC = () => (
  <svg {...base} viewBox="0 0 16 16" role="img">
    <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5 8.2 7 10.2 11 5.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Downward notch (triangle): reserve / turn-back. */
export const Notch: React.FC = () => (
  <svg {...base} viewBox="0 0 16 16" role="img">
    <path d="M2.5 4 h11 L8 13 Z" fill="currentColor" />
  </svg>
);

/** Crossed square: unreachable / stop (hard). */
export const CrossSquare: React.FC = () => (
  <svg {...base} viewBox="0 0 16 16" role="img">
    <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5 5 L11 11 M11 5 L5 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

/** Radiating: an urgent, acknowledge-only alert (sunset / return-to-shelter). */
export const Alert: React.FC = () => (
  <svg {...base} viewBox="0 0 16 16" role="img">
    <path d="M8 2.5 L14 13 H2 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M8 6.5 V9.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="8" cy="11.4" r="0.9" fill="currentColor" />
  </svg>
);

/** Chevron: a disclosure that opens downward; rotated by CSS when open. */
export const Chevron: React.FC = () => (
  <svg {...base} viewBox="0 0 16 16" role="img">
    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
