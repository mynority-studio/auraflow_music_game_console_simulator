/**
 * ToplineEngine — 抽象终止符 → 物理 pitch 实例化（Phase 6）
 *
 * 职责：消费 PCFGGrammarEngine 吐出的 TerminalSymbol[]（kind + duration，无 pitch），
 *      跟随当前和弦 + 调式将其转化为 NoteData[]。
 *
 * 参考实现：Impro-Visor `MelodyGenerator.closestToMiddle` / `randomChordOrColorTone`
 *
 * 两遍处理（Two-Pass）：
 *   Pass 1（顺序，每 chord/color tone ×2 PRNG）：
 *     遍历 terminals，对每个 chordTone / colorTone 调用 pickPitchInMask：
 *       PRNG #1 判定是否触发 leap（< leapProbability 触发）
 *       PRNG #2 抽取候选索引（leap 分支用，nearest 分支空转消耗）
 *     不触发 leap → 在候选池中选"离 cursor 绝对距离最近"（保留连贯性）
 *     触发 leap → 过滤掉 |p - cursor| <= 2 的近音，剩余池随机抽（打破轨道锁定）
 *     兜底：远音池空 → 完整池随机抽；候选池空 → 静音
 *     approachTone 留空（pitch = -1），等 Pass 2 回填。
 *
 *   Pass 2（顺序，每 approach ×1 PRNG）：
 *     扫描 approach 槽位，找下一个已决定 pitch 的非 rest 槽位作 target，按
 *     approachDownProb 概率决定下方半音 chromatic neighbor 或上方调内 diatonic neighbor。
 *
 *   Pass 3（顺序，零 PRNG）：智能踏板（chord-aware sustain + 句尾延音）。
 *     对每个已决定 pitch 的 slot，把 duration 从 grammar 给的硬切时长线性插值到
 *     "自然踏板时长"（= min(下一发声音 onset, 当前和弦 endBeat) - 本音 onset）：
 *       final_dur = lerp(grammar_dur, pedaled_dur, legatoRatio)
 *     和弦边界硬钳（钢琴家换和弦必松踏板）；rest 透明（钢琴阻尼器下落需时间，
 *     短 rest 内的音会自然续响）。零 PRNG 消耗 → 保留 D-5 序列对齐。
 *
 * 设计要点：
 *   1. K-1 / K-2 / K-5：全程 RELATIVE 空间，绝不读 GlobalContext.currentKeyOffset；
 *      Orchestrator.applyOffset() 是唯一的相对 → 绝对转换点。
 *   2. cursor 初值 anchorPitch（默认 72 = C5）— RELATIVE 空间中 C5 在 tonic PC=0 上。
 *   3. ChordTone 池 = CHORD_INTERVALS[chord.quality] 全部音程（root / 3 / 5 / 7 / ext）
 *      过 mod 12 + chord.root 偏移得到 PC 列表。
 *   4. ColorTone 池 = CHORD_SCALE_INTERVALS[chord.quality] PC 列表 \ ChordTone PC 列表
 *      （Phase 6.3.5：Chord-Scale Theory 局部音阶 — Major7→Ionian / Minor7→Dorian /
 *      Dominant7→Mixolydian / HalfDim→Locrian / Dim7→Whole-Half。空池时回落到
 *      ChordTone 池。摒弃旧的"全局 SCALE_INTERVALS[tonality] 取交集"写法 — 借用 /
 *      副属和弦不再被全局调式锁死，从根本上规避 Minor 9th 撞音）。
 *   5. PRNG 消耗（D-1 / D-5）：
 *      - Pass 1：每 chord/color tone ×2（leap 判定 + 索引抽取，恒定消耗）
 *      - Pass 2：每 approach ×1（方向二选一加权抽样）
 *      - Pass 3：零（纯后处理，duration 字段插值）
 *
 * Phase 6.2 — Harmonic Sequence 支持：
 *   PCFGGrammarEngine 的 motif recall 路径会在被回放序列的首个 terminal 上打
 *   `motifStart = true`。本引擎 Pass 1 检测到此标记时**重置 cursor 至 anchorPitch**，
 *   让同一动机在不同和弦/和声上重复时具有相同的"起跳锚"。
 *   起跳后的 chord-aware "nearest pitch in mask" 自动把首音吸到当前和弦内音 —
 *   不同和弦自然产生不同的具体起音，这就是和声模进（Harmonic Sequence）。
 *
 *   该重置完全在 Pass 1 内完成；Pass 2（approach 回填）不感知 motifStart —
 *   approach 永远基于已决定的下一个 pitch 反算，与是否在 motif 边界无关。
 *
 * 约束遵从（pipeline rule §4）：
 *   D-1: PRNG 通过 PRNGManager.next()
 *   D-3: 内部无非确定排序；输出由 Stage5Layering 统一 sort
 *   D-4 / C-1: beat / duration 浮点比较走 epsilon
 *   P-1: 无 Map/Set，全数组线性扫描
 *   T-1: TerminalKind 与 Tonality 走 enum/literal union 类型比较
 *   T-3: 无 any
 *   T-5: motifStart 用 `=== true` 显式判定，不依赖 undefined falsy 语义
 *   S-2 / S-3 / S-4: 显式参数、同步、输出纯数据
 *   K-1 / K-2 / K-5 / K-7: RELATIVE 全程，不加 keyOffset，不读 GlobalContext
 */

