import { fromTemplate } from './dom';
import type { Action, HeldControl } from './keymap';

type Ref = 'throttle' | 'stage';

const HOLD_BUTTONS: [HeldControl, string, string][] = [
  ['pitch-up', '▲', 'Pitch up'],
  ['yaw-left', '◀', 'Yaw left'],
  ['yaw-right', '▶', 'Yaw right'],
  ['pitch-down', '▼', 'Pitch down'],
];

const ACTION_BUTTONS: [Action, string][] = [
  ['autopilot', 'Auto'],
  ['sas', 'SAS'],
  ['camera', 'Cam'],
  ['map', 'Map'],
  ['warp-down', '−W'],
  ['warp-up', '+W'],
  ['pause', '❚❚'],
  ['help', '?'],
];

/**
 * On-screen controls for touch devices: throttle slider, stage button, attitude pad and
 * the most important toggles. Uses pointer events so it also works with a mouse.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private readonly throttle: HTMLInputElement;

  constructor(
    host: HTMLElement,
    handlers: { onAction: (a: Action) => void; onThrottle: (value: number) => void; held: Set<HeldControl> },
  ) {
    const holds = HOLD_BUTTONS.map(([c, glyph, label]) => `<button type="button" class="touch-btn touch-btn--${c}" data-hold="${c}" aria-label="${label}">${glyph}</button>`).join('');
    const actions = ACTION_BUTTONS.map(([a, label]) => `<button type="button" class="touch-btn" data-action="${a}">${label}</button>`).join('');
    const { root, refs } = fromTemplate<Ref>(/* html */ `
      <div class="touch" aria-label="Touch controls">
        <div class="touch__actions">${actions}</div>
        <div class="touch__pad">${holds}</div>
        <label class="touch__throttle"><span>Thr</span>
          <input data-ref="throttle" type="range" min="0" max="100" value="100" aria-label="Throttle" />
        </label>
        <button type="button" class="touch-btn touch-btn--stage" data-ref="stage" data-action="stage">Launch</button>
      </div>`);
    this.root = root;
    this.throttle = refs.throttle as HTMLInputElement;
    host.append(root);

    root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((b) =>
      b.addEventListener('click', () => handlers.onAction(b.dataset.action as Action)),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-hold]').forEach((b) => {
      const control = b.dataset.hold as HeldControl;
      const release = () => handlers.held.delete(control);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        handlers.held.add(control);
      });
      b.addEventListener('pointerup', release);
      b.addEventListener('pointercancel', release);
      b.addEventListener('lostpointercapture', release);
    });
    this.throttle.addEventListener('input', () => handlers.onThrottle(Number(this.throttle.value) / 100));
  }

  /** Reflect the simulation's throttle and flight phase back into the controls. */
  sync(throttle: number, launched: boolean): void {
    if (document.activeElement !== this.throttle) this.throttle.value = String(Math.round(throttle * 100));
    const stage = this.root.querySelector<HTMLElement>('[data-ref="stage"]')!;
    const label = launched ? 'Stage' : 'Launch';
    if (stage.textContent !== label) stage.textContent = label;
  }

  set visible(v: boolean) {
    this.root.hidden = !v;
  }

  dispose(): void {
    this.root.remove();
  }
}
