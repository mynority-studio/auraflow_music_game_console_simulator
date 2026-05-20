// ============================================================
// NCTApproachPatterns — 和弦外音趋近公式库(Phase 5 数据基础)
// ============================================================
//
// 出处:Miles Davis "music has no wrong notes, only wrong resolutions"。
// 高级和弦外音(Non-Chord Tones,NCTs)的关键不在于音高,而在于**目标解析**。
// 本模块存放经典爵士/Bebop 趋近模式的**向量定义**,供消费方按 hash + R 维度
// 概率抽取。
//
// 设计哲学:**逆向锚定** — 算法先确定目标音(锚),再用本库的向量倒推前置音符。
// 这样无论中间多离调,最后总能"完美着陆"。
//
// 4 个模式(Phase 5 初始集,Phase 6 Solo 引擎可扩展):
//
//   ChromaticBelow(半音下趋近):
//     [-1] → target
//     最经典 Blues 味道:目标音前一个半音(如 target=E,前音=Eb)。
//     适合 jazz comping / blues solo 大量使用。
//
//   DiatonicAbove(全音上趋近):
//     [+1 diatonic] → target
//     平稳的经过音,柔和色彩过渡。注意是音阶内邻音,需调用方提供 chord scale。
//
//   Enclosure(双向包围):
//     [+1 diatonic, -1 chromatic] → target
//     极具 Bebop 爵士味的高级技巧 — 上方大二度 → 下方小二度 → 目标。
//
//   DoubleChromatic(双半音趋近):
//     [-2 chromatic, -1 chromatic] → target
//     连续半音阶滑行,极强紧张感。Charlie Parker / Bud Powell 常用。
//
// 消费方:
//   Phase 5:BassIdiom A 规则 R 驱动选 ChromaticBelow vs DiatonicAbove(单音模式)
//   Phase 6:Solo 引擎 ImprovisationStrategy 全用(含 Enclosure / Double)
//
// 关联规则:
//   cross_sync_rule §1.13:NCT 数据表 ↔ Bass A 规则 ↔ Phase 6 Solo 引擎
//
// 零 PRNG。
// ============================================================

/** 趋近模式标识 — 数值枚举,C 移植直接做数组下标 */
export enum ApproachPatternId {
    ChromaticBelow  = 0,
    DiatonicAbove   = 1,
    Enclosure       = 2,
    DoubleChromatic = 3,
}

/**
 * 单个趋近模式定义。
 *
 * vector 含义(以目标音为 0,前置音的相对偏移):
 *   - 正数 = 上方音(diatonic / chromatic 取决于 useDiatonic 字段)
 *   - 负数 = 下方音(默认 chromatic)
 *
 * 例如 Enclosure [+1, -1]:第一个音是目标上方音阶音,第二个音是目标下方半音。
 */
export interface ApproachPattern {
    id: ApproachPatternId;
    name: string;
    /** 向量长度(单音模式 = 1,双音模式 = 2) */
    length: number;
    /** 相对目标的 offset 序列(从远到近),最后一项总是用作"target 之前最后一个音" */
    vector: ReadonlyArray<number>;
    /** 是否走 diatonic 路径(音阶内邻音);false = chromatic(半音) */
    useDiatonic: ReadonlyArray<boolean>;
    /** R 维度阈值 — 仅当 weather.r ≥ 此值才候选(防 Pop 风格 outside) */
    minRiskLevel: number;
}

export const NCT_APPROACH_PATTERNS: ReadonlyArray<ApproachPattern> = Object.freeze([
    Object.freeze({
        id: ApproachPatternId.ChromaticBelow,
        name: 'Chromatic Below',
        length: 1,
        vector: Object.freeze([-1]),
        useDiatonic: Object.freeze([false]),
        minRiskLevel: 0.0,   // 任何风格都允许(blues 味道无害)
    }),
    Object.freeze({
        id: ApproachPatternId.DiatonicAbove,
        name: 'Diatonic Above',
        length: 1,
        vector: Object.freeze([+1]),
        useDiatonic: Object.freeze([true]),
        minRiskLevel: 0.0,   // 任何风格都允许
    }),
    Object.freeze({
        id: ApproachPatternId.Enclosure,
        name: 'Enclosure',
        length: 2,
        vector: Object.freeze([+1, -1]),
        useDiatonic: Object.freeze([true, false]),
        minRiskLevel: 0.4,   // 仅 Jazz / NeoSoul 允许
    }),
    Object.freeze({
        id: ApproachPatternId.DoubleChromatic,
        name: 'Double Chromatic',
        length: 2,
        vector: Object.freeze([-2, -1]),
        useDiatonic: Object.freeze([false, false]),
        minRiskLevel: 0.5,   // Jazz / NeoSoul Bebop 风
    }),
]);

// ============================================================
// 选择函数 — deterministic hash + R 维度过滤
// ============================================================

/**
 * 按 R 维度 + hash 选趋近模式。
 *
 * 算法:
 *   1. 过滤 NCT_APPROACH_PATTERNS,只留 riskLevel ≥ pattern.minRiskLevel 的候选
 *   2. 按 hash 在候选中均匀抽取
 *
 * R 维度行为:
 *   - R = 0 (Pop):  只有 ChromaticBelow / DiatonicAbove 候选(2 选)
 *   - R = 0.4 (Jazz基线): + Enclosure(3 选)
 *   - R = 0.5+ (NeoSoul / Solo): + DoubleChromatic(4 选)
 *
 * 零 PRNG(hash 由调用方按 chord index / step 派生)。
 *
 * @param hash 调用方提供的 [0, 1) 浮点值(deterministic)
 * @param riskLevel weather.r 当前值
 * @returns 选中的 ApproachPattern
 */
export function pickApproachPattern(
    hash: number, riskLevel: number,
): ApproachPattern {
    const candidates: ApproachPattern[] = [];
    for (let i = 0; i < NCT_APPROACH_PATTERNS.length; i++) {
        if (riskLevel >= NCT_APPROACH_PATTERNS[i].minRiskLevel) {
            candidates.push(NCT_APPROACH_PATTERNS[i]);
        }
    }
    if (candidates.length === 0) return NCT_APPROACH_PATTERNS[ApproachPatternId.ChromaticBelow];
    const idx = Math.floor(hash * candidates.length);
    const safeIdx = idx < 0 ? 0 : (idx >= candidates.length ? candidates.length - 1 : idx);
    return candidates[safeIdx];
}
