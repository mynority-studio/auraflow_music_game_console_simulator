/**
 * MasterLickCompiler — 大师 Grammar → 预编译 lickPool
 *
 * 职责（编译时）：
 *   - 输入：PersonaManifest（含 customRootIds → COMMON_GRAMMAR_ROOTS）
 *   - 输出：NoteData[][]（同 lickPool 数据形状，C 大三和弦 Cmaj7 / C Ionian 参考坐标）
 *   - 把每个 root 的 AbstractToken[] 翻译成具体 pitch NoteData[]，跳过 rest 推进 onset 游标。
 *
 * 与 takeover 路径的关系：
 *   takeover 走 MasterPhraseRenderer 在生成期产 TerminalSymbol（pitch 由 ToplineEngine 跟和弦实例化）；
 *   lick-only 走本编译器 **离线** 产具体 pitch NoteData，由 Stage5Layering 的 splice 路径在
 *   生成期按当前和弦 rootPc 平移 + localScaleMask snap。两者风格相同，介入深度不同。
 *
 * 编译期 PRNG 隔离（关键约束）：
 *   不调用 PRNGManager —— 用本地 LCG，seed 由 manifest.id hash 派生。
 *   保证：相同 manifest → 相同 lickPool；不污染运行期 PRNG 序列（D-5 不变）。
 *
 * 参考坐标（reference context）：
 *   chord.root = 0 (C), chord.quality = Major7, anchorPitch = 72 (C5), range = [60, 84]
 *   Splice 路径在运行期会按 targetChord.root 做相对平移 + Topology 变异，
 *   所以编译产物只需在 C 调下合理即可。
 *
 * 约束遵从（pipeline rule §4）：
 *   D-1: 编译期使用本地 LCG（不调 PRNGManager.next()）—— 编译时刻先于任何 setSeed
 *   D-2: 本模块仅在模块初始化时被调用一次（registry 派生卡牌时）
 *   K-1: 输出 NoteData 是 RELATIVE pitch（lickPool 约定）
 *   P-1: 扁平数组遍历
 *   T-3: 无 any
 *   S-3: 同步纯函数；无副作用（不写 console）
 */
import {
    AbstractToken,
    GrammarRoot,
    NoteData,
    PersonaManifest,
    TerminalKind,
    ChordQuality,
    CHORD_INTERVALS,
    CHORD_SCALE_INTERVALS,
} from '../types';
import { COMMON_GRAMMAR_ROOTS } from '../data/CommonRoots';
import { ToplineEngine } from '../pipeline/ToplineEngine';

const EPSILON = 1e-6;
const SIXTEENTHS_PER_BEAT = 4;
const PC = 12;

export interface CompileOptions {
    /** 取 baseWeight 前 K 大的 root 编译进 lickPool（默认 8 —— 兼顾签名感与内存） */
    topK?: number;
    /** 参考和弦 root PC（默认 0 = C） */
    refRootPc?: number;
    /** 参考和弦 quality（默认 Major7 = 标准 Cmaj7 容器） */
    refQuality?: ChordQuality;
    /** Cursor 初值 / lick 起跳锚（默认 72 = C5） */
    anchor?: number;
    /** Pitch 上下界（默认 [60, 84] = C4~C6，与 Stage5Layering.LEAD_RANGE 一致） */
    pitchRange?: [number, number];
}

const DEFAULTS: Required<CompileOptions> = {
    topK: 8,
    refRootPc: 0,
    refQuality: ChordQuality.Major7,
    anchor: 72,
    pitchRange: [60, 84],
};

/**
 * 把 PersonaManifest 编译成 NoteData[][]（一个 root 一个 lick）。
 *
 * 步骤：
 *   1. 解引用 customRootIds → GrammarRoot[]，按 baseWeight 降序取前 K
 *   2. 派生本地 LCG（seed = djb2(manifest.id)），用于 velocity 微抖动等次要决策
 *   3. 预算 chord/color PCs（参考 Cmaj7 + C Ionian）
 *   4. 逐 root 翻译：token → NoteData（rest 跳过但 onset 累计）
 *   5. 过滤空 lick（无 chord/color 命中的极端情况）
 */
