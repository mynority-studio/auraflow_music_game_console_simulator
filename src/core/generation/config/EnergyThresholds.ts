/**
 * EnergyThresholds — 段落能量等级（1-10）的语义化阈值常量
 *
 * 收归原本散布在 TextureMapper / Orchestrator / ToplineEngine / RhythmCells 中
 * 的 `energy >= 7`、`energy <= 4` 等魔法数字，提供单一来源。
 *
 * 设计目标：
 *   - 单一来源（single source of truth），未来调音只改一处
 *   - 自文档化命名，阅读代码不需要心算"7 是高还是中"
 *   - 为未来风格覆盖（StyleConfig.global.energyThresholds）预留空间
 *
 * 使用约定：
 *   - 比较操作符保留原代码意图（>= / <= / > / <）以保持行为一致
 *   - 不要在新代码中再写 `energy >= 7` 这样的字面量，直接 import 这里的常量
 */
export const ENERGY = {
    /** 极低 (<=2) — 完全 Pad，无鼓无贝斯，仅铺底 */
    SILENT_MAX: 2,

    /** 低 (<=3) — 极简伴奏，Pad 可以作为 counterMelody 兜底 */
    AMBIENT_MAX: 3,

    /** 中低 (<=4) — 主歌主体，arpeggio/pad 织体，能量未起来 */
    LOW_MAX: 4,

    /** 中 (>=5) — 织体加密，drum crash、chord re-attack 介入 */
    MEDIUM_MIN: 5,

    /** 中高 (>=6) — chord 弱拍 re-attack、build-up 起势 */
    BUILD_MIN: 6,

    /** 高 (>=7) — 副歌主体阈值，arpeggio、syncopation、ghost notes、breathing 全开 */
    HIGH_MIN: 7,

    /** 极高 (>=8) — 副歌爆发，hard stop / outro StopEnding 触发线 */
    PEAK_MIN: 8,
} as const;
