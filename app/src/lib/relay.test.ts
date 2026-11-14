// Written with AI assistance, directed and reviewed by the team.

import { describe, it, expect } from 'vitest';
import { RelayItem, Pass, queueOrder, planPass, nextPass, passBytes } from './relay';

function item(id: string, kind: RelayItem['kind'], createdMs: number, bytes: number, starred?: boolean): RelayItem {
  return starred === undefined ? { id, kind, createdMs, bytes } : { id, kind, createdMs, bytes, starred };
}

describe('queueOrder', () => {
  it('an SOS created after 50 position items still sorts first', () => {
    const positions = Array.from({ length: 50 }, (_, i) => item(`pos-${i}`, 'position', i, 100));
    const sos = item('sos-1', 'sos', 10_000, 100); // created long after the positions
    const ordered = queueOrder([...positions, sos]);
    expect(ordered[0].id).toBe('sos-1');
    expect(ordered).toHaveLength(51);
  });

  it('orders kinds, with starred science before ordinary science, oldest first within a kind', () => {
    const ordered = queueOrder([
      item('other', 'other', 0, 1),
      item('sci', 'science', 5, 1),
      item('sci-star', 'science', 9, 1, true),
      item('suit', 'suit', 0, 1),
      item('pos-late', 'position', 20, 1),
      item('pos-early', 'position', 1, 1),
      item('warn', 'warning', 0, 1),
      item('sos', 'sos', 0, 1),
    ]);
    expect(ordered.map((i) => i.id)).toEqual([
      'sos',
      'warn',
      'pos-early', // oldest position first
      'pos-late',
      'suit',
      'sci-star', // starred science before ordinary science
      'sci',
      'other',
    ]);
  });

  it('does not mutate the input array', () => {
    const input = [item('b', 'suit', 0, 1), item('a', 'sos', 0, 1)];
    const copy = [...input];
    queueOrder(input);
    expect(input).toEqual(copy);
  });
});

describe('planPass', () => {
  it('respects capacity and drops nothing (send + wait = input)', () => {
    const items = [
      item('sos', 'sos', 0, 300),
      item('pos-1', 'position', 1, 300),
      item('pos-2', 'position', 2, 300),
      item('sci', 'science', 3, 300),
    ];
    const { send, wait } = planPass(items, 700); // room for two 300-byte items
    expect(send.length + wait.length).toBe(items.length);
    const sentBytes = send.reduce((s, i) => s + i.bytes, 0);
    expect(sentBytes).toBeLessThanOrEqual(700);
    expect(send.map((i) => i.id)).toEqual(['sos', 'pos-1']);
    expect(wait.map((i) => i.id)).toEqual(['pos-2', 'sci']);
  });

  it('a waiting SOS blocks lower items from jumping it', () => {
    const items = [
      item('sos', 'sos', 0, 1000), // too big for this pass
      item('pos', 'position', 1, 10), // would fit, but must not jump the SOS
    ];
    const { send, wait } = planPass(items, 50);
    expect(send).toHaveLength(0);
    expect(wait.map((i) => i.id)).toEqual(['sos', 'pos']);
    // Without the blocking SOS, the small position would send.
    expect(planPass([items[1]], 50).send.map((i) => i.id)).toEqual(['pos']);
  });

  it('a non-critical item that does not fit lets smaller later items through', () => {
    const items = [
      item('pos-big', 'position', 0, 100), // does not fit
      item('suit-small', 'suit', 1, 10), // smaller, lower priority: may still go
    ];
    const { send, wait } = planPass(items, 50);
    expect(send.map((i) => i.id)).toEqual(['suit-small']);
    expect(wait.map((i) => i.id)).toEqual(['pos-big']);
  });
});

describe('nextPass', () => {
  const passes: Pass[] = [
    { orbiter: 'TGO', riseUtcMs: 5_000, setUtcMs: 6_000, peakElevationDeg: 40 }, // already over
    { orbiter: 'MRO', riseUtcMs: 20_000, setUtcMs: 21_000, peakElevationDeg: 55 },
    { orbiter: 'ODY', riseUtcMs: 10_000, setUtcMs: 11_000, peakElevationDeg: 30 },
  ];

  it('picks the earliest pass whose set time is after now', () => {
    const p = nextPass(passes, 7_000);
    expect(p?.orbiter).toBe('ODY'); // earliest rise among passes still ahead
  });

  it('includes a pass currently in progress', () => {
    const p = nextPass(passes, 10_500); // inside ODY's window
    expect(p?.orbiter).toBe('ODY');
  });

  it('returns null when no pass remains', () => {
    expect(nextPass(passes, 100_000)).toBeNull();
  });
});

describe('passBytes', () => {
  it('is duration times rate over 8', () => {
    // 600 s pass at 2 Mbps peak UHF return (relay.md row 7).
    const pass: Pass = { orbiter: 'MRO', riseUtcMs: 0, setUtcMs: 600_000, peakElevationDeg: 50 };
    expect(passBytes(pass, 2_000_000)).toBe(150_000_000);
  });
});
