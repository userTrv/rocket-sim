/** Typed description of a multi-stage launch vehicle. All values SI (kg, N, m, s, rad). */
export interface EngineConfig {
  readonly name: string;
  /** Number of engines on the stage (used for visuals and roll authority). */
  readonly count: number;
  /** Total stage thrust in vacuum at 100% throttle, N. */
  readonly vacuumThrust: number;
  /** Specific impulse at sea level, s. Determines the nozzle exit-area pressure loss. */
  readonly ispSeaLevel: number;
  /** Specific impulse in vacuum, s. Determines mass flow. */
  readonly ispVacuum: number;
  /** Deepest throttle setting while running (0..1). */
  readonly minThrottle: number;
  /** Total number of ignitions available, including the first one. */
  readonly ignitions: number;
  /** Maximum gimbal deflection, rad. */
  readonly gimbalRange: number;
  /** Nozzle exit radius for visuals, m. */
  readonly nozzleExitRadius: number;
}

export interface StageConfig {
  readonly name: string;
  readonly dryMass: number;
  readonly propellantMass: number;
  /** Length of the stage including its interstage, m. */
  readonly length: number;
  readonly diameter: number;
  readonly engine: EngineConfig;
  /** Reaction-control torque available on every axis, N*m. */
  readonly rcsTorque: number;
}

export interface FairingConfig {
  readonly mass: number;
  readonly length: number;
  readonly diameter: number;
  /** Fairing is jettisoned automatically above this altitude, m. */
  readonly jettisonAltitude: number;
}

export interface VehicleConfig {
  readonly name: string;
  /** Stages from the bottom (first to fire) up. */
  readonly stages: readonly StageConfig[];
  readonly payloadMass: number;
  readonly fairing: FairingConfig;
  /** Passive angular damping (slosh, structure), 1/s. Keeps free tumbling bounded. */
  readonly angularDamping: number;
}
