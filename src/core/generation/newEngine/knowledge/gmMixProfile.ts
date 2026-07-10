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

// ★ Layer 2(three-layer mix plan §2.1):完整 song space 契约 —— 器配层【唯一真源】,render 只消费,ESP32 消费全参数,浏览器只吃 reverb/chorus send。
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

// 每空间的 FX 参数(确定性)。★ ESP32 消费完整 FX 契约;浏览器 scheduler 将 CC95 预渲染为轻量 echo。
const SONG_SPACE_PROFILES: Record<SpaceProfile, SongSpaceProfile> = {
  popWarmRoom:      { id: 'popWarmRoom',      reverbTime: 0.52, reverbLevel: 0.40, predelayMs: 12, damping: 0.50, chorusLfoHz: 0.6, chorusDepth: 0.18, chorusBaseDelay: 8, delayMode: 'eighth',        delayFeedback: 0.12 },
  lofiTapeRoom:     { id: 'lofiTapeRoom',     reverbTime: 0.46, reverbLevel: 0.35, predelayMs: 8,  damping: 0.62, chorusLfoHz: 0.4, chorusDepth: 0.22, chorusBaseDelay: 10, delayMode: 'eighth',        delayFeedback: 0.18 }, // dusty
  rnbPlateRoom:     { id: 'rnbPlateRoom',     reverbTime: 0.60, reverbLevel: 0.45, predelayMs: 15, damping: 0.42, chorusLfoHz: 0.7, chorusDepth: 0.20, chorusBaseDelay: 8, delayMode: 'dotted-eighth',  delayFeedback: 0.16 },
  jazzClub:         { id: 'jazzClub',         reverbTime: 0.40, reverbLevel: 0.30, predelayMs: 18, damping: 0.55, chorusLfoHz: 0.5, chorusDepth: 0.14, chorusBaseDelay: 8, delayMode: 'off',           delayFeedback: 0.0 },
  dryFront:         { id: 'dryFront',         reverbTime: 0.25, reverbLevel: 0.20, predelayMs: 5,  damping: 0.60, chorusLfoHz: 0.5, chorusDepth: 0.12, chorusBaseDelay: 8, delayMode: 'eighth',        delayFeedback: 0.10 },
  syntheticSoftRoom:{ id: 'syntheticSoftRoom',reverbTime: 0.55, reverbLevel: 0.42, predelayMs: 10, damping: 0.50, chorusLfoHz: 0.8, chorusDepth: 0.24, chorusBaseDelay: 10, delayMode: 'quarter',       delayFeedback: 0.14 },
};

/** ★ 一首一个完整 song space(器配-owned 真源)。render 消费 reverb/chorus send;ESP32 消费全 FX 参数。 */
export function songSpaceProfile(style: string, world: TimbreWorld | undefined, hasPad: boolean): SongSpaceProfile {
  return SONG_SPACE_PROFILES[pickSpaceProfile(style, world, hasPad)];
}

/** ★ 按器配层已定的 SpaceProfile id 直取完整 song space。器配层(instrumentalPlanner)已用
 *  lineup-based hasPad 算定 spaceProfile 并 golden 锁=设备 out->space;下游(copych FX 下发)直取，
 *  避免用 IR-based hasPad 重推导(IR≠器配/设备 lineup 判据，会偏离设备空间)。 */
export function songSpaceProfileById(id: SpaceProfile): SongSpaceProfile {
  return SONG_SPACE_PROFILES[id];
}

