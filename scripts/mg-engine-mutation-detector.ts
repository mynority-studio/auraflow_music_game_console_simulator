/**
 * 探测器:对 STYLE_DICTIONARY 等"应该是常量"的全局对象做 hash,
 * 在 Engine 调用前后 hash,看是否被偷偷修改。
 */

import {
    Engine as MgEngine,
    Random as MgRandom,
} from '../../melodygenerative/src/lib/musicEngine';

import {
    STYLE_DICTIONARY,
    MACRO_MOTIF_POOLS,
    MACRO_FILL_SCALES,
} from '../../melodygenerative/src/lib/styleDictionary';

import * as crypto from 'crypto';

function hash(obj: any): string {
    return crypto.createHash('sha256').update(JSON.stringify(obj, (k, v) => {
        if (typeof v === 'function') return `__fn:${v.name || 'anon'}`;
        return v;
    })).digest('hex').slice(0, 16);
}

function runCase(seed: string, style: string, bars: number) {
    const cfg: any = { seed: `${seed}::harmony`, style, key: 'C', mode: 'Major', emotion: 'auto', barsOverride: bars };
    const eng = new MgEngine(new MgRandom(cfg.seed));
    const chords = eng.generateProgressions(cfg);
    const events = eng.generateArrangement(chords, cfg).events;
    return { chordCount: chords.length, eventCount: events.length };
}

const TARGETS = {
    STYLE_DICTIONARY: () => STYLE_DICTIONARY,
    MACRO_MOTIF_POOLS: () => MACRO_MOTIF_POOLS,
    MACRO_FILL_SCALES: () => MACRO_FILL_SCALES,
};

function dumpHashes(label: string) {
    console.log(`\n[${label}]`);
    for (const [name, getter] of Object.entries(TARGETS)) {
        console.log(`  ${name}: ${hash(getter())}`);
    }
}

dumpHashes('Before any call');

console.log('\n→ running (42, POP, 16)');
runCase('42', 'POP', 16);
dumpHashes('After (42, POP, 16)');

console.log('\n→ running (42, JAZZ, 24)');
runCase('42', 'JAZZ', 24);
dumpHashes('After (42, JAZZ, 24)');

console.log('\n→ running (42, RNB, 16)');
runCase('42', 'RNB', 16);
dumpHashes('After (42, RNB, 16)');

console.log('\n→ running (42, JAZZ, 16) — should be no-op for STYLE_DICTIONARY');
runCase('42', 'JAZZ', 16);
dumpHashes('After (42, JAZZ, 16)');
