import { G0 } from './constants';
import { NOSE } from './attitude';
import { altitude, elevationAngle, headingOf, surfaceVelocityAt } from './frames';
import { addScaled, angleBetween, dot, length, normalize, reject, sub } from './math/vec3';
import { rotate } from './math/quat';
import type { MaxQDetector } from './events';
import type { Simulation } from './simulation';
import type { Telemetry } from './telemetry';

const DEG = 180 / Math.PI;

/** Derive HUD values from the current simulation state. */
export function computeTelemetry(sim: Simulation, maxQ: MaxQDetector): Telemetry {
  const { r, v, q } = sim.state;
  const vehicle = sim.vehicle;
  const up = normalize(r);
  const nose = rotate(q, NOSE);
  const surfaceVel = sub(v, surfaceVelocityAt(r));
  const mass = vehicle.mass;
  const aero = sim.aero;
  const thrust = sim.propulsion.thrust;
  const specificForce = sim.phase === 'prelaunch'
    ? G0 // resting on the pad: the ground pushes back with 1 g
    : length(addScaled(aero.force, nose, thrust)) / mass;

  return {
    missionTime: sim.missionTime,
    altitude: altitude(r),
    surfaceSpeed: length(surfaceVel),
    orbitalSpeed: length(v),
    verticalSpeed: dot(v, up),
    horizontalSpeed: length(reject(v, up)),
    mach: aero.mach,
    dynamicPressure: aero.dynamicPressure,
    maxQ: maxQ.peak,
    maxQTime: maxQ.reported ? maxQ.peakTime : null,
    gLoad: specificForce / G0,
    throttle: sim.propulsion.throttle > 0 ? sim.propulsion.throttle : vehicle.effectiveThrottle(sim.throttle) * (vehicle.engineRunning ? 1 : 0),
    thrust,
    mass,
    ambientPressure: aero.pressure,
    pitch: elevationAngle(r, nose) * DEG,
    heading: headingOf(r, nose),
    angleOfAttack: aero.airspeed > 5 ? angleBetween(nose, aero.airVelocity) * DEG : 0,
    orbit: sim.orbit,
    stages: vehicle.config.stages.map((s, i) => ({
      name: s.name,
      propellant: vehicle.propellant[i]!,
      capacity: s.propellantMass,
      attached: i >= vehicle.stageIndex,
      active: i === vehicle.stageIndex,
      ignitionsLeft: vehicle.ignitionsLeft[i]!,
    })),
    stageIndex: vehicle.stageIndex,
    engineRunning: vehicle.engineRunning,
    fairingAttached: vehicle.fairingAttached,
    sas: sim.sas,
    autopilot: sim.autopilot?.phase ?? null,
  };
}
