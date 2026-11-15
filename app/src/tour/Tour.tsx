// Written with AI assistance, directed and reviewed by the team.
// The guided tour: Tour and Tour this tab in the top bar, and the spotlight overlay.
// The overlay blurs and dims everything but the step's section (four panes around a cut-out),
// so clicks outside the spotlight never reach the app; the popover beside it says what the
// section is, how to use it and why it matters on a Mars walk.

import React, { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { stepsFor, TAB_ORDER, type TourStep, type TourTab } from './steps';
import {
  CLOSED,
  currentStep,
  placePopover,
  rememberFinished,
  resolveAnchor,
  shouldAutoStart,
  spotlightRect,
  stepCount,
  tourReducer,
  tourStorage,
  type AnchorProbe,
  type Rect,
  type TourScope,
} from './tourState';
import './tour.css';

/** How long a step waits for its anchor (a tab loading, a panel opening) before the centred card says why. */
const ANCHOR_WAIT_MS = 1500;

const selector = (name: string) => `[data-tour="${name}"]`;

/** Every element with the name counts: the Visor readouts are three plates, spotlit together. */
const probe: AnchorProbe = (name) => {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selector(name)));
  if (elements.length === 0) return null;
  const shown = elements.filter((element) => element.getClientRects().length > 0 && !element.closest('[hidden]'));
  if (shown.length === 0) return { visible: false, rect: { top: 0, left: 0, width: 0, height: 0 } };
  const boxes = shown.map((element) => element.getBoundingClientRect());
  const top = Math.min(...boxes.map((b) => b.top));
  const left = Math.min(...boxes.map((b) => b.left));
  const bottom = Math.max(...boxes.map((b) => b.bottom));
  const right = Math.max(...boxes.map((b) => b.right));
  return { visible: true, rect: { top, left, width: right - left, height: bottom - top } };
};

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && Math.round(a.top) === Math.round(b.top) && Math.round(a.left) === Math.round(b.left)
    && Math.round(a.width) === Math.round(b.width) && Math.round(a.height) === Math.round(b.height));

const isTab = (value: string): value is TourTab => (TAB_ORDER as string[]).includes(value);

export interface TourControlsProps {
  /** The open tab. */
  tab: string;
  /** Switches tabs; a step on another tab calls it. */
  onTab: (tab: TourTab) => void;
}

/** Tour and Tour this tab buttons, plus the overlay while a tour runs. Starts itself on a first visit. */
export const TourControls: React.FC<TourControlsProps> = ({ tab, onTab }) => {
  const [state, dispatch] = useReducer(tourReducer, CLOSED);

  useEffect(() => {
    if (!shouldAutoStart(window.location.search, tourStorage())) return;
    dispatch({ type: 'start', scope: 'all' });
    // ?tour=1 is a one-off: a reload after Skip or Done does not start it again.
    const params = new URLSearchParams(window.location.search);
    if (params.has('tour')) {
      params.delete('tour');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }
  }, []);

  useEffect(() => {
    if (!state.open && state.finished) rememberFinished(tourStorage(), state.finished);
  }, [state]);

  const start = (scope: TourScope) => dispatch({ type: 'start', scope });
  const step = currentStep(state);

  return (
    <>
      <div className="s48-tour-start" role="group" aria-label="Guided tour">
        <button type="button" className="s48-btn s48-btn--secondary" onClick={() => start('all')}>
          Tour
        </button>
        {isTab(tab) && (
          <button type="button" className="s48-btn s48-btn--secondary" onClick={() => start(tab)} aria-label="Tour this tab">
            <span className="s48-tour-start__long">Tour this tab</span>
            <span className="s48-tour-start__short" aria-hidden="true">This tab</span>
          </button>
        )}
      </div>
      {state.open && step &&
        createPortal(
          <TourOverlay
            step={step}
            count={stepCount(state)}
            first={state.index === 0}
            last={state.index === stepsFor(state.scope).length - 1}
            tab={tab}
            onTab={onTab}
            onNext={() => dispatch({ type: 'next' })}
            onBack={() => dispatch({ type: 'back' })}
            onSkip={() => dispatch({ type: 'skip' })}
          />,
          document.body,
        )}
    </>
  );
};

