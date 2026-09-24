import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { R_EARTH } from '../sim/constants';
import { geoToDirection, localFrame } from '../sim/frames';
import type { LaunchSite } from '../sim/simulation';
import type { Vec3 } from '../sim/math/vec3';
import { fromBasis } from '../sim/math/quat';
import { ATMOSPHERE_FRAGMENT, ATMOSPHERE_VERTEX } from './shaders/atmosphere';
import { CLOUD_FRAGMENT, EARTH_FRAGMENT, EARTH_VERTEX } from './shaders/earth';
import { disposeObject, toQuaternion } from './space';

const CLOUD_ALTITUDE = 3_000;
const ATMOSPHERE_TOP = 100_000;
const PATCH_RADIUS = 200_000;
/** The ground right around the pad is lowered slightly so the concrete pad never z-fights. */
const PAD_CLEARING_RADIUS = 160;
const PAD_CLEARING_DEPTH = 1.5;

/**
 * Procedural Earth: a globe for the big picture plus a finely tessellated patch of true
 * sphere around the launch site (the globe's flat facets would otherwise sit up to ~100 m
 * below the real surface). Both use local vertex coordinates so float32 is enough.
 */
export class EarthView {
  /** Positioned at Earth's centre (relative to the floating origin) and spun with the Earth. */
  readonly group = new Group();
  /** Local east/up/south frame at the pad, child of the spinning Earth. */
  readonly padAnchor = new Group();
  readonly atmosphere: Mesh;
  private readonly surfaceMaterial: ShaderMaterial;
  private readonly patchMaterial: ShaderMaterial;
  private readonly cloudMaterial: ShaderMaterial;
  private readonly atmosphereMaterial: ShaderMaterial;
  private readonly sharedUniforms = {
    uSunDir: { value: new Vector3(1, 0, 0) },
    uCameraAltitude: { value: 0 },
    uTime: { value: 0 },
  };

  constructor(site: LaunchSite) {
    const padDir = geoToDirection(site.latitude, site.longitude);
    const padDirV = new Vector3(padDir.x, padDir.y, padDir.z);
    const makeSurface = (origin: Vector3, fragment = EARTH_FRAGMENT) =>
      new ShaderMaterial({
        vertexShader: EARTH_VERTEX,
        fragmentShader: fragment,
        uniforms: {
          ...this.sharedUniforms,
          uPatchOrigin: { value: origin },
          uPadDir: { value: padDirV },
        },
      });

    this.surfaceMaterial = makeSurface(new Vector3());
    const globe = new Mesh(new SphereGeometry(R_EARTH, 512, 256), this.surfaceMaterial);
    globe.name = 'globe';

    const padPoint = padDirV.clone().multiplyScalar(R_EARTH);
    this.patchMaterial = makeSurface(padPoint);
    const patch = new Mesh(buildGroundPatch(padDir), this.patchMaterial);
    patch.position.copy(padPoint);
    patch.name = 'ground-patch';

    this.cloudMaterial = makeSurface(new Vector3(), CLOUD_FRAGMENT);
    this.cloudMaterial.transparent = true;
    this.cloudMaterial.depthWrite = false;
    this.cloudMaterial.side = DoubleSide;
    const clouds = new Mesh(new SphereGeometry(R_EARTH + CLOUD_ALTITUDE, 256, 128), this.cloudMaterial);
    clouds.name = 'clouds';

    this.atmosphereMaterial = new ShaderMaterial({
      vertexShader: ATMOSPHERE_VERTEX,
      fragmentShader: ATMOSPHERE_FRAGMENT,
      uniforms: {
        uSunDir: this.sharedUniforms.uSunDir,
        uEarthCenter: { value: new Vector3() },
        uPlanetRadius: { value: R_EARTH },
        uAtmosphereRadius: { value: R_EARTH + ATMOSPHERE_TOP },
        uScaleHeight: { value: 8_500 },
      },
      side: BackSide,
      transparent: true,
      depthWrite: false,
    });
    this.atmosphere = new Mesh(new SphereGeometry(R_EARTH + ATMOSPHERE_TOP, 128, 64), this.atmosphereMaterial);
    this.atmosphere.renderOrder = -1;
    this.atmosphere.name = 'atmosphere';

    const { up, east, north } = localFrame(padDir);
    const south = { x: -north.x, y: -north.y, z: -north.z };
    this.padAnchor.position.copy(padPoint);
    this.padAnchor.quaternion.copy(toQuaternion(fromBasis(east, up, south)));

    this.group.add(globe, patch, clouds, this.padAnchor);
  }

  update(origin: Vec3, earthAngle: number, sunDir: Vector3, cameraAltitude: number, time: number): void {
    this.group.position.set(-origin.x, -origin.y, -origin.z);
    this.group.rotation.set(0, earthAngle, 0);
    this.atmosphere.position.copy(this.group.position);
    this.sharedUniforms.uSunDir.value.copy(sunDir);
    this.sharedUniforms.uCameraAltitude.value = cameraAltitude;
    this.sharedUniforms.uTime.value = time;
    (this.atmosphereMaterial.uniforms.uEarthCenter!.value as Vector3).copy(this.group.position);
  }

  dispose(): void {
    disposeObject(this.group);
    disposeObject(this.atmosphere);
  }
}

/**
 * Polar grid of true-sphere vertices around the pad, stored relative to the pad point.
 * Rings grow geometrically from metres near the pad to ~200 km at the edge.
 */
function buildGroundPatch(padDir: Vec3): BufferGeometry {
  const { east, north } = localFrame(padDir);
  const radii = [0];
  for (let d = 4; d < PATCH_RADIUS; d *= 1.09) radii.push(d);
  radii.push(PATCH_RADIUS);
  const segments = 96;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const d of radii) {
    const angle = d / R_EARTH;
    const drop = d < PAD_CLEARING_RADIUS ? PAD_CLEARING_DEPTH : d < PAD_CLEARING_RADIUS * 1.6 ? PAD_CLEARING_DEPTH / 2 : 0;
    const radius = R_EARTH - drop;
    for (let s = 0; s < segments; s++) {
      const phi = (s / segments) * Math.PI * 2;
      const tx = east.x * Math.cos(phi) + north.x * Math.sin(phi);
      const ty = east.y * Math.cos(phi) + north.y * Math.sin(phi);
      const tz = east.z * Math.cos(phi) + north.z * Math.sin(phi);
      const px = radius * (Math.cos(angle) * padDir.x + Math.sin(angle) * tx);
      const py = radius * (Math.cos(angle) * padDir.y + Math.sin(angle) * ty);
      const pz = radius * (Math.cos(angle) * padDir.z + Math.sin(angle) * tz);
      // Subtract the pad point in double precision before storing as float32.
      positions.push(px - R_EARTH * padDir.x, py - R_EARTH * padDir.y, pz - R_EARTH * padDir.z);
    }
  }
  for (let ring = 0; ring < radii.length - 1; ring++) {
    for (let s = 0; s < segments; s++) {
      const a = ring * segments + s;
      const b = ring * segments + ((s + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}
