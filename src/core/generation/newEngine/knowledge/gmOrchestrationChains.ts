// ============================================================
// newEngine · knowledge · GM128 链式协同器配(gm128_chain_orchestration_directive,2026-06-10)
// ------------------------------------------------------------
// 器配层【拥有】最终 GM program 选择:不再让 BandEngine 逐角色独立抽。链优先级:
//   选音色世界 → comp 先定 → lead 按 comp 兼容 → bass 按世界 → pad 按世界+pair → drum kit。
//   目标 = 一个房间里的一支乐队(同族/可兼容),不是 5 个角色各自乱抽不相干的 GM patch。
// ★ provisional-优先策略(directive `provisional` 契约):用 BandEngine 已 seed-变化的抽签当候选,
//   兼容则保留(守多样性),不兼容才让链表赢(comp 取首个合法 → 永远落 EP4,Clav/羽管 comp 不被选中)。
//   纯函数、确定性(不抽 rng;世界由 provisional 推导)。GM 家族分类是 KB 数据,兼容性是我们的编配规则。
// ============================================================

import type { InstrumentRoleName } from '../band/BandSpec';
import type { Rng } from '../foundation';
import {
  instrumentInfo, isBassRoleProgram, isSustainedInstrument, canPlayComp, leadCompCompatible, timbreSource,
  type TimbreWorld,
} from './instruments';

export interface ChainProfile {
  id: string;
  world: TimbreWorld;
  compPriority: number[];                  // comp 候选(优先序;取首个 canPlayComp)
  leadByComp: Record<number, number[]>;    // 给定 comp → lead 优先序(同族/同源最佳配对)
  bassPriority: number[];
  padPriority: number[];
  drumPriority: number[];                  // 通道10 Dream GM128 drum kit program(0/8/16/24/25/32/40...)
}

/**
 * 可听的「乐队编制世界」。这不是新的 GM 音色分类，而是把真实编配中会同时出现的
 * 主奏、和声、低音与鼓手关系固化成总谱模板。它由 style + Band 的既有 seed 候选 +
 * Arranger 已选的 groove 合同确定，因此不额外消耗随机数，也不扰动 grammar/texture 子流。
 */
export type EnsembleWorldId =
  | 'cityPopElectricBand'
  | 'cityPopPianoBand'
  | 'jazzPianoTrio'
  | 'jazzSaxQuartet'
  | 'smoothJazzQuartet'
  | 'lofiBoomBap'
  | 'rnbPocket'
  | 'acgPianoTrio';

