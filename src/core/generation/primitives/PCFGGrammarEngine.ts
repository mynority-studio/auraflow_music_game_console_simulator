/**
 * PCFGGrammarEngine — 概率上下文无关文法栈式推导器
 *
 * 参考实现：Impro-Visor `imp.lickgen.Grammar`（outerFill / findRule / accumulateTerminals）
 *
 * 职责（纯算法）：
 *   - 输入：GrammarConfig（起始符号 + WeightedRule[]）+ 目标拍数
 *   - 输出：一维 TerminalSymbol[]（按推导顺序，时间正向）
 *   - 规则用 TS 对象 / JSON 表示，不解析 S-expr 字符串
 *
 * Phase 6 重构：Terminal 由"数值 pitchOffset"改为"职能 kind"。
 *   - 语法树只决定**时值 + 音符职能**（chordTone / approachTone / colorTone / rest）
 *   - 具体物理 pitch 由 ToplineEngine 在消费 terminals 时按当前和弦/调式实例化
 *   - 这是 Impro-Visor `chord.grammar` 的核心思想：语法是节奏与职能，pitch 是后处理
 *
 * Phase 6.2 — The Soloist's Memory（动机折叠与召回）：
 *   引擎内置局部 motif buffer（函数作用域，单次 expand 调用生命周期）。
 *   NonTerminal 可通过 `action` 字段触发：
 *     - `'define'`：正常按 pickRule 展开（消耗 1 PRNG），并将展开得到的 terminal
 *                   子序列以 lhs/name 为 key 存入 buffer。
 *     - `'recall'`：从 buffer 取出该 name 的最新定义，**零 PRNG 消耗**直接压入 output；
 *                   首音打 motifStart 标记，由 ToplineEngine 用于和声模进 cursor 重置。
 *   该机制让同一段律动在不同和弦上重复演绎（Harmonic Sequence），并保证 recall
 *   阶段的绝对稳定（D-1 / D-5）。
 *
 * 风格无关：所有 weight / rhs / lhs 由 caller 喂入，引擎不带任何 Pop/Jazz 硬编码。
 * 风格差异通过 ruleset 中 kind / duration 分布塑造（chordTone 比例 / 三连音率 / approach 概率等）。
 *
 * 约束遵从（pipeline rule §4）：
 *   D-1: 加权规则选择走 PRNGManager.next()；recall 路径 0 PRNG
 *   D-4 / C-1: budget / duration 比较走 epsilon
 *   P-1: 仅扁平数组 + 线性扫描，无 Map/Set（motif buffer 用 struct-array + 末端扫描）
 *   T-1: lhs/name 字符串仅作 grammar 内部符号身份（identity），不做风格分类
 *   T-3: 无 any
 *   T-5: motifStart 用 `=== true` 显式判定，不依赖 undefined falsy 语义
 *   S-1: motif buffer 为函数局部变量，不污染全局
 *   S-3 / S-4: 同步函数，输出纯数据
 *   K-1 / K-7: TerminalSymbol 不携带 pitch 信息 — Pitch Space 由 ToplineEngine 决定（RELATIVE）
 */

import { PRNGManager } from '../../utils/PRNG';

const EPSILON = 1e-6;
const DEFAULT_MAX_EXPANSIONS = 10000;

/**
 * Terminal 音符职能（abstract role） — 由 ToplineEngine 映射到具体 pitch：
 *   - chordTone   : 当前和弦的内音（root / 3rd / 5th / 7th）— "在和弦里"
 *   - colorTone   : 调内但非和弦内的张力音（9 / 11 / 13）— "在调里但不在和弦里"
 *   - approachTone: 经过音 — 解决到下一个 chord/color tone 的半音或调内邻音
 *   - rest        : 休止
 */
export type TerminalKind = 'chordTone' | 'approachTone' | 'colorTone' | 'rest';

/**
 * Terminal：推导出的叶节点 — 一个抽象音符职能 + 时值。
 *
 * 不带 pitch — pitch 由 ToplineEngine 跟随当前和弦实例化。
 * caller 通过 ruleset 中的 kind 分布塑造风格（Pop 重 chordTone / Jazz 重 colorTone 等）。
 */
