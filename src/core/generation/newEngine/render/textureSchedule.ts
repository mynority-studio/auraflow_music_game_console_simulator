// ============================================================
// newEngine · render · TextureSchedule(多声部节奏的【中央下发指令】)
// ------------------------------------------------------------
// 用户架构定向(2026-06-05):纹理 = bass+comp+drum 的【共享节奏指令】,中央下发一次,
//   三个 renderer 都消费同一 textureCase → 同一时钟对拍/复调(忠实 mg:纹理即多声部合谱)。
// 此前选择逻辑埋在 accompanimentRenderer 内部(只 comp 用)→ 现上移成 schedule,bass/drum 也读。
// 需 harmony(dominant-chain 检测)→ 放 render 协调层(arranger 权威在 harmony 后实现)。
// ============================================================

import { phraseCellRole, densityForCell, energyForCell, pickTextureForBar, pickAcgTextureForBar, type TextureStyleName, type SectionLabel, type GrooveTextureContract } from '../knowledge/textureProfiles';
import { hasTextureRenderer } from './textureRenderer';
import type { HarmonicFunction, HarmonicPlan } from '../harmony/HarmonicPlan';
import type { SectionRole } from '../arranger/ArrangementPlan';

// style → texture style 名;非 rich(blues/default)→ undefined,各 renderer 回退老逻辑。
export const TEXTURE_STYLE: Record<string, TextureStyleName> = { pop: 'POP', lofi: 'LOFI', rnb: 'RNB', jazz: 'JAZZ', acg: 'ACG' };
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
  textureRng: { next(): number; pick<T>(xs: readonly T[]): T };
  richTextureBySection?: Record<string, string>; // 器配层段级下发(非 LOFI);空 = 逐 span 回退
  richTextureSwitchBySection?: Record<string, { atFraction: number; toTexture: string }>; // 段内受控变化(verse 中段)
  grooveContract?: GrooveTextureContract; // ★ §4:ACG 逐-bar 织体选择消费 GrooveContract(preferred/allowed/forbidden)
}): TextureSchedule {
  const { plan, style, sectionRoleById, activeSectionIds, textureRng, richTextureBySection, richTextureSwitchBySection, grooveContract } = args;
  const txStyle = TEXTURE_STYLE[style.toLowerCase()];
  const schedule: TextureSchedule = {};
  if (!txStyle) return schedule;
  const rich = richTextureBySection ?? {};
  const richSwitch = richTextureSwitchBySection ?? {};

  const timeline = plan.chordTimeline;
  const funcBySpan: Record<string, HarmonicFunction> = {};
  timeline.forEach((s, i) => { funcBySpan[s.id] = plan.chordFunctionTimeline[i]; });
  const countInSec: Record<string, number> = {};
  timeline.forEach((s) => { countInSec[s.sectionId] = (countInSec[s.sectionId] ?? 0) + 1; });
  const idxInSec: Record<string, number> = {};
  const seenSec: Record<string, number> = {};
  timeline.forEach((s) => { idxInSec[s.id] = seenSec[s.sectionId] ?? 0; seenSec[s.sectionId] = (seenSec[s.sectionId] ?? 0) + 1; });

  // ★ ACG(§4):逐-bar 具名手势(忠实 MG pickAcgTextureForBar),不走段级 richTextureBySection。
  //   MG ACG texturePerBar 每 bar 换手势(每首 6-7 种);SIM 此前段级只 2 → 听感差。POP/JAZZ/RNB MG 本就单织体 → 保段级。
  //   ⚠️ LOFI 暂【不】逐-bar:LOFI 织体本就稀疏(OneShot/sparse),逐-bar 切会破 comp 连续性(>2.5 拍突发洞,
  //     即段级架构当初专门修的 comp-continuity-gap)→ 需先港 MG 的 bridge/carryTail 连续性处理才能逐-bar(次级待办)。
  //   barIndex = span 在全 timeline 的位置;func/nextFunc 从 chordFunctionTimeline;prevId/rep 跨 span 追踪。
  const fBar = (f: HarmonicFunction | undefined): 'T' | 'S' | 'D' => (f === 'D' ? 'D' : f === 'S' ? 'S' : 'T');
  if (txStyle === 'ACG') {
    let acgPrevId: string | undefined; let acgRep = 0;
    timeline.forEach((span, i) => {
      if (!activeSectionIds.has(span.sectionId)) return;
      const label = SECTION_LABEL[sectionRoleById[span.sectionId] ?? 'verse'] ?? 'VERSE';
      const prof = pickAcgTextureForBar({
        barIndex: i, totalBars: timeline.length, sectionLabel: label,
        func: fBar(funcBySpan[span.id]),
        nextFunc: i + 1 < timeline.length ? fBar(funcBySpan[timeline[i + 1].id]) : null,
        prevTextureId: acgPrevId, repeatCount: acgRep, contract: grooveContract, random: textureRng,
      });
      if (prof.id === acgPrevId) acgRep += 1; else { acgPrevId = prof.id; acgRep = 1; }
      if (hasTextureRenderer(prof.textureCase)) schedule[span.id] = prof.textureCase;
    });
    return schedule;
  }

  let prevTex: string | undefined;
  let rep = 0;
  for (const span of timeline) {
    if (!activeSectionIds.has(span.sectionId)) continue;
    // ★ 器配层段级下发优先:整段沿用,projection + 渲染器存在性校验(render 只做投影/校验,不做决策)。
    //   含段内受控变化:idxInSec/count ≥ atFraction → 切到 variant(verse 中段,兼容连续,不留洞)。
    const planned = rich[span.sectionId];
    if (planned) {
      const sw = richSwitch[span.sectionId];
      const cnt = countInSec[span.sectionId] || 1;
      const tc = (sw && idxInSec[span.id] / cnt >= sw.atFraction) ? sw.toTexture : planned;
      if (hasTextureRenderer(tc)) schedule[span.id] = tc;
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