// —— 6 条链表(directive Chain Profiles,忠实保留;0-based GM)——
export const CHAIN_PROFILES: Record<string, ChainProfile> = {
  // RNB / neo-soul / city-pop / 暖 pop
  electricKeys: {
    id: 'electricKeys', world: 'electricKeys',
    compPriority: [5, 25],
    leadByComp: { 5: [5, 0, 25, 108], 25: [5, 0, 25, 108] },
    bassPriority: [38, 32], padPriority: [89], drumPriority: [25, 8],
  },
  // LOFI / chill
  lofiTapeKeys: {
    id: 'lofiTapeKeys', world: 'lofiTapeKeys',
    compPriority: [5, 24, 25, 0],
    leadByComp: { 5: [5, 0, 108, 25], 24: [108, 5, 0, 25], 25: [5, 0, 108, 25], 0: [0, 5, 108, 25] },
    bassPriority: [32, 38], padPriority: [89], drumPriority: [25, 8],
  },
  // pop 抒情 / 简单原声乐队
  acousticPianoBand: {
    id: 'acousticPianoBand', world: 'acousticPianoBand',
    compPriority: [0, 5, 25],
    leadByComp: { 0: [0, 5, 25, 108], 5: [5, 0, 25, 108], 25: [0, 5, 25, 108] },
    bassPriority: [32, 38], padPriority: [89], drumPriority: [8, 25],
  },
  // ACG PIANOSONG:三轨只是左右手/旋律职责，发声统一为一架钢琴；最终 CC0+PC 调色由器配层整首锁定。
  acgKeyboardBand: {
    id: 'acgKeyboardBand', world: 'acousticPianoBand',
    compPriority: [0],
    leadByComp: {
      0: [0],
    },
    bassPriority: [0], padPriority: [89], drumPriority: [8],
  },
  // jazz
  jazzCombo: {
    id: 'jazzCombo', world: 'jazzCombo',
    compPriority: [0, 5, 25],
    leadByComp: { 0: [66, 67, 0], 5: [66, 67, 5, 0], 25: [66, 67, 0, 25] },
    bassPriority: [32], padPriority: [89], drumPriority: [40, 8],
  },
  // 软 synth-pop / modal synthetic
  syntheticSoft: {
    id: 'syntheticSoft', world: 'syntheticSoft',
    compPriority: [5, 25],
    leadByComp: { 5: [5, 0, 108, 25], 25: [5, 0, 25, 108] },
    bassPriority: [38, 32], padPriority: [89], drumPriority: [25, 8],
  },
  // modal / static / ambient
  modalAmbient: {
    id: 'modalAmbient', world: 'modalAmbient',
    compPriority: [0, 5, 24, 25],
    leadByComp: { 0: [108, 0, 67, 25], 5: [5, 108, 67, 25], 24: [108, 67, 25], 25: [108, 25, 67] },
    bassPriority: [32, 38], padPriority: [89], drumPriority: [25, 40, 8],
  },

  // ── 实战编制模板(资料落地) ─────────────────────────────────────────────
  // CityPop:DX/FM electric piano + single bass voice + Room-kit dance band.
  // Sax 不在默认池中，避免它替代键盘成为 CityPop 的常驻主角。
  cityPopElectricBand: {
    id: 'cityPopElectricBand', world: 'electricKeys',
    compPriority: [5, 0],
    leadByComp: { 5: [5, 0], 0: [0, 5] },
    bassPriority: [33, 32, 38], padPriority: [89], drumPriority: [8],
  },
  // CityPop 的抒情/钢琴向分支：只保留钢琴、原声/指弹低音与同一支节奏组。
  cityPopPianoBand: {
    id: 'cityPopPianoBand', world: 'acousticPianoBand',
    compPriority: [0, 5],
    leadByComp: { 0: [0, 5], 5: [5, 0] },
    bassPriority: [0, 32, 33], padPriority: [89], drumPriority: [8],
  },
  // 爵士钢琴三重奏：钢琴、原声贝斯、Brush/Ride 语汇。lead/comp 是双轨钢琴职责，
  // 而不是凭空加一支乐器；这里也明确不引入合成贝斯或 pad。
  jazzPianoTrio: {
    id: 'jazzPianoTrio', world: 'jazzCombo',
    compPriority: [0], leadByComp: { 0: [0] },
    bassPriority: [32], padPriority: [89], drumPriority: [40, 8],
  },
  // 传统小编制的萨克斯前线：次中音/上低音 + 钢琴 comp + 原声贝斯 + 鼓。
  jazzSaxQuartet: {
    id: 'jazzSaxQuartet', world: 'jazzCombo',
    compPriority: [0, 5], leadByComp: { 0: [66, 67], 5: [66, 67] },
    bassPriority: [32], padPriority: [89], drumPriority: [40, 8],
  },
  // Dave Koz 一类 smooth jazz：萨克斯与柔和 electric piano，不能再与 swing/brush 强绑。
  smoothJazzQuartet: {
    id: 'smoothJazzQuartet', world: 'electricKeys',
    compPriority: [5, 0], leadByComp: { 5: [66, 65], 0: [66, 65] },
    bassPriority: [33, 32], padPriority: [89], drumPriority: [8],
  },
  // Lofi boom-bap：电钢/钢琴采样感 + 原声或 finger bass。808 鼓机的选择仍由 groove 合同下发。
  lofiBoomBap: {
    id: 'lofiBoomBap', world: 'lofiTapeKeys',
    compPriority: [5, 0], leadByComp: { 5: [5, 0], 0: [0, 5] },
    bassPriority: [32, 33], padPriority: [89], drumPriority: [25, 8],
  },
  // Neo-soul/RNB：FM EP + synth bass 的单一低频主角；pad 是段落色彩，不与 comp 常驻叠厚。
  rnbPocket: {
    id: 'rnbPocket', world: 'electricKeys',
    compPriority: [5], leadByComp: { 5: [5, 0] },
    bassPriority: [38], padPriority: [89], drumPriority: [25, 8],
  },
  // ACG PIANOSONG：双手/旋律职责分轨，但维持同一架钢琴的音色世界；最终 CC0+PC 调色由器配层整首锁定。
  acgPianoTrio: {
    id: 'acgPianoTrio', world: 'acousticPianoBand',
    compPriority: [0], leadByComp: { 0: [0] },
    bassPriority: [0], padPriority: [89], drumPriority: [8],
  },
};

