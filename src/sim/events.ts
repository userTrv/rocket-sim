export type SimEventType =
  | 'ignition'
  | 'liftoff'
  | 'max-q'
  | 'meco'
  | 'stage-sep'
  | 'fairing-sep'
  | 'seco'
  | 'depleted'
  | 'no-ignitions'
  | 'orbit'
  | 'crash'
  | 'autopilot'
  | 'sas';

export interface SimEvent {
  readonly type: SimEventType;
  /** Mission elapsed time (s since liftoff; negative before liftoff). */
  readonly missionTime: number;
  readonly message: string;
}

/**
 * Detects the maximum of dynamic pressure during ascent.
 * Reports once, after q has dropped clearly below its running peak.
 */
export class MaxQDetector {
  peak = 0;
  peakTime = 0;
  reported = false;

  constructor(
    private readonly minimumPeak = 5_000,
    private readonly dropRatio = 0.92,
  ) {}

  /** Returns the peak value when max-Q has just been passed, otherwise null. */
  update(q: number, missionTime: number): { value: number; time: number } | null {
    if (q > this.peak) {
      this.peak = q;
      this.peakTime = missionTime;
    }
    if (!this.reported && this.peak >= this.minimumPeak && q < this.peak * this.dropRatio) {
      this.reported = true;
      return { value: this.peak, time: this.peakTime };
    }
    return null;
  }
}
