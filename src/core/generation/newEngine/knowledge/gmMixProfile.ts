// ============================================================
// newEngine · knowledge · GM Mix Profile(ESP32-S2 乐器混音/空间,2026-06-10)
// ------------------------------------------------------------
// docs/esp32s2_gm128_instrument_mix_directive.md:器配层据 style+timbreWorld+role+【生效】GM program
//   决定 CC7 音量 / CC10 声像 / CC91 混响 / CC93 合唱 / (可选 CC11 表情,静态)。
//   目标 = "一个房间里的乐队",不是 5 个互不相干的 GM patch。ESP32-S2:小、表驱动、确定性、整数。
// ★ 只产【混音元数据】(CC 值),不碰音符/织体/和声(directive 严格非目标)。无 rng,确定性。
// ============================================================

import type { InstrumentRoleName } from '../band/BandSpec';
import type { TimbreWorld } from './instruments';

export interface RoleMix {
  volume: number;      // CC7
  pan: number;         // CC10
  reverb: number;      // CC91
  chorus: number;      // CC93
  expression?: number; // CC11(静态,可选)
  delay?: number;      // ★ Layer 2:CC95 send 进共享 song delay(极克制,拍板 D;bass/drum/pad off)
}

export type SpaceProfile = 'popWarmRoom' | 'lofiTapeRoom' | 'rnbPlateRoom' | 'jazzClub' | 'dryFront' | 'syntheticSoftRoom';

// ★ Layer 2(three-layer mix plan §2.1):完整 song space 契约 —— 器配层【唯一真源】,render 只消费,硬件共享 FX 消费全参数。
export interface SongSpaceProfile {
  id: SpaceProfile;
  reverbTime: number;   // 0..1 → ESP32 FxReverb::setTime
  reverbLevel: number;  // 0..1 → ESP32 FxReverb::setLevel
  predelayMs: number;
  damping: number;      // 0..1
  chorusLfoHz: number;
  chorusDepth: number;
  chorusBaseDelay: number;
  delayMode: 'off' | 'eighth' | 'dotted-eighth' | 'quarter';
  delayFeedback: number;
}

// 每空间的 FX 参数(确定性)。★ 硬件共享 FX 消费完整契约;CC95 进入真 delay bus。
const SONG_SPACE_PROFILES: Record<SpaceProfile, SongSpaceProfile> = {
  popWarmRoom:      { id: 'popWarmRoom',      reverbTime: 0.46, reverbLevel: 0.32, predelayMs: 16, damping: 0.58, chorusLfoHz: 0.6, chorusDepth: 0.15, chorusBaseDelay: 8, delayMode: 'eighth',        delayFeedback: 0.08 },
  lofiTapeRoom:     { id: 'lofiTapeRoom',     reverbTime: 0.42, reverbLevel: 0.30, predelayMs: 10, damping: 0.66, chorusLfoHz: 0.4, chorusDepth: 0.18, chorusBaseDelay: 10, delayMode: 'eighth',        delayFeedback: 0.12 }, // dusty but controlled on hardware shared FX
  rnbPlateRoom:     { id: 'rnbPlateRoom',     reverbTime: 0.52, reverbLevel: 0.36, predelayMs: 20, damping: 0.58, chorusLfoHz: 0.7, chorusDepth: 0.16, chorusBaseDelay: 8, delayMode: 'dotted-eighth',  delayFeedback: 0.10 },
  jazzClub:         { id: 'jazzClub',         reverbTime: 0.38, reverbLevel: 0.26, predelayMs: 18, damping: 0.58, chorusLfoHz: 0.5, chorusDepth: 0.12, chorusBaseDelay: 8, delayMode: 'off',           delayFeedback: 0.0 },
  dryFront:         { id: 'dryFront',         reverbTime: 0.25, reverbLevel: 0.20, predelayMs: 5,  damping: 0.60, chorusLfoHz: 0.5, chorusDepth: 0.12, chorusBaseDelay: 8, delayMode: 'off',           delayFeedback: 0.0 },
  syntheticSoftRoom:{ id: 'syntheticSoftRoom',reverbTime: 0.55, reverbLevel: 0.42, predelayMs: 10, damping: 0.50, chorusLfoHz: 0.8, chorusDepth: 0.24, chorusBaseDelay: 10, delayMode: 'quarter',       delayFeedback: 0.14 },
};

