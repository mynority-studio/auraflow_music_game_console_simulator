// ============================================================
// cadence.ts — Cadence tier / phrase / tonic strength / DURATION_VALUES
// ============================================================
// Phase 6.1 拆分自 mg-engine/musicTheory.ts(L4025-4271)。
// ============================================================

import { getChordBackboneIntervals } from './chord-types';
import { computeGlobalContract } from './chord-color';

export type CadenceTier = 'A_global_T' | 'B_phrase_T' | 'C_phrase_DS' | 'none';

/**
 * Per-bar phrase role from detectPhrases + Period 识别。驱动 Cadence
 * Tier 选择,替代旧的"每 motifInterval bar 一次"硬切。
 *
 *   song_end           — 整曲最后一 bar
 *   antecedent_end     — Period 的 antecedent 末尾 (问号, force C)
 *   consequent_end     — Period 的 consequent 末尾 (句号, B 或 C 按 func)
 *   phrase_end_through — ThroughComposed phrase 末尾 (按 func 默认逻辑)
 *   mid_phrase         — phrase 内部 (无 cadence)
 */
export type PhraseRole = 'song_end' | 'antecedent_end' | 'consequent_end'
                       | 'phrase_end_through' | 'mid_phrase';

export function classifyCadenceTier(opts: {
  isGlobalEnd: boolean;
  isPhraseEndNote: boolean;
  func: 'T' | 'S' | 'D';
  isLastChordT: boolean;
  /** 当传入时,phraseRole 优先于默认 isPhraseEndNote/isGlobalEnd 逻辑。
   * Period antecedent 强制 Tier C (问号 / preserve-tension),
   * consequent + T 落 Tier B (句号 / 1-3-5 force),
   * song_end + T 落 Tier A (剧终)。 */
  phraseRole?: PhraseRole;
}): CadenceTier {
  // phraseRole 驱动路径 (Phase 5 — Caplin period semantics)
  if (opts.phraseRole !== undefined) {
    switch (opts.phraseRole) {
      case 'mid_phrase': return 'none';
      case 'song_end':   return opts.func === 'T' ? 'A_global_T' : 'none';
      case 'antecedent_end': return 'C_phrase_DS';  // 强制问号
      case 'consequent_end': return opts.func === 'T' ? 'B_phrase_T' : 'C_phrase_DS';
      case 'phrase_end_through': /* fall through to default */ break;
    }
  }
  // 默认路径 (无 phraseRole 时 — 兼容外部调用 + ThroughComposed phrase-end)
  if (!opts.isPhraseEndNote) return 'none';
  if (opts.isGlobalEnd && opts.isLastChordT) return 'A_global_T';
  if (opts.func === 'T') return 'B_phrase_T';
  return 'C_phrase_DS';
}

export function cadenceTargetPcs(
  tier: CadenceTier,
  chordType: string,
  chordRootPc: number,
  opts: { keyRootPc: number; keyIsMinor: boolean }
): { pcs: Set<number>; mode: 'force' | 'preserve-tension' } {
  if (tier === 'A_global_T') {
    const keyThird = opts.keyIsMinor ? 3 : 4;
    const keyRoot = ((opts.keyRootPc % 12) + 12) % 12;
    return {
      pcs: new Set([keyRoot, ((keyRoot + keyThird) % 12 + 12) % 12]),
      mode: 'force',
    };
  }
  if (tier === 'B_phrase_T') {
    const backbone = getChordBackboneIntervals(chordType);
    const rootPc = ((chordRootPc % 12) + 12) % 12;
    return {
      pcs: new Set(backbone.map((i) => (((rootPc + i) % 12) + 12) % 12)),
      mode: 'force',
    };
  }
  if (tier === 'C_phrase_DS') {
    return {
      pcs: computeGlobalContract(chordType, chordRootPc).pcs,
      mode: 'preserve-tension',
    };
  }
  return { pcs: new Set<number>(), mode: 'preserve-tension' };
}

