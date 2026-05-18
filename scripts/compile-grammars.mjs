#!/usr/bin/env node
// =================================================================================
// scripts/compile-grammars.mjs
//
// 离线 Grammar 编译器 — 读 Impro-Visor 6 大师语法 → 拓扑提取 → SRAM / Flash 分区输出
//
// 输入:
//   docs/ImproVisor_Master_Grammars.md
//     - 由 zsh + curl 从 github.com/Impro-Visor/Impro-Visor 上游拉取，
//     - 按 "### File: grammars/<Name>.grammar" 分段，```lisp 代码块包裹。
//
// 输出:
//   src/core/generation/data/CommonRoots.ts        (SRAM 区 — 编译进固件 .rodata)
//   flash/personas/<MasterId>.json                 (Flash 区 — 模拟 XIP 可替换扩展卡)
//
// 工作流:
//   1. 词法/语法分析  - Lisp s-expression 解析器（零依赖 / 纯 Node fs）
//   2. 规则展开        - 走 (rule (LHS) (BODY) weight) 树，收集 AbstractToken[]
//   3. 全局去重        - 按 [kind,duration] 序列哈希聚类，赋予紧凑 id
//   4. 拓扑派生        - 终结符频次统计 → TopologyConfig 概率参数
//   5. 分区写盘        - SRAM 字典 + Persona JSON
//
// 执行:
//   node scripts/compile-grammars.mjs
//
// 设计原则:
//   - 零依赖（仅 node:fs / node:path / node:url）
//   - 零副作用幂等（重复运行覆盖输出，不污染 git）
//   - 确定性（同输入恒等输出，便于 diff review）
// =================================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const INPUT_FILE       = path.join(PROJECT_ROOT, 'docs/ImproVisor_Master_Grammars.md');
const COMMON_ROOTS_OUT = path.join(PROJECT_ROOT, 'src/core/generation/data/CommonRoots.ts');
const PERSONAS_DIR     = path.join(PROJECT_ROOT, 'flash/personas');

// SRAM 字典容量上限（512 × ~16 token × 2B ≈ 16KB，留足 ESP32-S3 余量）
const MAX_ROOTS = 512;

// =================================================================================
// 0. TerminalKind 枚举（与 src/core/generation/types.ts 对齐）
// =================================================================================
const TerminalKind = Object.freeze({
    Rest:         0,
    ChordTone:    1,
    ColorTone:    2,
    ApproachTone: 3,
});

/**
 * Impro-Visor 终结符首字母 → TerminalKind
 *   C — chord tone（和弦音）
 *   L — scale / linear（音阶音，对应到我们 ColorTone）
 *   X — explicit color / chromatic（色彩 / 半音）
 *   A — approach tone（趋近音）
 *   R — rest（休止）
 *   H — held continuation（延续，跳过：依附于前一音）
 *   Q — quantized Markov leaf（无法离线展开，跳过）
 */
const LETTER_TO_KIND = Object.freeze({
    C: TerminalKind.ChordTone,
    L: TerminalKind.ColorTone,
    X: TerminalKind.ColorTone,
    A: TerminalKind.ApproachTone,
    R: TerminalKind.Rest,
});

/** 6 位大师卡牌描述（Persona Manifest 元数据） */
const DESCRIPTIONS = {
    CharlieParker: 'Bebop 密集跑动 — 大量色彩音与高速 16 分跑动',
    MilesDavis:    'Cool Jazz 留白 — 长音呼吸与少量色彩点缀',
    JohnColtrane:  'Hard Bop 极速和声 — 密集琶音与三连音连发',
    BillEvans:     'Lyrical Modal — 根音省略与内声部平稳连接',
    DexterGordon:  'Hard Bop 强硬 — 节奏锚定与和弦音强调',
    ChetBaker:     'Cool 抒情 — 平缓级进与忧郁长音',
};

// =================================================================================
// 1. Lisp s-expression Parser（词法 + 递归下降）
// =================================================================================

/**
 * 扁平 token 化：分裂出 '(' / ')' 与 atom 字符串，跳过空白与 ';' 行注释。
 * 输入：Lisp 源字符串
 * 输出：token 数组（每个元素是 string）
 */
function tokenize(src) {
    const tokens = [];
    const n = src.length;
    let i = 0;
    while (i < n) {
        const c = src[i];
        if (c === ';') {
            while (i < n && src[i] !== '\n') i++;
        } else if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
            i++;
        } else if (c === '(' || c === ')') {
            tokens.push(c);
            i++;
        } else {
            let atom = '';
            while (i < n && !'(); \t\n\r'.includes(src[i])) {
                atom += src[i++];
            }
            tokens.push(atom);
        }
    }
    return tokens;
}

