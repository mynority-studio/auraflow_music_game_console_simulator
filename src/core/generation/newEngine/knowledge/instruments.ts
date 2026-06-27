// ============================================================
// newEngine · knowledge · Instruments(编制 + 乐器选配)
// ------------------------------------------------------------
// BandEngine 的"乐器"要素:按 style + seed 决定
//   ① 编制 lineup(可变 2–5 件;lead 必有 + ≥1 和声承载 comp/pad/bass);
//   ② 每个角色的具体乐器(GM program)。
// 纯数据 + 确定性挑选(rng)。renderSongFull 只渲 lineup 内的轨;irToMidi 读 program 发声。
// ============================================================

import type { Rng } from '../foundation';
import type { InstrumentRoleName } from '../band/BandSpec';

interface LineupRule {
  always: InstrumentRoleName[];                          // 必有(含 lead + 和声承载)
  optional: { role: InstrumentRoleName; prob: number }[]; // 按概率随 seed 加入
}

// 各 style 编制规则:always 保证 ≥2 件且含 lead + 和声;optional 让编制大小可变。
const LINEUP_RULES: Record<string, LineupRule> = {
  jazz: { always: ['lead', 'bass', 'comp'], optional: [{ role: 'drum', prob: 0.85 }, { role: 'pad', prob: 0.15 }] },
  pop: { always: ['lead', 'bass', 'comp'], optional: [{ role: 'drum', prob: 0.9 }, { role: 'pad', prob: 0.6 }] },
  // LOFI rich textures in MG all declare bass:required; keeping bass optional can
  // drop the sustaining anchor and make one-shot/chop bars feel like playback stalls.
  lofi: { always: ['lead', 'bass', 'comp'], optional: [{ role: 'pad', prob: 0.85 }, { role: 'drum', prob: 0.6 }] },
  rnb: { always: ['lead', 'bass', 'comp'], optional: [{ role: 'drum', prob: 0.8 }, { role: 'pad', prob: 0.55 }] }, // neo-soul:Rhodes comp + pocket 鼓
  modal: { always: ['lead', 'pad'], optional: [{ role: 'bass', prob: 0.6 }, { role: 'comp', prob: 0.5 }, { role: 'drum', prob: 0.35 }] },
  // ★ ACG 钢琴主导(MG 久石让/坂本电影钢琴):钢琴 lead+comp+原声 bass 常驻;暖弦 pad 一点点铺垫。
  //   ★ 2026-06-28 用户决策:ACG 暂【无鼓】(没有对应织体/编配)→ 不进 drum,先做成 MG 那样的纯钢琴音乐。
  acg: { always: ['lead', 'comp', 'bass'], optional: [{ role: 'pad', prob: 0.7 }] },
  default: { always: ['lead', 'comp', 'bass'], optional: [{ role: 'drum', prob: 0.7 }, { role: 'pad', prob: 0.5 }] },
};

