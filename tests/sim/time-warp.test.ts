import { describe, expect, it } from 'vitest';
import { clampWarp, maxAllowedWarp, PHYSICS_WARP_MAX, stepSizeForWarp, stepWarp, BASE_STEP, RAILS_STEP } from '../../src/sim/time-warp';

const coasting = { flying: true, thrusting: false, altitude: 300_000, autopilotLimit: Infinity };

describe('time warp policy', () => {
  it('allows no warp on the pad', () => {
    expect(maxAllowedWarp({ ...coasting, flying: false })).toBe(1);
  });

  it('limits to physics warp in the atmosphere or under thrust', () => {
    expect(maxAllowedWarp({ ...coasting, altitude: 50_000 })).toBe(PHYSICS_WARP_MAX);
    expect(maxAllowedWarp({ ...coasting, thrusting: true })).toBe(PHYSICS_WARP_MAX);
  });

  it('allows full rails warp when coasting in space, capped by the autopilot', () => {
    expect(maxAllowedWarp(coasting)).toBe(1000);
    expect(maxAllowedWarp({ ...coasting, autopilotLimit: 75 })).toBe(50);
  });

  it('steps through the levels and snaps down to what is allowed', () => {
    expect(stepWarp(1, 1)).toBe(2);
    expect(stepWarp(1, -1)).toBe(1);
    expect(stepWarp(1000, 1)).toBe(1000);
    expect(clampWarp(1000, 4)).toBe(4);
    expect(clampWarp(50, 1000)).toBe(50);
  });

  it('uses a longer (but still fine) step only on rails', () => {
    expect(stepSizeForWarp(4)).toBe(BASE_STEP);
    expect(stepSizeForWarp(100)).toBe(RAILS_STEP);
  });
});
