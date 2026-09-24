import { dragCoefficient, dynamicPressure } from './aero';
import { atmosphereAt } from './atmosphere';
import { MU_EARTH, R_EARTH } from './constants';
import { surfaceVelocityAt } from './frames';
import { add, addScaled, length, scale, sub, type Vec3 } from './math/vec3';

/** Translational state integrated with RK4. */
export interface PointMassState {
  readonly r: Vec3;
  readonly v: Vec3;
  readonly m: number;
}

/** Inputs held constant over one integration step. */
export interface StepInputs {
  /** Thrust force in the inertial frame, N. */
  readonly thrust: Vec3;
  /** Propellant mass flow, kg/s (positive = mass decreases). */
  readonly massFlow: number;
  /** Drag reference area, m^2 (0 disables drag). */
  readonly referenceArea: number;
}

export interface AeroState {
  readonly force: Vec3;
  readonly airVelocity: Vec3;
  readonly airspeed: number;
  readonly mach: number;
  readonly dynamicPressure: number;
  readonly density: number;
  readonly pressure: number;
}

/** Inverse-square point-mass gravity. */
export const gravityAt = (r: Vec3, mu = MU_EARTH): Vec3 => {
  const d = length(r);
  return scale(r, -mu / (d * d * d));
};

/** Drag against the co-rotating atmosphere, with a Mach-dependent drag coefficient. */
export function aerodynamics(r: Vec3, v: Vec3, referenceArea: number): AeroState {
  const atm = atmosphereAt(length(r) - R_EARTH);
  const airVelocity = sub(v, surfaceVelocityAt(r));
  const airspeed = length(airVelocity);
  const mach = airspeed / atm.speedOfSound;
  const q = dynamicPressure(atm.density, airspeed);
  const dragMagnitude = q * dragCoefficient(mach) * referenceArea;
  const force = airspeed > 1e-9 ? scale(airVelocity, -dragMagnitude / airspeed) : scale(airVelocity, 0);
  return { force, airVelocity, airspeed, mach, dynamicPressure: q, density: atm.density, pressure: atm.pressure };
}

interface Derivative {
  readonly dr: Vec3;
  readonly dv: Vec3;
  readonly dm: number;
}

function derivative(s: PointMassState, inputs: StepInputs): Derivative {
  let accel = gravityAt(s.r);
  if (s.m > 0) {
    accel = addScaled(accel, inputs.thrust, 1 / s.m);
    if (inputs.referenceArea > 0) {
      accel = addScaled(accel, aerodynamics(s.r, s.v, inputs.referenceArea).force, 1 / s.m);
    }
  }
  return { dr: s.v, dv: accel, dm: -inputs.massFlow };
}

const advance = (s: PointMassState, d: Derivative, dt: number): PointMassState => ({
  r: addScaled(s.r, d.dr, dt),
  v: addScaled(s.v, d.dv, dt),
  m: s.m + d.dm * dt,
});

/** Classic 4th-order Runge-Kutta step for position, velocity and mass. */
export function rk4Step(s: PointMassState, inputs: StepInputs, dt: number): PointMassState {
  const k1 = derivative(s, inputs);
  const k2 = derivative(advance(s, k1, dt / 2), inputs);
  const k3 = derivative(advance(s, k2, dt / 2), inputs);
  const k4 = derivative(advance(s, k3, dt), inputs);
  const sum = (a: Vec3, b: Vec3, c: Vec3, d: Vec3): Vec3 =>
    add(add(a, scale(add(b, c), 2)), d);
  return {
    r: addScaled(s.r, sum(k1.dr, k2.dr, k3.dr, k4.dr), dt / 6),
    v: addScaled(s.v, sum(k1.dv, k2.dv, k3.dv, k4.dv), dt / 6),
    m: s.m + ((k1.dm + 2 * k2.dm + 2 * k3.dm + k4.dm) * dt) / 6,
  };
}

/** Specific mechanical energy of a point mass in the central field, J/kg. */
export const specificEnergy = (r: Vec3, v: Vec3, mu = MU_EARTH): number =>
  (length(v) ** 2) / 2 - mu / length(r);
