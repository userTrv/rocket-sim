import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/sim/events';
import { altitude } from '../../src/sim/frames';
import { Simulation } from '../../src/sim/simulation';
import { maxAllowedWarp, PHYSICS_WARP_MAX, stepSizeForWarp } from '../../src/sim/time-warp';
import { FALCON_9 } from '../../src/sim/vehicle/falcon9';

const DEG = 180 / Math.PI;

/** Fly headless with the autopilot, using as much time warp as the rules allow. */
function flyToOrbit() {
  const sim = new Simulation({ vehicle: FALCON_9 });
  const events: SimEvent[] = [];
  sim.toggleAutopilot();
  let maxQ = 0;
  let maxG = 0;
  while (sim.t < 2 * 3600 && sim.phase !== 'crashed') {
    const warp = maxAllowedWarp({
      flying: sim.phase === 'flight',
      thrusting: sim.vehicle.engineRunning,
      altitude: altitude(sim.state.r),
      autopilotLimit: sim.autopilotWarpLimit,
    });
    sim.step(stepSizeForWarp(warp), warp > PHYSICS_WARP_MAX);
    events.push(...sim.drainEvents());
    maxQ = Math.max(maxQ, sim.telemetry.dynamicPressure);
    maxG = Math.max(maxG, sim.telemetry.gLoad);
    if (sim.autopilot?.phase === 'orbit' || sim.autopilot?.phase === 'out-of-propellant') break;
  }
  return { sim, events, maxQ, maxG };
}

describe('autopilot end-to-end', () => {
  const { sim, events, maxQ, maxG } = flyToOrbit();
  const orbit = sim.telemetry.orbit;

  it('reaches a stable orbit (periapsis above 150 km)', () => {
    expect(sim.phase).toBe('flight');
    expect(sim.autopilot?.phase).toBe('orbit');
    expect(sim.orbitAchieved).toBe(true);
    expect(orbit.periapsis).toBeGreaterThan(150_000);
  });

  it('circularises near the 200 km target', () => {
    expect(orbit.apoapsis).toBeGreaterThan(180_000);
    expect(orbit.apoapsis).toBeLessThan(230_000);
    expect(orbit.eccentricity).toBeLessThan(0.005);
  });

  it('stays within the propellant budget', () => {
    expect(sim.vehicle.stageIndex).toBe(1);
    expect(sim.vehicle.stagePropellant).toBeGreaterThan(0);
  });

  it('flies due east from the Cape, so inclination is about the launch latitude', () => {
    expect(orbit.inclination * DEG).toBeGreaterThan(28);
    expect(orbit.inclination * DEG).toBeLessThan(30);
  });

  it('respects the structural limits it guides to', () => {
    expect(maxQ).toBeLessThan(36_000);
    expect(maxG).toBeLessThan(4.7);
  });

  it('emits the mission events in the right order', () => {
    const order = ['liftoff', 'max-q', 'meco', 'stage-sep', 'ignition', 'fairing-sep', 'seco', 'ignition', 'orbit', 'seco'];
    const seen = events.map((e) => e.type).filter((t) => order.includes(t));
    let cursor = 0;
    for (const type of seen) if (type === order[cursor]) cursor++;
    expect(cursor).toBe(order.length);
  });

  it('leaves the spent first stage on a ballistic path back to Earth', () => {
    const stage = sim.debris.find((d) => d.kind === 'stage');
    expect(stage).toBeDefined();
    expect(stage!.alive).toBe(false); // it has hit the ground (ocean) by now
  });
});
