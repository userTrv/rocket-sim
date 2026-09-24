import { describe, expect, it } from 'vitest';
import { FixedStepper } from '../../src/app/fixed-stepper';

describe('fixed-step accumulator', () => {
  it('runs a whole number of steps and keeps the remainder for interpolation', () => {
    const s = new FixedStepper();
    const plan = s.plan(0.05, 1, 0.02);
    expect(plan.steps).toBe(2);
    expect(plan.alpha).toBeCloseTo(0.5, 9);
    // The banked 0.01 s carries over into the next frame.
    expect(s.plan(0.01, 1, 0.02).steps).toBe(1);
  });

  it('scales banked time by the warp factor', () => {
    const s = new FixedStepper();
    expect(s.plan(1 / 60, 100, 0.1).steps).toBe(16);
  });

  it('drops time instead of spiralling when a frame needs too many steps', () => {
    const s = new FixedStepper(10);
    const plan = s.plan(1, 1, 0.02);
    expect(plan.steps).toBe(10);
    expect(plan.dropped).toBe(true);
    expect(s.plan(0, 1, 0.02).steps).toBe(0);
  });

  it('ignores negative deltas and can be reset', () => {
    const s = new FixedStepper();
    expect(s.plan(-5, 1, 0.02).steps).toBe(0);
    s.plan(0.019, 1, 0.02);
    s.reset();
    expect(s.plan(0.002, 1, 0.02).steps).toBe(0);
  });
});
