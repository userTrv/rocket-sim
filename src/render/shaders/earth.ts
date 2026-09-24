import { NOISE_GLSL } from './noise';

/**
 * Procedural Earth: continents, biomes, ice caps and night lights from 3D noise on the
 * unit sphere (no textures). The same shader draws the low-poly globe and the finely
 * tessellated ground patch around the pad, so both blend seamlessly.
 */
export const EARTH_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uPatchOrigin;   // earth-space offset added to local vertex positions
varying vec3 vSpherePos;     // earth-space position (for noise lookups)
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
void main() {
  vSpherePos = uPatchOrigin + position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normalize(vSpherePos));
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

export const EARTH_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunDir;        // world space
uniform vec3 uPadDir;        // earth space, unit
uniform float uCameraAltitude;
varying vec3 vSpherePos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
${NOISE_GLSL}

float continents(vec3 n) {
  float h = fbm(n * 1.7, 7) + 0.12 * snoise(n * 11.0);
  // Guarantee a coastline with land to the west of the launch site.
  float padDist = 1.0 - dot(n, uPadDir);
  h += 0.35 * exp(-padDist * 2500.0);
  // ...with the ocean just to the east (downrange), like Cape Canaveral.
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), uPadDir));
  h -= 0.4 * smoothstep(0.004, 0.012, dot(n - uPadDir, east)) * exp(-padDist * 300.0);
  return h;
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vSpherePos);
  float lat = asin(clamp(n.y, -1.0, 1.0));
  float dist = length(vWorldPos - cameraPosition);

  float h = continents(n);
  // Fine detail that fades out with distance to avoid shimmering.
  float detailFade = 1.0 - smoothstep(20000.0, 400000.0, dist);
  float nearFade = 1.0 - smoothstep(500.0, 6000.0, dist);
  float detail = detailFade * (0.5 * snoise(n * 900.0) + 0.25 * snoise(n * 4000.0) + 0.12 * snoise(n * 30000.0))
               + nearFade * 0.25 * snoise(n * 200000.0);
  float land = smoothstep(0.03, 0.05, h + detail * 0.02);

  vec3 deep = vec3(0.02, 0.09, 0.22);
  vec3 shallow = vec3(0.05, 0.27, 0.40);
  vec3 ocean = mix(deep, shallow, smoothstep(-0.12, 0.03, h));

  float moisture = fbm(n * 3.1 + 7.0, 4);
  float padDist = 1.0 - dot(n, uPadDir);
  // Deserts cluster around 25 deg latitude, but keep the launch site's coast green.
  float desertBand = exp(-pow((abs(lat) - 0.42) / 0.12, 2.0)) * (1.0 - exp(-padDist * 400.0));
  vec3 forest = vec3(0.13, 0.26, 0.10);
  vec3 grass = vec3(0.30, 0.38, 0.17);
  vec3 desert = vec3(0.66, 0.55, 0.36);
  vec3 rock = vec3(0.38, 0.33, 0.28);
  vec3 ground = mix(forest, grass, smoothstep(-0.2, 0.3, moisture + detail * 0.3));
  ground = mix(ground, desert, smoothstep(0.2, 0.7, desertBand - moisture));
  ground = mix(ground, rock, smoothstep(0.35, 0.55, h));
  ground *= 0.78 + 0.45 * detail;
  // Lakes and wetlands scattered over the land at close range.
  float lakes = detailFade * smoothstep(0.62, 0.7, snoise(n * 2500.0) * 0.6 + snoise(n * 9000.0) * 0.4);
  ground = mix(ground, shallow * 0.8, lakes * (1.0 - smoothstep(0.35, 0.5, h)));
  float ice = smoothstep(1.15, 1.25, abs(lat) + 0.08 * snoise(n * 8.0)) ;
  ground = mix(ground, vec3(0.92, 0.95, 0.98), max(ice, smoothstep(0.55, 0.62, h)));
  ocean = mix(ocean, vec3(0.85, 0.9, 0.95), ice);
  vec3 albedo = mix(ocean, ground, land);

  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndl = dot(N, uSunDir);
  float day = smoothstep(-0.12, 0.25, ndl);
  vec3 color = albedo * (0.03 + 1.1 * max(ndl, 0.0));

  // Sun glint on water.
  vec3 H = normalize(uSunDir + V);
  color += (1.0 - land) * pow(max(dot(N, H), 0.0), 120.0) * 0.6 * step(0.0, ndl);

  // City lights on the night side.
  float cities = smoothstep(0.55, 0.85, snoise(n * 60.0) * 0.5 + snoise(n * 240.0) * 0.5 + 0.2 * moisture);
  color += land * (1.0 - ice) * (1.0 - day) * cities * vec3(1.0, 0.72, 0.38) * 0.35;

  // Atmospheric rim (seen from space) and aerial perspective (seen from low altitude).
  float rim = pow(1.0 - max(dot(N, V), 0.0), 4.0) * smoothstep(15000.0, 150000.0, uCameraAltitude);
  vec3 sky = vec3(0.35, 0.58, 1.0);
  color = mix(color, sky * (0.25 + day), rim * 0.55 * day);
  float airAtCamera = exp(-uCameraAltitude / 12000.0);
  float haze = (1.0 - exp(-dist / 120000.0)) * (0.7 * airAtCamera + 0.04);
  color = mix(color, vec3(0.45, 0.6, 0.85) * (0.1 + 0.9 * day), haze * day);

  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export const CLOUD_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunDir;
uniform float uTime;
varying vec3 vSpherePos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
${NOISE_GLSL}
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vSpherePos);
  vec3 drift = vec3(uTime * 0.00002, 0.0, 0.0);
  float dist = length(vWorldPos - cameraPosition);
  float fine = (1.0 - smoothstep(30000.0, 600000.0, dist)) * 0.12 * snoise(n * 400.0);
  float c = fbm(n * 5.0 + drift, 6) + fine;
  float lat = abs(n.y);
  float coverage = smoothstep(0.22, 0.45, c + 0.12 * sin(lat * 9.0));
  // Fade clouds that are very far or very close to avoid hard edges when flying through.
  float fade = smoothstep(300.0, 2500.0, dist);
  vec3 N = normalize(vWorldNormal);
  float light = smoothstep(-0.05, 0.25, dot(N, uSunDir));
  vec3 color = mix(vec3(0.02, 0.025, 0.04), vec3(1.0), light);
  gl_FragColor = vec4(color, coverage * 0.9 * fade);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
