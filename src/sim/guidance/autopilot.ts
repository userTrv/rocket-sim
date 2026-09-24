import { G0, MU_EARTH, R_EARTH } from '../constants';
import { localFrame, surfaceVelocityAt } from '../frames';
import { add, addScaled, cross, dot, length, lerp, normalize, reject, rotateAroundAxis, scale, sub, type Vec3 } from '../math/vec3';
import { circularSpeed, type OrbitalElements } from '../orbit';

/**
 * Closed-loop ascent guidance, KSP-style but physically honest:
 *
 *  1. vertical rise      clear the tower
 *  2. pitch-over         small kick towards the launch azimuth
 *  3. gravity turn       follow surface prograde (blending into orbital prograde),
 *                        throttle to respect a max-Q and a g limit
 *  4. MECO + staging     burn stage 1 to depletion, coast briefly, separate
 *  5. upper ascent       steer the vertical speed so the apoapsis sits on the target
 *                        altitude while horizontal speed builds; cut off (SECO-1)
 *                        once the periapsis is out of the atmosphere
 *  6. coast              wait for apoapsis (time warp allowed)
 *  7. circularise        burn horizontally at apoapsis, nulling vertical speed,
 *                        until the orbit is circular (SECO-2)
 */
export type AutopilotPhase =
  | 'launch'
  | 'vertical-rise'
  | 'pitch-over'
  | 'gravity-turn'
  | 'meco-coast'
  | 'upper-ascent'
  | 'coast-to-apoapsis'
  | 'circularize'
  | 'orbit'
  | 'out-of-propellant';

export interface AutopilotOptions {
  /** Target circular orbit altitude, m. */
  readonly targetAltitude: number;
  /** Surface speed at which the pitch-over starts, m/s. */
  readonly pitchOverSpeed: number;
  /** Pitch-over kick angle from vertical, rad. */
  readonly pitchOverAngle: number;
  /** Launch azimuth, rad from north (pi/2 = due east). */
  readonly azimuth: number;
  /** Dynamic pressure the throttle controller tries to stay under, Pa. */
  readonly maxDynamicPressure: number;
  /** Acceleration limit, g. */
  readonly maxG: number;
  /**
   * The upper stage first burns into a transfer orbit with its periapsis at this altitude
   * and apoapsis at the target altitude (SECO-1), then circularises at apoapsis.
   */
  readonly insertionAltitude: number;
}

export const DEFAULT_AUTOPILOT: AutopilotOptions = {
  targetAltitude: 200_000,
  pitchOverSpeed: 55,
  pitchOverAngle: (5 * Math.PI) / 180,
  azimuth: Math.PI / 2,
  maxDynamicPressure: 32_000,
  maxG: 4.5,
  insertionAltitude: 140_000,
};

export interface GuidanceContext {
  readonly t: number;
  readonly r: Vec3;
  readonly v: Vec3;
  readonly altitude: number;
  readonly dynamicPressure: number;
  readonly orbit: OrbitalElements;
  readonly onPad: boolean;
  readonly stageIndex: number;
  readonly hasNextStage: boolean;
  readonly engineRunning: boolean;
  readonly stagePropellant: number;
  readonly mass: number;
  /** Thrust at 100% throttle in the current ambient pressure, N. */
  readonly fullThrust: number;
  readonly maxMassFlow: number;
  readonly minThrottle: number;
  readonly ispVacuum: number;
}

export interface GuidanceCommand {
  readonly throttle: number;
  /** Desired nose direction in the inertial frame (null = hold current attitude). */
  readonly forward: Vec3 | null;
  /** Hint for the "top" of the vehicle so roll stays heads-up. */
  readonly topHint: Vec3 | null;
  readonly launch: boolean;
  readonly stage: boolean;
  /** Highest time warp the autopilot is comfortable with right now. */
  readonly warpLimit: number;
}

const NO_WARP_LIMIT = Number.POSITIVE_INFINITY;
const STAGING_DELAY = 2.5; // s of coast between MECO and separation
const IGNITION_DELAY = 1.5; // s between separation and upper-stage ignition
const MIN_TIME_TO_GO = 8; // s; below this the terminal guidance freezes the pitch

export class Autopilot {
  phase: AutopilotPhase;
  private phaseStart: number;
  private stagedAt: number | null = null;
  private lastPeriapsis = -Infinity;
  private lastSinPitch = 0;

  constructor(
    ctx: GuidanceContext,
    readonly options: AutopilotOptions = DEFAULT_AUTOPILOT,
  ) {
    this.phase = Autopilot.initialPhase(ctx, options);
    this.phaseStart = ctx.t;
  }

