// ============================================================
// newEngine · arranger · deriveMusicIntentPlan(mg_intent_planning_layer_migration_directive_v2 §5.3, Phase 1)
// ------------------------------------------------------------
// Arranger owns musical intent → 派生逻辑放这。★ Phase 1:纯函数、observe-only、【不抽 RNG】、【不被 render 消费】
//   → 结构性保证生成输出不变(#3 RNG 纪律)。来源全 SIM-native(#1):ArrangementPlan(section/role/energy/bars)
//   + GrooveContract id + styleIntentProfile + finalEventProfile;不跑 MG oracle。
// Phase 1 派生子集:section role/energy/grooveContractId + bass pattern(placeholder)+ texture family(placeholder)。
//   其余 schedule(comp onset-form/lead grammar/transition)Phase 2-6 增量落地。
// ============================================================

import { beatsPerBarOf } from './phraseTiming';
import type { ArrangementPlan } from './ArrangementPlan';
import type { StyleName } from '../knowledge/mgMusicTheory';
import { styleIntentProfile, bassFamilyFromFloorBeats } from '../knowledge/styleIntentProfiles';
import { dominantFamilyOfCases } from '../knowledge/textureFamilyMap';
import type { MusicIntentPlan, SectionMusicIntent, IntentMeta, BassPatternSchedule, TextureFamilySchedule } from '../intent/MusicIntentPlan';
import type { IntentSummary } from '../intent/intentAuditTypes';

const CREATED_BY = 'deriveMusicIntentPlan/phase2';
const observeMeta = (): IntentMeta => ({ mode: 'observe', source: 'sim-derived', createdBy: CREATED_BY });
// ★ Phase 2:只 bass schedule 翻 enforce(render 消费 applyBassPatternSchedule);其它字段仍 observe(用户约束)。
const bassMeta = (): IntentMeta => ({ mode: 'enforce', source: 'sim-derived', createdBy: CREATED_BY });

export function deriveMusicIntentPlan(style: string, arrangement: ArrangementPlan): MusicIntentPlan {
  const styleName = style.toUpperCase() as StyleName; // band.style 是小写字符串;归一到 StyleName(消费者仍 lowercase 匹配)
  const bpb = beatsPerBarOf(arrangement.meter);
  const prof = styleIntentProfile(style);
  const bassFamily = bassFamilyFromFloorBeats(style);
  // ★ Phase 3(observe):texture family intent = GrooveContract preferred 的主导 family(arranger 的织体身份;SIM-native)。
  //   缺 contract → styleProfile 默认。per-section 暂用同一 song-level family(intro/outro 微调留后续精化)。
  const preferred = (arrangement.songGrooveContract?.preferredTextureCases ?? []) as readonly string[];
  const grooveFamily = preferred.length > 0 ? dominantFamilyOfCases(preferred) : prof.defaultTextureFamily;
  let startBar = 0;
  const sections: SectionMusicIntent[] = arrangement.sections.map((s) => {
    const startBeat = startBar * bpb;
    const endBeat = (startBar + s.bars) * bpb;
    startBar += s.bars;
    const energy = arrangement.energyBySection[s.id] ?? 0.5;
    const densityHint = energy >= 0.66 ? 'dense' : energy <= 0.4 ? 'sparse' : 'medium';
    // ★ Phase 2:intro/outro bass = minimal(与 enforceBassDensityFloor 跳过 intro/outro 一致 → schedule 精确编码现 floor)。
    const secBassFamily = (s.role === 'intro' || s.role === 'outro') ? 'minimal' : bassFamily;
    const bassPatternSchedule: BassPatternSchedule = {
      meta: bassMeta(),
      slots: [{ meta: bassMeta(), startBeat, endBeat, family: secBassFamily, targetNotesPerBar: prof.bassTargetNotesPerBar, allowEnergyThinning: true }],
    };
    const textureFamilySchedule: TextureFamilySchedule = {
      meta: observeMeta(),
      slots: [{ meta: observeMeta(), startBeat, endBeat, family: grooveFamily, densityHint, switchPolicy: 'section' }],
    };
    return {
      meta: observeMeta(),
      sectionId: s.id, sectionRole: s.role, functionTag: s.functionTag,
      startBeat, endBeat, bars: s.bars, energy,
      grooveContractId: arrangement.songGrooveContractId,
      bassPatternSchedule, textureFamilySchedule,
    };
  });
  return { version: 1, style: styleName, mode: 'observe', source: 'sim-derived', sections };
}

/** 紧凑摘要,供 report 暴露(observe:不被 render 消费)。 */
export function summarizeMusicIntent(plan: MusicIntentPlan): IntentSummary {
  return {
    version: 1, style: plan.style, mode: plan.mode, source: plan.source,
    sections: plan.sections.map((s) => ({
      sectionId: s.sectionId, sectionRole: s.sectionRole, functionTag: s.functionTag,
      startBeat: s.startBeat, bars: s.bars, energy: +s.energy.toFixed(2),
      grooveContractId: s.grooveContractId, mode: s.meta.mode, source: s.meta.source,
      bassFamily: s.bassPatternSchedule?.slots[0]?.family,
      bassTargetNotesPerBar: s.bassPatternSchedule?.slots[0]?.targetNotesPerBar,
      textureFamily: s.textureFamilySchedule?.slots[0]?.family,
    })),
  };
}
