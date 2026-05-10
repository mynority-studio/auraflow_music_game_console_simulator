// ============================================================
// StyleFlags — 数值 StyleId 枚举（参考架构移植后：3 风格）
// ============================================================
// 用户决策：保持数值枚举（rule T-1 — 风格分类禁止字符串子串匹配）
// 参考代码用 string id（'Pop'/'Chill Jazz'/'Neo-Soul'）做查表 key，
// 我们改用数值枚举 + 显示名旁路表。
// ============================================================

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
