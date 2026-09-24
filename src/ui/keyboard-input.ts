import { bindingForCode, type Action, type HeldControl } from './keymap';

/**
 * Keyboard handling: one-shot actions fire on keydown (no auto-repeat), held controls are
 * tracked in a set that the game polls every frame.
 */
export class KeyboardInput {
  readonly held = new Set<HeldControl>();
  private readonly abort = new AbortController();

  constructor(target: Window, private readonly onAction: (action: Action) => void) {
    const opts = { signal: this.abort.signal };
    target.addEventListener('keydown', (e) => this.onKeyDown(e), opts);
    target.addEventListener('keyup', (e) => this.onKeyUp(e), opts);
    target.addEventListener('blur', () => this.held.clear(), opts);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.metaKey || e.altKey || isEditable(e.target)) return;
    const binding = bindingForCode(e.code);
    if (!binding) return;
    // Let the browser handle Tab/Enter on focused buttons; everything we bind is ours.
    e.preventDefault();
    if (binding.hold) this.held.add(binding.hold);
    if (binding.action && !e.repeat) this.onAction(binding.action);
  }

  private onKeyUp(e: KeyboardEvent): void {
    const binding = bindingForCode(e.code);
    if (binding?.hold) this.held.delete(binding.hold);
  }

  dispose(): void {
    this.abort.abort();
  }
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type === 'text');
}
