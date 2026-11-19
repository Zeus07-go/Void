// KaleidoscopeEngine — the single animation loop for Universe 02.
// Canvas 2D only. Zero React renders per frame. All state is mutable.

import { ParticleSystem } from './ParticleSystem';
import { RippleSystem } from './RippleSystem';
import {
  type SymmetryFold,
  type SymmetryTransform,
  buildTransforms,
  applyTransform,
} from './SymmetryEngine';
import {
  type PaletteName,
  PALETTES,
  pickColor,
} from './PaletteConfig';

// ─── constants ────────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;
const MAX_TRAIL_POINTS = 120;
const MAX_TRAILS = 40;
const BLOOM_MAX_R = 160;
const BLOOM_ORBIT_COUNT = 24;
const DUST_COUNT = 320;
const MAX_DPR = 2;

// ─── types ────────────────────────────────────────────────────────────────────

export type InteractionMode = 'paint' | 'bloom';

interface TrailPoint {
  x: number;
  y: number;
  age: number; // seconds since emitted
}

interface Trail {
  points: TrailPoint[];
  color: string;
  width: number;
  dead: boolean;
  age: number;
}

interface BloomOrb {
  angle: number;
  speed: number;
  r: number;
  colorIdx: number;
}

interface BloomState {
  active: boolean;
  x: number;
  y: number;
  radius: number;
  orbits: BloomOrb[];
  bursting: boolean;
  burstT: number;
  burstR: number;
}

export interface EngineCallbacks {
  onFirstPaint?: () => void;
}

// ─── mulberry32 PRNG (same seed as render.ts for determinism) ─────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorWithAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

// ─── background cache ─────────────────────────────────────────────────────────

function buildBackground(w: number, h: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);

  // Base deep black-indigo
  g.fillStyle = '#050412';
  g.fillRect(0, 0, w, h);

  const max = Math.max(w, h);

  // Nebula clouds
  const neb = (x: number, y: number, r: number, col: string) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  };
  neb(w * 0.2, h * 0.25, max * 0.6, 'rgba(139,92,246,0.11)');   // violet top-left
  neb(w * 0.82, h * 0.75, max * 0.5, 'rgba(56,189,248,0.07)');  // blue bottom-right
  neb(w * 0.6, h * 0.15, max * 0.38, 'rgba(232,121,249,0.06)'); // magenta top
  neb(w * 0.1, h * 0.8, max * 0.42, 'rgba(56,189,248,0.055)'); // blue bottom-left
  neb(w * 0.5, h * 0.5, max * 0.7, 'rgba(17,16,42,0.45)');      // deep indigo center vignette

  // Starfield
  const rng = mulberry32(99);
  const starCount = Math.min(800, Math.floor((w * h) / 2200));
  for (let i = 0; i < starCount; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const layer = rng();
    let r: number, a: number;
    if (layer < 0.75) { r = 0.3 + rng() * 0.4; a = 0.1 + rng() * 0.28; }
    else if (layer < 0.95) { r = 0.5 + rng() * 0.5; a = 0.25 + rng() * 0.35; }
    else { r = 0.8 + rng() * 0.65; a = 0.6 + rng() * 0.35; }

    const hue = rng();
    const col = hue < 0.2 ? '200,180,255' : hue < 0.45 ? '180,220,255' : '240,238,255';

    if (r > 0.85) {
      // Bright star with tiny halo
      const gr = g.createRadialGradient(x, y, 0, x, y, r * 6);
      gr.addColorStop(0, `rgba(${col},0.28)`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
    }
    g.fillStyle = `rgba(${col},${a})`;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }

  // Edge vignette
  const vig = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, max * 0.78);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(2,2,10,0.65)');
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);

  return c;
}

// ─── main engine class ────────────────────────────────────────────────────────

