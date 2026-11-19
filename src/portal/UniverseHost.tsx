// Mounts both universes and the portal overlay.
// The singularity stays mounted (paused while away) so returning never rebuilds the black hole.

import { Component, useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { App } from '../App';
import { KaleidoscopeScene } from './destinations';
import { KaleidoscopePreview } from './KaleidoscopePreview';
import { portal, startPortalJump } from './transitionManager';

class DestinationBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error('VOID: destination scene crashed, showing preview', err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export const UniverseHost = () => {
  const state = useSyncExternalStore(portal.subscribe, portal.getState, portal.getState);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = overlayRef.current;
    return c ? portal.attach(c) : undefined;
  }, []);

  const goHome = useCallback(() => {
    startPortalJump('singularity');
  }, []);

  const home = state.current === 'singularity';

  return (
    <>
      <div style={{ visibility: home ? 'visible' : 'hidden' }} inert={!home} aria-hidden={!home}>
        <App phase={state.phase} active={home} />
      </div>

      {state.current === 'kaleidoscope' && (
        <DestinationBoundary fallback={<KaleidoscopePreview onReturn={goHome} />}>
          <KaleidoscopeScene onReturn={goHome} />
        </DestinationBoundary>
      )}

      <canvas
        ref={overlayRef}
        className="fixed inset-0 h-full w-full"
        style={{ zIndex: 50, display: 'none', touchAction: 'none' }}
        aria-hidden="true"
      />
      <p className="sr-only" aria-live="polite">
        {state.phase === 'traveling' ? 'Jumping between universes' : home ? 'Universe 01, the singularity' : 'Universe 02, the Kaleidoscope'}
      </p>
    </>
  );
};
