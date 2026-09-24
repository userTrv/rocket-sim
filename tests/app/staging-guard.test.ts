import { describe, expect, it } from 'vitest';
import { earlyStagingWarning } from '../../src/app/staging-guard';
import { Simulation } from '../../src/sim/simulation';
import { FALCON_9 } from '../../src/sim/vehicle/falcon9';

const run = (sim: Simulation, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.02) sim.step(0.02);
};

describe('early staging guard', () => {
  it('does not interfere with the launch press on the pad', () => {
    expect(earlyStagingWarning(new Simulation({ vehicle: FALCON_9 }).telemetry)).toBeNull();
  });

  it('asks to confirm separating a burning, fuelled first stage', () => {
    const sim = new Simulation({ vehicle: FALCON_9 });
    sim.launch();
    run(sim, 5);
    expect(earlyStagingWarning(sim.telemetry)).toMatch(/press Space again/);
  });

  it('lets a spent or shut-down stage go without confirmation', () => {
    const sim = new Simulation({ vehicle: FALCON_9 });
    sim.launch();
    run(sim, 5);
    sim.setThrottle(0);
    run(sim, 1);
    expect(sim.telemetry.engineRunning).toBe(false);
    expect(earlyStagingWarning(sim.telemetry)).toBeNull();
  });
});
