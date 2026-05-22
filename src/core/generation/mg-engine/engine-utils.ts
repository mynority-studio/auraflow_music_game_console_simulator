// ============================================================
// engine-utils — mg.Engine class 的纯函数抽取(Phase 1 / #6.0)
// ============================================================
//
// audit 报告(2026-05-22)将 mg.Engine class 的 24 个 method 分组,这里收集
// 「组 A 纯函数候选」(0 state 依赖,可直接抽离 class scope)。
//
// 渐进式抽取:每抽出一个 method,Engine class 内调用点改为 free function 调用
// (`this.xxx()` → `xxx()`)。Phase 6 完成后 Engine class 可全部消失。
//
// 本文件位置(mg-engine/)暂时,#6.6 整体迁移到 af2-engine/ 时一起搬。
// ============================================================

import { StyleName, STYLE_DICTIONARY } from '../af2-engine/data/styleDictionary';
import { ChordTextureEngine } from '../af2-engine/instruments/chord-texture/ChordTextureEngine';
import {
    harmonicFunctionFromRoman, QUANTIZED_DURATIONS, Random,
    KEYS, spellPcInKey, midiToNoteInKey, midiToNoteInChord,
    UNRESOLVED_TENSION_THRESHOLD,
} from './musicEngine';
import type { ChordDef, GenerationConfig, ResolvedGenerationContext, NoteContext, HardConstraint, SoftScore, NoteEvent, BarPatternSongContext } from './musicEngine';
import {
    CHORD_TYPES, SCALE_TYPES, noteToMidi, isAvoidNote, MELODY_RANGE, classifyEngineChordType,
    getModeAwareSubstitutions, modeProgressionTemplate,
    MAINSTREAM_EMOTION_TO_MODE, MAJOR_FLAVOR_MODES,
    EXOTIC_MODE_PROBABILITY, EXOTIC_MODES,
    getMeterContext, modeToKeyFamily,
    assembleVoicing, placeVoicingMidi, evaluateTensionState, detectModeBorrowing,
    STYLE_SHELL, STYLE_ROOTLESS, STYLE_CLUSTER, STYLE_FULL, STYLE_BLUES,
    JAZZ_ROOTLESS_VOICINGS, POP_VOICINGS, RNB_VOICINGS, BLUES_VOICINGS, INTERVAL_AESTHETICS,
    // Phase 3.2 — generateBarPattern dependencies
    cadenceTargetPcs, classifyCadenceTier, snapMidiToNearestPc,
    classifyNoteRole, getClosestScaleMidi,
    computeGlobalContract, getResolutionTargets,
    evaluateNoteInChordContext, getScaleGravity,
    getChordBackboneIntervals,
} from '../af2-engine/music-theory';
import type {
    Emotion, VoicingStylePreference, NoteRole, NoteHarmonicAssessment, PhraseRole,
    TensionTracker, MeterContext,
} from '../af2-engine/music-theory';
import { DYNAMIC_TSD_DICTIONARY, analyzeTargetQuality } from '../af2-engine/data/dynamicHarmony';
import {
    pickBasslineRule, BASSLINE_RULES, DEFAULT_BASSLINE_RULE,
    BASS_PATTERN_RULES, resolveBassAnchorPc, clampPcToBassMidi,
} from '../af2-engine/data/basslineRules';

/**
 * 抽自 mg.Engine.resolveTonalCharacter (原 L684-689)。
 * 决定 song-level 是 tonal(功能性和声)还是 modal(scale-color)。
 *
 * BLUES style → modal(blues note 是 scale color,非 tension resolution)
 * Major/Minor/Ionian/Aeolian mode → tonal
 * 其他 mode(Dorian/Phrygian/Lydian/Mixolydian/Locrian)→ modal
 */
export function resolveTonalCharacter(style: StyleName, mode: string): 'tonal' | 'modal' {
    if (style === 'BLUES') return 'modal';
    const tonalModes = new Set(['Major', 'Minor', 'Ionian', 'Aeolian']);
    if (!tonalModes.has(mode)) return 'modal';
    return 'tonal';
}

/**
 * 抽自 mg.Engine.getHarmonicFunction (原 L1634-1636)。
 * 一行 wrapper:roman numeral → T/S/D 功能。
 *
 * 设计原因:原 class method 仅为 wrap harmonicFunctionFromRoman(后者已在
 * musicTheory.ts 是 free function)。抽出后调用方可直接调本函数或下层。
 */
export function getHarmonicFunction(romanOriginal: string): 'T' | 'S' | 'D' {
    return harmonicFunctionFromRoman(romanOriginal);
}

/**
 * 抽自 mg.Engine.applySwing (原 L3418-3428)。
 * Swing/shuffle groove 时值调整 — 把直拍的 8th note 偏移到 2:1 triplet feel。
 *
 *   straight 0.5 → swing 0.66
 *   straight 0.25 → swing 0.33(triplet 1)
 *   straight 0.75 → swing 0.83(triplet 3)
 *   其他 fraction:不变
 */
export function applySwing(t: number, isShuffle: boolean): number {
    if (!isShuffle) return t;
    const beat = Math.floor(t);
    const fraction = t - beat;
    if (fraction === 0) return t;
    if (Math.abs(fraction - 0.5) < 0.01) return beat + 0.66;
    if (Math.abs(fraction - 0.25) < 0.01) return beat + 0.33;
    if (Math.abs(fraction - 0.75) < 0.01) return beat + 0.83;
    return t;
}

/**
 * 抽自 mg.Engine.computeBackboneTargets (原 L2785-2816)。
 * Chord 的 backbone target pcs — melody 结构音应该 land 的"和声回归点"。
 *
 * = chord literal pcs(always)+ key root(仅当 chord 完全 diatonic 于 key
 * palette,且 keyRootPc 不是 avoid note)。
 */
export function computeBackboneTargets(
    chord: ChordDef,
    keyRootPc: number,
    modeIntervals: number[],
    isModalContext: boolean = false,
): Set<number> {
    const chordRootPc = (((chord.rootMidi % 12) + 12) % 12);
    const intervals = CHORD_TYPES[chord.type] || [0, 4, 7];

    const targets = new Set<number>();
    for (const iv of intervals) targets.add((chordRootPc + iv) % 12);

    const keyPcs = new Set<number>();
    for (const iv of modeIntervals) keyPcs.add((keyRootPc + iv) % 12);
    const chordLiteralPcs = Array.from(targets);
    const isDiatonic = chordLiteralPcs.every(pc => keyPcs.has(pc));
    if (isDiatonic && !targets.has(keyRootPc)) {
        const intvFromChordRoot = ((keyRootPc - chordRootPc) % 12 + 12) % 12;
        const cFunc = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
        if (!isAvoidNote(intvFromChordRoot, chord.type, undefined, isModalContext, cFunc)) {
            targets.add(keyRootPc);
        }
    }
    return targets;
}

/**
 * 抽自 mg.Engine.estimateBackboneAlignment (原 L2828-2857)。
 * Motif 结构音 vs backbone targets 的对齐分(0-1)。
 * 1.0 = 所有 structural 音 land 在 chord literal/key root;0.0 = 都不 land。
 */
export function estimateBackboneAlignment(
    motif: any[],
    chord: ChordDef,
    runScale: number[],
    targets: Set<number>,
): number {
    if (motif.length === 0) return 0;
    const chordRootPc = (((chord.rootMidi % 12) + 12) % 12);
    const scalePcs = Array.from(new Set(runScale.map(x => ((x%12)+12)%12))).sort((a,b)=>a-b);
    const N = scalePcs.length || 7;
    const rootIdx = scalePcs.indexOf(chordRootPc);
    const startIdx = rootIdx >= 0 ? rootIdx : 0;

    let backboneCount = 0;
    let hits = 0;
    for (let i = 0; i < motif.length; i++) {
        const m = motif[i];
        const beatPos = ((m.t % 4) + 4) % 4;
        const isStrong = Math.abs(beatPos) < 0.05 || Math.abs(beatPos - 2) < 0.05;
        const isLong = m.d >= 1.5;
        const isLast = i === motif.length - 1;
        if (!(isStrong || isLong || isLast)) continue;
        backboneCount++;

        let pc: number;
        if ('chromaticOffset' in m) {
            pc = ((chordRootPc + m.chromaticOffset) % 12 + 12) % 12;
        } else {
            const targetIdx = ((startIdx + m.diatonicStep) % N + N) % N;
            pc = scalePcs[targetIdx];
        }
        if (targets.has(pc)) hits++;
    }
    return backboneCount > 0 ? hits / backboneCount : 0;
}

/**
 * 抽自 mg.Engine.findClosestCrossChordPair (原 L3130-3154)。
 * 跨 chord voice-leading 最近 pc 对(currChord.literal ↔ nextChord.literal,
 * 最小 mod-12 距离)。tiebreak:pcA 更接近 anchorPc 的优先。
 */
export function findClosestCrossChordPair(
    currChord: ChordDef,
    nextChord: ChordDef,
    anchorPc: number = -1,
): { pcA: number; pcB: number; distance: number } {
    const aLit = CHORD_TYPES[currChord.type] || [0, 4, 7];
    const bLit = CHORD_TYPES[nextChord.type] || [0, 4, 7];
    const aRoot = (((currChord.rootMidi % 12) + 12) % 12);
    const bRoot = (((nextChord.rootMidi % 12) + 12) % 12);
    const aPcs = aLit.map(iv => (aRoot + iv) % 12);
    const bPcs = bLit.map(iv => (bRoot + iv) % 12);
    let best = { pcA: aPcs[0], pcB: bPcs[0], distance: 99, anchorDist: 99 };
    for (const a of aPcs) {
        for (const b of bPcs) {
            const d = Math.min(((a - b + 12) % 12), ((b - a + 12) % 12));
            const ad = anchorPc >= 0
                ? Math.min(((a - anchorPc + 12) % 12), ((anchorPc - a + 12) % 12))
                : 0;
            if (d < best.distance || (d === best.distance && ad < best.anchorDist)) {
                best = { pcA: a, pcB: b, distance: d, anchorDist: ad };
            }
        }
    }
    return { pcA: best.pcA, pcB: best.pcB, distance: best.distance };
}

/**
 * 抽自 mg.Engine.estimateMotifShapeMetrics (原 L3317-3362)。
 * 计算 motif 三个 shape metrics:
 *   vlInHit   — 第一个 structural pc ∈ vlIn(common tone w/ 前 chord)
 *   vlOutHit  — 最后 structural pc ∈ vlOut(common tone w/ 后 chord)
 *   variety   — distinct structural pcs / total structural(0-1)
 */
export function estimateMotifShapeMetrics(
    motif: any[],
    chord: ChordDef,
    runScale: number[],
    vlIn: Set<number> | null,
    vlOut: Set<number> | null,
): { vlInHit: number; vlOutHit: number; variety: number } {
    if (motif.length === 0) return { vlInHit: 0, vlOutHit: 0, variety: 0 };
    const chordRootPc = (((chord.rootMidi % 12) + 12) % 12);
    const scalePcs = Array.from(new Set(runScale.map(x => ((x%12)+12)%12))).sort((a,b)=>a-b);
    const N = scalePcs.length || 7;
    const rootIdx = scalePcs.indexOf(chordRootPc);
    const startIdx = rootIdx >= 0 ? rootIdx : 0;

    const projectPc = (m: any): number => {
        if ('chromaticOffset' in m) {
            return ((chordRootPc + m.chromaticOffset) % 12 + 12) % 12;
        }
        const targetIdx = ((startIdx + m.diatonicStep) % N + N) % N;
        return scalePcs[targetIdx];
    };

    const structPcs: number[] = [];
    let firstStructPc = -1;
    let lastStructPc = -1;
    for (let i = 0; i < motif.length; i++) {
        const m = motif[i];
        const beatPos = ((m.t % 4) + 4) % 4;
        const isStrong = Math.abs(beatPos) < 0.05 || Math.abs(beatPos - 2) < 0.05;
        const isLong = m.d >= 1.5;
        const isLast = i === motif.length - 1;
        if (!(isStrong || isLong || isLast)) continue;
        const pc = projectPc(m);
        structPcs.push(pc);
        if (firstStructPc < 0) firstStructPc = pc;
        lastStructPc = pc;
    }

    const vlInHit = (vlIn && firstStructPc >= 0 && vlIn.has(firstStructPc)) ? 1 : 0;
    const vlOutHit = (vlOut && lastStructPc >= 0 && vlOut.has(lastStructPc)) ? 1 : 0;
    const variety = structPcs.length > 0
        ? new Set(structPcs).size / structPcs.length
        : 0;
    return { vlInHit, vlOutHit, variety };
}

/**
 * 抽自 mg.Engine.getFillScaleForStyle (原 L3453-3492)。
 * 风格特定的 fill scale(用于 passing/connecting/run notes 的 nearest-neighbor
 * 填充)。fallbackRunScale 用于 fillMap 无匹配时回退。
 * BLUES 系 anchor 在 musicKey(blue notes 跨 12-bar form 持续);其他 anchor 在 chord root。
 */
export function getFillScaleForStyle(
    style: StyleName,
    chord: ChordDef,
    func: 'T' | 'S' | 'D',
    musicKey: string,
    _musicMode: string | undefined,
    fallbackRunScale: number[],
): number[] {
    const profile = STYLE_DICTIONARY[style];
    const fillMap = profile.fillScales?.[func];
    if (!fillMap) return fallbackRunScale;

    let scaleNames: string[] | undefined = fillMap[chord.type];
    if (!scaleNames || scaleNames.length === 0) {
        const t = chord.type;
        if (t.includes('maj')) scaleNames = fillMap['maj7'] || fillMap['maj'];
        else if (t.startsWith('m') && !t.startsWith('maj')) scaleNames = fillMap['m7'] || fillMap['min'] || fillMap['m'];
        else if (t.includes('7') || t.includes('9') || t.includes('13')) scaleNames = fillMap['7'];
        else scaleNames = fillMap['maj'];
    }
    if (!scaleNames || scaleNames.length === 0) return fallbackRunScale;

    const scaleName = scaleNames[0];
    const intervals = SCALE_TYPES[scaleName];
    if (!intervals) return fallbackRunScale;

    const isBluesFamily = /Blues|Pentatonic/.test(scaleName);
    const rootM = (style === 'BLUES' && isBluesFamily)
        ? noteToMidi(musicKey + "3")
        : chord.rootMidi;

    const midiScale: number[] = [];
    for (let oct = -2; oct <= 3; oct++) {
        intervals.forEach(iv => midiScale.push(rootM + (oct * 12) + iv));
    }
    return midiScale.sort((a, b) => a - b);
}

/**
 * 抽自 mg.Engine.getScaleForStyle (原 L3494-3711,~218 行最大方法)。
 * 风格特定的 run scale(melody 主用 scale)。
 *
 * 流程:
 *   1. Diatonic-mode-of-key 快速路径:chord 完全 diatonic 于 key → 用 key palette(非 BLUES)
 *   2. Style-specific scale 候选池(profile.scaleMapping)+ secondary dominant 借用规则
 *   3. Style preference + key compatibility 评分,选最佳 scale
 *   4. BLUES blue-note family / exotic mode 用 key root anchor;其他用 chord root anchor
 */
export function getScaleForStyle(
    style: StyleName,
    chord: ChordDef,
    func: 'T' | 'S' | 'D',
    musicKey: string,
    musicMode?: string,
): number[] {
    const profile = STYLE_DICTIONARY[style] || STYLE_DICTIONARY['POP'];
    const mapping = profile.scaleMapping[func];

    const modeName = (musicMode && musicMode in SCALE_TYPES)
        ? musicMode
        : 'Ionian';
    if (style !== 'BLUES') {
        const keyRootPc = (((noteToMidi(musicKey + "0") % 12) + 12) % 12);
        const modeIntervals = SCALE_TYPES[modeName];
        const keyPcs = new Set(modeIntervals.map(iv => (keyRootPc + iv) % 12));
        const chordRootPc = (((chord.rootMidi % 12) + 12) % 12);
        const chordIntervals = CHORD_TYPES[chord.type] || [];
        const chordPcs = chordIntervals.map(iv => (chordRootPc + iv) % 12);
        const chordIsDiatonic = keyPcs.has(chordRootPc)
            && chordPcs.every(pc => keyPcs.has(pc));
        if (chordIsDiatonic) {
            const intervalsFromChordRoot: number[] = [];
            for (let iv = 0; iv < 12; iv++) {
                if (keyPcs.has((chordRootPc + iv) % 12)) {
                    intervalsFromChordRoot.push(iv);
                }
            }
            const midiScale: number[] = [];
            for (let oct = -2; oct <= 3; oct++) {
                intervalsFromChordRoot.forEach(iv => {
                    midiScale.push(chord.rootMidi + (oct * 12) + iv);
                });
            }
            return midiScale.sort((a, b) => a - b);
        }
    }

    let preferences = profile.scalePreference || [];
    if (musicMode && profile.globalMelodyScaleMapping && profile.globalMelodyScaleMapping[musicMode]) {
        preferences = profile.globalMelodyScaleMapping[musicMode];
    }

    const isExoticMode = !!musicMode && musicMode in SCALE_TYPES
        && !['Ionian', 'Aeolian', 'Major', 'Minor', 'Major Blues', 'Minor Blues'].includes(musicMode);
    if (isExoticMode) {
        preferences = [musicMode!, ...preferences];
    }

    let scaleChoices: string[] = [];

    if (mapping[chord.type]) {
        scaleChoices = mapping[chord.type];
    } else if (chord.type.includes('maj') && mapping['maj']) {
        scaleChoices = mapping['maj'];
    } else if (chord.type.includes('7') && mapping['7']) {
        scaleChoices = mapping['7'];
    } else if (chord.type.includes('min') && mapping['min']) {
        scaleChoices = mapping['min'];
    }

    if (chord.roman.includes('/')) {
        const [src, target] = chord.roman.split('/');
        if (src.startsWith('subV')) {
            scaleChoices = ['Lydian Dominant', 'Altered'];
        } else if (/^(V|VII)/.test(src) && target) {
            const targetIsMinor = target === target.toLowerCase()
                || ['ii', 'iii', 'vi', 'iv'].includes(target);
            scaleChoices = targetIsMinor
                ? ['Phrygian Dominant', 'Altered', 'Harmonic Minor']
                : ['Mixolydian', 'Lydian Dominant'];
        }
    }

    if (scaleChoices.length === 0) {
        if (chord.type.includes('m') && !chord.type.includes('maj')) scaleChoices = ['Dorian', 'Aeolian'];
        else if (chord.type.includes('dim') || chord.type.includes('b5')) scaleChoices = ['Locrian'];
        else if (chord.type.includes('7') && !chord.type.includes('maj')) scaleChoices = ['Mixolydian'];
        else scaleChoices = ['Ionian', 'Lydian'];
    }

    if (isExoticMode && !scaleChoices.includes(musicMode!)) {
        scaleChoices = [musicMode!, ...scaleChoices];
    }

    let forcedExoticScale: string | null = null;
    if (isExoticMode) {
        forcedExoticScale = musicMode!;
    }

    const keyRootMidi = noteToMidi(musicKey + "0") % 12;
    const keyScaleIntervals = SCALE_TYPES['Ionian'];
    const keyPcs = new Set(keyScaleIntervals.map(i => (keyRootMidi + i) % 12));

    let bestScale = scaleChoices[0];
    let maxScore = -1;

    scaleChoices.forEach(scaleName => {
        let score = 0;
        if (preferences.includes(scaleName)) score += 5;

        const scaleIntervals = SCALE_TYPES[scaleName] || SCALE_TYPES['Ionian'];
        const chordRootMidi = chord.rootMidi % 12;
        const scalePcs = scaleIntervals.map(i => (chordRootMidi + i) % 12);
        const coincidence = scalePcs.filter(pc => keyPcs.has(pc)).length;
        score += coincidence;

        if (score > maxScore) {
            maxScore = score;
            bestScale = scaleName;
        }
    });

    const effectiveScale = forcedExoticScale ?? bestScale;
    const finalScaleIntervals = SCALE_TYPES[effectiveScale] || SCALE_TYPES['Ionian'];

    let rootM = chord.rootMidi;
    if (style === 'BLUES' && (effectiveScale === 'Blues' || effectiveScale === 'Major Blues' || effectiveScale === 'Minor Pentatonic' || effectiveScale === 'Major Pentatonic')) {
        rootM = noteToMidi(musicKey + "3");
    } else if (forcedExoticScale) {
        rootM = noteToMidi(musicKey + "3");
    }

    const midiScale: number[] = [];
    for (let oct = -2; oct <= 3; oct++) {
        finalScaleIntervals.forEach(interval => {
            midiScale.push(rootM + (oct * 12) + interval);
        });
    }
    return midiScale.sort((a,b) => a-b);
}

// ============================================================
// Phase 2 — 组 B PRNG 参数化(0 state 依赖,通过参数收 Random)
// ============================================================
//
// 这些 method 在 mg.Engine class 中通过 `this.random` 消耗 PRNG。抽离后改为接收
// `rng: Random` 参数,PRNG 调用顺序 verbatim 保持(D-5 锁帧)。
//
// callsite 改造方式:Engine class 内保留 method stub,内部 forward 到 free
// function,callsite 0 改动。Phase 5+ 删除 Engine class 时再把 callsite 直接换。
// ============================================================

/**
 * 抽自 mg.Engine.resolveMotifStrategy (原 L791-816)。
 * style 偏好驱动的 motif 策略选择(regular vs functional)+ interval 选择。
 *
 * PRNG 消耗:固定 3 次(strategy / enginePick / styleRule.N snap),
 * 第一次条件性多消耗 1 次(styleRule 存在时)。
 */
export function resolveMotifStrategy(
    config: GenerationConfig,
    r: Random,
): { motifStrategy: 'regular' | 'functional'; motifInterval: number } {
    const profile = STYLE_DICTIONARY[config.style];
    const styleRule = profile?.motifRepeatStrategy;

    let strategy: 'regular' | 'functional';
    if (styleRule && r.next() < 0.7) {
        strategy = styleRule.preferred;
    } else {
        strategy = r.next() < 0.5 ? 'regular' : 'functional';
    }

    const enginePick = 2 + Math.floor(r.next() * 7); // 2..8
    let interval = enginePick;
    if (styleRule?.N) {
        const [lo, hi] = styleRule.N.range;
        interval = Math.max(lo, Math.min(hi, enginePick));
        if (r.next() < 0.5) interval = styleRule.N.preferred;
    }

    return { motifStrategy: strategy, motifInterval: interval };
}

/**
 * 抽自 mg.Engine.generateMelodyPhrase (原 L2668-2753)。
 * style motif 库抽取,或 evaluator-driven random scaffold fallback。
 *
 * PRNG 消耗:有 motif 库时 1 次(pick);无库时变长(pattern.pick + range +
 * 每 step × 2 = 1 + 1 + 2N)。
 *
 * Evaluator-driven random fallback(无 motif 库时):
 *   生成 rhythmic scaffold + 随机 diatonic steps,downstream 评估器做音乐工作:
 *     - evaluateNoteInChordContext flags out-of-contract pitches
 *     - unified-tension-resolution 当 urgency ≥ 0.5 snap follow-up note
 *     - in-chord-contract 强制 structural-beat pitches 入 chord contract
 *     - cadence resolution 按 Tier 重写 phrase-end last notes
 *     - leading-tone-on-V cross-check 把 B-on-G7 升为 tension
 *   即使 raw 随机,emit melody 仍尊重 chord context;质量上限由评估器决定,非 motif 设计。
 *
 * RHYTHM_PATTERNS 偏好 8th / 16th:isStructural 在 strong-beat OR duration ≥ 1.5
 *   时触发 — 长音过多 → structural 位置过多 → in-chord-contract 把它们 snap 到
 *   chord literal → same-PC clusters。8ths 介于强拍 → 作 passing tones 通过。
 *
 * Random walk 步幅 ±2..±5(无 ±0/±1):投影 pitch 落得远 → chord-tone snap 分散
 *   到多 chord 位置,而不是塌缩到最近的;否则多个 stepwise step snap 到同 chord-tone
 *   → same-PC clusters。
 *
 * Reflection(BLUES audit 教训):clamp 在 [0,9] 边界会让 step 在 9 或 0 堆积
 *   (e.g. step=8 +5 → clamp 9, then 9 +5 → clamp 9)→ 3+ 连续相同 diatonicStep
 *   投影同 MIDI("F-F-F-F" 卡块,L4.66/5.00/5.66 全 MIDI 81)。Reflection 把
 *   overshoot 翻为真实方向反转 → walk 继续运动。
 */
export function generateMelodyPhrase(style: StyleName, rng: Random): any[] {
    const phrases = STYLE_DICTIONARY[style]?.motifs || STYLE_DICTIONARY['POP'].motifs;
    if (!phrases || phrases.length === 0) {
        const RHYTHM_PATTERNS: number[][] = [
            [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],          // straight 8ths
            [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1],                 // 8ths + tail quarter
            [0.5, 0.5, 1, 0.5, 0.5, 1],                        // 8-8-Q-8-8-Q
            [0.25, 0.25, 0.5, 0.5, 0.5, 0.5, 0.5, 1],          // 16th opener
            [1, 0.5, 0.5, 0.5, 0.5, 1],                        // Q-8-8-8-8-Q
            [0.5, 0.5, 0.5, 0.5, 2],                           // 8ths + half rest
            [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1.5],               // breath ending
            [0.25, 0.25, 0.25, 0.25, 0.5, 0.5, 2],             // 16ths gathering
        ];
        const pattern = rng.pick(RHYTHM_PATTERNS);
        const motif: any[] = [];
        let t = 0;
        let step = rng.range(0, 9);
        for (const d of pattern) {
            motif.push({ t, d, diatonicStep: step });
            // BLUES leans on stepwise lick flow(±1/±2);其他 style 用宽跳
            // (±2..±5)分散到 chord-tone snap basin。
            const moves = style === 'BLUES'
                ? [-2, -2, -2, -1, -1, -1, -1, 1, 1, 1, 1, 2, 2, 2]
                : [-5, -4, -3, -3, -2, -2, 2, 2, 3, 3, 4, 5];
            const delta = rng.pick(moves);
            // Reflect off [0, 9] boundary 而非 clamp(见 jsdoc 注释 Reflection 段)。
            let newStep = step + delta;
            if (newStep > 9) newStep = 9 - (newStep - 9);
            if (newStep < 0) newStep = -newStep;
            step = Math.max(0, Math.min(9, newStep));
            t += d;
        }
        return motif;
    }
    const picked = rng.pick(phrases);
    // Unwrap MotifDef wrappers — downstream pipeline expects raw note arrays.
    return Array.isArray(picked) ? picked : (picked as { notes: any[] }).notes;
}

