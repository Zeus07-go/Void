// The multiverse tunnel: one fullscreen procedural shader drawn on an overlay canvas,
// active only during a jump. A light 2D backend covers reduced motion / no WebGL.

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uCenter;
uniform float uScale;
uniform float uDpr;
uniform float uTravel;
uniform float uSpeed;
uniform float uPal;
uniform float uRev;
uniform float uMaskR;
uniform float uHoleR;
uniform float uAlpha;
uniform float uTime;

const float TAU = 6.2831853;

vec3 palForward(float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  vec3 a = vec3(1.0, 0.64, 0.26);  // warm amber
  vec3 b = vec3(0.98, 0.34, 0.08); // burnt orange
  vec3 c = vec3(0.56, 0.22, 1.0);  // electric violet
  vec3 d = vec3(1.0, 0.18, 0.7);   // magenta
  vec3 e = vec3(0.16, 0.7, 1.0);   // cyan-blue
  if (t < 1.0) return mix(a, b, t);
  if (t < 2.0) return mix(b, c, t - 1.0);
  if (t < 3.0) return mix(c, d, t - 2.0);
  return mix(d, e, t - 3.0);
}

vec3 palReverse(float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  vec3 a = vec3(0.56, 0.22, 1.0);  // violet
  vec3 b = vec3(1.0, 0.18, 0.7);   // magenta
  vec3 c = vec3(0.16, 0.7, 1.0);   // cyan
  vec3 d = vec3(1.0, 0.64, 0.26);  // amber
  vec3 e = vec3(0.35, 0.18, 0.08); // toward black
  if (t < 1.0) return mix(a, b, t);
  if (t < 2.0) return mix(b, c, t - 1.0);
  if (t < 3.0) return mix(c, d, t - 2.0);
  return mix(d, e, t - 3.0);
}

vec3 pal(float t) { return uRev > 0.5 ? palReverse(t) : palForward(t); }

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Radius measured in an n-gon metric, so rings become polygons
float polyRadius(vec2 p, float n, float rot) {
  float a = atan(p.y, p.x) + rot;
  float seg = TAU / n;
  float q = mod(a, seg) - seg * 0.5;
  return length(p) * cos(q) / cos(seg * 0.5);
}

