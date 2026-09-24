import { SceneRenderer } from '../render/scene-renderer';
import { CAMERA_LABELS } from '../render/camera-rig';
import type { RenderFrame } from '../render/frame';
import { earthAngle, altitude } from '../sim/frames';
import { Simulation, type LaunchSite } from '../sim/simulation';
import { clampWarp, maxAllowedWarp, PHYSICS_WARP_MAX, stepSizeForWarp, stepWarp } from '../sim/time-warp';
import type { VehicleConfig } from '../sim/vehicle/config';
import { Hud } from '../ui/hud';
import { STAGING_CONFIRM_WINDOW, earlyStagingWarning } from './staging-guard';
import { KeyboardInput } from '../ui/keyboard-input';
import { axesFromHeld, type Action } from '../ui/keymap';
import { HelpOverlay, PauseOverlay, ResultOverlay } from '../ui/overlays';
import { TouchControls } from '../ui/touch-controls';
import { FixedStepper } from './fixed-stepper';
import { interpolateBody, interpolatePose, type WorldSnapshot } from './interpolation';
import { isResultState, nextMissionState, type MissionState } from './mission-state';
import { TrailRecorder } from './trail';

export interface GameOptions {
  readonly root: HTMLElement;
  readonly vehicle: VehicleConfig;
  readonly site?: LaunchSite;
}

const MAX_FRAME_DELTA = 0.1; // s; longer hitches are not replayed
const THROTTLE_RATE = 0.6; // per second while Shift/Ctrl is held
const HUD_INTERVAL = 1 / 20;
const CHART_INTERVAL = 0.5;
const CRASH_RESULT_DELAY_MS = 2500;

/**
 * Composition root and main loop: owns the simulation, the renderer and the UI, runs the
 * fixed-step physics decoupled from the display refresh, and routes player input.
 */
export class Game {
  private sim: Simulation;
  private readonly renderer: SceneRenderer;
  private readonly hud: Hud;
  private readonly keyboard: KeyboardInput;
  private readonly touch: TouchControls;
  private readonly help: HelpOverlay;
  private readonly pause: PauseOverlay;
  private readonly result: ResultOverlay;
  private readonly stepper = new FixedStepper();
  private readonly trail = new TrailRecorder();
  private readonly resizeObserver: ResizeObserver;
  private readonly abort = new AbortController();
  private missionState: MissionState = 'pad';
  private warp = 1;
  private userPaused = false;
  /** The result screen waits until the engine is off so it shows the final orbit. */
  private resultPending = false;
  private resultAt = 0;
  private prev: WorldSnapshot | null = null;
  private lastStep = stepSizeForWarp(1);
  private raf = 0;
  private lastTime = 0;
  private hudTimer = 0;
  /** performance.now() of an unconfirmed early staging request, 0 if none. */
  private stagingRequestedAt = 0;
  private chartTimer = 0;

  constructor(private readonly options: GameOptions) {
    const { root } = options;
    const scene = root.querySelector<HTMLElement>('[data-scene]')!;
    const ui = root.querySelector<HTMLElement>('[data-ui]')!;
    const labels = root.querySelector<HTMLElement>('[data-labels]')!;
    this.sim = this.createSimulation();
    this.renderer = new SceneRenderer({ canvasHost: scene, labelLayer: labels, vehicle: options.vehicle, site: this.sim.site });
    this.hud = new Hud(ui);
    this.keyboard = new KeyboardInput(window, (a) => this.onAction(a));
    this.touch = new TouchControls(ui, {
      onAction: (a) => this.onAction(a),
      onThrottle: (v) => this.sim.setThrottle(v),
      held: this.keyboard.held,
    });
    this.touch.visible = matchMedia('(pointer: coarse)').matches;
    this.help = new HelpOverlay(ui, () => this.help.close());
    this.pause = new PauseOverlay(ui, () => this.setPaused(false));
    this.result = new ResultOverlay(ui, () => this.result.close(), () => this.restart());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(scene);
    this.resize();
    document.addEventListener('visibilitychange', () => this.onVisibility(), { signal: this.abort.signal });
    this.start();
  }

  private createSimulation(): Simulation {
    return new Simulation({ vehicle: this.options.vehicle, ...(this.options.site ? { site: this.options.site } : {}) });
  }

  // ------------------------------------------------------------------ loop

