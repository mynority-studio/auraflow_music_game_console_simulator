/**
 * 精确定位 INTERVAL_AESTHETICS 在 mg call 后是怎么被改的
 */

import {
    Engine as MgEngine,
    Random as MgRandom,
} from '../../melodygenerative/src/lib/musicEngine';

import { INTERVAL_AESTHETICS } from '../../melodygenerative/src/lib/musicTheory';

function dumpIA() {
    const out: Record<number, any> = {};
    for (const k of Object.keys(INTERVAL_AESTHETICS).sort((a, b) => +a - +b)) {
        const rule = (INTERVAL_AESTHETICS as any)[k];
        out[+k] = {
            function: rule.function,
            tensionAmount: rule.tensionAmount,
            expectedResolutions: rule.expectedResolutions,
        };
    }
    return out;
}

console.log('=== INTERVAL_AESTHETICS before any call ===');
const before = dumpIA();
console.log(JSON.stringify(before, null, 2));

const cfg: any = { seed: '42::harmony', style: 'JAZZ', key: 'C', mode: 'Major', emotion: 'auto', barsOverride: 24 };
const eng = new MgEngine(new MgRandom(cfg.seed));
const chords = eng.generateProgressions(cfg);
eng.generateArrangement(chords, cfg);

console.log('\n=== INTERVAL_AESTHETICS after 1 JAZZ 24 call ===');
const after = dumpIA();
console.log(JSON.stringify(after, null, 2));

console.log('\n=== Diff ===');
for (const k of Object.keys(before)) {
    const b = (before as any)[k];
    const a = (after as any)[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
        console.log(`  pc ${k}:`);
        console.log(`    before: ${JSON.stringify(b)}`);
        console.log(`    after:  ${JSON.stringify(a)}`);
    }
}
