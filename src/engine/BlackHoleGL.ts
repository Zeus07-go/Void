// Real-time raymarched Schwarzschild black hole.
// Each pixel's light ray is integrated through curved spacetime (units: Schwarzschild radius = 1),
// so the lensed disk arcs, photon ring and distorted starfield all emerge from the physics.

import { AdaptiveResolution } from './adaptive';

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const RANGES = `#define NEB_RANGE 2.0
#define HERO_RANGE 4.0
`;

const MAIN_FRAG = `precision highp float;
uniform vec2 uCenter;
uniform float uMin;
uniform float uTime;
uniform vec3 uCamPos;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform float uFocal;
uniform float uPulse;
uniform float uFade;
uniform float uCharge;
uniform float uPortal;
uniform float uHover;
#ifdef BAKED
uniform samplerCube uNeb;
uniform samplerCube uHero;
uniform sampler2D uDiskTex;
#endif

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = p * 2.07 + 1.3;
    a *= 0.5;
  }
  return s;
}

float fbm3(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    s += a * noise(p);
    p = p * 2.11 + 1.7;
    a *= 0.5;
  }
  return s / 0.875;
}

// Stellar colour by temperature class: blue O/B → white A/F → yellow G → orange K → red M
vec3 starColor(float t) {
  if (t < 0.12) return vec3(0.62, 0.74, 1.0);
  if (t < 0.4) return vec3(0.86, 0.9, 1.0);
  if (t < 0.68) return vec3(1.0, 0.96, 0.9);
  if (t < 0.86) return vec3(1.0, 0.84, 0.62);
  if (t < 0.96) return vec3(1.0, 0.68, 0.42);
  return vec3(1.0, 0.5, 0.36);
}

// One star per occupied cell; a sharp core plus an optional soft halo for bright stars.
vec3 starLayer(vec3 d, float scale, float density, float core, float halo, float gain) {
  vec3 p = d * scale;
  vec3 id = floor(p);
  float h = hash13(id);
  if (h < 1.0 - density) return vec3(0.0);
  vec3 c = vec3(hash13(id + 1.7), hash13(id + 3.1), hash13(id + 5.3)) * 0.5 + 0.25;
  vec3 q = fract(p) - c;
  float dd = dot(q, q);
  float mag = pow(hash13(id + 7.7), 4.0); // most stars faint, a few brilliant
  float b = exp(-dd / (core * core)) * (0.35 + 2.4 * mag);
  if (halo > 0.0) b += exp(-dd / (halo * halo)) * 0.5 * mag;
  float t = hash13(id + 9.1);
  float tw = 0.85 + 0.15 * sin(uTime * (1.3 + t * 3.0) + h * 40.0);
  return starColor(t) * b * tw * gain;
}

#ifndef BAKED
vec2 rot2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// A large inclined spiral galaxy centred on sky direction G.
vec3 spiralGalaxy(vec3 d, vec3 G, float size, float incl, float rot, vec3 armTint, float bright) {
  float ca = dot(d, G);
  if (ca < 0.75) return vec3(0.0);
  vec3 t1 = normalize(cross(G, vec3(0.0, 1.0, 0.0)));
  vec3 t2 = cross(t1, G);
  vec2 pp = rot2(vec2(dot(d, t1), dot(d, t2)) / size, rot); // projected, galaxy-aligned
  vec2 p = vec2(pp.x, pp.y / incl); // de-projected disk plane
  float r = length(p);
  if (r > 1.7) return vec3(0.0);
  float th = atan(p.y, p.x);
  float phase = 2.0 * th + 4.8 * log(r + 0.03);
  float arms = pow(0.5 + 0.5 * cos(phase), 2.5);
  float clump = fbm3(vec3(p * 4.5, 2.0));
  float disk = exp(-r * 2.4);
  vec3 col = armTint * disk * (0.25 + 2.6 * arms * clump);
  // dust lanes trail the arms
  float lane = smoothstep(0.6, 0.95, 0.5 + 0.5 * cos(phase + 1.1)) * smoothstep(0.06, 0.3, r);
  col *= 1.0 - lane * 0.7;
  // star-forming knots
  float k1 = noise(vec3(p * 26.0, 5.0));
  float k2 = noise(vec3(p * 34.0, 9.0));
  col += vec3(1.0, 0.42, 0.78) * smoothstep(0.78, 0.96, k1) * arms * disk * 1.1;
  col += vec3(0.55, 0.72, 1.0) * smoothstep(0.8, 0.97, k2) * arms * disk * 1.0;
  // bulge (spheroidal, so measured in projected space)
  float rb = dot(pp, pp);
  col += vec3(1.0, 0.86, 0.68) * exp(-rb * 90.0) * 1.0;
  col += vec3(1.0, 0.62, 0.5) * exp(-rb * 12.0) * 0.35;
  col += armTint * exp(-r * r * 0.9) * 0.05; // faint outer halo
  return col * (1.0 - smoothstep(1.1, 1.7, r)) * bright;
}

// Small, distant spiral galaxies scattered across the sky
vec3 galaxies(vec3 d) {
  vec3 p = d * 18.0;
  vec3 id = floor(p);
  float h = hash13(id + 17.0);
  if (h < 0.955) return vec3(0.0);
  vec3 c = vec3(hash13(id + 2.0), hash13(id + 4.0), hash13(id + 6.0)) * 0.5 + 0.25;
  vec3 q = fract(p) - c;
  vec3 t1 = normalize(cross(d, vec3(0.0, 1.0, 0.001)));
  vec3 t2 = cross(d, t1);
  vec2 uv = vec2(dot(q, t1), dot(q, t2));
  float ang = h * 60.0;
  float ca = cos(ang);
  float sa = sin(ang);
  uv = vec2(ca * uv.x - sa * uv.y, sa * uv.x + ca * uv.y);
  uv.y *= 1.6 + fract(h * 13.0) * 2.4;
  float r = length(uv);
  float arms = 0.5 + 0.5 * sin(atan(uv.y, uv.x) * 2.0 - log(r + 0.002) * 7.0);
  float g = exp(-r * r * 1400.0) * 1.2 + exp(-r * r * 160.0) * (0.25 + 0.45 * arms);
  vec3 tint = mix(vec3(1.0, 0.82, 0.72), vec3(0.66, 0.6, 1.0), fract(h * 7.0));
  return tint * g * 0.45;
}

vec3 nebulaSky(vec3 d) {
  vec3 col = vec3(0.0);

  // Galactic plane, gently warped
  vec3 bandN = normalize(vec3(0.28, 1.0, 0.32));
  float warp = fbm3(d * 2.0) - 0.5;
  float bh = dot(d, bandN) + warp * 0.18;
  float band = exp(-bh * bh * 16.0);
  float bandWide = exp(-bh * bh * 4.0);

  // Bright galactic core off to one side of the void
  vec3 coreDir = normalize(vec3(-0.8, 0.12, -0.55));
  float coreAmt = pow(max(dot(d, coreDir), 0.0), 5.0) * band;

  // Star clouds, cut by dark dust lanes
  float clouds = fbm3(d * 4.5 + 3.0);
  float dust = fbm3(d * 10.0 + 11.0);
  float lanes = 1.0 - smoothstep(0.42, 0.7, dust) * 0.9 * band;
  vec3 milky = mix(vec3(0.5, 0.5, 0.72), vec3(1.0, 0.8, 0.58), clamp(coreAmt * 2.0, 0.0, 1.0));
  col += milky * band * (0.04 + 0.3 * clouds * clouds) * lanes * 0.3;
  col += vec3(1.0, 0.78, 0.52) * coreAmt * (0.3 + clouds) * lanes * 0.4;
  col += vec3(0.42, 0.4, 0.62) * bandWide * 0.012;

  // Deep navy sky with blue/violet nebulosity — only the densest pockets glow
  float nv = fbm3(d * 2.4 + 20.0);
  float nt = fbm3(d * 3.1 + 40.0);
  float nr = fbm3(d * 2.0 + 60.0);
  col += vec3(0.012, 0.018, 0.05) * (0.6 + 0.8 * nt);
  col += vec3(0.42, 0.3, 0.8) * smoothstep(0.52, 0.85, nv) * 0.13;
  col += vec3(0.1, 0.3, 0.7) * smoothstep(0.55, 0.88, nt) * 0.12;
  col += vec3(0.65, 0.22, 0.55) * smoothstep(0.62, 0.92, nr) * 0.09;

  col += galaxies(d);

  return col;
}

// Large spiral galaxies. Artistic choice: sampled with only partial lensing so they stay
// readable as galaxies instead of being smeared into Einstein arcs by the nearby hole.
vec3 heroGalaxies(vec3 d) {
  vec3 col = vec3(0.0);
  // Hero galaxy, upper-left of the void in the default framing
  col += spiralGalaxy(d, normalize(vec3(-0.549, 0.111, -0.829)), 0.2, 0.38, -0.32, vec3(0.5, 0.46, 1.0) * 0.55, 1.2);
  // Two more revealed by orbiting the camera
  col += spiralGalaxy(d, normalize(vec3(0.62, -0.22, 0.75)), 0.15, 0.72, 0.9, vec3(0.42, 0.55, 1.0) * 0.45, 1.0);
  col += spiralGalaxy(d, normalize(vec3(0.9, 0.3, -0.3)), 0.09, 0.5, 2.1, vec3(0.75, 0.55, 0.95) * 0.45, 0.9);
  return col;
}

#endif

vec3 skyNebula(vec3 d) {
#ifdef BAKED
  vec3 t = textureCube(uNeb, d).rgb;
  return t * t * NEB_RANGE;
#else
  return nebulaSky(d);
#endif
}

vec3 skyHero(vec3 d) {
#ifdef BAKED
  vec3 t = textureCube(uHero, d).rgb;
  return t * t * HERO_RANGE;
#else
  return heroGalaxies(d);
#endif
}

vec3 background(vec3 d) {
  vec3 col = skyNebula(d);
  float bh = dot(d, normalize(vec3(0.28, 1.0, 0.32)));
  float band = exp(-bh * bh * 16.0);
  // Stars stay procedural: pin-sharp at any resolution and still twinkling
  col += starLayer(d, 45.0, 0.2, 0.035, 0.11, 2.2);
  col += starLayer(d, 110.0, 0.32 + 0.15 * band, 0.06, 0.0, 1.3);
  col += starLayer(d, 260.0, 0.45 + 0.3 * band, 0.09, 0.0, 0.7);
  return col;
}

vec4 disk(vec3 p, vec3 rd) {
  float r = length(p.xz);
  float inner = 2.6;
  float outer = 13.0;
  float x = (r - inner) / (outer - inner);
  if (x < 0.0 || x > 1.0) return vec4(0.0);
  float edge = smoothstep(0.0, 0.035, x) * (1.0 - smoothstep(0.45, 1.0, x));

  float ang = atan(p.z, p.x);
  float omega = 1.6 / pow(r, 1.5);
  float a = ang - uTime * omega;
#ifdef BAKED
  // turbulence pre-rendered in the co-rotating frame: (angle, radius) -> streak
  float streak = texture2D(uDiskTex, vec2(a / 6.2831853, x)).r * 2.5;
#else
  vec3 q = vec3(cos(a) * 1.6, sin(a) * 1.6, r * 2.4);
  float n = fbm(q);
  float n2 = fbm3(q * vec3(2.5, 2.5, 3.5) + 7.0);
  float streak = 0.35 + 1.25 * n * n + 0.35 * n2;
#endif

  float temp = pow(inner / r, 0.85);
  vec3 cool = vec3(0.6, 0.2, 0.07);
  vec3 mid = vec3(1.0, 0.55, 0.22);
  vec3 hot = vec3(1.0, 0.93, 0.84);
  vec3 c = mix(cool, mid, smoothstep(0.18, 0.55, temp));
  c = mix(c, hot, smoothstep(0.6, 0.97, temp));
  float I = temp * temp * 3.4 * streak * edge;

  // Relativistic beaming and gravitational redshift
  float v = sqrt(0.5 / r);
  vec3 vel = normalize(vec3(-p.z, 0.0, p.x)) * v;
  float gamma = inversesqrt(1.0 - v * v);
  float dop = 1.0 / (gamma * (1.0 - dot(vel, -normalize(rd))));
  I *= mix(1.0, pow(dop, 3.0), 0.6);
  c = mix(c, c * vec3(0.9, 0.97, 1.12), clamp(dop - 1.0, 0.0, 1.0));
  I *= sqrt(max(1.0 - 1.0 / r, 0.0));
  I *= (1.0 + 0.9 * uPulse) * (1.0 + 0.3 * uHover + 1.1 * uCharge + 1.6 * uPortal);
  // violet/blue energy emerges from the amber disk as the portal opens
  c = mix(c, vec3(0.62, 0.38, 1.0), clamp(uPortal * 0.75 + uCharge * 0.15, 0.0, 0.85) * smoothstep(0.05, 0.6, x));

  float alpha = clamp(I * 0.9, 0.0, 1.0) * edge;
  return vec4(c * I, alpha);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - uCenter) / uMin;
  vec3 rd = normalize(uRight * uv.x + uUp * uv.y + uFwd * uFocal);
  vec3 pos = uCamPos;
  vec3 dir = rd;
  vec3 hv = cross(pos, dir);
  float h2 = dot(hv, hv);

  vec3 col = vec3(0.0);
  float A = 0.0;
  bool captured = false;

  for (int i = 0; i < 220; i++) {
    float r = length(pos);
    if (r < 1.0) { captured = true; break; }
    if (A > 0.985) break;
    // Escaping and already past the disk: no more crossings possible. Add the remaining
    // weak-field deflection analytically instead of marching out to infinity.
    if (r > 14.0 && dot(pos, dir) > 0.0) {
      vec3 n = normalize(dir);
      vec3 inward = -pos / r;
      vec3 perp = inward - dot(inward, n) * n;
      float pl = length(perp);
      float b = sqrt(h2);
      float rest = (1.0 - sqrt(max(0.0, 1.0 - (b * b) / (r * r)))) / max(b, 1.0);
      if (pl > 1e-4) dir = n + (perp / pl) * rest;
      break;
    }
    float dt = clamp(0.12 * (r - 1.0), 0.015, 1.6);
    float r2 = r * r;
    vec3 acc = -1.5 * h2 * pos / (r2 * r2 * r);
    dir += acc * dt;
    vec3 np = pos + dir * dt;
    if (pos.y * np.y < 0.0) {
      float t = pos.y / (pos.y - np.y);
      vec4 d = disk(mix(pos, np, t), dir);
      col += (1.0 - A) * d.rgb;
      A += (1.0 - A) * d.a;
    }
    pos = np;
  }

  if (!captured) {
    vec3 fd = normalize(dir);
    col += (1.0 - A) * (background(fd) + skyHero(normalize(mix(rd, fd, 0.2)))) * (1.0 - 0.35 * uCharge - 0.4 * uPortal);
  }
  // Photon ring: rays just above the critical impact parameter wind around the hole.
  // A smooth function of b gives a clean, continuous ring at any resolution.
  float bImpact = sqrt(h2);
  if (!captured) {
    float ring = exp(-max(bImpact - 2.598, 0.0) * 28.0);
    col += vec3(1.0, 0.8, 0.6) * ring * (0.35 + 0.6 * uPulse) * (1.0 - A);
  }

  col = vec3(1.0) - exp(-col * 1.4);
  col = pow(col, vec3(0.9));
  gl_FragColor = vec4(col * uFade, 1.0);
}
`;

