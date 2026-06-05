// ============================================================
// newEngine · knowledge · ProgressionLibrary(混:进行=事实 / 带权选取=new)
// ------------------------------------------------------------
// 架构定稿 Part 4 / 3.3:per-section-role 级数模板 + diatonic 品质推导。
// Engine 按 seed(rng 子流)从候选里选,绑定到当前 song(铁律22-23)。
// Slice 1 tonal:大调/自然小调自然 7 和弦。
// ============================================================

import type { Rng } from '../foundation';
import type { ChordQuality } from './chords';
import type { DiatonicMode } from './scales';

const MAJOR_DIATONIC_QUALITY: Record<number, ChordQuality> = {
  1: 'maj7', 2: 'm7', 3: 'm7', 4: 'maj7', 5: '7', 6: 'm7', 7: 'm7b5',
};
const MINOR_DIATONIC_QUALITY: Record<number, ChordQuality> = {
  1: 'm7', 2: 'm7b5', 3: 'maj7', 4: 'm7', 5: 'm7', 6: 'maj7', 7: '7',
};

/** 度数 → 自然 7 和弦品质(按调式)。 */
export function diatonicQuality(degree: number, mode: DiatonicMode): ChordQuality {
  const map = mode === 'minor' ? MINOR_DIATONIC_QUALITY : MAJOR_DIATONIC_QUALITY;
  const q = map[degree];
  if (!q) throw new RangeError(`diatonicQuality(): degree 须 1..7,得到 ${degree}`);
  return q;
}

export type SectionRole = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro';

// per-role 级数候选(degree 序列)
const ROLE_PROGRESSIONS: Record<SectionRole, readonly (readonly number[])[]> = {
  intro: [[1, 4]],
  verse: [[1, 6, 4, 5], [2, 5, 1, 6]],
  chorus: [[1, 5, 6, 4], [4, 5, 1, 1]],
  bridge: [[6, 4, 1, 5]],
  outro: [[4, 5, 1, 1]],
};

/** 按 rng 从该 role 的候选里选一条级数序列(确定性)。 */
export function pickProgressionDegrees(role: SectionRole, rng: Rng): number[] {
  const options = ROLE_PROGRESSIONS[role];
  if (!options) throw new RangeError(`pickProgressionDegrees(): 未知 role "${role}"`);
  return rng.pick(options).slice();
}

// ============================================================
// Progression Prototype Registry(harmony 迁移 Loop 1)
// ------------------------------------------------------------
// 忠实 port 自 melodygenerative styleDictionary.ts SECTION 2(PROGRESSION POOL):
//   ProgressionPrototype 接口 + modern POP/RNB/JAZZ/BLUES + LOFI 显式 prototype
//   + pickProgressionPrototype / fitProgressionToBars / listProgressionPrototypes。
// ★ 风格名/mode/sectionRoles 对齐 melodygenerative(POP/JAZZ/RNB/BLUES/LOFI · Major/Minor ·
//   含 ending/loop);消费层(HARMONY)做 band.style/SectionRole 适配。
// ★ 不迁 _legacyProgressionsAsPool()(plan:先迁 modern + LOFI explicit)。
// ★ rootOffset = 相对 key 的半音(非 pitch class);ChordSkeletonSlot 改名 ProgressionSlot。
// ============================================================

export type HarmonyStyleName = 'POP' | 'JAZZ' | 'RNB' | 'BLUES' | 'LOFI';
export type ProtoMode = 'Major' | 'Minor';
export type ProtoSectionRole = 'intro' | 'verse' | 'chorus' | 'bridge' | 'ending' | 'loop';
/** Berklee 5 分类:非自然音和弦来源(Planner 设置)。 */
export type BorrowedSource = 'secondary_dominant' | 'secondary_ii_v' | 'backdoor_dominant' | 'modal_interchange' | 'chromatic_color';
export type BassRole = 'root' | '3rd' | '5th' | '7th' | 'pedal';
export type TonicizationPlacement = 'light' | 'approach' | 'iiv_split' | 'full_2bar';

/** 进行模板的单和弦槽(= melodygenerative ChordSkeletonSlot)。type = 和弦类型串(对应 ChordTypeId)。 */
export interface ProgressionSlot {
  roman: string;
  type: string;
  scaleDegree: number;
  rootOffset: number;            // 相对 key 的半音
  bassRole?: BassRole;
  bassPedalPc?: number;          // bassRole='pedal' 时
  beats?: number;                // 默认整小节;两个 beats=2 拼成一小节(和声节奏 split)
  localTonalCenterPc?: number;
  forcedScale?: string;
  lockType?: boolean;            // true=Stage2 装饰不改 type
  borrowedFrom?: string;
  effectiveFunc?: 'T' | 'S' | 'D';
  borrowedSource?: BorrowedSource;
  mustResolve?: boolean;
  tonicizationPlacement?: TonicizationPlacement;
  analysisKeyPc?: number;
  localRoman?: string;
  // ★ JPOP ii-V 等模板依赖精确品质(m7b5/m7/7):preserveType 让该 slot 跳过 POP 风格三和弦折叠
  //   (alignChordTypeToMgStyle),保留作者品质到最终。窄用,不全局放松 POP 和声。
  preserveType?: boolean;
}

export interface ProgressionTransformPolicy {
  allowTonicization: boolean;
  maxTonicizePer16: number;
  allowBorrowed: boolean;
  maxBorrowedPer16: number;
  allowFullTwoFive: boolean;
  allowSubV: boolean;
  preferSusDominant: boolean;
}

