import { vec3, type Vec3 } from './vec3';

/**
 * Unit quaternion describing the rotation from the body frame to the inertial frame.
 * Convention: v_inertial = q * v_body * q^-1.
 */
export interface Quat {
  readonly w: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const quat = (w: number, x: number, y: number, z: number): Quat => ({ w, x, y, z });

export const IDENTITY: Quat = quat(1, 0, 0, 0);

export const multiply = (a: Quat, b: Quat): Quat =>
  quat(
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  );

export const conjugate = (q: Quat): Quat => quat(q.w, -q.x, -q.y, -q.z);

export const normalizeQuat = (q: Quat): Quat => {
  const n = Math.hypot(q.w, q.x, q.y, q.z);
  return n > 0 ? quat(q.w / n, q.x / n, q.y / n, q.z / n) : IDENTITY;
};

/** Rotate a vector from body to inertial frame. */
export const rotate = (q: Quat, v: Vec3): Vec3 => {
  // Optimised q * v * q^-1 (t = 2 * cross(q.xyz, v); v' = v + w*t + cross(q.xyz, t))
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return vec3(
    v.x + q.w * tx + (q.y * tz - q.z * ty),
    v.y + q.w * ty + (q.z * tx - q.x * tz),
    v.z + q.w * tz + (q.x * ty - q.y * tx),
  );
};

/** Rotate a vector from inertial to body frame. */
export const rotateInverse = (q: Quat, v: Vec3): Vec3 => rotate(conjugate(q), v);

export const fromAxisAngle = (axis: Vec3, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return quat(Math.cos(angle / 2), axis.x * s, axis.y * s, axis.z * s);
};

/**
 * Quaternion whose body axes X, Y, Z map onto the given orthonormal inertial basis vectors.
 * (Rotation matrix with the basis vectors as columns.)
 */
export const fromBasis = (bx: Vec3, by: Vec3, bz: Vec3): Quat => {
  const m00 = bx.x, m01 = by.x, m02 = bz.x;
  const m10 = bx.y, m11 = by.y, m12 = bz.y;
  const m20 = bx.z, m21 = by.z, m22 = bz.z;
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = quat(0.25 / s, (m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s);
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = quat((m21 - m12) / s, 0.25 * s, (m01 + m10) / s, (m02 + m20) / s);
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = quat((m02 - m20) / s, (m01 + m10) / s, 0.25 * s, (m12 + m21) / s);
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = quat((m10 - m01) / s, (m02 + m20) / s, (m12 + m21) / s, 0.25 * s);
  }
  return normalizeQuat(q);
};

/**
 * Advance attitude by a body-frame angular velocity over dt (exact for constant rate):
 * q' = q * exp(omega * dt / 2).
 */
export const integrateBodyRate = (q: Quat, omega: Vec3, dt: number): Quat => {
  const rate = Math.hypot(omega.x, omega.y, omega.z);
  if (rate * dt < 1e-12) return q;
  const axis = vec3(omega.x / rate, omega.y / rate, omega.z / rate);
  return normalizeQuat(multiply(q, fromAxisAngle(axis, rate * dt)));
};

/** Spherical linear interpolation along the shortest arc. */
export const slerp = (a: Quat, b: Quat, t: number): Quat => {
  let cos = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  let bb = b;
  if (cos < 0) {
    cos = -cos;
    bb = quat(-b.w, -b.x, -b.y, -b.z);
  }
  if (cos > 0.9995) {
    return normalizeQuat(
      quat(a.w + (bb.w - a.w) * t, a.x + (bb.x - a.x) * t, a.y + (bb.y - a.y) * t, a.z + (bb.z - a.z) * t),
    );
  }
  const theta = Math.acos(cos);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return quat(a.w * wa + bb.w * wb, a.x * wa + bb.x * wb, a.y * wa + bb.y * wb, a.z * wa + bb.z * wb);
};
