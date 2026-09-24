import { describe, expect, it } from 'vitest';
import { isResultState, nextMissionState } from '../../src/app/mission-state';

describe('mission state machine', () => {
  it('follows pad -> ascent -> orbit', () => {
    expect(nextMissionState('pad', 'ignition')).toBe('pad');
    expect(nextMissionState('pad', 'liftoff')).toBe('ascent');
    expect(nextMissionState('ascent', 'meco')).toBe('ascent');
    expect(nextMissionState('ascent', 'orbit')).toBe('orbit');
  });

  it('can crash from any live state and never leaves crashed', () => {
    expect(nextMissionState('ascent', 'crash')).toBe('crashed');
    expect(nextMissionState('orbit', 'crash')).toBe('crashed');
    expect(nextMissionState('crashed', 'orbit')).toBe('crashed');
  });

  it('does not reach orbit straight from the pad', () => {
    expect(nextMissionState('pad', 'orbit')).toBe('pad');
  });

  it('shows the result screen only for final outcomes', () => {
    expect(isResultState('orbit')).toBe(true);
    expect(isResultState('crashed')).toBe(true);
    expect(isResultState('ascent')).toBe(false);
  });
});
