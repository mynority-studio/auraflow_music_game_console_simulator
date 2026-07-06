// ============================================================
// newEngine · instrumental · InstrumentationPlan 契约
// ------------------------------------------------------------
// 架构定稿 Part 2.5 / 铁律16:器配 / 织体 / 旋律预留。值对象快照,deepFreeze。
// textureYieldPolicy 按织体分流(active comp 让位 / pad 不让位)。
// melodyReservationPlan.hookAnchorSlots = 伴奏生成前就知道的 hook【窗口+要求】;
//   具体锚点音高由 Prepass 填进候选池(2.6/2.7)。
// Slice 1:voicingPlan/articulationPlan/silencePlan 待消费者到位再补(轻耦合)。
// ============================================================

import { deepFreeze, type DeepReadonly, type Midi } from '../foundation';
import type { InstrumentRoleName } from '../band/BandSpec';
import type { EndingStyle, PhraseId, SectionEntry, SectionId } from '../arranger/ArrangementPlan';
import type { GenericTextureKind, GenericTextureYield } from '../knowledge/textureProfiles';
import type { TimbreWorld } from '../knowledge/instruments';
import type { RoleMix, SpaceProfile } from '../knowledge/gmMixProfile';
import type { DrumHit } from '../knowledge/grooves';

// ★ 织体种类 / 让位类的真源在 KB(knowledge/textureProfiles);此处仅按契约名复用(用户定:织体归 KB)。
export type TextureKind = GenericTextureKind;
export type YieldClass = GenericTextureYield;

export interface RegisterRange {
  lowMidi: Midi;
  highMidi: Midi;
}

export interface HookAnchorSlot {
  phraseId: PhraseId;
  beatSlot: number;            // hook 句在曲中的起拍(绝对拍位)
  preferredRegister: RegisterRange;
  anchorRequired: boolean;     // 主 hook(chorus)强制让位
  segment: 'head' | 'tail' | 'full-motif';
  maxAccompanimentDensity: number;
}

export interface MelodyReservationPlan {
  reservedRegister: RegisterRange;
  densityCeiling: number;
  hookAnchorSlots: HookAnchorSlot[];
}

export type GestureExpressionKind =
  | 'none'
  | 'keyboard-touch'
  | 'mallet-strike'
  | 'drum-rudiment'
  | 'sax-breath-legato'
  | 'pipe-wind-breath'
  | 'bowed-string-legato'
  | 'bass-pluck-legato'
  | 'bass-walk'
  | 'bass-muted'
  | 'sustained-pad';
export type GestureExpressionFamily = 'none' | 'keyboard' | 'mallet' | 'drum' | 'sax' | 'pipe-wind' | 'bowed-string' | 'bass' | 'pad';
export type GestureBreathModel = 'none' | 'reed-continuous' | 'pipe-taper';
export type GestureNoteShape = 'none' | 'finger-legato' | 'strike-decay' | 'rudiment-hits' | 'legato-overlap' | 'bow-legato' | 'bass-legato' | 'bass-muted' | 'sustain-pad';
export type GestureArticulation = 'none' | 'comping' | 'finger-legato' | 'staccato' | 'tenuto' | 'slur' | 'ghost' | 'roll' | 'walking';
export type GestureVelocityCurve = 'none' | 'soft' | 'linear' | 'accented' | 'ghosted' | 'walking-pulse' | 'strike-decay';
export type GesturePedalPolicy = 'none' | 'harmonic-change' | 'light-syncopated' | 'acg-legato-change';
// ★ Layer 1(three-layer mix plan):乐器【尾音契约】—— 和 reverb/chorus 分开,tail 是乐器演奏行为(gate/pedal/CC72 release),不是空间。
export type TailPolicy =
  | 'none'
  | 'keyboard-natural'    // 原声钢琴:自然衰减 + comp 可 harmonic pedal
  | 'electric-key-tail'   // DX7/GM5 电钢:靠 note gate(comp)/ CC72 release(lead,保 parity),不靠 blanket pedal / reverb
  | 'piano-pedal-comp'    // 钢琴 comp:harmonic-change pedal
  | 'pad-sustain'         // pad:长音
  | 'pluck-short'         // 拨弦/贝斯:短
  | 'wind-breath';        // 吹奏:气声包络(CC11)
export type GestureRudimentPolicy = 'none' | 'backbeat-ghost' | 'ride-swing' | 'laidback-ghost' | 'lofi-dusty' | 'fill-roll';
export type GestureHiHatPolicy = 'none' | 'closed-open-lift' | 'ride-swing' | 'laidback-closed' | 'dusty-closed';
export type GestureBassTechnique = 'walking' | 'pluck' | 'muted' | 'ghost-note' | 'approach-tone' | 'slide' | 'legato';

