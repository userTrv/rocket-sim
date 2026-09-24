import { aerodynamics, gravityAt, rk4Step, type AeroState } from './dynamics';
import { atmosphereAt } from './atmosphere';
import { attitudeControl, attitudeFromForward, NOSE, rotationalStep, TOP, type Inertia } from './attitude';
import { R_EARTH } from './constants';
import { stepDebris, TUMBLE_DRAG_FACTOR, type Debris } from './debris';
import { MaxQDetector, type SimEvent, type SimEventType } from './events';
import { altitude, earthAngle, geoToDirection, localFrame, rotateWithEarth, surfaceVelocityAt } from './frames';
import { Autopilot, DEFAULT_AUTOPILOT, type AutopilotOptions, type GuidanceCommand, type GuidanceContext } from './guidance/autopilot';
import { addScaled, length, scale, sub, vec3, ZERO, type Vec3 } from './math/vec3';
import { fromAxisAngle, fromBasis, multiply, rotate, type Quat } from './math/quat';
import { orbitalElements, type OrbitalElements } from './orbit';
import { computeTelemetry } from './telemetry-builder';
import { FlightRecorder, type Telemetry } from './telemetry';
import type { VehicleConfig } from './vehicle/config';
import { Vehicle, type PropulsionOutput, type SeparatedBody } from './vehicle/vehicle';

export interface LaunchSite {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
}

export const CAPE_CANAVERAL: LaunchSite = { name: 'LC-39A, Florida', latitude: 28.608, longitude: -80.604 };

export type FlightPhase = 'prelaunch' | 'flight' | 'crashed';

/** Normalised manual rotation input: pitch > 0 nose up, yaw > 0 nose right, roll > 0 roll right. */
export interface PilotInput {
  readonly pitch: number;
  readonly yaw: number;
  readonly roll: number;
}

/** Rigid-body state: CoM position/velocity (inertial), attitude, body-frame angular velocity. */
export interface BodyState {
  readonly r: Vec3;
  readonly v: Vec3;
  readonly q: Quat;
  readonly w: Vec3;
}

export interface SimulationOptions {
  readonly vehicle: VehicleConfig;
  readonly site?: LaunchSite;
  readonly autopilot?: AutopilotOptions;
}

const NO_INPUT: PilotInput = { pitch: 0, yaw: 0, roll: 0 };
/** Orbit counts as achieved (mission success) above this periapsis altitude. */
export const ORBIT_PERIAPSIS_THRESHOLD = 150_000;
/** Magnitude of the pitch-damping derivative Cmq for a slender body (dimensionless). */
const PITCH_DAMPING_COEFFICIENT = 10;

/**
 * The flight simulation: a fixed-step, framework-free world containing the launcher,
 * the rotating Earth and any jettisoned debris. Call `step(dt)` with a constant dt.
 */
export class Simulation {
  t = 0;
  phase: FlightPhase = 'prelaunch';
  launched = false;
  liftoffTime: number | null = null;
  state: BodyState;
  /** Commanded throttle 0..1 (the engine clamps to its minimum when running). */
  throttle = 1;
  sas = false;
  pilot: PilotInput = NO_INPUT;
  autopilot: Autopilot | null = null;
  autopilotWarpLimit = Infinity;
  orbitAchieved = false;
  impactSpeed: number | null = null;
  readonly vehicle: Vehicle;
  readonly site: LaunchSite;
  readonly debris: Debris[] = [];
  readonly recorder = new FlightRecorder();
  telemetry: Telemetry;
  orbit: OrbitalElements;
  propulsion: PropulsionOutput = { thrust: 0, massFlow: 0, throttle: 0 };
  aero: AeroState;

  private readonly padDirection: Vec3;
  private readonly padAttitude: Quat;
  private readonly autopilotOptions: AutopilotOptions;
  private readonly maxQ = new MaxQDetector();
  private events: SimEvent[] = [];
  private sasTarget: Quat | null = null;
  private nextDebrisId = 1;
  private noIgnitionWarned = false;
  private secoCount = 0;

  constructor(options: SimulationOptions) {
    this.vehicle = new Vehicle(options.vehicle);
    this.site = options.site ?? CAPE_CANAVERAL;
    this.autopilotOptions = options.autopilot ?? DEFAULT_AUTOPILOT;
    this.padDirection = geoToDirection(this.site.latitude, this.site.longitude);
    const { up, east, north } = localFrame(this.padDirection);
    // On the pad the "top" of the vehicle faces west, so pitching down (W) tips it east.
    this.padAttitude = fromBasis(scale(north, -1), up, scale(east, -1));
    this.state = this.padState();
    this.aero = aerodynamics(this.state.r, this.state.v, 0);
    this.orbit = orbitalElements(this.state.r, this.state.v);
    this.telemetry = this.buildTelemetry();
  }