export class KaleidoscopeEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cb: EngineCallbacks;

  private dpr = 1;
  private w = 0;
  private h = 0;
  private cx = 0;
  private cy = 0;

  private bg: HTMLCanvasElement | null = null;

  // Rendering state
  private trails: Trail[] = [];
  private paintCanvas: HTMLCanvasElement;
  private paintCtx: CanvasRenderingContext2D;

  // Systems
  private readonly particles: ParticleSystem;
  private readonly ripples: RippleSystem;

  // Interaction state
  private painting = false;
  private currentTrail: Trail | null = null;
  private lastPaintX = 0;
  private lastPaintY = 0;
  private colorCycle = 0;
  private pointerX = 0;
  private pointerY = 0;
  private pointerMoving = false;
  private pointerMoveTimer = 0;
  private firstPaint = false;

  // Bloom
  private bloom: BloomState = {
    active: false, x: 0, y: 0, radius: 0,
    orbits: [], bursting: false, burstT: 0, burstR: 0,
  };
  private bloomColorIdx = 0;

  // Settings
  private symmetry: SymmetryFold = 6;
  private transforms: SymmetryTransform[] = [];
  private palette: PaletteName = 'violet';
  private mode: InteractionMode = 'paint';
  private still = false;
  private reduced = false;

  // Animation
  private raf = 0;
  private last = 0;
  private running = false;
  private clock = 0;
  private introT = 0;

  // Arrival pulse
  private arrivalPulse = 1;
  private arrivalR = 0;
  private transparentBg = false;

  constructor(
    canvas: HTMLCanvasElement,
    cb: EngineCallbacks = {},
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
    this.cb = cb;

    this.reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.particles = new ParticleSystem();
    this.ripples = new RippleSystem();

    // Offscreen canvas that accumulates painted trails (persists until clear)
    this.paintCanvas = document.createElement('canvas');
    this.paintCtx = this.paintCanvas.getContext('2d')!;

    this.transforms = buildTransforms(this.symmetry);

    this.resize();
    this.seedDust();

    // Trigger arrival pulse
    this.arrivalPulse = 1;
    this.arrivalR = 0;
  }

  // ── public API ──────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    this.canvas.removeEventListener('contextmenu', this.prevent);
  }

  attachEvents(): void {
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onCancel);
    this.canvas.addEventListener('contextmenu', this.prevent);
  }

  setSymmetry(fold: SymmetryFold): void {
    this.symmetry = fold;
    this.transforms = buildTransforms(fold);
  }

  setPalette(p: PaletteName): void {
    this.palette = p;
  }

  setMode(m: InteractionMode): void {
    this.mode = m;
  }

  /** Let a backdrop layer behind the canvas show through (the static starfield is skipped). */
  setTransparentBackground(on: boolean): void {
    this.transparentBg = on;
  }

  setStill(s: boolean): void {
    this.still = s;
  }

  clearPainting(): void {
    // Dissolve trails by fading the paint canvas out
    this.trails = [];
    // Animated fade: draw a semi-transparent rect each frame until clear
    this._clearingPaint = true;
    this._clearAlpha = 1;
  }

  private _clearingPaint = false;
  private _clearAlpha = 0;

  // ── resize ───────────────────────────────────────────────────────────────────

  private readonly onResize = (): void => this.resize();

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.w = w;
    this.h = h;
    this.cx = w / 2;
    this.cy = h / 2;

    this.bg = buildBackground(w, h, this.dpr);

    // Resize paint canvas and preserve content
    const old = this.paintCanvas;
    this.paintCanvas = document.createElement('canvas');
    this.paintCanvas.width = Math.round(w * this.dpr);
    this.paintCanvas.height = Math.round(h * this.dpr);
    this.paintCtx = this.paintCanvas.getContext('2d')!;
    this.paintCtx.scale(this.dpr, this.dpr);
    if (old.width > 0 && old.height > 0) {
      this.paintCtx.drawImage(old, 0, 0, w, h);
    }
  }

  private seedDust(): void {
    const rng = mulberry32(17);
    this.particles.seedDust(this.w || window.innerWidth, this.h || window.innerHeight, DUST_COUNT, rng);
  }

  // ── input handlers ────────────────────────────────────────────────────────

  private readonly prevent = (e: Event) => e.preventDefault();

  private local(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private readonly onDown = (e: PointerEvent): void => {
    e.preventDefault();
    const { x, y } = this.local(e);
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* best effort */ }

    if (this.mode === 'bloom') {
      this.startBloom(x, y);
      return;
    }

    // Paint mode
    this.painting = true;
    this.lastPaintX = x;
    this.lastPaintY = y;
    this.colorCycle++;

    const color = pickColor(this.palette, this.colorCycle);
    const trail: Trail = {
      points: [{ x, y, age: 0 }],
      color,
      width: 2.5 + Math.random() * 1.5,
      dead: false,
      age: 0,
    };
    this.currentTrail = trail;
    this.trails.push(trail);
    if (this.trails.length > MAX_TRAILS) {
      this.trails[0]!.dead = true;
      this.trails.shift();
    }

    if (!this.firstPaint) {
      this.firstPaint = true;
      this.cb.onFirstPaint?.();
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    const { x, y } = this.local(e);
    this.pointerX = x;
    this.pointerY = y;
    this.pointerMoving = true;
    this.pointerMoveTimer = 0.18;

    if (this.mode === 'bloom' && this.bloom.active && !this.bloom.bursting) {
      this.bloom.x = x;
      this.bloom.y = y;
      return;
    }

    if (!this.painting || !this.currentTrail) return;

    const dx = x - this.lastPaintX;
    const dy = y - this.lastPaintY;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return; // skip micro-moves

    // Smooth interpolation — add intermediate points for large jumps
    const steps = Math.min(8, Math.ceil(dist / 6));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = this.lastPaintX + dx * t;
      const py = this.lastPaintY + dy * t;
      this.currentTrail.points.push({ x: px, y: py, age: 0 });
      if (this.currentTrail.points.length > MAX_TRAIL_POINTS) {
        this.currentTrail.points.shift();
      }

      // Emit trail particles along each symmetry arm
      if (!this.reduced && Math.random() < 0.4) {
        const relX = px - this.cx;
        const relY = py - this.cy;
        for (const tf of this.transforms) {
          const tp = applyTransform(tf, relX, relY, this.cx, this.cy);
          this.particles.emit({
            x: tp.x + (Math.random() - 0.5) * 6,
            y: tp.y + (Math.random() - 0.5) * 6,
            vx: (Math.random() - 0.5) * 25,
            vy: (Math.random() - 0.5) * 25,
            life: 0.6 + Math.random() * 0.8,
            r: 0.8 + Math.random() * 1.2,
            colorIdx: this.colorCycle % 7,
            kind: 1,
          });
        }
      }
    }

    this.lastPaintX = x;
    this.lastPaintY = y;
  };

  private readonly onUp = (e: PointerEvent): void => {
    const { x, y } = this.local(e);

    if (this.mode === 'bloom' && this.bloom.active) {
      this.releaseBloom();
      return;
    }

    if (this.painting) {
      this.painting = false;
      this.currentTrail = null;
    } else {
      // Tap → ripple
      this.fireRipple(x, y);
    }

    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    } catch { /* best effort */ }
  };

  private readonly onCancel = (e: PointerEvent): void => {
    this.painting = false;
    this.currentTrail = null;
    if (this.bloom.active) this.releaseBloom();
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    } catch { /* best effort */ }
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
    } else if (this.running) {
      this.last = performance.now();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  // ── ripple ─────────────────────────────────────────────────────────────────

  private fireRipple(x: number, y: number): void {
    const maxR = Math.hypot(this.w, this.h) * 0.38;
    const palette = PALETTES[this.palette];
    const color = palette.colors[this.colorCycle % palette.colors.length]!;
    this.ripples.add(x, y, maxR, color);

    // Disturb nearby dust
    if (!this.reduced) {
      for (let i = 0; i < this.particles.capacity; i++) {
        if (this.particles.life[i]! <= 0 || this.particles.kind[i] !== 0) continue;
        const dx = this.particles.x[i]! - x;
        const dy = this.particles.y[i]! - y;
        const d = Math.hypot(dx, dy);
        if (d < 180 && d > 0.1) {
          const f = (1 - d / 180) * 55;
          this.particles.vx[i]! += (dx / d) * f;
          this.particles.vy[i]! += (dy / d) * f;
        }
      }
    }
  }

  // ── bloom ──────────────────────────────────────────────────────────────────

  private startBloom(x: number, y: number): void {
    this.bloomColorIdx = (this.bloomColorIdx + 1) % 7;
    const orbits: BloomOrb[] = [];
    for (let i = 0; i < BLOOM_ORBIT_COUNT; i++) {
      orbits.push({
        angle: (TAU / BLOOM_ORBIT_COUNT) * i,
        speed: 1.2 + Math.random() * 1.8,
        r: 18 + Math.random() * 22,
        colorIdx: (this.bloomColorIdx + i) % 7,
      });
    }
    this.bloom = { active: true, x, y, radius: 0, orbits, bursting: false, burstT: 0, burstR: 0 };
  }

  private releaseBloom(): void {
    if (!this.bloom.active || this.bloom.bursting) return;
    this.bloom.bursting = true;
    this.bloom.burstT = 0;
    this.bloom.burstR = this.bloom.radius;

    // Scatter particles in symmetrical bursts
    if (!this.reduced) {
      const relX = this.bloom.x - this.cx;
      const relY = this.bloom.y - this.cy;
      for (const tf of this.transforms) {
        const tp = applyTransform(tf, relX, relY, this.cx, this.cy);
        for (let i = 0; i < 18; i++) {
          const a = (TAU / 18) * i;
          const sp = 60 + Math.random() * 100;
          this.particles.emit({
            x: tp.x, y: tp.y,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 1.2 + Math.random() * 0.8,
            r: 1.2 + Math.random() * 1.8,
            colorIdx: (this.bloomColorIdx + i) % 7,
            kind: 1,
          });
        }
      }
    }
  }

  // ── frame loop ─────────────────────────────────────────────────────────────

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const rawMs = now - this.last;
    this.last = now;
    // rAF timestamps can precede the performance.now() recorded on resume: clamp at 0
    const dt = Math.max(0, Math.min(rawMs / 1000, 1 / 20));

    this.update(dt);
    this.draw();
  };

  private update(dt: number): void {
    this.clock += dt;
    this.introT = Math.min(1, this.introT + dt / 1.6);

    // Pointer moving cooldown
    if (this.pointerMoveTimer > 0) {
      this.pointerMoveTimer -= dt;
      if (this.pointerMoveTimer <= 0) this.pointerMoving = false;
    }

    if (!this.still) {
      // Arrival pulse expands outward from center
      if (this.arrivalPulse > 0) {
        this.arrivalR += dt * Math.max(this.w, this.h) * 0.7;
        this.arrivalPulse -= dt * 0.6;
      }

      this.particles.update(dt, this.pointerX, this.pointerY, this.pointerMoving);
      this.ripples.update(dt);

      // Respawn dead ambient dust
      const rng = mulberry32(Math.floor(this.clock * 60) & 0xffff);
      let dead = 0;
      for (let i = 0; i < this.particles.capacity; i++) {
        if (this.particles.kind[i] === 0 && this.particles.life[i]! <= 0) dead++;
      }
      if (dead > 60) {
        for (let i = 0; i < 4; i++) {
          const a = rng() * TAU;
          const sp = 4 + rng() * 16;
          this.particles.emit({
            x: rng() * this.w,
            y: rng() * this.h,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp,
            life: 5 + rng() * 10,
            r: 0.5 + rng() * 1.3,
            colorIdx: Math.floor(rng() * 7),
            kind: 0,
          });
        }
      }

      // Age trail points
      for (const trail of this.trails) {
        trail.age += dt;
        for (const pt of trail.points) pt.age += dt;
      }
      // Remove very old trails
      this.trails = this.trails.filter((t) => t.age < 18);

      // Bloom grow
      if (this.bloom.active && !this.bloom.bursting) {
        this.bloom.radius = Math.min(BLOOM_MAX_R, this.bloom.radius + dt * 55);
        for (const orb of this.bloom.orbits) {
          orb.angle += orb.speed * dt;
        }
      }
      if (this.bloom.bursting) {
        this.bloom.burstT += dt / 1.0;
        if (this.bloom.burstT >= 1) {
          this.bloom.active = false;
          this.bloom.bursting = false;
        }
      }
    }

    // Clear animation
    if (this._clearingPaint) {
      this._clearAlpha -= dt * 1.4;
      if (this._clearAlpha <= 0) {
        this._clearAlpha = 0;
        this._clearingPaint = false;
        this.paintCtx.clearRect(0, 0, this.paintCanvas.width, this.paintCanvas.height);
      }
    }
  }

  // ── draw ───────────────────────────────────────────────────────────────────

  private draw(): void {
    const g = this.ctx;
    const { w, h, dpr } = this;

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // Background — transparent when a live backdrop renders behind this canvas
    if (this.transparentBg) g.clearRect(0, 0, w, h);
    else if (this.bg) g.drawImage(this.bg, 0, 0, w, h);

    // Intro fade-in overlay
    if (this.introT < 1) {
      g.globalAlpha = 1 - easeOutCubic(this.introT);
      g.fillStyle = '#050412';
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 1;
    }

    // Arrival pulse ring
    if (this.arrivalPulse > 0 && !this.reduced) {
      const ap = clamp(this.arrivalPulse, 0, 1);
      g.save();
      g.globalAlpha = ap * 0.35;
      g.strokeStyle = `rgba(139,92,246,${ap * 0.7})`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(this.cx, this.cy, Math.max(0, this.arrivalR), 0, TAU);
      g.stroke();
      // second ring slightly smaller
      g.globalAlpha = ap * 0.2;
      g.beginPath();
      g.arc(this.cx, this.cy, Math.max(0, this.arrivalR * 0.72), 0, TAU);
      g.stroke();
      g.restore();
    }

    // Ambient nebula dust particles
    this.drawDust(g);

    // Ripples (drawn below the painting layer)
    this.drawRipples(g);

    // Paint canvas (accumulated trails, persistent)
    if (this._clearingPaint && this._clearAlpha > 0) {
      g.globalAlpha = this._clearAlpha;
    }
    g.drawImage(this.paintCanvas, 0, 0, w, h);
    g.globalAlpha = 1;

    // Live trails (currently being drawn — not yet baked)
    this.drawTrails(g);

    // Bloom
    if (this.bloom.active) this.drawBloom(g);

    // Trail particles (glow on top)
    this.drawTrailParticles(g);
  }

  private drawDust(g: CanvasRenderingContext2D): void {
    const palette = PALETTES[this.palette];
    for (let i = 0; i < this.particles.capacity; i++) {
      if (this.particles.life[i]! <= 0 || this.particles.kind[i] !== 0) continue;
      const frac = this.particles.life[i]! / this.particles.maxLife[i]!;
      const alpha = Math.min(frac, 1 - frac) * 2 * 0.45;
      if (alpha < 0.01) continue;
      const color = palette.colors[this.particles.colorIdx[i]! % palette.colors.length]!;
      const [r, gv, b] = hexToRgb(color);
      g.fillStyle = `rgba(${r},${gv},${b},${(alpha * 0.5).toFixed(3)})`;
      g.beginPath();
      g.arc(this.particles.x[i]!, this.particles.y[i]!, this.particles.r[i]!, 0, TAU);
      g.fill();
    }
  }

  private drawTrailParticles(g: CanvasRenderingContext2D): void {
    const palette = PALETTES[this.palette];
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.particles.capacity; i++) {
      if (this.particles.life[i]! <= 0 || this.particles.kind[i] !== 1) continue;
      const frac = this.particles.life[i]! / this.particles.maxLife[i]!;
      const alpha = frac * 0.7;
      if (alpha < 0.015) continue;
      const color = palette.colors[this.particles.colorIdx[i]! % palette.colors.length]!;
      const r = this.particles.r[i]! * (1 + (1 - frac) * 2);
      const [rv, gv, bv] = hexToRgb(color);
      const gr = g.createRadialGradient(
        this.particles.x[i]!, this.particles.y[i]!, 0,
        this.particles.x[i]!, this.particles.y[i]!, r * 3,
      );
      gr.addColorStop(0, `rgba(${rv},${gv},${bv},${alpha})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(this.particles.x[i]!, this.particles.y[i]!, r * 3, 0, TAU);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }

  private drawRipples(g: CanvasRenderingContext2D): void {
    for (const rip of this.ripples.active) {
      const ease = 1 - Math.pow(1 - rip.t, 3);
      const r = rip.maxR * ease;
      const alpha = (1 - rip.t) * 0.55;
      const [rv, gv, bv] = hexToRgb(rip.color);

      g.save();
      g.globalCompositeOperation = 'lighter';

      // Outer ring
      g.strokeStyle = `rgba(${rv},${gv},${bv},${(alpha * 0.5).toFixed(3)})`;
      g.lineWidth = 2.5;
      g.globalAlpha = 1;
      g.beginPath();
      g.arc(rip.x, rip.y, r, 0, TAU);
      g.stroke();

      // Middle ring
      if (rip.t > 0.1) {
        const r2 = r * 0.68;
        g.strokeStyle = `rgba(${rv},${gv},${bv},${(alpha * 0.35).toFixed(3)})`;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(rip.x, rip.y, r2, 0, TAU);
        g.stroke();
      }
      // Glow fill
      const gr = g.createRadialGradient(rip.x, rip.y, r * 0.85, rip.x, rip.y, r);
      gr.addColorStop(0, `rgba(${rv},${gv},${bv},${(alpha * 0.08).toFixed(3)})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(rip.x, rip.y, r, 0, TAU);
      g.fill();

      g.restore();
    }
  }

  private drawTrails(g: CanvasRenderingContext2D): void {
    // Bake completed trails to the paint canvas (all but the current live one)
    for (const trail of this.trails) {
      if (trail === this.currentTrail) continue; // drawn live
      if (!trail.dead && trail.points.length > 1) {
        this.bakeTrail(this.paintCtx, trail, false);
        trail.dead = true; // mark as baked so we don't re-bake
      }
    }

    // Draw the current live trail directly on the main canvas
    if (this.currentTrail && this.currentTrail.points.length > 1) {
      this.drawSingleTrail(g, this.currentTrail, true);
    }
  }

  private bakeTrail(ctx: CanvasRenderingContext2D, trail: Trail, live: boolean): void {
    this.drawSingleTrail(ctx, trail, live);
  }

  private drawSingleTrail(g: CanvasRenderingContext2D, trail: Trail, _live: boolean): void {
    const pts = trail.points;
    if (pts.length < 2) return;
    const [rv, gv, bv] = hexToRgb(trail.color);

    // Mirror across all symmetry arms
    for (const tf of this.transforms) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      g.lineJoin = 'round';

      // Outer glow pass
      g.lineWidth = trail.width * 4.5;
      g.strokeStyle = `rgba(${rv},${gv},${bv},0.06)`;
      g.beginPath();
      let first = true;
      for (const pt of pts) {
        const relX = pt.x - this.cx;
        const relY = pt.y - this.cy;
        const { x, y } = applyTransform(tf, relX, relY, this.cx, this.cy);
        if (first) { g.moveTo(x, y); first = false; }
        else g.lineTo(x, y);
      }
      g.stroke();

      // Mid glow pass
      g.lineWidth = trail.width * 2.2;
      g.strokeStyle = `rgba(${rv},${gv},${bv},0.18)`;
      g.beginPath();
      first = true;
      for (const pt of pts) {
        const relX = pt.x - this.cx;
        const relY = pt.y - this.cy;
        const { x, y } = applyTransform(tf, relX, relY, this.cx, this.cy);
        if (first) { g.moveTo(x, y); first = false; }
        else g.lineTo(x, y);
      }
      g.stroke();

      // Core bright pass
      g.lineWidth = trail.width * 0.8;
      g.strokeStyle = `rgba(${rv},${gv},${bv},0.85)`;
      g.beginPath();
      first = true;
      for (const pt of pts) {
        const relX = pt.x - this.cx;
        const relY = pt.y - this.cy;
        const { x, y } = applyTransform(tf, relX, relY, this.cx, this.cy);
        if (first) { g.moveTo(x, y); first = false; }
        else g.lineTo(x, y);
      }
      g.stroke();

      g.restore();
    }
  }

  private drawBloom(g: CanvasRenderingContext2D): void {
    const { bloom } = this;
    const palette = PALETTES[this.palette];

    if (bloom.bursting) {
      const t = easeOutCubic(bloom.burstT);
      const alpha = (1 - bloom.burstT) * 0.8;

      for (const tf of this.transforms) {
        const relX = bloom.x - this.cx;
        const relY = bloom.y - this.cy;
        const { x, y } = applyTransform(tf, relX, relY, this.cx, this.cy);
        const r = bloom.burstR + t * Math.min(this.w, this.h) * 0.28;

        g.save();
        g.globalCompositeOperation = 'lighter';
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        const color = palette.colors[bloom.orbits[0]!.colorIdx % palette.colors.length]!;
        const [rv, gv, bv] = hexToRgb(color);
        gr.addColorStop(0, `rgba(${rv},${gv},${bv},${(alpha * 0.5).toFixed(3)})`);
        gr.addColorStop(0.4, `rgba(${rv},${gv},${bv},${(alpha * 0.15).toFixed(3)})`);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
        g.restore();
      }
      return;
    }

    for (const tf of this.transforms) {
      const relX = bloom.x - this.cx;
      const relY = bloom.y - this.cy;
      const { x, y } = applyTransform(tf, relX, relY, this.cx, this.cy);

      g.save();
      g.globalCompositeOperation = 'lighter';

      // Core glow
      const color0 = palette.colors[bloom.orbits[0]!.colorIdx % palette.colors.length]!;
      const [rv0, gv0, bv0] = hexToRgb(color0);
      const gr = g.createRadialGradient(x, y, 0, x, y, bloom.radius);
      gr.addColorStop(0, `rgba(${rv0},${gv0},${bv0},0.35)`);
      gr.addColorStop(0.3, `rgba(${rv0},${gv0},${bv0},0.12)`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, bloom.radius, 0, TAU);
      g.fill();

      // Orbiting particles
      for (const orb of bloom.orbits) {
        const ox = x + Math.cos(orb.angle) * bloom.radius * 0.85;
        const oy = y + Math.sin(orb.angle) * bloom.radius * 0.85;
        const color = palette.colors[orb.colorIdx % palette.colors.length]!;
        const [rv, gv, bv] = hexToRgb(color);
        const pg = g.createRadialGradient(ox, oy, 0, ox, oy, orb.r);
        pg.addColorStop(0, `rgba(${rv},${gv},${bv},0.7)`);
        pg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = pg;
        g.beginPath();
        g.arc(ox, oy, orb.r, 0, TAU);
        g.fill();
      }

      g.restore();
    }
  }
}
