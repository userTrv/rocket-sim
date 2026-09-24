import { MISSION_STATE_LABEL, type MissionState } from '../app/mission-state';
import type { SimEvent } from '../sim/events';
import type { AutopilotPhase } from '../sim/guidance/autopilot';
import type { Telemetry, TelemetrySample } from '../sim/telemetry';
import { TelemetryChart } from './chart';
import { escapeHtml, fromTemplate, setText } from './dom';
import {
  formatAngle,
  formatDistance,
  formatDuration,
  formatMissionTime,
  formatOrbitAltitude,
  formatPercent,
  formatPressure,
  formatSpeed,
} from './format';

export interface HudState {
  readonly missionState: MissionState;
  readonly warp: number;
  readonly maxWarp: number;
  readonly cameraLabel: string;
  readonly mapView: boolean;
}

type Ref =
  | 'clock' | 'state' | 'stage' | 'events' | 'hint'
  | 'apo' | 'peri' | 'tapo' | 'incl' | 'ecc' | 'period'
  | 'alt' | 'vsurf' | 'vorb' | 'vs' | 'mach' | 'q' | 'qbar' | 'qmax' | 'g' | 'pitch'
  | 'throttle' | 'throttlebar' | 'thrust' | 'stages'
  | 'sas' | 'ap' | 'warp' | 'cam'
  | 'chartAlt' | 'chartVel';

const Q_SCALE = 40_000; // Pa at full bar

const AUTOPILOT_LABEL: Record<AutopilotPhase, string> = {
  launch: 'Launch',
  'vertical-rise': 'Vertical rise',
  'pitch-over': 'Pitch-over',
  'gravity-turn': 'Gravity turn',
  'meco-coast': 'MECO / staging',
  'upper-ascent': 'Upper ascent',
  'coast-to-apoapsis': 'Coast to Ap',
  circularize: 'Circularize',
  orbit: 'Orbit hold',
  'out-of-propellant': 'No propellant',
};

const row = (label: string, ref: Ref, extra = '') =>
  `<div class="readout"><dt>${label}</dt><dd data-ref="${ref}">—</dd>${extra}</div>`;

const TEMPLATE = /* html */ `
<div class="hud" aria-label="Flight instruments">
  <section class="panel panel--mission" aria-label="Mission">
    <div class="clock" data-ref="clock">T+ 00:00:00</div>
    <div class="mission-status"><span data-ref="state">On pad</span><span class="sep">·</span><span data-ref="stage">Stage 1</span></div>
    <ol class="event-log" data-ref="events" aria-live="polite" aria-label="Event log"></ol>
  </section>

  <section class="panel panel--orbit" aria-label="Orbit">
    <h2>Orbit</h2>
    <dl class="readouts">
      ${row('Apoapsis', 'apo')}${row('Periapsis', 'peri')}${row('Time to Ap', 'tapo')}
      ${row('Inclination', 'incl')}${row('Eccentricity', 'ecc')}${row('Period', 'period')}
    </dl>
  </section>

  <section class="panel panel--flight" aria-label="Flight data">
    <h2>Flight</h2>
    <dl class="readouts">
      ${row('Altitude', 'alt')}${row('Surface vel.', 'vsurf')}${row('Orbital vel.', 'vorb')}
      ${row('Vertical spd', 'vs')}${row('Mach', 'mach')}
      <div class="readout readout--wide"><dt>Dyn. pressure</dt><dd data-ref="q">—</dd>
        <div class="bar bar--q" aria-hidden="true"><div class="bar__fill" data-ref="qbar"></div><div class="bar__marker" data-ref="qmax" title="Max-Q"></div></div>
      </div>
      ${row('G-load', 'g')}${row('Pitch', 'pitch')}
    </dl>
  </section>

  <section class="panel panel--propulsion" aria-label="Propulsion">
    <div class="throttle">
      <div class="throttle__head"><span>Throttle</span><strong data-ref="throttle">0%</strong><span class="muted" data-ref="thrust"></span></div>
      <div class="bar bar--throttle" aria-hidden="true"><div class="bar__fill" data-ref="throttlebar"></div></div>
    </div>
    <div class="stages" data-ref="stages"></div>
    <div class="chips">
      <span class="chip" data-ref="sas">SAS</span>
      <span class="chip" data-ref="ap">Autopilot</span>
      <span class="chip" data-ref="warp">Warp 1×</span>
      <span class="chip chip--cam" data-ref="cam">Chase</span>
    </div>
  </section>

  <section class="panel panel--charts" aria-label="Telemetry charts">
    <canvas data-ref="chartAlt" aria-label="Altitude over time"></canvas>
    <canvas data-ref="chartVel" aria-label="Velocity over time"></canvas>
  </section>

  <div class="hint" data-ref="hint"></div>
</div>`;

/** DOM heads-up display. Values are pushed in; the HUD owns no simulation state. */
export class Hud {
  readonly root: HTMLElement;
  private readonly refs: Record<Ref, HTMLElement>;
  private readonly charts: TelemetryChart[];
  private stageKey = '';
  private flashText = '';
  private flashUntil = 0;

  constructor(host: HTMLElement) {
    const { root, refs } = fromTemplate<Ref>(TEMPLATE);
    this.root = root;
    this.refs = refs;
    host.append(root);
    this.charts = [
      new TelemetryChart(refs.chartAlt as HTMLCanvasElement, { label: 'Altitude', unit: 'km', color: '#4fd1ff', scale: 1e-3, value: (s) => s.altitude }),
      new TelemetryChart(refs.chartVel as HTMLCanvasElement, { label: 'Velocity', unit: 'km/s', color: '#ffa24a', scale: 1e-3, value: (s) => s.velocity }),
    ];
  }