export function isSpaceProfile(value: string | undefined): value is SpaceProfile {
  return !!value && Object.prototype.hasOwnProperty.call(SONG_SPACE_PROFILES, value);
}

export function songSpaceProfileById(id: string | undefined): SongSpaceProfile | undefined {
  return isSpaceProfile(id) ? SONG_SPACE_PROFILES[id] : undefined;
}

const DREAM5504_DRY_BASELINE_STYLES = new Set(['pop', 'lofi', 'jazz', 'rnb']);

/** Firm5504-EK: MIDI Channel Volume (CC7) power-up default. */
export const DREAM5504_DEFAULT_CHANNEL_VOLUME = 100;

/** 四个正式多轨风格先走 Dream 5504 干声安全基线，空间 CC 待逐音色硬件验证后再开放。 */
export function isDream5504DryBaselineStyle(style: string | undefined): boolean {
  return DREAM5504_DRY_BASELINE_STYLES.has((style ?? '').toLowerCase());
}

/** ★ 一首一个完整 song space(器配-owned 真源)。render 消费 reverb/chorus send;ESP32 消费全 FX 参数。 */
export function songSpaceProfile(style: string, world: TimbreWorld | undefined, hasPad: boolean): SongSpaceProfile {
  return SONG_SPACE_PROFILES[pickSpaceProfile(style, world, hasPad)];
}

/** ★ Layer 2 delay 策略(拍板 D):CC95 send。GM5 键盘电钢槽位的尾音交给乐器 release + shared room,不再叠 delay。 */
export function delaySendForRole(style: string, role: InstrumentRoleName, program: number): number {
  void style;
  void role;
  void program;
  // Dream 5504 官方 GM2 MIDI 固件没有确认 CC95 song-delay send。
  // 四个正式风格不再借风格名注入额外 CC；以后若启用 delay，必须由有官方
  // 证据的具体音色/固件能力显式声明。
  return 0;
}

const clampCC = (v: number): number => Math.max(0, Math.min(127, Math.round(v)));

/** 一首一个空间(style + timbreWorld + 是否有 pad)。 */
export function pickSpaceProfile(style: string, world: TimbreWorld | undefined, hasPad: boolean): SpaceProfile {
  const s = style.toLowerCase();
  // ★ ACG(2026-07-02):久石让/坂本电影钢琴 = 空间感(hall/room),不能 dry-front。去 pad 后靠钢琴自身混响托空间,
  //   否则落进 !hasPad→dryFront(rev×0.62,40/47→25/29 变干)—— 与 MG 空旷 cinematic piano 相反。→ ACG 恒 warmRoom。
  if (s === 'acg') return 'popWarmRoom';
  // POP/LOFI/JAZZ/RNB 不再拥有风格总线空间。统一从 dryFront 起步，
  // 每件乐器的 CC91/93 只由最终 Program profile 决定。
  if (s === 'pop' || s === 'lofi' || s === 'jazz' || s === 'rnb') return 'dryFront';
  if (s === 'blues') return 'jazzClub';
  if (world === 'syntheticSoft') return 'syntheticSoftRoom';
  if (!hasPad) return 'dryFront'; // pop/其它 无 pad → 更干靠前
  return 'popWarmRoom';
}

// 空间对【comp/lead/pad】混响的整体缩放。bass/drum 用低频专属小 room send,不随大房间放大。
const SPACE_REVERB_SCALE: Record<SpaceProfile, number> = {
  popWarmRoom: 1.0, lofiTapeRoom: 0.9, rnbPlateRoom: 1.0, jazzClub: 0.72, dryFront: 0.62, syntheticSoftRoom: 1.05,
};

// 角色基底(directive 全局默认的代表值)。pan 由 pan 规则覆盖。
const ROLE_BASE: Record<InstrumentRoleName, RoleMix> = {
  bass: { volume: 78, pan: 64, reverb: 10, chorus: 2 },
  comp: { volume: 92, pan: 52, reverb: 42, chorus: 30 }, // YD3411 中频优势:comp/lead 是房间前景,comp velocity 低用 CC7 补偿
  lead: { volume: 84, pan: 64, reverb: 50, chorus: 20 },
  pad: { volume: 66, pan: 88, reverb: 68, chorus: 46 },
  drum: { volume: 78, pan: 64, reverb: 14, chorus: 0 },
};

