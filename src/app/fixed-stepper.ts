/**
 * Fixed-timestep accumulator ("Fix Your Timestep"): real time (scaled by time warp) is
 * banked and spent in constant-size simulation steps, decoupling physics from frame rate.
 * The leftover fraction is returned as an interpolation factor for rendering.
 */
export interface StepPlan {
  /** Number of fixed steps to run this frame. */
  readonly steps: number;
  /** Interpolation factor between the previous and current state, 0..1. */
  readonly alpha: number;
  /** True when simulation time had to be dropped to keep the frame budget. */
  readonly dropped: boolean;
}

export class FixedStepper {
  private accumulator = 0;

  constructor(private readonly maxStepsPerFrame = 1200) {}

  /**
   * @param realDelta wall-clock seconds since the last frame (already clamped by the caller)
   * @param warp time-warp multiplier
   * @param stepSize fixed simulation step, s
   */
  plan(realDelta: number, warp: number, stepSize: number): StepPlan {
    this.accumulator += Math.max(0, realDelta) * warp;
    let steps = Math.floor(this.accumulator / stepSize);
    let dropped = false;
    if (steps > this.maxStepsPerFrame) {
      steps = this.maxStepsPerFrame;
      this.accumulator = 0;
      dropped = true;
    } else {
      this.accumulator -= steps * stepSize;
    }
    return { steps, alpha: dropped ? 1 : Math.min(1, this.accumulator / stepSize), dropped };
  }

  /** Forget banked time (e.g. after a warp change or a pause). */
  reset(): void {
    this.accumulator = 0;
  }
}