export function compileMasterLickPool(
    manifest: PersonaManifest,
    opts?: CompileOptions,
): NoteData[][] {
    const cfg: Required<CompileOptions> = {
        topK:        opts?.topK        ?? DEFAULTS.topK,
        refRootPc:   opts?.refRootPc   ?? DEFAULTS.refRootPc,
        refQuality:  opts?.refQuality  ?? DEFAULTS.refQuality,
        anchor:      opts?.anchor      ?? DEFAULTS.anchor,
        pitchRange:  opts?.pitchRange  ?? DEFAULTS.pitchRange,
    };

    // ----------------------------------------------------------------
    // Step 1: 解引用并按 baseWeight 排序，取 top-K
    // ----------------------------------------------------------------
    const resolved: GrammarRoot[] = [];
    for (let i = 0; i < manifest.customRootIds.length; i++) {
        const rid = manifest.customRootIds[i];
        const r = COMMON_GRAMMAR_ROOTS[rid];
        if (r !== undefined && r.baseWeight > 0) resolved.push(r);
    }
    resolved.sort((a, b) => b.baseWeight - a.baseWeight);
    const topRoots = resolved.length > cfg.topK ? resolved.slice(0, cfg.topK) : resolved;

    // ----------------------------------------------------------------
    // Step 2: 本地 LCG（djb2 hash → seed）
    // ----------------------------------------------------------------
    const rng = createLocalRng(hashStringDjb2(manifest.id));

    // ----------------------------------------------------------------
    // Step 3: 预算 chord/color PC pool（一次性，循环外）
    // ----------------------------------------------------------------
    const chordPcs = buildPcPool(CHORD_INTERVALS[cfg.refQuality], cfg.refRootPc);
    const scalePcs = buildPcPool(CHORD_SCALE_INTERVALS[cfg.refQuality], cfg.refRootPc);
    // colorPcs = scale \ chord
    const colorPcs: number[] = [];
    for (let i = 0; i < scalePcs.length; i++) {
        if (chordPcs.indexOf(scalePcs[i]) < 0) colorPcs.push(scalePcs[i]);
    }

    // ----------------------------------------------------------------
    // Step 4: 逐 root 翻译
    // ----------------------------------------------------------------
    const pool: NoteData[][] = [];
    for (let i = 0; i < topRoots.length; i++) {
        const lick = compileRoot(topRoots[i], cfg, chordPcs, colorPcs, rng);
        if (lick.length > 0) pool.push(lick);
    }
    return pool;
}

// ============================================================
// 内部实现
// ============================================================

function compileRoot(
    root: GrammarRoot,
    cfg: Required<CompileOptions>,
    chordPcs: number[],
    colorPcs: number[],
    rng: () => number,
): NoteData[] {
    const out: NoteData[] = [];
    const [lo, hi] = cfg.pitchRange;
    let onset = 0;
    let cursor = cfg.anchor;

    for (let t = 0; t < root.tokens.length; t++) {
        const tok = root.tokens[t];
        const beats = tok.duration / SIXTEENTHS_PER_BEAT;
        if (beats <= EPSILON) continue;

        // Rest：不写 lickPool 条目，仅推进 onset（lickPool 约定为非休止序列）
        if (tok.kind === TerminalKind.Rest) {
            onset += beats;
            continue;
        }

        const pitch = resolvePitch(tok, cfg, chordPcs, colorPcs, cursor, lo, hi);
        if (pitch < 0) {
            onset += beats; // 解析失败也推 onset，保 lick 时长正确
            continue;
        }

        const velocity = pickVelocity(tok.kind, rng);
        out.push({ pitch, onset, duration: beats, velocity });
        cursor = pitch;
        onset += beats;
    }
    return out;
}

/**
 * AbstractToken → pitch（int 0~127）。
 *
 * 优先级（与 ToplineEngine.render Pass 1 同序，保证两条路径腔调一致）：
 *   1. targetDegree > 0 命中：(refRootPc + degreeToInterval) % 12，nearest to cursor
 *   2. 否则按 kind + contourDir 在 chord/color PC pool 里选最近 pitch
 *   3. ApproachTone：cursor - 1（默认下行半音 chromatic neighbor）
 */
