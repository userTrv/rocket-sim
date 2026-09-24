import type { Quat } from '../sim/math/quat';
import type { Vec3 } from '../sim/math/vec3';
import type { OrbitalElements } from '../sim/orbit';

/** Everything the renderer needs for one frame, already interpolated between sim steps. */
export interface RenderFrame {
  /** Simulation time, s. */
  readonly time: number;
  /** Wall-clock seconds since the previous frame (0 while paused). */
  readonly realDelta: number;
  /** Simulated seconds advanced since the previous frame. */
  readonly simDelta: number;
  readonly earthAngle: number;
  readonly vehicle: {
    readonly r: Vec3;
    readonly v: Vec3;
    readonly q: Quat;
    readonly comHeight: number;
    readonly stageIndex: number;
    readonly fairingAttached: boolean;
  };
  readonly engine: {
    readonly running: boolean;
    readonly throttle: number;
    readonly ambientPressure: number;
  };
  readonly debris: readonly {
    readonly id: number;
    readonly kind: 'stage' | 'fairing';
    readonly variant: number;
    readonly r: Vec3;
    readonly q: Quat;
    readonly alive: boolean;
  }[];
  readonly altitude: number;
  readonly dynamicPressure: number;
  readonly orbit: OrbitalElements;
  /** Recent inertial positions for the map-view trajectory. */
  readonly trail: readonly Vec3[];
  readonly onPad: boolean;
  readonly crashed: boolean;
}
