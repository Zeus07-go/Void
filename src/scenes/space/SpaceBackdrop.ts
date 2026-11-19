// Living space behind Universe 02: flowing nebula, parallax star layers, shooting stars,
// a gentle swirl around the pointer and spacetime shockwaves on every tap.
// One fullscreen shader, one rAF loop; nothing per-frame touches React.

import { AdaptiveResolution } from '../../engine/adaptive';

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const MAX_SHOCKS = 4;

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uPointer;
uniform float uPointerOn;
uniform vec2 uPar;
uniform vec4 uShock[${MAX_SHOCKS}];

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = r * p * 2.03 + 1.7;
    a *= 0.5;
  }
  return s;
}

vec3 starLayer(vec2 p, float density, float size, float t) {
  vec2 id = floor(p);
  float h = hash12(id);
  if (h > density) return vec3(0.0);
  vec2 c = vec2(hash12(id + 3.1), hash12(id + 7.7)) * 0.6 + 0.2;
  vec2 d = fract(p) - c;
  float b = exp(-dot(d, d) / (size * size));
  float k = hash12(id + 11.3);
  float tw = 0.65 + 0.35 * sin(t * (0.8 + k * 2.5) + h * 60.0);
  vec3 tint = k < 0.2 ? vec3(0.75, 0.7, 1.0) : k < 0.45 ? vec3(0.7, 0.85, 1.0) : vec3(1.0, 0.97, 1.0);
  return tint * b * tw * (0.5 + 1.5 * pow(hash12(id + 5.9), 3.0));
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5 * uRes) / uRes.y;

  // Spacetime shockwaves from taps: a travelling ring that refracts everything behind it
  vec2 disp = vec2(0.0);
  float ring = 0.0;
  for (int i = 0; i < ${MAX_SHOCKS}; i++) {
    vec4 s = uShock[i];
    if (s.w <= 0.0) continue;
    vec2 c = (s.xy - 0.5 * uRes) / uRes.y;
    vec2 d = uv - c;
    float dist = length(d);
    float R = s.z * 0.75;
    float fade = 1.0 - smoothstep(0.0, 1.6, s.z);
    float band = exp(-pow((dist - R) / 0.04, 2.0)) * fade * s.w;
    disp += (d / max(dist, 1e-4)) * band * 0.03;
    ring += band;
  }

  // Gentle gravitational swirl around the pointer
  vec2 pc = (uPointer - 0.5 * uRes) / uRes.y;
  vec2 dp = uv - pc;
  float fall = exp(-dot(dp, dp) * 14.0) * uPointerOn;
  float ang = fall * 0.55;
  float ca = cos(ang);
  float sa = sin(ang);
  vec2 sw = pc + vec2(ca * dp.x - sa * dp.y, sa * dp.x + ca * dp.y);
  vec2 p = sw + disp;

  // Flowing nebula (domain-warped noise drifting slowly)
  float t = uTime * 0.025;
  vec2 q = p * 1.25 + uPar * 0.035;
  vec2 w1 = vec2(fbm(q + vec2(t, -0.7 * t)), fbm(q + vec2(5.2, 1.3) - t));
  float n = fbm(q + 1.8 * w1 + vec2(-0.5 * t, 0.3 * t));
  float n2 = fbm(q * 2.1 - w1 + 3.0 + t * 0.4);

  vec3 col = vec3(0.02, 0.016, 0.07);
  vec3 violet = vec3(0.4, 0.22, 0.88);
  vec3 blue = vec3(0.12, 0.38, 0.9);
  vec3 magenta = vec3(0.85, 0.28, 0.8);
  col += mix(violet, blue, smoothstep(0.3, 0.8, n2)) * smoothstep(0.38, 0.95, n) * 0.38;
  col += magenta * smoothstep(0.55, 1.0, n * n2 * 1.7) * 0.2;
  col *= 0.72 + 0.28 * smoothstep(0.2, 0.62, n2); // dark dust lanes
  col += violet * fall * 0.08; // faint glow where space is being stirred

  // Parallax star layers drifting at different depths
  float st = uTime;
  col += starLayer(p * 26.0 + uPar * 0.25 + vec2(st * 0.06, st * 0.015), 0.22, 0.06, st) * 0.45;
  col += starLayer(p * 14.0 + uPar * 0.55 + vec2(st * 0.11, st * 0.03), 0.16, 0.07, st) * 0.75;
  col += starLayer(p * 7.0 + uPar * 1.1 + vec2(st * 0.2, st * 0.05), 0.09, 0.075, st) * 1.2;

  // Shooting stars: one every few seconds, on a random path
  for (int k = 0; k < 2; k++) {
    float period = 6.0 + float(k) * 3.7;
    float id = floor((uTime + float(k) * 2.3) / period);
    float lt = mod(uTime + float(k) * 2.3, period);
    if (lt < 1.1) {
      vec2 start = vec2(hash12(vec2(id, 1.0 + float(k))) * 1.8 - 0.9, 0.2 + hash12(vec2(id, 7.0)) * 0.35);
      float a = -0.35 - hash12(vec2(id, 3.0)) * 0.5;
      // falls diagonally downward, to the left or right
      float side = hash12(vec2(id, 5.0)) > 0.5 ? 1.0 : -1.0;
      vec2 dir = normalize(vec2(side * cos(a), -abs(sin(a))));
      vec2 head = start + dir * lt * 1.1;
      vec2 rel = uv - head;
      float along = dot(rel, -dir);
      float across = length(rel + dir * along);
      float tail = smoothstep(0.32, 0.0, along) * step(0.0, along);
      float life = sin(3.14159 * clamp(lt / 1.1, 0.0, 1.0));
      col += vec3(0.85, 0.9, 1.0) * exp(-across * across / 0.000012) * tail * life * 0.9;
    }
  }

  col += vec3(0.55, 0.48, 1.0) * ring * 0.22;

  // Vignette and gentle tonemap
  col *= 1.0 - 0.45 * smoothstep(0.45, 1.25, length(uv));
  col = 1.0 - exp(-col * 1.5);
  gl_FragColor = vec4(col, 1.0);
}
`;

type Shock = { x: number; y: number; age: number; strength: number };

export class SpaceBackdrop {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private buf: WebGLBuffer | null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private raf = 0;
  private last = 0;
  private time = 0;
  private running = false;
  private paused = false;
  private still = false;
  private reduced: boolean;
  private w = 0;
  private h = 0;
  private scale = 1;
  private res = new AdaptiveResolution(Math.min(window.devicePixelRatio || 1, 1.5) * 0.85, 0.45, Math.min(window.devicePixelRatio || 1, 1.5));
  private pointer = { x: 0, y: 0, tx: 0, ty: 0, on: 0, target: 0 };
  private par = { x: 0, y: 0, tx: 0, ty: 0 };
  private shocks: Shock[] = [];
  private shockData = new Float32Array(MAX_SHOCKS * 4);

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) throw new Error('shader');
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'compile');
      return s;
    };
    const prog = gl.createProgram();
    if (!prog) throw new Error('program');
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    this.prog = prog;
    gl.useProgram(prog);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uRes', 'uTime', 'uPointer', 'uPointerOn', 'uPar', 'uShock']) this.u[n] = gl.getUniformLocation(prog, n);

    this.time = 40 + Math.random() * 100; // start mid-flow so the nebula is already shaped
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('pointermove', this.onMove, { passive: true });
    window.addEventListener('pointerdown', this.onDown, { passive: true });
    window.addEventListener('pointerup', this.onUp, { passive: true });
    document.addEventListener('pointerleave', this.onUp);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Paused: nothing renders (e.g. fully covered). */
  setPaused(p: boolean): void {
    if (p === this.paused) return;
    this.paused = p;
    cancelAnimationFrame(this.raf);
    if (!p && this.running && !document.hidden) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  /** Still: space stops drifting but stays on screen and still answers touches. */
  setStill(s: boolean): void {
    this.still = s;
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    document.removeEventListener('pointerleave', this.onUp);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.gl.deleteBuffer(this.buf);
    this.gl.deleteProgram(this.prog);
  }

  private readonly resize = (): void => {
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width || window.innerWidth;
    this.h = r.height || window.innerHeight;
    // Adaptive: sharp when the GPU has headroom, softer (the nebula hides it) under load
    this.scale = this.res.scale;
    this.canvas.width = Math.max(2, Math.round(this.w * this.scale));
    this.canvas.height = Math.max(2, Math.round(this.h * this.scale));
    if (this.paused || !this.running) this.renderOnce();
  };

  private readonly onVisibility = (): void => {
    cancelAnimationFrame(this.raf);
    if (!document.hidden && this.running && !this.paused) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.local(e);
    this.pointer.tx = p.x;
    this.pointer.ty = p.y;
    if (this.pointer.target === 0) {
      this.pointer.x = p.x;
      this.pointer.y = p.y;
    }
    this.pointer.target = e.pointerType === 'mouse' || e.buttons ? 1 : 0;
    this.par.tx = (p.x / Math.max(1, this.w) - 0.5) * 2;
    this.par.ty = (p.y / Math.max(1, this.h) - 0.5) * 2;
  };

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.local(e);
    this.pointer.target = 1;
    this.pointer.tx = this.pointer.x = p.x;
    this.pointer.ty = this.pointer.y = p.y;
    if (this.reduced) return;
    if (this.shocks.length >= MAX_SHOCKS) this.shocks.shift();
    this.shocks.push({ x: p.x, y: p.y, age: 0, strength: 1 });
  };

  private readonly onUp = (e: Event): void => {
    if (e instanceof PointerEvent && e.pointerType === 'mouse' && e.type === 'pointerup') return;
    this.pointer.target = 0;
  };

  private readonly frame = (now: number): void => {
    if (!this.running || this.paused) return;
    this.raf = requestAnimationFrame(this.frame);
    const rawMs = now - this.last;
    const dt = Math.min(0.05, Math.max(0, rawMs / 1000));
    this.last = now;
    if (this.res.sample(rawMs, dt)) this.resize();
    if (!this.still && !this.reduced) this.time += dt;
    const k = Math.min(1, dt * 6);
    this.pointer.x += (this.pointer.tx - this.pointer.x) * k;
    this.pointer.y += (this.pointer.ty - this.pointer.y) * k;
    this.pointer.on += (this.pointer.target - this.pointer.on) * Math.min(1, dt * 2.5);
    const kp = Math.min(1, dt * 2);
    this.par.x += (this.par.tx - this.par.x) * kp;
    this.par.y += (this.par.ty - this.par.y) * kp;
    for (const s of this.shocks) s.age += dt;
    this.shocks = this.shocks.filter((s) => s.age < 1.6);
    this.renderOnce();
  };

  private renderOnce(): void {
    const gl = this.gl;
    const s = this.scale;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.uRes!, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.uTime!, this.time);
    gl.uniform2f(this.u.uPointer!, this.pointer.x * s, (this.h - this.pointer.y) * s);
    gl.uniform1f(this.u.uPointerOn!, this.reduced ? 0 : this.pointer.on);
    gl.uniform2f(this.u.uPar!, this.reduced ? 0 : this.par.x, this.reduced ? 0 : -this.par.y);
    this.shockData.fill(0);
    this.shocks.forEach((sh, i) => {
      this.shockData[i * 4] = sh.x * s;
      this.shockData[i * 4 + 1] = (this.h - sh.y) * s;
      this.shockData[i * 4 + 2] = sh.age;
      this.shockData[i * 4 + 3] = sh.strength;
    });
    gl.uniform4fv(this.u.uShock!, this.shockData);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