import { PRNGManager } from '../../utils/PRNG';
import {
    GeneratedChord, NoteData, Tonality, ChordQuality,
    CHORD_INTERVALS, SCALE_INTERVALS, CHORD_SCALE_INTERVALS,
} from '../types';
import { TerminalSymbol, TerminalKind } from '../primitives/PCFGGrammarEngine';

const EPSILON = 1e-6;
const PITCH_CLASS_SIZE = 12;

const DEFAULT_PITCH_LO = 60;      // C4
const DEFAULT_PITCH_HI = 84;      // C6
const DEFAULT_ANCHOR = 72;        // C5
const DEFAULT_APPROACH_DOWN_PROB = 0.5;
const DEFAULT_LEAP_PROBABILITY = 0.2;
const LEAP_NEAR_THRESHOLD = 2;    // |p - cursor| <= 此值视为"近音"，leap 时剔除

/** Pass 1 / Pass 2 中间表示 — pitch = -1 表示尚未决定 / rest */
interface PitchSlot {
    pitch: number;
    onset: number;
    duration: number;
    kind: TerminalKind;
    /** Phase 6.2 — motif recall 首音；Pass 1 检测到时重置 cursor 至 anchorPitch */
    motifStart: boolean;
    /** Phase 6.2 observability — 动机身份标签，原样透传到 NoteData.motifName（不影响生成） */
    motifName: string | undefined;
    /**
     * Phase 6.3 — 显式靶向音级（0 sentinel = 未设置）。
     * 非 0 时 Pass 1 优先按 (chord.root + degreeToInterval(degree, quality)) mod 12
     * 算法计算 PC，绕过 mask 抽样。0 sentinel 保留是为了 C 移植期间避免 undefined / Optional 包装。
     */
    targetDegree: number;
    /**
     * Phase 6.3 — 方向约束（0 sentinel = 未设置；±1 = 限制方向）。
     * 非 0 时 Pass 1 在 mask 收集阶段过滤方向不符的候选；
     * targetDegree 已命中时本字段被忽略（优先级低）。
     */
    contourDir: number;
}

export interface ToplineInput {
    /** PCFGGrammarEngine.expand() 输出 — 按时间正序，已知 kind 和 duration */
    terminals: TerminalSymbol[];
    /** 当前段落覆盖的和弦序列（已过滤至 section 内，按 startBeat 升序） */
    chords: GeneratedChord[];
    /** 段落起拍（相对全曲）— terminals 的第一个音落在此处 */
    startBeat: number;
    /** 调式 — 决定 ColorTone 池和 approachTone 上行 diatonic neighbor 的合法 PC */
    tonality: Tonality;
    /** velocity 范围（int 0~127）— 来自 Persona.dynamicRange */
    velocityRange: [number, number];
    /** Pitch 工作区间（RELATIVE，含端点）— 默认 [60, 84] = C4~C6 */
    pitchRange?: [number, number];
    /** Cursor 初值（RELATIVE）— 默认 72 = C5 */
    anchorPitch?: number;
    /** approach 走下方半音 vs 上方调内音的概率 — Pop 0.5 / NeoSoul 0.75 */
    approachDownProb?: number;
    /**
     * 触发"大跳（Leap）"的概率 — 默认 0.2。
     * 用于打破 nearest-cursor 的轨道锁定，让旋律真正铺开到 [pitchRange] 全幅。
     * 触发时从候选池中剔除 |p - cursor| <= 2 的近音再随机抽。
     */
    leapProbability?: number;
    /**
     * Phase 6 智能踏板 — Pass 3 后处理系数，默认 1.0（自然踏板）。
     * 0 = 干（grammar duration 不变）/ 1 = 延音至下一个发声音或和弦边界 / >1 = 过踏（被和弦边界硬钳）。
     * 零 PRNG 消耗 — 保留黄金种子（pitch 序列不变，仅 duration 字段变化）。
     */
    legatoRatio?: number;
}

