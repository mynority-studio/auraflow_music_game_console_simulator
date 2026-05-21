/**
 * mg-smoke.ts — Phase 1 step 2 验证:MgEngineFacade.generate() 不抛错
 *
 * 用途:
 *   - 不依赖浏览器音频环境,直接 node 跑一次 facade,验证 mg pipeline 能从头跑到尾
 *   - 输出 track 各轨长度 + 前几个 note 的关键字段,方便目测合理性
 *
 * 跑法:
 *   npx tsx scripts/mg-smoke.ts
 *
 * 不属于 golden seed 体系,不需要 bit-exact;只是 Phase 1 step 2 的 sanity check。
 */

import { PRNGManager } from '../src/core/utils/PRNG';
import { EngineSelectionStore } from '../src/state/EngineSelectionStore';
import { MgEngineFacade } from '../src/core/generation/mg-engine/MgEngineFacade';

function dump(label: string) {
    console.log(`\n=== ${label} ===`);
    PRNGManager.setSeed(42);
    const { track, context } = MgEngineFacade.generate({});
    console.log(`chords        : ${track.chords.length}`);
    console.log(`melody        : ${track.melody.length} notes`);
    console.log(`accompaniment : ${track.accompaniment?.length ?? 0} notes`);
    console.log(`bass          : ${track.bass?.length ?? 0} notes`);
    console.log(`drums         : ${track.drums?.length ?? 0} notes`);
    console.log(`atmosphere    : ${track.atmosphere?.length ?? 0} notes`);
    console.log(`sections      : ${track.sections.length}`);
    console.log(`bpm           : ${track.bpm}`);
    console.log(`keyOffset     : ${track.keyOffset}`);
    console.log(`tonality      : ${track.tonality}`);
    console.log(`style.id      : ${context.style?.id}`);
    console.log(`gmOverrides   : ${JSON.stringify(context.gmProgramOverrides)}`);

    if (track.chords.length > 0) {
        const c = track.chords[0];
        console.log(`first chord   : root=${c.root} quality=${c.quality} numeral="${c.numeral}" voicing=[${c.voicing?.join(',')}] startBeat=${c.startBeat} endBeat=${c.endBeat}`);
    }
    if (track.melody.length > 0) {
        const m = track.melody[0];
        console.log(`first melody  : pitch=${m.pitch} onset=${m.onset} dur=${m.duration} vel=${m.velocity.toFixed(2)}`);
    }
    if (track.accompaniment && track.accompaniment.length > 0) {
        const a = track.accompaniment[0];
        console.log(`first accomp  : pitch=${a.pitch} onset=${a.onset} dur=${a.duration} vel=${a.velocity.toFixed(2)}`);
    }
}

EngineSelectionStore.setEngine('MG');

EngineSelectionStore.setMgStyle('POP');
dump('seed=42 style=POP');

EngineSelectionStore.setMgStyle('JAZZ');
dump('seed=42 style=JAZZ');

EngineSelectionStore.setMgStyle('BLUES');
dump('seed=42 style=BLUES');

EngineSelectionStore.setMgStyle('RNB');
dump('seed=42 style=RNB');

console.log('\n✅ MgEngineFacade.generate() smoke OK — 4 个 style 全跑通');
