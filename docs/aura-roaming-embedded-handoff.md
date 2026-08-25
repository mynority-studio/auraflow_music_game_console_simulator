# 光律漫游 · Aura Key — 嵌入式开发交接文档（含全部源码）

- 生成日期:2026-08-25;源:simulator 仓 weslay-0810 分支 `src/features/auraRoaming/`
- 配套文档:`aura-roaming-gameplay-spec.md`(行为真源,数值裁定)、engine 仓 `aura_key_gameplay_port_plan_20260822.md`(复刻计划)
- 本文档目的:给嵌入式工程师的**完整实现参考**——功能分几个阶段、每个环节的状态名、状态怎么迁移、定时器怎么管理,最后附全部 TypeScript 源码(行为参照物,含测试 = 行为规格)。

---

## 1. 功能总览

生成的音乐照常播放(**lead 主旋律不静音**),15 个物理按键(5列×3行,每键 9 颗 LED)变成"亮哪按哪"的引导层:

- 系统提前算好"哪些时刻、哪个键该亮"(提示计划,离线纯函数);
- 播放时每个提示键做呼吸灯,**最亮点落在对应音符发声前 120ms**;
- 用户在阈值内按下 → 该键发接管乐器音色(**贴谱**:声音落在音符正点,不跟手指)+ 一记拍手打击 + 爆闪波纹;
- 按偏 → 乐器不发声,只回一记鼓边边击;
- 完全没按 → 静默漏过;
- 没亮的键随便按,即按即响(自由弹奏)。

计分:律光(分数)、combo(连击,≥5 充能)、律光音轨(两次成功命中之间穿插自由弹奏)。

## 2. 管线分层(三个阶段)

```
┌─ Phase A 生成期(离线,纯函数,seed 确定,可放 MCU 生成完成后一次算好)─┐
│  A1 重音打分   leadAccents   : lead 每个音符 → 显著度分数              │
│  A2 节奏型抽取 cuePlanner    : 逐小节抽槽位+防节拍器 → PlannedCue[]    │
│  A3 和声填充   harmonicFill  : lead 空窗补结构音/色彩音提示            │
│  A4 键位绑定   padLookup     : 音高 → 15 键索引(布局外提示丢弃)      │
│  产物: RuntimeCue[](tick 升序,id 重编)= 嵌入式的 AuraCuePlan 工件   │
└──────────────────────────────────────────────────────────────────────┘
┌─ Phase B 运行期(实时,50ms 轮询 + 事件驱动)────────────────────────────┐
│  B1 灯光排程   poll()        : cueState pending→lit,发呼吸灯事件      │
│  B2 输入捕获   onPadDown/Up  : 屏幕键总线 + MIDI 位置键                │
│  B3 判定       classifyPressDelta : Δt → perfect/good/missAttempt      │
│  B4 发声       贴谱 snapTimers + 时值延音 sustains + 打击叠击          │
│  B5 视觉       呼吸灯/爆闪/波纹(LED 渲染层每帧算包络)                │
└──────────────────────────────────────────────────────────────────────┘
┌─ Phase C 计分层(纯 reducer,任何平台可直移)───────────────────────────┐
│  C1 计分       applyJudgement : 律光/combo/充能                        │
│  C2 律光音轨   luxTrail       : 锚点状态机                             │
│  C3 HUD        🌟 晃动/颤抖/光斑(产品屏)                             │
└──────────────────────────────────────────────────────────────────────┘
```

## 3. 核心状态机与命名(嵌入式实现按这些名字对齐)

### 3.1 提示生命周期 `cueState`(每条提示一份)

```
 pending ──(riseStart 进入 150ms lookahead)──► lit ──┬─(成功命中)────► done
    │                                                ├─(按偏命中)────► done
    │                                                └─(正点+380ms+50ms 仍未按 → 漏过)► done
    └─(seek 越过:wallMs < now−380ms,不判 miss)────────────────────► done
 重播/回跳(tick 大幅倒退):done/lit → pending(仅未来提示);曲首回跳时整局计分清零
```

- `pending`:已计划,尚未排灯;
- `lit`:呼吸灯事件已发出(带绝对峰值时刻),等待判定;
- `done`:已消费(成功/按偏/漏过/被跳过),不再参与任何判定。

### 3.2 呼吸灯包络阶段(渲染层每帧对每个 glow 求值,函数 `cueGlowIntensity`)

```
 dark(0) ─► rise(620ms 余弦缓升) ─► peak(=音符正点−120ms,亮度1) ─► hold(480ms) ─► fade(260ms) ─► removed(-1)
                                        │
                             命中时 snuffGlow():立刻截断到当前,快灭 140ms(视觉"被接住")
```

关键契约:**峰值时刻是绝对时基**(performance.now 系;嵌入式对应硬件毫秒时钟),事件派发抖动不影响峰值精度;**每条提示独立排程**,与前一个灯的状态无关,窗口重叠即多键同时呼吸。

### 3.3 判定枚举 `AuraJudgementKind`(Δt = 按压时刻 − 音符正点 − 延迟补偿)

| 状态名 | 条件 | 乐器音 | 打击音 | 计分 | 律光音轨 |
|---|---|---|---|---|---|
| `perfect` | \|Δt\| ≤ 80ms | 贴谱发声 | 拍手 GM39 v112 | 律光+2, combo+1 | 可收口/起锚 |
| `good` | \|Δt\| ≤ 220ms | 贴谱发声 | 拍手 GM39 v88 | 律光+1, combo+1 | 可收口/起锚 |
| `missAttempt`(按偏) | \|Δt\| ≤ 380ms | **不发声** | 边击 GM37 v80 即刻 | combo 清零 | **打断** |
| `missIgnore`(漏过) | 超时未按 | — | — | combo 清零 | **不打断**(A→C 语义) |
| (自由弹奏,无判定) | 窗外 / 未亮键 | 即按即响 | — | — | 音轨材料 |

### 3.4 计分状态 `AuraScoreState` / 律光音轨状态 `LuxTrailState`

```
AuraScoreState { lux, combo, bestCombo, charging(=combo≥5), judged{4类计数} }
LuxTrailState  { anchorCueId, anchorBeat, sawUnlitPress }
  成功命中: anchor≠null 且 sawUnlitPress 且 间距≤8拍 → 记一条音轨;命中总是成为新锚
  未亮键按压: 有锚才置 sawUnlitPress
  missAttempt: 整个状态清空(打断);missIgnore 不触碰该状态
```

### 3.5 运行时资源(定时器/映射,关闭 Aura Key 必须全清)

| 名称 | 类型 | 作用 |
|---|---|---|
| `pollTimer` | 50ms 周期 | 灯光排程 + 漏过判定 + 换歌/回跳检测 |
| `snapTimers` | Map<sourceId, timer> | 贴谱发声:早按的 noteOn 推迟到正点−30ms |
| `sustains` | Map<sourceId, {untilMs, timer, padIndex}> | 时值延音:松手推迟 note-off 到时值结束+150ms(封顶5s) |
| `gainBoostTimer` | 一次性 90ms | CC7=127 抬档(voice setup 会写回默认,延迟补发保证 last-writer-wins) |
| 同键再按 | `flushSustain` | 作废未发声的挂起 noteOn(无需 noteOff);已发声的立即 noteOff → legato 交接 |

### 3.6 视觉反馈事件(渲染层协议,对应嵌入式 LED 驱动命令)

| 事件 | 载荷 | 含义 |
|---|---|---|
| `aura_cue` | cueId,col,row,hue,peakAtMs,riseMs,holdMs,fadeMs | 排一个呼吸灯(包络参数全带上) |
| `aura_cue_hit` | cueId(+col,row,hue,energy=成功时) | 收灯;成功时叠爆闪+波纹 |
| `aura_cue_clear` | — | 清空所有引导灯(停播/换歌/关闭) |

命中视觉三层(成功才有):整键爆闪(峰值 2.8/2.2,340ms 二次方衰减,max 混合)+ 小涟漪波纹(r→5 约两键宽,厚1.4)+ 粒子爆(3.6/2.8,spread 2.6)。Aura Key 模式内**关闭整轨氛围光与按键流体拖尾**,按键反馈改清脆 3×3 暗块。

## 4. 时序常量总表(全部裁定值,嵌入式做成可调参数)

| 常量 | 值 | 说明 |
|---|---|---|
| CUE_RISE_MS | 620ms | 呼吸缓升时长(统一,不随间距变) |
| CUE_PEAK_LEAD_MS | 120ms | 峰值提前音符正点的量 |
| CUE_HOLD_MS | 480ms | 峰值保持 |
| CUE_FADE_MS | 260ms | 渐灭 |
| 命中快灭 | 140ms | snuffGlow |
| perfectMs / goodMs / attemptMs | 80 / 220 / 380ms | 判定窗口 |
| SNAP_FIRE_EARLY_MS | 30ms | 贴谱提前量(交给接管量化器落格) |
| CUE_SUSTAIN_TAIL_MS / MAX | 150ms / 5000ms | 延音尾 / 封顶 |
| POLL_MS / SCHEDULE_LOOKAHEAD_MS | 50 / 150ms | 轮询周期 / 排灯前瞻 |
| AURA_KEY_USER_CC7 | 100(与生成 lead 持平;2026-08-25 撤销 127 对比档) | 接管通道音量(仍显式补发防 setup 覆盖) |
| DEFAULT_PAD_VELOCITY | 112 | 屏幕键默认力度 |
| CHARGE_COMBO | 5 | 充能门槛 |
| TRAIL_MAX_GAP_BEATS | 8 拍 | 律光音轨锚点有效期 |
| CUE_HUE | 272(紫) | 引导色;Perfect 反馈 48(金) |

## 5. 已付学费的坑(嵌入式必读)

1. **CC 输出合同**:生成曲五通道的默认输出过滤器会丢弃裸 CC7;接管/引导用的辅助实时通道(scheduler ch15 → 线上 ch16)必须显式豁免,否则音量抬档静默失效(我们踩过);
2. **灯不排队**:上升时长必须与前一提示解耦(曾做成间距相关 → 视觉像"等前灯熄灭才亮");
3. **爆闪层**:命中瞬间如果只"收引导灯",亮度反而下降;必须叠加高于引导峰值的爆闪层;
4. **贴谱早按**:noteOn 定时到正点会被量化器向后取整到下一格,要提前 30ms 送入;
5. **漏过不判早**:seek/回跳越过的历史提示直接 done,不计 missIgnore;
6. **音色选择**:接管音色来自变体银行(bank 8/16/24…),能力判断必须走音色档案解析,不能只看 bank0。

---

# 附录:全部源码

以下为 `src/features/auraRoaming/` 全部文件 + 关键集成点,与仓库逐字一致。
测试文件 = 可执行的行为规格(复刻时导出为 golden 向量)。

<!-- CODE-SECTIONS-BELOW -->

## A. 类型与常量

## `src/features/auraRoaming/types.ts`

全部共享类型 + 裁定常量(判定窗口/灯光时序/延音/色相)。嵌入式的参数表来源。

```typescript
// ============================================================
// auraRoaming · types(光律漫游共享契约)
// ------------------------------------------------------------
// 功能整体收在 src/features/auraRoaming/ 独立目录,方便日后整体迁移。
// 两个模式:氛围漫游 = 现有音乐生成(Q+H 配置,这里零设置);
// Aura Key = 亮灯引导跟弹(lead 不静音,15 键逻辑与用户接管沙盒一致)。
// ============================================================

/** 只读 lead 音符(从 MusicalIR NoteIR 适配,剥掉品牌类型)。 */
export interface AuraLeadNote {
  pitch: number;
  startTick: number;
  durationTicks: number;
  velocity: number;
}

/** 提示音的时值档:只提示全/二/四分 + 少量八分,防节拍器由 planner 负责。 */
export type CueValueClass = 'whole' | 'half' | 'quarter' | 'eighth';

/** 重音打分候选(accent 层输出,planner 输入)。 */
export interface AccentCandidate {
  noteIndex: number;
  tick: number;
  beat: number;
  pitch: number;
  durationBeats: number;
  velocity: number;
  score: number;
}

/** planner 选定的提示音(尚未绑定键位)。
 *  source:'lead' = 来自 lead 重音;'harmonic' = 和声填充(lead 无旋律的
 *  空窗里,按当前布局的结构音/色彩音提前亮灯,ACG 等稀疏风格提密度)。 */
export interface PlannedCue {
  id: number;
  tick: number;
  beat: number;
  pitch: number;
  durationBeats: number;
  valueClass: CueValueClass;
  source?: 'lead' | 'harmonic';
}

export type AuraJudgementKind = 'perfect' | 'good' | 'missAttempt' | 'missIgnore';

export interface AuraJudgeWindows {
  /** |Δt| ≤ perfectMs → Perfect */
  perfectMs: number;
  /** perfect < |Δt| ≤ goodMs → 普通成功 */
  goodMs: number;
  /** good < |Δt| ≤ attemptMs → 按偏 miss;更远 = 自由弹奏不判定 */
  attemptMs: number;
}

export const DEFAULT_JUDGE_WINDOWS: AuraJudgeWindows = {
  perfectMs: 80,
  goodMs: 220,
  attemptMs: 380,
};

export const LUX_PER_PERFECT = 2;
export const LUX_PER_GOOD = 1;
/** 连续成功该次数进入「充能」🌟高能颤抖 + 光斑喷射。 */
export const CHARGE_COMBO = 5;
/** 律光音轨:两次成功命中相距超过该拍数则锚点作废。 */
export const TRAIL_MAX_GAP_BEATS = 8;

/** 呼吸灯时序:最亮点提前量(实测 75ms 手感偏急,提前到 120ms)。 */
export const CUE_PEAK_LEAD_MS = 120;
/** 最亮保持窗(覆盖住音符发声时刻,给用户反应;实测加长到 480ms)。 */
export const CUE_HOLD_MS = 480;
export const CUE_FADE_MS = 260;
/** 呼吸上升时长:所有提示统一固定 — 每个键只按自己的峰值时刻倒推
 *  起亮点,窗口重叠就同时呼吸,绝不等前一个灯熄灭。 */
export const CUE_RISE_MS = 620;
/** 引导灯主色相(紫罗兰,与面板 violet 一致)。 */
export const CUE_HUE = 272;
/** 亮灯键命中后的自动时值延音:按 lead 音符时值持续,再加一点
 *  legato 尾巴衔接下一个提示;未亮键不延音。 */
export const CUE_SUSTAIN_TAIL_MS = 150;
export const CUE_SUSTAIN_MAX_MS = 5000;
```

## `src/features/auraRoaming/index.ts`

唯一对外出口(整个功能独立目录,外部只从这里 import)。

```typescript
// ============================================================
// auraRoaming · 光律漫游唯一对外出口
// ------------------------------------------------------------
// 功能整体收在本目录,外部(App/devPanels)只从这里 import,
// 方便日后整体迁移到正式产品层。
// ============================================================

export { AuraRoamingPanel } from './ui/AuraRoamingPanel';
export { AuraStarHud } from './ui/AuraStarHud';
export { getAuraRoamingSnapshot, subscribeAuraRoaming } from './state/auraRoamingStore';
export { setAuraKeyOn, toggleAuraKey, isAuraKeyOn } from './runtime/auraKeyRuntime';
```

## B. Phase A 生成期(纯函数,可直移 C)

## `src/features/auraRoaming/accent/leadAccents.ts`

A1 重音打分:lead 每音符 → 显著度分数(乐句头/节拍位置/时值/力度峰/音高峰)。

