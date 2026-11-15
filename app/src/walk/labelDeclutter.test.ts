import { describe, expect, it } from 'vitest';
import type { CrewMarkerModel } from '../safety/crewMarkers';
import { offsetLonLat } from '../safety/crewMarkers';
import { declutterCrewLabels, groundDistanceM, LABEL_CLEAR_M } from './labelDeclutter';

const dropOff = { lon: 137.4, lat: -4.6 };

function model(roverAtM: number, crewAtM: number): CrewMarkerModel {
  const rover = offsetLonLat(dropOff, roverAtM, 90);
  const lead = offsetLonLat(dropOff, crewAtM, 0);
  return {
    crew: [{ id: 'EV1', ...lead, uncertaintyM: 5 }, { id: 'EV2', ...offsetLonLat(lead, 3, 90), uncertaintyM: 5 }],
    separated: false,
    rover: { ...rover, label: 'Rover · 1 min to crew' },
    returnLine: null,
  };
}

describe('groundDistanceM', () => {
  it('measures metres between nearby points', () => {
    expect(groundDistanceM(dropOff, offsetLonLat(dropOff, 100, 45))).toBeCloseTo(100, 0);
  });
});

describe('declutterCrewLabels', () => {
  it('drops the rover label while the rover is parked at the drop-off', () => {
    expect(declutterCrewLabels(model(0, 500), dropOff)?.rover?.label).toBe('');
  });

  it('drops the rover label when the crew stands at the rover', () => {
    const m = model(400, 500);
    const atRover = offsetLonLat(m.rover!, 10, 0);
    m.crew[0] = { ...m.crew[0], ...atRover };
    expect(declutterCrewLabels(m, dropOff)?.rover?.label).toBe('');
  });

  it('keeps the rover label when it is clear of the drop-off and the crew', () => {
    const m = model(LABEL_CLEAR_M * 3, LABEL_CLEAR_M * 6);
    expect(declutterCrewLabels(m, dropOff)).toBe(m);
  });

  it('keeps the crew labels and passes null through', () => {
    const m = declutterCrewLabels(model(0, 0), dropOff);
    expect(m?.crew.map((c) => c.id)).toEqual(['EV1', 'EV2']);
    expect(declutterCrewLabels(null, dropOff)).toBeNull();
  });
});
