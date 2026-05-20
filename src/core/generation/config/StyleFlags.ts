// ============================================================
// StyleFlags — 数值 StyleId 枚举(C.1 — 对齐 melodygenerative 命名)
// ============================================================
//
// 用户决策(plan §2):保持数值枚举(rule T-1 — 风格分类禁止字符串子串匹配)。
// C.1 改名:原 ModernPop / ChillJazz / NeoSoul 内部命名,现对齐 mg macro 命名
// POP / JAZZ / RNB / BLUES(mg styleDictionary 公共 macro 名)。
//
// **enum 数值 0/1/2 不变**(POP=0 / JAZZ=1 / RNB=2)→ 保 golden seed bit-exact。
// 新增 BLUES = 3(stub,默认 pool 不抽,需 forcedStyleId 才用)。
// ============================================================

/**
 * C++ Porting Guide:
 *   enum class StyleId : uint8_t {
 *     POP = 0, JAZZ = 1, RNB = 2, BLUES = 3,
 *   };
 *
 * 数值锁定 — pool[Math.floor(PRNG.next() * pool.length)] 抽取索引依赖。
 * 改顺序 → **golden seed 全部 rebaseline**。
 *
 * C.1 改名(ModernPop/ChillJazz/NeoSoul → POP/JAZZ/RNB)+ 加 BLUES = 3:
 *   - enum 数值 0/1/2 保持不变 → golden seed bit-exact
 *   - BLUES = 3 默认 pool 不抽,需 forcedStyleId 才用(StyleRegistry 有 stub config 临时复用 JAZZ)
 *
 * 改顺序需同步(无变化时同步表):
 *   - CurveWeatherSampler STYLE_*_BASE 5 个表(K/T/S/R/G base 各按 StyleId 索引)
 *   - CastingEngine STYLE_ANCHOR_RECIPE 表
 *   - MoodRouter MOOD_RECIPE / MOOD_WALK_PATTERN 二维表的列索引
 *   - config/StyleRegistry / styles/index.ts getStyleHarmonyBundle / getStyleStage5Bundle
 *   - data/GMSoundMap 相关 channel 路由
 *   - HarmonyEngine STYLE_MAPPING
 * Cross-sync §1.6 + §1.18(MoodRouter 二维表)。
 */
export enum StyleId {
    POP = 0,
    JAZZ = 1,
    RNB = 2,
    BLUES = 3,
}

export const StyleIdName: Record<StyleId, string> = {
    [StyleId.POP]:   'POP',
    [StyleId.JAZZ]:  'JAZZ',
    [StyleId.RNB]:   'RNB',
    [StyleId.BLUES]: 'BLUES',
};
