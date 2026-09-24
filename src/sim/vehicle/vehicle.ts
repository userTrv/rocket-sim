import { G0, SEA_LEVEL_PRESSURE } from '../constants';
import { vec3, type Vec3 } from '../math/vec3';
import type { StageConfig, VehicleConfig } from './config';

export interface PropulsionOutput {
  /** Net thrust after the ambient-pressure loss, N. */
  readonly thrust: number;
  /** Propellant mass flow, kg/s. */
  readonly massFlow: number;
  /** Throttle actually applied (respects min throttle), 0..1. */
  readonly throttle: number;
}

export interface MassProperties {
  readonly mass: number;
  readonly length: number;
  /** Centre of mass height above the bottom of the current stack, m. */
  readonly comHeight: number;
  /** Moment of inertia about the pitch/yaw axes through the CoM, kg*m^2. */
  readonly pitchInertia: number;
  /** Moment of inertia about the longitudinal (roll) axis, kg*m^2. */
  readonly rollInertia: number;
}

/** A stage (or fairing half) that left the vehicle. */
export interface SeparatedBody {
  readonly kind: 'stage' | 'fairing';
  readonly name: string;
  readonly mass: number;
  readonly length: number;
  readonly diameter: number;
  readonly stageIndex: number;
}

interface Segment {
  readonly mass: number;
  readonly length: number;
  readonly radius: number;
}

const OFF: PropulsionOutput = { thrust: 0, massFlow: 0, throttle: 0 };

/** Upper envelope length once the fairing is gone (payload adapter + payload). */
const BARE_PAYLOAD_LENGTH_RATIO = 0.6;

/**
 * Mutable runtime state of the launcher: propellant, active stage, engine state.
 * Knows nothing about position or attitude; that lives in the simulation.
 */
export class Vehicle {
  stageIndex = 0;
  engineRunning = false;
  fairingAttached = true;
  readonly propellant: number[];
  readonly ignitionsLeft: number[];

  constructor(readonly config: VehicleConfig) {
    this.propellant = config.stages.map((s) => s.propellantMass);
    this.ignitionsLeft = config.stages.map((s) => s.engine.ignitions);
  }

  get stage(): StageConfig {
    return this.config.stages[this.stageIndex]!;
  }

  get hasNextStage(): boolean {
    return this.stageIndex < this.config.stages.length - 1;
  }

  get stagePropellant(): number {
    return this.propellant[this.stageIndex]!;
  }

  get stageIgnitionsLeft(): number {
    return this.ignitionsLeft[this.stageIndex]!;
  }

  /** Maximum propellant mass flow of the active stage (100% throttle), kg/s. */
  maxMassFlow(stage: StageConfig = this.stage): number {
    return stage.engine.vacuumThrust / (stage.engine.ispVacuum * G0);
  }

  /** Effective nozzle exit area derived from the sea-level/vacuum Isp ratio, m^2. */
  exitArea(stage: StageConfig = this.stage): number {
    const e = stage.engine;
    return (e.vacuumThrust * (1 - e.ispSeaLevel / e.ispVacuum)) / SEA_LEVEL_PRESSURE;
  }

  /** Clamp a commanded throttle to what the engine can do: 0 or [minThrottle, 1]. */
  effectiveThrottle(command: number): number {
    if (!(command > 0)) return 0;
    return Math.min(1, Math.max(command, this.stage.engine.minThrottle));
  }

  /**
   * Thrust and mass flow of the active stage.
   * Mass flow is set by vacuum Isp; thrust loses p_ambient * A_exit, so it rises
   * from the sea-level to the vacuum value as the air thins out.
   */
  propulsion(throttleCommand: number, ambientPressure: number): PropulsionOutput {
    if (!this.engineRunning || this.stagePropellant <= 0) return OFF;
    const throttle = this.effectiveThrottle(throttleCommand);
    if (throttle === 0) return OFF;
    const massFlow = throttle * this.maxMassFlow();
    const thrust = Math.max(0, throttle * this.stage.engine.vacuumThrust - ambientPressure * this.exitArea());
    return { thrust, massFlow, throttle };
  }

