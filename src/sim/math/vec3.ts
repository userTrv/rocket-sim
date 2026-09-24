/**
 * Minimal immutable 3D vector math in double precision.
 * Plain objects keep the simulation core dependency-free and easy to test.
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const ZERO: Vec3 = vec3(0, 0, 0);

export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);

export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);

export const scale = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s);

/** a + b * s */
export const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 =>
  vec3(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export const lengthSq = (a: Vec3): number => dot(a, a);

export const length = (a: Vec3): number => Math.sqrt(dot(a, a));

export const normalize = (a: Vec3): Vec3 => {
  const len = length(a);
  return len > 0 ? scale(a, 1 / len) : ZERO;
};

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

export const negate = (a: Vec3): Vec3 => vec3(-a.x, -a.y, -a.z);

/** Component of `a` perpendicular to the unit vector `n`. */
export const reject = (a: Vec3, n: Vec3): Vec3 => addScaled(a, n, -dot(a, n));

/** Angle between two vectors in radians, numerically safe near 0 and pi. */
export const angleBetween = (a: Vec3, b: Vec3): number =>
  Math.atan2(length(cross(a, b)), dot(a, b));

/** Rotate `v` around unit `axis` by `angle` radians (Rodrigues' formula). */
export const rotateAroundAxis = (v: Vec3, axis: Vec3, angle: number): Vec3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const term1 = scale(v, c);
  const term2 = scale(cross(axis, v), s);
  const term3 = scale(axis, dot(axis, v) * (1 - c));
  return add(add(term1, term2), term3);
};
