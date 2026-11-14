// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { EntityCollection } from 'cesium';
import type { MarkerImages } from '../globe/markerImages';
import { GlobeOverlays } from '../globe/overlays';
import { NBSP } from './format';

const token = (name: string) => (name === '--font-data' ? 'sans-serif' : '#8ec1f5');
const image = { image: 'data:,', width: 1, height: 1 };
const images = new Proxy({}, { get: () => () => image }) as MarkerImages;

const model = {
  crew: [
    { id: 'EV1', lon: 137.36, lat: -4.76, uncertaintyM: 12 },
    { id: 'EV2', lon: 137.3601, lat: -4.76, uncertaintyM: 0 },
  ],
  separated: false,
  rover: { lon: 137.35, lat: -4.77, label: 'Rover · arrives 18:22' },
  returnLine: [
    { lon: 137.36, lat: -4.76 },
    { lon: 137.35, lat: -4.77 },
  ],
};

describe('GlobeOverlays.setCrew', () => {
  it('draws a disc per astronaut, one uncertainty circle per non-zero radius, the rover and the corridor', () => {
    const host = { entities: new EntityCollection() };
    const overlays = new GlobeOverlays(host, { token, images });
    overlays.setCrew(model);
    const values = host.entities.values;
    const labels = values.filter((e) => e.label).map((e) => e.label!.text!.getValue(undefined as never));
    expect(labels).toEqual([`EV1 ±${NBSP}12${NBSP}m`, `EV2 ±${NBSP}0${NBSP}m`, 'Rover · arrives 18:22']);
    const ellipses = values.filter((e) => e.ellipse);
    expect(ellipses).toHaveLength(1);
    expect(ellipses[0].ellipse!.semiMajorAxis!.getValue(undefined as never)).toBe(12);
    // Corridor casing and core, plus the one circle outline.
    expect(values.filter((e) => e.polyline)).toHaveLength(3);
  });

  it('removes its entities when cleared with null', () => {
    const host = { entities: new EntityCollection() };
    const overlays = new GlobeOverlays(host, { token, images });
    overlays.setCrew(model);
    overlays.setCrew(null);
    expect(host.entities.values).toHaveLength(0);
  });
});
