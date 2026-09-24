import { PerspectiveCamera, Vector3 } from 'three';
import { NOSE } from '../sim/attitude';
import { R_EARTH } from '../sim/constants';
import { localFrame, surfaceVelocityAt } from '../sim/frames';
import { addScaled, cross, length, normalize, reject, scale, sub, vec3, type Vec3 } from '../sim/math/vec3';
import { rotate } from '../sim/math/quat';
import type { RenderFrame } from './frame';
import { relativeVector } from './space';

export type CameraMode = 'chase' | 'orbit' | 'pad' | 'onboard';
export const CAMERA_MODES: readonly CameraMode[] = ['chase', 'orbit', 'pad', 'onboard'];

export const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: 'Chase',
  orbit: 'Orbit (drag / zoom)',
  pad: 'Pad tracking',
  onboard: 'Onboard',
};

interface Spherical {
  azimuth: number;
  elevation: number;
  distance: number;
}

export interface CameraContext {
  readonly frame: RenderFrame;
  /** Floating origin currently in use. */
  readonly origin: Vec3;
  readonly padPosition: Vec3;
  readonly topAboveCom: number;
  readonly upperStageBaseAboveCom: number;
  readonly vehicleRadius: number;
  readonly reducedMotion: boolean;
}

const CHASE_DISTANCE = 170;
const MAP_MIN = R_EARTH * 1.3;
const MAP_MAX = R_EARTH * 40;

/**
 * Camera modes and pointer controls. All positions are computed in render space
 * (relative to the floating origin), with the local horizon kept level.
 */
export class CameraRig {
  readonly camera = new PerspectiveCamera(55, 1, 0.3, 5e10);
  mode: CameraMode = 'chase';
  mapView = false;
  private readonly orbit: Spherical = { azimuth: -2.1, elevation: 0.12, distance: 140 };
  private readonly map: Spherical = { azimuth: 0, elevation: 0.4, distance: R_EARTH * 3.4 };
  private chaseZoom = 1;
  private chaseDir: Vec3 | null = null;
  private shakeTime = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private readonly abort = new AbortController();

  constructor(private readonly element: HTMLElement) {
    const opts = { signal: this.abort.signal };
    element.addEventListener('pointerdown', (e) => this.onPointerDown(e), opts);
    element.addEventListener('pointermove', (e) => this.onPointerMove(e), opts);
    element.addEventListener('pointerup', (e) => this.onPointerUp(e), opts);
    element.addEventListener('pointercancel', (e) => this.onPointerUp(e), opts);
    element.addEventListener('wheel', (e) => this.onWheel(e), { ...opts, passive: false });
  }

