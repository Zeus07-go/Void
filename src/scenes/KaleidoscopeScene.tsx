/**
 * VOID — Universe 02: The Kaleidoscope
 *
 * Props:
 *   onReturn  — called when the user wants to return to Universe 01.
 *               Wire this to Claude's startPortalJump("singularity") or
 *               your own scene-manager callback.
 *   isActive  — when false the animation loop is paused (used by the
 *               shared scene manager to save resources while transitioning).
 *
 * Integration note:
 *   This component does NOT own the portal transition.  It simply calls
 *   onReturn() and lets the parent/portal-controller handle the animation.
 *   If Claude's portal controller exposes startPortalJump(destination),
 *   pass it as: <KaleidoscopeScene onReturn={() => startPortalJump("singularity")} />
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { KaleidoscopeEngine, type InteractionMode } from './kaleidoscope/KaleidoscopeEngine';
import { KaleidoscopeControls } from './kaleidoscope/KaleidoscopeControls';
import type { SymmetryFold } from './kaleidoscope/SymmetryEngine';
import type { PaletteName } from './kaleidoscope/PaletteConfig';
import { portal } from '../portal/transitionManager';
import { ConstellationLayer } from '../constellations/ConstellationLayer';
import { SpaceBackdrop } from './space/SpaceBackdrop';
import './kaleidoscope/kaleidoscope.css';

export interface KaleidoscopeSceneProps {
  /** Called when user requests to return to Universe 01. */
  onReturn: () => void;
  /** When false, the animation loop is paused. Defaults to true. */
  isActive?: boolean;
}

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function KaleidoscopeScene({ onReturn, isActive = true }: KaleidoscopeSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spaceRef = useRef<HTMLCanvasElement>(null);
  const backdropRef = useRef<SpaceBackdrop | null>(null);
  const engineRef = useRef<KaleidoscopeEngine | null>(null);

  // UI state — only these trigger React renders (never updated per frame)
  const [symmetry, setSymmetry] = useState<SymmetryFold>(6);
  const [palette, setPalette] = useState<PaletteName>('violet');
  const [mode, setMode] = useState<InteractionMode>('paint');
  const [still, setStill] = useState(prefersReduced);
  const [hasPainted, setHasPainted] = useState(false);
  // Living constellations: easter eggs by default, or a dedicated focus mode
  const [constellations, setConstellations] = useState(false);

  // Boot the engine once on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new KaleidoscopeEngine(canvas, {
      onFirstPaint: () => setHasPainted(true),
    });
    engine.attachEvents();
    engine.start();
    engineRef.current = engine;

    // Register with the portal so it can choreograph arrive/leave
    const unregister = portal.registerScene('kaleidoscope', {
      onLeave: () => engine.setStill(true),
      onEnter: () => engine.setStill(false),
    });

    // Expose on window for dev inspection
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__kaleidoscope = engine;
    }

    return () => {
      unregister();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Living space behind the kaleidoscope. Falls back to the engine's static sky without WebGL.
  useEffect(() => {
    const c = spaceRef.current;
    if (!c) return;
    let backdrop: SpaceBackdrop;
    try {
      backdrop = new SpaceBackdrop(c);
    } catch (err) {
      console.warn('VOID: moving space unavailable, using static sky', err);
      c.style.display = 'none';
      return;
    }
    backdropRef.current = backdrop;
    backdrop.start();
    engineRef.current?.setTransparentBackground(true);
    return () => {
      engineRef.current?.setTransparentBackground(false);
      backdrop.destroy();
      backdropRef.current = null;
    };
  }, []);

  useEffect(() => {
    backdropRef.current?.setPaused(!isActive || constellations);
    backdropRef.current?.setStill(still);
  }, [isActive, constellations, still]);

  // Sync isActive → pause/resume
  useEffect(() => {
    // The engine's internal visibility handler covers tab-hide;
    // isActive handles scene-manager pausing.
    // We re-use setStill for the external pause signal.
    engineRef.current?.setStill(!isActive || still || constellations);
  }, [isActive, still, constellations]);

  useEffect(() => {
    if (!constellations) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConstellations(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [constellations]);

  // Propagate setting changes — no re-renders inside the engine
  const handleSymmetry = useCallback((f: SymmetryFold) => {
    setSymmetry(f);
    engineRef.current?.setSymmetry(f);
  }, []);

  const handlePalette = useCallback((p: PaletteName) => {
    setPalette(p);
    engineRef.current?.setPalette(p);
  }, []);

  const handleMode = useCallback((m: InteractionMode) => {
    setMode(m);
    engineRef.current?.setMode(m);
  }, []);

  const handleClear = useCallback(() => {
    engineRef.current?.clearPainting();
  }, []);

  const handleStill = useCallback(() => {
    setStill((v) => {
      const next = !v;
      engineRef.current?.setStill(next);
      return next;
    });
  }, []);

  const handleReturn = useCallback(() => {
    // Delegate entirely to the parent — no self-managed transition
    onReturn();
  }, [onReturn]);

  return (
    <div className="kc-scene" aria-label="Universe 02 — The Kaleidoscope">
      <canvas ref={spaceRef} className="kc-canvas" aria-hidden="true" />
      <canvas
        ref={canvasRef}
        className="kc-canvas"
        aria-label="Interactive kaleidoscope canvas. Drag to paint symmetrical light trails. Tap to create ripples."
      />

      <ConstellationLayer focus={constellations} />

      <button
        type="button"
        className="void-btn cn-toggle"
        aria-pressed={constellations}
        onClick={() => setConstellations((v) => !v)}
        title="Some stars are alive"
      >
        ✦ Constellations
      </button>

      <div className="kc-overlay">
        {/* ── Header ── */}
        <header className="kc-header">
          <div className="kc-title-block">
            <p className="kc-eyebrow">VOID / 02</p>
            <h1 className="kc-title">The Kaleidoscope</h1>
            <p className="kc-tagline">Shape the infinite.</p>
          </div>
        </header>

        {/* ── Hint ── */}
        <div className="kc-hints" aria-live="polite">
          <p className={`kc-hint-text${hasPainted ? ' kc-hint-hidden' : ''}`}>
            Drag to paint · Click to ripple
          </p>
        </div>

        {/* ── Controls ── */}
        <footer>
          <KaleidoscopeControls
            symmetry={symmetry}
            palette={palette}
            mode={mode}
            still={still}
            onSymmetry={handleSymmetry}
            onPalette={handlePalette}
            onMode={handleMode}
            onClear={handleClear}
            onStill={handleStill}
            onReturn={handleReturn}
          />
        </footer>
      </div>
    </div>
  );
}
