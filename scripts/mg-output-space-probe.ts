/**
 * 实测 mg 输出空间到底是 RELATIVE 还是 ABSOLUTE。
 *
 * 关键问题:HarmonyEngine facade 强制传 key='C',注释说让 mg "RELATIVE 空间(C 调)输出"。
 * 但 mg 内部 BASS_RANGE/MELODY_RANGE 都是 standard MIDI 绝对编号(C4=60)。
 *
 * 实测方法:
 *   1. 跑 mg key='C' 一次:看 bassMidi / noteNumber 真实范围
 *   2. 跑 mg key='G' 一次:看 bassMidi / noteNumber 是否上移了 7 半音
 *
 * 期望:
 *   如果 mg 是 ABSOLUTE (with key respect):key='G' 跑出来音域应该高 7 半音
 *   如果 mg 是 RELATIVE (永远 C 输出):key='G' 跑出来跟 key='C' 一模一样
 */

import {
    Engine as MgEngine,
    Random as MgRandom,
} from '../../melodygenerative/src/lib/musicEngine';

function run(key: string) {
    const cfg: any = { seed: '42::harmony', style: 'POP', key, mode: 'Major', emotion: 'auto' };
    const eng = new MgEngine(new MgRandom(cfg.seed));
    const chords = eng.generateProgressions(cfg);
    const timeline = eng.generateArrangement(chords, cfg);

    const bassMidis = chords.map(c => c.bassMidi);
    const bassPCs = chords.map(c => ((c.bassMidi % 12) + 12) % 12);
    const roots = chords.map(c => c.root);
    const bassNames = chords.map(c => c.bass);

    const melodyEvents = timeline.events.filter(e => e.part === 'melody');
    const melodyMidis = melodyEvents.map(e => e.noteNumber);
    const bassEvents = timeline.events.filter(e => e.part === 'bass');
    const bassNoteMidis = bassEvents.map(e => e.noteNumber);
    const chordEvents = timeline.events.filter(e => e.part === 'chord');
    const chordMidis = chordEvents.map(e => e.noteNumber);

    return {
        key,
        chord_roots: roots.slice(0, 6),
        chord_bass_names: bassNames.slice(0, 6),
        chord_bassMidi: bassMidis.slice(0, 6),
        chord_bassPC: bassPCs.slice(0, 6),
        melody_midi_min: Math.min(...melodyMidis),
        melody_midi_max: Math.max(...melodyMidis),
        melody_midi_avg: Math.round(melodyMidis.reduce((a, b) => a + b, 0) / melodyMidis.length),
        bass_event_midi_min: Math.min(...bassNoteMidis),
        bass_event_midi_max: Math.max(...bassNoteMidis),
        chord_event_midi_min: Math.min(...chordMidis),
        chord_event_midi_max: Math.max(...chordMidis),
    };
}

console.log('=== mg POP key=C ===');
const c = run('C');
console.log(JSON.stringify(c, null, 2));

console.log('\n=== mg POP key=G ===');
const g = run('G');
console.log(JSON.stringify(g, null, 2));

console.log('\n=== mg POP key=Eb ===');
const eb = run('Eb');
console.log(JSON.stringify(eb, null, 2));

console.log('\n\n=== 判定 ===');
const shiftCG = c.melody_midi_avg - g.melody_midi_avg;
const shiftCEb = c.melody_midi_avg - eb.melody_midi_avg;
console.log(`melody avg shift C→G: ${-shiftCG} semitones (expected if absolute: ~+7 or -5)`);
console.log(`melody avg shift C→Eb: ${-shiftCEb} semitones (expected if absolute: ~+3 or -9)`);
console.log(`bass midi shift C→G: ${g.bass_event_midi_min - c.bass_event_midi_min} (min) / ${g.bass_event_midi_max - c.bass_event_midi_max} (max)`);

if (Math.abs(shiftCG) < 1 && Math.abs(shiftCEb) < 1) {
    console.log('\n>>> mg 输出是 RELATIVE — 同样 chord 进行,不同 key 出来音高一致 <<<');
} else {
    console.log('\n>>> mg 输出是 ABSOLUTE(key-aware)— 不同 key 出不同音高 <<<');
}