export interface TerminalSymbol {
    type: 'terminal';
    /** 时长（拍） */
    duration: number;
    /** 音符职能 — 决定 pitch 实例化策略 */
    kind: TerminalKind;
    /**
     * Phase 6.2 — motif recall 首音标记。
     *
     * 当 NonTerminalSymbol.action === 'recall' 触发回放时,引擎在被压入 output 的
     * 第一个 terminal 上打 `motifStart = true`。ToplineEngine 收到此标记会重置
     * pitch cursor 至 anchorPitch — 让同一动机在不同和弦上从相同 "起跳锚" 出发，
     * 自然产生 Harmonic Sequence（和声模进）。
     *
     * 普通展开链路上的 terminal 不设此字段（undefined 等价于 false）。
     * 检查时用 `=== true`（T-5：不依赖 undefined falsy 语义）。
     */
    motifStart?: boolean;
    /**
     * Phase 6.2 observability — 动机身份标签。
     *
     * 引擎自动埋点（仅用于调试/可视化，**不影响生成逻辑**）：
     *   - Recall 路径：每个被压入 output 的 terminal 都被打上 `motifName = top.name`（recall 的目标 name）
     *   - Define 路径：marker 弹栈时（define 子树展开完毕），对 output 切片中**尚未标记**的 terminal
     *                  打上 `motifName = top.name` —"first-wins" 语义保护内嵌动机的更精细身份
     *
     * 普通展开链路（无 action）的 terminal 不携带 motifName。
     * 字段在 ToplineEngine 内原样透传到 NoteData.motifName。
     * C 移植：const char* 或 uint8_t enum index。
     */
    motifName?: string;
    /**
     * Phase 6.3 — The Contour Dictionary：显式目标音级（1/3/5/7/9/11/13）。
     *
     * 表达"我要的是和弦的第 N 度音"，而非"在 PC mask 中找最近的"。配合 chord.quality
     * 动态展开为真实半音偏移（如 Major7 的 3rd = 4 半音 / Minor7 的 3rd = 3 半音）。
     * 让一条规则（如 `targetDegree: 5`）能在十二个调任意 quality 上自适应渲染。
     *
     * ToplineEngine.render() Pass 1 中：
     *   - 命中：算法计算 PC = (chord.root + degreeToInterval(degree, quality)) mod 12，
     *           在 [pitchRange] 内取 PC 命中且距 cursor 最近的 pitch。
     *   - PRNG ×2 空转消耗（D-5 序列对齐）— 即便是确定性靶向，也保留原节点的 PRNG 配额。
     *   - 与 kind 协作：chordTone + targetDegree(1/3/5/7) 命中和弦内音；
     *                   colorTone + targetDegree(9/11/13) 命中张力音；其余组合按算法落点。
     *
     * 字段缺省（undefined）→ 走原 nearest/leap 路径（向后兼容）。
     * 优先级：targetDegree > contourDir > 默认 mask 抽样。
     */
    targetDegree?: number;
    /**
     * Phase 6.3 — 方向约束：+1 强制上行级进 / -1 强制下行级进。
     *
     * 仅作用于 chord/color tone（rest/approach 忽略）。在原 PC mask 候选池上按方向过滤
     * 后再走 nearest/leap 抽样，PRNG ×2 消耗不变。候选池为空（cursor 已到边界）→
     * 兜底放弃方向，按原全池 nearest（保证不静音）。
     *
     * 与 targetDegree 互斥使用时优先级低 — targetDegree 命中即覆盖方向。
     */
    contourDir?: 1 | -1;
}

/** Non-Terminal：可被规则展开的中间节点 */
export interface NonTerminalSymbol {
    type: 'nonterminal';
    name: string;
    /**
     * Phase 6.2 — Motif Buffer 操作（默认 undefined = 正常展开）。
     *
     *   - 'define': 正常 pickRule + 展开（消耗 1 PRNG），并把这次展开收集到的
     *               terminal 子序列以 `name` 为 key 存入函数局部 motif buffer。
     *               支持嵌套与覆盖（同名重复 define 取最新 — 后扫优先）。
     *   - 'recall': **零 PRNG 消耗**，直接把 motif buffer 中该 name 最新存储的
     *               terminal 序列压入 output；首音打 motifStart=true 标记。
     *               若 buffer 中无此 name（recall 早于 define），按"无匹配规则"
     *               同语义静音忽略。
     *
     * 设计要点：
     *   1. define 必须在推导路径上**先于** recall 出现，否则 recall 静音。
     *   2. 同名 lhs 可有多条权重不同的规则；define 阶段按 PRNG 抽取其中一条
     *      并固化该具体展开 — 后续 recall 都重放这同一份实例。
     *   3. 嵌套 define 合法（动机 A 内嵌动机 B），各自独立捕获。
     *   4. buffer 生命周期 = 单次 expand() 调用 — 不跨 block / 跨段污染。
     */
    action?: 'define' | 'recall';
}

