# AF2 架构设计 v1.1

> **状态**:Phase 1 实装完成 + bit-exact 验收通过。
> Phase 2 启动前再审视一次,届时视情况升 v2.0。
>
> 本文件与 `README.md`(融合原则)互补。
> 任何 AF2 PR 与本文件冲突时,优先更新本文件再实装。

---

## §1 设计原则(简要引用,详见 README.md)

- **mg 核心算法是真理之源**:和声进行 / voicing / topline / chord 演绎 / melody 演绎 → 同 seed bit-exact = MG 模式
- **AF 可干预白名单**:段落骨架标注 / 能量曲线 / 乐器分配(渲染必须忠实 mg)
- **乐理冲突 → mg 优先**

## §2 关键硬约束(从 mg 现状推出,不可绕过)

### §2.1 mg 输出小节数固定

- BLUES → **12** bars(传统 12-bar blues)
- POP / JAZZ / RNB → **16** bars
- 由 `STYLE_DICTIONARY[style].recommendedBars` 决定,`bars` 已从公开 API 移除(`musicEngine.ts:350-356`)

**含义**:AF 段落骨架的"总小节数" = mg.recommendedBars,**不能反向要求** mg 跑更多。

### §2.2 mg 输出 3 个 part

`MusicTimeline.events: NoteEvent[]` 每个事件带 `part` 字段:
- `'melody'` — mg 的主旋律线(线性单声部,带 motif / lick)
- `'chord'`  — mg 的伴奏 chord(comping voicing)
- `'bass'`   — mg 的 bass line(walking / pedal / 等 pattern)

**含义**:AF2 槽位路由就是把这 3 个 part 分发给对应槽位的 musician。

### §2.3 mg 内部已有"全局故事曲线"

`ResolvedGenerationContext` 包含:emotion / mode / tonalCharacter / motifStrategy / 等。
`generateArrangement` 内部还有 apex bar 规划(`musicEngine.ts:1834+`)、tension 起伏。

**含义**:AF 段落骨架不能尝试"驱动" mg 的能量曲线 —— 那是 mg 自己的事,AF 标段落仅供 UI/视觉呈现,**不喂回 mg**。

### §2.4 mg 已绝对化 MIDI

`ChordDef.notesMidi` / `NoteEvent.noteNumber` 都是绝对 MIDI(C 调,直接可播)。

**含义**:AF2 沿用 `MgEngineFacade` 当前策略 — `keyOffset=0` + `AbsoluteTransposer` 等价 pass-through,K-2 不破。

---

## §3 三层架构的 AF2 落地

### §3.1 层 1:世界规则库

| 子层 | Phase 1 实现 | 后期 |
|------|-------------|------|
| MusicTheory(度量衡 / TSD / 和弦 / 调式) | 用 `mg-engine/musicTheory.ts` 作为真理之源 | AF 的 `types.ts` 与之冲突时让位 |
| 风格库(BPM / 和声 pool / motifs) | 用 `mg-engine/styleDictionary.ts` | — |
| Bass / Rhythm 规则 | 用 `mg-engine/basslineRules.ts` + `rhythmPattern.ts` | — |
| **乐器 idiom**(物理实质 / 音域 / 槽位限制) | **AF2 新建**,mg 没有 | 拓展 |
| 乐句 / base grammar | `styleDictionary.motifs` 挂 style | persona.signature 待定 |

### §3.2 层 2:乐队 Engine — 6 槽位

| 槽位 | mg 来源 | Phase 1 | Phase 2+ |
|------|---------|---------|---------|
| **Vocal** | (无) | 强制空 | 单独旋律生成器 |
| **MainInst** | `part='melody'` | ✅ 接 | — |
| **Accomp** | `part='chord'` | ✅ 接 | — |
| **Atmosphere** | (无) | 强制空 | AF DrumIdiom/AtmosphereRenderer 改造 |
| **Bass** | `part='bass'` | ✅ 接 | — |
| **Drums** | (无) | 强制空 | 同上 |

槽位允许性由 `Instrument.eligibleSlots` 声明(如:钢琴可放 MainInst/Accomp/Bass;萨克斯只能 MainInst/Accomp;鼓只能 Drums)。