/** 器配层下发的演奏表情计划:音色决定"怎么吹/怎么发声",render 只执行计划。 */
export interface GestureExpressionPlan {
  kind: GestureExpressionKind;
  family: GestureExpressionFamily;
  program?: number;
  ccControllers: readonly number[];
  breathModel: GestureBreathModel;
  noteShape: GestureNoteShape;
  articulation: GestureArticulation;
  velocityCurve: GestureVelocityCurve;
  pedalPolicy: GesturePedalPolicy;
  rudimentPolicy: GestureRudimentPolicy;
  hiHatPolicy: GestureHiHatPolicy;
  bassTechniques?: readonly GestureBassTechnique[];
  gateRatio?: number;
  maxConnectBeats?: number;
  overlapBeats?: number;
  tailPolicy?: TailPolicy;   // ★ Layer 1:乐器尾音契约(与 reverb/chorus send 分开;测试据此区分 tail vs 空间)
  releaseCc?: number;        // ★ Layer 1:可选 release 增强(CC72,64-centered;两 synth 都响应)。lead 电钢 tail 主机制(保 parity)
}

// ★ 收尾【乐器进出计划】(2026-06-08,器配据 arrangement.endingStyle 编写):render 据此出收尾手势。
//   exitBarByRole = 该 role 在 outro 内【撑过头几个相对小节后静音】(undefined = 响到末);
//   holdFinalChord = 末和弦延留(tag);fadeOut = outro 力度渐弱(fade);coldStop = 末小节齐停 + button 重音(cold)。
export interface EndingPlan {
  style: EndingStyle;
  outroSectionId: SectionId | null;
  outroBars: number;
  exitBarByRole: Partial<Record<InstrumentRoleName, number>>;
  holdFinalChord: boolean;
  fadeOut: boolean;
  coldStop: boolean;
  // ★ Loop G(2026-06-08)cadence orchestration:谁延留末和弦 / 是否保护 lead 时值。
  //   (finalAnchorRoles 已删 2026-06-10:render 侧从未消费=死字段;末 I 接地由 sustainRoles + coldStop/hold 覆盖。)
  sustainRoles?: readonly InstrumentRoleName[];     // 延留末和弦的角色(末段实际在场:pad 优先,无 pad 用 comp;lead 不默认延留)
  protectLeadTiming?: boolean;             // true → applyEnding 不强行延长 lead(末音落主音由 mgLeadRenderer snap 负责)
}

