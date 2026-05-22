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
import { harmonicFunctionFromRoman, QUANTIZED_DURATIONS, Random } from './musicEngine';
import type { ChordDef, GenerationConfig } from './musicEngine';
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
