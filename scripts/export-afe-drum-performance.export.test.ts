// SPDX-License-Identifier: GPL-3.0-only
// ============================================================
// export-afe-drum-performance — planDrumPerformance 逐位对账 golden exporter
// （P2-10A 拆步4；方案 A 独立，零触碰 src/）
// ------------------------------------------------------------
// 拆步5 的 C 主体 `afe_plan_drum_performance`（零 double）需要一个**先于实现**冻结的逐位
// 对账靶：本 exporter 手构造 fixtures、直调**生产** planDrumPerformance，把
// (输入, 期望 25 字段合同) 成对投影成 core/tests/golden/afe_drum_performance_golden.json，
// 由 core 侧 gen_drum_performance_golden.py 生成 C golden .h（对锁步1 冻结的
// afe_drum_performance_contract_t）。
//
// ★★ 合同池的核心不变量（**绝不覆盖 id 串**）
//   合同 id 串 ↔ contract enum 的绑定是拆步3 冻结的：C 侧 `afe_drum_feel_for_contract(enum)`
//   是按 enum 索引的 effective 表，而 TS 侧 `drumFeelProfileIdForContract` 按 **id 串** 查
//   `PROFILE_BY_CONTRACT_ID`。若合成一个新 id 串，TS 会落到 fallback 子句、C 仍取 enum 表值
//   ⇒ **期望输出不可表示**。故池条目一律「克隆某个真合同 + 只覆盖结构字段」
//   （density / grid / rhythmSwingSource / drum.{kitProgram,四个 family}），
//   这些字段不改变 feel 映射（21 个真 id 全部命中 explicit 表、fallback 不可达），
//   却正好驱动 timing safety、complexity 与 baseFamily —— 两侧因此始终一致。
//   本不变量在 buildContractPool() 里 fail-closed 断言。
//
// ★ 覆盖设计（设计门 §6.1 逐条）
//   A 27 family × 4 可达 role（合成合同显式 family 驱动 contractFamilyForRole）
//   B roleForSection 完整域：11 个 SectionFunctionTag + undefined = 12 形态
//   C OpeningDrumEntry 9 值 + absent = 10 形态（仅首段生效）
//   D 21 合同 → feel profile 映射
//   E baseFamily fallback 全叶 × style 分派（jazz 5 叶 / rnb 5 / lofi 4 分岔 / citypop 2 /
//     ballad|sparse / jpop|active / 兜底 pop-backbeat），含**子串优先级**（见下）
//   F score boundary 选择规则：有跨段候选 vs 只有自指候选
//   G complexity / intensity 上下钳位（lift +1 触顶、breakdown -1 触底）
//   H timing safety 45 格（3 effective swing × 5 grid × 3 density）
//
// ★ 覆盖缺口记账（有断言看守，KB 一改即转红）
//   [不可达] **单个 id 同时含两个同分支关键字**（如同含 `smooth` 与 `ballad`）：v5 21 个合同
//     无此形态，而合成 id 串会破坏上述 id↔enum 不变量。**改用真 id × 7 个 style 的组合**
//     覆盖子串优先级（`lofi_halftime_dusty` 同含 halftime 与 dusty；`lofi_lazy_dilla` 在
//     LOFI 下取 lazy、在 RNB 下取 dilla；`pop_ballad_halftime` 在 JAZZ 下取 ballad）。
//     exporter 断言「21 个 id 内无同分支双关键字」，一旦 KB 新增即转红要求补 fixture。
//   [不可达] role='silent'：roleForSection 永不产（设计 §6.1-1），density 第五行由拆步3 的
//     AST 定理独立冻结，不在本 golden 内。
//   [不可达] fillForBoundary：DEV-002 冻结 groove_score_plan 必传，该分支生产不可达；
//     恢复落点见执行计划具名条目。
// 运行: pnpm exec vitest run --config vitest.export.config.ts scripts/export-afe-drum-performance.export.test.ts
// ============================================================
import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as ts from 'typescript';
import { planDrumPerformance } from '../src/core/generation/newEngine/arranger/drumPerformancePlanner';
import { GROOVE_CONTRACT_POOL } from '../src/core/generation/newEngine/knowledge/grooveContracts';
import { drumFeelProfileIdForContract } from '../src/core/generation/newEngine/knowledge/drumPerformanceKnowledge';
import type {
  Section, SectionEntry, SectionFunctionTag, OpeningDrumEntry, GrooveScorePlan,
} from '../src/core/generation/newEngine/arranger/ArrangementPlan';
import type { GrooveContract } from '../src/core/generation/newEngine/knowledge/grooveContracts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const CORE = join(REPO, '..', 'core');
const OUT_JSON = join(CORE, 'tests', 'golden', 'afe_drum_performance_golden.json');
const EXPORTER_REL = 'scripts/export-afe-drum-performance.export.test.ts';
const SCHEMA_VERSION = 'drum_performance_golden_v1';
const ENGINE_BASE_COMMIT = 'fb33e9eaa74cee6a1c882b3d710391e969e0462e';
const SPEC_ANCHOR = 'Newengine_Demo-v5.0';
const PLANNER_REL = 'src/core/generation/newEngine/arranger/drumPerformancePlanner.ts';