const BAKE_FRAG = `precision highp float;
uniform float uFace;
uniform float uSize;
uniform float uMode;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = p * 2.07 + 1.3;
    a *= 0.5;
  }
  return s;
}

float fbm3(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 3; i++) {
    s += a * noise(p);
    p = p * 2.11 + 1.7;
    a *= 0.5;
  }
  return s / 0.875;
}

vec2 rot2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// A large inclined spiral galaxy centred on sky direction G.
vec3 spiralGalaxy(vec3 d, vec3 G, float size, float incl, float rot, vec3 armTint, float bright) {
  float ca = dot(d, G);
  if (ca < 0.75) return vec3(0.0);
  vec3 t1 = normalize(cross(G, vec3(0.0, 1.0, 0.0)));
  vec3 t2 = cross(t1, G);
  vec2 pp = rot2(vec2(dot(d, t1), dot(d, t2)) / size, rot); // projected, galaxy-aligned
  vec2 p = vec2(pp.x, pp.y / incl); // de-projected disk plane
  float r = length(p);
  if (r > 1.7) return vec3(0.0);
  float th = atan(p.y, p.x);
  float phase = 2.0 * th + 4.8 * log(r + 0.03);
  float arms = pow(0.5 + 0.5 * cos(phase), 2.5);
  float clump = fbm3(vec3(p * 4.5, 2.0));
  float disk = exp(-r * 2.4);
  vec3 col = armTint * disk * (0.25 + 2.6 * arms * clump);
  // dust lanes trail the arms
  float lane = smoothstep(0.6, 0.95, 0.5 + 0.5 * cos(phase + 1.1)) * smoothstep(0.06, 0.3, r);
  col *= 1.0 - lane * 0.7;
  // star-forming knots
  float k1 = noise(vec3(p * 26.0, 5.0));
  float k2 = noise(vec3(p * 34.0, 9.0));
  col += vec3(1.0, 0.42, 0.78) * smoothstep(0.78, 0.96, k1) * arms * disk * 1.1;
  col += vec3(0.55, 0.72, 1.0) * smoothstep(0.8, 0.97, k2) * arms * disk * 1.0;
  // bulge (spheroidal, so measured in projected space)
  float rb = dot(pp, pp);
  col += vec3(1.0, 0.86, 0.68) * exp(-rb * 90.0) * 1.0;
  col += vec3(1.0, 0.62, 0.5) * exp(-rb * 12.0) * 0.35;
  col += armTint * exp(-r * r * 0.9) * 0.05; // faint outer halo
  return col * (1.0 - smoothstep(1.1, 1.7, r)) * bright;
}

// Small, distant spiral galaxies scattered across the sky
vec3 galaxies(vec3 d) {
  vec3 p = d * 18.0;
  vec3 id = floor(p);
  float h = hash13(id + 17.0);
  if (h < 0.955) return vec3(0.0);
  vec3 c = vec3(hash13(id + 2.0), hash13(id + 4.0), hash13(id + 6.0)) * 0.5 + 0.25;
  vec3 q = fract(p) - c;
  vec3 t1 = normalize(cross(d, vec3(0.0, 1.0, 0.001)));
  vec3 t2 = cross(d, t1);
  vec2 uv = vec2(dot(q, t1), dot(q, t2));
  float ang = h * 60.0;
  float ca = cos(ang);
  float sa = sin(ang);
  uv = vec2(ca * uv.x - sa * uv.y, sa * uv.x + ca * uv.y);
  uv.y *= 1.6 + fract(h * 13.0) * 2.4;
  float r = length(uv);
  float arms = 0.5 + 0.5 * sin(atan(uv.y, uv.x) * 2.0 - log(r + 0.002) * 7.0);
  float g = exp(-r * r * 1400.0) * 1.2 + exp(-r * r * 160.0) * (0.25 + 0.45 * arms);
  vec3 tint = mix(vec3(1.0, 0.82, 0.72), vec3(0.66, 0.6, 1.0), fract(h * 7.0));
  return tint * g * 0.45;
}

vec3 nebulaSky(vec3 d) {
  vec3 col = vec3(0.0);

  // Galactic plane, gently warped
  vec3 bandN = normalize(vec3(0.28, 1.0, 0.32));
  float warp = fbm3(d * 2.0) - 0.5;
  float bh = dot(d, bandN) + warp * 0.18;
  float band = exp(-bh * bh * 16.0);
  float bandWide = exp(-bh * bh * 4.0);

  // Bright galactic core off to one side of the void
  vec3 coreDir = normalize(vec3(-0.8, 0.12, -0.55));
  float coreAmt = pow(max(dot(d, coreDir), 0.0), 5.0) * band;

  // Star clouds, cut by dark dust lanes
  float clouds = fbm3(d * 4.5 + 3.0);
  float dust = fbm3(d * 10.0 + 11.0);
  float lanes = 1.0 - smoothstep(0.42, 0.7, dust) * 0.9 * band;
  vec3 milky = mix(vec3(0.5, 0.5, 0.72), vec3(1.0, 0.8, 0.58), clamp(coreAmt * 2.0, 0.0, 1.0));
  col += milky * band * (0.04 + 0.3 * clouds * clouds) * lanes * 0.3;
  col += vec3(1.0, 0.78, 0.52) * coreAmt * (0.3 + clouds) * lanes * 0.4;
  col += vec3(0.42, 0.4, 0.62) * bandWide * 0.012;

  // Deep navy sky with blue/violet nebulosity — only the densest pockets glow
  float nv = fbm3(d * 2.4 + 20.0);
  float nt = fbm3(d * 3.1 + 40.0);
  float nr = fbm3(d * 2.0 + 60.0);
  col += vec3(0.012, 0.018, 0.05) * (0.6 + 0.8 * nt);
  col += vec3(0.42, 0.3, 0.8) * smoothstep(0.52, 0.85, nv) * 0.13;
  col += vec3(0.1, 0.3, 0.7) * smoothstep(0.55, 0.88, nt) * 0.12;
  col += vec3(0.65, 0.22, 0.55) * smoothstep(0.62, 0.92, nr) * 0.09;

  col += galaxies(d);

  return col;
}

// Large spiral galaxies. Artistic choice: sampled with only partial lensing so they stay
// readable as galaxies instead of being smeared into Einstein arcs by the nearby hole.
vec3 heroGalaxies(vec3 d) {
  vec3 col = vec3(0.0);
  // Hero galaxy, upper-left of the void in the default framing
  col += spiralGalaxy(d, normalize(vec3(-0.549, 0.111, -0.829)), 0.2, 0.38, -0.32, vec3(0.5, 0.46, 1.0) * 0.55, 1.2);
  // Two more revealed by orbiting the camera
  col += spiralGalaxy(d, normalize(vec3(0.62, -0.22, 0.75)), 0.15, 0.72, 0.9, vec3(0.42, 0.55, 1.0) * 0.45, 1.0);
  col += spiralGalaxy(d, normalize(vec3(0.9, 0.3, -0.3)), 0.09, 0.5, 2.1, vec3(0.75, 0.55, 0.95) * 0.45, 0.9);
  return col;
}

vec3 faceDir(vec2 st) {
  float s = st.x;
  float t = st.y;
  if (uFace < 0.5) return vec3(1.0, -t, -s);
  if (uFace < 1.5) return vec3(-1.0, -t, s);
  if (uFace < 2.5) return vec3(s, 1.0, t);
  if (uFace < 3.5) return vec3(s, -1.0, -t);
  if (uFace < 4.5) return vec3(s, -t, 1.0);
  return vec3(-s, -t, -1.0);
}

void main() {
  vec2 st = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec3 d = normalize(faceDir(st));
  // sqrt encoding keeps precision in the dark end of an 8-bit texture
  vec3 c = uMode < 0.5 ? nebulaSky(d) / NEB_RANGE : heroGalaxies(d) / HERO_RANGE;
  gl_FragColor = vec4(sqrt(clamp(c, 0.0, 1.0)), 1.0);
}
`;

