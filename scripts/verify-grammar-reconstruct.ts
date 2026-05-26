// ============================================================
// verify-grammar-reconstruct.ts — bit-exact 验证 compiled reconstruct vs parseGrammar
// ============================================================
//
// 用法:npx tsx scripts/verify-grammar-reconstruct.ts
//
// 比对两条路径输出的 GrammarData 字段:
//   路径 1:parseGrammar(.grammar source 文本)
//   路径 2:fetch compiled JSON + pool → reconstruct
//
// 若字段完全相等(rules / baseRules / parameters / startSymbol / rulesByHead / headSet)
// → PCFG runner 输入零变化 → 同 seed bit-exact 输出有保证。
//
// 不能完全跑 runtime fetch(node 环境无 fetch),所以直接读 fs。
// 模拟 reconstructGrammarData 逻辑。
// ============================================================

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parseGrammar, type GrammarData, type GrammarToken, type GrammarRule } from '../src/core/generation/improCore/data/grammar-parser';
import { readSexpr } from '../src/core/generation/improCore/data/sexpr-reader';

const SRC_DIR = 'data/grammars';
const COMPILED_DIR = 'public/grammars-compiled';

// ─────────────────────────────────────────────────────────────────
// 复制 grammar-parser.ts 里的 reconstruct 逻辑(node 端无法 fetch)
// ─────────────────────────────────────────────────────────────────

// Compact v2 schema(short keys + 默认值省略)
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
    n: string;
    p: Array<[string, string | number | boolean]>;
    s: string;
    r: CompactRuleV2[];
    br: CompactRuleV2[];
}

function loadBodyPool(): GrammarToken[][] {
    const text = readFileSync(join(COMPILED_DIR, 'pool.txt'), 'utf8');
    const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
    const lines = trimmed.split('\n');
    const bodies: GrammarToken[][] = [];
    for (const line of lines) {
        const wrapped = readSexpr(`(${line})`) as GrammarToken[];
        bodies.push(wrapped);
    }
    return bodies;
}

function reconstructGrammarData(compiled: CompactGrammarV2, pool: GrammarToken[][]): GrammarData {
    function expandRule(r: CompactRuleV2): GrammarRule {
        const body = pool[r.b];
        if (!body) throw new Error(`bodyId ${r.b} out of pool (size ${pool.length})`);
        return {
            head: r.h,
            params: r.p ?? [],
            body,
            weight: r.w ?? 1.0,
            builtin: r.bn !== undefined ? { type: 'brick', name: r.bn } : undefined,
            headFixedArg: r.a,
            isBase: r.ib === 1,
        };
    }
    const rules = compiled.r.map(expandRule);
    const baseRules = compiled.br.map(expandRule);
    const rulesByHead = new Map<string, GrammarRule[]>();
    const baseRulesByHead = new Map<string, GrammarRule[]>();
    const headSet = new Set<string>();
    for (const r of rules) {
        let arr = rulesByHead.get(r.head);
        if (!arr) { arr = []; rulesByHead.set(r.head, arr); }
        arr.push(r);
        headSet.add(r.head);
    }
    for (const r of baseRules) {
        let arr = baseRulesByHead.get(r.head);
        if (!arr) { arr = []; baseRulesByHead.set(r.head, arr); }
        arr.push(r);
        headSet.add(r.head);
    }
    return {
        name: compiled.n,
        parameters: new Map(compiled.p),
        startSymbol: compiled.s,
        rules,
        baseRules,
        rulesByHead,
        baseRulesByHead,
        headSet,
    };
}

// ─────────────────────────────────────────────────────────────────
// 字段级比对
// ─────────────────────────────────────────────────────────────────

function tokenEqual(a: GrammarToken, b: GrammarToken): boolean {
    if (typeof a === 'string' && typeof b === 'string') return a === b;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!tokenEqual(a[i]!, b[i]!)) return false;
        }
        return true;
    }
    return false;
}

function bodyEqual(a: readonly GrammarToken[], b: readonly GrammarToken[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (!tokenEqual(a[i]!, b[i]!)) return false;
    }
    return true;
}