```typescript
// ============================================================
// auraRoaming · accent(lead 重音识别)
// ------------------------------------------------------------
// 只读消费最终 lead NoteIR(MG 链外,不改任何事件 → 天然满足
// productLeadNonMutation)。给每个音符打"重音显著度"分,cuePlanner
// 再按节奏型/密度从候选里挑提示音。
//
// 打分维度:乐句头(休止后首音)、小节正拍/次强拍、长时值、
// 局部力度峰、局部音高峰。分数只用于排序,不承诺绝对量纲。
// ============================================================

import type { AccentCandidate, AuraLeadNote } from '../types';

export interface AccentScoringContext {
  ppq: number;
  beatsPerBar: number;
}

const GRID_EPS = 0.07;

function isNear(value: number, target: number): boolean {
  return Math.abs(value - target) < GRID_EPS;
}

function isOnGrid(beat: number, grid: number): boolean {
  const nearest = Math.round(beat / grid) * grid;
  return Math.abs(beat - nearest) < GRID_EPS;
}

/** lead 音符 → 重音候选(按 tick 升序;分数越高越该被提示)。 */
export function scoreLeadAccents(
  notes: readonly AuraLeadNote[],
  ctx: AccentScoringContext,
): AccentCandidate[] {
  const { ppq, beatsPerBar } = ctx;
  const sorted = notes
    .map((note, noteIndex) => ({ note, noteIndex }))
    .sort((a, b) => a.note.startTick - b.note.startTick || a.note.pitch - b.note.pitch);

  const out: AccentCandidate[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const { note, noteIndex } = sorted[i];
    const beat = note.startTick / ppq;
    const durationBeats = note.durationTicks / ppq;
    const posInBar = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;

    let score = 0;

    // 乐句头:曲首或休止 ≥1 拍之后的首音
    if (i === 0) {
      score += 3;
    } else {
      const prev = sorted[i - 1].note;
      const gapBeats = (note.startTick - (prev.startTick + prev.durationTicks)) / ppq;
      if (gapBeats >= 1) score += 3;
      else if (gapBeats >= 0.5) score += 1.2;
    }

    // 节拍位置
    if (isNear(posInBar, 0) || isNear(posInBar, beatsPerBar)) score += 2.5;
    else if (beatsPerBar % 2 === 0 && isNear(posInBar, beatsPerBar / 2)) score += 1.5;
    else if (isOnGrid(beat, 1)) score += 0.8;
    else if (isOnGrid(beat, 0.5)) score += 0.3;

    // 时值(长音天然是"缓缓呼吸"的好目标)
    if (durationBeats >= 2) score += 3;
    else if (durationBeats >= 1) score += 2;
    else if (durationBeats >= 0.5) score += 0.75;

    // 局部力度峰
    const prevVel = i > 0 ? sorted[i - 1].note.velocity : -1;
    const nextVel = i < sorted.length - 1 ? sorted[i + 1].note.velocity : -1;
    if (note.velocity >= prevVel && note.velocity >= nextVel && (note.velocity > prevVel || note.velocity > nextVel)) {
      score += 1.2;
    }

    // 局部音高峰(旋律轮廓顶点)
    const prevPitch = i > 0 ? sorted[i - 1].note.pitch : Number.NEGATIVE_INFINITY;
    const nextPitch = i < sorted.length - 1 ? sorted[i + 1].note.pitch : Number.NEGATIVE_INFINITY;
    if (note.pitch > prevPitch && note.pitch > nextPitch) score += 0.8;

    out.push({ noteIndex, tick: note.startTick, beat, pitch: note.pitch, durationBeats, velocity: note.velocity, score });
  }
  return out;
}
```

## `src/features/auraRoaming/cue/cuePlanner.ts`

A2 节奏型抽取:逐小节权重抽槽位 + 能量波 + 三条防节拍器硬规则。mulberry32 为确定性 PRNG。

```typescript
// ============================================================
// auraRoaming · cuePlanner(提示音选择,防节拍器)
// ------------------------------------------------------------
// 逐小节从加权节奏型库抽取提示槽位(全/二/四分 + 少量八分),
// seed 驱动 + 小节能量波调密度;槽位再对齐到 accent 候选上。
// 三条硬规则:
//   1. 相邻提示间隔 < 0.45 拍必弃(引导不该比八分还密);
//   2. 八分间隔(0.45~0.55 拍)提示占比 ≤ ~12%,超预算即弃;
//   3. 连续相同间隔最多 3 次,第 4 次强制丢弃 → 不会退化成节拍器。
// 纯函数:相同 (candidates, ctx) 恒得相同计划。
// ============================================================

import type { AccentCandidate, CueValueClass, PlannedCue } from '../types';

export interface CuePlanContext {
  beatsPerBar: number;
  totalBeats: number;
  seed: number;
}

/** mulberry32:确定性小 PRNG(与工程内其他 seeded 逻辑同风格)。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SlotPattern {
  key: string;
  weight: number;
  /** 小节内槽位(拍),含 .5 即为八分槽。energyBias>0 → 高能量小节更偏好。 */
  slots: (beatsPerBar: number, rng: () => number) => number[];
  energyBias: number;
}

// 权重整体偏密(实测"久久才亮一个"太呆):期望 ~2.3 槽/小节,再经
// 候选对齐/键位反查/防节拍器过滤后仍有 ~1.5+/小节的活跃引导感。
const PATTERNS: SlotPattern[] = [
  { key: 'rest', weight: 0.4, energyBias: -1, slots: () => [] },
  { key: 'whole', weight: 1.5, energyBias: -0.5, slots: () => [0] },
  { key: 'half', weight: 3, energyBias: 0, slots: (bpb) => [0, Math.floor(bpb / 2)] },
  { key: 'halfOff', weight: 1.2, energyBias: 0, slots: (bpb) => [Math.floor(bpb / 2)] },
  {
    key: 'quarterPair', weight: 3.5, energyBias: 0.5,
    slots: (bpb, rng) => {
      const first = Math.floor(rng() * Math.max(1, bpb - 1));
      const second = first + 1 + Math.floor(rng() * Math.max(1, bpb - first - 1));
      return [first, Math.min(second, bpb - 1)];
    },
  },
  {
    key: 'quarterTriple', weight: 3, energyBias: 1,
    slots: (bpb, rng) => {
      const all = Array.from({ length: bpb }, (_, i) => i);
      // 去掉一个随机整数拍,留下 bpb-1 个(4/4 → 3 个)
      all.splice(Math.floor(rng() * all.length), 1);
      return all;
    },
  },
  {
    key: 'quarterFull', weight: 1.5, energyBias: 1.2,
    slots: (bpb) => Array.from({ length: bpb }, (_, i) => i),
  },
  {
    key: 'withEighth', weight: 1.6, energyBias: 1,
    slots: (bpb, rng) => {
      const anchor = Math.floor(rng() * Math.max(1, bpb - 1));
      return [anchor, anchor + 0.5, Math.min(anchor + 2, bpb - 1)];
    },
  },
];

function valueClassOf(slotInBar: number, pattern: SlotPattern, beatsPerBar: number): CueValueClass {
  if (slotInBar % 1 !== 0) return 'eighth';
  if (pattern.key === 'whole') return 'whole';
  if (pattern.key === 'half' || pattern.key === 'halfOff') return 'half';
  if (pattern.key === 'withEighth' && beatsPerBar > 0) return 'quarter';
  return 'quarter';
}

/** 槽位 → 最近的高分候选(±0.45 拍容差 — 真实 lead 有休止,容差
 *  太窄会让大量槽位落空,引导密度骤降;分数优先)。 */
function bestCandidateNear(
  candidates: readonly AccentCandidate[],
  targetBeat: number,
): AccentCandidate | null {
  let best: AccentCandidate | null = null;
  for (const c of candidates) {
    if (Math.abs(c.beat - targetBeat) > 0.45) continue;
    if (!best || c.score > best.score || (c.score === best.score && Math.abs(c.beat - targetBeat) < Math.abs(best.beat - targetBeat))) {
      best = c;
    }
  }
  return best;
}

export function planCues(candidates: readonly AccentCandidate[], ctx: CuePlanContext): PlannedCue[] {
  const { beatsPerBar, totalBeats, seed } = ctx;
  if (beatsPerBar <= 0 || totalBeats <= 0 || candidates.length === 0) return [];

  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const energyPhase = rng() * Math.PI * 2;
  const barCount = Math.ceil(totalBeats / beatsPerBar);

  interface Picked { candidate: AccentCandidate; valueClass: CueValueClass; }
  const picked: Picked[] = [];
  const usedNoteIndexes = new Set<number>();

  for (let bar = 0; bar < barCount; bar++) {
    // 8 小节一个能量波:verse 疏、chorus 密的近似(无段落元数据也成立)
    const energy = 0.5 + 0.5 * Math.sin((Math.PI * 2 * bar) / 8 + energyPhase);
    let totalWeight = 0;
    const weights = PATTERNS.map((p) => {
      const w = Math.max(0.05, p.weight * (1 + p.energyBias * (energy - 0.5)));
      totalWeight += w;
      return w;
    });
    let roll = rng() * totalWeight;
    let pattern = PATTERNS[0];
    for (let i = 0; i < PATTERNS.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { pattern = PATTERNS[i]; break; }
    }

    const barStart = bar * beatsPerBar;
    for (const slot of pattern.slots(beatsPerBar, rng)) {
      const candidate = bestCandidateNear(candidates, barStart + slot);
      if (!candidate || usedNoteIndexes.has(candidate.noteIndex)) continue;
      usedNoteIndexes.add(candidate.noteIndex);
      picked.push({ candidate, valueClass: valueClassOf(slot, pattern, beatsPerBar) });
    }
  }

  picked.sort((a, b) => a.candidate.tick - b.candidate.tick);

  // ---- 全局硬规则过滤 ----
  const out: PlannedCue[] = [];
  const eighthBudget = Math.max(2, Math.floor(picked.length * 0.15));
  let eighthUsed = 0;
  const recentIntervals: number[] = [];

  for (const { candidate, valueClass } of picked) {
    const prev = out[out.length - 1];
    if (prev) {
      const interval = candidate.beat - prev.beat;
      if (interval < 0.45) continue; // 比八分还密 → 弃
      const isEighthGap = interval < 0.55 + 1e-9;
      if (isEighthGap && eighthUsed >= eighthBudget) continue;
      // 防节拍器:连续相同间隔 ≤3
      if (
        recentIntervals.length >= 3
        && recentIntervals.slice(-3).every((v) => Math.abs(v - interval) < 0.02)
      ) continue;
      if (isEighthGap) eighthUsed++;
      recentIntervals.push(interval);
      if (recentIntervals.length > 8) recentIntervals.shift();
    }
    out.push({
      id: out.length,
      tick: candidate.tick,
      beat: candidate.beat,
      pitch: candidate.pitch,
      durationBeats: candidate.durationBeats,
      valueClass,
    });
  }
  return out;
}
```

## `src/features/auraRoaming/cue/harmonicFill.ts`

A3 和声填充:lead 空窗里强拍亮结构音(p=0.65)/弱拍亮色彩音(p=0.3),布局即安全音图。

```typescript
// ============================================================
// auraRoaming · harmonicFill(和声填充提示,纯函数)
// ------------------------------------------------------------
// lead 稀疏(尤其 ACG)时提示密度骤降。接管布局本身是逐和弦重建的
// 安全音图,cell 自带 classRole:即使当下 lead 没旋律,"重拍按结构音、
// 弱拍按色彩音"也一定和谐 → 在 lead 提示的空窗里按概率补亮:
//   · 强拍(小节头/中点)偏好 chord 结构音,概率高;
//   · 其他整数拍作弱拍,偏好 scale/approach 色彩音,概率低;
//   · 与既有提示(含已补的)最小间距 1 拍,不挤 lead 锚点;
// seed 驱动,纯函数确定性。
// ============================================================

import type { PlannedCue } from '../types';

export interface HarmonicFillCell {
  index: number;
  midi: number;
  classRole: string;
}

export interface HarmonicFillContext {
  beatsPerBar: number;
  totalBeats: number;
  seed: number;
  ppq: number;
  /** 该拍的当前布局 cells(runtime 里来自 controller.getPadMap)。 */
  cellsAtBeat: (beat: number) => readonly HarmonicFillCell[] | null;
}

/** 已绑定键位的填充提示。 */
export interface HarmonicFillCue extends PlannedCue {
  padIndex: number;
}

const MIN_GAP_BEATS = 1.0;
const STRONG_PROB = 0.65;
const WEAK_PROB = 0.3;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function planHarmonicFillCues(
  leadCues: readonly PlannedCue[],
  ctx: HarmonicFillContext,
): HarmonicFillCue[] {
  const { beatsPerBar, totalBeats, seed, ppq, cellsAtBeat } = ctx;
  if (beatsPerBar <= 0 || totalBeats <= 0) return [];
  const rng = mulberry32((seed ^ 0x51f0a7) >>> 0);

  const occupied = leadCues.map((c) => c.beat);
  const out: HarmonicFillCue[] = [];
  const tooClose = (beat: number): boolean =>
    occupied.some((b) => Math.abs(b - beat) < MIN_GAP_BEATS)
    || out.some((c) => Math.abs(c.beat - beat) < MIN_GAP_BEATS);

  for (let beat = 0; beat < Math.floor(totalBeats); beat++) {
    const posInBar = beat % beatsPerBar;
    const strong = posInBar === 0 || (beatsPerBar % 2 === 0 && posInBar === beatsPerBar / 2);
    const roll = rng(); // 每拍都消耗一次随机数,决策与 tooClose 顺序无关 → 确定性稳定
    const pick = rng();
    if (tooClose(beat)) continue;
    if (roll > (strong ? STRONG_PROB : WEAK_PROB)) continue;

    const cells = cellsAtBeat(beat);
    if (!cells || cells.length === 0) continue;
    let pool = strong
      ? cells.filter((c) => c.classRole === 'chord')
      : cells.filter((c) => c.classRole === 'scale' || c.classRole === 'approach');
    if (pool.length === 0) pool = cells.filter((c) => c.classRole === 'chord');
    if (pool.length === 0) continue;

    // 靠中心优先,前 3 个里 seeded 抖动选一个,避免每次都同一键
    const sorted = [...pool].sort((a, b) => Math.abs(a.index - 7) - Math.abs(b.index - 7));
    const cell = sorted[Math.floor(pick * Math.min(3, sorted.length))];

    out.push({
      id: 0, // 合并排序后由 runtime 统一重编
      tick: Math.round(beat * ppq),
      beat,
      pitch: cell.midi,
      durationBeats: strong ? 1 : 0.5,
      valueClass: 'quarter',
      source: 'harmonic',
      padIndex: cell.index,
    });
  }
  return out;
}
```

## `src/features/auraRoaming/cue/padLookup.ts`

A4 键位绑定:音高 → 键索引,精确匹配 → 八度折叠 → 布局外丢弃;重复 cell 取近中心。

```typescript
// ============================================================
// auraRoaming · padLookup(lead 音高 → 15 键位反查,纯函数)
// ------------------------------------------------------------
// 接管布局是按和弦重建的两八度安全音窗;lead 音符可能:
//   · 恰好在布局里(精确 midi 命中,重复 cell 取离中心 7 最近的);
//   · 只有同 pitch-class 的八度折叠(仍然"这个音在布局的这个位置");
//   · 完全不在 → 该提示跳过(引导必须诚实)。
// ============================================================

import { TAKEOVER_CENTER_PAD_INDEX } from '../../../core/generation/leadTakeoverSandbox/padLayout';

export interface PadLookupCell {
  index: number;
  midi: number;
  pc: number;
}

function nearestCenter(a: PadLookupCell, b: PadLookupCell): PadLookupCell {
  const da = Math.abs(a.index - TAKEOVER_CENTER_PAD_INDEX);
  const db = Math.abs(b.index - TAKEOVER_CENTER_PAD_INDEX);
  return db < da ? b : a;
}

export function padIndexForPitch(cells: readonly PadLookupCell[], pitch: number): number | null {
  let exact: PadLookupCell | null = null;
  let samePc: PadLookupCell | null = null;
  const pc = ((pitch % 12) + 12) % 12;
  for (const cell of cells) {
    if (cell.midi === pitch) exact = exact ? nearestCenter(exact, cell) : cell;
    else if (cell.pc === pc) samePc = samePc ? nearestCenter(samePc, cell) : cell;
  }
  if (exact) return exact.index;
  if (samePc) return samePc.index;
  return null;
}
```

