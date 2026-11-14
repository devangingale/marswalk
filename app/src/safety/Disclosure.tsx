// Written with AI assistance, directed and reviewed by the team.
import React from 'react';
import { Chevron } from './glyphs';

/**
 * A panel header toggle for the safety column: the panel's title (and an
 * optional one-line summary) on a full-width button that opens or closes the
 * panel's detail. The state is the caller's, so the panel keeps its live parts.
 */
export const DisclosureButton: React.FC<{
  open: boolean;
  onToggle: () => void;
  controls: string;
  children: React.ReactNode;
}> = ({ open, onToggle, controls, children }) => (
  <button
    type="button"
    className={`s48-disclosure ${open ? 'is-open' : ''}`}
    aria-expanded={open}
    aria-controls={controls}
    onClick={onToggle}
  >
    <span className="s48-disclosure__label">{children}</span>
    <span className="s48-disclosure__chev">
      <Chevron />
    </span>
  </button>
);