每槽位的 musician 有 3 参数:**Style + Instrument + Persona**(Persona 含 articulation 偏好 / signature licks / 表演特征,**不得干涉 mg 算法**)。

### §3.3 层 3:音乐生成 Engine — 主管线

```
┌─ Step 1: AF 段落骨架 ──────────────────────────────────────┐
│  SectionPlanner.plan(styleName, prng) → SectionMetadata[] │
│    - 总小节 = mg.recommendedBars(12/16,硬约束)            │
│    - 段落分布(Intro/Verse/Chorus/Bridge/Outro)由 AF PRNG  │
│      抽 structureTemplate,但模板的"小节数总和"必须 = 12/16│
│    - energyLevel 由 AF 自行决定,**不喂回 mg**             │
└───────────────────────────────────────────────────────────┘
        ↓ SectionMetadata[] (仅供下游标注,不影响 mg)
┌─ Step 2: mg 内核调用 ──────────────────────────────────────┐
│  MgKernelInvoker.invoke(seed, styleName, key)             │
│    - PRNG 隔离:用 mg.Random(seedString)                  │
│    - 调 Engine.generateProgressions → ChordDef[]          │
│    - 调 Engine.generateArrangement → MusicTimeline        │
│    - 返回 { chords, events }(原样,不动)                  │
└───────────────────────────────────────────────────────────┘
        ↓ { chords: ChordDef[], events: NoteEvent[] }
┌─ Step 3: 段落映射(只读切片) ──────────────────────────────┐
│  SectionMapper.assignSections(events, sections)           │
│    - 给每个 event 标注它属于哪个段落(基于 onset)            │
│    - 不改 event.pitch / onset / duration / velocity        │
│    - 输出 events 携带 sectionIdx 标记                      │
└───────────────────────────────────────────────────────────┘
        ↓ events with sectionIdx
┌─ Step 4: 槽位路由 ─────────────────────────────────────────┐
│  SlotRouter.route(events, bandPlan)                       │
│    - events where part='melody' → bandPlan[MainInst]      │
│    - events where part='chord'  → bandPlan[Accomp]        │
│    - events where part='bass'   → bandPlan[Bass]          │
│    - 槽位空 → 该 part 直接丢弃(乐手缺席,该路声音消失)     │
└───────────────────────────────────────────────────────────┘
        ↓ Map<slot, NoteData[]>
┌─ Step 5: Realizer(忠实 mg) ───────────────────────────────┐
│  for slot in [MainInst, Accomp, Bass]:                    │
│    musician = bandPlan[slot]                              │
│    if musician?.instrument === 'Piano':                   │
│       PianoRealizer.realize(notes)  ← 直通,等价 mg 输出   │
│    else if musician?.instrument === 'Saxophone':          │
│       SaxRealizer.realize(notes)    ← Phase 2,加 articulation
│                                       但禁止改 pitch/onset │
│    ...                                                    │
│  铁律:Realizer 只能在 NoteData 上加 articulation 字段      │
│         (slideIn / breath / vibrato),禁止改 pitch / onset │
│         / duration / velocity 主字段                       │
└───────────────────────────────────────────────────────────┘
        ↓ NoteData[] per slot
┌─ Step 6: 装配 GeneratedTrack + MusicContext ──────────────┐
│  与 MgEngineFacade 输出同形状,                             │
│  下游 AbsoluteTransposer / MidiConverter 零改动            │
└───────────────────────────────────────────────────────────┘
```

---

## §4 与 AF 现有模块的关系(谁留谁走)

### §4.1 保留可用(AF2 直接复用)

| 模块 | 用途 |
|------|------|
| `FractalStructureEngine` | 段落骨架生成 — 但需改造为"总小节受 mg 限制"版本(写新模块 `SectionPlanner`,不动 AF 原版) |
| `AbsoluteTransposer` | K-2 唯一加 keyOffset 点 — AF2 路径下 keyOffset=0,等价 pass-through |
| `MidiConverter` / `PlaybackEngine` / `AudioEngine` | 无影响,下游照常 |
| `config/styles/structureTemplates` | 段落模板池 — 但要筛选"小节数总和 = 12/16"的模板;不符合的过滤掉或新建 mg 专用模板池 |

### §4.2 禁用(违反 mg 优先原则)