export interface InstrumentationPlanData {
  activityBySection: Record<SectionId, Partial<Record<InstrumentRoleName, number>>>;
  // ★ 编曲密度弧(A1):每段【在场的乐手子集】(genre×functionTag×lineup 确定性推出)。
  //   render 按此 gate(谁在哪段进/出)→ intro 稀疏 / chorus 全员同进 / breakdown 抽离。
  //   无 functionTag/genre 的段 = 全 lineup(向后兼容)。lead 当前全程在场(gating 留后续)。
  activeRolesBySection: Record<SectionId, InstrumentRoleName[]>;
  registerByRole: Record<InstrumentRoleName, RegisterRange>;
  textureBySection: Record<SectionId, TextureKind>; // 笼统让位类织体(active-comp/pad…),管谁让位
  // ★ rich textureCase 段级下发(2026-06-08,texture-switch 修复):非 LOFI 每段一个具体 textureCase
  //   (同 role/repeatGroup 复用、同曲 ≤2、排除 delayed-entry)→ render 按段 projection,不再逐 span 随机切。
  //   LOFI 不在此(空)→ render 回退逐 span 老路(LOFI phrase-variation 留后续)。
  richTextureBySection: Record<SectionId, string>;
  // ★ 段内受控变化(第二期):verse 中段(atFraction)切到【兼容连续】变体,同曲 ≤2/段、所有同 role 段一致
  //   (repeatGroup)、低概率。render 按 idxInSec/count ≥ atFraction 投影。无此项的段 = 全段单一织体。
  richTextureSwitchBySection: Record<SectionId, { atFraction: number; toTexture: string }>;
  textureYieldPolicy: Record<TextureKind, YieldClass>;
  // ★ 器配:每乐手(角色)× 每段落的音色(GM program)。大多全曲=primary;comp/lead 偶尔 chorus 换同族备选。
  //   同一乐手换声音(效果器/电钢切音色)→ render 落 programChange 事件,不换轨/通道。
  programByRoleSection: Record<InstrumentRoleName, Record<SectionId, number>>;
  // ★ 2026-06-10:器配层【最终生效】基底 program(band.roleProgram 过链式协同 + repairWorld/repairCompCapability/
  //   coherentLeadComp 后)。render 一律读这个 + programByRoleSection,不再回头读 band.roleProgram(消双真源)。
  roleProgram: Record<InstrumentRoleName, number>;
  // ★ 链式协同诊断(gm128_chain_orchestration):本曲选定的音色世界/链 profile + 各角色生效 program + 决策轨迹。
  //   器配层【拥有】GM 选择:band.roleProgram 仅作 provisional 候选,链按 comp→lead→bass→pad 协同。trace/调试用。
  orchestrationChain: {
    world: TimbreWorld;
    profileId: string;
    compProgram?: number;
    leadProgram?: number;
    bassProgram?: number;
    padProgram?: number;
    drumProgram?: number;
    decisions: string[];
  };
  // ★ ESP32 混音(esp32s2_gm128_instrument_mix_directive):器配层据 style+timbreWorld+role+生效 program
  //   决定 CC7/10/91/93(+可选 CC11)。随段程序变(programByRoleSection 切换 → mix 也切)。render 落 IR,irToMidi 读。
  mixByRoleSection: Record<InstrumentRoleName, Record<SectionId, RoleMix>>;
  spaceProfile: SpaceProfile;
  // ★ 手势表情层(吹奏/气息模拟):器配层据最终 program 下发表情计划,render 只消费计划,不再自行按 GM 号猜。
  gestureExpressionByRole: Record<InstrumentRoleName, GestureExpressionPlan>;
  // ★ 每段鼓型(2026-06-08,groove 下发):Arranger 给 GrooveKind → 器配按 (style×groove) 从 KB 词汇
  //   确定性挑变体(同 groove → 同变体,repeatGroup 一致)。render 据此逐段换鼓型(取代单一 drumPattern);
  //   texturePocket 退成次要兜底(仅无此项的段)。空 = render 回退 drumPattern(style)(向后兼容)。
  drumPatternBySection: Record<SectionId, DrumHit[]>;
  // ★ 音色世界统一性(可观测;不参与避让/render):timbreWorld = 本曲音色世界分类;
  //   sameInstrumentPairs = 同乐器对(lead==comp 等,记录不拒绝)。GM program 仍由 programByRoleSection 承载。
  timbreWorld?: TimbreWorld;
  sameInstrumentPairs?: { a: InstrumentRoleName; b: InstrumentRoleName; program: number }[];
  melodyReservationPlan: MelodyReservationPlan;
  // ★ 收尾乐器进出计划(器配据 arrangement.endingStyle 排,render 投影出手势)。
  endingPlan: EndingPlan;
  // ★ 段落边界衔接计划(Loop C):lead-in pickup / downbeat anchor / song entry(render gate / humanize 消费)。
  transitionPlan: TransitionPlan;
  // ★ Loop I.3:该段【comp 是唯一和声支撑(无 pad 在场)】→ 若 texture 首击太晚(firstOnsetBeat>0.08),
  //   render 在 structural 下拍补一个轻 guide-tone shell anchor(不让 wash/late texture 当唯一 comp 下拍锚)。
  needsDownbeatCompAnchorBySection: Record<SectionId, boolean>;
}

// ============================================================
// ★ Loop C(2026-06-08):段落边界【器配计划】(器配层把 Arranger 的 entryBySection 宏观意图变成可执行衔接计划)。
//   render(Loop E gate / Loop F humanize)消费;不在此生成 NoteIR。确定性、boundary 行为(与 repeatGroup 无关)。
// ============================================================
export interface BoundaryGesturePlan {
  fromSectionId: SectionId;
  toSectionId: SectionId;
  boundaryBar: number;          // 下一段开始的绝对小节序号
  prepBar: number;              // 上一段最后一小节序号(= boundaryBar - 1)
  entry: SectionEntry;          // downbeat | lead-in
  pickupRoles: InstrumentRoleName[];        // lead-in:允许在 prepBar 预进入的角色(drum/comp/bass)
  releaseRoles: InstrumentRoleName[];        // 在 to 段下拍【新进入】的角色(release 感)
  downbeatAnchorRoles: InstrumentRoleName[]; // to 段下拍必须落地的接地/和声支撑角色
  protectPickupFromGate: boolean;            // pickup 音符不被上一段 activeRoles gate 删除(Loop E)
}
export interface SongEntryPlan {
  firstSectionId: SectionId;
  hasIntro: boolean;
  mode: 'normal-intro' | 'staged-first-bar' | 'direct-anchor';
  downbeatAnchorRoles: InstrumentRoleName[]; // 第一小节必须落地的下拍锚点
  delayedRoles: InstrumentRoleName[];        // staged 进入:延后一拍/一小节的非核心角色
}
export interface TransitionPlan {
  boundaries: BoundaryGesturePlan[];
  songEntry: SongEntryPlan;
}

export type InstrumentationPlan = DeepReadonly<InstrumentationPlanData>;

export function freezeInstrumentationPlan(data: InstrumentationPlanData): InstrumentationPlan {
  return deepFreeze(data);
}