## C. Phase B 运行期

## `src/features/auraRoaming/runtime/auraKeyRuntime.ts`

运行时单例(核心):50ms 轮询排灯、cueState 状态机、判定、贴谱发声 snapTimers、时值延音 sustains、打击叠击、CC7 抬档、MIDI 输入接入、换歌/回跳重建。嵌入式主循环的直接参照。

```typescript
// ============================================================
// auraRoaming · auraKeyRuntime(Aura Key 引导模式运行时,单例)
// ------------------------------------------------------------
// 打开 Aura Key 后:
//   · lead 继续播放(LeadTakeoverController 用 nativeLeadMuteEnabled:false,
//     从不产生 lead-mute,也不跑 reconcileNativeLeadMute);
//   · 15 键逻辑与用户接管沙盒一致:亮/未亮的键都能按,发接管乐器音色
//     (channel 15,和弦安全音映射,声音链仍是 AudioEngine → Dream5504);
//   · 每 50ms 轮询播放时钟,对生成曲 lead 重音做提示计划,提前把呼吸灯
//     事件发给 LedMatrix(峰值时刻自带,发送抖动不影响精度);
//   · 判定 Perfect/普通/按偏/无视,维护 combo、律光、律光音轨。
// 只读消费 MusicalIR;不注册 scheduler listener(只读时钟状态)。
// ============================================================

import { AudioEngine } from '../../../core/audio/AudioEngine';
import { globalMidiScheduler } from '../../../core/audio/MidiScheduler';
import { LeadTakeoverController } from '../../../core/generation/leadTakeoverSandbox/leadTakeoverController';
import {
  TAKEOVER_USER_CHANNEL,
  executeLeadTakeoverActions,
  prepareLeadTakeoverVoice,
  resetLeadTakeoverRuntimeState,
  takeoverSnapshotFromMusicGeneration,
} from '../../../core/generation/leadTakeoverSandbox/qhTakeoverConsumer';
import { DREAM5504_DEFAULT_CHANNEL_VOLUME } from '../../../core/generation/newEngine/knowledge/gmMixProfile';
import {
  resetTakeoverPadInputState,
  subscribeTakeoverPadInput,
  type TakeoverPadInputEvent,
} from '../../../core/generation/leadTakeoverSandbox/takeoverInputBus';
import { takeoverPadCoord } from '../../../core/generation/leadTakeoverSandbox/padLayout';
import { modulateTakeoverMidiMessage } from '../../../core/generation/leadTakeoverSandbox/takeoverMidiModulator';
import {
  claimMidiInputExclusive,
  requestMidiAccess,
  type MidiAccessHandle,
  type MidiDeviceInfo,
  type ParsedMidiMessage,
} from '../../../core/generation/motifSandbox/midi/webMidi';
import {
  getTakeoverMidiInputPreference,
  resolveTakeoverMidiInput,
} from '../../../state/TakeoverMidiInputStore';
import type { MusicGenerationResult } from '../../../core/generation/musicGeneration/types';
import { scoreLeadAccents } from '../accent/leadAccents';
import { planCues } from '../cue/cuePlanner';
import { planHarmonicFillCues } from '../cue/harmonicFill';
import { padIndexForPitch } from '../cue/padLookup';
import { classifyPressDelta } from '../judge/judgement';
import {
  INITIAL_LUX_TRAIL_STATE,
  trailOnAttemptMiss,
  trailOnCueSuccess,
  trailOnUnlitPress,
  type LuxTrailState,
} from '../judge/luxTrail';
import {
  getAuraRoamingSnapshot,
  patchAuraRoaming,
  recordAuraJudgement,
  recordAuraTrail,
  resetAuraSession,
} from '../state/auraRoamingStore';
import {
  CUE_FADE_MS,
  CUE_HOLD_MS,
  CUE_HUE,
  CUE_PEAK_LEAD_MS,
  CUE_RISE_MS,
  CUE_SUSTAIN_MAX_MS,
  CUE_SUSTAIN_TAIL_MS,
  DEFAULT_JUDGE_WINDOWS,
  type PlannedCue,
} from '../types';

const POLL_MS = 50;
const SCHEDULE_LOOKAHEAD_MS = 150;
const DEFAULT_PAD_VELOCITY = 112;
/** 亮灯键早按 → 推迟到 lead 正点发声;提前这点量让控制器的
 *  groove/16 分量化(snap 窗 60ms)把音精确落回谱面格点。 */
const SNAP_FIRE_EARLY_MS = 30;
/** 命中打击感:鼓通道(scheduler ch9 → 出板 ch10 GM 鼓组)一次性叠击。
 *  命中用拍手(39)— 与歌曲鼓组的军鼓/踩镲彻底区分;按偏用鼓边边击。 */
const DRUM_CHANNEL = 9;
const GM_HAND_CLAP = 39;
const GM_SIDE_STICK = 37;
/** Aura Key 期间用户接管通道音量:与生成 lead 持平(2026-08-25 用户
 *  裁定,127 对比档听感过响撤销)。仍显式补发 — voice setup 时序防覆盖。 */
const AURA_KEY_USER_CC7 = DREAM5504_DEFAULT_CHANNEL_VOLUME;
/** voice setup 会写 CC7=默认值,延迟这点量再抬,保证 last-writer-wins。 */
const USER_GAIN_BOOST_DELAY_MS = 90;

interface RuntimeCue extends PlannedCue {
  padIndex: number;
  col: number;
  row: number;
  cueState: 'pending' | 'lit' | 'done';
  wallMs: number;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

class AuraKeyRuntime {
  private running = false;
  private controller = new LeadTakeoverController({ nativeLeadMuteEnabled: false });
  private cues: RuntimeCue[] = [];
  private lastResult: MusicGenerationResult | null = null;
  private songReady = false;
  private trail: LuxTrailState = INITIAL_LUX_TRAIL_STATE;
  private ppq = 480;
  private bpm = 120;
  private lastTick = 0;
  private pollTimer: number | null = null;
  private unsubPad: (() => void) | null = null;
  private midiHandle: MidiAccessHandle | null = null;
  private releaseMidiClaim: (() => void) | null = null;
  /** 亮灯键自动时值延音:sourceId → 挂住到几时(timer=已松手在等 note-off)。 */
  private sustains = new Map<string, { untilMs: number; timer: number | null; padIndex: number }>();
  /** 亮灯键早按的贴谱发声:sourceId → 等待发 noteOn 的定时器。 */
  private snapTimers = new Map<string, number>();
  private gainBoostTimer: number | null = null;

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.controller = new LeadTakeoverController({ nativeLeadMuteEnabled: false });
    this.cues = [];
    this.lastResult = null;
    this.songReady = false;
    this.trail = INITIAL_LUX_TRAIL_STATE;
    resetTakeoverPadInputState();
    resetLeadTakeoverRuntimeState(AudioEngine);
    if (AudioEngine.getCurrentMusicGeneration()) prepareLeadTakeoverVoice(AudioEngine);
    this.applyUserGainBoost();
    this.unsubPad = subscribeTakeoverPadInput(this.onPadBusEvent);
    this.pollTimer = window.setInterval(this.poll, POLL_MS);
    resetAuraSession();
    patchAuraRoaming({ auraKeyOn: true, songReady: false, cueTotal: 0 });
    void this.connectMidi();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.unsubPad?.();
    this.unsubPad = null;
    for (const sustain of this.sustains.values()) {
      if (sustain.timer !== null) window.clearTimeout(sustain.timer);
    }
    this.sustains.clear();
    for (const timer of this.snapTimers.values()) window.clearTimeout(timer);
    this.snapTimers.clear();
    if (this.gainBoostTimer !== null) window.clearTimeout(this.gainBoostTimer);
    this.gainBoostTimer = null;
    AudioEngine.controllerChange(TAKEOVER_USER_CHANNEL, 7, DREAM5504_DEFAULT_CHANNEL_VOLUME);
    executeLeadTakeoverActions(AudioEngine, this.controller.reset());
    resetLeadTakeoverRuntimeState(AudioEngine);
    this.emitClear();
    this.disconnectMidi();
    this.cues = [];
    this.songReady = false;
    patchAuraRoaming({ auraKeyOn: false, songReady: false, midiStatus: 'off' });
  }

  // ---- 播放时钟轮询:计划重建 + 亮灯排程 + 过期判 miss ----

  private poll = (): void => {
    const now = nowMs();
    const result = AudioEngine.getCurrentMusicGeneration();
    const playing = globalMidiScheduler.isPlaying && AudioEngine.getCurrentPlaybackKind() === 'generated';

    if (!result || result.status !== 'ok' || !result.ir || !playing) {
      if (this.songReady) {
        this.songReady = false;
        this.emitClear();
        for (const cue of this.cues) if (cue.cueState === 'lit') cue.cueState = 'pending';
        patchAuraRoaming({ songReady: false });
      }
      return;
    }

    if (result !== this.lastResult) this.rebuild(result);
    if (!this.songReady) {
      this.songReady = true;
      patchAuraRoaming({ songReady: true, cueTotal: this.cues.length });
    }

    const currentTick = AudioEngine.getCurrentTick();
    // 重播/回跳:tick 大幅倒退 → 重新武装未来提示,曲首则整局清零
    if (currentTick + this.ppq * 2 < this.lastTick) this.rearm(currentTick);
    this.lastTick = currentTick;

    const ticksPerMs = ((this.bpm / 60) * this.ppq) / 1000;

    for (const cue of this.cues) {
      if (cue.cueState === 'done') continue;
      const wallMs = now + (cue.tick - currentTick) / ticksPerMs;
      cue.wallMs = wallMs;

      if (cue.cueState === 'pending') {
        if (wallMs < now - DEFAULT_JUDGE_WINDOWS.attemptMs) {
          cue.cueState = 'done'; // seek 越过的历史提示不判 miss
          continue;
        }
        // 每个提示独立排灯:统一上升时长,只按自己的峰值时刻倒推起亮点;
        // 与前一个灯是否还亮着无关,窗口重叠就同时呼吸
        const riseStartMs = wallMs - CUE_PEAK_LEAD_MS - CUE_RISE_MS;
        if (riseStartMs <= now + SCHEDULE_LOOKAHEAD_MS) {
          AudioEngine.emitVisualEvent({
            type: 'aura_cue',
            cueId: cue.id,
            col: cue.col,
            row: cue.row,
            hue: CUE_HUE,
            peakAtMs: wallMs - CUE_PEAK_LEAD_MS,
            riseMs: CUE_RISE_MS,
            holdMs: CUE_HOLD_MS,
            fadeMs: CUE_FADE_MS,
          });
          cue.cueState = 'lit';
        }
      } else if (now > wallMs + DEFAULT_JUDGE_WINDOWS.attemptMs + POLL_MS) {
        cue.cueState = 'done';
        recordAuraJudgement('missIgnore'); // 完全没按:清 combo,但不打断律光音轨(A→C 语义)
      }
    }
  };

  private rebuild(result: MusicGenerationResult): void {
    this.lastResult = result;
    const ir = result.ir;
    if (!ir) return;
    this.ppq = AudioEngine.getPpq();
    this.bpm = result.bpm;
    const snapshot = takeoverSnapshotFromMusicGeneration(result);
    this.controller.setSnapshot(snapshot, AudioEngine.getCurrentBeat());
    prepareLeadTakeoverVoice(AudioEngine);
    this.applyUserGainBoost();

    const ts = snapshot.timeSignature;
    const beatsPerBar = Math.max(1, ts[0] * (4 / ts[1]));
    const leadTrack = ir.tracks.find((t) => t.role === 'lead');
    const notes = (leadTrack?.notes ?? []).map((n) => ({
      pitch: n.pitch as number,
      startTick: n.startTick as number,
      durationTicks: n.durationTicks as number,
      velocity: n.velocity,
    }));
    const totalBeats = (ir.durationTicks as number) / this.ppq;
    const accents = scoreLeadAccents(notes, { ppq: this.ppq, beatsPerBar });
    const planned = planCues(accents, { beatsPerBar, totalBeats, seed: result.seed });

    const bound: Array<PlannedCue & { padIndex: number }> = [];
    for (const cue of planned) {
      const cells = this.controller.getPadMap(cue.beat)?.cells ?? [];
      const padIndex = padIndexForPitch(cells, cue.pitch);
      if (padIndex === null) continue; // 布局外的音符不提示(引导必须诚实)
      bound.push({ ...cue, source: 'lead', padIndex });
    }
    // 和声填充:lead 空窗里按当前布局的结构音(强拍)/色彩音(弱拍)补提示,
    // ACG 等旋律稀疏风格的密度救星 — 布局即安全音图,亮谁都和谐
    const fillers = planHarmonicFillCues(bound, {
      beatsPerBar,
      totalBeats,
      seed: result.seed,
      ppq: this.ppq,
      cellsAtBeat: (b) => this.controller.getPadMap(b)?.cells ?? null,
    });
    this.cues = [...bound, ...fillers]
      .sort((a, b) => a.tick - b.tick)
      .map((cue, index) => {
        const { col, row } = takeoverPadCoord(cue.padIndex);
        return { ...cue, id: index, col, row, cueState: 'pending' as const, wallMs: 0 };
      });
    this.trail = INITIAL_LUX_TRAIL_STATE;
    this.lastTick = 0;
    this.emitClear();
    resetAuraSession();
    patchAuraRoaming({ songReady: true, cueTotal: this.cues.length });
    this.songReady = true;
  }

  private rearm(currentTick: number): void {
    this.emitClear();
    for (const cue of this.cues) {
      cue.cueState = cue.tick > currentTick ? 'pending' : 'done';
    }
    this.trail = INITIAL_LUX_TRAIL_STATE;
    if (currentTick < this.ppq) resetAuraSession(); // 从头重播 → 新一局
  }

  private emitClear(): void {
    AudioEngine.emitVisualEvent({ type: 'aura_cue_clear' });
  }

  // ---- 输入(屏幕 pad 总线 + BLE/Web MIDI 位置键) ----

  private onPadBusEvent = (event: TakeoverPadInputEvent): void => {
    if (event.type === 'down') this.onPadDown(event.padIndex, event.atMs, DEFAULT_PAD_VELOCITY, `pad:${event.padIndex}`);
    else this.onPadUp(event.padIndex, `pad:${event.padIndex}`);
  };

  private onMidiMessage = (message: ParsedMidiMessage): void => {
    const positioned = modulateTakeoverMidiMessage(message);
    if (!positioned) return;
    if (positioned.type === 'down') {
      this.onPadDown(positioned.padIndex, nowMs(), positioned.velocity || DEFAULT_PAD_VELOCITY, positioned.sourceId);
    } else {
      this.onPadUp(positioned.padIndex, positioned.sourceId);
    }
  };

  private onPadDown(padIndex: number, atMs: number, velocity: number, sourceId: string): void {
    if (!this.running) return;
    this.flushSustain(sourceId); // 上一次延音/待发声还挂着 → 先收掉,legato 交接
    const beat = AudioEngine.getCurrentBeat();

    if (!this.songReady) {
      executeLeadTakeoverActions(AudioEngine, this.controller.noteOn(padIndex, beat, velocity, sourceId));
      return;
    }

    const latencyOffsetMs = getAuraRoamingSnapshot().latencyOffsetMs;
    const now = nowMs();
    const currentTick = AudioEngine.getCurrentTick();
    const ticksPerMs = ((this.bpm / 60) * this.ppq) / 1000;

    let best: RuntimeCue | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const cue of this.cues) {
      if (cue.cueState !== 'lit' || cue.padIndex !== padIndex) continue;
      const cueWallMs = now + (cue.tick - currentTick) / ticksPerMs;
      const delta = atMs - cueWallMs - latencyOffsetMs;
      if (Math.abs(delta) <= DEFAULT_JUDGE_WINDOWS.attemptMs && Math.abs(delta) < Math.abs(bestDelta)) {
        best = cue;
        bestDelta = delta;
      }
    }

    if (!best) {
      // 未亮键:即按即响(原行为);同时是开着锚点的律光音轨材料
      executeLeadTakeoverActions(AudioEngine, this.controller.noteOn(padIndex, beat, velocity, sourceId));
      this.trail = trailOnUnlitPress(this.trail);
      patchAuraRoaming({ lastPress: `自由 pad${padIndex} · 即发` });
      return;
    }

    best.cueState = 'done';
    const kind = classifyPressDelta(bestDelta) ?? 'missAttempt';

    if (kind === 'missAttempt') {
      // 按偏(早了/晚了两种情况):乐器音色不发声 — 引导音要么正点要么沉默;
      // 只即刻回一记鼓边边击作为"偏了"反馈,收灯但不放命中动效
      this.fireHitPercussion(kind);
      AudioEngine.emitVisualEvent({ type: 'aura_cue_hit', cueId: best.id });
      recordAuraJudgement(kind);
      this.trail = trailOnAttemptMiss(this.trail);
      patchAuraRoaming({ lastPress: `按偏 Δ${Math.round(bestDelta)}ms · 静默+边击` });
      return;
    }

    // 亮灯键贴谱发声:阈值内早按 → 声音推迟到 lead 音符正点;正点后按 → 立即。
    // 命中成功再叠一记鼓击(与音符同一时刻,transient 对齐强化打击感)
    const bestWallMs = now + (best.tick - currentTick) / ticksPerMs;
    const fireInMs = bestWallMs - now - SNAP_FIRE_EARLY_MS;
    if (fireInMs > 5) {
      const timer = window.setTimeout(() => {
        this.snapTimers.delete(sourceId);
        if (!this.running) return;
        executeLeadTakeoverActions(
          AudioEngine,
          this.controller.noteOn(padIndex, AudioEngine.getCurrentBeat(), velocity, sourceId),
        );
        this.fireHitPercussion(kind);
      }, fireInMs);
      this.snapTimers.set(sourceId, timer);
    } else {
      executeLeadTakeoverActions(AudioEngine, this.controller.noteOn(padIndex, beat, velocity, sourceId));
      this.fireHitPercussion(kind);
    }
    patchAuraRoaming({
      lastPress: `${kind === 'perfect' ? 'Perfect' : '普通'} Δ${Math.round(bestDelta)}ms · `
        + `${fireInMs > 5 ? `+${Math.round(fireInMs)}ms 贴谱` : '即发'}${best.source === 'harmonic' ? ' · 和声' : ''}`,
    });
    // 亮灯键自动时值延音:按 lead 音符时值挂住 + legato 尾巴;未亮键不享受
    const cueEndTick = best.tick + best.durationBeats * this.ppq;
    const sustainUntilMs = Math.min(
      now + CUE_SUSTAIN_MAX_MS,
      now + (cueEndTick - currentTick) / ticksPerMs + CUE_SUSTAIN_TAIL_MS,
    );
    if (sustainUntilMs > now) this.sustains.set(sourceId, { untilMs: sustainUntilMs, timer: null, padIndex });
    recordAuraJudgement(kind);
    const trailResult = trailOnCueSuccess(this.trail, best.id, best.beat);
    this.trail = trailResult.state;
    if (trailResult.completedTrail) recordAuraTrail();
    // 带 col/row/hue/energy → LedMatrix 收灯 + 整键爆闪 + 全板波纹
    AudioEngine.emitVisualEvent({
      type: 'aura_cue_hit',
      cueId: best.id,
      col: best.col,
      row: best.row,
      hue: kind === 'perfect' ? 48 : CUE_HUE,
      energy: kind === 'perfect' ? 2.8 : 2.2,
    });
    AudioEngine.emitVisualEvent({
      type: 'custom_particle',
      col: best.col,
      row: best.row,
      hue: kind === 'perfect' ? 48 : CUE_HUE,
      energy: kind === 'perfect' ? 3.6 : 2.8,
      spread: 2.6,
    });
  }

  /** 接管通道音量抬档:在 voice setup(CC7=默认)落地后补发,确保生效。 */
  private applyUserGainBoost(): void {
    if (this.gainBoostTimer !== null) window.clearTimeout(this.gainBoostTimer);
    this.gainBoostTimer = window.setTimeout(() => {
      this.gainBoostTimer = null;
      if (!this.running) return;
      AudioEngine.controllerChange(TAKEOVER_USER_CHANNEL, 7, AURA_KEY_USER_CC7);
    }, USER_GAIN_BOOST_DELAY_MS);
  }

  /** 打击反馈:Perfect=重拍手,普通=轻拍手(与贴谱 noteOn 同刻);
   *  按偏=鼓边边击(即刻,乐器音色不发声,边击是唯一反馈)。 */
  private fireHitPercussion(kind: 'perfect' | 'good' | 'missAttempt'): void {
    const note = kind === 'missAttempt' ? GM_SIDE_STICK : GM_HAND_CLAP;
    const velocity = kind === 'perfect' ? 112 : kind === 'good' ? 88 : 80;
    AudioEngine.noteOn(DRUM_CHANNEL, note, velocity);
    AudioEngine.noteOffAt(DRUM_CHANNEL, note, AudioEngine.getAudioTime() + 0.12);
  }

  private onPadUp(padIndex: number, sourceId: string): void {
    if (!this.running) return;
    const sustain = this.sustains.get(sourceId);
    const now = nowMs();
    if (sustain && sustain.timer === null && sustain.untilMs - now > 40) {
      // 松手但 lead 时值未走完 → note-off 推迟到时值结束(自动延音)
      sustain.timer = window.setTimeout(() => {
        this.sustains.delete(sourceId);
        if (!this.running) return;
        executeLeadTakeoverActions(AudioEngine, this.controller.noteOff(padIndex, AudioEngine.getCurrentBeat(), sourceId));
      }, sustain.untilMs - now);
      return;
    }
    this.sustains.delete(sourceId);
    executeLeadTakeoverActions(AudioEngine, this.controller.noteOff(padIndex, AudioEngine.getCurrentBeat(), sourceId));
  }

  /** 同一 sourceId 再次按下前,把仍在延音等待/待贴谱发声的上一个音收掉。 */
  private flushSustain(sourceId: string): void {
    const snapTimer = this.snapTimers.get(sourceId);
    if (snapTimer !== undefined) {
      window.clearTimeout(snapTimer); // 还没发声就被再次按下 → 直接作废,无需 noteOff
      this.snapTimers.delete(sourceId);
    }
    const sustain = this.sustains.get(sourceId);
    if (!sustain) return;
    this.sustains.delete(sourceId);
    if (sustain.timer !== null) {
      window.clearTimeout(sustain.timer);
      executeLeadTakeoverActions(AudioEngine, this.controller.noteOff(sustain.padIndex, AudioEngine.getCurrentBeat(), sourceId));
    }
  }

  // ---- BLE/Web MIDI 接入(设备偏好与 Q+T 共享) ----

  private async connectMidi(): Promise<void> {
    this.releaseMidiClaim = claimMidiInputExclusive('auraKey');
    const res = await requestMidiAccess(this.onMidiMessage, (devices) => this.selectFromDevices(devices), {
      exclusiveOwner: 'auraKey',
    });
    if (!this.running) {
      res.handle?.dispose();
      this.disconnectMidi();
      return;
    }
    if (res.status !== 'ready' || !res.handle) {
      patchAuraRoaming({ midiStatus: res.status === 'unsupported' ? 'MIDI: 浏览器不支持' : 'MIDI: 未授权' });
      return;
    }
    this.midiHandle = res.handle;
    this.selectFromDevices(res.handle.listInputs());
  }

  private selectFromDevices(devices: MidiDeviceInfo[]): void {
    if (!this.midiHandle) return;
    const preferred = resolveTakeoverMidiInput(devices, getTakeoverMidiInputPreference()) ?? devices[0] ?? null;
    this.midiHandle.selectInput(preferred?.id ?? null);
    patchAuraRoaming({ midiStatus: preferred ? `MIDI: ${preferred.name}` : 'MIDI: 无输入设备' });
  }

  private disconnectMidi(): void {
    this.midiHandle?.dispose();
    this.midiHandle = null;
    this.releaseMidiClaim?.();
    this.releaseMidiClaim = null;
  }
}

const runtime = new AuraKeyRuntime();

export function isAuraKeyOn(): boolean {
  return runtime.isRunning();
}

export function setAuraKeyOn(on: boolean): void {
  if (on) runtime.start();
  else runtime.stop();
}

export function toggleAuraKey(): void {
  setAuraKeyOn(!runtime.isRunning());
}
```

