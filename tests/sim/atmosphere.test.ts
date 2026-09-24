import { describe, expect, it } from 'vitest';
import { atmosphereAt, geopotentialAltitude } from '../../src/sim/atmosphere';

/** Reference values: U.S. Standard Atmosphere 1976, geometric altitudes. */
const TABLE = [
  { h: 0, T: 288.15, p: 101_325, rho: 1.225 },
  { h: 5_000, T: 255.68, p: 54_048, rho: 0.73643 },
  { h: 11_000, T: 216.77, p: 22_700, rho: 0.3648 },
  { h: 20_000, T: 216.65, p: 5_529.3, rho: 0.08891 },
  { h: 32_000, T: 228.49, p: 889.06, rho: 0.013555 },
  { h: 50_000, T: 270.65, p: 79.779, rho: 1.0269e-3 },
  { h: 70_000, T: 219.59, p: 5.2209, rho: 8.2829e-5 },
  { h: 86_000, T: 186.87, p: 0.3734, rho: 6.958e-6 },
];

describe('atmosphere (US Standard Atmosphere 1976)', () => {
  it.each(TABLE)('matches the standard at $h m', ({ h, T, p, rho }) => {
    const a = atmosphereAt(h);
    expect(a.temperature).toBeCloseTo(T, 0);
    expect(a.pressure / p).toBeCloseTo(1, 2);
    expect(a.density / rho).toBeCloseTo(1, 2);
  });

  it('gives the sea-level speed of sound', () => {
    expect(atmosphereAt(0).speedOfSound).toBeCloseTo(340.29, 1);
  });

  it('decreases pressure and density monotonically with altitude', () => {
    let prev = atmosphereAt(0);
    for (let h = 500; h <= 900_000; h += 500) {
      const cur = atmosphereAt(h);
      expect(cur.pressure).toBeLessThan(prev.pressure);
      expect(cur.density).toBeLessThan(prev.density);
      prev = cur;
    }
  });

  it('is continuous across the layered/tabulated boundary at 86 km', () => {
    const below = atmosphereAt(85_999.9);
    const above = atmosphereAt(86_000.1);
    expect(above.pressure / below.pressure).toBeCloseTo(1, 3);
    expect(above.density / below.density).toBeCloseTo(1, 2);
  });

  it('reaches vacuum at the top of the model', () => {
    expect(atmosphereAt(2_000_000).density).toBe(0);
    expect(atmosphereAt(2_000_000).pressure).toBe(0);
  });

  it('converts geometric to geopotential altitude', () => {
    expect(geopotentialAltitude(0)).toBe(0);
    expect(geopotentialAltitude(86_000)).toBeCloseTo(84_852, -1);
  });
});
