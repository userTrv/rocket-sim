import { Group, type Mesh } from 'three';
import type { VehicleConfig } from '../sim/vehicle/config';
import type { RenderFrame } from './frame';
import { buildFairingHalf, buildFirstStage, type RocketMaterials } from './rocket-model';
import { placeRelative, toQuaternion } from './space';
import type { Vec3 } from '../sim/math/vec3';

/** Meshes for jettisoned stages and fairing halves, created on demand. */
export class DebrisView {
  readonly group = new Group();
  private readonly meshes = new Map<number, Group>();

  constructor(
    private readonly config: VehicleConfig,
    private readonly materials: RocketMaterials,
  ) {}

  update(debris: RenderFrame['debris'], origin: Vec3): void {
    const seen = new Set<number>();
    for (const d of debris) {
      if (!d.alive) continue;
      seen.add(d.id);
      let holder = this.meshes.get(d.id);
      if (!holder) {
        holder = this.create(d.kind, d.variant);
        this.meshes.set(d.id, holder);
        this.group.add(holder);
      }
      placeRelative(holder, d.r, origin);
      toQuaternion(d.q, holder.quaternion);
    }
    for (const [id, holder] of this.meshes) {
      if (seen.has(id)) continue;
      this.group.remove(holder);
      holder.traverse((o) => (o as Mesh).geometry?.dispose());
      this.meshes.delete(id);
    }
  }

  /** Debris positions refer to the body's centroid, so shift the mesh down by half its length. */
  private create(kind: 'stage' | 'fairing', variant: number): Group {
    const holder = new Group();
    if (kind === 'stage') {
      const stage = buildFirstStage(this.config, this.materials);
      stage.position.y = -this.config.stages[variant]!.length / 2;
      holder.add(stage);
    } else {
      const half = buildFairingHalf(this.config, this.materials, variant);
      half.position.y = -this.config.fairing.length / 2;
      holder.add(half);
    }
    return holder;
  }

  clear(): void {
    this.update([], { x: 0, y: 0, z: 0 });
  }

  dispose(): void {
    this.clear();
  }
}