  get missionTime(): number {
    return this.liftoffTime === null ? 0 : this.t - this.liftoffTime;
  }

  /** Inertial position of the launch pad (ground level) at the current time. */
  padPosition(): Vec3 {
    return scale(rotateWithEarth(this.padDirection, earthAngle(this.t)), R_EARTH);
  }

  /** Remove and return events emitted since the last call. */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ---------------------------------------------------------------- commands

  launch(): void {
    if (this.launched) return;
    this.launched = true;
    if (this.throttle <= 0) this.throttle = 1;
    if (this.vehicle.ignite()) this.emit('ignition', `Ignition: ${this.vehicle.stage.engine.name}`);
  }

  /** Space bar: launch on the pad, otherwise separate the active stage (or the fairing). */
  stage(): void {
    if (!this.launched) return this.launch();
    if (this.phase !== 'flight') return;
    const v = this.vehicle;
    if (v.hasNextStage) {
      if (v.engineRunning) this.cutoffEvent();
      const before = v.massProperties();
      const body = v.separateStage();
      if (body) this.spawnSeparated(body, before.comHeight, before.length);
    } else if (v.fairingAttached) {
      this.jettisonFairing();
    }
  }

  setThrottle(value: number, fromPilot = true): void {
    this.throttle = Math.max(0, Math.min(1, value));
    if (fromPilot) this.disengageAutopilot('manual throttle');
  }

  setPilotInput(input: PilotInput): void {
    this.pilot = input;
    if (input.pitch !== 0 || input.yaw !== 0 || input.roll !== 0) this.disengageAutopilot('manual input');
  }

  toggleSas(): void {
    this.sas = !this.sas;
    this.sasTarget = null;
    this.emit('sas', this.sas ? 'SAS on: holding attitude' : 'SAS off');
  }

  toggleAutopilot(): void {
    if (this.autopilot) return this.disengageAutopilot('pilot');
    if (this.phase === 'crashed') return;
    this.autopilot = new Autopilot(this.guidanceContext(), this.autopilotOptions);
    this.emit('autopilot', `Autopilot engaged (${this.autopilot.phase})`);
  }

  private disengageAutopilot(reason: string): void {
    if (!this.autopilot) return;
    this.autopilot = null;
    this.autopilotWarpLimit = Infinity;
    this.sasTarget = null;
    this.emit('autopilot', `Autopilot disengaged (${reason})`);
  }

  // ---------------------------------------------------------------- stepping

  /**
   * Advance the world by dt seconds. With `rails` (high time warp) the attitude is frozen
   * and only the trajectory is integrated, like KSP's on-rails warp.
   */
  step(dt: number, rails = false): void {
    if (this.phase === 'crashed') return;
    let command: GuidanceCommand | null = null;
    if (this.autopilot) {
      command = this.autopilot.update(this.guidanceContext());
      this.throttle = command.throttle;
      this.autopilotWarpLimit = command.warpLimit;
      if (command.launch) this.launch();
      if (command.stage) this.stage();
    }
    this.updateEngine();

    const v = this.vehicle;
    const atm = atmosphereAt(altitude(this.state.r));
    const prop = v.propulsion(this.throttle, atm.pressure);
    const props = v.massProperties();
    const planned = prop.massFlow * dt;
    const fraction = planned > v.stagePropellant ? v.stagePropellant / Math.max(planned, 1e-12) : 1;
    this.propulsion = { ...prop, thrust: prop.thrust * fraction, massFlow: prop.massFlow * fraction };

    if (this.phase === 'prelaunch') {
      v.consume(planned * fraction);
      this.t += dt;
      const weight = props.mass * length(gravityAt(this.state.r));
      if (this.propulsion.thrust > weight) {
        this.phase = 'flight';
        this.liftoffTime = this.t;
        this.recorder.stats.liftoffMass = props.mass;
        this.emit('liftoff', 'Liftoff!');
      } else {
        this.state = this.padState();
      }
    } else {
      const thrustDir = rotate(this.state.q, NOSE);
      const next = rk4Step(
        { r: this.state.r, v: this.state.v, m: props.mass },
        { thrust: scale(thrustDir, this.propulsion.thrust), massFlow: this.propulsion.massFlow, referenceArea: v.referenceArea },
        dt,
      );
      v.consume(planned * fraction);
      const rot = rails
        ? { q: this.state.q, w: ZERO }
        : this.rotate(command, props.pitchInertia, props.rollInertia, props.length, dt);
      this.state = { r: next.r, v: next.v, q: rot.q, w: rot.w };
      this.t += dt;
    }

    if (v.engineRunning && v.stagePropellant <= 0) {
      v.shutdown();
      this.emit('depleted', `${v.stage.name} propellant depleted`);
      this.cutoffEvent();
    }
    if (v.fairingAttached && this.phase === 'flight' && altitude(this.state.r) > v.config.fairing.jettisonAltitude) {
      this.jettisonFairing();
    }
    for (const d of this.debris) stepDebris(d, dt);
    this.postStep(props.comHeight);
  }

