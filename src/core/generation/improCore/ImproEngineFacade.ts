// ============================================================
// ImproEngineFacade — ImproCore 主入口(mirror Af2EngineFacade.generate)
// ============================================================
//
// 共识 1(B):复用 AF2 Layer 1-3 输出(SectionPlanner + Af2KernelDriver
// 给的 chord progression),ImproCore 只替换 Layer 4-7。
//
// 流程:
//   1. AF2 借用:keyOffset / tonality / sections / chord progression(GeneratedChord[])
//   2. per chord:
//      a. ChordVocab 查 priority/color(AF2 chord-vocab.ts 18 curated)
//      b. HandManager.planHands → numLH/numRH + 区间
//      c. VoicingGenerator.generateVoicing → { lhMidi, rhMidi }(ABSOLUTE MIDI)
//      d. weighted pick chord-pattern + applyChordPattern → accomp NoteEvent[]
//      e. weighted pick bass-pattern + applyBassPattern → bass NoteEvent[]
//      f. weighted pick drum-pattern + applyDrumPattern → drum NoteEvent[]
//   3. NoteEvent → NoteData
//   4. GeneratedTrack(keyOffset = 0 防 K-2 重复转调)
//
// 共识 2:全 D-5 deterministic — 用 AF2 Random class,seed sub-fork
// (impro_${seed}_${chord_idx}_voicing / _bass / _drum / _pattern)
//
// 不消费的 AF2 字段:musician / Conductor / Reconciler / chord-texture / MelodyGen
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
import { Af2KernelDriver } from '../af2-engine/Af2KernelDriver';
import { ChordQualityName } from '../types';
import { ChordQuality } from '../types';
import { getChordVocab } from '../af2-engine/music-theory/chord-vocab';
import { BALLAD_STYLE, SWING_STYLE, CLOSED_HIGH_VOICING_SETTINGS } from './data/loaded';
import type { StyleData, BassPattern, ChordPattern, DrumPattern } from './data/sty-parser';
import { planHands } from './algorithms/hand-manager';
import { generateVoicing } from './algorithms/voicing-generator';
import { applyChordPattern, type NoteEvent } from './algorithms/chord-pattern';
import { applyBassPattern } from './algorithms/bass-pattern';
import { applyDrumPattern } from './algorithms/drum-pattern';
import { parseNoteName } from './algorithms/note-utils';

export interface ImproGenerateResult {
    track: GeneratedTrack;
    context: MusicContext;
}

/** ImproEngine 默认 style — Q+H UI 后续可加 selector */
const DEFAULT_STYLE: StyleData = BALLAD_STYLE;
void SWING_STYLE; // 保留 import 避免 unused warning(后续 UI 接入再用)

const POP_STYLE_ID: StyleId = StyleId.ModernPop;

