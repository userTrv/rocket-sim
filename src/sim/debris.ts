import { R_EARTH } from './constants';
import { rk4Step } from './dynamics';
import { length, type Vec3 } from './math/vec3';
import { integrateBodyRate, type Quat } from './math/quat';

/** A jettisoned body (spent stage, fairing half) flying a simple ballistic path. */
export interface Debris {
  readonly id: number;
  readonly kind: 'stage' | 'fairing';
  readonly name: string;
  /** Index of the stage (for visuals), or the fairing side (-1 / +1). */
  readonly variant: number;
  r: Vec3;
  v: Vec3;
  q: Quat;
  /** Constant body-frame tumble rate, rad/s. */
  readonly w: Vec3;
  readonly mass: number;
  /** Drag area * tumbling factor, m^2. */
  readonly referenceArea: number;
  readonly createdAt: number;
  alive: boolean;
}

/** Tumbling bodies present much more area than a nose-first rocket. */
export const TUMBLE_DRAG_FACTOR = 4;

/** Propagate a debris body: gravity + drag (RK4), constant tumble. Marks impact on the ground. */
export function stepDebris(d: Debris, dt: number): void {
  if (!d.alive) return;
  const next = rk4Step({ r: d.r, v: d.v, m: d.mass }, { thrust: { x: 0, y: 0, z: 0 }, massFlow: 0, referenceArea: d.referenceArea }, dt);
  d.r = next.r;
  d.v = next.v;
  d.q = integrateBodyRate(d.q, d.w, dt);
  if (length(d.r) <= R_EARTH) d.alive = false;
}
