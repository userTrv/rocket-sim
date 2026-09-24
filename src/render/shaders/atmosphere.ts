/**
 * Single-scattering-inspired atmosphere: ray-march the density along the view ray
 * through a shell around the planet. From the ground it produces a blue sky that
 * hides the stars; from orbit it produces the thin blue limb.
 */
export const ATMOSPHERE_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorldPos;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

export const ATMOSPHERE_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uEarthCenter;
uniform vec3 uSunDir;
uniform float uPlanetRadius;
uniform float uAtmosphereRadius;
uniform float uScaleHeight;
varying vec3 vWorldPos;

vec2 raySphere(vec3 ro, vec3 rd, vec3 c, float r) {
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float h = b * b - (dot(oc, oc) - r * r);
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - cameraPosition);
  vec2 shell = raySphere(ro, rd, uEarthCenter, uAtmosphereRadius);
  if (shell.y < 0.0) discard;
  float t0 = max(shell.x, 0.0);
  float t1 = shell.y;
  vec2 ground = raySphere(ro, rd, uEarthCenter, uPlanetRadius);
  if (ground.x > 0.0) t1 = min(t1, ground.x);
  const int STEPS = 12;
  float ds = (t1 - t0) / float(STEPS);
  float depth = 0.0;
  float scatter = 0.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (t0 + (float(i) + 0.5) * ds) - uEarthCenter;
    float r = length(p);
    float density = exp(-(r - uPlanetRadius) / uScaleHeight);
    float lit = smoothstep(-0.18, 0.2, dot(p / r, uSunDir));
    depth += density * ds;
    scatter += density * ds * lit;
  }
  float k = 1.0 / 7000.0;
  float alpha = 1.0 - exp(-depth * k);
  float light = 1.0 - exp(-scatter * k);
  float mu = dot(rd, uSunDir);
  vec3 rayleigh = vec3(0.07, 0.24, 0.78) * (0.8 + 0.2 * mu * mu);
  vec3 horizon = vec3(0.5, 0.66, 0.92);
  vec3 color = mix(rayleigh, horizon, smoothstep(0.75, 0.995, alpha));
  // Warm tint when the sun is low (long light paths).
  color = mix(color, vec3(1.0, 0.62, 0.38), smoothstep(0.85, 1.0, alpha) * (1.0 - light / max(alpha, 1e-3)) * 0.6);
  color *= light / max(alpha, 1e-3);
  color += vec3(1.0, 0.92, 0.8) * pow(max(mu, 0.0), 400.0) * 3.0 * alpha;
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