// 各 style 各角色的乐器候选(GM program);随 seed 选一。
// ★ lead 走【钢琴 + 舒缓键盘 + 马林巴/颤音琴】路线(删长笛/小号/萨克斯/合成 lead 等高频刺耳)。
//   2026-06-09 暖路线扩充:在【不刺耳】前提下加宽调色板 —— 尼龙/爵士/clean 吉他(24/26/27)、
//   哈蒙德管风琴(16)、大提琴(42)、更多暖 pad(88 New Age / 94 Halo)、古筝(107)/卡林巴(108)。
//   仍不加铜管/萨克斯/合成 lead(守"不刺耳")。配对一致性由 coherentLeadComp() 在器配层补充规则保证。
const INSTRUMENTS: Record<string, Partial<Record<InstrumentRoleName, number[]>>> = {
  // ★ 2026-06-10:管风琴(16)从 comp 移到【仅 pad】—— Hammond 是【持续音 + 无力度】乐器,我们的 comp 是
  //   衰减型节奏切分 + 力度人性化,吹三音 stab 脱离现实(联网核对:organ comping 少音/持续/无 velocity)。
  //   持续乐器归 pad(持续渲染天然合适);comp 只放【可衰减/拨奏的多音乐器】。capability 见 canPlayComp()。
  // ★ 2026-06-10:暖路线全族扩(用户:钢琴/bass/吉他/pad/synthFX 全加,暖子集 = 跳过失真/过载吉他 + 刺耳 FX)。
  //   按风格 + 能力分配:comp 只放可 comp(键盘/吉他);synthFX(持续)→ pad;吉他 lead+comp;slap/fretless → bass。
  // ★ 2026-06-10:吉他全撤(用户:先不要了)—— 吉他 comp 有空洞问题、lead 也撤。元数据保留(随时可回)。
  //   +排箫(75)/尺八(77)暖气声管乐 lead(单音 → 仅 lead;暖、配古筝/卡林巴/lofi 氛围世界)。Clav(7,键盘)留 rnb comp。
  jazz: { lead: [0, 4, 26, 11, 12, 6], comp: [0, 4], bass: [32, 35], pad: [49, 16], drum: [0] },                          // ★ 2026-06-23 +大钢琴(三重奏 lead)+爵士吉他;权重见 INSTRUMENT_WEIGHTS · 无品贝斯
  pop: { lead: [1, 4, 12, 2, 3, 75], comp: [1, 4, 2], bass: [38, 33, 34], pad: [89, 50, 88, 90, 95, 99, 100], drum: [0] }, // +电子大钢琴/酒吧/排箫 lead · 拨片贝斯 · Polysynth/Sweep/Atmosphere/Brightness pad
  lofi: { lead: [4, 11, 12, 108, 6, 75, 77], comp: [4, 5], bass: [33, 39], pad: [89, 91, 94, 92, 98, 102], drum: [0] },     // +羽管/排箫/尺八 lead · Bowed/Crystal/Echoes pad
  rnb: { lead: [4, 5, 11, 2], comp: [4, 5], bass: [33, 39, 35, 36, 37], pad: [89, 91, 16, 99], drum: [0] },               // 无品/slap 贝斯 · Atmosphere pad(★ Clav 7 撤出 comp:亮/打击 funk 音色在 arp 织体+高力度下炸裂、刺耳)
  modal: { lead: [12, 11, 8, 107, 6, 75, 77], comp: [4, 0], bass: [32, 33], pad: [89, 48, 91, 94, 92, 93, 97, 98, 102], drum: [0] }, // +羽管/排箫/尺八 lead · synthFX 氛围 pad
  // ★ ACG 钢琴主导(MG 久石让/坂本电影钢琴):★ 2026-06-28 用户复核「做成纯 solo piano」→ lead/comp 都【只大钢琴 0】
  //   (旋律+伴奏同一台钢琴,不再 lead 电钢/comp 大钢琴的双钢琴错位);bass = 原声/低音提琴(32/43 upright 暖);
  //   pad = 电影暖弦(49 慢弦/48 弦组/50 合成弦/89 暖垫)。
  acg: { lead: [0], comp: [0], bass: [32, 43], pad: [49, 48, 50, 89], drum: [0] },
  default: { lead: [0, 4, 12], comp: [0, 4], bass: [33], pad: [89], drum: [0] },     // 大钢琴/Rhodes/马林巴
};

const FALLBACK_PROGRAM: Record<InstrumentRoleName, number> = { bass: 33, comp: 0, lead: 0, pad: 89, drum: 0 };
const ROLE_ORDER: InstrumentRoleName[] = ['bass', 'comp', 'pad', 'lead', 'drum'];

// ★ 2026-06-23(用户:JAZZ 整编"是乐器问题,不要缩,做更高优先级"):候选池全保留(不缩),给地道音色【更高
//   选中权重】。缺省权重=1;现仅 jazz lead/bass 配权重 —— 钢琴三重奏(piano≫Rhodes>爵士吉他>颤音琴≫marimba/
//   harpsi)、bass upright≫fretless。**权重只改被选中概率,不改 rng 消耗步数(仍每角色一次抽样)** → 同 seed
//   确定性、非加权风格/角色字节不变;jazz lead/bass 值改变(本意),其余角色因 stream 对齐而不变。
const INSTRUMENT_WEIGHTS: Record<string, Partial<Record<InstrumentRoleName, Record<number, number>>>> = {
  jazz: {
    lead: { 0: 8, 4: 5, 26: 4, 11: 2, 12: 0.5, 6: 0.5 }, // 钢琴为主(三重奏感)
    bass: { 32: 6, 35: 1.5 },                            // 原声 upright 为主
  },
};