// Polygon rings receding to the vanishing point (one colour channel's worth)
float ringField(vec2 p, float travel) {
  float sides = 6.0;
  float rr = polyRadius(p, sides, travel * 0.12 + 0.4);
  float z = 0.32 / (rr + 0.015) - travel * 1.7;
  // thin bright edge where each ring cell begins (|fract - 0.5| → 0.5)
  float line = smoothstep(0.4, 0.5, abs(fract(z) - 0.5));
  float r2 = polyRadius(p, 4.0, -travel * 0.2);
  float z2 = 0.32 / (r2 + 0.015) - travel * 1.15 + 0.5;
  float line2 = smoothstep(0.44, 0.5, abs(fract(z2) - 0.5)) * 0.55;
  float fade = smoothstep(0.0, 0.08, length(p));
  return (line + line2) * fade;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float rp = length(frag - uCenter);
  float open = smoothstep(uMaskR, uMaskR - 30.0 * uDpr, rp);
  float reveal = smoothstep(uHoleR - 60.0 * uDpr, uHoleR, rp);
  float vis = open * reveal * uAlpha;

  // Glowing, colour-split rims where the horizon is crossed and where the destination opens
  float rimW = 10.0 * uDpr;
  vec3 rim = vec3(
    exp(-pow((rp - uMaskR - 5.0 * uDpr) / rimW, 2.0)),
    exp(-pow((rp - uMaskR) / rimW, 2.0)),
    exp(-pow((rp - uMaskR + 5.0 * uDpr) / rimW, 2.0)));
  rim *= step(1.0, uMaskR) * (1.0 - step(uScale * 2.5, uMaskR));
  vec3 rim2 = vec3(
    exp(-pow((rp - uHoleR - 6.0 * uDpr) / (rimW * 1.6), 2.0)),
    exp(-pow((rp - uHoleR) / (rimW * 1.6), 2.0)),
    exp(-pow((rp - uHoleR + 6.0 * uDpr) / (rimW * 1.6), 2.0)));
  rim2 *= step(1.0, uHoleR);
  vec3 rimCol = (rim * vec3(1.0, 0.75, 1.1) + rim2 * pal(uPal + 0.1) * 1.4) * uAlpha;

  if (vis < 0.002) {
    vec3 c = 1.0 - exp(-rimCol * 1.6);
    gl_FragColor = vec4(c, max(max(c.r, c.g), c.b));
    return;
  }

  vec2 p = (frag - uCenter) / uScale;
  float r = length(p);
  float a = atan(p.y, p.x);
  float z = 0.32 / (r + 0.015);
  float tr = uTravel;

  // Deep tunnel body
  vec3 col = mix(vec3(0.02, 0.01, 0.04), pal(uPal + 0.2) * 0.22, smoothstep(0.5, 6.0, z));

  // Chromatic polygon rings
  float split = 0.006 + 0.02 * uSpeed;
  vec3 ringCol = pal(uPal + fract(floor(z * 0.6 - tr * 1.02) * 0.137) * 0.3);
  col.r += ringField(p * (1.0 + split), tr) * ringCol.r;
  col.g += ringField(p, tr) * ringCol.g;
  col.b += ringField(p * (1.0 - split), tr) * ringCol.b;

  // Flowing energy ribbons spiralling down the tunnel
  float rib1 = smoothstep(0.93, 1.0, sin(a * 3.0 + z * 1.6 - tr * 4.0));
  float rib2 = smoothstep(0.95, 1.0, sin(-a * 2.0 + z * 2.3 - tr * 5.0 + 1.3));
  float ribFade = smoothstep(0.02, 0.2, r) * smoothstep(1.6, 0.4, r);
  col += pal(uPal + 0.15) * rib1 * ribFade * 0.9;
  col += pal(uPal + 0.35) * rib2 * ribFade * 0.7;

  // Angular shard panels on the tunnel wall
  vec2 cell = vec2(floor((a / TAU + 0.5) * 12.0), floor(z * 1.4 - tr * 1.7));
  float hc = hash21(cell);
  float panel = step(0.86, hc) * smoothstep(0.05, 0.25, r);
  col += pal(uPal + hc * 0.4) * panel * 0.16;

  // Stars stretched into light trails
  float sectors = 260.0;
  float sv = (a / TAU + 0.5) * sectors;
  float sid = floor(sv);
  float h = hash11(sid);
  float aw = abs(fract(sv) - 0.5);
  float zs = fract(z * 0.22 + h * 7.0 - tr * (0.5 + h * 0.6));
  float len = 0.04 + 0.32 * uSpeed;
  float streak = smoothstep(len, 0.0, zs) * smoothstep(0.5, 0.05, aw) * step(0.55, h);
  col += mix(vec3(1.0, 0.96, 0.9), pal(uPal + h * 0.3), 0.35) * streak * smoothstep(0.03, 0.3, r) * 1.1;

  // Vanishing-point glow
  col += pal(uPal + 0.3) * exp(-r * r * 30.0) * 1.1 + vec3(1.0, 0.95, 0.9) * exp(-r * r * 500.0) * 0.8;

  // Comic halftone texture modulated by brightness
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  vec2 hp = fract(frag / (6.0 * uDpr)) - 0.5;
  float dotMask = step(length(hp), 0.18 + 0.32 * clamp(lum, 0.0, 1.0));
  col *= 0.86 + 0.22 * dotMask;

  col = 1.0 - exp(-col * 1.7);
  vec3 outc = col * vis + (1.0 - exp(-rimCol * 1.6));
  float outA = clamp(vis + max(max(rimCol.r, rimCol.g), rimCol.b), 0.0, 1.0);
  gl_FragColor = vec4(outc, outA);
}
`;

export type TunnelFrame = {
  w: number;
  h: number;
  dpr: number;
  cx: number;
  cy: number;
  time: number;
  travel: number;
  speed: number;
  pal: number;
  reverse: boolean;
  maskR: number; // CSS px — tunnel visible inside this radius
  holeR: number; // CSS px — destination revealed inside this radius
  alpha: number;
};

interface Backend {
  render(f: TunnelFrame): void;
  clear(): void;
  destroy(): void;
}

class GLBackend implements Backend {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private buf: WebGLBuffer | null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private quality: number;

  constructor(private canvas: HTMLCanvasElement, quality: number) {
    this.quality = quality;
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
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
    for (const n of ['uCenter', 'uScale', 'uDpr', 'uTravel', 'uSpeed', 'uPal', 'uRev', 'uMaskR', 'uHoleR', 'uAlpha', 'uTime']) {
      this.u[n] = gl.getUniformLocation(prog, n);
    }
  }

  render(f: TunnelFrame): void {
    const gl = this.gl;
    const s = Math.min(f.dpr, 1.5) * this.quality;
    const W = Math.max(2, Math.round(f.w * s));
    const H = Math.max(2, Math.round(f.h * s));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    gl.uniform2f(this.u.uCenter!, f.cx * s, (f.h - f.cy) * s);
    gl.uniform1f(this.u.uScale!, Math.min(f.w, f.h) * s);
    gl.uniform1f(this.u.uDpr!, s);
    gl.uniform1f(this.u.uTravel!, f.travel);
    gl.uniform1f(this.u.uSpeed!, f.speed);
    gl.uniform1f(this.u.uPal!, f.pal);
    gl.uniform1f(this.u.uRev!, f.reverse ? 1 : 0);
    gl.uniform1f(this.u.uMaskR!, f.maskR * s);
    gl.uniform1f(this.u.uHoleR!, f.holeR * s);
    gl.uniform1f(this.u.uAlpha!, f.alpha);
    gl.uniform1f(this.u.uTime!, f.time);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  clear(): void {
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  destroy(): void {
    this.gl.deleteBuffer(this.buf);
    this.gl.deleteProgram(this.prog);
  }
}

/** Restrained fallback: concentric rings and a calm colour shift. */
class SimpleBackend implements Backend {
  private ctx: CanvasRenderingContext2D;
  constructor(private canvas: HTMLCanvasElement) {
    const c = canvas.getContext('2d');
    if (!c) throw new Error('2D unavailable');
    this.ctx = c;
  }

  render(f: TunnelFrame): void {
    const dpr = Math.min(f.dpr, 2);
    const W = Math.round(f.w * dpr);
    const H = Math.round(f.h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, f.w, f.h);
    const [r, gg, b] = simplePalette(f.pal, f.reverse);
    g.save();
    g.beginPath();
    g.arc(f.cx, f.cy, Math.max(0, f.maskR), 0, Math.PI * 2);
    if (f.holeR > 0) g.arc(f.cx, f.cy, f.holeR, 0, Math.PI * 2, true);
    g.clip();
    const grad = g.createRadialGradient(f.cx, f.cy, 0, f.cx, f.cy, Math.hypot(f.w, f.h) / 2);
    grad.addColorStop(0, `rgba(${r},${gg},${b},${0.55 * f.alpha})`);
    grad.addColorStop(1, `rgba(8,5,16,${f.alpha})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, f.w, f.h);
    const maxR = Math.hypot(f.w, f.h) / 2;
    for (let i = 0; i < 6; i++) {
      const k = (i / 6 + f.travel * 0.25) % 1;
      const rr = Math.pow(k, 2) * maxR;
      g.strokeStyle = `rgba(${r},${gg},${b},${(1 - k) * 0.6 * f.alpha})`;
      g.lineWidth = 1 + k * 3;
      g.beginPath();
      g.arc(f.cx, f.cy, rr, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  clear(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  destroy(): void {
    this.clear();
  }
}

function simplePalette(t: number, reverse: boolean): [number, number, number] {
  const fwd: [number, number, number][] = [
    [255, 163, 66],
    [250, 87, 20],
    [143, 56, 255],
    [255, 46, 178],
    [41, 178, 255],
  ];
  const stops = reverse ? [fwd[2]!, fwd[3]!, fwd[4]!, fwd[0]!, [40, 22, 10] as [number, number, number]] : fwd;
  const x = Math.min(0.999, Math.max(0, t)) * 4;
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
}

export class PortalTunnel {
  private backend: Backend | null = null;
  private simple: boolean;

  constructor(private canvas: HTMLCanvasElement, simple: boolean) {
    this.simple = simple;
  }

  get isSimple(): boolean {
    return this.simple;
  }

  /** Created lazily on first jump and reused afterwards. */
  private ensure(): Backend {
    if (this.backend) return this.backend;
    if (!this.simple) {
      try {
        this.backend = new GLBackend(this.canvas, 0.85);
        return this.backend;
      } catch (err) {
        console.warn('VOID: tunnel shader unavailable, using simple transition', err);
        this.simple = true;
      }
    }
    this.backend = new SimpleBackend(this.canvas);
    return this.backend;
  }

  render(f: TunnelFrame): void {
    this.ensure().render(f);
  }

  warm(): void {
    this.ensure().clear();
  }

  clear(): void {
    this.backend?.clear();
  }

  destroy(): void {
    this.backend?.destroy();
    this.backend = null;
  }
}
