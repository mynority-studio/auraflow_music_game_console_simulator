// ============================================================
// improcore-adapter.ts — ImproCore 算法 → AF2 idiom 接口适配层
// ============================================================
//
// 2026-05-26 加 — AF2+ImproCore 合并 Step 6.2。
//
// 职责:把 AF2 framework 的 MusicianPlanInput 转 ImproCore 算法接口,
// 让 PianoIdiom.planMelody / planAccomp / Composer.compose 走 ImproCore
// 算法,同时保留 AF2 framework(Conductor / Arranger / Dispatcher /
// Reconciler / Band / persona / pad / drum 等)。
//
// **关键约束(K-2 invariant)**:
//   ImproEngineFacade 用 ABSOLUTE pcs(已加 keyOffset),但 AF2 framework
//   内部全 RELATIVE 空间(AbsoluteTransposer 才加 keyOffset)。本 adapter
//   喂 ImproCore 的 pcs / pitch 全部 RELATIVE — ImproCore 算法 PC-agnostic
//   (只 mod 12),input/output 同空间即正确。
//
// 当前实装:
//   - planMelodyImproCore — ImproCore lick-gen 生成 melody NoteData[]
//   - 后续:planAccompImproCore + assembleVoicingImproCore
// ============================================================

import type { GeneratedChord, NoteData, SectionMetadata } from '../../types';
import { ChordQuality, Tonality } from '../../types';
import type { MusicianPlanInput } from '../Conductor';
import { Random } from '../utils/Random';
import { PRNGManager } from '../../../utils/PRNG';
import { getChordVocab } from '../music-theory/chord-vocab';
import {
    generateMelody,
    selectGrammarByName,
    type MelodyChordCtx,
    type GrammarSelection,
} from '../../improCore/algorithms/lick-gen';
import { getScalePcs } from '../../improCore/algorithms/note-utils';
import {
    attachWidePianoVoicings,
    type WidePianoVoicing,
    type WideVoicingChordInput,
} from '../../harmony/wide-piano-voicing';
import {
    applyChordPattern,
    type NoteEvent,
} from '../../improCore/algorithms/chord-pattern';
import { applyBassPattern } from '../../improCore/algorithms/bass-pattern';
import { ImproStyleStore } from '../../../../state/ImproStyleStore';
import { getStyleByName } from '../../improCore/data/loaded';
import type { ChordPattern, BassPattern } from '../../improCore/data/sty-parser';

// ─────────────────────────────────────────────────────────────────
// Quality → type string(chord-vocab.ts key 用 'maj' / 'm7' / 'maj7' ...)
// ─────────────────────────────────────────────────────────────────

const QUALITY_TO_VOCAB_TYPE: Record<ChordQuality, string> = {
    [ChordQuality.Major]:           'maj',
    [ChordQuality.Minor]:           'min',
    [ChordQuality.Diminished]:      'dim',
    [ChordQuality.Diminished7]:     'dim7',
    [ChordQuality.Augmented]:       'aug',
    [ChordQuality.Dominant7]:       '7',
    [ChordQuality.Minor7]:          'm7',
    [ChordQuality.Major7]:          'maj7',
    [ChordQuality.HalfDiminished]:  'm7b5',
    [ChordQuality.Sus4]:            'sus4',
    [ChordQuality.Dominant7Sus4]:   '7sus4',
    [ChordQuality.Add9]:            'add9',
    [ChordQuality.Minor9]:          'm9',
    [ChordQuality.Major9]:          'maj9',
    [ChordQuality.Dominant9]:       '9',
    [ChordQuality.Minor11]:         'm11',
    [ChordQuality.Dominant11]:      '11',
    [ChordQuality.Dominant13]:      '13',
    [ChordQuality.Major13]:         'maj13',
    [ChordQuality.Major7Sharp11]:   'maj7#11',
    [ChordQuality.Dom7Flat9]:       '7b9',
    [ChordQuality.Dom7Sharp9]:      '7#9',
    [ChordQuality.Dom7Sharp11]:     '7#11',
    [ChordQuality.Dom7Flat13]:      '7b13',
    [ChordQuality.Dom7Alt]:         '7alt',
};

function qualityToVocabType(q: ChordQuality): string {
    return QUALITY_TO_VOCAB_TYPE[q] ?? 'maj';
}

// ─────────────────────────────────────────────────────────────────
// Key diatonic pcs(RELATIVE)— 全曲 key 内 7 度音
// ─────────────────────────────────────────────────────────────────

