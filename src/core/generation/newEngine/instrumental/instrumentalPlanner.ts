// ============================================================
// newEngine · instrumental · InstrumentalPlanner(Slice 1)
// ------------------------------------------------------------
// 架构定稿 Part 7 / 3 表:BandSpec + ArrangementPlan → InstrumentationPlan。
// 织体按段落功能;让位策略按织体分流;hookAnchorSlots 由 skeletonRole='hook' 的 phrase 推导,
// 携带绝对拍位 + 让位要求(主 hook=chorus 强制让位)。
// (HarmonicPlan 在加 voicingPlan 时再接入,当前 register/texture/reservation 不需要它。)
// ============================================================

import { midi, type Rng } from '../foundation';
import type { BandSpec, InstrumentRoleName } from '../band/BandSpec';
import type { ArrangementPlan, Section } from '../arranger/ArrangementPlan';
import { phraseStartBeats } from '../arranger/phraseTiming';
import { pickGenericTexture, GENERIC_TEXTURE_YIELD, type TextureSectionRole } from '../knowledge/textureProfiles';
import { sameFamilyAlternates, isKeyboardFamily } from '../knowledge/instruments';
import {
  freezeInstrumentationPlan,
  type HookAnchorSlot,
  type InstrumentationPlan,
  type InstrumentationPlanData,
  type RegisterRange,
  type TextureKind,
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

// ★ 织体选择偏好 + 让位策略已搬进 KB(knowledge/textureProfiles)。引擎不再自带,改查 KB。

// 会切音色的乐手:仅 comp/lead,且【仅键盘族】(效果器/电钢能切;颤音琴/马林巴是物理乐器,不切)。
const TIMBRE_SWITCH_ROLES: InstrumentRoleName[] = ['comp', 'lead'];
const TIMBRE_SWITCH_PROB = 0.12; // 偶尔(每首掷一次):~12% 歌切,88% 全曲单音色

export function buildInstrumentationPlan(
  band: BandSpec,
  arrangement: ArrangementPlan,
  rng?: Rng, // ★ 音色切换决策(确定性子流);缺省 = 不切(全曲 primary,向后兼容)
): InstrumentationPlan {
  const textureBySection: Record<string, TextureKind> = {};
  const activityBySection: Record<string, Partial<Record<InstrumentRoleName, number>>> = {};
  const sectionById: Record<string, Section> = {};

  for (const s of arrangement.sections) {
    sectionById[s.id] = s as Section;
    const e = arrangement.energyBySection[s.id] ?? 0.5;
    textureBySection[s.id] = pickGenericTexture(s.role as TextureSectionRole); // 查 KB(引擎无偏好)
    activityBySection[s.id] = { bass: e, comp: e, drum: e, lead: e, pad: clamp01(1 - e) };
  }

  // ★ 器配音色:每角色 × 每段落。默认全 primary;comp/lead 掷骰命中 → chorus 段换【同族】备选(段落对比)。
  //   repeatGroup 一致:按 section.role 决策 → 所有 chorus 段同备选、verse 段同 primary。确定性。
  // ★ 每首【掷一次骰】:命中 → 选一个【键盘族 comp/lead】乐手,chorus 换同族备选。最多一个乐手切。
  const eligible = band.instrumentPool.filter(
    (r) => TIMBRE_SWITCH_ROLES.includes(r) && isKeyboardFamily(band.roleProgram[r]) && sameFamilyAlternates(band.style, r, band.roleProgram[r]).length > 0,
  );
  let switchRole: InstrumentRoleName | undefined;
  let switchAlt: number | undefined;
  if (rng && eligible.length > 0 && rng.next() < TIMBRE_SWITCH_PROB) {
    switchRole = rng.pick(eligible);
    switchAlt = rng.pick(sameFamilyAlternates(band.style, switchRole, band.roleProgram[switchRole]));
  }
  const programByRoleSection: Record<InstrumentRoleName, Record<string, number>> = {} as Record<InstrumentRoleName, Record<string, number>>;
  for (const role of band.instrumentPool) {
    const primary = band.roleProgram[role];
    programByRoleSection[role] = {};
    for (const s of arrangement.sections) {
      programByRoleSection[role][s.id] = role === switchRole && switchAlt !== undefined && s.role === 'chorus' ? switchAlt : primary;
    }
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
    textureYieldPolicy: GENERIC_TEXTURE_YIELD,
    programByRoleSection,
    melodyReservationPlan: {
      reservedRegister: REGISTER_BY_ROLE.lead,
      densityCeiling: clamp01(band.styleProfile.accompDensity),
      hookAnchorSlots,
    },
  };

  return freezeInstrumentationPlan(data);
}