// ★ melody-forward(2026-06-23,用户:走 A 整编里 motif/旋律声音小)。lead = 主奏,应明显坐在 comp/鼓之上,
//   但原 lead CC7(79-83)反而低于 comp(85-90)→ 旋律被埋。统一抬高 lead CC7,让有效响度(CC7×velocity)
//   回到与【试听(用户认可的平衡)】相当(实测 试听 lead eff≈69 vs 整编 59;+14 把整编拉回 ~69)。
//   作用于所有 Q+N 歌(非仅走 A);确定性,clampCC 兜 127 不溢出。
const LEAD_PRESENCE_BOOST = 14;
// ★ ACG 平衡(2026-06-28 用户:ACG lead eff≈9500 碾全队 eff≈3700 → 一轨很小声)。ACG=solo piano,
//   RH 旋律不该碾 LH 伴奏。lead 减压(present 但不碾)+ comp 抬(高空气 comp 可听)。
//   2026-07-13 小喇叭实听:bassline 需要在 100-200Hz 可闻,不再压到完全靠后。
const ACG_LEAD_BOOST = -6;   // piano lead 88−6=82 · 旋律仍在,但不碾 LH/comp
const ACG_COMP_LIFT = 13;    // piano comp 90+13=103→100 · comp 高空气抬可听
const ACG_BASS_LIFT = -4;    // 82−4=78 · bassline 可闻,但低于钢琴主体
const MODAL_BASS_LIFT = -4;  // modal 常少轨/慢音值,稍收 bass 避免持续低频占满小腔体

// 非 Dream 四个正式干声风格的程序专属覆盖。POP/LOFI/JAZZ/RNB 在
// mixForProgram 入口直接返回官方默认 CC7，不读取此表的 volume。
// key=program;值=Partial(只覆盖给定字段)。按 role 区分的取 role 维。
type ProgOverride = Partial<Record<InstrumentRoleName, Partial<RoleMix>>>;
const PROGRAM_MIX: Record<number, ProgOverride> = {
  // Piano 0:YD3411 中频优势在钢琴主体区,大钢琴应是 comp/lead 前景核心。
  0: { comp: { volume: 90, reverb: 44, chorus: 8 }, lead: { volume: 88, reverb: 50, chorus: 5 } },
  // 电钢 4/5:不能靠混响假装尾音。空间收干,避免 FM/Rhodes 谐波尾巴压住大钢琴。
  4: { comp: { volume: 72, reverb: 18, chorus: 12 }, lead: { volume: 66, reverb: 22, chorus: 14 } },
  // 电钢 5(POP/LOFI/RNB 最重要;GU Electric Grand):SF2 保干净 24k CP-80 样本;大钢琴层用 Aura25 自有 GM0,不重复打包。
  5: { comp: { volume: 70, reverb: 12, chorus: 6 }, lead: { volume: 62, reverb: 16, chorus: 8 } },
  6: { comp: { volume: 80, reverb: 29, chorus: 4 }, lead: { volume: 80, reverb: 29, chorus: 4 } }, // 羽管键琴:干、保 attack
  8: {
    comp: { volume: 80, reverb: 40, chorus: 6 },
    lead: { volume: 80, reverb: 45, chorus: 5 },
    drum: { volume: 60, reverb: 24 },
  }, // Celesta(旋律按钢琴系) / bank128 Room 鼓组:对齐试听的 kick room send
  11: { lead: { volume: 73, reverb: 34, chorus: 0 } }, // 颤音琴:高区金属峰明显,少进空间,靠干净 attack 而不是拖尾
  12: { lead: { volume: 81, reverb: 41, chorus: 7 } },  // 马林巴:保木质 attack
  108: { lead: { volume: 58, reverb: 18, chorus: 0 } }, // 卡林巴:轻拨弦热源,少进空间,避免小喇叭高频谐振
  107: { lead: { volume: 80, reverb: 44, chorus: 10 } }, // 古筝(拨弦,略带空间)
  // 这些旧 profile 仅供其它风格；Dream 四个正式风格不会消费其 CC7。
  24: { comp: { volume: 56, reverb: 14, chorus: 0 }, lead: { volume: 58, reverb: 28, chorus: 0 } }, // 尼龙吉他 comp:干、短、保拨弦 attack
  25: { comp: { volume: 56, reverb: 14, chorus: 0 }, lead: { volume: 58, reverb: 30, chorus: 0 } }, // 民谣/钢弦木吉他 comp 不进厚空间,避免扫拨糊
  40: { lead: { volume: 72, reverb: 56, chorus: 8 } },  // 小提琴:留 room,音量低于 sax,避免高频顶出
  // 管乐/萨克斯(气声,中低音区)
  65: { lead: { volume: 78, reverb: 46, chorus: 8 } },
  66: { lead: { volume: 78, reverb: 62, chorus: 0 } },
  67: { lead: { volume: 70, reverb: 52, chorus: 0 } },
  75: { lead: { volume: 80, reverb: 50, chorus: 12 } }, 77: { lead: { volume: 80, reverb: 48, chorus: 10 } },
  // 贝斯
  32: { bass: { volume: 82, reverb: 10, chorus: 1 } }, 33: { bass: { volume: 82, reverb: 10, chorus: 1 } },
  35: { bass: { volume: 81, reverb: 10, chorus: 2 } }, // 无品:保留一点宽度,避免 chorus 让低频发虚
  36: { bass: { volume: 80, reverb: 9, chorus: 1 } }, 37: { bass: { volume: 80, reverb: 9, chorus: 1 } },
  38: { bass: { volume: 80, reverb: 8, chorus: 1 } }, // synth bass:提高主体,少 chorus 保持小喇叭低频清晰
  // 暖 pad
  88: { pad: { volume: 64, reverb: 68, chorus: 52 } }, 89: { pad: { volume: 64, reverb: 68, chorus: 52 } },
  90: { pad: { volume: 64, reverb: 68, chorus: 52 } }, 94: { pad: { volume: 64, reverb: 68, chorus: 52 } }, 95: { pad: { volume: 64, reverb: 68, chorus: 52 } },
  // FX pad(空气层,音量低)
  99: { pad: { volume: 58, reverb: 76, chorus: 56 } },
  100: { pad: { volume: 58, reverb: 76, chorus: 56 } }, 102: { pad: { volume: 58, reverb: 76, chorus: 56 } },
  // 合奏弦 pad
  48: { pad: { volume: 64, reverb: 66, chorus: 42 } }, 49: { pad: { volume: 64, reverb: 66, chorus: 42 } }, 50: { pad: { volume: 64, reverb: 68, chorus: 46 } },
};

