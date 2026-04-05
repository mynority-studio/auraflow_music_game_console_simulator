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
import { StyleId } from '../src/core/generation/config/StyleFlags';

const SEEDS = [12345, 99999, 42, 7777777];

function run() {
    const results: any[] = [];

    console.log(`Golden Seed Test — ${SEEDS.length} seeds, StyleId.Default`);
    console.log('='.repeat(60));

    for (const seed of SEEDS) {
        try {
            // step 0: setSeed
            PRNGManager.setSeed(seed);
            const stateA = PRNGManager.getState();

            // step 1: 消耗一次 PRNG（原用于选风格）
            PRNGManager.next();
            const stateB = PRNGManager.getState();

            // step 2: generateFullSong
            const engine = new MelodyEngine();
            const { track, context } = engine.generateFullSong(StyleId.Default);
            const stateC = PRNGManager.getState();

            // step 4: arrange
            const arranged = Orchestrator.arrange(track, StyleId.Default, context);
            const stateD = PRNGManager.getState();

            // hash arranged output (no MidiConverter in this version)
            const sha256 = createHash('sha256')
                .update(JSON.stringify(arranged))
                .digest('hex');

            const result = {
                seed,
                stateA,
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
                sha256: sha256.substring(0, 32),
            };

            results.push(result);

            console.log(`\nSeed ${seed}:`);
            console.log(`  States: A=${stateA} → B=${stateB} → C=${stateC} → D=${stateD}`);
            console.log(`  Track: ${track.bpm}bpm, ${track.key}, ${track.sections.length} sections, ${track.melody.length} melody notes`);
            console.log(`  Arranged: melody=${arranged.melody.length}, LH=${arranged.pianoLH.length}, RH=${arranged.pianoRH.length}, drums=${arranged.drums?.length ?? 0}`);
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
