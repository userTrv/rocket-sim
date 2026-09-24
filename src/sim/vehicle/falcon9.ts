import type { VehicleConfig } from './config';

const DEG = Math.PI / 180;

/**
 * A two-stage kerosene/LOX launcher with roughly Falcon 9 Full Thrust numbers.
 * Sources: public SpaceX user guide figures and widely quoted estimates; rounded.
 *
 * | Stage | Dry    | Propellant | Thrust (vac) | Isp SL / vac | Burn time |
 * |-------|--------|------------|--------------|--------------|-----------|
 * | 1     | 25.6 t | 411 t      | 8 227 kN     | 282 / 311 s  | ~152 s    |
 * | 2     | 3.9 t  | 107.5 t    | 981 kN       | —   / 348 s  | ~374 s    |
 *
 * Payload 15 t + 1.9 t fairing. Liftoff mass ~565 t, liftoff T/W ~1.37.
 */
export const FALCON_9: VehicleConfig = {
  name: 'Falcon 9-class launcher',
  stages: [
    {
      name: 'Stage 1',
      dryMass: 25_600,
      propellantMass: 411_000,
      length: 47.7,
      diameter: 3.66,
      rcsTorque: 60_000,
      engine: {
        name: '9 x Merlin 1D',
        count: 9,
        vacuumThrust: 8_227_000,
        ispSeaLevel: 282,
        ispVacuum: 311,
        minThrottle: 0.4,
        ignitions: 3,
        gimbalRange: 5 * DEG,
        nozzleExitRadius: 0.46,
      },
    },
    {
      name: 'Stage 2',
      dryMass: 3_900,
      propellantMass: 107_500,
      length: 13.8,
      diameter: 3.66,
      rcsTorque: 40_000,
      engine: {
        name: 'Merlin Vacuum',
        count: 1,
        vacuumThrust: 981_000,
        ispSeaLevel: 180,
        ispVacuum: 348,
        minThrottle: 0.39,
        ignitions: 4,
        gimbalRange: 5 * DEG,
        nozzleExitRadius: 1.5,
      },
    },
  ],
  payloadMass: 15_000,
  fairing: {
    mass: 1_900,
    length: 13.1,
    diameter: 5.2,
    jettisonAltitude: 110_000,
  },
  angularDamping: 0.03,
};
