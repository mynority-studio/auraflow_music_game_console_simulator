// ============================================================
// grammar-runner.ts — Impro-Visor 完整 PCFG runner
// ============================================================
//
// 升级版 grammar runner,支持完整 Impro-Visor .grammar 语义:
//   - 参数化 head((P Y) — Y = remaining slots)
//   - 数学求值((- Y 120) / (+ Y N))
//   - base rule termination(fire when Y <= 0)
//   - parameter consumer(chord-tone-weight / leap-prob 注入 NoteChooser)
//   - share/unshare motif state(Step 3 加)
//   - fill operator(Step 3 加)
//   - BRICK lookup(Step 4 加)
//
// 输入:GrammarData(parsed grammar)+ totalSlots(目标长度,典型 Y 起始值)
// 输出:GrammarToken[] terminal 序列(C8 / L16 / R8 / (X 4 8) / (slope ...) 等)
//      给现有 chooseNote 消费
//
// 共识 2 D-5 deterministic — 用 AF2 Random class
// ============================================================

import type { Random } from '../../af2-engine/utils/Random';
import type { GrammarData, GrammarRule, GrammarToken } from '../data/grammar-parser';

// ─────────────────────────────────────────────────────────────────
// Math evaluator(对 (- Y 120) / (+ Y N) 等数学表达式求值)
// ─────────────────────────────────────────────────────────────────

/**
 * 在变量 binding 下求值 expression。
 *   atom string "Y" → bindings.get('Y')
 *   atom number "120" → 120
 *   list (- Y 120) → eval(Y) - 120
 *   list (+ Y 100) → eval(Y) + 100
 *   list (* Y 2)   → eval(Y) * 2
 *   list (/ Y 2)   → eval(Y) / 2
 *   其他 list → undefined(不能求值,留给后续 runner 处理)
 */
function evalExpr(expr: GrammarToken, bindings: Map<string, number>): number | undefined {
    if (typeof expr === 'string') {
        const n = parseFloat(expr);
        if (!isNaN(n)) return n;
        return bindings.get(expr);
    }
    // list
    if (expr.length < 1) return undefined;
    const op = expr[0];
    if (typeof op !== 'string') return undefined;
    if (op === '-' || op === '+' || op === '*' || op === '/') {
        // (op a b c ...)
        let acc: number | undefined;
        for (let i = 1; i < expr.length; i++) {
            const v = evalExpr(expr[i]!, bindings);
            if (v === undefined) return undefined;
            if (acc === undefined) acc = v;
            else {
                if (op === '-') acc -= v;
                else if (op === '+') acc += v;
                else if (op === '*') acc *= v;
                else if (op === '/') acc = v !== 0 ? acc / v : acc;
            }
        }
        return acc;
    }
    return undefined;
}

// ─────────────────────────────────────────────────────────────────
// Rule matching
// ─────────────────────────────────────────────────────────────────

/**
 * 找匹配 (head, arg) 的所有 rules(base + rules)。
 *   head match 必须严格相等
 *   headFixedArg(如 (BRICK 1920))必须匹配传入的 arg
 *   params(如 (P Y))接受 — 把 arg bind 到 params[0]
 *
 * 返:[(rule, bindings)]。base rules 排在前(优先 termination match)。
 */
function findMatchingRules(
    grammar: GrammarData,
    head: string,
    arg: number | undefined,
): Array<{ rule: GrammarRule; bindings: Map<string, number> }> {
    const out: Array<{ rule: GrammarRule; bindings: Map<string, number> }> = [];

    // base rules first(termination 优先)
    for (const rule of grammar.baseRules) {
        if (rule.head !== head) continue;
        // base rule 的 headFixedArg 一般是固定数值(如 (P 0)),要严格 match arg
        if (rule.headFixedArg !== undefined && rule.headFixedArg !== arg) continue;
        // base rule 无 params(典型 (P 0) 没变量),不 bind
        out.push({ rule, bindings: new Map() });
    }

    // recursive rules
    for (const rule of grammar.rules) {
        if (rule.head !== head) continue;
        // headFixedArg match
        if (rule.headFixedArg !== undefined && rule.headFixedArg !== arg) continue;
        // params bind:(P Y) 期待传入 arg,绑给 Y
        const bindings = new Map<string, number>();
        if (rule.params.length > 0 && arg !== undefined) {
            bindings.set(rule.params[0]!, arg);
        }
        out.push({ rule, bindings });
    }
    return out;
}

/** 在 [rules] 内 weighted random pick 1 个 */
function pickWeightedRule(
    matches: Array<{ rule: GrammarRule; bindings: Map<string, number> }>,
    rng: Random,
): { rule: GrammarRule; bindings: Map<string, number> } | undefined {
    if (matches.length === 0) return undefined;
    const total = matches.reduce((s, m) => s + m.rule.weight, 0);
    if (total <= 0) return matches[0]!;
    let target = rng.next() * total;
    for (const m of matches) {
        target -= m.rule.weight;
        if (target <= 0) return m;
    }
    return matches[matches.length - 1]!;
}

// ─────────────────────────────────────────────────────────────────
// Runner state(motif sharing + fill counter)
// ─────────────────────────────────────────────────────────────────

interface RunnerState {
    /** Motif sharing — (share Name) 缓存 expansion,后续同名 (share Name) 用缓存 */
    sharedMotifs: Map<string, GrammarToken[]>;
}

// ─────────────────────────────────────────────────────────────────
// Expansion
// ─────────────────────────────────────────────────────────────────

