// Written with AI assistance, directed and reviewed by the team.
import { describe, it, expect } from 'vitest';
import { ladderLevel, chooseShelter, type LadderInput, type ShelterCandidate } from './ladder';

/** A sol where sunset is 18:00 and the back-by (reserve 30 min) is 17:30. */
const sunsetMs = Date.UTC(2026, 10, 14, 18, 0);
const backByMs = Date.UTC(2026, 10, 14, 17, 30);

function at(h: number, m: number): number {
  return Date.UTC(2026, 10, 14, h, m);
}

describe('ladderLevel', () => {
  it('is ok when the projected arrival beats the back-by time', () => {
    const input: LadderInput = {
      nowMs: at(15, 0),
      backByMs,
      sunsetMs,
      projectedArrivalMs: at(17, 10), // 20 min before back-by
      behindPaceMin: 0,
    };
    const r = ladderLevel(input);
    expect(r.level).toBe('ok');
    expect(r.arrivalAfterBackByMin).toBe(-20);
    expect(r.minutesToSunset).toBe(180);
  });

  it('is behind-pace when arrival slips past the back-by time but before sunset', () => {
    const r = ladderLevel({
      nowMs: at(16, 50),
      backByMs,
      sunsetMs,
      projectedArrivalMs: at(17, 45), // 15 min after back-by, 15 before sunset
      behindPaceMin: 12,
    });
    expect(r.level).toBe('behind-pace');
    expect(r.arrivalAfterBackByMin).toBe(15);
    expect(r.detail).toContain('15 min after the back-by time');
  });

  it('is turn-back when the projected arrival is after sunset', () => {
    const r = ladderLevel({
      nowMs: at(17, 10),
      backByMs,
      sunsetMs,
      projectedArrivalMs: at(18, 25), // 25 min after sunset
      behindPaceMin: 22,
    });
    expect(r.level).toBe('turn-back');
    expect(r.arrivalAfterSunsetMin).toBe(25);
    expect(r.detail).toContain('25 min after sunset');
  });

  it('is return-to-shelter once the crew is out past the back-by time', () => {
    const r = ladderLevel({
      nowMs: at(17, 38),
      backByMs,
      sunsetMs,
      projectedArrivalMs: at(18, 40),
      behindPaceMin: 35,
    });
    expect(r.level).toBe('return-to-shelter');
    expect(r.minutesToBackBy).toBe(-8);
    expect(r.minutesToSunset).toBe(22);
  });

  it('is return-to-shelter when suit time is shorter than the walk to shelter', () => {
    const r = ladderLevel({
      nowMs: at(15, 0),
      backByMs,
      sunsetMs,
      projectedArrivalMs: at(17, 0),
      behindPaceMin: 0,
      suitTimeLeftS: 20 * 60,
      timeToShelterS: 35 * 60,
    });
    expect(r.level).toBe('return-to-shelter');
  });

  it('lights the advisory on pace slip alone, below the arrival trigger', () => {
    const r = ladderLevel({
      nowMs: at(15, 0),
      backByMs,
      sunsetMs,
      projectedArrivalMs: at(17, 20), // still before back-by
      behindPaceMin: 8, // above PACE_SLIP_MIN (5)
    });
    expect(r.level).toBe('behind-pace');
  });
});

describe('chooseShelter', () => {
  const candidates: ShelterCandidate[] = [
    { id: 'hab', kind: 'habitat', distanceM: 2400, onRoute: false },
    { id: 'hab-route', kind: 'habitat', distanceM: 3100, onRoute: true },
    { id: 'rover', kind: 'rover', distanceM: 900 },
    { id: 'plan-shelter', kind: 'habitat', distanceM: 1500, primary: true },
    { id: 'cliff', kind: 'terrain-shield', distanceM: 300, skyBlockedFrac: 0.55 },
    { id: 'cave', kind: 'cave', distanceM: 120, accessible: false },
  ];

  it('daylight and pace pick the nearest pressurised shelter or the plan shelter', () => {
    expect(chooseShelter('daylight', candidates)?.shelter.id).toBe('rover');
    expect(chooseShelter('pace', candidates)?.shelter.id).toBe('rover');
  });

  it('radiation prefers the nearest terrain shield over a far habitat, skipping an inaccessible cave', () => {
    const choice = chooseShelter('radiation', candidates);
    expect(choice?.shelter.id).toBe('cliff');
    expect(choice?.reason).toContain('55 %');
  });

  it('dust picks the habitat on the planned route even when it is farther', () => {
    const choice = chooseShelter('dust', candidates);
    expect(choice?.shelter.id).toBe('hab-route');
    expect(choice?.reason).toContain('along the planned route');
  });

  it('the plan shelter wins a tie and counts whatever its type', () => {
    const tie: ShelterCandidate[] = [
      { id: 'rover', kind: 'rover', distanceM: 0 },
      { id: 'plan-shelter', kind: 'radiation-shelter', distanceM: 0, primary: true, name: 'Shelter · Radiation shelter' },
    ];
    const choice = chooseShelter('pace', tie);
    expect(choice?.shelter.id).toBe('plan-shelter');
    expect(choice?.reason).toBe('The plan shelter, where the walk ends.');
    expect(chooseShelter('radiation', [{ id: 'rs', kind: 'radiation-shelter', distanceM: 40 }, { id: 'h', kind: 'habitat', distanceM: 900 }])?.shelter.id).toBe('rs');
  });

  it('returns null when no candidate fits the hazard', () => {
    expect(chooseShelter('dust', [{ id: 'r', kind: 'rover', distanceM: 10 }])).toBeNull();
  });
});