  /** Pick a sensible phase when the autopilot is engaged mid-flight. */
  static initialPhase(ctx: GuidanceContext, o: AutopilotOptions): AutopilotPhase {
    if (ctx.onPad) return 'launch';
    if (ctx.orbit.periapsis > o.targetAltitude - 30_000) return 'orbit';
    if (ctx.stageIndex === 0) {
      if (ctx.altitude < 1_000) return 'vertical-rise';
      return 'gravity-turn';
    }
    if (ctx.orbit.periapsis > o.insertionAltitude - 25_000 || (!ctx.engineRunning && ctx.orbit.apoapsis > o.targetAltitude - 20_000)) {
      return 'coast-to-apoapsis';
    }
    return 'upper-ascent';
  }

  private enter(phase: AutopilotPhase, t: number): void {
    this.phase = phase;
    this.phaseStart = t;
  }

  update(ctx: GuidanceContext): GuidanceCommand {
    const { up, east, north } = localFrame(ctx.r);
    const downrange = add(scale(north, Math.cos(this.options.azimuth)), scale(east, Math.sin(this.options.azimuth)));
    const hold = (forward: Vec3, throttle: number, extra: Partial<GuidanceCommand> = {}): GuidanceCommand => ({
      throttle,
      forward,
      topHint: sub(up, downrange),
      launch: false,
      stage: false,
      warpLimit: NO_WARP_LIMIT,
      ...extra,
    });
    const elapsed = ctx.t - this.phaseStart;
    const surfaceVel = sub(ctx.v, surfaceVelocityAt(ctx.r));
    const orbitalPrograde = normalize(ctx.v);

    if (ctx.stagePropellant <= 0 && !ctx.hasNextStage && this.phase !== 'orbit') {
      this.enter(ctx.orbit.periapsis > 150_000 ? 'orbit' : 'out-of-propellant', ctx.t);
    }

    switch (this.phase) {
      case 'launch':
        if (!ctx.onPad) this.enter('vertical-rise', ctx.t);
        return hold(up, 1, { launch: true });

      case 'vertical-rise':
        if (length(surfaceVel) > this.options.pitchOverSpeed && ctx.altitude > 150) this.enter('pitch-over', ctx.t);
        return hold(up, this.ascentThrottle(ctx));

      case 'pitch-over': {
        const kick = rotateAroundAxis(up, normalize(cross(up, downrange)), this.options.pitchOverAngle);
        const velocityTilt = Math.acos(Math.min(1, dot(normalize(surfaceVel), up)));
        if (velocityTilt >= this.options.pitchOverAngle * 0.9 || elapsed > 20) this.enter('gravity-turn', ctx.t);
        return hold(kick, this.ascentThrottle(ctx));
      }

      case 'gravity-turn': {
        if (!ctx.engineRunning && ctx.stagePropellant <= 0) {
          this.enter('meco-coast', ctx.t);
          return hold(normalize(surfaceVel), 0);
        }
        // Follow surface prograde low down, inertial prograde higher up.
        const blend = clamp01((ctx.altitude - 25_000) / 35_000);
        const prograde = normalize(lerp(normalize(surfaceVel), orbitalPrograde, blend));
        if (ctx.orbit.apoapsis > this.options.targetAltitude + 20_000) {
          this.enter('meco-coast', ctx.t); // stage 1 overperformed: cut early
          return hold(prograde, 0);
        }
        return hold(prograde, this.ascentThrottle(ctx));
      }

      case 'meco-coast': {
        const dir = ctx.altitude > 60_000 ? orbitalPrograde : normalize(surfaceVel);
        if (this.stagedAt === null && elapsed >= STAGING_DELAY && ctx.hasNextStage) {
          this.stagedAt = ctx.t;
          return hold(dir, 0, { stage: true });
        }
        if (this.stagedAt !== null && ctx.t - this.stagedAt >= IGNITION_DELAY) {
          this.enter('upper-ascent', ctx.t);
          return hold(dir, 1);
        }
        return hold(dir, 0);
      }

      case 'upper-ascent': {
        const o = this.options;
        if (ctx.orbit.apoapsis >= o.targetAltitude && ctx.orbit.periapsis > o.insertionAltitude - 25_000) {
          this.enter('coast-to-apoapsis', ctx.t); // SECO-1: in the transfer orbit
          return hold(orbitalPrograde, 0);
        }
        // Insert at the periapsis of an ellipse whose apoapsis is the target altitude.
        const rp = R_EARTH + o.insertionAltitude;
        const ra = R_EARTH + o.targetAltitude;
        const vPeriapsis = Math.sqrt((MU_EARTH * 2 * ra) / (rp * (rp + ra)));
        return hold(this.terminalGuidanceDirection(ctx, rp, vPeriapsis), this.ascentThrottle(ctx));
      }

      case 'coast-to-apoapsis': {
        const burn = this.circularizationBurnTime(ctx);
        const tApo = ctx.orbit.timeToApoapsis;
        const justPassed = tApo > ctx.orbit.period - 120;
        if (ctx.orbit.periapsis > this.options.targetAltitude - 15_000 && ctx.orbit.eccentricity < 0.003) {
          this.enter('orbit', ctx.t);
          return hold(orbitalPrograde, 0);
        }
        if (tApo <= burn / 2 + 0.5 || justPassed) {
          this.enter('circularize', ctx.t);
          this.lastSinPitch = 0;
          this.lastPeriapsis = ctx.orbit.periapsis;
          return hold(this.horizontal(ctx), 1);
        }
        // Allow warp as long as the burn start stays several frames of warp away.
        const timeToBurn = tApo - burn / 2 - 15;
        return hold(orbitalPrograde, 0, { warpLimit: Math.max(1, timeToBurn / 4) });
      }

      case 'circularize': {
        const el = ctx.orbit;
        const done =
          el.apoapsis - el.periapsis < 2_000 ||
          (el.periapsis > 150_000 && el.periapsis < this.lastPeriapsis - 5);
        this.lastPeriapsis = el.periapsis;
        if (done) {
          this.enter('orbit', ctx.t);
          return hold(orbitalPrograde, 0);
        }
        // Throttle back for a precise cutoff during the last seconds.
        const dvLeft = circularSpeed(length(ctx.r)) - horizontalSpeed(ctx);
        const accel = ctx.fullThrust / ctx.mass;
        const throttle = clamp01(Math.max(ctx.minThrottle, dvLeft / (accel * 3)));
        const r = length(ctx.r);
        return hold(this.terminalGuidanceDirection(ctx, r, circularSpeed(r), 0.4), dvLeft > 0 ? throttle : 0);
      }

      case 'orbit':
      case 'out-of-propellant':
        return hold(orbitalPrograde, 0);
    }
  }

