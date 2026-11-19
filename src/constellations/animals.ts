// Original constellation drawings. Rig units: ~100 wide, y grows downward, animals face right.
// Bone angles: positive = clockwise on screen.

import type { Action, AnimalDef, Keyframe, Pose } from './rig';

const sin = Math.sin;
const smooth = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

// ───────────────────────────── LION ─────────────────────────────

const lionAction: Action = {
  duration: 2.7,
  pulses: [1.12],
  keys: [
    { t: 0, pose: {} },
    // head lifts, near front leg steps forward, tail curls up
    { t: 0.42, pose: { y: -2, bones: { head: -0.3, frontN: -0.45, frontNlow: 0.75, tail1: -0.4, tail2: 0.45, tail3: 0.35 } } },
    // near paw plants, far front leg steps
    { t: 0.82, pose: { x: 4, y: -1, bones: { head: -0.36, frontF: -0.45, frontFlow: 0.75, tail1: 0.3, tail2: -0.45, tail3: -0.3 } } },
    // roar: head high, jaw open — golden pulse
    { t: 1.15, pose: { x: 6, y: -1.5, breath: 0.03, bones: { head: -0.44, jaw: 0.38, tail1: -0.3, tail2: 0.4, tail3: 0.45 } } },
    { t: 1.75, pose: { x: 6, bones: { head: -0.3, jaw: 0.08, tail1: 0.2, tail2: -0.3, tail3: -0.15 } } },
    { t: 2.7, pose: {} },
  ],
};

export const LION: AnimalDef = {
  id: 'lion',
  label: 'The Lion',
  accent: [255, 196, 92],
  center: [52, 34],
  seed: 'ear',
  joints: {
    snout: [97, 21],
    jaw: [91, 28],
    brow: [88, 13],
    ear: [81, 8],
    maneTop: [74, 10],
    maneBack: [67, 22],
    maneLow: [76, 34],
    back: [50, 21],
    hip: [32, 21],
    rump: [24, 25],
    belly: [50, 35],
    chest: [72, 38],
    elbowN: [74, 48],
    pawN: [76, 60],
    toeN: [81, 60],
    elbowF: [67, 48],
    pawF: [68, 60],
    stifleN: [30, 41],
    hockN: [24, 51],
    pawHN: [28, 60],
    stifleF: [37, 42],
    hockF: [33, 52],
    pawHF: [37, 60],
    tail1: [17, 27],
    tail2: [10, 34],
    tail3: [6, 43],
    tuft: [9, 49],
  },
  edges: [
    ['snout', 'brow'], ['brow', 'ear'], ['ear', 'maneTop'], ['maneTop', 'maneBack'], ['maneBack', 'maneLow'],
    ['maneLow', 'jaw'], ['jaw', 'snout'], ['maneBack', 'back'], ['back', 'hip'], ['hip', 'rump'],
    ['rump', 'tail1'], ['tail1', 'tail2'], ['tail2', 'tail3'], ['tail3', 'tuft'],
    ['maneLow', 'chest'], ['chest', 'belly'], ['belly', 'stifleF'],
    ['chest', 'elbowN'], ['elbowN', 'pawN'], ['pawN', 'toeN'], ['chest', 'elbowF'], ['elbowF', 'pawF'],
    ['hip', 'stifleN'], ['stifleN', 'hockN'], ['hockN', 'pawHN'], ['hip', 'stifleF'], ['stifleF', 'hockF'], ['hockF', 'pawHF'],
  ],
  bones: [
    { name: 'jaw', pivot: 'maneLow', joints: ['jaw'] },
    { name: 'head', pivot: 'maneBack', joints: ['snout', 'jaw', 'brow', 'ear', 'maneTop', 'maneLow'] },
    { name: 'tail3', pivot: 'tail2', joints: ['tail3', 'tuft'] },
    { name: 'tail2', pivot: 'tail1', joints: ['tail2', 'tail3', 'tuft'] },
    { name: 'tail1', pivot: 'rump', joints: ['tail1', 'tail2', 'tail3', 'tuft'] },
    { name: 'frontNlow', pivot: 'elbowN', joints: ['pawN', 'toeN'] },
    { name: 'frontN', pivot: 'chest', joints: ['elbowN', 'pawN', 'toeN'] },
    { name: 'frontFlow', pivot: 'elbowF', joints: ['pawF'] },
    { name: 'frontF', pivot: 'chest', joints: ['elbowF', 'pawF'] },
    { name: 'hindN', pivot: 'hip', joints: ['stifleN', 'hockN', 'pawHN'] },
    { name: 'hindF', pivot: 'hip', joints: ['stifleF', 'hockF', 'pawHF'] },
  ],
  idle: (t): Pose => ({
    breath: 0.014 * sin(t * 1.5),
    bones: {
      head: 0.035 * sin(t * 0.55),
      tail1: 0.09 * sin(t * 0.9),
      tail2: 0.13 * sin(t * 0.9 - 0.8),
      tail3: 0.15 * sin(t * 0.9 - 1.5),
    },
  }),
  action: lionAction,
};

