import { describe, expect, it } from 'vitest';
import {
  formatDistance,
  formatDuration,
  formatMass,
  formatMissionTime,
  formatOrbitAltitude,
  formatPercent,
  formatPressure,
  formatSpeed,
} from '../../src/ui/format';

describe('HUD formatting', () => {
  it('formats the mission clock', () => {
    expect(formatMissionTime(0)).toBe('T+ 00:00:00');
    expect(formatMissionTime(155.4)).toBe('T+ 00:02:35');
    expect(formatMissionTime(3 * 3600 + 61)).toBe('T+ 03:01:01');
    expect(formatMissionTime(-10)).toBe('T- 00:00:10');
  });

  it('switches distance units at 10 km', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(9_999)).toBe('9,999 m');
    expect(formatDistance(200_700)).toBe('200.7 km');
    expect(formatDistance(Infinity)).toBe('—');
  });

  it('formats speeds, pressures, masses and percentages', () => {
    expect(formatSpeed(7842.4)).toBe('7,842 m/s');
    expect(formatPressure(31_300)).toBe('31.3 kPa');
    expect(formatPressure(235)).toBe('235 Pa');
    expect(formatMass(10_020)).toBe('10.0 t');
    expect(formatMass(950)).toBe('950 kg');
    expect(formatPercent(0.456)).toBe('46%');
    expect(formatPercent(1.5)).toBe('100%');
  });

  it('formats durations compactly', () => {
    expect(formatDuration(45.9)).toBe('45 s');
    expect(formatDuration(725)).toBe('12m 05s');
    expect(formatDuration(5_280)).toBe('1h 28m');
    expect(formatDuration(NaN)).toBe('—');
  });

  it('describes suborbital and escape trajectories', () => {
    expect(formatOrbitAltitude(-5_800_000)).toBe('suborbital');
    expect(formatOrbitAltitude(Infinity)).toBe('escape');
    expect(formatOrbitAltitude(150_200)).toBe('150.2 km');
  });
});
