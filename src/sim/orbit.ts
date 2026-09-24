import { MU_EARTH, R_EARTH } from './constants';
import { add, cross, dot, length, normalize, scale, vec3, type Vec3 } from './math/vec3';

/** Classical orbital elements derived from an inertial state vector (two-body, point-mass Earth). */
export interface OrbitalElements {
  /** Semi-major axis, m (negative for hyperbolic orbits). */
  readonly semiMajorAxis: number;
  readonly eccentricity: number;
  /** Inclination relative to the equator, rad. */
  readonly inclination: number;
  /** Periapsis radius, m. */
  readonly periapsisRadius: number;
  /** Apoapsis radius, m (Infinity when unbound). */
  readonly apoapsisRadius: number;
  /** Periapsis/apoapsis altitude above the mean radius, m. */
  readonly periapsis: number;
  readonly apoapsis: number;
  /** Orbital period, s (Infinity when unbound). */
  readonly period: number;
  /** True anomaly, rad in [0, 2pi). */
  readonly trueAnomaly: number;
  /** Time until the next apoapsis/periapsis passage, s (NaN when undefined). */
  readonly timeToApoapsis: number;
  readonly timeToPeriapsis: number;
  /** Specific orbital energy, J/kg. */
  readonly specificEnergy: number;
  /** Specific angular momentum vector, m^2/s. */
  readonly angularMomentum: Vec3;
  /** Unit vector towards periapsis (or the current position for circular orbits). */
  readonly periapsisDirection: Vec3;
  readonly bound: boolean;
}

const TWO_PI = Math.PI * 2;
const CIRCULAR_EPS = 1e-6;

const wrap = (a: number): number => ((a % TWO_PI) + TWO_PI) % TWO_PI;

export function orbitalElements(r: Vec3, v: Vec3, mu = MU_EARTH): OrbitalElements {
  const rMag = length(r);
  const vMag = length(v);
  const h = cross(r, v);
  const hMag = length(h);
  const specificEnergy = (vMag * vMag) / 2 - mu / rMag;

  // Eccentricity vector: e = (v x h)/mu - r/|r|
  const eVec = add(scale(cross(v, h), 1 / mu), scale(r, -1 / rMag));
  const eccentricity = length(eVec);
  const bound = specificEnergy < 0 && eccentricity < 1;
  const semiMajorAxis = -mu / (2 * specificEnergy);

  const p = (hMag * hMag) / mu; // semi-latus rectum
  const periapsisRadius = p / (1 + eccentricity);
  const apoapsisRadius = bound ? p / (1 - eccentricity) : Infinity;
  // +Y is the spin axis, so inclination is the angle between h and +Y.
  const inclination = hMag > 0 ? Math.acos(Math.min(1, Math.max(-1, h.y / hMag))) : 0;

  const periapsisDirection = eccentricity > CIRCULAR_EPS ? normalize(eVec) : normalize(r);
  let trueAnomaly = 0;
  if (eccentricity > CIRCULAR_EPS) {
    const cosNu = dot(eVec, r) / (eccentricity * rMag);
    trueAnomaly = Math.acos(Math.min(1, Math.max(-1, cosNu)));
    if (dot(r, v) < 0) trueAnomaly = TWO_PI - trueAnomaly;
  }

  let period = Infinity;
  let timeToApoapsis = NaN;
  let timeToPeriapsis = NaN;
  if (bound) {
    const n = Math.sqrt(mu / semiMajorAxis ** 3); // mean motion
    period = TWO_PI / n;
    const E = 2 * Math.atan2(
      Math.sqrt(1 - eccentricity) * Math.sin(trueAnomaly / 2),
      Math.sqrt(1 + eccentricity) * Math.cos(trueAnomaly / 2),
    );
    const M = wrap(E - eccentricity * Math.sin(E));
    timeToPeriapsis = wrap(TWO_PI - M) / n;
    timeToApoapsis = wrap(Math.PI - M) / n;
  }

  return {
    semiMajorAxis,
    eccentricity,
    inclination,
    periapsisRadius,
    apoapsisRadius,
    periapsis: periapsisRadius - R_EARTH,
    apoapsis: apoapsisRadius - R_EARTH,
    period,
    trueAnomaly,
    timeToApoapsis,
    timeToPeriapsis,
    specificEnergy,
    angularMomentum: h,
    periapsisDirection,
    bound,
  };
}

/**
 * Sample the orbit as a closed polyline (inertial frame) for map view.
 * For unbound or degenerate orbits returns an empty list.
 */
export function orbitPath(el: OrbitalElements, segments = 256): Vec3[] {
  const hMag = length(el.angularMomentum);
  if (!el.bound || hMag === 0) return [];
  const P = el.periapsisDirection;
  const Q = normalize(cross(el.angularMomentum, P));
  const p = el.semiMajorAxis * (1 - el.eccentricity ** 2);
  const points: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const nu = (i / segments) * TWO_PI;
    const rad = p / (1 + el.eccentricity * Math.cos(nu));
    points.push(vec3(
      rad * (Math.cos(nu) * P.x + Math.sin(nu) * Q.x),
      rad * (Math.cos(nu) * P.y + Math.sin(nu) * Q.y),
      rad * (Math.cos(nu) * P.z + Math.sin(nu) * Q.z),
    ));
  }
  return points;
}

/** Inertial position at a given true anomaly on the orbit. */
export function positionAtTrueAnomaly(el: OrbitalElements, nu: number): Vec3 {
  const P = el.periapsisDirection;
  const Q = normalize(cross(el.angularMomentum, P));
  const p = el.semiMajorAxis * (1 - el.eccentricity ** 2);
  const rad = p / (1 + el.eccentricity * Math.cos(nu));
  return add(scale(P, rad * Math.cos(nu)), scale(Q, rad * Math.sin(nu)));
}

/** Speed of a circular orbit at radius r. */
export const circularSpeed = (radius: number, mu = MU_EARTH): number => Math.sqrt(mu / radius);