/**
 * 抽自 mg.Engine.deriveDevelopmentMotif (原 L3240-3286)。
 * 3 分支:Inversion(<0.34)/ Late entry(<0.67)/ Truncation(else)。
 *
 * PRNG 消耗:固定 1 次(分支判别)。
 *
 * - Inversion: 镜像 diatonicSteps / chromaticOffsets 围绕首音值;首音不动,其余
 *   每音对首音的 interval 取反。
 * - Late entry(subtle lay-back): 原版 0.5 拍 shift 在 120bpm 下 250ms drag,大到
 *   velocity-accent check(m.t % 1 === 0)在原弱拍触发 → 听感"错拍 accent"。
 *   降到 32 分(0.125 beats ≈ 60ms @ 120bpm)— 微 soul lay-back,不破 grid 对齐。
 *   超出 4-beat bar 的音被 drop。
 * - Truncation with rest: 保留前半数音,其余 drop;bar 剩余 reads as silence
 *   (rhythm builder 后台继续,melody 是"喘口气"的)。
 */
export function deriveDevelopmentMotif(currentMotif: any[], rng: Random): any[] {
    if (currentMotif.length === 0) return [];
    const r = rng.next();

    if (r < 0.34) {
        const first = currentMotif[0];
        const baseDia = ('diatonicStep' in first) ? first.diatonicStep : 0;
        const baseChrom = ('chromaticOffset' in first) ? first.chromaticOffset : 0;
        return currentMotif.map((n, i) => {
            const out: any = { ...n };
            if (i === 0) return out;
            if ('diatonicStep' in n) {
                out.diatonicStep = baseDia - (n.diatonicStep - baseDia);
            } else if ('chromaticOffset' in n) {
                out.chromaticOffset = baseChrom - (n.chromaticOffset - baseChrom);
            }
            return out;
        });
    }

    if (r < 0.67) {
        const shift = 0.125;
        const shifted = currentMotif
            .map(n => ({ ...n, t: n.t + shift }))
            .filter(n => n.t < 4 && n.t + n.d <= 4);
        if (shifted.length === 0) {
            return [{ ...currentMotif[currentMotif.length - 1], t: 3.5, d: 0.5 }];
        }
        return shifted;
    }

    const keepCount = Math.max(1, Math.ceil(currentMotif.length / 2));
    return currentMotif.slice(0, keepCount).map(n => ({ ...n }));
}

/**
 * 抽自 mg.Engine.motifMutator (原 L1046-1117)。
 * Style/density/complexity 驱动的 motif 调制(Jazz chromatic approach / Pop
 * stutter / Pop legato),末尾 QUANTIZED_DURATIONS 量化。
 *
 * PRNG 消耗:逐 step 变长 — 每 step 最多 2 次(chromatic gate / direction or
 * stutter gate or legato gate)。
 *
 * 三档 style 调制:
 *   - 爵士调制 / R&B(JAZZ + complexity>0.6): 在 gap ≥ 0.5 拍处插入半音 approach
 *     (小二度趋近 next)。
 *   - Funk / 电子(POP + density>0.7): 长音 [d=1] 切割为 [d=0.25, 休止, t+0.5 d=0.25]
 *     的 stutter 模式。
 *   - Pop Ballad(POP + density<0.5): legato 连音 — 把当前音 d 拉满到下一音起拍。
 *
 * 末尾 QUANTIZED_DURATIONS 量化:snap d 到标准乐理时值(16th / 8th / dotted-8th /
 * 1/4 / dotted-1/4 / 1/2 / dotted-1/2 / 全音符),不让 sub-style motif 或
 * deriveDevelopmentMotif 的 diminution 算术输出 1.25 / 2.5 这类非标准值。
 * 最小值 0.25(16th)— 更短听感"碎裂"而非"节奏"。
 *
 * 注:`isShuffle` 当前 method body 未消费,签名保留作未来 shuffle 调制扩展点。
 */
export function motifMutator(
    motif: any[],
    style: StyleName,
    density: number,
    complexity: number,
    isShuffle: boolean,
    rng: Random,
): any[] {
    void isShuffle;
    let mutated: any[] = [];
    const len = motif.length;

    for (let i = 0; i < len; i++) {
        const v = motif[i];
        const next = motif[i + 1];
        const gap = next ? (next.t - (v.t + v.d)) : (4 - (v.t + v.d));

        mutated.push({ ...v });

        // 爵士调制 / R&B 调制:包围音与半音经过音
        if (style === 'JAZZ' && complexity > 0.6) {
            if (gap >= 0.5 && rng.next() < (complexity * 0.8)) {
                const targetOffset = next ? (next.chromaticOffset ?? (next.diatonicStep * 2)) : (v.chromaticOffset ?? (v.diatonicStep * 2));
                mutated.push({
                    t: (next ? next.t : 4) - 0.25,
                    d: 0.25,
                    chromaticOffset: targetOffset + (rng.next() > 0.5 ? 1 : -1)
                });
            }
        }

        // Funk 调制 / 电子调制:时值碎片化/Stutter 切割
        if (style === 'POP' && density > 0.7) {
            if (v.d >= 0.75 && rng.next() < (density * 0.8)) {
                const newMutated = [...mutated];
                const last = newMutated[newMutated.length - 1];
                last.d = 0.25;
                newMutated.push({
                    t: last.t + 0.5,
                    d: 0.25,
                    ...('diatonicStep' in last ? { diatonicStep: last.diatonicStep } : { chromaticOffset: last.chromaticOffset })
                });
                mutated = newMutated;
            }
        }

        // Pop Ballad:平滑连音(Legato stretch)
        if (style === 'POP' && density < 0.5) {
            if (gap > 0.1 && gap < 1.0 && rng.next() > 0.5) {
                mutated[mutated.length - 1].d += gap;
            }
        }
    }

    for (const n of mutated) {
        n.d = QUANTIZED_DURATIONS.reduce((best, v) =>
            Math.abs(v - n.d) < Math.abs(best - n.d) ? v : best,
            QUANTIZED_DURATIONS[0]
        );
    }
    return mutated;
}

/**
 * 抽自 mg.Engine.decorateChordType (原 L837-975)。
 * 8-step decision pipeline 把骨架 chord(roman + type + rootOffset)的 type
 * 升级为色彩化版本(maj7 / 9 / 13 / altered / sub-V 等)。
 *
 * 算法流(逐 step):
 *   1. Roll colorLevel(单次 random.next,总是消耗 — D-5 锁帧保护)
 *   2. Look-ahead 分析:用 next chord 决定 targetQuality
 *   3. Dynamic TSD dictionary 查表(POP/JAZZ/BLUES/RNB 直查,与 StyleName 1-1 对应)
 *   4. Tritone substitution 条件 random(仅 currFunc=='D' + 上行五度时消耗 — D-5
 *      保证当且仅当替换 eligible 时漂移)
 *   5. 静态 fallback 到 colorChoices(动态字典 miss 时)
 *   6. Mode-aware 审核:filter pickFrom 到 mode 内可用 type;sub-V 与 V/X 跳过
 *      filter(V/X by definition non-diatonic;sub-V 故意外 palette)
 *   7. Data-debt guard:final type 不在 CHORD_TYPES 时按 func 降级到安全 type
 *   8. Sub-V override:Lydian Dominant family 静态查 colorLevel,override
 *      rootOffset(+6 半音)+ roman(subV/X);Stage 3 Divisi 2.0 middleware 看新
 *      物理 bass 重分类
 *
 * PRNG 消耗:固定 1 次(colorLevel)+ 1 次(pick finalType);条件 1 次(tritone)。
 *
 * 调用者 callsite 唯一(realizeProgression),不会被多线程并发。
 */
export function decorateChordType(
    base: { roman: string; type: string; rootOffset: number; scaleDegree?: number },
    nextBase: { roman: string; type: string; rootOffset: number; scaleDegree?: number },
    style: StyleName,
    mode: string,
    rng: Random,
): {
    type: string;
    rootOffsetOverride?: number;
    romanOverride?: string;
} {
    const profile = STYLE_DICTIONARY[style] || STYLE_DICTIONARY['POP'];
    const probs = profile.colorLevelProbabilities;

    // 1. Roll colorLevel — 单次 random.next 总是消耗
    const r = rng.next();
    let colorLevel: 0 | 1 | 2 = 0;
    if (r < probs.level0) colorLevel = 0;
    else if (r < probs.level0 + probs.level1) colorLevel = 1;
    else colorLevel = 2;

    const currFunc = harmonicFunctionFromRoman(base.roman);
    const nextFunc = harmonicFunctionFromRoman(nextBase.roman);

    // 2. Look-ahead context analysis
    const targetQuality = analyzeTargetQuality(currFunc, nextFunc, nextBase.roman, nextBase.type);

    // 3. Dynamic dictionary lookup
    const rules = DYNAMIC_TSD_DICTIONARY[style]?.[currFunc];
    let choices: string[] | undefined;
    let isTritoneSub = false;

    if (rules) {
        const rule = rules.find(rl => rl.target === targetQuality)
            ?? rules.find(rl => rl.target === 'Default');
        if (rule && rule.levels[colorLevel]) {
            choices = rule.levels[colorLevel];

            // 4. Tritone substitution gate(D-5:仅在真正 eligible 时消耗 random)
            if (rule.tritoneProb && currFunc === 'D' && targetQuality !== 'Deceptive') {
                const rootDelta = (((nextBase.rootOffset - base.rootOffset) % 12) + 12) % 12;
                if (rootDelta === 5 && rng.next() < rule.tritoneProb) {
                    isTritoneSub = true;
                }
            }
        }
    }

    // 5. Static fallback
    if (!choices || choices.length === 0) {
        const choicesMap = profile.colorChoices || STYLE_DICTIONARY['POP'].colorChoices!;
        const romanBase = base.roman.split('/')[0].replace(/maj7|m7|7|maj9|m9|7sus4|b/g, '');
        let staticChoices = choicesMap[base.roman] || choicesMap[romanBase];

        if (!staticChoices) {
            const isMinor = base.type === 'min'
                || (base.type.startsWith('m') && !base.type.startsWith('maj'))
                || base.roman === base.roman.toLowerCase();
            if (currFunc === 'D') staticChoices = choicesMap['V'];
            else if (currFunc === 'S') staticChoices = isMinor ? choicesMap['ii'] : choicesMap['IV'];
            else staticChoices = isMinor ? choicesMap['vi'] : choicesMap['I'];
        }
        choices = staticChoices?.[colorLevel] ?? [base.type];
    }

    // 6. Mode-aware audit — sub-V / V/X 跳过
    const isSecondaryDom = base.roman.includes('/');
    let pickFrom = choices;
    if (base.scaleDegree !== undefined && !isTritoneSub && !isSecondaryDom) {
        const filtered = getModeAwareSubstitutions(pickFrom, mode, base.scaleDegree);
        pickFrom = filtered.length > 0 ? filtered : choices;
    }
    // V/X:filter sus4(sus4 会替换 borrowed major 3rd → 完全 diatonic → engine
    // 选 diatonic fast path → borrow 失效)。强制 major-3rd dom 保 borrow identity。
    if (isSecondaryDom) {
        const noSus = pickFrom.filter(t => !/sus/.test(t));
        pickFrom = noSus.length > 0 ? noSus : ['7'];
    }

    let finalType = rng.pick(pickFrom);

    // 7. Data-debt guard
    if (!CHORD_TYPES[finalType]) {
        if (currFunc === 'D') finalType = '7';
        else if (currFunc === 'S') finalType = targetQuality === 'MinorTarget' ? 'm7' : 'maj7';
        else finalType = targetQuality === 'MinorTarget' ? 'min' : 'maj';
    }

    // 8. Sub-V override — Lydian Dominant family
    if (isTritoneSub) {
        let subVType: string;
        if (colorLevel === 0) subVType = '7';
        else if (colorLevel === 1) subVType = '9';
        else subVType = targetQuality === 'MinorTarget' ? '7#11' : '13';

        return {
            type: subVType,
            rootOffsetOverride: ((base.rootOffset + 6) % 12 + 12) % 12,
            romanOverride: `subV/${nextBase.roman.split('/')[0]}`,
        };
    }

    return { type: finalType };
}

/**
 * 抽自 mg.Engine.generateProgression (原 L977-1029)。
 * 从 style.progressions[mode] 抽一条骨架,展开到 bars 长,逐 bar 调
 * decorateChordType 做 look-ahead 色彩化。
 *
 * Fallback 链:mode 直查 → modeProgressionTemplate 路由 → defaultMode → 内置三和弦默认。
 *
 * Skeletons 做 shallow copy — 防止 bar i 的 look-ahead override 通过共享 ref
 * 污染 bar i+1 的 lookup。
 *
 * Look-ahead 注释:每 bar consult next bar(ring index 处理 song 末尾)→ chord-type
 * 选择能 idiomatically voice-lead 到下个 chord。Sub-V tritone substitution 可能
 * 改写 rootOffset / roman;shallow copy 吸收 override,下游 realizeProgression
 * 看到的是 substituted bass anchor。
 *
 * PRNG 消耗:1 次(pick progressions)+ N 次 × decorateChordType 内部消耗
 * (每 bar 1-3 次)。
 */
export function generateProgression(style: StyleName, bars: number, mode: string, rng: Random): any[] {
    const profile = STYLE_DICTIONARY[style];
    let progressions = profile?.progressions?.[mode];

    // Exotic-mode fallback
    if (!progressions) {
        const template = modeProgressionTemplate(mode);
        progressions = profile?.progressions?.[template];
    }

    // Style-default fallback
    if (!progressions) {
        const defaultMode = profile?.defaultMode || 'Major';
        progressions = profile?.progressions?.[defaultMode];
    }

    if (!progressions) {
        // Ultimate fallback if dictionary is somehow empty
        progressions = [
            [{ roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }, { roman: 'IV', type: 'maj', scaleDegree: 4, rootOffset: 5 }, { roman: 'V', type: 'maj', scaleDegree: 5, rootOffset: 7 }, { roman: 'I', type: 'maj', scaleDegree: 1, rootOffset: 0 }]
        ];
    }

    const chosen = rng.pick(progressions);
    const skeletons: any[] = [];
    for (let i = 0; i < bars; i++) {
        skeletons.push({ ...chosen[i % chosen.length] });
    }

    return skeletons.map((skel, i) => {
        const nextSkel = skeletons[(i + 1) % skeletons.length];
        const deco = decorateChordType(skel, nextSkel, style, mode, rng);
        return {
            ...skel,
            type: deco.type,
            ...(deco.rootOffsetOverride !== undefined ? { rootOffset: deco.rootOffsetOverride } : {}),
            ...(deco.romanOverride !== undefined ? { roman: deco.romanOverride } : {}),
        };
    });
}

/**
 * 抽自 mg.Engine.resolveGeneration (原 L707-786)。
 * Song-level decision resolver:emotion / mode / motifStrategy / basslineRule /
 * meter / tonalCharacter 一次性 resolve 出来给下游 pipeline。
 *
 * PRNG 来源:**自带** `new Random(\`${config.seed}::emotion\`)` — 不接外部 rng
 * 参数。Engine class 内调用时也是如此(method body 第一行 new Random)。
 * 因此本函数虽属"组 B PRNG-aware",但语义上更像 Group A 的"自带 RNG"模式。
 *
 * 决策流:
 *   1. Meter resolved up-front:config.meter > style.timeSignature > [4,4] fallback
 *   2. Direct mode override(snapshot tests / 高级 caller 用 config.mode 直接指定)
 *      → 仍消耗 motifStrategy + basslineRule 的 PRNG(D-5 stream 不动)
 *   3. emotion 分支:auto → 50/50;固定 emotion 跳过 PRNG(但 exotic-gate 仍消耗)
 *   4. Exotic gate:总是 r.next() 消耗(EXOTIC_MODE_PROBABILITY 调参不破 stream)
 *   5. BLUES 例外:mainstream mode 用 Major Blues / Minor Blues(非 Ionian/Aeolian),
 *      因 BLUES 风格只在 blues 音阶 (1 b3 3 4 b5 5 b7) 上有意义,Ionian 抹平所有 blue notes
 *   6. resolveMotifStrategy(extracted)+ pickBasslineRule 消耗剩余 PRNG
 *   7. tonalCharacter 由 style + mode 决定(BLUES / 非主流 mode → modal,否则 tonal)
 *
 * PRNG 消耗(`r` 内部 stream):
 *   - direct mode 路径:0 次(emotion 短路)+ motifStrategy(3-4)+ basslineRule(0-1)
 *   - auto emotion + exotic gate:1(emotion auto)+ 1(exotic gate)+ 1(exotic pick)
 *     + motifStrategy + basslineRule
 *   - 固定 emotion + 非 exotic:1(exotic gate)+ motifStrategy + basslineRule
 */
export function resolveGeneration(config: GenerationConfig): ResolvedGenerationContext {
    // emotion fork:song-level decisions 共用一条 deterministic chain
    const r = new Random(`${config.seed}::emotion`);

    const meterCtx = getMeterContext(
        config.meter ?? STYLE_DICTIONARY[config.style]?.timeSignature ?? [4, 4],
    );

    // Direct override(snapshot tests / 高级 caller)
    if (config.mode) {
        const mode = config.mode;
        const known = mode in SCALE_TYPES;
        const isMainstream = mode === MAINSTREAM_EMOTION_TO_MODE.bright
                          || mode === MAINSTREAM_EMOTION_TO_MODE.sad
                          || mode === 'Major' || mode === 'Minor'
                          || mode === 'Major Blues' || mode === 'Minor Blues';
        const motif = resolveMotifStrategy(config, r);
        const basslineRule = pickBasslineRule(STYLE_DICTIONARY[config.style]?.basslineRules, r);
        return {
            mode,
            emotion: MAJOR_FLAVOR_MODES.includes(mode) || mode === 'Major' ? 'bright' : 'sad',
            isExotic: known && !isMainstream,
            ...motif,
            basslineRule,
            meter: meterCtx.meter,
            meterContext: meterCtx,
            tonalCharacter: resolveTonalCharacter(config.style, mode),
        };
    }

    const requested = config.emotion ?? 'auto';
    const finalEmotion: Emotion = requested === 'auto'
        ? (r.next() < 0.5 ? 'bright' : 'sad')
        : requested;

    let mode: string;
    let isExotic: boolean;
    // Exotic-gate 总是消耗 PRNG(EXOTIC_MODE_PROBABILITY 调参不破 stream)
    const exoticRoll = r.next();
    if (exoticRoll < EXOTIC_MODE_PROBABILITY) {
        mode = r.pick(EXOTIC_MODES as string[]);
        isExotic = true;
    } else {
        // BLUES 例外:mainstream mode 是 Major Blues / Minor Blues(blue notes 关键)
        if (config.style === 'BLUES') {
            mode = finalEmotion === 'bright' ? 'Major Blues' : 'Minor Blues';
        } else {
            mode = MAINSTREAM_EMOTION_TO_MODE[finalEmotion];
        }
        isExotic = false;
    }

    const motif = resolveMotifStrategy(config, r);
    const basslineRule = pickBasslineRule(STYLE_DICTIONARY[config.style]?.basslineRules, r);
    return {
        emotion: finalEmotion,
        mode,
        isExotic,
        ...motif,
        basslineRule,
        meter: meterCtx.meter,
        meterContext: meterCtx,
        tonalCharacter: resolveTonalCharacter(config.style, mode),
    };
}

/**
 * 抽自 mg.Engine.realizeProgression (原 L894-1409,515 行)。
 *
 * 把 abstract chord path(generateProgression 输出)展开为完整 ChordDef[](含
 * voicing / bass / 极性化的 chordSymbol / Divisi 2.0 harmonicState / modal
 * borrowing / sub-V slash 处理)。Stage G 的 voicing pipeline 顶配版。
 *
 * Voicing pipeline(Stage G refactor):
 *   1. BASS first(G5 prep):bassline rule 决定 bass MIDI;必须先于 voicing
 *      因为 G3 placeVoicingMidi 需要 bass 位置来 enforce 8-14 semitone
 *      "sweet spot" gap。
 *   2. PCS selection(G2):existing style voicing tables(JAZZ_ROOTLESS / POP /
 *      BLUES / RNB)优先 — encode Stage B 手调 Bill Evans / Glasper 知识;
 *      miss 时 assembleVoicing 走 aesthetic table + clash arbitration
 *      (修 POP V7b13 等 altered cases)。
 *   3. MIDI placement(G3):placeVoicingMidi multi-objective brute-force
 *      搜索匹配 preferredRegister + bass distance constraint + voice-leading
 *      (修 84% mid-range tenor-gap)。
 *
 * Structural root-anchor(audit 修正后):bar 0 / phrase boundary / cadential
 * landing 三种条件触发强制 root anchor;否则走 ruleFn(stepwise_descent 等)。
 * 修复前 RNB / JAZZ-minor 78.9% non-Solid,8/8 seeds affected。
 *
 * V/X 副属和弦专属 bass pattern(老师 4):
 *   - (a) 跳进式:root → 3rd 转位切换(beat 0-1 / 2-3)
 *   - (b) Walk-up:root → 3rd → 5th → leading(next chord root - 1)
 *   PRNG 0.5 gate 选 a/b。
 *
 * 末尾两 pass roman label sync:
 *   - Pass 1:major-quality type → uppercase / minor / dim → lowercase
 *     (cosmetic only — UI label 与 audible chord 对齐)
 *   - Pass 2:subV/X 用 X 的 synced label(deferred 到 Pass 1 完成后)
 *
 * PRNG 消耗:
 *   - 每 bar:2 次条件(POP maj / min add9 swap)+ 1 次条件(secondary dom
 *     bass mode 0.5 gate)
 *   - 每 bar(非 forceRootAnchor 路径):bassline ruleFn 内消耗(可变)
 *   - 每 bar(bassPattern 路径):BASS_PATTERN_RULES rule 内消耗(可变)
 */