// ---- 枚举序：**逐条对锁冻结 ABI**（afe_drum_performance.h / afe_p2org.h）----
// ★★ 首轮 Blocker 教训：上一版这五张表（entryMode/velocity/kick/snare/hat）是我**凭 TS union
//   序与直觉编的**，与冻结 ABI 不符（`full` 导成 1 实为 5、velocity 少了 FLAT=0、
//   kick 的 ANCHOR_ONLY 才是 0、snare 的 rim/ghost 次序颠倒、hat 少了 QUARTERS=0 与 PEDAL=5），
//   而我又把 C 自洽门的域宽锁成缩窄后的值 ⇒ **整体自证成绿**。
//   这与拆步3 首轮 style 枚举（我写 {POP,RNB,LOFI,JAZZ}，实为 POP0/JAZZ1/LOFI2/RNB3）同一形态。
//   **根因是没让机器去对**：TS 侧序表与 C 侧 ABI 之间此前零交叉校验。
//   现在的制度：本文件只是「TS 字符串 → ABI 常量**名**」的映射，**数值一律由 codegen 解析
//   冻结头取得**（gen_drum_performance_golden.py 的 parse_abi_enums），并在 .h 里 emit 具名常量
//   让 C 编译器再兜一层。
//   ★★ 二轮 F1/F8 更正：上一版注释称「下方 it('枚举映射对锁冻结 ABI') 直接读 .h 做第三重
//     独立核对」——**该测试当时并不存在**（描述通胀）；而且即便存在，那三层查的都是
//     「常量名是否存在」，**没有一层验证映射本身**（把 'full' 映到 HAT_ONLY 三层全过）。
//     真正独立的判据是**从 TS 串重新推导**：'-' 与 camelCase 断词 → 全大写 → 加前缀。
//     该判据现已同时落在 codegen（ts_to_abi_name）与下方 it('枚举映射经独立推导核对')。
const ROLE_ABI: Record<string, string> = {
  silent: 'AFE_DRUM_ROLE_SILENT', timekeeper: 'AFE_DRUM_ROLE_TIMEKEEPER',
  lift: 'AFE_DRUM_ROLE_LIFT', breakdown: 'AFE_DRUM_ROLE_BREAKDOWN', pickup: 'AFE_DRUM_ROLE_PICKUP',
};
const ENTRY_MODE_ABI: Record<string, string> = {
  none: 'AFE_DRUM_ENTRY_NONE', 'hat-only': 'AFE_DRUM_ENTRY_HAT_ONLY',
  'kick-only': 'AFE_DRUM_ENTRY_KICK_ONLY', 'kick-hat': 'AFE_DRUM_ENTRY_KICK_HAT',
  'ride-only': 'AFE_DRUM_ENTRY_RIDE_ONLY', full: 'AFE_DRUM_ENTRY_FULL',
  dropout: 'AFE_DRUM_ENTRY_DROPOUT',
};
const FILL_POLICY_ABI: Record<string, string> = {
  none: 'AFE_DRUM_FILL_NONE', light: 'AFE_DRUM_FILL_LIGHT',
  turnaround: 'AFE_DRUM_FILL_TURNAROUND', big: 'AFE_DRUM_FILL_BIG',
};
const TIMING_PROFILE_ABI: Record<string, string> = {
  tight: 'AFE_DRUM_TIMING_TIGHT', 'behind-snare': 'AFE_DRUM_TIMING_BEHIND_SNARE',
  'dilla-late': 'AFE_DRUM_TIMING_DILLA_LATE', 'swing-ride': 'AFE_DRUM_TIMING_SWING_RIDE',
};
const VELOCITY_PROFILE_ABI: Record<string, string> = {
  flat: 'AFE_DRUM_VEL_FLAT', backbeat: 'AFE_DRUM_VEL_BACKBEAT',
  ghosted: 'AFE_DRUM_VEL_GHOSTED', crescendo: 'AFE_DRUM_VEL_CRESCENDO',
};
const KICK_POLICY_ABI: Record<string, string> = {
  'anchor-only': 'AFE_DRUM_KICK_ANCHOR_ONLY', 'four-on-floor': 'AFE_DRUM_KICK_FOUR_ON_FLOOR',
  syncopated: 'AFE_DRUM_KICK_SYNCOPATED', halftime: 'AFE_DRUM_KICK_HALFTIME',
};
const SNARE_POLICY_ABI: Record<string, string> = {
  backbeat: 'AFE_DRUM_SNARE_BACKBEAT', rim: 'AFE_DRUM_SNARE_RIM',
  'ghost-before-backbeat': 'AFE_DRUM_SNARE_GHOST_BEFORE_BACKBEAT',
  'jazz-comping': 'AFE_DRUM_SNARE_JAZZ_COMPING',
};
const HAT_POLICY_ABI: Record<string, string> = {
  quarters: 'AFE_DRUM_HAT_QUARTERS', eighths: 'AFE_DRUM_HAT_EIGHTHS',
  sixteenths: 'AFE_DRUM_HAT_SIXTEENTHS', shaker16: 'AFE_DRUM_HAT_SHAKER16',
  ride: 'AFE_DRUM_HAT_RIDE', pedal: 'AFE_DRUM_HAT_PEDAL',
};
const CYMBAL_POLICY_ABI: Record<string, string> = {
  none: 'AFE_DRUM_CYMBAL_NONE', 'section-crash': 'AFE_DRUM_CYMBAL_SECTION_CRASH',
  'hook-crash': 'AFE_DRUM_CYMBAL_HOOK_CRASH',
};
const TOM_POLICY_ABI: Record<string, string> = {
  none: 'AFE_DRUM_TOM_NONE', turnaround: 'AFE_DRUM_TOM_TURNAROUND',
  'big-fill': 'AFE_DRUM_TOM_BIG_FILL',
};
const GUARD_ABI: Record<string, string> = {
  strict: 'AFE_DRUM_GUARD_STRICT', normal: 'AFE_DRUM_GUARD_NORMAL',
};
const FEEL_ABI: Record<string, string> = {
  'pop-tight-backbeat': 'AFE_DRUM_FEEL_POP_TIGHT_BACKBEAT',
  'pop-driving-rock': 'AFE_DRUM_FEEL_POP_DRIVING_ROCK',
  'rnb-laidback-pocket': 'AFE_DRUM_FEEL_RNB_LAIDBACK_POCKET',
  'rnb-dilla-voices': 'AFE_DRUM_FEEL_RNB_DILLA_VOICES',
  'lofi-dusty-pocket': 'AFE_DRUM_FEEL_LOFI_DUSTY_POCKET',
  'jazz-swing-ride': 'AFE_DRUM_FEEL_JAZZ_SWING_RIDE',
  'jazz-brush-ballad': 'AFE_DRUM_FEEL_JAZZ_BRUSH_BALLAD',
  'jazz-bossa-tight': 'AFE_DRUM_FEEL_JAZZ_BOSSA_TIGHT',
};
const OPENING_ENTRY_ABI: Record<string, string> = {
  none: 'AFE_DRUM_OPENING_NONE', hatsOnly: 'AFE_DRUM_OPENING_HATS_ONLY',
  kickOnly: 'AFE_DRUM_OPENING_KICK_ONLY', backbeatDelayed: 'AFE_DRUM_OPENING_BACKBEAT_DELAYED',
  fourOnFloorRamp: 'AFE_DRUM_OPENING_FOUR_ON_FLOOR_RAMP', rideOnly: 'AFE_DRUM_OPENING_RIDE_ONLY',
  brushLoop: 'AFE_DRUM_OPENING_BRUSH_LOOP', halftimePocket: 'AFE_DRUM_OPENING_HALFTIME_POCKET',
  tomPickup: 'AFE_DRUM_OPENING_TOM_PICKUP',
};
// 输入侧枚举（不进输出合同，仍须与 C 侧输入结构一致）
const STYLE_ORDER = ['POP', 'JAZZ', 'LOFI', 'RNB', 'ACG', 'BLUES', 'MODAL'] as const;
const OPENING_ENTRY_ORDER = ['none', 'hatsOnly', 'kickOnly', 'backbeatDelayed', 'fourOnFloorRamp',
  'rideOnly', 'brushLoop', 'halftimePocket', 'tomPickup'] as const;
const FUNCTION_TAG_ORDER = ['setup', 'story', 'build', 'hook', 'breakdown',
  'loop', 'head', 'solo', 'headOut', 'tag', 'outro'] as const;
// ★★ 拆步5 首跑抓出的第三次同类错：上一版我手写 ['downbeat','lead-in','delayed','pickup','none']，
//   而真源 `SectionEntry = 'downbeat' | 'lead-in'` 只有 **2 值**（'delayed'/'pickup' 属另一个类型
//   RolePerformanceContract.entryMode，根本不是合法输入），C ABI 则是 NONE=0/DOWNBEAT=1/LEAD_IN=2。
//   结果 C2 组的 lead-in 与 delayed 两例 entry_mode 对调、且两个非法值本不该存在。
//   现改为「只导 ABI 常量名」，数值由 codegen 解析 afe_groove.h 取得（与输出枚举同一制度）。
const SECTION_ENTRY_ABI: Record<string, string> = {
  none: 'AFE_GROOVE_SECTION_ENTRY_NONE',
  downbeat: 'AFE_GROOVE_SECTION_ENTRY_DOWNBEAT',
  'lead-in': 'AFE_GROOVE_SECTION_ENTRY_LEAD_IN',
};
/** 真源域：只有 2 个值 + absent（absent 在 C 侧即 ENTRY_NONE）。 */
const SECTION_ENTRY_DOMAIN = ['downbeat', 'lead-in'] as const;
// 27 family 冻结序 = 拆步2 append-only registry（前 17 项不可重编号）
const FAMILY_ORDER = [
  'pop-backbeat', 'ballad-halftime', 'citypop-syncopated-boogie', 'citypop-disco-boogie',
  'jpop-driving-8ths', 'tr808-lofi-boombap', 'tr808-lofi-minimal', 'tr808-lofi-dusty-break',
  'tr808-rnb-pocket', 'tr808-dilla-pocket', 'rnb-gospel-triplet', 'tr808-trap-soul-halftime',
  'jazz-swing-ride', 'jazz-bebop-comping', 'jazz-brush-ballad', 'smooth-jazz-backbeat',
  'jazz-bossa', 'rnb-neo-soul-pocket', 'rnb-dilla-pocket', 'rnb-neo-soul', 'rnb-dilla',
  'rnb-gospel-shuffle', 'trap-soul-halftime', 'lofi-boombap', 'lofi-dusty-break',
  'lofi-minimal', 'jazz-ballad-light',
] as const;

