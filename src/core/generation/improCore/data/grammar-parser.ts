// ============================================================
// grammar-parser.ts — Impro-Visor .grammar Lisp → GrammarData
// ============================================================
//
// 解析 Impro-Visor .grammar 文件(Lisp PCFG)成结构化 GrammarData:
//
//   (parameter (use-grammar true))
//   (parameter (chord-tone-weight 0.7))
//   (parameter (leap-prob 0.01))
//   ...
//   (startsymbol P)
//   (base (P 0) () 1.0)                                ← termination rule
//   (rule (P Y) (Seg1 (P (- Y 120))) 1)                ← recursive 参数化
//   (rule (Seg1) (C4) 1.0)                             ← terminal rule
//   (rule (BRICK 1920) ((slope ...) ...) (builtin brick Sad-Cadence) 1.0)
//
// 输出 GrammarData(后续 Step 2-4 给 grammar runner 用)。
//
// Step 1 仅 parse,不 run。
// ============================================================

import type { Polylist } from './polylist';
import { isAtom, isList } from './polylist';
import { readMultiSexpr } from './sexpr-reader';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** Grammar token — atom string 或 nested list(含 (slope ...) / (X N) / (- Y N) 等)*/
export type GrammarToken = string | GrammarToken[];

export interface GrammarRule {
    /** LHS head non-terminal,如 'P' / 'Seg1' / 'BRICK' / 'Motif_X' */
    head: string;
    /** LHS 参数变量,如 (P Y) → ['Y'](通常 0-1 个) */
    params: string[];
    /** RHS body tokens(含 nested expressions) */
    body: GrammarToken[];
    /** rule weight(weighted random pick),base rule 中此字段通常 1 */
    weight: number;
    /** 可选 (builtin brick Sad-Cadence) marker */
    builtin?: { type: string; name: string };
    /** rule LHS 头部第一个字面参数(用于 BRICK 长度匹配:(BRICK 1920) → 1920)*/
    headFixedArg?: number;
    /** 是 base rule(terminator):fire 当 head 参数满足条件(如 Y === 0)*/
    isBase?: boolean;
}