export function realizeProgression(
    abstractPath: any[],
    key: string,
    style: StyleName,
    ctx: ResolvedGenerationContext,
    rng: Random,
): ChordDef[] {
    const keyIndex = Math.max(0, KEYS.indexOf(key));
    const isMinorKey = modeToKeyFamily(ctx.mode) === 'minor';
    const degreeOffsets: Record<string, number> = {
        'I': 0, 'ii': 2, 'iii': 4, 'IV': 5, 'V': 7, 'vi': 9, 'vii': 11
    };

    const parsedChords: ChordDef[] = [];

    abstractPath.forEach((ap, apIdx) => {
        let rootOffset = 0;
        let activeType = ap.type;

        if (ap.rootOffset !== undefined) {
            rootOffset = ap.rootOffset;
        } else if (ap.roman.includes('/')) {
            const [chordPart, targetPart] = ap.roman.split('/');
            const targetOffset = degreeOffsets[targetPart] || 0;
            if (chordPart === 'V') {
                rootOffset = (targetOffset + 7) % 12;
            } else if (chordPart === 'iim7') {
                rootOffset = (targetOffset + 2) % 12;
            } else if (chordPart === 'V7') {
                rootOffset = (targetOffset + 7) % 12;
            }
        } else {
            const baseRoman = ap.roman.replace(/maj7|m7|7|maj9|m9|7sus4|b/, '');
            if (ap.roman.startsWith('bVII')) {
                rootOffset = 10;
            } else {
                rootOffset = degreeOffsets[baseRoman] !== undefined ? degreeOffsets[baseRoman] : 0;
            }
        }

        if (style === 'POP' && activeType === 'maj') activeType = rng.next() > 0.5 ? 'add9' : 'maj';
        if (style === 'POP' && activeType === 'min') activeType = rng.next() > 0.5 ? 'm7' : 'min';

        const rootKeyIndex = (keyIndex + rootOffset) % 12;
        const rootName = spellPcInKey(rootKeyIndex, keyIndex, isMinorKey);
        const intervals = CHORD_TYPES[activeType] || CHORD_TYPES['maj'];

        // Step 1: pcs selection
        const compingMode = STYLE_DICTIONARY[style]?.compingVoicingMode ?? 'shell';
        const stylePref: VoicingStylePreference =
            compingMode === 'rootless' ? STYLE_ROOTLESS :
            compingMode === 'cluster'  ? STYLE_CLUSTER  :
            compingMode === 'full'     ? STYLE_FULL     :
            compingMode === 'blues'    ? STYLE_BLUES    :
            STYLE_SHELL;

        const overrideTable: Record<string, number[]> | null =
            compingMode === 'rootless' ? JAZZ_ROOTLESS_VOICINGS :
            compingMode === 'cluster'  ? RNB_VOICINGS           :
            compingMode === 'full'     ? POP_VOICINGS           :
            compingMode === 'blues'    ? BLUES_VOICINGS         :
            null;
        const overrideIntervals = overrideTable ? overrideTable[activeType] : undefined;

        let compingPcs: number[];
        if (overrideIntervals) {
            compingPcs = overrideIntervals.map(iv => (((rootKeyIndex + iv) % 12) + 12) % 12);
            compingPcs = Array.from(new Set(compingPcs));
        } else {
            compingPcs = assembleVoicing(activeType, rootKeyIndex, stylePref);
        }

        // Secondary dominant 9th injection
        const isSecondaryDom = ap.roman.includes('/');
        if (isSecondaryDom) {
            const ninthPc = (((rootKeyIndex + 2) % 12) + 12) % 12;
            if (!compingPcs.includes(ninthPc)) compingPcs.push(ninthPc);
        }

        const pitchClasses = compingPcs;

        // Step 2: Bass — G5 Bass Planner
        const slotBassRole = (ap as any).bassRole as
            ('root' | '3rd' | '5th' | '7th' | 'pedal' | undefined);
        const slotBassPedalPc = (ap as any).bassPedalPc as number | undefined;
        const bassAnchorPc = resolveBassAnchorPc(
            slotBassRole, rootKeyIndex, intervals, slotBassPedalPc,
        );

        const ruleFn = BASSLINE_RULES[ctx.basslineRule] ?? BASSLINE_RULES[DEFAULT_BASSLINE_RULE];
        const prevBassMidi = parsedChords.length > 0
            ? parsedChords[parsedChords.length - 1].bassMidi
            : null;
        const isCadenceToTonic = ap.roman === 'I'
            && parsedChords.length > 0
            && abstractPath[parsedChords.length - 1].roman.includes('V');

        // Structural root-anchor positions
        const isBarStart = parsedChords.length === 0;
        const isPhraseBoundary = ctx.motifInterval > 0
            && parsedChords.length > 0
            && parsedChords.length % ctx.motifInterval === 0;
        const prevRoman = parsedChords.length > 0
            ? abstractPath[parsedChords.length - 1].roman
            : '';
        const isPrimaryV = /^V[^/IiVv]*$|^V$/.test(prevRoman.split('/')[0])
            && prevRoman.split('/')[0] !== 'IV'
            && prevRoman.split('/')[0] !== 'VI';
        const isSecondaryV = prevRoman.startsWith('V/') || prevRoman.startsWith('V7/');
        const secondaryTarget = isSecondaryV
            ? prevRoman.split('/')[1]
            : null;
        const PRIMARY_LANDING_ROMANS = new Set([
            'I', 'i', 'vi', 'VI', 'bVI', 'IV', 'iv',
        ]);
        const isResolutionLanding = (isPrimaryV && PRIMARY_LANDING_ROMANS.has(ap.roman))
            || (isSecondaryV && secondaryTarget !== null
                && (ap.roman === secondaryTarget
                    || ap.roman.toLowerCase() === secondaryTarget.toLowerCase()));
        const forceRootAnchor = isBarStart || isPhraseBoundary || isResolutionLanding;

        let bassM: number;
        if (slotBassRole && slotBassRole !== 'root') {
            bassM = clampPcToBassMidi(bassAnchorPc);
        } else if (forceRootAnchor) {
            bassM = clampPcToBassMidi(bassAnchorPc);
        } else {
            // Bass ONLY anchor on chord literal pcs (1/3/5/7) — never extensions
            const chordLiteralPcs = intervals.slice(0, 4).map(iv => ((rootKeyIndex + iv) % 12 + 12) % 12);
            bassM = ruleFn({
                chordRootPc: rootKeyIndex,
                bassAnchorPc,
                pitchClasses: chordLiteralPcs,
                prevBassMidi,
                isCadenceToTonic,
                isLast: parsedChords.length === abstractPath.length - 1,
                barIndex: parsedChords.length,
                random: rng,
            });
        }

        // Step 3a: Chord-identity guard for inversions (G7 fix)
        const inversionBassPc = (((bassM % 12) + 12) % 12);
        if (inversionBassPc !== rootKeyIndex && stylePref.rootPolicy === 'omit') {
            compingPcs = compingPcs.filter(pc => pc !== inversionBassPc);
            if (!compingPcs.includes(rootKeyIndex)) {
                compingPcs.push(rootKeyIndex);
            }
        }

        // Step 3b: MIDI placement
        const prevCompingMidi = parsedChords.length > 0
            ? (parsedChords[parsedChords.length - 1].notesMidi
                ?? parsedChords[parsedChords.length - 1].notes.map(n => noteToMidi(n)))
            : [];
        const compingNotesMidi = placeVoicingMidi(
            compingPcs, prevCompingMidi, bassM, activeType, rootKeyIndex,
        );

        // Divisi 2.0 — Harmonic state machine middleware
        const bassPc = ((bassM % 12) + 12) % 12;
        const upperRootPc = ((rootKeyIndex % 12) + 12) % 12;
        const pitchClassesSet = new Set(pitchClasses);
        pitchClassesSet.add(upperRootPc);
        const keyRootPc = ((noteToMidi(key + "0") % 12) + 12) % 12;
        const originalFunc = harmonicFunctionFromRoman(ap.roman);
        const harmonicState = evaluateTensionState(
            upperRootPc, pitchClassesSet, bassPc, originalFunc, keyRootPc, ap.roman
        );

        // Display chord symbol — extension upgrade so label matches audible chord
        const voicingPcSet = new Set(compingNotesMidi.map(m => ((m % 12) + 12) % 12));
        const has9 = voicingPcSet.has(((rootKeyIndex + 2) % 12 + 12) % 12);
        const has11 = voicingPcSet.has(((rootKeyIndex + 5) % 12 + 12) % 12);
        const has13 = voicingPcSet.has(((rootKeyIndex + 9) % 12 + 12) % 12);
        let displayType = activeType;
        if (activeType === 'm7') {
            if (has9 && has11) displayType = 'm11';
            else if (has9 && has13) displayType = 'm13';
            else if (has9) displayType = 'm9';
            else if (has11) displayType = 'm7add11';
        } else if (activeType === 'maj7') {
            if (has9 && has13) displayType = 'maj13';
            else if (has9) displayType = 'maj9';
            else if (has13) displayType = 'maj7add13';
        } else if (activeType === '7') {
            if (has9 && has13) displayType = '13';
            else if (has9) displayType = '9';
            else if (has13) displayType = '7add13';
        } else if (activeType === 'min' || activeType === 'm') {
            if (has9 && has11) displayType = 'm11';
            else if (has9) displayType = 'madd9';
        } else if (activeType === 'maj') {
            if (has9 && has13) displayType = '6/9';
            else if (has9) displayType = 'add9';
            else if (has13) displayType = '6';
        }
        const displayChordSymbol = bassPc === upperRootPc
            ? `${rootName}${displayType === 'maj' ? '' : displayType}`
            : `${rootName}${displayType === 'maj' ? '' : displayType}/${spellPcInKey(bassPc, keyIndex, isMinorKey)}`;

        // Bass pattern dispatch (老师 4)
        const bassPatternKey = STYLE_DICTIONARY[style]?.bassPattern;
        let bassPatternEvents: { time: number; midi: number; duration: number; velocity: number }[] | undefined;
        // V/X 副属和弦 walk-up / inversion 推进
        if (isSecondaryDom) {
            const isMinorChord = activeType === 'min' || activeType === 'm7' || activeType === 'm9'
                || activeType === 'm11' || activeType === 'm7b5' || activeType === 'dim' || activeType === 'dim7';
            const thirdSemis = isMinorChord ? 3 : 4;
            const fifthSemis = activeType === 'dim' || activeType === 'dim7' || activeType === 'm7b5'
                ? 6 : (activeType === 'aug' ? 8 : 7);
            const clampBass = (m: number): number => {
                while (m < 33) m += 12;
                while (m > 55) m -= 12;
                return m;
            };
            const thirdBassMidi = clampBass(((rootKeyIndex + thirdSemis) % 12) + 36);
            const fifthBassMidi = clampBass(((rootKeyIndex + fifthSemis) % 12) + 36);
            const modeRoll = rng.next();
            if (modeRoll < 0.5) {
                // (a) 跳进式
                bassPatternEvents = [
                    { time: 0, midi: bassM, duration: 2, velocity: 92 },
                    { time: 2, midi: thirdBassMidi, duration: 2, velocity: 96 },
                ];
            } else {
                // (b) Walk-up
                const nextAp = abstractPath[apIdx + 1];
                let leadingMidi = thirdBassMidi;
                if (nextAp) {
                    let nextRootOff = nextAp.rootOffset;
                    if (nextRootOff === undefined) {
                        const baseRoman = nextAp.roman.replace(/maj7|m7|7|maj9|m9|7sus4|b/, '');
                        nextRootOff = nextAp.roman.startsWith('bVII') ? 10 : (degreeOffsets[baseRoman] ?? 0);
                    }
                    const nextRootPc = (keyIndex + nextRootOff) % 12;
                    const leadingPc = ((nextRootPc - 1) % 12 + 12) % 12;
                    leadingMidi = clampBass(leadingPc + 36);
                }
                bassPatternEvents = [
                    { time: 0, midi: bassM, duration: 1, velocity: 95 },
                    { time: 1, midi: thirdBassMidi, duration: 1, velocity: 88 },
                    { time: 2, midi: fifthBassMidi, duration: 1, velocity: 90 },
                    { time: 3, midi: leadingMidi, duration: 1, velocity: 96 },
                ];
            }
        } else if (bassPatternKey && BASS_PATTERN_RULES[bassPatternKey]) {
            const chordLiteralPcsPat = intervals.slice(0, 4).map(iv => ((rootKeyIndex + iv) % 12 + 12) % 12);
            bassPatternEvents = BASS_PATTERN_RULES[bassPatternKey]({
                chordRootPc: rootKeyIndex,
                bassPc: ((bassM % 12) + 12) % 12,
                pitchClasses: chordLiteralPcsPat,
                prevBassMidi,
                isCadenceToTonic,
                isLast: parsedChords.length === abstractPath.length - 1,
                barIndex: parsedChords.length,
                random: rng,
            });
        }

        // Mode-borrowing detection
        const borrowed = detectModeBorrowing(
            rootKeyIndex,
            activeType,
            keyIndex,
            ctx.mode,
        );

        // Local tonal center
        let localTonalCenterPc: number = keyIndex;
        if (ap.roman.includes('/')) {
            const targetPart = ap.roman.split('/')[1];
            const cleanTarget = targetPart.replace(/^b/, '').replace(/^#/, '');
            const targetDegreeOffset = degreeOffsets[cleanTarget]
                ?? degreeOffsets[cleanTarget.charAt(0).toUpperCase() + cleanTarget.slice(1).toLowerCase()]
                ?? degreeOffsets[cleanTarget.toLowerCase()];
            if (targetDegreeOffset !== undefined) {
                let offset = targetDegreeOffset;
                if (targetPart.startsWith('b')) offset = (offset - 1 + 12) % 12;
                else if (targetPart.startsWith('#')) offset = (offset + 1) % 12;
                localTonalCenterPc = (keyIndex + offset) % 12;
            }
        }

        parsedChords.push({
            root: rootName,
            rootMidi: rootKeyIndex + 48,
            type: activeType,
            roman: ap.roman,
            bass: midiToNoteInKey(bassM, keyIndex, isMinorKey),
            bassMidi: bassM,
            notes: compingNotesMidi.map(m => midiToNoteInChord(m, rootKeyIndex, keyIndex, isMinorKey, activeType)),
            notesMidi: compingNotesMidi.slice(),
            duration: ((ap as any).beats as number | undefined)
                ?? ctx.meterContext.beatsPerMeasure,
            tensionState: harmonicState.tensionState,
            effectiveFunc: harmonicState.effectiveFunc,
            virtualExtensions: harmonicState.virtualExtensions,
            chordSymbol: displayChordSymbol,
            bassPattern: bassPatternEvents,
            borrowedFrom: borrowed ?? undefined,
            localTonalCenterPc,
        });

        // Round-trip guard (dev-only)
        if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'production') {
            const justPushed = parsedChords[parsedChords.length - 1];
            for (let i = 0; i < justPushed.notesMidi.length; i++) {
                const reparsed = noteToMidi(justPushed.notes[i]);
                if (reparsed !== justPushed.notesMidi[i]) {
                    console.warn(`[voicing round-trip mismatch] bar=${parsedChords.length - 1} ${activeType} root=${rootName}: "${justPushed.notes[i]}" parsed to ${reparsed}, expected ${justPushed.notesMidi[i]}`);
                }
            }
        }
    });

    // Roman label sync — 2-pass(own romans first,then sub-V deferred)
    const isMinorType = (t: string): boolean =>
        t === 'min' || t === 'm'
        || (t.startsWith('m') && !t.startsWith('maj'))
        || t === 'dim' || t === 'dim7' || t === 'm7b5' || t === 'm9b5';
    const syncRoman = (roman: string, type: string): string => {
        if (roman.includes('/')) return roman;
        const flat = roman.startsWith('b') ? 'b' : '';
        const base = flat ? roman.slice(1) : roman;
        return flat + (isMinorType(type) ? base.toLowerCase() : base.toUpperCase());
    };
    parsedChords.forEach((c) => {
        c.roman = syncRoman(c.roman, c.type);
    });
    parsedChords.forEach((c, i) => {
        if (c.roman.startsWith('subV/')) {
            const nextRoman = parsedChords[(i + 1) % parsedChords.length].roman;
            c.roman = `subV/${nextRoman.split('/')[0]}`;
        }
    });

    return parsedChords;
}

/**
 * 抽自 mg.Engine.generateProgressions (原 L803-811,public)。
 * Public 入口 — 串联 resolveGeneration → generateProgression → realizeProgression,
 * 一次性给出"骨架展开 + voicing 实化"后的完整 ChordDef[]。
 *
 * 行数小但语义不可省 — 是 mg pipeline 的 harmony 顶层入口。
 */
export function generateProgressions(config: GenerationConfig, rng: Random): ChordDef[] {
    const { style, key } = config;
    const ctx = resolveGeneration(config);
    const bars = STYLE_DICTIONARY[style]?.recommendedBars ?? 16;
    const progression = generateProgression(style, bars, ctx.mode, rng);
    return realizeProgression(progression, key, style, ctx, rng);
}

// ============================================================
// Phase 3 — Group A 续:arrangement 层的 stateless helpers
// ============================================================

/**
 * 抽自 mg.Engine.predictMotifStructuralPcs (原 L2088-2113)。
 * 给定 motif + chord + runScale,预测每个 structural note(strong beat / 长音
 * / 末音)落在的 pc 集合。给 evaluator 做 motif 形状评估用。
 *
 * 0 state / 0 PRNG。
 */
export function predictMotifStructuralPcs(motif: any[], chord: ChordDef, runScale: number[]): Set<number> {
    const out = new Set<number>();
    if (motif.length === 0) return out;
    const chordRootPc = (((chord.rootMidi % 12) + 12) % 12);
    const scalePcs = Array.from(new Set(runScale.map(x => ((x % 12) + 12) % 12))).sort((a, b) => a - b);
    const N = scalePcs.length || 7;
    const rootIdx = scalePcs.indexOf(chordRootPc);
    const startIdx = rootIdx >= 0 ? rootIdx : 0;
    for (let i = 0; i < motif.length; i++) {
        const m = motif[i];
        const beatPos = ((m.t % 4) + 4) % 4;
        const isStrong = Math.abs(beatPos) < 0.05 || Math.abs(beatPos - 2) < 0.05;
        const isLong = m.d >= 1.5;
        const isLast = i === motif.length - 1;
        if (!(isStrong || isLong || isLast)) continue;
        let pc: number;
        if ('chromaticOffset' in m) {
            pc = ((chordRootPc + m.chromaticOffset) % 12 + 12) % 12;
        } else {
            const targetIdx = ((startIdx + m.diatonicStep) % N + N) % N;
            pc = scalePcs[targetIdx];
        }
        out.add(pc);
    }
    return out;
}

/**
 * 抽自 mg.Engine.estimateMotifConflictRatio (原 L1867-1915)。
 * 估算 motif 中有多少音是 chord context 下的 avoid note,返回 [0, 1] 冲突率。
 *
 * Dominant chord 上的 3→4 上行半音 motion(false resolve)额外计 ×4 conflict,
 * 任一对此类 motion 即足以排除该 motif 候选。
 *
 * 0 state / 0 PRNG。
 */
export function estimateMotifConflictRatio(
    motif: any[],
    chord: ChordDef,
    runScale: number[],
    func: string = 'T',
    isModalContext: boolean = false,
    scaleName?: string,
): number {
    if (motif.length === 0) return 0;
    const chordRootPc = (((chord.rootMidi % 12) + 12) % 12);
    const scalePcsSet = new Set<number>();
    runScale.forEach(m => scalePcsSet.add((((m % 12) + 12) % 12)));
    let scalePcs = Array.from(scalePcsSet).sort((a, b) => a - b);
    if (scalePcs.length === 0) {
        scalePcs = SCALE_TYPES['Ionian'].map(iv => (chordRootPc + iv) % 12).sort((a, b) => a - b);
    }
    const rootIdx = scalePcs.indexOf(chordRootPc);
    const rotated = rootIdx >= 0
        ? [...scalePcs.slice(rootIdx), ...scalePcs.slice(0, rootIdx)]
        : scalePcs;
    const N = rotated.length;

    let conflicts = 0;
    const isDominant = chord.effectiveFunc === 'D'
        || getHarmonicFunction(chord.roman) === 'D';
    const ivs: number[] = [];
    for (const note of motif) {
        let pc: number;
        if ('chromaticOffset' in note) {
            pc = (((chordRootPc + note.chromaticOffset) % 12) + 12) % 12;
        } else {
            const step = note.diatonicStep;
            const wrappedStep = ((step % N) + N) % N;
            pc = rotated[wrappedStep];
        }
        const intvFromChordRoot = (((pc - chordRootPc) % 12) + 12) % 12;
        ivs.push(intvFromChordRoot);
        if (isAvoidNote(intvFromChordRoot, chord.type, scaleName, isModalContext, func)) conflicts++;
    }
    // 老师规则 1:D 函数 3→4 上行半音(false-resolve)× 4 倍计 conflict
    if (isDominant) {
        for (let i = 0; i < ivs.length - 1; i++) {
            if (ivs[i] === 4 && ivs[i + 1] === 5) conflicts += 4;
        }
    }
    return Math.min(1, conflicts / motif.length);
}

/**
 * Hard-filter relaxation priority(原 mg.Engine.HARD_FILTER_PRIORITY static)。
 * Selectee 在候选池空时按 priority 从高到低 drop filter。0 = 最重要(保留最久),
 * 13 = 最不重要(最先丢)。
 *
 * Load-bearing musical(0-8)— chord identity / avoid on strong beat / tendency
 * resolution / phrase cadence / pending tension resolution / acoustic clash /
 * gravity-line closure。任一被丢都产生可听 "wrong note"。
 *
 * Etiquette(9-13)— leap-cap / apex headroom / pc-repeat / leap-recovery /
 * anti-monotonicity。违反时降级形状,不破和声;池子稀疏时优先丢弃。
 */
export const HARD_FILTER_PRIORITY: Record<string, number> = {
    'in-melody-range': 0,
    'no-avoid': 1,
    'in-chord-contract': 2,
    'saturation-resolve': 3,
    'unified-tension-resolution': 4,
    'phrase-end-no-unresolved-avoid': 5,
    'no-cross-octave-m9': 6,
    'scale-gravity-line': 7,
    'color-line': 8,
    'leap-octave-cap': 9,
    'apex-headroom': 10,
    'no-same-pc-repeat': 11,
    'leap-recovery': 12,
    'anti-monotonicity': 13,
};

/**
 * 抽自 mg.Engine.selectBestMidi (原 L2191-2281)。
 * AND-architecture melody constraint selector:
 *   1. 建 candidate pool(runScale ±10 半音 + chord literal pcs 邻近八度
 *      + apex pitch guard)
 *   2. Hard filters 按 priority 排序应用;空池时从末尾 relax
 *   3. Soft scores 加权打分;motif intent 距离微 penalty(0.15)preserve 形状
 *
 * 全 fail fallback:return ctx.motifProjMidi。
 *
 * 0 state / 0 PRNG(完全依赖 ctx + filters + scores)。
 */
export function selectBestMidi(
    ctx: NoteContext,
    hardFilters: HardConstraint[],
    softScores: SoftScore[],
): number {
    const proj = ctx.motifProjMidi;

    // 1. Build candidate pool
    const candSet = new Set<number>();
    if (proj >= MELODY_RANGE.LOW && proj <= MELODY_RANGE.HIGH) candSet.add(proj);
    for (const sm of ctx.runScale) {
        if (Math.abs(sm - proj) <= 10
            && sm >= MELODY_RANGE.LOW && sm <= MELODY_RANGE.HIGH) {
            candSet.add(sm);
        }
    }
    const literal = CHORD_TYPES[ctx.chord.type] || [0, 4, 7];
    const rootPc = (((ctx.chord.rootMidi % 12) + 12) % 12);
    for (const iv of literal) {
        const pc = (rootPc + iv) % 12;
        for (let oct = 4; oct <= 7; oct++) {
            const m = oct * 12 + pc;
            if (Math.abs(m - proj) <= 12
                && m >= MELODY_RANGE.LOW && m <= MELODY_RANGE.HIGH) {
                candSet.add(m);
            }
        }
    }

    // Rule 10 — apex pitch guard
    if (ctx.isApexBar && ctx.isStructural && ctx.apexPitchMidi > 0
        && ctx.apexPitchMidi >= MELODY_RANGE.LOW
        && ctx.apexPitchMidi <= MELODY_RANGE.HIGH) {
        candSet.add(ctx.apexPitchMidi);
    }

    const cands = Array.from(candSet);

    // 2. Hard filters with relaxation
    const activeFilters = hardFilters
        .filter(f => f.shouldApply(ctx))
        .slice()
        .sort((a, b) =>
            (HARD_FILTER_PRIORITY[a.name] ?? 999) - (HARD_FILTER_PRIORITY[b.name] ?? 999)
        );
    let valid = cands.filter(midi => activeFilters.every(f => f.accept(midi, ctx)));
    let droppedFilters = 0;
    while (valid.length === 0 && droppedFilters < activeFilters.length) {
        droppedFilters++;
        const relaxed = activeFilters.slice(0, activeFilters.length - droppedFilters);
        valid = cands.filter(midi => relaxed.every(f => f.accept(midi, ctx)));
    }
    if (valid.length === 0) {
        return ctx.motifProjMidi;
    }

    // 3. Soft score + tiny distance penalty
    const activeScores = softScores.filter(s => s.shouldApply(ctx));
    let best = valid[0];
    let bestScore = -Infinity;
    for (const midi of valid) {
        let total = 0;
        for (const s of activeScores) {
            total += s.weight * s.score(midi, ctx);
        }
        total -= 0.15 * Math.abs(midi - ctx.motifProjMidi);
        if (total > bestScore) {
            bestScore = total;
            best = midi;
        }
    }
    return best;
}

/** "Motifs as Islands" selector tuning(原 Engine.N_CANDIDATES static)。
 *  从 final pool 抽 5 个候选,按 conflict-aware 排序选最优。 */
export const N_CANDIDATES = 5;
/** Memory reuse 概率(原 Engine.MEMORY_REUSE_PROB static)。
 *  同 memoryKey 重出时,60% 复用 cached motif,40% 重新选 — 兼顾 thematic
 *  recurrence 与 variation。 */
export const MEMORY_REUSE_PROB = 0.60;

/**
 * 抽自 mg.Engine.selectBestMotif (原 L1937-2040)。
 * "Motifs as Islands" selector — 替换盲目 `random.pick(pool)`,加入:
 *   1. Three-tier 上下文 pre-filter(allowedQualities × allowedTSD)
 *   2. Memory 复用 60% 概率(同 chord 上下文复用之前选过的 motif)
 *   3. N=5 候选抽样 + multi-criteria 评分(backbone × 2.0 + vlIn × 1.0 +
 *      vlOut × 1.5 + variety × 0.5 + parallelism × 0.8 - avoidRate × 1.0)
 *   4. Cache winner to thematicMemory
 *
 * Zero-Drift property:pure-array pool → Tier1 == Tier2 == pool → 与 pre-upgrade
 * `random.pick` 行为等价。Cache hit 也 drain 5 次 random.pick,stream 对称。
 *
 * PRNG 消耗:固定 1(memory roll)+ N_CANDIDATES(候选抽样)= 6 次,与分支无关。
 */
export function selectBestMotif(
    pool: (any[] | { notes: any[]; rules?: any })[],
    chord: ChordDef,
    runScale: number[],
    memoryKey: string,
    thematicMemory: Record<string, any[]>,
    backboneTargets: Set<number> | null = null,
    vlIn: Set<number> | null = null,
    vlOut: Set<number> | null = null,
    prevPhrasePcs: Set<number> | null = null,
    rng: Random = new Random('default'),
): any[] {
    if (!pool || pool.length === 0) return [];

    // Three-tier context-aware pre-filter
    const chordQuality = classifyEngineChordType(chord.type);
    const currentFunc: 'T' | 'S' | 'D' = chord.effectiveFunc ?? getHarmonicFunction(chord.roman);
    const tier1: (any[] | { notes: any[]; rules?: any })[] = [];
    const tier2: (any[] | { notes: any[]; rules?: any })[] = [];
    for (const item of pool) {
        if (Array.isArray(item)) {
            tier1.push(item);
            tier2.push(item);
            continue;
        }
        const rules = item.rules;
        if (!rules) {
            tier1.push(item);
            tier2.push(item);
            continue;
        }
        const passQuality = !rules.allowedQualities
            || rules.allowedQualities.includes(chordQuality);
        const passTSD = !rules.allowedTSD
            || rules.allowedTSD.includes(currentFunc);
        if (passQuality) {
            tier2.push(item);
            if (passTSD) tier1.push(item);
        }
    }
    let finalPool: (any[] | { notes: any[]; rules?: any })[] = pool;
    if (tier1.length >= 3) finalPool = tier1;
    else if (tier2.length >= 3) finalPool = tier2;

    // Memory reuse roll
    const memRoll = rng.next();
    const cached = thematicMemory[memoryKey];
    if (cached && memRoll < MEMORY_REUSE_PROB) {
        // Drain N_CANDIDATES picks even on cache hit so stream stays symmetric
        for (let i = 0; i < N_CANDIDATES; i++) rng.pick(finalPool);
        return cached;
    }

    // Draw N candidates
    const candidates: (any[] | { notes: any[]; rules?: any })[] = [];
    for (let i = 0; i < N_CANDIDATES; i++) {
        candidates.push(rng.pick(finalPool));
    }

    let best: any = candidates[0];
    let bestRank = -Infinity;
    for (const c of candidates) {
        const notes = Array.isArray(c) ? c : c.notes;
        const avoidRate = estimateMotifConflictRatio(notes, chord, runScale);
        const backboneHit = backboneTargets
            ? estimateBackboneAlignment(notes, chord, runScale, backboneTargets)
            : 0;
        const { vlInHit, vlOutHit, variety } =
            estimateMotifShapeMetrics(notes, chord, runScale, vlIn, vlOut);
        let parallelismHit = 0;
        if (prevPhrasePcs && prevPhrasePcs.size > 0) {
            const candPcs = predictMotifStructuralPcs(notes, chord, runScale);
            if (candPcs.size > 0) {
                let inter = 0;
                candPcs.forEach(p => { if (prevPhrasePcs!.has(p)) inter++; });
                const union = candPcs.size + prevPhrasePcs.size - inter;
                const sim = union > 0 ? inter / union : 0;
                parallelismHit = Math.max(0, 1 - 2 * Math.abs(sim - 0.5));
            }
        }
        const rank = backboneHit * 2.0
            + vlInHit * 1.0
            + vlOutHit * 1.5
            + variety * 0.5
            + parallelismHit * 0.8
            - avoidRate * 1.0;
        if (rank > bestRank) { bestRank = rank; best = c; }
    }

    const bestNotes = Array.isArray(best) ? best : best.notes;
    thematicMemory[memoryKey] = bestNotes;
    return bestNotes;
}

