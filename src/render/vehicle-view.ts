import { Group, type Mesh } from 'three';
import { NOSE } from '../sim/attitude';
import { addScaled, type Vec3 } from '../sim/math/vec3';
import { rotate } from '../sim/math/quat';
import type { VehicleConfig } from '../sim/vehicle/config';
import type { RenderFrame } from './frame';
import { Plume, type PlumeStyle } from './plume';
import { buildRocket, type RocketMaterials, type RocketModel } from './rocket-model';
import { placeRelative, toQuaternion } from './space';

const PLUME_STYLES: readonly PlumeStyle[] = [
  { exitRadius: 1.8, seaLevelLength: 55, vacuumLength: 150, vacuumSpread: 14 },
  { exitRadius: 1.5, seaLevelLength: 20, vacuumLength: 90, vacuumSpread: 10 },
];

/**
 * The flying vehicle: model, visibility per stage and the exhaust plume.
 * The group origin is the vehicle's centre of mass (the simulated point).
 */
export class VehicleView {
  readonly group = new Group();
  private readonly model: RocketModel;
  private readonly plume = new Plume();

  constructor(private readonly config: VehicleConfig, materials: RocketMaterials) {
    this.model = buildRocket(config, materials);
    this.group.add(this.model.root);
    this.model.root.add(this.plume.group);
  }

  /** Height of the stack base above the CoM is -(stageBase + comHeight) in model units. */
  private baseOffset(frame: RenderFrame): number {
    return this.model.stageBase[frame.vehicle.stageIndex]! + frame.vehicle.comHeight;
  }

  update(frame: RenderFrame, origin: Vec3, time: number): void {
    const v = frame.vehicle;
    placeRelative(this.group, v.r, origin);
    toQuaternion(v.q, this.group.quaternion);
    this.model.root.position.y = -this.baseOffset(frame);
    this.model.stages.forEach((s, i) => (s.visible = i >= v.stageIndex));
    this.model.fairing.forEach((f) => (f.visible = v.fairingAttached));
    this.plume.group.position.y = this.model.nozzleExit[v.stageIndex]!;
    const throttle = frame.engine.running ? frame.engine.throttle : 0;
    this.plume.update(PLUME_STYLES[v.stageIndex] ?? PLUME_STYLES[0]!, throttle, frame.engine.ambientPressure, time);
  }

  /** Inertial position of the active nozzle exit. */
  nozzlePosition(frame: RenderFrame): Vec3 {
    const nose = rotate(frame.vehicle.q, NOSE);
    const exit = this.model.nozzleExit[frame.vehicle.stageIndex]! - this.baseOffset(frame);
    return addScaled(frame.vehicle.r, nose, exit);
  }

  /** Height of the stack top above the CoM, m. */
  topAboveCom(frame: RenderFrame): number {
    const total = this.config.stages.reduce((h, s) => h + s.length, 0) + this.config.fairing.length;
    return total - this.baseOffset(frame);
  }

  /** Height of the upper-stage base above the CoM, m (for the onboard camera). */
  upperStageBaseAboveCom(frame: RenderFrame): number {
    return this.model.stageBase[1]! - this.baseOffset(frame);
  }

  dispose(): void {
    this.plume.dispose();
    this.group.traverse((o) => (o as Mesh).geometry?.dispose());
  }
}
