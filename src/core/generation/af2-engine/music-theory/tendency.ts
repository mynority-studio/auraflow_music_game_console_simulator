// ============================================================
// tendency.ts — KK tension / INTERVAL_AESTHETICS / Lerdahl gravity /
//               TENDENCY_TABLE family / evaluateNoteInChordContext
// ============================================================
// Phase 6.1 拆分自 mg-engine/musicTheory.ts。
// Sources: KK section + INTERVAL_AESTHETICS (L1068-1216) + Lerdahl gravity
// + SCALE_GRAVITY (L1233-1469) + NoteHarmonicAssessment (L1575-1679) +
// TENDENCY_TABLE family + evaluateNoteInChordContext (L1680-2162)。
// ============================================================

import { CHORD_TYPES } from './chord-types';
import { SCALE_TYPES, isAvoidNote } from './scale';
import { noteToMidi } from './midi';
import { modeToKeyFamily } from './mode';
// 2026-05-26 Step 6.4:voicing.ts 已删(ImproCore wide-piano-voicing 接管)。
// tendency.ts 的 chordTable lookup 退化为空 table — role / tensionLevel 走 fallback。
// 实际 tendency.ts 整体已无外部 caller(评估为 dead code,Step 6.5 清理时再删)。
const getChordVoicingAesthetics = (_chordType: string): Record<number, { role?: string; tensionLevel?: number }> => ({});
import { computeGlobalContract } from './chord-color';

// ------------------------------------------------------------------
// Krumhansl-Kessler probe-tone profile (1982).
//
// 实验数据来源:Krumhansl & Kessler (1982), "Tracing the Dynamic
// Changes in Perceived Tonal Organization in a Spatial Representation
// of Musical Keys", Psychological Review 89(4), 334-368.
//
// 用真人 probe-tone 实验测得 12 个 pc 在大调 / 小调下的"稳定度感受
// 强度"。raw values 2.23-6.35 是被试评分均值。这是认知音乐心理学
// 这块最被广泛引用的客观数据,替代手调 tensionAmount 数值。
//
// 注:K-K 是 key-relative 稳定度(被试听完调性 cadence 后判断 probe
// 音的契合度)。本项目 INTERVAL_AESTHETICS 主要在 key-relative 上下
// 文使用(TensionTracker.addTension 接收 pcFromKey);chord-relative
// 调用点(isTension 检查)被 globalPcs 合约前置 guard,K-K 的语义偏
// 移不会失效。MAJOR / MINOR 两个 profile 都接入,TensionTracker 按
// 构造时传入的 modeFamily(modeProgressionTemplate 派生)分发。
// INTERVAL_AESTHETICS.tensionAmount 字段保持 K-K MAJOR 派生(模块
// 加载时常量),其 function / expectedResolutions 是 mode-agnostic
// 语义标签 — TensionTracker 在 minor 上下文里只覆盖 tension 数值,
// 不动 function 字段。
// ------------------------------------------------------------------

const KK_STABILITY_MAJOR: readonly number[] = [
  // C    Db    D     Eb    E     F     Gb    G     Ab    A     Bb    B
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];