export interface ProgressionPrototype {
  id: string;
  style: HarmonyStyleName;
  mode: ProtoMode;
  sectionRoles: ProtoSectionRole[];
  lengthBars: number;
  slots: ProgressionSlot[];
  weight?: number;
  subStyles?: string[];
  energy?: [number, number];
  density?: [number, number];
  cadence?: 'open' | 'weak' | 'loop' | 'modal' | 'soft_authentic';
  emotionTags?: ('warm' | 'sad' | 'dark' | 'float' | 'emo' | 'study' | 'nostalgic')[];
  transformPolicy?: ProgressionTransformPolicy;
}

type ProtoRandom = { next(): number };

/** roman → 级数(1..7)。 */
function romanScaleDegree(roman: string): number {
  const stripped = roman.replace(/^[b#n]+/, '').split('/')[0];
  const head = stripped.match(/^[IVivXx]+/)?.[0] ?? '';
  const map: Record<string, number> = { I: 1, i: 1, II: 2, ii: 2, III: 3, iii: 3, IV: 4, iv: 4, V: 5, v: 5, VI: 6, vi: 6, VII: 7, vii: 7 };
  return map[head] ?? 1;
}
function romanHead(roman: string): string {
  if (!roman) return '';
  return roman.replace(/^[b#n]+/, '').match(/^[IVivXx]+/)?.[0] ?? '';
}
/** slot 工厂:rootOffset 必填;lockType=true 默认(Stage2 保留作者 chord type)。 */
function ch(roman: string, type: string, rootOffset: number, extra: Partial<ProgressionSlot> = {}): ProgressionSlot {
  return { roman, type, rootOffset, scaleDegree: romanScaleDegree(roman), lockType: true, ...extra };
}

// LOFI 软 policy:不跑 tonicization / borrowed planner,色彩来自 prototype 自带。
const LOFI_NO_TRANSFORM: ProgressionTransformPolicy = {
  allowTonicization: false, maxTonicizePer16: 0, allowBorrowed: false, maxBorrowedPer16: 0,
  allowFullTwoFive: false, allowSubV: false, preferSusDominant: true,
};

// —— modern slot 模板 ——
const POP_CANON_8: ProgressionSlot[] = [ch('I', 'add9', 0), ch('V', '7sus4', 7, { bassRole: '3rd' }), ch('vi', 'm7', 9), ch('iii', 'm7', 4, { bassRole: '5th' }), ch('IV', 'add9', 5), ch('I', 'add9', 0, { bassRole: '3rd' }), ch('IV', 'add9', 5), ch('V', '7sus4', 7)];
const POP_4536251_8: ProgressionSlot[] = [ch('IV', 'maj9', 5), ch('V', '9sus4', 7), ch('iii', 'm7', 4), ch('vi', 'm7', 9), ch('ii', 'm7', 2), ch('V', '7sus4', 7), ch('I', 'maj9', 0), ch('I', '6/9', 0)];
const POP_4536251_SECONDARY_VI_8: ProgressionSlot[] = [ch('IV', 'maj9', 5), ch('V', '9sus4', 7), ch('III', '7b13', 4, { borrowedSource: 'secondary_dominant', mustResolve: true, borrowedFrom: 'V/vi' }), ch('vi', 'm9', 9), ch('ii', 'm7', 2), ch('V', '7sus4', 7), ch('I', 'maj9', 0), ch('I', '6/9', 0)];
const POP_LONG_1645_TO_4536251_16: ProgressionSlot[] = [ch('I', 'add9', 0), ch('V', '7sus4', 7), ch('vi', 'm7', 9), ch('IV', 'add9', 5), ch('I', 'add9', 0), ch('V/vi', '7b9', 4, { borrowedSource: 'secondary_dominant', mustResolve: true }), ch('vi', 'm9', 9), ch('IV', 'maj9', 5), ch('IV', 'maj9', 5), ch('V', '9sus4', 7), ch('iii', 'm7', 4), ch('vi', 'm7', 9), ch('ii', 'm7', 2), ch('V', '7b13', 7), ch('I', 'maj9', 0), ch('I', '6/9', 0)];
const POP_MINOR_IV_SIGH_8: ProgressionSlot[] = [ch('I', 'add9', 0), ch('IV', 'maj9', 5), ch('iv', 'm9', 5, { borrowedSource: 'modal_interchange', borrowedFrom: 'parallel minor iv' }), ch('I', 'add9', 0), ch('vi', 'm7', 9), ch('ii', 'm7', 2), ch('V', '7sus4', 7), ch('I', 'maj9', 0)];
const POP_EPIC_CADENCE_8: ProgressionSlot[] = [ch('IV', 'maj9', 5), ch('V', '9sus4', 7), ch('ii', 'm7', 2), ch('V', '7b13', 7), ch('bVI', 'maj9', 8, { borrowedSource: 'modal_interchange', borrowedFrom: 'parallel minor bVI' }), ch('bVII', 'add9', 10, { borrowedSource: 'modal_interchange', borrowedFrom: 'parallel minor bVII' }), ch('I', 'maj9', 0), ch('I', '6/9', 0)];
const MINOR_AEOLIAN_POP_8: ProgressionSlot[] = [ch('i', 'm9', 0), ch('VI', 'maj9', 8), ch('III', 'maj9', 3), ch('VII', 'add9', 10), ch('iv', 'm9', 5), ch('VII', '7sus4', 10), ch('III', 'maj9', 3), ch('V', '7b13', 7)];
const MINOR_MODAL_CADENCE_8: ProgressionSlot[] = [ch('i', 'm7', 0), ch('iv', 'm9', 5), ch('V/V', '9', 2, { borrowedSource: 'secondary_dominant', mustResolve: true }), ch('V', '7b13', 7), ch('bVII', 'add9', 10, { borrowedSource: 'modal_interchange', borrowedFrom: 'Aeolian modal cadence' }), ch('i', 'm9', 0), ch('iv', 'm7', 5), ch('V', '7b13', 7)];
const MINOR_DORIAN_LIFT_8: ProgressionSlot[] = [ch('i', 'm9', 0), ch('IV', '9', 5, { borrowedSource: 'modal_interchange', borrowedFrom: 'Dorian IV (raised 6)' }), ch('iv', 'm9', 5), ch('i', 'm9', 0), ch('VI', 'maj9', 8), ch('VII', 'add9', 10), ch('V', '7b13', 7), ch('i', 'm9', 0)];
const RNB_MINOR_NEO_SOUL_8: ProgressionSlot[] = [ch('i', 'm9', 0), ch('iv', 'm9', 5), ch('VII', '13sus4', 10), ch('III', 'maj9', 3), ch('VI', 'maj9', 8), ch('iv', 'm11', 5), ch('V', '7sus4', 7), ch('i', 'm9', 0)];
const RNB_MAJOR_COMMON_TONE_8: ProgressionSlot[] = [ch('I', 'maj9', 0), ch('vi', 'm9', 9), ch('ii', 'm9', 2), ch('V', '13sus4', 7), ch('IV', 'maj9', 5), ch('iv', 'm9', 5, { borrowedSource: 'modal_interchange', borrowedFrom: 'parallel minor iv' }), ch('I', 'maj9', 0), ch('VI', '7alt', 9, { borrowedSource: 'secondary_dominant', mustResolve: true, borrowedFrom: 'V/ii' })];
const RNB_BACKDOOR_8: ProgressionSlot[] = [ch('ii', 'm9', 2), ch('V', '13sus4', 7), ch('I', 'maj9', 0), ch('VI', '7#9', 9, { borrowedSource: 'secondary_dominant', mustResolve: true, borrowedFrom: 'V/ii' }), ch('iv', 'm9', 5, { borrowedSource: 'modal_interchange', borrowedFrom: 'parallel minor iv' }), ch('bVII', '13', 10, { borrowedSource: 'backdoor_dominant', mustResolve: true }), ch('I', 'maj9', 0), ch('I', '6/9', 0)];
const JAZZ_1625_8: ProgressionSlot[] = [ch('I', 'maj7', 0), ch('VI', '7alt', 9, { borrowedSource: 'secondary_dominant', mustResolve: true, borrowedFrom: 'V/ii' }), ch('ii', 'm9', 2), ch('V', '13', 7), ch('iii', 'm7', 4), ch('VI', '7alt', 9, { borrowedSource: 'secondary_dominant', mustResolve: true, borrowedFrom: 'V/ii' }), ch('ii', 'm9', 2), ch('V', '7b9', 7)];
const JAZZ_MINOR_251_8: ProgressionSlot[] = [ch('ii', 'm7b5', 2), ch('V', '7alt', 7), ch('i', 'm9', 0), ch('i', 'm9', 0), ch('iv', 'm9', 5), ch('VII', '13', 10), ch('III', 'maj9', 3), ch('VI', '7alt', 8)];
const BLUES_12BAR_DOMINANT: ProgressionSlot[] = [ch('I', '7', 0), ch('I', '7', 0), ch('I', '7', 0), ch('I', '7', 0), ch('IV', '7', 5), ch('IV', '7', 5), ch('I', '7', 0), ch('I', '7', 0), ch('V', '9', 7), ch('IV', '9', 5), ch('I', '7', 0), ch('V', '9', 7)];

// —— JPOP canon ii-V 替换(2026-06-06,follow melodygenerative HarmonyChangeLog)——
//   原 canon 的 vii / IV-向 由 bar-级 ii/X→V/X cell(2+2 拍)替换。离调借用内置(副属/二五)。
//   ii-V cell 用 preserveType 保精确品质(m7b5/m7/7,POP 折叠会毁掉爵士色彩);I/IV 主和弦 lockType:false
//   留给 Stage2 装饰【自由变体】(色彩可换 maj9/6-9 等)。32 拍 = 8 小节,beat-aware 扩 64。
//   forcedScale 给每个离调和弦显式局部音阶(含其和弦音 → 守"和弦音 ⊆ chord-scale"不变量):
//   ii/X=Locrian/Dorian·V/vi(→小调)=Phrygian Dominant·V/IV(→大调)=Mixolydian。melody 也据此解析。
// JPOP canon 变体策略:允许引擎在已实化和弦上叠加副属/二五离调(自由变体);I/IV 保 add9 j-pop 色彩(锁)。
const JPOP_VARIATION: ProgressionTransformPolicy = {
  allowTonicization: true, maxTonicizePer16: 2, allowBorrowed: true, maxBorrowedPer16: 1,
  allowFullTwoFive: true, allowSubV: false, preferSusDominant: false,
};
const POP_JPOP_CANON_251_BAR_REPLACE_8: ProgressionSlot[] = [
  ch('I', 'add9', 0),                                                                                                         // Cadd9 (4) 保 add9 色彩
  ch('ii/vi', 'm7b5', 11, { beats: 2, preserveType: true, borrowedSource: 'secondary_ii_v', borrowedFrom: 'ii/vi', forcedScale: 'Locrian' }),         // Bm7b5 (2)
  ch('V/vi', '7', 4, { beats: 2, preserveType: true, borrowedSource: 'secondary_dominant', mustResolve: true, borrowedFrom: 'V/vi', forcedScale: 'Phrygian Dominant' }), // E7 (2)
  ch('vi', 'm7', 9, { preserveType: true }),                                                                                  // Am7 (4)
  ch('ii/IV', 'm7', 7, { beats: 2, preserveType: true, borrowedSource: 'secondary_ii_v', borrowedFrom: 'ii/IV', forcedScale: 'Dorian' }),            // Gm7 (2)
  ch('V/IV', '7', 0, { beats: 2, preserveType: true, borrowedSource: 'secondary_dominant', mustResolve: true, borrowedFrom: 'V/IV', forcedScale: 'Mixolydian' }), // C7 (2)
  ch('IV', 'add9', 5),                                                                                                        // Fadd9 (4) 保 add9 色彩
  ch('V/vi', '7', 4, { beats: 2, preserveType: true, borrowedSource: 'secondary_dominant', mustResolve: true, borrowedFrom: 'V/vi', forcedScale: 'Phrygian Dominant' }), // E7 (2)
  ch('vi', 'm7', 9, { beats: 2, preserveType: true }),                                                                        // Am7 (2)
  ch('ii', 'm7', 2, { preserveType: true }),                                                                                  // Dm7 (4)
  ch('V', '7', 7, { preserveType: true }),                                                                                    // G7 (4)
];

// —— 联网补足(2026-06-05,web 研究:Wikipedia Rhythm Changes + 爵士标准)—— 给薄的 jazz 加 3 条权威进行 ——
// rhythm changes bridge:III7-VI7-II7-V7 五度循环属链(各 2 小节 → 2 slot)。
const JAZZ_RHYTHM_BRIDGE_8: ProgressionSlot[] = [
  ch('III', '13', 4, { borrowedSource: 'secondary_dominant', mustResolve: true }), ch('III', '13', 4, { borrowedSource: 'secondary_dominant', mustResolve: true }),
  ch('VI', '13', 9, { borrowedSource: 'secondary_dominant', mustResolve: true }), ch('VI', '13', 9, { borrowedSource: 'secondary_dominant', mustResolve: true }),
  ch('II', '9', 2, { borrowedSource: 'secondary_dominant', mustResolve: true }), ch('II', '9', 2, { borrowedSource: 'secondary_dominant', mustResolve: true }),
  ch('V', '13', 7), ch('V', '7b9', 7),
];
// Autumn Leaves A:ii-V-I(关系大调 bIII)+ ii-V-i(小调)—— 小调爵士标准。
const JAZZ_AUTUMN_LEAVES_8: ProgressionSlot[] = [
  ch('iv', 'm7', 5), ch('bVII', '7', 10, { borrowedSource: 'secondary_dominant', mustResolve: true }),
  ch('bIII', 'maj7', 3), ch('bVI', 'maj7', 8),
  ch('ii', 'm7b5', 2), ch('V', '7alt', 7), ch('i', 'm9', 0), ch('i', 'm9', 0),
];
// 爵士 12-bar blues:含 #IV 替代位的 VI7 副属 + ii-V turnaround(比 BLUES_12BAR 更爵士)。
const JAZZ_BLUES_12: ProgressionSlot[] = [
  ch('I', '9', 0), ch('IV', '9', 5), ch('I', '7', 0), ch('I', '7', 0),
  ch('IV', '9', 5), ch('IV', '9', 5), ch('I', '7', 0), ch('VI', '7#9', 9, { borrowedSource: 'secondary_dominant', mustResolve: true }),
  ch('ii', 'm9', 2), ch('V', '13', 7), ch('I', '9', 0), ch('VI', '7alt', 9, { borrowedSource: 'secondary_dominant', mustResolve: true }),
];

const _MODERN_PROGRESSION_PROTOTYPES: ProgressionPrototype[] = [
  { id: 'pop_canon_8', style: 'POP', mode: 'Major', sectionRoles: ['verse', 'chorus'], lengthBars: 8, slots: POP_CANON_8 },
  { id: 'pop_4536251_8', style: 'POP', mode: 'Major', sectionRoles: ['chorus', 'ending'], lengthBars: 8, slots: POP_4536251_8 },
  { id: 'pop_4536251_secvi_8', style: 'POP', mode: 'Major', sectionRoles: ['chorus', 'bridge'], lengthBars: 8, slots: POP_4536251_SECONDARY_VI_8 },
  { id: 'pop_long_1645_4536_16', style: 'POP', mode: 'Major', sectionRoles: ['verse', 'chorus'], lengthBars: 16, slots: POP_LONG_1645_TO_4536251_16 },
  { id: 'pop_minor_iv_sigh_8', style: 'POP', mode: 'Major', sectionRoles: ['verse', 'intro'], lengthBars: 8, slots: POP_MINOR_IV_SIGH_8 },
  { id: 'pop_epic_cadence_8', style: 'POP', mode: 'Major', sectionRoles: ['ending', 'bridge'], lengthBars: 8, slots: POP_EPIC_CADENCE_8 },
  // ★ JPOP canon ii-V(follow MG):weight=1.5 提高 POP 权重(canon 更常出,不独占);自由变体=transformPolicy 引擎叠加离调;离调借用=内置副属/二五。
  { id: 'pop_jpop_canon_251_bar_replace_8', style: 'POP', mode: 'Major', sectionRoles: ['verse', 'chorus'], lengthBars: 8, weight: 1.5, slots: POP_JPOP_CANON_251_BAR_REPLACE_8, transformPolicy: JPOP_VARIATION, subStyles: ['JPOP Canon', 'JPOP Piano'], emotionTags: ['nostalgic', 'emo'] },
  { id: 'pop_min_aeolian_8', style: 'POP', mode: 'Minor', sectionRoles: ['verse', 'chorus'], lengthBars: 8, slots: MINOR_AEOLIAN_POP_8 },
  { id: 'pop_min_modal_cad_8', style: 'POP', mode: 'Minor', sectionRoles: ['chorus', 'bridge'], lengthBars: 8, slots: MINOR_MODAL_CADENCE_8 },
  { id: 'pop_min_dorian_lift_8', style: 'POP', mode: 'Minor', sectionRoles: ['bridge', 'chorus'], lengthBars: 8, slots: MINOR_DORIAN_LIFT_8 },
  { id: 'rnb_min_neo_soul_8', style: 'RNB', mode: 'Minor', sectionRoles: ['verse', 'chorus'], lengthBars: 8, slots: RNB_MINOR_NEO_SOUL_8 },
  { id: 'rnb_maj_common_tone_8', style: 'RNB', mode: 'Major', sectionRoles: ['verse', 'chorus'], lengthBars: 8, slots: RNB_MAJOR_COMMON_TONE_8 },
  { id: 'rnb_backdoor_8', style: 'RNB', mode: 'Major', sectionRoles: ['chorus', 'ending'], lengthBars: 8, slots: RNB_BACKDOOR_8 },
  { id: 'jazz_1625_8', style: 'JAZZ', mode: 'Major', sectionRoles: ['verse', 'chorus'], lengthBars: 8, slots: JAZZ_1625_8 },
  { id: 'jazz_min_251_8', style: 'JAZZ', mode: 'Minor', sectionRoles: ['verse', 'chorus'], lengthBars: 8, slots: JAZZ_MINOR_251_8 },
  // —— 联网补足(2026-06-05):3 条权威 jazz 进行,jazz 从 2 → 5 ——
  { id: 'jazz_rhythm_bridge_8', style: 'JAZZ', mode: 'Major', sectionRoles: ['bridge'], lengthBars: 8, slots: JAZZ_RHYTHM_BRIDGE_8 },
  { id: 'jazz_autumn_leaves_8', style: 'JAZZ', mode: 'Minor', sectionRoles: ['verse', 'chorus'], lengthBars: 8, slots: JAZZ_AUTUMN_LEAVES_8 },
  { id: 'jazz_blues_12', style: 'JAZZ', mode: 'Major', sectionRoles: ['verse', 'chorus'], lengthBars: 12, slots: JAZZ_BLUES_12 },
  { id: 'blues_12bar_dom', style: 'BLUES', mode: 'Major', sectionRoles: ['verse', 'chorus', 'intro', 'ending'], lengthBars: 12, slots: BLUES_12BAR_DOMINANT, weight: 3 },
];

// —— LOFI slot 模板 ——
const LOFI_MAJOR_WARM_8: ProgressionSlot[] = [ch('I', 'maj9', 0), ch('vi', 'm9', 9), ch('ii', 'm9', 2), ch('V', '13sus4', 7), ch('I', 'maj9', 0), ch('vi', 'm9', 9), ch('IV', 'maj9', 5), ch('V', '9sus4', 7)];
const LOFI_EMO_SECONDARY_VI_8: ProgressionSlot[] = [ch('I', 'maj9', 0), ch('III', '7sus4', 4, { borrowedSource: 'secondary_dominant', borrowedFrom: 'soft V/vi', mustResolve: true }), ch('vi', 'm9', 9), ch('IV', 'maj9', 5), ch('I', 'maj9', 0), ch('III', '7', 4, { borrowedSource: 'secondary_dominant', borrowedFrom: 'V/vi', mustResolve: true }), ch('vi', 'm9', 9), ch('IV', 'add9', 5)];
const LOFI_DESCENDING_BASS_8: ProgressionSlot[] = [ch('I', 'maj9', 0), ch('V', '9sus4', 7, { bassRole: '3rd' }), ch('vi', 'm9', 9), ch('IV', 'maj9', 5), ch('I', '6/9', 0, { bassRole: '3rd' }), ch('IV', 'maj9', 5), ch('ii', 'm9', 2), ch('V', '9sus4', 7)];
const LOFI_SOFT_CANON_8: ProgressionSlot[] = [ch('I', 'add9', 0), ch('V', '7sus4', 7, { bassRole: '3rd' }), ch('vi', 'm7', 9), ch('iii', 'm7', 4), ch('IV', 'add9', 5), ch('I', 'add9', 0, { bassRole: '3rd' }), ch('IV', 'add9', 5), ch('V', '7sus4', 7)];
const LOFI_IV_START_FLOAT_8: ProgressionSlot[] = [ch('IV', 'maj9', 5), ch('iii', 'm7', 4), ch('vi', 'm9', 9), ch('ii', 'm9', 2), ch('IV', 'maj9', 5), ch('iii', 'm7', 4), ch('vi', 'm9', 9), ch('V', '9sus4', 7)];
const LOFI_MINOR_AEOLIAN_8: ProgressionSlot[] = [ch('i', 'm9', 0), ch('VII', 'add9', 10), ch('VI', 'maj9', 8), ch('VII', 'add9', 10), ch('i', 'm9', 0), ch('iv', 'm9', 5), ch('VI', 'maj9', 8), ch('VII', 'add9', 10)];
const LOFI_MINOR_EMO_8: ProgressionSlot[] = [ch('i', 'm9', 0), ch('VI', 'maj9', 8), ch('III', 'maj9', 3), ch('VII', 'add9', 10), ch('iv', 'm9', 5), ch('VI', 'maj9', 8), ch('VII', '9sus4', 10), ch('i', 'm9', 0)];
const LOFI_DORIAN_SOFT_8: ProgressionSlot[] = [ch('i', 'm9', 0), ch('IV', '9', 5, { borrowedSource: 'modal_interchange', borrowedFrom: 'Dorian IV' }), ch('iv', 'm9', 5), ch('i', 'm9', 0), ch('VII', 'add9', 10), ch('IV', '9', 5, { borrowedSource: 'modal_interchange', borrowedFrom: 'Dorian IV' }), ch('VI', 'maj9', 8), ch('i', 'm9', 0)];
const LOFI_MINOR_MODAL_CADENCE_8: ProgressionSlot[] = [ch('i', 'm9', 0), ch('iv', 'm9', 5), ch('V/V', '9', 2, { borrowedSource: 'secondary_dominant', borrowedFrom: 'V/V to home V', mustResolve: true }), ch('V', '7b13', 7), ch('VII', 'add9', 10, { borrowedSource: 'modal_interchange', borrowedFrom: 'Aeolian modal cadence V→bVII→i' }), ch('i', 'm9', 0), ch('iv', 'm7', 5), ch('VII', 'add9', 10)];
const LOFI_MINOR_IV_SIGH_8: ProgressionSlot[] = [ch('I', 'maj9', 0), ch('IV', 'maj9', 5), ch('iv', 'm9', 5, { borrowedSource: 'modal_interchange', borrowedFrom: 'parallel minor iv' }), ch('I', 'maj9', 0), ch('vi', 'm9', 9), ch('ii', 'm9', 2), ch('V', '9sus4', 7), ch('I', '6/9', 0)];
const LOFI_NEOSOUL_SOFT_8: ProgressionSlot[] = [ch('I', 'maj9', 0), ch('vi', 'm9', 9), ch('IV', 'maj9', 5), ch('iv', 'm9', 5, { borrowedSource: 'modal_interchange', borrowedFrom: 'parallel minor iv' }), ch('I', 'maj9', 0), ch('III', '7sus4', 4, { borrowedSource: 'secondary_dominant', borrowedFrom: 'soft V/vi', mustResolve: true }), ch('vi', 'm9', 9), ch('IV', 'maj9', 5)];
const LOFI_251_SUS_LOOP_8: ProgressionSlot[] = [ch('ii', 'm9', 2), ch('V', '13sus4', 7), ch('I', 'maj9', 0), ch('vi', 'm9', 9), ch('IV', 'maj9', 5), ch('iii', 'm7', 4), ch('ii', 'm9', 2), ch('V', '9sus4', 7)];
const LOFI_PHRYGIAN_HINT_8: ProgressionSlot[] = [ch('i', 'm9', 0), ch('bII', 'maj7', 1, { borrowedSource: 'modal_interchange', borrowedFrom: 'Phrygian bII color' }), ch('VII', 'add9', 10), ch('VI', 'maj9', 8), ch('i', 'm9', 0), ch('VII', 'add9', 10), ch('VI', 'maj9', 8), ch('VII', 'add9', 10)];
const LOFI_PEDAL_MAJOR_16: ProgressionSlot[] = [ch('I', 'maj9', 0, { bassRole: 'pedal', bassPedalPc: 0 }), ch('IV', 'maj9', 5, { bassRole: 'pedal', bassPedalPc: 0 }), ch('vi', 'm9', 9, { bassRole: 'pedal', bassPedalPc: 0 }), ch('V', '9sus4', 7, { bassRole: 'pedal', bassPedalPc: 0 }), ch('I', '6/9', 0, { bassRole: 'pedal', bassPedalPc: 0 }), ch('iii', 'm7', 4, { bassRole: 'pedal', bassPedalPc: 0 }), ch('IV', 'maj9', 5, { bassRole: 'pedal', bassPedalPc: 0 }), ch('V', '9sus4', 7, { bassRole: 'pedal', bassPedalPc: 0 }), ch('vi', 'm9', 9, { bassRole: 'pedal', bassPedalPc: 0 }), ch('IV', 'maj9', 5, { bassRole: 'pedal', bassPedalPc: 0 }), ch('I', 'maj9', 0, { bassRole: 'pedal', bassPedalPc: 0 }), ch('V', '9sus4', 7, { bassRole: 'pedal', bassPedalPc: 0 }), ch('IV', 'maj9', 5, { bassRole: 'pedal', bassPedalPc: 0 }), ch('iv', 'm9', 5, { bassRole: 'pedal', bassPedalPc: 0, borrowedSource: 'modal_interchange', borrowedFrom: 'parallel minor iv' }), ch('I', 'maj9', 0, { bassRole: 'pedal', bassPedalPc: 0 }), ch('I', '6/9', 0, { bassRole: 'pedal', bassPedalPc: 0 })];
const LOFI_EMO_LONG_16: ProgressionSlot[] = [ch('I', 'maj9', 0), ch('III', '7sus4', 4, { borrowedSource: 'secondary_dominant', borrowedFrom: 'soft V/vi', mustResolve: true }), ch('vi', 'm9', 9), ch('IV', 'maj9', 5), ch('I', '6/9', 0, { bassRole: '3rd' }), ch('V', '9sus4', 7, { bassRole: '3rd' }), ch('vi', 'm9', 9), ch('IV', 'add9', 5), ch('IV', 'maj9', 5), ch('iii', 'm7', 4), ch('vi', 'm9', 9), ch('ii', 'm9', 2), ch('IV', 'maj9', 5), ch('iv', 'm9', 5, { borrowedSource: 'modal_interchange', borrowedFrom: 'parallel minor iv' }), ch('I', 'maj9', 0), ch('V', '9sus4', 7)];
const LOFI_SHORT_FOUR_CELL: ProgressionSlot[] = [ch('I', 'maj9', 0), ch('vi', 'm9', 9), ch('IV', 'maj9', 5), ch('V', '9sus4', 7)];

const _LOFI_PROTOTYPES: ProgressionPrototype[] = [
  { id: 'lofi_major_warm_8', style: 'LOFI', mode: 'Major', sectionRoles: ['verse', 'intro', 'loop'], lengthBars: 8, weight: 1.35, slots: LOFI_MAJOR_WARM_8, energy: [0.2, 0.55], density: [0.15, 0.45], cadence: 'loop', emotionTags: ['warm', 'study', 'nostalgic'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Warm Piano', 'Lofi Study Loop', 'Lofi Rainy Rhodes'] },
  { id: 'lofi_emo_secondary_vi_8', style: 'LOFI', mode: 'Major', sectionRoles: ['verse', 'chorus', 'loop'], lengthBars: 8, weight: 1.30, slots: LOFI_EMO_SECONDARY_VI_8, energy: [0.25, 0.65], density: [0.2, 0.55], cadence: 'loop', emotionTags: ['emo', 'sad', 'warm'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Emo Piano', 'Lofi Bedroom Pop'] },
  { id: 'lofi_descending_bass_8', style: 'LOFI', mode: 'Major', sectionRoles: ['verse', 'loop'], lengthBars: 8, weight: 1.20, slots: LOFI_DESCENDING_BASS_8, energy: [0.25, 0.6], density: [0.2, 0.55], cadence: 'weak', emotionTags: ['warm', 'emo'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Soft Canon', 'Lofi Emo Piano', 'Lofi Study Loop'] },
  { id: 'lofi_soft_canon_8', style: 'LOFI', mode: 'Major', sectionRoles: ['verse', 'intro'], lengthBars: 8, weight: 0.95, slots: LOFI_SOFT_CANON_8, energy: [0.2, 0.55], density: [0.25, 0.55], cadence: 'weak', emotionTags: ['nostalgic', 'warm'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Soft Canon', 'Lofi Warm Piano'] },
  { id: 'lofi_iv_start_float_8', style: 'LOFI', mode: 'Major', sectionRoles: ['intro', 'verse', 'loop'], lengthBars: 8, weight: 1.00, slots: LOFI_IV_START_FLOAT_8, energy: [0.15, 0.45], density: [0.1, 0.4], cadence: 'open', emotionTags: ['float', 'warm'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Modal Float', 'Lofi Ambient Intro', 'Lofi Rainy Rhodes'] },
  { id: 'lofi_minor_aeolian_8', style: 'LOFI', mode: 'Minor', sectionRoles: ['verse', 'intro', 'loop'], lengthBars: 8, weight: 1.25, slots: LOFI_MINOR_AEOLIAN_8, energy: [0.2, 0.55], density: [0.15, 0.45], cadence: 'loop', emotionTags: ['dark', 'sad'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Minor Tape', 'Lofi Melancholy Minor', 'Lofi Night Drive'] },
  { id: 'lofi_minor_emo_8', style: 'LOFI', mode: 'Minor', sectionRoles: ['verse', 'chorus', 'loop'], lengthBars: 8, weight: 1.15, slots: LOFI_MINOR_EMO_8, energy: [0.25, 0.65], density: [0.2, 0.55], cadence: 'loop', emotionTags: ['sad', 'emo'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Melancholy Minor', 'Lofi Emo Piano'] },
  { id: 'lofi_dorian_soft_8', style: 'LOFI', mode: 'Minor', sectionRoles: ['bridge', 'loop', 'verse'], lengthBars: 8, weight: 0.70, slots: LOFI_DORIAN_SOFT_8, energy: [0.25, 0.6], density: [0.15, 0.5], cadence: 'modal', emotionTags: ['float', 'warm'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Dorian Chill', 'Lofi Modal Float'] },
  { id: 'lofi_minor_modal_cadence_8', style: 'LOFI', mode: 'Minor', sectionRoles: ['ending', 'loop'], lengthBars: 8, weight: 0.65, slots: LOFI_MINOR_MODAL_CADENCE_8, energy: [0.25, 0.65], density: [0.15, 0.45], cadence: 'modal', emotionTags: ['dark', 'sad'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Minor Tape', 'Lofi Night Drive'] },
  { id: 'lofi_minor_iv_sigh_8', style: 'LOFI', mode: 'Major', sectionRoles: ['verse', 'ending'], lengthBars: 8, weight: 0.90, slots: LOFI_MINOR_IV_SIGH_8, energy: [0.2, 0.55], density: [0.15, 0.45], cadence: 'weak', emotionTags: ['emo', 'sad'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Emo Piano', 'Lofi Bedroom Pop'] },
  { id: 'lofi_neosoul_soft_8', style: 'LOFI', mode: 'Major', sectionRoles: ['verse', 'loop'], lengthBars: 8, weight: 0.85, slots: LOFI_NEOSOUL_SOFT_8, energy: [0.25, 0.6], density: [0.2, 0.55], cadence: 'loop', emotionTags: ['warm', 'nostalgic'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Neo Soul Soft', 'Lofi Rainy Rhodes'] },
  { id: 'lofi_251_sus_loop_8', style: 'LOFI', mode: 'Major', sectionRoles: ['loop', 'verse'], lengthBars: 8, weight: 0.80, slots: LOFI_251_SUS_LOOP_8, energy: [0.2, 0.55], density: [0.15, 0.45], cadence: 'soft_authentic', emotionTags: ['warm', 'study'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Study Loop', 'Lofi Warm Piano'] },
  { id: 'lofi_phrygian_hint_8', style: 'LOFI', mode: 'Minor', sectionRoles: ['intro', 'bridge'], lengthBars: 8, weight: 0.45, slots: LOFI_PHRYGIAN_HINT_8, energy: [0.15, 0.45], density: [0.1, 0.35], cadence: 'modal', emotionTags: ['dark', 'float'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Minor Tape', 'Lofi Modal Float'] },
  { id: 'lofi_pedal_major_16', style: 'LOFI', mode: 'Major', sectionRoles: ['intro', 'loop'], lengthBars: 16, weight: 0.75, slots: LOFI_PEDAL_MAJOR_16, energy: [0.1, 0.45], density: [0.08, 0.35], cadence: 'open', emotionTags: ['float', 'study'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Ambient Intro', 'Lofi Night Drive', 'Lofi Study Loop'] },
  { id: 'lofi_emo_long_16', style: 'LOFI', mode: 'Major', sectionRoles: ['verse', 'chorus', 'loop'], lengthBars: 16, weight: 1.10, slots: LOFI_EMO_LONG_16, energy: [0.25, 0.7], density: [0.2, 0.6], cadence: 'loop', emotionTags: ['emo', 'sad', 'warm'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Emo Piano', 'Lofi Bedroom Pop', 'Lofi Piano Hiphop'] },
  { id: 'lofi_short_four_cell_4', style: 'LOFI', mode: 'Major', sectionRoles: ['loop', 'intro'], lengthBars: 4, weight: 0.70, slots: LOFI_SHORT_FOUR_CELL, energy: [0.15, 0.5], density: [0.1, 0.4], cadence: 'loop', emotionTags: ['study', 'warm'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Piano Hiphop', 'Lofi Study Loop'] },
];

/** 公开池 = modern + LOFI(★ 不含 legacy,见 Loop 1)。 */
export const PROGRESSION_POOL: ProgressionPrototype[] = [..._MODERN_PROGRESSION_PROTOTYPES, ..._LOFI_PROTOTYPES];

function weightedPickPrototype(pool: ProgressionPrototype[], random: ProtoRandom): ProgressionPrototype {
  const total = pool.reduce((s, p) => s + (p.weight ?? 1), 0);
  let roll = random.next() * total;
  for (const p of pool) {
    const w = p.weight ?? 1;
    if (roll < w) return p;
    roll -= w;
  }
  return pool[pool.length - 1];
}

/** 按 filter 查 prototype(style/mode/functionRole/maxBars 任一可选)。 */
export function listProgressionPrototypes(filter: { style?: HarmonyStyleName; mode?: ProtoMode; functionRole?: ProtoSectionRole; maxBars?: number } = {}): ProgressionPrototype[] {
  return PROGRESSION_POOL.filter((p) =>
    (filter.style === undefined || p.style === filter.style)
    && (filter.mode === undefined || p.mode === filter.mode)
    && (filter.functionRole === undefined || p.sectionRoles.includes(filter.functionRole))
    && (filter.maxBars === undefined || p.lengthBars <= filter.maxBars),
  );
}

/**
 * 选一个 prototype 并 fit 到 bars。先严格(style+mode+role+lengthBars≤bars),空则放宽去 mode。
 * 返回 fit 后的 slots;无候选 → null。带权随机(确定性,random 来自 forked 子流)。
 */
export function pickProgressionPrototype(args: {
  style: HarmonyStyleName;
  mode: ProtoMode;
  functionRole: ProtoSectionRole;
  bars: number;
  random: ProtoRandom;
}): ProgressionSlot[] | null {
  const strict = listProgressionPrototypes({ style: args.style, mode: args.mode, functionRole: args.functionRole, maxBars: args.bars });
  if (strict.length > 0) return fitProgressionToBars(weightedPickPrototype(strict, args.random).slots, args.bars);
  const relaxed = PROGRESSION_POOL.filter((p) => p.style === args.style && p.lengthBars <= args.bars && p.sectionRoles.includes(args.functionRole));
  if (relaxed.length === 0) return null;
  return fitProgressionToBars(weightedPickPrototype(relaxed, args.random).slots, args.bars);
}

/** 同 pickProgressionPrototype,但返回选中 prototype 的 transformPolicy(供 prototype 段离调变体门控)。 */
export function pickProgressionPrototypeWithPolicy(args: {
  style: HarmonyStyleName;
  mode: ProtoMode;
  functionRole: ProtoSectionRole;
  bars: number;
  random: ProtoRandom;
}): { slots: ProgressionSlot[]; transformPolicy?: ProgressionTransformPolicy } | null {
  const strict = listProgressionPrototypes({ style: args.style, mode: args.mode, functionRole: args.functionRole, maxBars: args.bars });
  const pool = strict.length > 0 ? strict
    : PROGRESSION_POOL.filter((p) => p.style === args.style && p.lengthBars <= args.bars && p.sectionRoles.includes(args.functionRole));
  if (pool.length === 0) return null;
  const proto = weightedPickPrototype(pool, args.random);
  return { slots: fitProgressionToBars(proto.slots, args.bars), transformPolicy: proto.transformPolicy };
}

/** 把 N-bar 模板展开填满 bars;第 2 遍起末 V 和弦换 7sus4 作 cadence 变化(避免纯重复)。 */
export function fitProgressionToBars(phrase: ProgressionSlot[], bars: number): ProgressionSlot[] {
  if (phrase.length === 0) return [];
  if (phrase.length === bars) return phrase.map((x) => ({ ...x }));
  const out: ProgressionSlot[] = [];
  let pass = 0;
  while (out.length < bars) {
    const copy = phrase.map((x) => ({ ...x }));
    if (pass >= 1) {
      let lastVIdx = -1;
      for (let i = copy.length - 1; i >= 0; i--) { if (romanHead(copy[i].roman) === 'V') { lastVIdx = i; break; } }
      if (lastVIdx >= 0) {
        const newType = pass % 2 === 1 ? '7sus4' : copy[lastVIdx].type;
        copy[lastVIdx] = { ...copy[lastVIdx], type: newType };
      }
    }
    out.push(...copy);
    pass++;
  }
  return out.slice(0, bars);
}
