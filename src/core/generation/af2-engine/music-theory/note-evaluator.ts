// ============================================================
// note-evaluator — 单音在 chord+key 上下文里的"适配度"评估器
// ============================================================
//
// 替代删除的 mg HarmonicEvaluator(evaluateNoteInChordContext)。
// 简化版本:不做 unified-tension-resolution 复杂度,只给 4 类别 + score。
//
// 用例:
//   1. Af2MelodyGen.pickBestPassingPc:从候选 pitch 集合中挑评分最高的
//   2. 未来 Af2AccompGen / BassIdiom 也可消费(检测 voice leading 质量)
//   3. 未来 chord-tone evaluator UI 调试
//
// 算法:
//   pc = pitch % 12
//   chord tones = CHORD_TYPES[quality].map(iv => (root + iv) % 12)
//   scale tones = SCALE_TYPES[Ionian or Aeolian based on isMinor]
//
//   pc ∈ chord tones        → ChordTone     score 1.0
//   pc ∈ scale tones        → ScaleTone     score 0.7
//   distanceToChord === 1   → ChromaticPassing score 0.5
//   otherwise               → Avoid         score 0.2
//
// score 设计偏好:chord tone 强落点 / scale tone 自然过渡 / chromatic 短促修饰 /
//   avoid 谨慎使用(只在强方向偏好时才接受)
//
// 零 PRNG,deterministic。
// ============================================================

import { ChordQuality, ChordQualityName } from '../../types';
import { CHORD_TYPES } from './chord-types';
import { SCALE_TYPES } from './scale';

/** 4 大类别 — 数值升序对应"远离 chord/key"程度 */
export enum NoteCategory {
    ChordTone = 0,
    ScaleTone = 1,
    ChromaticPassing = 2,
    Avoid = 3,
}

export interface NoteEvaluation {
    /** 类别 */
    category: NoteCategory;
    /** 适配度评分 [0, 1] */
    score: number;
    /** 离最近 chord tone 的半音距离(chord tone 自己 = 0)*/
    distanceToChord: number;
    /** 是否在 key scale 内(diatonic) */
    isDiatonic: boolean;
}

const SCORE_BY_CATEGORY: Record<NoteCategory, number> = {
    [NoteCategory.ChordTone]:        1.00,
    [NoteCategory.ScaleTone]:        0.70,
    [NoteCategory.ChromaticPassing]: 0.50,
    [NoteCategory.Avoid]:            0.20,
};

/** Get chord tone pcs from quality (uses ChordTypes 表)。 */
function getChordTonePcs(chordRootPc: number, quality: ChordQuality): Set<number> {
    const root = ((chordRootPc % 12) + 12) % 12;
    const qualityName = ChordQualityName[quality] ?? 'Major';
    // 映射 enum name → CHORD_TYPES key(简化,直接试几个 alias)
    const aliases: Record<string, string> = {
        'Major':           'maj',
        'Minor':           'min',
        'Diminished':      'dim',
        'Augmented':       'aug',
        'Major7':          'maj7',
        'Minor7':          'm7',
        'Dominant7':       '7',
        'HalfDiminished':  'm7b5',
        'Diminished7':     'dim7',
        'Sus4':            'sus4',
        'Dominant7Sus4':   '7sus4',
        'Add9':            'add9',
        'Minor9':          'm9',
        'Major9':          'maj9',
        'Dominant9':       '9',
        'Minor11':         'm11',
        'Dominant13':      '13',
        'Major13':         'maj13',
        'Major7Sharp11':   'maj7#11',
        'Dom7Flat9':       '7b9',
        'Dom7Sharp9':      '7#9',
        'Dom7Sharp11':     '7#11',
        'Dom7Flat13':      '7b13',
        'Dom7Alt':         '7alt',
        'Dominant11':      '11',
    };
    const chordTypeKey = aliases[qualityName] ?? 'maj';
    const intervals = CHORD_TYPES[chordTypeKey] ?? CHORD_TYPES['maj'];
    const out = new Set<number>();
    for (const iv of intervals) out.add(((root + iv) % 12 + 12) % 12);
    return out;
}

/** Key scale pcs(major Ionian / minor Aeolian)。 */
function getKeyScalePcs(keyRootPc: number, isMinor: boolean): Set<number> {
    const root = ((keyRootPc % 12) + 12) % 12;
    const modeName = isMinor ? 'Aeolian' : 'Ionian';
    const intervals = SCALE_TYPES[modeName] ?? SCALE_TYPES['Ionian'];
    const out = new Set<number>();
    for (const iv of intervals) out.add(((root + iv) % 12 + 12) % 12);
    return out;
}

