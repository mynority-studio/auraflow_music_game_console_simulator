// ============================================================
// grammar-audit.ts — 对 public/grammars/*.grammar 做 N-gram / 切片可行性分析
// ============================================================
//
// 用法:npx tsx scripts/grammar-audit.ts
// 输出:.claude/notes/grammar-audit.md
//
// 分析维度:
//   1. 基础统计(file size / rule 数 / parameter 数)
//   2. BRICK length 分布(960 / 1920 / 2880 / 其他)
//   3. builtin brick name 跨 grammar 重叠
//   4. rule body 字面指纹 — 完整 body 跨 grammar 重叠(克隆率)
//   5. body 前缀(head pattern)与后缀(tail pattern)N-gram 重叠
//   6. token 词汇分布(X / slope / R / 节奏 token)
//   7. per-grammar 独占 rule 占比
// ============================================================

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseGrammar, type GrammarData, type GrammarRule, type GrammarToken } from '../src/core/generation/improCore/data/grammar-parser';

const GRAMMARS_DIR = 'data/grammars';
const OUTPUT_PATH = '.claude/notes/grammar-audit.md';

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** 把 GrammarToken[] 序列化为字面字符串 — 用作指纹 / N-gram key */
function tokenToStr(t: GrammarToken): string {
    if (typeof t === 'string') return t;
    return '(' + t.map(tokenToStr).join(' ') + ')';
}
function bodyToStr(body: GrammarToken[]): string {
    return body.map(tokenToStr).join(' ');
}

/** 提取 body 的"flat token 序列" — 嵌套 (slope ...) 内的 token 也展平 */
function flattenTokens(t: GrammarToken): string[] {
    if (typeof t === 'string') return [t];
    return t.flatMap(flattenTokens);
}

/** 取 body 前 N 个 token / 后 N 个 token */
function takeHead(body: GrammarToken[], n: number): string {
    const flat = body.flatMap(flattenTokens);
    return flat.slice(0, n).join(' ');
}
function takeTail(body: GrammarToken[], n: number): string {
    const flat = body.flatMap(flattenTokens);
    return flat.slice(Math.max(0, flat.length - n)).join(' ');
}