function resolvePitch(
    tok: AbstractToken,
    cfg: Required<CompileOptions>,
    chordPcs: number[],
    colorPcs: number[],
    cursor: number,
    lo: number,
    hi: number,
): number {
    // ApproachTone：默认下行半音（NeoSoul approachDownProb=0.75 的多数情况）
    if (tok.kind === TerminalKind.ApproachTone) {
        let p = cursor - 1;
        while (p < lo) p += 12;
        while (p > hi) p -= 12;
        return p;
    }

    // chordTone / colorTone — targetDegree 优先
    if (tok.targetDegree > 0) {
        const interval = ToplineEngine.degreeToInterval(tok.targetDegree, cfg.refQuality);
        const targetPc = (((cfg.refRootPc + interval) % PC) + PC) % PC;
        const p = ToplineEngine.findNearestPitchByPc(targetPc, cursor, lo, hi);
        if (p >= 0) return p;
    }

    // 默认 PC pool nearest（按方向约束过滤）
    const pool = tok.kind === TerminalKind.ChordTone ? chordPcs : colorPcs;
    return pickNearestPitchFromPool(pool, cursor, lo, hi, tok.contourDir);
}

/** 在 PC 集合中找距 cursor 最近的 pitch；contourDir ±1 时过滤方向，无候选则放松 */
function pickNearestPitchFromPool(
    pcs: number[],
    cursor: number,
    lo: number,
    hi: number,
    contourDir: number,
): number {
    // First pass: 带方向过滤
    let best = -1;
    let bestDist = Number.MAX_SAFE_INTEGER;
    for (let p = lo; p <= hi; p++) {
        const pc = ((p % PC) + PC) % PC;
        let inPool = false;
        for (let i = 0; i < pcs.length; i++) {
            if (pcs[i] === pc) { inPool = true; break; }
        }
        if (!inPool) continue;
        if (contourDir === 1 && p <= cursor) continue;
        if (contourDir === -1 && p >= cursor) continue;
        const d = p > cursor ? p - cursor : cursor - p;
        if (d < bestDist) { bestDist = d; best = p; }
    }
    if (best >= 0) return best;

    // Fallback: 放松方向
    if (contourDir !== 0) {
        return pickNearestPitchFromPool(pcs, cursor, lo, hi, 0);
    }
    return -1; // 池空（极端兜底）
}

function buildPcPool(intervals: number[] | undefined, rootPc: number): number[] {
    if (intervals === undefined) return [];
    const out: number[] = [];
    for (let i = 0; i < intervals.length; i++) {
        const pc = (((intervals[i] + rootPc) % PC) + PC) % PC;
        // 去重（intervals 含 14/17/21 等 octave 扩展，mod 12 后会与基本三和弦音重叠）
        let dup = false;
        for (let j = 0; j < out.length; j++) if (out[j] === pc) { dup = true; break; }
        if (!dup) out.push(pc);
    }
    return out;
}

/** Velocity 派生（0-1 float，lickPool 约定格式）—— 力度按 kind 分层，rng 抖动 */
function pickVelocity(kind: TerminalKind, rng: () => number): number {
    let base: number;
    let span: number;
    if (kind === TerminalKind.ChordTone) {
        base = 0.78; span = 0.10; // 0.78~0.88（重）
    } else if (kind === TerminalKind.ColorTone) {
        base = 0.72; span = 0.10; // 0.72~0.82（中）
    } else {
        // ApproachTone
        base = 0.62; span = 0.10; // 0.62~0.72（软）
    }
    return base + rng() * span;
}

/** djb2 字符串 hash → uint32 */
function hashStringDjb2(s: string): number {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
    }
    return h >>> 0;
}

/** Park–Miller LCG（与 MasterPhraseRenderer 的 caller-注入风格一致） */
function createLocalRng(seed: number): () => number {
    let state = (seed >>> 0) || 1;
    return () => {
        // 与 PRNGManager 同形 LCG，但状态隔离
        state = ((state * 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}