/** Chord tone 半音距离(0 = chord tone 本身,1 = 半音邻,等)。 */
function distanceToNearestChordTone(pc: number, chordTones: Set<number>): number {
    let minDist = 12;
    for (const ct of chordTones) {
        const d1 = ((pc - ct + 12) % 12);
        const d2 = ((ct - pc + 12) % 12);
        const d = Math.min(d1, d2);
        if (d < minDist) minDist = d;
    }
    return minDist;
}

/**
 * 主入口:评估 pitch 在 chord + key 上下文里的适配度。
 *
 * @param pitch       MIDI pitch(任何八度均可,内部 % 12)
 * @param chordRootPc Chord root pc(0-11)
 * @param quality     ChordQuality enum
 * @param keyRootPc   Key root pc(0-11,默认 C=0)
 * @param isMinor     调式 minor 否(默认 false = major)
 */
export function evaluateNoteInContext(
    pitch: number,
    chordRootPc: number,
    quality: ChordQuality,
    keyRootPc: number = 0,
    isMinor: boolean = false,
): NoteEvaluation {
    const pc = ((pitch % 12) + 12) % 12;
    const chordTones = getChordTonePcs(chordRootPc, quality);
    const scaleTones = getKeyScalePcs(keyRootPc, isMinor);

    const distanceToChord = distanceToNearestChordTone(pc, chordTones);
    const isDiatonic = scaleTones.has(pc);

    let category: NoteCategory;
    if (chordTones.has(pc)) {
        category = NoteCategory.ChordTone;
    } else if (isDiatonic) {
        category = NoteCategory.ScaleTone;
    } else if (distanceToChord === 1) {
        category = NoteCategory.ChromaticPassing;
    } else {
        category = NoteCategory.Avoid;
    }

    return {
        category,
        score: SCORE_BY_CATEGORY[category],
        distanceToChord,
        isDiatonic,
    };
}

/**
 * 批量评估候选 pc 集合,返回评分降序数组。便于 melody 算法挑最高分。
 *
 * 可选 directionBias:若给定 nextPc,与 prevPc(候选起点)的"方向一致"候选 +0.15 分。
 *   方向定义:nextPc 在 prevPc 的顺时针半音距离 ≤ 6 视为"上行"。
 */
export interface RankedPc {
    pc: number;
    evaluation: NoteEvaluation;
    adjustedScore: number;
}

export function rankCandidatePcs(
    candidates: ReadonlyArray<number>,
    chordRootPc: number,
    quality: ChordQuality,
    keyRootPc: number = 0,
    isMinor: boolean = false,
    options?: { prevPc?: number; nextPc?: number },
): RankedPc[] {
    // 性能优化:per-call 预算 chordTones + scaleTones 一次,4-6 candidates 共享
    //   (原 evaluateNoteInContext 每 candidate 重新构造 Set,~6× 重复浪费)
    const chordTones = getChordTonePcs(chordRootPc, quality);
    const scaleTones = getKeyScalePcs(keyRootPc, isMinor);

    let goUp = false;
    let hasBias = false;
    if (options?.prevPc !== undefined && options?.nextPc !== undefined) {
        const dist = ((options.nextPc - options.prevPc + 12) % 12);
        goUp = dist > 0 && dist <= 6;
        hasBias = true;
    }
    const ranked: RankedPc[] = candidates.map(pc => {
        const evaluation = evaluateWithSets(pc, chordTones, scaleTones);
        let bias = 0;
        if (hasBias && options?.prevPc !== undefined) {
            const stepDir = ((pc - options.prevPc + 12) % 12);
            const candUp = stepDir > 0 && stepDir <= 6;
            if (candUp === goUp) bias = 0.15;
        }
        return { pc, evaluation, adjustedScore: evaluation.score + bias };
    });
    ranked.sort((a, b) => b.adjustedScore - a.adjustedScore);
    return ranked;
}

/** Internal:预算 chord+scale Set 后的轻量评估(rankCandidatePcs 内部用) */
function evaluateWithSets(
    pitch: number,
    chordTones: Set<number>,
    scaleTones: Set<number>,
): NoteEvaluation {
    const pc = ((pitch % 12) + 12) % 12;
    const distanceToChord = distanceToNearestChordTone(pc, chordTones);
    const isDiatonic = scaleTones.has(pc);
    let category: NoteCategory;
    if (chordTones.has(pc)) category = NoteCategory.ChordTone;
    else if (isDiatonic) category = NoteCategory.ScaleTone;
    else if (distanceToChord === 1) category = NoteCategory.ChromaticPassing;
    else category = NoteCategory.Avoid;
    return { category, score: SCORE_BY_CATEGORY[category], distanceToChord, isDiatonic };
}
