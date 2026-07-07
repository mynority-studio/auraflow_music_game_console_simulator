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
import { pickGenericTexture, GENERIC_TEXTURE_YIELD, pickTextureForBarWithGroove, densityForCell, energyForCell, rateTextureTransition, DELAYED_ENTRY_TEXTURES, type TextureSectionRole, type TextureStyleName } from '../knowledge/textureProfiles';
import { sameFamilyAlternates, isKeyboardFamily, classifyTimbreWorld, repairWorldMismatches, sameInstrumentPairs, coherentLeadComp, repairCompCapability, enforceRoleFamilies, preferredRegisterForRole } from '../knowledge/instruments';
import { orchestrateRolePrograms } from '../knowledge/gmOrchestrationChains';
import { pickSpaceProfile, mixForProgram, enforceRelationalMix, type RoleMix } from '../knowledge/gmMixProfile';
import { drumGrooveVariants, type DrumHit, type GrooveKind } from '../knowledge/grooves';
import { mapProgramToAura25, mapRoleProgramsToAura25 } from '../../../sound/Aura25Palette';
import { buildGestureExpressionByRole } from './gestureExpression';
import {
  freezeInstrumentationPlan,
  type BoundaryGesturePlan,
  type EndingPlan,
  type HookAnchorSlot,
  type InstrumentationPlan,
  type InstrumentationPlanData,
  type RegisterRange,
  type SongEntryPlan,
  type TextureKind,
  type TransitionPlan,
} from './InstrumentationPlan';
import type { EndingStyle } from '../arranger/ArrangementPlan';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';

const rr = (lo: number, hi: number): RegisterRange => ({ lowMidi: midi(lo), highMidi: midi(hi) });
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

const REGISTER_BY_ROLE: Record<InstrumentRoleName, RegisterRange> = {
  bass: rr(36, 48),
  comp: rr(48, 67),
  pad: rr(48, 84),
  lead: rr(67, 84),
  drum: rr(35, 50),
};

