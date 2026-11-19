// Drop-in layer for Universe 02. Sits between a scene's canvas and its UI.
// Easter-egg mode (default): animals hide as faint stars; painting underneath is untouched,
// only an animal you have found becomes clickable. Focus mode: dark sky, every animal live.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ConstellationSky, type ConstellationTarget } from './ConstellationSky';

type Props = {
  /** Constellations mode — dims the scene underneath and makes every animal interactive. */
  focus: boolean;
};

export const ConstellationLayer = ({ focus }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const skyRef = useRef<ConstellationSky | null>(null);
  const [targets, setTargets] = useState<ConstellationTarget[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let sky: ConstellationSky;
    try {
      sky = new ConstellationSky(canvas, { onTargets: setTargets });
    } catch (err) {
      console.warn('VOID: constellations unavailable', err);
      return;
    }
    skyRef.current = sky;
    sky.start();
    if (import.meta.env.DEV) (window as unknown as { __sky?: ConstellationSky }).__sky = sky;
    return () => {
      sky.destroy();
      skyRef.current = null;
    };
  }, []);

  useEffect(() => skyRef.current?.setFocus(focus), [focus]);

  const hover = (id: string, on: boolean) => (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') skyRef.current?.setHover(id, on);
  };

  return (
    <div className="cn-layer" data-focus={focus}>
      <div className="cn-backdrop" aria-hidden="true" />
      <canvas ref={canvasRef} className="cn-canvas" aria-hidden="true" />
      {focus && <p className="cn-caption">Linger on the stars. Some of them are alive.</p>}
      {targets.map((t) => (
        <button
          key={t.id}
          type="button"
          className="cn-target"
          data-live={focus || t.found}
          style={{ left: t.x, top: t.y, width: t.w, height: t.h }}
          aria-label={t.found ? `${t.label} constellation — awaken` : 'Hidden constellation — reveal'}
          onPointerEnter={hover(t.id, true)}
          onPointerLeave={hover(t.id, false)}
          onFocus={() => skyRef.current?.setHover(t.id, true)}
          onBlur={() => skyRef.current?.setHover(t.id, false)}
          onClick={() => skyRef.current?.activate(t.id)}
        />
      ))}
    </div>
  );
};