/** TS 字符串 → ABI 常量名（**只导名，不导数值**）。未知值 fail-closed。 */
const abiName = (m: Record<string, string>, v: string, what: string): string => {
  const n = m[v];
  if (n === undefined) throw new Error(`${what}: 未知值 ${v}（fail-closed）`);
  return n;
};

const idx = <T extends readonly string[]>(order: T, v: string, what: string): number => {
  const i = order.indexOf(v as never);
  if (i < 0) throw new Error(`${what}: 未知值 ${v}（fail-closed）`);
  return i;
};

// ============================================================
// ★ score 读取闭包的 AST 定理
//   C 侧只会照 TS 的读取面消费 groove_score_plan。若 TS 其实读了更多字段而 golden 只导
//   boundaries，C 就会拿不到必要输入而对不上——这类「读取闭包不完整」是 P2-2a B-2 的教训。
//   故机器证明：fillFromGrooveScore 的 score 形参**只**被用作 `score.boundaries`，
//   且候选对象上被读的属性 ⊆ {opening, fromSectionId, toSectionId, intensity}。
// ============================================================
const SCORE_CLOSURE = ['opening', 'fromSectionId', 'toSectionId', 'intensity'] as const;

function proveScoreReadClosure(src: string): { scoreProps: string[]; boundaryProps: string[] } {
  const sf = ts.createSourceFile('p.ts', src, ts.ScriptTarget.ES2022, true);
  let fn: ts.FunctionDeclaration | undefined;
  sf.forEachChild((n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === 'fillFromGrooveScore') fn = n;
  });
  if (!fn || !fn.body) throw new Error('未找到 fillFromGrooveScore 声明（fail-closed）');
  const scoreParam = fn.parameters.find((p) => ts.isIdentifier(p.name) && p.name.text === 'score');
  if (!scoreParam) throw new Error('fillFromGrooveScore 无 score 形参（fail-closed）');

  const scoreProps = new Set<string>();
  const boundaryProps = new Set<string>();
  // 候选/边界局部名：candidates / boundary / candidate —— 读到它们的属性即计入 boundary 面
  const BOUNDARY_LOCALS = new Set(['candidate', 'boundary']);
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === 'score' && !ts.isParameter(n.parent)) {
      const par = n.parent;
      if (!par || !ts.isPropertyAccessExpression(par) || par.expression !== n) {
        throw new Error(`score 被整体使用（${par ? ts.SyntaxKind[par.kind] : '?'}）——`
          + '读取闭包不可判定，fail-closed');
      }
      scoreProps.add(par.name.text);
    }
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression)
        && BOUNDARY_LOCALS.has(n.expression.text)) {
      boundaryProps.add(n.name.text);
    }
    n.forEachChild(walk);
  };
  fn.body.forEachChild(walk);
  return { scoreProps: [...scoreProps].sort(), boundaryProps: [...boundaryProps].sort() };
}

// ============================================================
// 合同池：克隆真合同 + 只覆盖结构字段
// ============================================================
type DrumOverride = Partial<{
  kitProgram: number;
  timekeeperFamily: string | undefined;
  liftFamily: string | undefined;
  pickupFamily: string | undefined;
  breakdownFamily: string | undefined;
}>;
type PoolSpec = {
  base: string;                  // 克隆基底（真合同 id）
  /** ★ 二轮 F2/F6：**合成 id 串**。上一版我判定「不可表示」——那是错的：
   *  合成 id 让 TS 落 feel fallback，只要**基底 enum 的 effective feel 恰等于该 fallback 结果**，
   *  两侧就自然一致（Codex 的解法，直接推翻我的结论）。故允许 override，但由
   *  assertSyntheticIdFeelMatch() **机器证明**该等式成立，不成立即 fail-closed。 */
  idStr?: string;
  density?: 'sparse' | 'medium' | 'active';
  grid?: string;
  rhythmSwingSource?: string;
  drum?: DrumOverride | null;    // null = 显式移除 drum（走 baseFamily fallback）
};

const REAL = new Map(GROOVE_CONTRACT_POOL.map((c) => [c.id, c]));

const poolSpecs: PoolSpec[] = [];
const poolKey = (s: PoolSpec): string => JSON.stringify([s.base, s.idStr ?? null, s.density ?? null, s.grid ?? null,
  s.rhythmSwingSource ?? null, s.drum === null ? 'NO_DRUM' : (s.drum ?? null)]);
const poolIndex = new Map<string, number>();
function poolRef(s: PoolSpec): number {
  const k = poolKey(s);
  const hit = poolIndex.get(k);
  if (hit !== undefined) return hit;
  const i = poolSpecs.length;
  poolSpecs.push(s);
  poolIndex.set(k, i);
  return i;
}

/** 合成 id 的**可表示性证明**：TS 侧会落 `drumFeelProfileIdForContract` 的 fallback 子句，
 *  而 C 侧仍按基底 enum 取拆步3 冻结的 effective 表 —— 二者必须相等，否则期望输出不可表示。
 *  直调生产 `drumFeelProfileIdForContract` 取两侧结果，不复写 fallback 算法。 */
function assertSyntheticIdFeelMatch(s: PoolSpec, cloned: GrooveContract): void {
  const base = REAL.get(s.base)!;
  const cEffective = drumFeelProfileIdForContract(base);            // C 侧：enum → effective 表
  const probe = { ...cloned, id: s.idStr } as GrooveContract;
  const tsFallback = drumFeelProfileIdForContract(probe);           // TS 侧：合成 id → fallback
  if (tsFallback !== cEffective) {
    throw new Error(`合成 id ${s.idStr!} 不可表示：TS fallback feel=${tsFallback} 而基底 `
      + `${s.base} 的 effective feel=${cEffective} —— 请改选一个 effective feel 等于 `
      + `${tsFallback} 的基底 enum（fail-closed）`);
  }
}

/** 为合成 id **自动选基底**：在 21 个真合同里找 effective feel 恰等于「该合成 id 在此合同
 *  结构下的 TS fallback feel」的那一个。手挑基底我已错过一次（probe_gospel_dilla），
 *  这类可机器推导的选择就不该手写。找不到 ⇒ 该 id 确实不可表示，fail-closed。 */
function pickBaseForSyntheticId(idStr: string, styleHint: string,
                                shape: { density?: string; grid?: string }): string {
  const tried: string[] = [];
  for (const cand of GROOVE_CONTRACT_POOL) {
    const probe = { ...cand, id: idStr } as GrooveContract;
    if (shape.density !== undefined) (probe as { density: string }).density = shape.density;
    if (shape.grid !== undefined) (probe as { grid: string }).grid = shape.grid;
    const tsFallback = drumFeelProfileIdForContract(probe);
    const effective = drumFeelProfileIdForContract(cand);
    tried.push(`${cand.id}:${effective}vs${tsFallback}`);
    if (tsFallback === effective) return cand.id;
  }
  throw new Error(`合成 id ${idStr}（style=${styleHint}）找不到可表示的基底 —— `
    + `需 effective feel == TS fallback feel。候选比对：${tried.slice(0, 5).join(' ')}…（fail-closed）`);
}

function materializeContract(s: PoolSpec): GrooveContract {
  const base = REAL.get(s.base);
  if (!base) throw new Error(`合同池基底 ${s.base} 不在 GROOVE_CONTRACT_POOL（fail-closed）`);
  const c = JSON.parse(JSON.stringify(base)) as GrooveContract;
  if (c.id !== s.base) throw new Error('克隆后 id 串漂移（fail-closed）');
  if (s.idStr !== undefined) {
    // 合成 id：必须先证明「TS fallback feel == 基底 enum 的 effective feel」
    assertSyntheticIdFeelMatch(s, c);
    (c as { id: string }).id = s.idStr;
  }
  if (s.density !== undefined) (c as { density: string }).density = s.density;
  if (s.grid !== undefined) (c as { grid: string }).grid = s.grid;
  if (s.rhythmSwingSource !== undefined) {
    (c as { rhythmSwingSource?: string }).rhythmSwingSource = s.rhythmSwingSource;
  }
  if (s.drum === null) {
    (c as { drum?: unknown }).drum = undefined;
  } else if (s.drum) {
    if (!c.drum) throw new Error(`${s.base} 无 drum，无法施加 drum 覆盖（fail-closed）`);
    Object.assign(c.drum as Record<string, unknown>, s.drum);
  }
  return c;
}

