/**
 * 探测 mg / harmony-engine Engine 是否有跨调用的模块级状态泄漏。
 *
 * 假设:Engine 应该是 stateless 的(每次 new Engine + new Random → 确定性输出),
 * 但实测中同 (seed, style, bars) 在不同矩阵位置产出不同 event count,
 * 说明某处有跨实例 / 跨调用的状态泄漏。
 *
 * 探测方式:
 *   1. 独立运行 (42, RNB, 16) 10 次,看是否每次都一致
 *   2. 在 (42, RNB, 16) 之前依次运行其他 case,看哪个 case 污染了它
 */

import {
    Engine as MgEngine,
    Random as MgRandom,
    type NoteEvent as MgNoteEvent,
} from '../../melodygenerative/src/lib/musicEngine';

import {
    Engine as AfEngine,
    Random as AfRandom,
    type NoteEvent as AfNoteEvent,
} from '../src/core/generation/harmony-engine/musicEngine';

function runMg(seed: string, style: string, bars: number) {
    const cfg: any = { seed: `${seed}::harmony`, style, key: 'C', mode: 'Major', emotion: 'auto', barsOverride: bars };
    const eng = new MgEngine(new MgRandom(cfg.seed));
    const chords = eng.generateProgressions(cfg);
    const events = eng.generateArrangement(chords, cfg).events;
    return { chordCount: chords.length, eventCount: events.length };
}

function runAf(seed: string, style: string, bars: number) {
    const cfg: any = { seed: `${seed}::harmony`, style, key: 'C', mode: 'Major', emotion: 'auto', barsOverride: bars };
    const eng = new AfEngine(new AfRandom(cfg.seed));
    const chords = eng.generateProgressions(cfg);
    const events = eng.generateArrangement(chords, cfg).events;
    return { chordCount: chords.length, eventCount: events.length };
}

console.log('======================================================');
console.log('  实验 1:独立连续 10 次跑 (42, RNB, 16) — 看是否稳定');
console.log('======================================================\n');

console.log('mg side:');
for (let i = 0; i < 10; i++) {
    const r = runMg('42', 'RNB', 16);
    console.log(`  iter ${i}: chords=${r.chordCount} events=${r.eventCount}`);
}

console.log('\naf side:');
for (let i = 0; i < 10; i++) {
    const r = runAf('42', 'RNB', 16);
    console.log(`  iter ${i}: chords=${r.chordCount} events=${r.eventCount}`);
}

console.log('\n======================================================');
console.log('  实验 2:在 (42, RNB, 16) 前依次插入其他 case,找污染源');
console.log('======================================================\n');

const PRECEDORS = [
    ['42', 'POP', 16],
    ['42', 'POP', 24],
    ['42', 'JAZZ', 16],
    ['42', 'JAZZ', 24],
    // 跳过 (42, RNB, *) 本身
];

console.log('mg side — preceded by single case then (42, RNB, 16):');
for (const [s, st, b] of PRECEDORS) {
    runMg(s as string, st as string, b as number);
    const r = runMg('42', 'RNB', 16);
    console.log(`  after (${s}, ${st}, ${b}): chords=${r.chordCount} events=${r.eventCount}`);
}

console.log('\naf side — preceded by single case then (42, RNB, 16):');
for (const [s, st, b] of PRECEDORS) {
    runAf(s as string, st as string, b as number);
    const r = runAf('42', 'RNB', 16);
    console.log(`  after (${s}, ${st}, ${b}): chords=${r.chordCount} events=${r.eventCount}`);
}

console.log('\n======================================================');
console.log('  实验 3:完整复刻 compare.ts 顺序前 4 case + (42, RNB, 16)');
console.log('======================================================\n');

console.log('mg side(完整复刻顺序):');
runMg('42', 'POP', 16);
runMg('42', 'POP', 24);
runMg('42', 'JAZZ', 16);
runMg('42', 'JAZZ', 24);
const r1 = runMg('42', 'RNB', 16);
console.log(`  (42, RNB, 16) after 4 priors: chords=${r1.chordCount} events=${r1.eventCount}`);

console.log('\naf side(完整复刻顺序):');
runAf('42', 'POP', 16);
runAf('42', 'POP', 24);
runAf('42', 'JAZZ', 16);
runAf('42', 'JAZZ', 24);
const r2 = runAf('42', 'RNB', 16);
console.log(`  (42, RNB, 16) after 4 priors: chords=${r2.chordCount} events=${r2.eventCount}`);
