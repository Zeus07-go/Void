// ParticleSystem — struct-of-arrays ring buffer for nebula dust & trail particles.
// All mutation happens inside the rAF loop; zero React renders per frame.

const MAX_PARTICLES = 1200;

export class ParticleSystem {
  // Position
  readonly x = new Float32Array(MAX_PARTICLES);
  readonly y = new Float32Array(MAX_PARTICLES);
  // Velocity
  readonly vx = new Float32Array(MAX_PARTICLES);
  readonly vy = new Float32Array(MAX_PARTICLES);
  // Life: 0 = dead, 1 = freshly emitted
  readonly life = new Float32Array(MAX_PARTICLES);
  readonly maxLife = new Float32Array(MAX_PARTICLES);
  // Radius
  readonly r = new Float32Array(MAX_PARTICLES);
  // Color index into the active palette (0-6)
  readonly colorIdx = new Uint8Array(MAX_PARTICLES);
  // 0 = nebula dust (ambient), 1 = trail particle
  readonly kind = new Uint8Array(MAX_PARTICLES);

  private next = 0;
  readonly capacity = MAX_PARTICLES;

  emit(opts: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    r: number;
    colorIdx: number;
    kind: 0 | 1;
  }): void {
    const i = this.next;
    this.next = (i + 1) % MAX_PARTICLES;
    this.x[i] = opts.x;
    this.y[i] = opts.y;
    this.vx[i] = opts.vx;
    this.vy[i] = opts.vy;
    this.life[i] = opts.life;
    this.maxLife[i] = opts.life;
    this.r[i] = opts.r;
    this.colorIdx[i] = opts.colorIdx;
    this.kind[i] = opts.kind;
  }

  update(dt: number, pointerX: number, pointerY: number, pointerMoving: boolean): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= dt;

      if (this.kind[i] === 0) {
        // Nebula dust — subtle pointer attraction/repulsion
        if (pointerMoving) {
          const dx = pointerX - this.x[i]!;
          const dy = pointerY - this.y[i]!;
          const d2 = dx * dx + dy * dy;
          const reach2 = 90 * 90;
          if (d2 < reach2 && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const f = (1 - d / 90) * 18;
            // Swirl: tangential push instead of radial, so dust orbits
            this.vx[i]! += (-dy / d) * f * dt;
            this.vy[i]! += (dx / d) * f * dt;
          }
        }
        // Gentle drag so dust doesn't drift off forever
        const drag = Math.exp(-dt * 0.9);
        this.vx[i]! *= drag;
        this.vy[i]! *= drag;
      } else {
        // Trail particle — simple drag
        const drag = Math.exp(-dt * 1.6);
        this.vx[i]! *= drag;
        this.vy[i]! *= drag;
      }

      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
    }
  }

  /** Seed ambient nebula dust spread across the viewport. */
  seedDust(w: number, h: number, count: number, rng: () => number): void {
    for (let i = 0; i < count; i++) {
      const angle = rng() * Math.PI * 2;
      const speed = 4 + rng() * 18;
      this.emit({
        x: rng() * w,
        y: rng() * h,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 4 + rng() * 12,
        r: 0.5 + rng() * 1.4,
        colorIdx: Math.floor(rng() * 7),
        kind: 0,
      });
    }
  }
}
