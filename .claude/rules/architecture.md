# Auraflow AF2 Architecture Rule

> **2026-05-25 重写** — 反映 14 commit 重构后的 7/8 层显式 core+plugin 架构。
> 本文件是 AF2 引擎的唯一宪法。每次动 `src/core/generation/af2-engine/` 前先读。

---

## 0. 何时必读

任一命中,先读完再动手:

- 改 `src/core/generation/af2-engine/` 下任何文件
- 新增 / 重命名 / 删除引擎模块或 plugin
- 改任何模块的 PRNG 消耗
- 改 IR 字段(`types.ts` / `ir/index.ts` / `af2-engine/types/ChordDef.ts`)
- 改任何 enum 数值或顺序(SectionType / ChordQuality / BandRole / MgStyle 等)
- 新增 musician / mgStyle / SectionType / BandRole / WalkPattern
- 改 `runPipeline` 入口 / `AudioEngine` 公开方法签名
- 写 App / 嵌入式直接调引擎

读完对应章节后再动手。偏离本文档的改动,听感大概率挂 / API 契约大概率破 /
关联模块大概率不同步。

---

## 0.5 需求评估守则(动手前必做)

**核心原则**:每次需求评估,**先做一次综合判断**,避免一开始就走偏 — 把通用的写进
专用文件 → 多处重复同步;把专用的写进 utils → 污染共享层。3 个必答问题:

### Q1:这是通用改动还是专用改动?

| 改动范围 | 该改哪 |
|---|---|
| **1 个 musician 卡专用** | `idioms/MusicianRegistry.ts` 卡内 `persona` / `af2Overrides` |
| **1 个 mgStyle 专用**(POP/JAZZ/RNB/BLUES) | per-style 配置表(Arranger `SECTION_POOLS_BY_STYLE` / AccompGen `STYLE_TEXTURE_POOL` / Composer `DEFAULT_VOICING_MODE_BY_STYLE` / drum-grid / `FILL_STYLES_BY_STYLE` 等) |
| **1 个 sectionType 专用**(Intro/Verse/Chorus 等) | per-sectionType 池(`SECTION_POOLS` / `SECTION_SLICE_POOL` / `phraseContourBias` 等) |
| **1 个 plugin 内部细节** | 该 plugin 文件(`plugins/<layer>/Xxx.ts`) |
| **≥ 2 处复用**(跨 plugin / 跨 idiom) | 抽 `utils/*.ts` 或 `music-theory/*.ts` |
| **跨 layer 协议**(改 plugin 元数据 / 改 PRNG 协议 / 改 IR) | 改 core 协议 + 更新本规则对应章节 + §12 跨同步登记表新增条目 |

**错位惩罚**:
- 通用逻辑写进专用文件 → 多处重复同步,改一处漏一处(本会话 §13 已遇 7 次)
- 专用配置写进 utils → 污染共享层,模糊"哪些是 invariant / 哪些是 tunable"

### Q2:是否已有重复实现?

动手前 grep 类似公式 / helper / 配置:

```bash
# hash 公式(plugin 内常见 deterministic gate)
grep -rn "& 0xff" src/core/generation/af2-engine/

# velocity clamp([0.1, 1.0] 全系统统一)
grep -rn "Math.max(0.1, Math.min(1" src/core/generation/af2-engine/

# pitch class normalization
grep -rn "((.*% 12) + 12) % 12" src/core/generation/af2-engine/

# per-style 配置表(看哪些已存在,加新 mgStyle 时全部同步)
grep -rn "Record<MgStyle" src/core/generation/af2-engine/

# musician override 字段消费者
grep -rn "af2Overrides\." src/core/generation/af2-engine/
```

存在 → **复用 / 扩展**(prefer 复用);**严禁第二份独立实现**。
不存在但 Q1 答"≥ 2 处复用" → 抽到 utils,这次实现就抽。

### Q3:PRNG 影响评估

| 改动 | 必须做 |
|---|---|
| 加 `rng.next()` / `rng.pick()` 调用 | 同 seed 输出会变 → 必须更新该 plugin metadata `prngConsumption`;'locked' plugin 必须**保占位**(条件分支跳过也要 `rng.next()`,见 DynamicHarmonyDecorator lockType ceremony) |
| 减 `rng.next()` 调用 | 同上,绝不要直接删除;改 plugin 协议为 `'zero'` 并改用 deterministic hash gate |
| 改 hash gate 公式 | 同 seed bit-exact 改变 → 听感 4 mgStyle 重新对账(POP/JAZZ/RNB/BLUES) |
| 加新 plugin 用 PRNG | metadata 明文标 `'zero'` / `'locked'` / `'forked'`,选 `'forked'` 派 `${seed}::name` sub-stream 不污染主流 |

### 反例清单(本会话审计踩到的)

| 反例 | 修复 |
|---|---|
| GM Drum 键位散落 4 个 override 文件 | 抽 `plugins/drum/constants.ts` |
| `(h * 31 + 17) & 0xff` 重复 3 处 | 抽 `utils/hash-utils.ts` `hashApplyPersonaPass(h)` |
| `Math.max(0.1, Math.min(1, v))` 重复 4 处 | 抽 `utils/velocity.ts` `clampVelocity(v)` |
| `classifyPhraseRole` 重复 3 个 Planner | 抽 `utils/phrase-role.ts` |
| `romanHead` 重复 2 个 Planner | 抽 `utils/roman.ts` |
| `MINOR_TO_MAJOR_TYPE` 重复 2 文件 | 抽 `utils/minor-major-type.ts` |
| `phraseIdx + h` 在 AccompGen.pickTextureType 算两遍 | hoist 到函数顶 |

**走完 3 问 + grep**,从源头避免"已经做过的事再做一遍"。

---

## 1. 总览:8 层架构 + 7/8 层 plugin 化

### 1.1 数据流(顶层)

```
┌─ 1. BandEngine ────────────────── 选 Band(5 槽位)
        ↓
┌─ 2. Conductor ──────────────────── core + 5 RoleFilter plugin
        ↓                              → SectionAssignment[]
┌─ 3. Arranger ───────────────────── core + 4 ProgressionPlanner plugin
        ↓                              → Af2AbstractStep[]
┌─ 4. Composer ───────────────────── core + 2 plugin
        ↓                              → ChordDef[]
┌─ 5. Dispatcher ─────────────────── thin orchestrator(调用顺序敏感)
        ↓                              → Map<musicianId, NoteData[]>
┌─ 6. 乐手 Idiom ─────────────────── 4 musician
│   ├─ PianoIdiom + MelodyGen(6 plugin)+ AccompGen(3 plugin)
│   ├─ BassIdiom(原子)
│   ├─ DrumIdiom + 3 Modifier + 5 Override
│   └─ PadIdiom(原子)
        ↓
┌─ 7. Reconciler ─────────────────── 纯 plugin 链(3 plugin,无 core)
        ↓                              → velocity 调整
┌─ 8. GM128 装配 ──────────────────── thin priority chain
        ↓
   AbsoluteTransposer(K-2 唯一加 keyOffset 点)
        ↓
   MidiConverter → PlaybackEngine → 音频输出
```

### 1.2 plugin 化状态表

| Layer | 单元 | core | plugin chain |
|---|---|---|---|
| 1 | BandEngine | thin selector | — |
| 2 | Conductor | `buildDefaultByMusician`(全员上岗) | 5 RoleFilter |
| 3 | Arranger | per-section 抽进行 + 拼接 | 4 ProgressionPlanner |
| 4 | Composer | 主循环 + voicing assembly + placement | DynamicHarmonyDecorator + VoicingSmoother |
| 5 | Dispatcher | orchestrator | — |
| 6 | MelodyGen(钢琴) | role gate + chord-tone cycle + placeNearAnchor | 6 plugin |
| 6 | AccompGen(钢琴) | textureType pick + family dispatch + velocity persona | 3 post-pass plugin |
| 6 | DrumIdiom | per-step PRNG 3 gate + emit | 3 Modifier + 5 Override |
| 6 | BassIdiom / PadIdiom | 原子(不拆) | — |
| 7 | Reconciler | 无 core | 3 plugin |
| 8 | GM128 装配 | thin priority chain | — |

