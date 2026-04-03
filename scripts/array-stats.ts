/**
 * Phase 0.4 — 数组最大长度统计
 *
 * 跑 200 个随机 seed，统计各数组的 min/max/avg 长度，
 * 为 C 移植预分配 buffer 提供上限依据。
 *
 * 运行：npx tsx scripts/array-stats.ts
 *       npm run array-stats
 */
import { PRNGManager } from '../src/core/utils/PRNG';
import { MelodyEngine } from '../src/core/generation/MelodyEngine';
import { Orchestrator } from '../src/core/generation/arrangement/Orchestrator';
import { MidiConverter, DEFAULT_CHANNEL_MAP } from '../src/core/generation/MidiConverter';
import { getAllAvailableStyles } from '../src/core/generation/config/styles/StyleRegistry';
import { writeFileSync } from 'node:fs';

const SEED_COUNT = 200;
const BASE_SEED = 1000;

interface ArrayStats {
    min: number;
    max: number;
    avg: number;
    samples: number;
}

function newStats(): { min: number; max: number; sum: number; count: number } {
    return { min: Infinity, max: 0, sum: 0, count: 0 };
}

function record(s: { min: number; max: number; sum: number; count: number }, val: number) {
    if (val < s.min) s.min = val;
    if (val > s.max) s.max = val;
    s.sum += val;
    s.count++;
}

function finalize(s: { min: number; max: number; sum: number; count: number }): ArrayStats {
    return {
        min: s.min === Infinity ? 0 : s.min,
        max: s.max,
        avg: s.count > 0 ? Math.round(s.sum / s.count) : 0,
        samples: s.count,
    };
}

