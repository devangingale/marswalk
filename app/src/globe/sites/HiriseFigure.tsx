// Written with AI assistance, directed and reviewed by the team.
// HiRISE image section of the site card: a thumbnail cropped around the site, the
// observation details and credit, and a full-image viewer (native dialog, Esc closes).

import React, { useEffect, useRef, useState } from 'react';
import { HiriseView, thumbCrop } from './hirise';

/** Width / height of the card thumbnail; matches .sites-hirise__thumb in sites.css. */
const THUMB_ASPECT = 4 / 3;

interface HiriseFigureProps {
  view: HiriseView;
}

export const HiriseFigure: React.FC<HiriseFigureProps> = ({ view }) => {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (view.kind === 'none') {
    return (
      <section className="sites-hirise" aria-label="HiRISE image">
        <p className="sites-hirise__none">No HiRISE image covers this site</p>
      </section>
    );
  }

  const crop = thumbCrop(view.width, view.height, view.marker, THUMB_ASPECT);
  const markerAt = (at: { x: number; y: number } | null) =>
    at && <span className="sites-hirise__marker" style={{ left: `${at.x}%`, top: `${at.y}%` }} aria-hidden="true" />;

  return (
    <section className="sites-hirise" aria-label="HiRISE image">
      <button
        type="button"
        className="sites-hirise__thumb"
        onClick={() => setOpen(true)}
        aria-label={`Open HiRISE image ${view.observationId} larger`}
      >
        <img
          src={view.src}
          alt={view.alt}
          width={view.width}
          height={view.height}
          loading="lazy"
          decoding="async"
          style={{ objectPosition: crop.position }}
        />
        {markerAt(crop.marker)}
      </button>
      <dl className="sites-hirise__meta">
        <div>
          <dt>HiRISE</dt>
          <dd>
            <a href={view.pageUrl} target="_blank" rel="noreferrer">
              {view.observationId}
            </a>
          </dd>
        </div>
        <div>
          <dt>Acquired</dt>
          <dd>{view.date}</dd>
        </div>
        <div>
          <dt>Resolution</dt>
          <dd>{view.resolution}</dd>
        </div>
      </dl>
      <p className="sites-hirise__credit">{view.credit}</p>

      <dialog
        ref={dialogRef}
        className="sites-hirise-viewer"
        aria-label={view.alt}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        {open && (
          <figure className="sites-hirise-viewer__figure">
            <div className="sites-hirise-viewer__frame">
              <img src={view.src} alt={view.alt} width={view.width} height={view.height} />
              {markerAt(view.marker)}
            </div>
            <figcaption className="sites-hirise-viewer__caption">
              <a href={view.pageUrl} target="_blank" rel="noreferrer">
                {view.observationId}
              </a>
              <span>{view.date}</span>
              <span>{view.resolution}</span>
              <span>{view.credit}</span>
              <button type="button" className="s48-btn s48-btn--secondary" onClick={() => setOpen(false)}>
                Close
              </button>
            </figcaption>
          </figure>
        )}
      </dialog>
    </section>
  );
};
