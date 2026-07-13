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

// 各 style 编制规则:always 保证 ≥2 件且含 lead + 和声;optional 仍按旧序列抽样。
// POP/RNB/LOFI/JAZZ 若抽样漏掉 drum,会在 lineup 阶段无 rng 补回,保住既有 lead/comp/bass program 序列。
const LINEUP_RULES: Record<string, LineupRule> = {
  jazz: { always: ['lead', 'bass', 'comp'], optional: [{ role: 'drum', prob: 0.85 }] },
  pop: { always: ['lead', 'bass', 'comp'], optional: [{ role: 'drum', prob: 0.9 }, { role: 'pad', prob: 0.6 }] },
  // LOFI rich textures in MG all declare bass:required; keeping bass optional can
  // drop the sustaining anchor and make one-shot/chop bars feel like playback stalls.
  lofi: { always: ['lead', 'bass', 'comp'], optional: [{ role: 'pad', prob: 0.85 }, { role: 'drum', prob: 0.6 }] },
  rnb: { always: ['lead', 'bass', 'comp'], optional: [{ role: 'drum', prob: 0.8 }, { role: 'pad', prob: 0.55 }] }, // neo-soul:Rhodes comp + pocket 鼓
  modal: { always: ['lead', 'pad'], optional: [{ role: 'bass', prob: 0.6 }, { role: 'comp', prob: 0.5 }, { role: 'drum', prob: 0.35 }] },
  // ★ ACG 钢琴主导(MG 久石让/坂本电影钢琴):纯钢琴 lead+comp+原声 bass。
  //   ★ 2026-07-02 用户决策:ACG 【无 pad】(MG ACG 无 pad;pad 改变空间/延音/厚度/和声雾感 → 抹掉纯钢琴空旷感)+
  //     【无鼓】(没有对应织体/编配)→ 只 lead+comp+bass,忠实 MG 纯钢琴音乐(硬合同也只这三轨)。
  acg: { always: ['lead', 'comp', 'bass'], optional: [] },
  default: { always: ['lead', 'comp', 'bass'], optional: [{ role: 'drum', prob: 0.7 }, { role: 'pad', prob: 0.5 }] },
};

// 各 style 各角色的乐器候选(GM program);随 seed 选一。
// ★ lead 走【钢琴 + 舒缓键盘 + 低音区萨克斯 + 轻拨奏】路线(删长笛/小号/合成 lead 等高频刺耳)。
//   2026-06-09 暖路线扩充:在【不刺耳】前提下加宽调色板 —— 尼龙/钢弦/爵士/电吉他元数据(24/25/26/27)、
//   哈蒙德管风琴(16)、大提琴(42)、更多暖 pad(88 New Age / 94 Halo)、古筝(107)/卡林巴(108)。
//   仍不加铜管/长笛/高频合成 lead(守"不刺耳");低音区萨克斯作为 CityPop/Jazz lead 允许。
//   配对一致性由 coherentLeadComp() 在器配层补充规则保证。
const INSTRUMENTS: Record<string, Partial<Record<InstrumentRoleName, number[]>>> = {
  // ★ 2026-06-10:管风琴(16)从 comp 移到【仅 pad】—— Hammond 是【持续音 + 无力度】乐器,我们的 comp 是
  //   衰减型节奏切分 + 力度人性化,吹三音 stab 脱离现实(联网核对:organ comping 少音/持续/无 velocity)。
  //   持续乐器归 pad(持续渲染天然合适);comp 只放【可衰减/拨奏的多音乐器】。capability 见 canPlayComp()。
  // ★ 2026-06-10:暖路线全族扩(用户:钢琴/bass/吉他/pad/synthFX 全加,暖子集 = 跳过失真/过载吉他 + 刺耳 FX)。
  //   按风格 + 能力分配:comp 只放可 comp(键盘/吉他);synthFX(持续)→ pad;吉他 lead+comp;slap/fretless → bass。
  // ★ 2026-07-03:用户决策「不要 jazz guitar」→ GM26 不再进入主动器配池;爵士 lead 聚焦低音区萨克斯/钢琴/电钢。
  // ★ 2026-07-07:旧 Tenor Sax(GM66)与慢弦(GM49)从运行包剔除;萨克斯主动池统一改 GM67 上低音,持续 pad 只保留 GM89。
  // ★ 2026-07-07:GM27 Clean Guitar 太薄 → 运行包改 GM25 Folk/Steel Acoustic Guitar,作为 pop/R&B/modal lead+comp 色彩。
  //   Jazz 默认池不主动放吉他;显式选择 guitarist 时由 family fallback 兜 GM25。
  jazz: { lead: [67, 0], comp: [0, 5], bass: [32], pad: [89], drum: [0] },
  // ★ 2026-07-07:GM67 sax 从非 Jazz 主动 lead 池移出。Pop/RNB/LOFI 的主角应是 piano/EP/soft pluck,
  //   sax 只在 Jazz 高概率出现;Modal 保留极低色彩概率,避免全局“到处都是 sax”。
  pop: { lead: [0, 5, 25, 108], comp: [5, 0], bass: [38, 32], pad: [89], drum: [0] },
  lofi: { lead: [5, 0, 108, 25], comp: [5, 0], bass: [32, 38], pad: [89], drum: [0] },
  rnb: { lead: [5, 0, 25], comp: [5, 0], bass: [38, 32], pad: [89], drum: [0] },
  modal: { lead: [108, 0, 5, 67, 25], comp: [0, 5, 24, 25], bass: [32, 38], pad: [89], drum: [0] },
  // ★ ACG 主体仍是钢琴写作,但 lead/comp 对当前 Aura25 小包开放键盘式色彩:
  //   大钢琴/GU Electric Grand。bass 保持原声,不引入 drum/pad 核心。
  acg: { lead: [0, 5], comp: [0, 5], bass: [32], pad: [89], drum: [0] },
  default: { lead: [0, 5, 25, 108], comp: [0, 5, 25, 24], bass: [32], pad: [89], drum: [0] },
};