export class ToplineEngineError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'ToplineEngineError';
        this.context = context;
    }
}

export class ToplineEngine {
    /**
     * 入口：抽象 terminals → 物理 NoteData[]。
     *
     * Pitch Space: RELATIVE — 输出 pitch 不含 keyOffset。
     *
     * PRNG 消耗：
     *   - Pass 1：(chordTone + colorTone) 个数 × 2
     *   - Pass 2：approachTone 个数 × 1
     *   - Pass 3：0（纯后处理）
     */
    public static render(input: ToplineInput): NoteData[] {
        ToplineEngine.validate(input);

        const rangeLo = input.pitchRange ? input.pitchRange[0] : DEFAULT_PITCH_LO;
        const rangeHi = input.pitchRange ? input.pitchRange[1] : DEFAULT_PITCH_HI;
        const anchor = input.anchorPitch !== undefined ? input.anchorPitch : DEFAULT_ANCHOR;
        const approachDownProb = input.approachDownProb !== undefined
            ? input.approachDownProb : DEFAULT_APPROACH_DOWN_PROB;
        const leapProb = input.leapProbability !== undefined
            ? input.leapProbability : DEFAULT_LEAP_PROBABILITY;
        const legatoRatio = input.legatoRatio !== undefined
            ? input.legatoRatio : 1.0;

        const scalePcMask = ToplineEngine.buildScaleMask(input.tonality);

        // P-1 / M-1：复用候选池 buffer，避免热循环内反复分配
        const candidatesBuffer: number[] = [];

        // -----------------------------------------------------------
        // Pass 0：terminals → PitchSlot[]（带 onset，rest 标记保留，motifStart 传递）
        // -----------------------------------------------------------
        const slots: PitchSlot[] = [];
        let beatCursor = input.startBeat;
        for (let i = 0; i < input.terminals.length; i++) {
            const term = input.terminals[i];
            slots.push({
                pitch: -1,
                onset: beatCursor,
                duration: term.duration,
                kind: term.kind,
                // T-5：显式 === true，不靠 undefined falsy
                motifStart: term.motifStart === true,
                // observability 标签原样透传（undefined → undefined，不参与音高决策）
                motifName: term.motifName,
                // Phase 6.3 — 轮廓字典 hint 投影到 slot（undefined → 0 sentinel，T-5 合规）
                targetDegree: term.targetDegree !== undefined ? term.targetDegree : 0,
                contourDir: term.contourDir !== undefined ? term.contourDir : 0,
            });
            beatCursor += term.duration;
        }

        // -----------------------------------------------------------
        // Pass 1：决定所有 chordTone / colorTone 的 pitch（cursor 推进）
        //
        // Phase 6.2 — motifStart 触发 cursor 重置：
        //   每个 motif 首音都从 anchorPitch 起跳，让 chord-aware "nearest pitch in mask"
        //   在新和弦上给出不同但稳定的首音 — 自然形成和声模进。
        //   该重置无视 kind（rest / approach 也重置）— 保证 motif 边界语义一致性。
        // -----------------------------------------------------------
        let pitchCursor = anchor;
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];

            // motif 起点重锚（在 kind 分支之前完成）— 即使 motif 首音是 rest/approach，
            // cursor 也已对齐 anchor，后续首个 chord/color 仍从 anchor 出发。
            if (slot.motifStart) {
                pitchCursor = anchor;
            }

            if (slot.kind === 'rest' || slot.kind === 'approachTone') continue;

            const chord = ToplineEngine.findChordAt(input.chords, slot.onset);
            if (chord === null) continue;  // 段落起拍前/后无和弦 — 静音

            // -------------------------------------------------------
            // Phase 6.3 — Hint 优先级：targetDegree > contourDir > 默认
            //
            // D-5：所有 chord/color tone 节点恒定消耗 PRNG ×2（leapRoll + pickRoll），
            //      不论分支命中。下面三个分支都通过 pickPitchInMask 或显式 next() ×2
            //      保持节点级 PRNG 配额恒定 — 让带 hint 的规则与不带 hint 的规则在
            //      同 seed 下产生严格对齐的下游消耗序列。
            // -------------------------------------------------------

