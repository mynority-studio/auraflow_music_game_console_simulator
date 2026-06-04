// ============================================================
// newEngine · knowledge · ChordIntervalRoles(和弦内音程角色,B-port 乐理事实)
// ------------------------------------------------------------
// Provenance:port 自 melodygenerative/src/lib/musicTheory.ts(CHORD_VOICING_AESTHETICS)。
//   按【和弦品质族】逐音程(相对根音 pc)给角色:
//     CHORD_TONE(骨干) · AVAILABLE_TENSION(可用张力 9/13…可加色) ·
//     ALTERED_TENSION(改变张力,属和弦专属) · AVOID_NOTE(避免)。
//   每项带 tensionLevel(0..1)+ registerHint(low/mid/high/flex)。
// 用途:voicer 参考它给 comp 加可用张力出彩色 voicing;melody/audit 参考它判音的色彩角色。
// 纯乐理事实。比 tensionModel(stable/acceptable/avoid 三分)多了 altered + 力度 + 音区提示。
// ============================================================

import { mod12, type PitchClass } from '../foundation';
import type { ChordQuality } from './chords';

export type NoteFunctionRole = 'CHORD_TONE' | 'AVAILABLE_TENSION' | 'ALTERED_TENSION' | 'AVOID_NOTE';
export type RegisterHint = 'low' | 'mid' | 'high' | 'flex';

export interface ChordIntervalAesthetic {
  role: NoteFunctionRole;
  tensionLevel: number;     // 0..1
  register: RegisterHint;
}

type Fam = 'maj' | 'min' | 'dom' | 'm7b5' | 'sus';

// 逐音程(0..11,相对根音)→ [role, tensionLevel, register]。port 自 CHORD_VOICING_AESTHETICS,逐值忠实。
const C = (r: NoteFunctionRole, t: number, reg: RegisterHint): ChordIntervalAesthetic => ({ role: r, tensionLevel: t, register: reg });

const TABLE: Record<Fam, readonly ChordIntervalAesthetic[]> = {
  maj: [C('CHORD_TONE', 0.0, 'flex'), C('AVOID_NOTE', 1.0, 'flex'), C('AVAILABLE_TENSION', 0.3, 'high'), C('AVOID_NOTE', 0.9, 'flex'), C('CHORD_TONE', 0.1, 'low'), C('AVOID_NOTE', 0.85, 'flex'), C('AVAILABLE_TENSION', 0.6, 'high'), C('CHORD_TONE', 0.05, 'mid'), C('AVOID_NOTE', 0.85, 'flex'), C('AVAILABLE_TENSION', 0.4, 'high'), C('AVOID_NOTE', 0.75, 'flex'), C('CHORD_TONE', 0.2, 'low')],
  min: [C('CHORD_TONE', 0.0, 'flex'), C('AVOID_NOTE', 0.9, 'flex'), C('AVAILABLE_TENSION', 0.35, 'high'), C('CHORD_TONE', 0.1, 'low'), C('AVOID_NOTE', 0.95, 'flex'), C('AVAILABLE_TENSION', 0.4, 'high'), C('AVOID_NOTE', 0.8, 'flex'), C('CHORD_TONE', 0.05, 'mid'), C('AVOID_NOTE', 0.75, 'flex'), C('AVAILABLE_TENSION', 0.5, 'high'), C('CHORD_TONE', 0.2, 'low'), C('AVAILABLE_TENSION', 0.65, 'low')],
  dom: [C('CHORD_TONE', 0.0, 'flex'), C('ALTERED_TENSION', 0.8, 'high'), C('AVAILABLE_TENSION', 0.4, 'high'), C('ALTERED_TENSION', 0.85, 'high'), C('CHORD_TONE', 0.1, 'low'), C('AVOID_NOTE', 0.95, 'flex'), C('ALTERED_TENSION', 0.75, 'high'), C('CHORD_TONE', 0.1, 'mid'), C('ALTERED_TENSION', 0.8, 'high'), C('AVAILABLE_TENSION', 0.5, 'high'), C('CHORD_TONE', 0.15, 'low'), C('AVOID_NOTE', 1.0, 'flex')],
  m7b5: [C('CHORD_TONE', 0.0, 'flex'), C('AVAILABLE_TENSION', 0.7, 'high'), C('AVAILABLE_TENSION', 0.6, 'high'), C('CHORD_TONE', 0.1, 'low'), C('AVOID_NOTE', 1.0, 'flex'), C('AVAILABLE_TENSION', 0.5, 'high'), C('CHORD_TONE', 0.3, 'mid'), C('AVOID_NOTE', 0.9, 'flex'), C('AVAILABLE_TENSION', 0.6, 'high'), C('AVOID_NOTE', 0.8, 'flex'), C('CHORD_TONE', 0.1, 'low'), C('AVOID_NOTE', 1.0, 'flex')],
  sus: [C('CHORD_TONE', 0.0, 'flex'), C('ALTERED_TENSION', 0.7, 'high'), C('CHORD_TONE', 0.1, 'mid'), C('ALTERED_TENSION', 0.7, 'high'), C('AVOID_NOTE', 0.95, 'flex'), C('CHORD_TONE', 0.1, 'mid'), C('AVAILABLE_TENSION', 0.6, 'high'), C('CHORD_TONE', 0.1, 'mid'), C('ALTERED_TENSION', 0.7, 'high'), C('AVAILABLE_TENSION', 0.4, 'high'), C('CHORD_TONE', 0.1, 'low'), C('AVOID_NOTE', 0.9, 'flex')],
};

// 我方 ChordQuality → 品质族(dim7 复用 m7b5 表,同减族读法)
function familyOf(quality: ChordQuality): Fam {
  switch (quality) {
    case 'maj': case 'maj7': return 'maj';
    case 'min': case 'm7': return 'min';
    case '7': return 'dom';
    case 'm7b5': case 'dim7': return 'm7b5';
    default: return 'maj';
  }
}

/** 某品质下,相对根音 pc 的音程角色 + 力度 + 音区提示。 */
export function chordIntervalRole(quality: ChordQuality, intervalFromRoot: number): ChordIntervalAesthetic {
  return TABLE[familyOf(quality)][mod12(intervalFromRoot)];
}

/**
 * 从候选 pc(通常 colorToneMap)里挑【可用张力】出来给 voicer 加色:
 *   只取 AVAILABLE_TENSION,按 tensionLevel 升序(先 9 再 13 再 #11,温和优先),取前 count 个。
 * 返回绝对 pc[]。count<=0 或无可用 → []。
 */
export function pickColorTones(quality: ChordQuality, rootPc: PitchClass, candidatePcs: readonly number[], count: number): PitchClass[] {
  if (count <= 0) return [];
  return candidatePcs
    .map((pc) => ({ pc, a: chordIntervalRole(quality, mod12(pc - rootPc)) }))
    .filter((x) => x.a.role === 'AVAILABLE_TENSION')
    .sort((x, y) => x.a.tensionLevel - y.a.tensionLevel)
    .slice(0, count)
    .map((x) => mod12(x.pc));
}