const DISK_BAKE_FRAG = `precision highp float;
uniform vec2 uSize;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float fbmN(vec3 p, int octaves) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    s += a * noise(p);
    p = p * 2.07 + 1.3;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  float a = uv.x * 6.2831853;
  float r = 2.6 + uv.y * (13.0 - 2.6);
  vec3 q = vec3(cos(a) * 1.6, sin(a) * 1.6, r * 2.4);
  float n = fbmN(q, 4);
  float n2 = fbmN(q * vec3(2.5, 2.5, 3.5) + 7.0, 3) / 0.875;
  float streak = 0.35 + 1.25 * n * n + 0.35 * n2;
  gl_FragColor = vec4(vec3(clamp(streak / 2.5, 0.0, 1.0)), 1.0);
}
`;

export type Camera = { yaw: number; pitch: number; dist: number };

const B_CRIT = 2.598; // critical impact parameter (3√3/2 Rs)

export class BlackHoleGL {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private buf: WebGLBuffer | null;
  private cubes: WebGLTexture[] = [];
  private diskTex: WebGLTexture | null = null;
  readonly focal = 1.5;
  /** Two-way adaptive render scale (device pixels per CSS pixel). */
  readonly res: AdaptiveResolution;
  /** True when the sky was pre-rendered into cube maps. */
  readonly baked: boolean;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    const dpr = window.devicePixelRatio || 1;
    this.res = new AdaptiveResolution(Math.min(dpr, 1.5) * 0.92, 0.5, Math.min(dpr, 2));

    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    // Pre-render the static sky once; fall back to computing it per pixel if that fails
    let baked = false;
    try {
      this.cubes = [this.bakeCube(0, 512), this.bakeCube(1, 1024)];
      this.diskTex = this.bakeDisk(2048, 256);
      baked = true;
    } catch (err) {
      console.warn('VOID: sky pre-render unavailable, computing it live', err);
      this.cubes.forEach((t) => gl.deleteTexture(t));
      this.cubes = [];
      if (this.diskTex) gl.deleteTexture(this.diskTex);
      this.diskTex = null;
    }
    this.baked = baked;

