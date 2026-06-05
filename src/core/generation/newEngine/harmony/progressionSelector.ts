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
import { pickProgressionPrototypeWithPolicy, type HarmonyStyleName, type ProtoSectionRole, type ProgressionSlot, type ProgressionTransformPolicy } from '../knowledge/progressions';

/** prototype 选择结果:slots + 该 prototype 的 transformPolicy(prototype 段离调变体门控)。 */
export interface SelectedProgression {
  slots: ProgressionSlot[];
  transformPolicy?: ProgressionTransformPolicy;
}

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
  protoByGroup: Map<string, SelectedProgression>;
}): SelectedProgression | null {
  const { band, section, hrng, protoByGroup } = args;
  const group = section.repeatGroup;
  if (group && protoByGroup.has(group)) return protoByGroup.get(group)!;

  // ★ harmonyRole(CODEX V4.2)优先:lofi 段请求 'loop' prototype、outro→'ending' 等显式语义;
  //   缺省回退 legacy role 映射。harmonyRole 值集 ≡ ProtoSectionRole,直接可传。
  const picked = pickProgressionPrototypeWithPolicy({
    style: toHarmonyStyle(band.style),
    mode: band.mode === 'minor' ? 'Minor' : 'Major',
    functionRole: section.harmonyRole ?? ROLE_MAP[section.role as SectionRole] ?? 'verse',
    bars: section.bars,
    random: hrng,
  });
  if (group && picked) protoByGroup.set(group, picked);
  return picked;
}