interface OverlayProps {
  step: TourStep;
  count: string;
  first: boolean;
  last: boolean;
  tab: string;
  onTab: (tab: TourTab) => void;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

const viewportSize = () => ({ width: window.innerWidth, height: window.innerHeight });

const TourOverlay: React.FC<OverlayProps> = ({ step, count, first, last, tab, onTab, onNext, onBack, onSkip }) => {
  const [target, setTarget] = useState<{ rect: Rect | null; missing: boolean }>({ rect: null, missing: false });
  const [viewport, setViewport] = useState(viewportSize);
  const [size, setSize] = useState({ width: 360, height: 240 });
  const dialogRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const titleId = `s48-tour-title-${step.id}`;

  // The step's tab first; then find its anchor every frame, so it follows panels as they open,
  // tabs as they load and the window as it resizes.
  useEffect(() => {
    if (step.tab && step.tab !== tabRef.current) onTab(step.tab);
    const startedAt = performance.now();
    let triedOpen = false;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      setViewport((current) => {
        const next = viewportSize();
        return current.width === next.width && current.height === next.height ? current : next;
      });
      if (step.tab && step.tab !== tabRef.current) return;
      const result = resolveAnchor(step, probe, triedOpen);
      if (result.kind === 'open') {
        triedOpen = true;
        const handle = document.querySelector<HTMLElement>(selector(result.handle));
        // Already pressed (the panel is still rendering open): pressing again would close it.
        if (handle && handle.getAttribute('aria-expanded') !== 'true') handle.click();
        return;
      }
      const rect = result.kind === 'element' ? result.rect : null;
      const missing = result.kind === 'centre' && result.missing && performance.now() - startedAt > ANCHOR_WAIT_MS;
      setTarget((current) => (sameRect(current.rect, rect) && current.missing === missing ? current : { rect, missing }));
    };
    // First look on the next frame, so a mount-and-remount (React StrictMode) never presses a handle twice.
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // onTab is stable enough per step; the effect restarts only on a new step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Focus moves into the popover and returns to where it was when the tour closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      if (previous && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (!dialogRef.current?.contains(document.activeElement)) nextRef.current?.focus();
  }, [step]);

  // Esc closes from anywhere; Tab stays inside the popover; other keys in the popover stay out of the app.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onSkip();
        return;
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'));
        if (focusable.length === 0) return;
        const index = focusable.indexOf(document.activeElement as HTMLElement);
        const nextIndex = index === -1 ? 0 : (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
        event.preventDefault();
        event.stopPropagation();
        focusable[nextIndex].focus();
        return;
      }
      if (dialog.contains(event.target as Node)) event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onSkip]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const measure = () => {
      const next = { width: dialog.offsetWidth, height: dialog.offsetHeight };
      setSize((current) => (current.width === next.width && current.height === next.height ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dialog);
    return () => observer.disconnect();
  }, []);

  const cut = target.rect ? spotlightRect(target.rect, viewport) : null;
  const place = placePopover(cut, viewport, size);

  return (
    <div className="s48-tour" data-spotlight={cut ? 'true' : 'false'}>
      {cut ? (
        <>
          <div className="s48-tour__pane" style={{ top: 0, left: 0, width: viewport.width, height: cut.top }} />
          <div className="s48-tour__pane" style={{ top: cut.top + cut.height, left: 0, width: viewport.width, height: Math.max(0, viewport.height - cut.top - cut.height) }} />
          <div className="s48-tour__pane" style={{ top: cut.top, left: 0, width: cut.left, height: cut.height }} />
          <div className="s48-tour__pane" style={{ top: cut.top, left: cut.left + cut.width, width: Math.max(0, viewport.width - cut.left - cut.width), height: cut.height }} />
          <div className="s48-tour__ring" style={{ top: cut.top, left: cut.left, width: cut.width, height: cut.height }} aria-hidden="true" />
        </>
      ) : (
        <div className="s48-tour__pane" style={{ top: 0, left: 0, width: viewport.width, height: viewport.height }} />
      )}
      <div
        ref={dialogRef}
        className="s48-tour__pop"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-side={place.side}
        style={{ top: place.top, left: place.left }}
      >
        <p className="s48-tour__count num">{count}</p>
        <h2 id={titleId} className="s48-tour__title">{step.title}</h2>
        <div className="s48-tour__lines">
          {step.lines.map((line) =>
            line.label ? (
              <p key={line.label} className="s48-tour__line">
                <span className="s48-tour__label">{line.label}</span>
                <span>{line.text}</span>
              </p>
            ) : (
              <p key={line.text} className="s48-tour__line s48-tour__line--plain">{line.text}</p>
            ),
          )}
        </div>
        {target.missing && step.missing && <p className="s48-tour__note">{step.missing}</p>}
        <div className="s48-tour__actions">
          <button type="button" className="s48-btn s48-btn--quiet" onClick={onSkip}>
            Skip
          </button>
          <span className="s48-tour__grow" />
          <button type="button" className="s48-btn s48-btn--secondary" onClick={onBack} disabled={first}>
            Back
          </button>
          <button type="button" ref={nextRef} className="s48-btn s48-btn--primary" onClick={onNext}>
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};
