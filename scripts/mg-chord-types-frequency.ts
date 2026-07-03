/**
 * 统计 mg 实际输出的 chord types 频率,看 adapter 的简化映射风险有多大
 */

import { Engine as MgEngine, Random as MgRandom } from '../../melodygenerative/src/lib/musicEngine';

const TYPE_COUNT = new Map<string, number>();
const SEEDS = ['1', '2', '3', '42', '100', '7777', 'experiment', 'foo', 'bar', 'baz'];
const STYLES = ['POP', 'JAZZ', 'RNB', 'BLUES'];

for (const seed of SEEDS) {
    for (const style of STYLES) {
        try {
            const cfg: any = { seed: `${seed}::harmony`, style, key: 'C', mode: 'Major', emotion: 'auto' };
            const eng = new MgEngine(new MgRandom(cfg.seed));
            const chords = eng.generateProgressions(cfg);
            for (const c of chords) {
                TYPE_COUNT.set(c.type, (TYPE_COUNT.get(c.type) ?? 0) + 1);
            }
        } catch (e) {
            // skip
        }
    }
}

const sorted = [...TYPE_COUNT.entries()].sort((a, b) => b[1] - a[1]);
const total = [...TYPE_COUNT.values()].reduce((a, b) => a + b, 0);

console.log(`Total chords generated: ${total}`);
console.log(`Distinct types: ${TYPE_COUNT.size}\n`);
console.log('Frequency (sorted desc):');
for (const [type, count] of sorted) {
    const pct = (count / total * 100).toFixed(1);
    console.log(`  ${count.toString().padStart(4)}  ${pct.padStart(5)}%  "${type}"`);
}
