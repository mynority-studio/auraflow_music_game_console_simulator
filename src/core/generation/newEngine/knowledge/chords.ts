// ============================================================
// newEngine · knowledge · ChordLibrary(B-port 乐理事实)
// ------------------------------------------------------------
// 架构定稿 Part 4 / KB 移植计划 §2:和弦音 = 相对根音的半音程集合(纯乐理事实)。
//   兼容层:narrow ChordQuality(7 种,harmony 实际产出,原有调用不动)。
//   完整 ChordLibrary:46 种宽和弦(port 自 melodygenerative CHORD_TYPES,逐值忠实;
//     张力音保 compound 高位 14/18/20/21,不折成 2 防摩擦)+ 别名归一化。
// ============================================================

import { mod12, type PitchClass } from '../foundation';

export type ChordQuality = 'maj' | 'min' | 'maj7' | 'm7' | '7' | 'm7b5' | 'dim7';

// 和弦音相对根音的半音程
const CHORD_TONE_INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  '7': [0, 4, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
};

export function chordToneIntervals(quality: ChordQuality): number[] {
  const t = CHORD_TONE_INTERVALS[quality];
  if (!t) throw new RangeError(`chordToneIntervals(): 未知 quality "${quality}"`);
  return t.slice();
}

/** 某根音 + 品质的全部和弦音(pc)。 */
export function chordTones(rootPc: PitchClass, quality: ChordQuality): PitchClass[] {
  return chordToneIntervals(quality).map((iv) => mod12(rootPc + iv));
}

// —— 完整 ChordLibrary(KB 移植 §2)——

// 相对根音的半音程(张力音保 compound 高位:9=14,#11=18,b13=20,13=21)。
// port 自 melodygenerative/src/lib/musicTheory.ts CHORD_TYPES,逐值忠实。
const CHORD_TYPES = {
  'maj': [0, 4, 7], 'min': [0, 3, 7], 'dim': [0, 3, 6], 'aug': [0, 4, 8],
  'maj7': [0, 4, 7, 11], 'm7': [0, 3, 7, 10], '7': [0, 4, 7, 10], 'm7b5': [0, 3, 6, 10], 'dim7': [0, 3, 6, 9],
  'add9': [0, 4, 7, 14], 'm9': [0, 3, 7, 10, 14], 'maj9': [0, 4, 7, 11, 14], '9': [0, 4, 7, 10, 14],
  'sus4': [0, 5, 7], '7sus4': [0, 5, 7, 10], '9sus4': [0, 5, 7, 10, 14], '13sus4': [0, 5, 7, 10, 14, 21],
  '7b13': [0, 4, 7, 10, 20], '13': [0, 4, 7, 10, 14, 21], '7#9': [0, 4, 7, 10, 15], '7alt': [0, 4, 10, 13, 15, 20],
  'm11': [0, 3, 7, 10, 14, 17], 'maj13': [0, 4, 7, 11, 14, 21], '6': [0, 4, 7, 9], '6/9': [0, 4, 7, 9, 14],
  '11': [0, 5, 7, 10, 14], '13b9': [0, 4, 7, 10, 13, 21], '7#11': [0, 4, 7, 10, 18], 'm9b5': [0, 3, 6, 10, 14],
  'm7sus4': [0, 5, 7, 10], '7#5': [0, 4, 8, 10], 'maj7#11': [0, 4, 7, 11, 18], '7b9': [0, 4, 7, 10, 13],
  'maj9#11': [0, 4, 7, 11, 14, 18],
  'sus2': [0, 2, 7], '5': [0, 7], '7b5': [0, 4, 6, 10], '9#5': [0, 4, 8, 10, 14], '9#11': [0, 4, 7, 10, 14, 18],
  '13#11': [0, 4, 7, 10, 14, 18, 21], '7#9#11': [0, 4, 7, 10, 15, 18], 'mMaj9': [0, 3, 7, 11, 14],
  'm13': [0, 3, 7, 10, 14, 21], 'm6/9': [0, 3, 7, 9, 14], 'quartal': [0, 5, 10, 15], 'madd9': [0, 3, 7, 14],
} satisfies Record<string, readonly number[]>;

export type ChordTypeId = keyof typeof CHORD_TYPES;