            // Branch 1 — targetDegree 命中：算法计算 PC，绕过 mask 抽样
            if (slot.targetDegree !== 0) {
                const interval = ToplineEngine.degreeToInterval(slot.targetDegree, chord.quality);
                const targetPc = (((chord.root + interval) % PITCH_CLASS_SIZE) + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE;
                // D-5：空转消耗（替代 pickPitchInMask 内的 leapRoll / pickRoll）
                PRNGManager.next();
                PRNGManager.next();
                const picked = ToplineEngine.findNearestPitchByPc(targetPc, pitchCursor, rangeLo, rangeHi);
                if (picked >= 0) {
                    slot.pitch = picked;
                    pitchCursor = picked;
                }
                continue;
            }

            // Branch 2 / 3 — 走 mask 路径（包含 contourDir 过滤）
            // Phase 6.3.5 — colorPcMask 已切换到 Chord-Scale Theory（局部音阶），
            //               不再依赖全局 scalePcMask；签名同步收窄。
            let pcMask: number;
            if (slot.kind === 'chordTone') {
                pcMask = ToplineEngine.chordPcMask(chord);
            } else {
                pcMask = ToplineEngine.colorPcMask(chord);
            }
            if (pcMask === 0) continue;  // 池空 — 静音（原行为：不消耗 PRNG，保持旧 seed 对齐）

            // 引力向量预瞄 — 下一拍/下一和弦根音作为锚点（零 PRNG）
            //   gravityTarget 未命中 chord 时为 undefined，pickPitchInMask 退化为纯 nearest。
            let gravityTarget: number | undefined = undefined;
            const nextBeat = slot.onset + Math.max(1.0, slot.duration);
            const targetChord = ToplineEngine.findChordAt(input.chords, nextBeat);
            if (targetChord !== null) {
                const rootPc = ((targetChord.root % PITCH_CLASS_SIZE) + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE;
                const foundAnchor = ToplineEngine.findNearestPitchByPc(rootPc, pitchCursor, rangeLo, rangeHi);
                if (foundAnchor >= 0) gravityTarget = foundAnchor;
            }

            const picked = ToplineEngine.pickPitchInMask(
                pcMask, pitchCursor, rangeLo, rangeHi,
                leapProb, candidatesBuffer, slot.contourDir,
                gravityTarget, 0.35,
            );
            if (picked < 0) continue;
            slot.pitch = picked;
            pitchCursor = picked;
        }

        // -----------------------------------------------------------
        // Pass 2：回填 approachTone — 查 Pass 1 已决定的下一个 pitch 作 target
        // -----------------------------------------------------------
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (slot.kind !== 'approachTone') continue;

            const target = ToplineEngine.findNextResolvedPitch(slots, i);
            if (target < 0) continue;  // 无后继 chord/color tone — approach 静音

            // PRNG ×1：下方半音 chromatic vs 上方调内 diatonic
            const goDown = PRNGManager.next() < approachDownProb;
            let candidate: number;
            if (goDown) {
                candidate = target - 1;  // chromatic leading tone from below
            } else {
                // 上方最近调内音（若 target 已在调内，则下一个调内音；否则就近 ceil）
                candidate = ToplineEngine.nearestScalePitchAbove(target, scalePcMask);
            }
            // clamp 到 range
            if (candidate < rangeLo) candidate = rangeLo;
            else if (candidate > rangeHi) candidate = rangeHi;
            slot.pitch = candidate;
        }

        // -----------------------------------------------------------
        // Pass 3：智能踏板（chord-aware sustain + 句尾延音）
        // 零 PRNG 消耗 — 保留 D-5 黄金种子的 pitch 序列对齐。
        // -----------------------------------------------------------
        ToplineEngine.applyIntelligentPedal(slots, input.chords, legatoRatio);

        // -----------------------------------------------------------
        // 输出 NoteData[]（velocity：chordTone 重，其他中）
        // -----------------------------------------------------------
        const veloLo = input.velocityRange[0];
        const veloHi = input.velocityRange[1];
        const veloMid = Math.floor((veloLo + veloHi) / 2);