const MAJOR_DIATONIC_PCS: ReadonlyArray<number> = [0, 2, 4, 5, 7, 9, 11];
const MINOR_DIATONIC_PCS: ReadonlyArray<number> = [0, 2, 3, 5, 7, 8, 10];

function getKeyDiatonicPcsRelative(tonality: Tonality): readonly number[] {
    return tonality === Tonality.Minor ? MINOR_DIATONIC_PCS : MAJOR_DIATONIC_PCS;
}

// ─────────────────────────────────────────────────────────────────
// Grammar selection(per musician)
// ─────────────────────────────────────────────────────────────────

/**
 * 从 musician.persona.grammarName 选 GrammarSelection。
 * 未设置 / 未 prefetch → fallback 'quarter-baseline'(hardcode,即时返回)。
 *
 * 注:real grammar 需要 prefetch(loadGrammarByName);本 adapter 不主动 fetch
 * (PianoIdiom.plan() 是同步调用,无法 await)。期望 BandSelectionStore /
 * UI 层在 musician 选定时触发 prefetch — 同步调到这里时 grammar 已 cache。
 */
export function getImproCoreGrammar(grammarName?: string): GrammarSelection {
    const name = grammarName ?? 'quarter-baseline';
    return selectGrammarByName(name);
}

// ─────────────────────────────────────────────────────────────────
// Build MelodyChordCtx[] from GeneratedChord[] + sections(RELATIVE 空间)
// ─────────────────────────────────────────────────────────────────

/**
 * 把 AF2 RELATIVE chord 序列转 ImproCore MelodyChordCtx[]。
 *
 * 每 chord:
 *   - rootPc / spellPcs / colorPcs:用 RELATIVE pcs(不加 keyOffset)
 *   - scalePcs:chord-scale 本地 scale(intersect key diatonic 防调外)
 *   - isPhraseEnd:本 chord 是否在 section 末(给 lick-gen 长 tonic 收音用)
 *   - roman:chord.numeral(给 BRICK cadence detector 用)
 *
 * ImproCore 算法只用 mod 12 操作 pcs,所以 RELATIVE / ABSOLUTE 都 work,
 * 只要 input/output 同空间。输出 melody.pitch 也是 RELATIVE。
 */
export function buildMelodyChordCtxs(
    chords: ReadonlyArray<GeneratedChord>,
    sections: ReadonlyArray<SectionMetadata>,
    tonality: Tonality,
    keyOffset: number,
): MelodyChordCtx[] {
    const keyDiatonicPcs = getKeyDiatonicPcsRelative(tonality);
    const keyDiaSet = new Set(keyDiatonicPcs);
    const ctxs: MelodyChordCtx[] = [];

    for (let ci = 0; ci < chords.length; ci++) {
        const chord = chords[ci]!;
        const nextChord = chords[ci + 1] ?? null;
        const beats = chord.endBeat - chord.startBeat;
        if (beats <= 0) continue;

        // isPhraseEnd:本 chord 跟下 chord 不在同一 section
        const mySection = sections.find(s =>
            chord.startBeat >= s.startBeat - 0.1 && chord.endBeat <= s.endBeat + 0.1
        );
        const isPhraseEnd = !nextChord
            ? true
            : (() => {
                const nextSection = sections.find(s =>
                    nextChord.startBeat >= s.startBeat - 0.1 && nextChord.endBeat <= s.endBeat + 0.1
                );
                return mySection !== nextSection;
            })();

        // chord.root 当前是 ABSOLUTE pc(Composer chordDefToGeneratedChord 加过 keyOffset),
        // 减回 keyOffset 得 RELATIVE rootPc(K-2:adapter 内全 RELATIVE 工作)
        const rootPc = ((chord.root - keyOffset) % 12 + 12) % 12;
        const vocabType = qualityToVocabType(chord.quality);
        const vocab = getChordVocab(vocabType);
        const spellPcs = vocab.spell.map(pc => ((rootPc + pc) % 12 + 12) % 12);
        const colorPcsAll = vocab.color.map(pc => ((rootPc + pc) % 12 + 12) % 12);

        // chord-scale relationship — 用 chord-vocab 自带的 idiomatic scale
        const chordScaleName = vocab.scales[0] ?? 'major';
        const chordScaleRaw = getScalePcs(chordScaleName, rootPc);
        // 与 key diatonic 取交集(防调外);交集太小(<4)→ 用纯 chord scale
        const chordScaleIntersect = chordScaleRaw.filter(pc => keyDiaSet.has(pc));
        const localScalePcs = chordScaleIntersect.length >= 4 ? chordScaleIntersect : chordScaleRaw;
        const localScaleSet = new Set(localScalePcs);
        const colorPcs = colorPcsAll.filter(pc => localScaleSet.has(pc));

        ctxs.push({
            startBeat: chord.startBeat,
            beats,
            rootPc,
            spellPcs,
            colorPcs,
            scalePcs: localScalePcs,
            isPhraseEnd,
            roman: chord.numeral,
        });
    }
    return ctxs;
}