const FALLBACK_PROGRAM: Record<InstrumentRoleName, number> = { bass: 32, comp: 0, lead: 0, pad: 89, drum: 0 };
const ROLE_ORDER: InstrumentRoleName[] = ['bass', 'comp', 'pad', 'lead', 'drum'];
const FAMILY_FALLBACK_PROGRAMS: Partial<Record<InstrumentFamily, readonly number[]>> = {
  guitar: [25],
  keyboard: [0, 5],
  bass: [32, 38],
  pad: [89],
  mallet: [108],
  wind: [67],
};

// ★ 2026-06-23(用户:JAZZ 整编"是乐器问题,不要缩,做更高优先级"):候选池全保留(不缩),给地道音色【更高
//   选中权重】。缺省权重=1;现仅 jazz lead/bass 配权重 —— 上低音萨克斯/钢琴三重奏优先;
//   bass upright 为主。**权重只改被选中概率,不改 rng 消耗步数(仍每角色一次抽样)** → 同 seed
//   确定性、非加权风格/角色字节不变;jazz lead/bass 值改变(本意),其余角色因 stream 对齐而不变。
const INSTRUMENT_WEIGHTS: Record<string, Partial<Record<InstrumentRoleName, Record<number, number>>>> = {
  jazz: {
    lead: { 67: 12, 0: 6 },
    bass: { 32: 6 },
  },
  pop: { lead: { 0: 7, 5: 5, 25: 2, 108: 1 } },
  lofi: { lead: { 5: 7, 0: 4, 108: 2, 25: 1 } },
  rnb: { lead: { 5: 8, 0: 4, 25: 2 } },
  modal: { lead: { 108: 4, 0: 3, 5: 2, 67: 1, 25: 1 } },
  acg: {
    lead: { 0: 10, 5: 3 },
    comp: { 0: 10, 5: 3 },
  },
  default: { lead: { 0: 7, 5: 5, 25: 2, 108: 1 } },
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
  autoFilledRoles?: InstrumentRoleName[];             // ★ §4.4:participant 约束无法覆盖必要职责时自动补位的 role(UI 标明)
}

/** ★ participant lineup 约束(qn_takeover 二阶段 §4):由 Band Selection 的「参与乐手/职能」推导。
 *  只约束【哪些 role 入 lineup】+【该 role 限定哪些乐器家族】;具体 GM program 仍由 rng/器配层随机选(§5)。 */
export interface LineupConstraint {
  allowedRoles?: ReadonlySet<InstrumentRoleName>;                              // 只这些 role 可入 lineup(undefined=全默认)
  requiredRoles?: ReadonlySet<InstrumentRoleName>;                             // ★ 这些 role 【必须】出现(selected 乐手保证出声,不被随机掉)
  familyByRole?: Partial<Record<InstrumentRoleName, readonly InstrumentFamily[]>>; // 该 role 候选限定家族(空交集回退不过滤)
}

