/** Pure formatting helpers for the HUD (unit-tested). */

const pad2 = (n: number): string => String(Math.floor(n)).padStart(2, '0');

/** "T+ 00:02:35" / "T- 00:00:00" style mission clock. */
export function formatMissionTime(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  const s = Math.abs(seconds);
  return `T${sign} ${pad2(s / 3600)}:${pad2((s % 3600) / 60)}:${pad2(s % 60)}`;
}

/** Distances: metres below 10 km, kilometres above. */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return '—';
  const abs = Math.abs(metres);
  if (abs < 10_000) return `${Math.round(metres).toLocaleString('en-US')} m`;
  return `${(metres / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

export function formatSpeed(ms: number): string {
  return `${Math.round(ms).toLocaleString('en-US')} m/s`;
}

export function formatPressure(pa: number): string {
  return pa >= 1000 ? `${(pa / 1000).toFixed(1)} kPa` : `${Math.round(pa)} Pa`;
}

/** Compact duration: "45 s", "12m 04s", "1h 32m". NaN/Infinity become a dash. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const s = Math.max(0, seconds);
  if (s < 60) return `${Math.floor(s)} s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad2(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${pad2((s % 3600) / 60)}m`;
}

export function formatAngle(degrees: number, digits = 1): string {
  return `${degrees.toFixed(digits)}°`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

export function formatMass(kg: number): string {
  return kg >= 10_000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg).toLocaleString('en-US')} kg`;
}

/** Orbit altitudes: suborbital periapsis deep inside the Earth reads better as "suborbital". */
export function formatOrbitAltitude(metres: number): string {
  if (!Number.isFinite(metres)) return 'escape';
  if (metres < -1_000_000) return 'suborbital';
  return formatDistance(metres);
}
