// ============================================================
// newEngine · knowledge · BasslineRules(bass anchor + bar-internal pattern,B-port 纯规则)
// ------------------------------------------------------------
// Provenance:忠实 port 自 melodygenerative/src/lib/basslineRules.ts。
// 两层:
//   ① BasslineRuleFn(BASSLINE_RULES)—— 每和弦选 1 个 bass anchor MIDI(节奏交下游)。
//      stepwise_descent / root_lock / octave_alternate / fifth_drop / walking_bass / boogie_root_fifth。
//   ② BassPatternRuleFn(BASS_PATTERN_RULES)—— 小节内整条 bass 律动事件(boogie/stride/dilla)。
// render 层消费 anchor/pattern 结果,不在此写音轨。random 用 forked 子流。
// ============================================================

const BASS_LOW = 36;  // C2
const BASS_HIGH = 55; // G3
const norm12 = (n: number): number => ((n % 12) + 12) % 12;
const clampToBassRange = (midi: number): number => {
  let m = midi;
  while (m < BASS_LOW) m += 12;
  while (m > BASS_HIGH) m -= 12;
  return m;
};

export interface BasslineContext {
  chordRootPc: number;
  bassAnchorPc: number;          // bass 实际落点 pc(root 时 = chordRootPc)
  pitchClasses: number[];        // 和弦全 pc
  prevBassMidi: number | null;
  isCadenceToTonic: boolean;
  isLast: boolean;
  barIndex: number;
  random: { next(): number };
}
export type BasslineRuleFn = (ctx: BasslineContext) => number;

export interface BassPatternEvent { time: number; midi: number; duration: number; velocity: number; }
export interface BassPatternContext {
  chordRootPc: number;
  bassPc: number;                // 实际发声 bass pc(支持转位)
  pitchClasses: number[];
  prevBassMidi: number | null;
  isCadenceToTonic: boolean;
  isLast: boolean;
  barIndex: number;
  random: { next(): number };
}
export type BassPatternRuleFn = (ctx: BassPatternContext) => BassPatternEvent[];

// —— ① bar-internal pattern rules ——

// boogie:root-5-6-5 四分音符行走;末/终止式塌成整小节 root。
const boogiePatternRule: BassPatternRuleFn = (ctx) => {
  const anchor = clampToBassRange(ctx.bassPc + 36);
  if (ctx.isLast || ctx.isCadenceToTonic) return [{ time: 0, midi: anchor, duration: 4, velocity: 95 }];
  const fifth = clampToBassRange(norm12(ctx.chordRootPc + 7) + 36);
  const sixth = clampToBassRange(norm12(ctx.chordRootPc + 9) + 36);
  return [
    { time: 0, midi: anchor, duration: 1, velocity: 100 },
    { time: 1, midi: fifth, duration: 1, velocity: 88 },
    { time: 2, midi: sixth, duration: 1, velocity: 92 },
    { time: 3, midi: fifth, duration: 1, velocity: 85 },
  ];
};

// stride:Tatum/Waller LH,1·3 低 root,2·4 高八度和弦音。
const stridePatternRule: BassPatternRuleFn = (ctx) => {
  const lowAnchor = clampToBassRange(ctx.bassPc + 24);
  if (ctx.isLast || ctx.isCadenceToTonic) return [{ time: 0, midi: lowAnchor, duration: 4, velocity: 95 }];
  let highPc = norm12(ctx.chordRootPc + 7);
  if (highPc === ctx.bassPc || !ctx.pitchClasses.includes(highPc)) {
    const nonAnchor = ctx.pitchClasses.find((pc) => pc !== ctx.bassPc);
    if (nonAnchor !== undefined) highPc = nonAnchor;
  }
  const highMidi = clampToBassRange(highPc + Math.floor(lowAnchor / 12) * 12 + 12);
  return [
    { time: 0, midi: lowAnchor, duration: 1, velocity: 100 },
    { time: 1, midi: highMidi, duration: 1, velocity: 75 },
    { time: 2, midi: lowAnchor, duration: 1, velocity: 92 },
    { time: 3, midi: highMidi, duration: 1, velocity: 75 },
  ];
};

