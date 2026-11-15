// Written with AI assistance, directed and reviewed by the team.
// Left panel on Explore and Plan: what is on now, then This site and Whole planet, each made of
// collapsible groups whose open state is remembered per tab.

import React, { useCallback, useId, useState } from 'react';
import { SiteLayer, LayerState } from '../types';
import '../shell/shell.css';
import type { RoverOverlayState } from '../types';
import {
  formatResolution,
  getLayerDisplayName,
  getLayerSourceAgency,
  formatLegendValue,
  cleanUnits,
} from '../shell/layerFormat';
import { GlobeLayer, legendSteps } from '../globe/layerManifest';
import {
  buildGroups,
  gridText,
  isGroupOpen,
  readOpenGroups,
  shortCitation,
  writeOpenGroups,
  type GroupItem,
  type LayerSection,
  type PanelGroup,
} from '../shell/layerGroups';

const LEGEND_STEPS = 16;

export interface CaveOverlay {
  enabled: boolean;
  count: number;
  credit: string;
  /** Distance to the nearest candidate, shown while the layer is on. */
  atSite?: string;
  onToggle: () => void;
}

/** Whole-planet temperature entry: the row is drawn by its owner, the rest feeds On now. */
export interface TemperatureEntry {
  enabled: boolean;
  row: React.ReactNode;
  atSite?: string;
  opacity?: number;
  onToggle?: () => void;
  onOpacityChange?: (opacity: number) => void;
  /** CSS background for the legend bar. */
  legend?: string;
}

/** The animated dust history driven by the Explore clock. */
export interface DustHistoryEntry {
  enabled: boolean;
  onToggle: () => void;
  /** One short line under the row and in On now, such as why it came on. */
  note?: string;
  /** CSS background for the legend bar. */
  legend?: string;
  credit?: string;
}

interface LayerPanelProps {
  layers: SiteLayer[];
  layerStates: Record<string, LayerState>;
  roverOverlayState?: RoverOverlayState;
  photosAvailable?: boolean;
  onToggleRoverOverlay?: (layer: keyof RoverOverlayState) => void;
  globalLayers?: GlobeLayer[];
  globalStates?: Record<string, LayerState>;
  onToggleGlobal?: (layerId: string) => void;
  onGlobalOpacityChange?: (layerId: string, opacity: number) => void;
  /** Extra content under an enabled whole-planet layer's legend, by layer id. */
  globalDetail?: Record<string, React.ReactNode>;
  caves?: CaveOverlay;
  /** Whole-planet temperature entry, shown in its own group. */
  temperature?: TemperatureEntry;
  /** Dust history from the clock, shown in the Dust group. */
  dustHistory?: DustHistoryEntry;
  /** Value of each shown whole-planet layer at the site, such as 312 µGy/day; keyed by layer id. */
  siteValues?: Record<string, string>;
  onToggleLayer: (layerId: string) => void;
  onOpacityChange: (layerId: string, opacity: number) => void;
  /** Key for the remembered open groups, one per tab. */
  panelId?: string;
  /** Outside the shared layout the panel hides itself; in a Regions panel it is always shown. */
  isOpen?: boolean;
  onTogglePanel?: () => void;
}

/** One layer in On now: the compact row at the top of the panel. */
interface NowSpec {
  name: string;
  note?: string;
  opacity?: number;
  onOpacity?: (opacity: number) => void;
  legend?: React.ReactNode;
  onRemove: () => void;
}