/** ★ Layer 2 delay 策略(拍板 D):CC95 send。GM5 CityPop/DX7 EP = lead/comp 都进轻量空间;其余仍克制。 */
export function delaySendForRole(style: string, role: InstrumentRoleName, program: number): number {
  const s = style.toLowerCase();
  if (role === 'bass' || role === 'drum' || role === 'pad') return 0; // 拍板:bass/drum off · pad mostly off
  if (s === 'jazz' || s === 'blues' || s === 'acg') return 0; // club/cinematic piano 空间不走共享 echo,避免 comp/lead 尾巴糊成一团。
  const isCityPopFmEp = program === 5;
  const isEP = program === 4 || isCityPopFmEp; // GM4 Rhodes EP1 · GM5 DX7/FM EP2
  const isGuitar = program >= 24 && program <= 31;
  if (role === 'comp' && isGuitar) return 0; // 吉他扫拨自身 already busy:不再进共享 delay,避免浏览器 echo + reverb 多重叠加。
  if (isCityPopFmEp) return role === 'lead' ? 16 : 12; // SF2 已有内部宽化;外部 echo 只留空气,避免浏览器/ESP32 颗粒重复。
  if (role === 'lead') {
    if (s === 'rnb' || isEP) return 26;  // rnb / 非 GM5 EP lead:dotted-eighth/eighth,very low
    if (s === 'lofi') return 22;         // lofi lead:dusty,very low
    return 0;
  }
  if (role === 'comp') return s === 'lofi' ? 22 : 0; // lofi comp:dusty;其余 off
  return 0;
}

const clampCC = (v: number): number => Math.max(0, Math.min(127, Math.round(v)));

/** 一首一个空间(style + timbreWorld + 是否有 pad)。 */
export function pickSpaceProfile(style: string, world: TimbreWorld | undefined, hasPad: boolean): SpaceProfile {
  const s = style.toLowerCase();
  if (s === 'jazz' || s === 'blues') return 'jazzClub';
  if (s === 'lofi') return 'lofiTapeRoom';
  if (s === 'rnb') return 'rnbPlateRoom';
  // ★ ACG(2026-07-02):久石让/坂本电影钢琴 = 空间感(hall/room),不能 dry-front。去 pad 后靠钢琴自身混响托空间,
  //   否则落进 !hasPad→dryFront(rev×0.62,40/47→25/29 变干)—— 与 MG 空旷 cinematic piano 相反。→ ACG 恒 warmRoom。
  if (s === 'acg') return 'popWarmRoom';
  if (world === 'syntheticSoft') return 'syntheticSoftRoom';
  if (!hasPad) return 'dryFront'; // pop/其它 无 pad → 更干靠前
  return 'popWarmRoom';
}

// 空间对【comp/lead/pad】混响的整体缩放(bass/drum 不受房间影响,守干)。
const SPACE_REVERB_SCALE: Record<SpaceProfile, number> = {
  popWarmRoom: 1.0, lofiTapeRoom: 0.9, rnbPlateRoom: 1.0, jazzClub: 0.72, dryFront: 0.62, syntheticSoftRoom: 1.05,
};

// 角色基底(directive 全局默认的代表值)。pan 由 pan 规则覆盖。
const ROLE_BASE: Record<InstrumentRoleName, RoleMix> = {
  bass: { volume: 65, pan: 64, reverb: 4, chorus: 4 },
  comp: { volume: 90, pan: 52, reverb: 40, chorus: 30 }, // comp 偏高=保"有效响度=CC7×velocity"(comp velocity 低)
  lead: { volume: 82, pan: 64, reverb: 50, chorus: 20 },
  pad: { volume: 76, pan: 88, reverb: 80, chorus: 70 },
  drum: { volume: 100, pan: 64, reverb: 20, chorus: 0 },
};

// ★ melody-forward(2026-06-23,用户:走 A 整编里 motif/旋律声音小)。lead = 主奏,应明显坐在 comp/鼓之上,
//   但原 lead CC7(79-83)反而低于 comp(85-90)→ 旋律被埋。统一抬高 lead CC7,让有效响度(CC7×velocity)
//   回到与【试听(用户认可的平衡)】相当(实测 试听 lead eff≈69 vs 整编 59;+14 把整编拉回 ~69)。
//   作用于所有 Q+N 歌(非仅走 A);确定性,clampCC 兜 127 不溢出。
const LEAD_PRESENCE_BOOST = 14;
// ★ ACG 平衡(2026-06-28 用户:ACG lead eff≈9500 碾全队 eff≈3700 → 一轨很小声)。ACG=solo piano,
//   RH 旋律不该碾 LH 伴奏。lead 减压(present 但不碾)+ comp 抬(高空气 comp 可听)。
//   2026-07-09 SF2-aware 审计:当前 GM32 低频样本本身偏响,旧 bass +8 会让 ACG bass 占 54-63%。
//   所以 LH 托底靠音区/velocity,CC7 反而轻压,避免播放时低频把整首吃掉。
const ACG_LEAD_BOOST = -6;   // 83−6=77 · lead eff≈77×98=7546(仍最响=旋律在上,但不再 3×)
const ACG_COMP_LIFT = 13;    // 85+13=98 · comp 高空气抬可听
const ACG_BASS_LIFT = -12;   // 66−12=54 · 当前 SF2 低频样本已足,压住低频占比