  private rotate(command: GuidanceCommand | null, pitchI: number, rollI: number, len: number, dt: number): { q: Quat; w: Vec3 } {
    const v = this.vehicle;
    const inertia: Inertia = { pitch: pitchI, roll: rollI };
    const maxTorque = v.maxTorque(this.propulsion.thrust, v.massProperties());
    const maxAccel = vec3(maxTorque.x / pitchI, maxTorque.y / rollI, maxTorque.z / pitchI);
    const u = this.controlCommand(command, maxAccel);
    // Passive damping plus aerodynamic pitch damping: M = q S L Cmq (w L / 2V) = 0.25 rho V S L^2 Cmq w.
    const aero = aerodynamics(this.state.r, this.state.v, v.referenceArea);
    const aeroDamping = 0.25 * PITCH_DAMPING_COEFFICIENT * aero.density * aero.airspeed * v.referenceArea * len * len;
    const w = this.state.w;
    const damp = v.config.angularDamping;
    const torque = vec3(
      u.x * maxTorque.x - w.x * (damp * pitchI + aeroDamping),
      u.y * maxTorque.y - w.y * damp * rollI,
      u.z * maxTorque.z - w.z * (damp * pitchI + aeroDamping),
    );
    return rotationalStep(this.state, torque, inertia, dt);
  }

  private controlCommand(command: GuidanceCommand | null, maxAccel: Vec3): Vec3 {
    if (command?.forward) {
      const target = attitudeFromForward(command.forward, command.topHint ?? localFrame(this.state.r).up);
      return attitudeControl(this.state, target, maxAccel);
    }
    const p = this.pilot;
    if (p.pitch !== 0 || p.yaw !== 0 || p.roll !== 0) {
      this.sasTarget = null;
      return vec3(p.pitch, p.roll, -p.yaw);
    }
    if (this.sas || command) {
      this.sasTarget ??= this.state.q;
      return attitudeControl(this.state, this.sasTarget, maxAccel);
    }
    return ZERO;
  }

  private updateEngine(): void {
    const v = this.vehicle;
    if (!this.launched) return;
    if (this.throttle <= 0) {
      this.noIgnitionWarned = false;
      if (v.engineRunning) {
        v.shutdown();
        this.cutoffEvent();
      }
      return;
    }
    if (v.engineRunning || v.stagePropellant <= 0) return;
    const relight = v.stageIgnitionsLeft < v.stage.engine.ignitions;
    if (v.ignite()) {
      const left = v.stageIgnitionsLeft;
      this.emit('ignition', `${v.stage.name} ${relight ? 'relight' : 'ignition'} (${left} ignition${left === 1 ? '' : 's'} left)`);
    } else if (!this.noIgnitionWarned) {
      this.noIgnitionWarned = true;
      this.emit('no-ignitions', `${v.stage.name}: no ignitions left`);
    }
  }

  private cutoffEvent(): void {
    if (this.vehicle.stageIndex === 0) {
      this.emit('meco', 'MECO: main engine cutoff');
    } else {
      this.secoCount++;
      this.emit('seco', `SECO-${this.secoCount}: second engine cutoff`);
    }
  }

  private jettisonFairing(): void {
    const v = this.vehicle;
    const before = v.massProperties();
    const body = v.jettisonFairing();
    if (body) this.spawnSeparated(body, before.comHeight, before.length);
  }