export type GrammarSymbol = TerminalSymbol | NonTerminalSymbol;

export interface GrammarRule {
    /** 左部 — 非终止符身份（identifier） */
    lhs: string;
    /** 右部 — 终止符与非终止符混合序列；按写入顺序推导（leftmost-first） */
    rhs: GrammarSymbol[];
    /** > 0 才参与抽样；<= 0 视为禁用 */
    weight: number;
}

export interface GrammarConfig {
    startSymbol: string;
    rules: GrammarRule[];
    /** 安全上限，默认 10_000；防止规则左递归 / 高分叉失控 */
    maxExpansions?: number;
}

export class PCFGGrammarEngineError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'PCFGGrammarEngineError';
        this.context = context;
    }
}

// ============================================================
// 内部 sentinel — Motif End Marker（仅函数内栈使用，不外泄）
// ============================================================
//
// 当一个 `define` NonTerminal 被 pop 时，引擎在压入其 rhs 前先压入一个 marker。
// 由于 marker 在栈底（先压入），所有后续 rhs 展开完成后才会被 pop —
// 此时 output[startIdx ..] 正好是这个 define 的子树吐出的全部 terminal 序列。
// ============================================================
interface MotifEndMarker {
    type: 'motif-end-marker';
    /** 与 NonTerminal.name 同 — 用作 motif buffer key */
    name: string;
    /** define 触发时刻 output.length 的快照 — 切片起点 */
    startIdx: number;
}

/** Motif buffer 单元 — name + 该 name 最近一次 define 捕获到的 terminal 子序列 */
interface MotifRecord {
    name: string;
    terminals: TerminalSymbol[];
}

/** 栈内元素：常规 GrammarSymbol，或内部 sentinel marker */
type StackEntry = GrammarSymbol | MotifEndMarker;

