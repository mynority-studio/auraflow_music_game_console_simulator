/**
 * RootlessVoicer — 钢琴右手 Rootless / Quartal voicing 构造器（A2）
 *
 * 设计哲学：
 *   传统 PianoAccompIdiom 的 RH 用 chord.voicing.slice(1)（HarmonyCore 的 close-position
 *   tertian 4-voice 去掉 bass voice）。这套对 Pop ballad 够用，但缺色彩：
 *     - 不能按 colorBias 加 9 / 11 / 13 延伸音（左右手都被"3-5-7-(9)"锁死）
 *     - 不能切换 quartal（四度叠置，jazz / cinematic 风味）
 *     - 与 A3a LH shell 协同时只能机械上推同 PC，没有更音乐性的 "delete root, replace"
 *
 * 本模块替代 RH voicing 构建阶段：
 *   recipe.voicingMode === 'rootless' → buildRootlessVoicing
 *     · 删 root（bass 已锚定）→ 保留 3 / 5 / 7 → 按 colorBias 阶梯加 9 / 13 / 11
 *     · minor 9th 撞音过滤（伯克利 avoid-note 规则）
 *     · listen LH：与 LH shell 同 PC 的扩展直接向上一八度，避免 RH 抢占 LH 区间
 *   recipe.voicingMode === 'quartal' → buildQuartalVoicing
 *     · 纯四度叠置（5 半音步长），3 voice，起点 = root + 7（5th）
 *     · 现代 jazz / film-score "悬浮感"专用，不依赖 chord quality 三度信息
 *
 * 输出空间：RELATIVE — 与 PianoAccompIdiom 上下文一致，禁加 keyOffset（K-2）。
 *
 * PRNG 消耗：0（D-1 / D-5）。
 *
 * @author AuraFlow Tap! A2 — RH Rootless / Quartal / Extensions
 */

import {
    GeneratedChord,
    CHORD_INTERVALS,
    CQ_IS_DOM,
} from '../types';

// ============================================================
// 常量
// ============================================================

const PITCH_CLASS_SIZE = 12;

/** RH 默认锚点 C4 — placement 尽量靠近此 pitch */
const DEFAULT_RH_ANCHOR = 60;
/** RH 默认上界 C6 — 防止延伸音飞太高 */
const DEFAULT_RH_RANGE_HI = 84;
/** Quartal 默认起点 anchor —— D4，比 tertian 略高一点拉出 "开放感" */
const DEFAULT_QUARTAL_ANCHOR = 62;
/** 纯四度半音步长 */
const PERFECT_FOURTH_SEMITONES = 5;

/** 扩展音相对 root 的 PC 偏移 */
const EXT_9TH        = 2;
const EXT_NAT_11TH   = 5;
const EXT_SHARP_11TH = 6;
const EXT_13TH       = 9;

/** colorBias 阶梯：>= 这些阈值时叠加对应扩展 */
const BIAS_THRESHOLD_9TH  = 0.30;
const BIAS_THRESHOLD_13TH = 0.55;
const BIAS_THRESHOLD_11TH = 0.80;

// ============================================================
// 内部 helpers
// ============================================================