  /** Turn a separated body into debris and shift the vehicle state to the new CoM. */
  private spawnSeparated(body: SeparatedBody, oldCom: number, oldLength: number): void {
    const nose = rotate(this.state.q, NOSE);
    const after = this.vehicle.massProperties();
    const base = this.state.r;
    if (body.kind === 'stage') {
      // The upper stack's CoM sits `stage length + new CoM height` above the old base.
      this.state = { ...this.state, r: addScaled(base, nose, body.length + after.comHeight - oldCom) };
      this.addDebris(body, 0, addScaled(base, nose, body.length / 2 - oldCom), addScaled(this.state.v, nose, -1.5), vec3(0.015, 0.002, 0.01));
      this.emit('stage-sep', `${body.name} separation`);
    } else {
      this.state = { ...this.state, r: addScaled(base, nose, after.comHeight - oldCom) };
      const centre = addScaled(base, nose, oldLength - body.length / 2 - oldCom);
      const right = rotate(this.state.q, vec3(1, 0, 0));
      for (const side of [-1, 1]) {
        const vel = addScaled(addScaled(this.state.v, right, side * 3.5), nose, 0.5);
        this.addDebris({ ...body, mass: body.mass / 2 }, side, centre, vel, vec3(0, 0, -side * 0.35));
      }
      this.emit('fairing-sep', 'Fairing separation');
    }
  }

  private addDebris(body: SeparatedBody, variant: number, r: Vec3, v: Vec3, w: Vec3): void {
    this.debris.push({
      id: this.nextDebrisId++,
      kind: body.kind,
      name: body.name,
      variant: body.kind === 'stage' ? body.stageIndex : variant,
      r,
      v,
      q: this.state.q,
      w,
      mass: body.mass,
      referenceArea: Math.PI * (body.diameter / 2) ** 2 * TUMBLE_DRAG_FACTOR,
      createdAt: this.t,
      alive: true,
    });
  }

  private postStep(comHeight: number): void {
    this.aero = aerodynamics(this.state.r, this.state.v, this.vehicle.referenceArea);
    this.orbit = orbitalElements(this.state.r, this.state.v);
    this.telemetry = this.buildTelemetry();
    if (this.phase !== 'flight') return;
    const peak = this.maxQ.update(this.aero.dynamicPressure, this.missionTime);
    if (peak) this.emit('max-q', `Max-Q: ${(peak.value / 1000).toFixed(1)} kPa`);
    if (!this.orbitAchieved && this.orbit.periapsis > ORBIT_PERIAPSIS_THRESHOLD) {
      this.orbitAchieved = true;
      const km = (m: number) => (m / 1000).toFixed(0);
      this.emit('orbit', `Orbit achieved: ${km(this.orbit.apoapsis)} x ${km(this.orbit.periapsis)} km`);
    }
    if (altitude(this.state.r) < comHeight * 0.9) {
      this.impactSpeed = length(sub(this.state.v, surfaceVelocityAt(this.state.r)));
      this.phase = 'crashed';
      this.vehicle.shutdown();
      this.autopilot = null;
      this.emit('crash', `Vehicle lost: ground impact at ${this.impactSpeed.toFixed(0)} m/s`);
    }
    this.recorder.record(this.telemetry);
  }

  private padState(): BodyState {
    const angle = earthAngle(this.t);
    const props = this.vehicle.massProperties();
    const r = scale(rotateWithEarth(this.padDirection, angle), R_EARTH + props.comHeight);
    return { r, v: surfaceVelocityAt(r), q: multiply(fromAxisAngle(vec3(0, 1, 0), angle), this.padAttitude), w: ZERO };
  }

  guidanceContext(): GuidanceContext {
    const v = this.vehicle;
    const pressure = this.aero?.pressure ?? atmosphereAt(altitude(this.state.r)).pressure;
    return {
      t: this.t,
      r: this.state.r,
      v: this.state.v,
      altitude: altitude(this.state.r),
      dynamicPressure: this.aero?.dynamicPressure ?? 0,
      orbit: this.orbit ?? orbitalElements(this.state.r, this.state.v),
      onPad: this.phase === 'prelaunch',
      stageIndex: v.stageIndex,
      hasNextStage: v.hasNextStage,
      engineRunning: v.engineRunning,
      stagePropellant: v.stagePropellant,
      mass: v.mass,
      fullThrust: Math.max(0, v.stage.engine.vacuumThrust - pressure * v.exitArea()),
      maxMassFlow: v.maxMassFlow(),
      minThrottle: v.stage.engine.minThrottle,
      ispVacuum: v.stage.engine.ispVacuum,
    };
  }

  private buildTelemetry(): Telemetry {
    return computeTelemetry(this, this.maxQ);
  }

  private emit(type: SimEventType, message: string): void {
    this.events.push({ type, message, missionTime: this.missionTime });
  }
}

/** Unit vector of the vehicle's "top" (canopy) side in the inertial frame. */
export const topDirection = (q: Quat): Vec3 => rotate(q, TOP);
