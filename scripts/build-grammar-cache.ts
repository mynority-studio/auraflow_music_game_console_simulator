// ============================================================
// build-grammar-cache.ts — build-time 编译 .grammar → compiled JSON + pool
// ============================================================
//
// 用法:npx tsx scripts/build-grammar-cache.ts
// 输出:public/grammars-compiled/
//   - pool.txt                        全局 body 池(行 = bodyId,Lisp 文本紧凑)
//   - <grammar-name>.json × 82        per-grammar compact(bodyId 索引 pool)
//   - index.json                      路径清单 + meta
//
// 策略(切片化第一步 — 增量版):
//   - 跨 grammar 提取所有 rule 的 body 字面去重 → 全局 body 池
//   - 池用 Lisp 文本格式(\n 分隔,行 = bodyId)— 比 JSON token array 紧凑 ~2x
//   - per-grammar JSON 的 rule 仅存 { bodyId, head, params?, headFixedArg?, builtin?, weight, isBase? }
//   - 听感 bit-exact:GrammarData reconstruct 后 PCFG runner 输入零变化
//
// 输入:public/grammars/*.grammar(85 个)
// 预估缩减:4.7MB → ~1.2MB(~75%)
// ============================================================

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { parseGrammar, type GrammarToken, type GrammarRule } from '../src/core/generation/improCore/data/grammar-parser';

const SRC_DIR = 'data/grammars';
const OUT_DIR = 'public/grammars-compiled';

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function tokenToStr(t: GrammarToken): string {
    if (typeof t === 'string') return t;
    return '(' + t.map(tokenToStr).join(' ') + ')';
}
function bodyToFingerprint(body: GrammarToken[]): string {
    return body.map(tokenToStr).join(' ');
}

// ─────────────────────────────────────────────────────────────────
// Compiled JSON 格式 v2(2026-05-26 Step 8.2:short keys + 默认值省略)
// ─────────────────────────────────────────────────────────────────
//
// 紧凑 schema 设计:
//   - short keys:h/b/w/a/p/ib/bn(对应 head/bodyId/weight/headFixedArg/params/isBase/builtinName)
//   - 默认值省略:
//       w=1.0   → 省(grammar 中 default weight 比例极高)
//       ib=false → 省(只 base rule 标 ib:1)
//       a=undefined → 省(只 BRICK rule 有 headFixedArg)
//       p=[]    → 省(只 P Y / Q Y 类 recursive rule 有 params)
//       bn=undefined → 省(只 BRICK rule 有 builtin)
//   - builtin.type 总是 'brick' 在所有 grammar 文件 → 不存,reconstruct 时硬编

interface CompactRuleV2 {
    h: string;
    b: number;
    w?: number;
    a?: number;
    p?: string[];
    ib?: 1;
    bn?: string;
}

interface CompactGrammarV2 {
    v: 2;
    n: string;       // name
    p: Array<[string, string | number | boolean]>;  // parameters
    s: string;       // startSymbol
    r: CompactRuleV2[];     // rules
    br: CompactRuleV2[];    // baseRules
}

interface CompiledIndex {
    version: 2;
    grammars: string[];
    poolBodyCount: number;
    builtAt: string;
}

// ─────────────────────────────────────────────────────────────────
// Phase 1: parse all + collect unique bodies(全 rule 范围)
// ─────────────────────────────────────────────────────────────────

console.log('Phase 1: parse all grammars + dedup ALL rule bodies');

const files = readdirSync(SRC_DIR).filter(f => f.endsWith('.grammar')).sort();
const fpToBodyId = new Map<string, number>();
const bodyFingerprints: string[] = [];   // index = bodyId, value = Lisp 字符串

interface ParsedEntry {
    name: string;
    parsed: ReturnType<typeof parseGrammar>;
}
const parsed: ParsedEntry[] = [];

let parseFailures = 0;
let totalRulesSeen = 0;
for (const f of files) {
    const raw = readFileSync(join(SRC_DIR, f), 'utf8');
    const name = f.replace(/\.grammar$/, '');
    try {
        const p = parseGrammar(raw, name);
        parsed.push({ name, parsed: p });
        for (const r of [...p.rules, ...p.baseRules]) {
            totalRulesSeen++;
            const fp = bodyToFingerprint(r.body);
            if (!fpToBodyId.has(fp)) {
                fpToBodyId.set(fp, bodyFingerprints.length);
                bodyFingerprints.push(fp);
            }
        }
    } catch (e) {
        parseFailures++;
        console.warn(`parse failed: ${name}`);
    }
}
console.log(`  Parsed: ${parsed.length}/${files.length} (failures: ${parseFailures})`);
console.log(`  Total rules: ${totalRulesSeen}`);
console.log(`  Unique bodies (全 rule 去重): ${bodyFingerprints.length}`);
console.log(`  Dedup rate: ${((1 - bodyFingerprints.length / totalRulesSeen) * 100).toFixed(1)}%`);