// ============================================================
// 段与 score 构造
// ============================================================
type SecSpec = {
  id: string;
  functionTag?: SectionFunctionTag;
  bars?: number;
  entry?: SectionEntry;
  repeatGroup?: string;
  contract: PoolSpec;
};
type BndSpec = { from: string; to: string; opening?: boolean; intensity: number };

const mkSection = (s: SecSpec): Section => ({
  id: s.id as never,
  role: 'verse' as never,
  functionTag: s.functionTag,
  bars: s.bars ?? 4,
  repeatGroup: s.repeatGroup as never,
  hookPolicy: 'none' as never,
});

const mkScore = (bnds: BndSpec[]): GrooveScorePlan => ({
  boundaries: bnds.map((b) => ({
    fromSectionId: b.from, toSectionId: b.to,
    opening: b.opening ?? false, intensity: b.intensity,
  })),
} as never as GrooveScorePlan);

type CaseSpec = {
  name: string;
  note: string;
  style: (typeof STYLE_ORDER)[number];
  secs: SecSpec[];
  bnds?: BndSpec[];
  openingDrumEntry?: OpeningDrumEntry;   // undefined = absent
};

const cases: CaseSpec[] = [];
const seenNames = new Set<string>();
function addCase(c: CaseSpec): void {
  if (seenNames.has(c.name)) throw new Error(`fixture 名重复 ${c.name}（fail-closed）`);
  seenNames.add(c.name);
  cases.push(c);
}

// ---- A: 27 family × 4 可达 role ----
// 用「显式 drum family」驱动 contractFamilyForRole：四个 role 各取自己的字段。
// 基底取 pop_radio_straight（density=medium ⇒ complexity=2，便于观察 intensity 钳位）。
const ROLE_TAG: Record<string, SectionFunctionTag | undefined> = {
  timekeeper: 'story', lift: 'hook', breakdown: 'setup', pickup: 'build',
};
for (const fam of FAMILY_ORDER) {
  for (const role of ['timekeeper', 'lift', 'breakdown', 'pickup'] as const) {
    // 让被测 role 的字段指向 fam，其余字段置 undefined，确保 fallback 链只可能取到 fam
    const drum: DrumOverride = {
      timekeeperFamily: fam, liftFamily: undefined,
      pickupFamily: undefined, breakdownFamily: undefined,
    };
    if (role === 'lift') drum.liftFamily = fam;
    if (role === 'pickup') drum.pickupFamily = fam;
    if (role === 'breakdown') drum.breakdownFamily = fam;
    addCase({
      name: `A_family_${fam}_${role}`,
      note: `A: family=${fam} role=${role}（显式 drum family 驱动）`,
      style: 'POP',
      secs: [{ id: 's0', functionTag: ROLE_TAG[role], contract: { base: 'pop_radio_straight', drum } }],
      bnds: [{ from: 's0', to: 's0', intensity: 1 }],
    });
  }
}

// ---- A2: contractFamilyForRole 的 **fallback 链**（缺字段时逐级回退）----
// 判别力：A 组每个 role 都有自己的字段，改坏回退链仍全绿；这里逐级抽掉字段，
// 并覆盖 validDrumFamily 对**非法 family 名**必须拒绝并继续回退（不是直接采用）。
const A2: Array<{ name: string; role: 'lift' | 'pickup' | 'breakdown'; drum: DrumOverride }> = [
  { name: 'lift_to_timekeeper', role: 'lift',
    drum: { timekeeperFamily: 'jazz-bossa', liftFamily: undefined, pickupFamily: undefined, breakdownFamily: undefined } },
  { name: 'pickup_to_lift', role: 'pickup',
    drum: { timekeeperFamily: 'pop-backbeat', liftFamily: 'lofi-minimal', pickupFamily: undefined, breakdownFamily: undefined } },
  { name: 'pickup_to_timekeeper', role: 'pickup',
    drum: { timekeeperFamily: 'rnb-dilla', liftFamily: undefined, pickupFamily: undefined, breakdownFamily: undefined } },
  { name: 'breakdown_to_timekeeper', role: 'breakdown',
    drum: { timekeeperFamily: 'jazz-ballad-light', liftFamily: 'pop-backbeat', pickupFamily: undefined, breakdownFamily: undefined } },
  // ★ 原本还有两条「非法 family 名 → validDrumFamily 拒绝后继续回退」的靶，**已移除**：
  //   TS 侧 family 是字符串、非法名回退；C 侧 family 是 FK（afe_drum_pattern_family_id_t），
  //   步1 冻结的契约是「非法 family → ERR_BAD_CONTRACT」——该输入形态在 C 域**不可表示**，
  //   留着会让 golden 无法翻译成 C。行为面已由上面的 `undefined` 回退链等价覆盖
  //   （TS 里非法名与 undefined 走同一条回退路径）。见 meta.coverageGaps 的对应条目 + 下方断言看守。
  { name: 'timekeeper_only_no_optional', role: 'lift',
    drum: { timekeeperFamily: 'trap-soul-halftime', liftFamily: undefined, pickupFamily: undefined, breakdownFamily: undefined } },
];
for (const a of A2) {
  addCase({
    name: `A2_${a.name}`,
    note: `A2: contractFamilyForRole 回退链 ${a.name}（role=${a.role}）`,
    style: 'POP',
    secs: [{ id: 's0', functionTag: ROLE_TAG[a.role], contract: { base: 'pop_radio_straight', drum: a.drum } }],
    bnds: [{ from: 's0', to: 's0', intensity: 1 }],
  });
}

// ---- B: roleForSection 完整域（11 tag + undefined）----
for (const tag of [...FUNCTION_TAG_ORDER, undefined]) {
  addCase({
    name: `B_tag_${tag ?? 'undefined'}`,
    note: `B: functionTag=${tag ?? 'undefined'} → roleForSection 分派`,
    style: 'POP',
    secs: [{ id: 's0', functionTag: tag, contract: { base: 'pop_radio_straight' } }],
    bnds: [{ from: 's0', to: 's0', intensity: 1 }],
  });
}

// ---- C: OpeningDrumEntry 9 值 + absent（仅首段生效 ⇒ 第二段作对照）----
for (const oe of [...OPENING_ENTRY_ORDER, undefined]) {
  addCase({
    name: `C_opening_${oe ?? 'absent'}`,
    note: `C: openingDrumEntry=${oe ?? 'absent'}；第二段作「仅首段生效」的对照`,
    style: 'POP',
    secs: [
      { id: 's0', functionTag: 'story', contract: { base: 'pop_radio_straight' } },
      { id: 's1', functionTag: 'story', contract: { base: 'pop_radio_straight' } },
    ],
    bnds: [{ from: 's0', to: 's1', intensity: 1 }, { from: 's1', to: 's1', intensity: 1 }],
    openingDrumEntry: oe,
  });
}

// ---- D: 21 合同 → feel profile 映射 ----
for (const c of GROOVE_CONTRACT_POOL) {
  addCase({
    name: `D_feel_${c.id}`,
    note: `D: 合同 ${c.id} → feel profile`,
    style: 'POP',
    secs: [{ id: 's0', functionTag: 'story', contract: { base: c.id } }],
    bnds: [{ from: 's0', to: 's0', intensity: 1 }],
  });
}

// ---- E: baseFamily fallback 全叶（drum=null 强制走 fallback）× style 分派 ----
type ELeaf = { name: string; style: (typeof STYLE_ORDER)[number]; base: string;
  tag?: SectionFunctionTag; density?: 'sparse' | 'medium' | 'active' };
