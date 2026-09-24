import { AdditiveBlending, CylinderGeometry, DoubleSide, Group, Mesh, ShaderMaterial, Vector3 } from 'three';
import { SEA_LEVEL_PRESSURE } from '../sim/constants';
import { PLUME_FRAGMENT, PLUME_VERTEX } from './shaders/plume';

export interface PlumeStyle {
  /** Radius of the nozzle (cluster) exit, m. */
  readonly exitRadius: number;
  /** Plume length at sea level and in vacuum at full throttle, m. */
  readonly seaLevelLength: number;
  readonly vacuumLength: number;
  /** How far the plume widens in vacuum, as a multiple of the exit radius. */
  readonly vacuumSpread: number;
}

/** Two nested additive cones: a bright core and a wide, soft envelope. */
export class Plume {
  readonly group = new Group();
  private readonly outer: ShaderMaterial;
  private readonly core: ShaderMaterial;
  private readonly geometry = new CylinderGeometry(1, 1, 1, 32, 12, true).translate(0, -0.5, 0);

  constructor() {
    const make = (core: Vector3, edge: Vector3) =>
      new ShaderMaterial({
        vertexShader: PLUME_VERTEX,
        fragmentShader: PLUME_FRAGMENT,
        uniforms: {
          uStartRadius: { value: 1 },
          uEndRadius: { value: 1 },
          uLength: { value: 1 },
          uShape: { value: 1 },
          uIntensity: { value: 1 },
          uExpansion: { value: 0 },
          uTime: { value: 0 },
          uDiamonds: { value: 0 },
          uCoreColor: { value: core },
          uEdgeColor: { value: edge },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      });
    this.outer = make(new Vector3(1, 0.93, 0.75), new Vector3(1, 0.5, 0.18));
    this.core = make(new Vector3(1, 0.98, 0.9), new Vector3(1, 0.78, 0.45));
    const outerMesh = new Mesh(this.geometry, this.outer);
    const coreMesh = new Mesh(this.geometry, this.core);
    outerMesh.frustumCulled = false;
    coreMesh.frustumCulled = false;
    coreMesh.renderOrder = 2;
    outerMesh.renderOrder = 1;
    this.group.add(outerMesh, coreMesh);
  }

  /**
   * @param throttle 0..1 (0 hides the plume)
   * @param ambientPressure Pa; the plume balloons as the outside pressure drops.
   */
  update(style: PlumeStyle, throttle: number, ambientPressure: number, time: number): void {
    this.group.visible = throttle > 0;
    if (!this.group.visible) return;
    const expansion = Math.min(1, Math.max(0, 1 - ambientPressure / SEA_LEVEL_PRESSURE));
    const e2 = expansion * expansion;
    const length = (style.seaLevelLength + (style.vacuumLength - style.seaLevelLength) * expansion) * (0.55 + 0.45 * throttle);
    const flicker = 1 + 0.03 * Math.sin(time * 41) + 0.02 * Math.sin(time * 67);
    const set = (m: ShaderMaterial, start: number, end: number, len: number, shape: number, intensity: number) => {
      const u = m.uniforms;
      u.uStartRadius!.value = start;
      u.uEndRadius!.value = end;
      u.uLength!.value = len * flicker;
      u.uShape!.value = shape;
      u.uIntensity!.value = intensity;
      u.uExpansion!.value = expansion;
      u.uTime!.value = time;
      u.uDiamonds!.value = 1 - expansion;
    };
    const r = style.exitRadius;
    set(this.outer, r * 1.05, r * (1.6 + style.vacuumSpread * e2), length, 0.7 - 0.35 * expansion, 1.1 * throttle);
    set(this.core, r * 0.9, r * (0.5 + 0.8 * e2), length * 0.55, 1.2, 1.6 * throttle);
  }

  dispose(): void {
    this.geometry.dispose();
    this.outer.dispose();
    this.core.dispose();
  }
}
