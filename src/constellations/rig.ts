// Articulated constellation rigs.
// A constellation = named star joints + connecting edges + bones (groups of joints that
// rotate around a pivot joint). Poses are bone angles plus a root transform; actions are
// keyframed poses interpolated every frame. Joints are solved from the base drawing each
// frame, so lines always stay attached to their stars.

export type Vec = readonly [number, number];

/** A bone: rotates `joints` around `pivot`. List bones leaf-first (paw before leg). */
export type Bone = { name: string; pivot: string; joints: readonly string[] };

export type Pose = {
  x?: number;
  y?: number;
  rot?: number;
  breath?: number;
  bones?: Readonly<Record<string, number>>;
};

export type Keyframe = { t: number; pose: Pose };

export type Action = {
  duration: number;
  keys: readonly Keyframe[];
  /** Smooth root path layered over the keyframes (travel, glides). */
  root?: (t: number) => { x: number; y: number; rot: number };
  /** Moments for effects such as the lion's golden pulse. */
  pulses?: readonly number[];
};

export type AnimalDef = {
  id: string;
  label: string;
  joints: Readonly<Record<string, Vec>>;
  edges: readonly (readonly [string, string])[];
  bones: readonly Bone[];
  center: Vec;
  /** Reveal starts from this joint and spreads along the edges. */
  seed: string;
  accent: readonly [number, number, number];
  idle: (t: number) => Pose;
  action: Action;
};

export type CompiledAnimal = {
  def: AnimalDef;
  names: readonly string[];
  base: Float32Array;
  edges: Int16Array;
  bones: { name: string; pivot: number; joints: Int16Array }[];
  /** Edge indices ordered by distance from the seed joint, with per-edge reveal delay. */
  revealOrder: Int16Array;
  revealDelay: Float32Array;
  /** Per-joint reveal delay (when its first edge starts drawing). */
  jointDelay: Float32Array;
  revealDuration: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

const EDGE_STAGGER = 0.065;
const EDGE_DRAW = 0.22;

export function compile(def: AnimalDef): CompiledAnimal {
  const names = Object.keys(def.joints);
  const index = new Map(names.map((n, i) => [n, i]));
  const idx = (n: string) => {
    const i = index.get(n);
    if (i === undefined) throw new Error(`constellation ${def.id}: unknown joint "${n}"`);
    return i;
  };
  const base = new Float32Array(names.length * 2);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  names.forEach((n, i) => {
    const [x, y] = def.joints[n]!;
    base[i * 2] = x;
    base[i * 2 + 1] = y;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });
  const edges = new Int16Array(def.edges.length * 2);
  def.edges.forEach(([a, b], i) => {
    edges[i * 2] = idx(a);
    edges[i * 2 + 1] = idx(b);
  });
  const bones = def.bones.map((b) => ({ name: b.name, pivot: idx(b.pivot), joints: Int16Array.from(b.joints.map(idx)) }));

  // Breadth-first reveal from the seed joint: the constellation "joins" outward
  const depth = new Array<number>(names.length).fill(Infinity);
  depth[idx(def.seed)] = 0;
  const queue = [idx(def.seed)];
  while (queue.length) {
    const j = queue.shift()!;
    for (let e = 0; e < def.edges.length; e++) {
      const a = edges[e * 2]!;
      const b = edges[e * 2 + 1]!;
      const o = a === j ? b : b === j ? a : -1;
      if (o >= 0 && depth[o] === Infinity) {
        depth[o] = depth[j]! + 1;
        queue.push(o);
      }
    }
  }
  const order = def.edges
    .map((_, e) => e)
    .sort((e1, e2) => {
      const d1 = Math.min(depth[edges[e1 * 2]!]!, depth[edges[e1 * 2 + 1]!]!);
      const d2 = Math.min(depth[edges[e2 * 2]!]!, depth[edges[e2 * 2 + 1]!]!);
      return d1 - d2;
    });
  const revealOrder = Int16Array.from(order);
  const revealDelay = new Float32Array(def.edges.length);
  const jointDelay = new Float32Array(names.length).fill(Infinity);
  jointDelay[idx(def.seed)] = 0;
  order.forEach((e, k) => {
    const d = k * EDGE_STAGGER;
    revealDelay[e] = d;
    const a = edges[e * 2]!;
    const b = edges[e * 2 + 1]!;
    jointDelay[a] = Math.min(jointDelay[a]!, d);
    jointDelay[b] = Math.min(jointDelay[b]!, d + EDGE_DRAW);
  });
  for (let i = 0; i < jointDelay.length; i++) if (!Number.isFinite(jointDelay[i]!)) jointDelay[i] = 0;

  return {
    def,
    names,
    base,
    edges,
    bones,
    revealOrder,
    revealDelay,
    jointDelay,
    revealDuration: (order.length - 1) * EDGE_STAGGER + EDGE_DRAW,
    bounds: { minX, minY, maxX, maxY },
  };
}

export const EDGE_DRAW_TIME = EDGE_DRAW;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Interpolate the action's keyframes at time t (missing channels rest at 0). */
export function sampleAction(a: Action, t: number, out: MutablePose): void {
  resetPose(out);
  const keys = a.keys;
  if (!keys.length) return;
  let k0 = keys[0]!;
  let k1 = keys[keys.length - 1]!;
  if (t <= k0.t) k1 = k0;
  else if (t >= k1.t) k0 = k1;
  else {
    for (let i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i]!.t && t <= keys[i + 1]!.t) {
        k0 = keys[i]!;
        k1 = keys[i + 1]!;
        break;
      }
    }
  }
  const span = k1.t - k0.t;
  const u = span > 0 ? easeInOut((t - k0.t) / span) : 0;
  out.x = lerp(k0.pose.x ?? 0, k1.pose.x ?? 0, u);
  out.y = lerp(k0.pose.y ?? 0, k1.pose.y ?? 0, u);
  out.rot = lerp(k0.pose.rot ?? 0, k1.pose.rot ?? 0, u);
  out.breath = lerp(k0.pose.breath ?? 0, k1.pose.breath ?? 0, u);
  const b0 = k0.pose.bones ?? {};
  const b1 = k1.pose.bones ?? {};
  for (const n in b0) out.bones[n] = lerp(b0[n]!, b1[n] ?? 0, u);
  for (const n in b1) if (!(n in b0)) out.bones[n] = lerp(0, b1[n]!, u);
  if (a.root) {
    const r = a.root(t);
    out.x += r.x;
    out.y += r.y;
    out.rot += r.rot;
  }
}

