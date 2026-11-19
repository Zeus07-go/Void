// Living constellations: hidden animals among the stars that join up when discovered
// and awaken when touched. One canvas, one rAF loop, no per-frame React work.

import { ANIMALS } from './animals';
import { EDGE_DRAW_TIME, addPose, compile, newPose, resetPose, sampleAction, solve, type CompiledAnimal, type MutablePose } from './rig';

export type ConstellationTarget = { id: string; label: string; x: number; y: number; w: number; h: number; found: boolean };

export type SkyCallbacks = {
  /** Fired on resize and when an animal is discovered (rare — safe for React state). */
  onTargets?: (targets: ConstellationTarget[]) => void;
};

type Placement = { fx: number; fy: number; k: number };

type Instance = {
  c: CompiledAnimal;
  pos: Float32Array;
  pose: MutablePose;
  act: MutablePose;
  phase: number;
  // world placement
  cx: number;
  cy: number;
  s: number;
  box: { x: number; y: number; w: number; h: number };
  // state
  revealT: number; // < 0 = hidden
  dwell: number;
  hover: number;
  hoverTarget: boolean;
  actionT: number; // < 0 = idle
  queued: boolean;
  idleW: number;
  shimmer: number;
  pulses: number[]; // ring ages
  tint: number; // accent tint on the lines (lion's golden pulse)
  labelT: number;
};

