/** Single source of truth for controls: used by the keyboard handler and the help overlay. */
export type Action =
  | 'stage'
  | 'throttle-full'
  | 'throttle-cut'
  | 'sas'
  | 'autopilot'
  | 'map'
  | 'camera'
  | 'warp-down'
  | 'warp-up'
  | 'restart'
  | 'pause'
  | 'help';

export type HeldControl =
  | 'throttle-up'
  | 'throttle-down'
  | 'pitch-down'
  | 'pitch-up'
  | 'yaw-left'
  | 'yaw-right'
  | 'roll-left'
  | 'roll-right';

export interface KeyBinding {
  /** KeyboardEvent.code values (physical keys, layout independent). */
  readonly codes: readonly string[];
  /** Human-readable key names for the help overlay. */
  readonly keys: readonly string[];
  readonly description: string;
  readonly action?: Action;
  readonly hold?: HeldControl;
}

export const KEY_BINDINGS: readonly KeyBinding[] = [
  { codes: ['Space'], keys: ['Space'], description: 'Launch / stage separation', action: 'stage' },
  { codes: ['ShiftLeft', 'ShiftRight'], keys: ['Shift'], description: 'Throttle up', hold: 'throttle-up' },
  { codes: ['ControlLeft', 'ControlRight'], keys: ['Ctrl'], description: 'Throttle down', hold: 'throttle-down' },
  { codes: ['KeyZ'], keys: ['Z'], description: 'Full throttle', action: 'throttle-full' },
  { codes: ['KeyX'], keys: ['X'], description: 'Cut throttle (engine off; relights are limited)', action: 'throttle-cut' },
  { codes: ['KeyW'], keys: ['W'], description: 'Pitch down (towards the horizon)', hold: 'pitch-down' },
  { codes: ['KeyS'], keys: ['S'], description: 'Pitch up', hold: 'pitch-up' },
  { codes: ['KeyA'], keys: ['A'], description: 'Yaw left', hold: 'yaw-left' },
  { codes: ['KeyD'], keys: ['D'], description: 'Yaw right', hold: 'yaw-right' },
  { codes: ['KeyQ'], keys: ['Q'], description: 'Roll left', hold: 'roll-left' },
  { codes: ['KeyE'], keys: ['E'], description: 'Roll right', hold: 'roll-right' },
  { codes: ['KeyT'], keys: ['T'], description: 'SAS: hold current attitude', action: 'sas' },
  { codes: ['KeyG'], keys: ['G'], description: 'Autopilot: fly the ascent to orbit', action: 'autopilot' },
  { codes: ['KeyM'], keys: ['M'], description: 'Map view', action: 'map' },
  { codes: ['KeyC'], keys: ['C'], description: 'Cycle cameras (chase, orbit, pad, onboard)', action: 'camera' },
  { codes: ['Comma'], keys: [','], description: 'Time warp down', action: 'warp-down' },
  { codes: ['Period'], keys: ['.'], description: 'Time warp up', action: 'warp-up' },
  { codes: ['KeyR'], keys: ['R'], description: 'Restart', action: 'restart' },
  { codes: ['KeyP', 'Escape'], keys: ['P', 'Esc'], description: 'Pause', action: 'pause' },
  { codes: ['KeyH', 'Slash'], keys: ['H', '?'], description: 'Help', action: 'help' },
];

const BY_CODE = new Map<string, KeyBinding>();
for (const b of KEY_BINDINGS) for (const c of b.codes) BY_CODE.set(c, b);

export const bindingForCode = (code: string): KeyBinding | undefined => BY_CODE.get(code);

/** Normalised control axes from the set of held controls. */
export function axesFromHeld(held: ReadonlySet<HeldControl>): { pitch: number; yaw: number; roll: number; throttle: number } {
  const axis = (neg: HeldControl, pos: HeldControl) => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0);
  return {
    pitch: axis('pitch-down', 'pitch-up'),
    yaw: axis('yaw-left', 'yaw-right'),
    roll: axis('roll-left', 'roll-right'),
    throttle: axis('throttle-down', 'throttle-up'),
  };
}