interface Entry extends GroupItem {
  row: React.ReactNode;
  now?: NowSpec;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function rampBar(background: string): React.ReactNode {
  return <div className="s48-legend__ramp" style={{ background }} aria-hidden="true" />;
}

function stepsBar(layer: GlobeLayer): React.ReactNode {
  return (
    <div className="s48-legend__ramp s48-legend__ramp--steps" aria-hidden="true">
      {legendSteps(layer.legend.stops, layer.legend.min, layer.legend.max, LEGEND_STEPS).map((colour, i) => (
        <i key={i} style={{ background: colour }} />
      ))}
    </div>
  );
}

function siteRamp(layer: SiteLayer): string | null {
  const stops = layer.legend?.stops;
  return stops && stops.length > 0 ? `linear-gradient(to right, ${stops.map(([, c]) => c).join(', ')})` : null;
}

export const LayerPanel: React.FC<LayerPanelProps> = ({
  layers,
  layerStates,
  roverOverlayState,
  photosAvailable = false,
  onToggleRoverOverlay,
  globalLayers = [],
  globalStates = {},
  onToggleGlobal,
  onGlobalOpacityChange,
  globalDetail,
  caves,
  temperature,
  dustHistory,
  siteValues = {},
  onToggleLayer,
  onOpacityChange,
  panelId = 'layers',
  isOpen = true,
  onTogglePanel,
}) => {
  const [remembered, setRemembered] = useState<Record<string, boolean>>(() => readOpenGroups(panelId, browserStorage()));
  const baseId = useId();

  const setGroupOpen = useCallback(
    (id: string, open: boolean) => {
      setRemembered((prev) => {
        const next = { ...prev, [id]: open };
        writeOpenGroups(panelId, next, browserStorage());
        return next;
      });
    },
    [panelId],
  );

  const siteEntries: Entry[] = [];
  for (const layer of layers) {
    const state = layerStates[layer.id] || { enabled: layer.default_on, opacity: 1.0 };
    const name = getLayerDisplayName(layer);
    const ramp = siteRamp(layer);
    const units = cleanUnits(layer.units);
    const toggle = () => onToggleLayer(layer.id);
    const setOpacity = (v: number) => onOpacityChange(layer.id, v);
    siteEntries.push({
      key: `site:${layer.id}`,
      group: layer.kind || 'optical',
      on: state.enabled,
      now: {
        name,
        opacity: state.opacity,
        onOpacity: setOpacity,
        legend: ramp ? rampBar(ramp) : layer.type === 'points' ? <span className="pt" aria-hidden="true" /> : undefined,
        onRemove: toggle,
      },
      row: (
        <LayerRow
          name={name}
          checked={state.enabled}
          onToggle={toggle}
          note={
            <>
              <span className={layer.resolution_m >= 5 ? 's48-res s48-res--coarse' : 's48-res'}>
                {layer.type === 'points' ? 'Points' : formatResolution(layer.resolution_m)}
              </span>{' '}
              · {getLayerSourceAgency(layer)}
            </>
          }
          info={
            layer.source ? (
              <>
                <p>{layer.source}</p>
                {layer.agency && <div className="s48-layer__desc-meta">Agency: {layer.agency}</div>}
              </>
            ) : undefined
          }
        >
          <OpacityControl name={name} value={state.opacity} onChange={setOpacity} />
          {ramp && layer.legend && (
            <div className="s48-legend">
              {rampBar(ramp)}
              <div className="s48-legend__ends">
                <span>
                  <b>{formatLegendValue(layer.legend.stops[0][0])}</b>
                  {units && <span className="s48-legend__unit">{units}</span>}
                </span>
                <span>
                  <b>{formatLegendValue(layer.legend.stops[layer.legend.stops.length - 1][0])}</b>
                </span>
              </div>
            </div>
          )}
          {layer.type === 'points' && (
            <div className="s48-legend s48-legend--points">
              <span className="pt" />
              <span>
                {name} ({units || 'target point'})
              </span>
            </div>
          )}
        </LayerRow>
      ),
    });
  }

  if (roverOverlayState && onToggleRoverOverlay) {
    const rover = [
      ['traverse', 'Rover traverse'],
      ...(photosAvailable ? [['photos', 'Rover photos'] as const] : []),
    ] as const;
    for (const [key, name] of rover) {
      const toggle = () => onToggleRoverOverlay(key);
      siteEntries.push({
        key: `site:rover:${key}`,
        group: 'rover',
        on: roverOverlayState[key],
        now: { name, onRemove: toggle },
        row: <LayerRow name={name} checked={roverOverlayState[key]} onToggle={toggle} />,
      });
    }
  }

  const planetEntries: Entry[] = [];
  for (const layer of globalLayers) {
    const state = globalStates[layer.id] || { enabled: false, opacity: 1 };
    const toggle = () => onToggleGlobal?.(layer.id);
    const setOpacity = (v: number) => onGlobalOpacityChange?.(layer.id, v);
    const note = [gridText(layer.values?.res_deg), shortCitation(layer.source.citation)].filter(Boolean).join(' · ');
    planetEntries.push({
      key: `planet:${layer.id}`,
      group: layer.group,
      on: state.enabled,
      now: { name: layer.title, opacity: state.opacity, onOpacity: setOpacity, legend: stepsBar(layer), onRemove: toggle },
      row: (
        <LayerRow
          name={layer.title}
          checked={state.enabled}
          onToggle={toggle}
          note={note}
          info={
            <>
              <p>{layer.description}</p>
              <div className="s48-layer__desc-meta">Source: {layer.source.citation}</div>
              <div className="s48-layer__desc-meta">Licence: {layer.source.licence}</div>
              {layer.source.licence_note && <div className="s48-layer__desc-meta">{layer.source.licence_note}</div>}
            </>
          }
        >
          {siteValues[layer.id] && (
            <p className="s48-layer__at-site">
              At this site: <b>{siteValues[layer.id]}</b>
            </p>
          )}
          <OpacityControl name={layer.title} value={state.opacity} onChange={setOpacity} />
          <div className="s48-legend">
            {stepsBar(layer)}
            <div className="s48-legend__ends">
              <span>
                <b>{layer.legend.min_label}</b>
              </span>
              <span>
                <b>{layer.legend.max_label}</b>
                {layer.legend.units && <span className="s48-legend__unit">{layer.legend.units}</span>}
              </span>
            </div>
          </div>
          {globalDetail?.[layer.id]}
        </LayerRow>
      ),
    });
  }

  if (dustHistory) {
    planetEntries.push({
      key: 'planet:dust_history',
      group: 'dust',
      on: dustHistory.enabled,
      now: {
        name: 'Dust history',
        note: dustHistory.note,
        legend: dustHistory.legend ? rampBar(dustHistory.legend) : undefined,
        onRemove: dustHistory.onToggle,
      },
      row: (
        <LayerRow
          name="Dust history"
          checked={dustHistory.enabled}
          onToggle={dustHistory.onToggle}
          note={dustHistory.note ?? 'Daily · time bar under the map'}
          info={
            <>
              <p>Daily dust opacity for the Mars Year in the time bar under the map. Play or step through it there.</p>
              {dustHistory.credit && <div className="s48-layer__desc-meta">Source: {dustHistory.credit}</div>}
            </>
          }
        >
          {dustHistory.legend && <div className="s48-legend">{rampBar(dustHistory.legend)}</div>}
        </LayerRow>
      ),
    });
  }

  if (temperature) {
    planetEntries.push({
      key: 'planet:temperature',
      group: 'temperature',
      on: temperature.enabled,
      now: temperature.onToggle
        ? {
            name: 'Surface temperature',
            opacity: temperature.opacity,
            onOpacity: temperature.onOpacityChange,
            legend: temperature.legend ? rampBar(temperature.legend) : undefined,
            onRemove: temperature.onToggle,
          }
        : undefined,
      row: (
        <>
          {temperature.row}
          {temperature.enabled && temperature.atSite && (
            <p className="s48-layer__at-site s48-layer__at-site--row">
              At this site: <b>{temperature.atSite}</b>
            </p>
          )}
        </>
      ),
    });
  }

  if (caves) {
    planetEntries.push({
      key: 'planet:caves',
      group: 'caves',
      on: caves.enabled,
      now: { name: 'Cave candidates', legend: <span className="s48-cave-dot" aria-hidden="true" />, onRemove: caves.onToggle },
      row: (
        <LayerRow
          name="Cave candidates"
          checked={caves.enabled}
          onToggle={caves.onToggle}
          note={`${caves.count} points · MGC³ · USGS`}
          info={
            <>
              <p>Possible cave entrances seen in orbital images. None has been explored.</p>
              <div className="s48-layer__desc-meta">Source: {caves.credit}</div>
            </>
          }
        >
          {caves.atSite && (
            <p className="s48-layer__at-site">
              At this site: <b>{caves.atSite}</b>
            </p>
          )}
          <div className="s48-legend s48-legend--points">
            <span className="s48-cave-dot" />
            <span>
              <span className="num">{caves.count}</span> points
            </span>
          </div>
        </LayerRow>
      ),
    });
  }

  const siteGroups = buildGroups('site', siteEntries);
  const planetGroups = buildGroups('planet', planetEntries);
  // On now follows the panel order: This site, then Whole planet, group by group.
  const nowRows = [...siteGroups, ...planetGroups].flatMap((g) => g.items.filter((i) => i.on && i.now));
  const onCount = [...siteEntries, ...planetEntries].filter((e) => e.on).length;

  const section = (kind: LayerSection, title: string, groups: PanelGroup<Entry>[]) =>
    groups.length > 0 && (
      <section className="panel-sec s48-lp__sec" aria-labelledby={`${baseId}-${kind}`}>
        <h3 id={`${baseId}-${kind}`}>
          <span>{title}</span>
        </h3>
        <div className="s48-lp__groups">
          {groups.map((group) => (
            <LayerGroup
              key={group.id}
              id={`${baseId}-${group.id}`}
              label={group.label}
              onCount={group.onCount}
              open={isGroupOpen(remembered, group)}
              onOpenChange={(open) => setGroupOpen(group.id, open)}
            >
              {group.items.map((item) => (
                <React.Fragment key={item.key}>{item.row}</React.Fragment>
              ))}
            </LayerGroup>
          ))}
        </div>
      </section>
    );

  return (
    <aside className="panel s48-lp" style={{ display: isOpen ? 'block' : 'none', overflowY: 'auto' }}>
      <section className="panel-sec s48-lp__now" aria-labelledby={`${baseId}-now`}>
        <h3 id={`${baseId}-now`}>
          <span>
            On now <small>{onCount}</small>
          </span>
          {onTogglePanel && (
            <button type="button" className="s48-btn s48-btn--quiet" onClick={onTogglePanel} aria-label="Close layer panel">
              Hide
            </button>
          )}
        </h3>
        {nowRows.length > 0 ? (
          <ul className="s48-now">
            {nowRows.map((item) => (
              <NowRow key={item.key} spec={item.now!} />
            ))}
          </ul>
        ) : (
          <p className="s48-now__empty">No layers on.</p>
        )}
      </section>
      {section('site', 'This site', siteGroups)}
      {section('planet', 'Whole planet', planetGroups)}
    </aside>
  );
};

const OpacityControl: React.FC<{ name: string; value: number; onChange: (v: number) => void; compact?: boolean }> = ({
  name,
  value,
  onChange,
  compact,
}) => (
  <div className={compact ? 's48-opacity s48-opacity--compact' : 's48-opacity'}>
    {!compact && <span>Opacity</span>}
    <input
      type="range"
      className="s48-range"
      min="0"
      max="1"
      step="0.05"
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      aria-label={`${name} opacity`}
    />
    <output>{Math.round(value * 100)} %</output>
  </div>
);

const NowRow: React.FC<{ spec: NowSpec }> = ({ spec }) => (
  <li className="s48-now__row">
    <div className="s48-now__head">
      <span className="s48-now__name" title={spec.name}>
        {spec.name}
      </span>
      <button type="button" className="s48-layer__info-btn s48-now__remove" onClick={spec.onRemove} aria-label={`Turn off ${spec.name}`} title={`Turn off ${spec.name}`}>
        <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
        </svg>
      </button>
    </div>
    {(spec.legend || spec.onOpacity) && (
      <div className={spec.onOpacity ? 's48-now__body' : 's48-now__body s48-now__body--full'}>
        <div className="s48-now__legend">{spec.legend}</div>
        {spec.onOpacity && spec.opacity !== undefined && (
          <OpacityControl name={spec.name} value={spec.opacity} onChange={spec.onOpacity} compact />
        )}
      </div>
    )}
    {spec.note && <p className="s48-now__note">{spec.note}</p>}
  </li>
);

const LayerGroup: React.FC<{
  id: string;
  label: string;
  onCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}> = ({ id, label, onCount, open, onOpenChange, children }) => (
  <div className={`s48-lp-group ${open ? 'is-open' : ''}`}>
    <button
      type="button"
      className="s48-lp-group__btn"
      aria-expanded={open}
      aria-controls={id}
      onClick={() => onOpenChange(!open)}
    >
      <svg className="i s48-lp-group__chev" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6 4l4 4-4 4" />
      </svg>
      <span className="s48-lp-group__label">{label}</span>
      {onCount > 0 && <small className="s48-lp-group__count">· {onCount} on</small>}
    </button>
    <div id={id} className="s48-lp-group__items" hidden={!open}>
      {children}
    </div>
  </div>
);

const LayerRow: React.FC<{
  name: string;
  checked: boolean;
  onToggle: () => void;
  note?: React.ReactNode;
  info?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ name, checked, onToggle, note, info, children }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="s48-layer">
      <div className="s48-layer__head">
        <label title={name}>
          <input type="checkbox" className="s48-check" checked={checked} onChange={onToggle} />
          <span className="s48-layer__title">{name}</span>
        </label>
        {info && <InfoButton expanded={expanded} label={name} onClick={() => setExpanded(!expanded)} />}
      </div>
      {note && <div className="s48-layer__note">{note}</div>}
      {expanded && info && <div className="s48-layer__desc">{info}</div>}
      {checked && children && <div className="s48-layer__body">{children}</div>}
    </div>
  );
};

const InfoButton: React.FC<{ expanded: boolean; label: string; onClick: () => void }> = ({ expanded, label, onClick }) => (
  <button
    type="button"
    className={`s48-layer__info-btn ${expanded ? 'is-active' : ''}`}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    aria-expanded={expanded}
    aria-label={`About ${label}`}
    title={`About ${label}`}
  >
    <svg className="i" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 7v4M8 5h.01" />
    </svg>
  </button>
);
