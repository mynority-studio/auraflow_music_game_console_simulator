// ============================================================
// Phase 5 对照 harness — VoicingGenerator
// 跑法:npx tsx src/core/generation/improCore/engine/__harness__/phase5-voicing.ts
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseVocab, setActiveVocab } from '../vocab';
import { Chord } from '../chord';
import { ChordPart } from '../chordpart';
import { parseStyle } from '../style';
import { renderComping } from '../comp';
import { generateVoicing } from '../voicing';
import { CMIDI } from '../constants';

const here = dirname(fileURLToPath(import.meta.url));
setActiveVocab(parseVocab(readFileSync(join(here, '../vocab/My.voc'), 'utf8')));

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = ''): void {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}${detail ? '\n      ' + detail : ''}`); }
}

const voiceCM7 = (low: number, high: number, prev: number[] | null = null) => {
    const c = Chord.makeChord('CM7')!;
    return generateVoicing({
        priority: c.getPriorityMIDIarray(), color: c.getColorMIDIarray(),
        rootMidi: c.getRootSemitones() + CMIDI, low, high, numNotes: 4, previousVoicing: prev,
    });
};

// ------------------------------------------------------------
// (1) rootless voicing 正确性(×100)
// ------------------------------------------------------------
console.log('— voicing 正确性(CM7 rootless,音域 48-72)—');
{
    const allowedPC = new Set([11, 4, 7, 2, 9, 6]); // B E G + D A F#(去掉 root C=0)
    let inRange = true, noRoot = true, validPC = true, noM9 = true, nonEmpty = true;
    for (let i = 0; i < 100; i++) {
        const v = voiceCM7(48, 72);
        if (v.length === 0) { nonEmpty = false; continue; }
        for (const n of v) {
            if (n < 48 || n > 72) inRange = false;
            const pc = ((n % 12) + 12) % 12;
            if (pc === 0) noRoot = false;
            if (!allowedPC.has(pc)) validPC = false;
        }
        for (let a = 0; a < v.length; a++) for (let b = a + 1; b < v.length; b++) if (v[b]! - v[a]! === 13) noM9 = false;
    }
    ok('非空', nonEmpty);
    ok('全在音域 [48,72]', inRange);
    ok('rootless:无根音 C', noRoot);
    ok('全为 CM7 和弦/色彩音', validPC);
    ok('无小九度(invertM9 后)', noM9);
}

// ------------------------------------------------------------
// (2) voice leading:传 prev 后音的动量应小于不传 prev
// ------------------------------------------------------------
console.log('\n— voice leading(prev 偏置降低动量)—');
{
    const motion = (from: number[], to: number[]) =>
        to.reduce((s, n) => s + Math.min(...from.map(p => Math.abs(p - n))), 0) / Math.max(1, to.length);

    const N = 200;
    let withPrev = 0, withoutPrev = 0;
    for (let i = 0; i < N; i++) {
        const v1 = voiceCM7(48, 72);
        const v2p = voiceCM7(48, 72, v1);          // 传 prev
        const v2r = voiceCM7(48, 72, null);        // 不传
        if (v1.length && v2p.length) withPrev += motion(v1, v2p);
        if (v1.length && v2r.length) withoutPrev += motion(v1, v2r);
    }
    withPrev /= N; withoutPrev /= N;
    ok('传 prev 的平均动量 < 不传', withPrev < withoutPrev, `withPrev=${withPrev.toFixed(2)} withoutPrev=${withoutPrev.toFixed(2)}`);
}

// ------------------------------------------------------------
// (3) 全 145 style comping(含新 voicing)鲁棒性
// ------------------------------------------------------------
console.log('\n— 全 145 style comping(新 voicing)鲁棒性 —');
{
    const stylesDir = join(here, '../styles');
    const files = readdirSync(stylesDir).filter(f => f.endsWith('.sty'));
    const cp = ChordPart.fromTokens(['CM7', 'Fm7', 'Bb7', 'EbM7']);
    let bad = 0; const ex: string[] = [];
    for (const f of files) {
        try {
            const comp = renderComping(cp, parseStyle(readFileSync(join(stylesDir, f), 'utf8')));
            for (const n of comp.chords) if (n.pitch < 0 || n.pitch > 127) { bad++; ex.push(`${f}: ${n.pitch}`); break; }
        } catch (e) { bad++; ex.push(`${f}: ${String(e).slice(0, 60)}`); }
    }
    ok('全 145 style 新 voicing 渲染无越界/无错', bad === 0, ex.slice(0, 6).join('\n      '));
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
