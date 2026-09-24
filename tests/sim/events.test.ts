import { describe, expect, it } from 'vitest';
import { MaxQDetector } from '../../src/sim/events';

describe('max-Q detector', () => {
  it('reports the peak once, after q has clearly dropped', () => {
    const d = new MaxQDetector();
    const profile = [0, 5_000, 15_000, 28_000, 31_000, 30_000, 29_000, 27_000, 20_000, 5_000];
    const reports = profile.map((q, i) => d.update(q, i * 10)).filter((x) => x !== null);
    expect(reports).toEqual([{ value: 31_000, time: 40 }]);
  });

  it('ignores small bumps below the minimum peak', () => {
    const d = new MaxQDetector();
    expect([100, 400, 200, 0].map((q, i) => d.update(q, i))).toEqual([null, null, null, null]);
  });
});