// K-K 1982 minor probe-tone profile。注意 b3 (Eb, pc=3) 5.38 — 在小调
// 里是骨干(i 和弦的 3rd),major profile 里仅 2.33。同样 b6 (pc=8) 在
// minor 是稳定色彩 3.98(major 仅 2.39),b7 (pc=10) 3.34 是自然小调的
// 下中音(major 2.29 是迫切张力)。这些反转就是 minor 案例(jazz_minor_D
// / pop_minor_A 等)需要独立 profile 的根因。
const KK_STABILITY_MINOR: readonly number[] = [
  // C    Db    D     Eb    E     F     Gb    G     Ab    A     Bb    B
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

// 归一化:tension = 1 - (stability - min) / (max - min). 最稳 (root)
// → 0, 最不稳 (b2) → 1. 模块加载时一次性算好,运行时不重复计算。
const KK_TENSION_MAJOR: readonly number[] = (() => {
  const minS = Math.min(...KK_STABILITY_MAJOR);
  const maxS = Math.max(...KK_STABILITY_MAJOR);
  const range = maxS - minS;
  return KK_STABILITY_MAJOR.map(s => 1 - (s - minS) / range);
})();

const KK_TENSION_MINOR: readonly number[] = (() => {
  const minS = Math.min(...KK_STABILITY_MINOR);
  const maxS = Math.max(...KK_STABILITY_MINOR);
  const range = maxS - minS;
  return KK_STABILITY_MINOR.map(s => 1 - (s - minS) / range);
})();

export function kkTensionMajor(pc: number): number {
  return KK_TENSION_MAJOR[((pc % 12) + 12) % 12];
}

export function kkTensionMinor(pc: number): number {
  return KK_TENSION_MINOR[((pc % 12) + 12) % 12];
}

// ------------------------------------------------------------------
// Interval aesthetics — tension and expected resolution per pitch class
// (relative to the key root). Drives TensionTracker and per-note
// stability decisions during melody generation.
//
// tensionAmount 数值现派生自 K-K 1982 major probe-tone profile(见
// 上方 KK_STABILITY_MAJOR)。每条 K-K 派生值在注释中标 "(K-K: x.xxx)"
// 作为可追溯锚点。原手调值的相对排序(b2 > 7 > b6 > 4 > b7 > 6 > ...)
// 跟 K-K 主要趋势一致,具体数值由实验数据校准。
// expectedResolutions / function / degreeName 字段保持原值(K-K
// 不涉及这些)。
// ------------------------------------------------------------------

type IntervalFunction = 'Home' | 'Anchor' | 'Color' | 'Active' | 'Leading' | 'Tension';

interface IntervalRule {
   semitones: number;
   degreeName: string;
   function: IntervalFunction;
   tensionAmount: number;          // 0.0 to 1.0 (urgency to resolve)
   expectedResolutions: number[];  // semitone offsets relative to key root
   description: string;
}

// Major-mode key-relative interval aesthetics. tensionAmount sourced
// from K-K 1982 probe-tone profile (KK_TENSION_MAJOR); function /
// expectedResolutions / degreeName encode the functional-harmony
// role and the canonical resolution targets for melody scoring.
const INTERVAL_AESTHETICS_MAJOR: Record<number, IntervalRule> = {
    0:  { semitones: 0,  degreeName: '1',     function: 'Home',    tensionAmount: kkTensionMajor(0),  expectedResolutions: [],       description: '主音，绝对稳定，旅途的终起点与归宿。(K-K: 0.000)' },
    1:  { semitones: 1,  degreeName: 'b2',    function: 'Tension', tensionAmount: kkTensionMajor(1),  expectedResolutions: [0],      description: '极度不协和（小二度），具有极其强烈的向下解决至1的倾向。(K-K: 1.000)' },
    2:  { semitones: 2,  degreeName: '2',     function: 'Active',  tensionAmount: kkTensionMajor(2),  expectedResolutions: [0, 4],   description: '流动的经过音，通常平缓解决至1或被带向3。(K-K: 0.697)' },
    3:  { semitones: 3,  degreeName: 'b3',    function: 'Color',   tensionAmount: kkTensionMajor(3),  expectedResolutions: [2, 0],   description: '小调色彩基干或大调中的Blues音，带有忧郁色彩。(K-K: 0.976)' },
    4:  { semitones: 4,  degreeName: '3',     function: 'Home',    tensionAmount: kkTensionMajor(4),  expectedResolutions: [],       description: '大调色彩音，相对稳定，旅途中的"中转站"（未完全结束）。(K-K: 0.478)' },
    5:  { semitones: 5,  degreeName: '4',     function: 'Active',  tensionAmount: kkTensionMajor(5),  expectedResolutions: [4, 0],   description: '强烈的游离感，倾向解决到3（半音下行）或回归1，具体由当前和弦字面音决定。(K-K: 0.549)' },
    6:  { semitones: 6,  degreeName: '#4/b5', function: 'Tension', tensionAmount: kkTensionMajor(6),  expectedResolutions: [7, 5],   description: '三全音，极度游离，Lydian或Blues张力，通常作为经过音解决到5或4。(K-K: 0.930)' },
    7:  { semitones: 7,  degreeName: '5',     function: 'Anchor',  tensionAmount: kkTensionMajor(7),  expectedResolutions: [0],      description: '属音，仅次于主音的强支持点，"山中露营"，旅途未结，最终需回归1。(K-K: 0.282)' },
    8:  { semitones: 8,  degreeName: 'b6',    function: 'Active',  tensionAmount: kkTensionMajor(8),  expectedResolutions: [7],      description: '暗色主导倾向，强烈的半音下行解决至5音。(K-K: 0.961)' },
    9:  { semitones: 9,  degreeName: '6',     function: 'Active',  tensionAmount: kkTensionMajor(9),  expectedResolutions: [7, 4],   description: '明亮且自由的挂留音（五声音阶常用），常作为阶梯解决到5或3。(K-K: 0.653)' },
    10: { semitones: 10, degreeName: 'b7',    function: 'Active',  tensionAmount: kkTensionMajor(10), expectedResolutions: [9, 4, 0],description: '属七和弦色彩音，倾向下行解决至下一个和弦的3音（稳定音）。(K-K: 0.985)' },
    11: { semitones: 11, degreeName: '7',     function: 'Leading', tensionAmount: kkTensionMajor(11), expectedResolutions: [0],      description: '导音，极度迫切需半音上行解决至1。可有延迟解决（中间穿插经过音），但一个进行周期内必须"归宗"。(K-K: 0.842)' }
};

// Minor-mode (Aeolian-based) key-relative interval aesthetics.
// tensionAmount sourced from K-K 1982 minor probe-tone profile
// (KK_TENSION_MINOR — Krumhansl & Kessler 1982, "Tracing the dynamic
// changes in perceived tonal organization in a spatial representation
// of musical keys"). Function / expectedResolutions reflect minor-mode
// idiom (b3/b6/b7 are native chord-scale, harmonic-minor leading tone
// at pc 11 still functions as V→i leading).
//
// Key differences from major profile:
//   pc 3 (b3):  was Color/0.976 → now Home/low (minor's i-chord 3rd)
//   pc 4 (nat3): was Home/0.478 → now Tension/high (mMaj intrusion)
//   pc 8 (b6):  was Active/0.961 → now Color/low (Aeolian native b6)
//   pc 10 (b7): was Active/0.985 → now Active/low (Aeolian native b7)
//
// Source: Krumhansl & Kessler 1982 (probe-tone) + Berklee functional-
// harmony minor-mode chord-scale (Mark Levine 1995).
const INTERVAL_AESTHETICS_MINOR: Record<number, IntervalRule> = {
    0:  { semitones: 0,  degreeName: '1',     function: 'Home',    tensionAmount: kkTensionMinor(0),  expectedResolutions: [],       description: '主音，绝对稳定，小调的根基。(K-K minor: 0.000)' },
    1:  { semitones: 1,  degreeName: 'b2',    function: 'Tension', tensionAmount: kkTensionMinor(1),  expectedResolutions: [0],      description: 'Phrygian 色彩 b2，紧迫向 1 解决。(K-K minor: 0.968)' },
    2:  { semitones: 2,  degreeName: '2',     function: 'Active',  tensionAmount: kkTensionMinor(2),  expectedResolutions: [0, 3],   description: '小调上行温和经过，向 b3 或 1。(K-K minor: 0.746)' },
    3:  { semitones: 3,  degreeName: 'b3',    function: 'Home',    tensionAmount: kkTensionMinor(3),  expectedResolutions: [],       description: '小调骨架，i 和弦的 3 音，稳定。(K-K minor: 0.251)' },
    4:  { semitones: 4,  degreeName: '3',     function: 'Tension', tensionAmount: kkTensionMinor(4),  expectedResolutions: [3],      description: '大三度入侵，破坏 minor 质感（mMaj7 / picardy），强解决回 b3。(K-K minor: 0.989)' },
    5:  { semitones: 5,  degreeName: '4',     function: 'Active',  tensionAmount: kkTensionMinor(5),  expectedResolutions: [3, 0],   description: 'iv 和弦根，向 b3 或 1。(K-K minor: 0.749)' },
    6:  { semitones: 6,  degreeName: '#4/b5', function: 'Tension', tensionAmount: kkTensionMinor(6),  expectedResolutions: [7],      description: '三全音，向 5 解决。(K-K minor: 1.000)' },
    7:  { semitones: 7,  degreeName: '5',     function: 'Anchor',  tensionAmount: kkTensionMinor(7),  expectedResolutions: [0],      description: '属音，最终回归 1。(K-K minor: 0.418)' },
    8:  { semitones: 8,  degreeName: 'b6',    function: 'Color',   tensionAmount: kkTensionMinor(8),  expectedResolutions: [7],      description: 'Aeolian native b6，色彩稳定，弱引力向 5。(K-K minor: 0.621)' },
    9:  { semitones: 9,  degreeName: '6',     function: 'Active',  tensionAmount: kkTensionMinor(9),  expectedResolutions: [7],      description: 'Melodic minor 上行 6，破坏 Aeolian 倾向 G 大调感，向 5 收。(K-K minor: 0.962)' },
    10: { semitones: 10, degreeName: 'b7',    function: 'Color',   tensionAmount: kkTensionMinor(10), expectedResolutions: [0],      description: 'Aeolian native b7，色彩稳定，弱引力向 1。(K-K minor: 0.791)' },
    11: { semitones: 11, degreeName: '7',     function: 'Leading', tensionAmount: kkTensionMinor(11), expectedResolutions: [0],      description: 'Harmonic minor 导音（V→i），向 1 解决。(K-K minor: 0.835)' }
};

// Mode-aware dispatch. Major-family modes (Ionian / Lydian /
// Mixolydian) read the major profile; minor-family modes (Aeolian /
// Dorian / Phrygian / Locrian / harmonic / melodic minor) read the
// minor profile. The evaluator's globalMode parameter selects.
//
// Backwards-compat export: INTERVAL_AESTHETICS without mode index
// returns the major profile (historical default). New consumers
// should pass globalMode to selectIntervalAesthetics() instead.
export const INTERVAL_AESTHETICS: Record<number, IntervalRule> = INTERVAL_AESTHETICS_MAJOR;

export function selectIntervalAesthetics(globalMode: 'major' | 'minor'): Record<number, IntervalRule> {
    return globalMode === 'minor' ? INTERVAL_AESTHETICS_MINOR : INTERVAL_AESTHETICS_MAJOR;
}
// ------------------------------------------------------------------
// Lerdahl Tonal Pitch Space attraction formula (2001).
//
// 数据来源:Lerdahl, F. (2001). Tonal Pitch Space. Oxford UP. Ch. 4.
//
// α(p1 → p2) = (s(p2) / s(p1)) × (1 / n²)
//   s = anchoring strength (basic-space level)
//   n = 半音距离 (1-6, 用最短 mod-12 距离)
//
// scale-intrinsic anchoring(scale 内部的稳定度层级):
//   tonic       → 5  (octave level)
//   fifth       → 4  (fifth level)
//   third       → 3  (triadic level, scale 内的 3rd above root)
//   diatonic    → 2  (其他 scale tone)
//   chromatic   → 1  (scale 外)
//
// 跟 K-K 不同:K-K 是 perceived stability (实验数据);Lerdahl 是
// derived stability (按 basic space 层级理论推导)。两者协同 —
// K-K 校准 INTERVAL_AESTHETICS 张力值,Lerdahl 推导 SCALE_GRAVITY
// 引力目标。
// ------------------------------------------------------------------

function lerdahlScaleStrength(pc: number, scaleRoot: number, scaleName: string): number {
  const scaleIntervals = SCALE_TYPES[scaleName];
  if (!scaleIntervals) return 1;
  const ivFromRoot = ((pc - scaleRoot) % 12 + 12) % 12;
  if (!scaleIntervals.includes(ivFromRoot)) return 1; // chromatic
  if (ivFromRoot === 0) return 5;                      // tonic
  if (ivFromRoot === 7) return 4;                      // fifth
  // 3rd-of-scale — 优先 major-3 (4),fallback minor-3 (3),否则取 scale 里第一个 3-4 半音的音
  if (scaleIntervals.includes(4)) {
    if (ivFromRoot === 4) return 3;
  } else if (scaleIntervals.includes(3)) {
    if (ivFromRoot === 3) return 3;
  }
  return 2; // diatonic (other scale tone)
}

/**
 * Lerdahl attraction value α(fromPc → toPc) within a given scale context.
 * Returns 0 when scale unknown or pcs identical.
 *
 * Source: Lerdahl 2001, Tonal Pitch Space ch. 4.
 */
export function lerdahlAttraction(
  fromPc: number, toPc: number, scaleRoot: number, scaleName: string,
): number {
  const sFrom = lerdahlScaleStrength(fromPc, scaleRoot, scaleName);
  const sTo = lerdahlScaleStrength(toPc, scaleRoot, scaleName);
  // mod-12 shortest distance
  const rawDist = ((toPc - fromPc) % 12 + 12) % 12;
  const n = Math.min(rawDist, 12 - rawDist);
  if (n === 0) return 0;
  return (sTo / sFrom) * (1 / (n * n));
}

/**
 * Compute SCALE_GRAVITY rules for a scale entirely from Lerdahl
 * attraction. For each scale tone fromIv, find the candidate toIv
 * within ±2 semitones (in scale, MORE stable than fromIv) with
 * highest α. Returns rules with score = round(α × 10) — keeps
 * compatibility with engine's 0-30 score range (threshold 18 for
 * scale-gravity-line hard filter, /25 normalization for soft score).
 *
 * Only scale tones get rules (chromatic pcs are not in the scale's
 * "physics", matching original SCALE_GRAVITY semantics).
 *
 * Type heuristic:
 *   - resolve_up   if toIv > fromIv (mod 12 short-distance up)
 *   - resolve_down if toIv < fromIv
 *   - hang         when no clear pull (α < 0.5)
 */
export function computeLerdahlScaleGravity(scaleName: string): ScaleGravityRule[] {
  const scaleIntervals = SCALE_TYPES[scaleName];
  if (!scaleIntervals) return [];
  const rules: ScaleGravityRule[] = [];
  for (const fromIv of scaleIntervals) {
    if (fromIv === 0) continue; // tonic has no pull target
    // Candidate targets: scale tones within ±2 semitones, MORE stable than from
    let bestToIv = -1;
    let bestAlpha = 0;
    const sFrom = lerdahlScaleStrength(fromIv, 0, scaleName);
    for (const toIv of scaleIntervals) {
      if (toIv === fromIv) continue;
      // mod-12 shortest distance
      const rawDist = ((toIv - fromIv) % 12 + 12) % 12;
      const n = Math.min(rawDist, 12 - rawDist);
      if (n > 2) continue; // ±2 半音内才算 "gravity pull"
      const sTo = lerdahlScaleStrength(toIv, 0, scaleName);
      if (sTo <= sFrom) continue; // 只解决到更稳定的音
      const alpha = (sTo / sFrom) * (1 / (n * n));
      if (alpha > bestAlpha) {
        bestAlpha = alpha;
        bestToIv = toIv;
      }
    }
    if (bestToIv < 0) continue;
    // up vs down direction (mod-12 shortest)
    const upDist = ((bestToIv - fromIv) % 12 + 12) % 12;
    const downDist = 12 - upDist;
    const isUp = upDist <= downDist;
    const score = Math.round(bestAlpha * 10);
    const type: ScaleGravityRule['type'] =
      bestAlpha < 0.5 ? 'hang' : (isUp ? 'resolve_up' : 'resolve_down');
    rules.push({ fromInterval: fromIv, toInterval: bestToIv, score, type });
  }
  return rules;
}

// ------------------------------------------------------------------
// SCALE_GRAVITY — universal physics of half-step / whole-step
// resolution embedded in each scale (mode). Indexed by scale name;
// each rule says "when the melody emits a note at fromInterval (from
// the scale's tonic), the listener feels gravity toward toInterval".
//
// Style is NOT in this table — physics is style-independent. Per
// user direction:
// "无论流行还是爵士,只要用自然小调,b6→5的引力不可避免。
//  Style 只决定引擎对引力的服从度 (gravityStrictness)。"
//
// Score: relative magnitude (0-30); used for soft scoring weight.
//   - Lerdahl-derived entries: round(α × 10), α from
//     computeLerdahlScaleGravity (Lerdahl 2001 TPS ch.4)
//   - Manual override entries: hand-tuned for idioms Lerdahl's pure
//     in-scale 1/n² model doesn't capture (Blues b5, Phrygian b2,
//     modal sub-leading b7→1, secondary-dominant family scales)
//
// Type:
//   resolve_down — half/whole step downward (b6→5, 4→3)
//   resolve_up   — half/whole step upward (7→1, #4→5)
//   hang         — characteristic hang tone (Dorian's natural 6 等)
//
// Intervals are SEMITONES from the scale's tonic (0-11).
// ------------------------------------------------------------------

export interface ScaleGravityRule {
  fromInterval: number;
  toInterval: number;
  score: number;
  type: 'resolve_down' | 'resolve_up' | 'hang';
}

// Lazy-init cache(Phase 6.1 拆分后必须 lazy:tendency ↔ scale ↔ chord-color
// 形成 ES 模块循环,module-load 时 SCALE_TYPES 处于 TDZ,inline 调
// computeLerdahlScaleGravity → throw。延迟到首次 getScaleGravity 调用,
// 那时所有模块已 fully loaded。)
let _scaleGravityCache: Record<string, ScaleGravityRule[]> | null = null;
function buildScaleGravityTable(): Record<string, ScaleGravityRule[]> {
  return {
    // ---- Major Family — Lerdahl-derived (computeLerdahlScaleGravity at first access) ----
    // 自动派生自 Lerdahl 2001 TPS ch.4 attraction formula α = (s_to/s_from)×(1/n²)。
    // 跟原手调表对比:
    //   Ionian   4→3=15 (exact)、7→1=22→25 (+3)、2→1=6 (exact)、6→5=4→5 (+1)
    //   Lydian   #4→5=18→20、7→1=22→25、2→3 manual → 2→1 Lerdahl (主流向 1 而非 3)
    //   Mixol.   4→3=15 (exact)、新增 9→7(6→5)+ 11→0(7→1);
    //            原 10→9 / 10→7 (b7→6/5) 被 Lerdahl 排除 (b7/6 等稳, 无 pull)。
    'Ionian':     computeLerdahlScaleGravity('Ionian'),
    'Mixolydian': computeLerdahlScaleGravity('Mixolydian'),
    'Lydian':     computeLerdahlScaleGravity('Lydian'),
    // ---- Minor Family ----
    'Aeolian': [
        { fromInterval: 8,  toInterval: 7,  score: 25, type: 'resolve_down' }, // b6→5 minor sigh (strongest)
        { fromInterval: 10, toInterval: 0,  score: 18, type: 'resolve_up' },   // b7→1 modal leading sub
        { fromInterval: 2,  toInterval: 3,  score: 10, type: 'resolve_up' },   // 2→b3 dark up
        { fromInterval: 5,  toInterval: 3,  score: 12, type: 'resolve_down' }, // 4→b3 minor sub-down (raised)
    ],
    'Dorian': [
        { fromInterval: 9,  toInterval: 7,  score: 5,  type: 'hang' },          // ♮6 hangs (NOT pulled down strongly)
        { fromInterval: 9,  toInterval: 10, score: 6,  type: 'resolve_up' },    // 6→b7 cool
        { fromInterval: 2,  toInterval: 3,  score: 9,  type: 'resolve_up' },    // 2→b3
        { fromInterval: 5,  toInterval: 3,  score: 6,  type: 'resolve_down' },  // 4→b3
        { fromInterval: 10, toInterval: 0,  score: 10, type: 'resolve_up' },    // b7→1
    ],
    'Phrygian': [
        { fromInterval: 1,  toInterval: 0,  score: 22, type: 'resolve_down' }, // b2→1 dark Phrygian
        { fromInterval: 8,  toInterval: 7,  score: 20, type: 'resolve_down' }, // b6→5
    ],
    'Locrian': [
        { fromInterval: 1,  toInterval: 0,  score: 18, type: 'resolve_down' }, // b2→1
        { fromInterval: 6,  toInterval: 7,  score: 5,  type: 'resolve_up' },   // b5→? weak
    ],
    'Harmonic Minor': [
        { fromInterval: 11, toInterval: 0,  score: 25, type: 'resolve_up' },   // 7→1 raised leading
        { fromInterval: 8,  toInterval: 7,  score: 20, type: 'resolve_down' }, // b6→5 sigh kept
        { fromInterval: 2,  toInterval: 3,  score: 10, type: 'resolve_up' },   // 2→b3
    ],
    'Melodic Minor': [
        { fromInterval: 11, toInterval: 0,  score: 22, type: 'resolve_up' },   // 7→1 leading
        { fromInterval: 9,  toInterval: 11, score: 8,  type: 'resolve_up' },   // 6→7 (smooth ascent)
        { fromInterval: 2,  toInterval: 3,  score: 9,  type: 'resolve_up' },   // 2→b3
    ],
    // ---- Dominant family extensions for V/X borrowing ----
    'Phrygian Dominant': [
        { fromInterval: 1,  toInterval: 0,  score: 25, type: 'resolve_down' }, // b9→1 dark sub-tonic
        { fromInterval: 11, toInterval: 0,  score: 22, type: 'resolve_up' },   // 7→1 strong leading
        { fromInterval: 8,  toInterval: 7,  score: 20, type: 'resolve_down' }, // b13→5
        { fromInterval: 5,  toInterval: 4,  score: 12, type: 'resolve_down' }, // 4→3
    ],
    'Lydian Dominant': [
        { fromInterval: 6,  toInterval: 7,  score: 16, type: 'resolve_up' },   // #4→5
        { fromInterval: 10, toInterval: 9,  score: 10, type: 'resolve_down' }, // b7→6
    ],
    'Altered': [
        // Altered scale's gravity is mostly CROSS-CHORD (resolves into
        // next chord's tones). Within-scale tendencies are weaker;
        // engine should use cross-chord pcA/pcB closest-pair logic
        // for proper Altered resolution. Placeholder rules:
        { fromInterval: 1,  toInterval: 0,  score: 18, type: 'resolve_down' }, // b9→1
        { fromInterval: 8,  toInterval: 7,  score: 15, type: 'resolve_down' }, // b13→5
    ],
    'Bebop Dominant': [
        { fromInterval: 11, toInterval: 0,  score: 16, type: 'resolve_up' },   // natural 7 → 1 (added passing)
        { fromInterval: 10, toInterval: 9,  score: 10, type: 'resolve_down' }, // b7→6
        { fromInterval: 5,  toInterval: 4,  score: 14, type: 'resolve_down' }, // 4→3
    ],
    'Bebop Major': [
        { fromInterval: 5,  toInterval: 4,  score: 15, type: 'resolve_down' }, // 4→3
        { fromInterval: 11, toInterval: 0,  score: 22, type: 'resolve_up' },   // 7→1
        { fromInterval: 8,  toInterval: 7,  score: 12, type: 'resolve_down' }, // added b6→5
    ],
  };
}

/** Public access — preserves original SCALE_GRAVITY API while triggering lazy init. */
export function getScaleGravityTable(): Record<string, ScaleGravityRule[]> {
  if (_scaleGravityCache === null) _scaleGravityCache = buildScaleGravityTable();
  return _scaleGravityCache;
}

// Backwards-compat re-export(原 `export const SCALE_GRAVITY`,现 Proxy lazy)
export const SCALE_GRAVITY = new Proxy({} as Record<string, ScaleGravityRule[]>, {
  get(_, key: string) { return getScaleGravityTable()[key]; },
  ownKeys() { return Object.keys(getScaleGravityTable()); },
  getOwnPropertyDescriptor(_, key: string) {
    const table = getScaleGravityTable();
    if (key in table) return { configurable: true, enumerable: true, value: table[key] };
    return undefined;
  },
});

// Look up scale gravity for a given scale name, returning rules
// keyed by fromInterval for fast pendingResolve dispatch.
export function getScaleGravity(scaleName: string): Map<number, ScaleGravityRule> {
  const out = new Map<number, ScaleGravityRule>();
  const rules = getScaleGravityTable()[scaleName];
  if (!rules) return out;
  // If multiple rules share fromInterval, prefer highest score.
  for (const rule of rules) {
    const existing = out.get(rule.fromInterval);
    if (!existing || rule.score > existing.score) {
      out.set(rule.fromInterval, rule);
    }
  }
  return out;
}

// ------------------------------------------------------------------
// Chord voicing aesthetics — per-chord-type, what role each interval
// plays (chord tone / available tension / avoid).
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Unified harmonic assessment — the engine's only authoritative
// "is this note consonant in context, and where should it go" query.
//
// Why this exists: prior to this primitive, six independent call
// sites each consulted a different table (INTERVAL_AESTHETICS for
// key-relative function, CHORD_VOICING_AESTHETICS for chord-family
// role, isAvoidNote for chord-type avoid table, computeGlobalContract
// for chord-literal pcs, getResolutionTargets for key-tendency
// targets, plus the pendingResolve ghost state machine). They
// produced contradictory verdicts — e.g. G7's F was simultaneously
// flagged as CHORD_TONE (role) AND high tensionAmount (key) AND
// Leading-tone of D function. No fusion logic existed, so each call
// site invented its own ad-hoc combination.
//
// Design principle (user's first principle): "consonance depends on
// the harmonic environment." Chord-context judgement is authoritative;
// key-context provides resolution-target backstop only.
//
// Inputs are flat numbers (no ChordDef dependency) so this primitive
// can live in the theory module without circular imports.
// ------------------------------------------------------------------

export interface NoteHarmonicAssessment {
  /** chord-context consonance verdict — the authoritative read. */
  consonance: 'consonant' | 'colortone' | 'tension' | 'avoid';
  /**
   * Resolution urgency in [0, 1]. TSD-weighted:
   *   - D function tensions: high urgency (V7's b7 / leading-tone)
   *   - T function tensions: moderate (sets up the next phrase)
   *   - S function tensions: low — sus / 11 may hang waiting for D
   */
  urgency: number;
  /**
   * Absolute pcs (mod 12) where this note "wants to go." Priority
   * blend: same-chord literal anchor tones > next-chord anchor tones
   * (root / 3 / 5) > key-relative INTERVAL_AESTHETICS targets. The
   * note's own pc is excluded so the consumer can't trivially "resolve"
   * by staying.
   */
  resolutionTargets: number[];
  /** Note pc ∈ current chord's literal interval set (root/3/5/7/etc). */
  isInChordContract: boolean;
  /** Note pc ∈ admissible color extensions (9/11/13 per chord family). */
  isInChordExtension: boolean;
  /** Note pc ∈ next chord's 1/3/5 — anticipatory-resolution candidate. */
  isInNextChordAnchor: boolean;
}

/**
 * Detects dom-family chord types (root + 4-or-3 + 7 + …). Used to
 * decide whether the chord's 7-interval is a tension-bearing tendency
 * tone (dom b7 makes the tritone with 3) or a structural color
 * (m7's b7 is stable, maj7's 7 is mostly stable but slightly tense).
 */
function isDomFamilyChord(chordType: string, intervals: readonly number[]): boolean {
  if (chordType.startsWith('maj')) return false;
  if (chordType.startsWith('m') && !chordType.startsWith('maj')) return false;
  // dom: has b7 (10) AND major 3rd (4). sus chords also count for our
  // purpose — they carry the same b7 → tritone-pending feel.
  return intervals.includes(10) && (intervals.includes(4) || intervals.includes(5));
}

// ------------------------------------------------------------------
// Tendency table — chord-scenario × interval-from-chord-root.
//
// What: authoritative melody-side tension data. 6 scenarios capture
// the chord's base quality combined with its TSD function in the key
// (M7T = maj-base at Tonic, M7S = maj-base at Subdominant, m7T / m7S
// for min, 7D for any dom, SUS for sus chords). Each scenario's
// 12-entry row encodes per-pcFromChordRoot:
//   - state: CT (chord tone, fully consonant) / T (tension, may hang
//            or resolve) / A (avoid, must resolve)
//   - gravity: 0..1 resolution urgency (0 = none, 1 = imperative)
//   - targets: pcs-from-chord-root the note WANTS to resolve onto
//
// Why two M7 entries (M7T vs M7S) and two m7 entries (m7T vs m7S):
// because functional position changes the legality of the same
// chord-relative interval. The clearest cases:
//   - #11 (pc 6) on Cmaj7 (M7T) = T 0.5 (deliberate Lydian color)
//                  on Fmaj7 (M7S) = T 0.2 (Lydian is IV's birthright)
//   - 11 (pc 5)  on Cmaj7 (M7T) = A 0.95 (textbook fatal avoid)
//                  on Fmaj7 (M7S) = A 0.7 (IV tolerates more)
//   - M6 / 13 (pc 9) on Am7 (m7T) = A 0.8 (kills Aeolian = G major leak)
//                       on Dm7 (m7S) = T 0.4 (Dorian's signature tone)
//   - b6 / b13 (pc 8) on Am7 (m7T) = CT 0.2 (Aeolian b6 = legal scale tone)
//                       on Dm7 (m7S) = A 0.7 (kills Dorian)
//   - 11 (pc 5)  on Am7 (m7T) = A 0.8 (Aeolian 11 is heavy)
//                  on Dm7 (m7S) = T 0.3 (Dorian 11 = modern m11 chord)
//
// Without this T/S split the engine treats Am7 and Dm7 as "the same
// m7" and misses the Dorian-vs-Aeolian distinction that ii and vi
// have always carried in functional harmony.
//
// Extensions (9 / 11 / 13 / 6 / add) do NOT change scenario —
// Cmaj9, C6, Cadd9, Cmaj13 are all M7T (maj-base at T). Likewise
// for the minor and dom families. SUS is the only "type swaps
// scenario" case because sus chords reject the 3rd that defines
// maj / min quality.
//
// Source: derived from user's explicit chord-scenario tendency table
// (Levine 1995 / Berklee functional-harmony curriculum) plus a SUS
// row derived from sus-chord theory (4 / 11 = chord tone, 3 = avoid).
// ------------------------------------------------------------------

export type ChordScenario = 'M7T' | 'M7S' | 'm7S' | 'm7T' | '7D' | 'SUS';
export type TendencyState = 'CT' | 'T' | 'A';

export interface TendencyEntry {
  state: TendencyState;
  gravity: number;       // 0..1 — resolution urgency
  targets: readonly number[];  // pcs FROM CHORD ROOT (mod 12)
  note?: string;
}

export const TENDENCY_TABLE: Record<ChordScenario, readonly TendencyEntry[]> = {
  // M7T — Maj base at Tonic (Cmaj7 / Cmaj / Cmaj9 / Cadd9 / C6 / C6/9 in I)
  M7T: [
    /*  0 R   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  1 b9  */ { state: 'A',  gravity: 1.0,  targets: [0],     note: 'm9 clash with root' },
    /*  2 9   */ { state: 'T',  gravity: 0.2,  targets: [0, 4] },
    /*  3 #9  */ { state: 'A',  gravity: 0.9,  targets: [4, 2],  note: 'm9 clash with M3' },
    /*  4 3   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  5 11  */ { state: 'A',  gravity: 0.95, targets: [4],     note: 'textbook fatal avoid (vs M3)' },
    /*  6 #11 */ { state: 'T',  gravity: 0.5,  targets: [7, 4],  note: 'deliberate Lydian color' },
    /*  7 5   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  8 b13 */ { state: 'A',  gravity: 0.9,  targets: [7],     note: 'm9 clash with 5' },
    /*  9 13  */ { state: 'T',  gravity: 0.3,  targets: [7, 11] },
    /* 10 b7  */ { state: 'A',  gravity: 0.9,  targets: [11],    note: 'destroys maj7 → reads as dom7' },
    /* 11 7   */ { state: 'CT', gravity: 0.0,  targets: [] },
  ],
  // M7S — Maj base at Subdominant (Fmaj7 / F / Fmaj9 / F6 in IV; bVII7 borrowed maj)
  M7S: [
    /*  0 R   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  1 b9  */ { state: 'A',  gravity: 1.0,  targets: [0] },
    /*  2 9   */ { state: 'T',  gravity: 0.1,  targets: [0, 4],  note: 'freer under Lydian' },
    /*  3 #9  */ { state: 'A',  gravity: 0.9,  targets: [4, 2] },
    /*  4 3   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  5 11  */ { state: 'A',  gravity: 0.7,  targets: [4],     note: 'IV tolerates 11 better than I' },
    /*  6 #11 */ { state: 'T',  gravity: 0.2,  targets: [7, 4],  note: 'Lydian signature — IV birthright' },
    /*  7 5   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  8 b13 */ { state: 'A',  gravity: 0.9,  targets: [7] },
    /*  9 13  */ { state: 'T',  gravity: 0.2,  targets: [7, 11] },
    /* 10 b7  */ { state: 'A',  gravity: 0.9,  targets: [11] },
    /* 11 7   */ { state: 'CT', gravity: 0.0,  targets: [] },
  ],
  // m7S — Min base at Subdominant (Dm7 / Dm / Dm9 / Dm11 in ii; Dorian birthright)
  m7S: [
    /*  0 R   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  1 b9  */ { state: 'A',  gravity: 0.95, targets: [0],     note: 'm9 clash with root' },
    /*  2 9   */ { state: 'T',  gravity: 0.2,  targets: [0, 3] },
    /*  3 #9  */ { state: 'CT', gravity: 0.0,  targets: [],      note: 'enharmonic with m3 chord tone' },
    /*  4 3   */ { state: 'A',  gravity: 0.95, targets: [3],     note: 'destroys minor quality' },
    /*  5 11  */ { state: 'T',  gravity: 0.3,  targets: [3, 7],  note: 'Dorian 11 — modern m11 birthright' },
    /*  6 #11 */ { state: 'A',  gravity: 0.8,  targets: [7],     note: 'breaks Dorian (= m7b5 leak)' },
    /*  7 5   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  8 b13 */ { state: 'A',  gravity: 0.7,  targets: [7],     note: 'kills Dorian' },
    /*  9 13  */ { state: 'T',  gravity: 0.4,  targets: [7, 10], note: 'Dorian signature M6' },
    /* 10 b7  */ { state: 'CT', gravity: 0.0,  targets: [] },
    /* 11 7   */ { state: 'A',  gravity: 0.85, targets: [10],    note: 'makes mMaj7 — destroys Dorian' },
  ],
  // m7T — Min base at Tonic (Am7 / Am / Am9 in vi / i; Aeolian)
  m7T: [
    /*  0 R   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  1 b9  */ { state: 'A',  gravity: 1.0,  targets: [0] },
    /*  2 9   */ { state: 'T',  gravity: 0.3,  targets: [0, 3],  note: 'Aeolian 9 — slightly conservative' },
    /*  3 #9  */ { state: 'CT', gravity: 0.0,  targets: [],      note: 'enharmonic with m3 chord tone' },
    /*  4 3   */ { state: 'A',  gravity: 0.95, targets: [3],     note: 'destroys minor quality' },
    /*  5 11  */ { state: 'A',  gravity: 0.8,  targets: [3],     note: 'Aeolian 11 is heavy / chord-busting' },
    /*  6 #11 */ { state: 'A',  gravity: 0.8,  targets: [7] },
    /*  7 5   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  8 b13 */ { state: 'CT', gravity: 0.2,  targets: [7],     note: 'Aeolian b6 — legal scale tone (sus-ish)' },
    /*  9 13  */ { state: 'A',  gravity: 0.8,  targets: [7],     note: 'M6 kills Aeolian (→ Dorian leak)' },
    /* 10 b7  */ { state: 'CT', gravity: 0.0,  targets: [] },
    /* 11 7   */ { state: 'A',  gravity: 0.85, targets: [10],    note: 'mMaj7 — destroys Aeolian' },
  ],
  // 7D — Dom base at Dominant (G7 in V; V/X secondary dom; subV/X tritone sub).
  // Altered tensions (b9 / #9 / #11 / b13) are TENSION not AVOID — melodic
  // minor 5th mode (= altered scale) makes them legit dom7 vocabulary.
  '7D': [
    /*  0 R   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  1 b9  */ { state: 'T',  gravity: 0.7,  targets: [0, 4],  note: 'altered tension — V7b9 standard' },
    /*  2 9   */ { state: 'T',  gravity: 0.2,  targets: [0, 4] },
    /*  3 #9  */ { state: 'T',  gravity: 0.75, targets: [4],     note: 'Hendrix blues tension' },
    /*  4 3   */ { state: 'CT', gravity: 0.0,  targets: [],      note: 'leading-tone — strong V→I draw' },
    /*  5 11  */ { state: 'A',  gravity: 0.9,  targets: [4],     note: 'sus only — clashes with M3' },
    /*  6 #11 */ { state: 'T',  gravity: 0.55, targets: [7, 4],  note: 'Lydian dominant signature' },
    /*  7 5   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  8 b13 */ { state: 'T',  gravity: 0.65, targets: [7, 10], note: 'V7b13 / altered #5' },
    /*  9 13  */ { state: 'T',  gravity: 0.3,  targets: [7, 10] },
    /* 10 b7  */ { state: 'CT', gravity: 0.0,  targets: [],      note: 'tritone partner with 3' },
    /* 11 7   */ { state: 'A',  gravity: 0.95, targets: [10, 0], note: 'destroys dom function (m2 with b7)' },
  ],
  // SUS — Suspended (sus2 / sus4 / 7sus4 / 9sus). No 3rd → 4 (11) AND 2 (9)
  // are chord tones; the M3 is the avoid (it cancels the suspension). 7sus4's
  // b7 is CT (it's chord literal), not a dom tendency tone — the suspension
  // softens the tritone. Position-independent: sus character outweighs TSD
  // function for melody choice.
  SUS: [
    /*  0 R   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  1 b9  */ { state: 'A',  gravity: 0.95, targets: [0],     note: 'm9 clash with root' },
    /*  2 9   */ { state: 'CT', gravity: 0.0,  targets: [],      note: 'sus2 chord tone' },
    /*  3 #9  */ { state: 'T',  gravity: 0.5,  targets: [2, 5] },
    /*  4 3   */ { state: 'A',  gravity: 0.8,  targets: [5, 2],  note: 'M3 cancels the suspension' },
    /*  5 11  */ { state: 'CT', gravity: 0.0,  targets: [],      note: 'sus4 chord tone — the soul of sus' },
    /*  6 #11 */ { state: 'T',  gravity: 0.4,  targets: [7, 5] },
    /*  7 5   */ { state: 'CT', gravity: 0.0,  targets: [] },
    /*  8 b13 */ { state: 'T',  gravity: 0.5,  targets: [7] },
    /*  9 13  */ { state: 'T',  gravity: 0.3,  targets: [7, 0] },
    /* 10 b7  */ { state: 'CT', gravity: 0.1,  targets: [],      note: '7sus4 chord literal — softens tritone' },
    /* 11 7   */ { state: 'A',  gravity: 0.85, targets: [10, 0] },
  ],
};

/**
 * Map a chord type string to its base quality family — determines
 * which scenario family (maj / min / dom / sus) the chord belongs to.
 * Extensions (9 / 11 / 13 / 6 / add) DO NOT change the family.
 *
 * Returns null for chord types this resolver doesn't classify
 * (dim / aug / m7b5 / etc.) — caller should fall back to existing
 * chord-family logic in those cases.
 */
export function detectChordBaseQuality(chordType: string): 'maj' | 'min' | 'dom' | 'sus' | null {
  if (!chordType) return 'maj';
  if (chordType.includes('sus')) return 'sus';
  if (chordType.startsWith('maj')) return 'maj';
  if (chordType === '6' || chordType === '6/9' || chordType === 'add9'
      || chordType === '' || chordType === 'add2') return 'maj';
  if (chordType.startsWith('m') && !chordType.startsWith('maj')) {
    // m / m7 / m9 / m11 / m13 / m6 — but NOT m7b5 / mMaj7
    if (chordType === 'm7b5' || chordType === 'm9b5' || chordType.startsWith('mMaj')) return null;
    return 'min';
  }
  // Dom family: bare numeric chord type ('7', '9', '11', '13'), altered
  // ('7alt', '7b9', '7#9', '7b13', '7#11'), '7#5', '7b5'.
  if (/^(7|9|11|13)/.test(chordType) || chordType === '7alt'
      || /^7[#b]/.test(chordType)) return 'dom';
  // dim / aug / quartal / etc. — not classified
  return null;
}

/**
 * Resolve a chord's tendency-table scenario given its base quality and
 * effective TSD function in the song key. The 5-entry M7/m7/7D matrix
 * + 1-entry SUS gives 6 total scenarios; combinations not in the matrix
 * (e.g. dom at T position, maj at D) fall back to the nearest neighbor.
 *
 * Pure function — no random / chord-instance dependency beyond the
 * type string and effectiveFunc parameter.
 */
export function resolveChordScenario(
  chordType: string,
  effectiveFunc: 'T' | 'S' | 'D',
): ChordScenario | null {
  const base = detectChordBaseQuality(chordType);
  if (base === null) return null;
  if (base === 'sus') return 'SUS';
  if (base === 'dom') return '7D';  // dom always uses 7D regardless of position
  if (base === 'maj') return effectiveFunc === 'S' ? 'M7S' : 'M7T';  // D-position maj falls back to T
  if (base === 'min') return effectiveFunc === 'S' ? 'm7S' : 'm7T';
  return null;
}

/**
 * Tendency lookup for a melody pitch against the current chord context.
 * Returns null when the scenario can't be resolved (caller should fall
 * back to the chord-family CHORD_VOICING_AESTHETICS path).
 */
export function getMelodyTendency(
  melodyPc: number,
  chordRootPc: number,
  scenario: ChordScenario,
): TendencyEntry {
  const npc = (((melodyPc % 12) + 12) % 12);
  const rpc = (((chordRootPc % 12) + 12) % 12);
  const pcFromChord = (((npc - rpc) % 12) + 12) % 12;
  return TENDENCY_TABLE[scenario][pcFromChord];
}

export function evaluateNoteInChordContext(
  notePc: number,
  chordType: string,
  chordRootPc: number,
  effectiveFunc: 'T' | 'S' | 'D',
  nextChordType: string | null,
  nextChordRootPc: number | null,
  keyRootPc: number,
  scaleNameForBar?: string,
  isModalContext?: boolean,
  /**
   * Bar's currently-active runScale pitch classes. When provided, the
   * evaluator becomes scale-aware:
   *   - pcs IN the scale never degrade past 'colortone' (in-scale
   *     coloration is by definition legal — Phrygian-Dominant's b9
   *     over V/X-minor is the scale's signature, not a clash).
   *   - pcs OUT of the scale upgrade at least to 'tension' (out-of-
   *     scale pitches are outside the bar's tonal context regardless
   *     of chord-relative role).
   * Omit when caller has no scale context — evaluator falls back to
   * chord-context-only judgement.
   */
  localScalePcs?: Set<number>,
  /**
   * Song-level tonal character — 'tonal' (functional-harmony,
   * tensions must resolve) or 'modal' (scale-color, tensions hang).
   * Default 'tonal' preserves existing behavior for callers that
   * don't pass this. Under 'modal':
   *   - tension urgency halved (typically drops below the unified-
   *     tension-resolution hard constraint threshold → hard resolve
   *     stops firing → blues b3/b5/b7 may hang as scale color)
   *   - in-scale 'tension' upgrades to 'colortone' (functional
   *     tendency-tones become legitimate mode color when the bar's
   *     runScale embraces them)
   */
  tonalCharacter: 'tonal' | 'modal' = 'tonal',
  /**
   * Local tonal center pc — decided at harmony layer (realizeProgression)
   * when secondary dominants / borrowed chords are filled in. The
   * evaluator does NOT re-derive borrowing; it only consumes this pc
   * as the reference frame for INTERVAL_AESTHETICS lookup (the
   * key-relative expectedResolutions backstop). When omitted, falls
   * back to keyRootPc — matches "no borrowing" behavior.
   */
  localTonalCenterPc?: number,
  /**
   * Global key mode family — 'major' or 'minor'. Selects which
   * INTERVAL_AESTHETICS profile (K-K major or K-K minor) the Layer B
   * key-relative consultation reads from. Default 'major' preserves
   * pre-existing behavior. For minor songs, passing 'minor' makes the
   * evaluator correctly identify b3 as native CT (not borrowed Color),
   * nat3 as the mMaj intrusion (high tension), b6/b7 as native Aeolian
   * colors (low gravity), etc.
   */
  globalMode: 'major' | 'minor' = 'major',
): NoteHarmonicAssessment {
  const npc = (((notePc % 12) + 12) % 12);
  const rpc = (((chordRootPc % 12) + 12) % 12);
  const kpc = (((keyRootPc % 12) + 12) % 12);
  const pcFromChord = (((npc - rpc) % 12) + 12) % 12;

  // --- Local tonal center (set at harmony layer; evaluator only consumes) ---
  // The chord-realization stage (realizeProgression) decides borrowing
  // when it fills V/X secondary dominants and subV/X tritone
  // substitutions, and tags the chord with localTonalCenterPc. The
  // evaluator just reads it. No parallel borrow-detection logic here.
  const literalIntervals = CHORD_TYPES[chordType] ?? [0, 4, 7];
  const isDom = isDomFamilyChord(chordType, literalIntervals);
  const localKeyRootPc = localTonalCenterPc !== undefined
    ? (((localTonalCenterPc % 12) + 12) % 12)
    : kpc;
  const pcFromLocalKey = (((npc - localKeyRootPc) % 12) + 12) % 12;

  // --- chord-relative role / tensionLevel ---
  const chordTable = getChordVoicingAesthetics(chordType);
  const chordEntry = chordTable[pcFromChord];
  const role = chordEntry?.role ?? 'AVOID_NOTE';
  const chordTensionLevel = chordEntry?.tensionLevel ?? 1.0;

  // --- chord literal & extension contract ---
  const isInChordContract = literalIntervals.some(iv => (rpc + iv) % 12 === npc);
  const globalContract = computeGlobalContract(chordType, rpc);
  const isInChordExtension = globalContract.pcs.has(npc) && !isInChordContract;

  // --- next chord anchor pcs (1/3/5 from next root, chord-quality-aware) ---
  let isInNextChordAnchor = false;
  const nextAnchorPcs: number[] = [];
  if (nextChordType !== null && nextChordRootPc !== null) {
    const nrpc = (((nextChordRootPc % 12) + 12) % 12);
    const nextIvs = CHORD_TYPES[nextChordType] ?? [0, 4, 7];
    nextAnchorPcs.push(nrpc);
    if (nextIvs.includes(3)) nextAnchorPcs.push((nrpc + 3) % 12);
    if (nextIvs.includes(4)) nextAnchorPcs.push((nrpc + 4) % 12);
    if (nextIvs.includes(7)) nextAnchorPcs.push((nrpc + 7) % 12);
    isInNextChordAnchor = nextAnchorPcs.includes(npc);
  }

  // --- consonance verdict (chord-context-first) ---
  //
  // Two-tier consultation:
  //   1. TENDENCY_TABLE (preferred) — when resolveChordScenario produces
  //      a 6-scenario verdict (M7T / M7S / m7T / m7S / 7D / SUS), the
  //      table's state / gravity / targets are the AUTHORITATIVE source.
  //      This is the only path that distinguishes ii (Dm7 = m7S, Dorian)
  //      from vi (Am7 = m7T, Aeolian), I (Cmaj7 = M7T) from IV (Fmaj7 =
  //      M7S, Lydian), etc.
  //   2. CHORD_VOICING_AESTHETICS fallback — for chord types tendency
  //      can't classify (m7b5 / dim / dim7 / aug / quartal / etc.).
  let consonance: NoteHarmonicAssessment['consonance'];
  let tendencyGravity: number | null = null;
  let tendencyTargets: readonly number[] | null = null;
  const scenario = resolveChordScenario(chordType, effectiveFunc);
  if (scenario !== null) {
    const tendency = getMelodyTendency(npc, rpc, scenario);
    tendencyGravity = tendency.gravity;
    tendencyTargets = tendency.targets;
    // State → consonance. T splits by gravity: weak T (<0.5) is
    // colortone (hangable), strong T (≥0.5) is tension (must resolve).
    if (tendency.state === 'CT') {
      consonance = 'consonant';
    } else if (tendency.state === 'T') {
      consonance = tendency.gravity >= 0.5 ? 'tension' : 'colortone';
    } else { // 'A'
      consonance = 'avoid';
    }
  } else {
    // Fallback for chord types outside the 6-scenario coverage.
    if (role === 'AVOID_NOTE') {
      consonance = 'avoid';
    } else if (role === 'CHORD_TONE') {
      if (isDom && pcFromChord === 10) {
        consonance = 'tension';
      } else if (chordType.startsWith('maj') && pcFromChord === 11) {
        consonance = 'tension';
      } else {
        consonance = 'consonant';
      }
    } else if (role === 'AVAILABLE_TENSION') {
      consonance = 'colortone';
    } else { // ALTERED_TENSION
      consonance = 'tension';
    }
  }

  // --- Layer B: key-relative gravity (max-merge with Layer A) ---
  //
  // The note carries TWO independent tension stories simultaneously:
  //   Layer A = chord-context (TENDENCY_TABLE) — "what role am I in
  //             the current chord?"
  //   Layer B = key-context (INTERVAL_AESTHETICS, mode-aware) —
  //             "what role am I in the song's key?"
  //
  // The canonical case where they diverge: B on G7 in C major.
  //   Layer A (7D)[4] = CT 0.0 — chord 3rd of dom7, harmless
  //   Layer B (major)[11] = Leading 0.842 — key's 7th, must go to 1
  // Without consulting Layer B, the engine treats B as a plain chord
  // tone (melody stabs it 6× without resolving — audited as the
  // pop_gc1z2g bar 2 cluster).
  //
  // Resolution rule (Mark Levine / Berklee functional harmony):
  // take the STRONGER tension verdict.
  //   finalGravity = max(layerA.gravity, layerB.gravity)
  //   finalState   = harshest(layerA.state, layerB.state)
  //   finalTargets = union(layerA.targets, layerB.targets) at absolute pcs
  //
  // This generalizes the prior leading-tone-on-V special case to
  // every two-layer-divergence case (e.g. F-on-G7 = CT chord-tone
  // but key-relative 4 0.55 → must go to E; #11 on Cmaj7 vs C major
  // tritone 0.93 → tension overrides chord's mild T 0.5 etc.).
  const layerBProfile = selectIntervalAesthetics(globalMode);
  const layerBRule = layerBProfile[pcFromLocalKey];
  const layerBGravity = layerBRule?.tensionAmount ?? 0;
  const layerBTargetsAbs = (layerBRule?.expectedResolutions ?? [])
    .map(t => ((localKeyRootPc + t) % 12 + 12) % 12);
  // Layer A gravity = tendencyGravity (from TENDENCY_TABLE) when
  // scenario fired; else derived from chord tensionLevel (mild).
  const layerAGravity = tendencyGravity ?? (chordTensionLevel * 0.5);
  // Merge: take max. If Layer B is strictly harsher, upgrade
  // consonance accordingly and override tendencyGravity so urgency
  // computation picks it up.
  if (layerBGravity > layerAGravity) {
    tendencyGravity = layerBGravity;
    // Re-derive consonance from the layer-B verdict, but only ESCALATE
    // (never downgrade — chord-relative stays as ceiling for "is it a
    // chord tone" judgement).
    if (layerBGravity >= 0.85) {
      // Very high tension (avoid-class or leading-tone) — escalate to
      // 'avoid' if Layer B function is Tension; 'tension' otherwise.
      consonance = layerBRule?.function === 'Tension' ? 'avoid' : 'tension';
    } else if (layerBGravity >= 0.5) {
      if (consonance === 'consonant' || consonance === 'colortone') {
        consonance = 'tension';
      }
    }
    // Stash Layer B targets so resolutionTargets union sees them later.
  }
  // Always make Layer B targets available downstream (even when Layer A
  // dominated — anchor-scoring soft cross-chord bonus reads them too).
  const mergedLayerTargets: number[] = [];
  if (tendencyTargets !== null) {
    for (const offset of tendencyTargets) mergedLayerTargets.push(((rpc + offset) % 12 + 12) % 12);
  }
  for (const pc of layerBTargetsAbs) mergedLayerTargets.push(pc);

  // Style-aware avoid-note rule overrides — mode-aware exemptions
  // (modal characteristic notes get a pass even when the table flags
  // them as avoid). Only escalate to 'avoid' here; never downgrade.
  if (consonance !== 'avoid'
      && isAvoidNote(pcFromChord, chordType, scaleNameForBar, isModalContext ?? false, effectiveFunc)) {
    consonance = 'avoid';
  }

  // --- scale awareness (when localScalePcs provided) ---
  // The runScale defines the bar's currently-legal pitch pool —
  // including borrowed scales like Phrygian Dominant / Lydian Dominant
  // / Altered that the engine swaps in on secondary dominants. Without
  // this consultation, evaluator would judge those chords' chord-3rd
  // (e.g. C♯ on A7 / V/ii in C major) using ONLY chord-relative
  // (consonant ✓) but miss that C♯ is also a member of A Phrygian
  // Dominant — confirming it as a legitimate landing tone — and would
  // misjudge B♭ (b9 of A7 = legal in Phrygian Dominant) versus G♯
  // (not in any V/ii borrowed scale) the same way.
  //
  // Rule: in-scale pcs cannot be 'avoid'; out-of-scale pcs cannot be
  // 'consonant' (force at least 'tension'). Chord-context still wins
  // when stricter — an in-scale dom-7 b7 stays 'tension', not relaxed
  // to consonant.
  //
  // Under MODAL tonalCharacter, the scale's role is structurally
  // elevated: in-scale notes are not just "legal color" but the
  // genre's identity (blues b3/b7, Dorian's M6, Phrygian's b2). So
  // we further upgrade in-scale 'tension' to 'colortone' — these
  // notes don't demand resolution; they ARE the music.
  if (localScalePcs !== undefined && localScalePcs.size > 0) {
    const inScale = localScalePcs.has(npc);
    if (inScale) {
      if (consonance === 'avoid') consonance = 'colortone';
      if (tonalCharacter === 'modal' && consonance === 'tension') consonance = 'colortone';
    } else {
      if (consonance === 'consonant' || consonance === 'colortone') consonance = 'tension';
    }
  }

  // --- urgency ---
  // When tendency table fired (scenario resolved), urgency = tendency.gravity
  // verbatim — the table already encodes all the chord-context judgement.
  // When fallback fired, derive from consonance + chord tensionLevel + TSD
  // as before. In either case, modal tonalCharacter halves urgency at the
  // end so blues b3/b7 etc. drop below the hard-constraint threshold.
  let urgency: number;
  if (tendencyGravity !== null) {
    urgency = tendencyGravity;
  } else {
    switch (consonance) {
      case 'consonant':
        urgency = 0;
        break;
      case 'colortone':
        urgency = 0.15;
        break;
      case 'tension':
        urgency = Math.min(1, 0.5
          + chordTensionLevel * 0.3
          + (effectiveFunc === 'D' ? 0.2 : effectiveFunc === 'T' ? 0.1 : 0));
        break;
      case 'avoid':
        urgency = 1.0;
        break;
    }
  }
  // Modal songs relax resolution pressure — tensions become long-form
  // scale color rather than imperative pulls. Halving drops typical
  // chord-7 / leading-tone urgency below the unified-tension-resolution
  // threshold (0.5) so blues b7 etc. may hang.
  if (tonalCharacter === 'modal' && urgency > 0) {
    urgency = Math.min(1, urgency * 0.5);
  }

  // --- resolution targets (priority blend) ---
  // 1. TENDENCY_TABLE targets (when scenario resolved) — the most
  //    chord-context-precise targets, converted from chord-relative
  //    offsets to absolute pcs.
  // 2. Same-chord literal anchors (root/3/5/7) — closest landings
  // 3. Next-chord 1/3/5 — anticipatory resolution (Harmonic Catch path)
  // 4. LOCAL-key INTERVAL_AESTHETICS.expectedResolutions — backstop,
  //    sourced from the borrowed key when V-borrowing is active, else
  //    from the global key. This is the lookup that flips C♯-resolves-
  //    to-D under V/ii instead of C♯-resolves-to-C.
  const targets = new Set<number>();
  // mergedLayerTargets contains both TENDENCY_TABLE (Layer A) and
  // INTERVAL_AESTHETICS[mode] (Layer B) targets at absolute pcs.
  for (const pc of mergedLayerTargets) targets.add(pc);
  // Chord literal anchors as near-targets.
  for (const iv of literalIntervals) targets.add(((rpc + iv) % 12 + 12) % 12);
  // Next-chord 1/3/5 as anticipatory landing.
  for (const pc of nextAnchorPcs) targets.add(pc);
  targets.delete(npc);  // landing on self is not a resolution

  return {
    consonance,
    urgency,
    resolutionTargets: Array.from(targets),
    isInChordContract,
    isInChordExtension,
    isInNextChordAnchor,
  };
}

