// VOID simulation + renderer. One rAF loop, mutable typed state, zero React renders per frame.
import { getSharedAudio } from './audio';
import { BlackHoleGL, type Camera } from './BlackHoleGL';
import {
  TAU,
  TINT_RGBA,
  TINTS,
  ctx2d,
  makeBackground,
  makeCanvas,
  makeDiskTexture,
  makeGlowSprite,
  makeStarSprite,
} from './render';

const TRAIL = 26;
const MAX_STARS = 80;
const MIN_STARS = 10;
const INITIAL_STARS = 26;
const MAX_RIPPLES = 18;
const MAX_DUST = 480;
const MAX_FLASHES = 8;
const DISK_OUTER = 4.4; // disk outer radius in units of R
const TILT = 0.23; // vertical squash of the disk plane
const SUBSTEP = 1 / 240;
const TAP_SLOP = 8;
const CHARGE_TIME = 0.75; // seconds of hold to open the portal
const PORTAL_DIST = 4.2; // camera distance (Rs) at the moment of breach
const REST_PITCH = 0.045; // ~2.5° above the disk plane: the near edge-on cinematic view

type StarState = 'free' | 'held' | 'falling' | 'collapsing';

type Star = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  tint: number;
  phase: number;
  state: StarState;
  t: number;
  dur: number;
  delay: number;
  r0: number;
  a0: number;
  spin: number;
  birth: number;
  birthDelay: number;
  hover: number;
  trail: Float32Array;
  trailIdx: number;
  trailLen: number;
  dead: boolean;
};

type RippleKind = 'tap' | 'horizon' | 'reset';
type Ripple = { x: number; y: number; t: number; dur: number; r0: number; r1: number; kind: RippleKind; warm: boolean };
type Flash = { angle: number; t: number };
type Sample = { x: number; y: number; t: number };
type Grab = { star: Star; samples: Sample[]; offX: number; offY: number };
type Press = { x: number; y: number; t: number; moved: boolean; lastT?: number };
type Timer = { at: number; fn: () => void };
type Twinkler = { fx: number; fy: number; r: number; p: number; s: number };

export type UniverseCallbacks = {
  onAbsorb?: (total: number) => void;
  onFirstGrab?: () => void;
  /** Hold on the event horizon began / was released early. */
  onChargeStart?: () => void;
  onChargeCancel?: () => void;
  /** Charge completed. Return false if the jump could not start. */
  onPortalCharged?: () => boolean;
};

