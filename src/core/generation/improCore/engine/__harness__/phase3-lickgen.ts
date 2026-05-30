// ============================================================
// Phase 3 对照 harness — LickGen(抽象旋律 → 具体音高)
// 跑法:npx tsx src/core/generation/improCore/engine/__harness__/phase3-lickgen.ts
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseVocab, setActiveVocab } from '../vocab';
import { Grammar, type GrammarChordContext } from '../grammar';
import { ChordPart } from '../chordpart';
import { realize, DEFAULT_PARAMS, type LickGenParams } from '../lickgen';
import { getDurationAbstractMelody } from '../terminals';

const here = dirname(fileURLToPath(import.meta.url));
setActiveVocab(parseVocab(readFileSync(join(here, '../vocab/My.voc'), 'utf8')));
const grammarsDir = join(here, '../../data/grammars');

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = ''): void {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}${detail ? '\n      ' + detail : ''}`); }
}

const ctxOf = (cp: ChordPart): GrammarChordContext => ({
    familyAtSlot: (slot) => cp.getCurrentChord(slot)?.getFamily() ?? null,
    brickNameAtSlot: () => null,
});

// ------------------------------------------------------------
// (1) 确定性 scaleDegree:(X 1 8)(X 3 8)(X 5 8) over CM7 → [60,64,67]
// ------------------------------------------------------------
console.log('— 确定性 scaleDegree —');
{
    const g = Grammar.fromText('(startsymbol P)\n(rule (P Y) ((X 1 8)(X 3 8)(X 5 8)(P (- Y 180))) 1.0)');
    const cp = ChordPart.fromTokens(['CM7']);
    const abstract = g.run(180);
    const notes = realize(abstract, cp).map(n => n.pitch);
    ok('CM7 度 1/3/5 → [60,64,67]', JSON.stringify(notes) === JSON.stringify([60, 64, 67]), `got ${JSON.stringify(notes)}`);

    const cpA = ChordPart.fromTokens(['Amaj7']);
    const notesA = realize(g.run(180), cpA).map(n => n.pitch);
    ok('Amaj7 度 1/3/5 → [69,73,76]', JSON.stringify(notesA) === JSON.stringify([69, 73, 76]), `got ${JSON.stringify(notesA)}`);

    // b3 / #4 测试
    const g2 = Grammar.fromText('(startsymbol P)\n(rule (P Y) ((X b3 8)(X #4 8)(P (- Y 120))) 1.0)');
    const notes2 = realize(g2.run(120), ChordPart.fromTokens(['CM7'])).map(n => n.pitch);
    ok('CM7 度 b3/#4 → [63,66]', JSON.stringify(notes2) === JSON.stringify([63, 66]), `got ${JSON.stringify(notes2)}`);
}

// ------------------------------------------------------------
// (2) chord-tone 约束:C8 over CM7 全是和弦音(mod12 ∈ {0,4,7,11})
// ------------------------------------------------------------
console.log('\n— chord-tone 约束 —');
{
    const g = Grammar.fromText('(startsymbol P)\n(rule (P Y) (C8 (P (- Y 60))) 1.0)');
    const cp = ChordPart.fromTokens(['CM7']);
    let allChordTones = true;
    const allowed = new Set([0, 4, 7, 11]); // CM7 = C E G B
    for (let i = 0; i < 20; i++) {
        const notes = realize(g.run(480), cp);
        for (const n of notes) if (n.pitch >= 0 && !allowed.has(((n.pitch % 12) + 12) % 12)) allChordTones = false;
    }
    ok('C8 over CM7 全为 CM7 和弦音(×20 次)', allChordTones);

    // L8 over CM7 全是 color 音(D A F# = 2,9,6)
    const gL = Grammar.fromText('(startsymbol P)\n(rule (P Y) (L8 (P (- Y 60))) 1.0)');
    let allColor = true;
    const colorPCs = new Set([2, 9, 6]);
    for (let i = 0; i < 20; i++) {
        for (const n of realize(gL.run(480), cp)) if (n.pitch >= 0 && !colorPCs.has(((n.pitch % 12) + 12) % 12)) allColor = false;
    }
    ok('L8 over CM7 全为 CM7 color 音', allColor);
}

// ------------------------------------------------------------
// (3) 全链路鲁棒性:多个真实 grammar × 多和弦 → 合法可发声音符
// ------------------------------------------------------------
console.log('\n— 全链路鲁棒性(grammar → realize → MIDI)—');
const sampleGrammars = ['ArtFarmer', 'BillEvans', 'CharlieParker', 'Bach', 'BluesyEricka', 'JohnColtrane', 'WayneShorter']
    .map(n => `${n}.grammar`)
    .filter(f => { try { readFileSync(join(grammarsDir, f)); return true; } catch { return false; } });

const chords = ['CM7', 'Am7', 'Dm7', 'G7'];
const cp = ChordPart.fromTokens(chords);
const SLOTS = cp.getTotalSlots(); // 4 bar
const params: LickGenParams = DEFAULT_PARAMS;

let bad = 0;
const examples: string[] = [];
for (const f of sampleGrammars) {
    try {
        const g = Grammar.fromText(readFileSync(join(grammarsDir, f), 'utf8'));
        for (let i = 0; i < 5; i++) {
            const abstract = g.run(SLOTS, ctxOf(cp));
            const notes = realize(abstract, cp, params);
            if (notes.length === 0) continue;
            for (const n of notes) {
                if (n.pitch >= 0 && (n.pitch < 0 || n.pitch > 127)) { bad++; examples.push(`${f}: MIDI 越界 ${n.pitch}`); break; }
            }
            // 抽象与具体总时长应一致
            if (getDurationAbstractMelody(abstract) !== notes.reduce((s, n) => s + n.durationSlots, 0)) {
                bad++; examples.push(`${f}: 时长不一致`); break;
            }
        }
    } catch (e) { bad++; examples.push(`${f}: 抛错 ${String(e).slice(0, 70)}`); }
}
ok(`${sampleGrammars.length} 个真实 grammar 全链路无越界/无错/时长一致`, bad === 0, examples.slice(0, 6).join('\n      '));

// 音域抽查:大部分音落在 [minPitch-12, maxPitch+12]
{
    const g = Grammar.fromText(readFileSync(join(grammarsDir, 'ArtFarmer.grammar'), 'utf8'));
    const notes = realize(g.run(SLOTS, ctxOf(cp)), cp, params).filter(n => n.pitch >= 0);
    const inRange = notes.filter(n => n.pitch >= params.minPitch - 12 && n.pitch <= params.maxPitch + 12).length;
    ok('ArtFarmer 音高 ≥90% 落在 [min-12,max+12]', notes.length === 0 || inRange / notes.length >= 0.9,
        `${inRange}/${notes.length}`);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
