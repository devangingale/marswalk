// Written with AI assistance, directed and reviewed by the team.
// "View" button in the Explore map controls: a small menu of map toggles (slopes, grid),
// so the control row stays on one line.

import React, { useEffect, useId, useRef, useState } from 'react';

export interface ViewToggle {
  label: string;
  checked: boolean;
  onChange: () => void;
}

export const ViewMenu: React.FC<{ toggles: ViewToggle[] }> = ({ toggles }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Close on a press outside the menu or on Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="explore-view" ref={rootRef}>
      <button
        type="button"
        className="s48-btn s48-btn--secondary"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        View
      </button>
      <div id={menuId} className="explore-view__menu" hidden={!open}>
        {toggles.map((t) => (
          <label key={t.label}>
            <input type="checkbox" className="s48-check" checked={t.checked} onChange={t.onChange} />
            <span>{t.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
};
