// ============================================================
// Phase 1 对照 harness — 音高地基 + 和弦实现
// 跑法:npx tsx src/core/generation/improCore/engine/__harness__/phase1-chord.ts
// ============================================================
//
// 期望值来源:My.voc 权威定义(手工推导)+ NoteSymbol.transpose 算法
//   (移调后 MIDI = 原 MIDI + rise;A 的 rise = +9)。
// 不依赖 Vite —— 用 fs 读 My.voc + setActiveVocab 注入,纯 Node 可跑。
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { makeNoteSymbol, PITCH_CLASSES } from '../pitch';
import { parseVocab, setActiveVocab } from '../vocab';
import { Chord } from '../chord';

const here = dirname(fileURLToPath(import.meta.url));
setActiveVocab(parseVocab(readFileSync(join(here, '../vocab/My.voc'), 'utf8')));

let pass = 0, fail = 0;
function eq(label: string, got: unknown, want: unknown): void {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}\n      got  ${g}\n      want ${w}`); }
}

const spellMidi = (name: string) => Chord.makeChord(name)!.getSpellMIDIarray();
const colorMidi = (name: string) => Chord.makeChord(name)!.getColorMIDIarray();
const prioMidi  = (name: string) => Chord.makeChord(name)!.getPriorityMIDIarray();
const spellNames = (name: string) =>
    Chord.makeChord(name)!.getSpell().map(ns => PITCH_CLASSES[ns.pcIndex!]!.name);

console.log('— 音高基元(NoteSymbol)—');
eq('c8  → MIDI 60', makeNoteSymbol('c8')!.getMIDI(), 60);
eq('f#8 → MIDI 66', makeNoteSymbol('f#8')!.getMIDI(), 66);
eq('c+8 → MIDI 72', makeNoteSymbol('c+8')!.getMIDI(), 72);
eq('e-8 → MIDI 52', makeNoteSymbol('e-8')!.getMIDI(), 52);
eq('bb8 → MIDI 70', makeNoteSymbol('bb8')!.getMIDI(), 70);
eq('eb8 → MIDI 63', makeNoteSymbol('eb8')!.getMIDI(), 63);
eq('r4  → isRest', makeNoteSymbol('r4')!.isRest(), true);
eq('c8 transpose +9 → 69', makeNoteSymbol('c8')!.transpose(9).getMIDI(), 69);
eq('e8 transpose +9 → 73', makeNoteSymbol('e8')!.transpose(9).getMIDI(), 73);

console.log('\n— CM7(root C,rise 0)—');
eq('CM7 spell',    spellMidi('CM7'), [60, 64, 67, 71]);
eq('CM7 color',    colorMidi('CM7'), [62, 69, 66]);
eq('CM7 priority', prioMidi('CM7'),  [71, 64, 67, 60]);

console.log('\n— Cm7 / C7 —');
eq('Cm7 spell',    spellMidi('Cm7'), [60, 63, 67, 70]);
eq('Cm7 priority', prioMidi('Cm7'),  [63, 70, 67, 60]);
eq('C7 spell',     spellMidi('C7'),  [60, 64, 67, 70]);
eq('C7 priority',  prioMidi('C7'),   [70, 64, 67, 60]);

console.log('\n— Amaj7(= Cmaj7→CM7,rise +9)—');
eq('Amaj7 spell',     spellMidi('Amaj7'),  [69, 73, 76, 80]);
eq('Amaj7 color',     colorMidi('Amaj7'),  [71, 78, 75]);
eq('Amaj7 priority',  prioMidi('Amaj7'),   [80, 73, 76, 69]);
eq('Amaj7 spell 拼写', spellNames('Amaj7'), ['a', 'c#', 'e', 'g#']);

console.log('\n— 其它移调抽查 —');
eq('Dm7 spell (升号侧 rise +2)', spellMidi('Dm7'), [62, 65, 69, 72]);
eq('G7 spell  (升号侧 rise +7)', spellMidi('G7'),  [67, 71, 74, 77]);
eq('BbM7 spell (降号侧 rise -2)', spellMidi('BbM7'), [58, 62, 65, 69]);
eq('FM7 spell  (降号侧 rise -7)', spellMidi('FM7'), [53, 57, 60, 64]);
eq('NC isNOCHORD', Chord.makeChord('NC')!.isNOCHORD(), true);
eq('非法和弦 → null', Chord.makeChord('Zxyz'), null);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
