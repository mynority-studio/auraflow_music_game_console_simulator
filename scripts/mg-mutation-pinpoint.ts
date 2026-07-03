import {
    Engine as MgEngine,
    Random as MgRandom,
} from '../../melodygenerative/src/lib/musicEngine';

import { INTERVAL_AESTHETICS } from '../../melodygenerative/src/lib/musicTheory';

// 直接抓 pc=10 的 expectedResolutions 数组引用 + 长度
const arr10 = INTERVAL_AESTHETICS[10].expectedResolutions;
console.log('Before any call:');
console.log(`  INTERVAL_AESTHETICS[10].expectedResolutions = ${JSON.stringify(arr10)} (length ${arr10.length})`);
console.log(`  same array ref? (sanity) — ${arr10 === INTERVAL_AESTHETICS[10].expectedResolutions}`);

// Freeze 它,如果有人 push 会报错
// Object.freeze(arr10);  // 先不冻,观察自然行为

// 运行一次 JAZZ 24
const cfg: any = { seed: '42::harmony', style: 'JAZZ', key: 'C', mode: 'Major', emotion: 'auto', barsOverride: 24 };
const eng = new MgEngine(new MgRandom(cfg.seed));
const chords = eng.generateProgressions(cfg);
eng.generateArrangement(chords, cfg);

console.log('\nAfter 1 JAZZ 24 call:');
console.log(`  INTERVAL_AESTHETICS[10].expectedResolutions = ${JSON.stringify(INTERVAL_AESTHETICS[10].expectedResolutions)} (length ${INTERVAL_AESTHETICS[10].expectedResolutions.length})`);
console.log(`  same array ref as before? ${arr10 === INTERVAL_AESTHETICS[10].expectedResolutions}`);
console.log(`  saved arr10 = ${JSON.stringify(arr10)} (length ${arr10.length}) — if mutated, this also grew`);

console.log('\n=== Now freeze and run again ===');
Object.freeze(INTERVAL_AESTHETICS[10].expectedResolutions);
for (const k of Object.keys(INTERVAL_AESTHETICS)) {
    Object.freeze((INTERVAL_AESTHETICS as any)[+k].expectedResolutions);
}
console.log('All INTERVAL_AESTHETICS[pc].expectedResolutions arrays frozen.');

try {
    const eng2 = new MgEngine(new MgRandom(cfg.seed));
    const chords2 = eng2.generateProgressions(cfg);
    eng2.generateArrangement(chords2, cfg);
    console.log('Call succeeded after freeze.');
} catch (e: any) {
    console.log('Call FAILED after freeze:');
    console.log('  ' + (e?.message ?? e));
    console.log('  Stack head:');
    if (e?.stack) console.log('  ' + e.stack.split('\n').slice(0, 5).join('\n  '));
}