/** 加权挑 program:无权重表 → 退 `rng.pick`(字节不变路径);有 → 按权重(缺省 1)挑,消耗【一次 `rng.next()`】
 *  (与 pick 同步进度 → 不扰后续角色抽样)。total≤0 兜底退 pick。 */
function pickWeightedProgram(rng: Rng, cands: readonly number[], weights?: Record<number, number>): number {
  if (!weights) return rng.pick(cands);
  const w = cands.map((p) => weights[p] ?? 1);
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) return rng.pick(cands);
  let r = rng.next() * total;
  for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r < 0) return cands[i]; }
  return cands[cands.length - 1];
}

export interface BandInstrumentation {
  lineup: InstrumentRoleName[];                       // 实际编制(2–5,规范顺序)
  roleProgram: Record<InstrumentRoleName, number>;    // 每件乐器的 GM program(仅 lineup 内)
}

// —— 乐器类型 + 真实音域(MIDI)——
//   ★ comp 色彩决策按此分流:keyboard 族(钢琴/电钢/Celesta)可 voice 宽和弦色彩(9/13);
//     非键盘 / 超出该乐器音域的色彩 → 交给旋律承载(见 accompanimentRenderer)。
export type InstrumentFamily = 'keyboard' | 'mallet' | 'bass' | 'pad' | 'guitar' | 'strings' | 'wind' | 'percussion' | 'other';
export interface InstrumentInfo { family: InstrumentFamily; range: readonly [number, number]; }

const INSTRUMENT_INFO: Record<number, InstrumentInfo> = {
  0: { family: 'keyboard', range: [21, 108] }, 1: { family: 'keyboard', range: [21, 108] }, 2: { family: 'keyboard', range: [21, 108] },
  3: { family: 'keyboard', range: [21, 108] }, // 酒吧钢琴(Honky-tonk)
  4: { family: 'keyboard', range: [28, 103] }, 5: { family: 'keyboard', range: [28, 103] }, // Rhodes / FM-EP
  6: { family: 'keyboard', range: [29, 89] },  // 羽管键琴(Harpsichord,拨弦键盘)
  7: { family: 'keyboard', range: [36, 96] },  // Clavinet(funk 电翼)
  8: { family: 'keyboard', range: [60, 108] }, // Celesta(高音区键盘)
  16: { family: 'keyboard', range: [36, 96] }, // 哈蒙德管风琴(可 voice 和弦色彩)
  11: { family: 'mallet', range: [53, 89] },   // 颤音琴
  12: { family: 'mallet', range: [45, 96] },   // 马林巴
  107: { family: 'mallet', range: [48, 84] }, 108: { family: 'mallet', range: [60, 96] }, // 古筝 / 卡林巴(gentle 拨/击)
  24: { family: 'guitar', range: [40, 84] }, 25: { family: 'guitar', range: [40, 86] }, 26: { family: 'guitar', range: [40, 86] }, // 尼龙 / 钢弦 / 爵士
  27: { family: 'guitar', range: [40, 88] }, 28: { family: 'guitar', range: [40, 86] }, 31: { family: 'guitar', range: [55, 96] }, // clean / 闷音 / 泛音
  42: { family: 'strings', range: [36, 76] },  // 大提琴(暖音区独奏)
  75: { family: 'wind', range: [60, 96] }, 77: { family: 'wind', range: [55, 86] }, // 排箫 / 尺八(暖气声管乐,单音 → 仅 lead)
  32: { family: 'bass', range: [28, 67] }, 33: { family: 'bass', range: [28, 67] },
  34: { family: 'bass', range: [28, 60] }, 35: { family: 'bass', range: [28, 67] }, // 拨片 / 无品
  36: { family: 'bass', range: [28, 60] }, 37: { family: 'bass', range: [28, 60] }, // 击弦(slap)1/2
  38: { family: 'bass', range: [24, 60] }, 39: { family: 'bass', range: [24, 60] },
  48: { family: 'pad', range: [40, 100] }, 49: { family: 'pad', range: [40, 100] }, 50: { family: 'pad', range: [36, 100] },
  88: { family: 'pad', range: [36, 96] }, 94: { family: 'pad', range: [36, 96] }, // New Age / Halo(暖 pad)
  89: { family: 'pad', range: [36, 96] }, 91: { family: 'pad', range: [36, 96] },
  90: { family: 'pad', range: [36, 96] }, 92: { family: 'pad', range: [36, 96] }, 93: { family: 'pad', range: [36, 96] }, 95: { family: 'pad', range: [36, 96] }, // Polysynth/Bowed/Metallic/Sweep
  97: { family: 'pad', range: [36, 96] }, 98: { family: 'pad', range: [48, 108] }, 99: { family: 'pad', range: [36, 96] }, 100: { family: 'pad', range: [48, 108] }, 102: { family: 'pad', range: [36, 96] }, // Soundtrack/Crystal/Atmosphere/Brightness/Echoes
};
const DEFAULT_INFO: InstrumentInfo = { family: 'other', range: [36, 96] };

