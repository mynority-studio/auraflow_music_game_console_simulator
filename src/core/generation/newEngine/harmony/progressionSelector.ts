// ============================================================
// newEngine · harmony · ProgressionSelector(和声迁移 Loop 2)
// ------------------------------------------------------------
// prototype-first 选择:把 BandSpec/Section 映射成 KB prototype 查询 → 返回 fit 后的 slots。
// 同 repeatGroup 复用同一 prototype(铁律9:verse1≡verse2)。无匹配 → null(调用方回退 degree-picker)。
// ★ 小决策对齐 melodygenerative:style 小写→大写,SectionRole outro→ending,mode→Major/Minor。
// ============================================================

import type { Rng } from '../foundation';
import type { BandSpec } from '../band/BandSpec';
import type { Section, SectionRole } from '../arranger/ArrangementPlan';
import { pickProgressionPrototype, type HarmonyStyleName, type ProtoSectionRole, type ProgressionSlot } from '../knowledge/progressions';

// band.style(小写)→ HarmonyStyleName。modal 旁路不进这里;未知/default → POP。
const STYLE_MAP: Record<string, HarmonyStyleName> = { pop: 'POP', jazz: 'JAZZ', lofi: 'LOFI', rnb: 'RNB', blues: 'BLUES' };
export function toHarmonyStyle(style: string): HarmonyStyleName {
  return STYLE_MAP[style.toLowerCase()] ?? 'POP';
}

// SectionRole → ProtoSectionRole(generative:outro→ending)。
const ROLE_MAP: Record<SectionRole, ProtoSectionRole> = {
  intro: 'intro', verse: 'verse', chorus: 'chorus', bridge: 'bridge', outro: 'ending',
};

/**
 * 为一段选 prototype slots。同 repeatGroup 复用(先查 protoByGroup,缺则抽并登记)。
 * 返回 fit 到 section.bars 的 slots;无匹配 prototype → null。
 */
export function selectProgressionSlots(args: {
  band: BandSpec;
  section: Section;
  hrng: Rng;
  protoByGroup: Map<string, ProgressionSlot[]>;
}): ProgressionSlot[] | null {
  const { band, section, hrng, protoByGroup } = args;
  const group = section.repeatGroup;
  if (group && protoByGroup.has(group)) return protoByGroup.get(group)!;

  const slots = pickProgressionPrototype({
    style: toHarmonyStyle(band.style),
    mode: band.mode === 'minor' ? 'Minor' : 'Major',
    functionRole: ROLE_MAP[section.role as SectionRole] ?? 'verse',
    bars: section.bars,
    random: hrng,
  });
  if (group && slots) protoByGroup.set(group, slots);
  return slots;
}