/** 把 PC 放进 [floor, hi]，选离 anchor 最近的 octave；无候选时找最低合法位置 */
function placePcInRange(pc: number, anchor: number, floor: number, hi: number): number {
    const pcNorm = ((pc % PITCH_CLASS_SIZE) + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE;
    const anchorOctaveBase = anchor - (((anchor % PITCH_CLASS_SIZE) + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE);
    // 候选 ± 2 octave
    const candidates = [
        anchorOctaveBase - 12 + pcNorm,
        anchorOctaveBase + pcNorm,
        anchorOctaveBase + 12 + pcNorm,
        anchorOctaveBase + 24 + pcNorm,
    ];
    let best = -1;
    let bestDist = 9999;
    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (c < floor || c > hi) continue;
        const d = Math.abs(c - anchor);
        if (d < bestDist) {
            bestDist = d;
            best = c;
        }
    }
    if (best >= 0) return best;
    // fallback —— 找最低合法 octave 兜底
    let p = anchorOctaveBase + pcNorm;
    while (p < floor) p += 12;
    while (p > hi)    p -= 12;
    return p;
}

/** 检查 extPc 是否与某个 chord tone PC 形成 minor 9th 撞音（PC = chordTone + 1 半音）  */
function clashesMinor9th(extPc: number, chordTonePcs: number[]): boolean {
    // minor 9th = +13 半音 = +1 PC（环形）
    // 例：Dom7 G7 → chord tone C(0) + 4(E) + 7(G) + 10(B♭)；nat 11 = F(5)
    //     F 在 E 上方 1 半音 → minor 9th 撞音 → 必须升级为 #11 或舍去
    const target = (extPc - 1 + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE;
    for (let i = 0; i < chordTonePcs.length; i++) {
        if (chordTonePcs[i] === target) return true;
    }
    return false;
}

/** 数组去重（保持顺序） */
function dedupSortedArray(arr: number[]): number[] {
    if (arr.length <= 1) return arr.slice();
    const out: number[] = [arr[0]];
    for (let i = 1; i < arr.length; i++) {
        if (arr[i] !== out[out.length - 1]) out.push(arr[i]);
    }
    return out;
}

// ============================================================
// 公开 API — Rootless
// ============================================================

export interface RootlessVoicerInput {
    chord: GeneratedChord;
    /** 颜色偏好 ∈ [0, 1] — >=0.3 加 9 / >=0.55 加 13 / >=0.8 加 11 */
    colorBias: number;
    /** LH 已占 PC 集（listen） */
    lhPcSet?: number[];
    /** LH 顶音 pitch — RH 同 PC voice 至少要 > lhTopPitch + 11（一个八度以上） */
    lhTopPitch?: number;
    /** RH placement anchor，默认 C4=60 */
    anchorPitch?: number;
    /** RH 上界，默认 C6=84 */
    rangeHi?: number;
    /** RH 下界，默认 max(anchorPitch, lhTopPitch + 3) */
    rangeLo?: number;
}

/**
 * 构造 Rootless 右手 voicing。
 *
 * 算法（D-1 零 PRNG）：
 *   1. 取 chord tone PC 集（无 root）→ 3rd / 5th / 7th 等
 *   2. 按 colorBias 决定加哪些扩展（9 / 13 / 11）
 *   3. 过 minor 9th 撞音 filter（伯克利 avoid-note）
 *   4. listen LH：与 lhPcSet 同 PC 的 voice 强制升到 lhTopPitch + 12 以上
 *   5. 放置到 [rangeLo, rangeHi]、anchor 附近，升序 + 去重
 *
 * 输出：升序 pitch 数组（RELATIVE）。空集时退化到 [3, 7] 至少 2 voice（保证不静音）。
 */
export function buildRootlessVoicing(input: RootlessVoicerInput): number[] {
    const chord  = input.chord;
    const anchor = input.anchorPitch ?? DEFAULT_RH_ANCHOR;
    const hi     = input.rangeHi      ?? DEFAULT_RH_RANGE_HI;
    const lhTop  = input.lhTopPitch   ?? -1;
    const lo     = input.rangeLo      ?? Math.max(anchor, lhTop + 3);
    const lhPcs  = input.lhPcSet      ?? [];

    const rootPc = (((chord.bassOverride !== undefined ? chord.bassOverride : chord.root) % PITCH_CLASS_SIZE) + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE;
    const intervals = CHORD_INTERVALS[chord.quality] ?? [0, 4, 7];
    const qBit   = 1 << chord.quality;

    // chord tone PC 集（含 root，用于 minor 9th 检测） + 不含 root 的版本（放进 voicing）
    const allChordPcs: number[] = [];
    const chordTonePcsNoRoot: number[] = [];
    for (let i = 0; i < intervals.length; i++) {
        const pc = ((rootPc + intervals[i]) % PITCH_CLASS_SIZE + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE;
        if (allChordPcs.indexOf(pc) === -1) allChordPcs.push(pc);
        if (intervals[i] !== 0 && chordTonePcsNoRoot.indexOf(pc) === -1) {
            chordTonePcsNoRoot.push(pc);
        }
    }

    // colorBias 阶梯抽扩展音
    const cb = input.colorBias < 0 ? 0 : (input.colorBias > 1 ? 1 : input.colorBias);
    const candidateExts: number[] = [];
    if (cb >= BIAS_THRESHOLD_9TH)  candidateExts.push((rootPc + EXT_9TH)  % PITCH_CLASS_SIZE);
    if (cb >= BIAS_THRESHOLD_13TH) candidateExts.push((rootPc + EXT_13TH) % PITCH_CLASS_SIZE);
    if (cb >= BIAS_THRESHOLD_11TH) {
        // Dom 家族用 #11（Lydian Dominant），其他用 nat 11
        const isDom = (qBit & CQ_IS_DOM) !== 0;
        candidateExts.push((rootPc + (isDom ? EXT_SHARP_11TH : EXT_NAT_11TH)) % PITCH_CLASS_SIZE);
    }

    // minor 9th 撞音过滤
    const cleanExts: number[] = [];
    for (let i = 0; i < candidateExts.length; i++) {
        if (!clashesMinor9th(candidateExts[i], allChordPcs)) cleanExts.push(candidateExts[i]);
    }

    // 最终 PC 集：chord tone (no root) + 清洗后扩展（去重）
    const finalPcs: number[] = [];
    for (let i = 0; i < chordTonePcsNoRoot.length; i++) {
        if (finalPcs.indexOf(chordTonePcsNoRoot[i]) === -1) finalPcs.push(chordTonePcsNoRoot[i]);
    }
    for (let i = 0; i < cleanExts.length; i++) {
        if (finalPcs.indexOf(cleanExts[i]) === -1) finalPcs.push(cleanExts[i]);
    }
    // 保底：至少要有 [3, 7]（finalPcs.length === 0 几乎不可能，但兜底）
    if (finalPcs.length === 0 && chordTonePcsNoRoot.length > 0) {
        finalPcs.push(chordTonePcsNoRoot[0]);
        if (chordTonePcsNoRoot.length > 1) finalPcs.push(chordTonePcsNoRoot[1]);
    }

    // 放置 + listen LH
    const pitches: number[] = [];
    for (let i = 0; i < finalPcs.length; i++) {
        const pc = finalPcs[i];
        let isLhPc = false;
        for (let j = 0; j < lhPcs.length; j++) {
            if (lhPcs[j] === pc) { isLhPc = true; break; }
        }
        const effectiveLo = isLhPc ? Math.max(lo, lhTop + 12) : lo;
        const p = placePcInRange(pc, anchor, effectiveLo, hi);
        pitches.push(p);
    }

    pitches.sort((a, b) => a - b);
    return dedupSortedArray(pitches);
}

// ============================================================
// 公开 API — Quartal
// ============================================================

export interface QuartalVoicerInput {
    chord: GeneratedChord;
    /** 音数（默认 3） */
    voiceCount?: number;
    /** 起点 anchor，默认 D4=62 */
    anchorPitch?: number;
    /** 上界，默认 C6=84 */
    rangeHi?: number;
    /** LH 已占 PC 集（listen，目前未使用，预留 API 一致性） */
    lhPcSet?: number[];
    /** LH 顶音 pitch（同上） */
    lhTopPitch?: number;
}

/**
 * 构造 Quartal（纯四度叠置） voicing。
 *
 * 算法：
 *   1. 起点 PC = root + 7（5th） — 经典 So What voicing 起点
 *   2. 向上叠 voiceCount-1 个纯四度（5 半音步长）
 *   3. 起点放在 anchor 附近最近八度，后续 voice 顺次 +5 半音直到越界
 *
 * 听感：开放、悬浮、modal jazz 标志。适合 cinematic / dreamy 段落。
 * 不依赖 chord.quality 的三度信息（甚至 dim/aug 都能用）。
 */
export function buildQuartalVoicing(input: QuartalVoicerInput): number[] {
    const chord  = input.chord;
    const anchor = input.anchorPitch ?? DEFAULT_QUARTAL_ANCHOR;
    const hi     = input.rangeHi      ?? DEFAULT_RH_RANGE_HI;
    const lhTop  = input.lhTopPitch   ?? -1;
    const voiceCount = (input.voiceCount ?? 3) | 0;
    if (voiceCount <= 0) return [];

    const rootPc = (((chord.bassOverride !== undefined ? chord.bassOverride : chord.root) % PITCH_CLASS_SIZE) + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE;
    const startPc = (rootPc + 7) % PITCH_CLASS_SIZE;

    // 起点放置（>= max(anchor, lhTop+3)，避免与 LH shell 撞）
    const floor = Math.max(anchor, lhTop + 3);
    const startPitch = placePcInRange(startPc, anchor, floor, hi);

    const out: number[] = [startPitch];
    for (let i = 1; i < voiceCount; i++) {
        const next = startPitch + i * PERFECT_FOURTH_SEMITONES;
        if (next > hi) break;
        out.push(next);
    }
    return out;
}
