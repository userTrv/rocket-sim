import { describe, expect, it } from 'vitest';
import { axesFromHeld, bindingForCode, KEY_BINDINGS, type HeldControl } from '../../src/ui/keymap';

describe('keymap', () => {
  it('binds every physical key to exactly one control', () => {
    const codes = KEY_BINDINGS.flatMap((b) => b.codes);
    expect(new Set(codes).size).toBe(codes.length);
    for (const b of KEY_BINDINGS) expect(Boolean(b.action) !== Boolean(b.hold)).toBe(true);
  });

  it('covers the documented controls', () => {
    expect(bindingForCode('Space')?.action).toBe('stage');
    expect(bindingForCode('KeyG')?.action).toBe('autopilot');
    expect(bindingForCode('Escape')?.action).toBe('pause');
    expect(bindingForCode('Slash')?.action).toBe('help');
    expect(bindingForCode('ShiftLeft')?.hold).toBe('throttle-up');
    expect(bindingForCode('KeyK')).toBeUndefined();
  });

  it('turns held keys into signed axes', () => {
    const held = new Set<HeldControl>(['pitch-down', 'yaw-right', 'throttle-up']);
    expect(axesFromHeld(held)).toEqual({ pitch: -1, yaw: 1, roll: 0, throttle: 1 });
    held.add('pitch-up');
    expect(axesFromHeld(held).pitch).toBe(0);
  });
});
