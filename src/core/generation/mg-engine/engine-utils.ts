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
import { harmonicFunctionFromRoman } from './musicEngine';
import type { ChordDef } from './musicEngine';
import { CHORD_TYPES, SCALE_TYPES, noteToMidi, isAvoidNote } from './musicTheory';

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
