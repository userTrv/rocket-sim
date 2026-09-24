import { CanvasTexture, Group, Sprite, SpriteMaterial, Vector3, type InterleavedBufferAttribute, type PerspectiveCamera } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { R_EARTH } from '../sim/constants';
import { orbitPath, positionAtTrueAnomaly, type OrbitalElements } from '../sim/orbit';
import type { Vec3 } from '../sim/math/vec3';
import { placeRelative } from './space';

const ORBIT_SEGMENTS = 256;
const TRAIL_CAPACITY = 1024;

function markerTexture(color: string): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
  return new CanvasTexture(canvas);
}

/** Map view overlays: predicted orbit, flown trajectory, apoapsis/periapsis and vehicle markers. */
export class MapView {
  readonly group = new Group();
  private readonly orbitLine: Line2;
  private readonly trailLine: Line2;
  private readonly orbitBuffer = new Float32Array((ORBIT_SEGMENTS + 1) * 3);
  private readonly trailBuffer = new Float32Array(TRAIL_CAPACITY * 3);
  private readonly markers: Record<'apo' | 'peri' | 'vehicle', Sprite>;
  private readonly labels: Record<'apo' | 'peri', HTMLElement>;
  private readonly textures: CanvasTexture[] = [];
  private readonly earthCentre = new Vector3();

  constructor(private readonly labelLayer: HTMLElement) {
    this.orbitLine = new Line2(new LineGeometry(), new LineMaterial({ color: 0x4fd1ff, linewidth: 2.5 }));
    this.trailLine = new Line2(new LineGeometry(), new LineMaterial({ color: 0xffa24a, linewidth: 2 }));
    this.orbitLine.frustumCulled = false;
    this.trailLine.frustumCulled = false;
    const sprite = (color: string, size: number) => {
      const tex = markerTexture(color);
      this.textures.push(tex);
      const s = new Sprite(new SpriteMaterial({ map: tex, sizeAttenuation: false }));
      s.scale.setScalar(size);
      s.renderOrder = 10;
      return s;
    };
    this.markers = { apo: sprite('#4fd1ff', 0.016), peri: sprite('#ffd24f', 0.016), vehicle: sprite('#ffffff', 0.02) };
    this.group.add(this.orbitLine, this.trailLine, this.markers.apo, this.markers.peri, this.markers.vehicle);
    this.labels = { apo: this.makeLabel('map-label map-label--apo'), peri: this.makeLabel('map-label map-label--peri') };
    this.setVisible(false);
  }

  private makeLabel(className: string): HTMLElement {
    const el = document.createElement('div');
    el.className = className;
    this.labelLayer.append(el);
    return el;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
    this.labelLayer.hidden = !visible;
  }

