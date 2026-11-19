// RippleSystem — manages dimensional ripple effects triggered by tap/click.

const MAX_RIPPLES = 12;

export interface Ripple {
  x: number;
  y: number;
  t: number;      // normalized progress 0→1
  dur: number;    // duration in seconds
  maxR: number;   // maximum radius
  color: string;  // primary ring color
}

export class RippleSystem {
  private ripples: Ripple[] = [];

  add(x: number, y: number, maxR: number, color: string): void {
    if (this.ripples.length >= MAX_RIPPLES) this.ripples.shift();
    this.ripples.push({ x, y, t: 0, dur: 1.4, maxR, color });
  }

  update(dt: number): void {
    for (const r of this.ripples) r.t = Math.min(1, r.t + dt / r.dur);
    this.ripples = this.ripples.filter((r) => r.t < 1);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const rip of this.ripples) {
      const ease = 1 - Math.pow(1 - rip.t, 3);
      const r = rip.maxR * ease;
      const alpha = (1 - rip.t) * 0.6;

      // Outer glow ring
      ctx.save();
      ctx.beginPath();
      ctx.arc(rip.x, rip.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = rip.color.replace(')', `,${alpha * 0.4})`).replace('rgb(', 'rgba(').replace('rgba(rgba(', 'rgba(');
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = alpha * 0.5;
      ctx.stroke();

      // Inner ring (slightly behind)
      if (rip.t > 0.08) {
        const r2 = rip.maxR * ease * 0.72;
        ctx.beginPath();
        ctx.arc(rip.x, rip.y, r2, 0, Math.PI * 2);
        ctx.globalAlpha = alpha * 0.35;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  get active(): Ripple[] {
    return this.ripples;
  }
}
