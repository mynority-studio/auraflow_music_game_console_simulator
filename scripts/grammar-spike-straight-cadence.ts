// ============================================================
// grammar-spike-straight-cadence.ts — 单 brick name 切片化可行性 spike
// ============================================================
//
// 用法:npx tsx scripts/grammar-spike-straight-cadence.ts
// 输出:.claude/notes/grammar-spike-straight-cadence.md
//
// 目标:验证"brick name × BRICK length → unique body 矩阵"假设
//
// 假设(audit 数据支撑):
//   - 跨 grammar 字面冗余 91% — body 大量重复
//   - 137 brick name 是 Impro-Visor 已分好的语义切片
//   - Straight-Cadence: 42 grammar × 1858 rule(最大池)
//
// spike 问题:
//   1. 1858 rule 按 BRICK length 分桶后,每桶 unique body 数有多少?
//   2. 每桶共用 body 的"群众基础"多大(共用度分布)?
//   3. body 长得真的一样吗 vs 看似一样实际微差?抽样肉眼审。
//   4. body 内 token 序列的"内部 N-gram"是否有 PICKUP/BODY/TAIL 三段结构?
//
// 输出三段:
//   A. per-length 桶基础统计(unique / clones / 共用度)
//   B. 抽样 body 字面打印(Top 10 共用 + 5 random unique)
//   C. body 内 PICKUP/TAIL 子序列 N-gram 统计(N=4 前 / N=4 后)
// ============================================================

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseGrammar, type GrammarToken } from '../src/core/generation/improCore/data/grammar-parser';

const GRAMMARS_DIR = 'public/grammars';
const OUTPUT_PATH = '.claude/notes/grammar-spike-straight-cadence.md';
const TARGET_BRICK = 'Straight-Cadence';

// ─────────────────────────────────────────────────────────────────
// Helpers(复用 audit 脚本逻辑)
// ─────────────────────────────────────────────────────────────────

function tokenToStr(t: GrammarToken): string {
    if (typeof t === 'string') return t;
    return '(' + t.map(tokenToStr).join(' ') + ')';
}
function bodyToStr(body: GrammarToken[]): string {
    return body.map(tokenToStr).join(' ');
}
function flattenTokens(t: GrammarToken): string[] {
    if (typeof t === 'string') return [t];
    return t.flatMap(flattenTokens);
}
function inc(m: Map<string, number>, k: string, by = 1) {
    m.set(k, (m.get(k) ?? 0) + by);
}

// ─────────────────────────────────────────────────────────────────
// Load + filter to Straight-Cadence rules
// ─────────────────────────────────────────────────────────────────

interface SpikeRule {
    grammar: string;
    length: number;             // BRICK length(960 / 1920 / ...)
    body: GrammarToken[];
    bodyStr: string;            // 字面指纹
    flatTokens: string[];       // flatten 后的 token 序列
    weight: number;
}

const files = readdirSync(GRAMMARS_DIR).filter(f => f.endsWith('.grammar')).sort();
const all: SpikeRule[] = [];

for (const f of files) {
    const raw = readFileSync(join(GRAMMARS_DIR, f), 'utf8');
    const name = f.replace(/\.grammar$/, '');
    try {
        const data = parseGrammar(raw, name);
        for (const r of data.rules) {
            if (r.head !== 'BRICK') continue;
            if (r.builtin?.type !== 'brick' || r.builtin.name !== TARGET_BRICK) continue;
            const bodyStr = bodyToStr(r.body);
            const flatTokens = r.body.flatMap(flattenTokens);
            all.push({
                grammar: name,
                length: r.headFixedArg ?? 0,
                body: r.body,
                bodyStr,
                flatTokens,
                weight: r.weight,
            });
        }
    } catch (e) {
        // skip parse failures
    }
}
console.log(`Loaded ${all.length} '${TARGET_BRICK}' rules from ${files.length} files`);

// ─────────────────────────────────────────────────────────────────
// Part A: per-length bucket statistics
// ─────────────────────────────────────────────────────────────────

interface BucketStats {
    length: number;
    totalRules: number;
    uniqueBodies: number;
    clones: number;           // body 被 ≥ 2 rule 共用的数量
    sharedRules: number;      // 被共用 body 涉及的 rule 总数
    grammarsInvolved: number;
    // bodyStr → { count, grammars Set }
    bodyMap: Map<string, { count: number; grammars: Set<string> }>;
}

const byLength = new Map<number, SpikeRule[]>();
for (const r of all) {
    let arr = byLength.get(r.length);
    if (!arr) { arr = []; byLength.set(r.length, arr); }
    arr.push(r);
}