function registerForRole(role: InstrumentRoleName, program: number | undefined): RegisterRange {
  if (program === undefined) return REGISTER_BY_ROLE[role];
  const [lo, hi] = preferredRegisterForRole(role, program);
  return rr(lo, hi);
}

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
    outro: ['pad', 'comp', 'bass', 'lead'],                  // ★ +bass:接地落终止根音(无 pad 的编制下 outro 才不空)
  },
  lofi: {
    setup: ['comp', 'bass', 'lead'],
    loop: ['bass', 'comp', 'drum', 'pad', 'lead'],           // 近恒定 full loop
    breakdown: ['bass', 'comp', 'pad', 'lead'],              // filterBreak 去 drum
    outro: ['comp', 'pad', 'bass', 'lead'],                  // ★ +bass:同上,outro 接地
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
// ★ 收尾段(outro/tag)旋律【不能缺席】(2026-06-08,用户:outro 可以有旋律但要回归主音)→ 即便掷中也不丢 lead。
//   仍对它们掷骰(保 rng 抽取对齐 → intro 先行档/rich texture 决策 bit 不变),只是结果不采用。
const LEAD_NEVER_DROP_TAGS: ReadonlySet<SectionFunctionTag> = new Set(['outro', 'tag']);

// ★ intro 先行档(多样性修):intro(setup 段)从这组 per-song 掷一个 → pad/keys/bass/solo/full 轮换,
//   不再恒定 bass 先行(jazz/lofi)或 pad 先行(pop/rnb)。keys 档把 texture 设 active(arpeggio)→ comp 真渲染
//   (否则 intro 是 floating pad 段、comp 静默 = "伴奏织体先行"出不来)。∩lineup 空 → 回退密度弧默认。
interface IntroArchetype { roles: InstrumentRoleName[]; texture: TextureKind }
const INTRO_ARCHETYPES: readonly IntroArchetype[] = [
  { roles: ['pad', 'lead'], texture: 'pad' },                         // 暖 pad 铺底 + 旋律
  { roles: ['pad'], texture: 'pad' },                                 // 纯 ambient pad(器乐 intro)
  { roles: ['comp', 'lead'], texture: 'arpeggio' },                   // keys/arp 先行 + 旋律(伴奏织体先行)
  { roles: ['comp'], texture: 'arpeggio' },                          // keys riff(器乐 intro)
  { roles: ['comp', 'pad', 'lead'], texture: 'arpeggio' },           // keys + pad + 旋律
  { roles: ['bass', 'lead'], texture: 'pad' },                       // bass 先行
  { roles: ['lead'], texture: 'pad' },                              // solo 旋律先行
  { roles: ['comp', 'pad', 'bass', 'lead'], texture: 'active-comp' }, // full(全员起)
];

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
// verse 段内织体变化概率(每首掷一次):LOFI 段内变化是风格的一部分(高)、现代风格保守(低)。
const VERSE_VARIATION_PROB: Record<string, number> = { POP: 0.35, RNB: 0.35, JAZZ: 0.2, LOFI: 0.6 };

/** ★ 收尾乐器进出计划(器配据 arrangement.endingStyle 排;render 投影成手势)。
 *  退出次序原则:鼓/comp/bass = 节奏-能量件先退;pad/lead = 和声-气氛件后留承接收束。纯派生、确定性。 */
// ★ 2026-06-10:收尾计划据【末段实际在场角色】(activeRolesBySection[outro] —— 已含密度弧/lead-gating/
//   Loop D comp 托底,且不含静默 pad)而非整首 lineup → 不再把 jazz 等静默 pad 写进 sustain/anchor。
function buildEndingPlan(style: EndingStyle, sections: readonly Section[], outroActiveRoles: readonly InstrumentRoleName[]): EndingPlan {
  const outro = sections[sections.length - 1];
  const outroBars = outro?.bars ?? 0;
  const has = (r: InstrumentRoleName) => outroActiveRoles.includes(r);
  const exitBarByRole: Partial<Record<InstrumentRoleName, number>> = {};
  if (style === 'fade' && outroBars >= 2) {
    // 渐隐:节奏件错开退出(先 drum,再 comp,再 bass),pad/lead 响到末(尾音收束)。
    // ★ comp 只在【有 pad】时早退(pad 接渐隐尾音);无 pad 编制 → comp 留作尾音声部(靠力度 ramp 渐隐到末),
    //   否则 fade 末两小节会空(pad 缺、lead 常被 gate)= 仍像戛然而止。
    if (has('drum')) exitBarByRole.drum = Math.max(1, Math.round(outroBars * 0.34));
    if (has('comp') && has('pad')) exitBarByRole.comp = Math.max(1, Math.round(outroBars * 0.6));
    if (has('bass')) exitBarByRole.bass = Math.max(1, Math.round(outroBars * 0.8));
  } else if (style === 'tag' && outroBars >= 1) {
    // 延留:节奏件(鼓/bass)末小节退出,和声件(comp/pad/lead)延留末和弦 → 渐慢/收束感(不改 tempo)。
    if (has('drum')) exitBarByRole.drum = Math.max(1, outroBars - 1);
    if (has('bass')) exitBarByRole.bass = Math.max(1, outroBars - 1);
  }
  // cold:无早退(全员撑到末下拍齐停 + button 重音,由 render coldStop 投影)。
  // ★ Loop G cadence orchestration:sustain=pad 优先 / 无 pad 用 comp(lead 不延留;末段实际在场角色据上)。
  //   protectLeadTiming → lead 时值不被强拉(snap 管落主音)。(finalAnchorRoles 已删:render 侧从未消费=死字段,
  //   末 I 接地由 sustainRoles 延留 + coldStop/hold + musicalityAuditor outro-harmonic-support 覆盖。)
  const sustainRoles: InstrumentRoleName[] = has('pad') ? ['pad'] : has('comp') ? ['comp'] : [];
  return {
    style,
    outroSectionId: outro?.id ?? null,
    outroBars,
    exitBarByRole,
    holdFinalChord: style === 'tag',
    fadeOut: style === 'fade',
    coldStop: style === 'cold',
    sustainRoles,
    protectLeadTiming: true,
  };
}

// ★ Loop C(2026-06-08):段落边界衔接计划。纯派生(arrangement.entryBySection + activeRolesBySection + lineup),
//   无 rng、确定性。pickup 优先 drum>comp>bass;接地 grounding 优先 bass/drum + 一个和声支撑。
const PICKUP_PREF: readonly InstrumentRoleName[] = ['drum', 'comp', 'bass'];
const GROUNDING_PREF: readonly InstrumentRoleName[] = ['bass', 'drum'];
const HARMONIC_SUPPORT_PREF: readonly InstrumentRoleName[] = ['comp', 'pad'];

function buildTransitionPlan(
  arrangement: ArrangementPlan,
  activeRolesBySection: Record<string, InstrumentRoleName[]>,
  lineup: readonly InstrumentRoleName[],
): TransitionPlan {
  const sections = arrangement.sections;
  const startBar: number[] = [];
  let cum = 0;
  for (const s of sections) { startBar.push(cum); cum += s.bars; }
  const has = (r: InstrumentRoleName) => lineup.includes(r);
  const anchorFor = (active: ReadonlySet<InstrumentRoleName>): InstrumentRoleName[] => {
    const grounding = GROUNDING_PREF.filter((r) => active.has(r) && has(r));
    const harm = HARMONIC_SUPPORT_PREF.find((r) => active.has(r) && has(r));
    return [...grounding, ...(harm ? [harm] : [])];
  };

  const boundaries: BoundaryGesturePlan[] = [];
  for (let i = 0; i < sections.length - 1; i++) {
    const from = sections[i], to = sections[i + 1];
    const entry = (arrangement.entryBySection[to.id] ?? 'downbeat');
    const toActive = new Set<InstrumentRoleName>(activeRolesBySection[to.id] ?? []);
    const fromActive = new Set<InstrumentRoleName>(activeRolesBySection[from.id] ?? []);
    const pickupRoles = entry === 'lead-in' ? PICKUP_PREF.filter((r) => toActive.has(r) && has(r)) : [];
    const releaseRoles = [...toActive].filter((r) => !fromActive.has(r)); // to 段下拍新进入
    boundaries.push({
      fromSectionId: from.id, toSectionId: to.id,
      boundaryBar: startBar[i + 1], prepBar: startBar[i + 1] - 1, entry,
      pickupRoles, releaseRoles, downbeatAnchorRoles: anchorFor(toActive),
      protectPickupFromGate: pickupRoles.length > 0,
    });
  }

  const first = sections[0];
  const hasIntro = first.functionTag === 'setup' || first.role === 'intro';
  const firstActive = new Set<InstrumentRoleName>(activeRolesBySection[first.id] ?? []);
  const downbeatAnchorRoles = anchorFor(firstActive);
  // staged-first-bar:无 intro 直入 → 非锚点非 lead 的角色延后进入(避免全员戛然同起)。
  const delayedRoles = hasIntro ? [] : [...firstActive].filter((r) => !downbeatAnchorRoles.includes(r) && r !== 'lead');
  const songEntry: SongEntryPlan = {
    firstSectionId: first.id, hasIntro,
    mode: hasIntro ? 'normal-intro' : 'staged-first-bar',
    downbeatAnchorRoles, delayedRoles,
  };
  return { boundaries, songEntry };
}

// ★ #6(2026-06-10):某段落是否【属和弦链】(≥2 连续 D 功能)→ 段级 rich texture 选择据此避让
//   avoidOnDominantChain 织体(ambient/pedal 在属链上糊/悬而不决)。harmony 缺省 → false(向后兼容)。
function sectionIsDominantChain(harmonic: HarmonicPlan | undefined, sectionId: string): boolean {
  if (!harmonic) return false;
  let run = 0;
  for (let i = 0; i < harmonic.chordTimeline.length; i++) {
    if (harmonic.chordTimeline[i].sectionId !== sectionId) continue;
    if (harmonic.chordFunctionTimeline[i] === 'D') { run += 1; if (run >= 2) return true; } else run = 0;
  }
  return false;
}

export function buildInstrumentationPlan(
  band: BandSpec,
  arrangement: ArrangementPlan,
  rng?: Rng, // ★ 音色切换决策(确定性子流);缺省 = 不切(全曲 primary,向后兼容)
  harmonic?: HarmonicPlan, // ★ #6:吃 HarmonicPlan → 段级 texture 选择用真 dominant-chain(缺省 false,向后兼容)
): InstrumentationPlan {
  // ★ 音色世界统一性:先把 BandEngine 的 provisional roleProgram 过【风格错配修复】(当前池已守住=多为原样,
  //   family-invariant → comp voicing 决策不受影响),再【lead↔comp 配对一致性】修不搭对(电钢配电钢、
  //   马林巴解绑电钢),最后分类世界 + 记同乐器对。GM program 仍走 programByRoleSection。
  //   ★ 2026-06-10:链中加【comp 能力修复】—— comp 必须是多音 + 非持续乐器(单音/持续如管风琴不能做衰减节奏 comp);
  //     先修 comp 能力,再 lead↔comp 配对(lead 贴到已合法的 comp)。
  // ★ 链式协同(gm128_chain_orchestration,2026-06-10):器配层【拥有】最终 GM 选择 —— 用 BandEngine 的
  //   provisional(band.roleProgram,已 seed-变化)当候选,链按 comp→lead→bass→pad 顺序协同(兼容则保留=守
  //   多样性;不兼容链表赢=同族/可兼容)。世界由 provisional 推导→不抽 rng,不洗 timbre 序列。然后过既有安全网
  //   (repairWorld/repairCompCapability/coherentLeadComp,链后多为 no-op)。
  const orch = orchestrateRolePrograms({ style: band.style, lineup: band.instrumentPool, rng, provisional: band.roleProgram });
  // ★ participant 家族守卫(P1/P2 修复):orchestration/repair 后,把 Band Selection 的乐手家族约束
  //   闭环到【最终发声 program】—— 选了合成氛围(pad)/键盘手(keyboard)等,最终音色一定在该家族内。
  const repairedRoleProgram = enforceRoleFamilies(
    coherentLeadComp(repairCompCapability(repairWorldMismatches(orch.roleProgram, band.style), band.style), band.style),
    band.familyByRole, band.style,
  );
  const roleProgram = mapRoleProgramsToAura25(repairedRoleProgram, band.style) as Record<InstrumentRoleName, number>;
  const aura25Decisions = band.instrumentPool
    .filter((role) => repairedRoleProgram[role] !== undefined && repairedRoleProgram[role] !== roleProgram[role])
    .map((role) => `${role} Aura25 GM${repairedRoleProgram[role]}→GM${roleProgram[role]}`);
  const timbreWorld = classifyTimbreWorld(roleProgram, band.style);
  const samePairs = sameInstrumentPairs(roleProgram);
  const gestureExpressionByRole = buildGestureExpressionByRole(ALL_ROLES, roleProgram, band.style);
  const registerByRole = Object.fromEntries(
    ALL_ROLES.map((role) => [role, registerForRole(role, roleProgram[role])]),
  ) as Record<InstrumentRoleName, RegisterRange>;

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
    (r) => TIMBRE_SWITCH_ROLES.includes(r) && isKeyboardFamily(roleProgram[r]) && sameFamilyAlternates(band.style, r, roleProgram[r]).length > 0,
  );
  let switchRole: InstrumentRoleName | undefined;
  let switchAlt: number | undefined;
  if (rng && eligible.length > 0 && rng.next() < TIMBRE_SWITCH_PROB) {
    switchRole = rng.pick(eligible);
    switchAlt = mapProgramToAura25(rng.pick(sameFamilyAlternates(band.style, switchRole, roleProgram[switchRole])), switchRole, band.style);
  }
  const programByRoleSection: Record<InstrumentRoleName, Record<string, number>> = {} as Record<InstrumentRoleName, Record<string, number>>;
  for (const role of band.instrumentPool) {
    const primary = roleProgram[role];
    programByRoleSection[role] = {};
    for (const s of arrangement.sections) {
      const selected = role === switchRole && switchAlt !== undefined && s.role === 'chorus' ? switchAlt : primary;
      programByRoleSection[role][s.id] = mapProgramToAura25(selected, role, band.style);
    }
  }

  // ★ A4 lead-gating(多样性):lead-optional 段(intro/breakdown/outro/tag)本曲掷骰 → 纯器乐 or 含 lead。
  //   rng 在 timbre 决策【之后】取 → 不扰 timbre 确定性。无 rng → 不 drop(lead 全程,向后兼容)。
  const leadDropTags = new Set<SectionFunctionTag>();
  if (rng) for (const tag of LEAD_OPTIONAL_TAGS) { const drop = rng.next() < LEAD_DROP_PROB; if (drop && !LEAD_NEVER_DROP_TAGS.has(tag)) leadDropTags.add(tag); }
  for (const s of arrangement.sections) {
    activeRolesBySection[s.id] = activeRolesFor(band.style, s as Section, band.instrumentPool, leadDropTags); // ★ 密度弧 + lead-gating
  }

  // ★ intro 多样性:setup 段从【先行档】掷一个覆盖(roles + texture)→ 不再恒定 bass/pad 先行。
  //   rng 在 lead-gating 之后取 → 不扰 timbre/lead-drop;setup 的 lead-drop 决定被本覆盖取代(rng 序不变)。
  if (rng) {
    const arch = rng.pick(INTRO_ARCHETYPES);
    for (const s of arrangement.sections) {
      if (s.functionTag !== 'setup') continue;
      const roles = arch.roles.filter((r) => band.instrumentPool.includes(r));
      if (roles.length === 0) continue; // ∩lineup 空 → 保留密度弧默认(不强塞)
      activeRolesBySection[s.id] = roles;
      textureBySection[s.id] = arch.texture; // keys 档 = active(arpeggio)→ comp 真渲染
    }
  }

  const starts = phraseStartBeats(arrangement);
  const hookAnchorSlots: HookAnchorSlot[] = arrangement.phrases
    .filter((p) => p.skeletonRole === 'hook')
    .map((p): HookAnchorSlot => {
      // ★ 主 hook = functionTag 'hook'(跨风格:pop chorus / RNB call-response hook 都算)或 legacy hookPolicy 'main'。
      //   修:RNB hook 用 call-response → 原来 isMain=false 漏判,器配/让位层没把它当重心。
      const sec = sectionById[p.sectionId];
      const isMain = sec?.functionTag === 'hook' || sec?.hookPolicy === 'main';
      return {
        phraseId: p.id,
        beatSlot: starts[p.id],
        preferredRegister: registerByRole.lead,
        anchorRequired: isMain,
        segment: 'head',
        maxAccompanimentDensity: isMain ? 0.4 : 0.6,
      };
    });

  // ★ rich textureCase 段级下发(texture-switch 修复,第一期 = 非 LOFI):2 槽 low/high,
  //   按 role 分配(chorus/bridge→high,其余→low)→ verse↔verse 同、chorus↔chorus 同(repeatGroup 一致)、
  //   同曲 ≤2 核心、排除 delayed-entry(段级常驻不留洞)。LOFI/blues/default 空 → render 回退逐 span 老路。
  //   rng 在所有前置决策【之后】取(+2 draw)→ 不扰 timbre/lead/intro 确定性。
  // ★ 三期:LOFI 也纳入段级机制(LOFI 池 + 更高变化概率)→ 去掉 LOFI 的逐 span 乱切。
  const RICH_STYLE: Record<string, TextureStyleName> = { pop: 'POP', rnb: 'RNB', jazz: 'JAZZ', lofi: 'LOFI', acg: 'ACG' };
  const richTextureBySection: Record<string, string> = {};
  const richTextureSwitchBySection: Record<string, { atFraction: number; toTexture: string }> = {};
  const richStyle = RICH_STYLE[band.style.toLowerCase()];
  if (rng && richStyle) {
    // ★ #6:低槽(非 chorus/bridge 段,各风格通用)/高槽(chorus·bridge)若【任一所属段是属链】→ 避让
    //   ambient/pedal 织体(否则糊在属动机上)。pickTextureForBarWithGroove 仍只掷一次 → rng 序列不变,只换更合适织体。
    // ★ Phase E §3.7:texture 选择消费 arranger 下发的 GrooveContract(preferred/allowed/forbidden + density/grid)→
    //   选中织体契合 groove(POP/JAZZ/RNB/LOFI/ACG);ACG 天然限制在 spacious 集。legacy contract 无偏好 → uniform=旧行为。
    const grooveContract = arrangement.songGrooveContract;
    const isHigh = (r: string) => r === 'chorus' || r === 'bridge';
    const lowDom = arrangement.sections.some((s) => !isHigh(s.role) && sectionIsDominantChain(harmonic, s.id));
    const highDom = arrangement.sections.some((s) => isHigh(s.role) && sectionIsDominantChain(harmonic, s.id));
    const low = pickTextureForBarWithGroove({ style: richStyle, phraseRole: 'establish', density: densityForCell('establish', 'VERSE'), energy: energyForCell('establish', 'VERSE'), isDominantChain: lowDom, contract: grooveContract, exclude: DELAYED_ENTRY_TEXTURES, random: rng });
    const high = pickTextureForBarWithGroove({ style: richStyle, phraseRole: 'lift', density: densityForCell('lift', 'CHORUS'), energy: energyForCell('lift', 'CHORUS'), isDominantChain: highDom, contract: grooveContract, exclude: DELAYED_ENTRY_TEXTURES, random: rng });
    const lowTc = low?.textureCase ?? high?.textureCase;
    const highTc = high?.textureCase ?? lowTc;
    for (const s of arrangement.sections) {
      const tc = (s.role === 'chorus' || s.role === 'bridge') ? highTc : lowTc;
      if (tc) richTextureBySection[s.id] = tc;
    }

    // ★ verse 段内受控变化(≤2/段):低概率,中段切到【兼容连续 ≠base】变体;所有 verse 段一致(repeatGroup)。
    //   只切 rate='allow'(连续兼容,无需 bridge)→ 段内不留洞。rng 在 low/high 之后取(不扰前置)。
    if (lowTc && rng.next() < (VERSE_VARIATION_PROB[richStyle] ?? 0.35)) {
      const variant = pickTextureForBarWithGroove({
        style: richStyle, phraseRole: 'develop', density: densityForCell('develop', 'VERSE'), energy: energyForCell('develop', 'VERSE'),
        isDominantChain: false, contract: grooveContract, exclude: new Set([...DELAYED_ENTRY_TEXTURES, lowTc]), random: rng,
      });
      const vtc = variant?.textureCase;
      if (vtc && rateTextureTransition(lowTc, vtc).rating === 'allow') {
        for (const s of arrangement.sections) if (s.role === 'verse') richTextureSwitchBySection[s.id] = { atFraction: 0.5, toTexture: vtc };
      }
    }
  }

  // ★ 鼓型变体匹配(器配层,2026-06-08):Arranger 已按段下发 GrooveKind(arrangement.grooveBySection)。
  //   这里按 (style × groove) 从 KB 词汇确定性挑【一个变体】→ drumPatternBySection。
  //   repeatGroup 一致:同 grooveKind → 同变体(per-song 掷一次,所有同 groove 段共用)→ verse1≡verse2。
  //   rng 在所有前置决策【之后】取(append 在序列尾)→ 不扰 timbre/lead/intro/richTexture 既有序列(bit 不变)。
  //   无 rng → 变体 0(确定性,向后兼容)。
  const GROOVE_KINDS: readonly GrooveKind[] = ['sparse', 'laidback', 'straight', 'driving'];
  const variantByGroove: Partial<Record<GrooveKind, number>> = {};
  for (const gk of GROOVE_KINDS) {
    const n = drumGrooveVariants(band.style, gk).length;
    variantByGroove[gk] = rng && n > 1 ? rng.int(n) : 0;
  }
  const drumPatternBySection: Record<string, DrumHit[]> = {};
  for (const s of arrangement.sections) {
    const gk = (arrangement.grooveBySection[s.id] ?? 'straight') as GrooveKind;
    const variants = drumGrooveVariants(band.style, gk);
    drumPatternBySection[s.id] = variants[variantByGroove[gk] ?? 0] ?? variants[0];
  }

  // ★ Loop D(2026-06-08):lineup-aware 修复 —— floating / 收尾(outro/tag/setup)段若【pad 不在场】但 lineup 有 comp,
  //   则 comp 必须 active(和声托底)。把"无 pad 编制下谁铺和声"的授权放器配层(activeRolesBySection),
  //   不靠 render fallback 偷渲染再被 gateByDensity 删(directive §1.2/D.2)。在 transitionPlan/endingPlan 之前修。
  for (const s of arrangement.sections) {
    const roles = activeRolesBySection[s.id];
    if (!roles || roles.includes('pad') || roles.includes('comp') || !band.instrumentPool.includes('comp')) continue;
    const floating = GENERIC_TEXTURE_YIELD[textureBySection[s.id]] === 'floating';
    const isEnding = s.functionTag === 'outro' || s.functionTag === 'tag' || s.functionTag === 'setup';
    if (floating || isEnding) roles.push('comp');
  }

  // ★ ESP32 混音(esp32s2_gm128_instrument_mix_directive):据 style+timbreWorld+role+【每段生效 program】算
  //   CC7/10/91/93。activeRolesBySection 已终态(Loop D 后)→ 关系型护栏知道"该段 pad 是否唯一和声"。确定性。
  const hasPad = band.instrumentPool.includes('pad');
  const spaceProfile = pickSpaceProfile(band.style, timbreWorld, hasPad);
  const mixByRoleSection = {} as Record<InstrumentRoleName, Record<string, RoleMix>>;
  for (const role of band.instrumentPool) {
    mixByRoleSection[role] = {};
    for (const s of arrangement.sections) {
      mixByRoleSection[role][s.id] = mixForProgram({ style: band.style, timbreWorld, role, program: programByRoleSection[role][s.id], hasPad, space: spaceProfile });
    }
  }
  // 关系型护栏(逐段:pad vs comp 混响差/响度/声像距离;该段无 comp 在场 → pad 是唯一和声,不压其响度)。
  for (const s of arrangement.sections) {
    const padOnlyHarmony = !((activeRolesBySection[s.id] as readonly InstrumentRoleName[] | undefined)?.includes('comp'));
    const sec: Partial<Record<InstrumentRoleName, RoleMix>> = {};
    for (const role of band.instrumentPool) sec[role] = mixByRoleSection[role]?.[s.id];
    const fixed = enforceRelationalMix(sec, { padIsOnlyHarmony: padOnlyHarmony });
    for (const role of band.instrumentPool) if (fixed[role] && mixByRoleSection[role]) mixByRoleSection[role][s.id] = fixed[role]!;
  }

  // ★ ACG:lead/comp 是同一键盘式前景空间。即便音色在 piano/FM/vibes/kalimba 间变化,
  //   也统一 reverb/chorus/pan,只保留 volume 差异(melody-first:lead 响、comp 是空气)。
  if (band.style.toLowerCase() === 'acg') {
    for (const s of arrangement.sections) {
      const compMix = mixByRoleSection.comp?.[s.id];
      if (!compMix) continue;
      for (const role of ['lead', 'comp'] as const) {
        const m = mixByRoleSection[role]?.[s.id];
        if (m) mixByRoleSection[role][s.id] = { ...m, reverb: compMix.reverb, chorus: compMix.chorus, pan: 64 };
      }
    }
  }

  const data: InstrumentationPlanData = {
    activityBySection,
    activeRolesBySection,
    registerByRole,
    textureBySection,
    richTextureBySection,
    richTextureSwitchBySection,
    textureYieldPolicy: GENERIC_TEXTURE_YIELD,
    roleProgram, // ★ 生效基底 program(链式协同 + repair 后)→ render 单一真源
    orchestrationChain: {
      world: orch.world, profileId: orch.profileId,
      compProgram: roleProgram.comp, leadProgram: roleProgram.lead, bassProgram: roleProgram.bass,
      padProgram: roleProgram.pad, drumProgram: roleProgram.drum,
      decisions: aura25Decisions.length ? [...orch.decisions, ...aura25Decisions] : orch.decisions,
    },
    programByRoleSection,
    mixByRoleSection, // ★ ESP32 混音(CC7/10/91/93;随段程序变)
    spaceProfile,
    gestureExpressionByRole,
    drumPatternBySection,
    timbreWorld,
    sameInstrumentPairs: samePairs.length ? samePairs : undefined,
    melodyReservationPlan: {
      reservedRegister: registerByRole.lead,
      densityCeiling: clamp01(band.styleProfile.accompDensity),
      hookAnchorSlots,
    },
    endingPlan: buildEndingPlan(arrangement.endingStyle as EndingStyle, arrangement.sections,
      activeRolesBySection[arrangement.sections[arrangement.sections.length - 1]?.id] ?? band.instrumentPool),
    transitionPlan: buildTransitionPlan(arrangement, activeRolesBySection, band.instrumentPool),
    needsDownbeatCompAnchorBySection: Object.fromEntries(arrangement.sections.map((s) => {
      const roles = activeRolesBySection[s.id] ?? [];
      return [s.id, roles.includes('comp') && !roles.includes('pad')]; // comp 唯一和声支撑(无 pad)
    })),
  };

  return freezeInstrumentationPlan(data);
}
