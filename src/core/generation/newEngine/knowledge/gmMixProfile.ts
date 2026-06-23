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
}

export type SpaceProfile = 'popWarmRoom' | 'lofiTapeRoom' | 'rnbPlateRoom' | 'jazzClub' | 'dryFront' | 'syntheticSoftRoom';

const clampCC = (v: number): number => Math.max(0, Math.min(127, Math.round(v)));

/** 一首一个空间(style + timbreWorld + 是否有 pad)。 */
export function pickSpaceProfile(style: string, world: TimbreWorld | undefined, hasPad: boolean): SpaceProfile {
  const s = style.toLowerCase();
  if (s === 'jazz' || s === 'blues') return 'jazzClub';
  if (s === 'lofi') return 'lofiTapeRoom';
  if (s === 'rnb') return 'rnbPlateRoom';
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

// 程序专属覆盖(directive 各 GM 族代表值;只填该 program 在该 role 的 reverb/chorus/volume,pan 走规则)。
//   key=program;值=Partial(只覆盖给定字段)。按 role 区分的取 role 维。
type ProgOverride = Partial<Record<InstrumentRoleName, Partial<RoleMix>>>;
const PROGRAM_MIX: Record<number, ProgOverride> = {
  // Piano 0-3(亮钢琴 1 略干)
  0: { comp: { volume: 85, reverb: 40, chorus: 6 }, lead: { volume: 83, reverb: 47, chorus: 5 } },
  1: { comp: { volume: 81, reverb: 35, chorus: 6 }, lead: { volume: 79, reverb: 42, chorus: 5 } }, // 亮:vol−4 rev−5
  2: { comp: { volume: 85, reverb: 40, chorus: 6 }, lead: { volume: 83, reverb: 47, chorus: 5 } },
  3: { comp: { volume: 85, reverb: 40, chorus: 6 }, lead: { volume: 83, reverb: 47, chorus: 5 } },
  // 电钢 4/5(POP/LOFI/RNB 最重要;chorus 带宽度)
  4: { comp: { volume: 89, reverb: 43, chorus: 58 }, lead: { volume: 81, reverb: 45, chorus: 48 } },
  5: { comp: { volume: 89, reverb: 43, chorus: 58 }, lead: { volume: 81, reverb: 45, chorus: 48 } },
  6: { comp: { volume: 80, reverb: 29, chorus: 4 }, lead: { volume: 80, reverb: 29, chorus: 4 } }, // 羽管键琴:干、保 attack
  7: { comp: { volume: 83, reverb: 23, chorus: 16 } }, // Clav:干、短、靠前
  8: { comp: { volume: 80, reverb: 40, chorus: 6 }, lead: { volume: 80, reverb: 45, chorus: 5 } }, // Celesta(归键盘,按钢琴系)
  11: { lead: { volume: 79, reverb: 58, chorus: 32 } }, // 颤音琴:金属延音吃空间
  12: { lead: { volume: 81, reverb: 41, chorus: 7 } },  // 马林巴:保木质 attack
  108: { lead: { volume: 81, reverb: 41, chorus: 7 } }, // 卡林巴
  107: { lead: { volume: 80, reverb: 44, chorus: 10 } }, // 古筝(拨弦,略带空间)
  // 管乐(气声,中音区)
  75: { lead: { volume: 80, reverb: 50, chorus: 12 } }, 77: { lead: { volume: 80, reverb: 48, chorus: 10 } },
  16: { pad: { volume: 71, reverb: 51, chorus: 65 } }, // 管风琴:仅 pad,支撑不抢
  // 贝斯
  32: { bass: { volume: 66, reverb: 5, chorus: 2 } }, 33: { bass: { volume: 66, reverb: 5, chorus: 2 } },
  35: { bass: { volume: 66, reverb: 5, chorus: 7 } }, // 无品:chorus 可到 8
  34: { bass: { volume: 64, reverb: 4, chorus: 3 } }, 36: { bass: { volume: 64, reverb: 4, chorus: 2 } }, 37: { bass: { volume: 64, reverb: 4, chorus: 2 } },
  38: { bass: { volume: 62, reverb: 2, chorus: 7 } }, 39: { bass: { volume: 62, reverb: 2, chorus: 7 } }, // synth bass:很干
  // 暖 pad
  88: { pad: { volume: 77, reverb: 84, chorus: 79 } }, 89: { pad: { volume: 77, reverb: 84, chorus: 79 } },
  90: { pad: { volume: 77, reverb: 84, chorus: 79 } }, 94: { pad: { volume: 77, reverb: 84, chorus: 79 } }, 95: { pad: { volume: 77, reverb: 84, chorus: 79 } },
  // FX pad(空气层,音量低)
  98: { pad: { volume: 64, reverb: 92, chorus: 82 } }, 99: { pad: { volume: 64, reverb: 92, chorus: 82 } },
  100: { pad: { volume: 64, reverb: 92, chorus: 82 } }, 102: { pad: { volume: 64, reverb: 92, chorus: 82 } },
  // 合奏弦 pad
  48: { pad: { volume: 74, reverb: 78, chorus: 60 } }, 49: { pad: { volume: 74, reverb: 78, chorus: 60 } }, 50: { pad: { volume: 74, reverb: 80, chorus: 66 } },
};

const isFxPad = (p: number) => p === 98 || p === 99 || p === 100 || p === 102;
const isWarmPad = (p: number) => p === 88 || p === 89 || p === 90 || p === 94 || p === 95;
const isElectricPiano = (p: number) => p === 4 || p === 5;

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
  if (role === 'comp' || role === 'lead') { if (isElectricPiano(program)) base.chorus = Math.max(base.chorus, 38); } // 电钢必有 chorus
  if (program === 7) base.reverb = Math.min(base.reverb, 30);          // Clav 干
  if (program === 12 || program === 108) base.chorus = Math.min(base.chorus, 16); // 马林巴/卡林巴 少 chorus
  if (role === 'pad' && isFxPad(program)) { base.volume = Math.min(base.volume, 72); base.reverb = Math.max(base.reverb, 84); }

  // ★ melody-forward:lead 抬 CC7 让旋律明显在场(放最后 → 覆盖所有 program 基底 + 覆盖值)。clampCC 兜 127。
  if (role === 'lead') base.volume = base.volume + LEAD_PRESENCE_BOOST;

  return { volume: clampCC(base.volume), pan: clampCC(base.pan), reverb: clampCC(base.reverb), chorus: clampCC(base.chorus) };
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