export class PCFGGrammarEngine {
    /**
     * 展开成 terminal 序列。
     *
     * 终止条件（任一满足即停止）：
     *   1. 栈空
     *   2. 剩余 budget < epsilon（已填满）
     *   3. 累计展开次数达 maxExpansions（防失控）
     *   4. 栈顶 terminal 时长超出剩余 budget（避免半截 terminal）
     *   5. recall 中某 terminal 超出剩余 budget（动机被截断 → 与 4 同样终止）
     *
     * 输出最大长度：受 targetBeats / 最小 terminal duration 制约，由 caller 设计 ruleset 控制。（C-4）
     *
     * PRNG 消耗：
     *   - 普通 non-terminal 展开：每次 1 次（pickRule）
     *   - `action: 'define'` non-terminal：每次 1 次（仍然 pickRule，仅多挂 marker）
     *   - `action: 'recall'` non-terminal：**0 次**（D-1 / D-5 — 动机绝对稳定）
     */
    public static expand(targetBeats: number, config: GrammarConfig): TerminalSymbol[] {
        PCFGGrammarEngine.validateConfig(config);
        if (targetBeats < EPSILON) return [];

        const maxExp = (config.maxExpansions !== undefined && config.maxExpansions > 0)
            ? Math.floor(config.maxExpansions)
            : DEFAULT_MAX_EXPANSIONS;

        const output: TerminalSymbol[] = [];

        // Phase 6.2 — Motif buffer（函数局部，S-1 合规；扁平 struct-array，P-1 合规）
        const motifBuffer: MotifRecord[] = [];

        // 栈：top = 末位 index。用 push / length-- 模拟。元素类型支持 GrammarSymbol | MotifEndMarker。
        const stack: StackEntry[] = [];
        stack.push({ type: 'nonterminal', name: config.startSymbol });

        let budget = targetBeats;
        let expansions = 0;

        while (stack.length > 0 && budget > EPSILON && expansions < maxExp) {
            // pop
            const topIdx = stack.length - 1;
            const top = stack[topIdx];
            stack.length = topIdx;

            // ----------------------------------------------------
            // 分支 A：Terminal — 直接输出（深拷贝避免规则模板被污染）
            // ----------------------------------------------------
            if (top.type === 'terminal') {
                // 严格容差：terminal duration 超剩余 budget → 丢弃并终止
                // （继续推导很容易留下半截无意义 terminal，保守终止换确定性）
                if (top.duration <= budget + EPSILON) {
                    // Phase 6.2：深拷贝而非直接 push — 因为 define marker 弹栈时
                    // 会回填 motifName 标签，绝不允许污染源规则的 rhs 引用。
                    // 字段全为基本类型，浅拷贝即等价深拷贝。
                    // Phase 6.3：targetDegree / contourDir 一并透传（轮廓字典 hint）
                    const pushed: TerminalSymbol = {
                        type: 'terminal',
                        kind: top.kind,
                        duration: top.duration,
                    };
                    if (top.targetDegree !== undefined) pushed.targetDegree = top.targetDegree;
                    if (top.contourDir !== undefined) pushed.contourDir = top.contourDir;
                    output.push(pushed);
                    budget -= top.duration;
                } else {
                    break;
                }
                continue;
            }

            // ----------------------------------------------------
            // 分支 B：Motif End Marker — define 子树展开完毕，捕获子序列
            // ----------------------------------------------------
            if (top.type === 'motif-end-marker') {
                const sliceLen = output.length - top.startIdx;
                if (sliceLen > 0) {
                    // ① 捕获 — 浅拷贝到 buffer（TerminalSymbol 字段全为基本类型）
                    //   buffer 内容保持"无身份"（motifName/motifStart 都不带），
                    //   后续 recall 会根据 recall 上下文重新打标。
                    // Phase 6.3：targetDegree / contourDir 是动机的"内禀属性"（不像
                    //   motifName / motifStart 是 recall 上下文标签），必须随 buffer
                    //   一起留存 — 让回放时的算法展开仍按动机原始意图工作。
                    const captured: TerminalSymbol[] = new Array(sliceLen);
                    for (let i = 0; i < sliceLen; i++) {
                        const src = output[top.startIdx + i];
                        const cap: TerminalSymbol = {
                            type: 'terminal',
                            kind: src.kind,
                            duration: src.duration,
                        };
                        if (src.targetDegree !== undefined) cap.targetDegree = src.targetDegree;
                        if (src.contourDir !== undefined) cap.contourDir = src.contourDir;
                        captured[i] = cap;
                    }
                    // 同名覆盖语义：直接 push，findMotifIndex 末端扫描自然取最新
                    motifBuffer.push({ name: top.name, terminals: captured });

                    // ② Observability 埋点 — 给 output 切片中 *尚未标记* 的 terminal
                    //    打上 motifName = top.name（first-wins，保护内嵌 recall/define 的更精细身份）
                    for (let i = 0; i < sliceLen; i++) {
                        const out = output[top.startIdx + i];
                        if (out.motifName === undefined) {
                            out.motifName = top.name;
                        }
                    }
                }
                continue;
            }

            // ----------------------------------------------------
            // 分支 C：Non-Terminal — action 控制路径（默认 / define / recall）
            // ----------------------------------------------------
            const action = top.action;

            // C-1：recall — 0 PRNG，从 buffer 取 terminal 序列直接压入 output
            if (action === 'recall') {
                const motifIdx = PCFGGrammarEngine.findMotifIndex(motifBuffer, top.name);
                if (motifIdx < 0) {
                    // buffer 未命中 — 与 pickRule 返回 null 同语义，静音丢弃
                    continue;
                }
                const motifTerms = motifBuffer[motifIdx].terminals;
                let aborted = false;
                for (let i = 0; i < motifTerms.length; i++) {
                    const t = motifTerms[i];
                    if (t.duration > budget + EPSILON) {
                        aborted = true;
                        break;
                    }
                    // 首音打 motifStart 标记 — ToplineEngine 收到后重置 cursor 实现模进
                    // motifName 标记 — 每个被回放的 terminal 都附带 recall 的目标 name
                    //   （observability：可视化层据此画 bounding box）
                    // Phase 6.3：targetDegree / contourDir 是动机内禀属性，逐 recall 透传 —
                    //   让 Recall(Hook) 在新和弦上仍按"1→5 大跳"展开（变和弦不变意图）。
                    const replay: TerminalSymbol = {
                        type: 'terminal',
                        kind: t.kind,
                        duration: t.duration,
                        motifStart: i === 0 ? true : undefined,
                        motifName: top.name,
                    };
                    if (t.targetDegree !== undefined) replay.targetDegree = t.targetDegree;
                    if (t.contourDir !== undefined) replay.contourDir = t.contourDir;
                    output.push(replay);
                    budget -= t.duration;
                }
                if (aborted) break;  // 半截 motif → 与半截 terminal 同样保守终止
                continue;
            }

            // C-2：default / define — 共用 pickRule 路径（消耗 1 PRNG）
            const chosen = PCFGGrammarEngine.pickRule(top.name, config.rules);
            if (chosen === null) {
                // 无匹配规则 — 当作"silent drop"继续；与 Impro-Visor Grammar.findRule 返回 null 同语义
                continue;
            }

            if (action === 'define') {
                // 先压 end-marker（栈底）— 待所有子展开 pop 完后再被 pop，
                // 此时 output[startIdx ..] 正是这次 define 的子树终止符序列。
                stack.push({
                    type: 'motif-end-marker',
                    name: top.name,
                    startIdx: output.length,
                });
            }

            // rhs 逆序压栈 → leftmost 最先 pop（保持时间正序）
            const rhs = chosen.rhs;
            for (let i = rhs.length - 1; i >= 0; i--) {
                stack.push(rhs[i]);
            }
            expansions++;
        }

        return output;
    }

