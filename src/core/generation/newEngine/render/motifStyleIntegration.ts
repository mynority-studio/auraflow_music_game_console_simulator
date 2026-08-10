// ============================================================
// newEngine · render · motif 按风格融入合同(四期听感调优)
// ------------------------------------------------------------
// 用户实听结论(2026-08-10):POP 融入最自然,其余风格"为了播放而播放"。
// 根因:各风格 lead 架构不同 —— POP=短乐句反复(与动机写作同构);
// LOFI=score-owned 乐句计划;ACG=通篇作曲钢琴;JAZZ=bebop 松散语言;
// RNB=melisma 长音词汇。统一注入策略必然在非 POP 风格里显得外来。
// 本表让每个风格声明自己的动机融入方式;数值全部可听感调参。
// ============================================================

export interface MotifStyleIntegration {
  /** 每段落强制动机在场(POP 模型);false = 回退按歌长配额(松散关联)。 */
  perSectionPresence: boolean;
  /** 非每段模式下的 occurrence 上限。 */
  maxExtra: number;
  /** 片段类变奏(head/tail/omit/delay)的选址加分:风格越忌讳全句引用越高。 */
  fragmentBias: number;
  /** 衍生语法规则权重(legacy 加权采样直接生效;family-only 影响 cap 内竞争)。 */
  ruleWeightFull: number;
  ruleWeightFragment: number;
}

const TABLE: Record<string, MotifStyleIntegration> = {
  POP: { perSectionPresence: true, maxExtra: 3, fragmentBias: 0, ruleWeightFull: 40, ruleWeightFragment: 24 },
  RNB: { perSectionPresence: true, maxExtra: 3, fragmentBias: 8, ruleWeightFull: 28, ruleWeightFragment: 26 },
  JAZZ: { perSectionPresence: false, maxExtra: 2, fragmentBias: 10, ruleWeightFull: 18, ruleWeightFragment: 16 },
  LOFI: { perSectionPresence: false, maxExtra: 1, fragmentBias: 6, ruleWeightFull: 30, ruleWeightFragment: 20 },
  ACG: { perSectionPresence: false, maxExtra: 1, fragmentBias: 4, ruleWeightFull: 16, ruleWeightFragment: 12 },
};

/** 风格 → 融入合同;未知/缺省风格用 POP 模型(与既有测试行为一致)。 */
export function motifStyleIntegration(style?: string): MotifStyleIntegration {
  return TABLE[(style ?? 'POP').toUpperCase()] ?? TABLE.POP;
}
