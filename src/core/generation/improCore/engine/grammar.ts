// ============================================================
// ImproCore engine — Grammar 展开引擎
// imp/lickgen/Grammar.java 的忠实移植
// ============================================================
//
// 加权随机 CFG → 抽象旋律 token 流。栈式最左推导:
//   accumulateTerminals(弹出栈首终结符 → buffer,扣 slot)
//   applyRules(弹出一个非终结符 → 选规则展开 → 展开式 prepend 回栈)
//   直到 numSlotsToFill ≤ 0;末尾 truncate 到精确时长。
//
// 终止:start 符号负参数丢弃(P n, n≤0 → 丢)+ slot 填满。base 规则在
//   Java findRule 里 addToList 被注释,实际不参与(本移植照搬)。
//
// 与 Java 的差异:Tokenizer 类型 → numberize();无 trading(单遍生成)。
// builtin 在无和弦上下文时给"保活"默认(Phase 3 接和弦/roadmap 后转忠实)。
// ============================================================

import { readSexpr } from '../data/sexpr-reader';
import { BEAT } from './constants';
import {
    type GVal, type GList,
    numberize, isGList, gAssoc, gMember,
    isTerminal, isWrappedTerminal, getDuration, truncateAbstractMelody,
} from './terminals';

// 规则标签 / 特殊形式
const START = 'startsymbol';
const BASE = 'base';
const RULE = 'rule';
const BUILTIN = 'builtin';
const FILL = 'fill';
const SHARE = 'share';
const UNSHARE = 'unshare';
const UNSHAREALL = 'unshareall';
const MUSE_SWITCH = 'muse-switch';
const MUSE_DEFAULT = 'default';
const NONE = 'none';

// 安全上限(防病态 grammar 死循环)
const SAFETY = 200000;
// 连续多少次推导不减少剩余 slot 即判定卡死,提前退出
const NO_PROGRESS = 5000;

/** 和弦上下文(Phase 3 接入;Phase 2 可不传 → builtin 走保活默认) */
export interface GrammarChordContext {
    familyAtSlot(slot: number): string | null;
    brickNameAtSlot(slot: number): string | null;
}

interface WeightedRule { lhs: GList; rhs: GList; weight: number; }
interface Expansion { stack: GList; numSlotsToFill: number; }

/** 括号配平提取所有顶层 (...) 子串,忽略其间任何字符(分隔线/裸 atom 等) */
function extractTopLevelLists(text: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '(') { if (depth === 0) start = i; depth++; }
        else if (c === ')') {
            if (depth > 0) {
                depth--;
                if (depth === 0 && start >= 0) { out.push(text.slice(start, i + 1)); start = -1; }
            }
        }
    }
    return out;
}

export class Grammar {
    private rules: GList;
    private startSymbol: string | null = null;
    private terminalBuffer: GVal[] = [];
    private cache: GList = [];
    private chordSlot = 0;
    private ctx: GrammarChordContext | null = null;

    constructor(rules: GList) { this.rules = rules; }

