import { describe, expect, it } from 'vitest';
import { R_EARTH } from '../../src/sim/constants';
import { altitude, surfaceVelocityAt } from '../../src/sim/frames';
import { length, sub } from '../../src/sim/math/vec3';
import { Simulation } from '../../src/sim/simulation';
import { FALCON_9 } from '../../src/sim/vehicle/falcon9';

const DT = 0.02;
const run = (sim: Simulation, seconds: number) => {
  for (let t = 0; t < seconds; t += DT) sim.step(DT);
};

describe('simulation', () => {
  it('sits on the pad, co-rotating with the Earth, until launched', () => {
    const sim = new Simulation({ vehicle: FALCON_9 });
    run(sim, 10);
    expect(sim.phase).toBe('prelaunch');
    expect(length(sub(sim.state.v, surfaceVelocityAt(sim.state.r)))).toBeLessThan(1e-6);
    expect(altitude(sim.state.r)).toBeCloseTo(sim.vehicle.massProperties().comHeight, 6);
    // ~408 m/s eastward surface speed at 28.6 deg latitude
    expect(length(sim.state.v)).toBeCloseTo(408, 0);
  });

  it('lifts off when thrust exceeds weight and climbs', () => {
    const sim = new Simulation({ vehicle: FALCON_9 });
    sim.launch();
    run(sim, 20);
    expect(sim.phase).toBe('flight');
    expect(sim.liftoffTime).not.toBeNull();
    expect(sim.telemetry.altitude).toBeGreaterThan(500);
    expect(sim.telemetry.verticalSpeed).toBeGreaterThan(40);
    const types = sim.drainEvents().map((e) => e.type);
    expect(types).toEqual(['ignition', 'liftoff']);
  });

  it('stays down if the throttle is too low to lift off', () => {
    const sim = new Simulation({ vehicle: FALCON_9 });
    sim.setThrottle(0.5);
    sim.launch();
    run(sim, 5);
    expect(sim.phase).toBe('prelaunch');
  });

  it('separates stages into ballistic debris and shifts to the new centre of mass', () => {
    const sim = new Simulation({ vehicle: FALCON_9 });
    sim.launch();
    run(sim, 60);
    const massBefore = sim.vehicle.mass;
    const altBefore = sim.telemetry.altitude;
    sim.stage();
    expect(sim.vehicle.stageIndex).toBe(1);
    expect(sim.debris).toHaveLength(1);
    expect(sim.vehicle.mass).toBeLessThan(massBefore / 2);
    // The upper stack's CoM is tens of metres above the old one.
    expect(altitude(sim.state.r) - altBefore).toBeGreaterThan(20);
    const types = sim.drainEvents().map((e) => e.type);
    expect(types).toContain('meco');
    expect(types).toContain('stage-sep');
    // The next engine lights on the next step because the throttle is up.
    sim.step(DT);
    expect(sim.vehicle.engineRunning).toBe(true);
    // The spent stage falls behind and below.
    run(sim, 30);
    const stage = sim.debris[0]!;
    expect(length(stage.r)).toBeLessThan(length(sim.state.r));
  });

  it('uses up relights and refuses to ignite without any left', () => {
    const sim = new Simulation({ vehicle: FALCON_9 });
    sim.launch();
    run(sim, 30);
    for (let i = 0; i < 5; i++) {
      sim.setThrottle(0);
      sim.step(DT);
      sim.setThrottle(1);
      sim.step(DT);
    }
    expect(sim.vehicle.stageIgnitionsLeft).toBe(0);
    expect(sim.vehicle.engineRunning).toBe(false);
    expect(sim.drainEvents().some((e) => e.type === 'no-ignitions')).toBe(true);
  });

  it('detects a crash and reports the impact speed', () => {
    const sim = new Simulation({ vehicle: FALCON_9 });
    sim.launch();
    run(sim, 8);
    sim.setThrottle(0);
    run(sim, 60);
    expect(sim.phase).toBe('crashed');
    expect(sim.impactSpeed).toBeGreaterThan(20);
    expect(sim.drainEvents().at(-1)?.type).toBe('crash');
    expect(length(sim.state.r)).toBeGreaterThan(R_EARTH - 100);
  });

  it('turns the vehicle with manual input and holds attitude with SAS', () => {
    const sim = new Simulation({ vehicle: FALCON_9 });
    sim.launch();
    run(sim, 15);
    sim.setPilotInput({ pitch: -1, yaw: 0, roll: 0 }); // W: nose down towards the east
    run(sim, 3);
    sim.setPilotInput({ pitch: 0, yaw: 0, roll: 0 });
    sim.toggleSas();
    run(sim, 10);
    const pitched = sim.telemetry.pitch;
    expect(pitched).toBeLessThan(89);
    expect(sim.telemetry.heading).toBeGreaterThan(80);
    expect(sim.telemetry.heading).toBeLessThan(100);
    run(sim, 5);
    // SAS holds the inertial attitude: rates stay near zero.
    expect(length(sim.state.w)).toBeLessThan(0.01);
  });

  it('disengages the autopilot on manual input', () => {
    const sim = new Simulation({ vehicle: FALCON_9 });
    sim.toggleAutopilot();
    run(sim, 5);
    expect(sim.autopilot).not.toBeNull();
    sim.setPilotInput({ pitch: 1, yaw: 0, roll: 0 });
    expect(sim.autopilot).toBeNull();
  });
});