/** GM program → 类型 + 音域(未知回退 other/[36,96])。 */
export function instrumentInfo(program: number): InstrumentInfo {
  return INSTRUMENT_INFO[program] ?? DEFAULT_INFO;
}
/** 是否键盘族(钢琴/电钢/Celesta)→ comp 可 voice 宽和弦色彩。 */
export function isKeyboardFamily(program: number | undefined): boolean {
  return program !== undefined && instrumentInfo(program).family === 'keyboard';
}

// ============================================================
// ★ 乐器演奏能力(器配层据此判角色适配性,2026-06-10;联网核对配器实务)
//   ① 单音 vs 多音:单音乐器(管乐/铜管/独奏弓弦)物理上一次一音 → 不能做 comp/pad(和弦)。
//   ② 持续 vs 衰减:持续乐器(管风琴/合奏弦/合成 pad)无衰减、按住才响、多无 velocity →
//      我们的 comp(衰减型节奏切分 + 力度人性化)在其上脱离现实 → 归 pad(持续渲染天然合适)。
//   ⇒ comp 角色只接【多音 + 可衰减/拨奏】乐器;持续/单音乐器不进 comp。
// ============================================================
function gmRange(a: number, b: number): number[] { const r: number[] = []; for (let i = a; i <= b; i++) r.push(i); return r; }
/** 单音乐器(GM):铜管 56-63 · 簧片+管乐 64-79 · 独奏弓弦 40-42(旋律弓弦,非和弦)。当前池未用,作 guard + 扩库防错。 */
const MONOPHONIC_PROGRAMS: ReadonlySet<number> = new Set([...gmRange(56, 79), 40, 41, 42]);
/** 持续音乐器(无衰减,节奏 comp 不自然 → 归 pad):管风琴 16-23 · 合奏弦/合唱 48-55 · 合成 pad/效果 88-103。 */
const SUSTAINED_PROGRAMS: ReadonlySet<number> = new Set([...gmRange(16, 23), ...gmRange(48, 55), ...gmRange(88, 103)]);

/** 多音乐器(能弹和弦 → 可承担 comp/pad)。单音乐器只能 lead。 */
export function isPolyphonic(program: number): boolean { return !MONOPHONIC_PROGRAMS.has(program); }
/** 持续音乐器(管风琴/合奏弦/合成 pad)= 无衰减、按住才响。 */
export function isSustainedInstrument(program: number): boolean { return SUSTAINED_PROGRAMS.has(program); }
/** 适合做 comp 吗(衰减型节奏和弦 comping)= 多音 + 非持续(钢琴/电钢/吉他/木琴 ✓;管风琴/弦/pad ✗;单音 ✗)。 */
export function canPlayComp(program: number): boolean { return isPolyphonic(program) && !isSustainedInstrument(program); }

/** comp 能力修复(器配层 guard):comp 程序若不可 comp(单音 or 持续)→ 从同 style comp 池换可 comp 的(无则 Rhodes 4)。确定性、无 rng。 */
export function repairCompCapability(rp: Record<InstrumentRoleName, number>, style: string): Record<InstrumentRoleName, number> {
  if (rp.comp === undefined || canPlayComp(rp.comp)) return rp;
  const pool = (INSTRUMENTS[style] ?? INSTRUMENTS.default).comp ?? [];
  return { ...rp, comp: pool.find(canPlayComp) ?? 4 };
}

