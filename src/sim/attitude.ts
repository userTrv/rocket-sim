import { cross, length, normalize, reject, vec3, type Vec3 } from './math/vec3';
import { conjugate, fromBasis, integrateBodyRate, multiply, type Quat } from './math/quat';

/**
 * Rigid-body rotation and attitude control.
 * Body axes: +Y nose (thrust direction), +Z "top" (canopy), +X right. Pitch is about X,
 * roll about Y, yaw about Z. Angular velocity is expressed in the body frame.
 */
export interface RotationalState {
  readonly q: Quat;
  readonly w: Vec3;
}

export interface Inertia {
  /** About X and Z (pitch/yaw). */
  readonly pitch: number;
  /** About Y (roll). */
  readonly roll: number;
}

export const NOSE: Vec3 = vec3(0, 1, 0);
export const TOP: Vec3 = vec3(0, 0, 1);

/**
 * Integrate Euler's rotation equations with a semi-implicit Euler step:
 * I dw/dt = tau - w x (I w), then rotate the quaternion by the new rate.
 */
export function rotationalStep(
  state: RotationalState,
  torque: Vec3,
  inertia: Inertia,
  dt: number,
): RotationalState {
  const { w } = state;
  const Iw = vec3(inertia.pitch * w.x, inertia.roll * w.y, inertia.pitch * w.z);
  const gyro = cross(w, Iw);
  const w2 = vec3(
    w.x + ((torque.x - gyro.x) / inertia.pitch) * dt,
    w.y + ((torque.y - gyro.y) / inertia.roll) * dt,
    w.z + ((torque.z - gyro.z) / inertia.pitch) * dt,
  );
  return { q: integrateBodyRate(state.q, w2, dt), w: w2 };
}

/** Target attitude whose nose points along `forward` and top leans towards `topHint`. */
export function attitudeFromForward(forward: Vec3, topHint: Vec3): Quat {
  const y = normalize(forward);
  let z = normalize(reject(topHint, y));
  if (length(z) < 1e-6) z = normalize(reject(vec3(1, 0, 0), y));
  const x = cross(y, z);
  return fromBasis(x, y, z);
}

/** Rotation vector (axis * angle, body frame) that takes attitude q onto target. */
export function attitudeError(q: Quat, target: Quat): Vec3 {
  let e = multiply(conjugate(q), target);
  if (e.w < 0) e = { w: -e.w, x: -e.x, y: -e.y, z: -e.z };
  const s = Math.hypot(e.x, e.y, e.z);
  if (s < 1e-12) return vec3(0, 0, 0);
  const angle = 2 * Math.atan2(s, e.w);
  return vec3((e.x / s) * angle, (e.y / s) * angle, (e.z / s) * angle);
}

export interface ControllerTuning {
  /** Proportional gain from angle error to desired rate, 1/s. */
  readonly rateGain: number;
  /** Maximum commanded rotation rate, rad/s. */
  readonly maxRate: number;
  /** Time constant for tracking the desired rate, s. */
  readonly rateTimeConstant: number;
}

export const DEFAULT_TUNING: ControllerTuning = { rateGain: 0.8, maxRate: 0.2, rateTimeConstant: 0.35 };

/**
 * Saturation-aware attitude controller. For each axis the desired rate is limited so the
 * vehicle can still stop in time with the available angular acceleration (a "bang-bang
 * with a glide slope" law), then a rate loop turns the rate error into a normalised
 * torque command in [-1, 1].
 */
export function attitudeControl(
  state: RotationalState,
  target: Quat,
  maxAngularAccel: Vec3,
  tuning: ControllerTuning = DEFAULT_TUNING,
): Vec3 {
  const err = attitudeError(state.q, target);
  const axis = (e: number, w: number, aMax: number): number => {
    if (aMax <= 1e-9) return 0;
    const stoppable = Math.sqrt(2 * 0.5 * aMax * Math.abs(e));
    const desired = Math.sign(e) * Math.min(tuning.rateGain * Math.abs(e), stoppable, tuning.maxRate);
    const accel = (desired - w) / tuning.rateTimeConstant;
    return Math.max(-1, Math.min(1, accel / aMax));
  };
  return vec3(
    axis(err.x, state.w.x, maxAngularAccel.x),
    axis(err.y, state.w.y, maxAngularAccel.y),
    axis(err.z, state.w.z, maxAngularAccel.z),
  );
}

/** Rate-damping command (drive angular velocity to zero). */
export function killRotation(state: RotationalState, maxAngularAccel: Vec3, timeConstant = 0.35): Vec3 {
  const axis = (w: number, aMax: number) =>
    aMax <= 1e-9 ? 0 : Math.max(-1, Math.min(1, -w / timeConstant / aMax));
  return vec3(axis(state.w.x, maxAngularAccel.x), axis(state.w.y, maxAngularAccel.y), axis(state.w.z, maxAngularAccel.z));
}
