// ============================================================
// newEngine · knowledge · ProgressionLibrary(混:进行=事实 / 带权选取=new)
// ------------------------------------------------------------
// 架构定稿 Part 4 / 3.3:per-section-role 级数模板 + diatonic 品质推导。
// Engine 按 seed(rng 子流)从候选里选,绑定到当前 song(铁律22-23)。
// Slice 1 tonal:大调/自然小调自然 7 和弦。
// ============================================================

import { mod12, type Rng } from '../foundation';
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

export type HarmonyStyleName = 'POP' | 'JAZZ' | 'RNB' | 'BLUES' | 'LOFI' | 'ACG';
export type ProtoMode = 'Major' | 'Minor';
export type ProtoSectionRole = 'intro' | 'verse' | 'chorus' | 'bridge' | 'ending' | 'loop';
/** Berklee 5 分类:非自然音和弦来源(Planner 设置)。 */
export type BorrowedSource = 'secondary_dominant' | 'secondary_ii_v' | 'backdoor_dominant' | 'modal_interchange' | 'chromatic_color';
export type BassRole = 'root' | '3rd' | '5th' | '7th' | 'pedal';
export type TonicizationPlacement = 'light' | 'approach' | 'iiv_split' | 'full_2bar';

/**
 * An applied-chord target expressed relative to the section key.  Keeping the
 * target offset in knowledge (rather than a concrete pitch) preserves correct
 * V/X analysis after any song transposition.
 */
export interface AppliedHarmonyTarget {
  roman: string;
  rootOffset: number;
}