function qualityToVocabKey(q: ChordQuality): string {
    const name = ChordQualityName[q] ?? 'Major';
    const aliases: Record<string, string> = {
        'Major': 'maj', 'Minor': 'min', 'Diminished': 'dim', 'Augmented': 'aug',
        'Major7': 'maj7', 'Minor7': 'm7', 'Dominant7': 'dom7',
        'HalfDiminished': 'm7b5', 'Diminished7': 'dim7',
        'Sus4': 'sus4', 'Dominant7Sus4': '7sus4',
        'Add9': 'add9', 'Minor9': 'm9', 'Major9': 'maj9',
        'Dominant9': '9', 'Minor11': 'm11', 'Dominant13': '13',
        'Major13': 'maj13', 'Major7Sharp11': 'maj7#11',
        'Dom7Flat9': '7b9', 'Dom7Sharp9': '7#9', 'Dom7Sharp11': '7#11',
        'Dom7Flat13': '7b13', 'Dom7Alt': '7alt', 'Dominant11': '11',
    };
    return aliases[name] ?? 'maj';
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

        // 2. AF2 借用:sections + chord progression
        const totalBars = Af2KernelDriver.getRecommendedBars();
        const sections = SectionPlanner.plan(totalBars, 4);
        const mg = Af2KernelDriver.invoke(seedString, key, sections, isMinor, undefined);
        const chords: GeneratedChord[] = mg.chords;
        const bpm = mg.bpm;

        // 3. ImproCore — per chord 跑 voicing + 3 pattern
        const style: StyleData = DEFAULT_STYLE;
        const settings = CLOSED_HIGH_VOICING_SETTINGS;

        const voicingRng = new Random(`${seedString}_voicing`);
        const handsRng = new Random(`${seedString}_hands`);
        const chordPatternRng = new Random(`${seedString}_chord_pat`);
        const bassPatternRng = new Random(`${seedString}_bass_pat`);
        const drumPatternRng = new Random(`${seedString}_drum_pat`);
        const bassPickRng = new Random(`${seedString}_bass_pick`);

        const accompEvents: NoteEvent[] = [];
        const bassEvents: NoteEvent[] = [];
        const drumEvents: NoteEvent[] = [];

        // 物理音域(从 style 读 — note name → MIDI)
        const bassLowMidi = parseNoteName(style.bassLow) ?? 36;
        const bassHighMidi = parseNoteName(style.bassHigh) ?? 60;

        let prevVoicing: number[] = [];
        let prevLhLow = settings.lhLowerLimit;
        let prevBassMidi = bassLowMidi + 12;
        const enrichedChords: GeneratedChord[] = [];

        for (let ci = 0; ci < chords.length; ci++) {
            const chord = chords[ci];
            const nextChord = chords[ci + 1] ?? null;
            const chordBeats = chord.endBeat - chord.startBeat;
            if (chordBeats <= 0) {
                enrichedChords.push(chord);
                continue;
            }

            // 3a. chord vocab(absRoot = chord.root in RELATIVE 空间;加 keyOffset → ABSOLUTE)
            const absRootPc = ((chord.root + keyOffset) % 12 + 12) % 12;
            const vocab = getChordVocab(qualityToVocabKey(chord.quality));
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

            enrichedChords.push({ ...chord, voicing: fullVoicing });

            // 3d. chord pattern
            const cp: ChordPattern | null = pickWeighted(style.chordPatterns, chordPatternRng);
            if (cp) {
                accompEvents.push(...applyChordPattern(cp.rules, fullVoicing, chord.startBeat, chordBeats));
            }

            // 3e. bass pattern
            const bp: BassPattern | null = pickWeighted(style.bassPatterns, bassPatternRng);
            if (bp) {
                const nextAbsRootPc = nextChord
                    ? ((nextChord.root + keyOffset) % 12 + 12) % 12
                    : null;
                const bassNotes = applyBassPattern(
                    bp.rules, absRootPc, spellPcs, colorPcs, scalePcs, nextAbsRootPc,
                    prevBassMidi, bassLowMidi, bassHighMidi,
                    chord.startBeat, chordBeats, bassPickRng,
                );
                bassEvents.push(...bassNotes);
                const lastBass = bassNotes[bassNotes.length - 1];
                if (lastBass) prevBassMidi = lastBass.pitch;
            }

            // 3f. drum pattern
            const dp: DrumPattern | null = pickWeighted(style.drumPatterns, drumPatternRng);
            if (dp) {
                drumEvents.push(...applyDrumPattern(dp, chord.startBeat, chordBeats));
            }

            prevVoicing = fullVoicing;
            if (fullVoicing.length > 0) prevLhLow = fullVoicing[0]!;
        }

        // 4. NoteEvent → NoteData
        const accompaniment = accompEvents.map(noteEventToNoteData);
        const bass = bassEvents.map(noteEventToNoteData);
        const drums = drumEvents.map(noteEventToNoteData);

        // 5. GeneratedTrack(keyOffset = 0 — ImproCore 直接生成 ABSOLUTE MIDI,
        //    AbsoluteTransposer 不再加 transposition)
        const track: GeneratedTrack = {
            chords: enrichedChords,
            melody: [],                     // Step 2 共识:第一版无 melody
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