// ─────────────────────────────────────────────────────────────────
// Phase 2: write pool.txt(行 = bodyId,Lisp 文本)
// ─────────────────────────────────────────────────────────────────

console.log('Phase 2: write pool.txt + compiled grammars');

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

// pool.txt:每行一个 body。注意 body 内部不含 \n(parseGrammar 已 flatten),所以 \n 分隔安全。
const poolText = bodyFingerprints.join('\n') + '\n';
writeFileSync(join(OUT_DIR, 'pool.txt'), poolText);
console.log(`  pool.txt: ${(poolText.length / 1024).toFixed(1)} KB (${bodyFingerprints.length} bodies)`);

// ─────────────────────────────────────────────────────────────────
// Phase 3: write per-grammar compiled JSON
// ─────────────────────────────────────────────────────────────────

function compileRule(r: GrammarRule): CompactRuleV2 {
    const fp = bodyToFingerprint(r.body);
    const bodyId = fpToBodyId.get(fp);
    if (bodyId === undefined) throw new Error(`internal: rule body not in pool: ${fp.slice(0, 60)}`);
    const out: CompactRuleV2 = {
        h: r.head,
        b: bodyId,
    };
    // 默认值省略 — 极大幅 raw size 缩减
    if (r.weight !== 1.0) out.w = r.weight;
    if (r.headFixedArg !== undefined) out.a = r.headFixedArg;
    if (r.params.length > 0) out.p = r.params;
    if (r.isBase) out.ib = 1;
    // builtin.type 在 grammar 文件中始终 'brick',只存 name
    if (r.builtin) out.bn = r.builtin.name;
    return out;
}

let totalGrammarJsonSize = 0;
for (const { name, parsed: p } of parsed) {
    const compiled: CompactGrammarV2 = {
        v: 2,
        n: name,
        p: [...p.parameters.entries()],
        s: p.startSymbol,
        r: p.rules.map(compileRule),
        br: p.baseRules.map(compileRule),
    };
    const json = JSON.stringify(compiled);
    writeFileSync(join(OUT_DIR, `${name}.json`), json);
    totalGrammarJsonSize += json.length;
}
console.log(`  per-grammar JSON: ${(totalGrammarJsonSize / 1024).toFixed(1)} KB total (${parsed.length} files, avg ${(totalGrammarJsonSize / parsed.length / 1024).toFixed(1)} KB)`);

// ─────────────────────────────────────────────────────────────────
// Phase 4: index.json
// ─────────────────────────────────────────────────────────────────

const index: CompiledIndex = {
    version: 2,
    grammars: parsed.map(e => e.name).sort(),
    poolBodyCount: bodyFingerprints.length,
    builtAt: new Date().toISOString(),
};
const indexJson = JSON.stringify(index, null, 2) + '\n';
writeFileSync(join(OUT_DIR, 'index.json'), indexJson);
console.log(`  index.json: ${indexJson.length} bytes`);

// ─────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────

const totalOut = poolText.length + totalGrammarJsonSize + indexJson.length;
let totalSrc = 0;
for (const f of files) totalSrc += readFileSync(join(SRC_DIR, f), 'utf8').length;

console.log('\n=== Compile Summary ===');
console.log(`Source .grammar total:   ${(totalSrc / 1024).toFixed(1)} KB`);
console.log(`Compiled total:          ${(totalOut / 1024).toFixed(1)} KB`);
console.log(`  - pool.txt:            ${(poolText.length / 1024).toFixed(1)} KB`);
console.log(`  - per-grammar JSON:    ${(totalGrammarJsonSize / 1024).toFixed(1)} KB`);
console.log(`  - index.json:          ${(indexJson.length / 1024).toFixed(1)} KB`);
console.log(`Reduction:               ${((1 - totalOut / totalSrc) * 100).toFixed(1)}%`);
console.log(`Output: ${OUT_DIR}/`);