const buckets: BucketStats[] = [];
for (const [length, rules] of [...byLength.entries()].sort((a, b) => a[0] - b[0])) {
    const bodyMap = new Map<string, { count: number; grammars: Set<string> }>();
    for (const r of rules) {
        let entry = bodyMap.get(r.bodyStr);
        if (!entry) { entry = { count: 0, grammars: new Set() }; bodyMap.set(r.bodyStr, entry); }
        entry.count++;
        entry.grammars.add(r.grammar);
    }
    const uniqueBodies = bodyMap.size;
    const clones = [...bodyMap.values()].filter(v => v.count > 1).length;
    const sharedRules = [...bodyMap.values()].filter(v => v.count > 1).reduce((a, v) => a + v.count, 0);
    const grammarsInvolved = new Set(rules.map(r => r.grammar)).size;
    buckets.push({ length, totalRules: rules.length, uniqueBodies, clones, sharedRules, grammarsInvolved, bodyMap });
}

// ─────────────────────────────────────────────────────────────────
// Part B: 抽样 body — Top N 共用 + N random unique
// ─────────────────────────────────────────────────────────────────

function sampleBucket(bucket: BucketStats, topShared: number, randomUnique: number): {
    shared: Array<{ bodyStr: string; count: number; grammars: string[] }>;
    unique: Array<{ bodyStr: string; grammar: string }>;
} {
    const shared = [...bucket.bodyMap.entries()]
        .filter(([_, v]) => v.count > 1)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, topShared)
        .map(([bodyStr, v]) => ({ bodyStr, count: v.count, grammars: [...v.grammars].sort() }));

    const uniqueList = [...bucket.bodyMap.entries()].filter(([_, v]) => v.count === 1);
    // 简易"伪随机"抽样:取 index 0, mid, end 等
    const picked: typeof uniqueList = [];
    if (uniqueList.length > 0) {
        const step = Math.max(1, Math.floor(uniqueList.length / randomUnique));
        for (let i = 0; i < uniqueList.length && picked.length < randomUnique; i += step) picked.push(uniqueList[i]!);
    }
    const unique = picked.map(([bodyStr, v]) => ({ bodyStr, grammar: [...v.grammars][0]! }));

    return { shared, unique };
}

// ─────────────────────────────────────────────────────────────────
// Part C: PICKUP / TAIL N-gram 内部结构(N=4 prefix / suffix)
// ─────────────────────────────────────────────────────────────────

const N_GRAM_LEN = 4;

interface NgramStat {
    where: 'prefix' | 'suffix';
    fpMap: Map<string, { count: number; grammars: Set<string>; bucketLengths: Set<number> }>;
}

const prefixStat: NgramStat = { where: 'prefix', fpMap: new Map() };
const suffixStat: NgramStat = { where: 'suffix', fpMap: new Map() };

for (const r of all) {
    const head = r.flatTokens.slice(0, N_GRAM_LEN).join(' ');
    const tail = r.flatTokens.slice(Math.max(0, r.flatTokens.length - N_GRAM_LEN)).join(' ');
    for (const [fp, stat] of [[head, prefixStat], [tail, suffixStat]] as Array<[string, NgramStat]>) {
        if (!fp) continue;
        let entry = stat.fpMap.get(fp);
        if (!entry) { entry = { count: 0, grammars: new Set(), bucketLengths: new Set() }; stat.fpMap.set(fp, entry); }
        entry.count++;
        entry.grammars.add(r.grammar);
        entry.bucketLengths.add(r.length);
    }
}

// ─────────────────────────────────────────────────────────────────
// Render markdown
// ─────────────────────────────────────────────────────────────────

const lines: string[] = [];
const push = (s: string) => lines.push(s);

push(`# Grammar Spike Report — ${TARGET_BRICK}`);
push('');
push(`> 生成于 ${new Date().toISOString().slice(0, 10)} | 单 brick name 切片化可行性验证`);
push('');
push('**假设**:`brick name × BRICK length → unique body 矩阵` 可大幅压缩 grammar 规模。');
push(`**spike 目标**:吃透 \`${TARGET_BRICK}\`(audit 数据中最大池,1858 rule × 42 grammar)`);
push('');

// Part A
push('## A. per-length 桶基础统计');
push('');
push(`总共 ${all.length} 条 \`${TARGET_BRICK}\` rule,来自 ${new Set(all.map(r => r.grammar)).size} 个 grammar。`);
push('');
push('| BRICK length | beat | rule 数 | grammar 数 | unique body | clone body | 共用 rule 占比 | 唯一/总数 比 |');
push('|---|---|---|---|---|---|---|---|');
let totalUnique = 0, totalRules = 0;
for (const b of buckets) {
    const beat = b.length / 480;
    const sharedPct = b.totalRules > 0 ? (b.sharedRules / b.totalRules * 100).toFixed(1) + '%' : '-';
    const uniqPct = b.totalRules > 0 ? (b.uniqueBodies / b.totalRules * 100).toFixed(1) + '%' : '-';
    push(`| ${b.length} | ${beat} | ${b.totalRules} | ${b.grammarsInvolved} | ${b.uniqueBodies} | ${b.clones} | ${sharedPct} | ${uniqPct} |`);
    totalUnique += b.uniqueBodies;
    totalRules += b.totalRules;
}
push(`| **TOTAL** | — | **${totalRules}** | — | **${totalUnique}** | — | — | **${(totalUnique / totalRules * 100).toFixed(1)}%** |`);
push('');
push(`**核心数据**:1858 条 \`${TARGET_BRICK}\` rule → 去重后 ${totalUnique} 条 unique body(**压缩率 ${((1 - totalUnique / totalRules) * 100).toFixed(1)}%**)。`);
push('');

