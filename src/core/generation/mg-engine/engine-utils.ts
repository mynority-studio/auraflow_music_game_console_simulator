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

import { StyleName, STYLE_DICTIONARY } from './styleDictionary';
import {
    harmonicFunctionFromRoman, QUANTIZED_DURATIONS, Random,
    KEYS, spellPcInKey, midiToNoteInKey, midiToNoteInChord,
} from './musicEngine';
import type { ChordDef, GenerationConfig, ResolvedGenerationContext } from './musicEngine';
import {
    CHORD_TYPES, SCALE_TYPES, noteToMidi, isAvoidNote,
    getModeAwareSubstitutions, modeProgressionTemplate,
    MAINSTREAM_EMOTION_TO_MODE, MAJOR_FLAVOR_MODES,
    EXOTIC_MODE_PROBABILITY, EXOTIC_MODES,
    getMeterContext, modeToKeyFamily,
    assembleVoicing, placeVoicingMidi, evaluateTensionState, detectModeBorrowing,
    STYLE_SHELL, STYLE_ROOTLESS, STYLE_CLUSTER, STYLE_FULL, STYLE_BLUES,
    JAZZ_ROOTLESS_VOICINGS, POP_VOICINGS, RNB_VOICINGS, BLUES_VOICINGS,
} from '../af2-engine/music-theory';
import type { Emotion, VoicingStylePreference } from '../af2-engine/music-theory';
import { DYNAMIC_TSD_DICTIONARY, analyzeTargetQuality } from './dynamicHarmony';
import {
    pickBasslineRule, BASSLINE_RULES, DEFAULT_BASSLINE_RULE,
    BASS_PATTERN_RULES, resolveBassAnchorPc, clampPcToBassMidi,
} from './basslineRules';

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