/** 同族备选音色(供器配层 per-段落切音色):池里与 primary【同族】且 ≠primary 的 program。
 *  同族 = 同一个乐手换声音(键盘 Rhodes↔钢琴 / 效果器开关),非换乐手 → 不影响 voicing 分流。 */
export function sameFamilyAlternates(style: string, role: InstrumentRoleName, primary: number): number[] {
  const inst = INSTRUMENTS[style] ?? INSTRUMENTS.default;
  const pool = inst[role] ?? [];
  const fam = instrumentInfo(primary).family;
  return pool.filter((p) => p !== primary && instrumentInfo(p).family === fam);
}

// —— view-only:GM program → 名(仅覆盖本编制用到的;展示用,不参与生成)——
const GM_NAME: Record<number, string> = {
  0: '大钢琴', 1: '亮钢琴', 2: '电子大钢琴', 3: '酒吧钢琴', 4: '电钢 Rhodes', 5: '电钢 FM', 6: '羽管键琴', 7: 'Clavinet', 8: 'Celesta', 11: '颤音琴', 12: '马林巴',
  16: '哈蒙德管风琴', 24: '尼龙吉他', 25: '钢弦吉他', 26: '爵士吉他', 27: 'Clean 电吉他', 28: '闷音电吉他', 31: '吉他泛音', 42: '大提琴',
  75: '排箫', 77: '尺八', 107: '古筝', 108: '卡林巴',
  32: '立式贝斯', 33: '指弹贝斯', 34: '拨片贝斯', 35: '无品贝斯', 36: '击弦贝斯1', 37: '击弦贝斯2', 38: '合成贝斯1', 39: '合成贝斯2',
  48: '弦乐合奏1', 49: '弦乐合奏2', 50: '合成弦乐1',
  88: 'New Age Pad', 89: '暖 Pad', 90: 'Polysynth Pad', 91: '合唱 Pad', 92: 'Bowed Pad', 93: 'Metallic Pad', 94: 'Halo Pad', 95: 'Sweep Pad',
  97: 'Soundtrack FX', 98: 'Crystal FX', 99: 'Atmosphere FX', 100: 'Brightness FX', 102: 'Echoes FX',
};
/** GM program → 中文名(未知回退 "GM n")。 */
export function gmName(program: number): string {
  return GM_NAME[program] ?? `GM ${program}`;
}

export interface InstrumentCatalogStyle {
  style: string;
  always: InstrumentRoleName[];
  optional: { role: InstrumentRoleName; prob: number }[];
  roles: { role: InstrumentRoleName; programs: number[] }[];
}
/** view-only:导出编制目录(每 style 的编制规则 + 每角色候选乐器)。不参与生成,供 UI 展示。 */
export function getInstrumentCatalog(): InstrumentCatalogStyle[] {
  return Object.keys(LINEUP_RULES).map((style) => {
    const rule = LINEUP_RULES[style];
    const inst = INSTRUMENTS[style] ?? {};
    return {
      style,
      always: rule.always,
      optional: rule.optional,
      roles: ROLE_ORDER.filter((r) => inst[r] && inst[r]!.length > 0).map((r) => ({ role: r, programs: inst[r]! })),
    };
  });
}

// ============================================================
// ★ 音色世界(TimbreWorld)统一性(CODEX instrumentation_combination_rules 吸纳;只在器配层消费)
//   器配层据此【理解音色世界】+ 主动防风格错配。当前 per-style INSTRUMENTS 池已隐式守住 hard-reject,
//   此处把概念显式化:① 分类世界(可观测)② worldMismatches/repair 主动 guard(dormant 但 live,扩库即生效)
//   ③ sameInstrumentPairs 同乐器对(记录不拒绝,钢琴可同时 lead/comp)。纯函数、确定性。
// ============================================================
export type TimbreWorld =
  | 'acousticPianoBand' | 'brightPopHybrid' | 'electricKeys'
  | 'lofiTapeKeys' | 'jazzCombo' | 'modalAmbient' | 'syntheticSoft';

