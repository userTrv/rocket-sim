import { GAMMA_AIR, GAS_CONSTANT_AIR, G0 } from './constants';

/**
 * Simplified U.S. Standard Atmosphere 1976.
 *  - 0..86 km: the seven standard layers (geopotential altitude, linear temperature
 *    lapse rates, hydrostatic pressure).
 *  - above 86 km: log-linear interpolation of tabulated density/pressure/temperature
 *    (the real model solves diffusion equations there, which is overkill for a game).
 */
export interface AtmosphereSample {
  /** Kinetic temperature, K */
  readonly temperature: number;
  /** Static pressure, Pa */
  readonly pressure: number;
  /** Density, kg/m^3 */
  readonly density: number;
  /** Speed of sound, m/s */
  readonly speedOfSound: number;
}

interface Layer {
  readonly baseGeopotential: number; // m
  readonly baseTemperature: number; // K
  readonly lapseRate: number; // K/m
  readonly basePressure: number; // Pa
}

const EARTH_RADIUS_GEOPOTENTIAL = 6_356_766; // m, as used by the 1976 standard

const LAYERS: readonly Layer[] = [
  { baseGeopotential: 0, baseTemperature: 288.15, lapseRate: -0.0065, basePressure: 101_325 },
  { baseGeopotential: 11_000, baseTemperature: 216.65, lapseRate: 0, basePressure: 22_632.06 },
  { baseGeopotential: 20_000, baseTemperature: 216.65, lapseRate: 0.001, basePressure: 5_474.889 },
  { baseGeopotential: 32_000, baseTemperature: 228.65, lapseRate: 0.0028, basePressure: 868.0187 },
  { baseGeopotential: 47_000, baseTemperature: 270.65, lapseRate: 0, basePressure: 110.9063 },
  { baseGeopotential: 51_000, baseTemperature: 270.65, lapseRate: -0.0028, basePressure: 66.938_87 },
  { baseGeopotential: 71_000, baseTemperature: 214.65, lapseRate: -0.002, basePressure: 3.956_42 },
];

/** Geometric altitude (m) at which the layered model hands over to the upper table. */
const LAYERED_TOP = 86_000;

/** [geometric altitude m, temperature K, pressure Pa, density kg/m^3] from the 1976 tables. */
const UPPER_TABLE: readonly (readonly [number, number, number, number])[] = [
  [86_000, 186.87, 0.3734, 6.958e-6],
  [100_000, 195.08, 3.201e-2, 5.604e-7],
  [120_000, 360.0, 2.538e-3, 2.222e-8],
  [150_000, 634.39, 4.542e-4, 2.076e-9],
  [200_000, 854.56, 8.474e-5, 2.541e-10],
  [300_000, 976.01, 8.77e-6, 1.916e-11],
  [500_000, 999.24, 3.0e-7, 5.215e-13],
  [1_000_000, 1000.0, 7.5e-9, 3.561e-15],
];

const VACUUM: AtmosphereSample = { temperature: 1000, pressure: 0, density: 0, speedOfSound: 1 };

export const geopotentialAltitude = (geometric: number): number =>
  (EARTH_RADIUS_GEOPOTENTIAL * geometric) / (EARTH_RADIUS_GEOPOTENTIAL + geometric);

const speedOfSound = (temperature: number): number =>
  Math.sqrt(GAMMA_AIR * GAS_CONSTANT_AIR * temperature);

function layered(geometricAltitude: number): AtmosphereSample {
  const h = geopotentialAltitude(Math.max(0, geometricAltitude));
  let layer = LAYERS[0]!;
  for (const candidate of LAYERS) {
    if (h >= candidate.baseGeopotential) layer = candidate;
  }
  const dh = h - layer.baseGeopotential;
  const temperature = layer.baseTemperature + layer.lapseRate * dh;
  const pressure =
    layer.lapseRate === 0
      ? layer.basePressure * Math.exp((-G0 * dh) / (GAS_CONSTANT_AIR * layer.baseTemperature))
      : layer.basePressure *
        Math.pow(layer.baseTemperature / temperature, G0 / (GAS_CONSTANT_AIR * layer.lapseRate));
  const density = pressure / (GAS_CONSTANT_AIR * temperature);
  return { temperature, pressure, density, speedOfSound: speedOfSound(temperature) };
}

function upper(geometricAltitude: number): AtmosphereSample {
  const top = UPPER_TABLE[UPPER_TABLE.length - 1]!;
  if (geometricAltitude >= top[0]) return VACUUM;
  let i = 0;
  while (i < UPPER_TABLE.length - 2 && geometricAltitude > UPPER_TABLE[i + 1]![0]) i++;
  const [h0, t0, p0, d0] = UPPER_TABLE[i]!;
  const [h1, t1, p1, d1] = UPPER_TABLE[i + 1]!;
  const f = (geometricAltitude - h0) / (h1 - h0);
  const logLerp = (a: number, b: number) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * f);
  const temperature = t0 + (t1 - t0) * f;
  return {
    temperature,
    pressure: logLerp(p0, p1),
    density: logLerp(d0, d1),
    speedOfSound: speedOfSound(temperature),
  };
}

/** Atmospheric state at a geometric altitude above mean sea level (m). */
export function atmosphereAt(geometricAltitude: number): AtmosphereSample {
  return geometricAltitude < LAYERED_TOP ? layered(geometricAltitude) : upper(geometricAltitude);
}

/** Altitude above which the game treats the atmosphere as negligible (warp, plume, sky). */
export const ATMOSPHERE_CEILING = 100_000;
