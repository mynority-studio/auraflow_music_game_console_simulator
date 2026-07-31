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
import type { ArrangementPlan, OpeningTextureEntry, Section, SectionFunctionTag } from '../arranger/ArrangementPlan';
import { beatsPerBarOf, phraseStartBeats } from '../arranger/phraseTiming';
import { pickGenericTexture, GENERIC_TEXTURE_YIELD, pickTextureForBarWithGroove, densityForCell, energyForCell, rateTextureTransition, DELAYED_ENTRY_TEXTURES, TEXTURE_POOL, type GrooveTextureContract, type PhraseCellRole, type TextureSectionRole, type TextureStyleName } from '../knowledge/textureProfiles';
import { sameFamilyAlternates, isKeyboardFamily, classifyTimbreWorld, repairWorldMismatches, sameInstrumentPairs, coherentLeadComp, repairCompCapability, enforceRoleFamilies, preferredRegisterForRole, dream5504OrchestrationBank } from '../knowledge/instruments';
import {
  chooseEnsembleWorld,
  ensembleAllowsRoleProgram,
  orchestrateRolePrograms,
} from '../knowledge/gmOrchestrationChains';
import { pickSpaceProfile, mixForProgram, enforceRelationalMix, isDream5504DryBaselineStyle, type RoleMix } from '../knowledge/gmMixProfile';
import {
  drumGrooveVariants,
  drumPerformanceVariants,
  lofiAuxiliaryTopLoopById,
  lofiDrumPhraseById,
  type DrumHit,
  type GrooveKind,
} from '../knowledge/grooves';
import { ACG_PIANOSONG_PIANO_VOICES, DREAM5504_TARGET_ID, gmbkVoiceLabel, isAcousticPianoVoice, mapProgramToDream5504, mapRoleProgramsToDream5504, selectGMBK5X128Voice, type AcgPianoSongVoice, type GM128VoiceSelection } from '../../../sound/GMBK5X128Voices';
import { buildGestureExpressionByRole } from './gestureExpression';
import {
  ACTIVE_DREAM_ORCHESTRATION_PALETTE,
  applyAcousticDebugPalette,
  type DreamOrchestrationPaletteId,
} from './acousticDebugPalette';
import { dreamVoiceCcProfile, hasDocumentedPedal, mayEmitAutomaticCc } from './dreamCcCapabilities';
import {
  DREAM5504_DRUM_KIT_COUNT,
  DREAM5504_MODERN_MELODIC_VOICE_COUNT,
  DREAM5504_MT32_COMPATIBILITY_VOICE_COUNT,
  DREAM5504_VOICE_FAMILY_COUNTS,
  dreamVoiceProfileFor,
  type DreamVoiceProfile,
} from './dreamVoiceProfiles';
import {
  freezeInstrumentationPlan,
  type BoundaryGesturePlan,
  type EndingPlan,
  type HookAnchorSlot,
  type InstrumentationPlan,
  type InstrumentationPlanData,
  type ControllerBeatEvent,
  type RegisterRange,
  type PedalBeatEvent,
  type RoleControllerPlan,
  type RolePedalPlan,
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

function isFastKeyboardMotion(motion: string | undefined): boolean {
  return motion === 'sixteenth-ostinato' || motion === 'syncopated-comp' || motion === 'percussive';
}

function isPedalKeyboardMotion(motion: string | undefined): boolean {
  return motion === 'lyrical' || motion === 'broken-chord';
}

function pedalPlanForRole(args: {
  role: InstrumentRoleName;
  arrangement: ArrangementPlan;
  harmonic?: HarmonicPlan;
  programByRoleSection: Record<InstrumentRoleName, Record<string, number>>;
  bankByRoleSection: Record<InstrumentRoleName, Record<string, number | undefined>>;
  activeRolesBySection: Record<string, readonly InstrumentRoleName[]>;
  sharedPianoMotionRole?: InstrumentRoleName;
  playerGroup?: 'shared-piano';
  scoreOwnsTiming?: boolean;
}): RolePedalPlan {
  const { role, arrangement, harmonic, programByRoleSection, bankByRoleSection, activeRolesBySection, sharedPianoMotionRole, playerGroup, scoreOwnsTiming = false } = args;
  const disabledBySection: RolePedalPlan['disabledBySection'] = {};
  const events: PedalBeatEvent[] = [];
  const authorizedSectionIds: string[] = [];
  const motionRole = sharedPianoMotionRole ?? role;

  for (const section of arrangement.sections) {
    const sectionId = section.id;
    const program = programByRoleSection[role]?.[sectionId];
    const motion = arrangement.rolePerformanceBySection[motionRole]?.[sectionId]?.keyboardMotion;
    if (!(activeRolesBySection[sectionId] ?? []).includes(role) && !scoreOwnsTiming) {
      disabledBySection[sectionId] = 'inactive';
      continue;
    }
    if (role === 'bass' && !playerGroup) {
      disabledBySection[sectionId] = 'independent-piano-bass';
      continue;
    }
    const capability = dreamVoiceCcProfile({ bank: bankByRoleSection[role]?.[sectionId], program: program ?? -1, role });
    if (!hasDocumentedPedal(capability)) {
      disabledBySection[sectionId] = 'non-piano-voice';
      continue;
    }
    // ACG's fast-run exception belongs to a concrete local score gesture,
    // never to a coarse whole-section keyboardMotion label.
    if (isFastKeyboardMotion(motion) && !scoreOwnsTiming) {
      disabledBySection[sectionId] = 'fast-keyboard-motion';
      continue;
    }
    if (!harmonic || (!scoreOwnsTiming && !isPedalKeyboardMotion(motion))) continue;

    if (scoreOwnsTiming) {
      if (harmonic.chordTimeline.some((chord) => chord.sectionId === sectionId)) {
        authorizedSectionIds.push(sectionId);
      }
      continue;
    }

    for (const chord of harmonic.chordTimeline) {
      if (chord.sectionId !== sectionId) continue;
      const start = chord.startBeat as number;
      const end = start + (chord.durationBeats as number);
      // No invented millisecond lift: release exactly at the harmony boundary.
      // MidiScheduler guarantees CC64-off before CC64-on/noteOn on that tick.
      events.push({ atBeat: start, down: true, sectionId, reason: playerGroup ? 'shared-piano' : 'piano-harmony' });
      events.push({ atBeat: end, down: false, sectionId, reason: playerGroup ? 'shared-piano' : 'piano-harmony' });
    }
  }

  events.sort((a, b) => a.atBeat - b.atBeat || Number(a.down) - Number(b.down));
  return {
    role,
    playerGroup,
    timingOwner: scoreOwnsTiming ? 'arranger-piano-score' : 'instrumentation',
    ...(scoreOwnsTiming ? { authorizedSectionIds } : {}),
    events,
    disabledBySection,
  };
}

function buildPedalPlanByRole(args: {
  style: string;
  lineup: readonly InstrumentRoleName[];
  arrangement: ArrangementPlan;
  harmonic?: HarmonicPlan;
  programByRoleSection: Record<InstrumentRoleName, Record<string, number>>;
  bankByRoleSection: Record<InstrumentRoleName, Record<string, number | undefined>>;
  activeRolesBySection: Record<string, readonly InstrumentRoleName[]>;
  sharedPianoRoles?: readonly InstrumentRoleName[];
}): Partial<Record<InstrumentRoleName, RolePedalPlan>> {
  const { style, lineup, arrangement, harmonic, programByRoleSection, bankByRoleSection, activeRolesBySection, sharedPianoRoles } = args;
  const out: Partial<Record<InstrumentRoleName, RolePedalPlan>> = {};
  const sharedGroup = sharedPianoRoles
    ?? (style.toLowerCase() === 'acg' && ACG_PIANO_ROLES.every((role) => lineup.includes(role)) ? ACG_PIANO_ROLES : undefined);

  if (sharedGroup) {
    for (const role of sharedGroup) {
      if (!lineup.includes(role)) continue;
      out[role] = pedalPlanForRole({
        role,
        arrangement,
        harmonic,
        programByRoleSection,
        bankByRoleSection,
        activeRolesBySection,
        sharedPianoMotionRole: 'comp',
        playerGroup: 'shared-piano',
        scoreOwnsTiming: style.toLowerCase() === 'acg',
      });
    }
  }

  // A keyboard lead can be lyrical, but an independent piano bass is dry by
  // contract. Non-keyboard programs are rejected by the capability registry.
  for (const role of ['comp', 'lead', 'bass'] as const) {
    if (sharedGroup?.includes(role)) continue;
    if (!lineup.includes(role)) continue;
    out[role] = pedalPlanForRole({ role, arrangement, harmonic, programByRoleSection, bankByRoleSection, activeRolesBySection });
  }
  return out;
}

const PIANO_EXPRESSION_CC = 11;

// The uploaded Merry Go Round MIDI uses 70/80/90/100 as its recurring CC11
// plateaus. We keep that proven low-rate vocabulary and let Arranger's
// keyboardMotion choose phrase-level or bar-level expression; never per-note.
const PIANO_EXPRESSION_BY_STYLE: Record<string, Partial<Record<string, number>>> = {
  pop: { setup: 80, story: 90, build: 100, hook: 100, breakdown: 80, outro: 70 },
  jazz: { setup: 90, story: 90, build: 100, hook: 100, breakdown: 80, outro: 70 },
  lofi: { setup: 80, loop: 80, build: 90, hook: 90, breakdown: 70, outro: 70 },
  rnb: { setup: 80, story: 90, build: 100, hook: 100, breakdown: 80, outro: 70 },
  acg: { setup: 80, story: 90, build: 100, hook: 100, breakdown: 80, outro: 70 },
};

function pianoExpressionValue(style: string, sectionRole: string): number {
  const byStyle = PIANO_EXPRESSION_BY_STYLE[style.toLowerCase()] ?? PIANO_EXPRESSION_BY_STYLE.pop!;
  return byStyle[sectionRole] ?? byStyle.story ?? 90;
}

/**
 * CC11 is a channel-level dynamic, not a replacement for velocity. Lyrical
 * piano uses one phrase plateau plus its explicit CC64 plan. Rhythmic piano
 * has no CC64 plan and receives one low-rate CC11 plateau per bar instead,
 * so dense sixteenth/syncopated attacks remain dry and legible on Dream 5504.
 */
function buildControllerPlanByRole(args: {
  style: string;
  lineup: readonly InstrumentRoleName[];
  arrangement: ArrangementPlan;
  activeRolesBySection: Record<string, readonly InstrumentRoleName[]>;
  voiceProfileByRoleSection: Record<InstrumentRoleName, Record<string, DreamVoiceProfile>>;
}): Partial<Record<InstrumentRoleName, RoleControllerPlan>> {
  const { style, lineup, arrangement, activeRolesBySection, voiceProfileByRoleSection } = args;
  const out: Partial<Record<InstrumentRoleName, RoleControllerPlan>> = {};
  const beatsPerBar = beatsPerBarOf(arrangement.meter);
  for (const role of ['lead', 'comp', 'bass'] as const) {
    if (!lineup.includes(role)) continue;
    const events: ControllerBeatEvent[] = [];
    const disabledBySection: RoleControllerPlan['disabledBySection'] = {};
    let sectionStart = 0;
    for (const section of arrangement.sections) {
      const sectionEnd = sectionStart + section.bars * beatsPerBar;
      if (!(activeRolesBySection[section.id] ?? []).includes(role)) {
        disabledBySection[section.id] = 'inactive';
      } else {
        const voice = voiceProfileByRoleSection[role]?.[section.id];
        const capability = voice
          ? dreamVoiceCcProfile({ ...voice.address, role })
          : undefined;
        if (!voice || !isAcousticPianoVoice(voice.address.bank, voice.address.program)) {
          disabledBySection[section.id] = 'non-piano-voice';
        } else if (!capability || !mayEmitAutomaticCc(capability, PIANO_EXPRESSION_CC)) {
          disabledBySection[section.id] = 'unsupported-voice';
        } else {
          const motion = arrangement.rolePerformanceBySection[role]?.[section.id]?.keyboardMotion;
          const baseValue = pianoExpressionValue(style, section.role);
          if (isFastKeyboardMotion(motion)) {
            for (let bar = 0; bar < section.bars; bar++) {
              // Alternate only between verified phrase plateaus. The lower
              // odd bar is a tiny hand/breath release, not a fake tremolo.
              const value = bar % 2 === 0 ? baseValue : Math.max(70, baseValue - 10);
              events.push({
                atBeat: sectionStart + bar * beatsPerBar,
                controller: PIANO_EXPRESSION_CC,
                value,
                sectionId: section.id,
                reason: 'piano-motion-expression',
              });
            }
          } else {
            events.push({
              atBeat: sectionStart,
              controller: PIANO_EXPRESSION_CC,
              value: baseValue,
              sectionId: section.id,
              reason: 'piano-phrase-expression',
            });
          }
        }
      }
      sectionStart = sectionEnd;
    }
    if (events.length > 0) out[role] = { role, events, disabledBySection };
  }
  return out;
}

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
    loop: ['bass', 'comp', 'drum', 'lead'],
    headOut: ['bass', 'comp', 'drum', 'lead'],
    tag: ['comp', 'bass', 'lead'],
  },
  // ACG PIANOSONG:一架钢琴的三层手型始终完整——左手低根、右手中部琶音、可选顶声部。
  // 留白由 lead/comp 的 phrase 手势产生，不能靠抽掉 bass；否则和声重力会在主题/尾声消失。
  acg: {
    setup: ['bass', 'comp'],
    head: ['bass', 'comp', 'lead'],
    build: ['bass', 'comp', 'lead'],
    headOut: ['bass', 'comp', 'lead'],
    tag: ['bass', 'comp', 'lead'],
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

/** OpeningGesture 的音色化描述投影到既有 GenericTextureKind 真源，不另建 texture scheduler。 */
const OPENING_TEXTURE_TO_GENERIC: Record<Exclude<OpeningTextureEntry, 'none'>, TextureKind> = {
  pianoRiff: 'arpeggio',
  rhodesDust: 'arpeggio',
  padSwell: 'pad',
  stringOstinato: 'arpeggio',
  synthPulse: 'active-comp',
  guitarMute: 'active-comp',
  bellMotif: 'arpeggio',
  vinylNoise: 'pad',
};

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
const ACG_PIANO_ROLES: readonly InstrumentRoleName[] = ['lead', 'comp', 'bass'];
const POP_BALLAD_CONTRACT_ID = 'pop_ballad_halftime';

function popBalladTextureTag(section: Section): SectionFunctionTag {
  if (section.functionTag) return section.functionTag;
  if (section.role === 'intro') return 'setup';
  if (section.role === 'chorus') return 'hook';
  if (section.role === 'bridge') return 'breakdown';
  if (section.role === 'outro') return 'outro';
  return 'story';
}

function applyPopBalladVideoTextureArc(args: {
  arrangement: ArrangementPlan;
  richTextureBySection: Record<string, string>;
  richTextureSwitchBySection: Record<string, { atFraction: number; toTexture: string }>;
}): void {
  if (args.arrangement.songGrooveContractId !== POP_BALLAD_CONTRACT_ID) return;
  for (const section of args.arrangement.sections) {
    const contract = args.arrangement.grooveContractBySection?.[section.id] ?? args.arrangement.songGrooveContract;
    if (contract.id !== POP_BALLAD_CONTRACT_ID) continue;
    delete args.richTextureSwitchBySection[section.id];
    switch (popBalladTextureTag(section as Section)) {
      case 'setup':
        args.richTextureBySection[section.id] = 'Lyrical_Felt_Piano_Sparse';
        args.richTextureSwitchBySection[section.id] = { atFraction: 0.5, toTexture: 'Ambient_Pad_Breath' };
        break;
      case 'story':
        args.richTextureBySection[section.id] = 'Lyrical_Felt_Piano_Sparse';
        args.richTextureSwitchBySection[section.id] = { atFraction: 0.5, toTexture: 'Soft_Guitar_Pluck_8ths' };
        break;
      case 'build':
        args.richTextureBySection[section.id] = 'Lyrical_10th_Broken';
        args.richTextureSwitchBySection[section.id] = { atFraction: 0.7, toTexture: 'Ambient_Reverse_Swell' };
        break;
      case 'hook':
      case 'headOut':
        args.richTextureBySection[section.id] = 'Piano_Wide_Color_Motion';
        args.richTextureSwitchBySection[section.id] = { atFraction: 0.62, toTexture: 'Pop_Ballad_158_Sweep' };
        break;
      case 'breakdown':
      case 'solo':
        args.richTextureBySection[section.id] = 'Ambient_Pad_Breath';
        args.richTextureSwitchBySection[section.id] = { atFraction: 0.5, toTexture: 'Piano_Question_Answer' };
        break;
      case 'tag':
      case 'outro':
        args.richTextureBySection[section.id] = 'Low_Pedal_Color_Wash';
        break;
      default:
        args.richTextureBySection[section.id] = 'Lyrical_Felt_Piano_Sparse';
        break;
    }
  }
}

function firstContrastingTextureCase(args: {
  style: TextureStyleName;
  phraseRole: PhraseCellRole;
  density: number;
  energy: number;
  isDominantChain: boolean;
  contract?: GrooveTextureContract;
  exclude?: ReadonlySet<string>;
}): string | undefined {
  const allowed = (textureCase: string): boolean =>
    (!args.exclude?.has(textureCase))
    && (!args.contract?.allowedTextureCases || args.contract.allowedTextureCases.includes(textureCase))
    && !args.contract?.forbiddenTextureCases?.includes(textureCase);
  const candidates = TEXTURE_POOL.filter((texture) => {
    if (!allowed(texture.textureCase)) return false;
    if (!texture.styles.includes(args.style)) return false;
    if (!texture.phraseRoles.includes(args.phraseRole)) return false;
    if (args.density < texture.densityRange[0] || args.density > texture.densityRange[1]) return false;
    if (args.energy < texture.energyRange[0] || args.energy > texture.energyRange[1]) return false;
    if (texture.avoidOnDominantChain && args.isDominantChain) return false;
    return true;
  });
  const byCase = new Map(candidates.map((texture) => [texture.textureCase, texture]));
  for (const textureCase of args.contract?.preferredTextureCases ?? []) {
    if (byCase.has(textureCase)) return textureCase;
  }
  return candidates[0]?.textureCase;
}

/** ACG 用独立随机子流按权重挑一架琴；无子流时回退默认大钢琴，保住直接调用的兼容性。 */
function pickAcgPianoSongVoice(rng?: Rng): AcgPianoSongVoice {
  if (!rng) return ACG_PIANOSONG_PIANO_VOICES[0];
  const total = ACG_PIANOSONG_PIANO_VOICES.reduce((sum, voice) => sum + voice.weight, 0);
  let remaining = rng.next() * total;
  for (const voice of ACG_PIANOSONG_PIANO_VOICES) {
    remaining -= voice.weight;
    if (remaining < 0) return voice;
  }
  return ACG_PIANOSONG_PIANO_VOICES[ACG_PIANOSONG_PIANO_VOICES.length - 1];
}

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
    const pickupRoles = entry === 'lead-in'
      ? PICKUP_PREF.filter((r) => {
        if (!toActive.has(r) || !has(r)) return false;
        const roleEntryMode = arrangement.rolePerformanceBySection?.[r]?.[to.id]?.entryMode;
        // Arranger 明确写 downbeat/delayed 的新角色不能偷跑到上一段；旧 fixture
        // 缺 role contract 时保留历史 lead-in 行为。
        return roleEntryMode === undefined || roleEntryMode === 'pickup' || fromActive.has(r);
      })
      : [];
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
  acgPianoRng?: Rng, // ACG 整首钢琴 CC0+PC；独立子流，扩充调色板不扰既有 timbre/texture 结果
  orchestrationPalette: DreamOrchestrationPaletteId = ACTIVE_DREAM_ORCHESTRATION_PALETTE,
): InstrumentationPlan {
  // ★ 音色世界统一性:先把 BandEngine 的 provisional roleProgram 过【风格错配修复】(当前池已守住=多为原样,
  //   family-invariant → comp voicing 决策不受影响),再【lead↔comp 配对一致性】修不搭对(电钢配电钢、
  //   马林巴解绑电钢),最后分类世界 + 记同乐器对。GM program 仍走 programByRoleSection。
  //   ★ 2026-06-10:链中加【comp 能力修复】—— comp 必须是多音 + 非持续乐器(单音/持续如管风琴不能做衰减节奏 comp);
  //     先修 comp 能力,再 lead↔comp 配对(lead 贴到已合法的 comp)。
  // ★ 链式协同(gm128_chain_orchestration,2026-06-10):器配层【拥有】最终 GM 选择 —— 用 BandEngine 的
  //   provisional(band.roleProgram,已 seed-变化)当候选,先定真实乐队模板、再按 comp→lead→bass→pad 收敛。
  //   模板只读既有候选和 Arranger groove 合同,不抽 rng、不洗 timbre/grammar/texture 子流；鼓 kit 继续由
  //   songGrooveContract 独占主权。然后过既有安全网(repairWorld/repairCompCapability/coherentLeadComp)。
  const ensembleWorld = arrangement.resolvedArchetype?.instrumentationEnsembleId
    ?? chooseEnsembleWorld(band.style, band.roleProgram, arrangement.songGrooveContractId);
  const orch = orchestrateRolePrograms({
    style: band.style,
    lineup: band.instrumentPool,
    rng,
    provisional: band.roleProgram,
    ensembleWorld,
    drumKitProgram: arrangement.songGrooveContract.drum?.kitProgram,
  });
  const sharedPianoRoles = band.style.toLowerCase() === 'acg'
    || !!orch.sharedInstrumentRoleGroups?.some((roles) =>
      roles.includes('lead') && roles.includes('comp'))
    || !!arrangement.resolvedArchetype?.sharedInstrumentRoleGroups?.some((roles) =>
      roles.includes('lead') && roles.includes('comp'));
  // ★ participant 家族守卫(P1/P2 修复):orchestration/repair 后,把 Band Selection 的乐手家族约束
  //   闭环到【最终发声 program】—— 选了合成氛围(pad)/键盘手(keyboard)等,最终音色一定在该家族内。
  const repairedRoleProgram = enforceRoleFamilies(
    coherentLeadComp(
      repairCompCapability(repairWorldMismatches(orch.roleProgram, band.style), band.style),
      band.style,
      sharedPianoRoles,
    ),
    band.familyByRole, band.style,
  );
  // Arranger 可声明“编制模板音色锁定”：participant 仍决定职责归属/在场范围，但通用家族守卫
  // 不得在模板兑现之后把它换成另一件乐器。Instrumental 只执行合同，不识别任何 style/archetype id。
  if (arrangement.resolvedArchetype?.instrumentationVoicePolicy === 'ensemble-locked') {
    for (const role of band.instrumentPool) {
      if (orch.roleProgram[role] !== undefined) {
        repairedRoleProgram[role] = orch.roleProgram[role];
      }
    }
  }
  let roleProgram = { ...mapRoleProgramsToDream5504(repairedRoleProgram, band.style) } as Record<InstrumentRoleName, number>;
  let paletteBankByRole: Partial<Record<InstrumentRoleName, number>> = {};
  let paletteSharedPianoRoles: readonly InstrumentRoleName[] | undefined;
  const dream5504Decisions = band.instrumentPool
    .filter((role) => repairedRoleProgram[role] !== undefined && repairedRoleProgram[role] !== roleProgram[role])
    .map((role) => `${role} Dream5504 PC${repairedRoleProgram[role]}→PC${roleProgram[role]}`);
  const isAcgPianoSong = band.style.toLowerCase() === 'acg';
  let acgPianoVoice = isAcgPianoSong ? pickAcgPianoSongVoice(acgPianoRng) : undefined;
  if (acgPianoVoice) {
    for (const role of ACG_PIANO_ROLES) if (band.instrumentPool.includes(role)) roleProgram[role] = acgPianoVoice.program;
  }
  if (orchestrationPalette === 'acoustic-debug') {
    const acousticDebug = applyAcousticDebugPalette({
      style: band.style,
      lineup: band.instrumentPool,
      provisional: band.roleProgram,
      requestedDrumProgram: arrangement.songGrooveContract.drum?.kitProgram,
      instrumentationIntent: arrangement.acousticInstrumentationIntent,
      palette: orchestrationPalette,
    });
    roleProgram = { ...roleProgram, ...acousticDebug.roleProgram };
    paletteBankByRole = acousticDebug.roleBank;
    paletteSharedPianoRoles = acousticDebug.sharedPianoRoles;
    // The Arranger template decides whether several MIDI roles belong to one
    // physical piano. Non-shared acoustic templates retain independent roles.
    acgPianoVoice = undefined;
    dream5504Decisions.push(...acousticDebug.decisions);
  }
  const timbreWorld = classifyTimbreWorld(roleProgram, band.style);
  const samePairs = sameInstrumentPairs(roleProgram);
  const primaryVoiceByRole: Partial<Record<InstrumentRoleName, GM128VoiceSelection>> = {};
  const roleBank: Partial<Record<InstrumentRoleName, number>> = {};
  const voiceNameByRole: Partial<Record<InstrumentRoleName, string>> = {};
  const voiceProfileByRole: Partial<Record<InstrumentRoleName, DreamVoiceProfile>> = {};
  for (const role of band.instrumentPool) {
    const voice = selectGMBK5X128Voice({
      style: band.style,
      role,
      program: roleProgram[role],
      bank: paletteBankByRole[role]
        ?? (acgPianoVoice && ACG_PIANO_ROLES.includes(role)
          ? acgPianoVoice.bank
          : dream5504OrchestrationBank(band.style, role, roleProgram[role])),
      timbreWorld,
    });
    primaryVoiceByRole[role] = voice;
    if (voice.bank !== undefined) roleBank[role] = voice.bank;
    voiceNameByRole[role] = voice.name;
    const profile = dreamVoiceProfileFor({ bank: voice.bank, program: voice.program, role });
    if (!profile) throw new Error(`Dream 5504 automatic orchestration resolved an unclassified address: ${role} CC0=${voice.bank ?? 0} PC=${voice.program}`);
    voiceProfileByRole[role] = profile;
  }
  const gmbkVoiceDecisions = band.instrumentPool
    .map((role) => {
      const voice = primaryVoiceByRole[role];
      return voice ? `${role} ${gmbkVoiceLabel(voice)}` : undefined;
    })
    .filter((line): line is string => !!line);
  const gestureExpressionByRole = buildGestureExpressionByRole(ALL_ROLES, roleProgram, band.style);
  // Arrangement-owned LOFI Comp has already written its key-release behavior
  // (finger overlap or documented damper) before NoteIR exists. Project that
  // ownership into InstrumentationPlan so the generic keyboard 0.9 gate does
  // not shorten the scored connection a second time.
  if (
    arrangement.lofiFoundationPlan?.compIntent.brokenChordTechnique === 'anchored-finger-legato'
    && gestureExpressionByRole.comp.kind === 'keyboard-touch'
  ) {
    gestureExpressionByRole.comp = {
      ...gestureExpressionByRole.comp,
      gateRatio: 1,
    };
  }
  const registerByRole = Object.fromEntries(
    ALL_ROLES.map((role) => {
      const ensembleRange = orch.registerByRole?.[role];
      return [role, ensembleRange ? rr(ensembleRange[0], ensembleRange[1]) : registerForRole(role, roleProgram[role])];
    }),
  ) as Record<InstrumentRoleName, RegisterRange>;
  const strictRegisterByRole = orch.registerByRole
    ? Object.fromEntries(Object.entries(orch.registerByRole).map(([role, range]) => [
      role,
      rr(range![0], range![1]),
    ])) as Partial<Record<InstrumentRoleName, RegisterRange>>
    : undefined;
  const leadRegisterLow = registerByRole.lead.lowMidi as number;
  const leadRegisterHigh = registerByRole.lead.highMidi as number;
  const melodyReservedRegister: RegisterRange = {
    // 编制明确写死职责音区时，旋律保留区必须与真实 Lead 地板一致；否则
    // 碰撞/让位层会把中区旋律误判为只存在于更高音区。
    lowMidi: strictRegisterByRole?.lead
      ? registerByRole.lead.lowMidi
      : midi(Math.min(Math.max(leadRegisterLow, 67), leadRegisterHigh)),
    highMidi: registerByRole.lead.highMidi,
  };

  const textureBySection: Record<string, TextureKind> = {};
  const activeRolesBySection: Record<string, InstrumentRoleName[]> = {};
  const sectionById: Record<string, Section> = {};

  for (const s of arrangement.sections) {
    sectionById[s.id] = s as Section;
    // 织体:functionTag 优先(A3),无则回退 legacy role(template/无 rng 段)。
    textureBySection[s.id] = s.functionTag ? TEXTURE_BY_FUNCTION[s.functionTag] : pickGenericTexture(s.role as TextureSectionRole);
  }

  // ★ 器配音色:每角色 × 每段落。默认全 primary;comp/lead 掷骰命中 → chorus 段换【同族】备选(段落对比)。
  //   ACG PIANOSONG 例外：三轨是同一架钢琴的分工，不在段间切 program/bank。
  //   repeatGroup 一致:按 section.role 决策 → 所有 chorus 段同备选、verse 段同 primary。确定性。
  // ★ 每首【掷一次骰】:命中 → 选一个【键盘族 comp/lead】乐手,chorus 换同族备选。最多一个乐手切。
  //   即使模板拒绝该备选，也照旧消费这次抽签、仅维持 primary，避免器配规则改变后续 texture/鼓型的 seed 流。
  const eligible = (isAcgPianoSong || orchestrationPalette === 'acoustic-debug' ? [] : band.instrumentPool).filter(
    (r) => TIMBRE_SWITCH_ROLES.includes(r) && isKeyboardFamily(roleProgram[r]) && sameFamilyAlternates(band.style, r, roleProgram[r]).length > 0,
  );
  let switchRole: InstrumentRoleName | undefined;
  let switchAlt: number | undefined;
  if (rng && eligible.length > 0 && rng.next() < TIMBRE_SWITCH_PROB) {
    switchRole = rng.pick(eligible);
    const alternate = rng.pick(sameFamilyAlternates(band.style, switchRole, roleProgram[switchRole]));
    if (ensembleAllowsRoleProgram(ensembleWorld, switchRole, alternate)) {
      switchAlt = mapProgramToDream5504(alternate, switchRole, band.style);
    } else {
      switchRole = undefined;
    }
  }
  const programByRoleSection: Record<InstrumentRoleName, Record<string, number>> = {} as Record<InstrumentRoleName, Record<string, number>>;
  const bankByRoleSection: Record<InstrumentRoleName, Record<string, number | undefined>> = {} as Record<InstrumentRoleName, Record<string, number | undefined>>;
  const voiceNameByRoleSection: Record<InstrumentRoleName, Record<string, string>> = {} as Record<InstrumentRoleName, Record<string, string>>;
  const voiceProfileByRoleSection: Record<InstrumentRoleName, Record<string, DreamVoiceProfile>> = {} as Record<InstrumentRoleName, Record<string, DreamVoiceProfile>>;
  for (const role of band.instrumentPool) {
    const primary = roleProgram[role];
    programByRoleSection[role] = {};
    bankByRoleSection[role] = {};
    voiceNameByRoleSection[role] = {};
    voiceProfileByRoleSection[role] = {};
    for (const s of arrangement.sections) {
      const selected = role === switchRole && switchAlt !== undefined && s.role === 'chorus' ? switchAlt : primary;
      const mapped = mapProgramToDream5504(selected, role, band.style);
      const voice = selectGMBK5X128Voice({
        style: band.style,
        role,
        program: mapped,
        bank: paletteBankByRole[role]
          ?? (acgPianoVoice && ACG_PIANO_ROLES.includes(role)
            ? acgPianoVoice.bank
            : dream5504OrchestrationBank(band.style, role, mapped)),
        timbreWorld,
      });
      programByRoleSection[role][s.id] = voice.program;
      bankByRoleSection[role][s.id] = voice.bank;
      voiceNameByRoleSection[role][s.id] = voice.name;
      const profile = dreamVoiceProfileFor({ bank: voice.bank, program: voice.program, role });
      if (!profile) throw new Error(`Dream 5504 section voice is not in the modern orchestration registry: ${role} CC0=${voice.bank ?? 0} PC=${voice.program}`);
      voiceProfileByRoleSection[role][s.id] = profile;
    }
  }

  // ★ A4 lead-gating(多样性):lead-optional 段(intro/breakdown/outro/tag)本曲掷骰 → 纯器乐 or 含 lead。
  //   rng 在 timbre 决策【之后】取 → 不扰 timbre 确定性。无 rng → 不 drop(lead 全程,向后兼容)。
  const leadDropTags = new Set<SectionFunctionTag>();
  if (rng) for (const tag of LEAD_OPTIONAL_TAGS) { const drop = rng.next() < LEAD_DROP_PROB; if (drop && !LEAD_NEVER_DROP_TAGS.has(tag)) leadDropTags.add(tag); }
  for (const s of arrangement.sections) {
    activeRolesBySection[s.id] = activeRolesFor(band.style, s as Section, band.instrumentPool, leadDropTags); // ★ 密度弧 + lead-gating
  }

  // 旧 intro-archetype 曾在此消费一次 timbre RNG。决策已由 Arranger openingGesture 独占；
  // 保留空抽取只为避免无关的后续 rich-texture/鼓型 seed 序列漂移。
  if (rng) rng.next();

  // OpeningGesture 是首段唯一的角色/织体意图：roleDelayBars 决定本段内实际会进入的 lineup 角色，
  // textureEntry 覆盖同一 textureBySection 真源；none 不写入，保留 functionTag 原计划。
  const firstSection = arrangement.sections[0];
  const openingTexture = arrangement.openingGesture.textureEntry;
  if (firstSection && arrangement.openingGesture.sectionId === firstSection.id) {
    const openingRoles = band.instrumentPool.filter((role) => {
      const delayBars = arrangement.openingGesture.roleDelayBars[role];
      return delayBars !== undefined && delayBars < firstSection.bars;
    });
    // ACG 的开头也必须先有左手低根，不能让通用 openingGesture 把 piano score
    // 拆成“孤立右手”。首小节延迟的最终豁免仍由 Arranger/gate 消费；这里先把
    // bass/comp 的在场合同明确下发给所有后续消费者。
    activeRolesBySection[firstSection.id] = isAcgPianoSong
      ? band.instrumentPool.filter((role) => openingRoles.includes(role) || role === 'bass' || role === 'comp')
      : openingRoles;
    if (openingTexture !== 'none') {
      textureBySection[firstSection.id] = OPENING_TEXTURE_TO_GENERIC[openingTexture];
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
        preferredRegister: melodyReservedRegister,
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
    const requiredCompMelodySpace = richStyle === 'LOFI'
      ? arrangement.lofiLeadBlueprintPlan?.requiredCompMelodySpace
      : undefined;
    const incompatibleLofiTextures = requiredCompMelodySpace && requiredCompMelodySpace !== 'any'
      ? TEXTURE_POOL
        .filter((texture) =>
          texture.styles.includes('LOFI')
          && texture.partPolicy?.melodySpace !== requiredCompMelodySpace)
        .map((texture) => texture.textureCase)
      : [];
    const baseTextureExclusions = new Set([
      ...DELAYED_ENTRY_TEXTURES,
      ...incompatibleLofiTextures,
    ]);
    // ★ #6:低槽(非 chorus/bridge 段,各风格通用)/高槽(chorus·bridge)若【任一所属段是属链】→ 避让
    //   ambient/pedal 织体(否则糊在属动机上)。pickTextureForBarWithGroove 仍只掷一次 → rng 序列不变,只换更合适织体。
    // ★ Phase E §3.7:texture 选择消费 arranger 下发的 GrooveContract(preferred/allowed/forbidden + density/grid)→
    //   选中织体契合 groove(POP/JAZZ/RNB/LOFI/ACG);ACG 天然限制在 spacious 集。legacy contract 无偏好 → uniform=旧行为。
    const isHigh = (r: string) => r === 'chorus' || r === 'bridge';
    const groups: Array<{
      contract: typeof arrangement.songGrooveContract;
      sections: typeof arrangement.sections[number][];
    }> = [];
    const groupByContractId = new Map<string, typeof groups[number]>();
    for (const section of arrangement.sections) {
      const contract = arrangement.grooveContractBySection?.[section.id] ?? arrangement.songGrooveContract;
      let group = groupByContractId.get(contract.id);
      if (!group) {
        group = { contract, sections: [] };
        groups.push(group);
        groupByContractId.set(contract.id, group);
      }
      group.sections.push(section);
    }
    const slotsByContractId = new Map<string, { lowTc?: string; highTc?: string }>();
    for (const group of groups) {
      const lowDom = group.sections.some((s) => !isHigh(s.role) && sectionIsDominantChain(harmonic, s.id));
      const highDom = group.sections.some((s) => isHigh(s.role) && sectionIsDominantChain(harmonic, s.id));
      const low = pickTextureForBarWithGroove({ style: richStyle, phraseRole: 'establish', density: densityForCell('establish', 'VERSE'), energy: energyForCell('establish', 'VERSE'), isDominantChain: lowDom, contract: group.contract, exclude: baseTextureExclusions, random: rng });
      const highDensity = densityForCell('lift', 'CHORUS');
      const highEnergy = energyForCell('lift', 'CHORUS');
      const high = pickTextureForBarWithGroove({ style: richStyle, phraseRole: 'lift', density: highDensity, energy: highEnergy, isDominantChain: highDom, contract: group.contract, exclude: baseTextureExclusions, random: rng });
      const lowTc = low?.textureCase ?? high?.textureCase;
      let highTc = high?.textureCase ?? lowTc;
      if (lowTc && highTc === lowTc) {
        highTc = firstContrastingTextureCase({
          style: richStyle,
          phraseRole: 'lift',
          density: highDensity,
          energy: highEnergy,
          isDominantChain: highDom,
          contract: group.contract,
          exclude: new Set([...baseTextureExclusions, lowTc]),
        }) ?? highTc;
      }
      slotsByContractId.set(group.contract.id, { lowTc, highTc });
      for (const section of group.sections) {
        const tc = isHigh(section.role) ? highTc : lowTc;
        if (tc) richTextureBySection[section.id] = tc;
      }
    }

    // ★ verse 段内受控变化(≤2/段):同一 GrooveContract 的 verse 共用兼容变体。
    //   单 contract 歌仍保持原 low/high/variation RNG 顺序。
    for (const group of groups) {
      const lowTc = slotsByContractId.get(group.contract.id)?.lowTc;
      if (!lowTc || rng.next() >= (VERSE_VARIATION_PROB[richStyle] ?? 0.35)) continue;
      const variant = pickTextureForBarWithGroove({
        style: richStyle, phraseRole: 'develop', density: densityForCell('develop', 'VERSE'), energy: energyForCell('develop', 'VERSE'),
        isDominantChain: false, contract: group.contract, exclude: new Set([...baseTextureExclusions, lowTc]), random: rng,
      });
      const vtc = variant?.textureCase;
      if (vtc && rateTextureTransition(lowTc, vtc).rating === 'allow') {
        for (const section of group.sections) {
          if (section.role === 'verse') richTextureSwitchBySection[section.id] = { atFraction: 0.5, toTexture: vtc };
        }
      }
    }

    applyPopBalladVideoTextureArc({ arrangement, richTextureBySection, richTextureSwitchBySection });
  }

  // ★ 鼓型变体匹配(器配层):Arranger 下发 DrumPerformanceContract = 鼓手总谱主权威。
  //   优先按 patternFamily 选 KB 鼓型族;缺失时回退 legacy style×groove。repeatGroup/functionTag 一致的段
  //   共用变体,避免 verse1/verse2 演奏法漂移;不同功能段可同族不同打法,让每首歌有鼓手"手法"而不是单 loop。
  const GROOVE_KINDS: readonly GrooveKind[] = ['sparse', 'laidback', 'straight', 'driving'];
  const variantByGroove: Partial<Record<GrooveKind, number>> = {};
  for (const gk of GROOVE_KINDS) {
    const n = drumGrooveVariants(band.style, gk).length;
    variantByGroove[gk] = rng && n > 1 ? rng.int(n) : 0;
  }
  const variantByPerformanceKey: Record<string, number> = {};
  const drumPatternBySection: Record<string, DrumHit[]> = {};
  const drumPatternBySectionBar: Record<string, DrumHit[][]> = {};
  for (const s of arrangement.sections) {
    const perf = arrangement.drumPerformanceBySection?.[s.id];
    if (perf) {
      const variants = drumPerformanceVariants(perf);
      const key = `${perf.patternFamily}:${s.repeatGroup ?? s.functionTag ?? s.role}:${perf.role}:${perf.complexity}`;
      if (variantByPerformanceKey[key] === undefined) {
        variantByPerformanceKey[key] = rng && variants.length > 1 ? rng.int(variants.length) : 0;
      }
      const baseVariant = variantByPerformanceKey[key] ?? 0;
      drumPatternBySection[s.id] = variants[baseVariant] ?? variants[0];
      const scoreBars = arrangement.grooveScorePlan?.bySection[s.id]?.bars;
      const arrangerPhrasePatterns = scoreBars?.map((bar) => {
        const phrase = lofiDrumPhraseById(bar.drumPhraseId);
        if (!phrase || bar.drumPhraseBarIndex === undefined) return undefined;
        const core = bar.drumPhraseRole === 'turnaround'
          ? phrase.turnaroundBar
          : phrase.bars[bar.drumPhraseBarIndex];
        const topLoop = lofiAuxiliaryTopLoopById(bar.drumTopLoopId);
        const top = topLoop && bar.drumTopLoopBarIndex !== undefined
          ? topLoop.bars[bar.drumTopLoopBarIndex]
          : [];
        return [...core, ...top].map((hit) => ({ ...hit }));
      });
      if (arrangerPhrasePatterns?.some((pattern) => pattern !== undefined)) {
        drumPatternBySectionBar[s.id] = arrangerPhrasePatterns.map((pattern) =>
          pattern ?? drumPatternBySection[s.id].map((hit) => ({ ...hit })));
        drumPatternBySection[s.id] = drumPatternBySectionBar[s.id][0] ?? drumPatternBySection[s.id];
        continue;
      }
      // LOFI non-loop sections keep one minimal mask. The main loop path
      // above is owned by the Arranger's two-bar phrase score; neither path
      // performs an implicit per-bar modulo rotation.
      if (band.style.toLowerCase() === 'lofi') {
        drumPatternBySectionBar[s.id] = Array.from(
          { length: s.bars },
          () => drumPatternBySection[s.id].map((hit) => ({ ...hit })),
        );
        continue;
      }
      drumPatternBySectionBar[s.id] = (scoreBars ?? Array.from({ length: s.bars }, (_, barInSection) => ({
        role: 'base' as const,
        phraseIndex: Math.floor(barInSection / 4),
      }))).map((bar) => {
        const phraseAnswer = bar.phraseIndex % 2;
        const offset = bar.role === 'answer'
          ? 1 + phraseAnswer
          : bar.role === 'lift'
            ? 2
            : bar.role === 'turnaround'
              ? 2 + phraseAnswer
              : bar.role === 'breakdown'
                ? 0
                : phraseAnswer;
        return variants[(baseVariant + offset) % variants.length] ?? variants[0];
      });
      continue;
    }
    const gk = (arrangement.grooveBySection[s.id] ?? 'straight') as GrooveKind;
    const variants = drumGrooveVariants(band.style, gk);
    drumPatternBySection[s.id] = variants[variantByGroove[gk] ?? 0] ?? variants[0];
    drumPatternBySectionBar[s.id] = Array.from({ length: s.bars }, () => drumPatternBySection[s.id]);
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

  // 有 resolved archetype 时，Arranger 的 rolePerformance 是段级在场唯一真源。
  // Instrumental 仍负责音色/混音/具体演奏能力，但不能再按 style、拍号或段名重写编配。
  if (arrangement.resolvedArchetype) {
    for (const section of arrangement.sections) {
      activeRolesBySection[section.id] = band.instrumentPool.filter((role) =>
        arrangement.rolePerformanceBySection?.[role]?.[section.id]?.active === true);
    }
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
  if (!isDream5504DryBaselineStyle(band.style)) {
    for (const s of arrangement.sections) {
      const padOnlyHarmony = !((activeRolesBySection[s.id] as readonly InstrumentRoleName[] | undefined)?.includes('comp'));
      const sec: Partial<Record<InstrumentRoleName, RoleMix>> = {};
      for (const role of band.instrumentPool) sec[role] = mixByRoleSection[role]?.[s.id];
      const fixed = enforceRelationalMix(sec, { padIsOnlyHarmony: padOnlyHarmony });
      for (const role of band.instrumentPool) if (fixed[role] && mixByRoleSection[role]) mixByRoleSection[role][s.id] = fixed[role]!;
    }
  }

  // ★ ACG:lead/comp 是同一架钢琴的前景空间（大钢琴/亮钢琴/极少量柔电钢），
  //   统一 reverb/pan，只保留各程序自身的 chorus 差异。
  if (band.style.toLowerCase() === 'acg' && orchestrationPalette !== 'acoustic-debug') {
    for (const s of arrangement.sections) {
      const compMix = mixByRoleSection.comp?.[s.id];
      if (!compMix) continue;
      for (const role of ['lead', 'comp'] as const) {
        const m = mixByRoleSection[role]?.[s.id];
        if (m) mixByRoleSection[role][s.id] = { ...m, reverb: compMix.reverb, pan: 64 };
      }
    }
  }

  const pedalPlanByRole = buildPedalPlanByRole({
    style: band.style,
    lineup: band.instrumentPool,
    arrangement,
    harmonic,
    programByRoleSection,
    bankByRoleSection,
    activeRolesBySection,
    sharedPianoRoles: paletteSharedPianoRoles,
  });
  const controllerPlanByRole = buildControllerPlanByRole({
    style: band.style,
    lineup: band.instrumentPool,
    arrangement,
    activeRolesBySection,
    voiceProfileByRoleSection,
  });

  const data: InstrumentationPlanData = {
    activeRolesBySection,
    registerByRole,
    strictRegisterByRole,
    textureBySection,
    richTextureBySection,
    richTextureSwitchBySection,
    textureYieldPolicy: GENERIC_TEXTURE_YIELD,
    roleProgram, // ★ 生效基底 program(链式协同 + repair 后)→ render 单一真源
    roleBank,
    voiceNameByRole,
    voiceProfileByRole,
    orchestrationChain: {
      world: orchestrationPalette === 'acoustic-debug' ? 'acousticPianoBand' : orch.world,
      profileId: orchestrationPalette === 'acoustic-debug' ? 'acoustic-debug' : orch.profileId,
      ensembleWorld: orchestrationPalette === 'acoustic-debug' ? undefined : orch.ensembleWorld,
      compProgram: roleProgram.comp, compBank: roleBank.comp,
      leadProgram: roleProgram.lead, leadBank: roleBank.lead,
      bassProgram: roleProgram.bass, bassBank: roleBank.bass,
      padProgram: roleProgram.pad, padBank: roleBank.pad,
      drumProgram: roleProgram.drum,
      voiceNames: voiceNameByRole,
      decisions: [
        ...orch.decisions,
        `Dream5504 modern-GM melodic=${DREAM5504_MODERN_MELODIC_VOICE_COUNT} drumKits=${DREAM5504_DRUM_KIT_COUNT} MT32-excluded=${DREAM5504_MT32_COMPATIBILITY_VOICE_COUNT}`,
        ...dream5504Decisions,
        ...(acgPianoVoice ? [`ACG PIANOSONG song-piano ${acgPianoVoice.name}(GM${acgPianoVoice.program},CC0=${acgPianoVoice.bank})`] : []),
        ...gmbkVoiceDecisions,
      ],
    },
    hardwareVoiceWorld: {
      targetId: DREAM5504_TARGET_ID,
      melodicVoiceCount: DREAM5504_MODERN_MELODIC_VOICE_COUNT,
      drumKitCount: DREAM5504_DRUM_KIT_COUNT,
      excludedMt32CompatibilityVoiceCount: DREAM5504_MT32_COMPATIBILITY_VOICE_COUNT,
      familyCounts: { ...DREAM5504_VOICE_FAMILY_COUNTS },
    },
    programByRoleSection,
    bankByRoleSection,
    voiceNameByRoleSection,
    voiceProfileByRoleSection,
    mixByRoleSection, // ★ ESP32 混音(CC7/10/91/93;随段程序变)
    spaceProfile,
    gestureExpressionByRole,
    pedalPlanByRole,
    controllerPlanByRole,
    drumPatternBySection,
    drumPatternBySectionBar,
    timbreWorld,
    sameInstrumentPairs: samePairs.length ? samePairs : undefined,
    melodyReservationPlan: {
      reservedRegister: melodyReservedRegister,
      densityCeiling: clamp01(band.styleProfile.accompDensity),
      hookAnchorSlots,
    },
    endingPlan: buildEndingPlan(arrangement.endingStyle as EndingStyle, arrangement.sections,
      activeRolesBySection[arrangement.sections[arrangement.sections.length - 1]?.id] ?? band.instrumentPool),
    transitionPlan: buildTransitionPlan(arrangement, activeRolesBySection, band.instrumentPool),
    needsDownbeatCompAnchorBySection: Object.fromEntries(arrangement.sections.map((s) => {
      const roles = activeRolesBySection[s.id] ?? [];
      const plannedOpeningCompDelay = s.id === arrangement.sections[0]?.id
        && arrangement.openingGesture.sectionId === s.id
        && (arrangement.openingGesture.roleDelayBars.comp ?? 0) > 0;
      return [s.id, !isAcgPianoSong && !plannedOpeningCompDelay && roles.includes('comp') && !roles.includes('pad')];
    })),
  };

  return freezeInstrumentationPlan(data);
}
