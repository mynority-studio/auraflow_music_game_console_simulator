// ============================================================
// newEngine · render · TextureSchedule(多声部节奏的【中央下发指令】)
// ------------------------------------------------------------
// 用户架构定向(2026-06-05):纹理 = bass+comp+drum 的【共享节奏指令】,中央下发一次,
//   三个 renderer 都消费同一 textureCase → 同一时钟对拍/复调(忠实 mg:纹理即多声部合谱)。
// 此前选择逻辑埋在 accompanimentRenderer 内部(只 comp 用)→ 现上移成 schedule,bass/drum 也读。
// 需 harmony(dominant-chain 检测)→ 放 render 协调层(arranger 权威在 harmony 后实现)。
// ============================================================

import { phraseCellRole, densityForCell, energyForCell, pickTextureForBar, pickAcgTextureForBar, deriveAcgTextureCharacter, type TextureStyleName, type SectionLabel, type GrooveTextureContract } from '../knowledge/textureProfiles';
import { acgRenderProfile, resolveAcgBarFamily } from '../knowledge/acgRenderProfile';
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
/** ★ Phase 3A(intent 迁移):ACG 逐-bar family(drive/sparse)= character(和声动量)× acgRenderProfile section-energy。
 *  纯函数,从现 buildTextureSchedule ACG 分支【原样抽出】(byte-identical)。arranger 拥有此 family 逻辑;
 *  renderCoordinator 调它产 intent(enforce),buildTextureSchedule 读 intent 不再内联算 → 逐字节等价。 */
export function deriveAcgBarFamilies(
  plan: HarmonicPlan,
  activeSectionIds: Set<string>,
  sectionRoleById: Record<string, SectionRole>,
): Record<string, 'drive' | 'sparse'> {
  const timeline = plan.chordTimeline;
  const funcBySpan: Record<string, HarmonicFunction> = {};
  timeline.forEach((s, i) => { funcBySpan[s.id] = plan.chordFunctionTimeline[i]; });
  const fBar = (f: HarmonicFunction | undefined): 'T' | 'S' | 'D' => (f === 'D' ? 'D' : f === 'S' ? 'S' : 'T');
  const profile = acgRenderProfile();
  const acgFuncs = timeline.filter((s) => activeSectionIds.has(s.sectionId)).map((s) => fBar(funcBySpan[s.id]));
  const nAcgF = Math.max(1, acgFuncs.length);
  const dRatio = acgFuncs.filter((f) => f === 'D').length / nAcgF;
  const sRatio = acgFuncs.filter((f) => f === 'S').length / nAcgF;
  const acgCharacter = deriveAcgTextureCharacter(dRatio, sRatio, dRatio + sRatio);
  const out: Record<string, 'drive' | 'sparse'> = {};
  for (const span of timeline) {
    if (!activeSectionIds.has(span.sectionId)) continue;
    const label = SECTION_LABEL[sectionRoleById[span.sectionId] ?? 'verse'] ?? 'VERSE';
    out[span.id] = resolveAcgBarFamily(profile, label, acgCharacter);
  }
  return out;
}

export function buildTextureSchedule(args: {
  plan: HarmonicPlan;
  style: string;
  sectionRoleById: Record<string, SectionRole>;
  activeSectionIds: Set<string>;
  textureRng: { next(): number; pick<T>(xs: readonly T[]): T };
  richTextureBySection?: Record<string, string>; // 器配层段级下发(非 LOFI);空 = 逐 span 回退
  richTextureSwitchBySection?: Record<string, { atFraction: number; toTexture: string }>; // 段内受控变化(verse 中段)
  grooveContract?: GrooveTextureContract; // ★ §4:ACG 逐-bar 织体选择消费 GrooveContract(preferred/allowed/forbidden)
  acgBarFamilyBySpan?: Record<string, 'drive' | 'sparse'>; // ★ Phase 3A:ACG family intent(enforce);缺省→内联派生(fallback)
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

  // ACG PIANOSONG 以 4/8 小节手型建立记忆，而非每个和弦随机换手势。
  // 器配层已下发 section 主织体；只有未下发的直调/兼容路径才按 4 小节短语回退选择。
  const fBar = (f: HarmonicFunction | undefined): 'T' | 'S' | 'D' => (f === 'D' ? 'D' : f === 'S' ? 'S' : 'T');
  if (txStyle === 'ACG') {
    // family intent 仅服务 fallback；正常产品路径优先使用器配层为该段选定的主手型。
    const acgFamilies = args.acgBarFamilyBySpan ?? deriveAcgBarFamilies(plan, activeSectionIds, sectionRoleById);
    let acgPrevId: string | undefined; let acgPrevCase: string | undefined; let acgRep = 0;
    let fallbackPhrase: number | undefined;
    const finalCadenceCase = 'ACG_Pedal_Wash_Color_Drops';
    const lastActiveSpanId = [...timeline].reverse().find((span) => activeSectionIds.has(span.sectionId))?.id;
    const allows = (textureCase: string): boolean =>
      (!grooveContract?.allowedTextureCases || grooveContract.allowedTextureCases.includes(textureCase))
      && !grooveContract?.forbiddenTextureCases?.includes(textureCase);
    timeline.forEach((span, i) => {
      if (!activeSectionIds.has(span.sectionId)) return;
      const planned = rich[span.sectionId];
      if (planned && hasTextureRenderer(planned)) {
        schedule[span.id] = span.id === lastActiveSpanId && allows(finalCadenceCase) && hasTextureRenderer(finalCadenceCase)
          ? finalCadenceCase
          : planned;
        return;
      }

      // 没有器配主织体时，仍以 4 小节为一个手型单位，避免直调 API 退回逐 span 拼贴。
      const phrase = Math.floor((span.startBeat as number) / 16);
      if (fallbackPhrase !== phrase) {
        fallbackPhrase = phrase;
        const label = SECTION_LABEL[sectionRoleById[span.sectionId] ?? 'verse'] ?? 'VERSE';
        const barFamily = acgFamilies[span.id];
        const prof = pickAcgTextureForBar({
          barIndex: i, totalBars: timeline.length, sectionLabel: label,
          func: fBar(funcBySpan[span.id]),
          nextFunc: i + 1 < timeline.length ? fBar(funcBySpan[timeline[i + 1].id]) : null,
          prevTextureId: acgPrevId, repeatCount: acgRep, contract: grooveContract, characterFamily: barFamily, random: textureRng,
        });
        if (prof.id === acgPrevId) acgRep += 1; else { acgPrevId = prof.id; acgRep = 1; }
        acgPrevCase = prof.textureCase;
      }
      if (acgPrevCase && hasTextureRenderer(acgPrevCase)) schedule[span.id] = acgPrevCase;
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
