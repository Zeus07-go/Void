// Pre-rendered textures for the black hole and starfield.
// Everything expensive is drawn once into offscreen canvases; the frame loop only composites them.

export const TAU = Math.PI * 2;

/** Inner edge of the accretion disk as a fraction of its outer radius. */
export const DISK_INNER = 0.3;

export type Tint = readonly [number, number, number];

export const TINTS: readonly Tint[] = [
  [255, 238, 220], // warm white
  [255, 196, 130], // amber
  [186, 176, 255], // violet
  [205, 228, 255], // ice
];

export const TINT_RGBA: readonly string[] = TINTS.map(([r, g, b]) => `rgba(${r},${g},${b},`);

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D is not available');
  return g;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Face-on accretion disk: hot inner edge, streaky turbulent body, dark dust lanes. */
export function makeDiskTexture(size = 1280): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const cx = size / 2;
  const ro = size / 2;
  const ri = ro * DISK_INNER;
  const rnd = mulberry32(42);

  const base = g.createRadialGradient(cx, cx, ri, cx, cx, ro);
  base.addColorStop(0, 'rgba(255,250,240,0)');
  base.addColorStop(0.015, 'rgba(255,248,236,0.95)');
  base.addColorStop(0.08, 'rgba(255,222,176,0.85)');
  base.addColorStop(0.25, 'rgba(255,157,77,0.55)');
  base.addColorStop(0.5, 'rgba(196,96,44,0.24)');
  base.addColorStop(0.78, 'rgba(120,52,32,0.07)');
  base.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = base;
  g.beginPath();
  g.arc(cx, cx, ro, 0, TAU);
  g.arc(cx, cx, ri, 0, TAU, true);
  g.fill();

  // Luminous turbulent streaks
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 1600; i++) {
    const t = Math.pow(rnd(), 1.7);
    const r = ri + (ro - ri) * t;
    const a0 = rnd() * TAU;
    const len = 0.12 + rnd() * 1.2;
    const heat = 1 - t;
    const col = heat > 0.75 ? '255,244,228' : heat > 0.45 ? '255,214,160' : '255,150,80';
    const alpha = (0.015 + rnd() * 0.08) * (0.35 + heat);
    g.strokeStyle = `rgba(${col},${alpha})`;
    g.lineWidth = 0.6 + rnd() * 2.6 * (1 - t * 0.5);
    g.beginPath();
    g.arc(cx, cx, r, a0, a0 + len);
    g.stroke();
  }

  // Dark dust lanes for structure
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 260; i++) {
    const t = rnd();
    const r = ri * 1.05 + (ro - ri) * t;
    const a0 = rnd() * TAU;
    g.strokeStyle = `rgba(0,0,0,${0.05 + rnd() * 0.18})`;
    g.lineWidth = 1 + rnd() * 4;
    g.beginPath();
    g.arc(cx, cx, r, a0, a0 + 0.2 + rnd() * 1.4);
    g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  return c;
}

/** Soft atmospheric scattering around the disk. */
export function makeGlowSprite(size = 512): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const h = size / 2;
  const gr = g.createRadialGradient(h, h, 0, h, h, h);
  gr.addColorStop(0, 'rgba(255,170,95,0.32)');
  gr.addColorStop(0.12, 'rgba(255,150,80,0.16)');
  gr.addColorStop(0.3, 'rgba(200,110,90,0.06)');
  gr.addColorStop(0.55, 'rgba(119,112,184,0.035)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

export function makeStarSprite([r, gg, b]: Tint, size = 64): HTMLCanvasElement {
  const c = makeCanvas(size, size);
  const g = ctx2d(c);
  const h = size / 2;
  const gr = g.createRadialGradient(h, h, 0, h, h, h);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.08, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.16, `rgba(${r},${gg},${b},0.7)`);
  gr.addColorStop(0.38, `rgba(${r},${gg},${b},0.16)`);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

/** Static deep-space backdrop: nebula haze, three depths of stars, vignette. */
export function makeBackground(w: number, h: number, dpr: number): HTMLCanvasElement {
  const c = makeCanvas(w * dpr, h * dpr);
  const g = ctx2d(c);
  g.scale(dpr, dpr);
  g.fillStyle = '#030305';
  g.fillRect(0, 0, w, h);
  const max = Math.max(w, h);

  const neb = (x: number, y: number, r: number, col: string) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  };
  neb(w * 0.16, h * 0.2, max * 0.55, 'rgba(119,112,184,0.075)');
  neb(w * 0.88, h * 0.82, max * 0.5, 'rgba(119,112,184,0.05)');
  neb(w * 0.72, h * 0.12, max * 0.35, 'rgba(255,157,77,0.025)');

  const rnd = mulberry32(7);
  const n = Math.min(1200, Math.floor((w * h) / 1700));
  for (let i = 0; i < n; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const layer = rnd();
    let r: number;
    let a: number;
    if (layer < 0.76) {
      r = 0.3 + rnd() * 0.45;
      a = 0.12 + rnd() * 0.33;
    } else if (layer < 0.97) {
      r = 0.6 + rnd() * 0.55;
      a = 0.3 + rnd() * 0.4;
    } else {
      r = 0.9 + rnd() * 0.7;
      a = 0.75;
    }
    const hue = rnd();
    const col = hue < 0.14 ? '205,198,255' : hue < 0.32 ? '255,228,204' : '236,240,255';
    if (r > 0.9) {
      const gr = g.createRadialGradient(x, y, 0, x, y, r * 5);
      gr.addColorStop(0, `rgba(${col},0.22)`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
    }
    g.fillStyle = `rgba(${col},${a})`;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }

  const vig = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, max * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);
  return c;
}
