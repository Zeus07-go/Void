// Two-way adaptive render scale.
// Learns the display's refresh interval, lowers resolution under sustained load and climbs
// back up when there is headroom. One-off hitches (shader compiles, tab switches, GC) are
// ignored, and a ceiling stops it oscillating between two levels.

export class AdaptiveResolution {
  scale: number;
  private ema = 0;
  private best = Infinity;
  private slow = 0;
  private fast = 0;
  private cooldown = 0;
  private ceiling: number;
  private lastWasUp = false;

  constructor(
    initial: number,
    private readonly min: number,
    private readonly max: number,
  ) {
    this.scale = Math.max(min, Math.min(max, initial));
    this.ceiling = max;
  }

  /** Feed the real frame interval (ms) and frame dt (s). Returns true when the scale changed. */
  sample(frameMs: number, dt: number): boolean {
    if (!(frameMs > 0) || frameMs > 100) return false; // hitch or resume after a pause: ignore
    this.ema = this.ema ? this.ema + (frameMs - this.ema) * 0.1 : frameMs;
    // Refresh-interval estimate: lowest sustained interval, slowly forgotten, never slower
    // than 60 Hz — a scene that is slow from the first frame must still be pushed to 60 fps
    this.best = Math.min(this.best * 1.0004, this.ema, 16.9);
    this.cooldown -= dt;

    this.slow = this.ema > this.best * 1.22 ? this.slow + dt : 0;
    this.fast = this.ema < this.best * 1.06 ? this.fast + dt : 0;

    if (this.slow > 0.5 && this.scale > this.min) {
      // Dropped right after stepping up: that level is too expensive, never go back to it
      if (this.lastWasUp && this.cooldown > 0) this.ceiling = Math.max(this.min, this.scale * 0.97);
      this.scale = Math.max(this.min, this.scale * 0.86);
      this.slow = 0;
      this.fast = 0;
      this.cooldown = 1.2;
      this.lastWasUp = false;
      return true;
    }
    const cap = Math.min(this.max, this.ceiling);
    if (this.fast > 2.5 && this.cooldown <= 0 && this.scale < cap) {
      this.scale = Math.min(cap, this.scale * 1.08);
      this.fast = 0;
      this.cooldown = 2.5;
      this.lastWasUp = true;
      return true;
    }
    return false;
  }
}
