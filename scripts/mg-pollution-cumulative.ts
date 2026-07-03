/**
 * 测试污染是否累积:把 polluter 多次重复跑,然后跑 victim,看 victim 何时跌
 */

import {
    Engine as MgEngine,
    Random as MgRandom,
} from '../../melodygenerative/src/lib/musicEngine';

function runCase(seed: string, style: string, bars: number): number {
    const cfg: any = { seed: `${seed}::harmony`, style, key: 'C', mode: 'Major', emotion: 'auto', barsOverride: bars };
    const eng = new MgEngine(new MgRandom(cfg.seed));
    const chords = eng.generateProgressions(cfg);
    const events = eng.generateArrangement(chords, cfg).events;
    return events.length;
}

console.log('=== Pollution cumulative test: N polluters then RNB 16 ===\n');

const POLLUTER: [string, string, number] = ['42', 'JAZZ', 24];
const VICTIM: [string, string, number] = ['42', 'RNB', 16];

for (const N of [0, 1, 2, 3, 5, 10, 20, 50]) {
    // Fresh process not possible from within — simulate by NOT carrying state, but we ARE carrying state
    // Each iteration runs N polluters then 1 victim
    for (let i = 0; i < N; i++) runCase(...POLLUTER);
    const v = runCase(...VICTIM);
    console.log(`After ${String(N).padStart(2)} polluter calls: RNB 16 = ${v} events`);
}

console.log('\n=== 反向:N RNB 16 自己重复(self-warmup),看是否稳定 ===\n');

for (let i = 0; i < 5; i++) {
    const v = runCase(...VICTIM);
    console.log(`RNB 16 iter ${i+1}: ${v} events`);
}

console.log('\n=== 不同 polluter 类型对比 ===\n');

// 重置状态不可能,但可以看在已污染状态下不同 polluter 后的差异
const TESTS: Array<[string, [string, string, number]]> = [
    ['POP 16', ['42', 'POP', 16]],
    ['POP 24', ['42', 'POP', 24]],
    ['JAZZ 16', ['42', 'JAZZ', 16]],
    ['JAZZ 24', ['42', 'JAZZ', 24]],
    ['RNB 24', ['42', 'RNB', 24]],
    ['POP 16', ['42', 'POP', 16]],  // 看是否回退
];

for (const [label, cfg] of TESTS) {
    runCase(...cfg);
    const v = runCase(...VICTIM);
    console.log(`After ${label}: RNB 16 = ${v}`);
}
