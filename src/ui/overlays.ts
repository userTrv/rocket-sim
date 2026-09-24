import type { FlightStats, Telemetry } from '../sim/telemetry';
import { escapeHtml, fromTemplate } from './dom';
import { formatDistance, formatDuration, formatMass, formatMissionTime, formatOrbitAltitude, formatPressure, formatSpeed } from './format';
import { KEY_BINDINGS } from './keymap';

/** Modal-ish overlay with focus handling; closed overlays are `hidden` for assistive tech. */
abstract class Overlay {
  readonly root: HTMLElement;
  private lastFocus: Element | null = null;

  protected constructor(host: HTMLElement, html: string) {
    this.root = fromTemplate(html).root;
    this.root.hidden = true;
    host.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.lastFocus = document.activeElement;
    this.root.hidden = false;
    this.root.querySelector<HTMLElement>('[autofocus], button')?.focus({ preventScroll: true });
  }

  close(): void {
    this.root.hidden = true;
    if (this.lastFocus instanceof HTMLElement) this.lastFocus.focus({ preventScroll: true });
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  dispose(): void {
    this.root.remove();
  }
}

export class HelpOverlay extends Overlay {
  constructor(host: HTMLElement, onClose: () => void) {
    const rows = KEY_BINDINGS.map(
      (b) => `<tr><td>${b.keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join(' ')}</td><td>${escapeHtml(b.description)}</td></tr>`,
    ).join('');
    super(
      host,
      /* html */ `
      <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="help-title">
        <div class="overlay__card overlay__card--wide">
          <h2 id="help-title">Flight manual</h2>
          <p>Fly a two-stage launcher from the pad to a stable low Earth orbit (periapsis above 150 km).
             Press <kbd>G</kbd> to watch the autopilot do it, or fly by hand: launch with <kbd>Space</kbd>,
             tip a few degrees east with <kbd>W</kbd> at ~60 m/s, follow your velocity vector, stage when stage 1 runs dry,
             then build horizontal speed until the periapsis climbs out of the atmosphere.</p>
          <table class="keys"><tbody>${rows}</tbody></table>
          <p class="muted">Tip: on most browsers <kbd>Ctrl</kbd>+<kbd>W</kbd> closes the tab, so release Ctrl before steering.
             Drag to orbit the camera, scroll or pinch to zoom.</p>
          <button type="button" class="button button--primary" data-ref="close">Close (H)</button>
        </div>
      </div>`,
    );
    this.root.querySelector('[data-ref="close"]')!.addEventListener('click', onClose);
  }
}

export class PauseOverlay extends Overlay {
  constructor(host: HTMLElement, onResume: () => void) {
    super(
      host,
      /* html */ `
      <div class="overlay overlay--pause" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <div class="overlay__card">
          <h2 id="pause-title">Paused</h2>
          <p>Press <kbd>P</kbd> or <kbd>Esc</kbd> to resume.</p>
          <button type="button" class="button button--primary" data-ref="resume">Resume</button>
        </div>
      </div>`,
    );
    this.root.querySelector('[data-ref="resume"]')!.addEventListener('click', onResume);
  }
}

export interface ResultSummary {
  readonly success: boolean;
  readonly telemetry: Telemetry;
  readonly stats: FlightStats;
  readonly impactSpeed: number | null;
}

export class ResultOverlay extends Overlay {
  private readonly body: HTMLElement;
  private readonly title: HTMLElement;
  private readonly continueButton: HTMLButtonElement;

  constructor(host: HTMLElement, onContinue: () => void, onRestart: () => void) {
    super(
      host,
      /* html */ `
      <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="result-title">
        <div class="overlay__card overlay__card--result">
          <h2 id="result-title" data-ref="title"></h2>
          <dl class="summary" data-ref="body"></dl>
          <div class="overlay__actions">
            <button type="button" class="button button--primary" data-ref="continue">Keep flying</button>
            <button type="button" class="button" data-ref="restart">Restart (R)</button>
          </div>
        </div>
      </div>`,
    );
    this.body = this.root.querySelector('[data-ref="body"]')!;
    this.title = this.root.querySelector('[data-ref="title"]')!;
    this.continueButton = this.root.querySelector('[data-ref="continue"]')!;
    this.continueButton.addEventListener('click', onContinue);
    this.root.querySelector('[data-ref="restart"]')!.addEventListener('click', onRestart);
  }

  show(summary: ResultSummary): void {
    const { telemetry: t, stats: s } = summary;
    this.root.dataset.outcome = summary.success ? 'success' : 'failure';
    this.title.textContent = summary.success ? 'Orbit achieved' : 'Mission failed';
    const upper = t.stages.at(-1)!;
    const items: [string, string][] = [
      ['Mission time', formatMissionTime(t.missionTime)],
      ['Max altitude', formatDistance(s.maxAltitude)],
      ['Max velocity', formatSpeed(s.maxOrbitalSpeed)],
      ['Max-Q', `${formatPressure(s.maxQ)} at ${formatMissionTime(s.maxQTime)}`],
      ['Max g-load', `${s.maxG.toFixed(2)} g`],
    ];
    if (summary.success) {
      items.push(
        ['Orbit', `${formatOrbitAltitude(t.orbit.apoapsis)} × ${formatOrbitAltitude(t.orbit.periapsis)}`],
        ['Inclination', `${((t.orbit.inclination * 180) / Math.PI).toFixed(2)}°`],
        ['Period', formatDuration(t.orbit.period)],
        ['Stage 2 propellant left', `${formatMass(upper.propellant)} (${Math.round((upper.propellant / upper.capacity) * 100)}%)`],
      );
    } else if (summary.impactSpeed !== null) {
      items.push(['Impact speed', formatSpeed(summary.impactSpeed)]);
    }
    this.body.innerHTML = items.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
    this.continueButton.hidden = !summary.success;
    this.open();
  }
}
