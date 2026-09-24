import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  CanvasTexture,
  Color,
  DirectionalLight,
  HemisphereLight,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { R_EARTH } from '../sim/constants';
import { earthAngle, geoToDirection, localFrame, rotateWithEarth } from '../sim/frames';
import { addScaled, length, normalize, scale, ZERO, type Vec3 } from '../sim/math/vec3';
import type { LaunchSite } from '../sim/simulation';
import type { VehicleConfig } from '../sim/vehicle/config';
import { CameraRig, type CameraMode } from './camera-rig';
import { DebrisView } from './debris-view';
import { EarthView } from './earth-view';
import { ExhaustEffects } from './exhaust-effects';
import type { RenderFrame } from './frame';
import { LaunchPad } from './launch-pad';
import { MapView } from './map-view';
import { ParticleSystem } from './particles';
import { RocketMaterials } from './rocket-model';
import { Starfield } from './stars';
import { VehicleView } from './vehicle-view';

export interface SceneRendererOptions {
  readonly canvasHost: HTMLElement;
  readonly labelLayer: HTMLElement;
  readonly vehicle: VehicleConfig;
  readonly site: LaunchSite;
  readonly maxPixelRatio?: number;
}

const MAX_PIXEL_RATIO = 1.75;

function sunTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.08, 'rgba(255,250,235,1)');
  g.addColorStop(0.2, 'rgba(255,225,170,0.35)');
  g.addColorStop(1, 'rgba(255,200,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

/**
 * Owns the WebGL renderer and the scene graph. Stateless with respect to the simulation:
 * every frame it receives an interpolated RenderFrame and positions everything relative
 * to a floating origin (the vehicle, or Earth's centre in map view).
 */
export class SceneRenderer {
  readonly renderer: WebGLRenderer;
  readonly rig: CameraRig;
  private readonly scene = new Scene();
  private readonly materials = new RocketMaterials();
  private readonly earth: EarthView;
  private readonly pad = new LaunchPad();
  private readonly stars = new Starfield();
  private readonly particles = new ParticleSystem(2600);
  private readonly effects = new ExhaustEffects(this.particles);
  private readonly mapView: MapView;
  private readonly sunLight = new DirectionalLight(0xfff4e5, 3.6);
  private readonly skyLight = new HemisphereLight(0xbcd6ff, 0x5a5040, 1.4);
  private readonly sun: Sprite;
  private readonly sunDir: Vector3;
  private vehicleView: VehicleView;
  private debrisView: DebrisView;
  private width = 1;
  private height = 1;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private readonly options: SceneRendererOptions) {
    this.renderer = new WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, options.maxPixelRatio ?? MAX_PIXEL_RATIO));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.domElement.className = 'scene-canvas';
    this.renderer.domElement.setAttribute('aria-label', '3D view of the launch');
    options.canvasHost.append(this.renderer.domElement);
    this.scene.background = new Color(0x000000);

    this.rig = new CameraRig(this.renderer.domElement);
    this.earth = new EarthView(options.site);
    this.earth.padAnchor.add(this.pad.group);
    this.mapView = new MapView(options.labelLayer);
    this.vehicleView = new VehicleView(options.vehicle, this.materials);
    this.debrisView = new DebrisView(options.vehicle, this.materials);

    // Morning sun from the east-south-east of the pad, ~35 degrees high.
    const padDir = geoToDirection(options.site.latitude, options.site.longitude);
    const { up, east, north } = localFrame(padDir);
    const sun = normalize(addScaled(addScaled(scale(up, 0.6), east, 0.72), north, -0.34));
    this.sunDir = new Vector3(sun.x, sun.y, sun.z);
    this.sun = new Sprite(new SpriteMaterial({ map: sunTexture(), blending: AdditiveBlending, depthWrite: false, sizeAttenuation: false }));
    this.sun.scale.setScalar(0.35);
    this.sun.renderOrder = -1;

    this.scene.add(
      this.stars.points,
      this.sun,
      this.earth.group,
      this.earth.atmosphere,
      this.vehicleView.group,
      this.debrisView.group,
      this.particles.points,
      this.mapView.group,
      this.sunLight,
      this.sunLight.target,
      this.skyLight,
    );
  }

  get cameraMode(): CameraMode {
    return this.rig.mode;
  }

  /** Fire and smoke at an impact point. */
  explode(position: Vec3): void {
    this.effects.explosion(position);
  }

  cycleCamera(): CameraMode {
    return this.rig.cycleMode();
  }

  toggleMap(vehiclePosition: Vec3, orbitNormal: Vec3): boolean {
    const on = this.rig.toggleMap(vehiclePosition, orbitNormal);
    this.mapView.setVisible(on);
    return on;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.options.maxPixelRatio ?? MAX_PIXEL_RATIO));
    this.renderer.setSize(width, height, false);
    this.rig.resize(width, height);
  }

  /** Rebuild per-flight objects (vehicle, debris, smoke) for a fresh simulation. */
  reset(): void {
    this.scene.remove(this.vehicleView.group, this.debrisView.group);
    this.vehicleView.dispose();
    this.debrisView.dispose();
    this.vehicleView = new VehicleView(this.options.vehicle, this.materials);
    this.debrisView = new DebrisView(this.options.vehicle, this.materials);
    this.scene.add(this.vehicleView.group, this.debrisView.group);
    this.particles.clear();
  }

  render(frame: RenderFrame): void {
    const map = this.rig.mapView;
    const origin = map ? ZERO : frame.vehicle.r;
    const padPosition = scale(rotateWithEarth(geoToDirection(this.options.site.latitude, this.options.site.longitude), earthAngle(frame.time)), R_EARTH);

    this.vehicleView.update(frame, origin, frame.time);
    this.vehicleView.group.visible = !map && !frame.crashed;
    this.debrisView.update(frame.debris, origin);
    this.debrisView.group.visible = !map;
    this.effects.update(frame, this.vehicleView.nozzlePosition(frame), padPosition);
    this.particles.update(frame.simDelta, origin);
    this.particles.points.visible = !map;

    this.rig.update(
      {
        frame,
        origin,
        padPosition,
        topAboveCom: this.vehicleView.topAboveCom(frame),
        upperStageBaseAboveCom: this.vehicleView.upperStageBaseAboveCom(frame),
        vehicleRadius: this.options.vehicle.stages[0]!.diameter / 2,
        reducedMotion: this.reducedMotion.matches,
      },
      frame.realDelta,
    );
    const camera = this.rig.camera;
    const cameraWorld = { x: camera.position.x + origin.x, y: camera.position.y + origin.y, z: camera.position.z + origin.z };
    const cameraAltitude = length(cameraWorld) - R_EARTH;

    this.earth.update(origin, frame.earthAngle, this.sunDir, cameraAltitude, frame.time);
    this.stars.points.position.copy(camera.position);
    this.sun.position.copy(camera.position).addScaledVector(this.sunDir, 1e9);
    this.sunLight.position.copy(this.sunDir).multiplyScalar(1000);
    this.sunLight.target.position.set(0, 0, 0);
    // Less bounce light from the sky and ground once we are above the atmosphere.
    this.skyLight.intensity = 0.35 + 1.05 * Math.exp(-Math.max(0, cameraAltitude) / 30_000);
    this.particles.pixelScale = this.height * this.renderer.getPixelRatio() / (2 * Math.tan((camera.fov * Math.PI) / 360));

    this.mapView.update(frame.orbit, frame.trail, frame.vehicle.r, origin, camera, this.width, this.height);
    this.renderer.render(this.scene, camera);
  }

  dispose(): void {
    this.rig.dispose();
    this.vehicleView.dispose();
    this.debrisView.dispose();
    this.materials.dispose();
    this.earth.dispose();
    this.pad.dispose();
    this.stars.dispose();
    this.particles.dispose();
    this.mapView.dispose();
    this.sun.material.map?.dispose();
    this.sun.material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
