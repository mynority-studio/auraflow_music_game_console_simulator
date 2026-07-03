/**
 * 隔离实验:
 *   (a) 单独跑 (42, RNB, 16) → baseline
 *   (b) 在同一进程内先跑 (42, JAZZ, 24) 再跑 (42, RNB, 16) → polluted
 *
 * 然后 dump 两侧 Engine instance 的所有 instance fields 在 RNB 16 调用开始前的状态,
 * 看看到底什么不一样。
 */

import {
    Engine as MgEngine,
    Random as MgRandom,
} from '../../melodygenerative/src/lib/musicEngine';

function snapshot(obj: any): Record<string, any> {
    const out: Record<string, any> = {};
    for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v === null || v === undefined) { out[k] = v; continue; }
        if (typeof v === 'function') continue;
        if (typeof v === 'object') {
            try {
                out[k] = `[obj:${Array.isArray(v) ? 'array' : 'object'} keys=${Object.keys(v).length} stringSample=${JSON.stringify(v).slice(0, 80)}]`;
            } catch {
                out[k] = '[unserializable]';
            }
        } else {
            out[k] = v;
        }
    }
    return out;
}

function runCase(seed: string, style: string, bars: number, label: string): number {
    const cfg: any = { seed: `${seed}::harmony`, style, key: 'C', mode: 'Major', emotion: 'auto', barsOverride: bars };
    const eng = new MgEngine(new MgRandom(cfg.seed));

    console.log(`\n--- [${label}] Engine instance state BEFORE call ---`);
    const snap = snapshot(eng);
    for (const [k, v] of Object.entries(snap)) {
        if (k === 'random') continue;
        console.log(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }

    const chords = eng.generateProgressions(cfg);
    const events = eng.generateArrangement(chords, cfg).events;

    console.log(`\n--- [${label}] Engine instance state AFTER call ---`);
    const snap2 = snapshot(eng);
    for (const [k, v] of Object.entries(snap2)) {
        if (k === 'random') continue;
        console.log(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }

    console.log(`\n--- [${label}] Result: chords=${chords.length} events=${events.length} ---`);
    return events.length;
}

console.log('====================================================');
console.log(' (A) 单独跑 RNB 16 (baseline)');
console.log('====================================================');
const baseline = runCase('42', 'RNB', 16, 'baseline');

console.log('\n\n====================================================');
console.log(' (B) 同进程先跑 JAZZ 24,再跑 RNB 16');
console.log('====================================================');
console.log('\n>>> Step B-1: run JAZZ 24 (polluter)');
runCase('42', 'JAZZ', 24, 'polluter-jazz24');

console.log('\n>>> Step B-2: run RNB 16 (victim)');
const polluted = runCase('42', 'RNB', 16, 'polluted');

console.log('\n\n====================================================');
console.log(' 结论');
console.log('====================================================');
console.log(`baseline  RNB 16: ${baseline} events`);
console.log(`polluted  RNB 16: ${polluted} events`);
console.log(baseline === polluted ? 'NO POLLUTION (?!)' : `POLLUTION: ${baseline - polluted} events vanished`);
