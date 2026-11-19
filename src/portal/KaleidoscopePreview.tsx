// TEMPORARY destination preview for Universe 02.
// Kiro's real Kaleidoscope scene replaces this via src/portal/destinations.ts.

import { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { DestinationProps } from './destinations';

export const KaleidoscopePreview = ({ onReturn }: DestinationProps) => {
  const returnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    returnRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main className="kaleido-preview fixed inset-0 select-none overflow-hidden font-sans text-ink">
      <div className="kaleido-nebula kaleido-nebula-a" aria-hidden="true" />
      <div className="kaleido-nebula kaleido-nebula-b" aria-hidden="true" />

      <div className="absolute inset-0 flex flex-col justify-between p-4 sm:p-8">
        <header>
          <h1 className="font-display text-[22px] font-bold leading-none tracking-[0.45em] sm:text-[30px]">VOID / 02</h1>
          <p className="mt-2 font-display text-[11px] uppercase tracking-[0.4em] text-[#c8c0ff]">The Kaleidoscope</p>
        </header>

        <div className="mx-auto max-w-sm text-center">
          <p className="font-display text-[11px] uppercase tracking-[0.32em] text-[#a8a0e0]">Destination preview</p>
          <p className="mt-3 text-[13px] leading-relaxed text-[#cfc9f5]/80">
            The full Kaleidoscope scene is in progress. This placeholder exists so the portal can be tested end to end.
          </p>
        </div>

        <footer className="flex justify-center sm:justify-start">
          <button ref={returnRef} type="button" className="void-btn kaleido-btn" onClick={onReturn}>
            <ArrowLeft size={13} strokeWidth={1.6} />
            Return to the singularity
          </button>
        </footer>
      </div>
    </main>
  );
};