// 7 个 TimbreWorld → 6 条 profile(brightPopHybrid 折进 acousticPianoBand:其 comp 多为原声暖底)。
const PROFILE_BY_WORLD: Record<TimbreWorld, string> = {
  acousticPianoBand: 'acousticPianoBand', brightPopHybrid: 'acousticPianoBand',
  electricKeys: 'electricKeys', lofiTapeKeys: 'lofiTapeKeys', jazzCombo: 'jazzCombo',
  modalAmbient: 'modalAmbient', syntheticSoft: 'syntheticSoft',
};

// —— 合法性谓词(链表给优先序,谓词给合法性;两者解耦)——
// 默认刺耳 lead 家族(directive hard-reject;暖路线本就不含,作 guard):铜管/簧片 56-71 · 独奏小提琴 40 ·
//   失真/过载吉他 29-30 · 合唱 52 · 激进合成 lead 80-87。★ 排箫/尺八 72-79 是暖气声,不在此列。
function inRange(p: number, a: number, b: number): boolean { return p >= a && p <= b; }
export function isHarshLead(program: number): boolean {
  return (inRange(program, 56, 71) && ![64, 65, 66, 67].includes(program)) || program === 40 || program === 29 || program === 30
    || program === 52 || inRange(program, 80, 87);
}
/** GM0 的钢琴左手可承担 bass 职能，但只在明确列入模板的 piano-led 编制中允许。 */
function canPlayBassRole(p: number): boolean { return isBassRoleProgram(p); }
function isSynthBass(p: number): boolean { return p === 38 || p === 39; }
/** pad 角色合法 = 持续音(管风琴/弦/合成 pad)或 pad/strings 家族。 */
function canPlayPad(p: number): boolean {
  const fam = instrumentInfo(p).family;
  return isSustainedInstrument(p) || fam === 'pad' || fam === 'strings';
}
/** 该世界是否排斥此 pad(jazz 拒合唱 pad;GM89 是当前唯一小包持续垫,保留作 fallback)。 */
function worldRejectsPad(world: TimbreWorld, p: number): boolean {
  return world === 'jazzCombo' && p === 91;
}

function drumKitForStyle(style: string, profile: ChainProfile, contractKitProgram?: number): number {
  if (contractKitProgram === 8 || contractKitProgram === 25 || contractKitProgram === 40) return contractKitProgram;
  const s = style.toLowerCase();
  if (s === 'pop' || s === 'acg') return 8;          // Room kit:CityPop / modern POP / piano-led ACG.
  if (s === 'rnb' || s === 'lofi') return 25;        // TR-808 kit:machine-pocket styles only.
  if (s === 'jazz' || s === 'blues') return 40;      // Brush kit:jazz combo vocabulary.
  return profile.drumPriority[0] ?? 8;
}

/**
 * 选链 profile:requested(由 provisional 推导的世界)优先;否则按 style 表 + rng(pop 分支)。
 * directive World Selection;`requested` 给定时确定性、不抽 rng。
 */
export function chooseOrchestrationChain(style: string, rng: Rng, requested?: TimbreWorld): ChainProfile {
  const s = style.toLowerCase();
  if (s === 'acg') return CHAIN_PROFILES.acgKeyboardBand;
  if (requested) return CHAIN_PROFILES[PROFILE_BY_WORLD[requested]];
  if (s === 'jazz' || s === 'blues') return CHAIN_PROFILES.jazzCombo;
  if (s === 'lofi') return CHAIN_PROFILES.lofiTapeKeys;
  if (s === 'rnb') return CHAIN_PROFILES.electricKeys;
  if (s === 'modal') return CHAIN_PROFILES.modalAmbient;
  if (s === 'pop') return rng.pick([CHAIN_PROFILES.acousticPianoBand, CHAIN_PROFILES.electricKeys, CHAIN_PROFILES.syntheticSoft]);
  return CHAIN_PROFILES.acousticPianoBand;
}

/** 据 style + provisional【确定性】推导链世界(器配集成用;不抽 rng → 不洗 timbre 序列)。 */
export function deriveChainWorld(style: string, provisional: Partial<Record<InstrumentRoleName, number>>): TimbreWorld {
  const s = style.toLowerCase();
  if (s === 'jazz' || s === 'blues') return 'jazzCombo';
  if (s === 'lofi') return 'lofiTapeKeys';
  const bassSynth = provisional.bass !== undefined && timbreSource(provisional.bass) === 'synth';
  if (s === 'modal') return bassSynth ? 'syntheticSoft' : 'modalAmbient';
  if (s === 'rnb') return bassSynth ? 'syntheticSoft' : 'electricKeys';
  // ★ 2026-06-28 ACG 恒原声钢琴世界(MG 久石让/坂本):钢琴 comp/lead + 原声 bass + 弦 pad;绝不合成贝斯。
  if (s === 'acg') return 'acousticPianoBand';
  // pop / default:comp 原声 → acousticPianoBand;bass 合成 → syntheticSoft;否则电钢世界
  if (provisional.comp !== undefined && timbreSource(provisional.comp) === 'acoustic') return 'acousticPianoBand';
  if (bassSynth) return 'syntheticSoft';
  return 'electricKeys';
}

