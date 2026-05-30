// chordpart-leadsheet.ts — 验证 ChordPart.fromText 的 leadsheet 语法(| 分小节 / 重复)
//   + SmartGen 经过和弦不再被错误拆成整 bar。
//   跑:npx tsx src/core/generation/improCore/engine/__harness__/chordpart-leadsheet.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseVocab, setActiveVocab, parseScales, setActiveScales } from '../vocab';
import { ChordPart } from '../chordpart';
import { Engine, Random } from '../../../mgEngine/musicEngine';
import { STYLE_DICTIONARY } from '../../../mgEngine/styleDictionary';

const here = dirname(fileURLToPath(import.meta.url));
const vocText = readFileSync(join(here, '../vocab/My.voc'), 'utf8');
setActiveVocab(parseVocab(vocText));
setActiveScales(parseScales(vocText));

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
    ok ? pass++ : fail++;
};
const BAR = 480, BEAT = 120;

// ── 1) 向后兼容:无 | 时每和弦一 bar(旧行为)──────────────
{
    const cp = ChordPart.fromText('CM7 Am7 Dm7 G7');
    const s = cp.getSpans();
    check('无 | → 每和弦一 bar', s.length === 4 && cp.getTotalSlots() === 4 * BAR,
        `${s.length} span / ${cp.getTotalSlots()} slot`);
    check('无 | → 各 span 480 slot', s.every(x => x.end - x.start === BAR));
}

// ── 2) | 分小节:小节内两和弦各半 bar(经过和弦)──────────
{
    const cp = ChordPart.fromText('Dm7 G7 | CM7 | Am7 D7');
    const s = cp.getSpans();
    check('| 分小节 → 3 bar 5 和弦', s.length === 5 && cp.getTotalSlots() === 3 * BAR,
        `${s.length} span / ${cp.getTotalSlots() / BAR} bar`);
    check('小节内两和弦各 2 拍', s[0]!.end - s[0]!.start === 2 * BEAT && s[1]!.end - s[1]!.start === 2 * BEAT);
    check('独占小节 = 整 bar', s[2]!.end - s[2]!.start === BAR);
    check('span 无缝衔接', s.every((x, i) => i === 0 || x.start === s[i - 1]!.end));
}

// ── 3) / 重复上一个和弦 ────────────────────────────────
{
    const cp = ChordPart.fromText('F7 | / | BbM7');
    const s = cp.getSpans();
    check('/ 重复 → 3 span', s.length === 3, `${s.length} span`);
    check('/ 段和弦 = 前一和弦 F7', s[1]!.chord.getName() === s[0]!.chord.getName(),
        `${s[1]?.chord.getName()}`);
    check('/ 段占满整 bar', s[1]!.end - s[1]!.start === BAR);
}

// ── 4) 小节内 4 和弦各 1 拍(Impro-Visor 的 "F9 / / Bb13" 形,需在 | 内)──────
{
    const cp = ChordPart.fromText('C7 / / Bb13 |');
    const s = cp.getSpans();
    const durs = s.map(x => x.end - x.start);
    check('一 bar 内 4 格平分 = 各 120 slot', durs.every(d => d === BEAT) && cp.getTotalSlots() === BAR,
        `[${durs.join(',')}]`);
    check('/ 在 bar 内重复 C7', s[1]!.chord.getName() === 'C7' && s[2]!.chord.getName() === 'C7');
}

// ── 5) 平分余数:3 和弦一 bar(480/3=160)──────────────
{
    const cp = ChordPart.fromText('C7 F7 G7');  // 无 | → 旧行为 3 bar
    check('无 | 的 3 和弦 = 3 bar(旧)', cp.getTotalSlots() === 3 * BAR);
    const cp2 = ChordPart.fromText('C7 F7 G7 |'); // 有 | → 一 bar 平分
    const d2 = cp2.getSpans().map(x => x.end - x.start);
    check('一 bar 内 3 和弦平分 = 480 总', d2.reduce((a, b) => a + b, 0) === BAR, `[${d2.join(',')}]`);
}

// ── 6) 端到端:SmartGen 风格的经过和弦不再拆错 bar ────────
{
    // 复现 JAZZ:18 和弦含 2 拍经过和弦,应排成 16 bar(64 beats)
    const eng = new Engine(new Random('sg_JAZZ'));
    const chords = eng.generateProgressions({ seed: 'sg_JAZZ', style: 'JAZZ' as keyof typeof STYLE_DICTIONARY, key: 'C', emotion: 'auto' } as never) as { root: string; type: string; duration: number }[];
    const totalBeats = chords.reduce((a, c) => a + c.duration, 0);
    // 模拟 smartGen 的 toLeadsheet
    const MAP: Record<string, string> = { maj: '', min: 'm', min7: 'm7', dom7: '7' };
    const bars: string[][] = []; let cur: string[] = []; let acc = 0;
    for (const c of chords) { cur.push(c.root + (MAP[c.type] ?? c.type.replace('/', ''))); acc += c.duration; if (acc >= 4) { bars.push(cur); cur = []; acc = 0; } }
    const text = bars.map(b => b.join(' ')).join(' | ');
    const cp = ChordPart.fromText(text);
    check('JAZZ 经过和弦 → bar 数 = 总拍/4(非和弦数)',
        cp.getTotalSlots() / BAR === totalBeats / 4 && chords.length > totalBeats / 4,
        `${chords.length}和弦 → ${cp.getTotalSlots() / BAR}bar (总${totalBeats}拍)`);
    check('JAZZ 全程每 bar 恰好 480 slot 对齐', cp.getTotalSlots() % BAR === 0);
}

console.log(`\n${fail === 0 ? '🟢 全绿' : '🔴 有失败'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
