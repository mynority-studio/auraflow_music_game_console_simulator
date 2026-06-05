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
import type { ArrangementPlan, Section, SectionFunctionTag } from '../arranger/ArrangementPlan';
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

// ============================================================
// ★ 编曲密度弧(A1):genre × functionTag → 该段【期望在场的乐手】(再 ∩ lineup)。
//   原则(联网编曲实践):能量=在场元素多少随时间变化。POP 走加法弧(intro 稀疏→chorus 全员同进=release)、
//   RNB minimal、LOFI 近恒定 loop(filterBreak 去鼓)、JAZZ 四件常驻(变化在 solo/comp 密度,不靠乐器进出)。
//   lead 当前全程在场(fork1 默认,gating 留后续);无 functionTag/genre 的段 → 全 lineup(向后兼容)。
//   确定性(纯 genre×tag×lineup);同 functionTag → 同活动 → repeatGroup 一致(verse1≡verse2)。
// ============================================================
const ALL_ROLES: readonly InstrumentRoleName[] = ['bass', 'comp', 'pad', 'drum', 'lead'];
const DENSITY_ARC: Record<string, Partial<Record<SectionFunctionTag, InstrumentRoleName[]>>> = {
  pop: {
    setup: ['pad', 'comp', 'lead'],
    story: ['bass', 'drum', 'comp', 'lead'],                 // core,去 pad 留空间
    build: ['bass', 'drum', 'comp', 'pad', 'lead'],          // +pad 加厚(推)
    hook: ['bass', 'drum', 'comp', 'pad', 'lead'],           // 全员同进(downbeat=release)
    breakdown: ['bass', 'comp', 'pad', 'lead'],              // 去 drum(掉拍)
    outro: ['pad', 'bass', 'lead'],
  },
  rnb: {
    setup: ['pad', 'comp', 'lead'],
    story: ['bass', 'comp', 'drum', 'lead'],
    build: ['bass', 'comp', 'drum', 'pad', 'lead'],
    hook: ['bass', 'comp', 'drum', 'pad', 'lead'],
    breakdown: ['comp', 'lead'],                             // 真抽离 keys+vocal
    outro: ['pad', 'comp', 'lead'],
  },
  lofi: {
    setup: ['comp', 'bass', 'lead'],
    loop: ['bass', 'comp', 'drum', 'pad', 'lead'],           // 近恒定 full loop
    breakdown: ['bass', 'comp', 'pad', 'lead'],              // filterBreak 去 drum
    outro: ['comp', 'pad', 'lead'],
  },
  jazz: {
    setup: ['comp', 'bass', 'lead'],
    head: ['bass', 'comp', 'drum', 'lead'],
    build: ['bass', 'comp', 'drum', 'lead'],
    solo: ['bass', 'comp', 'drum', 'lead'],
    headOut: ['bass', 'comp', 'drum', 'lead'],
    tag: ['comp', 'bass', 'lead'],
  },
};

// ★ 织体按 functionTag(A3):取代纯 5-role 选择,让 build/breakdown/loop/head/solo/tag 各有专属织体。
//   值域 = GenericTextureKind(active-comp/arpeggio/pad/sustained-block/walking-bass);
//   texture→yield(active/floating)决定 render 的 activeSectionIds(active=comp 富织体)。
//   映射放消费层(instrumentalPlanner 已知 functionTag)→ 不让 knowledge 反依赖 arranger。
const TEXTURE_BY_FUNCTION: Record<SectionFunctionTag, TextureKind> = {
  setup: 'pad',                  // intro 铺底
  story: 'arpeggio',             // verse 分解(留空间)
  build: 'active-comp',          // 推进(富织体)
  hook: 'active-comp',           // 副歌满
  breakdown: 'sustained-block',  // 抽离(floating=让位)
  loop: 'arpeggio',              // lofi loop 分解
  head: 'active-comp',           // jazz comping
  solo: 'active-comp',           // solo 下 comping
  headOut: 'active-comp',
  tag: 'sustained-block',        // 收束持音
  outro: 'pad',                  // 淡出铺底
};

// ★ A4 lead-gating(多样性):仅这些 framing/transition 段 lead【可缺席】(纯器乐 intro / 人声抽离 breakdown);
//   core 段(story/build/hook/loop/head/solo/headOut)lead 恒在(旋律必须扛歌)。per-song 掷骰 → 两种都出现。
const LEAD_OPTIONAL_TAGS: readonly SectionFunctionTag[] = ['setup', 'breakdown', 'outro', 'tag'];
const LEAD_DROP_PROB = 0.45;

/** 该段在场乐手 = (密度弧 mask ± lead)∩ lineup;无 tag/genre → 全 lineup。
 *  lead 默认在场;仅 lead-optional 段且本曲掷中 leadDropTags → 缺席(纯器乐,多样性,gate 落地)。 */
function activeRolesFor(
  style: string,
  section: Section,
  lineup: readonly InstrumentRoleName[],
  leadDropTags?: ReadonlySet<SectionFunctionTag>,
): InstrumentRoleName[] {
  const genre = DENSITY_ARC[style.toLowerCase()];
  const mask = genre && section.functionTag ? genre[section.functionTag] : undefined;
  const want = new Set<InstrumentRoleName>(mask ?? ALL_ROLES);
  if (section.functionTag && leadDropTags?.has(section.functionTag)) want.delete('lead');
  else want.add('lead');
  return lineup.filter((r) => want.has(r));
}

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
  const activeRolesBySection: Record<string, InstrumentRoleName[]> = {};
  const sectionById: Record<string, Section> = {};

  for (const s of arrangement.sections) {
    sectionById[s.id] = s as Section;
    const e = arrangement.energyBySection[s.id] ?? 0.5;
    // 织体:functionTag 优先(A3),无则回退 legacy role(template/无 rng 段)。
    textureBySection[s.id] = s.functionTag ? TEXTURE_BY_FUNCTION[s.functionTag] : pickGenericTexture(s.role as TextureSectionRole);
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

  // ★ A4 lead-gating(多样性):lead-optional 段(intro/breakdown/outro/tag)本曲掷骰 → 纯器乐 or 含 lead。
  //   rng 在 timbre 决策【之后】取 → 不扰 timbre 确定性。无 rng → 不 drop(lead 全程,向后兼容)。
  const leadDropTags = new Set<SectionFunctionTag>();
  if (rng) for (const tag of LEAD_OPTIONAL_TAGS) if (rng.next() < LEAD_DROP_PROB) leadDropTags.add(tag);
  for (const s of arrangement.sections) {
    activeRolesBySection[s.id] = activeRolesFor(band.style, s as Section, band.instrumentPool, leadDropTags); // ★ 密度弧 + lead-gating
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
    activeRolesBySection,
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