    this.prog = this.link((baked ? '#define BAKED\n' : '') + RANGES + MAIN_FRAG);
    gl.useProgram(this.prog);
    for (const n of ['uCenter', 'uMin', 'uTime', 'uCamPos', 'uRight', 'uUp', 'uFwd', 'uFocal', 'uPulse', 'uFade', 'uCharge', 'uPortal', 'uHover', 'uNeb', 'uHero', 'uDiskTex']) {
      this.u[n] = gl.getUniformLocation(this.prog, n);
    }
    if (baked) {
      gl.uniform1i(this.u.uNeb!, 0);
      gl.uniform1i(this.u.uHero!, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cubes[0]!);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.cubes[1]!);
      gl.uniform1i(this.u.uDiskTex!, 2);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.diskTex);
    }
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type);
    if (!s) throw new Error('shader');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'compile failed');
    return s;
  }

  private link(frag: string): WebGLProgram {
    const gl = this.gl;
    const prog = gl.createProgram();
    if (!prog) throw new Error('program');
    gl.attachShader(prog, this.compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, this.compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    return prog;
  }

  /** Render one sky layer (0 = nebula/band/small galaxies, 1 = large galaxies) into a mipmapped cube map. */
  private bakeCube(mode: number, size: number): WebGLTexture {
    const gl = this.gl;
    const prog = this.link(RANGES + BAKE_FRAG);
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    if (!tex || !fb) throw new Error('cube alloc');
    try {
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
      for (let f = 0; f < 6; f++) {
        gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.useProgram(prog);
      gl.uniform1f(gl.getUniformLocation(prog, 'uSize'), size);
      gl.uniform1f(gl.getUniformLocation(prog, 'uMode'), mode);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.viewport(0, 0, size, size);
      for (let f = 0; f < 6; f++) {
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('cube framebuffer incomplete');
        gl.uniform1f(gl.getUniformLocation(prog, 'uFace'), f);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
      gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return tex;
    } catch (err) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteTexture(tex);
      throw err;
    } finally {
      gl.deleteFramebuffer(fb);
      gl.deleteProgram(prog);
    }
  }

  /** Accretion-disk turbulence in its co-rotating frame: x = angle (wraps), y = radius. */
  private bakeDisk(w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const prog = this.link(DISK_BAKE_FRAG);
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    if (!tex || !fb) throw new Error('disk alloc');
    try {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // No mipmaps: the angle wraps at atan's branch cut, which would pick a blurry mip there
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('disk framebuffer incomplete');
      gl.useProgram(prog);
      gl.uniform2f(gl.getUniformLocation(prog, 'uSize'), w, h);
      gl.viewport(0, 0, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return tex;
    } catch (err) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteTexture(tex);
      throw err;
    } finally {
      gl.deleteFramebuffer(fb);
      gl.deleteProgram(prog);
    }
  }

  /** On-screen radius (CSS px) of the shadow for a camera at distance `dist`. */
  shadowRadius(dist: number, minSide: number): number {
    const alpha = Math.asin(Math.min(0.99, B_CRIT / dist));
    return Math.tan(alpha) * this.focal * minSide;
  }

  render(o: {
    w: number;
    h: number;
    dpr: number;
    cx: number;
    cy: number;
    time: number;
    cam: Camera;
    pulse: number;
    fade: number;
    charge: number;
    portal: number;
    hover: number;
    scale?: number;
  }): void {
    const gl = this.gl;
    const s = this.res.scale * (o.scale ?? 1);
    const W = Math.max(2, Math.round(o.w * s));
    const H = Math.max(2, Math.round(o.h * s));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);

    const { yaw, pitch, dist } = o.cam;
    const cp = Math.cos(pitch);
    const pos: [number, number, number] = [dist * cp * Math.sin(yaw), dist * Math.sin(pitch), dist * cp * Math.cos(yaw)];
    const fwd = norm([-pos[0], -pos[1], -pos[2]]);
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);

    gl.uniform2f(this.u.uCenter!, o.cx * s, (o.h - o.cy) * s);
    gl.uniform1f(this.u.uMin!, Math.min(o.w, o.h) * s);
    gl.uniform1f(this.u.uTime!, o.time);
    gl.uniform3fv(this.u.uCamPos!, pos);
    gl.uniform3fv(this.u.uRight!, right);
    gl.uniform3fv(this.u.uUp!, up);
    gl.uniform3fv(this.u.uFwd!, fwd);
    gl.uniform1f(this.u.uFocal!, this.focal);
    gl.uniform1f(this.u.uPulse!, o.pulse);
    gl.uniform1f(this.u.uFade!, o.fade);
    gl.uniform1f(this.u.uCharge!, o.charge);
    gl.uniform1f(this.u.uPortal!, o.portal);
    gl.uniform1f(this.u.uHover!, o.hover);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy(): void {
    this.cubes.forEach((t) => this.gl.deleteTexture(t));
    this.cubes = [];
    if (this.diskTex) this.gl.deleteTexture(this.diskTex);
    this.diskTex = null;
    this.gl.deleteBuffer(this.buf);
    this.gl.deleteProgram(this.prog);
  }
}

type V3 = [number, number, number];
function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