## `src/features/auraRoaming/cue/cueGlow.ts`

呼吸包络纯函数:cueGlowIntensity(每帧求亮度)+ snuffGlow(命中截断快灭)。LED 驱动逐帧调用。

```typescript
// ============================================================
// auraRoaming · cueGlow(呼吸灯包络,纯函数)
// ------------------------------------------------------------
// 一个提示 = 该键 9 颗灯同步:灭 → 余弦缓升 → 最亮(峰值落在音符
// 发声前 50~100ms)→ 保持 → 渐灭。LedMatrix 的 rAF 每帧调
// cueGlowIntensity 取亮度,发事件的抖动不影响峰值时刻精度。
// ============================================================

export interface AuraCueGlowSpec {
  cueId: number;
  col: number;
  row: number;
  hue: number;
  /** 最亮时刻(performance.now() 时基,已含提前量)。 */
  peakAtMs: number;
  riseMs: number;
  holdMs: number;
  fadeMs: number;
}

/** 0..1 亮度;尚未开始 → 0;已结束 → -1(调用方移除)。 */
export function cueGlowIntensity(nowMs: number, glow: AuraCueGlowSpec): number {
  const riseStart = glow.peakAtMs - glow.riseMs;
  if (nowMs < riseStart) return 0;
  if (nowMs < glow.peakAtMs) {
    const p = (nowMs - riseStart) / glow.riseMs;
    return 0.5 - 0.5 * Math.cos(Math.PI * p);
  }
  const holdEnd = glow.peakAtMs + glow.holdMs;
  if (nowMs <= holdEnd) return 1;
  const fadeEnd = holdEnd + glow.fadeMs;
  if (nowMs < fadeEnd) {
    const p = (nowMs - holdEnd) / glow.fadeMs;
    return 0.5 + 0.5 * Math.cos(Math.PI * p);
  }
  return -1;
}

/** 命中后立刻收灯:峰值截断到当前(早按会先闪到最亮),随即快速渐灭。 */
export function snuffGlow(glow: AuraCueGlowSpec, nowMs: number, fadeMs = 140): AuraCueGlowSpec {
  const riseStart = glow.peakAtMs - glow.riseMs;
  const peakAtMs = Math.min(glow.peakAtMs, nowMs);
  return {
    ...glow,
    peakAtMs,
    riseMs: Math.max(1, peakAtMs - riseStart),
    holdMs: Math.max(0, nowMs - peakAtMs),
    fadeMs,
  };
}
```

## D. Phase C 计分层(纯 reducer)

## `src/features/auraRoaming/judge/judgement.ts`

判定分类 classifyPressDelta + 计分 reducer applyJudgement(律光/combo/充能)。

```typescript
// ============================================================
// auraRoaming · judgement(Perfect/普通/Miss 判定 + 计分,纯函数)
// ------------------------------------------------------------
// Δt = (按压时刻 − 提示音符发声时刻 − 用户延迟补偿)。
//   |Δt| ≤ 60ms  → perfect(律光 +2)
//   |Δt| ≤ 150ms → good  (律光 +1)
//   |Δt| ≤ 300ms → 按偏 missAttempt(清 combo,打断律光音轨)
//   更远 / 未亮键 → 自由弹奏,不判定
// 到期未按 → missIgnore(清 combo,不打断音轨 → 支持 A→C 跨越)。
// ============================================================

import {
  CHARGE_COMBO,
  DEFAULT_JUDGE_WINDOWS,
  LUX_PER_GOOD,
  LUX_PER_PERFECT,
  type AuraJudgeWindows,
  type AuraJudgementKind,
} from '../types';

/** 按压相对提示的分类;null = 窗外,视作自由弹奏。 */
export function classifyPressDelta(
  deltaMs: number,
  windows: AuraJudgeWindows = DEFAULT_JUDGE_WINDOWS,
): 'perfect' | 'good' | 'missAttempt' | null {
  const abs = Math.abs(deltaMs);
  if (abs <= windows.perfectMs) return 'perfect';
  if (abs <= windows.goodMs) return 'good';
  if (abs <= windows.attemptMs) return 'missAttempt';
  return null;
}

export function isSuccessJudgement(kind: AuraJudgementKind): boolean {
  return kind === 'perfect' || kind === 'good';
}

export function luxFor(kind: AuraJudgementKind): number {
  if (kind === 'perfect') return LUX_PER_PERFECT;
  if (kind === 'good') return LUX_PER_GOOD;
  return 0;
}

export interface AuraScoreState {
  lux: number;
  combo: number;
  bestCombo: number;
  charging: boolean;
  judged: Record<AuraJudgementKind, number>;
}

export const INITIAL_SCORE_STATE: AuraScoreState = {
  lux: 0,
  combo: 0,
  bestCombo: 0,
  charging: false,
  judged: { perfect: 0, good: 0, missAttempt: 0, missIgnore: 0 },
};

/** 计分 reducer:成功加律光 + 连击,任一 miss 清 combo(充能随之熄灭)。 */
export function applyJudgement(state: AuraScoreState, kind: AuraJudgementKind): AuraScoreState {
  const judged = { ...state.judged, [kind]: state.judged[kind] + 1 };
  if (isSuccessJudgement(kind)) {
    const combo = state.combo + 1;
    return {
      lux: state.lux + luxFor(kind),
      combo,
      bestCombo: Math.max(state.bestCombo, combo),
      charging: combo >= CHARGE_COMBO,
      judged,
    };
  }
  return { ...state, combo: 0, charging: false, judged };
}
```

## `src/features/auraRoaming/judge/luxTrail.ts`

律光音轨状态机:锚点/未亮键材料/收口;missIgnore 故意无对应函数(不打断)。

```typescript
// ============================================================
// auraRoaming · luxTrail(律光音轨状态机,纯函数)
// ------------------------------------------------------------
// 定义:两次成功命中的亮灯键之间,穿插按过 ≥1 个未亮键 → 记一条。
// 用户裁定的关键语义:
//   · "错过" = 完全没按(missIgnore)→ 不打断,允许 A→C 跨越被无视的 B;
//   · 按了但时机偏(missAttempt)→ 用户主动参与失败,打断当前音轨;
//   · 两次成功命中相距 > TRAIL_MAX_GAP_BEATS 拍 → 锚点过期,只重新起锚。
// ============================================================

import { TRAIL_MAX_GAP_BEATS } from '../types';

export interface LuxTrailState {
  anchorCueId: number | null;
  anchorBeat: number;
  sawUnlitPress: boolean;
}

export const INITIAL_LUX_TRAIL_STATE: LuxTrailState = {
  anchorCueId: null,
  anchorBeat: 0,
  sawUnlitPress: false,
};

export interface LuxTrailResult {
  state: LuxTrailState;
  completedTrail: boolean;
}

/** 成功命中:可能收口一条音轨,并总是把该命中设为新锚点。 */
export function trailOnCueSuccess(
  state: LuxTrailState,
  cueId: number,
  beat: number,
  maxGapBeats: number = TRAIL_MAX_GAP_BEATS,
): LuxTrailResult {
  const completedTrail =
    state.anchorCueId !== null
    && state.sawUnlitPress
    && beat - state.anchorBeat <= maxGapBeats
    && beat > state.anchorBeat;
  return {
    state: { anchorCueId: cueId, anchorBeat: beat, sawUnlitPress: false },
    completedTrail,
  };
}

/** 未亮键按压:锚点开着才算音轨材料。 */
export function trailOnUnlitPress(state: LuxTrailState): LuxTrailState {
  if (state.anchorCueId === null) return state;
  if (state.sawUnlitPress) return state;
  return { ...state, sawUnlitPress: true };
}

/** 按偏(missAttempt):打断进行中的音轨。missIgnore 故意无此对应函数。 */
export function trailOnAttemptMiss(_state: LuxTrailState): LuxTrailState {
  return INITIAL_LUX_TRAIL_STATE;
}
```

