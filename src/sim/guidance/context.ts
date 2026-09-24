import { altitude } from '../frames';
import type { Simulation } from '../simulation';
import type { GuidanceContext } from './autopilot';

/** Snapshot of everything the autopilot may look at, taken from the simulation. */
export function buildGuidanceContext(sim: Simulation): GuidanceContext {
  const v = sim.vehicle;
  const { r } = sim.state;
  const pressure = sim.aero.pressure;
  return {
    t: sim.t,
    r,
    v: sim.state.v,
    altitude: altitude(r),
    dynamicPressure: sim.aero.dynamicPressure,
    orbit: sim.orbit,
    onPad: sim.phase === 'prelaunch',
    stageIndex: v.stageIndex,
    hasNextStage: v.hasNextStage,
    engineRunning: v.engineRunning,
    stagePropellant: v.stagePropellant,
    mass: v.mass,
    fullThrust: Math.max(0, v.stage.engine.vacuumThrust - pressure * v.exitArea()),
    maxMassFlow: v.maxMassFlow(),
    minThrottle: v.stage.engine.minThrottle,
    ispVacuum: v.stage.engine.ispVacuum,
  };
}
