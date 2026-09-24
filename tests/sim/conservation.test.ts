import { describe, expect, it } from 'vitest';
import { MU_EARTH, R_EARTH } from '../../src/sim/constants';
import { rk4Step, specificEnergy, type PointMassState } from '../../src/sim/dynamics';
import { cross, length, sub, vec3 } from '../../src/sim/math/vec3';
import { orbitalElements } from '../../src/sim/orbit';

const coast = { thrust: vec3(0, 0, 0), massFlow: 0, referenceArea: 0 };

function propagate(s: PointMassState, dt: number, duration: number): PointMassState {
  let state = s;
  const steps = Math.round(duration / dt);
  for (let i = 0; i < steps; i++) state = rk4Step(state, coast, dt);
  return state;
}

describe('RK4 integrator on a coasting orbit', () => {
  // An eccentric, inclined orbit (e ~ 0.1) out of any atmosphere.
  const rp = R_EARTH + 400_000;
  const ra = R_EARTH + 2_000_000;
  const a = (rp + ra) / 2;
  const vp = Math.sqrt(MU_EARTH * (2 / rp - 1 / a));
  const start: PointMassState = { r: vec3(rp, 0, 0), v: vec3(0, vp * 0.5, -vp * Math.sqrt(0.75)), m: 1000 };
  const period = 2 * Math.PI * Math.sqrt(a ** 3 / MU_EARTH);

  it.each([
    { dt: 0.1, tolerance: 1e-10 },
    { dt: 1, tolerance: 1e-8 },
  ])('conserves energy and angular momentum over 5 periods (dt = $dt s)', ({ dt, tolerance }) => {
    const e0 = specificEnergy(start.r, start.v);
    const h0 = length(cross(start.r, start.v));
    const end = propagate(start, dt, 5 * period);
    const e1 = specificEnergy(end.r, end.v);
    const h1 = length(cross(end.r, end.v));
    expect(Math.abs((e1 - e0) / e0)).toBeLessThan(tolerance);
    expect(Math.abs((h1 - h0) / h0)).toBeLessThan(tolerance);
  });

  it('returns to the starting point after exactly one period', () => {
    const end = propagate(start, 0.5, period);
    // Period is not an exact multiple of dt; allow the fraction of a step.
    expect(length(sub(end.r, start.r))).toBeLessThan(length(start.v) * 0.5);
  });

  it('keeps the orbital elements fixed', () => {
    const el0 = orbitalElements(start.r, start.v);
    const el1 = (() => {
      const s = propagate(start, 1, 3 * period);
      return orbitalElements(s.r, s.v);
    })();
    expect(el1.apoapsis).toBeCloseTo(el0.apoapsis, -1);
    expect(el1.periapsis).toBeCloseTo(el0.periapsis, -1);
    expect(el1.inclination).toBeCloseTo(el0.inclination, 8);
  });
});
