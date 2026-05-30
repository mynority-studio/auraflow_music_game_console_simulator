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
// ────────────────────────────────────────────────────────────
// 真理之源 vs 源:`grammars/*.grammar` 不是 runtime 真理之源
// ────────────────────────────────────────────────────────────
// 同目录下的 `grammars/*.grammar`(85 个 Impro-Visor 学术语料)只在
// build-time 被 `scripts/precompile-grammars.mjs` 读取,生成 ROM:
//
//   grammars/*.grammar  ──[precompile]──▶  grammars.rom (991 KB,嵌入式)
//                                          grammars-rom-bytes.ts (base64 inline,web)
//
// Runtime(web 浏览器 + 嵌入式)全部从 ROM 解码,**不再 import.meta.glob**
// 那 85 个文件。本文件末尾的 ALL_GRAMMAR_DATA_MAP 实际 re-export from
// `grammar-rom-reader.ts`(ROM decoder),parseGrammar 仍 export 供单条
// .grammar 文本 ad-hoc 解析(如 dev tools)用,生产链路不走 parseGrammar。
//
// 改 grammar 工作流(罕见,user 已声明"后续不需要改"):
//   1. 改 grammars/*.grammar
//   2. npm run precompile-grammars
//   3. npm run verify-grammars-rom    ← 必须 0 mismatch
//   4. 提交 .grammar + .rom + -bytes.ts
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
    /** (terminals ...) 声明的终结符字面(保序保重复);无声明 → []。引擎当前不消费,仅 ROM 无损保真 */
    terminals: string[];
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
    if (!isNaN(n) && /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return n;
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
        if (!isNaN(num) && /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(a)) {
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
    const terminals: string[] = [];
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
        // (terminals X2 X4 ... slope) — 保序保重复
        if (head === 'terminals') {
            for (let i = 1; i < list.length; i++) {
                const t = list[i];
                if (isAtom(t!)) terminals.push(t as string);
            }
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

    return { name, parameters, startSymbol, terminals, rules, baseRules, rulesByHead, baseRulesByHead, headSet };
}

// ─────────────────────────────────────────────────────────────────
// 全量 grammar lookup:从 precompile 出的 grammars.rom(无损二进制 ROM,
// build-time 由 scripts/precompile-grammars.mjs 生成)读取,而非启动时
// glob/parse 85 个 .grammar 文件。bundle 体积:4.7 MB Lisp text →
// 991 KB ROM(嵌入式预算内)+ base64 inline TS module(web 端 sync import)。
//
// parseGrammar(上面)仍 export — 单条 .grammar 文本 ad-hoc parse 场景
// (如 dev tools / 实验)仍可用,但生产链路全走 reader。
// ─────────────────────────────────────────────────────────────────
export { ALL_GRAMMAR_DATA_MAP, ALL_GRAMMAR_DATA_NAMES, getGrammarData } from './grammar-rom-reader';