function ruleEqual(a: GrammarRule, b: GrammarRule): string | null {
    if (a.head !== b.head) return `head: ${a.head} vs ${b.head}`;
    if (a.weight !== b.weight) return `weight: ${a.weight} vs ${b.weight}`;
    if (a.headFixedArg !== b.headFixedArg) return `headFixedArg: ${a.headFixedArg} vs ${b.headFixedArg}`;
    if ((a.isBase ?? false) !== (b.isBase ?? false)) return `isBase: ${a.isBase} vs ${b.isBase}`;
    if (a.params.length !== b.params.length) return `params.length: ${a.params.length} vs ${b.params.length}`;
    for (let i = 0; i < a.params.length; i++) {
        if (a.params[i] !== b.params[i]) return `params[${i}]: ${a.params[i]} vs ${b.params[i]}`;
    }
    const ab = a.builtin, bb = b.builtin;
    if ((ab?.type ?? null) !== (bb?.type ?? null)) return `builtin.type`;
    if ((ab?.name ?? null) !== (bb?.name ?? null)) return `builtin.name`;
    if (!bodyEqual(a.body, b.body)) return `body mismatch`;
    return null;
}

// ─────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────

const pool = loadBodyPool();
console.log(`Loaded pool: ${pool.length} bodies`);

const compiledFiles = readdirSync(COMPILED_DIR).filter(f => f.endsWith('.json') && f !== 'index.json').sort();
console.log(`Verifying ${compiledFiles.length} grammars...`);

let ok = 0;
let failed = 0;
const failures: Array<{ name: string; reason: string }> = [];

for (const f of compiledFiles) {
    const name = f.replace(/\.json$/, '');
    const srcPath = join(SRC_DIR, `${name}.grammar`);
    let dataSrc: GrammarData;
    try {
        const raw = readFileSync(srcPath, 'utf8');
        dataSrc = parseGrammar(raw, name);
    } catch (e) {
        failed++;
        failures.push({ name, reason: 'parseGrammar source failed: ' + (e instanceof Error ? e.message : String(e)) });
        continue;
    }

    const compiledRaw = readFileSync(join(COMPILED_DIR, f), 'utf8');
    const compiled = JSON.parse(compiledRaw) as CompactGrammarV2;
    const dataRecon = reconstructGrammarData(compiled, pool);

    // 比较字段
    let mismatch: string | null = null;
    if (dataSrc.name !== dataRecon.name) mismatch = `name`;
    else if (dataSrc.startSymbol !== dataRecon.startSymbol) mismatch = `startSymbol`;
    else if (dataSrc.parameters.size !== dataRecon.parameters.size) mismatch = `parameters.size: ${dataSrc.parameters.size} vs ${dataRecon.parameters.size}`;
    else if (dataSrc.rules.length !== dataRecon.rules.length) mismatch = `rules.length: ${dataSrc.rules.length} vs ${dataRecon.rules.length}`;
    else if (dataSrc.baseRules.length !== dataRecon.baseRules.length) mismatch = `baseRules.length: ${dataSrc.baseRules.length} vs ${dataRecon.baseRules.length}`;
    else if (dataSrc.headSet.size !== dataRecon.headSet.size) mismatch = `headSet.size: ${dataSrc.headSet.size} vs ${dataRecon.headSet.size}`;

    if (!mismatch) {
        // 比较 parameters 内容
        for (const [k, v] of dataSrc.parameters) {
            if (dataRecon.parameters.get(k) !== v) {
                mismatch = `parameters.${k}: ${v} vs ${dataRecon.parameters.get(k)}`;
                break;
            }
        }
    }

    if (!mismatch) {
        // 比较 rules
        for (let i = 0; i < dataSrc.rules.length; i++) {
            const r = ruleEqual(dataSrc.rules[i]!, dataRecon.rules[i]!);
            if (r) { mismatch = `rules[${i}]: ${r}`; break; }
        }
    }
    if (!mismatch) {
        // 比较 baseRules
        for (let i = 0; i < dataSrc.baseRules.length; i++) {
            const r = ruleEqual(dataSrc.baseRules[i]!, dataRecon.baseRules[i]!);
            if (r) { mismatch = `baseRules[${i}]: ${r}`; break; }
        }
    }

    if (mismatch) {
        failed++;
        failures.push({ name, reason: mismatch });
    } else {
        ok++;
    }
}

console.log('\n=== Verification Summary ===');
console.log(`PASSED: ${ok}/${compiledFiles.length}`);
console.log(`FAILED: ${failed}`);
if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures.slice(0, 10)) {
        console.log(`  ${f.name}: ${f.reason}`);
    }
    if (failures.length > 10) console.log(`  ... (+${failures.length - 10} more)`);
    process.exit(1);
}
console.log('All grammars reconstruct bit-exact ✓');
