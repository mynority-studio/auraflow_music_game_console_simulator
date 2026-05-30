// grammar-rom-equiv.ts — A 方案验证:grammars.rom 能否无损替换 .grammar 文本?
//   对每个 grammar,对比:
//     基准 = Grammar.fromText(原始 .grammar 文本)          ← 引擎当前路径
//     ROM  = new Grammar(桥接(getGrammarData(从 ROM 解码)))  ← 替换后路径
//   种子化 Math.random,逐种子逐 grammar 比对生成的抽象旋律是否逐字节一致。
//   跑:npx tsx src/core/generation/improCore/engine/__harness__/grammar-rom-equiv.ts

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Grammar } from '../grammar';
import { numberize, type GList } from '../terminals';
import { getGrammarData } from '../../data/grammar-rom-reader';
import type { GrammarData } from '../../data/grammar-parser';

const here = dirname(fileURLToPath(import.meta.url));
const grammarsDir = join(here, '../../data/grammars');

// ── 桥:GrammarData(ROM 解出)→ 引擎 forms(GList)──────────────
//   引擎 run 只取决于「非 base 规则(文件序)+ startsymbol」。
//   规则恒 4 元 (rule lhs body WEIGHT);有 builtin 时 builtin 即 WEIGHT。
function grammarDataToForms(data: GrammarData): GList {
    const forms: unknown[] = [];
    forms.push(['startsymbol', data.startSymbol]);
    for (const r of data.rules) {
        const lhs: unknown[] = [r.head, ...r.params];
        if (r.headFixedArg !== undefined) lhs.push(String(r.headFixedArg));
        if (r.builtin) {
            // 文本里 builtin 规则恒为 5 元 (rule lhs body (builtin..) weight) —— 引擎 findRule
            // 只收 length===4,故这些规则被跳过(死规则)。重建成 5 元以复现"跳过"。
            forms.push(['rule', lhs, r.body, ['builtin', r.builtin.type, r.builtin.name], String(r.weight)]);
        } else {
            forms.push(['rule', lhs, r.body, String(r.weight)]);
        }
    }
    return numberize(forms) as GList;
}

// ── 种子化 Math.random(mulberry32),可保存/复位 ──────────────
const realRandom = Math.random;
function seedRandom(seed: number): void {
    let a = seed >>> 0;
    Math.random = function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const SEEDS = [1, 7, 42, 123, 9999];
const SLOTS = 1920; // 4 bars

const files = readdirSync(grammarsDir).filter((f) => f.endsWith('.grammar')).sort();
let okGrammars = 0, badGrammars = 0, romMissing = 0;
const mismatches: { name: string; seed: number; sample: string }[] = [];

for (const file of files) {
    const name = file.replace(/\.grammar$/, '');
    const text = readFileSync(join(grammarsDir, file), 'utf8');
    const data = getGrammarData(name);
    if (!data) { romMissing++; console.log(`⚠️  ${name}: ROM 无此 grammar`); continue; }

    const gText = Grammar.fromText(text);
    const gRom = new Grammar(grammarDataToForms(data));

    let grammarOk = true;
    for (const seed of SEEDS) {
        seedRandom(seed);
        const a = JSON.stringify(gText.run(SLOTS));
        seedRandom(seed);
        const b = JSON.stringify(gRom.run(SLOTS));
        if (a !== b) {
            grammarOk = false;
            if (mismatches.length < 8) {
                // 找首个不同位置
                let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
                mismatches.push({ name, seed, sample: `…${a.slice(Math.max(0, i - 20), i + 30)}\n     vs …${b.slice(Math.max(0, i - 20), i + 30)}` });
            }
            break;
        }
    }
    if (grammarOk) okGrammars++; else { badGrammars++; }
}
Math.random = realRandom;

console.log(`\n${'─'.repeat(56)}`);
console.log(`grammar 总数 ${files.length} · 一致 ${okGrammars} · 分歧 ${badGrammars} · ROM 缺 ${romMissing}`);
if (mismatches.length > 0) {
    console.log(`\n首批分歧样本(${mismatches.length}):`);
    for (const m of mismatches) console.log(`  [${m.name}] seed ${m.seed}:\n     ${m.sample}`);
}
console.log(`\n${badGrammars === 0 && romMissing === 0 ? '🟢 全部 85 grammar 生成逐字节一致 → ROM 可无损替换文本' : '🔴 存在分歧 → 非无损,见上'}`);
process.exit(badGrammars === 0 && romMissing === 0 ? 0 : 1);
