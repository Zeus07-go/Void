// SymmetryEngine — computes mirrored transform matrices for kaleidoscope painting.
// All transforms are precomputed as [cos, sin, mirrorX] triples so the
// frame loop does only cheap multiplications.

export type SymmetryFold = 2 | 4 | 6 | 8;

export interface SymmetryTransform {
  cos: number;
  sin: number;
  mirror: boolean;
}

/** Precompute all transform descriptors for a given fold count.
 *  Each fold creates 2 copies (rotated + reflected) giving `fold * 2` total brushes. */
export function buildTransforms(fold: SymmetryFold): SymmetryTransform[] {
  const transforms: SymmetryTransform[] = [];
  const step = (Math.PI * 2) / fold;
  for (let i = 0; i < fold; i++) {
    const angle = step * i;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // Rotated copy
    transforms.push({ cos: c, sin: s, mirror: false });
    // Reflected copy (mirror across the symmetry axis)
    transforms.push({ cos: c, sin: s, mirror: true });
  }
  return transforms;
}

/** Apply a single SymmetryTransform to a point relative to the center.
 *  Returns the transformed absolute point. */
export function applyTransform(
  t: SymmetryTransform,
  relX: number,
  relY: number,
  cx: number,
  cy: number,
): { x: number; y: number } {
  // Mirror flips the x-axis before rotating
  const mx = t.mirror ? -relX : relX;
  return {
    x: cx + mx * t.cos - relY * t.sin,
    y: cy + mx * t.sin + relY * t.cos,
  };
}