export type TimbreSource = 'acoustic' | 'electric' | 'synth';
const TIMBRE_SOURCE: Record<number, TimbreSource> = {
  0: 'acoustic', 1: 'acoustic', 2: 'acoustic', 3: 'acoustic', 6: 'acoustic', 8: 'acoustic', 11: 'acoustic', 12: 'acoustic', 32: 'acoustic', 48: 'acoustic', 49: 'acoustic',
  24: 'acoustic', 25: 'acoustic', 42: 'acoustic', 75: 'acoustic', 77: 'acoustic', 107: 'acoustic', 108: 'acoustic', // 尼龙/钢弦吉他/大提琴/排箫/尺八/古筝/卡林巴
  4: 'electric', 5: 'electric', 7: 'electric', 33: 'electric', 16: 'electric', 26: 'electric', 27: 'electric', 28: 'electric', 31: 'electric', // 电钢/Clav/哈蒙德/爵士&clean&闷音&泛音吉他
  34: 'electric', 35: 'electric', 36: 'electric', 37: 'electric', // 拨片/无品/slap 贝斯
  38: 'synth', 39: 'synth', 50: 'synth', 88: 'synth', 89: 'synth', 90: 'synth', 91: 'synth', 92: 'synth', 93: 'synth', 94: 'synth', 95: 'synth',
  97: 'synth', 98: 'synth', 99: 'synth', 100: 'synth', 102: 'synth', // synth FX(氛围/水晶/配乐/明亮/回声)
};
/** GM program → 音色来源(acoustic/electric/synth;未知回退 synth)。 */
export function timbreSource(program: number): TimbreSource {
  return TIMBRE_SOURCE[program] ?? 'synth';
}

type RoleProgramView = Partial<Record<InstrumentRoleName, number>>;

/** 据选定 roleProgram + style 分类音色世界(确定性,可观测)。 */
export function classifyTimbreWorld(rp: RoleProgramView, style: string): TimbreWorld {
  const cs = rp.comp !== undefined ? timbreSource(rp.comp) : 'electric';
  const bs = rp.bass !== undefined ? timbreSource(rp.bass) : 'electric';
  switch (style) {
    case 'jazz': return 'jazzCombo';
    case 'modal': return bs === 'synth' ? 'syntheticSoft' : 'modalAmbient';
    case 'rnb': return bs === 'synth' ? 'syntheticSoft' : 'electricKeys';
    case 'lofi': return 'lofiTapeKeys';
    case 'pop':
    default:
      if (cs === 'acoustic' && bs === 'acoustic') return 'acousticPianoBand';
      if (cs === 'acoustic') return 'brightPopHybrid';  // acoustic comp + electric/synth 节奏组
      return bs === 'synth' ? 'syntheticSoft' : 'brightPopHybrid';
  }
}

/** 风格错配检测(hard-reject;当前池已守住 → 多返回空,作主动 guard / 回归网)。 */
export function worldMismatches(rp: RoleProgramView, style: string): string[] {
  const out: string[] = [];
  if (style === 'jazz' && rp.bass !== undefined && [38, 39].includes(rp.bass)) out.push('jazz≠synth-bass');
  if (style === 'lofi' && rp.comp === 1) out.push('lofi≠bright-piano-comp');
  if (style === 'jazz' && rp.pad !== undefined && [89, 91].includes(rp.pad)) out.push('jazz≠choir/warm-pad');
  return out;
}

/** 修复风格错配:从同 style 池换一个【不错配】候选(确定性,无 rng);无错配 → 原对象返回。 */
export function repairWorldMismatches(rp: Record<InstrumentRoleName, number>, style: string): Record<InstrumentRoleName, number> {
  if (worldMismatches(rp, style).length === 0) return rp;
  const pool = INSTRUMENTS[style] ?? INSTRUMENTS.default;
  const out = { ...rp };
  const fix = (role: InstrumentRoleName, bad: (p: number) => boolean, fallback: number) => {
    if (out[role] === undefined || !bad(out[role])) return;
    out[role] = (pool[role] ?? []).find((p) => !bad(p)) ?? fallback;
  };
  if (style === 'jazz') { fix('bass', (p) => [38, 39].includes(p), 32); fix('pad', (p) => [89, 91].includes(p), 49); }
  if (style === 'lofi') fix('comp', (p) => p === 1, 4);
  return out;
}