export interface GrammarData {
    /** Grammar 名(从 filename 抽,无 .grammar 后缀)*/
    name: string;
    /** Parameter 字典 — chord-tone-weight / leap-prob / etc */
    parameters: Map<string, string | number | boolean>;
    /** Start symbol(典型 'P' / 'P_motif')*/
    startSymbol: string;
    /** Recursive rules(weighted random pick by head match) */
    rules: GrammarRule[];
    /** Base rules(termination conditions — Y === 0 等)*/
    baseRules: GrammarRule[];
    /** Step 5+ 性能:rules indexed by head name(O(1) lookup,替代 O(N) filter)*/
    rulesByHead: ReadonlyMap<string, ReadonlyArray<GrammarRule>>;
    /** Step 5+ 性能:base rules indexed by head name */
    baseRulesByHead: ReadonlyMap<string, ReadonlyArray<GrammarRule>>;
    /** Step 5+ 性能:non-terminal head 集合(grammar.rules + baseRules 合集)— rule invocation 判定 */
    headSet: ReadonlySet<string>;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function atomToValue(s: string): string | number | boolean {
    if (s === 'true') return true;
    if (s === 'false') return false;
    const n = parseFloat(s);
    if (!isNaN(n) && /^-?\d+(\.\d+)?$/.test(s)) return n;
    return s;
}

/**
 * 解析 head:`(P Y)` → { head: 'P', params: ['Y'], headFixedArg: undefined }
 *                 `(P)` → { head: 'P', params: [] }
 *                 `(P 0)` → { head: 'P', params: [], headFixedArg: 0 }
 *                 `(BRICK 1920)` → { head: 'BRICK', params: [], headFixedArg: 1920 }
 */
function parseHead(headList: Polylist): { head: string; params: string[]; headFixedArg?: number } {
    if (headList.length === 0) throw new Error('Empty head');
    const head = headList[0];
    if (!isAtom(head)) throw new Error('Head must be atom');
    const params: string[] = [];
    let headFixedArg: number | undefined;
    for (let i = 1; i < headList.length; i++) {
        const a = headList[i];
        if (!isAtom(a)) continue;
        const num = parseFloat(a);
        if (!isNaN(num) && /^-?\d+(\.\d+)?$/.test(a)) {
            // 字面数字 → headFixedArg(rule 的 head 含 literal arg,如 (BRICK 1920))
            headFixedArg = num;
        } else {
            // 变量(如 Y)→ params
            params.push(a);
        }
    }
    return { head, params, headFixedArg };
}

/**
 * 提取 (builtin brick Name) marker(从 rule 列表里找)。
 * 返 marker + 移除 marker 后的剩余 children。
 */
function extractBuiltin(children: Polylist): { builtin?: { type: string; name: string }; rest: (string | Polylist)[] } {
    const rest: (string | Polylist)[] = [];
    let builtin: { type: string; name: string } | undefined;
    for (const child of children) {
        if (isList(child) && child.length >= 3 && isAtom(child[0]!) && child[0] === 'builtin') {
            const typeStr = isAtom(child[1]!) ? (child[1] as string) : '';
            const nameStr = isAtom(child[2]!) ? (child[2] as string) : '';
            builtin = { type: typeStr, name: nameStr };
        } else {
            rest.push(child);
        }
    }
    return { builtin, rest };
}

// ─────────────────────────────────────────────────────────────────
// Main parser
// ─────────────────────────────────────────────────────────────────

/**
 * Parse Impro-Visor .grammar 文本 → GrammarData。
 *
 * @param src   Lisp source 文本
 * @param name  Grammar 名(从 filename 抽)
 * @throws Error 解析失败
 */
export function parseGrammar(src: string, name: string): GrammarData {
    const lists = readMultiSexpr(src);
    const parameters = new Map<string, string | number | boolean>();
    let startSymbol = 'P';
    const rules: GrammarRule[] = [];
    const baseRules: GrammarRule[] = [];

    for (const list of lists) {
        if (list.length < 1) continue;
        const head = list[0];
        if (!isAtom(head)) continue;

        // (parameter (key value))
        if (head === 'parameter' && list.length >= 2) {
            const paramList = list[1];
            if (isList(paramList) && paramList.length >= 2) {
                const key = paramList[0];
                const value = paramList[1];
                if (isAtom(key) && isAtom(value)) {
                    parameters.set(key, atomToValue(value));
                }
            }
            continue;
        }
        // (startsymbol Name)
        if (head === 'startsymbol' && list.length >= 2 && isAtom(list[1]!)) {
            startSymbol = list[1] as string;
            continue;
        }
        // (rule (head args) (body) weight) 或 (rule (head args) (body) (builtin ...) weight)
        // (base (head args) (body) weight)
        if ((head === 'rule' || head === 'base') && list.length >= 3) {
            const headPart = list[1];
            const bodyPart = list[2];
            if (!isList(headPart) || !isList(bodyPart)) continue;

            // children after head + body:可能含 (builtin ...) + weight
            const tailParts: (string | Polylist)[] = [];
            for (let i = 3; i < list.length; i++) tailParts.push(list[i]!);
            const { builtin, rest: weightOnly } = extractBuiltin(tailParts);
            // 剩 1 个 atom(weight)
            let weight = 1;
            if (weightOnly.length > 0) {
                const w = weightOnly[0];
                if (isAtom(w!)) {
                    const n = parseFloat(w as string);
                    if (!isNaN(n)) weight = n;
                }
            }

            const { head: ruleHead, params, headFixedArg } = parseHead(headPart);
            const ruleObj: GrammarRule = {
                head: ruleHead,
                params,
                body: bodyPart as GrammarToken[],
                weight,
                builtin,
                headFixedArg,
                isBase: head === 'base',
            };
            if (head === 'base') baseRules.push(ruleObj);
            else rules.push(ruleObj);
        }
    }

    // Step 5+ 性能:预 index by head name(O(1) lookup,避免 every-call linear filter)
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

    return { name, parameters, startSymbol, rules, baseRules, rulesByHead, baseRulesByHead, headSet };
}

// ─────────────────────────────────────────────────────────────────
// Lazy fetch + 内存 cache + compiled JSON 格式(2026-05-26)
// ─────────────────────────────────────────────────────────────────
//
// 改造历史:
//   v1(2026-05-26 早):eager glob → lazy fetch .grammar Lisp 文本
//   v2(2026-05-26 晚):lazy fetch compiled JSON(pool.txt + per-grammar JSON)
//                    body 全 rule 去重共享 pool,per-grammar 仅存 bodyId 引用
//                    为后续"musician 风格融合 / persona 控制"建索引基础设施
//
// 数据源:public/grammars-compiled/(由 scripts/build-grammar-cache.ts 生成)
//   - pool.txt              全局 body 池(行 = bodyId,Lisp 文本)
//   - <name>.json × 82      per-grammar compact(bodyId 索引 pool)
//   - index.json            grammar 名列表 + meta
//
// API(对外):
//   loadGrammarByName(name): Promise<GrammarData>  — fetch compiled + reconstruct + cache
//   getCachedGrammar(name):  GrammarData | undefined — 同步 cache 读(给 lick-gen 用)
//   loadGrammarIndex():      Promise<string[]>       — fetch index.json
//   getCachedGrammarNames(): string[]                — 同步取已 fetch 的 index
//
// reconstruct 后 GrammarData 跟 v1 parseGrammar 输出语义完全一致 — PCFG runner 零修改。

import { readSexpr } from './sexpr-reader';

// Compiled JSON 格式 — 与 scripts/build-grammar-cache.ts 同步
interface CompiledRule {
    head: string;
    params?: string[];
    headFixedArg?: number;
    bodyId: number;
    weight: number;
    isBase?: boolean;
    builtin?: { type: string; name: string };
}
interface CompiledGrammar {
    version: 1;
    name: string;
    parameters: Array<[string, string | number | boolean]>;
    startSymbol: string;
    rules: CompiledRule[];
    baseRules: CompiledRule[];
}
interface CompiledIndex {
    version: 1;
    grammars: string[];
    poolBodyCount: number;
    builtAt: string;
}

const _grammarCache = new Map<string, GrammarData>();
const _grammarInflight = new Map<string, Promise<GrammarData>>();
let _grammarNames: string[] | null = null;
let _grammarNamesInflight: Promise<string[]> | null = null;
let _bodyPool: readonly GrammarToken[][] | null = null;
let _bodyPoolInflight: Promise<readonly GrammarToken[][]> | null = null;

function compiledGrammarUrl(name: string): string {
    const base = import.meta.env.BASE_URL ?? '/';
    return `${base}grammars-compiled/${name}.json`;
}
function poolUrl(): string {
    const base = import.meta.env.BASE_URL ?? '/';
    return `${base}grammars-compiled/pool.txt`;
}
function indexUrl(): string {
    const base = import.meta.env.BASE_URL ?? '/';
    return `${base}grammars-compiled/index.json`;
}

/** Fetch + parse pool.txt(全局共享 body 池)。idempotent + dedup。 */
async function loadBodyPool(): Promise<readonly GrammarToken[][]> {
    if (_bodyPool) return _bodyPool;
    if (_bodyPoolInflight) return _bodyPoolInflight;

    _bodyPoolInflight = (async () => {
        const resp = await fetch(poolUrl());
        if (!resp.ok) {
            _bodyPoolInflight = null;
            throw new Error(`[ImproCore] body pool fetch failed (HTTP ${resp.status})`);
        }
        const text = await resp.text();
        // pool.txt 末尾固定有 trailing \n,先剔掉;中间空行 = 空 body(合法,如 base rule (base (P 0) () weight))
        const trimmed = text.endsWith('\n') ? text.slice(0, -1) : text;
        const lines = trimmed.split('\n');
        const bodies: GrammarToken[][] = [];
        for (const line of lines) {
            // wrap 整行成 list → readSexpr 返单 Polylist = GrammarToken[]
            const wrapped = readSexpr(`(${line})`) as GrammarToken[];
            bodies.push(wrapped);
        }
        _bodyPool = bodies;
        return bodies;
    })();
    return _bodyPoolInflight;
}

/** Reconstruct GrammarData from compiled JSON + 共享 pool。语义与 parseGrammar 输出一致。 */
function reconstructGrammarData(compiled: CompiledGrammar, pool: readonly GrammarToken[][]): GrammarData {
    function expandRule(r: CompiledRule): GrammarRule {
        const body = pool[r.bodyId];
        if (!body) throw new Error(`[ImproCore] bodyId ${r.bodyId} out of pool (size ${pool.length})`);
        return {
            head: r.head,
            params: r.params ?? [],
            body,
            weight: r.weight,
            builtin: r.builtin,
            headFixedArg: r.headFixedArg,
            isBase: r.isBase ?? false,
        };
    }
    const rules = compiled.rules.map(expandRule);
    const baseRules = compiled.baseRules.map(expandRule);

    // 重建 head 索引(与 parseGrammar 同逻辑)
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
        name: compiled.name,
        parameters: new Map(compiled.parameters),
        startSymbol: compiled.startSymbol,
        rules,
        baseRules,
        rulesByHead,
        baseRulesByHead,
        headSet,
    };
}