/**
 * Token 数组 → 嵌套数组 AST。atom 保持为 string。
 * 容错：在不平衡时记 warning，跳过当前顶层 expr 继续解析。
 */
function parse(tokens) {
    let pos = 0;
    function parseExpr() {
        const t = tokens[pos++];
        if (t === '(') {
            const list = [];
            while (pos < tokens.length && tokens[pos] !== ')') {
                list.push(parseExpr());
            }
            if (tokens[pos] !== ')') throw new Error('Unbalanced paren at end of input');
            pos++;
            return list;
        }
        if (t === ')') throw new Error('Unexpected closing paren at pos ' + (pos - 1));
        return t;
    }
    const exprs = [];
    while (pos < tokens.length) {
        try {
            exprs.push(parseExpr());
        } catch (e) {
            // 失败时跳到下一个 '(' 顶层重试，避免一处错误吃掉整个 grammar
            console.warn(`  ⚠️  parse warning: ${e.message}; 跳过当前段`);
            while (pos < tokens.length && tokens[pos] !== '(') pos++;
        }
    }
    return exprs;
}

// =================================================================================
// 2. 时值 / 音级解析
// =================================================================================

/**
 * 解析时值字符串 → 16 分音符单位（clamp 到 [1, 63]，契合 AbstractToken.duration 6-bit）
 *
 * 词法形态（来自 corpus 实际观测）：
 *   "8"        八分音符      = 480/8  = 60 slots  → 2 单位
 *   "4"        四分音符      = 480/4  = 120 slots → 4 单位
 *   "16"       十六分音符    = 480/16 = 30 slots  → 1 单位
 *   "2"        二分音符      = 240 slots          → 8 单位
 *   "1"        全音符        = 480 slots          → 16 单位
 *   "4+8"      附点四分      = 180 slots          → 6 单位
 *   "4+8+16"   附点附点      = 210 slots          → 7 单位
 *   "4/3"      四分三连音    = 80 slots           → 3 单位
 *   "8/3"      八分三连音    = 40 slots           → 1 单位
 *
 * 公式：
 *   - 单段 "N"     → slots = 480 / N         （N < 64：分母）
 *   - 单段 "N"     → slots = N               （N ≥ 64：罕见的字面 slot 数）
 *   - 单段 "N/M"   → slots = (480/N) × (2/M) （M 元组分母，常见 /3）
 *   - 串联 "A+B+C" → slots 累加
 */
function parseDuration(durStr) {
    if (!durStr) return 1;
    let slots = 0;
    for (const part of durStr.split('+')) {
        if (part.includes('/')) {
            const [a, b] = part.split('/').map(Number);
            if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) continue;
            slots += (480 / a) * (2 / b);
        } else {
            const n = Number(part);
            if (!Number.isFinite(n) || n <= 0) continue;
            slots += n >= 64 ? n : 480 / n;
        }
    }
    if (slots <= 0) return 1;
    const units = Math.round(slots / 30);
    return Math.max(1, Math.min(63, units));
}

/**
 * 解析音级字符串 → 整数（保留 1~7 的自然级，accidental 标记走 kind 判定不入 degree 数字）
 *   "3"  → 3      "b3" → 3      "#5" → 5
 * targetDegree 字段为 6-bit，clamp 到 [0, 63]。
 */
