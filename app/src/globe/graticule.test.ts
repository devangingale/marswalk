// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { cullLabels, cullScreenLabels, graticuleLines } from './graticule';

describe('graticuleLines', () => {
  it('covers the planet every 10 degrees, parallels from 80 S to 80 N', () => {
    const lines = graticuleLines(null, 10);
    const meridians = lines.filter((l) => l.axis === 'lon');
    const parallels = lines.filter((l) => l.axis === 'lat');
    expect(meridians.length).toBe(36);
    expect(parallels.map((l) => l.label)).toEqual([
      '80Â° S', '70Â° S', '60Â° S', '50Â° S', '40Â° S', '30Â° S', '20Â° S', '10Â° S', '0Â°',
      '10Â° N', '20Â° N', '30Â° N', '40Â° N', '50Â° N', '60Â° N', '70Â° N', '80Â° N',
    ]);
    expect(meridians[0].label).toBe('180Â°');
    expect(meridians[0].points[0]).toEqual([-180, -80]);
    expect(meridians[0].points.at(-1)).toEqual([-180, 80]);
  });

  it('draws 0.001 degree lines across the Gale sample corner', () => {
    const lines = graticuleLines({ west: 137.3604, south: -4.7659, east: 137.3689, north: -4.7575 }, 0.001);
    expect(lines.filter((l) => l.axis === 'lon').map((l) => l.label)).toEqual([
      '137.361Â° E', '137.362Â° E', '137.363Â° E', '137.364Â° E', '137.365Â° E', '137.366Â° E', '137.367Â° E', '137.368Â° E',
    ]);
    expect(lines.filter((l) => l.axis === 'lat').map((l) => l.label)).toEqual([
      '4.765Â° S', '4.764Â° S', '4.763Â° S', '4.762Â° S', '4.761Â° S', '4.760Â° S', '4.759Â° S', '4.758Â° S',
    ]);
  });

  it('wraps meridians in a view across 180 degrees', () => {
    const lines = graticuleLines({ west: 177.5, south: 0, east: -177.5, north: 2 }, 1);
    expect(lines.filter((l) => l.axis === 'lon').map((l) => l.label)).toEqual([
      '178Â° E', '179Â° E', '180Â°', '179Â° W', '178Â° W',
    ]);
    const equator = lines.find((l) => l.axis === 'lat' && l.value === 0)!;
    expect(equator.points[0]).toEqual([177.5, 0]);
    expect(equator.points.at(-1)).toEqual([-177.5, 0]);
  });

  it('draws nothing when the view is far too wide for the step', () => {
    expect(graticuleLines({ west: -180, south: -80, east: 180, north: 80 }, 0.01)).toEqual([]);
  });
});

describe('cullLabels', () => {
  it('drops labels that overlap one already placed', () => {
    const kept = cullLabels([
      { text: '120Â° E', x: 100, y: 4, axis: 'lon' as const },
      { text: '130Â° E', x: 120, y: 6, axis: 'lon' as const },
      { text: '140Â° E', x: 160, y: 4, axis: 'lon' as const },
      { text: '10Â° N', x: 4, y: 12, axis: 'lat' as const },
    ]);
    expect(kept.map((l) => l.text)).toEqual(['120Â° E', '140Â° E', '10Â° N']);
  });
});

describe('cullLabels with panels', () => {
  it('drops labels under a panel over the map', () => {
    const kept = cullLabels(
      [
        { text: '137.361Â° E', x: 100, y: 4, axis: 'lon' as const },
        { text: '137.362Â° E', x: 400, y: 4, axis: 'lon' as const },
      ],
      [[16, 16 - 14, 336, 200]],
    );
    expect(kept.map((l) => l.text)).toEqual(['137.362Â° E']);
  });
});

describe('cullScreenLabels', () => {
  it('keeps the highest priority label in a shared screen box', () => {
    expect(cullScreenLabels([
      { id: 'summary', box: [0, 0, 40, 14], priority: 3 },
      { id: 'fork', box: [0, 0, 40, 14], priority: 2 },
      { id: 'dropoff', box: [0, 0, 40, 14], priority: 1 },
      { id: 'clear', box: [50, 0, 90, 14], priority: 3 },
    ])).toEqual(['dropoff', 'clear']);
  });

  it('keeps exact priority order and excludes overlaps with marker boxes', () => {
    expect(cullScreenLabels([
      { id: 'summary', box: [20, 0, 60, 14], priority: 3 },
      { id: 'fork', box: [12, 0, 52, 14], priority: 2 },
      { id: 'dropoff', box: [0, 0, 36, 14], priority: 1 },
      { id: 'clear', box: [80, 0, 120, 14], priority: 3 },
    ], [[0, 0, 10, 14]])).toEqual(['fork', 'clear']);
  });

  it('allows boxes that touch at an edge', () => {
    expect(cullScreenLabels([
      { id: 'first', box: [0, 0, 20, 14], priority: 1 },
      { id: 'second', box: [20, 0, 40, 14], priority: 2 },
    ])).toEqual(['first', 'second']);
  });
});