  update(t: Telemetry, state: HudState): void {
    const r = this.refs;
    setText(r.clock, formatMissionTime(t.missionTime));
    setText(r.state, MISSION_STATE_LABEL[state.missionState]);
    setText(r.stage, `Stage ${t.stageIndex + 1}${t.engineRunning ? ' · burning' : ''}`);
    r.state.dataset.state = state.missionState;

    const o = t.orbit;
    setText(r.apo, formatOrbitAltitude(o.apoapsis));
    setText(r.peri, formatOrbitAltitude(o.periapsis));
    setText(r.tapo, o.bound && o.apoapsis > 1_000 ? formatDuration(o.timeToApoapsis) : '—');
    setText(r.incl, formatAngle((o.inclination * 180) / Math.PI, 2));
    setText(r.ecc, o.eccentricity.toFixed(4));
    setText(r.period, o.bound && o.periapsis > -1_000_000 ? formatDuration(o.period) : '—');
    r.peri.classList.toggle('good', o.periapsis > 150_000);

    setText(r.alt, formatDistance(t.altitude));
    setText(r.vsurf, formatSpeed(t.surfaceSpeed));
    setText(r.vorb, formatSpeed(t.orbitalSpeed));
    setText(r.vs, `${t.verticalSpeed >= 0 ? '+' : ''}${formatSpeed(t.verticalSpeed)}`);
    setText(r.mach, t.mach.toFixed(2));
    setText(r.q, formatPressure(t.dynamicPressure));
    r.qbar.style.transform = `scaleX(${Math.min(1, t.dynamicPressure / Q_SCALE)})`;
    r.qmax.style.left = `${Math.min(100, (t.maxQ / Q_SCALE) * 100)}%`;
    r.qmax.hidden = t.maxQ < 1000;
    r.qmax.classList.toggle('passed', t.maxQTime !== null);
    setText(r.g, `${t.gLoad.toFixed(2)} g`);
    setText(r.pitch, formatAngle(t.pitch));

    setText(r.throttle, formatPercent(t.throttleCommand));
    setText(r.thrust, t.thrust > 0 ? `${(t.thrust / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })} kN` : 'engine off');
    r.throttlebar.style.transform = `scaleX(${t.throttleCommand})`;
    r.throttlebar.classList.toggle('idle', t.thrust <= 0);
    this.updateStages(t);

    r.sas.classList.toggle('on', t.sas);
    setText(r.ap, t.autopilot ? `AP · ${AUTOPILOT_LABEL[t.autopilot]}` : 'Autopilot off');
    r.ap.classList.toggle('on', t.autopilot !== null);
    setText(r.warp, `Warp ${state.warp}×${state.maxWarp < 1000 && state.missionState !== 'pad' ? ` (max ${state.maxWarp}×)` : ''}`);
    r.warp.classList.toggle('on', state.warp > 1);
    setText(r.cam, state.mapView ? 'Map view' : state.cameraLabel);

    setText(r.hint, this.hint(state, t));
  }

  /** Show a short transient message in the hint line. */
  flash(message: string, seconds = 2.5): void {
    this.flashText = message;
    this.flashUntil = performance.now() + seconds * 1000;
  }

  private hint(state: HudState, t: Telemetry): string {
    if (performance.now() < this.flashUntil) return this.flashText;
    if (state.missionState === 'pad') return 'Space: launch  ·  G: autopilot  ·  H: help';
    if (t.autopilot === 'coast-to-apoapsis' && state.maxWarp > state.warp) return 'Coasting to apoapsis: press . to time-warp';
    return '';
  }

  private updateStages(t: Telemetry): void {
    const key = t.stages.map((s) => `${s.attached}${s.active}`).join();
    if (key !== this.stageKey) {
      this.stageKey = key;
      this.refs.stages.innerHTML = t.stages
        .map(
          (s, i) => `
        <div class="stage ${s.attached ? '' : 'stage--gone'} ${s.active ? 'stage--active' : ''}" data-stage="${i}">
          <span class="stage__name">${escapeHtml(s.name)}</span>
          <div class="bar bar--fuel" role="meter" aria-label="${escapeHtml(s.name)} propellant" aria-valuemin="0" aria-valuemax="100"><div class="bar__fill"></div></div>
          <span class="stage__pct"></span>
        </div>`,
        )
        .join('');
    }
    t.stages.forEach((s, i) => {
      const el = this.refs.stages.querySelector<HTMLElement>(`[data-stage="${i}"]`)!;
      const frac = s.capacity > 0 ? s.propellant / s.capacity : 0;
      (el.querySelector('.bar__fill') as HTMLElement).style.transform = `scaleX(${frac})`;
      el.querySelector('.bar')!.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
      setText(el.querySelector('.stage__pct') as HTMLElement, s.attached ? `${formatPercent(frac)} · ${s.ignitionsLeft} ign` : 'jettisoned');
    });
  }

  updateCharts(samples: readonly TelemetrySample[]): void {
    for (const c of this.charts) c.draw(samples);
  }

  logEvent(e: SimEvent): void {
    const li = document.createElement('li');
    li.className = `event event--${e.type}`;
    li.innerHTML = `<time>${formatMissionTime(e.missionTime)}</time> ${escapeHtml(e.message)}`;
    this.refs.events.prepend(li);
    while (this.refs.events.children.length > 7) this.refs.events.lastElementChild!.remove();
  }

  clearEvents(): void {
    this.refs.events.innerHTML = '';
  }

  dispose(): void {
    this.root.remove();
  }
}