## `src/features/auraRoaming/state/auraRoamingStore.ts`

会话状态单例(listener 模式);starPulse/trailPulse 单调递增动画 key。

```typescript
// ============================================================
// auraRoaming · store(模块单例 + listener Set,工程惯用模式)
// ------------------------------------------------------------
// UI(面板/星星 HUD/App)只订阅这里;runtime 是唯一写方。
// starPulse/trailPulse 是单调递增的动画 key:每次成功/成轨 +1,
// UI 用 key 变化触发 🌟 晃动,不需要事件总线。
// ============================================================

import {
  INITIAL_SCORE_STATE,
  applyJudgement,
  isSuccessJudgement,
  type AuraScoreState,
} from '../judge/judgement';
import type { AuraJudgementKind } from '../types';

export interface AuraRoamingSnapshot {
  auraKeyOn: boolean;
  /** 有生成曲在播放且提示计划就绪。 */
  songReady: boolean;
  cueTotal: number;
  score: AuraScoreState;
  trails: number;
  starPulse: number;
  trailPulse: number;
  lastJudgement: { kind: AuraJudgementKind; atMs: number } | null;
  latencyOffsetMs: number;
  midiStatus: string;
  /** 最近一次按压的调试摘要(判定/Δms/发声方式),面板展示。 */
  lastPress: string;
}

const state: AuraRoamingSnapshot = {
  auraKeyOn: false,
  songReady: false,
  cueTotal: 0,
  score: INITIAL_SCORE_STATE,
  trails: 0,
  starPulse: 0,
  trailPulse: 0,
  lastJudgement: null,
  latencyOffsetMs: 0,
  midiStatus: 'off',
  lastPress: '',
};

const listeners = new Set<(snapshot: AuraRoamingSnapshot) => void>();

export function getAuraRoamingSnapshot(): AuraRoamingSnapshot {
  return { ...state, score: { ...state.score, judged: { ...state.score.judged } } };
}

export function subscribeAuraRoaming(listener: (snapshot: AuraRoamingSnapshot) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  const snapshot = getAuraRoamingSnapshot();
  for (const listener of listeners) listener(snapshot);
}

export function patchAuraRoaming(partial: Partial<Pick<AuraRoamingSnapshot,
  'auraKeyOn' | 'songReady' | 'cueTotal' | 'midiStatus' | 'latencyOffsetMs' | 'lastPress'>>): void {
  Object.assign(state, partial);
  notify();
}

export function recordAuraJudgement(kind: AuraJudgementKind): void {
  state.score = applyJudgement(state.score, kind);
  if (isSuccessJudgement(kind)) state.starPulse += 1;
  state.lastJudgement = { kind, atMs: typeof performance !== 'undefined' ? performance.now() : Date.now() };
  notify();
}

export function recordAuraTrail(): void {
  state.trails += 1;
  state.trailPulse += 1;
  notify();
}

/** 新歌/重开 Aura Key 时清空本局计分(latency 偏好保留)。 */
export function resetAuraSession(): void {
  state.score = INITIAL_SCORE_STATE;
  state.trails = 0;
  state.lastJudgement = null;
  notify();
}
```

## E. UI 层(仿真器参照,嵌入式对应产品屏)

## `src/features/auraRoaming/ui/AuraRoamingPanel.tsx`

开发面板:Aura Key 开关/延迟补偿/计分显示/最近按压调试行。

```typescript
// ============================================================
// auraRoaming · AuraRoamingPanel(Q+L 开发面板)
// ------------------------------------------------------------
// 两个模式:
//   氛围漫游 — 即现有音乐生成,零设置,配置入口直通 Q+H;
//   Aura Key — 亮灯引导跟弹开关(runtime 单例),lead 不静音。
// 面板只订阅 store / 调 runtime 方法,不碰 scheduler。
// ============================================================

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Activity, Sparkles, X } from 'lucide-react';
import { toggleDevPanel, useDevPanelChannel } from '../../../components/devPanels';
import { setAuraKeyOn } from '../runtime/auraKeyRuntime';
import {
  getAuraRoamingSnapshot,
  patchAuraRoaming,
  subscribeAuraRoaming,
} from '../state/auraRoamingStore';

export const AuraRoamingPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState(getAuraRoamingSnapshot);

  useDevPanelChannel('auraRoam', open, setOpen);
  useEffect(() => subscribeAuraRoaming(setSnap), []);

  useEffect(() => {
    const held = new Set<string>();
    const isTyping = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      held.add(key);
      if (!open && held.has('q') && held.has('l') && !isTyping()) {
        event.preventDefault();
        setOpen(true);
      } else if (open && key === 'escape') {
        setOpen(false);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => held.delete(event.key.toLowerCase());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [open]);

  if (!open) return null;

  const { score } = snap;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed right-3 bottom-3 z-[70] w-[380px] max-w-[calc(100vw-1.5rem)] max-h-[92vh] overflow-auto rounded-2xl border border-violet-500/30
                 bg-zinc-950/95 text-zinc-200 shadow-[0_8px_40px_rgba(0,0,0,0.72)] backdrop-blur-md"
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Sparkles size={15} className="text-violet-300" />
        <span className="text-[12px] font-semibold tracking-wide text-violet-200">光律漫游</span>
        <span className="text-[10px] text-zinc-500">Q+L</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${snap.auraKeyOn ? 'bg-violet-500/15 text-violet-200' : 'bg-zinc-800 text-zinc-500'}`}>
          {snap.auraKeyOn ? 'AURA KEY' : '氛围漫游'}
        </span>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto text-zinc-500 hover:text-zinc-200">
          <X size={15} />
        </button>
      </div>

      {/* 氛围漫游:即现有音乐生成,零设置 */}
      <div className="border-b border-zinc-900 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-zinc-300">氛围漫游</span>
          <span className="text-[10px] text-zinc-500">= 现有音乐生成,无需设置</span>
          <button
            type="button"
            onClick={() => toggleDevPanel('pipeline')}
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1 text-[11px] text-sky-200 hover:bg-zinc-700"
          >
            <Activity size={11} /> Q+H 生成设置
          </button>
        </div>
      </div>

      {/* Aura Key */}
      <div className="border-b border-zinc-900 px-3 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAuraKeyOn(!snap.auraKeyOn)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] text-white ${
              snap.auraKeyOn ? 'bg-violet-600 hover:bg-violet-500' : 'bg-zinc-700 hover:bg-zinc-600'
            }`}
          >
            <Sparkles size={13} />
            {snap.auraKeyOn ? '关闭 Aura Key' : '打开 Aura Key'}
          </button>
          <span className="text-[10px] leading-tight text-zinc-500">
            亮哪按哪 · lead 不静音<br />未亮的键也能自由弹
          </span>
        </div>

        {snap.auraKeyOn && (
          <>
            <div className="rounded-lg border border-zinc-900 bg-zinc-900/55 px-2 py-1.5 text-[11px]">
              {snap.songReady ? (
                <div className="space-y-0.5">
                  <div className="text-violet-200">
                    提示 {snap.cueTotal} 个 · 连击 {score.combo}(最高 {score.bestCombo})
                    {score.charging && <span className="ml-1 text-amber-300">⚡充能中</span>}
                  </div>
                  <div className="text-zinc-400">
                    Perfect {score.judged.perfect} · 普通 {score.judged.good} · 按偏 {score.judged.missAttempt} · 漏过 {score.judged.missIgnore}
                  </div>
                  <div className="text-zinc-400">
                    律光 ×{score.lux} · 律光音轨 ×{snap.trails}
                  </div>
                  <div className="text-zinc-500">最近按压:{snap.lastPress || '—'}</div>
                </div>
              ) : (
                <span className="text-amber-300/90">等待生成曲播放(Q+H 生成并播放后自动开始引导)</span>
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-zinc-500">输入延迟补偿</span>
              <input
                aria-label="Aura Key latency offset ms"
                type="number"
                step={10}
                min={-200}
                max={300}
                value={snap.latencyOffsetMs}
                onChange={(event) => patchAuraRoaming({ latencyOffsetMs: Number(event.target.value) || 0 })}
                className="w-16 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-100"
              />
              <span className="text-zinc-500">ms</span>
              <span className="ml-auto text-[10px] text-zinc-500">{snap.midiStatus !== 'off' ? snap.midiStatus : 'MIDI 未连接'}</span>
            </div>
          </>
        )}
      </div>

      <div className="px-3 py-2 text-[10px] leading-relaxed text-zinc-500">
        判定:|Δt|≤80ms Perfect(律光+2,重拍手)· ≤220ms 普通(+1,轻拍手)· ≤380ms 按偏(音色不发声,只回鼓边边击,断律光音轨)· 完全没按=漏过(不断音轨,可 A→C 跨越)。
        亮灯键贴谱发声:阈值内早按声音推迟到 lead 正点,并按乐谱时值自动延音;未亮键即按即响。
        两次成功命中之间滑按过未亮键 → 律光音轨 ×1(相距 ≤8 拍)。MIDI 设备偏好与 Q+T 共享。
      </div>
    </motion.div>
  );
};
```

## `src/features/auraRoaming/ui/AuraStarHud.tsx`

🌟 HUD:成功晃动/充能颤抖+光斑喷射/异色🌟律光音轨计数/判定瞬时字。

```typescript
// ============================================================
// auraRoaming · AuraStarHud(屏幕 🌟 反馈层)
// ------------------------------------------------------------
// 挂在设备容器内,絶对定位覆盖屏幕区,pointer-events-none:
//   · 主🌟:每次成功命中晃一下;连击 ≥5 高能颤抖 + 随机喷射渐暗光斑;
//     右侧 ×N = 累计律光;
//   · 异色🌟(hue 旋转成青色):每记一条律光音轨晃一下,×M 计数;
//   · 判定瞬时字(PERFECT/GOOD/MISS)淡出。
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { getAuraRoamingSnapshot, subscribeAuraRoaming } from '../state/auraRoamingStore';
import type { AuraJudgementKind } from '../types';

interface Spark {
  id: number;
  dx: number;
  dy: number;
  hue: number;
  duration: number;
}

const JUDGE_LABEL: Record<AuraJudgementKind, { text: string; className: string }> = {
  perfect: { text: 'PERFECT', className: 'text-amber-300' },
  good: { text: 'GOOD', className: 'text-teal-300' },
  missAttempt: { text: 'MISS', className: 'text-rose-300' },
  missIgnore: { text: '·', className: 'text-zinc-600' },
};

export const AuraStarHud: React.FC = () => {
  const [snap, setSnap] = useState(getAuraRoamingSnapshot);
  const [sparks, setSparks] = useState<Spark[]>([]);
  const sparkSeq = useRef(0);

  useEffect(() => subscribeAuraRoaming(setSnap), []);

  // 充能态:持续喷射光斑;每次成功命中再补一撮
  useEffect(() => {
    if (!snap.charging) return;
    const spawn = (count: number) => {
      setSparks((prev) => [
        ...prev.slice(-20),
        ...Array.from({ length: count }, () => ({
          id: sparkSeq.current++,
          dx: (Math.random() * 2 - 1) * 48,
          dy: (Math.random() * 2 - 1) * 34 - 10,
          hue: 38 + Math.random() * 55,
          duration: 0.55 + Math.random() * 0.5,
        })),
      ]);
    };
    spawn(6);
    const timer = window.setInterval(() => spawn(3), 380);
    return () => window.clearInterval(timer);
  }, [snap.charging, snap.starPulse]);

  if (!snap.auraKeyOn) return null;

  const judgement = snap.lastJudgement;

  return (
    <div
      className="absolute z-[45] pointer-events-none"
      style={{
        left: 'calc(363 / 1537 * 100%)',
        top: 'calc(66 / 1410 * 100%)',
        width: 'calc(811 / 1537 * 100%)',
        height: 'calc(269 / 1410 * 100%)',
      }}
    >
      <div className="absolute right-2 top-1 flex items-start gap-3" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        {/* 主🌟 + 律光计数 */}
        <div className="relative flex items-center gap-1">
          <motion.div
            animate={snap.charging ? { x: [0, -1.6, 1.6, -1.1, 1.1, 0], y: [0, 1.1, -1.1, 1.6, -0.8, 0] } : { x: 0, y: 0 }}
            transition={snap.charging ? { repeat: Infinity, duration: 0.16 } : { duration: 0.1 }}
          >
            <motion.span
              key={snap.starPulse}
              className="inline-block text-[15px] leading-none drop-shadow-[0_0_6px_rgba(251,191,36,0.75)]"
              animate={{ rotate: [0, -16, 13, -9, 6, 0], scale: [1, 1.28, 1.05, 1] }}
              transition={{ duration: 0.45 }}
            >
              🌟
            </motion.span>
          </motion.div>
          <span className="text-[11px] font-semibold text-amber-200">×{snap.score.lux}</span>

          {/* 充能光斑喷射 */}
          {sparks.map((spark) => (
            <motion.span
              key={spark.id}
              className="absolute left-1.5 top-1.5 h-1 w-1 rounded-full"
              style={{ background: `hsl(${spark.hue}, 95%, 68%)`, boxShadow: `0 0 5px hsl(${spark.hue}, 95%, 60%)` }}
              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              animate={{ x: spark.dx, y: spark.dy, opacity: 0, scale: 0.35 }}
              transition={{ duration: spark.duration, ease: 'easeOut' }}
              onAnimationComplete={() => setSparks((prev) => prev.filter((s) => s.id !== spark.id))}
            />
          ))}
        </div>

        {/* 异色🌟(律光音轨) */}
        <div className="flex items-center gap-1">
          <motion.span
            key={snap.trailPulse}
            className="inline-block text-[15px] leading-none"
            style={{ filter: 'hue-rotate(165deg) saturate(1.6) drop-shadow(0 0 6px rgba(45,212,191,0.7))' }}
            animate={snap.trailPulse > 0 ? { rotate: [0, 15, -12, 8, 0], scale: [1, 1.3, 1] } : {}}
            transition={{ duration: 0.5 }}
          >
            🌟
          </motion.span>
          <span className="text-[11px] font-semibold text-teal-200">×{snap.trails}</span>
        </div>

        {/* 判定瞬时字 */}
        {judgement && judgement.kind !== 'missIgnore' && (
          <motion.span
            key={`${judgement.kind}-${judgement.atMs}`}
            className={`text-[10px] font-bold tracking-widest ${JUDGE_LABEL[judgement.kind].className}`}
            initial={{ opacity: 1, y: 0 }}
            animate={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          >
            {JUDGE_LABEL[judgement.kind].text}
          </motion.span>
        )}
      </div>
    </div>
  );
};
```

## F. 测试(= 可执行行为规格,复刻 golden 向量来源)

## `src/features/auraRoaming/accent/leadAccents.test.ts`

行为契约测试。

