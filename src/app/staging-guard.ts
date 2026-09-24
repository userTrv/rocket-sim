import type { Telemetry } from '../sim/telemetry';

/** Seconds within which a second Space press confirms an early separation. */
export const STAGING_CONFIRM_WINDOW = 2;
/** Below this propellant fraction the active stage is considered spent. */
const SPENT_FRACTION = 0.05;

/**
 * Separating a burning stage that still has propellant throws the vehicle away (and on the pad
 * leaves the upper stage without enough thrust to fly), so it needs a confirming second press.
 * Returns the warning to show, or null when staging can go ahead immediately.
 */
export function earlyStagingWarning(t: Telemetry): string | null {
  const active = t.stages[t.stageIndex];
  const hasNext = t.stages.some((s, i) => i > t.stageIndex && s.attached);
  if (!active || !hasNext || !t.engineRunning) return null;
  const fraction = active.capacity > 0 ? active.propellant / active.capacity : 0;
  if (fraction < SPENT_FRACTION) return null;
  return `${active.name} still has ${Math.round(fraction * 100)}% propellant: press Space again to separate`;
}
