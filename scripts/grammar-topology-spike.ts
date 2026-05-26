// ============================================================
// grammar-topology-spike.ts — 量化"PREFIX/MID/SUFFIX 三池切片"实际收益
// ============================================================
//
// 用法:npx tsx scripts/grammar-topology-spike.ts
// 输出:.claude/notes/grammar-topology-spike.md
//
// 关键假设验证:audit 报告的 N=4 head/tail 重叠率(99.8% / 92.7%)是 flatten
// token 数据;实际 body 是 GrammarToken[] (top-level nested)。按 top-level
// token 切片的实际重叠率 + mid 部分唯一度 = C 方案真实收益。
//
// 切片维度:
//   - 按 top-level GrammarToken 切:prefix = body.slice(0, N) / suffix = body.slice(-N)
//   - mid = body.slice(N, body.length - N)
//   - 三池各 dedup,统计 size + 唯一度
//
// 输出:
//   每个 N(2 / 3 / 4 / 5):
//     - prefix 池 size 及 unique count
//     - suffix 池 size 及 unique count
//     - mid 池 size 及 unique count(关键 — 决定收益上限)
//     - 估算 raw 总 size = 3 池 + per-body 3 small int 引用
// ============================================================

import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseGrammar, type GrammarToken } from '../src/core/generation/improCore/data/grammar-parser';

const SRC_DIR = 'data/grammars';
const OUTPUT_PATH = '.claude/notes/grammar-topology-spike.md';

function tokenToStr(t: GrammarToken): string {
    if (typeof t === 'string') return t;
    return '(' + t.map(tokenToStr).join(' ') + ')';
}
function bodyToFp(body: GrammarToken[]): string {
    return body.map(tokenToStr).join(' ');
}

// ─────────────────────────────────────────────────────────────────
// Load all bodies
// ─────────────────────────────────────────────────────────────────

const files = readdirSync(SRC_DIR).filter(f => f.endsWith('.grammar')).sort();
const allBodies: GrammarToken[][] = [];

for (const f of files) {
    const raw = readFileSync(join(SRC_DIR, f), 'utf8');
    const name = f.replace(/\.grammar$/, '');
    try {
        const p = parseGrammar(raw, name);
        for (const r of [...p.rules, ...p.baseRules]) {
            allBodies.push(r.body);
        }
    } catch (e) {
        // skip
    }
}
console.log(`Loaded ${allBodies.length} bodies from ${files.length} files`);

// Dedup full bodies(baseline)
const fullBodyMap = new Map<string, number>();
for (const b of allBodies) {
    const fp = bodyToFp(b);
    fullBodyMap.set(fp, (fullBodyMap.get(fp) ?? 0) + 1);
}
const uniqueBodies = fullBodyMap.size;
console.log(`Unique full bodies: ${uniqueBodies}`);

// 计算当前 pool.txt 估算 raw size(每行 = body Lisp 文本 + '\n')
let baselinePoolBytes = 0;
for (const fp of fullBodyMap.keys()) baselinePoolBytes += fp.length + 1;
console.log(`Baseline pool.txt raw: ${(baselinePoolBytes / 1024).toFixed(1)} KB (${uniqueBodies} unique)`);

// ─────────────────────────────────────────────────────────────────
// 切片 spike — N=2/3/4/5
// ─────────────────────────────────────────────────────────────────

interface SliceResult {
    n: number;
    bodiesProcessed: number;       // 长度 >= 2N 的 body 数(其他保留 inline)
    prefixUnique: number;
    suffixUnique: number;
    midUnique: number;
    prefixPoolBytes: number;
    suffixPoolBytes: number;
    midPoolBytes: number;
    fallbackInlineBodies: number;  // body 太短 (< 2N) → 不切片,直接 inline
    fallbackInlineBytes: number;
    estimatedTotal: number;
    estimatedSavingPct: number;
}

function spikeN(N: number): SliceResult {
    const prefixMap = new Map<string, number>();
    const suffixMap = new Map<string, number>();
    const midMap = new Map<string, number>();
    let fallbackBodies = 0;
    let fallbackBytes = 0;
    let processedCount = 0;

    for (const fp of fullBodyMap.keys()) {
        // 重新解析 fp → body 不可行(我们要 GrammarToken[]) — 用 allBodies 但 fp dedup
        // 跑下面循环走原 body 数组
    }

    // 改:遍历 fullBodyMap 的 key 字符串 + 复原 body 数组
    // 实际上更简单:遍历 unique body 数组(我们存 unique 引用)
    const seenFps = new Set<string>();
    const uniqueBodyArr: GrammarToken[][] = [];
    for (const b of allBodies) {
        const fp = bodyToFp(b);
        if (!seenFps.has(fp)) {
            seenFps.add(fp);
            uniqueBodyArr.push(b);
        }
    }

    for (const body of uniqueBodyArr) {
        if (body.length < 2 * N) {
            // 太短不切,inline 保留
            fallbackBodies++;
            fallbackBytes += bodyToFp(body).length + 1;
            continue;
        }
        const prefix = body.slice(0, N);
        const suffix = body.slice(body.length - N);
        const mid = body.slice(N, body.length - N);
        const pfp = bodyToFp(prefix);
        const sfp = bodyToFp(suffix);
        const mfp = bodyToFp(mid);
        prefixMap.set(pfp, (prefixMap.get(pfp) ?? 0) + 1);
        suffixMap.set(sfp, (suffixMap.get(sfp) ?? 0) + 1);
        midMap.set(mfp, (midMap.get(mfp) ?? 0) + 1);
        processedCount++;
    }

    let prefixBytes = 0;
    for (const fp of prefixMap.keys()) prefixBytes += fp.length + 1;
    let suffixBytes = 0;
    for (const fp of suffixMap.keys()) suffixBytes += fp.length + 1;
    let midBytes = 0;
    for (const fp of midMap.keys()) midBytes += fp.length + 1;

    // 估算 per-grammar 文件大小:每 rule 需要 3 个 small int(prefixId/midId/suffixId)
    //   假设用 JSON `[p,m,s]` = ~10-15 bytes/rule 引用(vs 当前 bodyId 单 int ~6 bytes)
    //   多增 ~7 bytes/rule × 50,826 rule = ~350 KB(per-grammar 总增量)
    //   但 pool size 大幅减小,净收益 = pool 收益 - 引用增量
    const refOverheadBytes = 50826 * 7;  // 估算 50K rule × 7 bytes 额外引用开销

    const total = prefixBytes + suffixBytes + midBytes + fallbackBytes + refOverheadBytes;
    const savings = (1 - total / baselinePoolBytes) * 100;

    return {
        n: N,
        bodiesProcessed: processedCount,
        prefixUnique: prefixMap.size,
        suffixUnique: suffixMap.size,
        midUnique: midMap.size,
        prefixPoolBytes: prefixBytes,
        suffixPoolBytes: suffixBytes,
        midPoolBytes: midBytes,
        fallbackInlineBodies: fallbackBodies,
        fallbackInlineBytes: fallbackBytes,
        estimatedTotal: total,
        estimatedSavingPct: savings,
    };
}