// Part B
push('## B. 抽样 body 字面(Top 5 共用 + 5 random unique,per length 桶)');
push('');
push('看 body 是否真的"看起来一样的就是一样的"(字面去重靠谱否),以及 unique body 之间到底差在哪。');
push('');

for (const b of buckets) {
    if (b.totalRules < 20) continue; // 小桶跳过
    const sample = sampleBucket(b, 5, 5);
    push(`### length=${b.length}(${b.length / 480} beat)桶 — ${b.totalRules} rule / ${b.uniqueBodies} unique`);
    push('');
    if (sample.shared.length > 0) {
        push('**Top 共用 body**:');
        push('');
        push('| 用次 | grammar 数 | grammar 列表(前 5) | body 摘要(前 100 字符)|');
        push('|---|---|---|---|');
        for (const s of sample.shared) {
            const preview = s.bodyStr.length > 100 ? s.bodyStr.slice(0, 100) + '...' : s.bodyStr;
            const glist = s.grammars.slice(0, 5).join(', ') + (s.grammars.length > 5 ? `, +${s.grammars.length - 5}` : '');
            push(`| ${s.count} | ${s.grammars.length} | ${glist} | \`${preview.replace(/\|/g, '\\|')}\` |`);
        }
        push('');
    }
    if (sample.unique.length > 0) {
        push('**抽样 unique body**:');
        push('');
        push('| grammar | body 摘要(前 120 字符)|');
        push('|---|---|');
        for (const u of sample.unique) {
            const preview = u.bodyStr.length > 120 ? u.bodyStr.slice(0, 120) + '...' : u.bodyStr;
            push(`| ${u.grammar} | \`${preview.replace(/\|/g, '\\|')}\` |`);
        }
        push('');
    }
}

// Part C
push('## C. PICKUP / TAIL N-gram 内部结构(N=4)');
push('');
push(`观察 body 的前 ${N_GRAM_LEN} / 后 ${N_GRAM_LEN} flatten token —— 是否能用 N-gram"句首库 / 句尾库"再二次切片。`);
push('');

push('### Top 10 高频 PREFIX(body 头 4 token)');
push('');
push('| 用次 | grammar 数 | 长度桶 | prefix |');
push('|---|---|---|---|');
const topPrefix = [...prefixStat.fpMap.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10);
for (const [fp, v] of topPrefix) {
    push(`| ${v.count} | ${v.grammars.size} | ${[...v.bucketLengths].sort().join('/')} | \`${fp.replace(/\|/g, '\\|')}\` |`);
}
push('');

push('### Top 10 高频 SUFFIX(body 尾 4 token)');
push('');
push('| 用次 | grammar 数 | 长度桶 | suffix |');
push('|---|---|---|---|');
const topSuffix = [...suffixStat.fpMap.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10);
for (const [fp, v] of topSuffix) {
    push(`| ${v.count} | ${v.grammars.size} | ${[...v.bucketLengths].sort().join('/')} | \`${fp.replace(/\|/g, '\\|')}\` |`);
}
push('');

push(`**Prefix 多样性**:${prefixStat.fpMap.size} 唯一 prefix / ${all.length} rule = ${(prefixStat.fpMap.size / all.length * 100).toFixed(1)}%`);
push(`**Suffix 多样性**:${suffixStat.fpMap.size} 唯一 suffix / ${all.length} rule = ${(suffixStat.fpMap.size / all.length * 100).toFixed(1)}%`);
push('');

// D 结论
push('## D. spike 结论(待审)');
push('');
push('待人工审完上面三段数据后,在此填写:');
push('- [ ] body 字面去重靠不靠谱(微差 body 是否被错合并?)');
push('- [ ] 单 brick name 桶的压缩率(unique / total)是否达预期 < 30%?');
push('- [ ] PREFIX / SUFFIX 是否有清晰的"句首库 / 句尾库"结构?');
push('- [ ] 是否值得走"切片化重构"全套?或部分?');
push('');

const md = lines.join('\n');
writeFileSync(OUTPUT_PATH, md);
console.log(`Wrote ${OUTPUT_PATH} (${(md.length / 1024).toFixed(1)} KB)`);
