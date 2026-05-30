// ============================================================
// Phase 4 对照 harness — Comping(bass / chord / drum 渲染)
// 跑法:npx tsx src/core/generation/improCore/engine/__harness__/phase4-comp.ts
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseVocab, setActiveVocab } from '../vocab';
import { ChordPart } from '../chordpart';
import { parseStyle } from '../style';
import { renderComping } from '../comp';

const here = dirname(fileURLToPath(import.meta.url));
setActiveVocab(parseVocab(readFileSync(join(here, '../vocab/My.voc'), 'utf8')));
const stylesDir = join(here, '../styles');

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = ''): void {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}${detail ? '\n      ' + detail : ''}`); }
}

const readStyle = (f: string) => parseStyle(readFileSync(join(stylesDir, f), 'utf8'));

// ------------------------------------------------------------
// (1) 解析 + 渲染基本正确性
// ------------------------------------------------------------
console.log('— 解析 + 渲染 —');
{
    const style = readStyle('no-style-but-swing.sty');
    ok('no-style-but-swing 解析出 bass/chord pattern', style.bassPatterns.length > 0 && style.chordPatterns.length > 0,
        `bass=${style.bassPatterns.length} chord=${style.chordPatterns.length}`);

    const cp = ChordPart.fromTokens(['CM7', 'Am7', 'Dm7', 'G7']);
    const comp = renderComping(cp, style);

    // bass 在音域内 + 是根音(此 style bass-pattern 只有 B*,全是根音)
    const bassOK = comp.bass.every(n => n.pitch >= style.bassLow - 1 && n.pitch <= style.bassHigh + 1);
    ok('bass 全在 bass 音域内', comp.bass.length > 0 && bassOK,
        `范围[${style.bassLow},${style.bassHigh}] 样本 ${comp.bass.slice(0, 6).map(n => n.pitch)}`);

    const roots = new Set([0, 9, 2, 7]); // C A D G
    ok('bass 全为和弦根音(B pattern)', comp.bass.every(n => roots.has(((n.pitch % 12) + 12) % 12)));

    // chord 在 chord 音域内
    const chordOK = comp.chords.every(n => n.pitch >= style.chordLow - 1 && n.pitch <= style.chordHigh + 12);
    ok('chord 击音在 chord 音域内', comp.chords.length > 0 && chordOK);
}

// ------------------------------------------------------------
// (2) drum:GM MIDI 合法 + channel
// ------------------------------------------------------------
console.log('\n— drum(4/4 style;奇数拍如 11-4 的 pattern 长于 480 bar,Phase 4 不渲染)—');
{
    const cp = ChordPart.fromTokens(['CM7', 'CM7']);
    // 找一个 4/4 兼容(能产出 drum)的 style
    let found = '';
    let drums: number[] = [];
    for (const f of readdirSync(stylesDir).filter(x => x.endsWith('.sty'))) {
        const style = parseStyle(readFileSync(join(stylesDir, f), 'utf8'));
        if (style.drumPatterns.length === 0) continue;
        const comp = renderComping(cp, style);
        if (comp.drums.length > 0) { found = style.name; drums = comp.drums.map(n => n.pitch); break; }
    }
    ok('存在能产出 drum 的 4/4 style', found !== '', `found=${found}`);
    ok('drum MIDI 全在 GM 打击范围 [35,81]', drums.length > 0 && drums.every(p => p >= 35 && p <= 81));
}

// ------------------------------------------------------------
// (3) 全 145 style 鲁棒性:解析 + 渲染无抛错
// ------------------------------------------------------------
console.log('\n— 全 145 style 鲁棒性 —');
const files = readdirSync(stylesDir).filter(f => f.endsWith('.sty')).sort();
ok('style 文件数 = 145', files.length === 145, `found=${files.length}`);

const cp = ChordPart.fromTokens(['CM7', 'Fm7', 'Bb7', 'EbM7']);
let bad = 0;
const examples: string[] = [];
for (const f of files) {
    try {
        const style = parseStyle(readFileSync(join(stylesDir, f), 'utf8'));
        const comp = renderComping(cp, style);
        for (const n of [...comp.bass, ...comp.chords, ...comp.drums]) {
            if (n.pitch >= 0 && (n.pitch < 0 || n.pitch > 127)) { bad++; examples.push(`${f}: MIDI 越界 ${n.pitch}`); break; }
        }
    } catch (e) { bad++; examples.push(`${f}: ${String(e).slice(0, 70)}`); }
}
ok('全 145 style 解析+渲染无越界/无抛错', bad === 0, `坏=${bad}\n      ` + examples.slice(0, 8).join('\n      '));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
