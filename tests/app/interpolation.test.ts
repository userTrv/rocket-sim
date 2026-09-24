import { describe, expect, it } from 'vitest';
import { interpolateBody } from '../../src/app/interpolation';
import { fromAxisAngle, IDENTITY } from '../../src/sim/math/quat';
import { vec3 } from '../../src/sim/math/vec3';

const body = (x: number, angle: number) => ({
  r: vec3(x, 0, 0),
  v: vec3(x * 2, 0, 0),
  q: angle === 0 ? IDENTITY : fromAxisAngle(vec3(0, 1, 0), angle),
  w: vec3(0, 0, 0),
});

describe('render interpolation', () => {
  it('blends position, velocity and attitude between two steps', () => {
    const prev = { vehicle: body(0, 0), stageIndex: 0, debris: new Map() };
    const out = interpolateBody(prev, body(10, Math.PI / 2), 0, 0.5);
    expect(out.r.x).toBeCloseTo(5, 12);
    expect(out.v.x).toBeCloseTo(10, 12);
    expect(2 * Math.acos(out.q.w)).toBeCloseTo(Math.PI / 4, 9);
  });

  it('snaps across staging, where the centre of mass jumps', () => {
    const prev = { vehicle: body(0, 0), stageIndex: 0, debris: new Map() };
    const current = body(10, 0);
    expect(interpolateBody(prev, current, 1, 0.5)).toBe(current);
    expect(interpolateBody(null, current, 0, 0.5)).toBe(current);
  });
});