/**
 * 从已有 seed 候选和 arranger groove 合同选真实编制模板。这里故意不调用 rng：
 * BandEngine 已完成本曲随机化，器配层只把候选收敛为一支听起来合理的乐队。
 */
export function chooseEnsembleWorld(
  style: string,
  provisional: Partial<Record<InstrumentRoleName, number>>,
  grooveContractId?: string,
): EnsembleWorldId | undefined {
  switch (style.toLowerCase()) {
    case 'pop':
      return provisional.comp === 0 && provisional.bass !== 38 ? 'cityPopPianoBand' : 'cityPopElectricBand';
    case 'jazz':
      if (grooveContractId === 'jazz_smooth_backbeat') return 'smoothJazzQuartet';
      return provisional.lead === 0 ? 'jazzPianoTrio' : 'jazzSaxQuartet';
    case 'lofi': return 'lofiBoomBap';
    case 'rnb': return 'rnbPocket';
    case 'acg': return 'acgPianoTrio';
    default:
      // modal/default 尚未定义成套的现实编制资料，保持既有 general chain，绝不误套 CityPop。
      return undefined;
  }
}

/** 模板是否允许该角色换到 program；用于限制 chorus 的同族换音色不越过总谱。 */
export function ensembleAllowsRoleProgram(world: EnsembleWorldId | undefined, role: InstrumentRoleName, program: number): boolean {
  if (!world) return true;
  const profile = CHAIN_PROFILES[world];
  if (role === 'comp') return profile.compPriority.includes(program);
  if (role === 'bass') return profile.bassPriority.includes(program);
  if (role === 'pad') return profile.padPriority.includes(program);
  if (role === 'lead') return Object.values(profile.leadByComp).some((programs) => programs.includes(program));
  // Drum kit 是 arranger 的 groove 合同主权，不能由器配模板否决。
  return true;
}

/**
 * 兼容性评分(tie-breaker / 校验用)。relation = lead-comp | pad-comp | bass-comp。
 *   同程序 > 同族 > 同音色来源 > 原声钢琴百搭;带具体加成/惩罚。越高越搭。
 */
export function scoreProgramPair(a: number, b: number, relation: 'lead-comp' | 'pad-comp' | 'bass-comp'): number {
  let s = 0;
  if (a === b) s += 100;
  const fa = instrumentInfo(a).family, fb = instrumentInfo(b).family;
  if (fa === fb) s += 60;
  if (timbreSource(a) === timbreSource(b)) s += 40;
  if (relation === 'lead-comp') {
    if (b === 0 || b === 1) s += 30;                                   // 原声钢琴 comp 百搭
    if ((b === 4 || b === 5) && (a === 4 || a === 5 || a === 11)) s += 25; // Rhodes/FM + Rhodes/FM/颤音
    if ((a === 64 || a === 65 || a === 66 || a === 67) && (b === 4 || b === 5 || b === 7)) s += 30; // CityPop sax + electric keys
    if (b === 6 && (a === 11 || a === 12 || a === 108)) s += 25;        // 羽管键琴 + 颤音/马林巴/卡林巴
    if ((b === 0 || b === 1) && (a === 11 || a === 12)) s += 15;        // 原声钢琴 + 木琴
    if ((a === 11 || a === 12 || a === 107 || a === 108) && (b === 4 || b === 5 || b === 7)) s -= 20; // 木琴 lead + 电钢 comp(除非世界允许)
    if (isHarshLead(a)) s -= 200;                                       // 刺耳 lead 默认重罚
  } else if (relation === 'pad-comp') {
    if (!canPlayPad(a)) s -= 200;
  } else if (relation === 'bass-comp') {
    if (!canPlayBassRole(a)) s -= 200;
  }
  return s;
}

export interface OrchestrationResult {
  world: TimbreWorld;
  profileId: string;
  ensembleWorld?: EnsembleWorldId;
  roleProgram: Record<InstrumentRoleName, number>;
  decisions: string[];
}

// 占位 Rng:orchestrate 总会推导/传入 requestedWorld → chooseOrchestrationChain 不抽 rng,此占位仅满足类型。
const FALLBACK_RNG: Rng = { next: () => 0, int: () => 0, pick: <T>(xs: readonly T[]): T => xs[0] };