const isFxPad = (p: number) => p === 98 || p === 99 || p === 100 || p === 102;
const isWarmPad = (p: number) => p === 88 || p === 89 || p === 90 || p === 94 || p === 95;
const isMalletProgram = (p: number) => p === 11 || p === 12 || p === 107 || p === 108;

/**
 * 据 style+timbreWorld+role+【生效】program 算该角色混音(单角色;关系型护栏 enforceRelationalMix 后处理)。
 *   确定性、整数、ESP32 安全。pan 走 pan 规则(lead/bass/drum 居中,comp/pad 展宽,有 pad 时对置)。
 */
export function mixForProgram(args: {
  style: string;
  timbreWorld: TimbreWorld | undefined;
  role: InstrumentRoleName;
  program: number;
  hasPad: boolean;
  space: SpaceProfile;
}): RoleMix {
  const { role, program, hasPad, space } = args;
  const base = { ...ROLE_BASE[role] };

  // Dream 四个正式风格完全绕过 role/program 音量表。明确重发默认值，既不
  // 依赖板子当前通道状态，也不改变 GMBK 固化音色之间的原始响度关系。
  if (isDream5504DryBaselineStyle(args.style)) {
    if (role === 'lead' || role === 'bass' || role === 'drum') base.pan = 64;
    else if (role === 'comp') base.pan = hasPad ? 52 : 60;
    else if (role === 'pad') base.pan = 88;
    return { volume: DREAM5504_DEFAULT_CHANNEL_VOLUME, pan: clampCC(base.pan), reverb: 0, chorus: 0 };
  }

  const ov = PROGRAM_MIX[program]?.[role];
  if (ov) Object.assign(base, ov);

  // pan 规则:lead/bass/drum 居中;comp 偏左(有 pad 更左);pad 偏右。
  if (role === 'lead' || role === 'bass' || role === 'drum') base.pan = 64;
  else if (role === 'comp') base.pan = hasPad ? 52 : 60;
  else if (role === 'pad') base.pan = 88;

  // 空间:只缩 comp/lead/pad 的混响。bass/drum 走低频专属 back-row send,不随大房间无限放大。
  if (role === 'comp' || role === 'lead' || role === 'pad') base.reverb = base.reverb * SPACE_REVERB_SCALE[space];

  // 角色护栏(directive guardrails,单角色部分)。
  if (role === 'bass') base.reverb = Math.min(base.reverb, 12);
  if (role === 'drum') base.chorus = 0;
  if (role === 'comp' || role === 'lead') {
    if (program === 4) {
      base.reverb = Math.min(base.reverb, role === 'lead' ? 22 : 18);
      base.chorus = role === 'lead' ? 14 : 12;
    }
    if (program === 5) {
      base.reverb = Math.min(base.reverb, role === 'lead' ? 16 : 12);
      base.chorus = role === 'lead' ? 8 : 6;
    }
  }
  if (isMalletProgram(program)) base.chorus = 0; // mallet 音准优先:不加 chorus 调制,避免听成微跑音。
  if (program === 7) base.reverb = Math.min(base.reverb, 30); // Clav:干、保 attack(同 harpsichord 6)
  if (role === 'pad' && isFxPad(program)) { base.volume = Math.min(base.volume, 60); base.reverb = Math.max(base.reverb, 72); }

  // ★ melody-forward:lead 抬 CC7 让旋律明显在场(放最后 → 覆盖所有 program 基底 + 覆盖值)。clampCC 兜 127。
  //   ★ ACG 例外:solo piano 的 lead 减压 + comp/bass 抬(见 ACG_* 常量),让 RH 不碾 LH(有效响度均衡)。
  const isAcg = args.style.toLowerCase() === 'acg';
  const isJazz = args.style.toLowerCase() === 'blues';
  const isModal = args.style.toLowerCase() === 'modal';
  if (role === 'lead') base.volume = base.volume + (isAcg ? ACG_LEAD_BOOST : LEAD_PRESENCE_BOOST);
  if (isAcg && role === 'comp') base.volume = base.volume + ACG_COMP_LIFT;
  if (isAcg && role === 'bass') base.volume = base.volume + ACG_BASS_LIFT;
  if (isJazz && role === 'bass') base.volume = base.volume - 11;
  if (isModal && role === 'bass') base.volume = base.volume + MODAL_BASS_LIFT;

  // ★ Layer 2:delay(CC95)send —— 官方未确认，当前恒关闭。
  const delay = delaySendForRole(args.style, role, program);
  return { volume: clampCC(base.volume), pan: clampCC(base.pan), reverb: clampCC(base.reverb), chorus: clampCC(base.chorus), ...(delay > 0 ? { delay: clampCC(delay) } : {}) };
}