    /**
     * 末端线性扫描 — 取 buffer 中 name 最新一次 define 的索引。
     *
     * 末端优先策略实现"同名覆盖"语义：同一 expand 内多次 define 同名 motif，
     * 后续 recall 总是回放最新一次。算法 C 翻译为 reverse-for 直接对应。
     *
     * @returns 命中索引（>=0），未命中返回 -1。
     */
    private static findMotifIndex(buffer: MotifRecord[], name: string): number {
        for (let i = buffer.length - 1; i >= 0; i--) {
            if (buffer[i].name === name) return i;
        }
        return -1;
    }

    /**
     * 按权重在匹配 lhs 的规则中抽 1 条。
     *
     * 算法对齐 Grammar.java::findRule：
     *   1. 线性扫一遍，累加 total weight
     *   2. r = PRNGManager.next() * total
     *   3. 第二次线性扫，找累计区间命中
     *
     * 双扫描换 0 中间数组（M-1）；C 端直接 1:1 翻译为两次 for-loop。
     */
    private static pickRule(lhs: string, rules: GrammarRule[]): GrammarRule | null {
        const len = rules.length;

        // pass 1: total weight
        let total = 0;
        for (let i = 0; i < len; i++) {
            const r = rules[i];
            // 字符串身份比较，非分类匹配 — T-1 合规
            if (r.lhs === lhs && r.weight > 0) {
                total += r.weight;
            }
        }
        if (total <= EPSILON) return null;

        // pass 2: cumulative selection
        const pick = PRNGManager.next() * total;
        let cumulative = 0;
        let lastMatch: GrammarRule | null = null;
        for (let i = 0; i < len; i++) {
            const r = rules[i];
            if (r.lhs === lhs && r.weight > 0) {
                cumulative += r.weight;
                lastMatch = r;
                if (pick < cumulative) return r;
            }
        }
        // 浮点边界回退：返回最后一个匹配项（与 Grammar.java listSize 兜底同语义）
        return lastMatch;
    }

    /** S-7：非法 config 抛带上下文的 Error 子类 */
    private static validateConfig(config: GrammarConfig): void {
        if (typeof config.startSymbol !== 'string' || config.startSymbol.length === 0) {
            throw new PCFGGrammarEngineError(
                'startSymbol must be a non-empty string',
                { actual: config.startSymbol },
            );
        }
        if (!Array.isArray(config.rules)) {
            throw new PCFGGrammarEngineError(
                'rules must be an array',
                { actual: typeof config.rules },
            );
        }
        if (config.maxExpansions !== undefined && config.maxExpansions < 1) {
            throw new PCFGGrammarEngineError(
                'maxExpansions must be >= 1 if provided',
                { actual: config.maxExpansions },
            );
        }
    }
}