// dilla pocket:neo-soul/hip-hop,1 长 root,2.75 off-beat pickup,3.5 回 root(lay-back)。
const dillaPocketRule: BassPatternRuleFn = (ctx) => {
  const anchor = clampToBassRange(ctx.bassPc + 36);
  if (ctx.isLast || ctx.isCadenceToTonic) return [{ time: 0, midi: anchor, duration: 4, velocity: 95 }];
  let pickupPc = norm12(ctx.chordRootPc + 7);
  if (pickupPc === ctx.bassPc || !ctx.pitchClasses.includes(pickupPc)) {
    const nonAnchor = ctx.pitchClasses.find((pc) => pc !== ctx.bassPc);
    if (nonAnchor !== undefined) pickupPc = nonAnchor;
  }
  const pickupMidi = clampToBassRange(pickupPc + 36);
  return [
    { time: 0, midi: anchor, duration: 2.5, velocity: 100 },
    { time: 2.75, midi: pickupMidi, duration: 0.5, velocity: 80 },
    { time: 3.5, midi: anchor, duration: 0.5, velocity: 88 },
  ];
};

export const BASS_PATTERN_RULES: Record<string, BassPatternRuleFn> = {
  boogie_pattern: boogiePatternRule,
  stride_pattern: stridePatternRule,
  dilla_pocket: dillaPocketRule,
};

// —— ② anchor-only rules ——

// stepwise_descent:从 prev 优先下行 1-3 半音到任一和弦音;V→I 卡 root。jazz/pop/soul 默认。
const stepwiseDescentRule: BasslineRuleFn = (ctx) => {
  const baseDefault = clampToBassRange(ctx.chordRootPc + 36);
  if (ctx.isLast) return baseDefault;
  if (ctx.prevBassMidi === null) return baseDefault;
  const prev = ctx.prevBassMidi;
  const candidates = ctx.pitchClasses.map((pc) => {
    let bestC = pc + 36;
    let cDiff = 100;
    for (let oct = 1; oct <= 3; oct++) {
      const testM = pc + (oct + 1) * 12;
      if (prev - testM >= 1 && prev - testM <= 3) return testM;
      let pDiff = Math.abs(prev - testM);
      if (pDiff > 5) pDiff += 2;
      if (pDiff < cDiff) { cDiff = pDiff; bestC = testM; }
    }
    return bestC;
  });
  let bestBass: number;
  const descendingStep = candidates.find((c) => prev - c >= 1 && prev - c <= 4);
  if (descendingStep !== undefined) {
    bestBass = descendingStep;
  } else {
    bestBass = candidates[0];
    let minDiff = Math.abs(prev - bestBass);
    for (const c of candidates) { const d = Math.abs(prev - c); if (d < minDiff) { minDiff = d; bestBass = c; } }
  }
  if (ctx.isCadenceToTonic) {
    let snap = clampToBassRange(ctx.chordRootPc + 36);
    if (Math.abs(snap + 12 - prev) < Math.abs(snap - prev) && snap + 12 < BASS_HIGH) snap += 12;
    bestBass = snap;
  }
  return clampToBassRange(bestBass);
};

// root_lock:始终低八度 root。cinematic/ambient/trap。
const rootLockRule: BasslineRuleFn = (ctx) => clampToBassRange(ctx.chordRootPc + 24);

// octave_alternate:root 在两八度间交替。synth pop/dance。
const octaveAlternateRule: BasslineRuleFn = (ctx) => {
  const low = clampToBassRange(ctx.chordRootPc + 24);
  const high = clampToBassRange(ctx.chordRootPc + 36);
  return ctx.barIndex % 2 === 0 ? low : high;
};

// fifth_drop:多数小节 root,每第 4 小节升到 5th。pop/soul/motown。
const fifthDropRule: BasslineRuleFn = (ctx) => {
  if (ctx.isLast) return clampToBassRange(ctx.chordRootPc + 36);
  const fifthPc = norm12(ctx.chordRootPc + 7);
  if (ctx.barIndex > 0 && ctx.barIndex % 4 === 3) return clampToBassRange(fifthPc + 36);
  if (ctx.prevBassMidi === null) return clampToBassRange(ctx.chordRootPc + 36);
  let best = clampToBassRange(ctx.chordRootPc + 36);
  let bestDist = Math.abs(best - ctx.prevBassMidi);
  for (const pc of ctx.pitchClasses) {
    for (let oct = 1; oct <= 3; oct++) {
      const m = pc + (oct + 1) * 12;
      if (m < BASS_LOW || m > BASS_HIGH) continue;
      const d = Math.abs(m - ctx.prevBassMidi);
      if (d < bestDist) { bestDist = d; best = m; }
    }
  }
  return best;
};

