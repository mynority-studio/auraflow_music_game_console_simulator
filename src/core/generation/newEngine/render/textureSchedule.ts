// ============================================================
// newEngine · render · TextureSchedule(多声部节奏的【中央下发指令】)
// ------------------------------------------------------------
// 用户架构定向(2026-06-05):纹理 = bass+comp+drum 的【共享节奏指令】,中央下发一次,
//   三个 renderer 都消费同一 textureCase → 同一时钟对拍/复调(忠实 mg:纹理即多声部合谱)。
// 此前选择逻辑埋在 accompanimentRenderer 内部(只 comp 用)→ 现上移成 schedule,bass/drum 也读。
// 需 harmony(dominant-chain 检测)→ 放 render 协调层(arranger 权威在 harmony 后实现)。
// ============================================================

import { phraseCellRole, densityForCell, energyForCell, pickTextureForBar, type TextureStyleName, type SectionLabel } from '../knowledge/textureProfiles';
import { hasTextureRenderer } from './textureRenderer';
import type { HarmonicFunction, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { SectionRole } from '../arranger/ArrangementPlan';

// style → texture style 名;非 rich(blues/default)→ undefined,各 renderer 回退老逻辑。
export const TEXTURE_STYLE: Record<string, TextureStyleName> = { pop: 'POP', lofi: 'LOFI', rnb: 'RNB', jazz: 'JAZZ' };
export const SECTION_LABEL: Record<SectionRole, SectionLabel> = {
  intro: 'INTRO', verse: 'VERSE', chorus: 'CHORUS', bridge: 'BRIDGE', outro: 'OUTRO',
};

/** spanId → 选中的 rich textureCase(仅 rich 风格的 active 段;其余 span 不在表内)。 */
export type TextureSchedule = Record<string, string>;

/**
 * 中央下发:spanId → rich textureCase。
 *   ★ 2026-06-08(texture-switch 修复):优先消费器配层的【段级】richTextureBySection
 *     —— 整段沿用同一 textureCase,不再逐 span 随机切(消"伴奏自己断掉")。
 *   无段级下发的段(LOFI / blues / default)→ 回退逐 span 选(老路,确定性不变)。
 */
export function buildTextureSchedule(args: {
  plan: HarmonicPlan;
  style: string;
  sectionRoleById: Record<string, SectionRole>;
  activeSectionIds: Set<string>;
  textureRng: { pick<T>(xs: readonly T[]): T };
  richTextureBySection?: Record<string, string>; // 器配层段级下发(非 LOFI);空 = 逐 span 回退
}): TextureSchedule {
  const { plan, style, sectionRoleById, activeSectionIds, textureRng, richTextureBySection } = args;
  const txStyle = TEXTURE_STYLE[style.toLowerCase()];
  const schedule: TextureSchedule = {};
  if (!txStyle) return schedule;
  const rich = richTextureBySection ?? {};

  const timeline = plan.chordTimeline;
  const funcBySpan: Record<string, HarmonicFunction> = {};
  timeline.forEach((s, i) => { funcBySpan[s.id] = plan.chordFunctionTimeline[i]; });
  const countInSec: Record<string, number> = {};
  timeline.forEach((s) => { countInSec[s.sectionId] = (countInSec[s.sectionId] ?? 0) + 1; });
  const idxInSec: Record<string, number> = {};
  const seenSec: Record<string, number> = {};
  timeline.forEach((s) => { idxInSec[s.id] = seenSec[s.sectionId] ?? 0; seenSec[s.sectionId] = (seenSec[s.sectionId] ?? 0) + 1; });

  let prevTex: string | undefined;
  let rep = 0;
  for (const span of timeline) {
    if (!activeSectionIds.has(span.sectionId)) continue;
    // ★ 器配层段级下发优先:整段沿用,projection + 渲染器存在性校验(render 只做投影/校验,不做决策)。
    const planned = rich[span.sectionId];
    if (planned) {
      if (hasTextureRenderer(planned)) schedule[span.id] = planned;
      continue;
    }
    // 回退:逐 span 选(LOFI / blues / 无段级下发)
    const role = sectionRoleById[span.sectionId] ?? 'verse';
    const cellRole = phraseCellRole(idxInSec[span.id], countInSec[span.sectionId]);
    const label = SECTION_LABEL[role] ?? 'VERSE';
    const prof = pickTextureForBar({
      style: txStyle, phraseRole: cellRole, density: densityForCell(cellRole, label), energy: energyForCell(cellRole, label),
      isDominantChain: funcBySpan[span.id] === 'D', prevTextureId: prevTex, repeatCount: rep, random: textureRng,
    });
    const tc = prof?.textureCase;
    if (tc && tc === prevTex) rep += 1; else { rep = 0; prevTex = tc; }
    if (tc && hasTextureRenderer(tc)) schedule[span.id] = tc;
  }
  return schedule;
}
