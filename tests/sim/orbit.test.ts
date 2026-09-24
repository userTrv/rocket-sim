import { describe, expect, it } from 'vitest';
import { MU_EARTH, R_EARTH } from '../../src/sim/constants';
import { cross, length, vec3 } from '../../src/sim/math/vec3';
import { circularSpeed, orbitalElements, orbitPath } from '../../src/sim/orbit';

const DEG = Math.PI / 180;

describe('orbital elements from a state vector', () => {
  it('recognises a circular equatorial orbit', () => {
    const r = R_EARTH + 400_000;
    // Equator is the XZ plane (+Y is the pole). Moving along -Z at +X is prograde (eastward).
    const el = orbitalElements(vec3(r, 0, 0), vec3(0, 0, -circularSpeed(r)));
    expect(el.eccentricity).toBeLessThan(1e-9);
    expect(el.semiMajorAxis).toBeCloseTo(r, 0);
    expect(el.periapsis).toBeCloseTo(400_000, 0);
    expect(el.apoapsis).toBeCloseTo(400_000, 0);
    expect(el.inclination).toBeCloseTo(0, 9);
    expect(el.period).toBeCloseTo(2 * Math.PI * Math.sqrt(r ** 3 / MU_EARTH), 3);
    expect(el.period / 60).toBeCloseTo(92.41, 1); // ISS-like ~92 min period
    expect(el.bound).toBe(true);
  });

  it('computes inclination for a polar and an inclined orbit', () => {
    const r = R_EARTH + 500_000;
    const v = circularSpeed(r);
    expect(orbitalElements(vec3(r, 0, 0), vec3(0, v, 0)).inclination).toBeCloseTo(Math.PI / 2, 9);
    const inc = 51.6 * DEG;
    const el = orbitalElements(vec3(r, 0, 0), vec3(0, v * Math.sin(inc), -v * Math.cos(inc)));
    expect(el.inclination / DEG).toBeCloseTo(51.6, 6);
  });

  it('recovers apoapsis/periapsis of a known ellipse (state at periapsis)', () => {
    const rp = R_EARTH + 200_000;
    const ra = R_EARTH + 1_000_000;
    const a = (rp + ra) / 2;
    const vp = Math.sqrt(MU_EARTH * (2 / rp - 1 / a));
    const el = orbitalElements(vec3(rp, 0, 0), vec3(0, 0, -vp));
    expect(el.periapsis).toBeCloseTo(200_000, -1);
    expect(el.apoapsis).toBeCloseTo(1_000_000, -1);
    expect(el.eccentricity).toBeCloseTo((ra - rp) / (ra + rp), 9);
    expect(el.trueAnomaly).toBeCloseTo(0, 6);
    expect(el.timeToApoapsis).toBeCloseTo(el.period / 2, 3);
  });

  it('reports zero time to periapsis while passing periapsis', () => {
    const rp = R_EARTH + 300_000;
    const ra = R_EARTH + 300_100;
    const a = (rp + ra) / 2;
    const vp = Math.sqrt(MU_EARTH * (2 / rp - 1 / a));
    const el = orbitalElements(vec3(rp, 0, 0), vec3(0, 0, -vp));
    const t = el.timeToPeriapsis;
    expect(Math.min(t, el.period - t)).toBeLessThan(1);
  });

  it('marks escape trajectories as unbound', () => {
    const r = R_EARTH + 300_000;
    const escape = Math.sqrt((2 * MU_EARTH) / r);
    const el = orbitalElements(vec3(r, 0, 0), vec3(0, 0, -escape * 1.1));
    expect(el.bound).toBe(false);
    expect(el.apoapsis).toBe(Infinity);
    expect(el.period).toBe(Infinity);
  });

  it('samples a closed orbit path whose points satisfy the conic equation', () => {
    const rp = R_EARTH + 200_000;
    const ra = R_EARTH + 5_000_000;
    const a = (rp + ra) / 2;
    const vp = Math.sqrt(MU_EARTH * (2 / rp - 1 / a));
    const el = orbitalElements(vec3(0, 0, rp), vec3(vp, 0, 0));
    const path = orbitPath(el, 64);
    expect(path).toHaveLength(65);
    const radii = path.map(length);
    expect(Math.min(...radii)).toBeCloseTo(rp, -1);
    expect(Math.max(...radii)).toBeCloseTo(ra, -2);
    // All points lie in the orbital plane.
    const n = cross(vec3(0, 0, rp), vec3(vp, 0, 0));
    for (const p of path) expect(Math.abs(p.x * n.x + p.y * n.y + p.z * n.z) / (length(p) * length(n))).toBeLessThan(1e-12);
  });
});