/**
 * 抽自 mg.Engine.applyTexture (原 L2064-2081)。
 * Phase 2d 之后 applyTexture 是 thin wrapper — 完全 dispatch 给 AF2
 * ChordTextureEngine.applyByTextureType(38 个 mg textureType 已 100% 覆盖 →
 * 23 个 AF2 子族)。
 *
 * Defensive throw:若未来加新 mg textureType 而未同步到 TEXTURE_MAPPING,
 * af2Events 会是 null,这里抛错而非默默调用旧实现(已删)。
 *
 * isShuffle / accentMode / density 当前不传 AF2(23 子族都不消费),将来需要时
 * 扩 ChordTextureInput schema。
 */
export function applyTexture(
    chord: ChordDef,
    textureType: string,
    startBeat: number,
    duration: number,
    melodyEvents: NoteEvent[],
    isShuffle: boolean,
    accentMode: 'heavy' | 'syncopated',
    density: number = 0.5,
    nextChord: ChordDef | null = null,
    rng: Random = new Random('default'),
): NoteEvent[] {
    void isShuffle; void accentMode; void density;
    const af2Events = ChordTextureEngine.applyByTextureType(
        textureType, chord, nextChord, startBeat, duration, rng, melodyEvents,
    );
    if (af2Events !== null) return af2Events;
    throw new Error("mg.applyTexture: AF2 ChordTextureEngine missed textureType " + textureType);
}