// 程序专属覆盖(directive 各 GM 族代表值;只填该 program 在该 role 的 reverb/chorus/volume,pan 走规则)。
//   key=program;值=Partial(只覆盖给定字段)。按 role 区分的取 role 维。
type ProgOverride = Partial<Record<InstrumentRoleName, Partial<RoleMix>>>;
const PROGRAM_MIX: Record<number, ProgOverride> = {
  // Piano 0
  0: { comp: { volume: 85, reverb: 40, chorus: 6 }, lead: { volume: 83, reverb: 47, chorus: 5 } },
  // 电钢 5(POP/LOFI/RNB 最重要;CityPop/DX7 电钢):SF2 只保干净 24k HL4 FM EP 样本;空间/宽度交给共享 FX。
  5: { comp: { volume: 78, reverb: 56, chorus: 52 }, lead: { volume: 70, reverb: 58, chorus: 50 } },
  6: { comp: { volume: 80, reverb: 29, chorus: 4 }, lead: { volume: 80, reverb: 29, chorus: 4 } }, // 羽管键琴:干、保 attack
  8: { comp: { volume: 80, reverb: 40, chorus: 6 }, lead: { volume: 80, reverb: 45, chorus: 5 } }, // Celesta(归键盘,按钢琴系)
  11: { lead: { volume: 79, reverb: 58, chorus: 32 } }, // 颤音琴:金属延音吃空间
  12: { lead: { volume: 81, reverb: 41, chorus: 7 } },  // 马林巴:保木质 attack
  108: { lead: { volume: 81, reverb: 41, chorus: 7 } }, // 卡林巴
  107: { lead: { volume: 80, reverb: 44, chorus: 10 } }, // 古筝(拨弦,略带空间)
  24: { comp: { volume: 76, reverb: 18, chorus: 0 }, lead: { volume: 78, reverb: 34, chorus: 2 } }, // 尼龙吉他 comp:干、短、保拨弦 attack
  25: { comp: { volume: 78, reverb: 20, chorus: 2 }, lead: { volume: 80, reverb: 38, chorus: 4 } }, // 民谣/钢弦木吉他 comp 不进厚空间,避免扫拨糊
  40: { lead: { volume: 72, reverb: 56, chorus: 8 } },  // 小提琴:留 room,音量低于 sax,避免高频顶出
  // 管乐/萨克斯(气声,中低音区)
  65: { lead: { volume: 78, reverb: 46, chorus: 8 } },
  66: { lead: { volume: 78, reverb: 62, chorus: 0 } },
  67: { lead: { volume: 80, reverb: 58, chorus: 0 } },
  75: { lead: { volume: 80, reverb: 50, chorus: 12 } }, 77: { lead: { volume: 80, reverb: 48, chorus: 10 } },
  // 贝斯
  32: { bass: { volume: 66, reverb: 5, chorus: 2 } }, 33: { bass: { volume: 66, reverb: 5, chorus: 2 } },
  35: { bass: { volume: 66, reverb: 5, chorus: 7 } }, // 无品:chorus 可到 8
  36: { bass: { volume: 64, reverb: 4, chorus: 2 } }, 37: { bass: { volume: 64, reverb: 4, chorus: 2 } },
  38: { bass: { volume: 62, reverb: 2, chorus: 7 } }, // synth bass:很干
  // 暖 pad
  88: { pad: { volume: 77, reverb: 84, chorus: 79 } }, 89: { pad: { volume: 77, reverb: 84, chorus: 79 } },
  90: { pad: { volume: 77, reverb: 84, chorus: 79 } }, 94: { pad: { volume: 77, reverb: 84, chorus: 79 } }, 95: { pad: { volume: 77, reverb: 84, chorus: 79 } },
  // FX pad(空气层,音量低)
  99: { pad: { volume: 64, reverb: 92, chorus: 82 } },
  100: { pad: { volume: 64, reverb: 92, chorus: 82 } }, 102: { pad: { volume: 64, reverb: 92, chorus: 82 } },
  // 合奏弦 pad
  48: { pad: { volume: 74, reverb: 78, chorus: 60 } }, 49: { pad: { volume: 74, reverb: 78, chorus: 60 } }, 50: { pad: { volume: 74, reverb: 80, chorus: 66 } },
};

