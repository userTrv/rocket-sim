import { BufferAttribute, BufferGeometry, NormalBlending, Points, ShaderMaterial } from 'three';
import { surfaceVelocityAt } from '../sim/frames';
import type { Vec3 } from '../sim/math/vec3';
import { PARTICLE_FRAGMENT, PARTICLE_VERTEX } from './shaders/plume';

export interface ParticleSpawn {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly life: number;
  readonly startSize: number;
  readonly endSize: number;
  /** RGB 0..1 and peak opacity. */
  readonly color: readonly [number, number, number, number];
  /** How quickly the particle adopts the local wind (co-rotating air), 1/s. */
  readonly drag: number;
}

/**
 * CPU-simulated billboard particles (smoke, steam). Positions are kept in double precision
 * in the inertial frame and written relative to the floating origin every frame, so a
 * smoke column stays put on the ground while the camera races away with the rocket.
 */
export class ParticleSystem {
  readonly points: Points;
  private readonly pos: Float64Array;
  private readonly vel: Float64Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly sizes: Float32Array;
  private readonly colors: Float32Array;
  private readonly drag: Float32Array;
  private readonly positionAttr: BufferAttribute;
  private readonly sizeAttr: BufferAttribute;
  private readonly colorAttr: BufferAttribute;
  private readonly material: ShaderMaterial;
  private cursor = 0;

  constructor(private readonly capacity: number) {
    this.pos = new Float64Array(capacity * 3);
    this.vel = new Float64Array(capacity * 3);
    this.age = new Float32Array(capacity).fill(1);
    this.life = new Float32Array(capacity).fill(1);
    this.sizes = new Float32Array(capacity * 2);
    this.colors = new Float32Array(capacity * 4);
    this.drag = new Float32Array(capacity);
    const geometry = new BufferGeometry();
    this.positionAttr = new BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(35048 /* DynamicDrawUsage */);
    this.sizeAttr = new BufferAttribute(new Float32Array(capacity), 1).setUsage(35048);
    this.colorAttr = new BufferAttribute(new Float32Array(capacity * 4), 4).setUsage(35048);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('aSize', this.sizeAttr);
    geometry.setAttribute('aColor', this.colorAttr);
    this.material = new ShaderMaterial({
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      uniforms: { uPixelScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  set pixelScale(value: number) {
    this.material.uniforms.uPixelScale!.value = value;
  }

  emit(p: ParticleSpawn): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos[i * 3] = p.position.x;
    this.pos[i * 3 + 1] = p.position.y;
    this.pos[i * 3 + 2] = p.position.z;
    this.vel[i * 3] = p.velocity.x;
    this.vel[i * 3 + 1] = p.velocity.y;
    this.vel[i * 3 + 2] = p.velocity.z;
    this.age[i] = 0;
    this.life[i] = p.life;
    this.sizes[i * 2] = p.startSize;
    this.sizes[i * 2 + 1] = p.endSize;
    this.colors.set(p.color, i * 4);
    this.drag[i] = p.drag;
  }

  update(dt: number, origin: Vec3): void {
    const out = this.positionAttr.array as Float32Array;
    const size = this.sizeAttr.array as Float32Array;
    const color = this.colorAttr.array as Float32Array;
    for (let i = 0; i < this.capacity; i++) {
      const k = i * 3;
      if (this.age[i]! >= this.life[i]!) {
        size[i] = 0;
        color[i * 4 + 3] = 0;
        continue;
      }
      this.age[i]! += dt;
      const t = Math.min(1, this.age[i]! / this.life[i]!);
      const wind = surfaceVelocityAt({ x: this.pos[k]!, y: this.pos[k + 1]!, z: this.pos[k + 2]! });
      const blend = 1 - Math.exp(-this.drag[i]! * dt);
      this.vel[k] = this.vel[k]! + (wind.x - this.vel[k]!) * blend;
      this.vel[k + 1] = this.vel[k + 1]! + (wind.y - this.vel[k + 1]!) * blend;
      this.vel[k + 2] = this.vel[k + 2]! + (wind.z - this.vel[k + 2]!) * blend;
      this.pos[k] = this.pos[k]! + this.vel[k]! * dt;
      this.pos[k + 1] = this.pos[k + 1]! + this.vel[k + 1]! * dt;
      this.pos[k + 2] = this.pos[k + 2]! + this.vel[k + 2]! * dt;
      out[k] = this.pos[k]! - origin.x;
      out[k + 1] = this.pos[k + 1]! - origin.y;
      out[k + 2] = this.pos[k + 2]! - origin.z;
      size[i] = this.sizes[i * 2]! + (this.sizes[i * 2 + 1]! - this.sizes[i * 2]!) * Math.sqrt(t);
      color[i * 4] = this.colors[i * 4]!;
      color[i * 4 + 1] = this.colors[i * 4 + 1]!;
      color[i * 4 + 2] = this.colors[i * 4 + 2]!;
      // Quick fade-in, long fade-out.
      color[i * 4 + 3] = this.colors[i * 4 + 3]! * Math.min(1, t * 12) * (1 - t) * (1 - t);
    }
    this.positionAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  clear(): void {
    this.age.fill(1);
    this.life.fill(1);
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
