import { ATMOSPHERE_CEILING } from './atmosphere';

/** Available time-warp multipliers. Up to PHYSICS_WARP_MAX the full physics runs as usual. */
export const WARP_LEVELS = [1, 2, 4, 10, 50, 100, 1000] as const;
export const PHYSICS_WARP_MAX = 4;

/** Fixed simulation step. Rails warp uses a longer (still tiny vs. the orbit period) RK4 step. */
export const BASE_STEP = 0.02;
export const RAILS_STEP = 0.1;

export interface WarpConditions {
  readonly flying: boolean;
  readonly thrusting: boolean;
  readonly altitude: number;
  /** Limit requested by the autopilot (e.g. an upcoming burn). */
  readonly autopilotLimit: number;
}

/**
 * KSP-like rules: physics warp (<= 4x) any time in flight; high "rails" warp only when
 * coasting above the atmosphere, and never past an autopilot-requested limit.
 */
export function maxAllowedWarp(c: WarpConditions): number {
  if (!c.flying) return 1;
  if (c.thrusting || c.altitude < ATMOSPHERE_CEILING) return PHYSICS_WARP_MAX;
  const limit = Math.max(1, c.autopilotLimit);
  let best: number = WARP_LEVELS[0];
  for (const w of WARP_LEVELS) if (w <= limit) best = w;
  return best;
}

/** Clamp a requested warp to the allowed level (snapping down to a valid level). */
export function clampWarp(requested: number, allowed: number): number {
  let best: number = WARP_LEVELS[0];
  for (const w of WARP_LEVELS) if (w <= requested && w <= allowed) best = w;
  return best;
}

export function stepWarp(current: number, direction: 1 | -1): number {
  const i = WARP_LEVELS.indexOf(current as (typeof WARP_LEVELS)[number]);
  const next = Math.max(0, Math.min(WARP_LEVELS.length - 1, (i < 0 ? 0 : i) + direction));
  return WARP_LEVELS[next]!;
}

export const stepSizeForWarp = (warp: number): number => (warp > PHYSICS_WARP_MAX ? RAILS_STEP : BASE_STEP);