// ------------------------------------------------------------------
// Tonic strength classification for Period antecedent/consequent
// detection.
//
// Caplin 1998 "Classical Form" 区分:
//   strong T  — I / i (root position tonic). Period consequent 必落
//               strong T (闭合,句号感).
//   weak T    — iii / vi (mediant / submediant 替代). Period antecedent
//               可落 weak T (开放,逗号感) — 听觉上 "未到家"。
//   nonTonic  — S / D function chords.
//
// 边界情况:
//   - I/3, I/5 (转位)  → 仍归 strong (字面是 tonic chord)
//   - Imaj7 / i7      → strong (chord type 不影响根音强度)
//   - V/X (secondary)  → nonTonic (harmonicFunctionFromRoman → 'D')
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Phrase detection from harmonic flow.
//
// Phrase boundary 不是 bar 计数,是 TSD 循环闭合事件:经过 D 之后
// 落到 T,且下一个 chord 启动新 S/D 循环(或段尾)。Caplin 1998 把
// phrase 定义为以 cadence 收束的功能单元 — phrase length 由和声决
// 定,常见 4 / 8 bar 但 6 / 10 / 13 等不规则也合法。
//
// 例:IV-V-iii-vi-ii-V-I-I (8 bar)
//   S → D → T(弱) → T(过渡) → S → D → T → T
//   bar 4 落 vi (弱 T) 后,bar 5 又起 S = TSD 循环重启
//   ⇒ 切两段:bar 0-3 (antecedent, 开放) + bar 4-7 (consequent, 闭合)
//   ⇒ Period
//
// Period 识别:对称偶数长度 + 中点落 weak T 或 D (开放) + 末尾落
// strong T (闭合)。其他情况归 ThroughComposed (含短 phrase / 不对称 /
// 单 TSD 循环)。
// ------------------------------------------------------------------

export type PhraseType = 'Period' | 'ThroughComposed';

export interface PhraseSegment {
  startBar: number;
  endBar: number;
  type: PhraseType;
  /** 仅 Period 类型有值;= startBar + length/2 - 1 */
  antecedentEndBar?: number;
}

// 结构类型 — 仅需 roman + effectiveFunc。避免引入 musicEngine 依赖。
interface ChordLikeForPhrase {
  roman: string;
  effectiveFunc?: 'T' | 'S' | 'D';
}

