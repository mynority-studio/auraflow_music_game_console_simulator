/**
 * 定位污染发生点 — 在 polluted 状态下,跑 (42, RNB, 16),逐事件对比 clean run。
 *
 * clean run = 单独 new Random + new Engine 跑这一个 case
 * polluted run = 先跑 (42, JAZZ, 24) 再跑 (42, RNB, 16)
 *
 * 期望:某个 event idx N,clean 有 / polluted 没有(或反之)
 */

import {
    Engine as MgEngine,
    Random as MgRandom,
    type NoteEvent as MgNoteEvent,
} from '../../melodygenerative/src/lib/musicEngine';

function runRnb(): MgNoteEvent[] {
    const cfg: any = { seed: '42::harmony', style: 'RNB', key: 'C', mode: 'Major', emotion: 'auto' };
    const eng = new MgEngine(new MgRandom('42::harmony'));
    const chords = eng.generateProgressions(cfg);
    return eng.generateArrangement(chords, cfg).events;
}

function runJazz24() {
    const cfg: any = { seed: '42::harmony', style: 'JAZZ', key: 'C', mode: 'Major', emotion: 'auto', barsOverride: 24 };
    const eng = new MgEngine(new MgRandom('42::harmony'));
    const chords = eng.generateProgressions(cfg);
    return eng.generateArrangement(chords, cfg).events;
}

function evSig(e: MgNoteEvent): string {
    return `${e.part.padEnd(6)} n=${String(e.noteNumber).padStart(3)} t=${e.time.toFixed(6).padStart(10)} d=${e.duration.toFixed(6).padStart(9)} v=${String(e.velocity).padStart(3)}`;
}

console.log('=== Clean run (RNB, 16) ===');
const cleanEvents = runRnb();
console.log(`Events: ${cleanEvents.length}`);

console.log('\n=== Polluted run: JAZZ 24 → RNB 16 ===');
runJazz24();
const pollutedEvents = runRnb();
console.log(`Events: ${pollutedEvents.length}`);

console.log('\n=== 逐事件对比 ===');
const minLen = Math.min(cleanEvents.length, pollutedEvents.length);
let firstDivergence = -1;
for (let i = 0; i < minLen; i++) {
    if (evSig(cleanEvents[i]) !== evSig(pollutedEvents[i])) {
        firstDivergence = i;
        break;
    }
}

if (firstDivergence === -1) {
    console.log(`前 ${minLen} 个 event bit-exact 一致。`);
    if (cleanEvents.length !== pollutedEvents.length) {
        const longer = cleanEvents.length > pollutedEvents.length ? 'clean' : 'polluted';
        const arr = cleanEvents.length > pollutedEvents.length ? cleanEvents : pollutedEvents;
        console.log(`\n但 ${longer} 多 ${Math.abs(cleanEvents.length - pollutedEvents.length)} 个 event:`);
        for (let i = minLen; i < arr.length; i++) {
            console.log(`  [${i}] ${evSig(arr[i])}`);
        }
    }
} else {
    console.log(`\n首次发散 @ idx=${firstDivergence}:`);
    console.log(`  clean    : ${evSig(cleanEvents[firstDivergence])}`);
    console.log(`  polluted : ${evSig(pollutedEvents[firstDivergence])}`);

    console.log('\n附近 5 个 event 对照:');
    const start = Math.max(0, firstDivergence - 2);
    const end = Math.min(minLen, firstDivergence + 5);
    for (let i = start; i < end; i++) {
        const marker = i === firstDivergence ? '★' : ' ';
        console.log(`  ${marker} [${String(i).padStart(4)}] clean    : ${evSig(cleanEvents[i])}`);
        console.log(`  ${marker}        polluted : ${evSig(pollutedEvents[i])}`);
    }
}

// 还要看 chords 是否在 polluted 时也变了
const cleanChords = (() => {
    const cfg: any = { seed: '42::harmony', style: 'RNB', key: 'C', mode: 'Major', emotion: 'auto' };
    const eng = new MgEngine(new MgRandom('42::harmony'));
    return eng.generateProgressions(cfg);
})();
runJazz24();
const pollutedChords = (() => {
    const cfg: any = { seed: '42::harmony', style: 'RNB', key: 'C', mode: 'Major', emotion: 'auto' };
    const eng = new MgEngine(new MgRandom('42::harmony'));
    return eng.generateProgressions(cfg);
})();

console.log('\n=== Chord progression 对比 ===');
let chordDiff = false;
for (let i = 0; i < Math.min(cleanChords.length, pollutedChords.length); i++) {
    const cs = `${cleanChords[i].roman}|${cleanChords[i].chordSymbol}|${cleanChords[i].notesMidi?.join(',')}`;
    const ps = `${pollutedChords[i].roman}|${pollutedChords[i].chordSymbol}|${pollutedChords[i].notesMidi?.join(',')}`;
    if (cs !== ps) {
        chordDiff = true;
        console.log(`  [${i}] clean    : ${cs}`);
        console.log(`        polluted : ${ps}`);
    }
}
if (!chordDiff) console.log('  Chord progression bit-exact 一致 (chord 层无污染)');