const results = [spikeN(2), spikeN(3), spikeN(4), spikeN(5)];

// ─────────────────────────────────────────────────────────────────
// 输出报告
// ─────────────────────────────────────────────────────────────────

const lines: string[] = [];
const push = (s: string) => lines.push(s);

push('# Grammar Topology Spike — N-gram 三池切片实测');
push('');
push(`> 生成于 ${new Date().toISOString().slice(0, 10)} | 量化 C 方案(PREFIX/MID/SUFFIX 三池)真实收益`);
push('');
push('## 假设验证');
push('');
push(`audit 报告 N=4 head/tail flatten token 重叠率 99.8% / 92.7%,但实际 body 是 GrammarToken[](nested)。`);
push(`本 spike 按 **top-level GrammarToken** 切片量化 mid 部分唯一度 — 这是 C 方案收益的真实上限。`);
push('');
push('## 基线(当前 compiled pool.txt)');
push('');
push(`- 总 body 数(含重复):${allBodies.length}`);
push(`- 唯一 body:${uniqueBodies}`);
push(`- 现 pool.txt raw size: **${(baselinePoolBytes / 1024).toFixed(1)} KB**`);
push('');
push('## 切片维度对比(per N)');
push('');
push('| N | 切片 body | prefix池 | suffix池 | **mid池** | 太短回退 | 估算 total | 节省 |');
push('|---|---|---|---|---|---|---|---|');
for (const r of results) {
    const sizeKB = (n: number) => (n / 1024).toFixed(1);
    push(`| ${r.n} | ${r.bodiesProcessed} | ${r.prefixUnique}(${sizeKB(r.prefixPoolBytes)}KB) | ${r.suffixUnique}(${sizeKB(r.suffixPoolBytes)}KB) | **${r.midUnique}(${sizeKB(r.midPoolBytes)}KB)** | ${r.fallbackInlineBodies}(${sizeKB(r.fallbackInlineBytes)}KB) | ${sizeKB(r.estimatedTotal)}KB | ${r.estimatedSavingPct.toFixed(1)}% |`);
}
push('');

push('## 关键观察');
push('');
for (const r of results) {
    const midRatio = r.midUnique / r.bodiesProcessed * 100;
    push(`- **N=${r.n}**:`);
    push(`  - mid 唯一度 ${r.midUnique}/${r.bodiesProcessed} = **${midRatio.toFixed(1)}%**(${midRatio > 80 ? '极高 — mid 几乎 = body,切片收益小' : midRatio > 50 ? '高 — 但有部分共享' : '低 — 共享充分'})`);
    push(`  - prefix/suffix 池总 size:${((r.prefixPoolBytes + r.suffixPoolBytes) / 1024).toFixed(1)} KB(相对极小)`);
    push(`  - **真正决定 total size 的是 mid 池**`);
    push('');
}

push('## 结论 — C 方案值不值得做?');
push('');
push('- mid 唯一度 > 80% → C 收益 < 20%,**不值得做**(工程量大,reconstruct 复杂,听感风险)');
push('- mid 唯一度 50-80% → C 收益 20-50%,**可考虑**(权衡工程 vs 维护成本)');
push('- mid 唯一度 < 50% → C 收益 > 50%,**值得做**(audit 暗示的拓扑结构成立)');
push('');
push('数据填到 §"关键观察"自动判断。');

const md = lines.join('\n');
writeFileSync(OUTPUT_PATH, md);
console.log(`\nWrote ${OUTPUT_PATH}`);
console.log('\nQuick summary:');
for (const r of results) {
    const midRatio = (r.midUnique / r.bodiesProcessed * 100).toFixed(1);
    console.log(`  N=${r.n}: mid ${r.midUnique}/${r.bodiesProcessed} (${midRatio}%) | total ${(r.estimatedTotal / 1024).toFixed(0)} KB | saving ${r.estimatedSavingPct.toFixed(1)}%`);
}