```typescript
import { describe, expect, it } from 'vitest';
import { scoreLeadAccents } from './leadAccents';
import type { AuraLeadNote } from '../types';

const PPQ = 480;

function note(pitch: number, startBeat: number, durBeats: number, velocity = 90): AuraLeadNote {
  return { pitch, startTick: Math.round(startBeat * PPQ), durationTicks: Math.round(durBeats * PPQ), velocity };
}

const CTX = { ppq: PPQ, beatsPerBar: 4 };

describe('auraRoaming/leadAccents — lead 重音识别', () => {
  it('休止 ≥1 拍后的乐句头得分高于连奏中段音', () => {
    const notes = [
      note(60, 0, 0.5),
      note(62, 0.5, 0.5),
      note(64, 1, 0.5),   // 连奏中段
      note(65, 3, 1),     // 1.5 拍休止后的乐句头 + 长音
    ];
    const scored = scoreLeadAccents(notes, CTX);
    const mid = scored.find((c) => c.pitch === 64)!;
    const head = scored.find((c) => c.pitch === 65)!;
    expect(head.score).toBeGreaterThan(mid.score);
  });

  it('正拍长音得分高于反拍短音', () => {
    const notes = [
      note(60, 4, 2),     // 小节正拍 + 2 拍长音
      note(62, 6.5, 0.25), // 反拍短音
      note(64, 7, 0.5),
    ];
    const scored = scoreLeadAccents(notes, CTX);
    const downbeatLong = scored.find((c) => c.pitch === 60)!;
    const offbeatShort = scored.find((c) => c.pitch === 62)!;
    expect(downbeatLong.score).toBeGreaterThan(offbeatShort.score);
  });

  it('输出按 tick 升序且确定性', () => {
    const notes = [note(64, 2, 1), note(60, 0, 1), note(67, 4, 1)];
    const a = scoreLeadAccents(notes, CTX);
    const b = scoreLeadAccents(notes, CTX);
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) expect(a[i].tick).toBeGreaterThanOrEqual(a[i - 1].tick);
  });
});
```

## `src/features/auraRoaming/cue/cuePlanner.test.ts`

行为契约测试。

```typescript
import { describe, expect, it } from 'vitest';
import { planCues } from './cuePlanner';
import type { AccentCandidate } from '../types';

const PPQ = 480;

/** 密集候选场:每 0.5 拍一个,分数偏爱正拍/小节头(接近真实 accent 分布)。 */
function denseCandidates(totalBeats: number): AccentCandidate[] {
  const out: AccentCandidate[] = [];
  let noteIndex = 0;
  for (let beat = 0; beat < totalBeats; beat += 0.5) {
    const isBarStart = beat % 4 === 0;
    const isInteger = beat % 1 === 0;
    out.push({
      noteIndex: noteIndex++,
      tick: Math.round(beat * PPQ),
      beat,
      pitch: 60 + (noteIndex % 12),
      durationBeats: isBarStart ? 2 : isInteger ? 1 : 0.5,
      velocity: 90,
      score: (isBarStart ? 5 : isInteger ? 3 : 1.2) + (noteIndex % 3) * 0.1,
    });
  }
  return out;
}

const CTX = { beatsPerBar: 4, totalBeats: 128, seed: 564417 };

describe('auraRoaming/cuePlanner — 提示选择与防节拍器', () => {
  const candidates = denseCandidates(128);

  it('确定性:同 seed 恒得同计划;不同 seed 产生不同计划', () => {
    expect(planCues(candidates, CTX)).toEqual(planCues(candidates, CTX));
    const signatures = new Set(
      [1, 2, 3, 4].map((seed) => planCues(candidates, { ...CTX, seed }).map((c) => c.beat).join(',')),
    );
    expect(signatures.size).toBeGreaterThanOrEqual(2);
  });

  it('密度下限:密集候选下平均每小节 ≥1.3 个提示(不再"久久亮一个")', () => {
    const barCount = CTX.totalBeats / CTX.beatsPerBar;
    for (const seed of [1, 7, 564417]) {
      const cues = planCues(candidates, { ...CTX, seed });
      expect(cues.length / barCount, `seed ${seed} 密度`).toBeGreaterThanOrEqual(1.3);
    }
  });

  it('提示间隔 ≥ 八分,且八分间隔占比受预算约束', () => {
    for (const seed of [1, 7, 564417]) {
      const cues = planCues(candidates, { ...CTX, seed });
      expect(cues.length).toBeGreaterThan(8);
      let eighthGaps = 0;
      for (let i = 1; i < cues.length; i++) {
        const interval = cues[i].beat - cues[i - 1].beat;
        expect(interval).toBeGreaterThanOrEqual(0.45);
        if (interval < 0.55) eighthGaps++;
      }
      expect(eighthGaps / cues.length).toBeLessThanOrEqual(0.2);
    }
  });

  it('防节拍器:不存在 4 个连续相同间隔', () => {
    for (const seed of [1, 7, 564417]) {
      const cues = planCues(candidates, { ...CTX, seed });
      for (let i = 4; i < cues.length; i++) {
        const intervals = [1, 2, 3, 4].map((k) => cues[i - k + 1].beat - cues[i - k].beat);
        const allEqual = intervals.every((v) => Math.abs(v - intervals[0]) < 0.02);
        expect(allEqual, `seed ${seed} 连续等间隔@${cues[i].beat}`).toBe(false);
      }
    }
  });

  it('时值档只含 全/二/四/八 分', () => {
    const cues = planCues(candidates, CTX);
    for (const cue of cues) expect(['whole', 'half', 'quarter', 'eighth']).toContain(cue.valueClass);
  });

  it('空候选/零时长 → 空计划', () => {
    expect(planCues([], CTX)).toEqual([]);
    expect(planCues(candidates, { ...CTX, totalBeats: 0 })).toEqual([]);
  });
});
```

## `src/features/auraRoaming/cue/harmonicFill.test.ts`

行为契约测试。

```typescript
import { describe, expect, it } from 'vitest';
import { planHarmonicFillCues, type HarmonicFillCell } from './harmonicFill';
import type { PlannedCue } from '../types';

const CELLS: HarmonicFillCell[] = [
  { index: 5, midi: 60, classRole: 'chord' },
  { index: 7, midi: 64, classRole: 'chord' },
  { index: 9, midi: 67, classRole: 'chord' },
  { index: 6, midi: 62, classRole: 'scale' },
  { index: 8, midi: 65, classRole: 'scale' },
  { index: 10, midi: 69, classRole: 'approach' },
];

const CHORD_MIDIS = new Set([60, 64, 67]);
const COLOR_MIDIS = new Set([62, 65, 69]);

function ctx(overrides: Partial<Parameters<typeof planHarmonicFillCues>[1]> = {}) {
  return {
    beatsPerBar: 4,
    totalBeats: 32,
    seed: 7,
    ppq: 480,
    cellsAtBeat: () => CELLS,
    ...overrides,
  };
}

function leadCue(beat: number): PlannedCue {
  return { id: 0, tick: beat * 480, beat, pitch: 72, durationBeats: 1, valueClass: 'quarter', source: 'lead' };
}

describe('auraRoaming/harmonicFill — 和声填充提示', () => {
  it('lead 全空窗时补出可观密度,且互相间距 ≥1 拍', () => {
    const fillers = planHarmonicFillCues([], ctx());
    expect(fillers.length).toBeGreaterThanOrEqual(6);
    const beats = fillers.map((f) => f.beat).sort((a, b) => a - b);
    for (let i = 1; i < beats.length; i++) expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(1);
    for (const f of fillers) expect(f.source).toBe('harmonic');
  });

  it('强拍给结构音,弱拍给色彩音(scale/approach)', () => {
    const fillers = planHarmonicFillCues([], ctx({ totalBeats: 64 }));
    for (const f of fillers) {
      const posInBar = f.beat % 4;
      const strong = posInBar === 0 || posInBar === 2;
      if (strong) expect(CHORD_MIDIS.has(f.pitch), `强拍 ${f.beat} 应为结构音`).toBe(true);
      else expect(COLOR_MIDIS.has(f.pitch), `弱拍 ${f.beat} 应为色彩音`).toBe(true);
    }
  });

  it('不挤 lead 锚点:与既有提示间距 <1 拍的拍位不补', () => {
    const fillers = planHarmonicFillCues([leadCue(4), leadCue(8)], ctx({ totalBeats: 12 }));
    for (const f of fillers) {
      expect(Math.abs(f.beat - 4)).toBeGreaterThanOrEqual(1);
      expect(Math.abs(f.beat - 8)).toBeGreaterThanOrEqual(1);
    }
  });

  it('确定性:同 seed 恒等;布局缺失时不补', () => {
    expect(planHarmonicFillCues([], ctx())).toEqual(planHarmonicFillCues([], ctx()));
    expect(planHarmonicFillCues([], ctx({ cellsAtBeat: () => null }))).toEqual([]);
    const signatures = new Set(
      [1, 2, 3].map((seed) => planHarmonicFillCues([], ctx({ seed })).map((f) => `${f.beat}:${f.padIndex}`).join(',')),
    );
    expect(signatures.size).toBeGreaterThanOrEqual(2);
  });
});
```

## `src/features/auraRoaming/cue/cueGlow.test.ts`

行为契约测试。

```typescript
import { describe, expect, it } from 'vitest';
import { cueGlowIntensity, snuffGlow, type AuraCueGlowSpec } from './cueGlow';

const GLOW: AuraCueGlowSpec = {
  cueId: 1, col: 2, row: 1, hue: 272,
  peakAtMs: 1000, riseMs: 400, holdMs: 320, fadeMs: 260,
};

describe('auraRoaming/cueGlow — 呼吸包络', () => {
  it('灭 → 缓升 → 峰值 → 保持 → 渐灭 → 移除', () => {
    expect(cueGlowIntensity(599, GLOW)).toBe(0);            // rise 前
    expect(cueGlowIntensity(800, GLOW)).toBeCloseTo(0.5, 5); // 余弦中点
    expect(cueGlowIntensity(1000, GLOW)).toBe(1);            // 峰值(音符发声前 50~100ms 由调用方保证)
    expect(cueGlowIntensity(1300, GLOW)).toBe(1);            // 保持窗内
    const fading = cueGlowIntensity(1450, GLOW);             // 渐灭中
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(1);
    expect(cueGlowIntensity(1581, GLOW)).toBe(-1);           // 结束
  });

  it('缓升单调不减', () => {
    let prev = -1;
    for (let t = 600; t <= 1000; t += 40) {
      const v = cueGlowIntensity(t, GLOW);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('snuffGlow:峰值后命中 → 立即进入快速渐灭', () => {
    const snuffed = snuffGlow(GLOW, 1100, 140);
    expect(cueGlowIntensity(1100, snuffed)).toBe(1);
    expect(cueGlowIntensity(1239, snuffed)).toBeGreaterThan(0);
    expect(cueGlowIntensity(1241, snuffed)).toBe(-1);
  });

  it('snuffGlow:峰值前早按 → 峰值截断到当下再快灭', () => {
    const snuffed = snuffGlow(GLOW, 900, 140);
    expect(snuffed.peakAtMs).toBe(900);
    expect(cueGlowIntensity(900, snuffed)).toBe(1);
    expect(cueGlowIntensity(1041, snuffed)).toBe(-1);
  });
});
```

## `src/features/auraRoaming/cue/padLookup.test.ts`

行为契约测试。

```typescript
import { describe, expect, it } from 'vitest';
import { padIndexForPitch, type PadLookupCell } from './padLookup';

function cell(index: number, midi: number): PadLookupCell {
  return { index, midi, pc: ((midi % 12) + 12) % 12 };
}

describe('auraRoaming/padLookup — lead 音高反查键位', () => {
  const cells = [cell(0, 60), cell(1, 62), cell(2, 64), cell(7, 67), cell(14, 72)];

  it('精确 midi 命中', () => {
    expect(padIndexForPitch(cells, 64)).toBe(2);
  });

  it('round-robin 重复 cell → 取离中心 7 最近的', () => {
    const dup = [cell(0, 60), cell(6, 60), cell(14, 60)];
    expect(padIndexForPitch(dup, 60)).toBe(6);
  });

  it('布局无该 midi → 同 pitch-class 八度折叠', () => {
    expect(padIndexForPitch(cells, 48)).toBe(0);  // C3 → C4 cell
    expect(padIndexForPitch(cells, 79)).toBe(7);  // G5 → G4 cell
  });

  it('完全不在布局 → null(该提示跳过)', () => {
    expect(padIndexForPitch(cells, 61)).toBeNull();
  });
});
```

## `src/features/auraRoaming/judge/judgement.test.ts`

行为契约测试。

```typescript
import { describe, expect, it } from 'vitest';
import { INITIAL_SCORE_STATE, applyJudgement, classifyPressDelta } from './judgement';

describe('auraRoaming/judgement — 判定窗口与计分', () => {
  it('判定窗口:±80 Perfect / ±220 普通 / ±380 按偏 / 更远自由弹奏', () => {
    expect(classifyPressDelta(0)).toBe('perfect');
    expect(classifyPressDelta(-79)).toBe('perfect');
    expect(classifyPressDelta(80)).toBe('perfect');
    expect(classifyPressDelta(81)).toBe('good');
    expect(classifyPressDelta(-219)).toBe('good');
    expect(classifyPressDelta(221)).toBe('missAttempt');
    expect(classifyPressDelta(-379)).toBe('missAttempt');
    expect(classifyPressDelta(381)).toBeNull();
    expect(classifyPressDelta(-500)).toBeNull();
  });

  it('计分:perfect +2 / good +1;连续成功 5 次进入充能;任一 miss 清 combo', () => {
    let state = INITIAL_SCORE_STATE;
    state = applyJudgement(state, 'perfect');
    expect(state.lux).toBe(2);
    for (const kind of ['good', 'good', 'good'] as const) state = applyJudgement(state, kind);
    expect(state.lux).toBe(5);
    expect(state.combo).toBe(4);
    expect(state.charging).toBe(false);
    state = applyJudgement(state, 'perfect');
    expect(state.combo).toBe(5);
    expect(state.charging).toBe(true);
    state = applyJudgement(state, 'missIgnore');
    expect(state.combo).toBe(0);
    expect(state.charging).toBe(false);
    expect(state.bestCombo).toBe(5);
    expect(state.lux).toBe(7); // miss 不扣律光
    expect(state.judged).toEqual({ perfect: 2, good: 3, missAttempt: 0, missIgnore: 1 });
  });
});
```

## `src/features/auraRoaming/judge/luxTrail.test.ts`

行为契约测试。

```typescript
import { describe, expect, it } from 'vitest';
import {
  INITIAL_LUX_TRAIL_STATE,
  trailOnAttemptMiss,
  trailOnCueSuccess,
  trailOnUnlitPress,
} from './luxTrail';

describe('auraRoaming/luxTrail — 律光音轨状态机', () => {
  it('A 成功 → 滑按未亮键 → B 成功 ⇒ 记一条', () => {
    let r = trailOnCueSuccess(INITIAL_LUX_TRAIL_STATE, 0, 4);
    expect(r.completedTrail).toBe(false);
    const withUnlit = trailOnUnlitPress(r.state);
    r = trailOnCueSuccess(withUnlit, 1, 6);
    expect(r.completedTrail).toBe(true);
    expect(r.state.anchorCueId).toBe(1); // 锚点移到 B,可连续成轨
  });

  it('两次成功之间没按未亮键 ⇒ 不记', () => {
    let r = trailOnCueSuccess(INITIAL_LUX_TRAIL_STATE, 0, 4);
    r = trailOnCueSuccess(r.state, 1, 6);
    expect(r.completedTrail).toBe(false);
  });

  it('B 完全没按(missIgnore 无状态机调用)⇒ A→C 仍成轨', () => {
    let r = trailOnCueSuccess(INITIAL_LUX_TRAIL_STATE, 0, 4);
    const withUnlit = trailOnUnlitPress(r.state);
    // B 被无视:用户裁定"错过 = 没按",不打断 → 直接到 C
    r = trailOnCueSuccess(withUnlit, 2, 9);
    expect(r.completedTrail).toBe(true);
  });

  it('按偏(missAttempt)打断进行中的音轨', () => {
    let r = trailOnCueSuccess(INITIAL_LUX_TRAIL_STATE, 0, 4);
    let state = trailOnUnlitPress(r.state);
    state = trailOnAttemptMiss(state);
    r = trailOnCueSuccess(state, 2, 6);
    expect(r.completedTrail).toBe(false); // 锚点已被打断,C 只是新锚
  });

  it('两次成功相距超 8 拍 ⇒ 锚点过期只重新起锚', () => {
    let r = trailOnCueSuccess(INITIAL_LUX_TRAIL_STATE, 0, 4);
    const withUnlit = trailOnUnlitPress(r.state);
    r = trailOnCueSuccess(withUnlit, 1, 13.5);
    expect(r.completedTrail).toBe(false);
    expect(r.state.anchorCueId).toBe(1);
  });

  it('没有锚点时未亮键按压不积累', () => {
    const state = trailOnUnlitPress(INITIAL_LUX_TRAIL_STATE);
    expect(state.sawUnlitPress).toBe(false);
  });
});
```