    /**
     * 从 .grammar 文本构造。忠实复刻 Grammar.loadGrammar:
     * 只保留顶层 list,跳过注释 / 分隔线 / 任何顶层 atom。
     */
    static fromText(text: string): Grammar {
        const cleaned = text.replace(/\/\*[\s\S]*?\*\//g, ' '); // 去 /* */ 块注释
        const rules = extractTopLevelLists(cleaned).map(s => numberize(readSexpr(s))) as GList;
        return new Grammar(rules);
    }

    getRules(): GList { return this.rules; }

    /** 取所有 (parameter (key value)) → Map */
    getParameters(): Map<string, GVal> {
        const params = new Map<string, GVal>();
        for (const form of this.rules) {
            if (isGList(form) && form[0] === 'parameter' && isGList(form[1])) {
                const kv = form[1];
                if (typeof kv[0] === 'string' && kv[1] !== undefined) params.set(kv[0], kv[1]);
            }
        }
        return params;
    }

    // --------------------------------------------------------
    // run:生成 numSlots 长的抽象旋律(单遍,无 trading)
    // --------------------------------------------------------
    run(numSlots: number, ctx?: GrammarChordContext): GList {
        this.ctx = ctx ?? null;
        this.chordSlot = 0;
        this.terminalBuffer = [];
        this.cache = [];

        let numSlotsToFill = numSlots;
        let guard = 0;
        while (numSlotsToFill > 0 && guard++ < SAFETY) {
            const before = numSlotsToFill;
            const stack = this.addStart(numSlotsToFill);
            if (stack === null) break;
            const result = this.outerFill(stack, numSlotsToFill);
            numSlotsToFill = result.numSlotsToFill;
            if (numSlotsToFill >= before) break; // 一整遍 outerFill 没推进 → 停(防死循环)
        }
        return truncateAbstractMelody(this.terminalBuffer, numSlots);
    }

    /** 压入起始符号 (startSymbol numSlots) */
    private addStart(numSlots: number): GList | null {
        for (const next of this.rules) {
            if (!isGList(next) || next.length === 0) continue;
            if (next[0] === START) {
                if (next.length === 2 && typeof next[1] === 'string') {
                    this.startSymbol = next[1];
                    return [[this.startSymbol, numSlots]];
                }
                return null;
            }
        }
        return null;
    }

    private accumulateTerminal(terminal: GVal, numSlotsToFill: number): number {
        const duration = getDuration(terminal);
        this.terminalBuffer.push(terminal);
        this.chordSlot += duration;
        return numSlotsToFill - duration;
    }

    private accumulateTerminals(stack: GList, numSlotsToFill: number): Expansion {
        while (numSlotsToFill > 0 && stack.length > 0) {
            const token = stack[0]!;
            if (!isTerminal(token)) return { stack, numSlotsToFill };
            if (isWrappedTerminal(token)) {
                numSlotsToFill = this.accumulateTerminal((token as GList)[0]!, numSlotsToFill);
            } else {
                numSlotsToFill = this.accumulateTerminal(token, numSlotsToFill);
            }
            stack = stack.slice(1);
        }
        return { stack, numSlotsToFill };
    }

    private outerFill(stack: GList, numSlotsToFill: number): Expansion {
        const originalStack = stack;
        let guard = 0;
        let stale = 0;
        while (numSlotsToFill > 0 && guard++ < SAFETY) {
            const before = numSlotsToFill;
            if (stack.length === 0) stack = originalStack;
            let r = this.accumulateTerminals(stack, numSlotsToFill);
            stack = r.stack; numSlotsToFill = r.numSlotsToFill;
            r = this.applyRules(stack, numSlotsToFill);
            stack = r.stack; numSlotsToFill = r.numSlotsToFill;
            if (numSlotsToFill < before) stale = 0;
            else if (++stale > NO_PROGRESS) break; // 连续不推进 → 卡死,退出
        }
        return { stack, numSlotsToFill };
    }

    private applyRules(stack: GList, numSlotsToFill: number): Expansion {
        if (stack.length === 0) return { stack, numSlotsToFill };
        let token = stack[0]!;
        stack = stack.slice(1);
        if (!isGList(token)) token = [token];
        const result = this.expandNonTerminal(token as GList, numSlotsToFill);
        if (result === null) return { stack, numSlotsToFill };
        const expansion = result.stack;
        return { stack: [...expansion, ...stack], numSlotsToFill: result.numSlotsToFill };
    }

    private wrapperType(token: GVal): string {
        if (!isGList(token)) return NONE;
        switch (token.length) {
            case 1: if (token[0] === UNSHAREALL) return UNSHAREALL; break;
            case 2:
                if (token[0] === SHARE) return SHARE;
                if (token[0] === UNSHARE) return UNSHARE;
                break;
            case 3:
                if (token[0] === FILL) return FILL;
                if (token[0] === MUSE_SWITCH) return MUSE_SWITCH;
                break;
        }
        return NONE;
    }

    private drop(aList: GList, find: GVal): GList {
        if (aList.length === 0) return aList;
        const firstList = aList[0] as GList;
        if (firstList[0] === find) return aList.slice(1);
        return [firstList, ...this.drop(aList.slice(1), find)];
    }

    private expandNonTerminal(token: GList, slotsToFill: number): Expansion | null {
        let shareable = false;
        let unshare = false;
        let tok: GList = token;

        switch (this.wrapperType(token)) {
            case NONE: break;

            case FILL: {
                tok = token.slice(1);                    // 去掉 'fill'
                const value = tok[0]!;
                const beats = typeof value === 'number' ? value : Number(value);
                const slots = Math.floor(beats * BEAT);  // fill 参数以拍计
                const innerToken = tok.slice(1);
                const result = this.outerFill(innerToken, slots);
                return { stack: [...result.stack, [UNSHAREALL]], numSlotsToFill: slotsToFill - slots };
            }

            case MUSE_SWITCH: {
                // Phase 2:无 muse 传感器 → 取 default 替换
                tok = token.slice(1);
                const alist = tok[1];
                if (isGList(alist)) {
                    const pair = gAssoc(alist, MUSE_DEFAULT);
                    if (pair && pair[1] !== undefined) return this.applyRules([pair[1]], slotsToFill);
                }
                return this.applyRules([], slotsToFill);
            }

            case UNSHARE:
                unshare = true;
            // 故意 fall-through
            case SHARE: {
                shareable = true;
                tok = token.slice(1);                    // (key)
                const find = tok[0]!;
                const found = gAssoc(this.cache, find);
                if (found !== null) {
                    if (unshare) this.cache = this.drop(this.cache, find);
                    return { stack: found.slice(1), numSlotsToFill: slotsToFill };
                }
                break;
            }

            case UNSHAREALL:
                this.cache = [];
                return { stack: [], numSlotsToFill: slotsToFill };
        }

        const ruleToUse = this.findRule(tok);
        if (ruleToUse === null) return null;

        const expansion = ruleToUse.rhs;
        if (shareable && !unshare) {
            this.cache = [[...tok, ...expansion], ...this.cache];
        }
        return { stack: expansion, numSlotsToFill: slotsToFill };
    }

    private findRule(token: GList): WeightedRule | null {
        const ruleList: WeightedRule[] = [];

        for (const next of this.rules) {
            if (!isGList(next) || next.length === 0 || typeof next[0] !== 'string') continue;
            const type = next[0];

            if (type === BASE && next.length === 4) {
                // Java findRule 里 base 的 addToList 被注释 → 不参与
                continue;
            }
            if (type === RULE && next.length === 4) {
                const rawLHS = next[1]!;
                const rawRHS = next[2]!;
                const lhs: GList = isGList(rawLHS) ? rawLHS : [rawLHS];
                let rhs: GList = isGList(rawRHS) ? rawRHS : [rawRHS];

                if (typeof token[0] === 'string' && token[0] === lhs[0]) {
                    const unified = this.setVars(token, lhs, rhs);
                    if (unified === null) continue;
                    rhs = this.evaluate(unified) as GList;

                    // start 符号负参数丢弃
                    const B: GVal[] = [];
                    for (const ob of rhs) {
                        if (isGList(ob) && ob.length === 2 && ob[0] === this.startSymbol) {
                            const arg = ob[1];
                            if (typeof arg === 'number' && arg <= 0) {
                                // 丢弃 (start n), n≤0
                            } else {
                                B.push(ob);
                            }
                        } else {
                            B.push(ob);
                        }
                    }
                    this.addToList(lhs, B, next[3]!, ruleList);
                }
            }
        }

        if (ruleList.length === 0) return null;

        // 轮盘赌
        let total = 0;
        for (const r of ruleList) total += r.weight;
        const rand = total * Math.random();
        let offset = 0;
        for (const r of ruleList) {
            if (rand >= offset && rand < offset + r.weight) return r;
            offset += r.weight;
        }
        return ruleList[ruleList.length - 1]!;
    }

    private addToList(lhs: GList, rhs: GList, wtExp: GVal, ruleList: WeightedRule[]): void {
        const wt = this.evaluate(wtExp);
        if (typeof wt === 'number' && wt > 0) {
            ruleList.push({ lhs, rhs, weight: wt });
        }
    }

    /** 单向合一:用 token 的实参绑定 lhs 的变量,代入 rhs */
    private setVars(getValsFrom: GList, getVarsFrom: GList, toSet: GList): GList | null {
        const vars = getVarsFrom.slice(1);
        const vals = getValsFrom.slice(1);
        let result = toSet;
        const n = Math.min(vars.length, vals.length);
        for (let i = 0; i < n; i++) {
            const v = vars[i]!, val = vals[i]!;
            if (typeof v === 'number' && typeof val === 'number') {
                if (v !== val) return null;
            } else if (typeof v === 'string' && typeof val === 'number') {
                result = this.replace(v, val, result);
            } else if (typeof v === 'string' && typeof val === 'string') {
                if (v !== val) return null;
            } else {
                return null;
            }
        }
        return result;
    }

    private replace(varName: string, value: number, toReplace: GList): GList {
        return toReplace.map(el =>
            isGList(el) ? this.replace(varName, value, el) : (el === varName ? value : el),
        );
    }

    private evaluate(toParse: GVal): GVal {
        if (typeof toParse === 'number' || typeof toParse === 'string') return toParse;
        if (isGList(toParse) && toParse.length > 0) {
            const op = toParse[0];
            if (op === BUILTIN) return this.evaluateBuiltin(toParse[1]!, toParse[2]!);
            if (op === '+') return this.num(this.evaluate(toParse[1]!)) + this.num(this.evaluate(toParse[2]!));
            if (op === '-') return this.num(this.evaluate(toParse[1]!)) - this.num(this.evaluate(toParse[2]!));
            if (op === '*') return this.num(this.evaluate(toParse[1]!)) * this.num(this.evaluate(toParse[2]!));
            if (op === '/') return this.num(this.evaluate(toParse[1]!)) / this.num(this.evaluate(toParse[2]!));
            return toParse.map(e => this.evaluate(e));
        }
        return toParse; // 空 list 原样返(Java 返 null,这里更安全)
    }

    private num(v: GVal): number { return typeof v === 'number' ? v : Number(v); }

    private evaluateBuiltin(arg1: GVal, arg2: GVal): number {
        if (arg1 === 'chord-family') {
            if (!isGList(arg2)) return 0;
            if (!this.ctx) return 1;                       // Phase 2 无上下文 → 中性保活
            const family = this.ctx.familyAtSlot(this.chordSlot);
            return family !== null && gMember(arg2, family) ? 1 : 0;
        }
        if (arg1 === 'brick') {
            if (typeof arg2 !== 'string') return 0;
            const name = this.ctx ? this.ctx.brickNameAtSlot(this.chordSlot) : null;
            if (name === null) return 0.1;                 // 无 roadmap → 保活权重(= IV "不匹配" 值)
            return name === arg2 ? 1 : 0.1;
        }
        return 0;                                          // 其它 builtin:Phase 2 暂返 0
    }
}
