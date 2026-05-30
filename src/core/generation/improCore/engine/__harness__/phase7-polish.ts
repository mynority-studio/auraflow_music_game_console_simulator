// ============================================================
// Phase 7 对照 harness — 打磨(swing / 双手 voicing / 奇数拍兜底)
// 跑法:npx tsx src/core/generation/improCore/engine/__harness__/phase7-polish.ts
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseVocab, setActiveVocab } from '../vocab';
import { Chord } from '../chord';
import { ChordPart } from '../chordpart';
import { parseStyle } from '../style';
import { renderComping } from '../comp';
import { generateVoicing } from '../voicing';
import { applySwing } from '../swing';
import { CMIDI } from '../constants';
import type { SlotNote } from '../lickgen';

const here = dirname(fileURLToPath(import.meta.url));
setActiveVocab(parseVocab(readFileSync(join(here, '../vocab/My.voc'), 'utf8')));

let pass = 0, fail = 0;
const ok = (l: string, c: boolean, d = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? '\n      ' + d : ''}`); } };

// ------------------------------------------------------------
// (1) swing
// ------------------------------------------------------------
console.log('— swing —');
{
    const pair: SlotNote[] = [
        { pitch: 60, startSlot: 0, durationSlots: 60 },
        { pitch: 62, startSlot: 60, durationSlots: 60 },
    ];
    const straight = applySwing(pair, 0.5);
    ok('ratio 0.5 → 原样', straight[1]!.startSlot === 60 && straight[0]!.durationSlots === 60);

    const swung = applySwing(pair, 0.67);
    ok('ratio 0.67 → off-beat 八分后移(60→80)', swung[1]!.startSlot === 80, `start=${swung[1]!.startSlot}`);
    ok('on-beat 八分变长(60→80)', swung[0]!.durationSlots === 80, `dur=${swung[0]!.durationSlots}`);
    ok('off-beat 八分变短(→40)', swung[1]!.durationSlots === 40, `dur=${swung[1]!.durationSlots}`);
    // 拍边界不动:slot 0 和 120 保持
    const onBeat = applySwing([{ pitch: 60, startSlot: 120, durationSlots: 120 }], 0.67);
    ok('拍边界(120)不动', onBeat[0]!.startSlot === 120);
}

// ------------------------------------------------------------
// (2) 双手 voicing
// ------------------------------------------------------------
console.log('\n— 双手 voicing —');
{
    const c = Chord.makeChord('CM7')!;
    let bothHands = 0, n = 0;
    for (let i = 0; i < 50; i++) {
        const v = generateVoicing({
            priority: c.getPriorityMIDIarray(), color: c.getColorMIDIarray(), rootMidi: c.getRootSemitones() + CMIDI,
            low: 48, high: 60, numNotes: 2, rightLow: 60, rightHigh: 72, numNotesRight: 2, previousVoicing: null,
        });
        if (v.length > 0) n++;
        const hasLow = v.some(p => p <= 60), hasHigh = v.some(p => p >= 60);
        if (hasLow && hasHigh) bothHands++;
    }
    ok('双手 voicing 非空', n === 50);
    ok('多数 voicing 跨两手音域(≥80%)', bothHands / 50 >= 0.8, `${bothHands}/50`);
}

// ------------------------------------------------------------
// (3) 奇数拍兜底:11-4 style 现在能产出 comping
// ------------------------------------------------------------
console.log('\n— 奇数拍兜底(11-4)—');
{
    const style = parseStyle(readFileSync(join(here, '../styles/11-4.sty'), 'utf8'));
    const cp = ChordPart.fromTokens(['CM7', 'Am7']);
    const comp = renderComping(cp, style);
    ok('11-4 现在有 bass 输出', comp.bass.length > 0, `bass=${comp.bass.length}`);
    ok('11-4 现在有 drum 输出(兜底取最短 pattern)', comp.drums.length > 0, `drums=${comp.drums.length}`);
    ok('所有音裁在 bar 内', [...comp.bass, ...comp.chords, ...comp.drums].every(nn => nn.startSlot + nn.durationSlots <= cp.getTotalSlots() + 1));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
