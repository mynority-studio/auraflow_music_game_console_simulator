// ============================================================
// newEngine · arranger · EdgePlanner(2026-06-08)
// ------------------------------------------------------------
// 修「intro→verse 衔接 / outro 收尾」:Arranger(最高权威)下发【段落边界行为】,
//   器配/render 才知道乐器怎么进、怎么出。两件事:
//   ① entryBySection — 每段乐器【进入方式】:能量跃升(intro→verse / verse→chorus / build→hook)
//      = lead-in(上一段末小节铺垫推进到本段下拍,release 感);平/降(重复段、loop→loop、收尾)= downbeat 直入。
//   ② endingStyle — 全曲【收尾方式】(联网研究 4 类收尾,按用户选 = 风格定制、不改 tempo):
//      pop=cold(button 干净停)· rnb/lofi=fade(逐件抽离+渐弱)· jazz=tag(末和弦延留+节奏件先退=渐慢感)。
//   纯派生(energy + style),无 rng → 确定性、不扰其它子流。
// ============================================================

import type { EndingStyle, Section, SectionEntry, SectionId } from './ArrangementPlan';

// 能量跃升阈值:setup→story(+0.20)/ story→hook(+0.28)/ build→hook(+0.14)/ setup→loop(+0.16)皆触发;
//   重复段(verse2≈verse1)、loop→loop(0)、head→head(ramp 0.04)、收尾段(降)不触发。
const ENTRY_LIFT_THRESHOLD = 0.10;

// 收尾风格定制(确定性 per-style;default/modal/blues → cold 果断安全)。
const ENDING_BY_STYLE: Record<string, EndingStyle> = { pop: 'cold', rnb: 'fade', lofi: 'fade', jazz: 'tag', default: 'cold' };

export interface EdgePlan {
  entryBySection: Record<SectionId, SectionEntry>;
  endingStyle: EndingStyle;
}

export function planEdges(
  sections: readonly Section[],
  energyBySection: Record<SectionId, number>,
  style: string,
): EdgePlan {
  const endingStyle = ENDING_BY_STYLE[style.toLowerCase()] ?? ENDING_BY_STYLE.default;
  const entryBySection: Record<SectionId, SectionEntry> = {};
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (i === 0) { entryBySection[s.id] = 'downbeat'; continue; }
    const lift = (energyBySection[s.id] ?? 0.5) - (energyBySection[sections[i - 1].id] ?? 0.5);
    entryBySection[s.id] = lift >= ENTRY_LIFT_THRESHOLD ? 'lead-in' : 'downbeat';
  }
  return { entryBySection, endingStyle };
}