  update(orbit: OrbitalElements, trail: readonly Vec3[], vehicle: Vec3, origin: Vec3, camera: PerspectiveCamera, width: number, height: number): void {
    if (!this.group.visible) return;
    this.earthCentre.set(-origin.x, -origin.y, -origin.z);
    const orbitPoints = orbitPath(orbit, ORBIT_SEGMENTS);
    this.orbitLine.visible = orbitPoints.length > 1;
    if (this.orbitLine.visible) {
      orbitPoints.forEach((p, i) => this.orbitBuffer.set([p.x - origin.x, p.y - origin.y, p.z - origin.z], i * 3));
      this.setLine(this.orbitLine, this.orbitBuffer.subarray(0, orbitPoints.length * 3));
    }

    const step = Math.max(1, Math.ceil(trail.length / (TRAIL_CAPACITY - 1)));
    let n = 0;
    for (let i = 0; i < trail.length && n < TRAIL_CAPACITY - 1; i += step) {
      const p = trail[i]!;
      this.trailBuffer.set([p.x - origin.x, p.y - origin.y, p.z - origin.z], n++ * 3);
    }
    this.trailBuffer.set([vehicle.x - origin.x, vehicle.y - origin.y, vehicle.z - origin.z], n++ * 3);
    this.trailLine.visible = n > 1;
    if (this.trailLine.visible) this.setLine(this.trailLine, this.trailBuffer.subarray(0, n * 3));
    (this.orbitLine.material as LineMaterial).resolution.set(width, height);
    (this.trailLine.material as LineMaterial).resolution.set(width, height);

    placeRelative(this.markers.vehicle, vehicle, origin);
    // Apsides below the surface (suborbital arcs) are not worth marking.
    const showApo = orbitPoints.length > 0 && orbit.apoapsis > 0;
    const showPeri = orbitPoints.length > 0 && orbit.periapsis > 0;
    this.markers.apo.visible = showApo;
    this.markers.peri.visible = showPeri;
    this.labels.apo.hidden = !showApo;
    this.labels.peri.hidden = !showPeri;
    if (showApo) {
      placeRelative(this.markers.apo, positionAtTrueAnomaly(orbit, Math.PI), origin);
      this.placeLabel(this.labels.apo, this.markers.apo.position, camera, width, height, `Ap ${(orbit.apoapsis / 1000).toFixed(0)} km`);
    }
    if (showPeri) {
      placeRelative(this.markers.peri, positionAtTrueAnomaly(orbit, 0), origin);
      this.placeLabel(this.labels.peri, this.markers.peri.position, camera, width, height, `Pe ${(orbit.periapsis / 1000).toFixed(0)} km`);
    }
  }

  /**
   * LineGeometry stores segments (start/end pairs) in an interleaved buffer. Rewrite that
   * buffer in place every frame and only rebuild the geometry when the point count changes,
   * so no GPU buffers are leaked.
   */
  private setLine(line: Line2, positions: Float32Array): void {
    const count = positions.length / 3;
    let geometry = line.geometry as LineGeometry;
    if (geometry.userData.count !== count) {
      geometry.dispose();
      geometry = new LineGeometry();
      geometry.setPositions(positions);
      geometry.userData.count = count;
      line.geometry = geometry;
      return;
    }
    const data = (geometry.getAttribute('instanceStart') as InterleavedBufferAttribute).data;
    const segments = data.array as Float32Array;
    for (let i = 0; i < count - 1; i++) {
      segments.set(positions.subarray(i * 3, i * 3 + 6), i * 6);
    }
    data.needsUpdate = true;
  }

  private placeLabel(el: HTMLElement, at: Vector3, camera: PerspectiveCamera, width: number, height: number, text: string): void {
    const p = at.clone().project(camera);
    const visible = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 && !behindEarth(camera.position, at, this.earthCentre);
    el.hidden = !visible;
    if (!visible) return;
    el.textContent = text;
    el.style.transform = `translate(${((p.x + 1) / 2) * width + 10}px, ${((1 - p.y) / 2) * height - 10}px)`;
  }

  dispose(): void {
    this.orbitLine.geometry.dispose();
    this.trailLine.geometry.dispose();
    (this.orbitLine.material as LineMaterial).dispose();
    (this.trailLine.material as LineMaterial).dispose();
    for (const s of Object.values(this.markers)) s.material.dispose();
    for (const t of this.textures) t.dispose();
    for (const l of Object.values(this.labels)) l.remove();
  }
}

/** True when the segment from the camera to `point` passes through the Earth. */
function behindEarth(cameraPos: Vector3, point: Vector3, centre: Vector3): boolean {
  const dir = point.clone().sub(cameraPos);
  const len = dir.length();
  dir.divideScalar(len);
  const oc = cameraPos.clone().sub(centre);
  const b = oc.dot(dir);
  const c = oc.lengthSq() - R_EARTH * R_EARTH;
  const disc = b * b - c;
  if (disc < 0) return false;
  const t = -b - Math.sqrt(disc);
  return t > 0 && t < len;
}
