// Written with AI assistance, directed and reviewed by the team.
// "Highest values" for one layer: the numbered markers on the map, as a list that flies to each.

import React from 'react';
import { formatLatLon } from '../sites/format';
import type { HotspotSet } from './ExploreAnnotations';
import { formatHotspotValue } from './hotspots';
import './annotations.css';

interface HotspotListProps {
  set: HotspotSet;
  onSelect: (lon: number, lat: number) => void;
}

export const HotspotList: React.FC<HotspotListProps> = ({ set, onSelect }) => (
  <section className="xa-hot" aria-label={`${set.spec.lowest ? 'Lowest' : 'Highest'} values, ${set.layer.title}`}>
    <h4 className="xa-hot__head">{set.spec.lowest ? 'Lowest values' : 'Highest values'}</h4>
    <ol className="xa-hot__list">
      {set.peaks.map((peak, i) => (
        <li key={`${peak.lon},${peak.lat}`}>
          <button type="button" className="xa-hot__row" onClick={() => onSelect(peak.lon, peak.lat)}>
            <span className="xa-hot__n">{i + 1}</span>
            <span className="xa-hot__val">{formatHotspotValue(set.spec, peak.value)}</span>
            <span className="xa-hot__at">{formatLatLon(peak.lat, peak.lon)}</span>
          </button>
        </li>
      ))}
    </ol>
  </section>
);
