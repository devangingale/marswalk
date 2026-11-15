// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { EntityCollection } from 'cesium';
import type { MarkerImages } from '../globe/markerImages';
import { GlobeOverlays } from '../globe/overlays';
import { NBSP } from './format';

const token = (name: string) => (name === '--font-data' ? 'sans-serif' : '#8ec1f5');
const image = { image: 'data:,', width: 1, height: 1 };
const images = new Proxy({}, { get: () => () => image }) as MarkerImages;
const crewImage = () => image;

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
  it('draws a ring per astronaut, an uncertainty circle shown only for a non-zero radius, the rover and the corridor', () => {
    const host = { entities: new EntityCollection() };
    const overlays = new GlobeOverlays(host, { token, images, crewImage });
    overlays.setCrew(model);
    const values = host.entities.values;
    const labels = values.filter((e) => e.label).map((e) => e.label!.text!.getValue(undefined as never));
    expect(labels).toEqual([`EV1 ±${NBSP}12${NBSP}m`, `EV2 ±${NBSP}0${NBSP}m`, 'Rover · arrives 18:22']);
    const ellipses = values.filter((e) => e.ellipse);
    expect(ellipses).toHaveLength(2);
    expect(ellipses[0].ellipse!.semiMajorAxis!.getValue(undefined as never)).toBe(12);
    expect(ellipses[0].ellipse!.show!.getValue(undefined as never)).toBe(true);
    expect(ellipses[1].ellipse!.show!.getValue(undefined as never)).toBe(false);
    // Corridor casing and core, plus one circle outline per astronaut.
    expect(values.filter((e) => e.polyline)).toHaveLength(4);
  });

  it('removes its entities when cleared with null', () => {
    const host = { entities: new EntityCollection() };
    const overlays = new GlobeOverlays(host, { token, images, crewImage });
    overlays.setCrew(model);
    overlays.setCrew(null);
    expect(host.entities.values).toHaveLength(0);
  });
});

describe('GlobeOverlays.setCrew updates', () => {
  it('moves the marks in place while the set of marks is unchanged', () => {
    const host = { entities: new EntityCollection() };
    const overlays = new GlobeOverlays(host, { token, images, crewImage });
    overlays.setCrew(model);
    const before = [...host.entities.values];
    overlays.setCrew({ ...model, crew: [{ ...model.crew[0], uncertaintyM: 30 }, model.crew[1]] });
    expect(host.entities.values).toEqual(before);
    const ellipse = host.entities.values.find((e) => e.ellipse)!;
    expect(ellipse.ellipse!.semiMajorAxis!.getValue(undefined as never)).toBe(30);
    const labels = host.entities.values.filter((e) => e.label).map((e) => e.label!.text!.getValue(undefined as never));
    expect(labels[0]).toBe(`EV1 ±${NBSP}30${NBSP}m`);
  });

  it('rebuilds when the night corridor appears', () => {
    const host = { entities: new EntityCollection() };
    const overlays = new GlobeOverlays(host, { token, images, crewImage });
    overlays.setCrew({ ...model, returnLine: null });
    expect(host.entities.values.filter((e) => e.polyline)).toHaveLength(2);
    overlays.setCrew(model);
    expect(host.entities.values.filter((e) => e.polyline)).toHaveLength(4);
  });
});