// ───────────────────────────── HORSE ─────────────────────────────

// Two gallop poses: extended (suspension) and gathered (legs under the body)
const EXT = { FN: -0.65, FNlow: 0.15, FF: -0.45, FFlow: 0.1, HN: 0.55, HNlow: -0.1, HF: 0.42, HFlow: -0.05, head: 0.12, tail1: -0.4, tail2: -0.2 };
const GAT = { FN: 0.38, FNlow: 1.05, FF: 0.52, FFlow: 0.95, HN: -0.5, HNlow: 0.65, HF: -0.62, HFlow: 0.6, head: -0.12, tail1: -0.22, tail2: 0.12 };

const gallopKeys: Keyframe[] = [{ t: 0, pose: {} }];
for (let i = 0; i < 7; i++) {
  const ext = i % 2 === 0;
  gallopKeys.push({ t: 0.16 + i * 0.2, pose: { y: ext ? -4 : 0.5, bones: ext ? EXT : GAT } });
}
gallopKeys.push({ t: 1.75, pose: { y: -1, bones: { head: -0.08, tail1: -0.25, tail2: 0.1 } } });
gallopKeys.push({ t: 2.3, pose: { bones: { head: 0.06, tail1: 0.12 } } });
gallopKeys.push({ t: 3.0, pose: {} });

const horseAction: Action = {
  duration: 3.0,
  keys: gallopKeys,
  // Surge forward while galloping, then drift gracefully home
  root: (t) => {
    const out = 46 * smooth(t / 1.55);
    const back = smooth((t - 1.55) / 1.45);
    return { x: out * (1 - back), y: 0, rot: -0.04 * sin(Math.PI * smooth(t / 1.55)) * (1 - back) };
  },
};

export const HORSE: AnimalDef = {
  id: 'horse',
  label: 'The Horse',
  accent: [170, 205, 255],
  center: [52, 38],
  seed: 'ear',
  joints: {
    muzzle: [97, 31],
    jaw: [91, 35],
    poll: [86, 14],
    ear: [84, 6],
    throat: [83, 28],
    crest: [74, 18],
    withers: [64, 21],
    back: [48, 25],
    croup: [30, 21],
    dock: [24, 23],
    chest: [72, 37],
    belly: [48, 41],
    flank: [32, 39],
    elbowFN: [71, 46],
    kneeFN: [72, 54],
    hoofFN: [71, 66],
    elbowFF: [65, 46],
    kneeFF: [65, 54],
    hoofFF: [64, 66],
    stifleHN: [33, 47],
    hockHN: [27, 55],
    hoofHN: [29, 66],
    stifleHF: [39, 47],
    hockHF: [35, 56],
    hoofHF: [37, 66],
    tail1: [17, 30],
    tail2: [12, 41],
    tail3: [10, 52],
  },
  edges: [
    ['muzzle', 'poll'], ['poll', 'ear'], ['poll', 'crest'], ['muzzle', 'jaw'], ['jaw', 'throat'], ['throat', 'chest'],
    ['crest', 'withers'], ['withers', 'back'], ['back', 'croup'], ['croup', 'dock'],
    ['dock', 'tail1'], ['tail1', 'tail2'], ['tail2', 'tail3'],
    ['chest', 'belly'], ['belly', 'flank'], ['flank', 'croup'],
    ['chest', 'elbowFN'], ['elbowFN', 'kneeFN'], ['kneeFN', 'hoofFN'],
    ['chest', 'elbowFF'], ['elbowFF', 'kneeFF'], ['kneeFF', 'hoofFF'],
    ['flank', 'stifleHN'], ['stifleHN', 'hockHN'], ['hockHN', 'hoofHN'],
    ['flank', 'stifleHF'], ['stifleHF', 'hockHF'], ['hockHF', 'hoofHF'],
  ],
  bones: [
    { name: 'tail2', pivot: 'tail1', joints: ['tail2', 'tail3'] },
    { name: 'tail1', pivot: 'dock', joints: ['tail1', 'tail2', 'tail3'] },
    { name: 'FNlow', pivot: 'kneeFN', joints: ['hoofFN'] },
    { name: 'FN', pivot: 'chest', joints: ['elbowFN', 'kneeFN', 'hoofFN'] },
    { name: 'FFlow', pivot: 'kneeFF', joints: ['hoofFF'] },
    { name: 'FF', pivot: 'chest', joints: ['elbowFF', 'kneeFF', 'hoofFF'] },
    { name: 'HNlow', pivot: 'hockHN', joints: ['hoofHN'] },
    { name: 'HN', pivot: 'flank', joints: ['stifleHN', 'hockHN', 'hoofHN'] },
    { name: 'HFlow', pivot: 'hockHF', joints: ['hoofHF'] },
    { name: 'HF', pivot: 'flank', joints: ['stifleHF', 'hockHF', 'hoofHF'] },
    { name: 'head', pivot: 'crest', joints: ['muzzle', 'jaw', 'poll', 'ear', 'throat'] },
  ],
  idle: (t): Pose => ({
    breath: 0.009 * sin(t * 1.3),
    bones: {
      head: 0.06 * sin(t * 0.8),
      tail1: 0.1 * sin(t * 1.1),
      tail2: 0.15 * sin(t * 1.1 - 0.7),
    },
  }),
  action: horseAction,
};