// 输入字符串别名 → 规范和弦类型。port 自 CHORD_TYPE_ALIASES,逐值忠实。
const CHORD_TYPE_ALIASES: Record<ChordTypeId, readonly string[]> = {
  'maj': ['M', '^', 'maj', 'major'], 'min': ['m', 'min', '-', 'minor'], 'dim': ['dim', 'o', '°', 'diminished'], 'aug': ['aug', '+', 'augmented'],
  'maj7': ['maj7', 'Maj7', 'M7', '^7', 'Δ', 'Δ7', 'ma7', 'major seventh'], 'm7': ['m7', 'min7', 'mi7', '-7', 'minor seventh'], '7': ['7', 'dom7', 'dominant seventh'],
  'm7b5': ['m7b5', 'ø', 'ø7', 'min7b5', 'half-diminished', 'm7(b5)'], 'dim7': ['dim7', 'o7', '°7', 'fully diminished'],
  'add9': ['add9', 'add2', 'Madd9', 'majadd9'], 'm9': ['m9', 'min9', '-9', 'minor ninth'], 'maj9': ['maj9', 'Maj9', 'M9', 'Δ9', '^9', 'major ninth'], '9': ['9', 'dom9', 'dominant ninth'],
  'sus4': ['sus4', 'sus', '4'], '7sus4': ['7sus4', '7sus'], '9sus4': ['9sus4', '9sus'], '13sus4': ['13sus4'],
  '7b13': ['7b13', '7(b13)'], '13': ['13', 'dom13'], '7#9': ['7#9', '7(#9)', 'Hendrix'], '7alt': ['7alt', 'alt', '7altered'],
  'm11': ['m11', 'min11', '-11', 'minor eleventh'], 'maj13': ['maj13', 'Maj13', 'M13', 'Δ13', '^13', 'major thirteenth'], '6': ['6', 'M6', 'add6', 'major sixth'], '6/9': ['6/9', '69', '6add9', 'M6/9', 'M69'],
  '11': ['11', 'dom11'], '13b9': ['13b9', '13(b9)'], '7#11': ['7#11', '7(#11)'], 'm9b5': ['m9b5', 'min9b5', 'm9(b5)'],
  'm7sus4': ['m7sus4', 'msus7'], '7#5': ['7#5', '7(#5)', '7+5'], 'maj7#11': ['maj7#11', 'M7#11', '^7#11', 'Δ#11', 'maj7(#11)'], '7b9': ['7b9', '7(b9)'], 'maj9#11': ['maj9#11', 'M9#11', '^9#11'],
  'sus2': ['sus2', '2'], '5': ['5', 'power', 'powerchord'], '7b5': ['7b5', '7(b5)'], '9#5': ['9#5', '9+5', '9(#5)'], '9#11': ['9#11', '9(#11)', '9+11'],
  '13#11': ['13#11', '13(#11)'], '7#9#11': ['7#9#11', '7(#9#11)', '7#9b5', '7#11#9'], 'mMaj9': ['mMaj9', 'mM9', '-Δ9', '-maj9'], 'm13': ['m13', 'min13', '-13', 'minor thirteenth'], 'm6/9': ['m6/9', 'm69', 'min6/9'],
  'quartal': ['quartal', '4', 'q4'], 'madd9': ['madd9', 'min(add9)', 'm(add9)', 'minor add9'],
};

const ALIAS_TO_CANONICAL: Record<string, ChordTypeId> = (() => {
  const m: Record<string, ChordTypeId> = {};
  for (const canonical of Object.keys(CHORD_TYPE_ALIASES) as ChordTypeId[]) for (const a of CHORD_TYPE_ALIASES[canonical]) m[a] = canonical;
  return m;
})();

/** 别名字符串 → 规范和弦类型;无法识别 → null。大小写敏感(M7≠m7)。 */
export function normalizeChordType(input: string): ChordTypeId | null {
  const trimmed = input.trim();
  if (trimmed in ALIAS_TO_CANONICAL) return ALIAS_TO_CANONICAL[trimmed];
  if (/^M(\d|$)/.test(trimmed)) return null; // M<digit> 不可降级(否则 M7→m7 误路由)
  return ALIAS_TO_CANONICAL[trimmed.toLowerCase()] ?? null;
}

export interface ChordTypeDefinition {
  id: ChordTypeId;
  intervals: readonly number[]; // 相对根音半音(张力保 compound 高位)
}

export function getChordType(id: ChordTypeId): ChordTypeDefinition {
  const intervals = CHORD_TYPES[id];
  if (!intervals) throw new RangeError(`getChordType(): 未知和弦类型 "${id}"`);
  return { id, intervals };
}