const E_LEAVES: ELeaf[] = [
  // jazz 5 叶
  { name: 'jazz_smooth', style: 'JAZZ', base: 'jazz_smooth_backbeat', tag: 'story' },
  { name: 'jazz_bossa', style: 'JAZZ', base: 'jazz_bossa_straight_latin', tag: 'story' },
  { name: 'jazz_ballad', style: 'JAZZ', base: 'jazz_ballad_loose', tag: 'story' },
  { name: 'jazz_solo_bebop', style: 'JAZZ', base: 'jazz_combo_swing', tag: 'solo' },
  { name: 'jazz_default_swingride', style: 'JAZZ', base: 'jazz_combo_swing', tag: 'story' },
  // rnb 5 叶
  { name: 'rnb_gospel', style: 'RNB', base: 'rnb_gospel_triplet', tag: 'story' },
  { name: 'rnb_dilla', style: 'RNB', base: 'rnb_dilla_pocket', tag: 'story' },
  { name: 'rnb_trap', style: 'RNB', base: 'rnb_trap_soul_halftime', tag: 'story' },
  { name: 'rnb_motown', style: 'RNB', base: 'rnb_motown_backbeat', tag: 'story' },
  { name: 'rnb_default_neosoul', style: 'RNB', base: 'rnb_neo_soul_laidback', tag: 'story' },
  // lofi：3 个关键字各按 functionTag 分岔（loop vs 非 loop）+ 缺省
  { name: 'lofi_late_loop', style: 'LOFI', base: 'lofi_tape_late_chords', tag: 'loop' },
  { name: 'lofi_late_nonloop', style: 'LOFI', base: 'lofi_tape_late_chords', tag: 'story' },
  { name: 'lofi_halftime_loop', style: 'LOFI', base: 'lofi_halftime_dusty', tag: 'loop' },
  { name: 'lofi_halftime_nonloop', style: 'LOFI', base: 'lofi_halftime_dusty', tag: 'story' },
  { name: 'lofi_lazy_loop', style: 'LOFI', base: 'lofi_lazy_dilla', tag: 'loop' },
  { name: 'lofi_lazy_nonloop', style: 'LOFI', base: 'lofi_lazy_dilla', tag: 'story' },
  { name: 'lofi_default_boombap', style: 'LOFI', base: 'pop_radio_straight', tag: 'story' },
  // 非 jazz/rnb/lofi 的 id 子串分支
  { name: 'citypop_hook', style: 'POP', base: 'pop_citypop_boogie', tag: 'hook' },
  { name: 'citypop_build', style: 'POP', base: 'pop_citypop_boogie', tag: 'build' },
  { name: 'citypop_other', style: 'POP', base: 'pop_citypop_boogie', tag: 'story' },
  { name: 'ballad_id', style: 'POP', base: 'pop_ballad_halftime', tag: 'story' },
  { name: 'sparse_density', style: 'POP', base: 'pop_radio_straight', tag: 'story', density: 'sparse' },
  { name: 'jpop_id', style: 'POP', base: 'pop_jpop_push_8ths', tag: 'story' },
  { name: 'active_density', style: 'POP', base: 'pop_radio_straight', tag: 'story', density: 'active' },
  { name: 'fallback_popbackbeat', style: 'POP', base: 'pop_radio_straight', tag: 'story' },
  // 子串优先级（真 id × style 组合）
  { name: 'prio_halftime_over_dusty', style: 'LOFI', base: 'lofi_halftime_dusty', tag: 'loop' },
  { name: 'prio_lazy_in_lofi', style: 'LOFI', base: 'lofi_lazy_dilla', tag: 'story' },
  { name: 'prio_dilla_in_rnb', style: 'RNB', base: 'lofi_lazy_dilla', tag: 'story' },
  { name: 'prio_ballad_in_jazz', style: 'JAZZ', base: 'pop_ballad_halftime', tag: 'story' },
  { name: 'prio_halftime_in_lofi_from_rnb_id', style: 'LOFI', base: 'rnb_trap_soul_halftime', tag: 'story' },
  // 兜底 style（非 jazz/rnb/lofi 一律落 id 子串分支，不得被特判）
  { name: 'style_acg_fallsthrough', style: 'ACG', base: 'pop_radio_straight', tag: 'story' },
  { name: 'style_blues_fallsthrough', style: 'BLUES', base: 'pop_radio_straight', tag: 'story' },
  { name: 'style_modal_fallsthrough', style: 'MODAL', base: 'pop_radio_straight', tag: 'story' },
];
for (const L of E_LEAVES) {
  addCase({
    name: `E_${L.name}`,
    note: `E: baseFamily fallback 叶 ${L.name}（style=${L.style} base=${L.base} tag=${L.tag}）`,
    style: L.style,
    secs: [{ id: 's0', functionTag: L.tag, contract: { base: L.base, density: L.density, drum: null } }],
    bnds: [{ from: 's0', to: 's0', intensity: 1 }],
  });
}

// ---- E2: **单 id 双关键字优先级**（§6.1 明确要求；二轮 F6）----
// 用合成 id + 「effective feel 等于 TS fallback 结果」的基底（见 assertSyntheticIdFeelMatch）。
// 判别力：把 baseFamily 里同 clause 内两个关键字的判断次序调换，这些靶就会红。
type E2 = { name: string; style: (typeof STYLE_ORDER)[number];
  idStr: string; tag?: SectionFunctionTag; note: string };
const E2_LEAVES: E2[] = [
  // jazz clause: smooth 先于 bossa 先于 ballad。基底取 effective feel == JAZZ 非 sparse fallback
  // (jazz-swing-ride=5) 的合同：jazz_combo_swing(0)/jazz_medium_swing(15) 皆为 5。
  { name: 'jazz_smooth_beats_bossa', style: 'JAZZ',
    idStr: 'probe_smooth_bossa', tag: 'story', note: 'smooth 先于 bossa ⇒ smooth-jazz-backbeat' },
  { name: 'jazz_smooth_beats_ballad', style: 'JAZZ',
    idStr: 'probe_smooth_ballad', tag: 'story', note: 'smooth 先于 ballad ⇒ smooth-jazz-backbeat' },
  { name: 'jazz_bossa_beats_ballad', style: 'JAZZ',
    idStr: 'probe_bossa_ballad', tag: 'story', note: 'bossa 先于 ballad ⇒ jazz-bossa' },
  // rnb clause: gospel 先于 dilla 先于 trap 先于 motown。RNB 非 dilla fallback = rnb-laidback-pocket(2)
  { name: 'rnb_gospel_beats_dilla', style: 'RNB',
    idStr: 'probe_gospel_dilla', tag: 'story', note: 'gospel 先于 dilla ⇒ rnb-gospel-triplet' },
  { name: 'rnb_dilla_beats_trap', style: 'RNB',
    idStr: 'probe_dilla_trap', tag: 'story', note: 'dilla 先于 trap ⇒ rnb-dilla-pocket' },
  { name: 'rnb_trap_beats_motown', style: 'RNB',
    idStr: 'probe_trap_motown', tag: 'story', note: 'trap 先于 motown ⇒ trap-soul-halftime' },
  // lofi clause: late 先于 halftime 先于 lazy|dusty。LOFI fallback = lofi-dusty-pocket(4)
  { name: 'lofi_late_beats_halftime', style: 'LOFI',
    idStr: 'probe_late_halftime', tag: 'loop', note: 'late 先于 halftime ⇒ lofi-dusty-break' },
  { name: 'lofi_halftime_beats_lazy', style: 'LOFI',
    idStr: 'probe_halftime_lazy', tag: 'loop', note: 'halftime 先于 lazy ⇒ lofi-boombap' },
  // 非 jazz/rnb/lofi clause: citypop 先于 ballad 先于 jpop
  { name: 'pop_citypop_beats_ballad', style: 'POP',
    idStr: 'probe_citypop_ballad', tag: 'hook', note: 'citypop 先于 ballad ⇒ citypop-disco-boogie' },
  { name: 'pop_ballad_beats_jpop', style: 'POP',
    idStr: 'probe_ballad_jpop', tag: 'story', note: 'ballad 先于 jpop ⇒ ballad-halftime' },
];
for (const L of E2_LEAVES) {
  const picked = pickBaseForSyntheticId(L.idStr, L.style, {});
  addCase({
    name: `E2_${L.name}`,
    note: `E2 双关键字优先级: ${L.note}（合成 id ${L.idStr}，机器选定基底 ${picked}）`,
    style: L.style,
    secs: [{ id: 's0', functionTag: L.tag,
             contract: { base: picked, idStr: L.idStr, drum: null } }],
    bnds: [{ from: 's0', to: 's0', intensity: 1 }],
  });
}