/**
 * 链式协同选 program(器配层拥有)。provisional 兼容则保留(守 seed 多样性),否则链表赢。
 *   comp 先定 → lead 按 comp → bass 按世界 → pad 按世界+pair → drum。确定性:除非显式传 rng 且某角色无 provisional,
 *   否则不抽 rng(provisional/首个合法即定)→ 不扰 timbre 子流序列。
 */
export function orchestrateRolePrograms(args: {
  style: string;
  lineup: readonly InstrumentRoleName[];
  rng?: Rng;
  requestedWorld?: TimbreWorld;
  ensembleWorld?: EnsembleWorldId;
  drumKitProgram?: number;
  provisional?: Partial<Record<InstrumentRoleName, number>>;
}): OrchestrationResult {
  const { style, lineup, provisional = {} } = args;
  const requested = args.requestedWorld ?? deriveChainWorld(style, provisional);
  const profile = args.ensembleWorld
    ? CHAIN_PROFILES[args.ensembleWorld]
    : style.toLowerCase() === 'acg'
    ? CHAIN_PROFILES.acgKeyboardBand
    : chooseOrchestrationChain(style, args.rng ?? FALLBACK_RNG, requested);
  const has = (r: InstrumentRoleName): boolean => lineup.includes(r);
  const decisions: string[] = [
    args.ensembleWorld ? `ensemble=${args.ensembleWorld}` : 'ensemble=legacy-chain',
    `world=${profile.world} profile=${profile.id}`,
  ];
  const rp = {} as Record<InstrumentRoleName, number>;

  // comp 先定(衰减节奏和弦能力 = canPlayComp;且须属本世界 compPriority —— comp 定义世界,故必须世界内)
  if (has('comp')) {
    const pv = provisional.comp;
    if (pv !== undefined && canPlayComp(pv) && profile.compPriority.includes(pv)) { rp.comp = pv; decisions.push(`comp keep GM${pv}`); }
    else { rp.comp = profile.compPriority.find(canPlayComp) ?? pv ?? 4; decisions.push(`comp chain GM${rp.comp}`); }
  }

  // lead 按 comp 兼容(同族/同源最佳配对;拒刺耳)
  if (has('lead')) {
    const comp = rp.comp;
    const cands = (comp !== undefined && profile.leadByComp[comp]) ? profile.leadByComp[comp]
      : (comp !== undefined ? [comp, 108, 0] : profile.compPriority);
    const ok = (p: number): boolean => !isHarshLead(p) && (comp === undefined || leadCompCompatible(p, comp));
    const pv = provisional.lead;
    if (pv !== undefined && cands.includes(pv) && ok(pv)) { rp.lead = pv; decisions.push(`lead keep GM${pv}`); }
    else { rp.lead = cands.find(ok) ?? cands[0] ?? pv ?? 0; decisions.push(`lead chain GM${rp.lead}`); }
  }

  // bass 按世界(jazz 拒合成贝斯；piano-led 模板可让 GM0 左手承担 bass 职能)
  if (has('bass')) {
    const ok = (p: number): boolean => canPlayBassRole(p) && !(profile.world === 'jazzCombo' && isSynthBass(p));
    const pv = provisional.bass;
    if (pv !== undefined && profile.bassPriority.includes(pv) && ok(pv)) { rp.bass = pv; decisions.push(`bass keep GM${pv}`); }
    else { rp.bass = profile.bassPriority.find(ok) ?? pv ?? 33; decisions.push(`bass chain GM${rp.bass}`); }
  }

  // pad 按世界 + comp/lead pair(持续/pad 家族;世界排斥则换)
  if (has('pad')) {
    const ok = (p: number): boolean => canPlayPad(p) && !worldRejectsPad(profile.world, p);
    const pv = provisional.pad;
    if (pv !== undefined && profile.padPriority.includes(pv) && ok(pv)) { rp.pad = pv; decisions.push(`pad keep GM${pv}`); }
    else { rp.pad = profile.padPriority.find(ok) ?? pv ?? 89; decisions.push(`pad chain GM${rp.pad}`); }
  }

  // drum kit:Dream GM128 由 ch10 Program Change 选 kit;不使用 bank select。
  if (has('drum')) {
    rp.drum = drumKitForStyle(style, profile, args.drumKitProgram) ?? provisional.drum ?? 8;
    decisions.push(`drum kit GM${rp.drum}`);
  }

  return { world: profile.world, profileId: profile.id, ensembleWorld: args.ensembleWorld, roleProgram: rp, decisions };
}