/**
 * 关系型护栏(需全角色集):pad.reverb ≥ comp.reverb+20 · pad.volume ≤ comp.volume−10(除非 pad 是唯一和声)·
 *   |comp.pan − pad.pan| ≥ 22。原地不可变:返回调整后的新 mix 集合。
 */
export function enforceRelationalMix(
  mixes: Partial<Record<InstrumentRoleName, RoleMix>>,
  opts: { padIsOnlyHarmony?: boolean } = {},
): Partial<Record<InstrumentRoleName, RoleMix>> {
  const comp = mixes.comp, pad = mixes.pad;
  if (!comp || !pad) return mixes;
  const out: Partial<Record<InstrumentRoleName, RoleMix>> = { ...mixes };
  const padOut = { ...pad };
  // pad 比 comp 至少湿 20
  padOut.reverb = clampCC(Math.max(padOut.reverb, comp.reverb + 20));
  // pad 是背景空气层:非唯一和声时至少比 comp 低一档,避免持续音遮住鼓/钢琴瞬态。
  if (!opts.padIsOnlyHarmony) padOut.volume = clampCC(Math.min(padOut.volume, comp.volume - 10));
  // comp/pad 声像距离 ≥ 22(comp 已偏左~52,pad 推到右)
  if (Math.abs(comp.pan - padOut.pan) < 22) padOut.pan = clampCC(comp.pan + 36);
  out.pad = padOut;
  return out;
}