// ---- C2: SectionEntry 域（二轮 F6：此前**全部** section 的 entry 都是 absent，
//      错误实现忽略 `entry==='lead-in' → full` 仍会全绿）----
for (const en of [...SECTION_ENTRY_DOMAIN, undefined]) {
  for (const role of ['timekeeper', 'pickup', 'breakdown'] as const) {
    addCase({
      name: `C2_entry_${en ?? 'absent'}_${role}`,
      note: `C2: entry=${en ?? 'absent'} role=${role} ⇒ entryForRole 分派`
        + `（lead-in 须压过 pickup 的 kick-hat）`,
      style: 'POP',
      secs: [{ id: 's0', functionTag: ROLE_TAG[role], entry: en,
               contract: { base: 'pop_radio_straight' } }],
      bnds: [{ from: 's0', to: 's0', intensity: 1 }],
    });
  }
}

// ---- F: score boundary 选择规则 ----
const F3SECS: SecSpec[] = [
  { id: 's0', functionTag: 'story', contract: { base: 'pop_radio_straight' } },
  { id: 's1', functionTag: 'story', contract: { base: 'pop_radio_straight' } },
  { id: 's2', functionTag: 'story', contract: { base: 'pop_radio_straight' } },
];
addCase({
  name: 'F_boundary_cross_section_first',
  note: 'F: 有跨段候选 ⇒ 取**首个** toSectionId != section.id 的候选（intensity 3 → big）',
  style: 'POP',
  secs: F3SECS,
  bnds: [
    { from: 's0', to: 's0', intensity: 1 },   // 自指，须被跳过
    { from: 's0', to: 's1', intensity: 3 },   // 首个跨段 ⇒ 命中
    { from: 's0', to: 's2', intensity: 2 },   // 后续跨段，不得命中
  ],
});
addCase({
  name: 'F_boundary_self_only_last',
  note: 'F: 只有自指候选 ⇒ 取**末个**候选（intensity 2 → turnaround）',
  style: 'POP',
  secs: [{ id: 's0', functionTag: 'story', contract: { base: 'pop_radio_straight' } }],
  bnds: [
    { from: 's0', to: 's0', intensity: 3 },
    { from: 's0', to: 's0', intensity: 2 },   // 末个 ⇒ 命中
  ],
});
addCase({
  name: 'F_boundary_opening_excluded',
  note: 'F: opening 候选须被过滤（否则会错取 intensity 3）',
  style: 'POP',
  secs: F3SECS.slice(0, 2),
  bnds: [
    { from: 's0', to: 's1', opening: true, intensity: 3 },
    { from: 's0', to: 's1', intensity: 1 },
  ],
});
addCase({
  name: 'F_boundary_none',
  note: 'F: s0 无候选 ⇒ fillPolicy=none。**边界端点全部是合法段**（首轮 F3：'
    + '原写池外 id sXY，转换器会生成 ABI 中不存在的 0xFF sentinel）',
  style: 'POP',
  secs: F3SECS.slice(0, 2),
  bnds: [{ from: 's1', to: 's0', intensity: 3 }],
});
addCase({
  name: 'F_boundary_intensity_1_light',
  note: 'F: intensity 1 ⇒ light（三个 intensity 阈值的第三档）',
  style: 'POP',
  secs: [{ id: 's0', functionTag: 'story', contract: { base: 'pop_radio_straight' } }],
  bnds: [{ from: 's0', to: 's0', intensity: 1 }],
});

// ---- G: complexity / intensity 钳位 ----
for (const density of ['sparse', 'medium', 'active'] as const) {
  for (const role of ['lift', 'breakdown', 'timekeeper'] as const) {
    addCase({
      name: `G_clamp_${density}_${role}`,
      note: `G: density=${density} role=${role} ⇒ complexity/intensity 钳位`,
      style: 'POP',
      secs: [{ id: 's0', functionTag: ROLE_TAG[role], contract: { base: 'pop_radio_straight', density } }],
      bnds: [{ from: 's0', to: 's0', intensity: 1 }],
    });
  }
}

// ---- H: timing safety 45 格（3 effective swing × 5 grid × 3 density）----
const SWING_SRC = ['straight-eighths', 'straight-sixteenths', 'authored'] as const;
const GRIDS = ['straight', 'swing', 'shuffle', 'dilla', 'rubato'] as const;
for (const sw of SWING_SRC) {
  for (const g of GRIDS) {
    for (const d of ['sparse', 'medium', 'active'] as const) {
      addCase({
        name: `H_timing_${sw}_${g}_${d}`,
        note: `H: timing 45 格 swing=${sw} grid=${g} density=${d}`,
        style: 'POP',
        secs: [{
          id: 's0', functionTag: 'story',
          contract: { base: 'pop_radio_straight', grid: g, density: d, rhythmSwingSource: sw },
        }],
        bnds: [{ from: 's0', to: 's0', intensity: 1 }],
      });
    }
  }
}

// ============================================================
// 物化：直调生产 planDrumPerformance
// ============================================================
const projectContract = (o: Record<string, unknown>, secIdx: number, contractIdEnum: number) => {
  const num = (k: string): number => {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      throw new Error(`${k}=${String(v)} 非整数（fail-closed）`);
    }
    return v;
  };
  const dc = o['densityCeiling'];
  if (typeof dc !== 'number' || !(dc >= 0 && dc <= 1)) {
    throw new Error(`densityCeiling=${String(dc)} 越 [0,1]（fail-closed）`);
  }
  // 量化 = round_half_up(fl(x*1000))（P2-4c 冻结语义：先乘后舍）
  const scaled = dc * 1000;
  const permille = Math.round(scaled);
  const feelOffset = num('feelOffsetMs');
  if (feelOffset < -32768 || feelOffset > 32767) throw new Error('feelOffsetMs 越 i16');
  // ★ 输出枚举**只导 ABI 常量名 + TS 原串**，数值由 codegen 解析冻结头取得（首轮 Blocker 修法）
  const S = (k: string): string => String(o[k]);
  return {
    sectionIndex: secIdx,
    contractIdEnum,
    role: S('role'), roleAbi: abiName(ROLE_ABI, S('role'), 'role'),
    patternFamily: S('patternFamily'),
    patternFamilyIdx: (() => {
      const k = (FAMILY_ORDER as readonly string[]).indexOf(S('patternFamily'));
      if (k < 0) throw new Error(`patternFamily 未知值 ${S('patternFamily')}（fail-closed）`);
      return k;
    })(),
    feelProfileId: S('feelProfileId'), feelProfileAbi: abiName(FEEL_ABI, S('feelProfileId'), 'feelProfileId'),
    kitProgram: num('kitProgram'),
    entryMode: S('entryMode'), entryModeAbi: abiName(ENTRY_MODE_ABI, S('entryMode'), 'entryMode'),
    fillPolicy: S('fillPolicy'), fillPolicyAbi: abiName(FILL_POLICY_ABI, S('fillPolicy'), 'fillPolicy'),
    timingProfile: S('timingProfile'),
    timingProfileAbi: abiName(TIMING_PROFILE_ABI, S('timingProfile'), 'timingProfile'),
    velocityProfile: S('velocityProfile'),
    velocityProfileAbi: abiName(VELOCITY_PROFILE_ABI, S('velocityProfile'), 'velocityProfile'),
    kickPolicy: S('kickPolicy'), kickPolicyAbi: abiName(KICK_POLICY_ABI, S('kickPolicy'), 'kickPolicy'),
    snarePolicy: S('snarePolicy'), snarePolicyAbi: abiName(SNARE_POLICY_ABI, S('snarePolicy'), 'snarePolicy'),
    hatPolicy: S('hatPolicy'), hatPolicyAbi: abiName(HAT_POLICY_ABI, S('hatPolicy'), 'hatPolicy'),
    cymbalPolicy: S('cymbalPolicy'),
    cymbalPolicyAbi: abiName(CYMBAL_POLICY_ABI, S('cymbalPolicy'), 'cymbalPolicy'),
    tomPolicy: S('tomPolicy'), tomPolicyAbi: abiName(TOM_POLICY_ABI, S('tomPolicy'), 'tomPolicy'),
    foregroundGuard: S('foregroundGuard'),
    foregroundGuardAbi: abiName(GUARD_ABI, S('foregroundGuard'), 'foregroundGuard'),
    complexity: num('complexity'), intensity: num('intensity'),
    fillAmount: num('fillAmount'), fillComplexity: num('fillComplexity'),
    phraseVariation: num('phraseVariation'), humanizeAmount: num('humanizeAmount'),
    densityCeilingPermille: permille,
    densityCeilingRawBits: Buffer.from(Float64Array.of(dc).buffer).reverse().toString('hex'),
    densityCeilingScaledBits: Buffer.from(Float64Array.of(scaled).buffer).reverse().toString('hex'),
    maxMoveTicks: num('maxMoveTicks'),
    feelOffsetMs: feelOffset,
    tsId: String(o['id']),
  };
};