const DWELL_TO_REVEAL = 0.35;
const TAU = Math.PI * 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class ConstellationSky {
  private ctx: CanvasRenderingContext2D;
  private items: Instance[];
  private w = 0;
  private h = 0;
  private dpr = 1;
  private raf = 0;
  private last = 0;
  private time = 0;
  private running = false;
  private focus = false;
  private focusAmt = 0;
  private reduced: boolean;
  private pointer: { x: number; y: number; active: boolean } = { x: 0, y: 0, active: false };
  private shimmerClock = 3;
  private glow: HTMLCanvasElement;
  private ambient: HTMLCanvasElement | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: SkyCallbacks = {},
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.glow = makeGlow();
    this.items = ANIMALS.map((def, i) => {
      const c = compile(def);
      return {
        c,
        pos: new Float32Array(c.base.length),
        pose: newPose(),
        act: newPose(),
        phase: i * 2.1,
        cx: 0,
        cy: 0,
        s: 1,
        box: { x: 0, y: 0, w: 0, h: 0 },
        revealT: -1,
        dwell: 0,
        hover: 0,
        hoverTarget: false,
        actionT: -1,
        queued: false,
        idleW: 1,
        shimmer: 0,
        pulses: [],
        tint: 0,
        labelT: 0,
      };
    });
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    window.addEventListener('pointerdown', this.onPointerDown, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
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
    window.removeEventListener('pointermove', this.onPointer);
    window.removeEventListener('pointerdown', this.onPointerDown);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /** Constellations mode: dark sky, every hidden animal hints at itself. */
  setFocus(on: boolean): void {
    this.focus = on;
  }

  setHover(id: string, on: boolean): void {
    const it = this.find(id);
    if (!it) return;
    it.hoverTarget = on;
    if (on) this.reveal(it);
  }

  /** Click / tap / Enter on an animal. */
  activate(id: string): void {
    const it = this.find(id);
    if (!it) return;
    if (!this.isRevealed(it)) {
      this.reveal(it);
      it.queued = true; // awaken as soon as it has fully joined
      return;
    }
    if (it.actionT >= 0) {
      it.queued = true; // replay once the current motion finishes — never overlap
      return;
    }
    this.awaken(it);
  }

  getTargets(): ConstellationTarget[] {
    return this.items.map((it) => ({
      id: it.c.def.id,
      label: it.c.def.label,
      ...it.box,
      found: it.revealT >= 0,
    }));
  }

  /** Dev/testing snapshot. */
  debug() {
    return this.items.map((it) => ({
      id: it.c.def.id,
      revealT: it.revealT,
      actionT: it.actionT,
      hover: it.hover,
      queued: it.queued,
      joints: Array.from(it.pos),
    }));
  }

  // ───────────────────────────── internals ─────────────────────────────

  private find(id: string): Instance | undefined {
    return this.items.find((i) => i.c.def.id === id);
  }

  private isRevealed(it: Instance): boolean {
    return it.revealT >= it.c.revealDuration;
  }

  private reveal(it: Instance): void {
    if (it.revealT >= 0) return;
    it.revealT = 0;
    it.labelT = 3;
    this.emitTargets();
  }

  private awaken(it: Instance): void {
    it.actionT = 0;
    it.queued = false;
    it.labelT = Math.max(it.labelT, 1.5);
  }

  private emitTargets(): void {
    this.cb.onTargets?.(this.getTargets());
  }

  private readonly resize = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width || window.innerWidth;
    this.h = rect.height || window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    const portrait = this.h > this.w * 1.15;
    const layout: Record<string, Placement> = portrait
      ? { eagle: { fx: 0.5, fy: 0.25, k: 0.62 }, lion: { fx: 0.47, fy: 0.47, k: 0.56 }, horse: { fx: 0.53, fy: 0.68, k: 0.54 } }
      : { eagle: { fx: 0.52, fy: 0.27, k: 0.3 }, lion: { fx: 0.24, fy: 0.58, k: 0.3 }, horse: { fx: 0.77, fy: 0.56, k: 0.3 } };
    const m = Math.min(this.w, this.h);
    for (const it of this.items) {
      const p = layout[it.c.def.id] ?? { fx: 0.5, fy: 0.5, k: 0.3 };
      it.s = (m * p.k) / 100;
      it.cx = p.fx * this.w;
      it.cy = p.fy * this.h;
      const b = it.c.bounds;
      const [ox, oy] = it.c.def.center;
      const pad = 6;
      it.box = {
        x: it.cx + (b.minX - ox - pad) * it.s,
        y: it.cy + (b.minY - oy - pad) * it.s,
        w: (b.maxX - b.minX + pad * 2) * it.s,
        h: (b.maxY - b.minY + pad * 2) * it.s,
      };
    }
    this.ambient = makeAmbient(this.w, this.h, this.dpr);
    this.emitTargets();
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) cancelAnimationFrame(this.raf);
    else if (this.running) {
      this.last = performance.now();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  private local(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private near(it: Instance, x: number, y: number, grow: number): boolean {
    const b = it.box;
    const gx = (b.w * (grow - 1)) / 2;
    const gy = (b.h * (grow - 1)) / 2;
    return x > b.x - gx && x < b.x + b.w + gx && y > b.y - gy && y < b.y + b.h + gy;
  }

  private readonly onPointer = (e: PointerEvent): void => {
    const p = this.local(e);
    this.pointer = { x: p.x, y: p.y, active: true };
  };

  // Touch has no hover: tapping near a hidden animal reveals it
  private readonly onPointerDown = (e: PointerEvent): void => {
    const p = this.local(e);
    this.pointer = { x: p.x, y: p.y, active: true };
    for (const it of this.items) if (it.revealT < 0 && this.near(it, p.x, p.y, 1.1)) this.reveal(it);
  };

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.update(dt);
    this.render();
  };

  private update(dt: number): void {
    this.time += dt;
    this.focusAmt += ((this.focus ? 1 : 0) - this.focusAmt) * Math.min(1, dt * 4);

    // Every few seconds a hidden animal shimmers, inviting discovery
    this.shimmerClock -= dt;
    if (this.shimmerClock <= 0) {
      this.shimmerClock = this.focus ? 3 : 7;
      const hidden = this.items.filter((i) => i.revealT < 0);
      const pick = hidden[Math.floor(Math.random() * hidden.length)];
      if (pick) pick.shimmer = 1;
    }

    for (const it of this.items) {
      // Discovery by lingering near (mouse/pen)
      if (it.revealT < 0) {
        it.dwell = this.pointer.active && this.near(it, this.pointer.x, this.pointer.y, 1.1) ? it.dwell + dt : 0;
        if (it.dwell > DWELL_TO_REVEAL) this.reveal(it);
      } else {
        it.revealT += this.reduced ? dt * 4 : dt;
        if (it.queued && it.actionT < 0 && this.isRevealed(it)) this.awaken(it);
      }

      it.shimmer = Math.max(0, it.shimmer - dt * 0.6);
      it.labelT = Math.max(0, it.labelT - dt);
      it.hover += ((it.hoverTarget && this.isRevealed(it) ? 1 : 0) - it.hover) * Math.min(1, dt * 10);
      it.tint = Math.max(0, it.tint - dt * 0.9);

      if (it.actionT >= 0) {
        const a = it.c.def.action;
        const prev = it.actionT;
        it.actionT += dt;
        for (const pt of a.pulses ?? []) {
          if (prev < pt && it.actionT >= pt) {
            it.pulses.push(0);
            it.tint = 1;
          }
        }
        const dur = this.reduced ? 1.2 : a.duration;
        if (this.reduced && prev === 0) it.pulses.push(0);
        if (it.actionT >= dur) {
          it.actionT = -1;
          if (it.queued) this.awaken(it);
        }
      }
      for (let i = 0; i < it.pulses.length; i++) it.pulses[i]! += dt;
      if (it.pulses.length && it.pulses[0]! > 1.6) it.pulses.shift();

      // Pose: idle breathing blended under the action keyframes
      const acting = it.actionT >= 0 && !this.reduced;
      it.idleW += ((acting ? 0.25 : 1) - it.idleW) * Math.min(1, dt * 5);
      resetPose(it.pose);
      if (!this.reduced) addPose(it.pose, it.c.def.idle(this.time + it.phase), it.idleW);
      if (acting) {
        sampleAction(it.c.def.action, it.actionT, it.act);
        addPose(it.pose, it.act, 1);
      }
      solve(it.c, it.pose, it.pos);
    }
  }

  private render(): void {
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.focusAmt > 0.01 && this.ambient) {
      g.globalAlpha = this.focusAmt;
      g.drawImage(this.ambient, 0, 0);
      g.globalAlpha = 1;
    }
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const it of this.items) this.drawAnimal(it);
  }

  private drawAnimal(it: Instance): void {
    const g = this.ctx;
    const { c, pos, s, cx, cy } = it;
    const [ox, oy] = c.def.center;
    const [ar, ag, ab] = c.def.accent;
    const X = (j: number) => cx + (pos[j * 2]! - ox) * s;
    const Y = (j: number) => cy + (pos[j * 2 + 1]! - oy) * s;
    const t = this.time;
    const hidden = it.revealT < 0;
    const rt = Math.max(0, it.revealT);
    const tint = it.tint;
    const lr = Math.round(255 + (ar - 255) * tint);
    const lg = Math.round(255 + (ag - 255) * tint);
    const lb = Math.round(255 + (ab - 255) * tint);

    // Lines join one by one from the seed joint
    if (!hidden) {
      g.lineCap = 'round';
      const baseA = 0.5 + 0.38 * it.hover + 0.15 * tint;
      g.lineWidth = 0.9 + 0.5 * it.hover;
      g.strokeStyle = `rgba(${lr},${lg},${lb},${baseA})`;
      const edges = c.edges;
      const all = rt >= c.revealDuration;
      g.beginPath();
      for (let k = 0; k < c.revealOrder.length; k++) {
        const e = c.revealOrder[k]!;
        const p = all ? 1 : clamp01((rt - c.revealDelay[e]!) / EDGE_DRAW_TIME);
        if (p <= 0) continue;
        const a = edges[e * 2]!;
        const b = edges[e * 2 + 1]!;
        // draw from the joint nearer the seed toward the other
        const from = c.jointDelay[a]! <= c.jointDelay[b]! ? a : b;
        const to = from === a ? b : a;
        const x0 = X(from);
        const y0 = Y(from);
        g.moveTo(x0, y0);
        g.lineTo(x0 + (X(to) - x0) * p, y0 + (Y(to) - y0) * p);
      }
      g.stroke();
      if (it.hover > 0.02 || tint > 0.02) {
        // soft halo on the lines when hovered / pulsing
        g.lineWidth = 4;
        g.strokeStyle = `rgba(${ar},${ag},${ab},${0.08 * it.hover + 0.14 * tint})`;
        g.stroke();
      }
    }

    // Star joints
    const n = c.names.length;
    for (let j = 0; j < n; j++) {
      const tw = 0.75 + 0.25 * Math.sin(t * (1.3 + (j % 5) * 0.37) + j * 1.7);
      let a: number;
      let size: number;
      if (hidden) {
        // just faint stars among many — until someone looks closely
        const sh = it.shimmer * Math.max(0, Math.sin(Math.PI * clamp01(1 - it.shimmer + (j / n) * 0.6 - 0.3)));
        a = (0.22 + 0.3 * this.focusAmt) * tw + 0.6 * sh + 0.35 * Math.min(1, it.dwell / DWELL_TO_REVEAL);
        size = 5 + 4 * sh;
      } else {
        const jr = clamp01((rt - c.jointDelay[j]!) / 0.25);
        const flash = jr > 0 && jr < 1 ? Math.sin(Math.PI * jr) : 0; // each star flares as its line arrives
        a = (0.25 + 0.65 * jr) * tw + 0.5 * flash + 0.25 * it.hover;
        size = 6 + 5 * flash + 3 * it.hover + 3 * tint;
      }
      a = Math.min(1, a);
      if (a < 0.01) continue;
      const x = X(j);
      const y = Y(j);
      g.globalAlpha = a;
      g.drawImage(this.glow, x - size / 2, y - size / 2, size, size);
      g.fillStyle = '#fff';
      g.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
    }
    g.globalAlpha = 1;

    // Awakening pulses (golden for the lion)
    for (const age of it.pulses) {
      const u = age / 1.6;
      const r = (12 + 80 * (1 - Math.pow(1 - u, 3))) * s;
      g.lineWidth = 1.5 + 4 * (1 - u);
      g.strokeStyle = `rgba(${ar},${ag},${ab},${0.6 * Math.pow(1 - u, 2)})`;
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.stroke();
    }

    // Name, shown when found and on hover
    const la = Math.max(Math.min(1, it.labelT), it.hover) * (hidden ? 0 : 1);
    if (la > 0.01) {
      g.globalAlpha = la * 0.85;
      g.font = '500 10px "Space Grotesk", ui-sans-serif, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'top';
      (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '3px';
      g.fillStyle = `rgb(${ar},${ag},${ab})`;
      g.fillText(it.c.def.label.toUpperCase(), it.box.x + it.box.w / 2, it.box.y + it.box.h + 4);
      (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
      g.globalAlpha = 1;
    }
  }
}

function makeGlow(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  gr.addColorStop(0.45, 'rgba(210,225,255,0.18)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
  return c;
}

/** Sparse ambient stars for Constellations mode's dark sky. */
function makeAmbient(w: number, h: number, dpr: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const n = Math.floor((w * h) / 5200);
  for (let i = 0; i < n; i++) {
    const r = rnd() < 0.92 ? 0.35 + rnd() * 0.4 : 0.8 + rnd() * 0.5;
    g.fillStyle = `rgba(235,238,255,${0.12 + rnd() * 0.4})`;
    g.beginPath();
    g.arc(rnd() * w, rnd() * h, r, 0, TAU);
    g.fill();
  }
  return c;
}
