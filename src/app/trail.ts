import type { Vec3 } from '../sim/math/vec3';

/** Samples the flown trajectory (inertial frame) at a fixed simulation-time interval for map view. */
export class TrailRecorder {
  readonly points: Vec3[] = [];
  private next = 0;

  constructor(
    private readonly interval = 2,
    private readonly capacity = 6000,
  ) {}

  record(time: number, position: Vec3): void {
    if (time < this.next) return;
    this.points.push(position);
    this.next = time + this.interval;
    if (this.points.length > this.capacity) this.points.splice(0, this.points.length - this.capacity);
  }

  clear(): void {
    this.points.length = 0;
    this.next = 0;
  }
}