function buildCases() {
  const out: unknown[] = [];
  for (const c of cases) {
    const sections = c.secs.map(mkSection);
    const contractBySection: Record<string, GrooveContract> = {};
    const entryBySection: Record<string, SectionEntry> = {};
    const energyBySection: Record<string, number> = {};
    const secOut: unknown[] = [];
    let poolLen = 0;
    const idOffs: number[] = [];
    for (const s of c.secs) {
      idOffs.push(poolLen);
      poolLen += Buffer.byteLength(s.id, 'utf8') + 1;
    }
    c.secs.forEach((s, i) => {
      const mat = materializeContract(s.contract);
      contractBySection[s.id] = mat;
      if (s.entry) entryBySection[s.id] = s.entry;
      energyBySection[s.id] = 0.5;
      secOut.push({
        sectionId: s.id, idOff: idOffs[i],
        functionTag: s.functionTag ?? null,
        functionTagIdx: s.functionTag ? idx(FUNCTION_TAG_ORDER, s.functionTag, 'functionTag') : 255,
        bars: s.bars ?? 4,
        entry: s.entry ?? null,
        entryAbi: abiName(SECTION_ENTRY_ABI, s.entry ?? 'none', 'entry'),
        repeatGroup: s.repeatGroup ?? null,
        contractPoolIdx: poolRef(s.contract),
        contractIdEnum: (() => {
          const e = CONTRACT_ENUM.get(s.contract.base);
          if (e === undefined) throw new Error(`合同 ${s.contract.base} 无 enum（fail-closed）`);
          return e;
        })(),
      });
    });
    // ★ 首轮 F3：boundary 端点必须是**本用例存在的段**——池外 id 会被转换器变成
    //   ABI 中不存在的 0xFF sentinel（afe_groove_boundary_score_t 无此哨兵）。
    const secIds = new Set(c.secs.map((x) => x.id));
    for (const b of c.bnds ?? []) {
      if (!secIds.has(b.from) || !secIds.has(b.to)) {
        throw new Error(`${c.name}: boundary ${b.from}→${b.to} 引用了本用例不存在的段`
          + `（存在的段：${[...secIds].join(',')}）——ABI 无 0xFF sentinel，fail-closed`);
      }
    }
    const score = mkScore(c.bnds ?? []);
    const res = planDrumPerformance(
      sections, c.style, contractBySection, energyBySection, entryBySection,
      c.openingDrumEntry, score,
    );
    const expected = c.secs.map((s, i) => {
      const r = res[s.id] as unknown as Record<string, unknown>;
      if (!r) throw new Error(`${c.name}: 段 ${s.id} 无输出（fail-closed）`);
      const enumId = CONTRACT_ENUM.get(s.contract.base);
      if (enumId === undefined) throw new Error(`合同 ${s.contract.base} 无 enum（fail-closed）`);
      return projectContract(r, i, enumId);
    });
    out.push({
      name: c.name, note: c.note,
      input: {
        style: c.style, styleIdx: idx(STYLE_ORDER, c.style, 'style'),
        // 池 = id0 \0 id1 \0 …（**NUL 分隔**）；idOff 按 byteLength+1 累计，与此拼法逐字节一致
        sectionIdPool: c.secs.map((s) => s.id).join('\0') + '\0',
        sectionIdPoolLen: poolLen,
        sections: secOut,
        hasOpeningDrumEntry: c.openingDrumEntry !== undefined,
        openingDrumEntry: c.openingDrumEntry ?? null,
        openingDrumEntryIdx: c.openingDrumEntry !== undefined
          ? idx(OPENING_ENTRY_ORDER, c.openingDrumEntry, 'openingDrumEntry') : 255,
        boundaries: (c.bnds ?? []).map((b) => ({
          fromSectionId: b.from, toSectionId: b.to,
          opening: b.opening ?? false, intensity: b.intensity,
        })),
      },
      expected,
    });
  }
  return out;
}

// contract id → 冻结 enum（对锁 afe_groove.h afe_groove_contract_id_t）
const CONTRACT_ENUM = new Map<string, number>([
  ['jazz_combo_swing', 0], ['jazz_take_five_5_4', 1], ['pop_radio_straight', 2],
  ['pop_citypop_boogie', 3], ['pop_jpop_push_8ths', 4], ['pop_ballad_halftime', 5],
  ['lofi_lazy_dilla', 6], ['lofi_tape_late_chords', 7], ['lofi_halftime_dusty', 8],
  ['rnb_neo_soul_laidback', 9], ['rnb_dilla_pocket', 10], ['rnb_gospel_triplet', 11],
  ['rnb_motown_backbeat', 12], ['rnb_trap_soul_halftime', 13], ['jazz_smooth_backbeat', 14],
  ['jazz_medium_swing', 15], ['jazz_ballad_loose', 16], ['jazz_bossa_straight_latin', 17],
  ['acg_hisaishi_rubato_arp', 18], ['acg_planing_wash', 19], ['acg_jpop_456_drive', 20],
]);