/** Top-N entries of a Map<string, number>(desc) */
function topN(m: Map<string, number>, n: number): Array<[string, number]> {
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function inc(m: Map<string, number>, k: string, by = 1) {
    m.set(k, (m.get(k) ?? 0) + by);
}

// ─────────────────────────────────────────────────────────────────
// Load all grammars
// ─────────────────────────────────────────────────────────────────

const files = readdirSync(GRAMMARS_DIR).filter(f => f.endsWith('.grammar')).sort();
console.log(`Loading ${files.length} grammars...`);

interface AuditEntry {
    name: string;
    sizeBytes: number;
    data: GrammarData;
}

const entries: AuditEntry[] = [];
for (const f of files) {
    const fullPath = join(GRAMMARS_DIR, f);
    const raw = readFileSync(fullPath, 'utf8');
    const name = f.replace(/\.grammar$/, '');
    try {
        const data = parseGrammar(raw, name);
        entries.push({ name, sizeBytes: raw.length, data });
    } catch (e) {
        console.warn(`parse failed: ${name}`, e);
    }
}
console.log(`Parsed ${entries.length}/${files.length} grammars`);

// ─────────────────────────────────────────────────────────────────
// Dimension 1: 基础统计
// ─────────────────────────────────────────────────────────────────

const totalRules = entries.reduce((s, e) => s + e.data.rules.length, 0);
const totalBaseRules = entries.reduce((s, e) => s + e.data.baseRules.length, 0);
const totalSize = entries.reduce((s, e) => s + e.sizeBytes, 0);

// ─────────────────────────────────────────────────────────────────
// Dimension 2: BRICK length 分布
// ─────────────────────────────────────────────────────────────────

const brickLengthCount = new Map<string, number>();
const ruleHeadCount = new Map<string, number>();
for (const e of entries) {
    for (const r of e.data.rules) {
        ruleHeadCount.set(r.head, (ruleHeadCount.get(r.head) ?? 0) + 1);
        if (r.head === 'BRICK' && r.headFixedArg !== undefined) {
            inc(brickLengthCount, String(r.headFixedArg));
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Dimension 3: builtin brick name 跨 grammar 重叠
// ─────────────────────────────────────────────────────────────────

const builtinNameToGrammars = new Map<string, Set<string>>();
const builtinNameUsages = new Map<string, number>(); // total rule count
for (const e of entries) {
    for (const r of e.data.rules) {
        if (r.builtin?.type === 'brick') {
            const name = r.builtin.name;
            let s = builtinNameToGrammars.get(name);
            if (!s) { s = new Set(); builtinNameToGrammars.set(name, s); }
            s.add(e.name);
            inc(builtinNameUsages, name);
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Dimension 4: rule body 字面指纹 — 完整 body 跨 grammar 克隆率
// ─────────────────────────────────────────────────────────────────

const bodyFpToGrammars = new Map<string, Set<string>>();
const bodyFpUsages = new Map<string, number>();
for (const e of entries) {
    for (const r of e.data.rules) {
        if (r.head !== 'BRICK') continue; // 只看 BRICK 实质 body,P Y 是 recursion 没意义
        const fp = bodyToStr(r.body);
        let s = bodyFpToGrammars.get(fp);
        if (!s) { s = new Set(); bodyFpToGrammars.set(fp, s); }
        s.add(e.name);
        inc(bodyFpUsages, fp);
    }
}

const uniqueBodies = bodyFpToGrammars.size;
const totalBrickBodies = [...bodyFpUsages.values()].reduce((a, b) => a + b, 0);
const clonedBodies = [...bodyFpToGrammars.values()].filter(s => s.size > 1).length;
const sharedBodyCount = [...bodyFpUsages.entries()].filter(([fp, _]) => bodyFpToGrammars.get(fp)!.size > 1).reduce((a, [_, n]) => a + n, 0);

// ─────────────────────────────────────────────────────────────────
// Dimension 5: head / tail N-gram 重叠(N = 3, 5, 8)
// ─────────────────────────────────────────────────────────────────

interface NgramStat {
    n: number;
    where: 'head' | 'tail';
    fpToGrammars: Map<string, Set<string>>;
    fpUsages: Map<string, number>;
}

function buildNgram(n: number, where: 'head' | 'tail'): NgramStat {
    const fpToGrammars = new Map<string, Set<string>>();
    const fpUsages = new Map<string, number>();
    for (const e of entries) {
        for (const r of e.data.rules) {
            if (r.head !== 'BRICK') continue;
            const fp = where === 'head' ? takeHead(r.body, n) : takeTail(r.body, n);
            if (!fp) continue;
            let s = fpToGrammars.get(fp);
            if (!s) { s = new Set(); fpToGrammars.set(fp, s); }
            s.add(e.name);
            inc(fpUsages, fp);
        }
    }
    return { n, where, fpToGrammars, fpUsages };
}

const ngramStats = [
    buildNgram(3, 'head'),
    buildNgram(5, 'head'),
    buildNgram(8, 'head'),
    buildNgram(3, 'tail'),
    buildNgram(5, 'tail'),
    buildNgram(8, 'tail'),
];

// ─────────────────────────────────────────────────────────────────
// Dimension 6: token 词汇分布
// ─────────────────────────────────────────────────────────────────

const tokenKindCount = new Map<string, number>();
for (const e of entries) {
    for (const r of e.data.rules) {
        if (r.head !== 'BRICK') continue;
        for (const t of r.body) {
            const flat = flattenTokens(t);
            for (const tok of flat) {
                if (tok === 'X') inc(tokenKindCount, 'X (scale-degree note)');
                else if (tok === 'slope') inc(tokenKindCount, 'slope (contour wrapper)');
                else if (/^R(\d+|[\d+/\s]+)?$/.test(tok)) inc(tokenKindCount, 'R (rest)');
                else if (/^[CLAX]\d/.test(tok)) inc(tokenKindCount, 'CLA[X] (abstract pitch class)');
                else if (/^[\d#b/+]+$/.test(tok)) inc(tokenKindCount, 'duration/numeric');
                else inc(tokenKindCount, `other: ${tok}`);
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────
// Dimension 7: per-grammar 独占 rule 占比
// ─────────────────────────────────────────────────────────────────

const perGrammarExclusive: Array<{ name: string; ruleCount: number; exclusiveCount: number; pct: number }> = [];
for (const e of entries) {
    let exclusive = 0;
    let total = 0;
    for (const r of e.data.rules) {
        if (r.head !== 'BRICK') continue;
        total++;
        const fp = bodyToStr(r.body);
        if (bodyFpToGrammars.get(fp)!.size === 1) exclusive++;
    }
    if (total > 0) {
        perGrammarExclusive.push({ name: e.name, ruleCount: total, exclusiveCount: exclusive, pct: exclusive / total });
    }
}
perGrammarExclusive.sort((a, b) => b.pct - a.pct); // 独占率最高 → 最低

// ─────────────────────────────────────────────────────────────────
// 输出 markdown
// ─────────────────────────────────────────────────────────────────

const lines: string[] = [];
const push = (s: string) => lines.push(s);

push('# Grammar Audit Report');
push('');
push(`> 生成于 ${new Date().toISOString().slice(0, 10)} | 数据源 \`public/grammars/*.grammar\``);
push('');
push('目标:量化 Impro-Visor 85 grammar 的内部冗余度,为后续"切片化重构"提供数据依据。');
push('');

// Dim 1: 基础统计
push('## 1. 基础统计');
push('');
push('| 指标 | 值 |');
push('|---|---|');
push(`| Grammar 文件数 | ${entries.length} |`);
push(`| 总 size | ${(totalSize / 1024).toFixed(1)} KB |`);
push(`| 平均 size / grammar | ${(totalSize / entries.length / 1024).toFixed(1)} KB |`);
push(`| 总 rule 数(含 P/BRICK/其他) | ${totalRules} |`);
push(`| 总 base rule 数 | ${totalBaseRules} |`);
push(`| 平均 rule / grammar | ${(totalRules / entries.length).toFixed(0)} |`);
push('');

push('**Rule head 分布**(前 10):');
push('');
push('| head | rule 数 |');
push('|---|---|');
for (const [h, n] of topN(ruleHeadCount, 10)) push(`| \`${h}\` | ${n} |`);
push('');

// Dim 2: BRICK length
push('## 2. BRICK length 分布');
push('');
push('每条 BRICK rule 的 length(ticks)= phrase 时长。960=2 beat,1920=4 beat,2880=6 beat,3840=8 beat,...');
push('');
push('| length(ticks) | beat | rule 数 |');
push('|---|---|---|');
for (const [len, n] of [...brickLengthCount.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const beats = Number(len) / 480;
    push(`| ${len} | ${beats} | ${n} |`);
}
push('');

// Dim 3: builtin brick name
push('## 3. builtin brick name(句式语义)分布');
push('');
push('每条 BRICK rule 可能带 `(builtin brick Name)` marker,标记适用的 cadence / phrase role。');
push('**这是 "PICKUP / BODY / TAIL" 切片维度最直接的来源**。');
push('');
push(`总共 ${builtinNameToGrammars.size} 种独立 brick name,覆盖 ${[...builtinNameUsages.values()].reduce((a, b) => a + b, 0)} 条 rule。`);
push('');
push('| brick name | 涉及 grammar 数 | 总 rule 数 | 跨 grammar? |');
push('|---|---|---|---|');
for (const [name, n] of topN(builtinNameUsages, 20)) {
    const gCount = builtinNameToGrammars.get(name)!.size;
    const cross = gCount > 1 ? '✓' : '';
    push(`| \`${name}\` | ${gCount} | ${n} | ${cross} |`);
}
push('');

// Dim 4: 字面 body 克隆率
push('## 4. 完整 body 字面克隆率(剽窃量)');
push('');
push('指标:不同 grammar 之间 rule body 是否字面完全相同 — 直接量化"冗余度"。');
push('');
push('| 指标 | 值 |');
push('|---|---|');
push(`| 唯一 body 字面数 | ${uniqueBodies} |`);
push(`| BRICK rule 总数 | ${totalBrickBodies} |`);
push(`| 唯一/总数 比 | ${(uniqueBodies / totalBrickBodies * 100).toFixed(1)}% |`);
push(`| 被克隆 body 数(被 ≥ 2 grammar 共用)| ${clonedBodies} |`);
push(`| 涉及 rule 总数(共用 body) | ${sharedBodyCount} |`);
push(`| 字面冗余度 = 共用 rule / 总 rule | ${(sharedBodyCount / totalBrickBodies * 100).toFixed(1)}% |`);
push('');
push('**Top 10 最常被多个 grammar 共用的 body**:');
push('');
push('| 用次 | grammar 数 | body 摘要 |');
push('|---|---|---|');
const topClones = [...bodyFpToGrammars.entries()]
    .filter(([_, s]) => s.size > 1)
    .sort((a, b) => b[1].size - a[1].size || (bodyFpUsages.get(b[0])! - bodyFpUsages.get(a[0])!))
    .slice(0, 10);
for (const [fp, gset] of topClones) {
    const n = bodyFpUsages.get(fp)!;
    const preview = fp.length > 60 ? fp.slice(0, 60) + '...' : fp;
    push(`| ${n} | ${gset.size} | \`${preview.replace(/\|/g, '\\|')}\` |`);
}
push('');

// Dim 5: N-gram head/tail
push('## 5. head / tail N-gram 重叠(PICKUP/TAIL 切片可行性)');
push('');
push('对每条 BRICK rule body flatten 取前 N / 后 N 个 token 作"head pattern" / "tail pattern"。');
push('问 N-gram 模式跨 grammar 重叠率 — 直接量化"用 N-gram 切片能合并多少"。');
push('');
for (const stat of ngramStats) {
    const totalRulesWithFp = [...stat.fpUsages.values()].reduce((a, b) => a + b, 0);
    const uniqueFps = stat.fpToGrammars.size;
    const sharedFps = [...stat.fpToGrammars.values()].filter(s => s.size > 1).length;
    const sharedFpRuleCount = [...stat.fpUsages.entries()].filter(([fp]) => stat.fpToGrammars.get(fp)!.size > 1).reduce((a, [_, n]) => a + n, 0);
    const coverage = sharedFpRuleCount / totalRulesWithFp;
    push(`### N=${stat.n} ${stat.where}`);
    push('');
    push(`- 唯一模式 / 总规则:${uniqueFps} / ${totalRulesWithFp} = **${(uniqueFps / totalRulesWithFp * 100).toFixed(1)}% 唯一**`);
    push(`- 被 ≥ 2 grammar 共用的模式:${sharedFps}(占模式 ${(sharedFps / uniqueFps * 100).toFixed(1)}%)`);
    push(`- 共用模式覆盖的 rule 占比:**${(coverage * 100).toFixed(1)}%** ← 切片可合并率`);
    push('');
    push(`**Top 5 高频共用 ${stat.where} pattern**:`);
    push('');
    push('| 用次 | grammar 数 | pattern |');
    push('|---|---|---|');
    const top = [...stat.fpToGrammars.entries()]
        .filter(([_, s]) => s.size > 1)
        .sort((a, b) => stat.fpUsages.get(b[0])! - stat.fpUsages.get(a[0])!)
        .slice(0, 5);
    for (const [fp, gset] of top) {
        const n = stat.fpUsages.get(fp)!;
        const preview = fp.length > 80 ? fp.slice(0, 80) + '...' : fp;
        push(`| ${n} | ${gset.size} | \`${preview.replace(/\|/g, '\\|')}\` |`);
    }
    push('');
}

// Dim 6: token 词汇
push('## 6. token 词汇分布');
push('');
push('| token 类别 | 出现次数 |');
push('|---|---|');
for (const [k, n] of topN(tokenKindCount, 15)) push(`| ${k} | ${n} |`);
push('');

// Dim 7: per-grammar 独占率
push('## 7. per-grammar 独占率(独有 ↔ 共享)');
push('');
push('独占率高 = grammar 个性强,本身就是独立"family";独占率低 = 大量 rule 跟其他 grammar 雷同。');
push('');
push('**Top 10 高独占率(最独特)**:');
push('');
push('| grammar | rule 数 | 独占数 | 独占率 |');
push('|---|---|---|---|');
for (const x of perGrammarExclusive.slice(0, 10)) {
    push(`| ${x.name} | ${x.ruleCount} | ${x.exclusiveCount} | ${(x.pct * 100).toFixed(1)}% |`);
}
push('');
push('**Top 10 低独占率(最大量复用其他 grammar)**:');
push('');
push('| grammar | rule 数 | 独占数 | 独占率 |');
push('|---|---|---|---|');
for (const x of perGrammarExclusive.slice(-10).reverse()) {
    push(`| ${x.name} | ${x.ruleCount} | ${x.exclusiveCount} | ${(x.pct * 100).toFixed(1)}% |`);
}
push('');

// 结论 + 切片维度建议
push('## 8. 结论与切片维度建议');
push('');
push('结合 6 个维度数据 + 用户的"PICKUP/BODY/TAIL"直觉 → 给出切片可行性评估和建议下一步。');
push('');
push('详见数据上方各章节,后续在审报告后补 §8 推荐切片维度 + 实施路径。');
push('');

const md = lines.join('\n');
writeFileSync(OUTPUT_PATH, md);
console.log(`Wrote ${OUTPUT_PATH} (${(md.length / 1024).toFixed(1)} KB)`);