        const out: NoteData[] = [];
        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (slot.kind === 'rest') continue;
            if (slot.pitch < 0) continue;
            const veloInt = slot.kind === 'chordTone' ? veloHi : veloMid;
            const note: NoteData = {
                pitch: slot.pitch,
                onset: slot.onset,
                duration: slot.duration,
                velocity: veloInt / 127,
            };
            // observability：仅当 motifName 存在时才挂字段，保持普通路径的 NoteData 干净
            if (slot.motifName !== undefined) note.motifName = slot.motifName;
            out.push(note);
        }
        return out;
    }

    // ============================================================
    // PC mask helpers — 用 12-bit 位掩码代替 Set<number>（P-1 / C-3）
    // ============================================================

    /** SCALE_INTERVALS[tonality] → 12-bit PC mask（PC 相对 tonic = 0） */
    private static buildScaleMask(tonality: Tonality): number {
        const intervals = SCALE_INTERVALS[tonality];
        if (intervals === undefined || intervals.length === 0) {
            throw new ToplineEngineError(
                `unknown Tonality: ${tonality}`,
                { tonality },
            );
        }
        let mask = 0;
        for (let i = 0; i < intervals.length; i++) {
            mask |= 1 << (intervals[i] % PITCH_CLASS_SIZE);
        }
        return mask;
    }

    /** 和弦内音 PC mask — CHORD_INTERVALS[quality] 全部音程，含色彩扩展（9/11/13） */
    private static chordPcMask(chord: GeneratedChord): number {
        const intervals = CHORD_INTERVALS[chord.quality];
        if (intervals === undefined || intervals.length === 0) {
            return 0;
        }
        let mask = 0;
        for (let i = 0; i < intervals.length; i++) {
            const pc = (chord.root + intervals[i]) % PITCH_CLASS_SIZE;
            mask |= 1 << pc;
        }
        return mask;
    }

    /**
     * Phase 6.3.5 — Chord-Scale Theory 局部音阶 mask。
     *
     * CHORD_SCALE_INTERVALS[chord.quality] 给出该和弦质量在伯克利体系下最适配的
     * 局部特征音阶半音步长（root-relative），每个 step 加上 chord.root 并 mod 12，
     * 压缩成 12-bit PC mask。Pitch Space: RELATIVE — 禁止预补偿 keyOffset（K-2）。
     *
     * 未列出的 quality 兜底用 Ionian（与表里的 Major / Major7 同形）。
     */
    private static buildLocalScaleMask(chord: GeneratedChord): number {
        let intervals = CHORD_SCALE_INTERVALS[chord.quality];
        if (intervals === undefined || intervals.length === 0) {
            intervals = SCALE_INTERVALS[Tonality.Major];  // Ionian 兜底
        }
        let mask = 0;
        for (let i = 0; i < intervals.length; i++) {
            const pc = ((chord.root + intervals[i]) % PITCH_CLASS_SIZE + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE;
            mask |= 1 << pc;
        }
        return mask;
    }

    /**
     * 色彩音 PC mask — Phase 6.3.5 CST 升级：
     *   colorMask = localScaleMask(chord) AND NOT chordMask
     *
     * 局部音阶由 CHORD_SCALE_INTERVALS[chord.quality] 决定（见 buildLocalScaleMask），
     * 不再借用全局 scalePcMask — 这从根本上规避借用 / 副属和弦（如 C 大调里
     * 的 D7 / E7）色彩音池里跳出与全局自然音冲突的 Minor 9th。
     *
     * 空池时回落到 chordMask（保证总有候选，不静音）。
     */
    private static colorPcMask(chord: GeneratedChord): number {
        const chordMask = ToplineEngine.chordPcMask(chord);
        const localScaleMask = ToplineEngine.buildLocalScaleMask(chord);
        const color = localScaleMask & ~chordMask & 0xFFF;  // 限制在 12 PC
        return color === 0 ? chordMask : color;
    }

    /**
     * Phase 6.3 — Contour Breakout：在 [lo, hi] 内按 pcMask 抽一个 pitch。
     *
     * Pitch Space: RELATIVE
     *
     * 算法：
     *   Step A — 收集候选池：扫描 [lo, hi]，把 PC ∈ pcMask 的 pitch 装入 candidates。
     *            若 contourDir ≠ 0，同时按方向（>0 上行 / <0 下行）过滤；空池兜底回退全池。
     *   Step B — PRNG ×2 恒定消耗（D-5 序列对齐）：
     *     PRNG #1 leapRoll：< leapProb → 进入 leap 分支
     *     PRNG #2 pickRoll：leap 分支用作索引；nearest 分支空转消耗
     *   Step C — 分支决策：
     *     Nearest 分支：candidates 中选 |p - cursor| 最小者（保留连贯性）。
     *                   等距偏好较低音（升序扫描 + 严格 <，沿用原 musical convention）。
     *     Leap 分支：candidates 中剔除 |p - cursor| <= LEAP_NEAR_THRESHOLD 的近音，
     *                剩余池中按 pickRoll 抽索引。打破 cursor 的轨道锁定。
     *     兜底（防空）：
     *       远音池空（candidates 全在 cursor ±2 半音内）→ 完整 candidates 按 pickRoll 抽。
     *       candidates 整体空（pcMask 与 [lo, hi] 无交集）→ 返回 -1（caller 静音处理）。
     *
     * candidatesBuffer 由 caller 提供并跨调用复用（P-1 / M-1）。
     * contourDir = 0 时退化为方向无关的原算法（向后兼容旧黄金种子）。
     */
    private static pickPitchInMask(
        pcMask: number, cursor: number, lo: number, hi: number,
        leapProb: number, candidatesBuffer: number[],
        contourDir: number,
        gravityTarget?: number, gravityWeight: number = 0.3,
    ): number {
        // Step A：收集候选池（原位重填）
        //   Phase 6.3 — 若 contourDir !== 0，按方向过滤；若过滤后空池，回退到全池
        //   （保证不静音；PRNG ×2 不受影响）。
        candidatesBuffer.length = 0;
        for (let p = lo; p <= hi; p++) {
            const pc = ((p % PITCH_CLASS_SIZE) + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE;
            if ((pcMask & (1 << pc)) === 0) continue;
            if (contourDir > 0 && p <= cursor) continue;   // 强制上行：剔除 ≤ cursor
            if (contourDir < 0 && p >= cursor) continue;   // 强制下行：剔除 ≥ cursor
            candidatesBuffer.push(p);
        }
        // 方向过滤后空池兜底：放弃方向，重收全池（cursor 已撞边界的情况）
        if (candidatesBuffer.length === 0 && contourDir !== 0) {
            for (let p = lo; p <= hi; p++) {
                const pc = ((p % PITCH_CLASS_SIZE) + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE;
                if ((pcMask & (1 << pc)) === 0) continue;
                candidatesBuffer.push(p);
            }
        }

        // Step B：PRNG ×2 恒定消耗 — 即使候选池为空、走 nearest 分支或发生兜底，
        // 这两次调用都必须空转消耗，否则不同种子/分支会让消耗次数漂移，破坏 D-5。
        const leapRoll = PRNGManager.next();
        const pickRoll = PRNGManager.next();

        const N = candidatesBuffer.length;
        if (N === 0) return -1;

        // Step C：Leap 分支
        if (leapRoll < leapProb) {
            // 先统计远音个数（不分配新数组 — P-1 / C-3）
            let farCount = 0;
            for (let i = 0; i < N; i++) {
                if (Math.abs(candidatesBuffer[i] - cursor) > LEAP_NEAR_THRESHOLD) {
                    farCount++;
                }
            }
            if (farCount > 0) {
                // 按 pickRoll 取第 targetIdx 个远音
                const targetIdx = Math.floor(pickRoll * farCount);
                let seen = 0;
                for (let i = 0; i < N; i++) {
                    if (Math.abs(candidatesBuffer[i] - cursor) > LEAP_NEAR_THRESHOLD) {
                        if (seen === targetIdx) return candidatesBuffer[i];
                        seen++;
                    }
                }
                // 理论不达（targetIdx ∈ [0, farCount)），安全兜底
                return candidatesBuffer[N - 1];
            }
            // 兜底：远音池空 → 完整 candidates 随机抽
            const idx = Math.floor(pickRoll * N);
            return candidatesBuffer[idx];
        }

        // Step C：Nearest 分支（pickRoll 已被空转消耗）
        //   引力向量：候选打分 = (1 - gw) * |p - cursor| + gw * |p - gravity|
        //   gravityTarget 未提供时退化为纯 nearest（与原算法字节对齐）。
        let best = candidatesBuffer[0];
        let bestScore = Math.abs(best - cursor);
        if (gravityTarget !== undefined) {
            bestScore = bestScore * (1 - gravityWeight) + Math.abs(best - gravityTarget) * gravityWeight;
        }
        for (let i = 1; i < N; i++) {
            let score = Math.abs(candidatesBuffer[i] - cursor);
            if (gravityTarget !== undefined) {
                score = score * (1 - gravityWeight) + Math.abs(candidatesBuffer[i] - gravityTarget) * gravityWeight;
            }
            // 严格 < — 同距离保留先到（升序扫描 = 较低音），沿用原 musical convention
            if (score < bestScore) {
                bestScore = score;
                best = candidatesBuffer[i];
            }
        }
        return best;
    }

    /**
     * Phase 6.3 — 把音级序号（1/3/5/7/9/11/13）映射到 chord.root 之上的半音偏移。
     *
     * Pitch Space: RELATIVE — 返回值是相对 chord.root 的半音数（未 mod 12，caller 取模）。
     *
     * 算法（C-portable，扁平扫描）：
     *   degree 1     → 0（根音永远存在）
     *   degree 3/5/7 → 扫描 CHORD_INTERVALS[quality]，取首个 PC 落在对应半音区间的 interval：
     *                  - 3 ∈ [2..5]   （含小三 3 / 大三 4 / sus4 占位 5）
     *                  - 5 ∈ [6..8]   （含减五 6 / 纯五 7 / 增五 8）
     *                  - 7 ∈ [9..11]  （含小七 10 / 大七 11 / 减七 9）
     *                  未命中（如三和弦无 7th）→ 用大调三和弦兜底（3=4, 5=7, 7=10）。
     *   degree 9     → 14（一个八度上的 2 度）
     *   degree 11    → 17（一个八度上的 4 度）
     *   degree 13    → 21（一个八度上的 6 度）
     *
     * 这些 tension 偏移与 quality 无关 — 它们的 PC 由 chord.root 移动决定，
     *   ToplineEngine 通过 mod 12 把它们映射到调内合法 PC（也可能落在调外，
     *   由 caller 的 mask / scale 兜底处理）。
     */
    public static degreeToInterval(degree: number, quality: ChordQuality): number {
        if (degree === 1) return 0;
        if (degree === 9) return 14;
        if (degree === 11) return 17;
        if (degree === 13) return 21;

        let loBound = 0, hiBound = 0, fallback = 0;
        if (degree === 3)      { loBound = 2; hiBound = 5;  fallback = 4;  }
        else if (degree === 5) { loBound = 6; hiBound = 8;  fallback = 7;  }
        else if (degree === 7) { loBound = 9; hiBound = 11; fallback = 10; }
        else return 0;  // 未知 degree（防御兜底，等效根音）

        const intervals = CHORD_INTERVALS[quality];
        if (intervals === undefined || intervals.length === 0) return fallback;

        for (let i = 0; i < intervals.length; i++) {
            const m = intervals[i] % PITCH_CLASS_SIZE;
            if (m >= loBound && m <= hiBound) return intervals[i];
        }
        return fallback;
    }

    /**
     * Phase 6.3 — 在 [lo, hi] 内寻找 PC 严格匹配 targetPc 且距 cursor 最近的 pitch。
     *
     * Pitch Space: RELATIVE
     *
     * 算法（线性扫描 + 严格 < 偏好较低音，与 pickPitchInMask Nearest 分支语义一致）：
     *   1. 升序扫 p ∈ [lo, hi]，跳过 PC 不匹配的 pitch；
     *   2. 维护最小 |p - cursor| 的最佳候选；
     *   3. 候选池全空（PC 在 [lo, hi] 内不出现 — 理论几乎不可能，调内有 12 个 PC）→ 返回 -1。
     */
    public static findNearestPitchByPc(
        targetPc: number, cursor: number, lo: number, hi: number,
    ): number {
        let best = -1;
        let bestDist = Number.MAX_SAFE_INTEGER;
        for (let p = lo; p <= hi; p++) {
            const pc = ((p % PITCH_CLASS_SIZE) + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE;
            if (pc !== targetPc) continue;
            const d = Math.abs(p - cursor);
            // 严格 < — 等距时偏好升序扫描中先到的较低音（与 pickPitchInMask 一致）
            if (d < bestDist) {
                bestDist = d;
                best = p;
            }
        }
        return best;
    }

    /**
     * Pass 3 — 智能踏板（chord-aware sustain + 句尾延音）。
     *
     * 算法（零 PRNG 消耗，纯后处理）：
     *   对每个已决定 pitch 的 slot：
     *     1. 查当前 slot 所在和弦 chord_i — null 则跳过（段边界，保持 grammar duration）。
     *     2. 向后扫描找**下一个发声音**（pitch >= 0，跳过 rest / 未决 approach）的 onset：
     *        - 找到 → ceiling = min(next_onset, chord_i.endBeat)
     *        - 未找到 → ceiling = chord_i.endBeat（句尾延音至和弦边界）
     *     3. pedaled_dur = ceiling - slot.onset（自然踏板时长）
     *     4. final_dur = lerp(grammar_dur, pedaled_dur, legatoRatio)
     *        - ratio = 0：final = grammar（干，纯 grammar）
     *        - ratio = 1：final = pedaled（完全踏板，钢琴自然延音）
     *        - ratio > 1：过踏（仍被 chord.endBeat 硬钳）
     *     5. 硬钳：never < grammar_dur（不缩短）、never > chord.endBeat - onset（不越界）。
     *
     * 关键设计：
     *   - **和弦边界硬约束** — 即使 ratio > 1，也绝不越过 chord_i.endBeat。
     *     钢琴家在和弦切换时必须松踏板防糊，这是音乐物理而非乐手个性。
     *   - **rest 透明** — 句中 rest 不打断延音（钢琴真实物理：阻尼器下落需时间，
     *     16th rest 间的音会自然续响）。如需保留 rest 作呼吸感，可降低 ratio。
     *   - **零 PRNG** — D-5 序列对齐不变，仅 NoteData.duration 字段值变化。
     *   - **C 可移植** — 双重 for 线性扫描，无 Map/Set，无递归。
     */
    private static applyIntelligentPedal(
        slots: PitchSlot[],
        chords: GeneratedChord[],
        legatoRatio: number,
    ): void {
        if (legatoRatio < EPSILON) return;  // 0 = 关闭踏板，保留 grammar duration 原样

        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (slot.pitch < 0) continue;
            if (slot.kind === 'rest') continue;

            const chord = ToplineEngine.findChordAt(chords, slot.onset);
            if (chord === null) continue;

            // 向后找下一个发声音的 onset（rest / 未决 approach 透明跳过）
            let nextOnset = Number.POSITIVE_INFINITY;
            for (let j = i + 1; j < slots.length; j++) {
                if (slots[j].pitch >= 0) {
                    nextOnset = slots[j].onset;
                    break;
                }
            }

            // ceiling = min(next note onset, chord boundary)
            const chordEnd = chord.endBeat;
            const ceiling = nextOnset < chordEnd ? nextOnset : chordEnd;
            const pedaledDur = ceiling - slot.onset;
            if (pedaledDur < EPSILON) continue;  // 退化切片：本音落在和弦尾，保 grammar

            const grammarDur = slot.duration;
            const delta = pedaledDur - grammarDur;
            let finalDur = grammarDur + delta * legatoRatio;

            // 硬钳：never 越过和弦边界、never 短于 grammar
            const maxDur = chordEnd - slot.onset;
            if (finalDur > maxDur) finalDur = maxDur;
            if (finalDur < grammarDur) finalDur = grammarDur;

            slot.duration = finalDur;
        }
    }

    /** 查 slots[startIdx+1..] 中第一个已解决（pitch >= 0）的槽位 pitch */
    private static findNextResolvedPitch(slots: PitchSlot[], startIdx: number): number {
        for (let i = startIdx + 1; i < slots.length; i++) {
            if (slots[i].pitch >= 0) return slots[i].pitch;
        }
        return -1;
    }

    /**
     * target 上方最近的调内 PC 对应的 pitch。
     * 跨度 1..12 半音线性扫描，找到第一个 PC 命中 scaleMask 的 pitch + delta。
     * 若全失（理论不可能 — 调式至少 5 个 PC）则回落 target + 1。
     */
    private static nearestScalePitchAbove(target: number, scalePcMask: number): number {
        for (let delta = 1; delta <= PITCH_CLASS_SIZE; delta++) {
            const candidate = target + delta;
            const pc = ((candidate % PITCH_CLASS_SIZE) + PITCH_CLASS_SIZE) % PITCH_CLASS_SIZE;
            if ((scalePcMask & (1 << pc)) !== 0) return candidate;
        }
        return target + 1;
    }

    /**
     * 段落和弦表中查 beat 落点对应的和弦。
     * chord.startBeat <= beat < chord.endBeat（闭右开），epsilon 容差。
     * 段落起拍未覆盖任何和弦 → null（caller 静音处理）。
     */
    private static findChordAt(chords: GeneratedChord[], beat: number): GeneratedChord | null {
        for (let i = 0; i < chords.length; i++) {
            const c = chords[i];
            if (beat >= c.startBeat - EPSILON && beat < c.endBeat - EPSILON) {
                return c;
            }
        }
        // 边界兜底：若 beat 恰好等于最后一个和弦的 endBeat，返回最后一个和弦
        if (chords.length > 0) {
            const last = chords[chords.length - 1];
            if (Math.abs(beat - last.endBeat) < EPSILON) return last;
        }
        return null;
    }

    /** S-7：非法输入早期失败 */
    private static validate(input: ToplineInput): void {
        if (!Array.isArray(input.terminals)) {
            throw new ToplineEngineError('terminals must be an array', {
                actual: typeof input.terminals,
            });
        }
        if (!Array.isArray(input.chords)) {
            throw new ToplineEngineError('chords must be an array', {
                actual: typeof input.chords,
            });
        }
        if (input.pitchRange !== undefined) {
            if (input.pitchRange[0] >= input.pitchRange[1]) {
                throw new ToplineEngineError('pitchRange[0] must be < pitchRange[1]', {
                    lo: input.pitchRange[0], hi: input.pitchRange[1],
                });
            }
        }
        if (input.velocityRange[0] > input.velocityRange[1]) {
            throw new ToplineEngineError('velocityRange[0] must be <= velocityRange[1]', {
                lo: input.velocityRange[0], hi: input.velocityRange[1],
            });
        }
        if (input.leapProbability !== undefined) {
            if (input.leapProbability < 0 || input.leapProbability > 1) {
                throw new ToplineEngineError('leapProbability must be in [0, 1]', {
                    actual: input.leapProbability,
                });
            }
        }
    }
}
