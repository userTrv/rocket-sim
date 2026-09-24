/**
 * Exhaust plume on an open cone. Brightness falls off along the plume and towards the
 * silhouette; at low altitude "shock diamonds" modulate the core. Additive blending.
 */
export const PLUME_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uStartRadius;
uniform float uEndRadius;
uniform float uLength;
uniform float uShape;       // < 1 flares quickly (vacuum), > 1 stays narrow
varying float vAlong;
varying vec3 vNormalView;
varying vec3 vViewDir;
void main() {
  // Unit open cylinder, y in [-1, 0], deformed into the plume shape.
  vAlong = -position.y; // 0 at the nozzle, 1 at the tail
  float radius = mix(uStartRadius, uEndRadius, pow(vAlong, uShape));
  vec3 p = vec3(position.x * radius, position.y * uLength, position.z * radius);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormalView = normalize(normalMatrix * vec3(position.x, 0.0, position.z));
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

export const PLUME_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uIntensity;
uniform float uExpansion;   // 0 = sea level, 1 = vacuum
uniform float uTime;
uniform vec3 uCoreColor;
uniform vec3 uEdgeColor;
uniform float uDiamonds;
varying float vAlong;
varying vec3 vNormalView;
varying vec3 vViewDir;
void main() {
  #include <logdepthbuf_fragment>
  float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
  float body = pow(facing, 1.5);
  float tail = pow(1.0 - clamp(vAlong, 0.0, 1.0), mix(1.6, 2.6, uExpansion));
  float flicker = 0.85 + 0.15 * sin(uTime * 53.0 + vAlong * 17.0) * sin(uTime * 31.0);
  float diamonds = 1.0 + uDiamonds * 0.5 * smoothstep(0.3, 1.0, sin(vAlong * 38.0)) * (1.0 - vAlong);
  vec3 color = mix(uEdgeColor, uCoreColor, pow(tail, 0.6) * body);
  float alpha = body * tail * flicker * diamonds * uIntensity * mix(1.0, 0.45, uExpansion);
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

export const PARTICLE_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
attribute vec4 aColor;
uniform float uPixelScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uPixelScale / max(-mv.z, 0.1), 0.0, 400.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

export const PARTICLE_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec4 vColor;
void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float soft = pow(1.0 - d, 1.5);
  gl_FragColor = vec4(vColor.rgb, vColor.a * soft);
}
`;

export const STAR_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize;
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

export const STAR_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uVisibility;
varying vec3 vColor;
void main() {
  #include <logdepthbuf_fragment>
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  gl_FragColor = vec4(vColor * (1.0 - d) * uVisibility, 1.0);
}
`;
