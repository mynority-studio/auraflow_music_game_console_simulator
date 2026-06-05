// ============================================================
// newEngine · harmony · DynamicHarmonyDecorator(和声迁移 Loop 3)
// ------------------------------------------------------------
// 忠实 port 自 melodygenerative dynamicHarmony.ts 的算法部分:
//   analyzeResolutionTarget(= analyzeTargetQuality):看下一和弦功能/品质 → 解析目标分类。
//   decorateChordType:lockType=true 不改;否则按 style/function/next-target + colorLevel 选 chord type。
// ★ 当前 prototype 槽全 lockType=true → 装饰对它们 no-op(只作用于 unlocked / fallback)。
//   tritone Sub-V 替代(tritoneProb)= 后续接(需改 rootOffset),Loop 3 只做 chord-type 装饰。
// ============================================================

import type { Rng } from '../foundation';
import { getDynamicTsdRules, type ResolutionTarget, type TSD_Func } from '../knowledge/dynamicTsdDictionary';

/** 分类下一和弦解析目标(港 analyzeTargetQuality,逐条忠实)。 */
export function analyzeResolutionTarget(currFunc: TSD_Func, nextFunc: TSD_Func, nextRoman: string, nextType: string): ResolutionTarget {
  if (!nextRoman) return 'Default';
  // 属未解决到主 → deceptive
  if (currFunc === 'D' && nextFunc !== 'T') return 'Deceptive';
  const nextBaseRoman = nextRoman.split('/')[0].replace(/[^a-zA-Z]/g, '');
  const typeIsMinor =
    nextType === 'min' || nextType === 'dim' || nextType === 'dim7' || nextType === 'm7b5'
    || (nextType.startsWith('m') && !nextType.startsWith('maj'));
  const romanIsMinor = nextBaseRoman.length > 0 && nextBaseRoman === nextBaseRoman.toLowerCase();
  return (typeIsMinor || romanIsMinor) ? 'MinorTarget' : 'MajorTarget';
}

/** colorBudget(0..1)→ colorLevel(0/1/2)。 */
function colorLevelFor(colorBudget: number): number {
  return colorBudget > 0.65 ? 2 : colorBudget > 0.35 ? 1 : 0;
}

/**
 * 装饰 chord type:lockType=true → 原样返回(作者已定);否则按动态字典选。
 * 无匹配规则 / 空字典 → 回退原 type。
 */
export function decorateChordType(args: {
  style: string;
  slotFunc: TSD_Func;
  slotType: string;
  slotLockType: boolean;
  nextFunc: TSD_Func;
  nextRoman: string;
  nextType: string;
  colorBudget: number;
  random: Rng;
}): string {
  if (args.slotLockType) return args.slotType; // 锁定槽不改(prototype 作者类型优先)
  const rules = getDynamicTsdRules(args.style, args.slotFunc);
  if (rules.length === 0) return args.slotType;
  const target = analyzeResolutionTarget(args.slotFunc, args.nextFunc, args.nextRoman, args.nextType);
  const rule = rules.find((r) => r.target === target) ?? rules.find((r) => r.target === 'Default') ?? rules[0];
  const level = colorLevelFor(args.colorBudget);
  const choices = rule.levels[level] ?? rule.levels[0] ?? [args.slotType];
  if (choices.length === 0) return args.slotType;
  return args.random.pick(choices);
}
