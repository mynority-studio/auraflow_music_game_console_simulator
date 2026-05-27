// Diagnostic: scan multiple seeds to see mg's thinning variance
import { Engine, Random, type GenerationConfig } from '../src/core/generation/mgEngine/musicEngine';
import type { StyleName } from '../src/core/generation/mgEngine/styleDictionary';

const seeds = process.argv.length > 2
    ? process.argv.slice(2)
    : ['pop_42', 'pop_1', 'pop_7', 'pop_100', 'pop_999', 'pop_31415', 'pop_abc'];

const style: StyleName = 'POP';

console.log('seed         | bars | mel  | chord | bass | avg-chord-events/bar | rich-bars(>=4 ev)');
console.log('-------------+------+------+-------+------+----------------------+------------------');

for (const seed of seeds) {
    const config: GenerationConfig = { seed, style, key: 'C', emotion: 'auto' };
    const engine = new Engine(new Random(seed));
    const chords = engine.generateProgressions(config);
    const tl = engine.generateArrangement(chords, config);

    const ev = tl.events;
    const melCount = ev.filter(e => e.part === 'melody').length;
    const chCount = ev.filter(e => e.part === 'chord').length;
    const bsCount = ev.filter(e => e.part === 'bass').length;

    // Per-bar chord event distribution
    let chordStart = 0;
    let richBars = 0;
    for (const c of chords) {
        const cStart = chordStart;
        const cEnd = chordStart + c.duration;
        const inWin = ev.filter(e => e.part === 'chord' && e.time >= cStart && e.time < cEnd).length;
        if (inWin >= 4) richBars++;
        chordStart = cEnd;
    }
    const avg = (chCount / chords.length).toFixed(2);

    console.log(`${seed.padEnd(13)}|  ${String(chords.length).padStart(2)}  | ${String(melCount).padStart(4)} | ${String(chCount).padStart(5)} | ${String(bsCount).padStart(4)} | ${avg.padStart(20)} | ${richBars}/${chords.length}`);
}
