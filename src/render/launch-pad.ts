import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { disposeObject } from './space';

/**
 * Launch complex in the pad's local frame: +X east, +Y up, +Z south, origin at the
 * vehicle's hold-down point. Concrete apron, lattice service tower with crew arm,
 * lightning masts, water tower and a hangar.
 */
export class LaunchPad {
  readonly group = new Group();

  constructor() {
    const concrete = new MeshStandardMaterial({ color: 0x9c9a94, roughness: 0.95 });
    const darkConcrete = new MeshStandardMaterial({ color: 0x4a4946, roughness: 1 });
    const steel = new MeshStandardMaterial({ color: 0x6d6f73, roughness: 0.6, metalness: 0.6 });
    const red = new MeshStandardMaterial({ color: 0x8a2c22, roughness: 0.7, metalness: 0.3 });
    const white = new MeshStandardMaterial({ color: 0xdedcd6, roughness: 0.8 });

    const apron = new Mesh(new BoxGeometry(140, 3, 140), concrete);
    apron.position.y = -1.5;
    // Flame trench exits to the east (downrange); smoke billows out of it at liftoff.
    const trench = new Mesh(new BoxGeometry(60, 0.2, 12), darkConcrete);
    trench.position.set(34, 0.01, 0);
    const mount = new Mesh(new CylinderGeometry(6, 7, 1.2, 8), darkConcrete);
    mount.position.y = -0.5;
    this.group.add(apron, trench, mount);

    this.group.add(buildLatticeTower(steel, red));

    // Lightning masts.
    const mastSteel = new MeshStandardMaterial({ color: 0xa9adb3, roughness: 0.5, metalness: 0.6 });
    for (const [x, z] of [[-45, -60], [50, -55], [0, -95]] as const) {
      const mast = new Mesh(new CylinderGeometry(0.25, 0.7, 110, 8), mastSteel);
      mast.position.set(x, 55, z);
      this.group.add(mast);
    }
    // Water tower.
    const tank = new Mesh(new CylinderGeometry(7, 7, 12, 20), white);
    tank.position.set(-260, 58, 180);
    const legs = new Mesh(new CylinderGeometry(1.2, 2, 52, 8), steel);
    legs.position.set(-260, 26, 180);
    // Hangar.
    const hangar = new Mesh(new BoxGeometry(70, 28, 45), white);
    hangar.position.set(-420, 14, -60);
    const roof = new Mesh(new BoxGeometry(72, 2, 47), darkConcrete);
    roof.position.set(-420, 29, -60);
    this.group.add(tank, legs, hangar, roof);
  }

  dispose(): void {
    disposeObject(this.group);
  }
}

function buildLatticeTower(steel: MeshStandardMaterial, accent: MeshStandardMaterial): Group {
  const tower = new Group();
  const cx = 0;
  const cz = -16; // north of the vehicle, out of the chase camera's line of sight
  const w = 9;
  const height = 88;
  const struts: Matrix4[] = [];
  const add = (from: Vector3, to: Vector3, thickness: number) => {
    const dir = to.clone().sub(from);
    const len = dir.length();
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
    const mid = from.clone().add(to).multiplyScalar(0.5);
    struts.push(new Matrix4().compose(mid, q, new Vector3(thickness, len, thickness)));
  };
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => [cx + (x! * w) / 2, cz + (z! * w) / 2] as const);
  for (const [x, z] of corners) add(new Vector3(x, 0, z), new Vector3(x, height, z), 0.9);
  const level = 6;
  for (let y = level; y <= height; y += level) {
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = corners[i]!;
      const [x1, z1] = corners[(i + 1) % 4]!;
      add(new Vector3(x0, y, z0), new Vector3(x1, y, z1), 0.45);
      add(new Vector3(x0, y - level, z0), new Vector3(x1, y, z1), 0.3);
    }
  }
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), steel, struts.length);
  struts.forEach((m, i) => mesh.setMatrixAt(i, m));
  tower.add(mesh);

  // Crew access arm reaching the upper stage, and a hammerhead crane on top.
  const armLength = Math.abs(cz) - w / 2 - 1.9;
  const arm = new Mesh(new BoxGeometry(2.6, 3, armLength), accent);
  arm.position.set(0, 58, -(1.9 + armLength / 2));
  const crane = new Mesh(new BoxGeometry(3, 3, 24), accent);
  crane.position.set(cx, height + 1.5, cz + 4);
  tower.add(arm, crane);
  return tower;
}