7 / 8 层显式 core+plugin。余下 3 thin 层(BandEngine / Dispatcher / GM128)是 framework seam,不值得拆。

### 1.3 全景树状图(core + plugin 职责)

每个 layer 的 core / plugin 全清单 + 一句话职责。详细 PRNG / 触发条件 / 改 X 去哪改见 §3-§10 各 layer 章节。

```
┌─ Layer 1: BandEngine ──────────────────────────────────────────────────────────┐
│ Core                                                                            │
│   BandSelectionStore + MusicianRegistry  从 9 张 musician 卡选 5 槽位 Band      │
│ Plugin: 无(thin selector,无算法决策)                                          │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─ Layer 2: Conductor ───────────────────────────────────────────────────────────┐
│ Core                                                                            │
│   buildDefaultByMusician          全员上岗,1 musician → 1 default role         │
│   pickConductorTemplate           per-mgStyle template variant 抽(seed hash) │
│ Plugin chain(DEFAULT_ROLE_FILTERS,5 RoleFilter,全 'zero' PRNG)              │
│   1. WakeKGate                    K < wakeK → silent(apex 例外 + Z3 ±0.15)   │
│   2. PeakKGate                    K > peakK → silent(apex 例外 + Z3 ±0.15)   │
│   3. StyleTemplateFilter          per-mgStyle template INTERSECTION(apex 例外)│
│   4. EnergyFilter                 energy 密度档 INTERSECTION(apex 例外)       │
│   5. MusicianPrefFilter           musician.sectionRolePreference INTERSECTION  │
│                                   (不 bypass apex,尊重 user 意图)             │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─ Layer 3: Arranger ────────────────────────────────────────────────────────────┐
│ Core                                                                            │
│   arrange() 主循环                per-section 从池抽进行 + 拼接 skeleton        │
│   SECTION_POOLS_BY_STYLE          Major 进行池(per mgStyle × sectionType)    │
│   SECTION_POOLS_BY_STYLE_MINOR    Minor 镜像池                                  │
│   SUB_STYLE_PROGRESSIONS          per-sub-style 优先池(P5 阶段)              │
│ Plugin chain(DEFAULT_PROGRESSION_PLANNERS,4 Planner,全 'forked' PRNG)       │
│   1. BorrowChordPlanner           Modal interchange(7 rule × 3 source × 5 防呆)│
│   2. PicardyPlanner               Minor only:phrase end i→I picardy 3rd       │
│   3. MinorBorrowPlanner           Minor only:iv→IV / bVI→VI parallel-major   │
│   4. TonicizationPlanner          secondary ii-V(4 placement × target mult)  │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─ Layer 4: Composer ────────────────────────────────────────────────────────────┐
│ Core                                                                            │
│   compose() 主循环                per step + look-ahead next → ChordDef[]      │
│   assembleVoicing                 per-mgStyle voicing mode(FULL/ROOTLESS/etc)│
│   placeVoicingMidi                voice-leading + chord range placement        │
│   spellPcInKey / midiToNoteInChord  音名拼写                                   │
│ Plugin(2)                                                                       │
│   1. DynamicHarmonyDecorator      chord-type decoration('locked' 2-3 PRNG):  │
│                                   lockType ceremony + colorLevel + TSD dict +  │
│                                   Sub-V tritone + data-debt guard              │
│   2. VoicingSmoother              R+S2 post-pass voice leading('zero'):      │
│                                   inversion candidates + phrase-arc bonus      │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─ Layer 5: Dispatcher ──────────────────────────────────────────────────────────┐
│ Core                                                                            │
│   dispatchMusicians()             按顺序调用 musician,累积 peers              │
│   调用顺序                        melody → bass → accomp → drums → pad        │
│ Plugin: 无(thin orchestrator,调用顺序由 framework 硬编)                       │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─ Layer 6: 4 musician idiom ────────────────────────────────────────────────────┐
│                                                                                 │
│ 6.1 PianoIdiom(planMelody / planAccomp / planBass 3 method)                   │
│   Core sub-orchestrator                                                         │
│     Af2MelodyGen                  chord-tone melody 主循环(role gate + cycle  │
│                                   [root,5,3,7] + placeNearAnchor + 边界 clamp) │
│     Af2AccompGen                  accomp 主循环(pickTextureType phrase-lock +│
│                                   ChordTextureEngine dispatch + velocity persona)│
│   Plugin: Melody 6 + Accomp 3 post-pass(全 'zero' PRNG)                       │
│     Melody(per slot 决策):                                                    │
│       1. RhythmPatternPicker      per-mgStyle rhythm pool + persona 加权       │
│       2. PhraseContourShaper      per-sectionType MIDI bias(arch/up/down)    │
│       3. PassingToneSelector      chromatic passing 50% gate + diatonic 选音 │
│       4. PhraseEndingDecider      section 末 chord 短 pickup + 长 tonic       │
│       5. SparsityGate             per-slot 删音                                │
│       6. VelocityHumanizer        per-slot velocity 浮动                       │
│     Accomp post-pass(链式调用):                                              │
│       1. MelodyDensityDucker      melody 密 ×0.6 / 稀 ×1.15(对话感)          │
│       2. SwingApplier             per-mgStyle 直拍 8th and swing               │
│       3. MicroTimingHumanizer     同 onset cluster strum micro-delay           │
│                                                                                 │
│ 6.2 BassIdiom(atomic,不拆 plugin)                                            │
│   Core                                                                          │
│     plan() 主循环                  walking pattern + swing + accents + jitter  │
│     WALK_PATTERNS                  per-pattern 节奏型(`data/BassWalkPatterns`)│
│     DEFAULT_WALK_PATTERN_BY_STYLE  per-mgStyle 默认 walking                    │
│     SWING_RATIO_BY_PATTERN         per-pattern swing 比例                      │
│   Plugin: 无(254 行紧凑,拆 plugin 性价比低)                                  │
│                                                                                 │
│ 6.3 DrumIdiom(orchestrator + 3 Modifier + 5 Override)                          │
│   Core                                                                          │
│     renderSection 主循环           per-step 16th grid + energy 双轴缩放 +      │
│                                   PRNG 3 gate(kick/snare/hihat)+ emit       │
│     drum-grid                     per-mgStyle grid(POP/JAZZ/BLUES/RNB)       │
│     SWING_RATIO_BY_STYLE          per-mgStyle drum swing                       │
│     plugins/drum/constants.ts     GM Drum Map 键位常量                         │
│   Plugin                                                                        │
│     Modifier(3,pre-PRNG,顺序敏感,全 'zero'):                                │
│       1. PersonaSparsity          全 probs × (1 - sparsity * 0.4)             │
│       2. CrossTrackModifier       bass strong → kick floor / chord sync → snare│
│       3. PersonaSyncopation       16th off-beat → snare boost                  │
│     Override(5,post-PRNG,前 4 互斥 + 第 5 独立,全 'zero'):                 │
│       1. BreakOverride            next Drop + 末 1/4 bar → 全静音(优先级最高)│
│       2. CrashOverride            段首 + crash section/高能 → Crash + kick     │
│       3. FillOverride             section transition 末 1 bar(5 fill style)  │
│       4. RideOverride             very high + 偶数 step + hihat → Ride        │
│       5. OpenHihatOverride        高能 + and-of-4 + hihat → Open Hihat(独立) │
│                                                                                 │
│ 6.4 PadIdiom(atomic,不拆 plugin)                                             │
│   Core                                                                          │
│     plan() 主循环                  voicing slice + attack pre-roll + velocity ramp│
│     SECTION_SLICE_POOL            per-sectionType slice mode 池(Low/Mid/High)│
│     atmosphereOverrides 消费       musician 卡 5 字段 wire                     │
│   Plugin: 无(308 行紧凑,拆 plugin 性价比低)                                  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─ Layer 7: Reconciler(无 core,纯 plugin 集合)─────────────────────────────────┐
│ Core: 无                                                                        │
│ Plugin(3,Facade Step 5.5-5.7 顺序调用,全 'zero' PRNG)                        │
│   1. EnergyHumanizer              段落能量驱动 velocity                         │
│                                   (energy 1→×0.70 / 5→×1.00 / 10→×1.10)     │
│                                   作用轨:melody / accomp / bass                │
│   2. CollisionDamper              accomp 撞 bass(<60)/melody(≥60)同 PC+   │
│                                   同 onset → ×0.5(只 damp accomp)           │
│   3. DropBuildupDynamics          Drop kind 缩放 + BuildUp 末 bar velocity ramp│
│                                   作用轨:melody / bass / accomp / pad         │
│                                   (drums 跳过,DrumIdiom 内部已感知)          │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─ Layer 8: GM128 装配 ──────────────────────────────────────────────────────────┐
│ Core(thin priority chain)                                                      │
│   Facade Step 6b                  优先级:                                       │
│                                   forcedGmPrograms > musician.gmProgramOverride│
│                                   > musician.defaultSound > AF2 idiom 默认     │
│ Plugin: 无                                                                      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 三大不变式

违反任一条 = 必坏(听感漂移 / 同 seed 不复现 / 跨模块脱节)。

### 2.1 K-2:Pitch Space 三空间

| 空间 | 哪些模块用 | pitch 范围 |
|---|---|---|
| **RELATIVE** | Arranger / Composer / Dispatcher / Idiom 全程 | pc 0-11 + 八度偏移,**不含** keyOffset |
| **ABSOLUTE** | `AbsoluteTransposer.arrange()` 之后 | RELATIVE + keyOffset,clamp [0,127] |
| **GM Drum Map**(第三空间) | Drums 轨 pitch(36-51 物理键位) | AbsoluteTransposer **不加** keyOffset |

**铁律**:AbsoluteTransposer 之前任何模块**禁止**给 `NoteData.pitch` 加 `keyOffset`。
Drums 轨用 `plugins/drum/constants.ts` 的 GM 常量,不参与转调。

### 2.2 D-5:PRNG 三协议

每个 plugin 在 metadata 明文标注 `prngConsumption`:

| 协议 | 含义 | 例子 |
|---|---|---|
| `'zero'` | 不消耗 PRNG(用 deterministic hash gate) | 所有 melody plugin / accomp post-pass / reconciler / drum modifier+override / conductor filter / VoicingSmoother |
| `'locked'` | 固定消耗 N 次(跳过条件也占位 `rng.next()` 保 stream 不漂) | DynamicHarmonyDecorator(2-3 次:lockType ceremony / colorLevel + pick + 条件 Sub-V gate) |
| `'forked'` | 用独立 sub-stream(`${seed}::name`),不污染主流 | Arranger 4 Planner(borrow / picardy / minor-borrow / tonicize)/ DrumGenerator(`af2_drum_${seed}`) |

**铁律**:
- 禁止 `Math.random()`,用 `Random` 或 `PRNGManager`
- 算法不变的重构 → PRNG 调用顺序必须 verbatim 一致
- 加新 plugin 必须在 metadata 声明 prngConsumption 并与实现一致

### 2.3 数据契约(IR 字段)

| 操作 | 规则 |
|---|---|
| 加 IR 字段 | **必须可选**(`field?: T`)— 不破坏旧 caller |
| 删 IR 字段 | 跨 AF2 全评估,确认零消费者 |
| 改 IR 字段类型 | 跨 AF2 全评估,可能需要 deprecation 路径 |
| `GeneratedChord.voicing` | 在 RELATIVE 空间;AbsoluteTransposer 之后才转 ABSOLUTE |
| `NoteData.velocity` | [0,1] float(MIDI vel 1-127 等价);用 `clampVelocity()` clamp |
| `SectionMetadata.startBeat/endBeat` | 拍数 float |

---

## 3. Layer 1:BandEngine

**职责**:选 Band(5 槽位:MainInst / Accomp / Bass / Drums / Atmosphere)。

**主文件**:`state/BandSelectionStore.ts` + `idioms/MusicianRegistry.ts`(9 musician 卡)。

**Core / Plugin 状态**:无 plugin(thin selector,无算法决策)。

**改 X 去哪改**:

| 改诉求 | 文件 |
|---|---|
| 新加 musician 卡 | `idioms/MusicianRegistry.ts` `MUSICIAN_POOL` 数组追加 |
| 改 musician 卡 persona | 同上,musician 对象 `persona` 字段 |
| 改 musician 卡 af2Overrides(per-instrument 行为) | 同上,`af2Overrides` 字段 |
| 跨 app 共享 BandSelection | `state/BandSelectionStore.ts`(单一真理之源) |

**跨模块同步**(改这些 → 同时改):

- 新 BandRole → `types.ts` enum + `Conductor.Band` + `SlotRouter` + `MidiConverter` channel + `MusicianRegistry` eligibleRoles
- 新 musician 卡 ID → `app_integration_rule §4` musician 列表(无外部文档则跳)

---

## 4. Layer 2:Conductor

**职责**:看 Band + Score,决定每段每位 musician 演什么 role(可多角色兼任 / silent)。

**主文件**:
- `af2-engine/Conductor.ts`(orchestrator + template + DynamicConductor.dispatch)
- `af2-engine/plugins/conductor/`(5 RoleFilter + types + index barrel)

**Core**:`buildDefaultByMusician`(全员上岗,1 musician → 1 default role,based on slot)。

**Plugin chain**(`plugins/conductor/index.ts` 的 `DEFAULT_ROLE_FILTERS` 数组,顺序敏感):

| # | Plugin | 行为 | apex bypass |
|---|---|---|---|
| 1 | `WakeKGate` | K < wakeK → silent(Z3 continuity ±0.15 容差) | ✓ |
| 2 | `PeakKGate` | K > peakK → silent(Z3 continuity ±0.15 容差) | ✓ |
| 3 | `StyleTemplateFilter` | per-mgStyle template INTERSECTION | ✓ |
| 4 | `EnergyFilter` | energy 密度档 INTERSECTION(1-2/3-4/5+) | ✓ |
| 5 | `MusicianPrefFilter` | musician.af2Overrides.sectionRolePreference INTERSECTION | **不** bypass |

**apex 例外**:`musician.persona.isApex && section.energyLevel >= 7` → 前 4 filter bypass。Pref 始终生效(尊重 user 意图)。

**PRNG**:全 'zero'。

**改 X 去哪改**:

| 改诉求 | 文件 |
|---|---|
| 加新 RoleFilter | `plugins/conductor/XxxFilter.ts` + 加入 `index.ts` 的 DEFAULT_ROLE_FILTERS 数组 |
| 改 filter 顺序 / 启停某 filter | `plugins/conductor/index.ts` DEFAULT_ROLE_FILTERS 数组 |
| 改 wakeK/peakK 容差 | `plugins/conductor/types.ts` `CONTINUITY_K_MARGIN` |
| 改 per-mgStyle template | `Conductor.ts` `CONDUCTOR_TEMPLATES_BY_STYLE` + `CONDUCTOR_TEMPLATE_VARIANTS_BY_STYLE` |
| 改 template variant 抽取 | `Conductor.ts` `pickConductorTemplate`(seed XOR styleHash,zero PRNG) |
| 改 musician 卡 sectionRolePreference | `MusicianRegistry.ts` 的 `af2Overrides.sectionRolePreference` |

**跨模块同步**:

- 改 SectionType enum → Conductor template 各 variant + Arranger 池 + Pad slice + Accomp pool
- 改 persona 字段(wakeK/peakK/isApex)→ musician 卡同步填默认值

---

## 5. Layer 3:Arranger

**职责**:决定全曲和声进行(级数 Roman + chord type + rootOffset)。

**主文件**:
- `af2-engine/Af2Arranger.ts`(orchestrator + 进行池 + arrange 主循环)
- `af2-engine/plugins/arranger/`(4 ProgressionPlanner wrapper + types + index)
- `af2-engine/BorrowChordPlanner.ts` / `TonicizationPlanner.ts` / `PicardyPlanner.ts` / `MinorBorrowPlanner.ts`(底层算法)

**Core**:per-section 从 `SECTION_POOLS_BY_STYLE[mgStyle][sectionType]`(或 Minor 镜像 / sub-style 优先池)抽进行 + 累积成 skeleton。

**Plugin chain**(`plugins/arranger/index.ts` 的 `DEFAULT_PROGRESSION_PLANNERS`,顺序敏感):

| # | Plugin | 行为 | shouldApply |
|---|---|---|---|
| 1 | `BorrowChordPlannerPlugin` | Modal interchange(7 rule × 3 source 锁定 × 5 防呆) | always(BLUES 内部 short-circuit) |
| 2 | `PicardyPlannerPlugin` | Minor only:phrase end i→I picardy 3rd | `isMinor && picardyRng` |
| 3 | `MinorBorrowPlannerPlugin` | Minor only:iv→IV / bVI→VI parallel-major borrow | `isMinor && minorBorrowRng` |
| 4 | `TonicizationPlannerPlugin` | secondary ii-V(4 placement × target mult × cooldown) | always(BLUES 内部 short-circuit) |

**顺序原因**:Borrow 先(给 Tonicize 看 borrow 后 target)/ Picardy 早于 MinorBorrow(Picardy lockType=true 不被 MinorBorrow 二次处理)/ Tonicize 末位。

**Per-mgStyle 概率 + 上限**:

| 维度 | POP | JAZZ | RNB | BLUES |
|---|---|---|---|---|
| Borrow prob / max | 0.45 / 3 | 0.35 / 4 | 0.55 / 5 | 0 / 0 |
| Picardy prob(Minor) | 0.30 | 0.20 | 0.25 | 0.10 |
| MinorBorrow prob / max | (M2)0.20+(M3)0.10 / 2 | 0.30+0.20 / 3 | 0.25+0.15 / 3 | 0+0 / 0 |
| Tonicize prob / max | 0.30 / 2 | 0.65 / 4 | 0.40 / 3 | 0 / 0 |

**PRNG**:全 'forked'(每 plugin 用独立 sub-stream:`${seed}::borrow` / `picardy` / `minor-borrow` / `tonicize`)。不污染主流。

**改 X 去哪改**:

| 改诉求 | 文件 |
|---|---|
| 改 per-mgStyle × sectionType 进行池(Major) | `Af2Arranger.ts` `SECTION_POOLS_BY_STYLE` |
| 改 per-mgStyle × sectionType 进行池(Minor) | `Af2Arranger.ts` `SECTION_POOLS_BY_STYLE_MINOR` |
| 改 per-sub-style 进行池 | `SubStyleProgressions.ts` `SUB_STYLE_PROGRESSIONS` |
| 改 Borrow 7 rule | `BorrowChordPlanner.ts` `RULES` 数组 |
| 改 Borrow per-style 概率 / 上限 | `BorrowChordPlanner.ts` `STYLE_BORROW_PROB` / `STYLE_MAX_BORROWS_PER_SONG` |
| 改 Tonicize 4 placement 权重 | `TonicizationPlanner.ts` `STYLE_PLACEMENT_WEIGHTS` |
| 改 Tonicize target mult | `TonicizationPlanner.ts` `TARGET_MULT` |
| 改 plugin 顺序 / 启停 | `plugins/arranger/index.ts` `DEFAULT_PROGRESSION_PLANNERS` 数组 |
| 加新 Planner | 新建 `plugins/arranger/XxxPlannerPlugin.ts` + 加入 DEFAULT 数组 |

---

## 6. Layer 4:Composer

**职责**:把 `Af2AbstractStep[]`(Roman + type + rootOffset)实化为完整 `ChordDef[]`(含 voicing / bassMidi / chordSymbol)。

**主文件**:
- `af2-engine/Af2Composer.ts`(orchestrator + 主循环 + assembleVoicing + placeVoicingMidi + 拼写)
- `af2-engine/plugins/composer/`(2 plugin + types + index)
- `af2-engine/DynamicHarmony.ts`(TSD dict + Sub-V tritoneProb 表 — plugin 查表用)
- `af2-engine/music-theory/voicing.ts`(`assembleVoicing` + `placeVoicingMidi`)
- `af2-engine/music-theory/chord-types.ts`(`CHORD_TYPES` interval 表)

**Core**(orchestrator 主循环):
1. per step + look-ahead next
2. 调 plugin:`DynamicHarmonyDecorator.apply(step, next, mgStyle, rng)` → finalType / rootOffsetOverride / romanOverride
3. `assembleVoicing(finalType, rootKeyIndex, voicingMode)`(per-mgStyle FULL/ROOTLESS/CLUSTER/BLUES/SHELL + sub-style override)
4. `placeVoicingMidi(...)` → voice-leading + chord range placement
5. `spellPcInKey` / `midiToNoteInChord` → 拼写
6. 主循环结束后调 plugin:`VoicingSmoother.apply(out)` → 跨 chord smoothing post-pass

**2 Composer Plugin**:

| Plugin | 时机 | 行为 | PRNG |
|---|---|---|---|
| `DynamicHarmonyDecorator` | per step(在 assembleVoicing 前) | lockType ceremony / colorLevel roll / TSD dict lookup / Sub-V tritone substitution / data-debt guard | 'locked'(2-3 次 / step) |
| `VoicingSmoother` | 主循环后 post-pass | inversion candidates(原 + 4 个 octave-shift)+ phrase-arc bonus,选 min L1+arc cost | 'zero' |

**改 X 去哪改**:

| 改诉求 | 文件 |
|---|---|
| 改 chord-type decoration(TSD lookup / colorLevel / Sub-V) | `plugins/composer/DynamicHarmonyDecorator.ts` |
| 改 TSD 字典(per-mgStyle T/S/D rule + tritoneProb) | `DynamicHarmony.ts` `DYNAMIC_TSD_DICTIONARY` |
| 改 colorLevel 概率 | `DynamicHarmony.ts` `COLOR_LEVEL_PROBABILITIES` |
| 改 voice-leading smoother(R + S2 phrase-arc) | `plugins/composer/VoicingSmoother.ts` |
| 改 per-mgStyle 默认 voicing mode | `Af2Composer.ts` `DEFAULT_VOICING_MODE_BY_STYLE` |
| 改 per-sub-style voicing mode override | `Af2Composer.ts` `SUB_STYLE_VOICING_MODE` |
| 改 voicing pcs assembly(clash detection / density cap) | `music-theory/voicing.ts` `assembleVoicing` |
| 改 chord type interval 表 | `music-theory/chord-types.ts` `CHORD_TYPES` |

---

## 7. Layer 5:Dispatcher

**职责**:协调调用顺序,把 peers(其他 musicians 已 emit notes)传给后续 musician。

**主文件**:`af2-engine/Dispatcher.ts`。

**Core / Plugin 状态**:无 plugin(orchestrator pattern,调用顺序由 framework 决定)。

**调用顺序**(N6 重排,2026-05-24):**melody → bass → accomp → drums → pad**

**Peers 协议**:
- drums 消费 bass + accomp peers(kick-bass interlock + chord syncopate boost)
- accomp 消费 melody peers(给 chord-texture `CallAndResponse` family 用,通过 `MusicianPlanInput.melodyPeerNotes` 注入)
- melody / bass / pad 当前**不**消费 peers(预留)

**改 X 去哪改**:

| 改诉求 | 文件 |
|---|---|
| 改调用顺序 | `Af2EngineFacade.ts` 内构造 `steps` 数组 |
| 加新 musician 消费 peers | `Conductor.ts` `MusicianPlanInput` 加字段 + Dispatcher 注入 + idiom 消费 |

---

## 8. Layer 6:乐手 Idiom(4 musician)

### 8.1 PianoIdiom + MelodyGen 6 plugin + AccompGen 3 plugin

**Piano 入口**:`af2-engine/instruments/PianoIdiom.ts`(planMelody / planAccomp / planBass 三 method;调下面 Gen 模块)。

**Melody orchestrator**:`af2-engine/Af2MelodyGen.ts`
- Core:chord ctx 构建 / role gate / chord-tone cycle `[root, 5, 3, 7]` / placeNearAnchor / 主循环

**Melody 6 plugin**(`plugins/melody/`,全 'zero' PRNG):

| Plugin | 行为 |
|---|---|
| `RhythmPatternPicker` | per-mgStyle rhythm pool(4 pattern)+ persona sparsity/syncopation 加权 |
| `PhraseContourShaper` | per-sectionType MIDI bias(Verse arch / Chorus 上行 / Bridge+Outro 下行) |
| `PassingToneSelector` | chromatic passing 50% gate + evaluator-driven diatonic-aware 选音 |
| `PhraseEndingDecider` | section 末 chord(progress >= 0.95)短 pickup + 长 tonic 收音 |
| `SparsityGate` | per-slot 删音(sparsity * 0.4 上限) |
| `VelocityHumanizer` | per-slot velocity dynamicRange 浮动(jitter ±50%) |

**Accomp orchestrator**:`af2-engine/Af2AccompGen.ts`
- Core:persona 消费 / `pickTextureType`(phrase-lock + energy-filter + songBase variation) / per-chord melody peers NoteEvent 转换 / ChordTextureEngine dispatch / velocity persona 重映射

**Accomp 3 post-pass plugin**(`plugins/accomp/`,全 'zero' PRNG,链式调用):

| # | Plugin | 行为 |
|---|---|---|
| 1 | `MelodyDensityDucker`(T) | melody 密 → accomp ×0.6,melody 稀 → ×1.15(对话感) |
| 2 | `SwingApplier`(Z1b) | per-mgStyle 直拍 8th and swing(JAZZ/BLUES 0.66,POP/RNB 0.50 identity 跳过) |
| 3 | `MicroTimingHumanizer`(U) | 同 onset cluster pitch-升序 strum micro-delay(0.008 beat) |

**Chord-texture**:`af2-engine/chord-texture/` — 24 family + ChordTextureEngine dispatcher。AccompGen pickTextureType 决定 textureType → ChordTextureEngine 路由到对应 family。

**Piano 改 X 去哪改**:

| 改诉求 | 文件 |
|---|---|
| Melody 节奏 pattern(per mgStyle) | `plugins/melody/RhythmPatternPicker.ts` `RHYTHM_PATTERNS_BY_STYLE` |
| Melody phrase contour | `plugins/melody/PhraseContourShaper.ts` |
| Melody chord-tone cycle | `Af2MelodyGen.ts` 主循环 cyclePcs 构造(core) |
| Melody passing tone | `plugins/melody/PassingToneSelector.ts` |
| Melody phrase ending | `plugins/melody/PhraseEndingDecider.ts` |
| Melody sparsity / velocity | `plugins/melody/{SparsityGate,VelocityHumanizer}.ts` |
| Accomp textureType 池 | `Af2AccompGen.ts` `STYLE_TEXTURE_POOL` |
| Accomp persona 加权 | `Af2AccompGen.ts` `pickTextureType` 内 sparsity/syncopation gate |
| Accomp 演绎 family(24 个) | `chord-texture/families/*.ts`(不要在 AccompGen 重实装) |
| Accomp textureType → family 映射 | `chord-texture/TextureTypeMapping.ts` `TEXTURE_MAPPING` |
| Accomp post-pass(duck/swing/micro) | `plugins/accomp/*.ts` |
| add11 物理触发 | `PianoIdiom.applyAdd11HandPhysics` |
| 钢琴主区 / 越界自然感 | `PianoIdiom.PIANO_REGIONS` + `applyRegionProbability` |

### 8.2 BassIdiom(原子,不拆 plugin)

**主文件**:`af2-engine/instruments/BassIdiom.ts`(254 行紧凑)。

**职责**:Walking + 节奏修饰(swing / accents / velocity jitter)。

**改 X 去哪改**:

| 改诉求 | 文件 |
|---|---|
| Walking pattern(HalfNote / LatinTumbao / Stride 等) | `data/BassWalkPatterns.ts` `WALK_PATTERNS` |
| Per-mgStyle 默认 walking | `BassIdiom.ts` `DEFAULT_WALK_PATTERN_BY_STYLE` |
| Swing 比例 | `BassIdiom.ts` `SWING_RATIO_BY_PATTERN` |
| Dynamic accent(down/off-beat) | `BassIdiom.ts` `ACCENT_DOWN` / `ACCENT_OFF` |
| 物理音域 / anchor | `BassIdiom.ts` `BASS_INSTRUMENT_SPEC` + `BASS_ANCHOR_MIDI` |
| musician 卡 walkPattern 偏好 | `MusicianRegistry.ts` `persona.walkPatternId` |

### 8.3 DrumIdiom + 3 Modifier + 5 Override

**主文件**:`af2-engine/instruments/DrumIdiom.ts`(176 行 orchestrator)+ `plugins/drum/`(8 plugin + types + constants + index)。

**Core**(orchestrator):per-section role gate + per-step PRNG 3 gate + 命中时 velocity 抽样 + base hit + emit。

**3 Modifier**(pre-PRNG,顺序敏感):

| # | Plugin | 行为 |
|---|---|---|
| 1 | `PersonaSparsity` | 全 probs × (1 - sparsity * 0.4) |
| 2 | `CrossTrackModifier` | bass strong → kick floor 0.75 / chord syncopate → snare × 1.3 |
| 3 | `PersonaSyncopation` | 16th off-beat(relStep 1/3)→ snare + sync*0.3 |

**5 Override**(post-PRNG,前 4 互斥 + 第 5 独立):

| # | Plugin | 触发 | Layer |
|---|---|---|---|
| 1 | `BreakOverride` | next Drop + 末 1/4 bar | 互斥(优先级最高) |
| 2 | `CrashOverride` | 段首 + crash section/高能 | 互斥 |
| 3 | `FillOverride` | section transition 末 1 bar(5 per-mgStyle 形态) | 互斥 |
| 4 | `RideOverride` | very high(>=8) + 偶数 step + hihat | 互斥(末位) |
| 5 | `OpenHihatOverride` | 高能(>=7) + and-of-4 + hihat | **独立**(可叠加 Ride) |

**PRNG**:全 'zero'(plugin 不碰 rng)。每 step 3 gate + 命中 velocity 全在 orchestrator,**保 D-5 锁帧**(拔某 plugin → PRNG stream 不变)。

**Drum 改 X 去哪改**:

| 改诉求 | 文件 |
|---|---|
| Per-mgStyle drum grid | `instruments/drum-grid/grids/{Pop,Jazz,Blues,Rnb}.ts` |
| GM Drum Map 键位常量 | `plugins/drum/constants.ts`(DRUM_KICK / SNARE / etc) |
| Modifier(persona / cross-track) | `plugins/drum/{PersonaSparsity,CrossTrackModifier,PersonaSyncopation}.ts` |
| Override(break / crash / fill / ride / open hihat) | `plugins/drum/{Break,Crash,Fill,Ride,OpenHihat}Override.ts` |
| Modifier / Override 链顺序 | `plugins/drum/index.ts` `DEFAULT_DRUM_MODIFIERS` / `EXCLUSIVE_DRUM_OVERRIDES` / `INDEPENDENT_DRUM_OVERRIDES` |
| Per-mgStyle swing 比例 | `DrumIdiom.ts` `SWING_RATIO_BY_STYLE` |
| Per-mgStyle fill 形态池 | `plugins/drum/FillOverride.ts` `FILL_STYLES_BY_STYLE` |

### 8.4 PadIdiom(原子,不拆 plugin)

**主文件**:`af2-engine/instruments/PadIdiom.ts`(308 行紧凑)。

**职责**:Voicing slice(Low/Mid/High pad)+ attack pre-roll + BuildUp velocity ramp + atmosphere overrides。

**改 X 去哪改**:

| 改诉求 | 文件 |
|---|---|
| Voicing slice per-sectionType 偏好 | `PadIdiom.ts` `SECTION_SLICE_POOL` |
| Attack pre-roll | `PadIdiom.ts` `attackPreRoll` |
| BuildUp velocity ramp | `PadIdiom.ts` plan() BuildUp 分支 |
| Pad 音域 / 中心区 | `PadIdiom.ts` `PAD_INSTRUMENT_SPEC` + `PAD_CENTER_LO/HI` |
| Persona colorBias 加权 | `PadIdiom.ts` `pickSliceMode` |
| musician 卡 atmosphereOverrides | `MusicianRegistry.ts` `personnel.atmosphereOverrides`(5 字段) |

---

## 9. Layer 7:Reconciler

**职责**:跨乐手协调 + events 后处理(velocity 调整)。无 core,纯 plugin 集合。

**主文件**:`af2-engine/plugins/reconciler/`(3 plugin + types + index)。

**3 Plugin**(全 'zero' PRNG,velocity-only 改写,链式调用):

| # | Plugin | 行为 |
|---|---|---|
| 1 | `EnergyHumanizer`(v1.0) | 段落能量驱动 velocity(energy 1→×0.70 / 5→×1.00 / 10→×1.10) |
| 2 | `CollisionDamper`(v1.1) | accomp 撞 bass(<60)或 melody(≥60)同 PC + 同 onset → ×0.5 |
| 3 | `DropBuildupDynamics`(v1.2) | Drop 段(energy<3)kind-specific 缩放 + BuildUp 末 1 bar velocity ramp |

**调用顺序**(Facade Step 5.5-5.7):
- melody / bass / accomp 各跑 EnergyHumanizer
- 只 accomp 跑 CollisionDamper(看 bass + melody peers)
- melody / bass / accomp / pad 各跑 DropBuildupDynamics(per-kind 表)
- **drums 跳过**(DrumIdiom 内部已带 energy 缩放 + BuildUp Fill)

**改 X 去哪改**:

| 改诉求 | 文件 |
|---|---|
| Energy → velocity 缩放曲线 | `plugins/reconciler/EnergyHumanizer.ts` `ENERGY_VEL_SCALE` |
| 撞音检测窗口 / damp factor | `plugins/reconciler/CollisionDamper.ts` `DUCK_WINDOW` / `DAMP_FACTOR` |
| Drop / BuildUp per-kind 缩放 | `plugins/reconciler/DropBuildupDynamics.ts` `DYNAMICS_TABLE` |
| 加新 reconciler plugin | 新建 `plugins/reconciler/Xxx.ts` + 加入 `index.ts` `RECONCILER_PLUGINS` |

---

## 10. Layer 8:GM128 装配

**职责**:决定每个 musician 用 GM 程式号几号。

**主文件**:`Af2EngineFacade.ts` Step 6b + `data/GMSoundMap.ts`。

**Core / Plugin 状态**:无 plugin(thin priority chain)。

**优先级链**(高到低):
1. `forcedGmPrograms[role]`(`PipelineRunOptions` 字段,user 强制)
2. `musician.gmProgramOverride`(musician 卡显式)
3. `musician.defaultSound`(musician 卡默认音色名 → GMSoundMap 查表)
4. AF2 idiom 默认(per BandRole 兜底)

**改 X 去哪改**:

| 改诉求 | 文件 |
|---|---|
| 改 GM 程式号兜底 | `data/GMSoundMap.ts` |
| 改 GM Drum Map 键位 | `plugins/drum/constants.ts`(慎改 — GM 标准)|
| 改 Channel 路由 | `audio/MidiConverter.ts` |

---

## 11. plugins/ 目录映射

```
src/core/generation/af2-engine/plugins/
├─ conductor/          5 RoleFilter + types + index
│  ├─ types.ts                      RoleFilter / RoleFilterContext / SectionFilterContext +
│  │                                buildSectionContext / buildRoleFilterContext + CONTINUITY_K_MARGIN
│  ├─ WakeKGate.ts / PeakKGate.ts / StyleTemplateFilter.ts /
│  ├─ EnergyFilter.ts / MusicianPrefFilter.ts
│  └─ index.ts                      DEFAULT_ROLE_FILTERS 数组
│
├─ arranger/           4 ProgressionPlanner + types + index
│  ├─ types.ts                      ProgressionPlanner / Context 协议
│  ├─ BorrowChordPlannerPlugin.ts / PicardyPlannerPlugin.ts /
│  ├─ MinorBorrowPlannerPlugin.ts / TonicizationPlannerPlugin.ts
│  └─ index.ts                      DEFAULT_PROGRESSION_PLANNERS 数组
│
├─ composer/           2 plugin + types + index
│  ├─ types.ts                      ComposerPluginMeta + DecorateResult
│  ├─ DynamicHarmonyDecorator.ts    chord-type decoration('locked' 2-3 PRNG)
│  ├─ VoicingSmoother.ts            R+S2 post-pass voice leading
│  └─ index.ts
│
├─ melody/             6 plugin + types + index
│  ├─ types.ts                      MelodyPluginMeta
│  ├─ RhythmPatternPicker.ts / PhraseContourShaper.ts /
│  ├─ PassingToneSelector.ts / PhraseEndingDecider.ts /
│  ├─ SparsityGate.ts / VelocityHumanizer.ts
│  └─ index.ts
│
├─ accomp/             3 post-pass + types + index
│  ├─ types.ts                      AccompPluginMeta
│  ├─ MelodyDensityDucker.ts / SwingApplier.ts / MicroTimingHumanizer.ts
│  └─ index.ts
│
├─ drum/               3 Modifier + 5 Override + types + constants + index
│  ├─ types.ts                      DrumPluginMeta + Modifier / Override 协议 +
│  │                                DrumProbs / DrumHitState / Context
│  ├─ constants.ts                  GM Drum Map 物理键位(KICK/SNARE/CRASH/etc)
│  ├─ PersonaSparsity.ts / CrossTrackModifier.ts / PersonaSyncopation.ts
│  ├─ BreakOverride.ts / CrashOverride.ts / FillOverride.ts /
│  ├─ RideOverride.ts / OpenHihatOverride.ts
│  └─ index.ts                      DEFAULT_DRUM_MODIFIERS / EXCLUSIVE_DRUM_OVERRIDES /
│                                   INDEPENDENT_DRUM_OVERRIDES
│
└─ reconciler/         3 plugin + types + index
   ├─ types.ts                      ReconcilerPluginMeta
   ├─ EnergyHumanizer.ts / CollisionDamper.ts / DropBuildupDynamics.ts
   └─ index.ts                      RECONCILER_PLUGINS(元数据数组)
```

**所有 plugin 元数据共同字段**:`{ name, version, prngConsumption, description }`。
`prngConsumption ∈ { 'zero', 'locked', 'forked' }`(见 §2.2)。

---

## 12. 跨模块同步登记表(改 X 必须改 Y)

12 类关联组,改前 grep 验证,改后逐项核对。

| # | 触发 | 必须同步 |
|---|---|---|
| 1 | 改 `PipelineRunOptions` 字段 | 3 app(PipelineMonitor / EndlessRadioManager / JamSessionManager)+ App API 文档 |
| 2 | 改 `MusicianPlanInput` 字段 | 6 plan() 消费方(PianoIdiom.planMelody/Accomp/Bass + BassIdiom + DrumIdiom + PadIdiom)+ Af2MelodyGen.generateAf2Melody + Af2AccompGen.generateAf2Accomp + Dispatcher 注入 + Facade Step 4.1+5 装配 |
| 3 | 改 `SectionType` enum 数值或新增 | Conductor template 各 variant + Arranger 池(Major + Minor + sub-style)+ AccompGen `STYLE_TEXTURE_POOL` + MelodyGen `phraseContourBias` per-sectionType + PadIdiom `SECTION_SLICE_POOL` + SectionPlanner |
| 4 | 改 `ChordQuality` enum 或新 quality | Composer `MG_TYPE_TO_QUALITY` + DynamicHarmony `DYNAMIC_TSD_DICTIONARY` per-quality 字段 + MelodyGen `thirdInterval`/`fifthInterval`/`seventhInterval` + BassIdiom `thirdInterval`/`fifthInterval` + `chord-types.ts` `CHORD_TYPES` |
| 5 | 改 `MgStyle` union 或新 mgStyle | Arranger `SECTION_POOLS_BY_STYLE` + BorrowChord/Tonicize/MinorBorrow/Picardy 4 planner per-style 概率 + DynamicHarmony `DYNAMIC_TSD_DICTIONARY` + `COLOR_LEVEL_PROBABILITIES` + Composer `DEFAULT_VOICING_MODE_BY_STYLE` + Conductor template variants + drum-grid + AccompGen `STYLE_TEXTURE_POOL` + `SubStyleTextures.SUB_STYLES_BY_MG` + MelodyGen `RHYTHM_PATTERNS_BY_STYLE` + BassIdiom `DEFAULT_WALK_PATTERN_BY_STYLE` + DrumIdiom `SWING_RATIO_BY_STYLE` + FillOverride `FILL_STYLES_BY_STYLE` + Reconciler `ACCOMP_SWING_BY_STYLE` + MgKernelInvoker `MG_STYLE_BARS` / `BPM` + Facade `MG_STYLE_TO_AF_STYLE` |
| 6 | 改 `BandRole` enum 或新 role | Conductor `Band` + `buildDefaultByMusician` + SlotRouter + MusicianRegistry `eligibleRoles` + MidiConverter channel 分配 + GMSoundMap `bandRoleToTrackKeys` + BandSelectionStore type + App API 文档 |
| 7 | 改 `WalkPatternId` enum 或新 walking | `data/BassWalkPatterns.ts` `WALK_PATTERNS` 数组(索引 = enum 数值)+ `BassIdiom.ts` `SWING_RATIO_BY_PATTERN` 表 |
| 8 | 改 `Af2MusicianOverrides` 接口字段 | PianoIdiom(读 regions/escape/add11Gate/algorithm)+ BassIdiom(via Conductor 转 SectionAssignment)+ PadGenerator(读 atmosphere)+ Conductor(读 sectionRolePreference)+ MusicianRegistry 注释 + §8 各乐器速查表 |
| 9 | 改 Conductor 5 RoleFilter 链 | `plugins/conductor/index.ts` `DEFAULT_ROLE_FILTERS` 数组 + musician 卡 persona 字段(wakeK/peakK/isApex)+ 加新 filter → 决定 apex bypass 语义 + 本文档 §4 同步 |
| 10 | 改 PRNG 消耗 / 改 hash gate ↔ rng.next() | 同 seed 不同输出 = 破 D-5。改前查 §2.2 "完全 deterministic"清单 + 改后全 mgStyle × 几个 seed 听感对账。'locked' plugin 必须保占位 rng.next() |
| 11 | 改 GM Drum Map / Channel 9 | `plugins/drum/constants.ts` + `audio/MidiConverter.ts` `CHANNEL_DRUMS=9` + §2.1 K-8 第三空间说明(基本不应改 — GM 标准) |
| 12 | 改 Dispatcher 调用顺序 | `Af2EngineFacade` 内 `steps` 数组顺序 + 验证 peers 依赖(当前:drums 读 bass+accomp peers / accomp 读 melody peers / 其他不读)+ §7 同步 |

---

## 13. 常用工作流速查

### 13.1 加新 plugin(任一 layer)

1. 在对应 `plugins/<layer>/` 创建 `XxxPlugin.ts` 文件
2. 实现 layer 的 plugin 协议(看该 layer types.ts 现有接口)
3. 明文标注 `prngConsumption`('zero' / 'locked' / 'forked')
4. 加入对应 `index.ts` 的 DEFAULT chain 数组(顺序敏感)
5. 验证 PRNG 隔离 — 跳过此 plugin 时主 stream 不变
6. lint + 听感对账 4 mgStyle

### 13.2 加新 musician 卡

1. `idioms/MusicianRegistry.ts` `MUSICIAN_POOL` 追加 musician 对象
2. 填 `eligibleRoles`(决定能上哪些 BandRole 槽位)
3. 填 `persona`(决定算法行为:sparsityTendency / syncopationAssault / dynamicRange / colorBias / wakeK / peakK / isApex 等)
4. 填 `af2Overrides`(per-instrument 行为覆盖)
5. 决定 `gmProgramOverride`(如有)
6. (可选)PipelineMonitor UI 中显式露出新卡 ID

### 13.3 加新 mgStyle

参见 §12 关联组 #5 — 共需同步 ~14 个文件。

### 13.4 加新 SectionType

参见 §12 关联组 #3 — 共需同步 ~6 个文件。

### 13.5 改 IR 字段

参见 §12 关联组 #2(MusicianPlanInput)/ §2.3(数据契约)。新字段**必须可选**。

### 13.6 加新 chord-texture family

1. `chord-texture/families/XxxFamily.ts` — 实装 NoteEvent[] 生成
2. `chord-texture/TextureTypeMapping.ts` — 加 textureType → family + params 映射
3. `chord-texture/ChordTextureEngine.ts` — switch 加 case
4. 若想用,加到 `Af2AccompGen.STYLE_TEXTURE_POOL` 某 mgStyle × sectionType 池
5. 若 cross-track 用 melody peers,需 `MusicianPlanInput.melodyPeerNotes` 透传

---

## 14. 反模式禁区

| ❌ 不要 | ✅ 替代 |
|---|---|
| App 直接 import `af2-engine/*` | 走 `runPipeline` 公开入口 |
| AbsoluteTransposer 之前给 pitch 加 `keyOffset` | 用 RELATIVE 空间,等 K-2 唯一加点 |
| `Math.random()` | `Random` class 或 `PRNGManager` |
| 在 Idiom 内做编排决策(role 分配 / 段落 selection) | 那是 Conductor / Arranger 职责 |
| 在 Dispatcher 内做 musician 算法 | 那是 Idiom 职责 |
| 在 Composer 内做 voicing 物理(placement / clash) | 走 `music-theory/voicing.ts` `placeVoicingMidi` |
| plugin 内消费 / 改主 PRNG 流(zero plugin) | 用 deterministic hash gate;若必须 PRNG → 改 plugin 协议为 'locked' 或 'forked' |
| 直接 mutate 输入 events 数组(plugin 协议) | 返回新数组(全部 reconciler / accomp post-pass / VoicingSmoother 一致) |
| 跳过 Dispatcher 直接拼 5 轨 | 走 Dispatcher.dispatchMusicians |
| 重建 `MelodyEngine` / `pipeline/HarmonyCore` / `primitives/*` / `mg-engine/*` | 已物理删除 — 不要复活 |
| 把 plugin 决策搬回 orchestrator | 保 plugin 独立性 — orchestrator 只做 PRNG ceremony + dispatch + emit |

---

## 15. 命名约定

| 后缀 | 语义 | 例子 |
|---|---|---|
| `*Idiom` | 乐器渲染器(class 或 const) | PianoIdiom / BassIdiom / DrumIdiom / PadIdiom |
| `*Generator` | musician 生成器(plan() 协议实现) | DrumGenerator / PadGenerator |
| `*Gen` | 算法 orchestrator(独立模块,被 Idiom 调) | Af2MelodyGen / Af2AccompGen |
| `Af2*` | AF2 自家命名(区别历史 AF/MG) | Af2Arranger / Af2Composer / Af2EngineFacade |
| `*Plugin` | plugin 文件(plugins/ 目录内) | DynamicHarmonyDecorator(没 Plugin 后缀)/ BorrowChordPlannerPlugin(有,因要与原 BorrowChordPlanner 算法区分) |
| `*Filter` / `*Modifier` / `*Override` / `*Gate` | plugin 子类型(更具体语义) | WakeKGate / PersonaSparsity / FillOverride |
| `*Planner` | 进行规划算法 | BorrowChordPlanner / TonicizationPlanner |
| `*Router` | 路由 | SlotRouter |
| `*Mapper` | 标注 / 映射 | SectionMapper |
| `*Reconciler` | 协调 / 调整 | (无,已拆为 plugin) |
| `*Conductor` | 编排决策 | DynamicConductor |
| `*Dispatcher` | 调用协调 | Dispatcher |
| `*Transposer` | 空间转换 | AbsoluteTransposer |
| `*Manager` | 全局可变状态(应少用) | PRNGManager |

---

## 16. App / 嵌入式 集成 API 契约

App 层 / 嵌入式只通过以下三个入口与引擎对话。**禁止**绕过它们直接调引擎内部模块。

### 16.1 三大公开入口

**(1)`PRNGManager.setSeed(seed: number)`** — 每次生成前必调。同 seed + 同 options → 同输出。

```ts
import { PRNGManager } from '../core/utils/PRNG';
PRNGManager.setSeed(42);
```

**(2)`runPipeline(options: PipelineRunOptions)`** — 一键生成。

```ts
import { runPipeline } from '../core/generation/pipeline';
const { track, context } = runPipeline({
    forcedStyleId: StyleId.ModernPop,
    forcedBand: { mainInst: 'alex_piano', bass: 'frank_bass', drums: 'dave_drums', atmosphere: 'nina_pad' },
    forcedGmPrograms: { mainInst: 0 },
});
```

- 返回 `{ track: GeneratedTrack, context: MusicContext }`
- `track.melody / accompaniment / bass / chords.voicing` 全部在 **RELATIVE** 空间
- 内部始终路由 `Af2EngineFacade.generate`

**(3)`AudioEngine.playSong(track, styleId, context)`** — 播放。

```ts
import { AudioEngine } from '../core/audio/AudioEngine';
AudioEngine.init();
await AudioEngine.playSong(track, context.style!.id, context);
```

- 内部走 `AbsoluteTransposer.arrange()`(K-2 唯一加 keyOffset 点)→ MidiConverter → PlaybackEngine
- async,Promise<void>
- 并发安全:快速连点 Play 只有最后一次会播

### 16.2 标准调用时序

```
App                           Engine
 │  setSeed(seed)              │
 │─────────────────────────────▶│  PRNGManager 锁状态
 │  runPipeline(options)       │
 │─────────────────────────────▶│  Af2EngineFacade.generate(8 层)
 │◀─────────────────────────────│  { track (RELATIVE), context }
 │  playSong(...)              │
 │─────────────────────────────▶│  K-2 → MidiConverter → PlaybackEngine
 │◀─────────────────────────────│  Promise resolves
 │  addVisualListener(...)     │
 │─────────────────────────────▶│  → VisualEvent (noteOn/noteOff/beat)
```

### 16.3 `PipelineRunOptions` 字段

| 字段 | 类型 | 含义 |
|---|---|---|
| `forcedStyleId` | `StyleId` | 强制曲风(ModernPop=0 / ChillJazz=1 / NeoSoul=2) |
| `allowedStyleIds` | `StyleId[]` | 允许 PRNG 抽取的池(`forcedStyleId` 提供时忽略) |
| `forcedBand` | `Partial<Record<BandRole, string \| null>>` | 强制乐队;value 是 musician ID 或 null(空槽) |
| `forcedGmPrograms` | `Partial<Record<BandRole, number>>` | per-role GM 程式覆盖(优先级最高) |
| `generation` | `GenerationOptions` | 进阶:`seed` / `length` / `userMotif` / `detectedTonality` / `detectedKey` (0-11)/ `detectedSubStyle` |

**BandRole 取值**:`'vocal' | 'mainInst' | 'accomp' | 'bass' | 'drums' | 'atmosphere'`

**MgStyle**(影响 AF2 内部):`'POP' | 'JAZZ' | 'BLUES' | 'RNB'`,通过 `EngineSelectionStore.setMgStyle()` 设置(不在 PipelineRunOptions)。

### 16.4 返回值结构

**`GeneratedTrack`(Pitch Space: RELATIVE)**:

```ts
{
  chords: GeneratedChord[];   // 全曲和弦(含 voicing,RELATIVE)
  melody: NoteData[];          // 主旋律(RELATIVE pitch)
  drums?: NoteData[];          // 鼓(GM Drum Map 第三空间,不参与 keyOffset)
  bpm: number;
  key: string;
  keyOffset: number;           // 0-11,K-2 之后加到 RELATIVE pitch
  tonality: Tonality;
  timeSignature: [number, number];
  sections: SectionMetadata[];
  accompaniment?: NoteData[];
  bass?: NoteData[];
  atmosphere?: NoteData[];
}
```

⚠️ **NoteData.pitch ∈ RELATIVE 空间**;App 层禁止自己加 keyOffset。

**`MusicContext`**:`{ keyOffset, tonality, bpm, timeSignature, ensemble?, style?, band?, gmProgramOverrides? }`。`playSong()` 需要原样传回。

### 16.5 AudioEngine API 速查

```ts
// 播放控制
AudioEngine.init()
AudioEngine.playSong(track, styleId, context)  // 注:无 generator 参数
AudioEngine.stop()
AudioEngine.getCurrentBeat() / getBpm() / getDuration()

// Channel / Part 静音
AudioEngine.muteChannel(channelNum, mute)
AudioEngine.isChannelMuted(channelNum)
AudioEngine.setPartMute(partName, mute)
AudioEngine.getPartChannels()

// Visual 订阅
AudioEngine.addVisualListener(listener)       // 已 mute 过滤
AudioEngine.addRawVisualListener(listener)    // 未过滤
AudioEngine.removeVisualListener / removeRawVisualListener
AudioEngine.setVisualsMode('all' | 'gameplay-only')

// 运行时 MIDI 注入(进阶)
AudioEngine.injectMidiEvent(ev)
AudioEngine.getChannelEvents(channel)
AudioEngine.replaceChannelEvents(channel, startTick, newEvents, endTick?)

// 实时演奏(当前 NO-OP,未来 Live mode 实装)
AudioEngine.playNote / noteOn / noteOff / pitchBend
```

### 16.6 嵌入式 C 端 IR 契约

**当前状态**:旧 golden seed baseline 已废,C 端 sync 工具链待重建。

**IR struct 承诺**:

```c
struct NoteData {
    uint8_t pitch;       // 0-127
    uint8_t velocity;    // 0-127 (TS 端 0.0-1.0 float 折算)
    float onset;         // Beat position
    float duration;      // Beat length
    uint8_t flags;       // optional flags 打包
};

struct GeneratedChord {
    uint8_t root;        // pc 0-11
    uint8_t quality;     // ChordQuality enum
    float startBeat / endBeat;
    uint8_t voicing[7];  // RELATIVE 空间,最多 7 音
    uint8_t voicingLen;
};

struct SectionMetadata {
    char name[16];
    float startBeat / endBeat;
    uint8_t energyLevel;
    uint8_t sectionType;
};
```

改 IR 字段时:同步 TS `ir/index.ts` / `types.ts` + C struct + 重建听感 baseline。

### 16.7 错误处理 + 常见 pitfall

```ts
try {
    PRNGManager.setSeed(seed);
    const { track, context } = runPipeline(options);
    await AudioEngine.playSong(track, context.style!.id, context);
} catch (e) {
    if (e instanceof Error) console.error('Pipeline failed:', e.message);
}
```

| Pitfall | 后果 |
|---|---|
| 忘 setSeed | 输出非确定性 |
| `forcedStyleId` 越界 | throw |
| `forcedBand` musician ID 拼错 | musician not found(fallback / silent) |
| 在 SF2 加载前调 playSong | 内部 `await startAudioContext()` 已处理,但 UI 建议加 Loading |
| 依赖 `playNote` / `noteOn` 实时演奏 | 当前 NO-OP,等 Live mode |

### 16.8 App 层禁止事项

- ❌ import `from '../core/generation/af2-engine/*'`(除 utility 类型外)
- ❌ import `from '../core/generation/pipeline/*'`(除 `pipeline/index.ts` 的 `runPipeline`)
- ❌ 绕过 AbsoluteTransposer 自己加 keyOffset(K-2 铁律)
- ❌ 修改 `track.chords[i].voicing` / `track.melody[i].pitch`(Composer / MelodyGen 决定)
- ❌ 自己实现 voicing / 织体 / casting(引擎职责)
- ❌ 跳过 setSeed 直接 runPipeline(非确定输出)
- ❌ playSong 期间改 currentArrangedTrack(无效)
- ❌ 依赖实时演奏 API(当前 NO-OP)
- ❌ 重建 `MelodyEngine` / 任何已删模块

---

## 附录:验证 SOP

每次 commit 前:

```bash
npm run lint           # tsc --noEmit 必过
```

听感测试:Pop / Jazz / NeoSoul / Blues 各 seed 至少一遍。
原 golden seed 系统已废,如需 bit-exact 对账请自行决定新 baseline 方案。

**架构重构(改 plugin / 拆 plugin)后的额外验收**:
- 同 seed bit-exact 对账(算法搬运的)
- PRNG 流不变验证(grep `rng.next()` / `rng.pick()` 调用顺序)
- 4 mgStyle 各听 1-2 个 seed
