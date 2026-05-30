// ============================================================
// Phase 2 对照 harness — Grammar 展开引擎
// 跑法:npx tsx src/core/generation/improCore/engine/__harness__/phase2-grammar.ts
// ============================================================
//
// (1) 确定性 mini-grammar:验证栈式推导 + (- Y N) 算术 + 负参数终止 + 精确时长
// (2) 全 85 grammar 鲁棒性:每个跑多次,断言输出全是合法终结符且总时长 ≤ 请求
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Grammar } from '../grammar';
import { isTerminal, getDurationAbstractMelody, type GVal } from '../terminals';

const here = dirname(fileURLToPath(import.meta.url));
const grammarsDir = join(here, '../../data/grammars');

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = ''): void {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}${detail ? '\n      ' + detail : ''}`); }
}

// ------------------------------------------------------------
// (1) 确定性 mini-grammar
// ------------------------------------------------------------
console.log('— 确定性 mini-grammar —');
const mini = `
(startsymbol P)
(rule (P Y) ((BRICK 480) (P (- Y 480))) 1.0)
(rule (BRICK 480) (C8 C8 C8 C8 C8 C8 C8 C8) 1.0)
`;
{
    const g = Grammar.fromText(mini);
    const out = g.run(960); // 2 bar
    const allC8 = out.every(t => t === 'C8');
    ok('run(960) → 16 个 C8', out.length === 16 && allC8, `len=${out.length} out=${JSON.stringify(out.slice(0, 4))}…`);
    ok('总时长精确 960 slot', getDurationAbstractMelody(out) === 960, `dur=${getDurationAbstractMelody(out)}`);

    const out1 = g.run(480);
    ok('run(480) → 8 个 C8(单 bar)', out1.length === 8 && getDurationAbstractMelody(out1) === 480);
}

// mini with slope + scaleDegree(验证终结符识别 + getDuration)
console.log('\n— 终结符形式(slope / scaleDegree)—');
{
    const g = Grammar.fromText(`
(startsymbol P)
(rule (P Y) ((B 480) (P (- Y 480))) 1.0)
(rule (B 480) ((X 1 8)(slope 0 0 C8)(X 3 8) R8 (X 5 4)) 1.0)
`);
    const out = g.run(480);
    ok('全是合法终结符', out.every(isTerminal), `out=${JSON.stringify(out)}`);
    // (X 1 8)=60 +(slope C8)=60 +(X 3 8)=60 +R8=60 +(X 5 4)=120 = 360 → 一个 brick 360<480,会再补
    ok('时长 ≤ 480', getDurationAbstractMelody(out) <= 480, `dur=${getDurationAbstractMelody(out)}`);
}

// ------------------------------------------------------------
// (2) 全 85 grammar 鲁棒性扫描
// ------------------------------------------------------------
console.log('\n— 全 85 grammar 鲁棒性(每个 run 5 次,4 bar)—');
const files = readdirSync(grammarsDir).filter(f => f.endsWith('.grammar')).sort();
ok('grammar 文件数 = 85', files.length === 85, `found=${files.length}`);

const RUNS = 5;
const SLOTS = 1920; // 4 bar
let badGrammars = 0;
let emptyGrammars = 0;
const failExamples: string[] = [];

for (const file of files) {
    let bad = false;
    let producedAny = false;
    try {
        const g = Grammar.fromText(readFileSync(join(grammarsDir, file), 'utf8'));
        for (let i = 0; i < RUNS; i++) {
            const out = g.run(SLOTS);
            if (out.length > 0) producedAny = true;
            // 每个元素必须是合法终结符
            const badTok = (out as GVal[]).find(t => !isTerminal(t));
            if (badTok !== undefined) { bad = true; failExamples.push(`${file}: 非终结符 ${JSON.stringify(badTok)}`); break; }
            // 总时长不得超过请求
            const dur = getDurationAbstractMelody(out);
            if (dur > SLOTS) { bad = true; failExamples.push(`${file}: 超时长 ${dur}>${SLOTS}`); break; }
        }
    } catch (err) {
        bad = true;
        failExamples.push(`${file}: 抛错 ${String(err).slice(0, 80)}`);
    }
    if (bad) badGrammars++;
    else if (!producedAny) emptyGrammars++;
}

ok('无 grammar 产出非法 token / 抛错 / 超时长', badGrammars === 0,
    `坏 grammar=${badGrammars}\n      ` + failExamples.slice(0, 8).join('\n      '));
console.log(`  · 全空输出的 grammar(占位/_empty 类)= ${emptyGrammars}`);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
