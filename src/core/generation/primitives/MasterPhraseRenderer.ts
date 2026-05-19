/**
 * MasterPhraseRenderer — 大师 Grammar 渲染器
 *
 * 职责（纯算法）：
 *   - 输入：budget（拍） + PersonaManifest + PRNG 抽取器
 *   - 输出：TerminalSymbol[]（与 PCFGGrammarEngine.expand 输出同形）
 *   - 按 baseWeight 加权抽 GrammarRoot，把其 AbstractToken[] 流式翻译成 TerminalSymbol[]，
 *     循环到 budget 填满；末端 token 按余额钳制 duration。
 *
 * 与 PCFGGrammarEngine 的关系（Master Takeover 路径）：
 *   两者输出契约相同（TerminalSymbol[]），下游 ToplineEngine.render 无感知差异。
 *   差异在于 grammar 来源：PCFG 走 style 层的递归 rules；MasterRenderer 走 flash 大师的扁平 roots。
 *
 * 编码格式转换（AbstractToken → TerminalSymbol）：
 *   - kind:         数值枚举 0/1/2/3 → 字符串 'rest'/'chordTone'/'colorTone'/'approachTone'
 *   - duration:     16 分音符单位 (1..63) → 拍 (duration / 4)
 *   - contourDir:   {-1, 0, 1} → {-1, undefined, 1}（0 表示无方向约束）
 *   - targetDegree: 0..63（0 = 无显式度数） → 1..7 | undefined
 *
 * 约束遵从（pipeline rule §4）：
 *   D-1: 加权抽样调用 caller 注入的 prng()（caller 用 PRNGManager.next()）
 *   D-4: budget 比较走 EPSILON
 *   K-1: TerminalSymbol 不带 pitch（pitch 在 ToplineEngine 实例化）
 *   P-1: 扁平数组 + 线性扫描；无 Map/Set
 *   T-3: 无 any —— AbstractToken/TerminalSymbol/PersonaManifest 全显式类型
 *   S-3: 同步纯函数；不读全局；不写 console
 */

import {
    AbstractToken,
    GrammarRoot,
    PersonaManifest,
    TerminalKind as AbstractTerminalKind,
} from '../types';
import { TerminalSymbol, TerminalKind as TerminalKindStr } from './PCFGGrammarEngine';
import { COMMON_GRAMMAR_ROOTS } from '../data/CommonRoots';

const EPSILON = 1e-6;
const SIXTEENTHS_PER_BEAT = 4;

/**
 * AbstractToken.kind (数值枚举) → TerminalSymbol.kind (字符串字面量)
 *
 * 数组下标 = AbstractTerminalKind 枚举值（0..3），值 = PCFGGrammarEngine 使用的字符串字面量。
 * P-1: 扁平数组下标查找，O(1)。
 */
const KIND_NUM_TO_STR: TerminalKindStr[] = [];
KIND_NUM_TO_STR[AbstractTerminalKind.Rest]         = 'rest';
KIND_NUM_TO_STR[AbstractTerminalKind.ChordTone]    = 'chordTone';
KIND_NUM_TO_STR[AbstractTerminalKind.ColorTone]    = 'colorTone';
KIND_NUM_TO_STR[AbstractTerminalKind.ApproachTone] = 'approachTone';

/**
 * PRNG 注入接口 —— caller 提供 0..1 浮点抽取函数。
 *
 * 实际生产路径由 PRNGManager.next() 实现；测试可注入确定性序列。
 */
export type PRNGFn = () => number;

export class MasterPhraseRendererError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'MasterPhraseRendererError';
        this.context = context;
    }
}