// 跟 musicEngine.harmonicFunctionFromRoman 同语义,但 musicTheory 不
// 应反向导入 — 这里独立实现一遍。两处一致性由 phrase 单测保护。
function harmonicFunctionFromRomanLocal(roman: string): 'T' | 'S' | 'D' {
  const base = roman.split('/')[0]
      .replace(/maj7|maj9|maj13|m7|m9|m11|sus4|7sus4|9sus4|7b13|7\#9|7alt|dim|aug|\+|o|ø|[0-9]/g, '');
  if (['V', 'v', 'vii', 'VII'].includes(base) || roman.includes('/')) return 'D';
  if (['IV', 'iv', 'ii', 'II', 'bVI', 'bVII'].includes(base)) return 'S';
  return 'T';
}

const funcOf = (c: ChordLikeForPhrase): 'T' | 'S' | 'D' =>
    c.effectiveFunc ?? harmonicFunctionFromRomanLocal(c.roman);

/**
 * 扫描和弦进行的强终止点 (strong cadence),产出 PhraseSegment[]。
 *
 * Phrase 边界规则 (D→strong T):
 *  - 当前 chord 是 strong T (I / i / I7 etc.,排除 iii/vi 等 weak T)
 *  - 此前经过 D-function chord (i.e. 这是一个 authentic cadence)
 *  - 下一个 chord 是 S/D (新循环) 或已是段尾
 *  → 切 phrase 边界。
 *
 * 弱终止 (D→weak T 如 V→vi deceptive) 不切外层 phrase,而是
 * 在 classifyPhrase 中作为 Period antecedent 的内部 cadence 识别。
 *
 * 段尾强制切边 (即使没经过 D),避免悬空。
 */
export function detectPhrases<T extends ChordLikeForPhrase>(chords: T[]): PhraseSegment[] {
  if (chords.length === 0) return [];
  const segments: PhraseSegment[] = [];
  let start = 0;
  let seenD = false;
  for (let i = 0; i < chords.length; i++) {
    const f = funcOf(chords[i]);
    if (f === 'D') seenD = true;
    const isLast = i === chords.length - 1;
    const nextF: 'T' | 'S' | 'D' | null = isLast ? null : funcOf(chords[i + 1]);
    const restart = nextF === 'S' || nextF === 'D';
    const strongTHere = f === 'T' && tonicStrength(chords[i].roman) === 'strong';
    const isStrongCadence = seenD && strongTHere && (restart || isLast);
    if (isStrongCadence || isLast) {
      segments.push(classifyPhrase({ startBar: start, endBar: i }, chords));
      start = i + 1;
      seenD = false;
    }
  }
  return segments;
}

function classifyPhrase<T extends ChordLikeForPhrase>(
  raw: { startBar: number; endBar: number },
  chords: T[],
): PhraseSegment {
  const len = raw.endBar - raw.startBar + 1;
  // Period 必要条件:对称偶数长度 ≥ 4,中点 open,末尾 closed strong T。
  if (len >= 4 && len % 2 === 0) {
    const mid = raw.startBar + len / 2 - 1;
    const midC = chords[mid];
    const lastC = chords[raw.endBar];
    const midF = funcOf(midC);
    const lastF = funcOf(lastC);
    const midOpen = midF === 'D' || (midF === 'T' && tonicStrength(midC.roman) === 'weak');
    const lastClosed = lastF === 'T' && tonicStrength(lastC.roman) === 'strong';
    if (midOpen && lastClosed) {
      return { ...raw, type: 'Period', antecedentEndBar: mid };
    }
  }
  return { ...raw, type: 'ThroughComposed' };
}

export type TonicStrength = 'strong' | 'weak' | 'nonTonic';

export function tonicStrength(roman: string): TonicStrength {
  if (!roman) return 'nonTonic';
  // 同 harmonicFunctionFromRoman 的 base 抽取:剥掉 slash 段 + 类型后缀
  // + 数字。保留大小写以区分大调/小调级数。
  const base = roman.split('/')[0]
      .replace(/maj7|maj9|maj13|m7|m9|m11|sus4|7sus4|9sus4|7b13|7\#9|7alt|dim|aug|\+|o|ø|[0-9]/g, '');
  if (base === 'I' || base === 'i') return 'strong';
  if (base === 'iii' || base === 'III' || base === 'vi' || base === 'VI'
      || base === 'bIII' || base === 'bVI') return 'weak';
  return 'nonTonic';
}

// Snap a MIDI pitch to the nearest scale tone whose pitch class is in
// targetPcs. Searches across the runScale (which already encodes the
// chord-aware octave coverage) so the result respects the active scale
// AND the cadence target. Falls back to mNoteMidi unchanged when no
// candidate is found (defensive — should not happen with non-empty pcs).

export function snapMidiToNearestPc(mNoteMidi: number, targetPcs: Set<number>, runScale: number[]): number {
  if (targetPcs.size === 0 || runScale.length === 0) return mNoteMidi;
  let best = mNoteMidi;
  let bestDist = Infinity;
  for (const sm of runScale) {
    const pc = (((sm % 12) + 12) % 12);
    if (!targetPcs.has(pc)) continue;
    const d = Math.abs(sm - mNoteMidi);
    if (d < bestDist) { bestDist = d; best = sm; }
  }
  return bestDist === Infinity ? mNoteMidi : best;
}

// ------------------------------------------------------------------
// Note duration values (beats per duration name). Reference table for
// a future ornament / rhythm naming layer.
// ------------------------------------------------------------------

export const DURATION_VALUES = {
    'Whole': 4,
    'Half': 2,
    'Dotted Half': 3,
    'Quarter': 1,
    'Dotted Quarter': 1.5,
    'Eighth': 0.5,
    'Dotted Eighth': 0.75,
    'Sixteenth': 0.25,
    'Triplet Quarter': 2/3,
    'Triplet Eighth': 1/3,
    'Triplet Sixteenth': 1/6
};