// ─────────────────────────────────────────────────────────────────
// planMelodyImproCore — Idiom plan() 入口
// ─────────────────────────────────────────────────────────────────

/**
 * AF2 PianoIdiom.planMelody 用 ImproCore lick-gen 替代 Af2MelodyGen 的入口。
 *
 * 流程:
 *   1. 从 input.musician.persona.grammarName 选 grammar
 *   2. build MelodyChordCtx[](RELATIVE 空间)
 *   3. PRNG fork:`af2_improcore_melody_${musicianId}_${initialSeed}`
 *   4. generateMelody → MelodyNote[]
 *   5. velocity 转 0-1 float(NoteData 协议)
 *
 * 注:返回的 NoteData.pitch 在 RELATIVE 空间,AbsoluteTransposer 后续加 keyOffset。
 */
export function planMelodyImproCore(
    input: MusicianPlanInput,
    melodyLo: number,
    melodyHi: number,
): NoteData[] {
    const grammarName = input.musician?.persona?.grammarName;
    const grammar = getImproCoreGrammar(grammarName);

    const ctxs = buildMelodyChordCtxs(
        input.score.chords,
        input.score.sections,
        input.score.tonality,
        input.score.keyOffset,
    );
    if (ctxs.length === 0) return [];

    const initialSeed = PRNGManager.getInitialSeed() >>> 0;
    const rng = new Random(`af2_improcore_melody_${input.musicianId}_${initialSeed}`);

    const melody = generateMelody(ctxs, rng, grammar, melodyLo, melodyHi);

    // MelodyNote { pitch, onset, duration, velocity (0-127) }
    // NoteData   { pitch, onset, duration, velocity (0-1 float) }
    return melody.map(n => ({
        pitch: n.pitch,
        onset: n.onset,
        duration: n.duration,
        velocity: Math.max(0, Math.min(1, n.velocity / 127)),
    }));
}

// ─────────────────────────────────────────────────────────────────
// buildWidePianoVoicingsForAf2 — Composer batch precompute voicing
// ─────────────────────────────────────────────────────────────────

/**
 * 简易 chord shape — Composer 用 abstractPath(Af2AbstractStep)调用 adapter
 * 时,转 minimal field 喂入即可。type 用 chord-vocab key string(maj / m7 / 等)。
 */
export interface WideVoicingChordSpec {
    /** RELATIVE root pc 0-11(不含 keyOffset)*/
    rootPcRelative: number;
    /** chord-vocab type key(maj / m7 / maj7 / etc.)*/
    type: string;
    /** roman 级数(I / V / ii / 等),给 wide-piano-voicing TSD dispatch 用 */
    roman: string;
    /** Effective function override(可选,优先于 roman 推断)*/
    effectiveFunc?: 'T' | 'S' | 'D';
    /** beats */
    duration: number;
}

/**
 * 从 chord spec 列表 + tonality build wide-piano-voicings(batch)。
 *
 * Composer.compose() 主循环开始前一次 build,然后 per-chord 用
 * wideVoicings[i].attackMidi 填 chord.voicing(RELATIVE MIDI 升序)。
 *
 * keyRootPc=0(RELATIVE 空间约定 tonic=pc0)/ mode 跟 tonality。
 *
 * 注:RELATIVE 空间 + AbsoluteTransposer 之后才加 keyOffset,所以
 * bassMidi 用 36 + relRoot(RELATIVE C2 估值),wide-piano-voicing 内部
 * 物理音域判断仍 work(都在 RELATIVE 空间)。
 */