/**
 * 递归 expand 一个 token,产出 terminal tokens push 到 out。
 *
 * @param token       要 expand 的 token(atom string 或 list)
 * @param grammar     GrammarData
 * @param bindings    变量绑定(从父 rule 继承)
 * @param rng         AF2 Random
 * @param out         terminal tokens 累积
 * @param state       runner state(share/unshare motif state)
 * @param depth       递归深度(防爆栈)
 */
function expandToken(
    token: GrammarToken,
    grammar: GrammarData,
    bindings: Map<string, number>,
    rng: Random,
    out: GrammarToken[],
    state: RunnerState,
    depth: number,
): void {
    if (depth > 500) return;  // safeguard

    if (typeof token === 'string') {
        // atom — 看是否是 non-terminal(grammar rule head)
        const matches = findMatchingRules(grammar, token, undefined);
        if (matches.length === 0) {
            // terminal atom — push
            out.push(token);
            return;
        }
        // weighted pick → expand body
        const picked = pickWeightedRule(matches, rng);
        if (!picked) { out.push(token); return; }
        for (const child of picked.rule.body) {
            expandToken(child, grammar, picked.bindings, rng, out, state, depth + 1);
        }
        return;
    }

    // list — could be:
    //   1. (share Name)   — motif sharing(缓存 expansion 给下次同名 share 用)
    //   2. (unshare Name) — 清除缓存
    //   3. (fill N expr)  — fill operator(expand expr,N 当 hint)
    //   4. (head arg)     — rule invocation
    //   5. terminal list  — (X N dur) / (slope ...) 等
    if (token.length < 1) {
        out.push(token);
        return;
    }
    const head = token[0];
    if (typeof head !== 'string') {
        out.push(token);
        return;
    }

    // (share Name) — motif sharing
    if (head === 'share' && token.length >= 2) {
        const motifName = token[1];
        if (typeof motifName === 'string') {
            const cached = state.sharedMotifs.get(motifName);
            if (cached) {
                // 用缓存(motif coherence)
                for (const t of cached) out.push(t);
            } else {
                // expand 一次,缓存,emit
                const sub: GrammarToken[] = [];
                expandToken(motifName, grammar, bindings, rng, sub, state, depth + 1);
                state.sharedMotifs.set(motifName, sub);
                for (const t of sub) out.push(t);
            }
        }
        return;
    }

    // (unshare Name) — 清除缓存,后续 fire Name 重新随机
    if (head === 'unshare' && token.length >= 2) {
        const motifName = token[1];
        if (typeof motifName === 'string') {
            state.sharedMotifs.delete(motifName);
        }
        return;
    }

    // (fill N expr) — fill operator
    //   简化版:expand expr 一次,忽略 N(原 Impro-Visor 用 N 当 expr 内 Y arg,
    //   我们当前不支持上下文 Y rebind,fallback 走 expr 原 Y bindings)
    if (head === 'fill' && token.length >= 3) {
        expandToken(token[2]!, grammar, bindings, rng, out, state, depth + 1);
        return;
    }

    // 检查是否是 rule invocation:(P Y) / (BRICK 1920) — head 必须在 grammar rules 内
    const isHead = grammar.rules.some(r => r.head === head) || grammar.baseRules.some(r => r.head === head);
    if (isHead) {
        // 尝试求值 arg(可能是 Y 变量或 (- Y 120) 表达式)
        let arg: number | undefined;
        if (token.length >= 2) {
            const argExpr = token[1]!;
            arg = evalExpr(argExpr, bindings);
        }
        const matches = findMatchingRules(grammar, head, arg);
        const picked = pickWeightedRule(matches, rng);
        if (!picked) {
            // 无 rule 匹配(可能 arg ≤ 0 但没有 base rule)— 终止
            return;
        }
        // 把 arg 绑给 rule.params[0](如 (P Y) 接受新 Y)
        if (picked.rule.params.length > 0 && arg !== undefined) {
            picked.bindings.set(picked.rule.params[0]!, arg);
        }
        for (const child of picked.rule.body) {
            expandToken(child, grammar, picked.bindings, rng, out, state, depth + 1);
        }
        return;
    }

    // terminal list — preserve(给后续 chooseNote 解释:(X N dur) / (slope ...))
    out.push(token);
}

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

/**
 * 把 grammar 从 startSymbol expand 到 terminal 序列。
 *
 * @param grammar      GrammarData(from parseGrammar)
 * @param totalSlots   起始 Y 值(典型一 chord 4 beat = 480 slots,Impro-Visor 标准:120 slots/beat)
 * @param rng          AF2 Random
 */
export function expandGrammarData(
    grammar: GrammarData,
    totalSlots: number,
    rng: Random,
): GrammarToken[] {
    const out: GrammarToken[] = [];
    const initialToken: GrammarToken = [grammar.startSymbol, String(totalSlots)];
    const bindings = new Map<string, number>();
    const state: RunnerState = { sharedMotifs: new Map() };
    expandToken(initialToken, grammar, bindings, rng, out, state, 0);
    return out;
}

// ─────────────────────────────────────────────────────────────────
// Parameter accessors(给 NoteChooser / chooseNote 用)
// ─────────────────────────────────────────────────────────────────

export function getParamNumber(grammar: GrammarData, key: string, fallback: number): number {
    const v = grammar.parameters.get(key);
    if (typeof v === 'number') return v;
    return fallback;
}

export function getParamBoolean(grammar: GrammarData, key: string, fallback: boolean): boolean {
    const v = grammar.parameters.get(key);
    if (typeof v === 'boolean') return v;
    return fallback;
}

export function getParamString(grammar: GrammarData, key: string, fallback: string): string {
    const v = grammar.parameters.get(key);
    if (typeof v === 'string') return v;
    return fallback;
}
