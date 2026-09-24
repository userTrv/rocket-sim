import { describe, expect, it } from 'vitest';
import { attitudeControl, attitudeError, attitudeFromForward, NOSE, rotationalStep, type RotationalState } from '../../src/sim/attitude';
import { angleBetween, length, normalize, vec3 } from '../../src/sim/math/vec3';
import { fromBasis, IDENTITY, rotate } from '../../src/sim/math/quat';

describe('attitude kinematics', () => {
  it('builds quaternions from an orthonormal basis', () => {
    const q = fromBasis(vec3(0, 0, -1), vec3(1, 0, 0), vec3(0, -1, 0));
    const x = rotate(q, vec3(1, 0, 0));
    const y = rotate(q, vec3(0, 1, 0));
    expect(x.z).toBeCloseTo(-1, 12);
    expect(y.x).toBeCloseTo(1, 12);
  });

  it('points the nose along the requested direction', () => {
    const fwd = normalize(vec3(1, 2, 3));
    const q = attitudeFromForward(fwd, vec3(0, 1, 0));
    expect(angleBetween(rotate(q, NOSE), fwd)).toBeLessThan(1e-9);
    expect(length(attitudeError(q, q))).toBe(0);
  });

  it('spins up under constant torque as tau / I', () => {
    let s: RotationalState = { q: IDENTITY, w: vec3(0, 0, 0) };
    for (let i = 0; i < 100; i++) s = rotationalStep(s, vec3(1000, 0, 0), { pitch: 500, roll: 50 }, 0.01);
    expect(s.w.x).toBeCloseTo(2, 9); // 1000 / 500 * 1 s
  });
});

describe('attitude controller', () => {
  it.each([
    { name: 'a fast-turning vehicle', maxAccel: 0.5 },
    { name: 'a sluggish vehicle (RCS only)', maxAccel: 0.02 },
  ])('turns $name 90 degrees and settles without large overshoot', ({ maxAccel }) => {
    const inertia = { pitch: 1e5, roll: 1e4 };
    const accel = vec3(maxAccel, maxAccel, maxAccel);
    const torque = vec3(maxAccel * inertia.pitch, maxAccel * inertia.roll, maxAccel * inertia.pitch);
    const target = attitudeFromForward(vec3(1, 0, 0), vec3(0, 1, 0));
    let s: RotationalState = { q: attitudeFromForward(vec3(0, 1, 0), vec3(0, 0, 1)), w: vec3(0, 0, 0) };
    let maxErrorAfterCrossing = 0;
    let crossed = false;
    for (let t = 0; t < 200; t += 0.02) {
      const u = attitudeControl(s, target, accel);
      for (const c of [u.x, u.y, u.z]) expect(Math.abs(c)).toBeLessThanOrEqual(1);
      s = rotationalStep(s, vec3(u.x * torque.x, u.y * torque.y, u.z * torque.z), inertia, 0.02);
      const err = length(attitudeError(s.q, target));
      if (err < 0.05) crossed = true;
      if (crossed) maxErrorAfterCrossing = Math.max(maxErrorAfterCrossing, err);
    }
    expect(length(attitudeError(s.q, target))).toBeLessThan(0.01);
    expect(maxErrorAfterCrossing).toBeLessThan(0.1);
    expect(length(s.w)).toBeLessThan(1e-3);
  });
});
