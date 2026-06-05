// ============================================================
// newEngine · knowledge · DynamicTsdDictionary(和声迁移 Loop 3,纯数据)
// ------------------------------------------------------------
// 忠实 port 自 melodygenerative/src/lib/dynamicHarmony.ts:DYNAMIC_TSD_DICTIONARY。
// 动态 TSD 色彩字典:per-style × per-function(T/S/D)规则,按【下一和弦解析目标】
//   (MajorTarget/MinorTarget/Deceptive/Default)+ colorLevel(0/1/2)选 chord type。
//   tritoneProb = D 功能下五度下行时触发 Sub-V tritone 替代的概率(数据携带;应用见后续)。
// 算法(analyzeResolutionTarget / decorateChordType)在 harmony/dynamicHarmonyDecorator.ts。
// ============================================================

export type ResolutionTarget = 'MajorTarget' | 'MinorTarget' | 'Deceptive' | 'Default';
export type TSD_Func = 'T' | 'S' | 'D';

export interface DynamicRule {
  target: ResolutionTarget;
  levels: Record<number, string[]>; // colorLevel 0/1/2 → 候选 chord type 名
  tritoneProb?: number;             // 仅 D 规则;Sub-V tritone 替代触发概率
}

export const DYNAMIC_TSD_DICTIONARY: Record<string, Record<TSD_Func, DynamicRule[]>> = {
  POP: {
    D: [
      { target: 'MajorTarget', levels: { 0: ['7', 'sus4'], 1: ['7sus4', '7'], 2: ['7sus4'] } },
      { target: 'MinorTarget', levels: { 0: ['7', 'sus4'], 1: ['7sus4', '7'], 2: ['7sus4'] } },
      { target: 'Deceptive', levels: { 0: ['sus4'], 1: ['7sus4', 'sus4'], 2: ['7sus4'] } },
      { target: 'Default', levels: { 0: ['maj', 'sus4'], 1: ['7sus4', '7'], 2: ['7sus4'] } },
    ],
    S: [
      { target: 'MajorTarget', levels: { 0: ['maj'], 1: ['add9'], 2: ['add9', 'sus2'] } },
      { target: 'MinorTarget', levels: { 0: ['min'], 1: ['madd9'], 2: ['madd9'] } },
      { target: 'Deceptive', levels: { 0: ['maj'], 1: ['add9'], 2: ['6'] } },
      { target: 'Default', levels: { 0: ['maj'], 1: ['add9'], 2: ['add9', 'sus2'] } },
    ],
    T: [{ target: 'Default', levels: { 0: ['maj'], 1: ['add9'], 2: ['6', 'add9'] } }],
  },

  LOFI: {
    D: [
      { target: 'MajorTarget', levels: { 0: ['9sus4', '7sus4'], 1: ['9sus4', '13sus4'], 2: ['13sus4'] } },
      { target: 'MinorTarget', levels: { 0: ['9sus4'], 1: ['13sus4'], 2: ['13sus4', '7sus4'] } },
      { target: 'Deceptive', levels: { 0: ['m9'], 1: ['m11', '9sus4'], 2: ['m11'] } },
      { target: 'Default', levels: { 0: ['9sus4'], 1: ['13sus4', 'm9'], 2: ['m11', '13sus4'] } },
    ],
    S: [
      { target: 'MajorTarget', levels: { 0: ['maj7'], 1: ['maj9'], 2: ['maj9', '6/9'] } },
      { target: 'MinorTarget', levels: { 0: ['m7'], 1: ['m9'], 2: ['m11'] } },
      { target: 'Deceptive', levels: { 0: ['m7'], 1: ['m9', 'm11'], 2: ['m11'] } },
      { target: 'Default', levels: { 0: ['maj7'], 1: ['maj9', 'm9'], 2: ['m11', '6/9'] } },
    ],
    T: [{ target: 'Default', levels: { 0: ['maj7'], 1: ['maj9', '6/9'], 2: ['maj9', 'm9'] } }],
  },

  RNB: {
    D: [
      { target: 'MajorTarget', levels: { 0: ['9sus4'], 1: ['13', '9sus4'], 2: ['13', '11'] }, tritoneProb: 0.15 },
      { target: 'MinorTarget', levels: { 0: ['7#9'], 1: ['7b13'], 2: ['7alt'] }, tritoneProb: 0.20 },
      { target: 'Deceptive', levels: { 0: ['7#9'], 1: ['13b9'], 2: ['7alt'] } },
      { target: 'Default', levels: { 0: ['9'], 1: ['13'], 2: ['7b13'] } },
    ],
    S: [
      { target: 'MajorTarget', levels: { 0: ['maj9'], 1: ['maj13'], 2: ['maj9#11'] } },
      { target: 'MinorTarget', levels: { 0: ['m9'], 1: ['m11'], 2: ['m9b5'] } },
      { target: 'Deceptive', levels: { 0: ['maj9'], 1: ['maj13'], 2: ['m11'] } },
      { target: 'Default', levels: { 0: ['maj9'], 1: ['m9'], 2: ['maj13'] } },
    ],
    T: [{ target: 'Default', levels: { 0: ['maj7'], 1: ['maj9'], 2: ['maj13', '6/9'] } }],
  },

  JAZZ: {
    D: [
      { target: 'MajorTarget', levels: { 0: ['7', '9'], 1: ['9', '13'], 2: ['13', '7#11'] }, tritoneProb: 0.35 },
      { target: 'MinorTarget', levels: { 0: ['7b9'], 1: ['7b13', '7#9'], 2: ['7alt', '13b9'] }, tritoneProb: 0.30 },
      { target: 'Deceptive', levels: { 0: ['7b9'], 1: ['7#9'], 2: ['7alt'] }, tritoneProb: 0.15 },
      { target: 'Default', levels: { 0: ['7'], 1: ['9', '13'], 2: ['7alt', '13'] } },
    ],
    S: [
      { target: 'MajorTarget', levels: { 0: ['maj7'], 1: ['maj9', '6/9'], 2: ['maj13'] } },
      { target: 'MinorTarget', levels: { 0: ['m7b5'], 1: ['m9b5'], 2: ['m11'] } },
      { target: 'Deceptive', levels: { 0: ['m7', 'm9'], 1: ['m11'], 2: ['maj9#11'] } },
      { target: 'Default', levels: { 0: ['maj7'], 1: ['m9'], 2: ['m7b5'] } },
    ],
    T: [{ target: 'Default', levels: { 0: ['maj7'], 1: ['maj9'], 2: ['6/9'] } }],
  },

  BLUES: {
    D: [
      { target: 'MajorTarget', levels: { 0: ['7'], 1: ['9'], 2: ['13'] } },
      { target: 'MinorTarget', levels: { 0: ['7#9'], 1: ['7b13'], 2: ['7#9'] } },
      { target: 'Deceptive', levels: { 0: ['7#9'], 1: ['7#9'], 2: ['7alt'] } },
      { target: 'Default', levels: { 0: ['7'], 1: ['9'], 2: ['13'] } },
    ],
    S: [{ target: 'Default', levels: { 0: ['7'], 1: ['9'], 2: ['9'] } }],
    T: [{ target: 'Default', levels: { 0: ['7'], 1: ['9'], 2: ['13'] } }],
  },
};

/** 查某 style 某功能的动态规则列表(缺 → 空,调用方回退原 type)。 */
export function getDynamicTsdRules(style: string, func: TSD_Func): DynamicRule[] {
  return DYNAMIC_TSD_DICTIONARY[style]?.[func] ?? [];
}