function parseDegree(degStr) {
    if (!degStr || typeof degStr !== 'string') return 0;
    const m = degStr.match(/^[#b]*(\d+)$/);
    if (!m) return 0;
    return Math.max(0, Math.min(63, parseInt(m[1], 10)));
}

// =================================================================================
// 3. 规则体遍历：AST → AbstractToken[]
// =================================================================================

/**
 * 递归走规则 body，把识别出的 terminal emit 到 out 数组。
 *
 * 节点形态:
 *   - atom "C8" / "L4" / "R16" / "X8" / "A16"  → letter + duration 双字段
 *   - atom "Q30" / "H4"                         → 跳过（不可离线展开 / 延续）
 *   - 列表 (slope from to TERM ...)             → 内联 terminals，contour 由 to-from 符号决定
 *   - 列表 (X <degree> <dur>)                   → 显式音；#/b → ColorTone，否则 ChordTone
 *   - 列表 (builtin brick <name>)               → 标签，忽略
 *   - 其他列表                                  → 递归展开
 *   - 非终结符引用 "Seg2" / "V4" / "BRICK" 等   → 跳过（递归依赖图未在离线脚本中展开）
 */
function walkBody(node, out, contourDir) {
    if (Array.isArray(node)) {
        if (node.length === 0) return;
        const head = node[0];

        // (slope from to TERM ...)
        if (head === 'slope' && node.length >= 3) {
            const from = parseInt(node[1], 10);
            const to = parseInt(node[2], 10);
            const dir = (!Number.isFinite(from) || !Number.isFinite(to))
                ? contourDir
                : (to > from ? 1 : to < from ? -1 : 0);
            for (let i = 3; i < node.length; i++) walkBody(node[i], out, dir);
            return;
        }

        // (X <degree> <dur>) 显式音
        if (head === 'X' && node.length === 3 && typeof node[1] === 'string' && typeof node[2] === 'string') {
            const degStr = node[1];
            const duration = parseDuration(node[2]);
            const hasAccidental = /[#b]/.test(degStr);
            const kind = hasAccidental ? TerminalKind.ColorTone : TerminalKind.ChordTone;
            out.push({ kind, duration, contourDir, targetDegree: parseDegree(degStr) });
            return;
        }

        // 标签/元信息列表 — 不参与 token 抽取
        if (head === 'builtin' || head === 'parameter' || head === 'startsymbol' || head === 'base') return;

        // 其他列表 → 透明递归
        for (const child of node) walkBody(child, out, contourDir);
        return;
    }

    if (typeof node !== 'string') return;

    // 原子终结符：letter + duration
    const m = node.match(/^([A-Z])([0-9+/]+)$/);
    if (m) {
        const kind = LETTER_TO_KIND[m[1]];
        if (kind === undefined) return; // Q / H / 其他跳过
        out.push({ kind, duration: parseDuration(m[2]), contourDir, targetDegree: 0 });
    }
    // 非终结符 atom / 单字母 / 数字 → 跳过
}

// =================================================================================
// 4. 大师级抽取
// =================================================================================

/** "true"/"false"/数字字符串 → 对应类型；否则原样返回 */
function parsePrimitive(val) {
    if (typeof val !== 'string') return val;
    if (val === 'true') return true;
    if (val === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(val)) {
        const n = Number(val);
        if (Number.isFinite(n)) return n;
    }
    return val;
}

/**
 * 从一份完整 grammar 源码抽取 { params, motifs }
 *   params : (parameter (key value)) 字典
 *   motifs : 每条 rule body 展开后的 token 序列 + 原始权重
 *
 * 过滤策略：
 *   - body 解析后 token 数 < 2 → 丢弃（噪声）
 *   - 非 Rest token 数 < 2     → 丢弃（仅一个发声音的动机无和声意义）
 */
function extractMaster(grammarSrc) {
    const tokens = tokenize(grammarSrc);
    const exprs = parse(tokens);

    const params = {};
    const motifs = [];

    for (const expr of exprs) {
        if (!Array.isArray(expr) || expr.length === 0) continue;
        const head = expr[0];

        // (parameter (key value))
        if (head === 'parameter' && Array.isArray(expr[1]) && expr[1].length >= 2) {
            const key = expr[1][0];
            const val = expr[1][1];
            if (typeof key === 'string') params[key] = parsePrimitive(val);
            continue;
        }

        // (rule (LHS args...) (BODY) [annotations...] [weight])
        if (head === 'rule' && expr.length >= 3) {
            const body = expr[2];
            if (!Array.isArray(body)) continue;

            // weight = 末位 numeric atom，否则默认 1.0
            let weight = 1.0;
            for (let i = expr.length - 1; i >= 3; i--) {
                const e = expr[i];
                if (typeof e === 'string') {
                    const n = parseFloat(e);
                    if (Number.isFinite(n)) { weight = n; break; }
                }
            }

            const out = [];
            walkBody(body, out, 0);
            if (out.length < 2) continue;

            let nonRest = 0;
            for (const t of out) if (t.kind !== TerminalKind.Rest) nonRest++;
            if (nonRest < 2) continue;

            motifs.push({ tokens: out, weight: Number.isFinite(weight) ? weight : 1.0 });
        }
    }

    return { params, motifs };
}

// =================================================================================
// 5. 全局去重 → COMMON_GRAMMAR_ROOTS
// =================================================================================

/**
 * 骨架签名：仅 [kind, duration] 参与哈希。
 * contourDir 与 targetDegree 是 persona 派生属性（演奏意图层），不进入"骨架"指纹。
 * 这样同一节奏型不论上行/下行/具体音级都共享同一个根，最大化复用。
 */
function rootSignature(tokens) {
    let sig = '';
    for (const t of tokens) sig += t.kind + ',' + t.duration + ';';
    return sig;
}

// =================================================================================
// 6. TopologyConfig 派生
// =================================================================================

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * 从终结符频次统计派生 TopologyConfig。
 *
 * 启发式映射（与 TopologyMutator 语义对齐）：
 *   colorBias    = 色彩音占比 ×2，封顶 1.0
 *                  → 高色彩大师（Coltrane）抢 ChordTone 提升为 ColorTone
 *   probInvert   = 0.10 baseline + approach 比例 ×0.5
 *                  → 趋近音越多越倾向倒影（保持对称解决）
 *   probReverse  = 0.10 baseline + (1 − restRatio) ×0.10
 *                  → rest 多 = 句子破碎 → 不宜整体逆行
 *   probExpand   = 平均时值 < 3 单位（多 16/8 分） → 0.35（高速大师慢化变形）
 *                  否则 0.15（已经平缓 → 少做时值扩展）
 *   probSideSlip = 色彩音占比 ×1.2，封顶 0.5
 *   sideSlipRange = colorRatio > 0.2 ? 2 半音 : 1 半音
 */
function deriveTopology(stats) {
    const { colorRatio, restRatio, approachRatio, avgDuration } = stats;
    return {
        probInvert:    round3(clamp01(0.10 + approachRatio * 0.5)),
        probReverse:   round3(clamp01(0.10 + (1 - restRatio) * 0.10)),
        probExpand:    round3(clamp01(avgDuration < 3 ? 0.35 : 0.15)),
        probSideSlip:  round3(Math.max(0, Math.min(0.5, colorRatio * 1.2))),
        sideSlipRange: colorRatio > 0.2 ? 2 : 1,
        colorBias:     round3(clamp01(colorRatio * 2.0)),
    };
}

/** 统计 motif 池中各 kind 频次 + 平均时值 */
function computeStats(motifs) {
    let chord = 0, color = 0, rest = 0, approach = 0, total = 0, durSum = 0;
    for (const m of motifs) {
        for (const t of m.tokens) {
            total++;
            durSum += t.duration;
            switch (t.kind) {
                case TerminalKind.ChordTone:    chord++;    break;
                case TerminalKind.ColorTone:    color++;    break;
                case TerminalKind.ApproachTone: approach++; break;
                case TerminalKind.Rest:         rest++;     break;
            }
        }
    }
    const denom = total > 0 ? total : 1;
    return {
        chordRatio:    chord    / denom,
        colorRatio:    color    / denom,
        restRatio:     rest     / denom,
        approachRatio: approach / denom,
        avgDuration:   durSum   / denom,
    };
}

// =================================================================================
// 7. 输出器
// =================================================================================

/** 'CharlieParker' → 'Charlie Parker' */
function prettyName(id) {
    return id.replace(/([A-Z])/g, ' $1').trim();
}

function writeCommonRoots(roots) {
    fs.mkdirSync(path.dirname(COMMON_ROOTS_OUT), { recursive: true });
    const stamp = new Date().toISOString();
    const header = `// AUTO-GENERATED — DO NOT EDIT
// 编译器：scripts/compile-grammars.mjs
// 生成时间：${stamp}
// 输入：docs/ImproVisor_Master_Grammars.md (6 大师 Impro-Visor 语法)
//
// SRAM 区根骨架字典 — Persona 通过 customRootIds 引用本表。
// C 移植对应：
//   pack 为 uint16[] (kind:2 | duration:6 | contourDir+1:2 | targetDegree:6)
//   总占用 ~ ${roots.length} × avg_tokens × 2 byte
//
// AbstractToken 字段：
//   kind:         0=Rest / 1=ChordTone / 2=ColorTone / 3=ApproachTone
//   duration:     1~63，单位 = 16 分音符
//   contourDir:   -1=down / 0=flat / 1=up（slope 派生的演奏轮廓）
//   targetDegree: 0~63，0 = 无显式音级，1~7 = 自然调内级数

import type { GrammarRoot } from '../types';

export const COMMON_GRAMMAR_ROOTS: GrammarRoot[] = [
`;
    const body = roots.map((r) => {
        const tokenLines = r.tokens.map((t) =>
            `{ kind: ${t.kind}, duration: ${t.duration}, contourDir: ${t.contourDir}, targetDegree: ${t.targetDegree} }`
        ).join(', ');
        return `    { id: ${r.id}, baseWeight: ${r.baseWeight}, tokens: [${tokenLines}] },`;
    }).join('\n');
    fs.writeFileSync(COMMON_ROOTS_OUT, header + body + '\n];\n');
    console.log(`📦 写入 ${path.relative(PROJECT_ROOT, COMMON_ROOTS_OUT)} (${roots.length} roots)`);
}

// =================================================================================
// 8. 主流程
// =================================================================================

function main() {
    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`❌ 输入文件不存在: ${INPUT_FILE}`);
        process.exit(1);
    }
    const md = fs.readFileSync(INPUT_FILE, 'utf8');

    // 切分 "### File: grammars/<Name>.grammar ... ```lisp ... ```"
    const sectionRegex = /### File: grammars\/([A-Za-z]+)\.grammar\s*\n+```lisp\n([\s\S]*?)\n```/g;
    const masters = [];
    let m;
    while ((m = sectionRegex.exec(md))) {
        masters.push({ id: m[1], source: m[2] });
    }
    if (masters.length === 0) {
        console.error('❌ 未匹配到任何大师 grammar 段（检查 markdown 结构）');
        process.exit(1);
    }
    console.log(`📖 检测到 ${masters.length} 位大师: ${masters.map((x) => x.id).join(', ')}`);

    // Step 1: 逐大师 parse + extract motifs
    const extractions = masters.map(({ id, source }) => {
        const ex = extractMaster(source);
        console.log(`  ${id.padEnd(15)} params=${String(Object.keys(ex.params).length).padStart(2)}  motifs=${ex.motifs.length}`);
        return { id, ...ex };
    });

    // Step 2: 全局签名去重 + per-master 频次统计
    const sigToRoot = new Map();     // sig → { id, tokens, totalWeight, globalCount }
    const masterRootFreq = new Map(); // masterId → Map<rootId, freq>

    for (const ex of extractions) {
        const freq = new Map();
        for (const motif of ex.motifs) {
            const sig = rootSignature(motif.tokens);
            let entry = sigToRoot.get(sig);
            if (!entry) {
                entry = { id: sigToRoot.size, tokens: motif.tokens, totalWeight: 0, globalCount: 0 };
                sigToRoot.set(sig, entry);
            }
            entry.totalWeight += motif.weight;
            entry.globalCount += 1;
            freq.set(entry.id, (freq.get(entry.id) || 0) + 1);
        }
        masterRootFreq.set(ex.id, freq);
    }

    // Step 3: 按 globalCount 倒序 cap MAX_ROOTS，分配紧凑 id
    const sorted = Array.from(sigToRoot.values()).sort((a, b) => b.globalCount - a.globalCount);
    const kept = sorted.slice(0, MAX_ROOTS);
    const oldToNew = new Map();
    kept.forEach((entry, idx) => oldToNew.set(entry.id, idx));

    const commonRoots = kept.map((entry, idx) => ({
        id: idx,
        baseWeight: round3(Math.log1p(entry.totalWeight)),
        tokens: entry.tokens,
    }));

    console.log(`✅ 全局去重：${sigToRoot.size} 候选 → 保留 ${commonRoots.length}（cap=${MAX_ROOTS}）`);

    // Step 4: 写 SRAM 字典
    writeCommonRoots(commonRoots);

    // Step 5: 每位大师 → Flash Persona JSON
    fs.mkdirSync(PERSONAS_DIR, { recursive: true });
    for (const ex of extractions) {
        const stats = computeStats(ex.motifs);
        const topologyConfig = deriveTopology(stats);

        // customRootIds: 落在 kept 中的 root id（按本大师频次降序）
        const freq = masterRootFreq.get(ex.id);
        const ids = Array.from(freq.entries())
            .filter(([oldId]) => oldToNew.has(oldId))
            .map(([oldId, count]) => [oldToNew.get(oldId), count])
            .sort((a, b) => b[1] - a[1])
            .map(([newId]) => newId);

        const manifest = {
            id: ex.id,
            name: prettyName(ex.id),
            description: DESCRIPTIONS[ex.id] || '',
            customRootIds: ids,
            topologyConfig,
            params: ex.params,
            stats: {
                totalRules:     ex.motifs.length,
                totalRoots:     ids.length,
                chordToneRatio: round3(stats.chordRatio),
                colorToneRatio: round3(stats.colorRatio),
                restRatio:      round3(stats.restRatio),
            },
        };

        const outPath = path.join(PERSONAS_DIR, `${ex.id}.json`);
        fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
        console.log(`  📝 ${path.relative(PROJECT_ROOT, outPath).padEnd(45)} roots=${String(ids.length).padStart(3)}  colorBias=${topologyConfig.colorBias}`);
    }

    console.log('🎉 编译完成');
}

main();