  private start(): void {
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const realDelta = Math.min(MAX_FRAME_DELTA, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const paused = this.userPaused || this.help.isOpen || this.result.isOpen;
    let simDelta = 0;
    let alpha = 1;
    if (!paused) {
      this.applyHeldControls(realDelta);
      ({ simDelta, alpha } = this.advance(realDelta));
    }
    this.renderer.render(this.buildFrame(paused ? 0 : realDelta, simDelta, alpha));
    this.checkPendingResult();
    this.hudTimer += realDelta;
    this.chartTimer += realDelta;
    if (this.hudTimer >= HUD_INTERVAL) {
      this.hudTimer = 0;
      this.updateHud();
    }
    if (this.chartTimer >= CHART_INTERVAL) {
      this.chartTimer = 0;
      this.hud.updateCharts(this.sim.recorder.samples);
    }
  };

  /** Run as many fixed steps as the banked (warped) time allows. */
  private advance(realDelta: number): { simDelta: number; alpha: number } {
    this.warp = clampWarp(this.warp, this.maxWarp());
    const stepSize = stepSizeForWarp(this.warp);
    const rails = this.warp > PHYSICS_WARP_MAX;
    const plan = this.stepper.plan(realDelta, this.warp, stepSize);
    let simDelta = 0;
    for (let i = 0; i < plan.steps; i++) {
      this.prev = this.snapshot();
      this.sim.step(stepSize, rails);
      this.lastStep = stepSize;
      simDelta += stepSize;
      this.trail.record(this.sim.t, this.sim.state.r);
      this.handleEvents();
      if (this.sim.phase === 'crashed' || this.maxWarp() < this.warp) {
        this.stepper.reset();
        break;
      }
    }
    return { simDelta, alpha: plan.alpha };
  }

  private snapshot(): WorldSnapshot {
    return {
      vehicle: this.sim.state,
      stageIndex: this.sim.vehicle.stageIndex,
      debris: new Map(this.sim.debris.map((d) => [d.id, { r: d.r, q: d.q }])),
    };
  }

  private buildFrame(realDelta: number, simDelta: number, alpha: number): RenderFrame {
    const sim = this.sim;
    const body = interpolateBody(this.prev, sim.state, sim.vehicle.stageIndex, alpha);
    const time = sim.t - (1 - alpha) * (this.prev ? this.lastStep : 0);
    const props = sim.vehicle.massProperties();
    const t = sim.telemetry;
    return {
      time,
      realDelta,
      simDelta,
      earthAngle: earthAngle(time),
      vehicle: {
        r: body.r,
        v: body.v,
        q: body.q,
        comHeight: props.comHeight,
        stageIndex: sim.vehicle.stageIndex,
        fairingAttached: sim.vehicle.fairingAttached,
      },
      engine: { running: sim.vehicle.engineRunning && sim.propulsion.thrust > 0, throttle: t.throttle, ambientPressure: t.ambientPressure },
      debris: sim.debris.map((d) => {
        const p = this.prev?.debris.get(d.id);
        const pose = p ? interpolatePose(p, d, alpha) : d;
        return { id: d.id, kind: d.kind, variant: d.variant, r: pose.r, q: pose.q, alive: d.alive };
      }),
      altitude: t.altitude,
      dynamicPressure: t.dynamicPressure,
      orbit: t.orbit,
      trail: this.trail.points,
      onPad: sim.phase === 'prelaunch',
      crashed: sim.phase === 'crashed',
    };
  }

  private maxWarp(): number {
    const sim = this.sim;
    return maxAllowedWarp({
      flying: sim.phase === 'flight',
      thrusting: sim.vehicle.engineRunning,
      altitude: altitude(sim.state.r),
      autopilotLimit: sim.autopilotWarpLimit,
    });
  }

  private handleEvents(): void {
    for (const e of this.sim.drainEvents()) {
      this.hud.logEvent(e);
      const next = nextMissionState(this.missionState, e.type);
      if (e.type === 'crash') this.renderer.explode(this.sim.state.r);
      if (next === this.missionState) continue;
      this.missionState = next;
      if (isResultState(next)) {
        this.resultPending = true;
        // Let the explosion play for a moment before covering it with the summary.
        this.resultAt = performance.now() + (next === 'crashed' ? CRASH_RESULT_DELAY_MS : 0);
      }
    }
  }

  private checkPendingResult(): void {
    if (this.resultPending && !this.sim.vehicle.engineRunning && performance.now() >= this.resultAt) this.showResult();
  }

  private showResult(): void {
    this.resultPending = false;
    this.warp = 1;
    this.updateHud();
    this.result.show({
      success: this.missionState === 'orbit',
      telemetry: this.sim.telemetry,
      stats: this.sim.recorder.stats,
      impactSpeed: this.sim.impactSpeed,
    });
  }

  private updateHud(): void {
    this.hud.update(this.sim.telemetry, {
      missionState: this.missionState,
      warp: this.warp,
      maxWarp: this.maxWarp(),
      cameraLabel: CAMERA_LABELS[this.renderer.cameraMode],
      mapView: this.renderer.rig.mapView,
    });
    this.touch.sync(this.sim.throttle, this.sim.launched);
  }

  // ------------------------------------------------------------------ input

  private applyHeldControls(dt: number): void {
    const axes = axesFromHeld(this.keyboard.held);
    const p = this.sim.pilot;
    if (axes.pitch !== p.pitch || axes.yaw !== p.yaw || axes.roll !== p.roll) {
      this.sim.setPilotInput({ pitch: axes.pitch, yaw: axes.yaw, roll: axes.roll });
    }
    if (axes.throttle !== 0) this.sim.setThrottle(this.sim.throttle + axes.throttle * THROTTLE_RATE * dt);
  }

  private requestStaging(): void {
    const warning = this.sim.launched ? earlyStagingWarning(this.sim.telemetry) : null;
    const now = performance.now();
    if (warning && now - this.stagingRequestedAt > STAGING_CONFIRM_WINDOW * 1000) {
      this.stagingRequestedAt = now;
      return this.hud.flash(warning, STAGING_CONFIRM_WINDOW);
    }
    this.stagingRequestedAt = 0;
    this.sim.stage();
  }

  private onAction(action: Action): void {
    const sim = this.sim;
    if (action === 'help') return this.help.toggle();
    if (action === 'restart') return this.restart();
    if (action === 'pause') {
      if (this.help.isOpen) return this.help.close();
      return this.setPaused(!this.userPaused);
    }
    if (this.result.isOpen || this.userPaused) return;
    switch (action) {
      case 'stage':
        return this.requestStaging();
      case 'throttle-full':
        return sim.setThrottle(1);
      case 'throttle-cut':
        return sim.setThrottle(0);
      case 'sas':
        return sim.toggleSas();
      case 'autopilot':
        return sim.toggleAutopilot();
      case 'map':
        this.renderer.toggleMap(sim.state.r, sim.orbit.angularMomentum);
        return this.updateHud();
      case 'camera':
        if (this.renderer.rig.mapView) this.renderer.toggleMap(sim.state.r, sim.orbit.angularMomentum);
        this.renderer.cycleCamera();
        return this.updateHud();
      case 'warp-up':
      case 'warp-down': {
        const requested = stepWarp(this.warp, action === 'warp-up' ? 1 : -1);
        const allowed = this.maxWarp();
        if (requested > allowed) this.hud.flash(this.warpLimitReason());
        this.warp = clampWarp(requested, allowed);
        this.stepper.reset();
        return this.updateHud();
      }
    }
  }

  private warpLimitReason(): string {
    const sim = this.sim;
    if (sim.phase !== 'flight') return 'Time warp is available after liftoff';
    if (sim.vehicle.engineRunning) return 'Time warp limited to 4× under thrust';
    if (altitude(sim.state.r) < 100_000) return 'Time warp limited to 4× inside the atmosphere';
    return 'Time warp limited by the autopilot (burn coming up)';
  }

  private setPaused(paused: boolean): void {
    this.userPaused = paused;
    if (paused) this.pause.open();
    else this.pause.close();
  }

  // ------------------------------------------------------------------ lifecycle

  restart(): void {
    this.sim = this.createSimulation();
    this.renderer.reset();
    this.hud.clearEvents();
    this.trail.clear();
    this.stepper.reset();
    this.prev = null;
    this.warp = 1;
    this.missionState = 'pad';
    this.resultPending = false;
    this.result.close();
    this.setPaused(false);
    this.hud.updateCharts([]);
    this.updateHud();
  }

  private resize(): void {
    const scene = this.options.root.querySelector<HTMLElement>('[data-scene]')!;
    this.renderer.resize(scene.clientWidth, scene.clientHeight);
  }

  /** Stop rendering entirely while the tab is hidden; resume without a time jump. */
  private onVisibility(): void {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else if (!this.raf) {
      this.stepper.reset();
      this.start();
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.keyboard.dispose();
    this.touch.dispose();
    this.help.dispose();
    this.pause.dispose();
    this.result.dispose();
    this.hud.dispose();
    this.renderer.dispose();
  }
}