## `src/features/auraRoaming/runtime/auraKeyDiag.test.ts`

行为契约测试。

```typescript
// Aura Key 发声链回归:控制器 noteOn/noteOff → executeLeadTakeoverActions 必须成对出声(ch15)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadTakeoverController } from '../../../core/generation/leadTakeoverSandbox/leadTakeoverController';
import {
  executeLeadTakeoverActions,
  prepareLeadTakeoverVoice,
  resetLeadTakeoverRuntimeState,
} from '../../../core/generation/leadTakeoverSandbox/qhTakeoverConsumer';
import type { TakeoverMusicSnapshot } from '../../../core/generation/leadTakeoverSandbox/types';

function makeTarget() {
  const sent: string[] = [];
  let tick = 4 * 480;
  return {
    sent,
    setTick(t: number) { tick = t; },
    getCurrentTick: () => tick,
    getPpq: () => 480,
    getCurrentMusicGeneration: () => null,
    getAudioTime: () => performance.now() / 1000,
    injectMidiEvent: (e: { type: string; channel: number; data1: number; data2: number }) => {
      sent.push(`inject:${e.type}:${e.channel}:${e.data1}:${e.data2}`);
    },
    noteOn: (ch: number, midi: number, vel: number) => sent.push(`noteOn:${ch}:${midi}:${vel}`),
    noteOnAt: (ch: number, midi: number, vel: number) => sent.push(`noteOnAt:${ch}:${midi}:${vel}`),
    noteOff: (ch: number, midi: number) => sent.push(`noteOff:${ch}:${midi}`),
    noteOffAt: (ch: number, midi: number) => sent.push(`noteOffAt:${ch}:${midi}`),
    controllerChange: (ch: number, cc: number, v: number) => sent.push(`cc:${ch}:${cc}:${v}`),
    controllerChangeAt: (ch: number, cc: number, v: number) => sent.push(`ccAt:${ch}:${cc}:${v}`),
    programChange: (ch: number, p: number) => sent.push(`pc:${ch}:${p}`),
  };
}

const SNAPSHOT: TakeoverMusicSnapshot = {
  styleHint: 'pop',
  key: 'C',
  tonality: 'major',
  bpm: 100,
  timeSignature: [4, 4],
  chords: [
    { rootPc: 0, quality: 'maj', startBeat: 0, durationBeats: 8 },
    { rootPc: 5, quality: 'maj', startBeat: 8, durationBeats: 8 },
  ],
  source: 'generated',
};

describe('auraKey 诊断:成功命中链路发声', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('noteOn → execute → 延迟窗口后必须有音高 noteOn 出现在 ch15', () => {
    const target = makeTarget();
    resetLeadTakeoverRuntimeState(target);
    prepareLeadTakeoverVoice(target);
    const controller = new LeadTakeoverController({ nativeLeadMuteEnabled: false });
    controller.setSnapshot(SNAPSHOT, 4);

    const onActions = controller.noteOn(7, 4.02, 112, 'pad:7');
    executeLeadTakeoverActions(target, onActions);
    vi.advanceTimersByTime(300);
    const noteOns = target.sent.filter((s) => s.startsWith('noteOn') && s.includes(':15:'));
    expect(noteOns.length).toBeGreaterThan(0);

    const offActions = controller.noteOff(7, 5.5, 'pad:7');
    executeLeadTakeoverActions(target, offActions);
    vi.advanceTimersByTime(300);
    const noteOffs = target.sent.filter((s) => s.startsWith('noteOff') && s.includes(':15:'));
    expect(noteOffs.length).toBeGreaterThan(0);
  });

  it('模拟延音场景:down→up(推迟 off)→snap noteOn→延音 off 全链平衡', () => {
    const target = makeTarget();
    resetLeadTakeoverRuntimeState(target);
    const controller = new LeadTakeoverController({ nativeLeadMuteEnabled: false });
    controller.setSnapshot(SNAPSHOT, 4);

    // 连续三次命中(模拟用户打了三个提示),每次 down/off 成对
    for (let i = 0; i < 3; i++) {
      const beat = 4 + i;
      executeLeadTakeoverActions(target, controller.noteOn(7, beat + 0.02, 112, 'pad:7'));
      vi.advanceTimersByTime(200);
      executeLeadTakeoverActions(target, controller.noteOff(7, beat + 0.6, 'pad:7'));
      vi.advanceTimersByTime(200);
    }
    const ons = target.sent.filter((s) => s.startsWith('noteOn') && s.includes(':15:'));
    const offs = target.sent.filter((s) => s.startsWith('noteOff') && s.includes(':15:'));
    expect(ons.length).toBeGreaterThanOrEqual(3);
    expect(offs.length).toBeGreaterThanOrEqual(3);
  });
});
```

## G. 集成点(仿真器侧,嵌入式做对应适配)

## `src/core/audio/playbackTypes.ts`

视觉事件协议(aura_cue* 三事件的载荷定义)。

```typescript
// ============================================================
// audio · playbackTypes(播放/视觉共享类型)
// ------------------------------------------------------------
// 这里只保留仍在用的中性类型:视觉事件(LedMatrix)+ 单轨名(mute)。
// ============================================================

/** 视觉事件(播放/交互 → LedMatrix 灯效)。aura_cue* = 光律漫游引导呼吸灯。 */
export interface VisualEvent {
    type: 'melody' | 'accomp' | 'bass' | 'drums' | 'counterMelody' | 'confirm' | 'custom_particle' | 'fn_key_active'
        | 'aura_cue' | 'aura_cue_hit' | 'aura_cue_clear';
    midiNote?: number;
    velocity?: number;
    col?: number;
    row?: number;
    hue?: number;
    energy?: number;
    spread?: number;
    source?: 'playback' | 'gameplay';
    time?: number;
    onset?: number;
    isUserMotif?: boolean;
    active?: boolean;
    /** aura_cue/aura_cue_hit:提示 id(hit 用于提前收灯)。 */
    cueId?: number;
    /** aura_cue:呼吸包络时序(performance.now() 时基,峰值已含提前量)。 */
    peakAtMs?: number;
    riseMs?: number;
    holdMs?: number;
    fadeMs?: number;
}

export type VisualEventListener = (event: VisualEvent) => void;

/** 单轨名(PipelineMonitor 单轨 mute 用;Q+N 映射见 AudioEngine.qnPartChannel)。 */
export type PartName =
    | 'vocal' | 'melody' | 'chord' | 'bass' | 'drums'
    | 'secondaryMelody' | 'counterMelody';
```

## `src/core/hardware/LedMatrix.tsx`

LED 渲染层(15×9=135 灯,每键 3×3):aura 段为呼吸灯逐帧求值/爆闪层/波纹;其余为仿真器氛围光模拟(嵌入式不需要,但 max 混合与 Aura Key 模式下关氛围光的逻辑要对应)。

