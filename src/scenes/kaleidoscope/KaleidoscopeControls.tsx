import type { SymmetryFold } from './SymmetryEngine';
import type { PaletteName } from './PaletteConfig';
import type { InteractionMode } from './KaleidoscopeEngine';
import { PALETTES } from './PaletteConfig';

interface Props {
  symmetry: SymmetryFold;
  palette: PaletteName;
  mode: InteractionMode;
  still: boolean;
  onSymmetry: (f: SymmetryFold) => void;
  onPalette: (p: PaletteName) => void;
  onMode: (m: InteractionMode) => void;
  onClear: () => void;
  onStill: () => void;
  onReturn: () => void;
}

const FOLDS: SymmetryFold[] = [2, 4, 6, 8];
const PALETTE_NAMES: PaletteName[] = ['violet', 'aurora', 'stellar'];

export function KaleidoscopeControls({
  symmetry,
  palette,
  mode,
  still,
  onSymmetry,
  onPalette,
  onMode,
  onClear,
  onStill,
  onReturn,
}: Props) {
  return (
    <div className="kc-controls" role="toolbar" aria-label="Kaleidoscope controls">
      {/* Symmetry */}
      <div className="kc-group">
        <span className="kc-label">Symmetry</span>
        <div className="kc-row">
          {FOLDS.map((f) => (
            <button
              key={f}
              type="button"
              className={`kc-btn kc-pill${symmetry === f ? ' kc-active' : ''}`}
              onClick={() => onSymmetry(f)}
              aria-pressed={symmetry === f}
              title={`${f}-fold symmetry`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="kc-divider" aria-hidden="true" />

      {/* Palette */}
      <div className="kc-group">
        <span className="kc-label">Palette</span>
        <div className="kc-row">
          {PALETTE_NAMES.map((p) => (
            <button
              key={p}
              type="button"
              className={`kc-btn kc-pill${palette === p ? ' kc-active' : ''}`}
              onClick={() => onPalette(p)}
              aria-pressed={palette === p}
              title={PALETTES[p].label}
            >
              <span
                className="kc-swatch"
                style={{ background: PALETTES[p].swatch }}
                aria-hidden="true"
              />
              <span className="kc-swatch-label">{PALETTES[p].label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="kc-divider" aria-hidden="true" />

      {/* Mode */}
      <div className="kc-group">
        <span className="kc-label">Mode</span>
        <div className="kc-row">
          <button
            type="button"
            className={`kc-btn kc-pill${mode === 'paint' ? ' kc-active' : ''}`}
            onClick={() => onMode('paint')}
            aria-pressed={mode === 'paint'}
          >
            Paint
          </button>
          <button
            type="button"
            className={`kc-btn kc-pill${mode === 'bloom' ? ' kc-active' : ''}`}
            onClick={() => onMode('bloom')}
            aria-pressed={mode === 'bloom'}
            title="Hold to grow energy bloom, release to burst"
          >
            Bloom
          </button>
        </div>
      </div>

      <div className="kc-divider" aria-hidden="true" />

      {/* Utility */}
      <div className="kc-group kc-row">
        <button
          type="button"
          className="kc-btn kc-pill kc-util"
          onClick={onClear}
          title="Dissolve all painted patterns"
        >
          Clear Universe
        </button>
        <button
          type="button"
          className={`kc-btn kc-pill kc-util${still ? ' kc-active' : ''}`}
          onClick={onStill}
          aria-pressed={still}
          title="Pause ambient animation"
        >
          {still ? '▶ Resume' : '⏸ Stillness'}
        </button>
      </div>

      <div className="kc-divider" aria-hidden="true" />

      {/* Return */}
      <button
        type="button"
        className="kc-btn kc-return"
        onClick={onReturn}
        title="Return to Universe 01 — The Singularity"
      >
        <span className="kc-return-arrow" aria-hidden="true">←</span>
        Return to the Singularity
      </button>
    </div>
  );
}