// ============================================================
// Phase 3.2 — generateBarPattern (2557 行最大 method 抽离)
//
// Class state 通过 BarPatternSongContext 打包传入(8 字段):
//   aestheticAnchor / songApex{Bar,Pitch,Phrase} / songGravityStrictness /
//   songMeterContext / songTonalCharacter / rng(原 this.random)
//
// 内部对 5 个 stub-extracted method 的调用全部改为 free function 直调:
//   estimateMotifConflictRatio / deriveDevelopmentMotif / motifMutator /
//   applyTexture / selectBestMidi(后两者 + rng 参数注入)
// ============================================================
export function generateBarPattern(
      chord: ChordDef, nextChord: ChordDef | null, style: StyleName, startBeat: number, motif: any[],
      func: 'T'|'S'|'D', isLast: boolean, musicKey: string, musicMode: string, tensionTracker: TensionTracker, melodyState: { currentMidi: number; lastNoteEnd: number; lastLeapSemis: number; sameDirRunLength: number; stepCount: number; leapCount: number; pendingScaleResolveTarget: number | null; pendingScaleResolveRootPc: number; pendingScaleResolveScore: number; pendingScaleLineWindowEnd: number; pendingScaleLineLastMidi: number; pendingColorLine: { startMidi: number; startPc: number; startTime: number; windowEnd: number; lineLastMidi: number } | null; lastEmitRole: NoteRole; lastEmitMidi: number; lastEmitAssessment: NoteHarmonicAssessment | null; lastEmitChord: ChordDef | null },
      textureType: string, isShuffle: boolean, accentMode: 'heavy' | 'syncopated',
      barIndex: number = 0, totalBars: number = 1, density: number = 0.5, complexity: number = 0.5,
      role: 'motif' | 'develop' | 'rest' = 'motif',
      shouldReturn: boolean = false,
      motifInterval: number = 4,
      // Style-flavored fill scale for in-bar Run Generator + passing
      // tone insertion. Falls back to runScale (computed below) when
      // not provided.
      fillScale: number[] | null = null,
      // Backbone target pcs (chord literal ∩ key palette + key root if
      // missing). Color Magnetism uses this to FORCE structural notes
      // onto chord contract — no probability gate, per user direction.
      // Falls back to chord-contract globalPcs check when null.
      barBackboneTargets: Set<number> | null = null,
      // Previous bar's chord — used by the cross-bar bridge to filter
      // candidate passing tones against the SOURCE chord's avoid table.
      // Without this, the bridge places a global-key passing tone in
      // the previous bar's silent tail, which can land on the source
      // chord's avoid 4th (e.g. F over a C maj triad) — a real
      // architectural leak the magnetism layer can't catch because
      // the bridge bypasses the per-note pipeline entirely.
      prevChord: ChordDef | null = null,
      // Phase 5 — Caplin-style phrase role from detectPhrases. When
      // provided, drives Cadence Tier selection: antecedent_end → C
      // forced, consequent_end → B (T) or C (D/S), song_end → A (T) or
      // none, phrase_end_through → default by func, mid_phrase → none.
      // Defaults to 'phrase_end_through' so legacy callers still hit
      // the original Tier logic.
      phraseRole: PhraseRole = 'phrase_end_through',
      songCtx: BarPatternSongContext,
  ): { patternEvents: NoteEvent[], bridgeVisual?: { time: number, label: string } } {
      let events: NoteEvent[] = [];
      let bridgeVisual: { time: number, label: string } | undefined;
      
      const rootKeyMidi = noteToMidi(musicKey + "0");
      const chordTones = chord.notes;

      // ====== Motif placement conflict escape (measured projection) ======
      // Per architecture S4 ("换位置 OR 换motif"), when the canonical motif
      // would clash too heavily with the active chord we demote the bar to
      // develop and swap in a derived variant.
      //
      // The earlier heuristic only triggered on a fixed list of chord-type
      // names (m7b5 / dim / 7alt). Now we project each motif note's would-be
      // interval-from-root and count how many fall on AVOID intervals for
      // this chord type. The trigger is a measured ratio, so it catches
      // motif/chord pairs that are genuinely hostile even when the chord-
      // type name doesn't look problematic, and it leaves alone otherwise-
      // hostile chord types when the specific motif happens to thread the
      // avoid notes.
      // runScale computed up-front so the motif-conflict check below
      // can evaluate against the chord's REAL melodic palette
      // (Dorian / Mixolydian / Altered etc.) instead of a static
      // Ionian proxy. The same runScale is reused by anchor scoring
      // and the per-note projection loop further down — single
      // construction, three consumers.
      const runScale = getScaleForStyle(style, chord, func, musicKey, musicMode);
      // Pcs view of the runScale — passed to evaluator so it can apply
      // scale-awareness. The runScale already includes borrowed scales
      // (Phrygian Dominant / Lydian Dominant / Altered) on secondary
      // dominants, so this set carries the borrowed-pitch-pool to the
      // chord-context judgement.
      const runScalePcs = new Set<number>(runScale.map(m => ((m % 12) + 12) % 12));

      // 物理避音法则上下文 (老师严格版).
      // isModalEnv: 仅 RNB (allowFloatingColor) / BLUES (allowBluesHangTone)
      // 风格授权 = modal 场. POP/JAZZ 即使 mode 是 Dorian/Mixolydian 也
      // 按调性处理 — 严守"三全音泄露"等法则.
      const isModalEnv = STYLE_DICTIONARY[style]?.allowFloatingColor === true
          || STYLE_DICTIONARY[style]?.allowBluesHangTone === true;

      // 提前解析 scale 名 (调式特征音免死查表用). 跟后面 scale-gravity
      // 用的同一份, 上提到这里. 后面 scaleNameForBar/scaleRootPcForBar
      // 重复计算块会沿用此值.
      let scaleNameForBar: string | null = null;
      let scaleRootPcForBar: number = -1;
      {
          const keyRootPcLocal = (((rootKeyMidi % 12) + 12) % 12);
          const chordRootPcLocal = (((chord.rootMidi % 12) + 12) % 12);
          const songMode = (musicMode && musicMode in SCALE_TYPES) ? musicMode : 'Ionian';
          const rsPcs = new Set(runScale.map(mp => ((mp % 12) + 12) % 12));
          const expected1 = new Set(SCALE_TYPES[songMode].map(iv => (keyRootPcLocal + iv) % 12));
          let m1 = expected1.size === rsPcs.size;
          if (m1) for (const pc of expected1) if (!rsPcs.has(pc)) { m1 = false; break; }
          if (m1) {
              scaleNameForBar = songMode;
              scaleRootPcForBar = keyRootPcLocal;
          } else {
              const candidates = ['Phrygian Dominant', 'Lydian Dominant', 'Altered',
                  'Mixolydian', 'Lydian', 'Ionian', 'Aeolian', 'Dorian', 'Phrygian',
                  'Harmonic Minor', 'Melodic Minor', 'Bebop Dominant', 'Bebop Major',
                  'Blues', 'Major Blues', 'Locrian'];
              for (const name of candidates) {
                  const ivs = SCALE_TYPES[name];
                  if (!ivs) continue;
                  const expected = new Set(ivs.map(iv => (chordRootPcLocal + iv) % 12));
                  let match = expected.size === rsPcs.size;
                  if (match) for (const pc of expected) if (!rsPcs.has(pc)) { match = false; break; }
                  if (match) {
                      scaleNameForBar = name;
                      scaleRootPcForBar = chordRootPcLocal;
                      break;
                  }
              }
          }
      }

      const conflictRatio = estimateMotifConflictRatio(motif, chord, runScale, func, isModalEnv, scaleNameForBar || undefined);
      if (role === 'motif' && motif.length > 0 && conflictRatio > 0.5) {
          motif = deriveDevelopmentMotif(motif, songCtx.rng);
          role = 'develop';
      }

      // ====== 应用变奏机 Motif Mutator ======
      // Motif raw output assumes a 4-beat bar (motif data is authored
      // for 4/4). For non-4/4 bars, scale t and d by
      // (beatsPerMeasure / 4) so the motif fits the new bar length —
      // a 6/8 bar (3 beats) compresses by 0.75; a 5/4 bar (5 beats)
      // stretches by 1.25. The structural shape of the motif (its
      // strong-beat placements at 0 and middle) maps proportionally.
      // For 4/4 the scale factor is 1 and the array passes through
      // unchanged — byte-equal preserved.
      const meterScale = songCtx.songMeterContext.beatsPerMeasure / 4;
      let mutatedMotif = meterScale === 1
          ? motifMutator(motif, style, density, complexity, isShuffle, songCtx.rng)
          : motifMutator(motif, style, density, complexity, isShuffle, songCtx.rng)
              .map((m) => ({ ...m, t: m.t * meterScale, d: m.d * meterScale }));
      // Chord-slot duration clip. When the slot is shorter than a full
      // bar (planner-inserted ii-V split: chord.duration=2 in 4/4),
      // motif notes whose onset lands past chord.duration must be
      // discarded — they would otherwise emit into the NEXT chord's
      // time region with this chord's pitch/role context. Also clamp
      // each surviving note's d so it doesn't bleed past the slot's
      // tail. No-op when chord.duration === bar length (legacy path).
      if (chord.duration < songCtx.songMeterContext.beatsPerMeasure) {
          mutatedMotif = mutatedMotif
              .filter(m => m.t < chord.duration - 0.001)
              .map(m => ({ ...m, d: Math.min(m.d, chord.duration - m.t) }));
      }

      // === 1. Texture Generation FIRST (伴奏织体锁定骨架) ===
      // 我们把 density 作为参数渗透下去，如果是非常高/很低的 density，能在内部调整
      //
      // Rhythmic Interlocking — pass the motif's rhythmic schedule
      // (timing only, no pitch) so applyTexture can duck under
      // melody hits and step back when melody rests, completing the
      // divisi (melody动 / 伴奏静, 旋律停 / 伴奏托). The blueprint
      // uses noteNumber: -999 as a sentinel so pushEvent's
      // close-pitch octave-drop check at the texture side never
      // misfires against it (real melody pitches are always above
      // MIDI 0).
      const melodyBlueprint: NoteEvent[] = mutatedMotif.map((m: { t: number; d: number }) => ({
          noteNumber: -999,
          time: startBeat + applySwing(m.t, isShuffle),
          duration: m.d,
          velocity: 100,
          part: 'melody' as const,
      }));
      const textureEvents = applyTexture(chord, textureType, startBeat, chord.duration, melodyBlueprint, isShuffle, accentMode, density, nextChord, songCtx.rng);
      // 老师 4 — BASSLINE 自有线条. style.bassPattern 已在
      // realizeProgression 生成 chord.bassPattern. 这里把 texture 的
      // bass 输出整体替换为 pattern 序列, 让 boogie / stride / dilla
      // pocket 这种"铺底简单旋律线"贯穿全 bar.
      if (chord.bassPattern && chord.bassPattern.length > 0) {
          const noBass = textureEvents.filter(e => e.part !== 'bass');
          events.push(...noBass);
          for (const bp of chord.bassPattern) {
              const absTime = startBeat + bp.time;
              if (absTime >= startBeat + chord.duration) continue;
              const remaining = startBeat + chord.duration - absTime - 0.02;
              if (remaining <= 0) continue;
              events.push({
                  noteNumber: bp.midi,
                  time: absTime,
                  duration: Math.min(bp.duration, remaining),
                  velocity: Math.min(127, bp.velocity),
                  part: 'bass',
              });
          }
      } else {
          events.push(...textureEvents);
      }

      // === 2. Melody Generation (Logic Pro Voice Leading & Resolve) ===
      
      const progress = barIndex / totalBars;
      const arch = Math.sin(progress * Math.PI);
      const maxShiftSemis = style === 'BLUES' ? 5 : 7;
      const macroSemiShift = isLast ? 0 : Math.floor(arch * maxShiftSemis);

      // runScale already computed above (line ~2247) for the
      // conflict-ratio check; reused here for anchor scoring + per-
      // note projection.
      const scalePcs = new Set(runScale.map(x => x % 12));
      const N = scalePcs.size;

      // Aesthetic Anchor — score each runScale candidate by what the
      // bar's first projected pitch would mean musically, not just by
      // distance to the previous note.
      //
      // The previous logic picked the runScale tone that landed the
      // motif's first step closest to lastNoteMidi. That's smooth voice
      // leading, but ignorant of harmony: the anchor would land on
      // whichever scale note happened to be nearest, even if it was
      // a bland 1/3/5 over a rich m11 chord, or worse, the chord's
      // declared color tone got skipped because a closer scale note won.
      //
      // The new scoring iterates all runScale candidates and for each
      // computes the FIRST PROJECTED PITCH (anchor + motif's first
      // step), then scores that pitch on:
      //   1. Voice-leading proximity to lastNoteMidi (smooth continuity)
      //   2. Composite-state virtualExtensions hit (Divisi 2.0's
      //      defining color over slash chords like F/G — huge bonus)
      //   3. Vacated-extension hit on declared 5+ interval chords
      //      (m9 / m11 / 13 / maj9 — the chord's "advertised" color)
      //   4. add9 / 6/9 named extension hit
      //   5. INTERVAL_AESTHETICS function vs. chord function intent:
      //        T (tonic)     → reward Home / Anchor / Color
      //        S (subdom.)   → reward Active / Color
      //        D (dominant)  → reward Leading / Tension / Active
      //   6. isAvoidNote penalty
      //   7. Tiny forked-random jitter so equal-score ties don't always
      //      collapse to the lowest scale index.
      //
      // The result: the bar's first note is musically intentional —
      // it answers the chord's role rather than passively following
      // the previous note.
      let anchorIdx = 0;
      const referenceMidi = melodyState.currentMidi || noteToMidi(musicKey + "4");
      const firstNote: any = mutatedMotif.length > 0 ? mutatedMotif[0] : null;
      const firstStepDiatonic = firstNote && 'diatonicStep' in firstNote ? firstNote.diatonicStep : 0;
      const firstChromaOffset = firstNote && 'chromaticOffset' in firstNote ? firstNote.chromaticOffset : 0;
      const firstIsDiatonic = firstNote ? 'diatonicStep' in firstNote : true;

      const projectFirstMidi = (k: number): number => {
          if (!firstIsDiatonic) {
              return runScale[k] + firstChromaOffset;
          }
          const targetIdx = k + firstStepDiatonic;
          const rsLen = runScale.length;
          const octs = Math.floor(targetIdx / rsLen);
          let rem = targetIdx % rsLen;
          if (rem < 0) rem += rsLen;
          return runScale[rem] + (octs * 12);
      };

      const chordRootPc = (((chord.rootMidi % 12) + 12) % 12);
      const keyRootPc = (((noteToMidi(musicKey + "0") % 12) + 12) % 12);
      const literalIntervals = CHORD_TYPES[chord.type] || [];
      const vacatedIntervals: number[] = literalIntervals.length >= 5
          ? literalIntervals.slice(4)
          : [];
      const effFunc = chord.effectiveFunc || func;

      let bestScore = -Infinity;
      for (let k = 0; k < runScale.length; k++) {
          const firstMidi = projectFirstMidi(k);
          if (firstMidi < MELODY_RANGE.LOW || firstMidi > MELODY_RANGE.HIGH) continue;

          let score = 0;
          const pcFromChord = (((firstMidi - chordRootPc) % 12) + 12) % 12;
          const pcFromKey = (((firstMidi - keyRootPc) % 12) + 12) % 12;
          const firstPc = (((firstMidi % 12) + 12) % 12);

          // 1. Voice leading — smoother continuation scores higher.
          //    Now that Active Divisi Magnet (m.d >= 0.5) reliably
          //    pulls held notes onto vacated extensions and Run
          //    Generator bridges gap+leap pairs, the anchor's
          //    responsibility is FIRST-NOTE PLACEMENT — smooth
          //    continuation from the previous bar's last pitch.
          //    Color completion is downstream's job. Coefficient
          //    raised from 1.2 to 3.5 — voice leading dominates,
          //    extensions provide a small flavor preference only.
          score -= Math.abs(firstMidi - referenceMidi) * 3.5;

          // 2. SlashChord virtualExtensions — moderate flavor pull.
          //    Capped at +15 (was +40). On real slash chords
          //    (F/G, D/C) the listener still hears the color when
          //    Active Divisi pulls a held note later in the bar.
          if (chord.tensionState === 'SlashChord' && chord.virtualExtensions) {
              const bassPc = (((chord.bassMidi % 12) + 12) % 12);
              for (const semis of chord.virtualExtensions) {
                  const targetPc = (((bassPc + semis) % 12) + 12) % 12;
                  if (firstPc === targetPc) score += 15;
              }
          }

          // 3. Vacated extensions — capped at +10 (was +30). Vacated
          //    extension completion is now Active Divisi's job (93%+
          //    coverage post-tune); the anchor doesn't need to chase
          //    extensions on bar-1 if they sit far from the previous
          //    pitch.
          for (const iv of vacatedIntervals) {
              const targetPc = (((chordRootPc + iv) % 12) + 12) % 12;
              if (pcFromChord === targetPc) score += 10;
          }

          // 4. add9 / 6/9 — named "added" tone is the chord's identity.
          if (chord.type === 'add9' && pcFromChord === 2) score += 25;
          if (chord.type === '6/9' && (pcFromChord === 9 || pcFromChord === 2)) score += 25;

          // 5. Unified consonance/urgency scoring — evaluator-driven.
          //    Replaces the prior three-rule stack (key INTERVAL_AESTHETICS
          //    function reward, chord CHORD_VOICING_AESTHETICS role
          //    reward, and isAvoidNote penalty) with one chord-context-
          //    authoritative assessment. The evaluator fuses all four
          //    sources internally; the anchor scorer only reads the
          //    fused verdict.
          //
          //    Scoring weights tuned to roughly preserve the prior
          //    range (-25..+15) so voice-leading (rule 1, ×3.5/semi)
          //    still dominates and the anchor doesn't lurch into
          //    unrelated registers when chord-context preferences
          //    change. consonant > colortone > tension > avoid in
          //    every position; TSD-functional intent adds a small
          //    role-confirming bonus on top.
          const anchorAssessment = evaluateNoteInChordContext(
              firstPc,
              chord.type,
              chordRootPc,
              effFunc,
              nextChord ? nextChord.type : null,
              nextChord ? ((nextChord.rootMidi % 12) + 12) % 12 : null,
              keyRootPc,
              scaleNameForBar || undefined,
              isModalEnv,
              runScalePcs,
              songCtx.songTonalCharacter,
              chord.localTonalCenterPc,
              modeToKeyFamily(musicMode),
          );
          switch (anchorAssessment.consonance) {
              case 'consonant': score += 8; break;
              case 'colortone': score += 6; break;
              case 'tension':   score += 3; break;
              case 'avoid':     score -= 25; break;
          }
          // Functional-intent bonus — anchor lands meaningfully for
          // the chord's role. T anchors home tones, D anchors urgency
          // (signals the function via tension-present), S anchors
          // transitional color.
          if (effFunc === 'T' && anchorAssessment.isInChordContract) score += 4;
          else if (effFunc === 'D' && anchorAssessment.urgency >= 0.5) score += 5;
          else if (effFunc === 'S' && anchorAssessment.isInChordExtension) score += 3;

          // Cross-chord resolution bonus — Layer C in the docs. When
          // the previous emit carried a non-trivial tendency (urgency
          // ≥ 0.4) and listed resolutionTargets, candidates that land
          // on one of those targets get a soft bonus proportional to
          // the prior tendency's gravity. This soft layer sits below
          // the unified-tension-resolution hard constraint (which
          // forces gravity ≥ 0.5 onto targets) — together they handle
          // the spectrum from "must resolve" (hard) down to "would
          // sound right to resolve" (soft).
          //
          // Bonus scales with prev urgency × 12 (up to ~+12 for an
          // avoid-class prev, ~+5 for a mild tension prev). Modal
          // tonalCharacter halved prev urgency already, so blues etc.
          // get muted bonus naturally.
          if (melodyState.lastEmitAssessment !== null) {
              const prev = melodyState.lastEmitAssessment;
              if (prev.urgency >= 0.4 && prev.resolutionTargets.includes(firstPc)) {
                  score += 12 * prev.urgency;
              }
          }

          // 7. Hard leap cutoff — beyond an octave from the previous
          //    pitch, the anchor candidate gets a near-disqualifying
          //    -100 penalty. Combined with the +3.5/semi VL penalty
          //    above, this guarantees the bar's first note never
          //    leaps more than 12 semis from the previous bar's last
          //    pitch unless NO closer candidate scores positive
          //    (which happens only on hostile chord types where every
          //    in-range scale tone is also avoid).
          if (Math.abs(firstMidi - referenceMidi) > 12) score -= 100;

          // 8. Tiny forked-random tie-break jitter so identical-score
          //    candidates don't always collapse to the lowest k.
          score += (songCtx.aestheticAnchor?.next() ?? 0) * 0.5;

          if (score > bestScore) {
              bestScore = score;
              anchorIdx = k;
          }
      }
      
      // Macro Arch Shift - shift the anchor octave if macro arch demands it
      const octShift = Math.round(macroSemiShift / 12);
      let targetAnchorMidi = runScale[anchorIdx] + octShift * 12;
      
      // Update anchorIdx to the shifted octave
      let minScaleDist = 999;
      for (let k = 0; k < runScale.length; k++) {
          let d = Math.abs(runScale[k] - targetAnchorMidi);
          if (d < minScaleDist) { minScaleDist = d; anchorIdx = k; }
      }

      let lastNoteMidi = melodyState.currentMidi || runScale[anchorIdx];
      const anchorRootMidi = runScale[anchorIdx];

      // Chord-root reference for motif projection.
      //
      // Motif data uses diatonicStep / chromaticOffset SEMANTICALLY
      // as "scale degree from chord root" / "semitones from chord
      // root" — e.g. POP `step 1` means "9 of chord", RNB `c10`
      // means "b7 of chord", RNB `c17` means "11 of chord (octave+P4)".
      //
      // The Aesthetic Anchor picks an octave + register, but if it
      // lands on a non-root scale tone (preferring voice-leading
      // smoothness), interpreting steps "from anchor" produces
      // wrong intervals from chord root: anchor=Bb + c17 = D#, not
      // the intended G (= 11 of D minor).
      //
      // Fix: project from chord root pitch class, in the OCTAVE
      // closest to the aesthetic anchor. Anchor still drives
      // register; chord root drives pitch class.
      const chordRootPcLocal = (((chord.rootMidi % 12) + 12) % 12);
      const anchorOctLocal = Math.floor(anchorRootMidi / 12);
      let rootMidiForProjection = anchorOctLocal * 12 + chordRootPcLocal;
      // Pick the chord-root midi in the octave closest to anchor.
      const _rmCandidates = [
          rootMidiForProjection - 12,
          rootMidiForProjection,
          rootMidiForProjection + 12,
      ];
      let _bestRm = _rmCandidates[0];
      let _bestRmDist = Infinity;
      for (const c of _rmCandidates) {
          const d = Math.abs(c - anchorRootMidi);
          if (d < _bestRmDist) { _bestRmDist = d; _bestRm = c; }
      }
      rootMidiForProjection = _bestRm;
      // Find that root midi's exact index in runScale (runScale is
      // multi-octave so the root MUST appear at multiple positions
      // when chord is diatonic to key — match by exact MIDI value).
      // If not present (exotic / blues / non-diatonic chords whose
      // runScale is rooted differently), fall back to anchorIdx.
      let rootProjIdx = runScale.indexOf(rootMidiForProjection);
      if (rootProjIdx < 0) {
          // Find any runScale entry sharing the chord root pc, nearest anchor.
          let bestPcDist = Infinity;
          for (let k = 0; k < runScale.length; k++) {
              if ((((runScale[k] % 12) + 12) % 12) === chordRootPcLocal) {
                  const d = Math.abs(runScale[k] - anchorRootMidi);
                  if (d < bestPcDist) { bestPcDist = d; rootProjIdx = k; rootMidiForProjection = runScale[k]; }
              }
          }
          if (rootProjIdx < 0) {
              rootProjIdx = anchorIdx;
              rootMidiForProjection = anchorRootMidi;
          }
      }

      // Cross-bar bridging — extend Run Generator's gap-fill across
      // the bar boundary. When the previous bar's last melody note
      // ended significantly before this bar's first note AND the
      // pitch leap is wide, drop one stepwise scale-tone passing
      // note inside the gap. Sacred motif's pitches are NOT touched
      // (the bridge is a NEW develop note in the silence between
      // bars, not a modification of motif pitches).
      //
      // Skips:
      //   - first bar of song (no preceding note to bridge from)
      //   - empty motif bar (rest)
      //   - same-bar motif notes (handled by the in-bar Run Generator
      //     post-pass at the end of generateBarPattern)
      if (melodyState.lastNoteEnd > 0 && mutatedMotif.length > 0) {
          const firstM = mutatedMotif[0];
          const firstAbsTime = startBeat + applySwing(firstM.t, isShuffle);
          // Predicted first projected pitch — anchored at chord root
          // (matching the per-note loop's chord-relative semantics).
          let firstTargetMidi: number;
          if ('diatonicStep' in firstM) {
              const step = firstM.diatonicStep;
              const rsLen = runScale.length;
              const targetIdx = rootProjIdx + step;
              const octs = Math.floor(targetIdx / rsLen);
              let rem = targetIdx % rsLen;
              if (rem < 0) rem += rsLen;
              firstTargetMidi = runScale[rem] + (octs * 12);
          } else {
              firstTargetMidi = rootMidiForProjection + (firstM.chromaticOffset || 0);
          }
          const timeGap = firstAbsTime - melodyState.lastNoteEnd;
          const pitchLeap = Math.abs(firstTargetMidi - lastNoteMidi);
          // Cross-bar stepwise walk (Method 2 bridge fill). The walk
          // anchors at lastNoteMidi (= bar A's last note, already snapped
          // to pcA by the bar-edge VL step at lastIdx) and arrives at
          // bridgeTargetMidi (= the predicted MIDI of bar B's first note
          // after Method 2 step 3 snaps it to pcB). Stepwise scale tones
          // fill the gap so the listener perceives a connected line
          // across the bar boundary.
          //
          // Triggers when: gap >= 0.5 beat (room for at least one
          // 8th-note insert) AND pitch leap >= 4 semis (close enough
          // already, no need to interpolate).
          if (timeGap >= 0.5 && pitchLeap >= 4 && pitchLeap <= 14) {
              // Recompute bridge target = where bar B's first note
              // will actually land after Method 2 snap (idx === 0
              // block in the per-note loop). When prevChord exists
              // and the natural leap >= 4, the first note snaps to
              // nearest pcB octave around lastNoteMidi.
              let bridgeTargetMidi = firstTargetMidi;
              if (prevChord && pitchLeap >= 4) {
                  const lastPc = (((lastNoteMidi % 12) + 12) % 12);
                  const { pcB } = findClosestCrossChordPair(prevChord, chord, lastPc);
                  const targetOct = Math.floor(lastNoteMidi / 12);
                  let bestPcMidi = bridgeTargetMidi;
                  let bestPcDist = Infinity;
                  for (let oct = targetOct - 1; oct <= targetOct + 1; oct++) {
                      const cand = oct * 12 + pcB;
                      if (cand < MELODY_RANGE.LOW || cand > MELODY_RANGE.HIGH) continue;
                      const d = Math.abs(cand - lastNoteMidi);
                      if (d < bestPcDist) { bestPcDist = d; bestPcMidi = cand; }
                  }
                  bridgeTargetMidi = bestPcMidi;
              }

              const direction = Math.sign(bridgeTargetMidi - lastNoteMidi);
              const updatedLeap = Math.abs(bridgeTargetMidi - lastNoteMidi);

              // Bridge palette = GLOBAL KEY palette (Option B). The
              // walk stays diatonic to the song's key, not the next
              // chord's altered scale.
              const keyPaletteScale = SCALE_TYPES[(musicMode && musicMode in SCALE_TYPES) ? musicMode : 'Ionian'];
              const bridgePalette: number[] = [];
              for (let oct = -2; oct <= 3; oct++) {
                  for (const iv of keyPaletteScale) {
                      bridgePalette.push(noteToMidi(musicKey + "3") + (oct * 12) + iv);
                  }
              }
              const sortedPalette = [...new Set(bridgePalette)].sort((a, b) => a - b);

              // Source + destination avoid filter — the walk plays in
              // the previous bar's chord time, so respect BOTH avoid
              // tables. Without this the walk leaks 4-of-maj or maj7-of-7
              // onto structural listening positions.
              const sourceChord = prevChord;
              const sourceFunc = sourceChord ? (sourceChord.effectiveFunc ?? getHarmonicFunction(sourceChord.roman)) : 'T';
              const isAcceptable = (sm: number): boolean => {
                  const pc = (((sm % 12) + 12) % 12);
                  if (sourceChord) {
                      const ivFromSrc = ((pc - (sourceChord.rootMidi % 12) + 12) % 12);
                      if (isAvoidNote(ivFromSrc, sourceChord.type, undefined, isModalEnv, sourceFunc)) return false;
                  }
                  const ivFromDst = ((pc - (chord.rootMidi % 12) + 12) % 12);
                  if (isAvoidNote(ivFromDst, chord.type, scaleNameForBar || undefined, isModalEnv, func)) return false;
                  return true;
              };

              // Walk stepwise scale tones from lastNoteMidi toward
              // bridgeTargetMidi. Number of inserts capped by:
              //   - gap budget: floor(gap / 0.5) — each insert is an 8th
              //   - pitch budget: updatedLeap - 1 (don't overshoot or
              //     hit the target pitch with the last insert; the
              //     target is reached by bar B's first note itself)
              //   - hard cap: 3 (avoid flooding the gap)
              const maxByGap = Math.floor(timeGap / 0.5);
              const maxByPitch = Math.max(0, updatedLeap - 1);
              const nInserts = Math.max(0, Math.min(3, maxByGap, maxByPitch));

              if (nInserts > 0 && direction !== 0) {
                  // Find anchor index in palette closest to lastNoteMidi.
                  let anchorPaletteIdx = 0;
                  let anchorDist = Infinity;
                  for (let k = 0; k < sortedPalette.length; k++) {
                      const d = Math.abs(sortedPalette[k] - lastNoteMidi);
                      if (d < anchorDist) { anchorDist = d; anchorPaletteIdx = k; }
                  }

                  // Distribute insert times evenly across the gap.
                  // Insert i sits at lastNoteEnd + (i+1) * (gap / (nInserts+1))
                  // — that places the last insert ~ 1/(n+1) of the gap
                  // BEFORE the next bar's first note, and the first insert
                  // ~ 1/(n+1) AFTER the previous bar's last note ended.
                  // Spacing leaves audible clearance on both sides.
                  const gapStart = melodyState.lastNoteEnd;
                  const slot = timeGap / (nInserts + 1);

                  for (let s = 0; s < nInserts; s++) {
                      // Walk one scale step in `direction` per insert.
                      let stepIdx = anchorPaletteIdx + direction * (s + 1);
                      if (stepIdx < 0 || stepIdx >= sortedPalette.length) break;
                      let stepMidi = sortedPalette[stepIdx];
                      // If filtered (avoid), skip ahead one scale step
                      // and try again — preserve direction so the walk
                      // still moves toward target.
                      if (!isAcceptable(stepMidi)) {
                          stepIdx += direction;
                          if (stepIdx < 0 || stepIdx >= sortedPalette.length) continue;
                          stepMidi = sortedPalette[stepIdx];
                          if (!isAcceptable(stepMidi)) continue;
                      }
                      // Don't emit identical pitch as endpoints (would
                      // collapse to a repeat).
                      if (stepMidi === lastNoteMidi || stepMidi === bridgeTargetMidi) continue;
                      if (stepMidi < MELODY_RANGE.LOW || stepMidi > MELODY_RANGE.HIGH) continue;

                      // Don't overshoot — the walk approaches but doesn't
                      // reach (or pass) the target.
                      if (direction > 0 && stepMidi >= bridgeTargetMidi) break;
                      if (direction < 0 && stepMidi <= bridgeTargetMidi) break;

                      const insertTime = gapStart + slot * (s + 1);
                      // Quantize duration to 16th (0.25) or 8th (0.5) —
                      // matches QUANTIZED_DURATIONS contract; non-standard
                      // values trigger the audit's duration warning.
                      const insertDur = slot >= 0.55 ? 0.5 : 0.25;
                      events.push({
                          noteNumber: stepMidi,
                          time: insertTime,
                          duration: insertDur,
                          velocity: 85,
                          part: 'melody',
                          origin: 'develop',
                      });
                  }
              }
          }
      }

      mutatedMotif.forEach((m: any, idx) => {
          const swTime = applySwing(m.t, isShuffle);
          const absTime = startBeat + swTime;

          // Structural-note detection lifted ABOVE the projection so the
          // chromaticOffset avoid-snap (below) can gate on it. The same
          // three-clause definition is used by color magnetism / tension
          // correction further down: strong beat OR long duration OR
          // phrase end. Notes failing all three are passing tones.
          //
          // Strong-beat positions come from the song's meterContext:
          //   4/4 → [0, 2] (downbeat + halfway)
          //   3/4 → [0]    (waltz downbeat only)
          //   6/8 → [0, 1.5] (two compound beats)
          //   12/8 → [0, 1.5, 3, 4.5]
          //   5/4 → [0, 3] (3+2 grouping)
          const bpm = songCtx.songMeterContext.beatsPerMeasure;
          const beatPosition = ((m.t % bpm) + bpm) % bpm;
          const isStrongBeat = songCtx.songMeterContext.strongBeats.some(
              (sb) => Math.abs(beatPosition - sb) < 0.05,
          );
          const isLongDuration = m.d >= 1.5;
          const isPhraseEnd = idx === mutatedMotif.length - 1;
          const isStructuralNote = isStrongBeat || isLongDuration || isPhraseEnd;

          let targetRawMidi: number;

          if ('diatonicStep' in m) {
              // diatonicStep is "scale degree from chord root", per the
              // motif data's semantic intent. Project from the chord
              // root's index in runScale (rootProjIdx), NOT from the
              // aesthetic anchor. Aesthetic anchor sets the octave
              // register; chord root sets the pitch-class meaning of
              // step N.
              const step = m.diatonicStep;
              const targetIndex = rootProjIdx + step;
              const runScaleLength = runScale.length;
              const octaves = Math.floor(targetIndex / runScaleLength);
              let remIndex = targetIndex % runScaleLength;
              if (remIndex < 0) remIndex += runScaleLength;

              targetRawMidi = runScale[remIndex] + (octaves * 12);
          } else {
              // chromaticOffset is "semitones from chord root", per the
              // motif data's intent: c10 = b7 of chord, c14 = 9 of chord,
              // c17 = 11 of chord. Anchored at chord root in the aesthetic
              // anchor's octave register.
              //
              // Two structural-beat snaps run here. Both gated on
              // isStructuralNote so passing chromatics keep the bebop /
              // chromatic-approach color JAZZ depends on; only landing-
              // weight notes get pulled into key + chord contract.
              //
              //   1. Out-of-scale snap — if the chromatic projection
              //      lands on a pc that ISN'T in the bar's runScale
              //      (e.g. F# from chromaticOffset=2 on Em in C major,
              //      where C major = {C,D,E,F,G,A,B}), it's a chromatic
              //      foreign to the song's key palette. The motif's
              //      "9-of-chord" intent (= F# chromatic) needs to be
              //      reinterpreted as the DIATONIC 9 (= F natural) so
              //      the structural beat lands on a key-resident pc.
              //      The runScale already encodes the key palette
              //      (mode-of-key fast path) or the chord-borrowed
              //      scale (V/X with Phrygian Dominant, sub-V with
              //      Lydian Dominant, etc.) — it's the source of
              //      truth on what the listener should hear over this
              //      chord in this key.
              //
              //   2. Avoid snap — if the chromatic projection lands on
              //      a chord-type-specific avoid (e.g. 4th over a maj
              //      triad = 11 = avoid 11), snap to nearest non-avoid
              //      scale tone. Long-rung avoid on a structural beat
              //      corrupts the chord's quality.
              //
              // Both snaps draw from runScale (the same source of
              // truth) and prefer the closest scale tone to the
              // original chromatic projection within ±3 semitones.
              const literalMidi = rootMidiForProjection + (m.chromaticOffset || 0);
              const litPc = (((literalMidi % 12) + 12) % 12);
              const litIntervalFromChord = (((litPc - chordRootPc) % 12) + 12) % 12;
              const inScale = runScale.some(sm => (((sm % 12) + 12) % 12) === litPc);
              const isAvoid = isAvoidNote(litIntervalFromChord, chord.type, scaleNameForBar || undefined, isModalEnv, func);
              // bypassSnap 通行证 — 当 motif 数据明确标记 m.bypassSnap
              // (via "!" suffix in defineMotif or rule-level
              // bypassStructuralSnap), 跳过结构位 out-of-scale / avoid
              // 强制 snap. 用户对 #11 / b9 / etc. 色彩的明确保留意图
              // 优先于引擎的"绝对优先 contract"约束.
              if (isStructuralNote && !m.bypassSnap && (isAvoid || !inScale)) {
                  let bestMidi = literalMidi;
                  let bestDist = Infinity;
                  for (const sm of runScale) {
                      const smPc = (((sm % 12) + 12) % 12);
                      const smIntv = (((smPc - chordRootPc) % 12) + 12) % 12;
                      if (isAvoidNote(smIntv, chord.type, scaleNameForBar || undefined, isModalEnv, func)) continue;
                      const d = Math.abs(sm - literalMidi);
                      if (d < bestDist) { bestDist = d; bestMidi = sm; }
                  }
                  targetRawMidi = bestDist <= 3 ? bestMidi : literalMidi;
              } else {
                  targetRawMidi = literalMidi;
              }
          }

          let mNoteMidi = targetRawMidi;

          let contourDir = 0;
          if (idx > 0) contourDir = Math.sign(mNoteMidi - lastNoteMidi);
          else contourDir = Math.sign(mNoteMidi - melodyState.currentMidi); // Initial inertia

          const chordRootMidi = noteToMidi(chord.root + "0");
          let pcInterval = (mNoteMidi - chordRootMidi) % 12;
          if (pcInterval < 0) pcInterval += 12;

          // Global-harmony contract — chord literal + admissible
          // extensions per quality. Anything in the contract is fair
          // game on a structural beat under the divisi model.
          // literalIntervals stays the raw chord-type pattern for the
          // magnet's top-color-tone calculation below.
          const literalIntervals = CHORD_TYPES[chord.type] || CHORD_TYPES['maj'];
          const { intervals: globalIntervals, pcs: globalPcs } =
              computeGlobalContract(chord.type, chord.rootMidi);

          // Divisi 2.0 — Virtual Extension unlock. When the chord is in
          // 'SlashChord' state with virtualExtensions defined (e.g. F/G
          // exposes b7/9/11/13 of G as a suspended-dominant pool),
          // those tones become legal magnet targets even though they
          // aren't part of the upper chord's CHORD_TYPES contract. The
          // intervals are stored in semitones FROM THE BASS pitch, so
          // we add bassPc + interval to the candidate pcs and to a
          // separate vIntervalsFromBass list that the candidate-search
          // loop will consume below.
          const vIntervalsFromBass: number[] = [];
          if (chord.tensionState === 'SlashChord' && chord.virtualExtensions) {
              const bassPcLocal = (((chord.bassMidi % 12) + 12) % 12);
              for (const semis of chord.virtualExtensions) {
                  const pc = (((bassPcLocal + semis) % 12) + 12) % 12;
                  globalPcs.add(pc);
                  vIntervalsFromBass.push(semis);
              }
          }

          // Cadence-position guard — hoisted above the magnetism +
          // bass-decollision blocks so both can defer cleanly to
          // Cadence Resolution (Definition 4) at the phrase-end last
          // note. Re-checked redundantly in the Active Divisi block
          // for clarity at the trigger site.
          const isCadenceLastNote = shouldReturn && idx === mutatedMotif.length - 1;

          const isStable = globalPcs.has((((mNoteMidi) % 12) + 12) % 12);
          const isTension = !isStable && (
              isAvoidNote(pcInterval, chord.type, scaleNameForBar || undefined, isModalEnv, func)
              || (INTERVAL_AESTHETICS[pcInterval] && INTERVAL_AESTHETICS[pcInterval].tensionAmount > 0.5)
          );

          let resolved = false;

          // Sacred-boundary gate. Motif pitches are preserved verbatim
          // here. Cadence resolution (Definition 4, runs later) is the
          // single architectural exception that yields motif sacred at
          // phrase-end last notes; this magnetism block is responsible
          // only for non-cadence structural notes.
          const motifSacred = role === 'motif';

          // scaleNameForBar / scaleRootPcForBar 已在 generateBarPattern
          // 顶部 (line ~3825) 上提为函数级 scope, 这里直接复用.
          const scaleGravityRulesForBar = scaleNameForBar
              ? getScaleGravity(scaleNameForBar)
              : null;

          // ===========================================================
          // AND PIPELINE — single-pass constraint satisfaction
          //
          // Replaces the historical sequential override sequence
          // (Color Magnetism → VL Hold → VL Bridge → Bass Decollision
          // → VL Limits) with one pure decision: build candidate pool,
          // apply hard filters, score by soft preferences, pick best.
          // Deterministic randoms (sacred-allow gates) are pre-rolled
          // here so consumption order matches the legacy pipeline.
          // ===========================================================
          {
              // Pre-rolls (mirrors legacy random consumption order):
              //   1. Magnetism sacred-allow — random consumed but result
              //      no longer reads into shouldApply. Previously this
              //      gave sacred motif a 15% probability to keep an
              //      avoid note on a structural beat ("preserve motif
              //      color"). In practice this meant 15% of strong-
              //      beat avoid notes survived as-is and the listener
              //      heard them as "wrong". Authors who legitimately
              //      want a structural avoid note (e.g. b9 over m
              //      chord as deliberate tension) mark the motif note
              //      with `!` → bypassSnap flag → still escapes the
              //      no-avoid filter. Random consumption retained so
              //      the snapshot stream stays stable.
              //   2. Bass-decoll sacred-allow (only if sacred)
              const magnetSacredAllow = (motifSacred && isTension)
                  ? (songCtx.rng.next() < 0.85)
                  : true;
              void magnetSacredAllow;  // kept for stream stability; no longer consulted
              const bassDecollSacredAllow = motifSacred
                  ? (songCtx.rng.next() < 0.6)
                  : true;

              // (scaleGravityRulesForBar / scaleRootPcForBar declared
              //  at outer per-iteration scope so the post-emit state
              //  update can read them.)

              // Saturation tension info — passed to context for hard
              // filter "saturation-resolve".
              const projPcFromKey = ((mNoteMidi - rootKeyMidi) % 12 + 12) % 12;
              const saturatedPc = tensionTracker.isSaturated(projPcFromKey)
                  ? projPcFromKey : null;

              const ctx: NoteContext = {
                  chord, prevChord, nextChord, runScale,
                  globalIntervals, vIntervalsFromBass, literalIntervals,
                  barBackboneTargets,
                  voiceLeadingIn: null,  // not threaded down; closest-pair handles VL
                  voiceLeadingOut: null,
                  motifProjMidi: mNoteMidi,
                  lastNoteMidi,
                  isStructural: isStructuralNote,
                  isStrongBeat,
                  isFirstNote: idx === 0,
                  isLastNote: idx === mutatedMotif.length - 1,
                  isPhraseEnd: ((barIndex + 1) % (motifInterval || 4) === 0)
                      || (barIndex === totalBars - 1),
                  isMotifSacred: motifSacred,
                  isCadencePosition: isCadenceLastNote,
                  cadenceTargetPcs: null,    // computed in cadence stage below
                  cadenceMode: 'none',
                  saturatedTensionPcFromKey: saturatedPc,
                  urgentTensionPcFromKey: null,  // tension correction kept as separate stage
                  tensionResolveProb: 0,
                  tensionResolveRoll: 1,
                  chordRootPc: ((chord.rootMidi % 12) + 12) % 12,
                  bassPc: ((chord.bassMidi % 12) + 12) % 12,
                  keyRootPc: ((rootKeyMidi % 12) + 12) % 12,
                  rootKeyMidi,
                  complexity,
                  lastLeapSemis: melodyState.lastLeapSemis,
                  sameDirRunLength: melodyState.sameDirRunLength,
                  stepCount: melodyState.stepCount,
                  leapCount: melodyState.leapCount,
                  apexBarIdx: songCtx.songApexBarIdx,
                  apexPitchMidi: songCtx.songApexPitchMidi,
                  isApexBar: songCtx.songApexBarIdx >= 0 && barIndex === songCtx.songApexBarIdx,
                  isApexPhraseBar: songCtx.songApexPhraseStartBar >= 0
                      && barIndex >= songCtx.songApexPhraseStartBar
                      && barIndex <= songCtx.songApexPhraseEndBar,
                  barIndex,
                  scaleGravityRules: scaleGravityRulesForBar,
                  scaleRootPc: scaleRootPcForBar,
                  gravityStrictness: songCtx.songGravityStrictness,
                  effectiveFunc: chord.effectiveFunc ?? func,
                  bypassSnap: !!m.bypassSnap,
                  isModalContext: isModalEnv,
                  scaleNameForBar: scaleNameForBar || undefined,
                  style,
                  noteDuration: m.d,
              };

              // ===== Hard Filters =====
              const hardFilters: HardConstraint[] = [
                  // Universal range — replaces the legacy range clamp.
                  { name: 'in-melody-range',
                    shouldApply: () => true,
                    accept: (m) => m >= MELODY_RANGE.LOW && m <= MELODY_RANGE.HIGH },
                  // Avoid-note ban on structural beats (chord-quality-aware).
                  // Sacred motif yields when magnetSacredAllow is false.
                  // bypassSnap (per motif-note "!" suffix) overrides —
                  // author's explicit color statement.
                  { name: 'no-avoid',
                    shouldApply: (c) => c.isStructural
                        && !c.bypassSnap,
                    accept: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        const iv = ((pc - c.chordRootPc + 12) % 12);
                        return !isAvoidNote(iv, c.chord.type, c.scaleNameForBar, c.isModalContext, c.effectiveFunc);
                    } },
                  // ABSOLUTE PRIORITY — backbone + global harmony.
                  // At structural positions (strong beat / long /
                  // phrase-end) the melody MUST land in the chord
                  // contract = literal pcs ∪ admissible color
                  // extensions ∪ Composite-state virtual extensions.
                  // No other rule (apex / leap-recovery / step-leap /
                  // anything) is allowed to violate this — INCLUDING
                  // sacred motif. Per user:
                  // "骨干音的选择一定绝对优先,不能变,然后是全局和声原则,
                  //  这不能变". Placed right after no-avoid so it has
                  // top relax-priority — the LAST hard filter to drop
                  // is the contract guarantee. Sacred motif's non-
                  // contract structural pitches will be reshaped here;
                  // motif character at non-structural positions
                  // (passing 16ths) is unaffected.
                  { name: 'in-chord-contract',
                    shouldApply: (c) => c.isStructural && !c.bypassSnap,
                    accept: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        const root = c.chordRootPc;
                        // chord literal — always in contract
                        for (const iv of c.literalIntervals) {
                            if ((root + iv) % 12 === pc) return true;
                        }
                        // admissible color extensions (full contract)
                        for (const iv of c.globalIntervals) {
                            if ((root + iv) % 12 === pc) return true;
                        }
                        // Composite-state virtual extensions (reckoned
                        // from bass pc)
                        for (const semis of c.vIntervalsFromBass) {
                            if ((c.bassPc + semis) % 12 === pc) return true;
                        }
                        return false;
                    } },
                  // Octave-leap cap — replaces VL Limits L9.
                  { name: 'leap-octave-cap',
                    shouldApply: (c) => !c.isMotifSacred,
                    accept: (m, c) => Math.abs(m - c.lastNoteMidi) <= 12 },
                  // PC-dedupe — candidate pc must NOT equal previous
                  // emit's pc. The in-chord-contract constraint above
                  // forces structural notes onto a small chord-literal
                  // set (4-5 pcs); without pc-dedupe, multiple stepwise
                  // motif steps that snap to the closest chord-tone
                  // produce identical-pc clusters (audited as 5-13
                  // consecutive same-pc events). One step's worth of
                  // pc variance per emit is enough to break monotony
                  // while still allowing octave-displaced repeats
                  // (same pc at different octave is two distinct
                  // melody notes; the check is strict pc equality at
                  // the same octave).
                  //
                  // Sacred motif yields — if motif intentionally
                  // repeats a pc (rare in random fallback, common in
                  // hook-style motifs), let it through.
                  { name: 'no-same-pc-repeat',
                    shouldApply: (c) => !c.isMotifSacred && c.lastNoteMidi > 0,
                    accept: (m, c) => {
                        const pcNew = ((m % 12) + 12) % 12;
                        const pcPrev = ((c.lastNoteMidi % 12) + 12) % 12;
                        return pcNew !== pcPrev;
                    } },
                  // Saturation forced resolve — replaces L4 saturation
                  // block. When same-pc tension count == 2, candidate
                  // must be on a resolution target ∪ chord literal pcs.
                  { name: 'saturation-resolve',
                    shouldApply: (c) => !c.isMotifSacred && c.saturatedTensionPcFromKey !== null,
                    accept: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        const targets = getResolutionTargets(c.saturatedTensionPcFromKey!);
                        const absoluteTargets = new Set(targets.map(t =>
                            ((c.keyRootPc + t) % 12 + 12) % 12));
                        for (const iv of c.literalIntervals)
                            absoluteTargets.add((c.chordRootPc + iv) % 12);
                        return absoluteTargets.has(pc);
                    } },
                  // Unified tension resolution — the only hard
                  // constraint reading the evaluator's authoritative
                  // assessment of the previous emit. When the prior
                  // note's urgency exceeds UNRESOLVED_TENSION_THRESHOLD,
                  // the next note MUST land in that assessment's
                  // resolutionTargets (same-chord literal + next-chord
                  // anchor + key-relative expectedResolutions).
                  //
                  // Covers all five resolution paths the user laid out:
                  //   - Passing / Neighbor: prev dissonant within same
                  //     chord → next must step into resolutionTargets.
                  //     Direction (same vs opposite) handled by the
                  //     voice-leading constraint, not this one.
                  //   - Appoggiatura: large leap onto strong-beat
                  //     dissonance → assessment.urgency high → same
                  //     forced step-down to resolutionTargets.
                  //   - Suspension: prev consonant on old chord →
                  //     chord changes mid-hold → new evaluator pass
                  //     reports tension + urgency → next forced to
                  //     resolutionTargets. (State update below re-
                  //     evaluates against the CURRENT chord, so the
                  //     suspension trigger is automatic.)
                  //   - Harmonic Catch: prev dissonant on old chord
                  //     → chord changes → new evaluator pass on the
                  //     prior pitch under the NEW chord may report
                  //     consonance → urgency drops to 0 → constraint
                  //     doesn't fire. The note may stay; the catch
                  //     happened. (Handled in the state-update path
                  //     by re-assessing on chord change.)
                  //
                  // Sacred motif yields — same architectural reason
                  // as cadence resolution (Tier A/B/C): when global
                  // harmony declares an unresolved tendency, motif
                  // preservation steps aside at exactly one pitch.
                  { name: 'unified-tension-resolution',
                    shouldApply: () =>
                        melodyState.lastEmitAssessment !== null
                        && melodyState.lastEmitAssessment.urgency >= UNRESOLVED_TENSION_THRESHOLD,
                    accept: (m) => {
                        const pc = ((m % 12) + 12) % 12;
                        return melodyState.lastEmitAssessment!.resolutionTargets.includes(pc);
                    } },
                  // Cross-octave m9 / b9 physical clash filter. A melody
                  // pitch sitting exactly 13 semitones (minor 9th) above
                  // OR below any currently-sounding voicing MIDI produces
                  // an audibly harsh frequency-domain beat — the listener
                  // hears it as a low-register half-step grind even
                  // though pc-level the two notes are "the same scale
                  // tone an octave apart" (m9 is the octave-expanded m2).
                  // This was the 23-event "m9 clash" symptom audited
                  // across JAZZ + RNB seeds: melody legitimately landed
                  // on a chord-tone (e.g. Fm9's Ab as b3 of the chord
                  // = CHORD_TONE) while the voicing already held the 9
                  // (G4) → G4 + Ab5 = m9 grind.
                  //
                  // Sacred motif yields here — same architectural reason
                  // as cadence resolution and the tension-resolution
                  // constraint: physical acoustic clash overrides motif
                  // pitch preservation at exactly one note.
                  { name: 'no-cross-octave-m9',
                    shouldApply: () => true,
                    accept: (m, c) => {
                        // Authoritative MIDI source. Re-parsing notes[]
                        // through noteToMidi was the legacy fallback;
                        // notesMidi is the source-of-truth populated by
                        // realizeProgression.
                        const voicingMidis = c.chord.notesMidi
                            ?? c.chord.notes.map(n => noteToMidi(n));
                        for (const vMidi of voicingMidis) {
                            const diff = m - vMidi;
                            if (diff === 13 || diff === -13) return false;
                        }
                        return true;
                    } },
                  // Rule 9 — Leap Recovery. After a leap ≥ 5 semis,
                  // the next emitted note must move ≤ 2 semis in the
                  // OPPOSITE direction (or hold). This is the classical
                  // "law of recovery" — Bach chorales / Mozart melodies
                  // virtually 100% obey it. Sacred motif yields (the
                  // canonical lick may have intentional consecutive
                  // leaps as a gesture). Only applies when there's a
                  // recorded prior leap (lastLeapSemis !== 0); first
                  // note of song is exempt.
                  { name: 'leap-recovery',
                    shouldApply: (c) => !c.isMotifSacred
                        && Math.abs(c.lastLeapSemis) >= 5,
                    accept: (m, c) => {
                        const step = m - c.lastNoteMidi;
                        const prevDir = Math.sign(c.lastLeapSemis);
                        // Step must be opposite (or zero), and small.
                        if (step === 0) return true; // hold is fine
                        const sameDir = Math.sign(step) === prevDir;
                        if (sameDir) return false;   // continuing same direction = ban
                        return Math.abs(step) <= 2;  // recovery must be ≤ M2
                    } },
                  // Rule 11 — Anti-Monotonicity. Forbid 5+ consecutive
                  // same-direction motions. After 4 same-direction
                  // steps, this note must reverse or hold (= step in
                  // opposite direction OR = 0).
                  { name: 'anti-monotonicity',
                    shouldApply: (c) => !c.isMotifSacred
                        && c.sameDirRunLength >= 4,
                    accept: (m, c) => {
                        const step = m - c.lastNoteMidi;
                        if (step === 0) return true;
                        const lastDir = Math.sign(c.lastLeapSemis);
                        return Math.sign(step) !== lastDir;
                    } },
                  // Rule 10 — Apex Headroom (hard constraint at
                  // structural positions). At non-apex bars, structural
                  // notes (strong beat / long / phrase-end) must stay
                  // below the planned apex pitch. Passing tones (16th
                  // runs) are exempt — listener perceives apex as the
                  // longest emphasized pitch, not the highest 16th.
                  // Applies to sacred motif too: relaxation falls back
                  // to motif intent only when no in-scale candidate
                  // exists below apex, preserving motif when truly
                  // forced. Otherwise the constraint pulls structural
                  // peaks of non-apex bars below the song's apex
                  // pitch — guaranteeing apex singularity.
                  { name: 'apex-headroom',
                    shouldApply: (c) => c.apexBarIdx >= 0 && !c.isApexBar
                        && c.apexPitchMidi > 0 && c.isStructural,
                    accept: (m, c) => m < c.apexPitchMidi },
                  // 老师哲学 (升级): 回归是过程不是事件 — 4-2-3 / 4-5-3 /
                  // 4-1-3-2-1 等多音 / 包围回归全合法. 旧的单步 hard
                  // 强制 (resolve-leading-tone / resolve-four) 已删.
                  // key-relative 4/7 是否色彩取决于当前 chord 上下文 —
                  // 这层判定现在由 evaluateNoteInChordContext 实时给出,
                  // 由 unified-tension-resolution hard constraint 消费.
                  //
                  // scale-gravity 也升级到 line-based — pendingScaleLine
                  // 跟踪开窗时间 + line 尾, accept = stepwise from tail
                  // OR pc match scale target. 多音回归 / 包围回归 OK.
                  // 4 拍窗口期满未解决 → expire (听感张力散).
                  // 其他 hard filter (in-chord-contract 等) 仍主导
                  // structural backbone 判定.
                  { name: 'scale-gravity-line',
                    shouldApply: (c) => melodyState.pendingScaleResolveTarget !== null
                        && melodyState.pendingScaleLineWindowEnd > 0
                        && absTime <= melodyState.pendingScaleLineWindowEnd
                        && c.gravityStrictness >= 0.45
                        && melodyState.pendingScaleResolveScore >= 18,
                    accept: (m) => {
                        const target = melodyState.pendingScaleResolveTarget!;
                        const rootPc = melodyState.pendingScaleResolveRootPc;
                        const pc = ((m % 12) + 12) % 12;
                        const iv = ((pc - rootPc + 12) % 12);
                        // (a) Resolution — pc on scale target
                        if (iv === target) return true;
                        // (b) Stepwise continuation — must be ≤ 2 semis
                        // AND must close in on (or hold steady against)
                        // the gravity target. Step-size-only ignores
                        // direction: from Ab leading down to G, both
                        // Ab→A and Ab→G are ≤ 2 semis, but Ab→A walks
                        // AWAY from the target — direction-blind
                        // approval lets the line ping-pong instead of
                        // resolving. Pick the nearest target MIDI to
                        // the prior step's pitch and require the new
                        // candidate is no further from it.
                        const lastMidi = melodyState.pendingScaleLineLastMidi;
                        if (Math.abs(m - lastMidi) > 2) return false;
                        let nearestTargetMidi = -999;
                        let nearestDist = Infinity;
                        for (let cand = target; cand < 128; cand += 12) {
                            const d = Math.abs(cand - lastMidi);
                            if (d < nearestDist) {
                                nearestDist = d;
                                nearestTargetMidi = cand;
                            }
                        }
                        if (nearestTargetMidi < 0) return true; // defensive
                        const oldDist = Math.abs(lastMidi - nearestTargetMidi);
                        const newDist = Math.abs(m - nearestTargetMidi);
                        return newDist <= oldDist;
                    } },
                  // Color-line — 老师哲理: 9/11/13/7 (high-voice color)
                  // open a tension WINDOW. Resolution is a process, not
                  // a single event. Inside the window the candidate
                  // must EITHER:
                  //   (a) land on chord 1/3/5 pitch-class at any octave
                  //       — the line resolves, pending clears; OR
                  //   (b) be ≤ 2 semis from the line's tail — the line
                  //       continues stepwise (passing tone, 16th run,
                  //       enclosure, half-step approach, etc.).
                  // Anything else (leap into more color) breaks the
                  // line and is rejected.
                  // Window width is 4 beats — listener tension memory.
                  // Past windowEnd shouldApply returns false (tension
                  // dissipated). Cadence position yields to Tier A/B/C.
                  // Applies to ALL emits not just structural — passing
                  // tones and 16th runs are part of the line.
                  // 老师哲学: phrase end 最后一个音绝对不能是未解决的
                  // avoid (= 落"句尾稳定位"上的避讳音 = 听感塌). cadence
                  // position 由 Tier A/B/C 接管, 这里只补 non-cadence
                  // phrase end (= phraseShouldReturn false 的 phrase end).
                  { name: 'phrase-end-no-unresolved-avoid',
                    shouldApply: (c) => c.isPhraseEnd && c.isLastNote
                        && !c.isCadencePosition,
                    accept: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        const runPcs = new Set<number>(c.runScale.map(sm => ((sm % 12) + 12) % 12));
                        const role = classifyNoteRole(
                            pc,
                            c.chord.type,
                            c.chordRootPc,
                            c.scaleNameForBar || '',
                            c.isModalContext,
                            c.effectiveFunc,
                            c.scaleRootPc,
                            runPcs,
                        );
                        return role !== 'avoid';
                    } },
                  { name: 'color-line',
                    shouldApply: (c) => melodyState.pendingColorLine !== null
                        && absTime <= melodyState.pendingColorLine.windowEnd
                        && !c.isCadencePosition,
                    accept: (m, c) => {
                        const line = melodyState.pendingColorLine!;
                        const pc = ((m % 12) + 12) % 12;
                        // (a) Resolution — pc on chord 1/3/5 any octave
                        const chordTriad = getChordBackboneIntervals(c.chord.type);
                        for (const iv of chordTriad) {
                            if ((c.chordRootPc + iv) % 12 === pc) return true;
                        }
                        // (b) Stepwise continuation
                        return Math.abs(m - line.lineLastMidi) <= 2;
                    } },
              ];

              // ===== Soft Scores =====
              const softScores: SoftScore[] = [
                  // Color Magnetism — prefer chord literal at structural beats
                  { name: 'in-chord-literal', weight: 2.0,
                    shouldApply: (c) => c.isStructural,
                    score: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        for (const iv of c.literalIntervals) {
                            if ((c.chordRootPc + iv) % 12 === pc) return 1;
                        }
                        return 0;
                    } },
                  // Admissible color (in contract but not literal)
                  { name: 'in-admissible-color', weight: 1.0,
                    shouldApply: (c) => c.isStructural,
                    score: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        let inLit = false;
                        for (const iv of c.literalIntervals) {
                            if ((c.chordRootPc + iv) % 12 === pc) { inLit = true; break; }
                        }
                        if (inLit) return 0;
                        for (const iv of c.globalIntervals) {
                            if ((c.chordRootPc + iv) % 12 === pc) return 1;
                        }
                        for (const semis of c.vIntervalsFromBass) {
                            if ((c.bassPc + semis) % 12 === pc) return 1;
                        }
                        return 0;
                    } },
                  // Top color tone — chord type's highest extension
                  // (m9's 9, 13's 13, etc.) when complexity ≥ 0.5.
                  // Implements the Divisi 2.0 "magnet upper-extension"
                  // bias.
                  { name: 'top-color-bonus', weight: 1.5,
                    shouldApply: (c) => c.isStructural && c.complexity >= 0.5
                        && c.literalIntervals.length > 4,
                    score: (m, c) => {
                        const topIv = c.literalIntervals[c.literalIntervals.length - 1];
                        const topPc = (c.chordRootPc + topIv) % 12;
                        const pc = ((m % 12) + 12) % 12;
                        return pc === topPc ? 1 : 0;
                    } },
                  // Method 2 last-note → pcA of closest cross-chord pair
                  { name: 'closest-pair-pcA', weight: 1.5,
                    shouldApply: (c) => c.isLastNote && c.nextChord !== null,
                    score: (m, c) => {
                        const projPc = ((c.motifProjMidi % 12) + 12) % 12;
                        const { pcA } = findClosestCrossChordPair(c.chord, c.nextChord!, projPc);
                        const pc = ((m % 12) + 12) % 12;
                        return pc === pcA ? 1 : 0;
                    } },
                  // Method 2 first-note → pcB of closest cross-chord pair
                  // (only when the natural projection would leap ≥ 4)
                  { name: 'closest-pair-pcB', weight: 1.0,
                    shouldApply: (c) => c.isFirstNote && c.prevChord !== null
                        && Math.abs(c.motifProjMidi - c.lastNoteMidi) >= 4,
                    score: (m, c) => {
                        const prevPc = ((c.lastNoteMidi % 12) + 12) % 12;
                        const { pcB } = findClosestCrossChordPair(c.prevChord!, c.chord, prevPc);
                        const pc = ((m % 12) + 12) % 12;
                        return pc === pcB ? 1 : 0;
                    } },
                  // Bass decollision — penalize melody pc == bass pc
                  // on structural beats. Sacred motif yields when
                  // bassDecollSacredAllow is false.
                  { name: 'avoid-bass-unison', weight: 1.0,
                    shouldApply: (c) => c.isStructural
                        && (!c.isMotifSacred || bassDecollSacredAllow),
                    score: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        return pc === c.bassPc ? -1 : 0;
                    } },
                  // Rule 8 — Step/Leap distribution bias toward 70-80%
                  // step. Tracks running ratio across the song; biases
                  // candidates that maintain target distribution.
                  // - When ratio < 0.70 (leap-heavy), step candidates
                  //   (≤ 2 semis from prev) get +1 bonus.
                  // - When ratio > 0.85 (over-step), leap candidates
                  //   (≥ 3 semis) get +0.4 bonus.
                  // - Within target band (0.70-0.85), no preference.
                  // First few notes (total < 4) default to "prefer step"
                  // for natural melodic motion.
                  { name: 'step-leap-distribution', weight: 1.5,
                    shouldApply: (c) => !c.isFirstNote && !c.isMotifSacred,
                    score: (m, c) => {
                        const total = c.stepCount + c.leapCount;
                        const ratio = total > 0 ? c.stepCount / total : 0.75;
                        const stepLikeNeeded = total < 4 || ratio < 0.70;
                        const leapLikeNeeded = ratio > 0.85;
                        const stepFromPrev = Math.abs(m - c.lastNoteMidi);
                        const isStep = stepFromPrev > 0 && stepFromPrev <= 2;
                        const isLeap = stepFromPrev >= 3;
                        if (stepLikeNeeded && isStep) return 1;
                        if (leapLikeNeeded && isLeap) return 0.4;
                        return 0;
                    } },
                  // Scale Gravity (universal physics). When the
                  // PREVIOUS emitted note triggered a fromInterval in
                  // SCALE_GRAVITY[scaleName], that gravity points at
                  // a target interval. This score rewards candidates
                  // landing on the target. Weight is dynamic via
                  // gravityStrictness × rule.score / 25 (rule scores
                  // are 0-30; we normalize). Style.gravityStrictness
                  // (0..1) controls how much the engine obeys the
                  // physics: POP 0.85 strict, JAZZ 0.35 loose.
                  { name: 'scale-gravity-target', weight: 1.0,
                    shouldApply: (c) => c.scaleGravityRules !== null
                        && c.scaleRootPc >= 0
                        && melodyState.pendingScaleResolveTarget !== null
                        && melodyState.pendingScaleResolveScore > 0,
                    score: (m) => {
                        const target = melodyState.pendingScaleResolveTarget!;
                        const pc = ((m % 12) + 12) % 12;
                        const intervalFromScaleRoot = ((pc - melodyState.pendingScaleResolveRootPc + 12) % 12);
                        if (intervalFromScaleRoot === target) {
                            // Score = rule.score × strictness, normalized to ~ 0-1.5 range.
                            return melodyState.pendingScaleResolveScore / 25
                                * songCtx.songGravityStrictness;
                        }
                        return 0;
                    } },
                  // Rule 10 — Apex target. At the planned apex bar
                  // (golden-ratio position 60-75% of song), a strong
                  // bonus pulls the highest structural note onto the
                  // pre-planned apex pitch. Only fires on structural
                  // beats so passing tones are unaffected.
                  { name: 'apex-target', weight: 4.0,
                    shouldApply: (c) => c.isApexBar && c.isStructural
                        && c.apexPitchMidi > 0,
                    score: (m, c) => m === c.apexPitchMidi ? 1 : 0 },
                  // Phrase register — apex phrase 整段抬高基线音区.
                  // 老师 E: apex 不是单点, 是整 phrase 的 register
                  // baseline. apex phrase 内任何 structural 候选, midi
                  // 在 apexPitch ± 5 半音窗内得分 1, 距离窗外按线性
                  // 衰减. apex bar 自身已被 apex-target 4.0 主导;
                  // 此 score (weight 1.5) 抬高 apex phrase 内非 apex
                  // bar 的整体音区, 不会喧宾夺主.
                  { name: 'phrase-register-target', weight: 1.5,
                    shouldApply: (c) => c.isApexPhraseBar && !c.isApexBar
                        && c.isStructural && c.apexPitchMidi > 0,
                    score: (m, c) => {
                        const target = c.apexPitchMidi;
                        const d = Math.abs(m - target);
                        if (d <= 5) return 1;
                        if (d >= 12) return 0;
                        return 1 - (d - 5) / 7;
                    } },
                  // 老师哲学落地: 音的角色 × 位置评分.
                  // 5 类角色 base 分:
                  //   chord_tone      +1.0  — 强拍长音首选
                  //   stable_tension  +0.5  — 可以但比 chord 音弱
                  //   characteristic  ±0.4  — 调式 +0.4 / 调性 -0.2
                  //                            (调性下特征音降级)
                  //   avoid           -0.8  — 弱拍短音 OK, 强拍长音重罚
                  //   chromatic       -0.6  — 半音装饰只在短时值
                  // 位置乘数:
                  //   strong beat    ×2
                  //   long (d≥1)     ×2
                  //   phrase-end last ×3
                  // 综合: chord 音 强拍长音 +1.0×4 = +4 强奖励;
                  //       avoid 强拍长音 -0.8×4 = -3.2 强惩罚;
                  //       avoid 弱拍 -0.8×1 = -0.8 可接受 (经过).
                  // 老师哲学: 避讳音级进解决奖励 (4→3, b6→5, b2→1 通用化).
                  // 上一 emit 是 avoid + 当前候选 stepwise (≤2 半音) +
                  // 当前候选是 chord_tone → 强奖励. 这是"避讳音允许使用,
                  // 但要解决"路径的明确加分. weight 2.5 跟 role-by-position
                  // 协同 (前者 3.0 给方向, 这里 2.5 给解决路径加成).
                  { name: 'avoid-resolution-reward', weight: 2.5,
                    shouldApply: () => melodyState.lastEmitRole === 'avoid'
                        && melodyState.lastEmitMidi > 0,
                    score: (m, c) => {
                        const step = Math.abs(m - melodyState.lastEmitMidi);
                        if (step > 2) return 0;
                        const pc = ((m % 12) + 12) % 12;
                        const runPcs = new Set<number>(c.runScale.map(sm => ((sm % 12) + 12) % 12));
                        const role = classifyNoteRole(
                            pc,
                            c.chord.type,
                            c.chordRootPc,
                            c.scaleNameForBar || '',
                            c.isModalContext,
                            c.effectiveFunc,
                            c.scaleRootPc,
                            runPcs,
                        );
                        if (role === 'chord_tone') return 1.0;
                        if (role === 'stable_tension') return 0.4;
                        return 0;
                    } },
                  { name: 'note-role-by-position', weight: 3.0,
                    shouldApply: () => true,
                    score: (m, c) => {
                        const pc = ((m % 12) + 12) % 12;
                        const runPcs = new Set<number>(c.runScale.map(sm => ((sm % 12) + 12) % 12));
                        const role = classifyNoteRole(
                            pc,
                            c.chord.type,
                            c.chordRootPc,
                            c.scaleNameForBar || '',
                            c.isModalContext,
                            c.effectiveFunc,
                            c.scaleRootPc,
                            runPcs,
                        );
                        const base: Record<NoteRole, number> = {
                            chord_tone:     1.0,
                            stable_tension: 0.5,
                            characteristic: c.isModalContext ? 0.4 : -0.2,
                            avoid:          -0.8,
                            chromatic:      -0.6,
                        };
                        let mult = 1;
                        if (c.isStrongBeat) mult *= 2;
                        if (c.noteDuration >= 1.0) mult *= 2;
                        if (c.isPhraseEnd && c.isLastNote) mult *= 3;
                        return base[role] * mult;
                    } },
                  // BLUES stepwise-bonus — rewards candidates within ±2
                  // semitones of the previous emit so the line threads
                  // blues-scale tones (b3/3/4/b5/5/b7) in a continuous
                  // lick-flow rather than arpeggiating chord 1/3/5/7
                  // (which is what in-chord-literal at weight 2.0 would
                  // otherwise dominate). Heavier than step-leap-
                  // distribution's stepwise reward so it actually pulls
                  // the choice on structural beats too.
                  { name: 'blues-stepwise-bonus', weight: 3.0,
                    shouldApply: (c) => c.style === 'BLUES' && c.lastNoteMidi > 0,
                    score: (m, c) => {
                        const semis = Math.abs(m - c.lastNoteMidi);
                        if (semis === 0) return 0;        // same MIDI handled separately
                        if (semis <= 2) return 1;          // stepwise lick
                        if (semis <= 4) return 0.3;        // small leap, still flow
                        return 0;
                    } },
                  // Anti-bridge same-MIDI penalty — universal. The hard
                  // no-same-pc-repeat bans candidates whose PC equals
                  // the previous emit's PC; this soft penalty discourages
                  // identical-MIDI candidates that survive when the hard
                  // filter relaxes (sacred motif, sparse candidate pool),
                  // and also penalizes "octave bounce" (m === lastMidi
                  // ± 12) which sounds like a stutter. Strong enough to
                  // override marginal preferences but not load-bearing
                  // ones (in-chord-literal weight 2.0 still wins when
                  // the only stepwise option lies outside contract).
                  { name: 'same-midi-bridge-penalty', weight: 1.2,
                    // BLUES + RNB only — these styles have repetition-
                    // heavy motif fallbacks and color-tone wallpapering
                    // tendencies. JAZZ + POP main pipelines already
                    // distribute candidates well; adding the penalty
                    // there cost ~4% melodyOK% (3 notes / song push out
                    // of contract) for no measurable shape benefit.
                    shouldApply: (c) => (c.style === 'BLUES' || c.style === 'RNB')
                        && c.lastNoteMidi > 0 && !c.isFirstNote,
                    score: (m, c) => {
                        if (m === c.lastNoteMidi) return -1;
                        if (m === c.lastNoteMidi + 12 || m === c.lastNoteMidi - 12) return -0.6;
                        return 0;
                    } },
              ];

              const newMidi = selectBestMidi(ctx, hardFilters, softScores);
              if (newMidi !== mNoteMidi) {
                  mNoteMidi = newMidi;
                  resolved = true;
                  pcInterval = (mNoteMidi - chordRootMidi) % 12;
                  if (pcInterval < 0) pcInterval += 12;
              }
          }


          // Texture–melody collision avoidance with 50/50 skip-or-shift.
          // Per architecture rule "如果伴奏和旋律有相同的音符，则旋律50%概率
          // 不使用这个音符". When the melody pitch matches an active texture
          // note, half the time we drop the melody event entirely (silence
          // for that beat — the texture chord covers the rhythm), the other
          // half we shift up one scale step (existing behaviour). Sacred
          // motif notes opt out — the canonical melody shape is preserved.
          let skipThisNote = false;
          if (!resolved && !motifSacred) {
              const collidingTexMidis = new Set<number>();
              for (const te of textureEvents) {
                  if (Math.abs(te.time - absTime) < 0.1) collidingTexMidis.add(te.noteNumber);
              }
              if (collidingTexMidis.has(mNoteMidi)) {
                  if (songCtx.rng.next() < 0.5) {
                      skipThisNote = true;
                  } else {
                      // Step-up to next runScale tone. Validate the
                      // replacement against the same musical contract
                      // the per-note pipeline enforced — runScale
                      // contains scale tones some of which are avoid
                      // notes or sit outside the chord contract, and
                      // an unchecked step-up can land the structural
                      // beat on either. If the candidate fails, keep
                      // the original (collision tolerated) rather than
                      // silently writing the wrong note.
                      const tryIndex = runScale.indexOf(mNoteMidi) + 1;
                      if (tryIndex > 0 && tryIndex < runScale.length) {
                          const candidate = runScale[tryIndex];
                          const candPc = ((candidate % 12) + 12) % 12;
                          const ivFromRoot = ((candPc - ((chord.rootMidi % 12) + 12) % 12) + 12) % 12;
                          const isAvoid = isStructuralNote && isAvoidNote(
                              ivFromRoot, chord.type, scaleNameForBar || undefined,
                              isModalEnv, chord.effectiveFunc ?? func,
                          );
                          const inContract = !isStructuralNote
                              || computeGlobalContract(chord.type, ((chord.rootMidi % 12) + 12) % 12).pcs.has(candPc);
                          if (!isAvoid && inContract) {
                              mNoteMidi = candidate;
                          }
                      }
                  }
              }
          }

          // Cadence Resolution (Definition 4 — dynamic context-aware
          // cadence). shouldReturn was decided at the song level by
          // style.returnRule (enabled / trigger / probabilityPerPhrase).
          // Sacred motif bars NO LONGER bail out — Definition 4 yields
          // sacred at the cadence position because the listener's
          // resolution expectation outranks pitch preservation.
          //
          // The tier classifier picks one of:
          //   A_global_T  → snap to global key root or 3 (剧终绝对回归)
          //   B_phrase_T  → snap to chord 1/3/5, no extensions (句号)
          //   C_phrase_DS → preserve tension if already in extended
          //                 contract; soft snap if not (问号 / 省略号)
          //
          // forceReturnHere upgrades the event's origin tag to 'return'
          // so the audit can count cadential rewrites separately.
          let forceReturnHere = false;
          // Divisi 2.0 — Cadence intercept. When the chord is in
          // 'FirstInversion' or 'Cadential64' state, the bass is sliding
          // (3rd in bass) or building tension (5th in bass / 6/4),
          // and a hard snap to 1/3/5 here cancels the harmonic
          // motion the listener is tracking. Skip Cadence Resolution
          // on those states — the melody continues to flow and lands
          // organically.
          //
          // EXCEPTION: at the song's final bar (`isLast`), cadence
          // ALWAYS fires regardless of state. Per the user's
          // architectural priority "return-to-stable is highest",
          // the song must close — Tier A handles T-function landings
          // on key tonic; Tier C handles D/S landings via
          // preserve-tension which naturally accommodates flowing
          // states without forcing a hard snap.
          // Cadence is blocked only by REAL flowing inversions — bass on
          // the 3rd (FirstInversion proper) or 5th (SecondInversion /
          // Cadential64). evaluateTensionState's fallback also tags
          // 7th-in-bass and other non-3rd shells as 'FirstInversion'
          // (see musicTheory.ts), but those aren't flowing inversions —
          // they're slash-flavored harmonies whose phrase endings
          // should still receive cadence resolution.
          const cadRootPc = ((chord.rootMidi % 12) + 12) % 12;
          const cadBassPc = ((chord.bassMidi % 12) + 12) % 12;
          const cadBassIvToRoot = ((cadBassPc - cadRootPc + 12) % 12);
          const isRealFirstInversion = chord.tensionState === 'FirstInversion'
              && (cadBassIvToRoot === 3 || cadBassIvToRoot === 4);
          const cadenceBlocked = !isLast && (
              isRealFirstInversion
              || chord.tensionState === 'SecondInversion'
              || chord.tensionState === 'Cadential64'
          );
          if (shouldReturn && idx === mutatedMotif.length - 1 && !cadenceBlocked) {
              const isGlobalEnd = isLast;
              const isLastChordT = isLast && func === 'T';
              const tier = classifyCadenceTier({
                  isGlobalEnd,
                  isPhraseEndNote: true,
                  func,
                  isLastChordT,
                  phraseRole,
              });
              if (tier !== 'none') {
                  const keyRootPc = noteToMidi(musicKey + "0") % 12;
                  const keyIsMinor = musicMode === 'Minor' || musicMode === 'Aeolian';
                  const { pcs: targetPcs, mode } = cadenceTargetPcs(
                      tier, chord.type, chord.rootMidi % 12,
                      { keyRootPc, keyIsMinor }
                  );
                  const currentPc = (((mNoteMidi) % 12) + 12) % 12;
                  const shouldSnap = mode === 'force' || !targetPcs.has(currentPc);
                  if (shouldSnap && targetPcs.size > 0) {
                      mNoteMidi = snapMidiToNearestPc(mNoteMidi, targetPcs, runScale);
                      forceReturnHere = true;
                  }
              }
          }

          // Saturation block — if the projected pitch's pc is a tension
          // already at MAX_OCCURRENCES (= 2) and unresolved within the
          // current harmonic cycle, REFUSE the 3rd same-pc emission.
          // Magnetize to a chord-aware resolution target instead. This
          // is the "最多 2 次" hard cap — independent of style strictness,
          // independent of structural-note gate. A 3rd 7 in a row over
          // an unresolved cycle becomes 1; a 3rd F (4th) over Cmaj
          // becomes E or C (whichever is closest chord tone).
          {
              const projectedPc = ((mNoteMidi - rootKeyMidi) % 12 + 12) % 12;
              if (!motifSacred && tensionTracker.isSaturated(projectedPc)) {
                  const targets = getResolutionTargets(projectedPc);
                  // Add chord-literal pcs (relative to KEY root, since the
                  // tracker speaks in key-relative pcs).
                  const chordRootPcAbs = ((chord.rootMidi % 12) + 12) % 12;
                  const keyRootPcAbs = ((rootKeyMidi % 12) + 12) % 12;
                  for (const iv of literalIntervals) {
                      const absPc = (chordRootPcAbs + iv) % 12;
                      const fromKey = ((absPc - keyRootPcAbs) % 12 + 12) % 12;
                      if (!targets.includes(fromKey)) targets.push(fromKey);
                  }
                  if (targets.length > 0) {
                      const baseOct = Math.floor(mNoteMidi / 12);
                      let best = mNoteMidi;
                      let bestDist = Infinity;
                      for (const tPc of targets) {
                          const absPc = ((rootKeyMidi + tPc) % 12 + 12) % 12;
                          for (let oct = -1; oct <= 1; oct++) {
                              const cand = absPc + (baseOct + oct) * 12;
                              const d = Math.abs(cand - mNoteMidi);
                              if (d < bestDist) { bestDist = d; best = cand; }
                          }
                      }
                      // Wider clamp than soft corrective (≤6) since this is
                      // a hard cap — must move; ±6 is still within a
                      // tritone, no violent leap.
                      if (bestDist <= 6 && bestDist > 0) {
                          mNoteMidi = getClosestScaleMidi(best, runScale, 0);
                      }
                  }
              }
          }

          // Tension-driven correction (count == 1, soft pressure):
          // probability-gated by the style's tensionResolutionStrictness.
          // POP / cadence-driven styles (0.7) snap aggressively; JAZZ /
          // ambient (0.15-0.3) leaves most tensions hanging — the
          // genre-defining "挂紧张" aesthetic. count == 2 is handled by
          // the saturation block above (mandatory, no probability).
          let correctedToResolution = false;
          if (!motifSacred && isStructuralNote) {
              const urgent = tensionTracker.getMostUrgentTension();
              if (urgent !== null) {
                  const profile = STYLE_DICTIONARY[style];
                  const strictness = profile?.tensionResolutionStrictness ?? 0.5;
                  if (songCtx.rng.next() < strictness) {
                      const targets = getResolutionTargets(urgent);
                      // Chord-aware: add current chord's literal pcs as
                      // resolution candidates (key-relative). Per user:
                      // "倾向解决到4或者0这个要根据当前和弦决定".
                      const chordRootPcAbs = ((chord.rootMidi % 12) + 12) % 12;
                      const keyRootPcAbs = ((rootKeyMidi % 12) + 12) % 12;
                      for (const iv of literalIntervals) {
                          const absPc = (chordRootPcAbs + iv) % 12;
                          const fromKey = ((absPc - keyRootPcAbs) % 12 + 12) % 12;
                          if (!targets.includes(fromKey)) targets.push(fromKey);
                      }
                      if (targets.length > 0) {
                          const baseOct = Math.floor(mNoteMidi / 12);
                          let best = mNoteMidi;
                          let bestDist = Infinity;
                          for (const targetPc of targets) {
                              const absPc = ((rootKeyMidi + targetPc) % 12 + 12) % 12;
                              for (let octShift = -1; octShift <= 1; octShift++) {
                                  const candidate = absPc + (baseOct + octShift) * 12;
                                  const d = Math.abs(candidate - mNoteMidi);
                                  if (d < bestDist) { bestDist = d; best = candidate; }
                              }
                          }
                          // Only snap when the resolution target is within
                          // a melodic step (≤ 4 semitones) — avoids violent
                          // octave jumps just to satisfy the tracker.
                          if (bestDist <= 4 && bestDist > 0) {
                              mNoteMidi = getClosestScaleMidi(best, runScale, 0);
                              correctedToResolution = true;
                          }
                      }
                  }
              }
          }

          // Feed the final pitch decision to TensionTracker. pcFromKey
          // is the pitch class relative to the song's key root, matching
          // INTERVAL_AESTHETICS' semitone-offsets-from-key-root
          // convention. checkResolution gets isStructural (only structural-
          // position notes count as "the listener heard the resolution
          // land") and the current chord's literal pcs (chord-aware
          // resolution per user direction).
          //
          // Gated by !skipThisNote: a skipped note never reaches the
          // listener, so it must not appear to resolve or add tension —
          // phantom notes would corrupt subsequent corrections.
          const pcFromKey = ((mNoteMidi - rootKeyMidi) % 12 + 12) % 12;
          if (!skipThisNote) {
              const chordRootPcForTracker = ((chord.rootMidi % 12) + 12) % 12;
              const keyRootPcForTracker = ((rootKeyMidi % 12) + 12) % 12;
              const chordLitFromKey = new Set<number>();
              for (const iv of literalIntervals) {
                  const absPc = (chordRootPcForTracker + iv) % 12;
                  chordLitFromKey.add(((absPc - keyRootPcForTracker) % 12 + 12) % 12);
              }
              tensionTracker.checkResolution(pcFromKey, isStructuralNote, chordLitFromKey);
              tensionTracker.addTension(pcFromKey, absTime);
          }

          const velocity = Math.max(0.4, Math.min(1.0, 0.6 + Math.sin((idx / mutatedMotif.length) * Math.PI) * 0.3 + (songCtx.rng.next() * 0.2)));
          
          let timeDiff = 0;
          let pitchDiff = 0;
          let absPitchDiff = 0;
          let lastAbsTime = absTime;

          if (idx > 0) {
              // motifMutator can insert chromatic-approach notes so
              // mutatedMotif may exceed motif.length. The previous-note
              // lookup must use mutatedMotif since idx is iterating it.
              const lastSwTime = applySwing(mutatedMotif[idx-1].t, isShuffle);
              lastAbsTime = startBeat + lastSwTime;
              timeDiff = absTime - lastAbsTime;
              pitchDiff = mNoteMidi - lastNoteMidi;
              absPitchDiff = Math.abs(pitchDiff);
          }

          // 老师: 装饰音过度滥用. 当前 ~7% melody note 是 grace, 实际
          // 演奏 1-3% 为合理. 收紧条件:
          //   - 跳进才装饰 (≥3 半音): 2 半音已经是步进, 不需"半音趋近"
          //   - 概率 25% (rand > 0.75): 真演奏 grace 不每跳必加
          const needsGraceNote = absPitchDiff >= 3 && absPitchDiff <= 5
              && timeDiff >= 0.5 && songCtx.rng.next() > 0.75;
          const passingNoteChance = absPitchDiff >= 3 && absPitchDiff <= 7 && timeDiff >= 1.0 && songCtx.rng.next() > 0.4;

          // Skip the passing tone when the destination note (mNoteMidi)
          // is being skipped — a passing tone is by definition the bridge
          // *between* lastNoteMidi and mNoteMidi, so removing the
          // destination leaves it dangling into silence.
          if (passingNoteChance && idx > 0 && !skipThisNote) {
              const passTime = lastAbsTime + (timeDiff / 2);
              // Passing tones snap to a 16th — the shortest standard
              // value. Any longer (e.g. timeDiff*0.25 unquantized) leaks
              // non-standard durations into the melody track and breaks
              // the QUANTIZED_DURATIONS contract for the whole pipeline.
              const passDur = 0.25;

              const avgPitch = lastNoteMidi + Math.round(pitchDiff / 2);
              let passPitchMidi = getClosestScaleMidi(avgPitch, runScale, 0);
              
              if (passPitchMidi === lastNoteMidi || passPitchMidi === mNoteMidi) {
                  passPitchMidi = getClosestScaleMidi(avgPitch, runScale, pitchDiff > 0 ? 1 : -1);
              }

              if (passPitchMidi !== lastNoteMidi && passPitchMidi !== mNoteMidi) {
                  // Range clamp passing tones too — they share the same
                  // playable window as the rest of the melody.
                  while (passPitchMidi > MELODY_RANGE.HIGH) passPitchMidi -= 12;
                  while (passPitchMidi < MELODY_RANGE.LOW) passPitchMidi += 12;
                  // Passing tones inserted between motif notes are always
                  // engine-derived connectors, never sacred — tag as develop
                  // even within a motif bar.
                  events.push({
                      noteNumber: passPitchMidi,
                      time: passTime,
                      duration: passDur,
                      velocity: Math.abs(Math.round(velocity * 0.85 * 127)),
                      part: 'melody',
                      origin: 'develop'
                  });
              }
          }

          // (Per-note Active Divisi Magnet was removed: pulling EVERY
          // note ≥ 0.25 beat onto the chord's top vacated extension
          // turned scalar runs into a single-pc repeat ("F-F-F-F-F"
          // on Cm11 with 8th notes). Color tones are decoration, not
          // wallpaper. The bar-level guarantor — at the end of
          // generateBarPattern, after Run Generator — provides the
          // architectural divisi guarantee by rewriting ONE note per
          // bar (the longest non-cadence develop/motif event) onto
          // the top vacated pc, and only when no note in the bar
          // already landed there. One declaration of color per bar
          // is enough for the listener to register the chord's full
          // type; more is repetition.)

          // Universal range clamp — bring shrill highs (> E6) and rumbly
          // lows (< A1) back into the melody window by octave-shifting.
          // Applies to ALL notes including sacred motif: octave shift
          // preserves the motif's interval relationships, only relocates
          // the register.
          while (mNoteMidi > MELODY_RANGE.HIGH) mNoteMidi -= 12;
          while (mNoteMidi < MELODY_RANGE.LOW) mNoteMidi += 12;

          // Cross-octave m9 escape. Any pitch sitting exactly 13 semis
          // (= m9 = octave-expanded m2) above or below a currently-
          // sounding voicing note creates an audible half-step grind
          // even when both pitches are pc-legitimate chord tones — the
          // canonical case is b3 of Cm9 (Eb5) sounding against the 9
          // (D4) one m9 apart.
          //
          // Anchor scoring's `no-cross-octave-m9` filter catches the
          // first-of-bar note; this catches mid-bar motif projections,
          // passing tones, run-generator inserts, and grace notes that
          // bypass anchor scoring. Sacred motif yields per the same
          // architectural rule as cadence resolution: physical
          // acoustic clash overrides pitch preservation.
          //
          // Strategy: shift ±12 (keeps pc identical → motif interval
          // pattern reads unchanged). Prefer whichever direction
          // escapes the clash and stays in MELODY_RANGE. If neither
          // works (rare — voicing covers both flanks), keep the
          // original — accepting the clash is preferable to dropping
          // out of range or destroying the motif's pc.
          {
              const voicingMidis = chord.notesMidi ?? chord.notes.map(n => noteToMidi(n));
              const formsM9 = (mid: number) =>
                  voicingMidis.some(v => mid - v === 13 || mid - v === -13);
              if (formsM9(mNoteMidi)) {
                  const candidates = [mNoteMidi - 12, mNoteMidi + 12];
                  const fix = candidates.find(c =>
                      c >= MELODY_RANGE.LOW && c <= MELODY_RANGE.HIGH && !formsM9(c)
                  );
                  if (fix !== undefined) mNoteMidi = fix;
              }
          }

          // Inherit the bar role onto each direct motif note. role==='rest'
          // never reaches this loop (mutatedMotif stays empty).
          // forceReturnHere (style.returnRule) and correctedToResolution
          // (TensionTracker corrective) both upgrade the note to 'return'.
          const eventOrigin: 'motif' | 'develop' | 'return' =
              (forceReturnHere || correctedToResolution) ? 'return'
              : role === 'develop' ? 'develop'
              : 'motif';

          // Humanization — break the "machine-gun" grid feel.
          //
          // velocity: the parabolic + jitter velocity from line 2118 is
          // already in [0.4, 1.0]. Heavy accent mode used to hard-clamp
          // downbeats to 127 (the sample's loudest layer), losing all
          // dynamic shaping. Capped at 0.95 (≈ 121) globally so the
          // loudest sample layer stays in reserve; accents still get a
          // small boost over surrounding notes.
          //
          // micro-timing: melody events used to receive a deterministic
          // ±0.008-beat position-hash jitter for "human feel". Removed
          // because bass + chord (texture) are exact-grid, so the jitter
          // produced 4-8ms misalignment between melody and accompaniment
          // at the same nominal beat — the listener perceives this as
          // "off-beat" smearing on strong beats. Modern pop/jazz mixes
          // expect grid-tight timing; intentional groove (behind/ahead
          // of beat) belongs at the global clock level, not per-note.
          const isAccent = accentMode === 'heavy' && (m.t % 1 === 0);
          const velocityFinal = isAccent ? velocity * 1.05 : velocity;
          const velocityMidi = Math.abs(Math.round(Math.min(0.95, velocityFinal) * 127));
          const humanizedTime = absTime;

          // skipThisNote (texture-collision 50% drop) bypasses event push
          // and lastNoteMidi update — the listener hears just the texture
          // chord at this beat, and the next note's voice-leading reference
          // remains the previously emitted note.
          if (!skipThisNote) {
              if (needsGraceNote && idx > 0) {
                  // 老师哲学: 钢琴 sampler 不响应 MIDI pitch bend, 旧
                  // pitchEnvelope 等于死代码. 改成真物理 grace note
                  // (倚音 / 碎音 / flam): 主音前 0.05 beat 砸一下半音
                  // 邻居 (b3 → 3 / 7 → 1 都用同一公式), velocity 70%.
                  const gracePitch = pitchDiff > 0 ? mNoteMidi - 1 : mNoteMidi + 1;
                  if (gracePitch >= MELODY_RANGE.LOW && gracePitch <= MELODY_RANGE.HIGH && humanizedTime - 0.05 >= startBeat) {
                      events.push({
                          noteNumber: gracePitch,
                          time: humanizedTime - 0.05,
                          duration: 0.05,
                          velocity: Math.max(40, Math.round(velocityMidi * 0.7)),
                          part: 'melody',
                          origin: 'develop',
                      });
                  }
              }
              events.push({
                  noteNumber: mNoteMidi,
                  time: humanizedTime,
                  duration: m.d,
                  velocity: velocityMidi,
                  part: 'melody',
                  origin: eventOrigin
              });
              // Rule 8 / 9 / 11 state update — track signed leap,
              // same-direction run length, and step/leap counts for
              // next note's hard + soft constraints.
              const stepFromPrev = mNoteMidi - lastNoteMidi;
              if (stepFromPrev !== 0) {
                  const prevDir = Math.sign(melodyState.lastLeapSemis);
                  const currDir = Math.sign(stepFromPrev);
                  if (prevDir === currDir && currDir !== 0) {
                      melodyState.sameDirRunLength = melodyState.sameDirRunLength + 1;
                  } else {
                      melodyState.sameDirRunLength = 1;
                  }
                  melodyState.lastLeapSemis = stepFromPrev;
                  // Rule 8 — step (≤ 2) vs leap (≥ 3) classification.
                  if (Math.abs(stepFromPrev) <= 2) melodyState.stepCount++;
                  else melodyState.leapCount++;
              }
              // Color-line update — runs on EVERY emit (not just
              // structural; passing tones and 16th runs are part of
              // the resolving line). Order: expire → resolve →
              // continue → arm.
              {
                  const pcMidi = ((mNoteMidi % 12) + 12) % 12;
                  const chordRootPcLocal = ((chord.rootMidi % 12) + 12) % 12;
                  const chordTriad = getChordBackboneIntervals(chord.type);
                  const inChordTriadPc = chordTriad.some(iv => (chordRootPcLocal + iv) % 12 === pcMidi);
                  // 1) Expire — listener tension dissipates past window
                  if (melodyState.pendingColorLine !== null
                      && absTime > melodyState.pendingColorLine.windowEnd) {
                      melodyState.pendingColorLine = null;
                  }
                  // 2) Resolve — pc landed on chord 1/3/5 (any octave)
                  if (melodyState.pendingColorLine !== null && inChordTriadPc) {
                      melodyState.pendingColorLine = null;
                  }
                  // 3) Continue — stepwise continuation, advance tail
                  if (melodyState.pendingColorLine !== null
                      && Math.abs(mNoteMidi - melodyState.pendingColorLine.lineLastMidi) <= 2) {
                      melodyState.pendingColorLine.lineLastMidi = mNoteMidi;
                  }
                  // 4) Arm — only on isStructural emit, only when no
                  //    pending already (don't reset mid-resolution),
                  //    only when this is a color interval from chord
                  //    root, and not when style allows floating + the
                  //    chord type self-declares this color.
                  // Color triggers (mod-12 interval from chord root):
                  //   1=b9, 2=9, 5=11, 6=#11/b5, 9=13, 10=b7, 11=maj7
                  if (isStructuralNote && melodyState.pendingColorLine === null) {
                      const ivFromChord = ((mNoteMidi - chord.rootMidi) % 12 + 12) % 12;
                      const colorTriggers = new Set([1, 2, 5, 6, 9, 10, 11]);
                      if (colorTriggers.has(ivFromChord)) {
                          // Two independent trigger-skip authorizations:
                          //
                          // (A) Floating color (chord-baked) — chord
                          //   types NAMING a color (m9 declares 9,
                          //   maj13 declares 13) raise listener's
                          //   stable baseline. Styles leaning on this
                          //   (neo-soul / R&B) skip trigger on
                          //   chord-baked color.
                          //
                          // (B) Blues hang tone (scale-baked) — blues
                          //   melody language hangs on b3 / b7 of the
                          //   KEY root, regardless of current chord.
                          //   These are scale-level home in the blues
                          //   vocabulary, not chord-relative tension.
                          //   Independent of chord type.
                          const styleAllowsFloating = STYLE_DICTIONARY[style].allowFloatingColor === true;
                          const chordTypeIvs = (CHORD_TYPES[chord.type] || []).map(iv => iv % 12);
                          const isChordBakedColor = chordTypeIvs.includes(ivFromChord);
                          const styleAllowsBluesHang = STYLE_DICTIONARY[style].allowBluesHangTone === true;
                          const ivFromKey = ((mNoteMidi - rootKeyMidi) % 12 + 12) % 12;
                          const isBluesHangTone = ivFromKey === 3 || ivFromKey === 10; // b3 / b7
                          const skipTrigger = (styleAllowsFloating && isChordBakedColor)
                              || (styleAllowsBluesHang && isBluesHangTone);
                          if (!skipTrigger) {
                              melodyState.pendingColorLine = {
                                  startMidi: mNoteMidi,
                                  startPc: pcMidi,
                                  startTime: absTime,
                                  windowEnd: absTime + 4,
                                  lineLastMidi: mNoteMidi,
                              };
                          }
                      }
                  }
              }
              // SCALE_GRAVITY pendingScaleResolve update — applies to
              // ALL emits (not just structural) for tighter physics
              // tracking. When this note's interval-from-scale-root
              // matches a fromInterval in the bar's gravity rules,
              // arm the next note to favor the rule's toInterval.
              // Clear when arrived.
              if (scaleGravityRulesForBar && scaleRootPcForBar >= 0) {
                  const intervalFromScaleRoot = ((mNoteMidi - scaleRootPcForBar) % 12 + 12) % 12;
                  // 1) Window expire — listener tension dissipates.
                  if (melodyState.pendingScaleLineWindowEnd > 0
                      && absTime > melodyState.pendingScaleLineWindowEnd) {
                      melodyState.pendingScaleResolveTarget = null;
                      melodyState.pendingScaleResolveScore = 0;
                      melodyState.pendingScaleLineWindowEnd = -1;
                      melodyState.pendingScaleLineLastMidi = -1;
                  }
                  // 2) Resolve — pc landed on scale target (multi-note
                  //    line OK: 4-2-3 / 4-5-3 / 4-1-3-2-1 都行).
                  if (melodyState.pendingScaleResolveTarget !== null
                      && intervalFromScaleRoot === melodyState.pendingScaleResolveTarget) {
                      melodyState.pendingScaleResolveTarget = null;
                      melodyState.pendingScaleResolveScore = 0;
                      melodyState.pendingScaleLineWindowEnd = -1;
                      melodyState.pendingScaleLineLastMidi = -1;
                  }
                  // 3) Continue — stepwise advance, update line tail.
                  if (melodyState.pendingScaleResolveTarget !== null
                      && melodyState.pendingScaleLineLastMidi > 0
                      && Math.abs(mNoteMidi - melodyState.pendingScaleLineLastMidi) <= 2) {
                      melodyState.pendingScaleLineLastMidi = mNoteMidi;
                  }
                  // 4) Arm — only when no pending already (don't reset
                  //    mid-line). Window 4 拍, lineLastMidi = 触发音.
                  if (melodyState.pendingScaleResolveTarget === null) {
                      const rule = scaleGravityRulesForBar.get(intervalFromScaleRoot);
                      if (rule && rule.type !== 'hang') {
                          melodyState.pendingScaleResolveTarget = rule.toInterval;
                          melodyState.pendingScaleResolveRootPc = scaleRootPcForBar;
                          melodyState.pendingScaleResolveScore = rule.score;
                          melodyState.pendingScaleLineWindowEnd = absTime + 4;
                          melodyState.pendingScaleLineLastMidi = mNoteMidi;
                      }
                  }
              }
              // 老师哲学: 跟踪 last emit 的角色 + midi 给下一 emit 的
              // avoid-resolution-reward 用 ("避讳音 → 半步解决 chord 音").
              {
                  const emittedPc = ((mNoteMidi % 12) + 12) % 12;
                  const runPcsForRole = new Set<number>(runScale.map(sm => ((sm % 12) + 12) % 12));
                  melodyState.lastEmitRole = classifyNoteRole(
                      emittedPc,
                      chord.type,
                      ((chord.rootMidi % 12) + 12) % 12,
                      scaleNameForBar || '',
                      isModalEnv,
                      chord.effectiveFunc ?? func,
                      scaleRootPcForBar,
                      runPcsForRole,
                  );
                  melodyState.lastEmitMidi = mNoteMidi;

                  // Unified harmonic state — evaluate THIS emit under
                  // its currently-active chord. The assessment is
                  // stored verbatim; the next iteration's hard
                  // constraint reads it. Handles all five resolution
                  // paths (Passing / Neighbor / Appoggiatura via
                  // same-chord tension, Suspension via chord-change
                  // re-assessment of held pitch, Harmonic Catch via
                  // re-assessment dropping urgency to 0). No state
                  // machine needed — the evaluator is the state.
                  const keyRootPcForEval = ((noteToMidi(musicKey + "0") % 12) + 12) % 12;
                  melodyState.lastEmitAssessment = evaluateNoteInChordContext(
                      emittedPc,
                      chord.type,
                      ((chord.rootMidi % 12) + 12) % 12,
                      chord.effectiveFunc ?? func,
                      nextChord ? nextChord.type : null,
                      nextChord ? ((nextChord.rootMidi % 12) + 12) % 12 : null,
                      keyRootPcForEval,
                      scaleNameForBar || undefined,
                      isModalEnv,
                      runScalePcs,
                      songCtx.songTonalCharacter,
                      chord.localTonalCenterPc,
                      modeToKeyFamily(musicMode),
                  );
                  melodyState.lastEmitChord = chord;
              }
              lastNoteMidi = mNoteMidi;
          }
      });

      melodyState.currentMidi = lastNoteMidi;

      // Run Generator — fill awkward gap+leap pairs with stepwise
      // scale runs.
      //
      // After the per-note loop the bar's melody might have two
      // adjacent emitted notes separated by a long silence AND a
      // wide pitch jump (e.g. a 1-beat hold landing low followed by
      // a 1.5-beat gap before a high run-in). The listener hears
      // this as an unmotivated leap into nowhere. Real players
      // bridge such gaps with eighth-note scalar runs that connect
      // the two anchors smoothly.
      //
      // Trigger: gap > 0.75 beats AND pitch leap >= 4 semitones.
      // Generation: stepwise scale tones from the runScale starting
      // at lastTime+lastDur, walking toward the next note. Each
      // intermediate tone is 0.5 beat (a swung 8th); the run is
      // capped at 4 inserts so we don't flood a sparse phrase.
      // Sacred yields here for the same architectural reason as
      // Active Divisi: when the listener WOULD perceive a hole,
      // sacred boundary preserving rhythm-only gives way to
      // perception-respecting bridging. Inserts are tagged
      // origin: 'develop' (passing material, never sacred).
      //
      // Deterministic — no random.next() consumption, just shape-
      // driven. New events are appended to the bar's events array;
      // the generateArrangement-level dedupe catches any time-pitch
      // collision.
      const barMel = events
          .filter(e => e.part === 'melody'
              && e.time >= startBeat
              && e.time < startBeat + chord.duration)
          .sort((a, b) => a.time - b.time);
      const runInserts: NoteEvent[] = [];

      // 老师哲学: Run Generator 按风格分发 fill strategy. 源头按 style
      // 选 palette + insertDur, 不在末尾 patch.
      //   POP  → extension arpeggio (chord 1-3-5-7-9 上扫), 16 分密度
      //   RNB  → minor pentatonic cascade (五声瀑布), 16 分密度
      //   JAZZ → stepwise (现状), 8 分密度
      //   BLUES → stepwise, 8 分密度
      const chordRootPcRG = (((chord.rootMidi % 12) + 12) % 12);
      const chordIntervalsRG = CHORD_TYPES[chord.type] || CHORD_TYPES['maj'];

      // POP arpeggio palette: chord 1/3/5/7 + 9 (extension), 跨 3 八度.
      const popArpPalette: number[] = [];
      const popArpIntervals = Array.from(new Set([
          ...chordIntervalsRG.filter(iv => iv < 12),
          14,  // 9
      ]));
      for (let oct = 3; oct <= 6; oct++) {
          for (const iv of popArpIntervals) {
              popArpPalette.push((chordRootPcRG + iv) % 12 + (oct + 1) * 12);
          }
      }
      popArpPalette.sort((a, b) => a - b);

      // RNB pentatonic palette: minor pentatonic (1, b3, 4, 5, b7) 跨 3 八度.
      const rnbPentPalette: number[] = [];
      const minorPentIvs = [0, 3, 5, 7, 10];
      for (let oct = 3; oct <= 6; oct++) {
          for (const iv of minorPentIvs) {
              rnbPentPalette.push((chordRootPcRG + iv) % 12 + (oct + 1) * 12);
          }
      }
      rnbPentPalette.sort((a, b) => a - b);

      // BLUES lick palette: Composite Blues (1, b3, 3, 4, b5, 5, b7) anchored
      // on the SONG key, not the current chord. Composite Blues carries the
      // double blue note (b3 and b5 simultaneously with natural 3 / 5), which
      // is the blues-vocabulary signature — running through it produces the
      // characteristic "blues lick" sound (b3→3 grace, 4→b5→5 chromatic
      // approach, b7 tail). Key-anchored because blues genres ride the same
      // scale over I/IV/V across the whole 12-bar form rather than chord-
      // following — that's the source of the genre's "horizontal" identity.
      const bluesPalette: number[] = [];
      const compositeBluesIvs = [0, 3, 4, 5, 6, 7, 10];
      const keyPcForBlues = ((noteToMidi(musicKey + "0") % 12) + 12) % 12;
      for (let oct = 3; oct <= 6; oct++) {
          for (const iv of compositeBluesIvs) {
              bluesPalette.push((keyPcForBlues + iv) % 12 + (oct + 1) * 12);
          }
      }
      bluesPalette.sort((a, b) => a - b);

      const fillStrategy: 'arpeggio_up' | 'pentatonic_cascade' | 'blues_lick' | 'stepwise' =
          style === 'POP' ? 'arpeggio_up' :
          style === 'RNB' ? 'pentatonic_cascade' :
          style === 'BLUES' ? 'blues_lick' : 'stepwise';
      // 16-th note density on blues_lick to deliver actual run feel —
      // 8th-note stepwise reads as "slow walk", not lick.
      const insertDur = (fillStrategy === 'stepwise') ? 0.5 : 0.25;
      const minSlotSize = insertDur;

      for (let bi = 0; bi < barMel.length - 1; bi++) {
          const curr = barMel[bi];
          const next = barMel[bi + 1];
          const gap = next.time - (curr.time + curr.duration);
          const leap = Math.abs(next.noteNumber - curr.noteNumber);
          // Trigger threshold per strategy. Blues licks need to fill
          // smaller gaps + smaller leaps than the default — the run
          // feel comes from continuous motion, not from filling rare
          // big jumps. Lowered to gap ≥ 0.5 (was 0.75) and leap ≥ 3
          // (was 4) for blues_lick.
          const gapThreshold = fillStrategy === 'blues_lick' ? 0.5 : 0.75;
          const leapThreshold = fillStrategy === 'blues_lick' ? 3 : 4;
          if (gap <= gapThreshold || leap < leapThreshold) continue;

          const direction = next.noteNumber > curr.noteNumber ? 1 : -1;
          const maxByGap = Math.floor(gap / minSlotSize);
          // 16 分密度时单步音程更小, 允许更多 inserts.
          const maxByLeap = fillStrategy === 'stepwise'
              ? Math.max(1, Math.floor(leap / 2))
              : Math.max(1, Math.floor(leap / 1.5));
          const nMaxCap = fillStrategy === 'pentatonic_cascade' ? 8
              : fillStrategy === 'blues_lick' ? 8
              : fillStrategy === 'arpeggio_up' ? 6 : 4;
          const nInserts = Math.max(1, Math.min(nMaxCap, maxByGap, maxByLeap));
          const runStart = curr.time + curr.duration;

          // 选 palette 按 strategy.
          const palette =
              fillStrategy === 'arpeggio_up' ? popArpPalette :
              fillStrategy === 'pentatonic_cascade' ? rnbPentPalette :
              fillStrategy === 'blues_lick' ? bluesPalette :
              (fillScale && fillScale.length > 0 ? fillScale : runScale);

          let bestIdx = 0;
          let bestDist = Infinity;
          for (let k = 0; k < palette.length; k++) {
              const d = Math.abs(palette[k] - curr.noteNumber);
              if (d < bestDist) { bestDist = d; bestIdx = k; }
          }
          // Voicing snapshot for m9 escape — same chord across the
          // whole run since Run Generator works bar-internally.
          const runVoicingMidis = chord.notesMidi ?? chord.notes.map(n => noteToMidi(n));
          const runFormsM9 = (mid: number) =>
              runVoicingMidis.some(v => mid - v === 13 || mid - v === -13);
          for (let s = 0; s < nInserts; s++) {
              const stepIdx = bestIdx + direction * (s + 1);
              if (stepIdx < 0 || stepIdx >= palette.length) break;
              let stepMidi = palette[stepIdx];
              if (stepMidi < MELODY_RANGE.LOW || stepMidi > MELODY_RANGE.HIGH) continue;
              if (stepMidi === curr.noteNumber || stepMidi === next.noteNumber) continue;
              if (direction > 0 && stepMidi >= next.noteNumber) break;
              if (direction < 0 && stepMidi <= next.noteNumber) break;
              // m9 escape — try ±12 if the palette pitch would form a
              // cross-octave m9 with the current voicing. Skip the
              // insert entirely if no octave variant escapes.
              if (runFormsM9(stepMidi)) {
                  const alt = [stepMidi - 12, stepMidi + 12].find(c =>
                      c >= MELODY_RANGE.LOW && c <= MELODY_RANGE.HIGH && !runFormsM9(c)
                  );
                  if (alt === undefined) continue;
                  stepMidi = alt;
              }

              runInserts.push({
                  noteNumber: stepMidi,
                  time: runStart + s * insertDur,
                  duration: insertDur,
                  velocity: fillStrategy === 'stepwise' ? 90 : 82, // 16 分 cascade 更轻
                  part: 'melody',
                  origin: 'develop',
              });
          }
      }
      events.push(...runInserts);

      // Last-emitted Contract Enforcement — Run Generator and other
      // post-loop inserts (cross-bar bridge, passing tones) bypass
      // the AND pipeline; they pick scale tones for stepwise voice
      // leading without checking chord contract. When the bar's
      // LAST emitted melody event happens to be such an insert AND
      // its pc is outside chord contract (literal ∪ admissible
      // color), the audit classifies it as "passing-on-strong" since
      // last-of-bar is a structural-listening position. Per user's
      // "骨干音绝对优先,全局和声不能变" — even post-loop inserts
      // must respect the contract at structural positions.
      //
      // Action: scan the bar's last emitted melody event. If its pc
      // is NOT in chord contract, snap to the nearest contract pc
      // in runScale within ±3 semitones. If no contract pc reachable,
      // accept the original (rare; would require relaxing).
      {
          const literal = CHORD_TYPES[chord.type] || [0, 4, 7];
          const rootPcEnf = (((chord.rootMidi % 12) + 12) % 12);
          const contractPcs = new Set<number>();
          for (const iv of literal) contractPcs.add((rootPcEnf + iv) % 12);
          const { intervals: contractGlobals } = computeGlobalContract(chord.type, chord.rootMidi);
          for (const iv of contractGlobals) contractPcs.add((rootPcEnf + iv) % 12);
          if (chord.tensionState === 'SlashChord' && chord.virtualExtensions) {
              const bassPcEnf = (((chord.bassMidi % 12) + 12) % 12);
              for (const semis of chord.virtualExtensions) contractPcs.add((bassPcEnf + semis) % 12);
          }
          const barMelEnf = events
              .filter(e => e.part === 'melody'
                  && e.time >= startBeat
                  && e.time < startBeat + chord.duration)
              .sort((a, b) => a.time - b.time);
          const lastEmit = barMelEnf[barMelEnf.length - 1];
          if (lastEmit) {
              const lastPc = (((lastEmit.noteNumber % 12) + 12) % 12);
              if (!contractPcs.has(lastPc)) {
                  // find nearest contract pc in runScale within ±3
                  let bestMidi = lastEmit.noteNumber;
                  let bestDist = Infinity;
                  for (const sm of runScale) {
                      const smPc = (((sm % 12) + 12) % 12);
                      if (!contractPcs.has(smPc)) continue;
                      const d = Math.abs(sm - lastEmit.noteNumber);
                      if (d <= 3 && d < bestDist) {
                          bestDist = d;
                          bestMidi = sm;
                      }
                  }
                  if (bestDist <= 3 && bestMidi !== lastEmit.noteNumber
                      && bestMidi >= MELODY_RANGE.LOW
                      && bestMidi <= MELODY_RANGE.HIGH) {
                      lastEmit.noteNumber = bestMidi;
                  }
              }
          }
      }

      // Bar-level vacated-extension guarantor — final divisi insurance.
      //
      // Per-note Active Divisi only fires when m.d >= 0.25 AND the
      // projected pitch lands within ±10 semis of the top vacated pc.
      // Bars dominated by short notes that sit far from the top
      // extension can therefore complete their full motif/develop
      // pass with NO note ever landing on the chord's defining color.
      // The listener hears a shell (7-chord) where the data declared
      // m9/m11/13/maj9 — the chord type label becomes a lie.
      //
      // Action: scan the bar's melody. If no event's pc matches the
      // top vacated pc, find the best rewrite candidate — preferring
      // develop-origin (freely rewriteable) over motif-origin (sacred
      // yields here per CLAUDE.md Active Divisi rule), and longest
      // duration first (so the listener actually rings on the new pc).
      // Excludes return-origin (cadence-locked). ±10-semi clamp keeps
      // the rewrite within a perfect-fifth-and-a-bit; failure to
      // reach is accepted silently rather than polluted.
      {
          let vacatedIvsG: number[];
          if (chord.type === 'add9' || chord.type === '6/9') {
              vacatedIvsG = literalIntervals.slice(3);
          } else if (literalIntervals.length >= 5) {
              vacatedIvsG = literalIntervals.slice(4);
          } else {
              vacatedIvsG = [];
          }
          if (vacatedIvsG.length > 0) {
              const rootPcG = (((chord.rootMidi % 12) + 12) % 12);
              const topPcG = (((rootPcG + vacatedIvsG[vacatedIvsG.length - 1]) % 12) + 12) % 12;
              const barMelG = events.filter(e => e.part === 'melody'
                  && e.time >= startBeat
                  && e.time < startBeat + chord.duration);
              const filled = barMelG.some(e => (((e.noteNumber % 12) + 12) % 12) === topPcG);
              if (!filled && barMelG.length > 0) {
                  const candidates = barMelG
                      .filter(e => e.origin !== 'return')
                      .sort((a, b) => {
                          const aDev = a.origin === 'develop' ? 1 : 0;
                          const bDev = b.origin === 'develop' ? 1 : 0;
                          if (bDev !== aDev) return bDev - aDev;
                          return b.duration - a.duration;
                      });
                  for (const cand of candidates) {
                      const newMidi = snapMidiToNearestPc(cand.noteNumber, new Set([topPcG]), runScale);
                      if (Math.abs(newMidi - cand.noteNumber) <= 10
                          && newMidi >= MELODY_RANGE.LOW
                          && newMidi <= MELODY_RANGE.HIGH
                          && newMidi !== cand.noteNumber) {
                          cand.noteNumber = newMidi;
                          break;
                      }
                  }
              }
          }
      }

      // Cadence-tail Leading-tone (起伏 / ebb-flow). When the bar is
      // phrase-end (shouldReturn) AND the bar's last melody pc is
      // already a chord-tone of the NEXT chord, the next bar's
      // first note will likely OPEN on the same pc (Method 2 closest-
      // pair snap or natural projection). Static continuation across
      // the bar line feels rigid — the listener wants a tiny dip
      // before the resolution lands again.
      //
      // Action: shorten the last melody event by 0.25 beat if needed,
      // then append a 16th-note event at the bar's last 16th slot
      // playing a stepwise scale neighbor of the cadence pc. The
      // result is "C ... C [B] || C" instead of "C ... C || C" — an
      // anticipation that pulls back to the next bar's opening.
      //
      // Gating: shouldReturn (phrase end only) AND last pc ∈ next
      // chord literal pcs (= continuation). Phrase ends already use
      // architectural cadence logic; this tail tone is the post-
      // resolution decoration the user described.
      // Phrase-end position is the ARCHITECTURAL boundary where the
      // user's 起伏 principle applies — independent of the cadence
      // resolution's probability gate. Cadence Tier rewrites the
      // last note's PITCH probabilistically (per style strictness);
      // the tail leading-tone inserts a NEW event in the silent tail
      // unconditionally when the continuation condition is met.
      const isPhraseEndBar = ((barIndex + 1) % (motifInterval || 4) === 0)
          || (barIndex === totalBars - 1);
      if (isPhraseEndBar && nextChord) {
          const barMelForTail = events
              .filter(e => e.part === 'melody'
                  && e.time >= startBeat
                  && e.time < startBeat + chord.duration)
              .sort((a, b) => a.time - b.time);
          // Pick the bar's MELODIC last note — exclude bass-doubling
          // develop notes that share the same time slot but sit
          // octaves below the lead voice (e.g. Bb4 + Bb3 stacked at
          // t=3.0). The leading-tone tail is a melodic gesture; pick
          // the highest-register event among those tied for last.
          let lastEvt = barMelForTail[barMelForTail.length - 1];
          if (lastEvt) {
              const lastTime = lastEvt.time;
              for (const e of barMelForTail) {
                  if (Math.abs(e.time - lastTime) < 0.01 && e.noteNumber > lastEvt.noteNumber) {
                      lastEvt = e;
                  }
              }
              const lastPc = (((lastEvt.noteNumber % 12) + 12) % 12);
              const nextLiteral = CHORD_TYPES[nextChord.type] || [0, 4, 7];
              const nextRootPc = (((nextChord.rootMidi % 12) + 12) % 12);
              const nextLiteralPcs = new Set(nextLiteral.map(iv => (nextRootPc + iv) % 12));
              if (nextLiteralPcs.has(lastPc)) {
                  // Find closest in-scale neighbor (above or below) of
                  // lastEvt within ±2 semis. Filter:
                  //   - skip avoid for CURRENT chord (tail rings
                  //     during current chord time)
                  //   - MUST be in CURRENT chord contract (literal ∪
                  //     admissible color) — per user "骨干音 + 全局
                  //     和声绝对优先". The leading-tone is at the bar's
                  //     LAST 8th = structural-listening position; it
                  //     can't violate contract just to function as a
                  //     leading tone.
                  //   - prefer below (traditional leading-tone direction)
                  const lastMidi = lastEvt.noteNumber;
                  const currChordRootPc = (((chord.rootMidi % 12) + 12) % 12);
                  const { pcs: currContractPcs } = computeGlobalContract(chord.type, chord.rootMidi);
                  let neighborMidi = -1;
                  let neighborDist = Infinity;
                  for (const sm of runScale) {
                      const d = Math.abs(sm - lastMidi);
                      if (d <= 0 || d > 2) continue;
                      const smPc = (((sm % 12) + 12) % 12);
                      const ivFromCurr = ((smPc - currChordRootPc) % 12 + 12) % 12;
                      if (isAvoidNote(ivFromCurr, chord.type, scaleNameForBar || undefined, isModalEnv, func)) continue;
                      // Contract filter: tail tone must stay in current
                      // chord contract.
                      if (!currContractPcs.has(smPc)) continue;
                      if (d < neighborDist
                          || (d === neighborDist && sm < neighborMidi)) {
                          neighborDist = d;
                          neighborMidi = sm;
                      }
                  }
                  if (neighborMidi >= MELODY_RANGE.LOW && neighborMidi <= MELODY_RANGE.HIGH) {
                      // Tail insert lands on the bar's last 8th (= barEnd
                      // - 0.5). Only fire when shortening lastEvt to fit
                      // produces a QUANTIZED duration — skip otherwise to
                      // keep the QUANTIZED_DURATIONS contract intact.
                      // Non-grid lastEvt times (e.g. t=0.66 from swing
                      // applied to a 0.5 motif beat) would shorten to
                      // 2.84 which isn't in {0.25, 0.5, ..., 4.0} — those
                      // bars skip the tail and keep the original cadence
                      // landing intact.
                      const QUANTIZED_DURS = new Set([0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5, 3.75, 4.0]);
                      const barEnd = startBeat + chord.duration;
                      const tailStart = barEnd - 0.5;
                      const proposedShortened = tailStart - lastEvt.time;
                      const proposedRounded = Math.round(proposedShortened * 100) / 100;
                      if (proposedShortened >= 0.25 && QUANTIZED_DURS.has(proposedRounded)) {
                          if (lastEvt.duration !== proposedRounded) {
                              lastEvt.duration = proposedRounded;
                          }
                          events.push({
                              noteNumber: neighborMidi,
                              time: tailStart,
                              duration: 0.5,
                              velocity: 80,
                              part: 'melody',
                              origin: 'develop',
                          });
                      }
                  }
              }
          }
      }

      // Track the last melody event's end time AFTER all Run Generator
      // inserts so the next bar's cross-bar bridge sees the true tail
      // position (not just the motif's last note).
      const barMelEnds = events
          .filter(e => e.part === 'melody'
              && e.time >= startBeat
              && e.time < startBeat + chord.duration)
          .sort((a, b) => a.time - b.time);
      if (barMelEnds.length > 0) {
          melodyState.lastNoteEnd = Math.max(...barMelEnds.map(e => e.time + e.duration));

          // Pick the bar's MELODIC last (highest-register among events
          // tied for last time). Used by the color-line resync below.
          // (Prior to evaluator-based state, this also resynced the
          // pendingResolve ghost — that ghost is gone now; the per-emit
          // evaluator state inside the main loop is the new source of
          // truth for cross-bar tension awareness.)
          let lastEmit = barMelEnds[barMelEnds.length - 1];
          const lastTime = lastEmit.time;
          for (const e of barMelEnds) {
              if (Math.abs(e.time - lastTime) < 0.01 && e.noteNumber > lastEmit.noteNumber) {
                  lastEmit = e;
              }
          }

          // Color-line resync — apply listener-perspective effects of
          // post-loop inserts (Run Generator / cadence-tail) that the
          // per-emit update missed. By 老师 bridge principle these are
          // transition tones, NOT structural — they DO NOT arm a new
          // pending. They CAN, however:
          //   • land on chord 1/3/5 pc → resolve any pending line
          //   • be ≤ 2 semis from line tail → continue the line
          //   • exceed the window → expire the pending
          // Window expire also runs here so cross-bar pending state
          // doesn't outlive its 4-beat memory window.
          const chordRootPcLocal2 = ((chord.rootMidi % 12) + 12) % 12;
          const lastPcMidi = ((lastEmit.noteNumber % 12) + 12) % 12;
          const chordTriadIvs = getChordBackboneIntervals(chord.type);
          const inChordTriadPc = chordTriadIvs.some(iv => (chordRootPcLocal2 + iv) % 12 === lastPcMidi);
          if (melodyState.pendingColorLine !== null
              && lastEmit.time > melodyState.pendingColorLine.windowEnd) {
              melodyState.pendingColorLine = null;
          }
          if (melodyState.pendingColorLine !== null && inChordTriadPc) {
              melodyState.pendingColorLine = null;
          }
          if (melodyState.pendingColorLine !== null
              && Math.abs(lastEmit.noteNumber - melodyState.pendingColorLine.lineLastMidi) <= 2) {
              melodyState.pendingColorLine.lineLastMidi = lastEmit.noteNumber;
          }

          // Re-sync currentMidi + lastEmitAssessment to the bar's
          // chronologically-last melody event. The per-emit update inside
          // generateBarPattern's main loop sets these to the LAST motif
          // note, but Run Generator inserts, cadence-tail rewrites, and
          // Active Divisi pulls push more events AFTER that point. Without
          // this re-sync the next bar's anchor scoring, voice-leading
          // distance, and unified-tension-resolution hard filter read the
          // stale motif-loop reference instead of the actual prior pitch
          // the listener just heard.
          melodyState.currentMidi = lastEmit.noteNumber;
          const lastEmitPcSync = ((lastEmit.noteNumber % 12) + 12) % 12;
          melodyState.lastEmitAssessment = evaluateNoteInChordContext(
              lastEmitPcSync,
              chord.type,
              chordRootPcLocal2,
              chord.effectiveFunc ?? func,
              nextChord ? nextChord.type : null,
              nextChord ? ((nextChord.rootMidi % 12) + 12) % 12 : null,
              ((noteToMidi(musicKey + "0") % 12) + 12) % 12,
              scaleNameForBar || undefined,
              isModalEnv,
              runScalePcs,
              songCtx.songTonalCharacter,
              chord.localTonalCenterPc,
              modeToKeyFamily(musicMode),
          );
          melodyState.lastEmitChord = chord;
      }

      // Cycle boundary — tension tracker resets at every cadence position
      // (and the song's final bar). User principle: "一个和声进行内" =
      // tensions live within a single chord cycle. A 7 hanging from
      // bar 2 doesn't carry forward into the next phrase's cycle.
      if (shouldReturn) {
          tensionTracker.resetCycle();
      }

      return { patternEvents: events, bridgeVisual };
  }
