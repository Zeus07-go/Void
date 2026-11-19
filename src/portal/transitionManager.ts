// UniverseTransitionManager — the single owner of every portal jump.
// State machine: idle → charging → collapsing → breaching → traveling → arriving → idle.
// Scenes register small hooks; the manager drives them, swaps scenes at a safe midpoint
// (while the tunnel fully covers the screen), reveals the destination and cleans up.

import { getSharedAudio } from '../engine/audio';
import { PortalTunnel } from './PortalTunnel';

export type UniverseId = 'singularity' | 'kaleidoscope';
export const UNIVERSE_IDS: readonly UniverseId[] = ['singularity', 'kaleidoscope'];

export type PortalPhase = 'idle' | 'charging' | 'collapsing' | 'breaching' | 'traveling' | 'arriving';

export type PortalState = {
  current: UniverseId;
  phase: PortalPhase;
  destination: UniverseId | null;
};

/** Optional hooks a scene can register so the portal can choreograph it. */
export type SceneHooks = {
  /** Where the portal opens from (CSS px). Defaults to the screen centre. */
  getHole?: () => { cx: number; cy: number; R: number } | null;
  /** 0 → 1 while the user is pulled out of this scene. */
  setCollapse?: (p: number) => void;
  /** 1 → 0 while the user arrives in this scene. */
  setEmerge?: (p: number) => void;
  /** Scene is being left (fully covered by the tunnel): pause heavy work here. */
  onLeave?: () => void;
  /** Scene is becoming current (still covered by the tunnel): reset/resume here. */
  onEnter?: () => void;
};

type Timeline = { collapseEnd: number; breachStart: number; breachEnd: number; swap: number; travelEnd: number; end: number };

const FULL: Timeline = { collapseEnd: 0.35, breachStart: 0.3, breachEnd: 0.72, swap: 1.2, travelEnd: 1.75, end: 2.45 };
// Reduced motion / constrained devices: short, calm, no rushing tunnel
const CALM: Timeline = { collapseEnd: 0.2, breachStart: 0.05, breachEnd: 0.4, swap: 0.5, travelEnd: 0.6, end: 1.1 };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeInCubic = (t: number) => t * t * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

class UniverseTransitionManager {
  private state: PortalState = { current: 'singularity', phase: 'idle', destination: null };
  private listeners = new Set<() => void>();
  private hooks = new Map<UniverseId, SceneHooks>();
  private canvas: HTMLCanvasElement | null = null;
  private tunnel: PortalTunnel | null = null;

  private raf = 0;
  private t = 0;
  private last = 0;
  private travel = 0;
  private tl: Timeline = FULL;
  private source: UniverseId = 'singularity';
  private dest: UniverseId = 'kaleidoscope';
  private swapped = false;
  private left = false;
  private arrivedSound = false;
  private origin = { cx: 0, cy: 0, R: 0 };

