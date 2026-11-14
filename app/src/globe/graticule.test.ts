// Written with AI assistance, directed and reviewed by the team.
import { describe, expect, it } from 'vitest';
import { cullLabels, cullScreenLabels, graticuleLines, offsetScreenMarkers } from './graticule';

describe('graticuleLines', () => {
  it('covers the planet every 10 degrees, parallels from 80 S to 80 N', () => {
    const lines = graticuleLines(null, 10);
    const meridians = lines.filter((l) => l.axis === 'lon');
    const parallels = lines.filter((l) => l.axis === 'lat');
    expect(meridians.length).toBe(36);
    expect(parallels.map((l) => l.label)).toEqual([
      '80° S', '70° S', '60° S', '50° S', '40° S', '30° S', '20° S', '10° S', '0°',
      '10° N', '20° N', '30° N', '40° N', '50° N', '60° N', '70° N', '80° N',
    ]);
    expect(meridians[0].label).toBe('180°');
    expect(meridians[0].points[0]).toEqual([-180, -80]);
    expect(meridians[0].points.at(-1)).toEqual([-180, 80]);
  });

  it('draws 0.001 degree lines across the Gale sample corner', () => {
    const lines = graticuleLines({ west: 137.3604, south: -4.7659, east: 137.3689, north: -4.7575 }, 0.001);
    expect(lines.filter((l) => l.axis === 'lon').map((l) => l.label)).toEqual([
      '137.361° E', '137.362° E', '137.363° E', '137.364° E', '137.365° E', '137.366° E', '137.367° E', '137.368° E',
    ]);
    expect(lines.filter((l) => l.axis === 'lat').map((l) => l.label)).toEqual([
      '4.765° S', '4.764° S', '4.763° S', '4.762° S', '4.761° S', '4.760° S', '4.759° S', '4.758° S',
    ]);
  });

  it('wraps meridians in a view across 180 degrees', () => {
    const lines = graticuleLines({ west: 177.5, south: 0, east: -177.5, north: 2 }, 1);
    expect(lines.filter((l) => l.axis === 'lon').map((l) => l.label)).toEqual([
      '178° E', '179° E', '180°', '179° W', '178° W',
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
      { text: '120° E', x: 100, y: 4, axis: 'lon' as const },
      { text: '130° E', x: 120, y: 6, axis: 'lon' as const },
      { text: '140° E', x: 160, y: 4, axis: 'lon' as const },
      { text: '10° N', x: 4, y: 12, axis: 'lat' as const },
    ]);
    expect(kept.map((l) => l.text)).toEqual(['120° E', '140° E', '10° N']);
  });
});

describe('cullLabels with panels', () => {
  it('drops labels under a panel over the map', () => {
    const kept = cullLabels(
      [
        { text: '137.361° E', x: 100, y: 4, axis: 'lon' as const },
        { text: '137.362° E', x: 400, y: 4, axis: 'lon' as const },
      ],
      [[16, 16 - 14, 336, 200]],
    );
    expect(kept.map((l) => l.text)).toEqual(['137.362° E']);
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

describe('offsetScreenMarkers', () => {
  it('keeps close stop numbers separated from a drop-off marker and each other', () => {
    expect([...offsetScreenMarkers([
      { id: 'stop-1', x: 0, y: 0, width: 28, height: 28 },
      { id: 'stop-2', x: 0, y: 0, width: 28, height: 28 },
    ], [[-14, -14, 14, 14]])]).toEqual([['stop-1', [30, 0]], ['stop-2', [0, 30]]]);
  });
});