const isFxPad = (p: number) => p === 98 || p === 99 || p === 100 || p === 102;
const isWarmPad = (p: number) => p === 88 || p === 89 || p === 90 || p === 94 || p === 95;
const isElectricPiano = (p: number) => p === 4 || p === 5; // GM4 Rhodes EP1 · GM5 DX7 EP2(都需 chorus)
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
  const ov = PROGRAM_MIX[program]?.[role];
  if (ov) Object.assign(base, ov);

  // pan 规则:lead/bass/drum 居中;comp 偏左(有 pad 更左);pad 偏右。
  if (role === 'lead' || role === 'bass' || role === 'drum') base.pan = 64;
  else if (role === 'comp') base.pan = hasPad ? 52 : 60;
  else if (role === 'pad') base.pan = 88;

  // 空间:只缩 comp/lead/pad 的混响(bass/drum 守干)。
  if (role === 'comp' || role === 'lead' || role === 'pad') base.reverb = base.reverb * SPACE_REVERB_SCALE[space];

  // 角色护栏(directive guardrails,单角色部分)。
  if (role === 'bass') base.reverb = Math.min(base.reverb, 8);
  if (role === 'drum') base.chorus = 0;
  if (role === 'comp' || role === 'lead') {
    if (isElectricPiano(program)) base.chorus = Math.max(base.chorus, 38); // 电钢必有 chorus
    if (program === 5) {
      base.reverb = Math.max(base.reverb, role === 'lead' ? 56 : 54);
      base.chorus = role === 'lead' ? 50 : 52;
    }
  }
  if (isMalletProgram(program)) base.chorus = 0; // mallet 音准优先:不加 chorus 调制,避免听成微跑音。
  if (program === 7) base.reverb = Math.min(base.reverb, 30); // Clav:干、保 attack(同 harpsichord 6)
  if (role === 'pad' && isFxPad(program)) { base.volume = Math.min(base.volume, 72); base.reverb = Math.max(base.reverb, 84); }

  // ★ melody-forward:lead 抬 CC7 让旋律明显在场(放最后 → 覆盖所有 program 基底 + 覆盖值)。clampCC 兜 127。
  //   ★ ACG 例外:solo piano 的 lead 减压 + comp/bass 抬(见 ACG_* 常量),让 RH 不碾 LH(有效响度均衡)。
  const isAcg = args.style.toLowerCase() === 'acg';
  if (role === 'lead') base.volume = base.volume + (isAcg ? ACG_LEAD_BOOST : LEAD_PRESENCE_BOOST);
  if (isAcg && role === 'comp') base.volume = base.volume + ACG_COMP_LIFT;
  if (isAcg && role === 'bass') base.volume = base.volume + ACG_BASS_LIFT;

  // ★ Layer 2:delay(CC95)send —— 极克制策略(拍板 D)。0 时省略(不发 CC95)。reverb/chorus 值不变(保浏览器平衡)。
  const delay = delaySendForRole(args.style, role, program);
  return { volume: clampCC(base.volume), pan: clampCC(base.pan), reverb: clampCC(base.reverb), chorus: clampCC(base.chorus), ...(delay > 0 ? { delay: clampCC(delay) } : {}) };
}

/**
 * 关系型护栏(需全角色集):pad.reverb ≥ comp.reverb+20 · pad.volume ≤ comp.volume(除非 pad 是唯一和声)·
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
  // pad 不比 comp 响(除非 pad 是唯一和声支撑)
  if (!opts.padIsOnlyHarmony) padOut.volume = clampCC(Math.min(padOut.volume, comp.volume));
  // comp/pad 声像距离 ≥ 22(comp 已偏左~52,pad 推到右)
  if (Math.abs(comp.pan - padOut.pan) < 22) padOut.pan = clampCC(comp.pan + 36);
  out.pad = padOut;
  return out;
}