  // ── store (useSyncExternalStore) ──
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): PortalState => this.state;

  private set(patch: Partial<PortalState>): void {
    const next = { ...this.state, ...patch };
    if (next.current === this.state.current && next.phase === this.state.phase && next.destination === this.state.destination) return;
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  // ── wiring ──
  attach(canvas: HTMLCanvasElement): () => void {
    this.canvas = canvas;
    const simple = prefersCalm();
    this.tunnel = new PortalTunnel(canvas, simple);
    canvas.style.display = 'none';
    // Compile the tunnel shader while idle so the first jump starts instantly
    const warm = window.setTimeout(() => this.tunnel?.warm(), 600);
    return () => {
      window.clearTimeout(warm);
      this.abortLoop();
      this.tunnel?.destroy();
      this.tunnel = null;
      this.canvas = null;
    };
  }

  registerScene(id: UniverseId, hooks: SceneHooks): () => void {
    this.hooks.set(id, hooks);
    return () => {
      if (this.hooks.get(id) === hooks) this.hooks.delete(id);
    };
  }

  isBusy(): boolean {
    const p = this.state.phase;
    return p !== 'idle' && p !== 'charging';
  }

  setCharging(on: boolean): void {
    if (this.isBusy()) return;
    this.set({ phase: on ? 'charging' : 'idle' });
  }

  // ── the jump ──
  startPortalJump = (destination: UniverseId): boolean => {
    if (!UNIVERSE_IDS.includes(destination)) {
      console.warn(`VOID: unknown universe "${String(destination)}"`);
      return false;
    }
    if (this.isBusy() || destination === this.state.current || !this.canvas || !this.tunnel) return false;

    this.source = this.state.current;
    this.dest = destination;
    this.tl = prefersCalm() || this.tunnel.isSimple ? CALM : FULL;
    this.t = 0;
    this.travel = 0;
    this.swapped = false;
    this.left = false;
    this.arrivedSound = false;

    const hole = this.hooks.get(this.source)?.getHole?.();
    this.origin = hole ?? { cx: window.innerWidth / 2, cy: window.innerHeight / 2, R: 0 };

    this.canvas.style.display = 'block';
    this.canvas.style.pointerEvents = 'auto'; // block input mid-jump
    const audio = getSharedAudio();
    audio.ensure();
    audio.whoosh(this.tl.end * 0.85, destination === 'singularity');

    this.set({ phase: 'collapsing', destination });
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
    return true;
  };

  private frame = (now: number): void => {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.t += dt;
    const { t, tl } = this;

    try {
      this.step(t, dt);
    } catch (err) {
      console.error('VOID: portal frame failed, recovering', err);
      this.recover();
      return;
    }

    if (t >= tl.end) {
      this.finish();
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private step(t: number, dt: number): void {
    const tl = this.tl;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const diag = Math.hypot(w, h) * 0.6;

    // Phase bookkeeping (React re-renders only on these few changes)
    const phase: PortalPhase = t < tl.collapseEnd ? 'collapsing' : t < tl.breachEnd ? 'breaching' : t < tl.travelEnd ? 'traveling' : 'arriving';
    this.set({ phase });

    const src = this.hooks.get(this.source);
    if (!this.swapped) {
      src?.setCollapse?.(easeInCubic(clamp01(t / tl.breachEnd)));
      const live = src?.getHole?.();
      if (live) this.origin = live;
    }

    // Once the tunnel fully covers the view, stop rendering the source scene
    if (!this.left && t >= tl.breachEnd + 0.04) {
      this.left = true;
      src?.onLeave?.();
    }

    // Swap scenes while the tunnel covers everything
    if (!this.swapped && t >= tl.swap) this.swap();

    if (this.swapped) {
      const d = this.hooks.get(this.dest);
      d?.setEmerge?.(1 - easeOutCubic(clamp01((t - tl.swap) / (tl.end - tl.swap))));
    }

    if (!this.arrivedSound && t >= tl.travelEnd) {
      this.arrivedSound = true;
      getSharedAudio().arrive(this.dest === 'singularity');
    }

    // Breach: the tunnel opens out of the event horizon and swallows the view
    const bu = smooth(tl.breachStart, tl.breachEnd, t);
    const startR = this.origin.R > 0 ? this.origin.R * 0.92 : 0;
    const maskR = bu <= 0 ? 0 : startR + (diag * 1.15 - startR) * easeInCubic(bu);

    // Accelerate, cruise, then decelerate on arrival
    const speed = smooth(tl.collapseEnd * 0.6, tl.breachEnd + 0.3, t) * (1 - 0.8 * smooth(tl.travelEnd, tl.end, t));
    this.travel += dt * (0.25 + 3.4 * speed);

    // Arrival: the last ring expands past the viewport, revealing the destination
    const au = clamp01((t - tl.travelEnd) / (tl.end - tl.travelEnd - 0.1));
    const holeR = au <= 0 ? 0 : easeInOutCubic(au) * diag * 1.25;
    const alpha = 1 - smooth(tl.end - 0.3, tl.end, t);

    this.tunnel!.render({
      w,
      h,
      dpr: window.devicePixelRatio || 1,
      cx: this.origin.cx,
      cy: this.origin.cy,
      time: t,
      travel: this.travel,
      speed,
      pal: smooth(tl.breachStart, tl.end - 0.15, t),
      reverse: this.dest === 'singularity',
      maskR,
      holeR,
      alpha,
    });
  }

  private swap(): void {
    this.swapped = true;
    const from = this.hooks.get(this.source);
    try {
      if (!this.left) {
        this.left = true;
        from?.onLeave?.();
      }
      this.set({ current: this.dest });
      this.hooks.get(this.dest)?.onEnter?.();
    } catch (err) {
      console.error('VOID: could not enter destination, returning', err);
      this.dest = this.source;
      this.set({ current: this.source, destination: this.source });
      from?.onEnter?.();
    }
  }

  private finish(): void {
    cancelAnimationFrame(this.raf);
    this.hooks.get(this.dest)?.setEmerge?.(0);
    this.tunnel?.clear();
    if (this.canvas) {
      this.canvas.style.display = 'none';
      this.canvas.style.pointerEvents = 'none';
    }
    this.set({ phase: 'idle', destination: null });
  }

  /** Something threw mid-jump: land somewhere valid with no overlay left behind. */
  private recover(): void {
    if (!this.swapped) {
      this.hooks.get(this.source)?.setCollapse?.(0);
      this.dest = this.source;
    } else {
      this.hooks.get(this.dest)?.setEmerge?.(0);
    }
    this.finish();
  }

  private abortLoop(): void {
    if (this.isBusy()) this.recover();
    cancelAnimationFrame(this.raf);
  }
}

function prefersCalm(): boolean {
  if (typeof window === 'undefined') return true;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  if (new URLSearchParams(window.location.search).get('portal') === 'simple') return true;
  return false;
}

export const portal = new UniverseTransitionManager();
if (import.meta.env.DEV) (window as unknown as { __portal?: UniverseTransitionManager }).__portal = portal;

/** Public navigation API. */
export function startPortalJump(destination: UniverseId): boolean {
  return portal.startPortalJump(destination);
}