| 模块 | 为什么不用 |
|------|----------|
| `HarmonyCore` / `MacroProgressionEngine` | mg 自己做和声进行 |
| `CastingEngine` / `MoodRouter` | mg 不做"casting" 决策,AF2 槽位路由是另一回事(简单 part→slot 映射) |
| `VoicingProcessor` | mg 已有 voicing,不可干预 |
| `Conductor` / `Reconciler` | mg 已自行处理跨乐器(chord/bass/melody 一体生成),AF Reconciler 没用武之地 |
| `ToplineEngine` | mg 自己做 topline |
| `PianoAccompIdiom` / `BassIdiom` / `DrumIdiom` / `AtmosphereRenderer` | Phase 1 全部不用;Phase 2+ Drum/Atmosphere 可能复活(见 §6 Q3) |

### §4.3 中间状态(Phase 1 后再评估)

| 模块 | 状态 |
|------|------|
| `CurveWeatherSampler`(5 维气象) | Phase 1 不用;AF 段落能量直传 SectionMetadata 即可 |
| `WakeStateMachine` / `MarkovStateMachine` | Phase 1 不用 |
| `ImprovisationStrategy`(Solo) | 不用;mg 自己生成 melody = solo |
| `GrooveHumanizer` | Phase 1 可选(mg 自带 swing / accent),不接 |

---

## §5 文件布局(Phase 1)

```
src/core/generation/af2-engine/
├── Af2EngineFacade.ts        # 主入口(替换当前 stub)
├── MgKernelInvoker.ts        # 调 mg.Engine + PRNG 隔离 + 类型转换
│                             # (现 MgEngineFacade 内部代码抽公共部分到这里)
├── SectionPlanner.ts         # AF 段落骨架(适配 mg 固定长度)
├── SectionMapper.ts          # 按段落给 mg events 打标(只读)
├── SlotRouter.ts             # 6 槽位路由(part → musician)
├── realizers/
│   ├── PianoRealizer.ts      # Phase 1 直通钢琴
│   └── (后期 SaxRealizer / ViolinRealizer / DrumRealizer)
├── README.md                 # 已存在 — 融合原则
└── ARCHITECTURE.md           # 本文件
```

**乐器 idiom 目录**(已决 §6 Q2):**B. `src/core/generation/af2-engine/instruments/`**(AF2 私有)。

Phase 1 只需 `PianoIdiom.ts`(直通);Phase 2+ 加 SaxIdiom / ViolinIdiom 等时按本目录扩展。

---

## §6 已决策(2026-05-21 用户拍板)

### Q1:全曲长度 → **A. 接受短曲**(Phase 1)

Phase 1 AF2 一次生成 = mg.recommendedBars(12/16 小节),与 mg-standalone 一致。
段落标注是"袖珍"版(如 Intro 2 + Verse 6 + Chorus 6 + Outro 2 = 16)。

Phase 1 完成后听感评估,若需"完整长曲"再讨论拼接方案。

**Phase 1 实装影响**:
- `SectionPlanner` 仅需从 AF 现有 `structureTemplates` 池筛选"小节数总和 = 12/16"的模板
- 若 AF 现有模板没有完美匹配的,新建 mg 专用模板池(`config/af2-section-templates.ts`)

### Q2:乐器 idiom 目录组织 → **B. `af2-engine/instruments/`**(AF2 私有)

Phase 1 只建 1 个文件:`af2-engine/instruments/PianoIdiom.ts`(直通钢琴)。
Phase 2+ 加新乐器时按本目录扩展(SaxIdiom / ViolinIdiom / DrumIdiom 等)。

**留下的后续讨论**:Phase N(AF/MG 删除后)若乐器 idiom 跨引擎复用,再考虑提升到顶层 `src/core/generation/instruments/`。

### Q3:Drums / Atmosphere / Vocal 槽位 → **C. 渐进式**

- **Phase 1**:Vocal / Atmosphere / Drums 槽位**强制空**(BandSelectionPanel 在 AF2 模式下 disable 这 3 个槽位 的选择,或选了也无声)
- **Phase 2+**:听用户对 Phase 1 的听感反馈再评估:
  - 若用户接受短曲 + 无鼓 → 不补
  - 若用户觉得缺少节奏感 → 评估"AF DrumIdiom 剥离 5 维气象上下文,接收 mg melody/bass 作为驱动信号"的可行性
  - Atmosphere / Vocal 同样延后