  /** Remove burned propellant from the active stage. Returns the mass actually removed. */
  consume(mass: number): number {
    const available = this.stagePropellant;
    const burned = Math.min(available, Math.max(0, mass));
    this.propellant[this.stageIndex] = available - burned;
    return burned;
  }

  /** Try to start the active stage's engine. Uses one ignition. */
  ignite(): boolean {
    if (this.engineRunning) return true;
    if (this.stagePropellant <= 0 || this.stageIgnitionsLeft <= 0) return false;
    this.ignitionsLeft[this.stageIndex] = this.stageIgnitionsLeft - 1;
    this.engineRunning = true;
    return true;
  }

  shutdown(): void {
    this.engineRunning = false;
  }

  /** Drop the active stage; the next one becomes active with its engine off. */
  separateStage(): SeparatedBody | null {
    if (!this.hasNextStage) return null;
    const stage = this.stage;
    const body: SeparatedBody = {
      kind: 'stage',
      name: stage.name,
      mass: stage.dryMass + this.stagePropellant,
      length: stage.length,
      diameter: stage.diameter,
      stageIndex: this.stageIndex,
    };
    this.engineRunning = false;
    this.stageIndex++;
    return body;
  }

  jettisonFairing(): SeparatedBody | null {
    if (!this.fairingAttached) return null;
    this.fairingAttached = false;
    const f = this.config.fairing;
    return { kind: 'fairing', name: 'Fairing', mass: f.mass, length: f.length, diameter: f.diameter, stageIndex: -1 };
  }

  private segments(): Segment[] {
    const segs: Segment[] = [];
    for (let i = this.stageIndex; i < this.config.stages.length; i++) {
      const s = this.config.stages[i]!;
      segs.push({ mass: s.dryMass + this.propellant[i]!, length: s.length, radius: s.diameter / 2 });
    }
    const f = this.config.fairing;
    segs.push({
      mass: this.config.payloadMass + (this.fairingAttached ? f.mass : 0),
      length: this.fairingAttached ? f.length : f.length * BARE_PAYLOAD_LENGTH_RATIO,
      radius: f.diameter / 2,
    });
    return segs;
  }

  get mass(): number {
    return this.segments().reduce((m, s) => m + s.mass, 0);
  }

  /** Reference area for drag: the widest cross-section, m^2. */
  get referenceArea(): number {
    const widest = Math.max(this.stage.diameter, this.config.fairing.diameter * (this.fairingAttached ? 1 : 0.8));
    return Math.PI * (widest / 2) ** 2;
  }

  /** Stack treated as uniform cylinders; propellant is spread evenly inside its stage. */
  massProperties(): MassProperties {
    const segs = this.segments();
    let mass = 0;
    let moment = 0;
    let base = 0;
    const centroids: number[] = [];
    for (const s of segs) {
      const c = base + s.length / 2;
      centroids.push(c);
      mass += s.mass;
      moment += s.mass * c;
      base += s.length;
    }
    const comHeight = moment / mass;
    let pitchInertia = 0;
    let rollInertia = 0;
    segs.forEach((s, i) => {
      const d = centroids[i]! - comHeight;
      pitchInertia += s.mass * (s.length ** 2 / 12 + s.radius ** 2 / 4) + s.mass * d * d;
      rollInertia += (s.mass * s.radius ** 2) / 2;
    });
    return { mass, length: base, comHeight, pitchInertia, rollInertia };
  }

  /**
   * Maximum control torque per body axis (x = pitch, y = roll, z = yaw), N*m.
   * Gimbal torque = thrust * sin(gimbal) * lever arm (engines sit at the stack base);
   * RCS adds a constant torque so the vehicle can be steered while coasting.
   */
  maxTorque(thrust: number, props: MassProperties): Vec3 {
    const stage = this.stage;
    const gimbal = thrust * Math.sin(stage.engine.gimbalRange) * props.comHeight;
    const rollFromGimbal = stage.engine.count > 1 ? 0.05 * gimbal : 0;
    return vec3(gimbal + stage.rcsTorque, rollFromGimbal + stage.rcsTorque * 0.5, gimbal + stage.rcsTorque);
  }
}