export type MutablePose = { x: number; y: number; rot: number; breath: number; bones: Record<string, number> };

export const newPose = (): MutablePose => ({ x: 0, y: 0, rot: 0, breath: 0, bones: {} });

export function resetPose(p: MutablePose): void {
  p.x = 0;
  p.y = 0;
  p.rot = 0;
  p.breath = 0;
  for (const k in p.bones) p.bones[k] = 0;
}

/** out += src * w */
export function addPose(out: MutablePose, src: Pose, w: number): void {
  out.x += (src.x ?? 0) * w;
  out.y += (src.y ?? 0) * w;
  out.rot += (src.rot ?? 0) * w;
  out.breath += (src.breath ?? 0) * w;
  const b = src.bones;
  if (b) for (const n in b) out.bones[n] = (out.bones[n] ?? 0) + b[n]! * w;
}

/** Solve joint positions (rig units) for a pose. */
export function solve(c: CompiledAnimal, pose: MutablePose, out: Float32Array): void {
  out.set(c.base);
  const [cx, cy] = c.def.center;
  for (const bone of c.bones) {
    const a = pose.bones[bone.name];
    if (!a) continue;
    const px = out[bone.pivot * 2]!;
    const py = out[bone.pivot * 2 + 1]!;
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    for (let k = 0; k < bone.joints.length; k++) {
      const j = bone.joints[k]!;
      const dx = out[j * 2]! - px;
      const dy = out[j * 2 + 1]! - py;
      out[j * 2] = px + dx * cs - dy * sn;
      out[j * 2 + 1] = py + dx * sn + dy * cs;
    }
  }
  const s = 1 + pose.breath;
  const cs = Math.cos(pose.rot);
  const sn = Math.sin(pose.rot);
  for (let i = 0; i < out.length; i += 2) {
    const dx = (out[i]! - cx) * s;
    const dy = (out[i + 1]! - cy) * s;
    out[i] = cx + dx * cs - dy * sn + pose.x;
    out[i + 1] = cy + dx * sn + dy * cs + pose.y;
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