**Phase 1 实装影响**:
- `SlotRouter` 只处理 MainInst / Accomp / Bass 三槽位,其他 3 槽位输出空数组
- UI 端 `BandSelectionPanel` 在 `engine === 'AF2'` 时,这 3 槽位的下拉灰显

---

## §7 PRNG 策略(已定 v1.1,2026-05-21 修正)

Phase 1+2:**mg 用 mg.Random 隔离,seedString 与 MG 模式完全相同(`mg_*`)**。

理由(融合原则):
- 用户硬约束:"同一种子,AF2 = MG 的和声进行/chord/melody"
- 不同 seedString 会导致 mg.Random 完全不同的 PRNG 序列,违反约束
- "用户混淆"问题不存在 — 切换引擎听同 seed 时,MG 和 AF2 一致(都是 mg 内核)
  是**预期行为**,AF 和 MG/AF2 不同才是预期行为

具体:
- `MgKernelInvoker.invoke()` 接收 seedString,内部 `new Random(seedString)`
- AF2 调用方(Af2EngineFacade)传 `mg_${auraflowSeed}` — 与 MgEngineFacade 完全一致
- AF 端(`SectionPlanner` 等)走 `PRNGManager`,与 mg 流完全隔离(只用 1 次 PRNG 抽模板)

验证:`scripts/af2-vs-mg-bitexact.ts` 跑同 seed 输出对比,AF2.chords + AF2.events
应与 MG.chords + MG.events 一致(只是装配方式不同 — MG 单段 / AF2 多段标注)。

Phase 3+:看 mg 是否真停止独立迭代,再讨论合并到 PRNGManager(届时 v2 baseline)。

---

## §8 验收锚点

Phase 1 完成时:

1. ✅ **bit-exact 锚点**:同 seed 下,AF2 模式的 chord/melody 输出 = MG 模式输出
   - 验证手段:Q+H 切到 AF2 vs MG,同 seed 听 + 看 UI 显示的 chord/melody
   - mg 内部 random stream 必须完全保留(MgKernelInvoker 不能消耗额外 PRNG)
2. ✅ **段落骨架可见**:Q+H Stage 1-2 panel 能展示 AF2 的段落标注(Intro/Verse/Chorus...)
3. ✅ **槽位路由生效**:在 BandSelectionPanel 把 MainInst 设为 alex_piano,Accomp 设为另一钢琴 musician,听感应该有差异(虽然 Phase 1 musician.persona 不消费,但至少"是否有该槽位"应该影响输出)
4. ✅ lint 0 errors
5. ✅ AF 模式无 regression(golden seed sha 一致)

---

## §9 不在 Phase 1 范畴(明确划出)

- Persona DNA 实际消费(motif 权重 / articulation 等)— Phase 2+
- 非钢琴乐器 idiom(萨克斯 / 小提琴 / 等)— Phase 2+
- Drums / Atmosphere 接入 — 见 §6 Q3
- 多段拼接长曲 — 见 §6 Q1
- 删 AF / MG 引擎切换 — Phase N(AF2 完全稳定后)

---

## §10 修订记录

- v0.1(2026-05-21):初稿,基于融合原则 + mg review 报告。
- v1.0(2026-05-21):用户拍板 §6 三决策点 — Q1 接受短曲 / Q2 idiom 内置目录 / Q3 渐进式;Phase 1 实装范围明确。
- v1.1(2026-05-21):Phase 1 实装跑通 + 修正 2 处设计漏洞:
  - **PRNG 策略修正(§7)**:AF2 改用与 MG 相同的 `mg_*` seedString(原先 `af2_*` 违反"同 seed AF2=MG bit-exact"硬约束)。验收脚本 `scripts/af2-vs-mg-bitexact.ts` 4/4 seeds 通过
  - **SlotRouter 简化**:Phase 1 不消费 forcedBand / Musician(默认 BandSelection={} 时所有 part 被丢弃导致无声)。Phase 2+ 引入 musician.persona 时再上"槽位空丢弃"语义
