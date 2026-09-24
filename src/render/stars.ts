import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';
import { STAR_FRAGMENT, STAR_VERTEX } from './shaders/plume';

/** Deterministic PRNG (mulberry32) so the sky looks the same on every visit. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAR_DISTANCE = 1e9;

/** Starfield with a faint Milky Way band; follows the camera so it is infinitely far. */
export class Starfield {
  readonly points: Points;

  constructor(count = 9000) {
    const rand = mulberry32(1969);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    // Galactic plane tilted ~60 degrees to the equator.
    const tilt = (62 * Math.PI) / 180;
    for (let i = 0; i < count; i++) {
      let x: number, y: number, z: number;
      const inBand = i > count * 0.55;
      if (inBand) {
        const lon = rand() * Math.PI * 2;
        const lat = (rand() + rand() + rand() - 1.5) * 0.18;
        const bx = Math.cos(lat) * Math.cos(lon);
        const by = Math.sin(lat);
        const bz = Math.cos(lat) * Math.sin(lon);
        x = bx;
        y = by * Math.cos(tilt) - bz * Math.sin(tilt);
        z = by * Math.sin(tilt) + bz * Math.cos(tilt);
      } else {
        const u = rand() * 2 - 1;
        const phi = rand() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        x = s * Math.cos(phi);
        y = u;
        z = s * Math.sin(phi);
      }
      positions.set([x * STAR_DISTANCE, y * STAR_DISTANCE, z * STAR_DISTANCE], i * 3);
      const temperature = rand();
      const brightness = inBand ? 0.25 + rand() * 0.35 : 0.35 + Math.pow(rand(), 3) * 0.9;
      const tint: [number, number, number] =
        temperature < 0.15 ? [1, 0.8, 0.6] : temperature > 0.8 ? [0.75, 0.85, 1] : [1, 0.97, 0.92];
      colors.set(tint.map((c) => c * brightness), i * 3);
      sizes[i] = inBand ? 1.2 : 1.1 + Math.pow(rand(), 6) * 2.6;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
    const material = new ShaderMaterial({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: { uVisibility: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -2;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as ShaderMaterial).dispose();
  }
}
