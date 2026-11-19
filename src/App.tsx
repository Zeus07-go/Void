import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Info, Orbit, Pause, Play, RotateCcw, Volume2, VolumeX, X } from 'lucide-react';
import { Universe } from './engine/Universe';
import { portal, startPortalJump, type PortalPhase } from './portal/transitionManager';

const G_MIN = 0.2;
const G_MAX = 2.5;

const gravityLabel = (g: number) => (g < 0.6 ? 'Drift' : g < 1.4 ? 'Orbit' : g < 2 ? 'Pull' : 'Collapse');

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type AppProps = {
  /** Current portal phase (changes only a handful of times per jump). */
  phase: PortalPhase;
  /** False while another universe is showing. */
  active: boolean;
};

/** Universe 01 — the singularity. */
export const App = ({ phase, active }: AppProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const universeRef = useRef<Universe | null>(null);
  const [absorbed, setAbsorbed] = useState(0);
  const [gravity, setGravity] = useState(1);
  const [still, setStill] = useState(prefersReducedMotion);
  const [muted, setMuted] = useState(false);
  const [touched, setTouched] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const u = new Universe(canvas, glRef.current, {
      onAbsorb: setAbsorbed,
      onFirstGrab: () => setTouched(true),
      onChargeStart: () => portal.setCharging(true),
      onChargeCancel: () => portal.setCharging(false),
      onPortalCharged: () => startPortalJump('kaleidoscope'),
    });
    universeRef.current = u;
    u.start();
    // The black hole is the portal: let the transition manager choreograph it
    const unregister = portal.registerScene('singularity', {
      getHole: () => u.getHole(),
      setCollapse: (p) => u.setPortalCollapse(p),
      setEmerge: (p) => u.setPortalEmerge(p),
      onLeave: () => u.pause(),
      onEnter: () => {
        u.prepareArrival();
        u.setPortalEmerge(1);
        u.resume();
      },
    });
    if (import.meta.env.DEV) (window as unknown as { __void?: Universe }).__void = u;
    return () => {
      unregister();
      u.destroy();
      universeRef.current = null;
    };
  }, []);

  useEffect(() => universeRef.current?.setGravity(gravity), [gravity]);
  useEffect(() => universeRef.current?.setStill(still), [still]);
  useEffect(() => universeRef.current?.setMuted(muted), [muted]);

  const reset = () => universeRef.current?.reset();
  const enterVoid = () => startPortalJump('kaleidoscope');
  const activeRef = useRef(active);
  activeRef.current = active;
  const jumping = phase !== 'idle' && phase !== 'charging';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current || portal.isBusy()) return;
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'r') universeRef.current?.reset();
      else if (k === 's') setStill((v) => !v);
      else if (k === 'm') setMuted((v) => !v);
      else if (k === 'escape') setInfoOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fill = `${((gravity - G_MIN) / (G_MAX - G_MIN)) * 100}%`;

  return (
    <main className="fixed inset-0 select-none overflow-hidden bg-void font-sans text-ink">
      <canvas ref={glRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        aria-label="An interactive black hole. Drag stars and throw them into the event horizon. Tap empty space to create new stars."
      />

      <div
        data-jumping={jumping}
        className="void-ui pointer-events-none absolute inset-0 flex flex-col justify-between p-4 sm:p-8 [padding-bottom:max(1rem,env(safe-area-inset-bottom))]"
      >
        {/* Top bar */}
        <header className="void-in flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-[26px] font-bold leading-none tracking-[0.55em] sm:text-[34px]">VOID</h1>
            <p className="mt-2 text-[10px] uppercase tracking-[0.32em] text-muted sm:text-[11px]">A universe you can touch</p>
          </div>
          <div className="pointer-events-auto flex gap-2">
            <button
              type="button"
              className="void-btn"
              aria-pressed={still}
              onClick={() => setStill((v) => !v)}
              title="Stillness (S)"
            >
              {still ? <Play size={13} strokeWidth={1.6} /> : <Pause size={13} strokeWidth={1.6} />}
              <span className="hidden sm:inline">Stillness</span>
            </button>
            <button
              type="button"
              className="void-btn icon"
              aria-pressed={muted}
              aria-label={muted ? 'Unmute sound' : 'Mute sound'}
              onClick={() => setMuted((v) => !v)}
              title="Sound (M)"
            >
              {muted ? <VolumeX size={15} strokeWidth={1.6} /> : <Volume2 size={15} strokeWidth={1.6} />}
            </button>
            <button
              type="button"
              className="void-btn icon"
              aria-expanded={infoOpen}
              aria-label="About VOID"
              onClick={() => setInfoOpen((v) => !v)}
            >
              {infoOpen ? <X size={15} strokeWidth={1.6} /> : <Info size={15} strokeWidth={1.6} />}
            </button>
          </div>
        </header>

        {/* Bottom bar */}
        <footer className="void-in flex flex-col gap-4">
          <div className="flex flex-col items-center gap-3 sm:hidden">
            <p
              className={`text-center font-display text-[11px] uppercase tracking-[0.3em] ${
                touched ? 'text-muted' : 'void-breathe text-warm'
              }`}
            >
              Drag a star. Bend its fate.
            </p>
            <button type="button" className="void-btn portal pointer-events-auto" onClick={enterVoid}>
              <Orbit size={13} strokeWidth={1.6} />
              Enter the void
            </button>
          </div>
          <div className="flex items-end justify-between gap-4">
            <div className="hidden min-w-0 flex-1 sm:block">
              <p
                className={`font-display text-[12px] uppercase tracking-[0.32em] ${
                  touched ? 'text-muted' : 'void-breathe text-warm'
                }`}
              >
                Drag a star. Bend its fate.
              </p>
              <p className="mt-2 text-[11px] tracking-[0.18em] text-muted/80">
                <span key={absorbed} className={`tabular-nums text-ink ${absorbed ? 'void-pop' : ''}`}>
                  {absorbed}
                </span>{' '}
                {absorbed === 1 ? 'star' : 'stars'} consumed
              </p>
              <button type="button" className="void-btn portal pointer-events-auto mt-4" onClick={enterVoid} title="Or hold the black hole">
                <Orbit size={13} strokeWidth={1.6} />
                Enter the void
              </button>
            </div>

            <label className="pointer-events-auto flex w-full max-w-[300px] flex-1 flex-col gap-1 sm:flex-none">
              <span className="flex items-baseline justify-between font-display text-[10px] uppercase tracking-[0.32em] text-muted">
                <span>Gravity</span>
                <span className="tabular-nums tracking-[0.15em] text-ink/80">
                  {gravityLabel(gravity)} · {gravity.toFixed(2)}×
                </span>
              </span>
              <input
                type="range"
                className="void-range"
                min={G_MIN}
                max={G_MAX}
                step={0.01}
                value={gravity}
                onChange={(e) => setGravity(Number(e.target.value))}
                onDoubleClick={() => setGravity(1)}
                style={{ '--fill': fill } as CSSProperties}
                aria-valuetext={`${gravityLabel(gravity)}, ${gravity.toFixed(2)} times`}
              />
            </label>

            <div className="flex flex-1 justify-end sm:min-w-0">
              <button type="button" className="void-btn pointer-events-auto" onClick={reset} title="Reset (R)">
                <RotateCcw size={13} strokeWidth={1.6} />
                <span className="hidden sm:inline">Reset Universe</span>
                <span className="sm:hidden">Reset</span>
              </button>
            </div>
          </div>
        </footer>
      </div>

      {infoOpen && (
        <div
          role="dialog"
          aria-label="About VOID"
          className="void-in absolute right-4 top-20 w-[min(320px,calc(100vw-2rem))] rounded-2xl border border-line bg-void2/90 p-5 text-[13px] leading-relaxed text-muted [animation-delay:0s] sm:right-8 sm:top-24"
        >
          <p className="font-display text-[11px] uppercase tracking-[0.3em] text-ink">Lose yourself in infinity</p>
          <ul className="mt-3 space-y-1.5">
            <li>
              <span className="text-ink">Drag</span> a star and <span className="text-ink">throw</span> it — gravity does the rest.
            </li>
            <li>
              <span className="text-ink">Tap</span> empty space to ripple spacetime and birth a star.
            </li>
            <li>
              <span className="text-ink">Tap</span> the void itself. It answers.
            </li>
            <li>Feed it quickly — the chimes climb.</li>
          </ul>
          <p className="mt-4 text-[11px] tracking-[0.12em] text-muted/80">
            Keys: <kbd className="text-ink">R</kbd> reset · <kbd className="text-ink">S</kbd> stillness ·{' '}
            <kbd className="text-ink">M</kbd> mute
          </p>
        </div>
      )}
    </main>
  );
};