export function buildWidePianoVoicingsForAf2(
    chordSpecs: ReadonlyArray<WideVoicingChordSpec>,
    tonality: Tonality,
    density: number = 0.5,
): WidePianoVoicing[] {
    const keyDiatonicPcs = getKeyDiatonicPcsRelative(tonality);
    const keyDiaSet = new Set(keyDiatonicPcs);
    const isMinor = tonality === Tonality.Minor;

    const wideInputs: WideVoicingChordInput[] = chordSpecs.map((spec) => {
        const rootPc = ((spec.rootPcRelative % 12) + 12) % 12;
        const vocab = getChordVocab(spec.type);
        const chordScaleName = vocab.scales[0] ?? 'major';
        const chordScaleRaw = getScalePcs(chordScaleName, rootPc);
        const chordScaleIntersect = chordScaleRaw.filter(pc => keyDiaSet.has(pc));
        const localScalePcs = new Set(chordScaleIntersect.length >= 4 ? chordScaleIntersect : chordScaleRaw);

        return {
            rootPc,
            chordType: spec.type,
            bassMidi: 36 + rootPc,  // C2 + RELATIVE pc(K-2 安全)
            duration: spec.duration,
            roman: spec.roman,
            effectiveFunc: spec.effectiveFunc,
            forcedScale: undefined,
            localScalePcs,
        };
    });

    const initialSeed = PRNGManager.getInitialSeed() >>> 0;
    return attachWidePianoVoicings({
        chords: wideInputs,
        style: 'POP',                       // 简化:全 POP(后续可 per-mgStyle)
        density,
        keyRootPc: 0,                       // RELATIVE 空间 tonic
        mode: isMinor ? 'Aeolian' : 'Ionian',
        sectionFunction: 'VERSE',           // 简化:全 VERSE(后续 per-section)
        motifInterval: 4,
        random: new Random(`af2_improcore_wide_voicing_${initialSeed}`),
    });
}

// ─────────────────────────────────────────────────────────────────
// planAccompImproCore — Idiom planAccomp 入口
// ─────────────────────────────────────────────────────────────────

/**
 * Pop/Jazz augment chord-pattern(arp / broken 加入 pool,避免 .sty 全柱式听感)。
 * 跟 ImproEngineFacade.ARP_AUGMENT_CHORD_PATTERNS 同源(此处独立 copy 以解
 * Facade 依赖)。
 */
const ARP_AUGMENT_CHORD_PATTERNS: ReadonlyArray<ChordPattern> = [
    { rules: ['V80', 'U2'],                 weight: 8.0 },
    { rules: ['V80', 'D2'],                 weight: 5.0 },
    { rules: ['V75', 'U4', 'D4'],           weight: 10.0 },
    { rules: ['V70', 'U1'],                 weight: 4.0 },
    { rules: ['V85', 'B4', 'B4'],           weight: 12.0 },
    { rules: ['V85', 'B2'],                 weight: 8.0 },
    { rules: ['V80', 'B4', 'B4', 'B4', 'B4'], weight: 6.0 },
    { rules: ['V90', 'X4', 'U4'],           weight: 10.0 },
    { rules: ['V90', 'X4', 'B4'],           weight: 10.0 },
    { rules: ['V85', 'X2', 'U2'],           weight: 7.0 },
];

function pickWeighted<T extends { weight: number }>(items: ReadonlyArray<T>, rng: Random): T | null {
    if (items.length === 0) return null;
    const total = items.reduce((s, x) => s + x.weight, 0);
    if (total <= 0) return items[0]!;
    let target = rng.next() * total;
    for (const it of items) {
        target -= it.weight;
        if (target <= 0) return it;
    }
    return items[items.length - 1]!;
}

/**
 * AF2 PianoIdiom.planAccomp 用 ImproCore chord-pattern 替代 Af2AccompGen 的入口。
 *
 * 前置条件:Composer.compose() 主循环已用 buildWidePianoVoicingsForAf2 填
 * chord.voicing(RELATIVE MIDI 升序),adapter 直接读消费。
 *
 * 流程:
 *   1. ImproStyleStore 拿当前 styleName(UI dropdown 选)
 *   2. style.chordPatterns + ARP_AUGMENT_CHORD_PATTERNS 拼 augmented pool
 *   3. PRNG fork:`af2_improcore_accomp_${musicianId}_${initialSeed}`
 *   4. per chord:pickWeighted(pool) → applyChordPattern → NoteEvent[]
 *   5. NoteEvent → NoteData
 */
export function planAccompImproCore(input: MusicianPlanInput): NoteData[] {
    const styleName = ImproStyleStore.getStyleName();
    const style = getStyleByName(styleName);
    const augmentedPool: ChordPattern[] = [...style.chordPatterns, ...ARP_AUGMENT_CHORD_PATTERNS];

    const initialSeed = PRNGManager.getInitialSeed() >>> 0;
    const rng = new Random(`af2_improcore_accomp_${input.musicianId}_${initialSeed}`);

    const allEvents: NoteEvent[] = [];
    for (const chord of input.score.chords) {
        const voicing = chord.voicing ?? [];
        if (voicing.length === 0) continue;
        const beats = chord.endBeat - chord.startBeat;
        if (beats <= 0) continue;

        const cp = pickWeighted(augmentedPool, rng);
        if (!cp) continue;
        const events = applyChordPattern(cp.rules, voicing, chord.startBeat, beats);
        allEvents.push(...events);
    }

    return allEvents.map(e => ({
        pitch: e.pitch,
        onset: e.onset,
        duration: e.duration,
        velocity: Math.max(0, Math.min(1, e.velocity / 127)),
    }));
}

