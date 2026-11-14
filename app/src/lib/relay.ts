// Written with AI assistance, directed and reviewed by the team.

/**
 * Store-and-forward relay queue (design: "SOS and relay scheduler").
 *
 * The device holds a priority queue of items to relay to Earth. When an orbiter
 * pass opens, the queue transmits in priority order; what does not fit waits for
 * the next pass, and nothing is dropped until delivery is confirmed. Pass
 * prediction (rise/set/elevation from SPICE) is computed elsewhere; this module
 * is the queue logic only.
 *
 * Priority order (design): SOS, warnings, crew positions and track, suit status
 * and vitals, starred science (the crew can star items to send first), science,
 * then everything else. Within one kind, older items (smaller createdMs) go
 * first; equal times keep input order (stable).
 *
 * Capacity: relay rate is up to 2 Mbps peak UHF return (relay.md row 7). A
 * minimum elevation mask and typical pass length were "not found" (relay.md rows
 * 16-17), so pass byte budgets come from a caller-chosen rate and the real
 * SPICE pass duration, never an invented figure.
 */

export type RelayItem = {
  id: string;
  kind: 'sos' | 'warning' | 'position' | 'suit' | 'science' | 'other';
  createdMs: number;
  bytes: number;
  /** Science items the crew starred to send before other science. */
  starred?: boolean;
};

export type Pass = {
  orbiter: string;
  riseUtcMs: number;
  setUtcMs: number;
  peakElevationDeg: number;
};

/** Priority rank for an item; lower goes first. */
function rank(item: RelayItem): number {
  switch (item.kind) {
    case 'sos':
      return 0;
    case 'warning':
      return 1;
    case 'position':
      return 2;
    case 'suit':
      return 3;
    case 'science':
      return item.starred ? 4 : 5; // starred science before ordinary science
    case 'other':
      return 6;
  }
}

/**
 * Returns the queue in transmit order: by priority kind, then oldest first
 * within a kind, stable for equal creation times. Does not mutate the input.
 */
export function queueOrder(items: RelayItem[]): RelayItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const dr = rank(a.item) - rank(b.item);
      if (dr !== 0) return dr;
      const dt = a.item.createdMs - b.item.createdMs;
      if (dt !== 0) return dt;
      return a.index - b.index; // stable: keep input order for equal times
    })
    .map((entry) => entry.item);
}

/**
 * Splits the queue into what fits in this pass and what waits, in queue order.
 * An item that does not fit waits; smaller later items may still go, EXCEPT a
 * critical item (SOS or warning) that waits blocks every lower item behind it
 * from jumping ahead of it. Nothing is dropped: `send` and `wait` together are
 * every input item.
 */
export function planPass(
  items: RelayItem[],
  passBytes: number
): { send: RelayItem[]; wait: RelayItem[] } {
  const ordered = queueOrder(items);
  const send: RelayItem[] = [];
  const wait: RelayItem[] = [];
  let used = 0;
  let blocked = false; // true once a waiting SOS/warning must not be jumped

  for (const item of ordered) {
    if (blocked) {
      wait.push(item);
      continue;
    }
    if (used + item.bytes <= passBytes) {
      send.push(item);
      used += item.bytes;
    } else {
      wait.push(item);
      if (item.kind === 'sos' || item.kind === 'warning') blocked = true;
    }
  }

  return { send, wait };
}

/**
 * The earliest pass that has not yet ended: the one with the smallest rise time
 * among passes whose set time is still after `nowMs`. Null when none remain.
 */
export function nextPass(passes: Pass[], nowMs: number): Pass | null {
  let best: Pass | null = null;
  for (const p of passes) {
    if (p.setUtcMs <= nowMs) continue;
    if (best === null || p.riseUtcMs < best.riseUtcMs) best = p;
  }
  return best;
}

/**
 * Bytes carried by a pass at `rateBps` bits per second: duration in seconds
 * times the rate, divided by 8 bits per byte.
 */
export function passBytes(pass: Pass, rateBps: number): number {
  const durationS = (pass.setUtcMs - pass.riseUtcMs) / 1000;
  return (durationS * rateBps) / 8;
}