```typescript
import React, { useEffect, useRef } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { VisualEvent } from '../audio/playbackTypes';
import { cueGlowIntensity, snuffGlow, type AuraCueGlowSpec } from '../../features/auraRoaming/cue/cueGlow';
import { subscribeAuraRoaming } from '../../features/auraRoaming/state/auraRoamingStore';

interface LedMatrixProps {
  activeKeys: Set<string>;
  appMode?: string;
}

interface Particle {
  x: number;
  y: number;
  hue: number;
  energy: number;
  spread: number;
  targetX: number;
  targetY: number;
  speed: number;
  active: boolean;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  speed: number;
  hue: number;
  thickness: number;
  active: boolean;
}

export function LedMatrix({ activeKeys, appMode }: LedMatrixProps) {
  // Touch Trail Refs
  const activeKeysRef = useRef<Set<string>>(activeKeys);
  const appModeRef = useRef<string | undefined>(appMode);
  const intensitiesA = useRef(new Float32Array(135));
  const intensitiesB = useRef(new Float32Array(135));
  const huesA = useRef(new Float32Array(135));
  const huesB = useRef(new Float32Array(135));
  const isA = useRef(true);
  const ledRefs = useRef<(HTMLDivElement | null)[]>([]);
  const lastTouchPos = useRef({ x: 7, y: 4 });
  const particlesRef = useRef<Particle[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const hitColorsRef = useRef<Map<string, number>>(new Map());
  const isFnKeyActiveRef = useRef(false);
  const auraGlowsRef = useRef<AuraCueGlowSpec[]>([]);
  interface AuraHitFlash { col: number; row: number; hue: number; atMs: number; peak: number; fadeMs: number; }
  const auraFlashesRef = useRef<AuraHitFlash[]>([]);
  const auraKeyOnRef = useRef(false);

  useEffect(() => subscribeAuraRoaming((snapshot) => { auraKeyOnRef.current = snapshot.auraKeyOn; }), []);

  useEffect(() => {
    activeKeysRef.current = activeKeys;
    
    // Clean up hit colors for released keys
    for (const key of hitColorsRef.current.keys()) {
      if (!activeKeys.has(key)) {
        hitColorsRef.current.delete(key);
      }
    }
  }, [activeKeys]);

  useEffect(() => {
    appModeRef.current = appMode;
  }, [appMode]);

  useEffect(() => {
    const handleVisualEvent = (event: VisualEvent) => {
      const { type, midiNote, velocity } = event;

      // Aura Key 引导期间关掉整轨"氛围光"(每音符粒子雨会淹没引导呼吸灯);
      // 只保留引导灯、命中光斑(custom_particle)与按键反馈
      if (
        auraKeyOnRef.current
        && (type === 'melody' || type === 'accomp' || type === 'bass' || type === 'drums' || type === 'counterMelody')
      ) {
        return;
      }

      if (type === 'custom_particle') {
        const cx = event.col !== undefined ? event.col * 3 + 1 : 7;
        const cy = event.row !== undefined ? event.row * 3 + 1 : 4;
        let hue = event.hue ?? 180;

        particlesRef.current.push({
          x: cx, y: cy, hue, energy: event.energy ?? 2.0, spread: event.spread ?? 3.0, targetX: -1, targetY: -1, speed: 0,
          active: true
        });
        return;
      }

      if (type === 'fn_key_active') {
        isFnKeyActiveRef.current = !!event.active;
        return;
      }

      // 光律漫游引导呼吸灯:包络参数随事件带入,峰值时刻绝对制(performance.now
      // 时基),rAF 每帧算亮度 → 事件派发抖动不影响"提前 50~100ms 最亮"的契约
      if (type === 'aura_cue') {
        if (event.col !== undefined && event.row !== undefined && event.peakAtMs !== undefined) {
          auraGlowsRef.current.push({
            cueId: event.cueId ?? -1,
            col: event.col,
            row: event.row,
            hue: event.hue ?? 272,
            peakAtMs: event.peakAtMs,
            riseMs: event.riseMs ?? 500,
            holdMs: event.holdMs ?? 320,
            fadeMs: event.fadeMs ?? 260,
          });
        }
        return;
      }
      if (type === 'aura_cue_hit') {
        const atMs = performance.now();
        auraGlowsRef.current = auraGlowsRef.current.map((g) => (g.cueId === event.cueId ? snuffGlow(g, atMs) : g));
        // 命中手感:整键爆闪(瞬时超亮→快速衰减)+ 向外扩满全板的渐暗波浪
        if (event.col !== undefined && event.row !== undefined) {
          auraFlashesRef.current.push({
            col: event.col,
            row: event.row,
            hue: event.hue ?? 272,
            atMs,
            peak: event.energy ?? 2.4,
            fadeMs: 340,
          });
          ripplesRef.current.push({
            x: event.col * 3 + 1,
            y: event.row * 3 + 1,
            radius: 0.5,
            maxRadius: 5,
            speed: 0.34,
            hue: event.hue ?? 272,
            thickness: 1.4,
            active: true,
          });
        }
        return;
      }
      if (type === 'aura_cue_clear') {
        auraGlowsRef.current = [];
        return;
      }

      if (type === 'confirm') {
        const cx = event.col !== undefined ? event.col * 3 + 1 : 7;
        const cy = event.row !== undefined ? event.row * 3 + 1 : 4;
        let hue = event.hue ?? 180;
        
        if (event.col !== undefined && event.row !== undefined) {
          const padId = `key-${event.col}-${event.row}`;
          hitColorsRef.current.set(padId, hue);
        }
        return;
      }

      const hue = (midiNote * 12) % 360;
      
      let x = 0, y = 0, energy = 0, spread = 0;
      let targetX = -1, targetY = -1, speed = 0;

      if (type === 'accomp') {
        // Edges
        x = Math.random() > 0.5 ? Math.floor(Math.random() * 4) : 11 + Math.floor(Math.random() * 4);
        y = 1 + Math.floor(Math.random() * 7);
        energy = velocity * 0.70; // Increased for breathing (+20%)
        spread = 7.2; // Increased spread (+20%)
        
        if (Math.random() > 0.5) {
          // Move inward
          targetX = x < 7 ? x + 3 + Math.random() * 3 : x - 3 - Math.random() * 3;
          targetY = y + (Math.random() * 4 - 2);
          speed = 0.02 + Math.random() * 0.03; // Slower
        }
      } else if (type === 'melody') {
        // Center
        x = 3 + Math.floor(Math.random() * 9);
        y = 1 + Math.floor(Math.random() * 7);
        energy = velocity * 1.03; // Increased (+20%)
        spread = 3.6; // Increased spread (+20%)
        
        if (Math.random() > 0.5) {
          // Move outward
          targetX = x < 7 ? x - 2 - Math.random() * 2 : x + 2 + Math.random() * 2;
          targetY = y + (Math.random() * 4 - 2);
          speed = 0.04 + Math.random() * 0.04; // Slower
        }
      } else if (type === 'drums') {
        // Background wash
        x = Math.floor(Math.random() * 15);
        y = Math.floor(Math.random() * 9);
        energy = velocity * 0.35; // Increased (+20%)
        spread = 10.2; // Increased spread for a wash effect (+20%)
        
        // Slow drift
        targetX = x + (Math.random() * 4 - 2);
        targetY = y + (Math.random() * 4 - 2);
        speed = 0.01 + Math.random() * 0.01; // Extremely slow
      }

      particlesRef.current.push({
        x, y, hue, energy, spread, targetX, targetY, speed,
        active: true
      });
    };

    AudioEngine.addVisualListener(handleVisualEvent);
    return () => AudioEngine.removeVisualListener(handleVisualEvent);
  }, []);

  useEffect(() => {
    let rafId: number;
    const loop = () => {
      const time = performance.now() * 0.001;
      let needsUpdate = false;
      
      const currentIntensities = isA.current ? intensitiesA.current : intensitiesB.current;
      const nextIntensities = isA.current ? intensitiesB.current : intensitiesA.current;
      const currentHues = isA.current ? huesA.current : huesB.current;
      const nextHues = isA.current ? huesB.current : huesA.current;

      // 0. Update Center of Mass
      if (activeKeysRef.current.size > 0) {
        let sumX = 0, sumY = 0, count = 0;
        activeKeysRef.current.forEach(keyId => {
          const parts = keyId.split('-');
          if (parts.length === 3) {
            sumX += parseInt(parts[1]) * 3 + 1;
            sumY += parseInt(parts[2]) * 3 + 1;
            count++;
          }
        });
        if (count > 0) {
          lastTouchPos.current.x += (sumX / count - lastTouchPos.current.x) * 0.3;
          lastTouchPos.current.y += (sumY / count - lastTouchPos.current.y) * 0.3;
        }
      }

      const mixHue = (h1: number, h2: number, w1: number, w2: number) => {
        if (w1 < 0.001) return h2;
        if (w2 < 0.001) return h1;
        let diff = h2 - h1;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        const weight = w2 / (w1 + w2);
        let res = h1 + diff * weight;
        if (res < 0) res += 360;
        return res % 360;
      };

      // 1. Diffusion and Decay
      for (let y = 0; y < 9; y++) {
        for (let x = 0; x < 15; x++) {
          const idx = y * 15 + x;
          let val = currentIntensities[idx];
          let hue = currentHues[idx];

          if (appModeRef.current === 'custom_clear') {
            // Fast clear for custom modes to keep visuals crisp
            val *= 0.5;
            if (val < 0.05) val = 0;
            else needsUpdate = true;
          } else if (auraKeyOnRef.current) {
            // Aura Key:无扩散的干净衰减 — 场面清爽,引导灯每帧重写不受影响
            val *= 0.8;
            if (val < 0.01) val = 0;
            else needsUpdate = true;
          } else {
            // Diffusion
            let neighborSum = 0;
            let neighbors = 0;
            let neighborHueSumX = 0;
            let neighborHueSumY = 0;

            const addNeighbor = (nIdx: number) => {
              const nVal = currentIntensities[nIdx];
              neighborSum += nVal;
              neighbors++;
              if (nVal > 0.01) {
                const nHue = currentHues[nIdx];
                neighborHueSumX += Math.cos(nHue * Math.PI / 180) * nVal;
                neighborHueSumY += Math.sin(nHue * Math.PI / 180) * nVal;
              }
            };

            if (x > 0) addNeighbor(idx - 1);
            if (x < 14) addNeighbor(idx + 1);
            if (y > 0) addNeighbor(idx - 15);
            if (y < 8) addNeighbor(idx + 15);

            const avgNeighborVal = neighbors > 0 ? neighborSum / neighbors : 0;
            
            // Blend current with neighbors
            val = val * 0.65 + avgNeighborVal * 0.35;

            if (avgNeighborVal > 0.01) {
              const avgNeighborHue = (Math.atan2(neighborHueSumY, neighborHueSumX) * 180 / Math.PI + 360) % 360;
              hue = mixHue(hue, avgNeighborHue, val * 0.65, avgNeighborVal * 0.35);
            }

            // Distance from last touch center
            const dx = x - lastTouchPos.current.x;
            const dy = y - lastTouchPos.current.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Organic smoke decay
            const noise = Math.sin(x * 0.8 + time * 2) * Math.cos(y * 0.8 - time * 1.5);
            const distFactor = Math.pow(Math.max(0, Math.min(1, dist / 12)), 1.5);
            
            // Base decay: 0.96 to 0.98 for slightly longer breathing feel
            const decayBase = 0.96 - (distFactor * 0.015);
            const decay = decayBase + noise * 0.005;

            val *= decay;
            if (val < 0.005) val = 0;
            else needsUpdate = true;
          }

          nextIntensities[idx] = val;
          nextHues[idx] = hue;
        }
      }

      // 2. Inject energy from active keys
      if (activeKeysRef.current.size > 0) {
        const defaultTouchHue = (time * 40) % 360;
        activeKeysRef.current.forEach(keyId => {
          const parts = keyId.split('-');
          if (parts.length === 3) {
            const keyC = parseInt(parts[1]);
            const keyR = parseInt(parts[2]);
            const cx = keyC * 3 + 1;
            const cy = keyR * 3 + 1;

            if (appModeRef.current === 'custom_pad_lit') {
              // In custom modes, just light up the 3x3 block
              let hue = hitColorsRef.current.get(keyId) ?? 180;
              
              for (let y = cy - 1; y <= cy + 1; y++) {
                for (let x = cx - 1; x <= cx + 1; x++) {
                  if (x >= 0 && x < 15 && y >= 0 && y < 9) {
                    const idx = y * 15 + x;
                    const currentE = nextIntensities[idx];
                    nextIntensities[idx] = Math.min(1.5, currentE + 1.5); // Brighter when touched
                    nextHues[idx] = mixHue(nextHues[idx], hue, currentE, 1.5);
                    needsUpdate = true;
                  }
                }
              }
            } else if (auraKeyOnRef.current) {
              // Aura Key:按键反馈用清脆 3×3 小块(暗于引导灯,不喷流体烟雾)
              for (let y = cy - 1; y <= cy + 1; y++) {
                for (let x = cx - 1; x <= cx + 1; x++) {
                  if (x >= 0 && x < 15 && y >= 0 && y < 9) {
                    const idx = y * 15 + x;
                    const currentE = nextIntensities[idx];
                    nextIntensities[idx] = Math.min(1.1, currentE + 0.8);
                    nextHues[idx] = mixHue(nextHues[idx], 190, currentE, 0.8);
                    needsUpdate = true;
                  }
                }
              }
            } else {
              // Default fluid touch trail
              for (let y = 0; y < 9; y++) {
                for (let x = 0; x < 15; x++) {
                  const dx = x - cx;
                  const dy = y - cy;
                  const distSq = dx * dx + dy * dy;

                  const angle = Math.atan2(dy, dx);
                  const shapeNoise = Math.sin(angle * 4 + time * 8) * 2.0;
                  const effectiveDistSq = distSq + shapeNoise;

                  if (effectiveDistSq < 7.2) {
                    const energy = Math.exp(-Math.max(0, effectiveDistSq) / 3.1) * 0.86;
                    const idx = y * 15 + x;
                    const currentE = nextIntensities[idx];
                    nextIntensities[idx] = Math.min(1.44, currentE + energy);
                    nextHues[idx] = mixHue(nextHues[idx], defaultTouchHue, currentE, energy);
                    needsUpdate = true;
                  }
                }
              }
            }
          }
        });
      }

      // 3. Process Particles (Music Events)
      const activeParticles = [];
      for (const p of particlesRef.current) {
        if (!p.active) continue;

        // Inject energy at current position
        for (let y = 0; y < 9; y++) {
          for (let x = 0; x < 15; x++) {
            const dx = x - p.x;
            const dy = y - p.y;
            const distSq = dx * dx + dy * dy;

            if (distSq < p.spread * 2) {
              const energy = Math.exp(-distSq / (p.spread / 2)) * p.energy;
              const idx = y * 15 + x;
              const currentE = nextIntensities[idx];
              nextIntensities[idx] = Math.min(2.0, currentE + energy);
              nextHues[idx] = mixHue(nextHues[idx], p.hue, currentE, energy);
              needsUpdate = true;
            }
          }
        }

        // Move particle
        if (p.targetX !== -1 && p.targetY !== -1) {
          const dx = p.targetX - p.x;
          const dy = p.targetY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist < 0.5) {
            // Reached target, do a final burst and die
            p.energy *= 1.5;
            p.targetX = -1; // Stop moving
            p.active = false;
          } else {
            p.x += (dx / dist) * p.speed;
            p.y += (dy / dist) * p.speed;
            p.energy *= 0.95; // Fade out while moving
            if (p.energy < 0.05) p.active = false;
          }
        } else {
          p.active = false; // Static burst dies immediately
        }

        if (p.active) activeParticles.push(p);
      }
      particlesRef.current = activeParticles;

      // 3.5 Process Ripples
      const activeRipples = [];
      for (const r of ripplesRef.current) {
        if (!r.active) continue;

        for (let y = 0; y < 9; y++) {
          for (let x = 0; x < 15; x++) {
            const dx = x - r.x;
            const dy = y - r.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            const distToRing = Math.abs(dist - r.radius);
            
            if (distToRing < r.thickness) {
              // Sharper crest: energy drops quickly as it moves away from the exact ring radius
              const ringEnergy = Math.exp(-(distToRing * distToRing) / 0.5);
              // Fade out as the ripple expands
              const fadeOut = Math.max(0, 1 - (r.radius / r.maxRadius));
              const energy = ringEnergy * fadeOut * 4.0; // High energy for bright crest
              
              if (energy > 0.05) {
                const idx = y * 15 + x;
                const currentE = nextIntensities[idx];
                nextIntensities[idx] = Math.min(4.0, currentE + energy);
                nextHues[idx] = mixHue(nextHues[idx], r.hue, currentE, energy);
                needsUpdate = true;
              }
            }
          }
        }

        r.radius += r.speed;
        if (r.radius >= r.maxRadius) {
          r.active = false;
        } else {
          activeRipples.push(r);
        }
      }
      ripplesRef.current = activeRipples;

      // 4. Render Function Key (Top Right: c=4, r=0 -> x:12-14, y:0-2)
      if (isFnKeyActiveRef.current) {
        const breathe = 0.5 + 0.5 * Math.sin(time * 4); // Fast breathing
        const hue = (time * 60) % 360; // Rainbow cycle
        for (let dy = 0; dy < 3; dy++) {
          for (let dx = 0; dx < 3; dx++) {
            const idx = dy * 15 + (12 + dx);
            nextIntensities[idx] = Math.max(nextIntensities[idx], 0.3 + breathe * 0.7);
            nextHues[idx] = hue;
          }
        }
        needsUpdate = true;
      }

      // 4.5 Aura Key 引导呼吸灯:该键 9 颗灯同步,max 混合不覆盖既有能量
      if (auraGlowsRef.current.length > 0) {
        const glowNowMs = time * 1000;
        const alive: AuraCueGlowSpec[] = [];
        for (const glow of auraGlowsRef.current) {
          const intensity = cueGlowIntensity(glowNowMs, glow);
          if (intensity < 0) continue;
          alive.push(glow);
          if (intensity <= 0) continue;
          const cx = glow.col * 3 + 1;
          const cy = glow.row * 3 + 1;
          const level = intensity * 1.25;
          for (let y = cy - 1; y <= cy + 1; y++) {
            for (let x = cx - 1; x <= cx + 1; x++) {
              if (x < 0 || x >= 15 || y < 0 || y >= 9) continue;
              const idx = y * 15 + x;
              if (level > nextIntensities[idx]) {
                nextIntensities[idx] = level;
                nextHues[idx] = glow.hue;
              }
            }
          }
        }
        auraGlowsRef.current = alive;
        if (alive.length > 0) needsUpdate = true;
      }

      // 4.6 命中爆闪:瞬时打到超亮,二次方衰减(压过引导灯与波纹)
      if (auraFlashesRef.current.length > 0) {
        const flashNowMs = time * 1000;
        const aliveFlashes: AuraHitFlash[] = [];
        for (const flash of auraFlashesRef.current) {
          const t = (flashNowMs - flash.atMs) / flash.fadeMs;
          if (t >= 1) continue;
          aliveFlashes.push(flash);
          const level = flash.peak * (1 - t) * (1 - t);
          const cx = flash.col * 3 + 1;
          const cy = flash.row * 3 + 1;
          for (let y = cy - 1; y <= cy + 1; y++) {
            for (let x = cx - 1; x <= cx + 1; x++) {
              if (x < 0 || x >= 15 || y < 0 || y >= 9) continue;
              const idx = y * 15 + x;
              if (level > nextIntensities[idx]) {
                nextIntensities[idx] = level;
                nextHues[idx] = flash.hue;
              }
            }
          }
        }
        auraFlashesRef.current = aliveFlashes;
        if (aliveFlashes.length > 0) needsUpdate = true;
      }

      // 5. Apply to DOM
      if (needsUpdate) {
        for (let i = 0; i < 135; i++) {
          const el = ledRefs.current[i];
          if (el) {
            const intensity = nextIntensities[i];
            if (intensity > 0.005 || el.style.getPropertyValue('--touch-intensity') !== '0') {
              el.style.setProperty('--touch-intensity', intensity > 0.005 ? intensity.toFixed(3) : '0');
              
              if (intensity > 0.005) {
                el.style.setProperty('--touch-hue', nextHues[i].toFixed(1));
              }
            }
          }
        }
      }

      isA.current = !isA.current;
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const leds = [];
  const ledW = 46;
  const ledH = 46;
  const containerW = 1333;
  const containerH = 780;
  const gapX = (containerW - 15 * ledW) / 14;
  const gapY = (containerH - 9 * ledH) / 8;

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 15; c++) {
      const ledIndex = r * 15 + c;
      
      let opacity = 0.07; // Slightly increased background glow (+20%)
      let rgb = { r: 6, g: 182, b: 212 }; // Default Cyan
      let duration = '500ms';
      let timing = 'ease-in';
      let extraClasses = '';

      const colorStr = `${rgb.r},${rgb.g},${rgb.b}`;

      leds.push(
        <div
          key={`led-${c}-${r}`}
          className={`absolute pointer-events-none mix-blend-screen ${extraClasses}`}
          style={{
            left: `calc(${c * (ledW + gapX)} / 1333 * 100%)`,
            top: `calc(${r * (ledH + gapY)} / 780 * 100%)`,
            width: `calc(${ledW} / 1333 * 100%)`,
            height: `calc(${ledH} / 780 * 100%)`,
          }}
        >
          {/* Base Layer */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              opacity: opacity,
              transition: `opacity ${duration} ${timing}`,
              background: `radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(${colorStr},0.8) 40%, transparent 70%)`,
              filter: 'blur(1px)',
              boxShadow: `0 0 12px 2.4px rgba(${colorStr},0.6)`
            }}
          />
          {/* Touch Trail Layer */}
          <div
            ref={el => ledRefs.current[ledIndex] = el}
            className="absolute inset-0 rounded-full will-change-transform will-change-opacity"
            style={{
              opacity: 'calc(var(--touch-intensity, 0) * 0.72)',
              transform: 'scale(calc(1 + var(--touch-intensity, 0) * 0.084))',
              background: `radial-gradient(circle, hsla(var(--touch-hue, 180), 100%, 80%, 0.96) 0%, hsla(var(--touch-hue, 180), 100%, 50%, 0.48) 40%, transparent 70%)`,
              filter: 'blur(1px)',
              boxShadow: `0 0 calc(7.2px * var(--touch-intensity, 0)) calc(0.84px * var(--touch-intensity, 0)) hsla(var(--touch-hue, 180), 100%, 50%, 0.36)`
            }}
          />
        </div>
      );
    }
  }

  return <>{leds}</>;
}
```

## `Dream5504MidiOutput.sendSchedulerChannelMessage`(节选:辅助通道 CC 豁免)

坑#1 的修复位置:辅助实时通道(scheduler role 为 null)豁免生成曲 CC 默认输出合同。

```typescript
  public sendSchedulerChannelMessage(
    channel0: number,
    message: Omit<MidiOutMessage, 'channel'>,
    timestampMs?: number,
  ): boolean {
    if (!this.requireReady('实时演奏')) return false;
    const role = schedulerChannelToOutputRole(channel0);
    const output = this.outputForRole(role);
    if (!output) {
      this.markSilent(`${role} 没有 MIDI 输出路由：已静音`);
      return false;
    }
    const channel = resolveSchedulerOutputChannel(channel0, this.state.mode, this.state.channels);
    const routedMessage = { ...message, channel } as MidiOutMessage;
    // 辅助实时通道(如 ch15 接管/Aura Key)不属于生成曲五通道的 Firm5504
    // 默认输出合同,拥有自己的 CC 流(音量抬档等);正式歌曲通道照旧受限
    const isAuxRealtimeChannel = schedulerChannelToRole(channel0) === null;
    if (!isAuxRealtimeChannel && !isDream5504RawDefaultMessageAllowed(routedMessage, role)) return true;
    try {
      sendMidiMessage(output, routedMessage, timestampMs);
      this.incrementEvent(`${role} · ch ${channel} · ${message.type}`);
      return true;
    } catch {
      this.markSilent(`${role} MIDI 发送失败：已静音`);
      return false;
    }
  }

  public sendPolyphonyAudition(request: MidiPolyphonyAudition): boolean {
```