// ─────────────────────────────────────────────────────────────────
// planBassImproCore — BassIdiom 入口
// ─────────────────────────────────────────────────────────────────

/** Bass 物理音域(RELATIVE,K-2 安全):A1=33 ~ G3=55 — 真 bass 区,避免飘进中音区撞钢琴 */
const BASS_LOW_MIDI = 33;
const BASS_HIGH_MIDI = 55;
const BASS_ANCHOR_MIDI = 40;   // E2 起步

/**
 * AF2 BassIdiom.plan 用 ImproCore bass-pattern 替代 AF2 自家 walking 的入口。
 *
 * 流程:
 *   1. ImproStyleStore 拿当前 styleName → style.bassPatterns
 *   2. PRNG fork:`af2_improcore_bass_${musicianId}_${initialSeed}` × 2(pattern pick + bass pick)
 *   3. per chord:
 *      a. 从 chord 算 RELATIVE chord spell / color / local scale pcs
 *      b. pickWeighted(style.bassPatterns) → BassPattern
 *      c. applyBassPattern → NoteEvent[]
 *      d. 维护 prevBassMidi(跨 chord voice leading)
 *   4. NoteEvent → NoteData
 */
export function planBassImproCore(input: MusicianPlanInput): NoteData[] {
    const styleName = ImproStyleStore.getStyleName();
    const style = getStyleByName(styleName);
    const bassPatterns: BassPattern[] = [...style.bassPatterns];
    if (bassPatterns.length === 0) return [];

    const initialSeed = PRNGManager.getInitialSeed() >>> 0;
    const patternRng = new Random(`af2_improcore_bass_pat_${input.musicianId}_${initialSeed}`);
    const pickRng = new Random(`af2_improcore_bass_pick_${input.musicianId}_${initialSeed}`);

    const keyOffset = input.score.keyOffset;
    const keyDiatonicPcs = getKeyDiatonicPcsRelative(input.score.tonality);
    const keyDiaSet = new Set(keyDiatonicPcs);

    const allEvents: NoteEvent[] = [];
    let prevBassMidi = BASS_ANCHOR_MIDI;

    const chords = input.score.chords;
    for (let ci = 0; ci < chords.length; ci++) {
        const chord = chords[ci]!;
        const next = chords[ci + 1] ?? null;
        const beats = chord.endBeat - chord.startBeat;
        if (beats <= 0) continue;

        // RELATIVE pcs(K-2:chord.root 是 ABSOLUTE,减回 keyOffset)
        const rootPc = ((chord.root - keyOffset) % 12 + 12) % 12;
        const vocab = getChordVocab(qualityToVocabType(chord.quality));
        const spellPcs = vocab.spell.map(pc => ((rootPc + pc) % 12 + 12) % 12);
        const colorPcsAll = vocab.color.map(pc => ((rootPc + pc) % 12 + 12) % 12);

        // local scale(per chord,跟 melody adapter 同算法)
        const chordScaleName = vocab.scales[0] ?? 'major';
        const chordScaleRaw = getScalePcs(chordScaleName, rootPc);
        const chordScaleIntersect = chordScaleRaw.filter(pc => keyDiaSet.has(pc));
        const localScalePcs = chordScaleIntersect.length >= 4 ? chordScaleIntersect : chordScaleRaw;
        const localScaleSet = new Set(localScalePcs);
        const colorPcs = colorPcsAll.filter(pc => localScaleSet.has(pc));

        const nextRootPc = next ? ((next.root - keyOffset) % 12 + 12) % 12 : null;

        const bp = pickWeighted(bassPatterns, patternRng);
        if (!bp) continue;
        const bassNotes = applyBassPattern(
            bp.rules,
            rootPc,
            spellPcs,
            colorPcs,
            localScalePcs,
            nextRootPc,
            prevBassMidi,
            BASS_LOW_MIDI,
            BASS_HIGH_MIDI,
            chord.startBeat,
            beats,
            pickRng,
        );
        allEvents.push(...bassNotes);
        const last = bassNotes[bassNotes.length - 1];
        if (last) prevBassMidi = last.pitch;
    }

    return allEvents.map(e => ({
        pitch: e.pitch,
        onset: e.onset,
        duration: e.duration,
        velocity: Math.max(0, Math.min(1, e.velocity / 127)),
    }));
}