/** 同乐器对(lead==comp):记录事实,不拒绝(同一乐器可同时承担多角色)。 */
export function sameInstrumentPairs(rp: RoleProgramView): { a: InstrumentRoleName; b: InstrumentRoleName; program: number }[] {
  const out: { a: InstrumentRoleName; b: InstrumentRoleName; program: number }[] = [];
  if (rp.lead !== undefined && rp.lead === rp.comp) out.push({ a: 'lead', b: 'comp', program: rp.lead });
  return out;
}

// ============================================================
// ★ lead↔comp 配对一致性(器配层补充规则,2026-06-09)
//   联网研究(orchestration/arrangement):同族 or 同音色来源 = cohesive("Rhodes melts into layers,
//   随同奏乐器变形");跨族跨源(如 acoustic 木琴 lead + electric 电钢 comp)在同音区竞争 = 糊/不搭。
//   原声钢琴 comp 是百搭暖底(木琴/吉他/弦在其上是经典叠加,register 分离即可)。
//   策略:只修【不搭】对,已和谐的保留(保多样性);优先改 lead(comp=和声床更该稳),
//   lead 池无相配 → 退而改 comp;都没招 → 原样(fail-open)。确定性、无 rng。
//   ⇒ 用户诉求:电钢(electric kbd)comp 自动配电钢/键盘 lead;马林巴与电钢解绑(马林巴改配原声暖底)。
// ============================================================

/** lead 与 comp 音色是否相配(同族 · 或同音色来源 · 或 comp 原声钢琴百搭)。 */
export function leadCompCompatible(lead: number, comp: number): boolean {
  if (lead === comp) return true;
  const lf = instrumentInfo(lead).family, cf = instrumentInfo(comp).family;
  if (lf === cf) return true;                       // 同族(键盘+键盘 / 木琴+木琴 / 吉他+吉他)
  if (comp === 0 || comp === 1) return true;        // 原声钢琴 comp = 百搭暖底
  return timbreSource(lead) === timbreSource(comp); // 同音色来源(都 acoustic / 都 electric / 都 synth)
}

/** 修不搭的 lead↔comp 对(器配层补充规则)。无 lead/comp 或已和谐 → 原对象返回。 */
export function coherentLeadComp(rp: Record<InstrumentRoleName, number>, style: string): Record<InstrumentRoleName, number> {
  const lead = rp.lead, comp = rp.comp;
  if (lead === undefined || comp === undefined) return rp;   // 缺角 → 无需配对
  if (leadCompCompatible(lead, comp)) return rp;             // 已和谐 → 保留多样性
  const pool = INSTRUMENTS[style] ?? INSTRUMENTS.default;
  // 1) 优先把 lead 换成与 comp 相配的同 style 候选(保 comp=和声床;池里若含同 comp 电钢 → 得"电钢配电钢")
  const leadFix = (pool.lead ?? []).find((p) => p !== lead && leadCompCompatible(p, comp));
  if (leadFix !== undefined) return { ...rp, lead: leadFix };
  // 2) lead 池无相配 → 把 comp 换成与 lead 相配的候选
  const compFix = (pool.comp ?? []).find((p) => p !== comp && leadCompCompatible(lead, p));
  if (compFix !== undefined) return { ...rp, comp: compFix };
  return rp;                                                 // 都没招 → 原样(fail-open)
}

/** 按 style + rng 选编制 + 乐器。确定性(同 seed 同结果);lineup 含 lead + ≥1 和声,最少 2 件。 */
export function pickBandInstrumentation(style: string, rng: Rng): BandInstrumentation {
  const rule = LINEUP_RULES[style] ?? LINEUP_RULES.default;
  const chosen = new Set<InstrumentRoleName>(rule.always);
  for (const o of rule.optional) if (rng.next() < o.prob) chosen.add(o.role);
  const lineup = ROLE_ORDER.filter((r) => chosen.has(r)); // 规范顺序

  const inst = INSTRUMENTS[style] ?? INSTRUMENTS.default;
  const roleProgram = {} as Record<InstrumentRoleName, number>;
  for (const r of lineup) {
    const cands = inst[r] ?? [FALLBACK_PROGRAM[r]];
    roleProgram[r] = pickWeightedProgram(rng, cands, INSTRUMENT_WEIGHTS[style]?.[r]);
  }
  return { lineup, roleProgram };
}
