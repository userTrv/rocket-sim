import {
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Vector2,
  type BufferGeometry,
  type Material,
} from 'three';
import type { VehicleConfig } from '../sim/vehicle/config';

/**
 * Low-poly Falcon 9-like launcher built from primitives. Every part is created in the
 * stage's own frame (y = 0 at the stage base, +y towards the nose) so a stage can be
 * reused as falling debris.
 */
export class RocketMaterials {
  readonly white = new MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.55, metalness: 0.05 });
  readonly fairingWhite = new MeshStandardMaterial({ color: 0xf4f5f6, roughness: 0.5, metalness: 0.05, side: DoubleSide });
  readonly soot = new MeshStandardMaterial({ color: 0xb9b4ad, roughness: 0.8 });
  readonly black = new MeshStandardMaterial({ color: 0x17181a, roughness: 0.6, metalness: 0.2 });
  readonly metal = new MeshStandardMaterial({ color: 0x7c8087, roughness: 0.4, metalness: 0.5 });
  readonly nozzle = new MeshStandardMaterial({ color: 0x5a4a40, roughness: 0.45, metalness: 0.5, side: DoubleSide });
  readonly niobium = new MeshStandardMaterial({ color: 0x3d4048, roughness: 0.3, metalness: 0.6, side: DoubleSide });
  readonly gold = new MeshStandardMaterial({ color: 0xe8b85a, roughness: 0.4, metalness: 0.3 });

  dispose(): void {
    for (const m of Object.values(this) as Material[]) m.dispose();
  }
}

const mesh = (geometry: BufferGeometry, material: Material, y = 0): Mesh => {
  const m = new Mesh(geometry, material);
  m.position.y = y;
  m.castShadow = false;
  return m;
};

/** Bell-shaped nozzle opening downwards: throat at y = height, exit at y = 0. */
function bell(exitRadius: number, height: number, segments = 20): LatheGeometry {
  const pts: Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new Vector2(exitRadius * (0.3 + 0.7 * Math.pow(1 - t, 1.8)), t * height));
  }
  return new LatheGeometry(pts, segments);
}

export function buildFirstStage(config: VehicleConfig, mats: RocketMaterials): Group {
  const stage = config.stages[0]!;
  const r = stage.diameter / 2;
  const L = stage.length;
  const interstage = 6.7;
  const g = new Group();
  g.name = 'stage-1';

  // Octaweb: one centre engine and eight around it.
  const engineGeo = bell(stage.engine.nozzleExitRadius, 1.6, 14);
  const positions: [number, number][] = [[0, 0]];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    positions.push([Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66]);
  }
  for (const [x, z] of positions) {
    const e = mesh(engineGeo, mats.nozzle);
    e.position.set(x, 0, z);
    g.add(e);
  }
  g.add(mesh(new CylinderGeometry(r * 0.98, r * 0.98, 0.9, 32), mats.metal, 2.0));
  // Tank with a sooty lower section.
  const sootHeight = 9;
  g.add(mesh(new CylinderGeometry(r, r, sootHeight, 40), mats.soot, 2.45 + sootHeight / 2));
  const tank = L - interstage - 2.45 - sootHeight;
  g.add(mesh(new CylinderGeometry(r, r, tank, 40), mats.white, 2.45 + sootHeight + tank / 2));
  g.add(mesh(new CylinderGeometry(r * 1.002, r * 1.002, interstage, 40), mats.black, L - interstage / 2));

  // Folded landing legs.
  const legGeo = new BoxGeometry(0.55, 10, 0.35);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = mesh(legGeo, mats.black, 7.5);
    leg.position.x = Math.cos(a) * (r + 0.12);
    leg.position.z = Math.sin(a) * (r + 0.12);
    leg.rotation.y = -a;
    g.add(leg);
  }
  // Grid fins, stowed flat against the interstage.
  const finGeo = new BoxGeometry(1.25, 1.5, 0.12);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const fin = mesh(finGeo, mats.metal, L - 1.4);
    fin.position.x = Math.cos(a) * (r + 0.25);
    fin.position.z = Math.sin(a) * (r + 0.25);
    fin.rotation.y = -a + Math.PI / 2;
    g.add(fin);
  }
  return g;
}

