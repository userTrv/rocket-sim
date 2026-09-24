import { OMEGA_EARTH, R_EARTH } from './constants';
import { cross, dot, length, normalize, vec3, reject, type Vec3 } from './math/vec3';

/**
 * Reference frames.
 * Inertial frame (ECI-like): origin at Earth's centre, +Y = north pole, Earth spins
 * counter-clockwise about +Y seen from above. Longitude is measured so that the point
 * (lat, lon) at t = 0 sits at (cos lat cos lon, sin lat, -cos lat sin lon) * R.
 */
export const EARTH_SPIN: Vec3 = vec3(0, OMEGA_EARTH, 0);

export interface LocalFrame {
  readonly up: Vec3;
  readonly east: Vec3;
  readonly north: Vec3;
}

const DEG = Math.PI / 180;

/** Unit direction of a point with the given geodetic (spherical) coordinates at Earth rotation angle 0. */
export const geoToDirection = (latDeg: number, lonDeg: number): Vec3 => {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return vec3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
};

/** Rotate an Earth-fixed vector into the inertial frame after Earth has turned by `angle` rad. */
export const rotateWithEarth = (v: Vec3, angle: number): Vec3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
};

/** Earth rotation angle at simulation time t. */
export const earthAngle = (t: number): number => OMEGA_EARTH * t;

/** Local up/east/north unit vectors at inertial position r. */
export const localFrame = (r: Vec3): LocalFrame => {
  const up = normalize(r);
  // East is the direction of Earth's rotation at that point: spin x up.
  let east = normalize(cross(vec3(0, 1, 0), up));
  if (length(east) < 0.5) east = vec3(0, 0, -1); // at the poles pick any horizontal axis
  const north = cross(up, east);
  return { up, east, north };
};

export const altitude = (r: Vec3): number => length(r) - R_EARTH;

/** Velocity of the co-rotating ground/atmosphere at position r. */
export const surfaceVelocityAt = (r: Vec3): Vec3 => cross(EARTH_SPIN, r);

/** Latitude (deg) of an inertial position. */
export const latitudeOf = (r: Vec3): number => Math.asin(r.y / length(r)) / DEG;

/** Angle of `dir` above the local horizon at position r, radians (-pi/2..pi/2). */
export const elevationAngle = (r: Vec3, dir: Vec3): number => {
  const up = normalize(r);
  const horizontal = length(reject(dir, up));
  return Math.atan2(dot(dir, up), horizontal);
};

/** Compass heading of `dir` at position r in degrees (0 = north, 90 = east). */
export const headingOf = (r: Vec3, dir: Vec3): number => {
  const { east, north } = localFrame(r);
  const h = Math.atan2(dot(dir, east), dot(dir, north)) / DEG;
  return (h + 360) % 360;
};
