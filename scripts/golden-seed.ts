/**
 * Golden Seed Test Script — PRNG 快照 + 输出序列化
 *
 * 用途：为 C 移植提供对比基准。同 seed → 同输出。
 * 运行：npx tsx scripts/golden-seed.ts
 *       npm run golden-seed
 */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PRNGManager } from '../src/core/utils/PRNG';
import { MelodyEngine } from '../src/core/generation/MelodyEngine';
import { Orchestrator } from '../src/core/generation/arrangement/Orchestrator';
import { MidiConverter, DEFAULT_CHANNEL_MAP, MidiEvent } from '../src/core/generation/MidiConverter';
import { getAllAvailableStyles } from '../src/core/generation/config/styles/StyleRegistry';
import { StyleIdName } from '../src/core/generation/config/StyleFlags';

const SEEDS = [12345, 99999, 42, 7777777];

interface SeedResult {
    seed: number;
    stateA: number;
    selectedStyleId: number;
    selectedStyleName: string;
    stateB: number;
    track: {
        bpm: number;
        key: string;
        keyOffset: number;
        tonality: number;
        timeSignature: [number, number];
        sectionCount: number;
        melodyNoteCount: number;
        vocalNoteCount: number;
        chordCount: number;
    };
    context: {
        keyOffset: number;
        tonality: number;
        bpm: number;
        timeSignature: [number, number];
        grooveDNA: number[];
    };
    stateC: number;
    arranged: {
        melodyNoteCount: number;
        pianoLHNoteCount: number;
        pianoRHNoteCount: number;
        drumsNoteCount: number;
        secondaryMelodyNoteCount: number;
        counterMelodyNoteCount: number;
        vocalNoteCount: number;
    };
    stateD: number;
    midiEvents: {
        totalCount: number;
        noteOnCount: number;
        noteOffCount: number;
        ccCount: number;
        first10Events: MidiEvent[];
        last5Events: MidiEvent[];
        sha256: string;
    };
}

function run() {
    const allStyles = getAllAvailableStyles();
    const count = allStyles.length;
    const results: SeedResult[] = [];

    console.log(`Golden Seed Test — ${SEEDS.length} seeds, ${count} styles`);
    console.log('='.repeat(60));

    for (const seed of SEEDS) {
        try {
            // step 0: setSeed
            PRNGManager.setSeed(seed);
            const stateA = PRNGManager.getState();

            // step 1: 选风格
            const styleIndex = Math.floor(PRNGManager.next() * count);
            const styleId = allStyles[styleIndex].id;
            const stateB = PRNGManager.getState();

            // step 2: generateFullSong
            const engine = new MelodyEngine();
            const { track, context } = engine.generateFullSong(styleId);
            const stateC = PRNGManager.getState();

            // step 4: arrange
            const arranged = Orchestrator.arrange(track, styleId, context);
            const stateD = PRNGManager.getState();

            // step 5: MidiConverter
            const events = MidiConverter.convert(arranged, DEFAULT_CHANNEL_MAP);

            // hash
            const sha256 = createHash('sha256')
                .update(JSON.stringify(events))
                .digest('hex');

            const noteOnCount = events.filter(e => e.type === 'noteOn').length;
            const noteOffCount = events.filter(e => e.type === 'noteOff').length;
            const ccCount = events.filter(e => e.type === 'cc').length;

            const result: SeedResult = {
                seed,
                stateA,
                selectedStyleId: styleId,
                selectedStyleName: StyleIdName[styleId] || `Unknown(${styleId})`,
                stateB,
                track: {
                    bpm: track.bpm,
                    key: track.key,
                    keyOffset: track.keyOffset,
                    tonality: track.tonality,
                    timeSignature: track.timeSignature,
                    sectionCount: track.sections.length,
                    melodyNoteCount: track.melody.length,
                    vocalNoteCount: track.vocal?.length ?? 0,
                    chordCount: track.chords.length,
                },
                context: {
                    keyOffset: context.keyOffset,
                    tonality: context.tonality,
                    bpm: context.bpm,
                    timeSignature: context.timeSignature,
                    grooveDNA: context.grooveDNA,
                },
                stateC,
                arranged: {
                    melodyNoteCount: arranged.melody.length,
                    pianoLHNoteCount: arranged.pianoLH.length,
                    pianoRHNoteCount: arranged.pianoRH.length,
                    drumsNoteCount: arranged.drums?.length ?? 0,
                    secondaryMelodyNoteCount: arranged.secondaryMelody?.length ?? 0,
                    counterMelodyNoteCount: arranged.counterMelody?.length ?? 0,
                    vocalNoteCount: arranged.vocal?.length ?? 0,
                },
                stateD,
                midiEvents: {
                    totalCount: events.length,
                    noteOnCount,
                    noteOffCount,
                    ccCount,
                    first10Events: events.slice(0, 10),
                    last5Events: events.slice(-5),
                    sha256,
                },
            };

            results.push(result);

            console.log(`\nSeed ${seed}:`);
            console.log(`  Style: ${result.selectedStyleName} (id=${styleId})`);
            console.log(`  States: A=${stateA} → B=${stateB} → C=${stateC} → D=${stateD}`);
            console.log(`  Track: ${track.bpm}bpm, ${track.key}, ${track.sections.length} sections, ${track.melody.length} melody notes`);
            console.log(`  Arranged: melody=${arranged.melody.length}, LH=${arranged.pianoLH.length}, RH=${arranged.pianoRH.length}, drums=${arranged.drums?.length ?? 0}`);
            console.log(`  MIDI: ${events.length} events (noteOn=${noteOnCount}, noteOff=${noteOffCount}, cc=${ccCount})`);
            console.log(`  SHA-256: ${sha256.substring(0, 16)}...`);

        } catch (error) {
            console.error(`\nSeed ${seed}: FAILED`);
            console.error(`  ${error}`);
        }
    }

    const output = {
        generatedAt: new Date().toISOString(),
        prngAlgorithm: 'LCG: state = (state * 1664525 + 1013904223) % 4294967296',
        ppq: 480,
        styleCount: count,
        availableStyles: allStyles.map(s => ({ id: s.id, name: s.name })),
        seeds: results,
    };

    const outPath = new URL('./golden-seed-output.json', import.meta.url).pathname;
    writeFileSync(outPath, JSON.stringify(output, null, 2));

    console.log('\n' + '='.repeat(60));
    console.log(`Output: ${outPath}`);
    console.log(`Seeds: ${results.length}/${SEEDS.length} passed`);
    console.log('Run again and diff to confirm determinism.');
}

run();
