// ============================================================
// StyleFlags — 数值 StyleId 枚举（参考架构移植后：3 风格）
// ============================================================
// 用户决策：保持数值枚举（rule T-1 — 风格分类禁止字符串子串匹配）
// 参考代码用 string id（'Pop'/'Chill Jazz'/'Neo-Soul'）做查表 key，
// 我们改用数值枚举 + 显示名旁路表。
// ============================================================

/**
 * C++ Porting Guide:
 *   enum class StyleId : uint8_t {
 *     ModernPop = 0, ChillJazz = 1, NeoSoul = 2,
 *   };
 *
 * 数值锁定 — pool[Math.floor(PRNG.next() * pool.length)] 抽取索引依赖。
 * 改顺序 → **golden seed 全部 rebaseline**(默认 styleId=0 行为变化)。
 *
 * 改顺序需同步:
 *   - CurveWeatherSampler STYLE_*_BASE 5 个表(K/T/S/R/G base 各按 StyleId 索引)
 *   - CastingEngine STYLE_ANCHOR_RECIPE 表
 *   - MoodRouter MOOD_RECIPE / MOOD_WALK_PATTERN 二维表的列索引
 *   - config/StyleRegistry / styles/index.ts getStyleHarmonyBundle / getStyleStage5Bundle
 *   - data/GMSoundMap 相关 channel 路由
 * Cross-sync §1.6 + §1.18(MoodRouter 二维表)。
 */
export enum StyleId {
    ModernPop = 0,
    ChillJazz = 1,
    NeoSoul = 2,
}

export const StyleIdName: Record<StyleId, string> = {
    [StyleId.ModernPop]: 'Modern Pop',
    [StyleId.ChillJazz]: 'Chill Jazz',
    [StyleId.NeoSoul]: 'Neo-Soul',
};