// ============================================================
describe('export afe drum performance golden（P2-10A 拆步4）', () => {
  /** TS 串 → ABI 常量名的**独立推导**（不查上面的映射表）。与 codegen 的 ts_to_abi_name 同规则。 */
  const ABI_PREFIX: Record<string, string> = {
    role: 'AFE_DRUM_ROLE_', entryMode: 'AFE_DRUM_ENTRY_', fillPolicy: 'AFE_DRUM_FILL_',
    timingProfile: 'AFE_DRUM_TIMING_', velocityProfile: 'AFE_DRUM_VEL_',
    kickPolicy: 'AFE_DRUM_KICK_', snarePolicy: 'AFE_DRUM_SNARE_', hatPolicy: 'AFE_DRUM_HAT_',
    cymbalPolicy: 'AFE_DRUM_CYMBAL_', tomPolicy: 'AFE_DRUM_TOM_',
    foregroundGuard: 'AFE_DRUM_GUARD_', feelProfileId: 'AFE_DRUM_FEEL_',
    openingDrumEntry: 'AFE_DRUM_OPENING_',
  };
  const derive = (ts: string, field: string): string =>
    ABI_PREFIX[field] + ts.replace(/([a-z0-9])(?=[A-Z])/g, '$1_').replace(/-/g, '_').toUpperCase();

  it('枚举映射经独立推导核对（二轮 F1：三层查名字存在挡不住映射错配）', () => {
    const PAIRS: Array<[string, Record<string, string>]> = [
      ['role', ROLE_ABI], ['entryMode', ENTRY_MODE_ABI], ['fillPolicy', FILL_POLICY_ABI],
      ['timingProfile', TIMING_PROFILE_ABI], ['velocityProfile', VELOCITY_PROFILE_ABI],
      ['kickPolicy', KICK_POLICY_ABI], ['snarePolicy', SNARE_POLICY_ABI],
      ['hatPolicy', HAT_POLICY_ABI], ['cymbalPolicy', CYMBAL_POLICY_ABI],
      ['tomPolicy', TOM_POLICY_ABI], ['foregroundGuard', GUARD_ABI],
      ['feelProfileId', FEEL_ABI], ['openingDrumEntry', OPENING_ENTRY_ABI],
    ];
    let n = 0;
    for (const [field, tbl] of PAIRS) {
      for (const [ts, abi] of Object.entries(tbl)) {
        expect(abi, `${field}: TS 串 ${ts} 的映射与独立推导不符`).toBe(derive(ts, field));
        n++;
      }
    }
    // 63 = 13 张表条目实测总数（**不是手写猜的**——我第一版写 58，被本断言当场抓住；
    //   这个锚的作用是防表被误删条目，故必须是实测值）
    expect(n, '映射条目总数（实测锚，防表条目被误删）').toBe(63);
    // 判据自检：故意错配必须被抓（否则本测试是恒真的摆设）
    expect(derive('full', 'entryMode')).toBe('AFE_DRUM_ENTRY_FULL');
    expect(derive('full', 'entryMode')).not.toBe('AFE_DRUM_ENTRY_HAT_ONLY');
    expect(derive('hatsOnly', 'openingDrumEntry')).toBe('AFE_DRUM_OPENING_HATS_ONLY');
    expect(derive('ghost-before-backbeat', 'snarePolicy'))
      .toBe('AFE_DRUM_SNARE_GHOST_BEFORE_BACKBEAT');
  });

  it('导出 (输入, 期望合同) 成对 golden', () => {
    // ① score 读取闭包定理
    const plannerSrc = readFileSync(join(REPO, PLANNER_REL), 'utf8');
    const closure = proveScoreReadClosure(plannerSrc);
    expect(closure.scoreProps, 'score 只读 boundaries').toEqual(['boundaries']);
    expect(closure.boundaryProps.every((p) => (SCORE_CLOSURE as readonly string[]).includes(p)),
      `boundary 读取面须 ⊆ ${SCORE_CLOSURE.join(',')}，实得 ${closure.boundaryProps.join(',')}`).toBe(true);

    // ② 覆盖缺口断言：21 个 id 内无「同分支双关键字」（见文件头记账）
    const JAZZ_KW = ['smooth', 'bossa', 'ballad'];
    const RNB_KW = ['gospel', 'dilla', 'trap', 'motown'];
    const LOFI_KW = ['late', 'halftime', 'lazy', 'dusty'];
    for (const c of GROOVE_CONTRACT_POOL) {
      for (const [br, kws] of [['jazz', JAZZ_KW], ['rnb', RNB_KW]] as const) {
        const hit = kws.filter((k) => c.id.includes(k));
        expect(hit.length <= 1, `${c.id} 在 ${br} 分支命中多个关键字 ${hit.join(',')}`
          + '——覆盖缺口记账失效，须补 fixture').toBe(true);
      }
      // lofi 分支的 halftime/(lazy|dusty) 双命中是**已知且被 fixture 覆盖**的优先级样本
      const lh = LOFI_KW.filter((k) => c.id.includes(k));
      if (lh.length > 1) {
        expect(c.id, 'lofi 双关键字目前只应出现在 lofi_halftime_dusty').toBe('lofi_halftime_dusty');
      }
    }

    // ③ 断言看守：真 KB 的 drum family 名必须全部落在 27 registry 内。
    //   TS 允许非法名并回退，C 侧 FK 非法即 ERR_BAD_CONTRACT ⇒ 两侧对不上。
    //   一旦 KB 出现非法名，本断言转红，要求先解决表示问题再补 fixture。
    for (const c of GROOVE_CONTRACT_POOL) {
      const d = c.drum;
      if (!d) continue;
      for (const k of ['timekeeperFamily', 'liftFamily', 'pickupFamily', 'breakdownFamily'] as const) {
        const v = (d as Record<string, unknown>)[k];
        if (v === undefined || v === null) continue;
        expect((FAMILY_ORDER as readonly string[]).includes(String(v)),
          `${c.id}.drum.${k}=${String(v)} 不在 27 family registry 内——`
          + 'C 侧 FK 非法即 ERR_BAD_CONTRACT，两侧语义分歧，须先解决表示问题').toBe(true);
      }
    }

    // ④ 27 family 冻结序须与 registry 一致（防重编号）
    expect(FAMILY_ORDER.length, 'family 27').toBe(27);
    expect(new Set(FAMILY_ORDER).size, 'family 名不重复').toBe(27);

    const built = buildCases();
    expect(built.length, 'fixture 数').toBeGreaterThan(150);

    const contractPool = poolSpecs.map((s, i) => {
      const enumId = CONTRACT_ENUM.get(s.base);
      if (enumId === undefined) throw new Error(`池[${i}] 基底 ${s.base} 无 enum`);
      return {
        poolIdx: i, baseId: s.base, baseIdEnum: enumId,
        idStr: s.idStr ?? null,
        density: s.density ?? null, grid: s.grid ?? null,
        rhythmSwingSource: s.rhythmSwingSource ?? null,
        drum: s.drum === null ? 'REMOVED' : (s.drum ?? null),
      };
    });

    const exporterSha = createHash('sha256')
      .update(readFileSync(join(REPO, EXPORTER_REL))).digest('hex');
    const doc = {
      meta: {
        layer: 'drum performance plan golden (planDrumPerformance raw)',
        schemaVersion: SCHEMA_VERSION,
        generator: EXPORTER_REL,
        exporterSha,
        engineBaseCommit: ENGINE_BASE_COMMIT,
        specAnchor: SPEC_ANCHOR,
        note: '拆步5 afe_plan_drum_performance 的逐位对账靶。合同池只克隆真合同 + 覆盖结构字段，'
          + '**绝不覆盖 id 串**（id↔enum 绑定是拆步3 冻结的 feel 表前提，见 exporter 头注）。'
          + 'densityCeiling 量化 = round_half_up(fl(x*1000))；同时导出量化前/后的 binary64 位型供 tie 自检。',
        scoreReadClosure: closure,
        coverageGaps: [
          "[不可达] role='silent'：roleForSection 永不产（设计 §6.1-1）；density 第五行由拆步3 AST 定理独立冻结",
          '[不可达] fillForBoundary：DEV-002 冻结 groove_score_plan 必传，生产不可达；恢复落点见执行计划具名条目',
          '[C 域不可表示] TS validDrumFamily 对**非法 family 名**回退；C 侧 family 是 FK，'
            + '步1 冻结「非法 family → ERR_BAD_CONTRACT」⇒ 该输入形态在 C 域不可达。'
            + '行为面已由 undefined 回退链等价覆盖（TS 里非法名与 undefined 同路径）；'
            + 'exporter 断言看守「真 KB 的 family 名全部合法」，一旦出现非法名即转红',
          '[不可达] 单个合同 id 同含同分支双关键字（如 smooth+ballad）：v5 21 合同无此形态，'
            + '而合成 id 串会破坏 id↔enum 不变量；改用真 id × 7 style 组合覆盖子串优先级，exporter 断言看守',
        ],
        emissionOrder: { sections: '输入段声明序（对锁 TS for i）' },
      },
      contractPool,
      cases: built,
    };
    mkdirSync(dirname(OUT_JSON), { recursive: true });
    writeFileSync(OUT_JSON, JSON.stringify(doc, null, 1) + '\n', 'utf8');
    expect(doc.cases.length).toBe(built.length);
  });
});