export type HoleInfo = { cx: number; cy: number; R: number; w: number; h: number };

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class Universe {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cb: UniverseCallbacks;
  readonly audio = getSharedAudio();

  private dpr = 1;
  private maxDpr = 2;
  private w = 0;
  private h = 0;
  private cx = 0;
  private cy = 0;
  private R = 0;
  private m = 0;
  private gm = 0;

  private bg: HTMLCanvasElement | null = null;
  private readonly disk = makeDiskTexture();
  private readonly glow = makeGlowSprite();
  private readonly sprites = TINTS.map((t) => makeStarSprite(t));
  private diskBuf = makeCanvas(1, 1);
  private diskCtx = ctx2d(this.diskBuf);
  private dashes: number[][] = [];

  private stars: Star[] = [];
  private ripples: Ripple[] = [];
  private flashes: Flash[] = [];
  private timers: Timer[] = [];
  private twinklers: Twinkler[] = [];
  private grabs = new Map<number, Grab>();
  private presses = new Map<number, Press>();
  private lastPointer = new Map<number, { x: number; y: number }>();

  // Dust particles, struct-of-arrays ring buffer
  private dX = new Float32Array(MAX_DUST);
  private dY = new Float32Array(MAX_DUST);
  private dVX = new Float32Array(MAX_DUST);
  private dVY = new Float32Array(MAX_DUST);
  private dLife = new Float32Array(MAX_DUST);
  private dMax = new Float32Array(MAX_DUST);
  private dWarm = new Uint8Array(MAX_DUST);
  private dNext = 0;

  private gravity = 1;
  private gravityTarget = 1;
  private still = false;
  private clock = 0;
  private deco = 0;
  private rot = 0;
  private pulse = 0;
  private intro = 0;
  private absorbed = 0;
  private combo = 0;
  private lastAbsorb = -10;
  private refillT = 0;
  private resetting = false;
  private hovered: Star | null = null;
  private cursor = '';
  private firstGrab = false;

  private raf = 0;
  private last = 0;
  private running = false;
  private frameEma = 16;
  private slowT = 0;

  // 3D camera (WebGL path)
  private gl: BlackHoleGL | null = null;
  private cam: Camera = { yaw: 0.35, pitch: 0.4, dist: 60 };
  private yaw = 0.35;
  private pitch = REST_PITCH;
  private zoom = 1;
  private yawVel = 0;
  private pitchVel = 0;
  private camIntro = 0;
  private parX = 0;
  private parY = 0;
  private parTX = 0;
  private parTY = 0;
  private dragging = new Set<number>();

  // Portal
  private charge = 0;
  private chargeId: number | null = null;
  private chargeFired = false;
  private holeHover = 0;
  private holeHoverTarget = 0;
  private collapse = 0;
  private emerge = 0;
  private paused = false;
  private baseR = 0;
  private pinchDist = 0;

  constructor(canvas: HTMLCanvasElement, glCanvas: HTMLCanvasElement | null, cb: UniverseCallbacks = {}) {
    this.canvas = canvas;
    this.ctx = ctx2d(canvas);
    this.cb = cb;
    if (glCanvas) {
      try {
        this.gl = new BlackHoleGL(glCanvas);
      } catch (err) {
        console.warn('VOID: WebGL black hole unavailable, using 2D fallback', err);
        this.gl = null;
        glCanvas.style.display = 'none';
      }
    }
    const rnd = Math.random;
    for (let i = 0; i < 60; i++) {
      this.twinklers.push({ fx: rnd(), fy: rnd(), r: 0.5 + rnd() * 0.9, p: rnd() * TAU, s: 0.6 + rnd() * 1.8 });
    }
    this.resize();
    this.populate(INITIAL_STARS, 0.05);

    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibility);
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('contextmenu', this.preventDefault);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  // ───────────────────────────── public API ─────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onCancel);
    c.removeEventListener('pointerleave', this.onLeave);
    c.removeEventListener('contextmenu', this.preventDefault);
    c.removeEventListener('wheel', this.onWheel);
    this.gl?.destroy();
    this.audio.chargeStop();
  }

  // ───────────────────────────── portal API ─────────────────────────────

  getHole(): HoleInfo {
    return { cx: this.cx, cy: this.cy, R: this.R, w: this.w, h: this.h };
  }

  /** 0 → 1: pull the universe into the hole and fly the camera through the horizon. */
  setPortalCollapse(p: number): void {
    this.collapse = clamp(p, 0, 1);
    if (this.collapse > 0 && this.grabs.size) {
      for (const g of this.grabs.values()) if (g.star.state === 'held') g.star.state = 'free';
      this.grabs.clear();
    }
  }

  /** 1 → 0: emerge from the hole on arrival. */
  setPortalEmerge(p: number): void {
    this.emerge = clamp(p, 0, 1);
  }

  /** Fresh universe for the next arrival (stars were swallowed on the way out). */
  prepareArrival(): void {
    this.stars = [];
    this.ripples = [];
    this.flashes = [];
    this.timers = [];
    this.dLife.fill(0);
    this.grabs.clear();
    this.presses.clear();
    this.dragging.clear();
    this.hovered = null;
    this.resetting = false;
    this.collapse = 0;
    this.charge = 0;
    this.chargeId = null;
    this.chargeFired = false;
    this.holeHover = 0;
    this.holeHoverTarget = 0;
    this.intro = 1;
    this.camIntro = 1;
    this.pulse = 0.8;
    const restDist = ((this.w < 640 ? 18 : 22) * this.zoom) / (0.82 + 0.18 * this.gravity);
    this.R = this.gl ? this.gl.shadowRadius(restDist, this.m) : this.baseR;
    this.populate(INITIAL_STARS, 0.04);
  }

  /** Stop the frame loop while another universe is showing; state is kept. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    cancelAnimationFrame(this.raf);
    this.audio.chargeStop();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (!this.running || document.hidden) return;
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  cancelCharge(): void {
    if (this.chargeId !== null) this.audio.chargeStop();
    this.chargeId = null;
    this.chargeFired = false;
  }

  /** Dev/testing snapshot. */
  debug() {
    return {
      cx: this.cx,
      cy: this.cy,
      R: this.R,
      absorbed: this.absorbed,
      stars: this.stars.map((s) => ({ x: s.x, y: s.y, state: s.state })),
    };
  }

  setGravity(g: number): void {
    this.gravityTarget = clamp(g, 0.1, 3);
  }

  setStill(s: boolean): void {
    this.still = s;
  }

  setMuted(m: boolean): void {
    this.audio.setMuted(m);
  }

  reset(): void {
    if (this.resetting) return;
    this.resetting = true;
    this.audio.ensure();
    this.audio.reset();
    this.grabs.clear();
    this.hovered = null;
    for (const s of this.stars) {
      if (s.state === 'free' || s.state === 'held') {
        this.beginSpiral(s, 'collapsing', 0.75 + Math.random() * 0.35, Math.random() * 0.3);
      }
    }
    this.schedule(1.05, () => {
      this.pulse = Math.min(1.8, this.pulse + 1.3);
      this.addRipple(this.cx, this.cy, this.R, Math.hypot(this.w, this.h) * 0.62, 1.9, 'reset', true);
      this.addRipple(this.cx, this.cy, this.R, Math.hypot(this.w, this.h) * 0.45, 2.3, 'reset', false);
    });
    this.schedule(1.35, () => {
      this.populate(INITIAL_STARS, 0.035);
      this.resetting = false;
    });
  }

  // ───────────────────────────── setup ─────────────────────────────

  private readonly preventDefault = (e: Event) => e.preventDefault();

  private readonly resize = (): void => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const oldCx = this.cx;
    const oldCy = this.cy;
    const oldR = this.R;

    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.w = w;
    this.h = h;
    this.m = Math.min(w, h);
    const mobile = w < 640;
    this.cx = w / 2;
    this.cy = h * (mobile ? 0.45 : 0.5);
    this.R = this.gl
      ? this.gl.shadowRadius(Math.max(this.cam.dist, mobile ? 18 : 22), this.m)
      : clamp(this.m * (mobile ? 0.085 : 0.092), 24, 120);
    this.baseR = this.R;
    // Circular speed of 0.19·m at radius 0.4·m when gravity = 1
    this.gm = Math.pow(0.19 * this.m, 2) * 0.4 * this.m;

    if (oldR > 0) {
      const s = this.R / oldR;
      for (const st of this.stars) {
        st.x = this.cx + (st.x - oldCx) * s;
        st.y = this.cy + (st.y - oldCy) * s;
        st.vx *= s;
        st.vy *= s;
        st.r0 *= s;
        this.resetTrail(st);
      }
    }

    this.bg = makeBackground(w, h, this.dpr);
    const bw = Math.ceil(this.R * DISK_OUTER * 2 * 1.06 * this.dpr) + 4;
    const bh = Math.ceil(bw * TILT * 1.06) + 4;
    this.diskBuf = makeCanvas(bw, bh);
    this.diskCtx = ctx2d(this.diskBuf);

    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    this.dashes = [];
    for (let i = 0; i < 9; i++) {
      const R = this.R;
      this.dashes.push([R * (0.25 + rnd() * 0.7), R * (0.04 + rnd() * 0.2), R * (0.1 + rnd() * 0.4), R * (0.03 + rnd() * 0.14)]);
    }
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
    } else if (this.running && !this.paused) {
      this.last = performance.now();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  private schedule(delay: number, fn: () => void): void {
    this.timers.push({ at: this.clock + delay, fn });
  }

  private circularSpeed(r: number): number {
    return Math.sqrt((this.gm * this.gravity) / Math.max(r, this.R));
  }

  private populate(n: number, stagger: number): void {
    const rMin = this.R * 2.6;
    const rMax = Math.max(rMin * 1.5, Math.min(Math.max(this.w, this.h) * 0.46, this.m * 0.62));
    for (let i = 0; i < n; i++) {
      const r = rMin + (rMax - rMin) * Math.sqrt(Math.random());
      const a = Math.random() * TAU;
      const v = this.circularSpeed(r) * (0.9 + Math.random() * 0.14);
      this.spawn(this.cx + Math.cos(a) * r, this.cy + Math.sin(a) * r, -Math.sin(a) * v, Math.cos(a) * v, i * stagger);
    }
  }

  private spawn(x: number, y: number, vx: number, vy: number, birthDelay = 0): Star | null {
    if (this.stars.length >= MAX_STARS) return null;
    const roll = Math.random();
    const tint = roll < 0.58 ? 0 : roll < 0.83 ? 1 : roll < 0.94 ? 2 : 3;
    const s: Star = {
      x,
      y,
      vx,
      vy,
      size: 1 + Math.random() * 1.5,
      tint,
      phase: Math.random() * TAU,
      state: 'free',
      t: 0,
      dur: 0,
      delay: 0,
      r0: 0,
      a0: 0,
      spin: 1,
      birth: 0,
      birthDelay,
      hover: 0,
      trail: new Float32Array(TRAIL * 2),
      trailIdx: 0,
      trailLen: 0,
      dead: false,
    };
    this.resetTrail(s);
    this.stars.push(s);
    return s;
  }

  private resetTrail(s: Star): void {
    s.trailIdx = 0;
    s.trailLen = 1;
    s.trail[0] = s.x;
    s.trail[1] = s.y;
  }

  private pushTrail(s: Star): void {
    s.trailIdx = (s.trailIdx + 1) % TRAIL;
    s.trail[s.trailIdx * 2] = s.x;
    s.trail[s.trailIdx * 2 + 1] = s.y;
    if (s.trailLen < TRAIL) s.trailLen++;
  }

  private addRipple(x: number, y: number, r0: number, r1: number, dur: number, kind: RippleKind, warm: boolean): void {
    if (this.ripples.length >= MAX_RIPPLES) this.ripples.shift();
    this.ripples.push({ x, y, t: 0, dur, r0, r1, kind, warm });
  }

  private emitDust(x: number, y: number, vx: number, vy: number, life: number, warm: boolean): void {
    const i = this.dNext;
    this.dNext = (i + 1) % MAX_DUST;
    this.dX[i] = x;
    this.dY[i] = y;
    this.dVX[i] = vx;
    this.dVY[i] = vy;
    this.dLife[i] = life;
    this.dMax[i] = life;
    this.dWarm[i] = warm ? 1 : 0;
  }

  // ───────────────────────────── physics ─────────────────────────────

  private beginSpiral(s: Star, state: 'falling' | 'collapsing', dur: number, delay: number): void {
    const dx = s.x - this.cx;
    const dy = s.y - this.cy;
    const cross = dx * s.vy - dy * s.vx;
    s.state = state;
    s.r0 = Math.hypot(dx, dy);
    s.a0 = Math.atan2(dy, dx);
    s.spin = cross === 0 ? 1 : Math.sign(cross);
    s.t = 0;
    s.dur = dur;
    s.delay = delay;
  }

  private absorbEffect(angle: number, spin: number): void {
    this.pulse = Math.min(1.6, this.pulse + 0.9);
    if (this.flashes.length >= MAX_FLASHES) this.flashes.shift();
    this.flashes.push({ angle, t: 0 });
    this.addRipple(this.cx, this.cy, this.R * 1.05, this.R * 5.5, 1.6, 'horizon', true);
    // Sparks swept along the photon ring
    const R = this.R;
    for (let i = 0; i < 12; i++) {
      const a = angle + (Math.random() - 0.5) * 0.7;
      const r = R * (1.1 + Math.random() * 0.25);
      const sp = this.m * (0.18 + Math.random() * 0.25);
      this.emitDust(
        this.cx + Math.cos(a) * r,
        this.cy + Math.sin(a) * r,
        -Math.sin(a) * sp * spin + Math.cos(a) * sp * 0.25,
        Math.cos(a) * sp * spin + Math.sin(a) * sp * 0.25,
        0.6 + Math.random() * 0.6,
        true,
      );
    }
    this.combo = this.clock - this.lastAbsorb < 2.5 ? this.combo + 1 : 0;
    this.lastAbsorb = this.clock;
    this.audio.absorb(this.combo);
    this.absorbed++;
    this.cb.onAbsorb?.(this.absorbed);
  }

  private update(dt: number): void {
    this.clock += dt;
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.clock);
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > this.clock);
        due.forEach((t) => t.fn());
      }
    }

    const decoDt = this.still ? 0 : dt;
    this.deco += decoDt;
    this.rot += decoDt * 0.11;
    this.pulse *= Math.exp(-dt * 2.4);
    this.intro = Math.min(1, this.intro + dt / 1.8);
    this.gravity += (this.gravityTarget - this.gravity) * Math.min(1, dt * 4);
    this.updatePortal(dt);
    if (this.gl) this.updateCamera(dt, decoDt);
    else this.R = this.baseR * (1 + 9 * Math.pow(Math.max(this.collapse, this.emerge), 2));

    const simDt = this.still ? 0 : dt;
    const steps = simDt > 0 ? Math.min(12, Math.ceil(simDt / SUBSTEP)) : 0;
    const h = steps > 0 ? simDt / steps : 0;
    const GM = this.gm * this.gravity * (1 + 1.5 * this.charge);
    const soft2 = Math.pow(this.R * 0.6, 2);
    const portalActive = this.collapse > 0 || this.emerge > 0.02;
    const capR = this.R * 1.12;
    const capR2 = portalActive ? 0 : capR * capR;
    const maxV = 3.2 * this.m;
    const farR2 = Math.pow(Math.hypot(this.w, this.h) * 0.8, 2);
    const { cx, cy } = this;
    let freeCount = 0;

    for (const s of this.stars) {
      if (s.birthDelay > 0) s.birthDelay -= dt;
      else if (s.birth < 1) s.birth = Math.min(1, s.birth + dt / 0.9);
      const hoverTarget = s === this.hovered || s.state === 'held' ? 1 : 0;
      s.hover += (hoverTarget - s.hover) * Math.min(1, dt * 14);

      if (s.state === 'free') {
        freeCount++;
        for (let k = 0; k < steps; k++) {
          const dx = cx - s.x;
          const dy = cy - s.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < capR2) {
            this.beginSpiral(s, 'falling', 0.5, 0);
            break;
          }
          const dd = d2 + soft2;
          const inv = GM / (dd * Math.sqrt(dd));
          s.vx += dx * inv * h;
          s.vy += dy * inv * h;
          const sp2 = s.vx * s.vx + s.vy * s.vy;
          if (sp2 > maxV * maxV) {
            const f = maxV / Math.sqrt(sp2);
            s.vx *= f;
            s.vy *= f;
          }
          s.x += s.vx * h;
          s.y += s.vy * h;
        }
        if (s.state === 'free') {
          const dx = s.x - cx;
          const dy = s.y - cy;
          if (dx * dx + dy * dy > farR2) s.dead = true;
        }
      } else if (s.state === 'held') {
        const dx = s.x - cx;
        const dy = s.y - cy;
        if (dx * dx + dy * dy < capR2) {
          // Fed directly into the void
          for (const [id, g] of this.grabs) if (g.star === s) this.grabs.delete(id);
          const v = this.releaseVelocity(s);
          s.vx = v.vx;
          s.vy = v.vy;
          this.beginSpiral(s, 'falling', 0.5, 0);
        }
      }

      if (s.state === 'falling' || s.state === 'collapsing') {
        if (s.delay > 0) {
          s.delay -= dt;
        } else {
          s.t = Math.min(1, s.t + dt / s.dur);
          const e = s.t * s.t;
          const r = s.r0 * (1 - e);
          const ang = s.a0 + s.spin * (s.t * 1.4 + e * 2.6) * (s.state === 'collapsing' ? 1.3 : 1);
          s.x = cx + Math.cos(ang) * r;
          s.y = cy + Math.sin(ang) * r;
          if (s.t >= 1) {
            s.dead = true;
            if (s.state === 'falling') this.absorbEffect(ang, s.spin);
            else this.pulse = Math.min(1.6, this.pulse + 0.06);
          }
        }
      }

      this.pushTrail(s);
    }

    // Collapse: everything streams into the hole (trails stretch naturally)
    if (this.collapse > 0) {
      const k = 1 - Math.exp(-dt * (1.5 + 16 * this.collapse * this.collapse));
      for (const s of this.stars) {
        s.x += (cx - s.x) * k;
        s.y += (cy - s.y) * k;
      }
      this.pulse = Math.max(this.pulse, this.collapse * 1.3);
    }

    if (this.stars.some((s) => s.dead)) {
      this.stars = this.stars.filter((s) => {
        if (s.dead && s === this.hovered) this.hovered = null;
        return !s.dead;
      });
    }

    // Keep the universe stocked
    if (!this.resetting && freeCount < MIN_STARS && !this.still && this.collapse === 0) {
      this.refillT -= dt;
      if (this.refillT <= 0) {
        this.refillT = 0.8;
        const r = this.m * (0.38 + Math.random() * 0.14);
        const a = Math.random() * TAU;
        const v = this.circularSpeed(r) * 0.95;
        this.spawn(cx + Math.cos(a) * r, cy + Math.sin(a) * r, -Math.sin(a) * v, Math.cos(a) * v);
      }
    }

    for (const r of this.ripples) r.t += dt / r.dur;
    if (this.ripples.length) this.ripples = this.ripples.filter((r) => r.t < 1);
    for (const f of this.flashes) f.t += dt / 0.75;
    if (this.flashes.length) this.flashes = this.flashes.filter((f) => f.t < 1);

    // Dust drifts and is lightly drawn toward the hole
    const dGM = GM * 0.3;
    const damp = Math.exp(-dt * 1.1);
    const R2 = this.R * this.R;
    for (let i = 0; i < MAX_DUST; i++) {
      if (this.dLife[i]! <= 0) continue;
      this.dLife[i]! -= dt;
      const dx = cx - this.dX[i]!;
      const dy = cy - this.dY[i]!;
      const d2 = dx * dx + dy * dy;
      if (d2 < R2) {
        this.dLife[i] = 0;
        continue;
      }
      const dd = d2 + soft2;
      const inv = (dGM / (dd * Math.sqrt(dd))) * dt;
      this.dVX[i] = (this.dVX[i]! + dx * inv) * damp;
      this.dVY[i] = (this.dVY[i]! + dy * inv) * damp;
      this.dX[i]! += this.dVX[i]! * dt;
      this.dY[i]! += this.dVY[i]! * dt;
    }
  }

  private updatePortal(dt: number): void {
    if (this.chargeId !== null && !this.chargeFired) {
      this.charge = Math.min(1, this.charge + dt / CHARGE_TIME);
      // Energy gathers: dust streams inward from a wide ring
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * TAU;
        const r = this.R * (2.2 + Math.random() * 1.8);
        const sp = this.R * (2.5 + this.charge * 4);
        this.emitDust(
          this.cx + Math.cos(a) * r,
          this.cy + Math.sin(a) * r,
          -Math.cos(a) * sp - Math.sin(a) * sp * 0.4,
          -Math.sin(a) * sp + Math.cos(a) * sp * 0.4,
          0.35 + Math.random() * 0.3,
          Math.random() < 0.7,
        );
      }
      if (this.charge >= 1) {
        this.chargeFired = true;
        this.chargeId = null;
        this.audio.chargeStop();
        const ok = this.cb.onPortalCharged?.() ?? false;
        if (!ok) this.chargeFired = false;
      }
    } else if (!this.chargeFired) {
      this.charge = Math.max(0, this.charge - dt * 2.2);
    }
    const hoverT = this.chargeId !== null ? 1 : this.holeHoverTarget;
    this.holeHover += (hoverT - this.holeHover) * Math.min(1, dt * 6);
  }

  private updateCamera(dt: number, decoDt: number): void {
    // Cinematic swoop-in on load
    this.camIntro = Math.min(1, this.camIntro + dt / 4.2);
    const ci = easeOutCubic(this.camIntro);

    // Orbit inertia, gentle idle drift, pitch eases back toward the iconic near-edge-on view
    const dragging = this.dragging.size > 0;
    if (!dragging) {
      this.yaw += this.yawVel * dt;
      this.pitch += this.pitchVel * dt;
      const k = Math.exp(-dt * 2.2);
      this.yawVel *= k;
      this.pitchVel *= k;
      this.pitch += (REST_PITCH - this.pitch) * Math.min(1, dt * 0.25);
    }
    this.pitch = clamp(this.pitch, -1.25, 1.25);

    this.parX += (this.parTX - this.parX) * Math.min(1, dt * 3);
    this.parY += (this.parTY - this.parY) * Math.min(1, dt * 3);

    const mobile = this.w < 640;
    const base = mobile ? 18 : 22;
    const massScale = 0.82 + 0.18 * this.gravity;
    const target = (base * this.zoom) / massScale;
    let dist = 60 + (target - 60) * ci;
    dist *= 1 - 0.05 * this.charge; // barely perceptible push-in while charging
    const portal = Math.max(this.collapse, this.emerge);
    if (portal > 0) dist *= Math.pow(PORTAL_DIST / dist, portal);
    this.cam.dist = dist;
    // Slow cinematic sway instead of a continuous drift, so the galaxy stays framed
    this.cam.yaw = this.yaw + this.parX * 0.07 + Math.sin(this.deco * 0.06) * 0.12;
    this.cam.pitch = 0.45 + (this.pitch + this.parY * 0.05 - 0.45) * ci;
    this.R = this.gl!.shadowRadius(this.cam.dist, this.m);
  }

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.gl) return;
    e.preventDefault();
    this.zoom = clamp(this.zoom * Math.exp(e.deltaY * 0.0012), 0.55, 2.2);
  };

  // ───────────────────────────── input ─────────────────────────────

  private local(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private pick(x: number, y: number, touch: boolean): Star | null {
    const radius = touch ? 38 : 24;
    let best: Star | null = null;
    let bestD = radius * radius;
    for (const s of this.stars) {
      if (s.state !== 'free' || s.birthDelay > 0) continue;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private setCursor(c: string): void {
    if (c !== this.cursor) {
      this.cursor = c;
      this.canvas.style.cursor = c;
    }
  }

  private releaseVelocity(s: Star): { vx: number; vy: number } {
    for (const g of this.grabs.values()) if (g.star === s) return this.sampleVelocity(g.samples);
    return { vx: 0, vy: 0 };
  }

  private sampleVelocity(samples: Sample[]): { vx: number; vy: number } {
    const last = samples[samples.length - 1];
    if (!last) return { vx: 0, vy: 0 };
    const now = performance.now();
    if (now - last.t > 90) return { vx: 0, vy: 0 }; // pointer was resting before release
    let first = last;
    for (let i = samples.length - 1; i >= 0; i--) {
      const s = samples[i]!;
      if (last.t - s.t > 70) break;
      first = s;
    }
    const dt = (last.t - first.t) / 1000;
    if (dt < 0.008) return { vx: 0, vy: 0 };
    let vx = (last.x - first.x) / dt;
    let vy = (last.y - first.y) / dt;
    const max = 2.6 * this.m;
    const sp = Math.hypot(vx, vy);
    if (sp > max) {
      vx *= max / sp;
      vy *= max / sp;
    }
    return { vx, vy };
  }

  private readonly onDown = (e: PointerEvent): void => {
    this.audio.ensure();
    if (this.collapse > 0 || this.emerge > 0.05 || this.chargeFired) return;
    const p = this.local(e);
    const touch = e.pointerType !== 'mouse';
    this.lastPointer.set(e.pointerId, p);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    const s = this.pick(p.x, p.y, touch);
    if (s) {
      s.state = 'held';
      s.vx = 0;
      s.vy = 0;
      this.grabs.set(e.pointerId, { star: s, samples: [{ ...p, t: performance.now() }], offX: s.x - p.x, offY: s.y - p.y });
      this.audio.grab();
      this.setCursor('grabbing');
      if (!this.firstGrab) {
        this.firstGrab = true;
        this.cb.onFirstGrab?.();
      }
    } else {
      this.presses.set(e.pointerId, { x: p.x, y: p.y, t: performance.now(), moved: false });
      // Press-and-hold on the event horizon charges the portal
      if (this.chargeId === null && Math.hypot(p.x - this.cx, p.y - this.cy) < this.R * 1.35) {
        this.chargeId = e.pointerId;
        this.audio.chargeStart(CHARGE_TIME * (1 - this.charge));
        this.cb.onChargeStart?.();
      }
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.local(e);
    const prev = this.lastPointer.get(e.pointerId);
    this.lastPointer.set(e.pointerId, p);

    if (prev && !this.still) {
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      const dist = Math.hypot(dx, dy);
      const n = Math.min(3, Math.floor(dist / 7));
      for (let i = 0; i < n; i++) {
        const f = Math.random();
        this.emitDust(
          prev.x + dx * f + (Math.random() - 0.5) * 4,
          prev.y + dy * f + (Math.random() - 0.5) * 4,
          dx * 2 + (Math.random() - 0.5) * 30,
          dy * 2 + (Math.random() - 0.5) * 30,
          0.5 + Math.random() * 0.6,
          Math.random() < 0.6,
        );
      }
    }

    const g = this.grabs.get(e.pointerId);
    if (g) {
      if (g.star.state !== 'held') {
        this.grabs.delete(e.pointerId);
      } else {
        // Snap the grab offset away so the star settles under the finger
        g.offX *= 0.8;
        g.offY *= 0.8;
        g.star.x = p.x + g.offX;
        g.star.y = p.y + g.offY;
        const now = performance.now();
        g.samples.push({ x: g.star.x, y: g.star.y, t: now });
        while (g.samples.length > 2 && now - g.samples[0]!.t > 140) g.samples.shift();
      }
      return;
    }

    const press = this.presses.get(e.pointerId);
    if (press && Math.hypot(p.x - press.x, p.y - press.y) > TAP_SLOP) press.moved = true;

    if (this.chargeId === e.pointerId && Math.hypot(p.x - this.cx, p.y - this.cy) > this.R * 2.2) {
      this.chargeId = null;
      this.audio.chargeStop();
      this.cb.onChargeCancel?.();
    }

    if (e.pointerType === 'mouse') {
      this.holeHoverTarget =
        this.grabs.size === 0 && !this.dragging.size && Math.hypot(p.x - this.cx, p.y - this.cy) < this.R * 1.7 ? 1 : 0;
    }

    if (this.gl && press?.moved && prev && this.chargeId !== e.pointerId) {
      // Two fingers on empty space: pinch to zoom
      if (this.presses.size >= 2) {
        const pts = [...this.presses.keys()].map((id) => this.lastPointer.get(id)).filter((v) => v !== undefined);
        if (pts.length >= 2) {
          const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
          if (this.pinchDist > 0) this.zoom = clamp(this.zoom * (this.pinchDist / d), 0.55, 2.2);
          this.pinchDist = d;
        }
      } else {
        // Drag empty space: orbit the camera around the black hole
        this.dragging.add(e.pointerId);
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        const ky = 3.2 / Math.max(this.w, 1);
        const kp = 2.2 / Math.max(this.h, 1);
        this.yaw -= dx * ky;
        this.pitch += dy * kp;
        const evDt = Math.max(1 / 240, (e.timeStamp - (press.lastT ?? e.timeStamp - 16)) / 1000);
        this.yawVel = clamp(this.yawVel * 0.5 + ((-dx * ky) / evDt) * 0.3, -1.6, 1.6);
        this.pitchVel = clamp(this.pitchVel * 0.5 + ((dy * kp) / evDt) * 0.3, -1.2, 1.2);
        press.lastT = e.timeStamp;
        this.setCursor('move');
      }
    }

    if (e.pointerType === 'mouse' && this.grabs.size === 0 && this.presses.size === 0) {
      this.parTX = (p.x / Math.max(this.w, 1) - 0.5) * 2;
      this.parTY = (p.y / Math.max(this.h, 1) - 0.5) * 2;
    }

    if (e.pointerType === 'mouse' && this.grabs.size === 0 && !this.dragging.size) {
      this.hovered = this.pick(p.x, p.y, false);
      this.setCursor(this.hovered ? 'grab' : 'default');
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.endPointer(e, true);
  };

  private readonly onCancel = (e: PointerEvent): void => {
    this.endPointer(e, false);
  };

  private readonly onLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && !this.grabs.has(e.pointerId)) {
      this.holeHoverTarget = 0;
      this.hovered = null;
      this.lastPointer.delete(e.pointerId);
    }
  };

  private endPointer(e: PointerEvent, allowTap: boolean): void {
    if (this.chargeId === e.pointerId) {
      this.chargeId = null;
      if (!this.chargeFired) {
        this.audio.chargeStop();
        this.cb.onChargeCancel?.();
      }
    }
    const g = this.grabs.get(e.pointerId);
    if (g) {
      this.grabs.delete(e.pointerId);
      if (g.star.state === 'held') {
        const v = allowTap ? this.sampleVelocity(g.samples) : { vx: 0, vy: 0 };
        g.star.state = 'free';
        g.star.vx = v.vx;
        g.star.vy = v.vy;
        this.audio.release(Math.hypot(v.vx, v.vy) / (1.5 * this.m));
      }
    }
    this.dragging.delete(e.pointerId);
    if (this.presses.size < 3) this.pinchDist = 0;
    const press = this.presses.get(e.pointerId);
    if (press) {
      this.presses.delete(e.pointerId);
      if (this.presses.size > 0) press.moved = true; // part of a pinch, never a tap
      if (allowTap && !press.moved && performance.now() - press.t < 600) this.tap(press.x, press.y);
    }
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (e.pointerType !== 'mouse') this.lastPointer.delete(e.pointerId);
    if (this.grabs.size === 0) {
      const p = this.local(e);
      this.hovered = e.pointerType === 'mouse' ? this.pick(p.x, p.y, false) : null;
      this.setCursor(this.hovered ? 'grab' : 'default');
    }
  }

  private tap(x: number, y: number): void {
    const d = Math.hypot(x - this.cx, y - this.cy);
    if (d < this.R * 1.3) {
      // Poke the void
      this.pulse = Math.min(1.6, this.pulse + 0.5);
      this.addRipple(this.cx, this.cy, this.R, this.R * 4, 1.4, 'horizon', false);
      this.audio.poke();
      return;
    }
    const warm = Math.random() < 0.55;
    this.addRipple(x, y, 3, 120, 1.15, 'tap', warm);
    this.addRipple(x, y, 2, 70, 1.4, 'tap', !warm);
    // Ripples nudge nearby stars
    const reach = 150;
    for (const s of this.stars) {
      if (s.state !== 'free') continue;
      const dx = s.x - x;
      const dy = s.y - y;
      const dd = Math.hypot(dx, dy);
      if (dd < reach && dd > 0.1) {
        const k = (1 - dd / reach) * 70;
        s.vx += (dx / dd) * k;
        s.vy += (dy / dd) * k;
      }
    }
    // Birth a new star in a gentle, slightly decaying orbit
    const a = Math.atan2(y - this.cy, x - this.cx);
    const v = this.circularSpeed(d) * 0.82;
    const s = this.spawn(x, y, -Math.sin(a) * v, Math.cos(a) * v);
    if (s) s.birth = 0.35;
    for (let i = 0; i < 10; i++) {
      const aa = Math.random() * TAU;
      const sp = 20 + Math.random() * 60;
      this.emitDust(x, y, Math.cos(aa) * sp, Math.sin(aa) * sp, 0.5 + Math.random() * 0.5, warm);
    }
    this.audio.spawn();
  }

  // ───────────────────────────── render ─────────────────────────────

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const rawMs = now - this.last;
    this.last = now;
    const dt = Math.max(0, Math.min(rawMs / 1000, 1 / 20));

    // Adaptive quality. WebGL: two-way resolution controller (drops under load, recovers
    // when there is headroom). 2D fallback: drop DPR once if frames stay slow.
    if (this.gl) {
      if (!document.hidden) this.gl.res.sample(rawMs, dt);
    } else if (rawMs < 100) {
      this.frameEma += (rawMs - this.frameEma) * 0.05;
      if (this.frameEma > 24 && this.maxDpr > 1) {
        this.slowT += dt;
        if (this.slowT > 1.5) {
          this.slowT = 0;
          this.maxDpr = 1;
          this.resize();
        }
      } else {
        this.slowT = 0;
      }
    }

    this.update(dt);
    this.render();
  };

  private render(): void {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;

    if (this.gl) {
      this.gl.render({
        w: this.w,
        h: this.h,
        dpr: this.dpr,
        cx: this.cx,
        cy: this.cy,
        time: this.deco,
        cam: this.cam,
        pulse: Math.min(1.3, this.pulse),
        fade: easeOutCubic(this.intro),
        charge: this.charge,
        portal: Math.max(this.collapse, this.emerge),
        hover: this.holeHover,
        // cheaper while flying through the horizon — the view is zooming and blurring anyway
        scale: 1 - 0.3 * Math.max(this.collapse, this.emerge),
      });
      g.clearRect(0, 0, this.canvas.width, this.canvas.height);
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.drawRingFlashes();
      this.drawRipples();
      this.drawDust();
      this.drawStars();
      this.drawPortalOverlay();
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      return;
    }

    if (this.bg) g.drawImage(this.bg, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Twinkling foreground specks
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = '#eef0ff';
    for (const t of this.twinklers) {
      const a = 0.08 + 0.5 * Math.pow(Math.sin(this.deco * t.s + t.p) * 0.5 + 0.5, 3);
      g.globalAlpha = a;
      g.fillRect(t.fx * this.w, t.fy * this.h, t.r, t.r);
    }
    g.globalAlpha = 1;

    this.drawHole();
    this.drawRipples();
    this.drawDust();
    this.drawStars();
    this.drawPortalOverlay();
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }

  /** Charge ring around the horizon and the HOLD TO JUMP hint. */
  private drawPortalOverlay(): void {
    const g = this.ctx;
    const { cx, cy, R } = this;
    if (this.collapse > 0 || this.emerge > 0.05) return;
    if (this.charge > 0.002) {
      const rr = R * 1.3;
      const c = this.charge;
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      g.lineWidth = 1;
      g.strokeStyle = `rgba(255,214,160,${0.2 * Math.min(1, c * 5)})`;
      g.beginPath();
      g.arc(cx, cy, rr, 0, TAU);
      g.stroke();
      const end = -Math.PI / 2 + TAU * c;
      g.beginPath();
      g.arc(cx, cy, rr, -Math.PI / 2, end);
      g.lineWidth = 10;
      g.strokeStyle = `rgba(255,140,90,${0.18 + 0.2 * c})`;
      g.stroke();
      g.lineWidth = 2.2;
      g.strokeStyle = `rgba(255,240,224,${0.6 + 0.4 * c})`;
      g.stroke();
      // violet energy creeping in as the charge completes
      g.lineWidth = 1.4;
      g.strokeStyle = `rgba(170,140,255,${0.6 * c * c})`;
      g.beginPath();
      g.arc(cx, cy, rr + 5, -Math.PI / 2, end);
      g.stroke();
      g.lineCap = 'butt';
    }
    const hint = this.holeHover * (1 - Math.min(1, this.charge * 3));
    if (hint > 0.01) {
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = hint;
      g.font = '500 11px "Space Grotesk", ui-sans-serif, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '4px';
      g.fillStyle = '#ffd6a0';
      g.fillText('HOLD TO JUMP', cx, Math.min(cy + R * 2.15, this.h - 140));
      (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
      g.globalAlpha = 1;
    }
  }

  private renderDiskBuffer(): void {
    const b = this.diskCtx;
    const W = this.diskBuf.width;
    const H = this.diskBuf.height;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-over';
    b.clearRect(0, 0, W, H);
    const outer = this.R * DISK_OUTER * this.dpr;
    const k = outer / (this.disk.width / 2);
    b.translate(W / 2, H / 2);
    b.scale(1, TILT);
    b.rotate(this.rot);
    const s = this.disk.width * k;
    b.drawImage(this.disk, -s / 2, -s / 2, s, s);
    b.globalCompositeOperation = 'lighter';
    b.drawImage(this.disk, -s / 2, -s / 2, s, s);
    // Relativistic beaming: the approaching (right) side glows brighter
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'destination-out';
    const lg = b.createLinearGradient(0, 0, W, 0);
    lg.addColorStop(0, 'rgba(0,0,0,0.62)');
    lg.addColorStop(0.5, 'rgba(0,0,0,0.28)');
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = lg;
    b.fillRect(0, 0, W, H);
    b.globalCompositeOperation = 'source-over';
  }

  private drawDiskHalf(front: boolean, alpha: number, boost: number): void {
    const g = this.ctx;
    const W = this.diskBuf.width / this.dpr;
    const H = this.diskBuf.height / this.dpr;
    const x = this.cx - W / 2;
    const y = this.cy - H / 2;
    g.save();
    g.beginPath();
    g.rect(x, front ? this.cy : y, W, H / 2);
    g.clip();
    g.globalAlpha = alpha;
    g.drawImage(this.diskBuf, x, y, W, H);
    if (boost > 0.02) {
      g.globalAlpha = alpha * Math.min(1, boost) * 0.7;
      g.drawImage(this.diskBuf, x, y, W, H);
    }
    g.restore();
  }

  private drawHole(): void {
    const g = this.ctx;
    const { cx, cy } = this;
    const p = Math.min(1, this.pulse);
    const io = easeOutCubic(this.intro);
    const R = this.R * (1 + 0.025 * p);
    const breathe = this.still ? 1 : 1 + 0.04 * Math.sin(this.deco * 0.7);

    // Atmospheric glow
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = io * (0.8 + 0.45 * p) * breathe;
    const gs = R * 17;
    g.drawImage(this.glow, cx - gs / 2, cy - gs / 2, gs, gs);

    // Back half of the disk
    this.renderDiskBuffer();
    this.drawDiskHalf(false, io, p);

    // Shadow + event horizon
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = io;
    const sg = g.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.6);
    sg.addColorStop(0, 'rgba(0,0,0,1)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sg;
    g.beginPath();
    g.arc(cx, cy, R * 1.6, 0, TAU);
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.beginPath();
    g.arc(cx, cy, R, 0, TAU);
    g.fill();

    // Gravitationally lensed far side of the disk, bent over the top and under the bottom
    g.globalCompositeOperation = 'lighter';
    const bands = 12;
    for (let i = 0; i < bands; i++) {
      const f = i / (bands - 1);
      const rr = R * (1.04 + f * 0.7);
      const a = (0.62 * Math.pow(1 - f, 1.5) + 0.03) * (1 + 0.7 * p) * io;
      const grad = g.createLinearGradient(cx - rr, 0, cx + rr, 0);
      grad.addColorStop(0, `rgba(255,160,90,${a * 0.35})`);
      grad.addColorStop(0.5, `rgba(255,210,155,${a * 0.85})`);
      grad.addColorStop(1, `rgba(255,242,224,${a})`);
      g.strokeStyle = grad;
      g.lineWidth = R * 0.06;
      g.beginPath();
      g.ellipse(cx, cy - R * 0.03, rr, rr * 0.93, 0, Math.PI, TAU);
      g.stroke();
    }
    // Fine streaks flowing along the lensed arc
    g.lineCap = 'round';
    const layers = this.dashes.length;
    for (let i = 0; i < layers; i++) {
      const f = i / (layers - 1);
      const rr = R * (1.06 + f * 0.5);
      g.lineWidth = 0.8 + (1 - f) * 1.2;
      g.strokeStyle = `rgba(255,236,210,${(0.35 * (1 - f) + 0.06) * io})`;
      g.setLineDash(this.dashes[i]!);
      g.lineDashOffset = -this.deco * R * (0.5 + (1 - f) * 0.7);
      g.beginPath();
      g.ellipse(cx, cy - R * 0.03, rr, rr * 0.93, 0, Math.PI, TAU);
      g.stroke();
    }
    g.setLineDash([]);
    g.lineCap = 'butt';
    // soft continuous underglow for the upper arc
    g.lineWidth = R * 0.32;
    g.strokeStyle = `rgba(255,170,100,${0.07 * io * (1 + p)})`;
    g.beginPath();
    g.ellipse(cx, cy - R * 0.03, R * 1.28, R * 1.2, 0, Math.PI, TAU);
    g.stroke();
    for (let i = 0; i < 3; i++) {
      const rr = R * (1.04 + i * 0.06);
      g.lineWidth = R * 0.05;
      g.strokeStyle = `rgba(255,214,160,${0.2 * (1 - i / 3) * io * (1 + p)})`;
      g.beginPath();
      g.ellipse(cx, cy + R * 0.02, rr, rr * 0.9, 0, 0, Math.PI);
      g.stroke();
    }

    // Photon ring
    const pr = R * 1.02;
    const ringBoost = 1 + p * 0.9;
    const ring: [number, number][] = [
      [11, 0.035],
      [4, 0.11],
      [1.2, 0.65],
    ];
    for (const [lw, a] of ring) {
      g.lineWidth = lw;
      g.strokeStyle = `rgba(255,238,218,${Math.min(1, a * ringBoost) * io})`;
      g.beginPath();
      g.arc(cx, cy, pr, 0, TAU);
      g.stroke();
    }

    // Light pulses racing around the ring from each absorption point
    for (const f of this.flashes) {
      const sweep = easeOutCubic(f.t) * Math.PI;
      const a = Math.pow(1 - f.t, 1.4);
      g.lineCap = 'round';
      for (const dir of [1, -1]) {
        const head = f.angle + dir * sweep;
        g.lineWidth = 2.6;
        g.strokeStyle = `rgba(255,248,236,${a})`;
        g.beginPath();
        if (dir > 0) g.arc(cx, cy, pr, head - 0.4, head);
        else g.arc(cx, cy, pr, head, head + 0.4);
        g.stroke();
        g.lineWidth = 8;
        g.strokeStyle = `rgba(255,170,95,${a * 0.25})`;
        g.stroke();
      }
      g.lineCap = 'butt';
    }

    // Front half of the disk passes in front of the shadow
    this.drawDiskHalf(true, io, p);
    g.globalAlpha = 1;
  }

  /** Light racing around the photon ring after an absorption (overlay for the WebGL hole). */
  private drawRingFlashes(): void {
    const g = this.ctx;
    const { cx, cy } = this;
    const pr = this.R * 1.01;
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (const f of this.flashes) {
      const sweep = easeOutCubic(f.t) * Math.PI;
      const a = Math.pow(1 - f.t, 1.4);
      for (const dir of [1, -1]) {
        const head = f.angle + dir * sweep;
        g.beginPath();
        if (dir > 0) g.arc(cx, cy, pr, head - 0.45, head);
        else g.arc(cx, cy, pr, head, head + 0.45);
        g.lineWidth = 2.4;
        g.strokeStyle = `rgba(255,248,236,${a})`;
        g.stroke();
        g.lineWidth = 9;
        g.strokeStyle = `rgba(255,170,95,${a * 0.22})`;
        g.stroke();
      }
    }
    g.lineCap = 'butt';
  }

  private drawRipples(): void {
    const g = this.ctx;
    g.globalCompositeOperation = 'lighter';
    for (const rp of this.ripples) {
      const e = easeOutCubic(rp.t);
      const r = rp.r0 + (rp.r1 - rp.r0) * e;
      const a = Math.pow(1 - rp.t, 2);
      let col: string;
      let lw: number;
      let alpha: number;
      if (rp.kind === 'tap') {
        col = rp.warm ? '255,157,77' : '150,142,232';
        lw = 1.4;
        alpha = a * 0.75;
      } else if (rp.kind === 'horizon') {
        col = rp.warm ? '255,206,150' : '170,160,240';
        lw = this.R * 0.07 * (1 - rp.t) + 0.6;
        alpha = a * 0.5;
      } else {
        col = rp.warm ? '255,214,160' : '140,132,220';
        lw = 2 + 7 * (1 - rp.t);
        alpha = a * 0.7;
      }
      g.lineWidth = lw;
      g.strokeStyle = `rgba(${col},${alpha})`;
      g.beginPath();
      g.arc(rp.x, rp.y, r, 0, TAU);
      g.stroke();
      if (rp.kind !== 'tap') {
        g.lineWidth = lw * 4;
        g.strokeStyle = `rgba(${col},${alpha * 0.12})`;
        g.stroke();
      }
    }
  }

  private drawDust(): void {
    const g = this.ctx;
    g.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < 2; pass++) {
      g.fillStyle = pass === 0 ? '#ffc890' : '#a69ef0';
      const want = pass === 0 ? 1 : 0;
      for (let i = 0; i < MAX_DUST; i++) {
        const life = this.dLife[i]!;
        if (life <= 0 || this.dWarm[i] !== want) continue;
        const f = life / this.dMax[i]!;
        g.globalAlpha = f * 0.8;
        const s = 0.6 + f * 1.4;
        g.fillRect(this.dX[i]! - s / 2, this.dY[i]! - s / 2, s, s);
      }
    }
    g.globalAlpha = 1;
  }

  private drawStars(): void {
    const g = this.ctx;
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (const s of this.stars) {
      if (s.birthDelay > 0) continue;
      const born = easeOutCubic(s.birth);
      let scale = 1;
      let bright = 1;
      let alpha = born;
      if (s.state === 'falling' || s.state === 'collapsing') {
        const t = s.t;
        scale = 1 - 0.8 * t * t;
        bright = 1 + 1.6 * t;
        alpha *= t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
      }
      const tw = this.still ? 1 : 0.86 + 0.14 * Math.sin(this.deco * 2.2 + s.phase);
      const col = TINT_RGBA[s.tint]!;

      // Trail
      const len = s.trailLen;
      if (len > 2) {
        const i0 = (s.trailIdx - (len - 1) + TRAIL * 2) % TRAIL;
        let px = s.trail[i0 * 2]!;
        let py = s.trail[i0 * 2 + 1]!;
        for (let k = 1; k < len; k++) {
          const idx = (i0 + k) % TRAIL;
          const x = s.trail[idx * 2]!;
          const y = s.trail[idx * 2 + 1]!;
          const f = k / len;
          const a = Math.min(1, f * f * 0.55 * alpha * bright);
          if (a > 0.01 && (x !== px || y !== py)) {
            g.strokeStyle = col + a + ')';
            g.lineWidth = s.size * scale * f * 1.4 + 0.3;
            g.beginPath();
            g.moveTo(px, py);
            g.lineTo(x, y);
            g.stroke();
          }
          px = x;
          py = y;
        }
      }

      // Head
      const sz = s.size * (10 + s.hover * 7) * scale * (0.85 + 0.15 * bright) * tw;
      g.globalAlpha = Math.min(1, alpha * (0.8 + 0.2 * bright));
      g.drawImage(this.sprites[s.tint]!, s.x - sz / 2, s.y - sz / 2, sz, sz);
      g.globalAlpha = 1;
      if (s.hover > 0.02) {
        g.lineWidth = 1;
        g.strokeStyle = `rgba(255,236,214,${s.hover * 0.4 * alpha})`;
        g.beginPath();
        g.arc(s.x, s.y, s.size * 3 + 6 + s.hover * 5, 0, TAU);
        g.stroke();
      }
    }
    g.lineCap = 'butt';
  }
}
