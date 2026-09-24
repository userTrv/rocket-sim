/**
 * Headless autopilot flight, printed as a table. Handy for tuning guidance:
 *   pnpm dlx tsx scripts/fly.ts
 */
import { Simulation } from '../src/sim/simulation';
import { FALCON_9 } from '../src/sim/vehicle/falcon9';
import { BASE_STEP } from '../src/sim/time-warp';

const sim = new Simulation({ vehicle: FALCON_9 });
sim.toggleAutopilot();
const dt = BASE_STEP;
let nextPrint = 0;
const km = (m: number) => (m / 1000).toFixed(1).padStart(7);
while (sim.t < 4000 && sim.phase !== 'crashed' && sim.autopilot?.phase !== 'orbit' && sim.autopilot?.phase !== 'out-of-propellant') {
  // Warp through the coast the way the app would: bigger steps above the atmosphere.
  const rails = sim.autopilot?.phase === 'coast-to-apoapsis' && sim.autopilotWarpLimit > 20;
  sim.step(rails ? 0.1 : dt, rails);
  for (const e of sim.drainEvents()) console.log(`T+${e.missionTime.toFixed(1).padStart(7)}  ${e.message}`);
  if (sim.missionTime >= nextPrint) {
    const t = sim.telemetry;
    console.log(
      `T+${t.missionTime.toFixed(0).padStart(5)} ${sim.autopilot?.phase.padEnd(18)} alt${km(t.altitude)} v${t.orbitalSpeed.toFixed(0).padStart(6)} vz${t.verticalSpeed.toFixed(0).padStart(6)} q${(t.dynamicPressure / 1000).toFixed(1).padStart(6)} g${t.gLoad.toFixed(2).padStart(5)} pitch${t.pitch.toFixed(1).padStart(6)} thr${t.throttle.toFixed(2)} apo${km(t.orbit.apoapsis)} peri${km(t.orbit.periapsis)} prop${(sim.vehicle.stagePropellant / 1000).toFixed(1).padStart(6)}t`,
    );
    nextPrint += 10;
  }
}
const t = sim.telemetry;
console.log('\nFINAL', sim.autopilot?.phase, 'apo', km(t.orbit.apoapsis), 'peri', km(t.orbit.periapsis), 'ecc', t.orbit.eccentricity.toFixed(4),
  'incl', ((t.orbit.inclination * 180) / Math.PI).toFixed(2), 'S2 prop left', (sim.vehicle.propellant[1]! / 1000).toFixed(1), 't');
