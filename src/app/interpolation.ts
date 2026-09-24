import type { BodyState } from '../sim/simulation';
import { lerp, type Vec3 } from '../sim/math/vec3';
import { slerp, type Quat } from '../sim/math/quat';

export interface PoseSnapshot {
  readonly r: Vec3;
  readonly q: Quat;
}

/** Previous-step poses for the vehicle and debris, used to interpolate the rendered frame. */
export interface WorldSnapshot {
  readonly vehicle: BodyState;
  readonly stageIndex: number;
  readonly debris: ReadonlyMap<number, PoseSnapshot>;
}

export const interpolatePose = (a: PoseSnapshot, b: PoseSnapshot, t: number): PoseSnapshot => ({
  r: lerp(a.r, b.r, t),
  q: slerp(a.q, b.q, t),
});

/**
 * Blend two body states. Across a staging event the CoM jumps along the stack, so
 * interpolation is skipped when the stage index differs.
 */
export function interpolateBody(prev: WorldSnapshot | null, current: BodyState, stageIndex: number, alpha: number): BodyState {
  if (!prev || prev.stageIndex !== stageIndex) return current;
  const pose = interpolatePose(prev.vehicle, current, alpha);
  return { ...current, r: pose.r, q: pose.q, v: lerp(prev.vehicle.v, current.v, alpha) };
}