// ───────────────────────────── EAGLE ─────────────────────────────

// Left wing: positive angle lifts it. Right wing mirrors.
const wings = (wing: number, hand: number, extra: Record<string, number> = {}) => ({
  wingL: wing,
  wingR: -wing,
  handL: hand,
  handR: -hand,
  ...extra,
});

const eagleAction: Action = {
  duration: 3.3,
  keys: [
    { t: 0, pose: {} },
    { t: 0.3, pose: { y: -2, bones: wings(0.22, -0.32, { headR: -0.1 }) } }, // wings expand
    { t: 0.55, pose: { y: -4, bones: wings(0.6, 0.3) } }, // up
    { t: 0.8, pose: { y: 1, bones: wings(-0.48, -0.4) } }, // down
    { t: 1.05, pose: { y: -4, bones: wings(0.58, 0.28) } },
    { t: 1.3, pose: { y: 1, bones: wings(-0.45, -0.38) } },
    { t: 1.55, pose: { y: -3, bones: wings(0.42, 0.2) } },
    { t: 1.9, pose: { bones: wings(0.06, -0.2, { tailFan: 0.15 }) } }, // glide, wings held wide
    { t: 2.6, pose: { bones: wings(0.04, -0.12, { tailFan: -0.1 }) } },
    { t: 3.3, pose: {} },
  ],
  // A banking glide out and back to its perch
  root: (t) => {
    const u = smooth((t - 0.45) / 2.7);
    const arc = sin(Math.PI * u);
    return { x: 34 * arc, y: -22 * arc, rot: 0.16 * sin(2 * Math.PI * u) };
  },
};

export const EAGLE: AnimalDef = {
  id: 'eagle',
  label: 'The Eagle',
  accent: [140, 220, 255],
  center: [50, 30],
  seed: 'head',
  joints: {
    beak: [55, 13],
    head: [50, 11],
    neck: [50, 19],
    chest: [50, 27],
    belly: [50, 40],
    tailBase: [50, 47],
    tailL: [44, 58],
    tailM: [50, 61],
    tailR: [56, 58],
    shoulderL: [44, 25],
    elbowL: [31, 18],
    wristL: [18, 22],
    tipL1: [5, 24],
    tipL2: [7, 31],
    tipL3: [12, 37],
    trailL: [30, 32],
    shoulderR: [56, 25],
    elbowR: [69, 18],
    wristR: [82, 22],
    tipR1: [95, 24],
    tipR2: [93, 31],
    tipR3: [88, 37],
    trailR: [70, 32],
  },
  edges: [
    ['beak', 'head'], ['head', 'neck'], ['neck', 'chest'], ['chest', 'belly'], ['belly', 'tailBase'],
    ['tailBase', 'tailL'], ['tailBase', 'tailM'], ['tailBase', 'tailR'],
    ['chest', 'shoulderL'], ['shoulderL', 'elbowL'], ['elbowL', 'wristL'],
    ['wristL', 'tipL1'], ['wristL', 'tipL2'], ['wristL', 'tipL3'], ['tipL3', 'trailL'], ['trailL', 'belly'],
    ['chest', 'shoulderR'], ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
    ['wristR', 'tipR1'], ['wristR', 'tipR2'], ['wristR', 'tipR3'], ['tipR3', 'trailR'], ['trailR', 'belly'],
  ],
  bones: [
    { name: 'handL', pivot: 'wristL', joints: ['tipL1', 'tipL2', 'tipL3'] },
    { name: 'wingL', pivot: 'shoulderL', joints: ['elbowL', 'wristL', 'tipL1', 'tipL2', 'tipL3', 'trailL'] },
    { name: 'handR', pivot: 'wristR', joints: ['tipR1', 'tipR2', 'tipR3'] },
    { name: 'wingR', pivot: 'shoulderR', joints: ['elbowR', 'wristR', 'tipR1', 'tipR2', 'tipR3', 'trailR'] },
    { name: 'headR', pivot: 'neck', joints: ['head', 'beak'] },
    { name: 'tailFan', pivot: 'tailBase', joints: ['tailL', 'tailM', 'tailR'] },
  ],
  idle: (t): Pose => ({
    y: 1.2 * sin(t * 1.2 + 1.2),
    bones: {
      ...wings(0.07 * sin(t * 1.2), 0.06 * sin(t * 1.2 - 0.6)),
      headR: 0.05 * sin(t * 0.6),
      tailFan: 0.04 * sin(t * 0.9),
    },
  }),
  action: eagleAction,
};

export const ANIMALS: readonly AnimalDef[] = [LION, HORSE, EAGLE];
