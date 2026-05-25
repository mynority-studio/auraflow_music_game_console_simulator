// ============================================================
// ImproEngineFacade — ImproCore 主入口(mirror Af2EngineFacade.generate)
// ============================================================
//
// 共识 1(B + A 升级 2026-05-25):
//   B:复用 AF2 Layer 1-3 输出(SectionPlanner + Arranger),Impro 只替换 Layer 4-7
//   A 升级:绕过 Af2KernelDriver.invoke(那里跑 Composer + DynamicHarmonyDecorator
//          + 4 Planner)— 直接调 Af2Arranger.arrange 不传 plannerOptions,
//          拿"裸 Roman + base type"(maj/min/dom7/m7/dim 等基础 type),
//          没有 Cmaj9/Cmaj7#11 之类 decoration,没有 borrow/picardy/tonicize 修改。
//          ImproCore 的 VoicingGenerator 在裸 chord 上自由加色 — 这才是 Impro-Visor
//          哲学(用户输入裸 chord symbol → VoicingGenerator 决定 voicing)。
//
// 流程:
//   1. AF2 借用:keyOffset / tonality / sections
//   2. Af2Arranger.arrange(sections, 4, rng) — 不传 plannerOptions,4 Planner 全跳过
//   3. Af2AbstractStep[] → chord 序列(累 startBeat/endBeat,默认 4 beat/bar)
//   4. per chord:
//      a. ChordVocab 查 priority/color(AF2 chord-vocab.ts 18 curated)
//      b. HandManager.planHands → numLH/numRH + 区间
//      c. VoicingGenerator.generateVoicing → { lhMidi, rhMidi }(ABSOLUTE MIDI)
//      d. weighted pick chord-pattern + applyChordPattern → accomp NoteEvent[]
//      e. weighted pick bass-pattern + applyBassPattern → bass NoteEvent[]
//      f. weighted pick drum-pattern + applyDrumPattern → drum NoteEvent[]
//   5. NoteEvent → NoteData
//   6. GeneratedTrack(keyOffset = 0 防 K-2 重复转调)
//
// 共识 2:全 D-5 deterministic — 用 AF2 Random class,seed sub-fork
// (impro_${seed}_${chord_idx}_voicing / _bass / _drum / _pattern)
//
// 不消费的 AF2 字段:Composer / DynamicHarmonyDecorator / 4 Planner / Conductor /
// Reconciler / chord-texture / MelodyGen / section.sectionType / section.energyLevel
// 输出 melody = [](共识 4 第一版无 melody)
// ============================================================

import { PRNGManager } from '../../utils/PRNG';
import { Random } from '../af2-engine/utils/Random';
import { KEYS } from '../af2-engine/music-theory/spell';
import {
    Tonality, type NoteData, type GeneratedTrack, type GeneratedChord,
    type MusicContext, BandRole,
} from '../types';
import { StyleId } from '../config/StyleFlags';
import type { PipelineRunOptions } from '../pipeline';
import { SectionPlanner } from '../af2-engine/SectionPlanner';
import { Af2KernelDriver, MG_TYPE_TO_QUALITY, POP_BPM } from '../af2-engine/Af2KernelDriver';
import { Af2Arranger } from '../af2-engine/Af2Arranger';
import { ChordQuality } from '../types';
import { getChordVocab } from '../af2-engine/music-theory/chord-vocab';
import { getStyleByName, getVoicingSettingsForType } from './data/loaded';
import { ImproStyleStore } from '../../../state/ImproStyleStore';
import type { StyleData, BassPattern, ChordPattern, DrumPattern } from './data/sty-parser';
import { planHands } from './algorithms/hand-manager';
import { generateVoicing } from './algorithms/voicing-generator';
import { applyChordPattern, type NoteEvent } from './algorithms/chord-pattern';
import { applyBassPattern } from './algorithms/bass-pattern';
import { applyDrumPattern } from './algorithms/drum-pattern';
import { generateMelody, getGrammarByName, type MelodyChordCtx } from './algorithms/lick-gen';
import { ImproGrammarStore } from '../../../state/ImproGrammarStore';
import { parseNoteName, getScalePcs } from './algorithms/note-utils';
import {
    planBorrowedChords, planTonicization,
    evaluateHarmony, type CoherenceChordInput,
    type BorrowChordInput, type TonicizationChordInput,
    type BorrowSource,
} from '../harmony';