export class MasterPhraseRenderer {
    /**
     * 渲染指定拍长的旋律 terminal 流。
     *
     * 算法：
     *   1. 解引用 manifest.customRootIds → GrammarRoot[]（一次性，循环外）
     *   2. 累加 baseWeight 得总权重
     *   3. 循环：剩余 budget > 0 时
     *      a. PRNG 抽样选一个 root（轮盘）
     *      b. 把 root.tokens 翻译成 TerminalSymbol 并追加
     *      c. 末端 token 按余额钳 duration（避免越界）
     *
     * PRNG 消耗：每选一个 root 消耗 1 次 prng()。token 翻译零 PRNG。
     */
    public static renderPhrase(
        budgetBeats: number,
        manifest: PersonaManifest,
        prng: PRNGFn,
    ): TerminalSymbol[] {
        if (budgetBeats < EPSILON) return [];
        if (manifest.customRootIds.length === 0) {
            throw new MasterPhraseRendererError(
                'manifest has no customRootIds',
                { manifestId: manifest.id },
            );
        }

        // ----------------------------------------------------------------
        // Step 1: 解引用 customRootIds → GrammarRoot[]，并累积总权重
        // ----------------------------------------------------------------
        const roots: GrammarRoot[] = [];
        let totalWeight = 0;
        for (let i = 0; i < manifest.customRootIds.length; i++) {
            const rid = manifest.customRootIds[i];
            const r = COMMON_GRAMMAR_ROOTS[rid];
            if (r === undefined) continue; // 容错：CommonRoots 缺失项跳过
            if (r.baseWeight <= 0) continue; // 禁用项
            roots.push(r);
            totalWeight += r.baseWeight;
        }
        if (roots.length === 0 || totalWeight <= EPSILON) {
            throw new MasterPhraseRendererError(
                'no usable grammar roots after weight filtering',
                { manifestId: manifest.id, rootIds: manifest.customRootIds },
            );
        }

        // ----------------------------------------------------------------
        // Step 2: 流式渲染直到 budget 填满
        // ----------------------------------------------------------------
        const out: TerminalSymbol[] = [];
        let remaining = budgetBeats;
        // 安全上限：每拍最多 ~16 个 16 分音符，预算外 ×2 上限防御无限循环
        const maxIterations = Math.ceil(budgetBeats * SIXTEENTHS_PER_BEAT) + 32;
        let iter = 0;

        while (remaining > EPSILON && iter < maxIterations) {
            iter++;
            // 轮盘抽根
            const r = prng() * totalWeight;
            let cum = 0;
            let chosen: GrammarRoot = roots[0];
            for (let i = 0; i < roots.length; i++) {
                cum += roots[i].baseWeight;
                if (r < cum) {
                    chosen = roots[i];
                    break;
                }
            }

            // 翻译 root.tokens 追加进 out（末端钳制）
            for (let t = 0; t < chosen.tokens.length; t++) {
                if (remaining <= EPSILON) break;
                const tok = chosen.tokens[t];
                const tokBeats = tok.duration / SIXTEENTHS_PER_BEAT;
                if (tokBeats <= EPSILON) continue;

                // 末端钳制：如果该 token 超出 remaining，截短到 remaining 后退出
                const useBeats = tokBeats > remaining ? remaining : tokBeats;
                const sym = MasterPhraseRenderer.toTerminal(tok, useBeats);
                if (sym !== undefined) out.push(sym);
                remaining -= useBeats;
            }
        }

        return out;
    }

    /**
     * AbstractToken → TerminalSymbol 单 token 翻译。
     *
     * 返回 undefined 的情况：
     *   - kind 越界（>3）—— 容错跳过（C 移植同语义）
     *   - duration 为 0 经钳制后清零
     */
    private static toTerminal(
        tok: AbstractToken,
        beats: number,
    ): TerminalSymbol | undefined {
        if (beats <= EPSILON) return undefined;
        if (tok.kind < 0 || tok.kind > 3) return undefined;

        const kindStr = KIND_NUM_TO_STR[tok.kind];
        const sym: TerminalSymbol = {
            type: 'terminal',
            duration: beats,
            kind: kindStr,
        };
        // contourDir: 0 → undefined（不带方向约束）；±1 透传
        if (tok.contourDir === 1 || tok.contourDir === -1) {
            sym.contourDir = tok.contourDir;
        }
        // targetDegree: 0 → undefined；1..7 透传（>7 也透传，ToplineEngine 兜底）
        if (tok.targetDegree > 0) {
            sym.targetDegree = tok.targetDegree;
        }
        return sym;
    }
}
