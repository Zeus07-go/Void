// Palette definitions for The Kaleidoscope.
// Each palette defines a set of stroke colors used when painting.

export type PaletteName = 'violet' | 'aurora' | 'stellar';

export interface PaletteEntry {
  name: string;
  label: string;
  colors: readonly string[];
  /** CSS color shown in the swatch button */
  swatch: string;
}

export const PALETTES: Record<PaletteName, PaletteEntry> = {
  violet: {
    name: 'violet',
    label: 'Violet Dream',
    swatch: '#8B5CF6',
    colors: [
      '#8B5CF6', // cosmic violet
      '#A78BFA', // soft violet
      '#E879F9', // magenta
      '#C084FC', // lavender
      '#7C3AED', // deep violet
      '#F0ABFC', // pale pink
      '#38BDF8', // electric blue accent
    ],
  },
  aurora: {
    name: 'aurora',
    label: 'Aurora',
    swatch: '#34D399',
    colors: [
      '#34D399', // emerald
      '#38BDF8', // sky blue
      '#818CF8', // indigo
      '#F472B6', // pink
      '#A3E635', // lime
      '#67E8F9', // cyan
      '#FDE68A', // soft gold
    ],
  },
  stellar: {
    name: 'stellar',
    label: 'Stellar Fire',
    swatch: '#F97316',
    colors: [
      '#F97316', // orange
      '#FBBF24', // amber
      '#EF4444', // red
      '#FCD34D', // yellow
      '#FB7185', // rose
      '#FDE68A', // pale gold
      '#FF6B6B', // coral
    ],
  },
};

/** Pick a color from the active palette cycling through its entries. */
export function pickColor(palette: PaletteName, index: number): string {
  const p = PALETTES[palette];
  return p.colors[index % p.colors.length]!;
}