  cycleMode(): CameraMode {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length]!;
    this.chaseDir = null;
    return this.mode;
  }

  /** Enter or leave map view; entering frames the vehicle's side of the planet. */
  toggleMap(vehiclePosition: Vec3, orbitNormal: Vec3): boolean {
    this.mapView = !this.mapView;
    if (this.mapView) {
      // Look from above the orbital plane, tilted towards the vehicle, so the orbit reads as an ellipse.
      const dir = normalize(addScaled(scale(normalize(vehiclePosition), 0.75), normalize(orbitNormal), 0.65));
      this.map.azimuth = Math.atan2(dir.x, dir.z);
      this.map.elevation = Math.asin(Math.max(-1, Math.min(1, dir.y))) * 0.8;
      this.map.distance = R_EARTH * 3.4;
    }
    return this.mapView;
  }

  update(ctx: CameraContext, dt: number): void {
    const cam = this.camera;
    if (this.mapView) {
      cam.near = 2_000;
      cam.fov = 45;
      const m = this.map;
      cam.position.set(
        m.distance * Math.cos(m.elevation) * Math.sin(m.azimuth),
        m.distance * Math.sin(m.elevation),
        m.distance * Math.cos(m.elevation) * Math.cos(m.azimuth),
      );
      cam.up.set(0, 1, 0);
      cam.lookAt(-ctx.origin.x, -ctx.origin.y, -ctx.origin.z);
      cam.updateProjectionMatrix();
      return;
    }
    const { frame } = ctx;
    const { up, east, north } = localFrame(frame.vehicle.r);
    const nose = rotate(frame.vehicle.q, NOSE);
    cam.near = 0.3;
    cam.fov = 55;
    let target = scale(nose, ctx.topAboveCom * 0.25);
    let camUp = up;

    switch (this.mode) {
      case 'chase': {
        const surfaceVel = sub(frame.vehicle.v, surfaceVelocityAt(frame.vehicle.r));
        const horizontal = reject(surfaceVel, up);
        const downrange = length(horizontal) > 25 ? normalize(horizontal) : east;
        const side = cross(downrange, up); // to the right of the flight path (south for eastward launches)
        const desired = normalize(addScaled(addScaled(scale(downrange, -0.55), side, 0.85), up, 0.1));
        this.chaseDir = this.chaseDir ? normalize(addScaled(this.chaseDir, sub(desired, this.chaseDir), Math.min(1, dt * 1.5))) : desired;
        const dist = CHASE_DISTANCE * this.chaseZoom * (frame.vehicle.stageIndex > 0 ? 0.55 : 1);
        this.setPosition(scale(this.chaseDir, dist));
        break;
      }
      case 'orbit': {
        const o = this.orbit;
        const offset = addScaled(
          scale(addScaled(scale(east, Math.cos(o.azimuth)), north, Math.sin(o.azimuth)), o.distance * Math.cos(o.elevation)),
          up,
          o.distance * Math.sin(o.elevation),
        );
        this.setPosition(offset);
        target = vec3(0, 0, 0);
        break;
      }
      case 'pad': {
        const pad = localFrame(ctx.padPosition);
        const station = addScaled(addScaled(addScaled(ctx.padPosition, pad.east, -380), pad.north, -520), pad.up, 6);
        const rel = relativeVector(station, ctx.origin);
        cam.position.copy(rel);
        const dist = rel.length();
        // Long-lens tracking camera: zoom so the vehicle stays a similar size.
        cam.fov = Math.min(50, Math.max(0.25, (2 * Math.atan((ctx.topAboveCom * 1.6) / dist) * 180) / Math.PI));
        camUp = pad.up;
        break;
      }
      case 'onboard': {
        const right = rotate(frame.vehicle.q, vec3(1, 0, 0));
        // On the first stage look down the tank at the engines; later look down the upper stage.
        const along = frame.vehicle.stageIndex === 0 ? ctx.upperStageBaseAboveCom - 9 : ctx.upperStageBaseAboveCom + 11;
        this.setPosition(addScaled(scale(nose, along), right, ctx.vehicleRadius + 0.9));
        target = addScaled(scale(nose, along - 40), right, ctx.vehicleRadius + 0.2);
        camUp = right;
        cam.fov = 70;
        break;
      }
    }

    this.applyShake(ctx, dt);
    cam.up.set(camUp.x, camUp.y, camUp.z);
    cam.lookAt(target.x, target.y, target.z);
    cam.updateProjectionMatrix();
  }

  private setPosition(p: Vec3): void {
    this.camera.position.set(p.x, p.y, p.z);
  }

  /** Buffeting near max-Q and rumble at liftoff; strongly reduced for prefers-reduced-motion. */
  private applyShake(ctx: CameraContext, dt: number): void {
    const { frame } = ctx;
    if (frame.onPad && !frame.engine.running) return;
    this.shakeTime += dt;
    const q = Math.min(1.2, frame.dynamicPressure / 30_000);
    const rumble = frame.engine.running ? Math.max(0, 1 - frame.altitude / 1500) * frame.engine.throttle : 0;
    let amplitude = 0.35 * q * q + 0.25 * rumble;
    if (this.mode === 'pad') amplitude *= 0.3;
    if (ctx.reducedMotion) amplitude *= 0.1;
    if (amplitude < 1e-3) return;
    const t = this.shakeTime;
    const n = (f: number, p: number) => Math.sin(t * f + p) * 0.6 + Math.sin(t * f * 2.3 + p * 1.7) * 0.4;
    const offset = new Vector3(n(31, 0), n(27, 1.3), n(35, 2.1)).multiplyScalar(amplitude);
    this.camera.position.add(offset);
  }

  private onPointerDown(e: PointerEvent): void {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.element.setPointerCapture?.(e.pointerId);
    if (this.pointers.size === 2) this.pinchDistance = this.currentPinch();
  }

  private onPointerMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const d = this.currentPinch();
      if (this.pinchDistance > 0) this.zoom(this.pinchDistance / d);
      this.pinchDistance = d;
      return;
    }
    if (!this.mapView && this.mode !== 'orbit') {
      if (Math.abs(dx) + Math.abs(dy) < 3) return;
      this.mode = 'orbit'; // dragging any follow camera turns it into the free orbit camera
    }
    const s = this.mapView ? this.map : this.orbit;
    s.azimuth -= dx * 0.006;
    s.elevation = Math.max(-1.45, Math.min(1.45, s.elevation + dy * 0.006));
  }

  private onPointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    this.pinchDistance = 0;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.zoom(Math.exp(e.deltaY * 0.0012));
  }

  private currentPinch(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private zoom(factor: number): void {
    if (this.mapView) {
      this.map.distance = Math.max(MAP_MIN, Math.min(MAP_MAX, this.map.distance * factor));
    } else if (this.mode === 'orbit') {
      this.orbit.distance = Math.max(15, Math.min(60_000, this.orbit.distance * factor));
    } else if (this.mode === 'chase') {
      this.chaseZoom = Math.max(0.2, Math.min(20, this.chaseZoom * factor));
    }
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.abort.abort();
  }
}