/** 进行模板的单和弦槽(= melodygenerative ChordSkeletonSlot)。type = 和弦类型串(对应 ChordTypeId)。 */
export interface ProgressionSlot {
  roman: string;
  type: string;
  scaleDegree: number;
  rootOffset: number;            // 相对 key 的半音
  bassRole?: BassRole;
  bassPedalPc?: number;          // bassRole='pedal' 时
  bassOffset?: number;           // 显式 slash-bass:相对 section key 的半音，realizer 转为绝对 bassPc
  /** V/X or ii/X target; makes the slash relation executable analysis data. */
  appliedTarget?: AppliedHarmonyTarget;
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
export function romanScaleDegree(roman: string): number {
  const stripped = roman.replace(/^[b#n]+/, '').split('/')[0];
  const head = stripped.match(/^[IVivXx]+/)?.[0] ?? '';
  const map: Record<string, number> = { I: 1, i: 1, II: 2, ii: 2, III: 3, iii: 3, IV: 4, iv: 4, V: 5, v: 5, VI: 6, vi: 6, VII: 7, vii: 7 };
  return map[head] ?? 1;
}
function romanHead(roman: string): string {
  if (!roman) return '';
  return roman.replace(/^[b#n]+/, '').match(/^[IVivXx]+/)?.[0] ?? '';
}

const LOCAL_DEGREE_SEMITONES: Record<number, number> = {
  1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11,
};

function accidentalSemitones(roman: string): number {
  if (roman.startsWith('bb')) return -2;
  if (roman.startsWith('b')) return -1;
  if (roman.startsWith('x')) return 2;
  if (roman.startsWith('#')) return 1;
  return 0;
}

/**
 * A slash numeral names a local function (`V/iv`), while rootOffset names the
 * audible global root. Infer the local tonic's transposition-safe offset so
 * the realizer can preserve both facts as RomanChord.secondaryTarget and
 * localTonalCenterPc. The current library uses ordinary diatonic i/ii/V heads
 * for applied harmony; unfamiliar forms deliberately return undefined rather
 * than inventing an analysis.
 */
function inferredAppliedTarget(roman: string, rootOffset: number): AppliedHarmonyTarget | undefined {
  const parts = roman.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  const head = parts[0];
  const localDegree = romanScaleDegree(head);
  const localOffset = LOCAL_DEGREE_SEMITONES[localDegree];
  if (localOffset === undefined) return undefined;
  return {
    roman: parts[1],
    rootOffset: mod12(rootOffset - localOffset - accidentalSemitones(head)),
  };
}
/** slot 工厂:rootOffset 必填;lockType=true 默认(Stage2 保留作者 chord type)。 */
function ch(roman: string, type: string, rootOffset: number, extra: Partial<ProgressionSlot> = {}): ProgressionSlot {
  const appliedTarget = inferredAppliedTarget(roman, rootOffset);
  return {
    roman,
    type,
    rootOffset,
    scaleDegree: romanScaleDegree(roman),
    lockType: true,
    ...(appliedTarget ? { appliedTarget } : {}),
    ...extra,
  };
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

// —— ACG slot 模板(久石让/坂本电影钢琴;MG 升级 Phase 2a,忠实 port 自 melodygenerative styleDictionary ACG cells)——
//   top-voice planing / common-tone / color-descent / borrowed-cadence / suspended-arrival(pedal)/ J-pop 4-5-6 / minor-circle。
//   全 slot preserveType(maj9/maj13/6/9/m9/sus 等富色彩品质,POP 三和弦折叠会毁 quartal 色彩);forcedScale 走真 chord-scale。
//   ⚠️ 4 个 secondary-dominant 变体(_vi_to_v_of_iv / _tonicized_iv)依赖 MG 的 withViAsVOfIvBeforeIv/withTonicizedIvOpening,
//   暂不港(低权重装饰,留作小补丁);7 个基底进行已覆盖 ACG 全部和声身份。
const ACG_MAJOR_PLANING_8: ProgressionSlot[] = [ch('I', 'maj9', 0, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian' }), ch('II', 'maj9', 2, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian', borrowedSource: 'chromatic_color', borrowedFrom: 'constant-structure planing' }), ch('III', 'maj9', 4, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian', borrowedSource: 'chromatic_color', borrowedFrom: 'constant-structure planing' }), ch('bV', 'maj9', 6, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian', borrowedSource: 'chromatic_color', borrowedFrom: 'constant-structure planing' }), ch('V', 'maj9', 7, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian', borrowedSource: 'chromatic_color', borrowedFrom: 'constant-structure planing' }), ch('bIII', 'maj9', 3, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian', borrowedSource: 'chromatic_color', borrowedFrom: 'constant-structure planing' }), ch('bVI', 'maj13', 8, { bassRole: '3rd', preserveType: true, forcedScale: 'Lydian', borrowedSource: 'chromatic_color', borrowedFrom: 'constant-structure planing' }), ch('I', '6/9', 0, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian' })];
const ACG_COMMON_TONE_8: ProgressionSlot[] = [ch('I', 'maj9', 0, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian' }), ch('V', 'maj9', 7, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian', borrowedSource: 'chromatic_color', borrowedFrom: 'top-voice planing' }), ch('vi', 'm9', 9, { bassRole: '3rd', preserveType: true, forcedScale: 'Dorian' }), ch('IV', 'maj9', 5, { bassRole: '3rd', preserveType: true, forcedScale: 'Lydian' }), ch('bVII', 'maj9', 10, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian', borrowedSource: 'chromatic_color', borrowedFrom: 'top-voice planing' }), ch('bVI', 'maj13', 8, { bassRole: '3rd', preserveType: true, forcedScale: 'Lydian', borrowedSource: 'chromatic_color', borrowedFrom: 'top-voice planing' }), ch('V', '9sus4', 7, { bassRole: '5th', preserveType: true, forcedScale: 'Mixolydian' }), ch('I', '6/9', 0, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian' })];
const ACG_COLOR_DESCENT_8: ProgressionSlot[] = [ch('IV', 'maj9', 5, { preserveType: true, forcedScale: 'Lydian' }), ch('I', 'maj9', 0, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian' }), ch('bVII', 'maj9', 10, { bassRole: '3rd', preserveType: true, forcedScale: 'Mixolydian', borrowedSource: 'modal_interchange', borrowedFrom: 'bVII (Mixolydian color)' }), ch('bII', 'maj9', 1, { preserveType: true, forcedScale: 'Ionian', borrowedSource: 'chromatic_color', borrowedFrom: 'bII constant-structure color' }), ch('ii', 'm9', 2, { preserveType: true, forcedScale: 'Dorian' }), ch('I', '6/9', 0, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian' }), ch('iv', 'm9', 5, { preserveType: true, forcedScale: 'Aeolian', borrowedSource: 'modal_interchange', borrowedFrom: 'iv (parallel minor)' }), ch('I', '6/9', 0, { preserveType: true, forcedScale: 'Ionian' })];
const ACG_BORROWED_CADENCE_8: ProgressionSlot[] = [ch('I', 'maj9', 0, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian' }), ch('ii', 'm9', 2, { preserveType: true, forcedScale: 'Dorian' }), ch('I', '6/9', 0, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian' }), ch('iv', 'm9', 5, { preserveType: true, forcedScale: 'Aeolian', borrowedSource: 'modal_interchange', borrowedFrom: 'iv (parallel minor)' }), ch('V', '9sus4', 7, { preserveType: true, forcedScale: 'Mixolydian', mustResolve: true }), ch('I', '6/9', 0, { preserveType: true, forcedScale: 'Ionian' }), ch('bVI', 'maj9', 8, { preserveType: true, forcedScale: 'Aeolian', borrowedSource: 'modal_interchange', borrowedFrom: 'bVI (parallel minor)' }), ch('V', '13sus4', 7, { preserveType: true, forcedScale: 'Mixolydian', mustResolve: true })];
const ACG_SUSPENDED_ARRIVAL_8: ProgressionSlot[] = [ch('I', 'maj9', 0, { bassRole: 'pedal', bassPedalPc: 0, preserveType: true, forcedScale: 'Ionian' }), ch('IV', 'maj9', 5, { bassRole: 'pedal', bassPedalPc: 0, preserveType: true, forcedScale: 'Lydian' }), ch('vi', 'm9', 9, { bassRole: 'pedal', bassPedalPc: 0, preserveType: true, forcedScale: 'Aeolian' }), ch('V', '13sus4', 7, { bassRole: 'pedal', bassPedalPc: 0, preserveType: true, forcedScale: 'Mixolydian' }), ch('ii', 'm9', 2, { preserveType: true, forcedScale: 'Dorian' }), ch('V', '9sus4', 7, { preserveType: true, forcedScale: 'Mixolydian', mustResolve: true }), ch('I', 'maj9', 0, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian' }), ch('I', '6/9', 0, { preserveType: true, forcedScale: 'Ionian' })];
const ACG_JPOP_456_DECEPTIVE_8: ProgressionSlot[] = [ch('IV', 'maj9', 5, { preserveType: true, forcedScale: 'Lydian' }), ch('V', '9', 7, { preserveType: true, forcedScale: 'Mixolydian', mustResolve: true }), ch('vi', 'm9', 9, { preserveType: true, forcedScale: 'Aeolian' }), ch('vi', 'm9', 9, { preserveType: true, forcedScale: 'Aeolian' }), ch('IV', 'maj9', 5, { preserveType: true, forcedScale: 'Lydian' }), ch('V', '9', 7, { preserveType: true, forcedScale: 'Mixolydian', mustResolve: true }), ch('vi', 'm9', 9, { preserveType: true, forcedScale: 'Aeolian' }), ch('I', '6/9', 0, { bassRole: '3rd', preserveType: true, forcedScale: 'Ionian' })];
const ACG_MINOR_CIRCLE_8: ProgressionSlot[] = [ch('i', 'm9', 0, { preserveType: true, forcedScale: 'Aeolian' }), ch('iv', 'm9', 5, { preserveType: true, forcedScale: 'Dorian' }), ch('VII', 'add9', 10, { preserveType: true, forcedScale: 'Aeolian' }), ch('III', 'maj9', 3, { preserveType: true, forcedScale: 'Ionian' }), ch('VI', 'maj9', 8, { preserveType: true, forcedScale: 'Lydian' }), ch('ii', 'm7b5', 2, { preserveType: true, forcedScale: 'Locrian' }), ch('V', '7b9', 7, { preserveType: true, forcedScale: 'Phrygian Dominant', mustResolve: true }), ch('i', 'm9', 0, { preserveType: true, forcedScale: 'Aeolian' })];

// —— ACG PIANOSONG · 根音中心小调抒情 profile ——
//   这不是替换旧的 ACG planing / common-tone 池，而是 ACG 处于 Minor 时优先可用的
//   一套短篇钢琴 cue 骨架。ACG 曲式实际有 4-bar intro / lift / coda；旧池几乎全是 8-bar，
//   短段会退回通用 degree-picker，因而无法保证低音、调式与终止语义。
//
//   规则：
//   - 非 intro 的低音全部显式 root（不用 3rd / 5th 反复转位）；
//   - 主体是 Aeolian i-bVI-bIII-bVII，色彩只用 add9 / madd9，不堆 maj9；
//   - lift 的 raised-6 放在 i(m6/9) 上，forcedScale 以主音为锚才真实表达 Dorian，
//     不把 "Dorian" 错挂到 IV 根音；
//   - V7-i 不强塞 forcedScale（其锚点应是主音），由小调 V7 的 chord-scale 规则给出
//     harmonic-minor 导音。intro 的 pedal 不写绝对 bassPedalPc，使其随歌曲 key 转置。
const ACG_PIANO_MINOR_PEDAL_INTRO_4: ProgressionSlot[] = [
  ch('i', 'madd9', 0, { bassRole: 'pedal', preserveType: true }),
  ch('i', 'madd9', 0, { bassRole: 'pedal', preserveType: true }),
  ch('i', 'madd9', 0, { bassRole: 'pedal', preserveType: true }),
  ch('i', 'madd9', 0, { bassRole: 'pedal', preserveType: true }),
];
const ACG_PIANO_MINOR_AEOLIAN_CELL_4: ProgressionSlot[] = [
  ch('i', 'madd9', 0, { bassRole: 'root', preserveType: true }),
  ch('bVI', 'add9', 8, { bassRole: 'root', preserveType: true }),
  ch('bIII', 'add9', 3, { bassRole: 'root', preserveType: true }),
  ch('bVII', 'sus2', 10, { bassRole: 'root', preserveType: true }),
];
const ACG_PIANO_MINOR_AEOLIAN_THEME_8: ProgressionSlot[] = [
  ...ACG_PIANO_MINOR_AEOLIAN_CELL_4,
  ch('i', 'madd9', 0, { bassRole: 'root', preserveType: true }),
  ch('iv', 'madd9', 5, { bassRole: 'root', preserveType: true }),
  ch('bVI', 'add9', 8, { bassRole: 'root', preserveType: true }),
  ch('bVII', 'sus2', 10, { bassRole: 'root', preserveType: true }),
];
const ACG_PIANO_MINOR_RELATIVE_DORIAN_LIFT_4: ProgressionSlot[] = [
  ch('i', 'm6/9', 0, { bassRole: 'root', preserveType: true, forcedScale: 'Dorian', borrowedSource: 'modal_interchange', borrowedFrom: 'Dorian tonic colour (raised 6)' }),
  ch('bIII', 'add9', 3, { bassRole: 'root', preserveType: true }),
  ch('bVII', 'add9', 10, { bassRole: 'root', preserveType: true }),
  ch('V', '7sus4', 7, { bassRole: 'root', preserveType: true, mustResolve: true }),
];
const ACG_PIANO_MINOR_HARMONIC_CADENCE_4: ProgressionSlot[] = [
  ch('iv', 'madd9', 5, { bassRole: 'root', preserveType: true }),
  ch('bVI', 'add9', 8, { bassRole: 'root', preserveType: true }),
  ch('V', '7', 7, { bassRole: 'root', preserveType: true, mustResolve: true }),
  ch('i', 'madd9', 0, { bassRole: 'root', preserveType: true }),
];

// —— JPOP canon ii-V 替换 + chromatic walkdown(follow MG styleDictionary PROGRESSION_POOL,逐 slot 对齐)——
//   canon:原 canon 的 vii / IV-向 由 bar-级 ii/X→V/X cell(2+2 拍)替换。全 slot preserveType(精确 m7b5/m7/7,
//   POP 折叠会毁爵士色彩,MG 同);ii-V cell tonicizationPlacement:'approach'(MG 同)。
//   ★ forcedScale 是我们的【附加】(MG 靠 realizeProgression 给局部音阶,我们 realChordScale 对 secondary_ii_v
//   不够 → 显式补,守"和弦音 ⊆ chord-scale"不变量):ii/X=Locrian/Dorian · V/vi(→小调)=Phrygian Dominant ·
//   V/IV(→大调)=Mixolydian。32 拍 = 8 小节,beat-aware 扩 64。
//   变体策略 JPOP_VARIATION(用户:在卡农上叠加引擎离调变体;transformPolicy 接活,见 harmonyEngine)。
const JPOP_VARIATION: ProgressionTransformPolicy = {
  allowTonicization: true, maxTonicizePer16: 2, allowBorrowed: true, maxBorrowedPer16: 1,
  allowFullTwoFive: true, allowSubV: false, preferSusDominant: false,
};
const POP_JPOP_CANON_251_BAR_REPLACE_8: ProgressionSlot[] = [
  ch('I', 'add9', 0, { preserveType: true }),                                                                                 // Cadd9 (4)
  ch('ii/vi', 'm7b5', 11, { beats: 2, preserveType: true, borrowedSource: 'secondary_ii_v', borrowedFrom: 'ii/vi', tonicizationPlacement: 'approach', forcedScale: 'Locrian' }),         // Bm7b5 (2)
  ch('V/vi', '7', 4, { beats: 2, preserveType: true, borrowedSource: 'secondary_dominant', mustResolve: true, borrowedFrom: 'V/vi', tonicizationPlacement: 'approach', forcedScale: 'Phrygian Dominant' }), // E7 (2)
  ch('vi', 'm7', 9, { preserveType: true }),                                                                                  // Am7 (4)
  ch('ii/IV', 'm7', 7, { beats: 2, preserveType: true, borrowedSource: 'secondary_ii_v', borrowedFrom: 'ii/IV', tonicizationPlacement: 'approach', forcedScale: 'Dorian' }),            // Gm7 (2)
  ch('V/IV', '7', 0, { beats: 2, preserveType: true, borrowedSource: 'secondary_dominant', mustResolve: true, borrowedFrom: 'V/IV', tonicizationPlacement: 'approach', forcedScale: 'Mixolydian' }), // C7 (2)
  ch('IV', 'add9', 5, { preserveType: true }),                                                                                // Fadd9 (4)
  ch('V/vi', '7', 4, { beats: 2, preserveType: true, borrowedSource: 'secondary_dominant', mustResolve: true, borrowedFrom: 'V/vi', tonicizationPlacement: 'approach', forcedScale: 'Phrygian Dominant' }), // E7 (2)
  ch('vi', 'm7', 9, { beats: 2, preserveType: true }),                                                                        // Am7 (2)
  ch('ii', 'm7', 2, { preserveType: true }),                                                                                  // Dm7 (4)
  ch('V', '7', 7, { preserveType: true }),                                                                                    // G7 (4)
];
// JPOP chromatic walkdown(follow MG 逐 slot:bass 半音下行 C-B-Bb-A-Ab-G-F-G,slash 转位)。
//   ii/IV(madd9)secondary_ii_v + iv(madd9)modal_interchange → 补 forcedScale 守不变量(MG 靠 realization)。
const POP_JPOP_CHROMATIC_WALKDOWN_8: ProgressionSlot[] = [
  ch('I', 'add9', 0),                                                                                                         // C
  ch('V', 'add9', 7, { bassRole: '3rd' }),                                                                                    // G/B(bass B)
  ch('ii/IV', 'madd9', 7, { bassRole: '3rd', borrowedSource: 'secondary_ii_v', borrowedFrom: 'ii/IV', forcedScale: 'Dorian' }), // Gm/Bb
  ch('IV', 'add9', 5, { bassRole: '3rd' }),                                                                                   // F/A
  ch('iv', 'madd9', 5, { bassRole: '3rd', borrowedSource: 'modal_interchange', borrowedFrom: 'parallel minor iv', forcedScale: 'Dorian' }), // Fm/Ab
  ch('I', 'add9', 0, { bassRole: '5th' }),                                                                                    // C/G
  ch('IV', 'add9', 5),                                                                                                        // F
  ch('V', '7sus4', 7),                                                                                                        // G
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
// 5/4 3+2 vamp learned from the supplied MIDI: the second harmony begins at
// the additive group boundary, not at the next bar. In E minor this realizes
// as Em9 (3 beats) -> Bm7 (2 beats).
const JAZZ_FIVE_FOUR_MINOR_VAMP_1: ProgressionSlot[] = [
  ch('i', 'm9', 0, { beats: 3, preserveType: true, forcedScale: 'Aeolian' }),
  ch('v', 'm7', 7, { beats: 2, preserveType: true, forcedScale: 'Aeolian' }),
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
  // ★ JPOP canon ii-V(follow MG:sectionRoles chorus/bridge 对齐);weight=1.5(用户提高 POP 权重,>MG 1.2);
  //   transformPolicy=用户要的卡农变体(引擎叠加离调)。slots 逐 slot 对齐 MG(+forcedScale 我们补)。
  { id: 'pop_jpop_canon_251_bar_replace_8', style: 'POP', mode: 'Major', sectionRoles: ['chorus', 'bridge'], lengthBars: 8, weight: 1.5, slots: POP_JPOP_CANON_251_BAR_REPLACE_8, transformPolicy: JPOP_VARIATION, subStyles: ['JPOP Canon', 'JPOP Piano'], emotionTags: ['nostalgic', 'emo'] },
  // ★ JPOP chromatic walkdown(follow MG:bass 半音下行 slash 链;sectionRoles verse/bridge/ending + weight 0.75 对齐 MG)。
  { id: 'pop_jpop_chromatic_walkdown_8', style: 'POP', mode: 'Major', sectionRoles: ['verse', 'bridge', 'ending'], lengthBars: 8, weight: 0.75, slots: POP_JPOP_CHROMATIC_WALKDOWN_8, subStyles: ['JPOP Walkdown'], emotionTags: ['nostalgic', 'emo'] },
  { id: 'pop_min_aeolian_8', style: 'POP', mode: 'Minor', sectionRoles: ['verse', 'chorus'], lengthBars: 8, slots: MINOR_AEOLIAN_POP_8 },
  { id: 'pop_min_modal_cad_8', style: 'POP', mode: 'Minor', sectionRoles: ['chorus', 'bridge'], lengthBars: 8, slots: MINOR_MODAL_CADENCE_8 },
  { id: 'pop_min_dorian_lift_8', style: 'POP', mode: 'Minor', sectionRoles: ['bridge', 'chorus'], lengthBars: 8, slots: MINOR_DORIAN_LIFT_8 },
  { id: 'rnb_min_neo_soul_8', style: 'RNB', mode: 'Minor', sectionRoles: ['verse', 'chorus'], lengthBars: 8, slots: RNB_MINOR_NEO_SOUL_8 },
  { id: 'rnb_maj_common_tone_8', style: 'RNB', mode: 'Major', sectionRoles: ['verse', 'chorus'], lengthBars: 8, slots: RNB_MAJOR_COMMON_TONE_8 },
  { id: 'rnb_backdoor_8', style: 'RNB', mode: 'Major', sectionRoles: ['chorus', 'ending'], lengthBars: 8, slots: RNB_BACKDOOR_8 },
  { id: 'jazz_1625_8', style: 'JAZZ', mode: 'Major', sectionRoles: ['verse', 'chorus'], lengthBars: 8, slots: JAZZ_1625_8 },
  { id: 'jazz_min_251_8', style: 'JAZZ', mode: 'Minor', sectionRoles: ['verse', 'chorus'], lengthBars: 8, slots: JAZZ_MINOR_251_8 },
  {
    id: 'jazz_five_four_minor_vamp_1',
    style: 'JAZZ',
    mode: 'Minor',
    sectionRoles: ['loop'],
    lengthBars: 1,
    slots: JAZZ_FIVE_FOUR_MINOR_VAMP_1,
    weight: 8,
    cadence: 'loop',
    transformPolicy: {
      allowTonicization: false,
      maxTonicizePer16: 0,
      allowBorrowed: false,
      maxBorrowedPer16: 0,
      allowFullTwoFive: false,
      allowSubV: false,
      preferSusDominant: false,
    },
    subStyles: ['Modern Jazz 5/4 Piano'],
  },
  // —— 联网补足(2026-06-05):3 条权威 jazz 进行,jazz 从 2 → 5 ——
  { id: 'jazz_rhythm_bridge_8', style: 'JAZZ', mode: 'Major', sectionRoles: ['bridge'], lengthBars: 8, slots: JAZZ_RHYTHM_BRIDGE_8 },
  { id: 'jazz_autumn_leaves_8', style: 'JAZZ', mode: 'Minor', sectionRoles: ['verse', 'chorus'], lengthBars: 8, slots: JAZZ_AUTUMN_LEAVES_8 },
  { id: 'jazz_blues_12', style: 'JAZZ', mode: 'Major', sectionRoles: ['verse', 'chorus'], lengthBars: 12, slots: JAZZ_BLUES_12 },
  { id: 'blues_12bar_dom', style: 'BLUES', mode: 'Major', sectionRoles: ['verse', 'chorus', 'intro', 'ending'], lengthBars: 12, slots: BLUES_12BAR_DOMINANT, weight: 3 },
  // ACG PIANOSONG · 根音中心小调 cue profile。放在既有 ACG 池之前，令 Minor 的
  // 4/8-bar 主题曲式优先命中它；旧 ACG planing / common-tone 原型仍完整保留在后面。
  { id: 'acg_piano_minor_pedal_intro_4', style: 'ACG', mode: 'Minor', sectionRoles: ['intro'], lengthBars: 4, slots: ACG_PIANO_MINOR_PEDAL_INTRO_4, weight: 5.2, cadence: 'open', emotionTags: ['sad', 'float'], subStyles: ['ACG PIANOSONG Rooted Minor'] },
  { id: 'acg_piano_minor_aeolian_theme_8', style: 'ACG', mode: 'Minor', sectionRoles: ['verse', 'chorus', 'loop'], lengthBars: 8, slots: ACG_PIANO_MINOR_AEOLIAN_THEME_8, weight: 5.4, cadence: 'modal', emotionTags: ['sad', 'nostalgic'], subStyles: ['ACG PIANOSONG Rooted Minor'] },
  { id: 'acg_piano_minor_aeolian_cell_4', style: 'ACG', mode: 'Minor', sectionRoles: ['verse', 'chorus', 'loop'], lengthBars: 4, slots: ACG_PIANO_MINOR_AEOLIAN_CELL_4, weight: 1.15, cadence: 'loop', emotionTags: ['sad', 'nostalgic'], subStyles: ['ACG PIANOSONG Rooted Minor'] },
  { id: 'acg_piano_minor_relative_dorian_lift_4', style: 'ACG', mode: 'Minor', sectionRoles: ['bridge'], lengthBars: 4, slots: ACG_PIANO_MINOR_RELATIVE_DORIAN_LIFT_4, weight: 4.8, cadence: 'modal', emotionTags: ['float', 'nostalgic'], subStyles: ['ACG PIANOSONG Rooted Minor'] },
  { id: 'acg_piano_minor_harmonic_cadence_4', style: 'ACG', mode: 'Minor', sectionRoles: ['ending'], lengthBars: 4, slots: ACG_PIANO_MINOR_HARMONIC_CADENCE_4, weight: 5.0, cadence: 'soft_authentic', emotionTags: ['sad', 'nostalgic'], subStyles: ['ACG PIANOSONG Rooted Minor'] },
  // ACG(既有久石让/坂本电影钢琴;MG 升级 Phase 2a。7 条 legacy 基底进行继续保留)
  { id: 'acg_topvoice_major_planing_8', style: 'ACG', mode: 'Major', sectionRoles: ['intro', 'verse', 'bridge', 'loop'], lengthBars: 8, slots: ACG_MAJOR_PLANING_8, weight: 1.7 },
  { id: 'acg_topvoice_common_tone_8', style: 'ACG', mode: 'Major', sectionRoles: ['verse', 'chorus', 'ending'], lengthBars: 8, slots: ACG_COMMON_TONE_8, weight: 1.1 },
  { id: 'acg_color_descent_8', style: 'ACG', mode: 'Major', sectionRoles: ['intro', 'verse', 'bridge'], lengthBars: 8, slots: ACG_COLOR_DESCENT_8, weight: 1.5 },
  { id: 'acg_borrowed_cadence_8', style: 'ACG', mode: 'Major', sectionRoles: ['verse', 'chorus', 'ending'], lengthBars: 8, slots: ACG_BORROWED_CADENCE_8, weight: 1.2 },
  { id: 'acg_suspended_arrival_8', style: 'ACG', mode: 'Major', sectionRoles: ['intro', 'chorus', 'ending'], lengthBars: 8, slots: ACG_SUSPENDED_ARRIVAL_8, weight: 1.1 },
  { id: 'acg_jpop_456_deceptive_8', style: 'ACG', mode: 'Major', sectionRoles: ['verse', 'chorus', 'bridge', 'ending'], lengthBars: 8, slots: ACG_JPOP_456_DECEPTIVE_8, weight: 1.35 },
  { id: 'acg_minor_circle_8', style: 'ACG', mode: 'Minor', sectionRoles: ['verse', 'chorus', 'bridge', 'ending'], lengthBars: 8, slots: ACG_MINOR_CIRCLE_8, weight: 1.35 },
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
const LOFI_MAJOR_TWO_CHORD_SOUL: ProgressionSlot[] = [ch('I', 'maj9', 0), ch('IV', 'maj9', 5)];
const LOFI_MAJOR_THREE_CHORD_FLOAT: ProgressionSlot[] = [ch('I', '6/9', 0), ch('vi', 'm9', 9), ch('IV', 'maj9', 5)];
const LOFI_SHORT_FOUR_CELL: ProgressionSlot[] = [ch('I', 'maj9', 0), ch('vi', 'm9', 9), ch('IV', 'maj9', 5), ch('V', '9sus4', 7)];
const LOFI_DESCENDING_SOUL_FOUR: ProgressionSlot[] = [ch('IV', 'maj9', 5), ch('iii', 'm11', 4), ch('ii', 'm11', 2), ch('I', 'maj9', 0)];
const LOFI_251_SOUL_THREE: ProgressionSlot[] = [ch('ii', 'm9', 2), ch('V', '13sus4', 7), ch('I', 'maj9', 0)];
const LOFI_MINOR_TWO_CHORD_SOUL: ProgressionSlot[] = [ch('i', 'm9', 0), ch('VI', 'maj9', 8)];
const LOFI_MINOR_THREE_CHORD_FLOAT: ProgressionSlot[] = [ch('i', 'm9', 0), ch('VII', 'add9', 10), ch('VI', 'maj9', 8)];
const LOFI_MINOR_FOUR_CHORD_SOUL: ProgressionSlot[] = [ch('i', 'm9', 0), ch('VI', 'maj9', 8), ch('III', 'maj9', 3), ch('VII', 'add9', 10)];

// —— 8-file LOFI piano corpus → transposition-safe harmonic grammar ——
// Only function, quality, bass role and harmonic rhythm are retained.  The
// source MIDI, absolute notes, filenames and ornamental top lines are not part
// of production knowledge.
const LOFI_MAJOR_PLAGAL_DESCENT_TWO: ProgressionSlot[] = [
  ch('IV', 'add9', 5, { bassRole: '3rd', beats: 1.5 }),
  ch('ii', 'm9', 2, { beats: 2.5 }),
  ch('I', 'maj7', 0),
];
const LOFI_MAJOR_WHOLE_STEP_PLANING_FOUR: ProgressionSlot[] = [
  ch('I', 'maj7', 0, { beats: 8 }),
  ch('II', 'maj', 2, {
    beats: 4,
    forcedScale: 'Ionian',
    borrowedSource: 'chromatic_color',
    borrowedFrom: 'whole-step constant-structure planing',
  }),
  ch('II', 'maj7', 2, {
    beats: 4,
    forcedScale: 'Ionian',
    borrowedSource: 'chromatic_color',
    borrowedFrom: 'whole-step constant-structure planing',
  }),
];
const LOFI_MAJOR_PARALLEL_MINOR_FALL_FOUR: ProgressionSlot[] = [
  ch('I', 'maj', 0),
  ch('i', 'min', 0, {
    borrowedSource: 'modal_interchange',
    borrowedFrom: 'parallel-minor tonic color',
  }),
  ch('bVII', 'maj', 10, {
    beats: 8,
    borrowedSource: 'modal_interchange',
    borrowedFrom: 'parallel-minor bVII',
  }),
];
const LOFI_MINOR_TURNAROUND_FOUR: ProgressionSlot[] = [
  ch('III', 'maj7', 3),
  ch('ii', 'm7b5', 2, { beats: 2 }),
  ch('V', '7#9', 7, {
    beats: 2,
    mustResolve: true,
    borrowedFrom: 'harmonic-minor dominant',
  }),
  ch('i', 'm9', 0),
  ch('V', '9', 7, { beats: 2, bassRole: '5th' }),
  ch('V', 'maj', 7, {
    beats: 2,
    forcedScale: 'Mixolydian',
    borrowedFrom: 'open dominant turnaround',
  }),
];
const LOFI_MINOR_AEOLIAN_EBB_EIGHT: ProgressionSlot[] = [
  ch('iv', 'm7', 5),
  ch('v', 'm7', 7),
  ch('VI', 'maj9', 8),
  ch('v', 'm7', 7),
  ch('iv', 'm7', 5),
  ch('v', 'm7', 7),
  ch('i', 'min', 0),
  ch('VII', 'maj', 10),
];
const LOFI_MINOR_LATE_CADENCE_FOUR: ProgressionSlot[] = [
  ch('i', 'min', 0, { beats: 8 }),
  ch('VI', 'maj', 8, { beats: 6 }),
  ch('VII', 'add9', 10, { beats: 2 }),
];
const LOFI_MINOR_THIRD_BASS_VAMP_FOUR: ProgressionSlot[] = [
  ch('i', 'm9', 0, { bassRole: '3rd', beats: 16 }),
];

const _LOFI_PROTOTYPES: ProgressionPrototype[] = [
  { id: 'lofi_major_two_chord_soul_2', style: 'LOFI', mode: 'Major', sectionRoles: ['intro', 'verse', 'chorus', 'loop', 'ending'], lengthBars: 2, weight: 2.2, slots: LOFI_MAJOR_TWO_CHORD_SOUL, energy: [0.1, 0.55], density: [0.08, 0.45], cadence: 'loop', emotionTags: ['warm', 'study'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Piano Hiphop', 'Lofi Study Loop'] },
  { id: 'lofi_major_three_chord_float_3', style: 'LOFI', mode: 'Major', sectionRoles: ['intro', 'verse', 'chorus', 'loop', 'ending'], lengthBars: 3, weight: 1.8, slots: LOFI_MAJOR_THREE_CHORD_FLOAT, energy: [0.1, 0.55], density: [0.08, 0.45], cadence: 'open', emotionTags: ['float', 'warm'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Piano Hiphop', 'Lofi Rainy Rhodes'] },
  { id: 'lofi_short_four_cell_4', style: 'LOFI', mode: 'Major', sectionRoles: ['intro', 'verse', 'chorus', 'loop', 'ending'], lengthBars: 4, weight: 2.4, slots: LOFI_SHORT_FOUR_CELL, energy: [0.15, 0.5], density: [0.1, 0.4], cadence: 'loop', emotionTags: ['study', 'warm'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Piano Hiphop', 'Lofi Study Loop'] },
  { id: 'lofi_descending_soul_4', style: 'LOFI', mode: 'Major', sectionRoles: ['intro', 'verse', 'chorus', 'loop', 'ending'], lengthBars: 4, weight: 2.2, slots: LOFI_DESCENDING_SOUL_FOUR, energy: [0.12, 0.52], density: [0.08, 0.42], cadence: 'weak', emotionTags: ['warm', 'nostalgic'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Piano Hiphop', 'Lofi Study Loop'] },
  { id: 'lofi_251_soul_3', style: 'LOFI', mode: 'Major', sectionRoles: ['intro', 'verse', 'chorus', 'loop', 'ending'], lengthBars: 3, weight: 1.4, slots: LOFI_251_SOUL_THREE, energy: [0.16, 0.55], density: [0.1, 0.42], cadence: 'soft_authentic', emotionTags: ['warm', 'study'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Piano Hiphop', 'Lofi Study Loop'] },
  { id: 'lofi_major_plagal_descent_2', style: 'LOFI', mode: 'Major', sectionRoles: ['intro', 'verse', 'chorus', 'loop', 'ending'], lengthBars: 2, weight: 1.65, slots: LOFI_MAJOR_PLAGAL_DESCENT_TWO, energy: [0.1, 0.5], density: [0.08, 0.42], cadence: 'weak', emotionTags: ['warm', 'float'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Piano Hiphop', 'Lofi Rainy Rhodes'] },
  { id: 'lofi_major_whole_step_planing_4', style: 'LOFI', mode: 'Major', sectionRoles: ['intro', 'verse', 'loop'], lengthBars: 4, weight: 0.9, slots: LOFI_MAJOR_WHOLE_STEP_PLANING_FOUR, energy: [0.08, 0.42], density: [0.06, 0.34], cadence: 'modal', emotionTags: ['float', 'study'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Modal Float', 'Lofi Ambient Intro', 'Lofi Rainy Rhodes'] },
  { id: 'lofi_major_parallel_minor_fall_4', style: 'LOFI', mode: 'Major', sectionRoles: ['intro', 'verse', 'chorus', 'loop', 'ending'], lengthBars: 4, weight: 1.15, slots: LOFI_MAJOR_PARALLEL_MINOR_FALL_FOUR, energy: [0.12, 0.5], density: [0.08, 0.4], cadence: 'modal', emotionTags: ['nostalgic', 'sad'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Minor Tape', 'Lofi Emo Piano', 'Lofi Modal Float'] },
  { id: 'lofi_minor_two_chord_soul_2', style: 'LOFI', mode: 'Minor', sectionRoles: ['intro', 'verse', 'chorus', 'loop', 'ending'], lengthBars: 2, weight: 2.2, slots: LOFI_MINOR_TWO_CHORD_SOUL, energy: [0.1, 0.55], density: [0.08, 0.45], cadence: 'loop', emotionTags: ['sad', 'warm'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Minor Tape', 'Lofi Piano Hiphop'] },
  { id: 'lofi_minor_three_chord_float_3', style: 'LOFI', mode: 'Minor', sectionRoles: ['intro', 'verse', 'chorus', 'loop', 'ending'], lengthBars: 3, weight: 1.8, slots: LOFI_MINOR_THREE_CHORD_FLOAT, energy: [0.1, 0.55], density: [0.08, 0.45], cadence: 'open', emotionTags: ['sad', 'float'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Minor Tape', 'Lofi Night Drive'] },
  { id: 'lofi_minor_four_chord_soul_4', style: 'LOFI', mode: 'Minor', sectionRoles: ['intro', 'verse', 'chorus', 'loop', 'ending'], lengthBars: 4, weight: 2.4, slots: LOFI_MINOR_FOUR_CHORD_SOUL, energy: [0.15, 0.55], density: [0.1, 0.45], cadence: 'loop', emotionTags: ['sad', 'nostalgic'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Minor Tape', 'Lofi Piano Hiphop'] },
  { id: 'lofi_minor_turnaround_4', style: 'LOFI', mode: 'Minor', sectionRoles: ['intro', 'verse', 'chorus', 'loop', 'ending'], lengthBars: 4, weight: 1.05, slots: LOFI_MINOR_TURNAROUND_FOUR, energy: [0.15, 0.58], density: [0.12, 0.46], cadence: 'loop', emotionTags: ['warm', 'nostalgic'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Piano Hiphop', 'Lofi Neo Soul Soft'] },
  { id: 'lofi_minor_aeolian_ebb_8', style: 'LOFI', mode: 'Minor', sectionRoles: ['intro', 'verse', 'loop'], lengthBars: 8, weight: 0.85, slots: LOFI_MINOR_AEOLIAN_EBB_EIGHT, energy: [0.12, 0.48], density: [0.08, 0.38], cadence: 'open', emotionTags: ['sad', 'float'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Minor Tape', 'Lofi Melancholy Minor', 'Lofi Night Drive'] },
  { id: 'lofi_minor_late_cadence_4', style: 'LOFI', mode: 'Minor', sectionRoles: ['intro', 'verse', 'chorus', 'loop', 'ending'], lengthBars: 4, weight: 1.25, slots: LOFI_MINOR_LATE_CADENCE_FOUR, energy: [0.1, 0.5], density: [0.06, 0.38], cadence: 'modal', emotionTags: ['sad', 'warm'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Piano Hiphop', 'Lofi Minor Tape'] },
  { id: 'lofi_minor_third_bass_vamp_4', style: 'LOFI', mode: 'Minor', sectionRoles: ['intro', 'loop'], lengthBars: 4, weight: 0.45, slots: LOFI_MINOR_THIRD_BASS_VAMP_FOUR, energy: [0.05, 0.32], density: [0.04, 0.28], cadence: 'open', emotionTags: ['float', 'study'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Ambient Intro', 'Lofi Rainy Rhodes'] },
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
  { id: 'lofi_pedal_major_16', style: 'LOFI', mode: 'Major', sectionRoles: ['intro'], lengthBars: 16, weight: 0.75, slots: LOFI_PEDAL_MAJOR_16, energy: [0.1, 0.45], density: [0.08, 0.35], cadence: 'open', emotionTags: ['float', 'study'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Ambient Intro', 'Lofi Night Drive', 'Lofi Study Loop'] },
  { id: 'lofi_emo_long_16', style: 'LOFI', mode: 'Major', sectionRoles: ['verse', 'chorus'], lengthBars: 16, weight: 1.10, slots: LOFI_EMO_LONG_16, energy: [0.25, 0.7], density: [0.2, 0.6], cadence: 'loop', emotionTags: ['emo', 'sad', 'warm'], transformPolicy: LOFI_NO_TRANSFORM, subStyles: ['Lofi Emo Piano', 'Lofi Bedroom Pop', 'Lofi Piano Hiphop'] },
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

function pickPrototypeForStyle(
  pool: ProgressionPrototype[],
  style: HarmonyStyleName,
  random: ProtoRandom,
): ProgressionPrototype {
  if (style === 'LOFI') {
    const shortLoops = pool.filter((prototype) => prototype.lengthBars <= 4);
    // LOFI Hip Hop defaults to a sample-like 2–4 chord cell. The remaining
    // 18% deliberately preserves the existing composed-jazzhop vocabulary.
    if (shortLoops.length > 0 && (shortLoops.length === pool.length || random.next() < 0.82)) {
      return weightedPickPrototype(shortLoops, random);
    }
  }
  return weightedPickPrototype(pool, random);
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

/** Exact KB lookup for an Arranger-selected whole-song harmonic identity. */
export function progressionPrototypeById(id: string): ProgressionPrototype | undefined {
  const prototype = PROGRESSION_POOL.find((candidate) => candidate.id === id);
  if (!prototype) return undefined;
  return {
    ...prototype,
    sectionRoles: [...prototype.sectionRoles],
    slots: prototype.slots.map((slot) => ({ ...slot })),
    subStyles: prototype.subStyles ? [...prototype.subStyles] : undefined,
    emotionTags: prototype.emotionTags ? [...prototype.emotionTags] : undefined,
    energy: prototype.energy ? [...prototype.energy] : undefined,
    density: prototype.density ? [...prototype.density] : undefined,
    transformPolicy: prototype.transformPolicy ? { ...prototype.transformPolicy } : undefined,
  };
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
  beatsPerBar?: number;
  random: ProtoRandom;
}): ProgressionSlot[] | null {
  const strict = listProgressionPrototypes({ style: args.style, mode: args.mode, functionRole: args.functionRole, maxBars: args.bars });
  if (strict.length > 0) return fitProgressionToBars(pickPrototypeForStyle(strict, args.style, args.random).slots, args.bars, args.beatsPerBar, args.style !== 'LOFI');
  const relaxed = PROGRESSION_POOL.filter((p) => p.style === args.style && p.lengthBars <= args.bars && p.sectionRoles.includes(args.functionRole));
  if (relaxed.length === 0) return null;
  return fitProgressionToBars(pickPrototypeForStyle(relaxed, args.style, args.random).slots, args.bars, args.beatsPerBar, args.style !== 'LOFI');
}

/** 同 pickProgressionPrototype,但返回选中 prototype 的 transformPolicy(供 prototype 段离调变体门控)。 */
export function pickProgressionPrototypeWithPolicy(args: {
  style: HarmonyStyleName;
  mode: ProtoMode;
  functionRole: ProtoSectionRole;
  bars: number;
  beatsPerBar?: number;
  random: ProtoRandom;
}): { prototypeId: string; slots: ProgressionSlot[]; transformPolicy?: ProgressionTransformPolicy } | null {
  const strict = listProgressionPrototypes({ style: args.style, mode: args.mode, functionRole: args.functionRole, maxBars: args.bars });
  const pool = strict.length > 0 ? strict
    : PROGRESSION_POOL.filter((p) => p.style === args.style && p.lengthBars <= args.bars && p.sectionRoles.includes(args.functionRole));
  if (pool.length === 0) return null;
  const proto = pickPrototypeForStyle(pool, args.style, args.random);
  return {
    prototypeId: proto.id,
    slots: fitProgressionToBars(proto.slots, args.bars, args.beatsPerBar, args.style !== 'LOFI'),
    transformPolicy: proto.transformPolicy,
  };
}

const DEFAULT_BEATS_PER_BAR = 4;
const slotBeats = (s: ProgressionSlot, beatsPerBar: number): number => s.beats ?? beatsPerBar;

/** 把模板展开【按拍】填满 bars 小节;第 2 遍起末 V 和弦换 7sus4 作 cadence 变化(避免纯重复)。
 *  ★ 修(2026-06-08):按【拍】累计而非 slot 个数 —— 含半小节槽(beats:2,如副属 ii-V)的模板,
 *    bars 个 slot ≠ bars 小节,会让段落和声短缺、时间线整体前移、outro 被挤掉(戛然而止)。
 *    beatsPerBar 缺省 4 以保持旧调用兼容；5/4 调用显式传 5。末槽按需截断到刚好填满。 */
export function fitProgressionToBars(
  phrase: ProgressionSlot[],
  bars: number,
  beatsPerBar = DEFAULT_BEATS_PER_BAR,
  varyRepeatedDominant = true,
): ProgressionSlot[] {
  if (phrase.length === 0) return [];
  if (!Number.isFinite(beatsPerBar) || beatsPerBar <= 0) throw new RangeError(`fitProgressionToBars(): beatsPerBar 须 > 0,得到 ${beatsPerBar}`);
  const target = bars * beatsPerBar; // 目标总拍
  const phraseBeats = phrase.reduce((n, s) => n + slotBeats(s, beatsPerBar), 0);
  if (phraseBeats === target) return phrase.map((x) => ({ ...x }));
  const out: ProgressionSlot[] = [];
  let acc = 0;
  let pass = 0;
  while (acc < target) {
    const copy = phrase.map((x) => ({ ...x }));
    if (varyRepeatedDominant && pass >= 1) {
      let lastVIdx = -1;
      for (let i = copy.length - 1; i >= 0; i--) { if (romanHead(copy[i].roman) === 'V') { lastVIdx = i; break; } }
      if (lastVIdx >= 0) {
        const newType = pass % 2 === 1 ? '7sus4' : copy[lastVIdx].type;
        copy[lastVIdx] = { ...copy[lastVIdx], type: newType };
      }
    }
    for (const s of copy) {
      if (acc >= target) break;
      const b = slotBeats(s, beatsPerBar);
      if (acc + b <= target) { out.push(s); acc += b; }
      else { out.push({ ...s, beats: target - acc }); acc = target; } // 末槽截断到刚好填满
    }
    pass++;
  }
  return out;
}