export interface ImproGenerateResult {
    track: GeneratedTrack;
    context: MusicContext;
}

/** ImproEngine 当前 style — 由 ImproStyleStore (Q+H UI dropdown 写入) 决定。
 *  Fallback:找不到 fall back 到 ballad。 */
function getCurrentStyle(): StyleData {
    return getStyleByName(ImproStyleStore.getStyleName());
}

const POP_STYLE_ID: StyleId = StyleId.ModernPop;

// ============================================================
// ImproCore 扩展:arp / broken / 混合 chord-pattern augment(2026-05-25)
// ============================================================
// .sty 原 chord-pattern 只有 X/R/V token → 全柱式听感。
// 这里 augment 含 U(arp up)/ D(arp down)/ B(broken pair)的 pattern,加到
// style.chordPatterns pool weighted random 抽样,让伴奏听感呈柱式 / arp / broken / 混合。
//
// weight 设计:总 weight ≈ 70.0,对比 ballad.sty 原池总 weight ≈ 100,新池占 41%
// (柱式仍主流,arp/broken 当装饰)。
// ============================================================
const ARP_AUGMENT_CHORD_PATTERNS: ChordPattern[] = [
    // 纯 arp(arp 主导)
    { rules: ['V80', 'U2'],             weight: 8.0 },   // 2 拍上行 arp
    { rules: ['V80', 'D2'],             weight: 5.0 },   // 2 拍下行 arp
    { rules: ['V75', 'U4', 'D4'],       weight: 10.0 },  // 上行 + 下行(一来回)
    { rules: ['V70', 'U1'],             weight: 4.0 },   // 1 拍 arp(快速)
    // Broken pair(高低对)
    { rules: ['V85', 'B4', 'B4'],       weight: 12.0 },  // 高低对 x 2
    { rules: ['V85', 'B2'],             weight: 8.0 },   // 长 broken
    { rules: ['V80', 'B4', 'B4', 'B4', 'B4'], weight: 6.0 }, // 8 beat 高低对密集
    // 混合(柱式 + 装饰)
    { rules: ['V90', 'X4', 'U4'],       weight: 10.0 },  // 1 拍柱 + 1 拍 arp
    { rules: ['V90', 'X4', 'B4'],       weight: 10.0 },  // 1 拍柱 + 1 拍 broken
    { rules: ['V85', 'X2', 'U2'],       weight: 7.0 },   // 2 拍柱 + 2 拍 arp
];

/**
 * Af2AbstractStep.type 是字符串(maj/min/dom7/m7/...),直接当 ChordVocab key 用。
 * 输出 GeneratedTrack.chords 时反向 string → ChordQuality enum(借 MG_TYPE_TO_QUALITY)。
 */
function typeStringToQuality(typeStr: string): ChordQuality {
    return MG_TYPE_TO_QUALITY[typeStr] ?? ChordQuality.Major;
}

void Af2KernelDriver;   // 保 import 不动(后续 SectionPlanner.getRecommendedBars 用)

/**
 * 算 key 的 7 个 diatonic pc(ABSOLUTE,已加 keyOffset)。
 * Major key:Ionian 1-2-3-4-5-6-7 = [0,2,4,5,7,9,11]
 * Minor key:Aeolian(自然小调) 1-2-b3-4-5-b6-b7 = [0,2,3,5,7,8,10]
 *
 * 用法:melody chooseNote RANDOM 候选限制 + bass S token 选音 — 避免 chord vocab
 * color 的 altered tension(b9/#9/#11/b13)漏到这两条线造成调外感。
 */
function computeKeyDiatonicPcs(keyOffset: number, isMinor: boolean): number[] {
    const intervals = isMinor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    return intervals.map(iv => ((iv + keyOffset) % 12 + 12) % 12);
}