/** 某根音 + 宽和弦类型 → pc 集合(compound 折成 pc)。 */
export function getChordPitchClasses(rootPc: PitchClass, chordType: ChordTypeId): PitchClass[] {
  return CHORD_TYPES[chordType].map((iv) => mod12(rootPc + iv));
}

export function listChordTypes(): readonly ChordTypeId[] {
  return Object.keys(CHORD_TYPES) as ChordTypeId[];
}

/** 按任意 chordType 字符串取相对根音半音(含 compound 张力);未知 → 大三和弦兜底 [0,4,7]。 */
export function chordTypeIntervals(chordType: string): readonly number[] {
  return (CHORD_TYPES as Record<string, readonly number[]>)[chordType] ?? [0, 4, 7];
}

/** chordType 是否在宽和弦表内(用于区分宽类型 vs 窄三和弦 'maj'/'min')。 */
export function isKnownChordType(chordType: string): boolean {
  return chordType in CHORD_TYPES;
}

// ============================================================
// ★ MG 风格和弦词汇对齐(用户:全部对齐 MG)。审计发现我们的和弦比 MG 系统性更延伸,尤其
//   POP(MG 是 min/maj 三和弦为主 + add9/7/7sus4 色彩,我们全是 m7/m9/maj9)。按【家族分类器】把
//   过度延伸映射到该 style 的 MG 主流类型,propagate 到张力/chord-scale/voicing(都读 chordType)。
//   LOFI 已贴 MG(延伸)→ 不动;JAZZ/RNB 轻削最非 MG 的(7alt/7#5 → 7b13)。确定性、纯函数。
// ============================================================
type AlignResult = { chordType: string; quality: ChordQuality };

/** POP:折回三和弦纯度。保留 {maj/min/add9/madd9/7/7sus4/sus2/sus4/m7b5/dim7/5};其余按家族折。 */
function alignPop(ct: string): AlignResult {
  if (ct === 'm7b5' || ct === 'm9b5') return { chordType: 'm7b5', quality: 'm7b5' };
  if (ct === 'dim' || ct === 'dim7') return { chordType: 'dim7', quality: 'dim7' };
  if (/sus/.test(ct)) {                                  // sus 家族
    const dom = /^(7|9|11|13)/.test(ct);
    return ct.includes('sus2') ? { chordType: 'sus2', quality: 'maj' } : { chordType: dom ? '7sus4' : 'sus4', quality: dom ? '7' : 'maj' };
  }
  if (ct === 'add9' || ct === 'madd9') return { chordType: ct, quality: ct === 'madd9' ? 'min' : 'maj' };
  if (ct === '6' || ct === '6/9') return { chordType: 'add9', quality: 'maj' };        // 6/9 → add9(三和弦底 + 色彩)
  if (ct === 'm6/9' || ct === 'm6') return { chordType: 'madd9', quality: 'min' };
  if (/^m(?!aj)/.test(ct)) return { chordType: 'min', quality: 'min' };                // 小调家族(m7/m9/m11/m13/mMaj9…)→ min
  if (/^maj/.test(ct)) return { chordType: 'maj', quality: 'maj' };                    // 大调家族(maj7/maj9/maj13…)→ maj
  if (/^(7|9|11|13)/.test(ct)) return { chordType: '7', quality: '7' };                // 属家族(含 7alt/7b9/7#9…)→ 7
  if (ct === 'min' || ct === '5' || ct === 'quartal') return { chordType: ct === 'min' ? 'min' : ct === '5' ? '5' : 'maj', quality: ct === 'min' ? 'min' : 'maj' };
  return { chordType: 'maj', quality: 'maj' };           // maj / 兜底
}

/** JAZZ/RNB:已基本贴 MG(延伸),只把最非 MG 的 altered 收成 7b13(MG 用 7b13/7#11 而非 7alt/7#5)。 */
function alignJazzRnb(ct: string, q: ChordQuality): AlignResult {
  if (ct === '7alt' || ct === '7#5' || ct === '9#5' || ct === '7#9#11') return { chordType: '7b13', quality: '7' };
  return { chordType: ct, quality: q };
}

/** 按 style 把和弦类型对齐 MG 主流词汇。LOFI/BLUES/未知 → 原样。 */
export function alignChordTypeToMgStyle(chordType: string, quality: ChordQuality, style: string): AlignResult {
  switch (style.toUpperCase()) {
    case 'POP': return alignPop(chordType);
    case 'JAZZ': case 'RNB': return alignJazzRnb(chordType, quality);
    default: return { chordType, quality };
  }
}
