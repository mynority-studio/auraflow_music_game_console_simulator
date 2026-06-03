// ============================================================
// newEngine · instrumental · InstrumentalPlanner(Slice 1)
// ------------------------------------------------------------
// 架构定稿 Part 7 / 3 表:BandSpec + ArrangementPlan → InstrumentationPlan。
// 织体按段落功能;让位策略按织体分流;hookAnchorSlots 由 skeletonRole='hook' 的 phrase 推导,
// 携带绝对拍位 + 让位要求(主 hook=chorus 强制让位)。
// (HarmonicPlan 在加 voicingPlan 时再接入,当前 register/texture/reservation 不需要它。)
// ============================================================

import { midi } from '../foundation';
import type { BandSpec, InstrumentRoleName } from '../band/BandSpec';
import type { ArrangementPlan, PhraseId, Section, SectionRole } from '../arranger/ArrangementPlan';
import {
  freezeInstrumentationPlan,
  type HookAnchorSlot,
  type InstrumentationPlan,
  type InstrumentationPlanData,
  type RegisterRange,
  type TextureKind,
  type YieldClass,
} from './InstrumentationPlan';

const rr = (lo: number, hi: number): RegisterRange => ({ lowMidi: midi(lo), highMidi: midi(hi) });
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

const REGISTER_BY_ROLE: Record<InstrumentRoleName, RegisterRange> = {
  bass: rr(36, 48),
  comp: rr(48, 67),
  pad: rr(48, 84),
  lead: rr(67, 84),
  drum: rr(35, 50),
};

const TEXTURE_BY_ROLE: Record<SectionRole, TextureKind> = {
  intro: 'pad',
  verse: 'arpeggio',
  chorus: 'active-comp',
  bridge: 'sustained-block',
  outro: 'pad',
};

const TEXTURE_YIELD: Record<TextureKind, YieldClass> = {
  'active-comp': 'active',
  arpeggio: 'active',
  'walking-bass': 'active',
  pad: 'floating',
  'sustained-block': 'floating',
};

function phraseStartBeats(arrangement: ArrangementPlan): Record<PhraseId, number> {
  const beatsPerBar = arrangement.meter.numerator * (4 / arrangement.meter.denominator);
  const starts: Record<PhraseId, number> = {};
  let beat = 0;
  for (const section of arrangement.sections) {
    const phrases = arrangement.phrases
      .filter((p) => p.sectionId === section.id)
      .slice()
      .sort((a, b) => a.phraseSlot - b.phraseSlot);
    for (const p of phrases) {
      starts[p.id] = beat;
      beat += p.bars * beatsPerBar;
    }
  }
  return starts;
}

export function buildInstrumentationPlan(
  band: BandSpec,
  arrangement: ArrangementPlan,
): InstrumentationPlan {
  const textureBySection: Record<string, TextureKind> = {};
  const activityBySection: Record<string, Partial<Record<InstrumentRoleName, number>>> = {};
  const sectionById: Record<string, Section> = {};

  for (const s of arrangement.sections) {
    sectionById[s.id] = s as Section;
    const e = arrangement.energyBySection[s.id] ?? 0.5;
    textureBySection[s.id] = TEXTURE_BY_ROLE[s.role as SectionRole];
    activityBySection[s.id] = { bass: e, comp: e, drum: e, lead: e, pad: clamp01(1 - e) };
  }

  const starts = phraseStartBeats(arrangement);
  const hookAnchorSlots: HookAnchorSlot[] = arrangement.phrases
    .filter((p) => p.skeletonRole === 'hook')
    .map((p): HookAnchorSlot => {
      const isMain = sectionById[p.sectionId]?.hookPolicy === 'main';
      return {
        phraseId: p.id,
        beatSlot: starts[p.id],
        preferredRegister: REGISTER_BY_ROLE.lead,
        anchorRequired: isMain,
        segment: 'head',
        maxAccompanimentDensity: isMain ? 0.4 : 0.6,
      };
    });

  const data: InstrumentationPlanData = {
    activityBySection,
    registerByRole: REGISTER_BY_ROLE,
    textureBySection,
    textureYieldPolicy: TEXTURE_YIELD,
    melodyReservationPlan: {
      reservedRegister: REGISTER_BY_ROLE.lead,
      densityCeiling: clamp01(band.styleProfile.accompDensity),
      hookAnchorSlots,
    },
  };

  return freezeInstrumentationPlan(data);
}
