import { NOSE } from '../sim/attitude';
import { localFrame, surfaceVelocityAt } from '../sim/frames';
import { add, addScaled, length, scale, type Vec3 } from '../sim/math/vec3';
import { rotate } from '../sim/math/quat';
import type { RenderFrame } from './frame';
import type { ParticleSystem } from './particles';
import { mulberry32 } from './stars';

const GROUND_EFFECT_HEIGHT = 90; // m above the pad where exhaust still hits the trench
const SMOKE_CEILING = 28_000; // m; above this the trail is invisible anyway

/**
 * Decides where exhaust smoke and steam spawn: a billowing cloud out of the flame trench
 * at liftoff and a trail behind the vehicle through the lower atmosphere.
 */
export class ExhaustEffects {
  private readonly rand = mulberry32(42);
  private carry = 0;

  constructor(private readonly particles: ParticleSystem) {}

  update(frame: RenderFrame, nozzle: Vec3, padPosition: Vec3): void {
    const dt = frame.simDelta;
    if (!frame.engine.running || dt <= 0 || frame.altitude > SMOKE_CEILING) return;
    const throttle = frame.engine.throttle;
    const heightAbovePad = length(nozzle) - length(padPosition);
    const nearGround = heightAbovePad < GROUND_EFFECT_HEIGHT;
    const thin = Math.max(0.15, 1 - frame.altitude / SMOKE_CEILING);
    const rate = (nearGround ? 160 : 90) * throttle * (nearGround ? 1 : thin);
    this.carry += rate * Math.min(dt, 0.1);
    const count = Math.floor(this.carry);
    this.carry -= count;
    const air = surfaceVelocityAt(nozzle);
    const nose = rotate(frame.vehicle.q, NOSE);
    const { up, north, east } = localFrame(padPosition);
    for (let i = 0; i < count; i++) {
      if (nearGround) this.trenchPlume(padPosition, air, up, north, east, heightAbovePad);
      else this.trail(nozzle, air, nose, thin);
    }
  }

  private jitter(scaleBy: number): Vec3 {
    const r = this.rand;
    return { x: (r() - 0.5) * scaleBy, y: (r() - 0.5) * scaleBy, z: (r() - 0.5) * scaleBy };
  }

  private trenchPlume(pad: Vec3, air: Vec3, up: Vec3, north: Vec3, east: Vec3, height: number): void {
    const r = this.rand;
    // Most of the exhaust leaves through the trench to the east, some spills sideways.
    const sideways = r() < 0.3;
    const dir = sideways ? addScaled(scale(north, r() < 0.5 ? -1 : 1), east, (r() - 0.5) * 0.6) : addScaled(east, north, (r() - 0.5) * 0.5);
    const origin = addScaled(addScaled(pad, sideways ? up : east, sideways ? 4 : 40), up, 3);
    const speed = 30 + r() * 60 * (1 - height / GROUND_EFFECT_HEIGHT);
    const velocity = add(addScaled(addScaled(air, dir, speed), up, 6 + r() * 14), this.jitter(10));
    const grey = 0.78 + r() * 0.15;
    this.particles.emit({
      position: add(origin, this.jitter(8)),
      velocity,
      life: 7 + r() * 7,
      startSize: 10,
      endSize: 70 + r() * 50,
      color: [grey, grey, grey * 0.98, 0.55],
      drag: 0.35,
    });
  }

  private trail(nozzle: Vec3, air: Vec3, nose: Vec3, thin: number): void {
    const r = this.rand;
    const behind = addScaled(nozzle, nose, -(8 + r() * 12));
    const grey = 0.85 + r() * 0.1;
    this.particles.emit({
      position: add(behind, this.jitter(3)),
      velocity: add(addScaled(air, nose, -30), this.jitter(12)),
      life: (8 + r() * 6) * (0.4 + 0.6 * thin),
      startSize: 12,
      endSize: 60 + 50 * (1 - thin),
      color: [grey, grey, grey, 0.8 * thin + 0.15],
      drag: 1.2,
    });
  }

  /** Fireball and debris smoke where the vehicle hit the ground. */
  explosion(position: Vec3): void {
    const r = this.rand;
    const air = surfaceVelocityAt(position);
    const { up } = localFrame(position);
    for (let i = 0; i < 220; i++) {
      const fire = i < 90;
      const dir = normalizeish(add(this.jitter(2), scale(up, 0.8)));
      this.particles.emit({
        position: add(position, this.jitter(15)),
        velocity: addScaled(air, dir, (fire ? 40 : 15) + r() * 60),
        life: fire ? 1.5 + r() * 1.5 : 8 + r() * 8,
        startSize: fire ? 25 : 20,
        endSize: fire ? 90 : 160,
        color: fire ? [1, 0.55 + r() * 0.25, 0.2, 0.9] : [0.25, 0.24, 0.23, 0.6],
        drag: fire ? 1.5 : 0.4,
      });
    }
  }
}

const normalizeish = (v: Vec3): Vec3 => {
  const l = length(v);
  return l > 0 ? scale(v, 1 / l) : v;
};
