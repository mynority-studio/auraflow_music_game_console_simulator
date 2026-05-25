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
import { generateMelody, type MelodyChordCtx } from './algorithms/lick-gen';
import { parseNoteName } from './algorithms/note-utils';

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

        // 2c. Af2AbstractStep[] → step-with-time 序列(累 startBeat/endBeat)
        //     默认每 step 占 4 beat(一 bar 4/4),除非 step.beats 显式设
        interface TimedStep {
            roman: string;
            type: string;        // ChordVocab key 兼容(maj/min/dom7/m7/...)
            rootOffset: number;  // RELATIVE pc
            startBeat: number;
            endBeat: number;
        }
        const stepsWithTime: TimedStep[] = [];
        let cursor = 0;
        for (const step of abstractPath) {
            const stepBeats = step.beats ?? 4;
            stepsWithTime.push({
                roman: step.roman,
                type: step.type,
                rootOffset: ((step.rootOffset % 12) + 12) % 12,
                startBeat: cursor,
                endBeat: cursor + stepBeats,
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

            // 3a. chord vocab — step.type 直接当 vocab key(string,A 路径无 enum 转)
            //     absRoot = step.rootOffset(RELATIVE pc)+ keyOffset → ABSOLUTE
            const absRootPc = ((step.rootOffset + keyOffset) % 12 + 12) % 12;
            const vocab = getChordVocab(step.type);
            const priorityPcs = vocab.priority.map(pc => ((absRootPc + pc) % 12 + 12) % 12);
            const colorPcs = vocab.color.map(pc => ((absRootPc + pc) % 12 + 12) % 12);
            const spellPcs = vocab.spell.map(pc => ((absRootPc + pc) % 12 + 12) % 12);
            const scalePcs = spellPcs.concat(colorPcs); // 简化:scale = spell ∪ color

            // 3b. hand layout
            const handLayout = planHands(settings, prevLhLow, handsRng);

            // 3c. voicing
            const { lhMidi, rhMidi } = generateVoicing(
                priorityPcs, colorPcs, handLayout, prevVoicing, settings, voicingRng,
            );
            const fullVoicing = [...lhMidi, ...rhMidi].sort((a, b) => a - b);

            // 同步压入 enriched(GeneratedChord 用 enum quality 给 UI)
            enrichedChords.push({
                numeral: step.roman,
                root: step.rootOffset,
                quality: typeStringToQuality(step.type),
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
            melodyCtxs.push({
                startBeat: step.startBeat,
                beats: chordBeats,
                spellPcs,
                colorPcs,
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
        const melodyEvents = generateMelody(melodyCtxs, melodyRng);
        const melody: NoteData[] = melodyEvents.map(e => ({
            pitch: e.pitch,
            onset: e.onset,
            duration: e.duration,
            velocity: e.velocity / 127,
        }));

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