/** Vertical offset of the upper-stage nozzle exit below the upper stage base, m. */
export const UPPER_NOZZLE_DROP = 3.2;

export function buildSecondStage(config: VehicleConfig, mats: RocketMaterials): Group {
  const stage = config.stages[1]!;
  const r = stage.diameter / 2;
  const g = new Group();
  g.name = 'stage-2';
  const nozzle = mesh(bell(stage.engine.nozzleExitRadius, UPPER_NOZZLE_DROP, 28), mats.niobium, -UPPER_NOZZLE_DROP);
  g.add(nozzle);
  g.add(mesh(new CylinderGeometry(0.5, 0.9, 0.8, 16), mats.metal, 0.1));
  g.add(mesh(new CylinderGeometry(r, r, stage.length, 40), mats.white, stage.length / 2));
  g.add(mesh(new CylinderGeometry(r * 1.004, r * 1.004, 0.5, 40), mats.black, stage.length - 0.25));
  return g;
}

function fairingProfile(radius: number, length: number): Vector2[] {
  const cyl = length * 0.5;
  const pts: Vector2[] = [new Vector2(radius * 0.72, 0), new Vector2(radius, 1.2), new Vector2(radius, cyl)];
  const ogive = length - cyl;
  for (let i = 1; i <= 12; i++) {
    const t = i / 12;
    pts.push(new Vector2(radius * Math.sqrt(Math.max(0, 1 - t * t)) * (1 - 0.06 * t), cyl + t * ogive));
  }
  return pts;
}

/** One fairing half (side = -1 or +1), base at y = 0. */
export function buildFairingHalf(config: VehicleConfig, mats: RocketMaterials, side: number): Group {
  const f = config.fairing;
  const g = new Group();
  // Lathe phi = 0..pi spans the +X half (x = r sin phi).
  const geo = new LatheGeometry(fairingProfile(f.diameter / 2, f.length), 24, side > 0 ? 0 : Math.PI, Math.PI);
  g.add(mesh(geo, mats.fairingWhite));
  return g;
}

export function buildPayload(config: VehicleConfig, mats: RocketMaterials): Group {
  const f = config.fairing;
  const g = new Group();
  g.add(mesh(new CylinderGeometry(1.2, 1.7, 1.2, 24), mats.black, 0.6));
  const body = mesh(new BoxGeometry(2.6, f.length * 0.45, 2.6), mats.gold, 1.2 + f.length * 0.225);
  g.add(body);
  return g;
}

export interface RocketModel {
  /** Root with y = 0 at the bottom of the first stage. */
  readonly root: Group;
  readonly stages: readonly Group[];
  /** Base height of each stage above the root. */
  readonly stageBase: readonly number[];
  readonly fairing: readonly Group[];
  readonly payload: Group;
  /** Nozzle exit height of each stage above the root. */
  readonly nozzleExit: readonly number[];
}

export function buildRocket(config: VehicleConfig, mats: RocketMaterials): RocketModel {
  const root = new Group();
  root.name = 'rocket';
  const s1 = buildFirstStage(config, mats);
  const s2 = buildSecondStage(config, mats);
  const l1 = config.stages[0]!.length;
  const l2 = config.stages[1]!.length;
  s2.position.y = l1;
  const fairing = [-1, 1].map((side) => {
    const half = buildFairingHalf(config, mats, side);
    half.position.y = l1 + l2;
    return half;
  });
  const payload = buildPayload(config, mats);
  payload.position.y = l1 + l2;
  root.add(s1, s2, payload, ...fairing);
  return {
    root,
    stages: [s1, s2],
    stageBase: [0, l1],
    fairing,
    payload,
    nozzleExit: [0, l1 - UPPER_NOZZLE_DROP],
  };
}
