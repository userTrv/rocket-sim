import { Quaternion, Vector3, type Object3D } from 'three';
import type { Quat } from '../sim/math/quat';
import type { Vec3 } from '../sim/math/vec3';

/**
 * Floating origin: the simulation works in double-precision metres around Earth's centre;
 * the GPU only ever sees positions relative to a moving origin (usually the vehicle), so
 * float32 precision is spent where the camera is and nothing jitters at orbital distances.
 */
export function placeRelative(obj: Object3D, world: Vec3, origin: Vec3): void {
  obj.position.set(world.x - origin.x, world.y - origin.y, world.z - origin.z);
}

export const toVector3 = (v: Vec3, out = new Vector3()): Vector3 => out.set(v.x, v.y, v.z);

export const relativeVector = (world: Vec3, origin: Vec3, out = new Vector3()): Vector3 =>
  out.set(world.x - origin.x, world.y - origin.y, world.z - origin.z);

export const toQuaternion = (q: Quat, out = new Quaternion()): Quaternion => out.set(q.x, q.y, q.z, q.w);

/** Recursively free GPU resources owned by an object tree. */
export function disposeObject(root: Object3D): void {
  root.traverse((node) => {
    const mesh = node as Partial<{ geometry: { dispose(): void }; material: { dispose(): void } | { dispose(): void }[] }>;
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
    else mesh.material?.dispose();
  });
}