/** Fetch compiled grammar JSON + pool → reconstruct GrammarData + cache。同 name 命中 cache / inflight。 */
export async function loadGrammarByName(name: string): Promise<GrammarData> {
    const cached = _grammarCache.get(name);
    if (cached) return cached;
    const inflight = _grammarInflight.get(name);
    if (inflight) return inflight;

    const p = (async () => {
        const [pool, resp] = await Promise.all([
            loadBodyPool(),
            fetch(compiledGrammarUrl(name)),
        ]);
        if (!resp.ok) {
            _grammarInflight.delete(name);
            throw new Error(`[ImproCore] compiled grammar fetch failed: ${name} (HTTP ${resp.status})`);
        }
        const compiled = await resp.json() as CompiledGrammar;
        const data = reconstructGrammarData(compiled, pool);
        _grammarCache.set(name, data);
        _grammarInflight.delete(name);
        return data;
    })();
    _grammarInflight.set(name, p);
    return p;
}

/** 同步 cache 读 — 给 lick-gen.ts 之类的同步消费方用。cache miss 返 undefined。 */
export function getCachedGrammar(name: string): GrammarData | undefined {
    return _grammarCache.get(name);
}

/** Fetch + cache index.json(grammar 名列表)。idempotent。 */
export async function loadGrammarIndex(): Promise<string[]> {
    if (_grammarNames) return _grammarNames;
    if (_grammarNamesInflight) return _grammarNamesInflight;

    _grammarNamesInflight = (async () => {
        const resp = await fetch(indexUrl());
        if (!resp.ok) {
            _grammarNamesInflight = null;
            throw new Error(`[ImproCore] grammar index fetch failed (HTTP ${resp.status})`);
        }
        const json = await resp.json() as CompiledIndex;
        _grammarNames = [...json.grammars];
        return _grammarNames;
    })();
    return _grammarNamesInflight;
}

/** 同步取已 fetch 的 grammar 名列表(给 UI dropdown 用,初始 [])。 */
export function getCachedGrammarNames(): ReadonlyArray<string> {
    return _grammarNames ?? [];
}

/** @deprecated 旧 API 兼容 — 改用 getCachedGrammar(同语义,同步从 cache 读)。 */
export function getGrammarData(name: string): GrammarData | undefined {
    return _grammarCache.get(name);
}