// walking_bass:从 prev 最近和弦音(双向,非只下行),step 优于 leap。jazz。
const walkingBassRule: BasslineRuleFn = (ctx) => {
  const baseRoot = clampToBassRange(ctx.chordRootPc + 36);
  if (ctx.isLast) return baseRoot;
  if (ctx.prevBassMidi === null) return baseRoot;
  if (ctx.isCadenceToTonic) return baseRoot;
  const prev = ctx.prevBassMidi;
  let best = baseRoot;
  let bestScore = Infinity;
  for (const pc of ctx.pitchClasses) {
    for (let oct = 1; oct <= 3; oct++) {
      const m = pc + (oct + 1) * 12;
      if (m < BASS_LOW || m > BASS_HIGH) continue;
      const d = Math.abs(m - prev);
      const score = d <= 3 ? d : d * 1.5 + 5;
      if (score < bestScore) { bestScore = score; best = m; }
    }
  }
  return best;
};

// boogie_root_fifth:偶小节 root,奇小节 5th(换 pc,非换八度)。boogie/12-bar blues。
const boogieRootFifthRule: BasslineRuleFn = (ctx) => {
  const rootMidi = clampToBassRange(ctx.chordRootPc + 36);
  if (ctx.isLast) return rootMidi;
  if (ctx.isCadenceToTonic) return rootMidi;
  if (ctx.barIndex % 2 === 0) return rootMidi;
  const fifthPc = norm12(ctx.chordRootPc + 7);
  return clampToBassRange(fifthPc + 36);
};

/** 按 bassRole 解析 bass anchor pc(转位支持);默认 root。 */
export function resolveBassAnchorPc(
  bassRole: 'root' | '3rd' | '5th' | '7th' | 'pedal' | undefined,
  chordRootPc: number,
  chordIntervals: number[],
  bassPedalPc?: number,
): number {
  switch (bassRole) {
    case '3rd': return norm12(chordRootPc + (chordIntervals[1] ?? 4));
    case '5th': return norm12(chordRootPc + (chordIntervals[2] ?? 7));
    case '7th': return norm12(chordRootPc + (chordIntervals[3] ?? 10));
    case 'pedal': return norm12(bassPedalPc ?? chordRootPc);
    case 'root':
    default: return norm12(chordRootPc);
  }
}

/** 任意 anchor pc → BASS_RANGE 内 MIDI。 */
export function clampPcToBassMidi(pc: number): number {
  let m = norm12(pc) + 36;
  while (m < BASS_LOW) m += 12;
  while (m > BASS_HIGH) m -= 12;
  return m;
}

export const BASSLINE_RULES: Record<string, BasslineRuleFn> = {
  stepwise_descent: stepwiseDescentRule,
  root_lock: rootLockRule,
  octave_alternate: octaveAlternateRule,
  fifth_drop: fifthDropRule,
  walking_bass: walkingBassRule,
  boogie_root_fifth: boogieRootFifthRule,
};

export const DEFAULT_BASSLINE_RULE = 'stepwise_descent';

/** 从风格 weighted ruleset 抽 1 个规则名(forked random,不扰主流)。 */
export function pickBasslineRule(
  rules: { ref: string; weight: number }[] | undefined,
  random: { next(): number },
): string {
  if (!rules || rules.length === 0) return DEFAULT_BASSLINE_RULE;
  const totalWeight = rules.reduce((s, r) => s + r.weight, 0);
  if (totalWeight <= 0) return DEFAULT_BASSLINE_RULE;
  let pick = random.next() * totalWeight;
  for (const r of rules) {
    if (pick < r.weight) return r.ref in BASSLINE_RULES ? r.ref : DEFAULT_BASSLINE_RULE;
    pick -= r.weight;
  }
  const last = rules[rules.length - 1].ref;
  return last in BASSLINE_RULES ? last : DEFAULT_BASSLINE_RULE;
}
