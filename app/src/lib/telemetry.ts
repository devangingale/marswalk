// Written with AI assistance, directed and reviewed by the team.

/**
 * Telemetry adapter interface (design: "Hardware links").
 *
 * One interface sits between the app and all hardware: crew positions, suit
 * status, rover status, the habitat link state, and commands to the rover.
 * Screens depend only on this interface; concrete adapters (simulated, a real
 * habitat bridge, or local paired devices) implement it.
 *
 * This file is pure data and types only: no React, no DOM, no timers. The
 * simulated adapter lives in `telemetrySim.ts`.
 */

/** A single reading of everything the hardware exposes, at wall-clock `tMs`. */
export type TelemetrySnapshot = {
  /** Wall-clock time of this reading, milliseconds (from the adapter's clock). */
  tMs: number;
  crew: {
    id: string;
    lon: number;
    lat: number;
    /**
     * Position uncertainty radius in local-frame metres. Grows while walking
     * (dead reckoning) and shrinks at a re-fix. Drives the on-screen
     * uncertainty circle and widens hazard margins.
     */
    uncertaintyM: number;
    suit: {
      /** Primary oxygen remaining, percent (SUITS O2 storage range 20-100 %). */
      o2Pct: number;
      /** Suit battery remaining, percent (SUITS batteries 20-100 %). */
      powerPct: number;
      /** Suit internal temperature, deg C (SUITS range 10-32 C). */
      tempC: number;
      /** Crew heart rate, bpm (SUITS range 50-160 bpm). */
      heartRate: number;
    };
  }[];
  rover: {
    lon: number;
    lat: number;
    /** Heading, degrees clockwise from north. */
    headingDeg: number;
    /** Rover battery remaining, percent. */
    batteryPct: number;
    /** Estimated seconds for the rover to reach the lead crew member; null if unknown. */
    etaToCrewS: number | null;
  };
  /** State of the always-on local link to the habitat. */
  habitatLink: 'live' | 'lost';
};

/**
 * A command the app requests of the rover. The rover's own hazard checks
 * always win (the app requests, the rover decides); every command is logged.
 * - `come_to_me` / `drive_to`: drive to a single point (lon, lat).
 * - `send_route`: hand the rover a planned route of [lon, lat] waypoints.
 */
export type RoverCommand =
  | { kind: 'come_to_me' | 'drive_to'; lon: number; lat: number }
  | { kind: 'send_route'; route: [number, number][] };

/** The rover's reply to a command. */
export type CommandReceipt = {
  /** Whether the rover accepted the request. */
  accepted: boolean;
  /** Estimated seconds to complete; null when not applicable or not accepted. */
  etaS: number | null;
  /** Present only when the command was not accepted, explaining why. */
  reason?: string;
  /** Opaque id for this command in the device command log. */
  logId: string;
};

/** The single hardware interface every screen depends on. */
export interface TelemetryAdapter {
  /**
   * Register a callback for telemetry snapshots. The current snapshot is
   * delivered immediately on subscribe; further snapshots follow when the
   * adapter's state changes (e.g. after a command). Returns an unsubscribe
   * function that stops all further callbacks.
   */
  subscribe(cb: (s: TelemetrySnapshot) => void): () => void;
  /** Request a rover command; resolves with the rover's receipt. */
  command(c: RoverCommand): Promise<CommandReceipt>;
  /** True when every value is simulated and must be labelled so on screen. */
  readonly simulated: boolean;
}
