import type { AutopilotPhase } from './guidance/autopilot';
import type { OrbitalElements } from './orbit';

export interface StageTelemetry {
  readonly name: string;
  readonly propellant: number;
  readonly capacity: number;
  readonly attached: boolean;
  readonly active: boolean;
  readonly ignitionsLeft: number;
}

/** Derived flight data for the HUD, recomputed after every simulation step. */
export interface Telemetry {
  readonly missionTime: number;
  readonly altitude: number;
  readonly surfaceSpeed: number;
  readonly orbitalSpeed: number;
  readonly verticalSpeed: number;
  readonly horizontalSpeed: number;
  readonly mach: number;
  readonly dynamicPressure: number;
  readonly maxQ: number;
  readonly maxQTime: number | null;
  readonly gLoad: number;
  readonly throttle: number;
  readonly thrust: number;
  readonly mass: number;
  readonly ambientPressure: number;
  /** Nose elevation above the local horizon, deg. */
  readonly pitch: number;
  /** Nose compass heading, deg. */
  readonly heading: number;
  /** Angle between the nose and the air-relative velocity, deg. */
  readonly angleOfAttack: number;
  readonly orbit: OrbitalElements;
  readonly stages: readonly StageTelemetry[];
  readonly stageIndex: number;
  readonly engineRunning: boolean;
  readonly fairingAttached: boolean;
  readonly sas: boolean;
  readonly autopilot: AutopilotPhase | null;
}

export interface TelemetrySample {
  readonly t: number;
  readonly altitude: number;
  readonly velocity: number;
  readonly dynamicPressure: number;
}

export interface FlightStats {
  maxAltitude: number;
  maxOrbitalSpeed: number;
  maxQ: number;
  maxQTime: number;
  maxG: number;
  liftoffMass: number;
}

/** Samples telemetry at a fixed interval for charts and the mission summary. */
export class FlightRecorder {
  readonly samples: TelemetrySample[] = [];
  readonly stats: FlightStats = { maxAltitude: 0, maxOrbitalSpeed: 0, maxQ: 0, maxQTime: 0, maxG: 0, liftoffMass: 0 };
  private nextSample = 0;

  constructor(
    private readonly interval = 1,
    private readonly maxSamples = 4000,
  ) {}

  record(t: Telemetry): void {
    const s = this.stats;
    s.maxAltitude = Math.max(s.maxAltitude, t.altitude);
    s.maxOrbitalSpeed = Math.max(s.maxOrbitalSpeed, t.orbitalSpeed);
    s.maxG = Math.max(s.maxG, t.gLoad);
    if (t.dynamicPressure > s.maxQ) {
      s.maxQ = t.dynamicPressure;
      s.maxQTime = t.missionTime;
    }
    if (t.missionTime >= this.nextSample) {
      this.samples.push({ t: t.missionTime, altitude: t.altitude, velocity: t.orbitalSpeed, dynamicPressure: t.dynamicPressure });
      this.nextSample = t.missionTime + this.interval;
      if (this.samples.length > this.maxSamples) this.decimate();
    }
  }

  /** Halve the resolution when the buffer fills up (long orbital flights). */
  private decimate(): void {
    const kept = this.samples.filter((_, i) => i % 2 === 0);
    this.samples.length = 0;
    this.samples.push(...kept);
  }
}