  /** Throttle for the ascent: full, but limited by dynamic pressure and g-load. */
  private ascentThrottle(ctx: GuidanceContext): number {
    const o = this.options;
    const qExcess = clamp01((ctx.dynamicPressure - 0.9 * o.maxDynamicPressure) / (0.2 * o.maxDynamicPressure));
    const qThrottle = 1 - 0.4 * qExcess;
    const gThrottle = ctx.fullThrust > 0 ? (o.maxG * G0 * ctx.mass) / ctx.fullThrust : 1;
    return Math.max(ctx.minThrottle, Math.min(1, qThrottle, gThrottle));
  }

  /**
   * Terminal guidance in the vertical channel. Assume the vertical acceleration varies
   * linearly over the remaining burn time t_go and solve for the value that brings the
   * vehicle to the target radius with zero vertical speed exactly at burnout:
   *   a0 = (6 dh - 4 vz t_go) / t_go^2
   * The engine supplies a0 + (gravity - centrifugal); whatever thrust is left over
   * accelerates the vehicle horizontally. t_go comes from the rocket equation.
   */
  private terminalGuidanceDirection(ctx: GuidanceContext, targetRadius: number, targetSpeed: number, maxSin = 0.9): Vec3 {
    const up = normalize(ctx.r);
    const rMag = length(ctx.r);
    const vz = dot(ctx.v, up);
    const vh = horizontalSpeed(ctx);
    const gEff = MU_EARTH / (rMag * rMag) - (vh * vh) / rMag;
    const aThrust = Math.max(ctx.fullThrust / ctx.mass, 1e-3);
    const cosPrev = Math.sqrt(1 - this.lastSinPitch * this.lastSinPitch);
    const dvGo = Math.max(0, targetSpeed - vh) / Math.max(cosPrev, 0.5);
    const ve = ctx.ispVacuum * G0;
    const burnTime = ctx.maxMassFlow > 0 ? (ctx.mass / ctx.maxMassFlow) * (1 - Math.exp(-dvGo / ve)) : 0;
    if (burnTime > MIN_TIME_TO_GO) {
      const a0 = (6 * (targetRadius - rMag) - 4 * vz * burnTime) / (burnTime * burnTime);
      this.lastSinPitch = Math.max(-0.5, Math.min(maxSin, (a0 + gEff) / aThrust));
    } // else: hold the last pitch through the final seconds (guidance becomes singular)
    const sinPitch = this.lastSinPitch;
    return normalize(addScaled(scale(this.horizontal(ctx), Math.sqrt(1 - sinPitch * sinPitch)), up, sinPitch));
  }

  private horizontal(ctx: GuidanceContext): Vec3 {
    const up = normalize(ctx.r);
    const h = reject(ctx.v, up);
    return length(h) > 1 ? normalize(h) : localFrame(ctx.r).east;
  }

  private circularizationBurnTime(ctx: GuidanceContext): number {
    const el = ctx.orbit;
    if (!el.bound) return 0;
    const ra = el.apoapsisRadius;
    const vApo = Math.sqrt(MU_EARTH * (2 / ra - 1 / el.semiMajorAxis));
    const dv = Math.max(0, circularSpeed(ra) - vApo);
    if (ctx.maxMassFlow <= 0) return 0;
    const ve = ctx.ispVacuum * G0;
    const burnedMass = ctx.mass * (1 - Math.exp(-dv / ve));
    return burnedMass / ctx.maxMassFlow;
  }
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

const horizontalSpeed = (ctx: GuidanceContext): number => length(reject(ctx.v, normalize(ctx.r)));