/**
 * Step A 修复"张力没解决"— 给 A 路径 base type 升级:
 *   V → 7 (dom7) 给 dominant 力度,V7→I 是经典 authentic cadence
 *   ii → m7         (jazz comping 经典 ii7-V7-I)
 *   末 chord I → maj7 (色彩 + 解决感)
 *   末 chord i → m7   (jazz minor 收束)
 * 其他保持 base type(避免太 jazz)。
 *
 * 注:vocab key 必须存在于 chord-vocab.ts(18 curated):'7' / 'm7' / 'maj7' 都在。
 */
function enhanceChordType(roman: string, baseType: string, isLastInSection: boolean): string {
    if (isLastInSection) {
        if (roman === 'I') return 'maj7';
        if (roman === 'i') return 'm7';
        // 其他末 chord(V / IV / vi 等)保持 — 避免太多变化
    }
    if (roman === 'V') return '7';
    if (roman === 'v') return 'm7';   // minor key 的 v(小七 = 自然小调)
    if (roman === 'ii') return 'm7';
    return baseType;
}

function pickWeighted<T extends { weight: number }>(items: readonly T[], rng: Random): T | null {
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

function noteEventToNoteData(e: NoteEvent): NoteData {
    return {
        pitch: e.pitch,
        onset: e.onset,
        duration: e.duration,
        velocity: e.velocity / 127,
    };
}

export const ImproEngineFacade = {
    /**
     * 主入口:runPipeline 在 EngineSelectionStore.getEngine() === 'Impro' 时调用。
     */
    generate(options: PipelineRunOptions): ImproGenerateResult {
        const auraflowSeed = PRNGManager.getInitialSeed();
        const seedString = `impro_${auraflowSeed >>> 0}`;

        // 1. AF2 借用:keyOffset + tonality(同 Af2EngineFacade 逻辑)
        const keyRng = new Random(`${seedString}_key`);
        const tonalityRng = new Random(`${seedString}_tonality`);
        const userKey = options.generation?.detectedKey;
        const keyOffset = (userKey !== undefined && Number.isInteger(userKey) && userKey >= 0 && userKey <= 11)
            ? userKey
            : keyRng.range(0, 11);
        const key = KEYS[keyOffset];
        const userTonality = options.generation?.detectedTonality;
        const tonality = (userTonality === Tonality.Major || userTonality === Tonality.Minor)
            ? userTonality
            : (tonalityRng.next() < 0.7 ? Tonality.Major : Tonality.Minor);
        const isMinor = tonality === Tonality.Minor;

        // 2. AF2 借用:sections
        const totalBars = Af2KernelDriver.getRecommendedBars();
        const sections = SectionPlanner.plan(totalBars, 4);
        const bpm = POP_BPM;
        void key; // K-2 不消费(下面 keyOffset 单独处理 ABSOLUTE pc 转换)

        // 2b. ★ A 路径:Af2Arranger.arrange 不传 plannerOptions → 4 Planner 全跳过
        //     拿"裸 Roman + base type"(无 borrow/picardy/tonicize/decoration)
        const arrangerRng = new Random(seedString);
        const abstractPath = Af2Arranger.arrange(sections, 4, arrangerRng);

        // 2b-bis. ★ harmony shared 层接入:borrow + tonicize 增强 chord progression
        //   melodygenerative 10 borrow rules + tonicization(P5a + per-target cooldown + borrow-source coloring)
        //   per-song borrow-source fork(80% Aeolian / 12% Mixolydian / 8% Phrygian)
        const songKeyRootPc = keyOffset;
        const borrowSourceRng = new Random(`${seedString}_borrow_source`);
        const borrowSourceRoll = borrowSourceRng.next();
        const borrowSource: BorrowSource = borrowSourceRoll < 0.80 ? 'Aeolian'
            : borrowSourceRoll < 0.92 ? 'Mixolydian'
            : 'Phrygian';

        // Af2AbstractStep → BorrowChordInput(plain object)
        const initialSlots: BorrowChordInput[] = abstractPath.map(s => ({
            roman: s.roman,
            type: s.type,
            scaleDegree: s.scaleDegree,
            rootOffset: ((s.rootOffset % 12) + 12) % 12,
            beats: s.beats ?? 4,
        }));

        // 跑 borrow planner
        const borrowedSlots = planBorrowedChords({
            skeleton: initialSlots,
            baseProb: 0.45,          // POP default(STYLE_BORROW_PROB)
            maxFires: 3,             // POP default
            motifInterval: 4,
            random: new Random(`${seedString}_borrow`),
            beatsPerMeasure: 4,
            mode: isMinor ? 'Aeolian' : 'Ionian',
            borrowSource,
            isMinorKey: isMinor,
        });

        // 跑 tonicization planner(input 复用 borrow 输出,接口字段兼容)
        const tonicizedSlots = planTonicization({
            skeleton: borrowedSlots as TonicizationChordInput[],
            style: 'POP',
            motifInterval: 4,
            random: new Random(`${seedString}_tonicize`),
            beatsPerMeasure: 4,
            songKeyRootPc,
            borrowSource,
        });

        // 2c. enhanced slots → step-with-time 序列(累 startBeat/endBeat)
        //     borrow/tonicize 可能改变 chord 数量 + chord beats,重新累积时间
        interface TimedStep {
            roman: string;
            type: string;
            rootOffset: number;
            startBeat: number;
            endBeat: number;
            localTonalCenterPc?: number;
            analysisKeyPc?: number;
            localRoman?: string;
            borrowedSource?: string;
            borrowedFrom?: string;
            effectiveFunc?: 'T' | 'S' | 'D';
            mustResolve?: boolean;
        }
        const stepsWithTime: TimedStep[] = [];
        let cursor = 0;
        for (const slot of tonicizedSlots) {
            const stepBeats = slot.beats ?? 4;
            stepsWithTime.push({
                roman: slot.roman,
                type: slot.type,
                rootOffset: ((slot.rootOffset % 12) + 12) % 12,
                startBeat: cursor,
                endBeat: cursor + stepBeats,
                localTonalCenterPc: slot.localTonalCenterPc,
                analysisKeyPc: slot.analysisKeyPc,
                localRoman: slot.localRoman,
                borrowedSource: slot.borrowedSource,
                borrowedFrom: slot.borrowedFrom,
                effectiveFunc: slot.effectiveFunc,
                mustResolve: slot.mustResolve,
            });
            cursor += stepBeats;
        }

        // 3. ImproCore — per chord 跑 voicing + 3 pattern
        const style: StyleData = getCurrentStyle();
        // ★ 根据 .sty voicing-type 字段路由 .fv preset(open / closed / quartal / shell)
        //   每个 .sty 的 voicing 哲学不同 — voicing-type 是 .sty 设计意图,必须 respect
        const settings = getVoicingSettingsForType(style.voicingType);
        // augment chord-pattern pool 加 arp/broken(原 .sty 全柱式 → 听感单一)
        const augmentedChordPatterns: ChordPattern[] = [
            ...style.chordPatterns,
            ...ARP_AUGMENT_CHORD_PATTERNS,
        ];

        const voicingRng = new Random(`${seedString}_voicing`);
        const handsRng = new Random(`${seedString}_hands`);
        const chordPatternRng = new Random(`${seedString}_chord_pat`);
        const bassPatternRng = new Random(`${seedString}_bass_pat`);
        const drumPatternRng = new Random(`${seedString}_drum_pat`);
        const bassPickRng = new Random(`${seedString}_bass_pick`);

        const accompEvents: NoteEvent[] = [];
        const bassEvents: NoteEvent[] = [];
        const drumEvents: NoteEvent[] = [];
        // Step A 最小可跑 melody — 收集 per-chord MelodyChordCtx,主循环后一次性 generateMelody
        const melodyCtxs: MelodyChordCtx[] = [];
        const melodyRng = new Random(`${seedString}_melody`);

        // 全曲共享:key 的 7 个 diatonic pc(过滤调外音用 — bass S + melody RANDOM)
        const keyDiatonicPcs = computeKeyDiatonicPcs(keyOffset, isMinor);

        // 物理音域(从 style 读 — note name → MIDI)
        // .sty bass-low / bass-high 经常偏高(ballad 的 'g--'=G2 / 'c'=C4),
        // 用户反馈"bass 还是高" — 即使 cap D3 仍听感不像真低音(电贝斯 D3 算中高音)。
        // 改 hardcode 区间 [C2 (36), C3 (48)] — 典型钢琴 LH / 真实低音区。
        // 取 .sty 字段做参考(若更低则用 .sty 值,但绝不让 high 超 C3)。
        const bassLowRaw = parseNoteName(style.bassLow) ?? 36;
        const bassHighRaw = parseNoteName(style.bassHigh) ?? 60;
        const bassLowMidi = Math.min(bassLowRaw, 36);    // 下扩到 C2 (36) 或更低
        const bassHighMidi = Math.min(bassHighRaw, 48);  // cap C3 (48) — 钢琴 LH 上限

        let prevVoicing: number[] = [];
        let prevLhLow = settings.lhLowerLimit;
        // 初始 bass anchor:用 style.bassBase(ballad C2 = 36)clamp 到 range,
        // 取代原 bassLow+12(总在 G3 偏高位置导致 voice leading 飘高)
        const bassBaseRaw = parseNoteName(style.bassBase) ?? bassLowMidi;
        let prevBassMidi = Math.max(bassLowMidi, Math.min(bassHighMidi, bassBaseRaw));
        const enrichedChords: GeneratedChord[] = [];

        for (let ci = 0; ci < stepsWithTime.length; ci++) {
            const step = stepsWithTime[ci]!;
            const nextStep = stepsWithTime[ci + 1] ?? null;
            const chordBeats = step.endBeat - step.startBeat;
            if (chordBeats <= 0) continue;

            // Step C:判定本 chord 是否 section 末(phrase ending)
            //   规则:next step 在不同 section(或不存在)→ 本 step 是 section 末
            const isPhraseEnd = (() => {
                if (!nextStep) return true;  // 全曲最后 chord
                const mySection = sections.find(s =>
                    step.startBeat >= s.startBeat - 0.1 && step.endBeat <= s.endBeat + 0.1
                );
                const nextSection = sections.find(s =>
                    nextStep.startBeat >= s.startBeat - 0.1 && nextStep.endBeat <= s.endBeat + 0.1
                );
                return mySection !== nextSection;
            })();

            // Step A:enhance chord type — V→V7, ii→m7, 末 chord I→Imaj7 等
            //   只升不降:升级到 chord-vocab.ts 有 curated 的 key(7/m7/maj7)
            const enhancedType = enhanceChordType(step.roman, step.type, isPhraseEnd);

            // 3a. chord vocab — 用 enhancedType 替代 step.type
            //     absRoot = step.rootOffset(RELATIVE pc)+ keyOffset → ABSOLUTE
            const absRootPc = ((step.rootOffset + keyOffset) % 12 + 12) % 12;
            const vocab = getChordVocab(enhancedType);
            const priorityPcs = vocab.priority.map(pc => ((absRootPc + pc) % 12 + 12) % 12);
            const colorPcsAll = vocab.color.map(pc => ((absRootPc + pc) % 12 + 12) % 12);
            const spellPcs = vocab.spell.map(pc => ((absRootPc + pc) % 12 + 12) % 12);

            // ★ chord-scale relationship — per chord 算 local scale(替代全曲 key scale)
            //   chord vocab.scales[0] 是经典 idiomatic scale(C maj→major / Dm7→dorian /
            //   G7→mixolydian / G7b9→diminished etc.)
            //   每个 chord 当下用自己的 local scale 给 melody/bass 游走,而不是全曲 key
            //   这样 chord 加 9/11/13(jazz extension)时 scale 也包含这些音 → 不冲突
            const chordScaleName = vocab.scales[0] ?? 'major';
            const chordScaleRaw = getScalePcs(chordScaleName, absRootPc);
            // 与 keyDiatonicPcs 取交集(防 chord 自己 scale 含调外音 — 如 F maj→F major
            // scale 含 Bb,在 C key 里 Bb 调外。交集保 melody/bass 仍在 key 内)。
            // 交集太小(<4 pc)→ 用纯 chord scale fallback(允许 jazz altered chord 的 b9 等)
            const keyDiaSet = new Set(keyDiatonicPcs);
            const chordScaleIntersect = chordScaleRaw.filter(pc => keyDiaSet.has(pc));
            const localScalePcs = chordScaleIntersect.length >= 4 ? chordScaleIntersect : chordScaleRaw;

            // chord LH/RH colorPcs 用 local scale 过滤(替代之前的 key scale 过滤)
            // 这样 chord 允许 9/11/13 调内 extension,但禁 altered tension(除非 chord scale 本身允许)
            const localScaleSet = new Set(localScalePcs);
            const colorPcs = colorPcsAll.filter(pc => localScaleSet.has(pc));
            // bass S token 也用 local scale(每 chord 当下的 scale,而非全曲 key)
            const scalePcs = localScalePcs;

            // 3b. hand layout
            const handLayout = planHands(settings, prevLhLow, handsRng);

            // 3c. voicing — colorPcs 已过滤调内,VoicingGenerator 不再选 altered tension
            const { lhMidi, rhMidi } = generateVoicing(
                priorityPcs, colorPcs, handLayout, prevVoicing, settings, voicingRng,
            );
            const fullVoicing = [...lhMidi, ...rhMidi].sort((a, b) => a - b);

            // 同步压入 enriched(GeneratedChord 用 enhanced quality 给 UI 显示升级后类型)
            enrichedChords.push({
                numeral: step.roman,
                root: step.rootOffset,
                quality: typeStringToQuality(enhancedType),
                startBeat: step.startBeat,
                endBeat: step.endBeat,
                voicing: fullVoicing,
            });

            // 3d. chord pattern(从 augmented pool 抽 — 原柱式 + arp/broken/混合)
            const cp: ChordPattern | null = pickWeighted(augmentedChordPatterns, chordPatternRng);
            if (cp) {
                accompEvents.push(...applyChordPattern(cp.rules, fullVoicing, step.startBeat, chordBeats));
            }

            // 3e. bass pattern
            const bp: BassPattern | null = pickWeighted(style.bassPatterns, bassPatternRng);
            if (bp) {
                const nextAbsRootPc = nextStep
                    ? ((nextStep.rootOffset + keyOffset) % 12 + 12) % 12
                    : null;
                const bassNotes = applyBassPattern(
                    bp.rules, absRootPc, spellPcs, colorPcs, scalePcs, nextAbsRootPc,
                    prevBassMidi, bassLowMidi, bassHighMidi,
                    step.startBeat, chordBeats, bassPickRng,
                );
                bassEvents.push(...bassNotes);
                const lastBass = bassNotes[bassNotes.length - 1];
                if (lastBass) prevBassMidi = lastBass.pitch;
            }

            // 3f. melody chord ctx(per chord 收集,主循环后 generateMelody 跑)
            //     Step C:phrase end 标记 → melody 走 long tonic 收音 path
            //     scalePcs:chord 当下的 local scale(chord-scale relationship),
            //              替代全曲 key scale — melody 在 chord 的 dorian/mixolydian 内游走
            melodyCtxs.push({
                startBeat: step.startBeat,
                beats: chordBeats,
                rootPc: absRootPc,
                spellPcs,
                colorPcs,
                scalePcs: localScalePcs,
                isPhraseEnd,
            });

            // 3g. drum pattern
            const dp: DrumPattern | null = pickWeighted(style.drumPatterns, drumPatternRng);
            if (dp) {
                drumEvents.push(...applyDrumPattern(dp, step.startBeat, chordBeats));
            }

            prevVoicing = fullVoicing;
            if (fullVoicing.length > 0) prevLhLow = fullVoicing[0]!;
        }

        // 4. NoteEvent → NoteData
        const accompaniment = accompEvents.map(noteEventToNoteData);
        const bass = bassEvents.map(noteEventToNoteData);
        const drums = drumEvents.map(noteEventToNoteData);

        // 4b. Step A:per-chord MelodyChordCtx → 一次性 generateMelody → NoteData[]
        // Step B:从 ImproGrammarStore 取用户选的 grammar(6 个 hardcode 风格)
        const grammar = getGrammarByName(ImproGrammarStore.getGrammarName());
        const melodyEvents = generateMelody(melodyCtxs, melodyRng, grammar);
        const melody: NoteData[] = melodyEvents.map(e => ({
            pitch: e.pitch,
            onset: e.onset,
            duration: e.duration,
            velocity: e.velocity / 127,
        }));

        // 4c. ★ harmonicCoherence diagnostic post-pass — 不 mutate 生成,仅评分 + console
        //   把 enrichedChords + bass + voicing 转 CoherenceChordInput → evaluateHarmony
        const coherenceChords: CoherenceChordInput[] = stepsWithTime.map((step, i) => {
            const ec = enrichedChords[i];
            const voicing = ec?.voicing ?? [];
            // bass MIDI:从 enrichedChords 拿不到,用 step 的 absRoot + 36(C2 bass 起点)估
            const absRootPc = ((step.rootOffset + keyOffset) % 12 + 12) % 12;
            const bassMidi = 36 + absRootPc;
            // rootMidi(ABSOLUTE):absRoot + 48(C3 octave 估)
            const rootMidi = 48 + absRootPc;
            return {
                rootMidi,
                bassMidi,
                notesMidi: voicing.length > 0 ? voicing : [rootMidi],
                type: step.type,
                roman: step.roman,
                duration: step.endBeat - step.startBeat,
                chordSymbol: `${step.roman}${step.type === 'maj' ? '' : step.type}`,
                effectiveFunc: step.effectiveFunc,
                borrowedSource: step.borrowedSource,
                borrowedFrom: step.borrowedFrom,
                analysisKeyPc: step.analysisKeyPc,
                localTonalCenterPc: step.localTonalCenterPc,
                localRoman: step.localRoman,
                mustResolve: step.mustResolve,
            };
        });
        const report = evaluateHarmony(coherenceChords, 'POP', songKeyRootPc);
        console.log(`[ImproCore] HarmonicCoherence report (POP, key pc ${songKeyRootPc}):`, {
            score: report.score.toFixed(3),
            passed: report.passed,
            subscores: Object.entries(report.subscores).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' '),
            obligations: report.obligations.length,
            issues: report.issues.length,
            topIssues: report.issues.slice(0, 5).map(i => `[${i.severity}] ${i.kind}: ${i.message}`),
        });

        // 5. GeneratedTrack(keyOffset = 0 — ImproCore 直接生成 ABSOLUTE MIDI,
        //    AbsoluteTransposer 不再加 transposition)
        const track: GeneratedTrack = {
            chords: enrichedChords,
            melody,                         // Step A:LickGen + 默认 grammar 生成
            accompaniment,
            bass,
            drums,
            bpm,
            key,
            keyOffset: 0,                   // ImproCore 输出 ABSOLUTE → K-2 不重复转调
            tonality,
            timeSignature: [4, 4],
            sections,                       // SectionPlanner 输出直接复用
            blockIndex: 0,
            absoluteStartBeat: 0,
            hasIntro: true,
        };

        // BandRole 不消费(ImproCore 不走 musician 槽位),用 AF2 同款 cast 绕 type
        void BandRole;
        const context: MusicContext = {
            keyOffset: 0,                   // 同上,K-2 不动
            tonality,
            bpm,
            timeSignature: [4, 4],
            grooveDNA: [],
            style: { id: POP_STYLE_ID } as MusicContext['style'],
        };
        void options.forcedBand;

        return { track, context };
    },
};
