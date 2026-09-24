/**
 * Drag coefficient of a slender launcher as a function of Mach number.
 * Shape follows the classic transonic drag rise: subsonic plateau, peak just past
 * Mach 1, then a slow decline in the hypersonic regime. Values are representative,
 * not measured Falcon 9 data.
 */
const CD_TABLE: readonly (readonly [number, number])[] = [
  [0, 0.3],
  [0.6, 0.3],
  [0.85, 0.36],
  [1.0, 0.52],
  [1.2, 0.58],
  [1.5, 0.52],
  [2.0, 0.44],
  [3.0, 0.36],
  [5.0, 0.29],
  [10.0, 0.25],
];

export function dragCoefficient(mach: number): number {
  if (!(mach > 0)) return CD_TABLE[0]![1];
  for (let i = 1; i < CD_TABLE.length; i++) {
    const [m1, c1] = CD_TABLE[i]!;
    if (mach <= m1) {
      const [m0, c0] = CD_TABLE[i - 1]!;
      return c0 + ((c1 - c0) * (mach - m0)) / (m1 - m0);
    }
  }
  return CD_TABLE[CD_TABLE.length - 1]![1];
}

/** Dynamic pressure q = 1/2 rho v^2 (Pa). */
export const dynamicPressure = (density: number, airspeed: number): number =>
  0.5 * density * airspeed * airspeed;