function run() {
    const allStyles = getAllAvailableStyles();
    const styleCount = allStyles.length;

    // GeneratedTrack arrays
    const trackMelody = newStats();
    const trackVocal = newStats();
    const trackChords = newStats();
    const trackSections = newStats();
    const trackGlobalRiff = newStats();

    // ArrangedTrack arrays
    const arrMelody = newStats();
    const arrPianoLH = newStats();
    const arrPianoRH = newStats();
    const arrDrums = newStats();
    const arrSecondaryMelody = newStats();
    const arrCounterMelody = newStats();
    const arrVocal = newStats();
    const arrUserMotif = newStats();

    // MidiEvent array
    const midiEvents = newStats();

    // Per-section note density (notes per beat)
    const notesPerBeat = newStats();

    // Track duration in beats
    const trackDuration = newStats();

    let failCount = 0;

    console.log(`Array Stats — ${SEED_COUNT} seeds, ${styleCount} styles`);
    console.log('='.repeat(60));

    for (let i = 0; i < SEED_COUNT; i++) {
        const seed = BASE_SEED + i;
        try {
            PRNGManager.setSeed(seed);

            const styleIndex = Math.floor(PRNGManager.next() * styleCount);
            const styleId = allStyles[styleIndex].id;

            const engine = new MelodyEngine();
            const { track, context } = engine.generateFullSong(styleId);

            // GeneratedTrack stats
            record(trackMelody, track.melody.length);
            record(trackVocal, track.vocal?.length ?? 0);
            record(trackChords, track.chords.length);
            record(trackSections, track.sections.length);
            record(trackGlobalRiff, track.globalRiff?.length ?? 0);

            // Duration
            const lastSection = track.sections[track.sections.length - 1];
            if (lastSection) {
                record(trackDuration, lastSection.endBeat);
            }

            const arranged = Orchestrator.arrange(track, styleId, context);

            // ArrangedTrack stats
            record(arrMelody, arranged.melody.length);
            record(arrPianoLH, arranged.pianoLH.length);
            record(arrPianoRH, arranged.pianoRH.length);
            record(arrDrums, arranged.drums?.length ?? 0);
            record(arrSecondaryMelody, arranged.secondaryMelody?.length ?? 0);
            record(arrCounterMelody, arranged.counterMelody?.length ?? 0);
            record(arrVocal, arranged.vocal?.length ?? 0);
            record(arrUserMotif, arranged.userMotif?.length ?? 0);

            // Notes per beat density
            const totalNotes = arranged.melody.length
                + arranged.pianoLH.length
                + arranged.pianoRH.length
                + (arranged.drums?.length ?? 0)
                + (arranged.secondaryMelody?.length ?? 0)
                + (arranged.counterMelody?.length ?? 0)
                + (arranged.vocal?.length ?? 0);
            if (lastSection && lastSection.endBeat > 0) {
                record(notesPerBeat, Math.round(totalNotes / lastSection.endBeat * 100) / 100);
            }

            const events = MidiConverter.convert(arranged, DEFAULT_CHANNEL_MAP);
            record(midiEvents, events.length);

            if ((i + 1) % 50 === 0) {
                console.log(`  ... ${i + 1}/${SEED_COUNT} seeds processed`);
            }
        } catch (error) {
            failCount++;
            if (failCount <= 3) {
                console.error(`  Seed ${seed}: FAILED — ${error}`);
            }
        }
    }

    const results = {
        generatedAt: new Date().toISOString(),
        seedRange: `${BASE_SEED} ~ ${BASE_SEED + SEED_COUNT - 1}`,
        seedCount: SEED_COUNT,
        failCount,
        generatedTrack: {
            melody: finalize(trackMelody),
            vocal: finalize(trackVocal),
            chords: finalize(trackChords),
            sections: finalize(trackSections),
            globalRiff: finalize(trackGlobalRiff),
            durationBeats: finalize(trackDuration),
        },
        arrangedTrack: {
            melody: finalize(arrMelody),
            pianoLH: finalize(arrPianoLH),
            pianoRH: finalize(arrPianoRH),
            drums: finalize(arrDrums),
            secondaryMelody: finalize(arrSecondaryMelody),
            counterMelody: finalize(arrCounterMelody),
            vocal: finalize(arrVocal),
            userMotif: finalize(arrUserMotif),
            notesPerBeat: finalize(notesPerBeat),
        },
        midiEvents: finalize(midiEvents),
        recommended_c_buffer_sizes: {} as Record<string, number>,
    };

    // 推荐 C 预分配上限：max * 1.5 向上取整到 64 的倍数
    const ceilTo64 = (n: number) => Math.ceil(n / 64) * 64;
    const recommend = (s: ArrayStats) => ceilTo64(Math.ceil(s.max * 1.5));

    results.recommended_c_buffer_sizes = {
        MAX_MELODY_NOTES: recommend(results.arrangedTrack.melody),
        MAX_PIANO_LH_NOTES: recommend(results.arrangedTrack.pianoLH),
        MAX_PIANO_RH_NOTES: recommend(results.arrangedTrack.pianoRH),
        MAX_DRUM_NOTES: recommend(results.arrangedTrack.drums),
        MAX_SECONDARY_MELODY_NOTES: recommend(results.arrangedTrack.secondaryMelody),
        MAX_COUNTER_MELODY_NOTES: recommend(results.arrangedTrack.counterMelody),
        MAX_VOCAL_NOTES: recommend(results.arrangedTrack.vocal),
        MAX_CHORDS: recommend(results.generatedTrack.chords),
        MAX_SECTIONS: recommend(results.generatedTrack.sections),
        MAX_MIDI_EVENTS: recommend(results.midiEvents),
    };

    // Print summary table
    console.log('\n' + '='.repeat(60));
    console.log(`Results (${SEED_COUNT - failCount}/${SEED_COUNT} seeds passed)\n`);

    const printRow = (label: string, s: ArrayStats, rec?: number) => {
        const recStr = rec !== undefined ? `  → C buffer: ${rec}` : '';
        console.log(`  ${label.padEnd(28)} min=${String(s.min).padStart(6)}  max=${String(s.max).padStart(6)}  avg=${String(s.avg).padStart(6)}${recStr}`);
    };

    console.log('GeneratedTrack:');
    printRow('melody', results.generatedTrack.melody);
    printRow('vocal', results.generatedTrack.vocal);
    printRow('chords', results.generatedTrack.chords, results.recommended_c_buffer_sizes.MAX_CHORDS);
    printRow('sections', results.generatedTrack.sections, results.recommended_c_buffer_sizes.MAX_SECTIONS);
    printRow('durationBeats', results.generatedTrack.durationBeats);

    console.log('\nArrangedTrack:');
    printRow('melody', results.arrangedTrack.melody, results.recommended_c_buffer_sizes.MAX_MELODY_NOTES);
    printRow('pianoLH', results.arrangedTrack.pianoLH, results.recommended_c_buffer_sizes.MAX_PIANO_LH_NOTES);
    printRow('pianoRH', results.arrangedTrack.pianoRH, results.recommended_c_buffer_sizes.MAX_PIANO_RH_NOTES);
    printRow('drums', results.arrangedTrack.drums, results.recommended_c_buffer_sizes.MAX_DRUM_NOTES);
    printRow('secondaryMelody', results.arrangedTrack.secondaryMelody, results.recommended_c_buffer_sizes.MAX_SECONDARY_MELODY_NOTES);
    printRow('counterMelody', results.arrangedTrack.counterMelody, results.recommended_c_buffer_sizes.MAX_COUNTER_MELODY_NOTES);
    printRow('vocal', results.arrangedTrack.vocal, results.recommended_c_buffer_sizes.MAX_VOCAL_NOTES);
    printRow('notesPerBeat', results.arrangedTrack.notesPerBeat);

    console.log('\nMidiEvents:');
    printRow('total', results.midiEvents, results.recommended_c_buffer_sizes.MAX_MIDI_EVENTS);

    console.log('\nRecommended C buffer sizes (max×1.5, ceil to 64):');
    for (const [key, val] of Object.entries(results.recommended_c_buffer_sizes)) {
        console.log(`  #define ${key.padEnd(32)} ${val}`);
    }

    const outPath = new URL('./array-stats-output.json', import.meta.url).pathname;
    writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`\nOutput: ${outPath}`);
}

run();