// —— 乐器类型 + 真实音域(MIDI)——
//   ★ comp 色彩决策按此分流:keyboard 族(钢琴/电钢/Celesta)可 voice 宽和弦色彩(9/13);
//     非键盘 / 超出该乐器音域的色彩 → 交给旋律承载(见 accompanimentRenderer)。
export type InstrumentFamily = 'keyboard' | 'mallet' | 'bass' | 'pad' | 'guitar' | 'strings' | 'wind' | 'percussion' | 'other';
export interface InstrumentInfo { family: InstrumentFamily; range: readonly [number, number]; }

const INSTRUMENT_INFO: Record<number, InstrumentInfo> = {
  0: { family: 'keyboard', range: [21, 108] }, 1: { family: 'keyboard', range: [21, 108] },
  4: { family: 'keyboard', range: [28, 103] }, 5: { family: 'keyboard', range: [28, 103] }, // Rhodes / GU Electric Grand
  6: { family: 'keyboard', range: [29, 89] },  // 羽管键琴(Harpsichord,拨弦键盘)
  7: { family: 'keyboard', range: [36, 96] },  // Clavinet(funk 电翼)
  8: { family: 'keyboard', range: [60, 108] }, // Celesta(高音区键盘)
  16: { family: 'keyboard', range: [36, 96] }, // 哈蒙德管风琴(可 voice 和弦色彩)
  11: { family: 'mallet', range: [53, 89] },   // 颤音琴(F3-F6)
  12: { family: 'mallet', range: [45, 96] },   // 马林巴
  65: { family: 'wind', range: [49, 81] }, 66: { family: 'wind', range: [44, 76] }, 67: { family: 'wind', range: [36, 72] }, // Alto / Tenor / Bari Sax(sounding;lead 不再硬压低八度)
  107: { family: 'mallet', range: [48, 84] }, 108: { family: 'mallet', range: [60, 88] }, // 古筝 / 卡林巴(gentle 拨/击;17-key C4-E6 常用区)
  24: { family: 'guitar', range: [40, 88] }, 25: { family: 'guitar', range: [40, 88] }, 26: { family: 'guitar', range: [40, 88] }, // 尼龙 / 钢弦 / 爵士
  27: { family: 'guitar', range: [40, 88] }, 28: { family: 'guitar', range: [40, 88] }, 31: { family: 'guitar', range: [52, 88] }, // clean / 闷音 / 泛音
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

/** 真实乐器硬音域。角色音区分工另见 preferredRegisterForRole;这里不再把 sax 人为降八度。 */
export function playableRangeForRole(role: InstrumentRoleName, program: number): readonly [number, number] {
  void role;
  return instrumentInfo(program).range;
}

function clampRangeToInstrument(range: readonly [number, number], hard: readonly [number, number]): readonly [number, number] {
  const lo = Math.max(range[0], hard[0]);
  const hi = Math.min(range[1], hard[1]);
  return lo <= hi ? [lo, hi] : hard;
}

/** 角色推荐音区:lead 更宽,comp 更窄且位于中低区,为 lead 留空间;最终仍由硬音域兜底。 */
export function preferredRegisterForRole(role: InstrumentRoleName, program: number): readonly [number, number] {
  const info = instrumentInfo(program);
  const hard = info.range;
  if (role === 'bass') return clampRangeToInstrument([hard[0], Math.min(hard[1], 55)], hard);
  if (role === 'pad') return clampRangeToInstrument([48, 84], hard);
  if (role === 'drum') return [35, 81];

  if (role === 'comp') {
    if (info.family === 'keyboard') return clampRangeToInstrument([48, 72], hard);
    if (info.family === 'mallet') return clampRangeToInstrument([hard[0], Math.min(hard[1], 77)], hard);
    if (info.family === 'guitar') return clampRangeToInstrument([40, 76], hard);
    if (info.family === 'pad') return clampRangeToInstrument([48, 76], hard);
    if (info.family === 'bass') return clampRangeToInstrument([hard[0], Math.min(hard[1], 55)], hard);
    return clampRangeToInstrument([48, 72], hard);
  }

  if (role === 'lead') {
    if (info.family === 'keyboard') return clampRangeToInstrument([48, 96], hard);
    if (info.family === 'mallet') return hard;
    if (info.family === 'guitar') return hard;
    if (info.family === 'wind') return hard;
    if (info.family === 'pad') return clampRangeToInstrument([48, 84], hard);
    return hard;
  }

  return hard;
}

/** 把旋律音高按八度折回该角色/乐器的真实可演奏范围,尽量保留 pitch class。 */
export function fitMidiToProgramRange(value: number, role: InstrumentRoleName, program: number): number {
  const [lo, hi] = playableRangeForRole(role, program);
  let n = Math.max(0, Math.min(127, Math.round(value)));
  while (n > hi) n -= 12;
  while (n < lo) n += 12;
  if (n >= lo && n <= hi) return n;
  return Math.abs(n - lo) <= Math.abs(n - hi) ? lo : hi;
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
  0: '大钢琴', 1: '亮钢琴', 4: '电钢 Rhodes', 5: 'GU Electric Grand', 6: '羽管键琴', 7: 'Clavinet', 8: 'Celesta', 11: '颤音琴', 12: '马林巴',
  16: '哈蒙德管风琴', 24: '尼龙吉他', 25: '民谣木吉他', 26: '爵士吉他', 27: 'Clean 电吉他', 28: '闷音电吉他', 31: '吉他泛音', 42: '大提琴',
  65: '中音萨克斯', 66: '次中音萨克斯', 67: '上低音萨克斯',
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
  0: 'acoustic', 1: 'acoustic', 6: 'acoustic', 8: 'acoustic', 11: 'acoustic', 12: 'acoustic', 32: 'acoustic', 48: 'acoustic', 49: 'acoustic', 65: 'acoustic', 66: 'acoustic', 67: 'acoustic',
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
    case 'acg': return 'acousticPianoBand';
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
  if (style === 'jazz' && rp.pad !== undefined && rp.pad === 91) out.push('jazz≠choir-pad');
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
  if (style === 'jazz') { fix('bass', (p) => [38, 39].includes(p), 32); fix('pad', (p) => p === 91, 89); }
  if (style === 'lofi') fix('comp', (p) => p === 1, 5);
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
  if ([64, 65, 66, 67].includes(lead) && (comp === 4 || comp === 5 || comp === 7)) return true; // CityPop sax over electric keys
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
function programFamily(program: number): InstrumentFamily {
  return INSTRUMENT_INFO[program]?.family ?? 'other';
}

/** ★ 最终音色家族守卫(qn_takeover §5,P1/P2 修复):器配层 orchestration/repair 后,把 participant 家族约束
 *  闭环到【最终 program】—— 某 role 的最终 program 若不在约束家族内,从该 style 的 role 池换一个同家族的(确定性、
 *  无 rng;池里无该家族 → 尽力保持,best-effort)。这是器配层【拥有音色】的一部分,不是生成后 service 覆盖。 */
export function enforceRoleFamilies(
  rp: Record<InstrumentRoleName, number>,
  familyByRole: Partial<Record<InstrumentRoleName, readonly InstrumentFamily[]>> | undefined,
  style: string,
): Record<InstrumentRoleName, number> {
  if (!familyByRole) return rp;
  const inst = INSTRUMENTS[style] ?? INSTRUMENTS.default;
  let out = rp;
  for (const role of Object.keys(familyByRole) as InstrumentRoleName[]) {
    const fams = familyByRole[role];
    const prog = out[role];
    if (!fams || !fams.length || prog === undefined) continue;
    if (fams.includes(programFamily(prog))) continue;          // 已合规
    const match = (inst[role] ?? []).find((p) => fams.includes(programFamily(p)))
      ?? fams.flatMap((family) => FAMILY_FALLBACK_PROGRAMS[family] ?? []).find((p) => fams.includes(programFamily(p)));
    if (match !== undefined) out = out === rp ? { ...rp, [role]: match } : { ...out, [role]: match };
  }
  return out;
}

/** ★ 风格级【硬核心 role】(ACG comp 硬合同 P0):某些风格无论 Band Selection 选什么都必须保留这些 role。
 *  ACG = 钢琴写作模型:lead(旋律/topline)+ comp(独立钢琴伴奏:琶音/空气色彩/和声主体)+ bass。
 *  即便 lead/comp 同用 GM0 Acoustic Grand 也是两个音乐角色、两条轨,不能塌成 lead-only。
 *  drum 不属 MG-faithful ACG 核心(P0 不加鼓,留作单独产品决策)。 */
export function hardRequiredRolesForStyle(style: string): InstrumentRoleName[] {
  return style.toLowerCase() === 'acg' ? ['lead', 'comp', 'bass'] : [];
}

function defaultDrumRequiredForStyle(style: string): boolean {
  return ['pop', 'rnb', 'lofi', 'jazz'].includes(style.toLowerCase());
}

function shouldRestoreDefaultDrum(style: string, constraint?: LineupConstraint): boolean {
  if (!defaultDrumRequiredForStyle(style)) return false;
  if (constraint?.allowedRoles && !constraint.allowedRoles.has('drum')) return false;
  return true;
}

export function pickBandInstrumentation(style: string, rng: Rng, constraint?: LineupConstraint): BandInstrumentation {
  const rule = LINEUP_RULES[style] ?? LINEUP_RULES.default;
  const chosen = new Set<InstrumentRoleName>(rule.always);
  for (const o of rule.optional) if (rng.next() < o.prob) chosen.add(o.role);
  let lineup = ROLE_ORDER.filter((r) => chosen.has(r)); // 规范顺序

  // ★ participant 约束(§4):只保留 participant 覆盖的 role。无约束 → 字节不变(下面 rng 序列一致)。
  const autoFilled: InstrumentRoleName[] = [];
  if (constraint?.allowedRoles || constraint?.requiredRoles) {
    const allowed = constraint.allowedRoles;
    const kept = new Set<InstrumentRoleName>(allowed ? lineup.filter((r) => allowed.has(r)) : lineup);
    // ★ requiredRoles:selected 乐手【必须】出现 —— 默认 lineup 没随机到也补上(P1 修复:选了鼓手一定有 drum)。
    if (constraint.requiredRoles) for (const r of constraint.requiredRoles) kept.add(r);
    // 最小乐队(§4.4):约束后无任何旋律/和声 role(lead/comp)→ 自动补 lead 并标记。
    if (!kept.has('lead') && !kept.has('comp')) { kept.add('lead'); autoFilled.push('lead'); }
    lineup = ROLE_ORDER.filter((r) => kept.has(r)); // 规范顺序
  }

  // ★ 风格硬核心(ACG P0):Band Selection 不能删掉 lead/comp/bass;ACG 排除 drum(不产 drum+lead 而缺 comp)。
  //   缺省 ACG 已含 lead/comp/bass → 无改动(字节不变);被约束删掉时在此无条件补回并标 autoFilled。
  const hardRoles = hardRequiredRolesForStyle(style);
  if (hardRoles.length) {
    const set = new Set<InstrumentRoleName>(lineup);
    for (const r of hardRoles) if (!set.has(r)) { set.add(r); if (!autoFilled.includes(r)) autoFilled.push(r); }
    if (style.toLowerCase() === 'acg') set.delete('drum'); // ACG 核心不含 drum(P0)
    lineup = ROLE_ORDER.filter((r) => set.has(r));
  }

  if (shouldRestoreDefaultDrum(style, constraint) && !lineup.includes('drum')) {
    const set = new Set<InstrumentRoleName>(lineup);
    set.add('drum');
    lineup = ROLE_ORDER.filter((r) => set.has(r));
  }

  const inst = INSTRUMENTS[style] ?? INSTRUMENTS.default;
  const roleProgram = {} as Record<InstrumentRoleName, number>;
  for (const r of lineup) {
    let cands = inst[r] ?? [FALLBACK_PROGRAM[r]];
    // ★ 家族约束:participant 的乐器家族过滤候选(空交集 → 先用可兑现 family fallback)。auto-fill 的 role 不约束家族。
    const fams = constraint?.familyByRole?.[r];
    if (fams && fams.length && !autoFilled.includes(r)) {
      const filtered = cands.filter((p) => fams.includes(programFamily(p)));
      if (filtered.length) cands = filtered;
      else {
        const fallback = fams.flatMap((family) => FAMILY_FALLBACK_PROGRAMS[family] ?? []).filter((p) => fams.includes(programFamily(p)));
        if (fallback.length) cands = fallback;
      }
    }
    roleProgram[r] = pickWeightedProgram(rng, cands, INSTRUMENT_WEIGHTS[style]?.[r]);
  }
  return { lineup, roleProgram, autoFilledRoles: autoFilled.length ? autoFilled : undefined };
}
