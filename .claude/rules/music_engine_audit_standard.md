# 🎵 AuraFlow 算法编曲引擎全维度审计标准 (V1.0)

> **文档等级** — 最高约束(与 `music_generation_pipeline_rule.md` 并列)
> **用途** — 每次大型优化 / 架构调整 / PR 合并后,必须按本文档逐项复盘
> **读者** — 算法开发者 / AI Agent / Code Reviewer
> **版本基线** — 2026-04-15 V1.0(PR #1~#7)；2026-04-17 V1.2(PR#8/9/11 + V3.5 §14 新增 24 检查项)；2026-04-17 V1.3(分层重构 — §12 状态快照剥离至 `docs/audits/current_state.md`，rules-tier 只保留恒定约束)；2026-04-17 V1.4(V3.6 MomentumStage §15 新增 8 检查项)

---

## 0. 审计使用指南

### 0.1 何时触发完整审计

必须执行完整十维审计的场景:

- 任何涉及 `/src/core/generation/` 子模块职责边界的改动(新增/重构/删除模块)
- 任何修改 PRNG 消耗序列的改动(新增或删除 `PRNGManager.next()` 调用)
- 任何对 HarmonyCore / Orchestrator / TextureMapper / ToplineEngine / PlaybackEngine 的大型重构
- 连续 3 个 PR 之后的累积复盘(防止小改动累积出架构漂移)
- 每次版本打 Tag 前的 Release Gate

小型 bugfix / 参数微调 **不强制**完整审计,但开发者应主动声明涉及的维度编号,由 Reviewer 决定是否展开。

### 0.2 审计执行流程

```
1. 开发者自查    → 按 §1~§10 逐项勾选,填写「审计报告模板」(§11)
2. 证据锚点     → 每个 ✅ 必须附 file_path:line 或函数名
3. Seed 回归    → 用 Seed Lab 抽查 10 个固定 seed,逐项听感验证(§10.1 固定 seed 回归池)
4. ACVE 快照     → 跑确定性验证,A/B/C/D 快照对比
5. Reviewer 复核 → 质疑任何 ✅ 的证据完整性
6. 签收合并     → 缺失项转为 tech debt 登记到 todo_plan.md
```

### 0.3 评分标记约定

| 标记 | 含义 |
|------|------|
| ✅ | 已完整实现,有明确代码锚点与测试证据 |
| ⚠️ | 部分实现 — 有骨架但未覆盖所有场景/乐器/段落 |
| ❌ | 缺失 — 无对应实现,登记为 tech debt |
| 🧪 | 实验阶段 — 已实现但未经充分听感验证 |
| 💤 | 有意搁置 — 权衡后放弃实现,需写明理由 |

---

## 1. 维度一:纵向和声与声部协同

**审计目标**:确保多声部在同一时刻的频率、和弦、节奏互不打架,具有高度凝聚力。

### 1.1 全局和声下发 (Global Harmony Broadcasting)

- **检查点**:所有声部是否订阅同一份 `GeneratedChord[]` 和弦时间轴?是否存在声部私自生成和弦的旁路?
- **证据位置**:`src/core/generation/composing/HarmonyCore.ts`(和声生成入口)、`src/core/generation/harmony/HarmonyPipeline.ts`(Shadow→Skeleton→Viterbi 三阶段)、`src/core/generation/arrangement/Orchestrator.ts`(统一分派 `track.chords` 给所有乐器)
- **硬约束**:
  - 每个声部生成函数必须以 `chords: GeneratedChord[]` 作为显式参数,禁止从 `GlobalContext` 读取
  - 禁止任何声部内部调用 `HarmonyPipeline` 或 `ViterbiChordSelector`
  - `Orchestrator.arrange()` 是唯一允许组织和弦时间轴的位置
- **当前状态**:✅ 已实现(PR #1~#3 完成 Viterbi 管线后达成)
- **审计示例命令**:`grep -r "new HarmonyPipeline\|ViterbiChordSelector" src/core/generation/` — 结果应只出现在 `HarmonyPipeline.ts` 内部

### 1.2 频段隔离与避让 (Frequency Range Isolation)

- **检查点**:每个乐器是否有**代码层强制**的音域边界?越界是否会被 clamp 或丢弃?
- **证据位置**:`src/core/generation/arrangement/TextureMapper.ts`(`clampToRange()` Bass 28~43),`src/core/generation/config/InstrumentProfiles.ts`(`safeRange` 字段)
- **硬约束**:
  - Bass: E1-B2 (MIDI 28-47)
  - Chord/PianoRH/CounterMelody: ≥ C3 (MIDI 48+)
  - Melody: C4-G6 典型区(48-79),允许通过 Climax 短暂突破到 MIDI 84
  - 所有 clamp 在生成函数末尾必须执行一次(PR #5 D7 pitch 逃逸的教训)
- **当前状态**:✅ 已实现(PR #5 修复 Climax/Melisma 绕过 clamp 的 bug)
- **常见回归**:新增"跳高八度"分支时忘记加 clamp,导致个别音符穿透到 piccolo 区

### 1.3 节奏互锁与密度互补 (Rhythmic Hocketing)

- **检查点**:主旋律、副旋律、反旋律、和弦是否存在同时高密度冲突?
- **证据位置**:`src/core/generation/arrangement/Orchestrator.ts:generateSecondaryFillLine`(Call-and-Response 填补线),CounterMelody 三模式(Parallel Harmony / Call-and-Response / Pad)
- **硬约束**:
  - 主旋律发声时,CounterMelody 不得进入 Call-and-Response 模式
  - 同 beat 内主+副旋律 onset 数量 ≤ 3(否则触发密度抑制)
  - Chord 织体密度必须由段落 energyLevel 驱动,不得与 Melody 同时冲顶
- **当前状态**:⚠️ 部分实现 — Call-and-Response 已实现,但**缺少全局 DensityBudget 统计**,跨声部的密度冲突检测目前依赖听感而非代码
- **建议补全**:引入 `DensityTracker`,每 beat 统计所有声部 onset 总数,超阈值时触发 Pad 模式

### 1.4 Avoid Notes 与和弦外音碰撞 (Avoidance Notes Filtering)

- **检查点**:强拍旋律是否强制和弦内音?弱拍的 Tension / Passing 是否合法?
- **证据位置**:`src/core/generation/harmony/ViterbiChordSelector.ts:scoreStep`(TopVoice 评分表),`src/core/generation/composing/ToplineEngine.ts`(PR #4 Avoid Notes 过滤,PR #7 半音 crash 拒绝)
- **硬约束**:
  - Strong beat(1, 3):90% 以上必须落在 Chord Tone(1/3/5/7)
  - Weak beat(2, 4):允许 Tension(9/11/13) 和经过音
  - **禁止半音 crash**:旋律音与 Bass 根音同时出现 m2/M7 距离(PR #7 修复)
- **当前状态**:✅ 已实现(2026-04-15 审计复核:m9 检测已在 `ToplineEngine.ts:2118, 2126` 的 chromatic lead + Bebop 路径实现)

---

## 2. 维度二:多样性与反固化

**审计目标**:在规则框架内,确保每次 seed 触发的编曲结构、和声走向、乐器技法都有显著差异。

### 2.1 和弦池深度与进行变异

- **检查点**:是否存在 Secondary Dominants / Modal Interchange / Tritone Substitution?和弦池至少覆盖多少候选?
- **证据位置**:`src/core/generation/harmony/CandidatePool.ts`(C Major 28 候选),`src/core/generation/harmony/ViterbiChordSelector.ts`(`W_FUNCTIONAL=8` 功能偏好,`functionalBonus` 为借调 +3 / 副属 +2)
- **硬约束**:
  - 单调候选池 ≥ 28(6 自然三和弦 + 6 七和弦 + 4 色彩 + 4 副属 + 4 借调 + 4 sus/dim)
  - 副属和弦出现率:8~15%(不能太高也不能为 0)
  - 借调出现率:5~12%
- **当前状态**:✅ 已实现(PR #2 扩池到 28~40)
- **审计方法**:跑 10 个 seed,统计 `GeneratedChord.quality` 分布;若 Dominant7/Minor 占比 >95% 视为失衡

### 2.2 节奏模板池碎片化

- **检查点**:伴奏节奏是否是整小节硬编码?还是由 1-Beat/2-Beat 碎片拼接?
- **证据位置**:`src/core/generation/melody/RhythmCells.ts`(节奏细胞池),`src/core/generation/composing/GrooveEngine.ts`(`GrooveDNA` 指纹),`src/core/generation/arrangement/TextureMapper.ts`(按 `isGrooveHit()` 查询 DNA)
- **硬约束**:
  - 禁止整小节硬编码节奏数组(如 `[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]`)
  - 节奏必须来自 `RhythmCells[styleId]` 池 + tag(`fast`/`slow`)过滤 + PRNG 选择
- **当前状态**:⚠️ 部分实现(2026-04-15 审计修正:实际按 `styleId` 分组 + `energyLevel` 驱动 tag 过滤,非完整 styleId×energyLevel 交叉表;功能足够但记账需如实)

### 2.3 乐器分配与音色随机池

- **检查点**:Ensemble 配置是否按权重随机?同一风格能否生成视觉上不同的 Palette?
- **证据位置**:`src/core/generation/arrangement/EnsembleDrafter.ts:draft`(10 slot PRNG 消耗)
- **硬约束**:
  - 每个 role(melody/chord/bass/secondary/counter)至少 3 个候选乐器
  - Secondary Melody 强制 Plucked 约束(EnsembleDrafter.ts:22-45)
- **当前状态**:✅ 已实现

### 2.4 人性化微调 (Micro-Timing & Velocity Humanization)

- **检查点**:velocity 是否全局固定?onset 是否严格对齐网格?
- **证据位置**:`src/core/generation/arrangement/Orchestrator.ts:applyGrooveLFO`(三角函数微时序),`src/core/generation/config/styles/StyleRegistry.ts`(humanize 参数)
- **硬约束**:
  - velocity 强拍 90-110,弱拍 60-80,禁止全局常数
  - onset jitter ±3~10 ticks(PPQ 480 → ±0.006~0.02 拍)
- **当前状态**:⚠️ 部分实现 — humanize 参数当前仅 0.01(极小),且主要作用于 Drums;Melody/Chord 声部的 velocity 动态范围不足
- **tech debt**:登记 PR #8 候选为 "Humanization Expansion"

---

## 3. 维度三:横向曲式与旋律发展

**审计目标**:确保音乐有起承转合,旋律符合人类的乐句呼吸逻辑。

### 3.1 动机生命周期 (Motif Lifecycle)

- **检查点**:Verse/Chorus 是否有 AABA / ABAC / AABC 结构?第二次出现是重复、变奏还是随机?
- **证据位置**:`src/core/generation/composing/ToplineEngine.ts:MotifMap`(C 可移植线性字典),`src/core/generation/arrangement/MotifLooper.ts:loopMotif`(AABA 硬编码),`src/core/generation/composing/StructureEngine.ts`(PhraseGroupPlanner)
- **硬约束**:
  - Verse 第一乐句生成动机 A,第二乐句必须为 A/A'/B(按 70/20/10 概率)
  - Chorus 必须有 hook 级 motif 重复,禁止每次都是新旋律
  - PR #6 修复了 'A'→'M' slot key bug,确认 Verse/PreChorus 继承生效
- **当前状态**:✅ 已实现(PR #6 修复核心 bug)
- **审计方法**:Seed Lab 听 5 遍同一 seed,确认 Chorus 副歌 hook 可被哼出

### 3.2 乐句呼吸与休止符分布 (Phrasing & Rests)

- **检查点**:每 4 小节是否有强制休止?转折处是否有 Fill?
- **证据位置**:`src/core/generation/types.ts:CadenceType`(Open/Closed 枚举),`src/core/generation/composing/ToplineEngine.ts`(群组末尾强制 Closed Cadence)
- **硬约束**:
  - 每 4 小节至少 1 拍绝对休止
  - Verse→Chorus 前 0.5~1 小节必须有 Drum Fill + 旋律留白
- **当前状态**:✅ 已实现

### 3.3 宏观能量曲线 (Macro Energy Curve)

- **检查点**:Intro/Verse/Chorus/Bridge/Outro 的音符密度、八度、织体密度是否有明显区分?
- **证据位置**:`src/core/generation/config/EnergyThresholds.ts`(SILENT_MAX=2 ~ PEAK_MIN=8),`src/core/generation/arrangement/TextureMapper.ts`(Bass 步长按 energyLevel 动态调整)
- **硬约束**:
  - Intro energy ≤ 3,Verse 3~5,Chorus 7~9,Outro 递减
  - 每个段落 energyLevel 的差值 ≥ 2(否则段落感丢失)
- **当前状态**:✅ 已实现

---

## 4. 维度四:律动与地基 (Rhythm Foundation)

**审计目标**:底鼓和贝斯必须锁死,节拍感清晰可辨。

### 4.1 Kick & Bass 锁定 (Rhythm Locking)

- **检查点**:Bass 的强音是否与 Kick 同 beat?锁定率是否 ≥ 80%?
- **证据位置**:`src/core/generation/arrangement/TextureMapper.ts:42-58`(Bass 读取 `prevBassRootMidi` 跨和弦状态),Drum Groove 的固定 Kick 拍点(1/3)
- **硬约束**:
  - Pop/EDM/Rock 风格:Bass 强音与 Kick 重合率 ≥ 80%
  - Ballad 风格:可放宽到 50%(Bass 更自由走动)
- **当前状态**:⚠️ 部分实现 — **Bass 不是显式读取 Kick 锚点**,而是靠 GrooveDNA 的同步权重间接重合;审计时需统计实际重合率
- **建议补全**:`DrumEngine` 生成 KickAnchorList 并作为参数传入 `TextureMapper.generateBassLine()`

### 4.2 切分音收敛机制 (Syncopation Control)

- **检查点**:连续切分音是否有上限?反拍后是否强制回正拍?
- **证据位置**:`src/core/generation/composing/GrooveEngine.ts`(GrooveDNA 驱动切分),但**无显式 cap**
- **硬约束**:
  - 连续反拍 onset ≤ 2 个,之后必须落正拍 Grounding
  - Chorus hook 的切分音 ≤ 每小节 4 个
- **当前状态**:❌ 缺失 — 当前切分完全由 RhythmCells 权重驱动,无显式收敛约束
- **tech debt**:登记为 PR #8 候选 "Syncopation Cap"

---

## 5. 维度五:声部引导 (Voice Leading) ⭐ 新增维度

**审计目标**:和弦连接符合古典和声学的声部进行规则,避免刺耳跳动与平行禁忌。

> 这是 Luis 原方案未覆盖的经典维度。在 Viterbi 管线中,声部引导质量直接决定和弦切换的"流畅感"。

### 5.1 公共音保留 (Common Tone Preservation)

- **检查点**:相邻和弦的公共音是否被优先保留在同一声部?
- **证据位置**:`src/core/generation/harmony/ViterbiChordSelector.ts`(`W_VOICE_LEADING=2`, `VOICE_LEADING_CAP=3`),`ChordMask.ts:commonTones`(bitmask popcount)
- **硬约束**:
  - 相邻和弦公共音 ≥ 1 时,TopVoice 优先保留
  - Voice leading 距离(半音)∑ ≤ 3(除非 Cadence 节点)
- **当前状态**:✅ 已实现(PR #1 ChordMask + Viterbi)

### 5.2 Top Voice 平滑 (Top Voice Smoothness)

- **检查点**:和弦顶音(用户最易感知的音)在相邻和弦间跳动是否 ≤ 4 半音?
- **证据位置**:`src/core/generation/harmony/ChordScoreTable.ts`(17×12 TopVoice 评分表,值域 -4~+4)
- **硬约束**:TopVoice 相邻跳动 > 5 半音时评分应为负
- **当前状态**:✅ 已实现

### 5.3 平行禁忌与隐伏禁忌 (Parallel Fifths/Octaves)

- **检查点**:多声部同时进行时,是否避免了平行五度、平行八度?
- **证据位置**:当前**无显式检测**
- **硬约束**:
  - 主旋律 + Bass 连续两拍平行五度 → 评分 -5
  - 主旋律 + CounterMelody 平行八度 → 评分 -3
- **当前状态**:❌ 缺失 — 由于 Bass 和 Melody 独立生成,理论上可能出现平行禁忌
- **备注**:Pop 风格对平行八度容忍度较高,不是 P0 bug,但 Jazz/Classical 风格必须补齐
- **tech debt**:登记为 PR #9 候选 "Voice Leading Purity Pass"

---

## 6. 维度六:段落衔接与转场 ⭐ 新增维度

**审计目标**:段落之间的切换自然,避免能量断崖与织体撕裂。

### 6.1 段落边界平滑 (Section Boundary Smoothing)

- **检查点**:Verse→Chorus 的最后 0.5~1 拍是否有过渡处理?
- **证据位置**:`src/core/generation/arrangement/Orchestrator.ts`(Verse bass entry delay 15%, PR #5 修复),`src/core/audio/PlaybackEngine.ts:382-387`(段落开头 1 拍 CC7 60%→100% 渐变)
- **硬约束**:
  - Section 开头 1 拍 CC7 渐变,防止爆音
  - Bass/Drums entry 不得早于 section 开头 2 个 bar(否则前段尾部被污染)
- **当前状态**:✅ 已实现

### 6.2 Turnaround 与 Fill (过门)

- **检查点**:段落末尾是否有 Drum Fill + 和弦 Turnaround?
- **证据位置**:`src/core/generation/arrangement/MotifLooper.ts:loopMotif`(B 段上行四度,Turnaround 下行五度)
- **硬约束**:Chorus 重复 4 次时,每 2 次必须有一次变奏 Turnaround
- **当前状态**:✅ 已实现

### 6.3 能量断崖检测 (Energy Cliff Detection)

- **检查点**:相邻段落 energyLevel 差 > 4 时,是否有 buildup/breakdown 缓冲?
- **证据位置**:当前**无主动检测**,依赖 PhraseGroupPlanner 的段落类型排序
- **硬约束**:energyLevel 突变时必须插入 1 bar 的 BuildUp / Breakdown
- **当前状态**:⚠️ 部分实现 — 结构层有 BuildUp/Breakdown 段落类型,但无自动插入
- **tech debt**:登记为 PR #8 候选 "Energy Curve Smoother"

---

## 7. 维度七:伪混音 (MIDI CC Mixing)

**审计目标**:通过原生 MIDI CC 实现"编曲即混音",不依赖 Web Audio GainNode 或 DSP 效果器。

### 7.1 初始增益级联 (Static Gain Staging)

- **检查点**:引擎初始化时是否下发 CC7?各 role 的增益是否有梯度?
- **证据位置**:`src/core/audio/PlaybackEngine.ts:376-391`,`config/styles/StyleRegistry.ts`
- **硬约束**(顺序,不绑定具体数值):
  - **顺序**: Vocal ≥ Melody ≥ Drums > Bass > Chord ≥ CounterMelody
  - **掩蔽**: 同频段声部 CC7 差值 < 5 dB 时触发红线
- **实现备注**:`music_domain_knowledge.md` 里的 118/108/98 是**理想绝对值**,实际实现用 dB 相对缩放(Vocal +3 dB ≈ 100,Melody 0 ≈ 80,Drums +1 ≈ 89,Bass -2 ≈ 64,Chord/Counter -4 ≈ 50),公式 `Math.round(80 * Math.pow(10, dB/20))`。顺序一致则合规。
- **当前状态**:✅ 已实现(2026-04-15 审计复核:顺序合规)

### 7.2 伪侧链 Pump (Fake Sidechain)

- **检查点**:Kick 触发时是否向 Bass/Chord 注入 CC11 下潜-回弹曲线?
- **证据位置**:`src/core/audio/PlaybackEngine.ts:441-468`(CC11 呼吸包络),`PlaybackEngine.ts:500-537`("Luis's Fake Sidechain" 代码段)
- **硬约束**:Kick 触发时 CC11 包络 40→65→100→127,150ms 恢复
- **当前状态**:⚠️ 部分实现(2026-04-15 审计发现:**Kick-triggered 代码段已实现但被 `needsSidechain = false` 硬关闭** `PlaybackEngine.ts:501`)
- **tech debt**:**P1** — 启用需一行改动 + 验证 CC11 与现有呼吸包络不冲突

### 7.3 动态声场映射 (Dynamic Pan & Reverb)

- **检查点**:CC10 Pan 和 CC91 Reverb 是否随 energyLevel 动态变化?
- **证据位置**:`src/core/audio/PlaybackEngine.ts:564-590`(CC10 Pan + CC74 Brightness + Intro Filter Sweep)
- **硬约束**:
  - Chorus:双吉他/Synth 展开到 Pan ±40~60
  - Intro Filter Sweep:CC74 从 20→127 渐变
  - CC91 Reverb:Intro 高 → Chorus 降低
- **当前状态**:✅ 已实现

---

## 8. 维度八:决定论与底层合规

**审计目标**:确保同一 seed 在 Web 与未来的 ESP32 C 移植上字节级一致。

### 8.1 PRNG 纯洁度 (PRNG Purity)

- **检查点**:代码中是否存在 `Math.random()` / `Date.now()` / `performance.now()` 进入生成路径?
- **证据位置**:`src/core/utils/PRNG.ts`(LCG a=1664525, c=1013904223, m=2^32)
- **审计命令**:
  ```bash
  grep -rn "Math.random\|Date.now\|performance.now" src/core/generation/
  ```
- **硬约束**:`src/core/generation/` 下零命中
- **当前状态**:✅ 已实现

### 8.2 零 GC 压力 (Zero Garbage Collection)

- **检查点**:热循环内是否存在 `new Object()` / `[...spread]` / `Array.map()` 创建临时对象?
- **证据位置**:`src/core/generation/harmony/ViterbiChordSelector.ts:138-140`(Int32Array DP 表预分配),`ToplineEngine.MotifMap`(线性数组字典)
- **硬约束**(见 pipeline rule §4.5, §4.6):
  - DP / 矩阵必须用 TypedArray
  - 热循环内 `.push()` 可接受(C 翻译为 `buf[count++]`)
  - 禁止热循环内 `.map()` / `.filter()` / `[...spread]`
- **当前状态**:✅ 部分实现 — Viterbi / MotifMap 已优化,Orchestrator 多处仍用 `new Array()`
- **tech debt**:登记为长期优化任务

### 8.3 ACVE 快照完整性 (Snapshot Integrity)

- **检查点**:四个快照点 A/B/C/D 是否都在代码中正确打点?
- **证据位置**:
  - **A**: `PRNGManager.setSeed()` 入口处,应由调用方(`SeedController` / `EndlessRadioManager`)在 setSeed 后立即 `recordSnapshot('A')`
  - **B**: `MelodyEngine.generateFullSong()` 入口
  - **C**: `Orchestrator.arrange()` 入口
  - **D**: `PlaybackEngine.loadSong()` 入口 / `MidiConverter.convert()` 入口
- **硬约束**:每个快照点必须在代码中 `PRNGManager.recordSnapshot()`
- **当前状态**:✅ 已实现(按 pipeline rule §5 要求)
- **审计方法**:同一 seed 跑两次,A/B/C/D 四个 state 必须严格相等;修改 PR 后,未改动的下游快照仍必须匹配历史录制值

---

## 9. 维度九:Pitch Space 契约 ⭐ 项目专有

**审计目标**:确保生成管道内 pitch 值遵守"相对空间生成,applyOffset 唯一转换"契约(见 pipeline rule §4.7 K-1~K-7)。

### 9.1 双空间分离 (Two Spaces Separation)

- **检查点**:生成函数返回的 `NoteData.pitch` 是否在相对空间(未叠加 keyOffset)?
- **证据位置**:`Orchestrator.applyOffset()` 是唯一的转换点
- **硬约束**:
  - 所有 `/src/core/generation/` 内部函数返回 RELATIVE pitch
  - `keyOffset` 只能在 `applyOffset()` 内被加入
- **当前状态**:✅ 已实现(K-1~K-7 作为 rule 存在)
- **审计命令**:`grep -rn "keyOffset" src/core/generation/ | grep -v "applyOffset\|MusicContext"` — 结果需要人工逐个审查合法性

### 9.2 禁止预补偿 (No Pre-Compensation)

- **检查点**:是否存在 "targetCenter - keyOffset" 这类对消模式?
- **证据位置**:历史上 ToplineEngine 曾出现,PR #3~#5 期间清理
- **硬约束**:K-4 明令禁止
- **当前状态**:✅ 已实现

### 9.3 后处理空间声明 (Post-Processing Space)

- **检查点**:`GlobalReviewer` 等后处理模块的输入是 RELATIVE 还是 ABSOLUTE?有无混用?
- **证据位置**:后处理模块接收 `applyOffset()` 之后的数据,处于 ABSOLUTE
- **硬约束**:K-6 要求通过 `% 12` 桥接进行 pitch class 比较
- **当前状态**:✅ 已实现

---

## 10. 维度十:听感主观验证协议 ⭐ 项目专有

**审计目标**:基于 Seed Lab 工具对算法产出进行结构化人工听感评估。代码测试只能保证"确定性"和"约束合规",但"好听"必须靠耳朵。

### 10.1 固定 seed 回归池 (Regression Seed Pool)

- **检查点**:每次大型优化后,是否用固定的 seed 池听 A/B 对比?
- **推荐池**:
  ```
  42, 12345, 2332053069, 88888888, 1, 999,
  (上次版本反映"好听"的 5 个 seed),
  (上次版本反映"有问题"的 3 个 seed)
  ```
- **工具**:`src/components/SeedController.tsx` (Seed Lab),Q+S 召唤面板
- **硬约束**:每个 seed 至少听完整一遍(Intro→Chorus×2→Outro)
- **审计记录**:在 §11 审计报告模板中填写每个 seed 的主观评分

### 10.2 Focus Mute 单声部抽检 (Focus Mute Check)

- **检查点**:用 Seed Lab 的 mute 功能,单独听每个声部是否独立可听?
- **标准**:
  - **Melody solo**:能哼出,有呼吸,有句式
  - **Bass solo**:有走向,不是干瘪根音
  - **Chord solo**:织体有变化,不是机械琶音
  - **Drums solo**:律动清晰,Fill 到位
  - **CounterMelody solo**:与主旋律有对话感,不是背景噪声
- **工具**:Seed Lab 的 7 个 mute 按钮
- **当前状态**:✅ 工具已就绪(SeedController PR)

### 10.3 五维主观打分 (Subjective 5-Axis Rating)

每个 seed 按以下 5 维打分(1-5 分):

| 维度 | 含义 |
|------|------|
| **Catchy** | 副歌是否有 hook,能哼出来 |
| **Flow** | 旋律连续性,有无撕裂感 |
| **Balance** | 声部协同,无掩蔽无冲突 |
| **Groove** | 律动感,Kick+Bass 地基稳 |
| **Variety** | 段落间有对比,不是从头平到尾 |

- **合格线**:10 个 seed 的 5 维平均 ≥ 3.5
- **红线**:任何单维度 < 2.5 视为回归

### 10.4 A/B 对比日志

- **检查点**:本次优化的"目标问题"在 A/B 对比中是否得到改善?
- **记录格式**:
  ```
  Seed 42:
    Before (commit b8380bc): Melody Flow 2.5, Catchy 3.0
    After  (commit 6571326): Melody Flow 4.0, Catchy 3.5
    结论:✅ Flow 改善,Catchy 微升,无回归
  ```
- **工具**:`git stash` + Seed Lab 切换对比

---

## 11. 审计报告模板

> 每次大型 PR 合并前,开发者复制本模板填写,附在 PR description 中。

```markdown
# [PR #X] 审计报告 — <一句话摘要>

**日期**: YYYY-MM-DD
**涉及 commit**: <commit range>
**涉及维度**: 1.1, 2.4, 5.2, ...

## 维度检查清单

### 维度一:纵向和声
- [ ] 1.1 全局和声下发 — <状态 + 证据>
- [ ] 1.2 频段隔离 — <状态 + 证据>
- [ ] 1.3 节奏互锁 — <状态 + 证据>
- [ ] 1.4 Avoid Notes — <状态 + 证据>

### 维度二:多样性
- [ ] 2.1 和弦池深度 — ...
- [ ] 2.2 节奏碎片化 — ...
- [ ] 2.3 乐器随机池 — ...
- [ ] 2.4 人性化微调 — ...

### 维度三:曲式发展
- [ ] 3.1 Motif 生命周期 — ...
- [ ] 3.2 乐句呼吸 — ...
- [ ] 3.3 能量曲线 — ...

### 维度四:律动地基
- [ ] 4.1 Kick+Bass 锁定 — ...
- [ ] 4.2 切分音收敛 — ...

### 维度五:声部引导
- [ ] 5.1 公共音保留 — ...
- [ ] 5.2 Top Voice 平滑 — ...
- [ ] 5.3 平行禁忌 — ...

### 维度六:段落衔接
- [ ] 6.1 边界平滑 — ...
- [ ] 6.2 Turnaround/Fill — ...
- [ ] 6.3 能量断崖 — ...

### 维度七:伪混音
- [ ] 7.1 增益级联 — ...
- [ ] 7.2 伪侧链 — ...
- [ ] 7.3 动态声场 — ...

### 维度八:决定论
- [ ] 8.1 PRNG 纯洁度 — ...
- [ ] 8.2 零 GC — ...
- [ ] 8.3 ACVE 快照 — ...

### 维度九:Pitch Space 契约
- [ ] 9.1 双空间分离 — ...
- [ ] 9.2 禁止预补偿 — ...
- [ ] 9.3 后处理空间 — ...

### 维度十:听感主观验证
- [ ] 10.1 固定 seed 池 — 听了 <N> 个 seed
- [ ] 10.2 Focus Mute 抽检 — <覆盖声部>
- [ ] 10.3 五维打分:

| Seed | Catchy | Flow | Balance | Groove | Variety | 均值 |
|------|--------|------|---------|--------|---------|------|
| 42   |        |      |         |        |         |      |
| 12345|        |      |         |        |         |      |
| ...  |        |      |         |        |         |      |

- [ ] 10.4 A/B 对比结论:

## Tech Debt 登记

本次 PR 未解决但需记录的遗留问题:
- [ ] <问题描述> → 登记到 todo_plan.md

## ACVE 验证结果

- [ ] Seed 42 四快照 A/B/C/D 与基线匹配
- [ ] Seed 12345 四快照 A/B/C/D 与基线匹配
- [ ] 如有差异,差异原因:<...>

## Reviewer 签收

- Reviewer: <name>
- Date: <date>
- 结论: ✅ 合并 / ⚠️ 需要补强 / ❌ 拒绝
```

---

## 12. 当前实现状态快照(已剥离至 docs/)

> **V1.3 重构**(2026-04-17): §12 状态快照表 + tech debt 列表已从本文件(rules-tier)剥离至 **`docs/audits/current_state.md`**。
>
> **Why** — §12 是会随每个 PR 漂移的"成绩单",留在 rules-tier 会让 Claude 把过期的 ✅/⚠️ 当真。Rules-tier 只保留"违反了一定是 bug"的恒定约束(检查维度定义在 §1~§11、§14)。
>
> **审计执行流程现在是**:
> 1. 在本文件查"应该检查什么"(§1~§11、§14 维度定义)
> 2. 在 `docs/audits/current_state.md` 查"现在状态如何"(各项 ✅/⚠️/❌ + 证据)
> 3. PR 修复或新增任何项时,更新 `docs/audits/current_state.md`(本文件不动)

---

## 14. V3.5 RichIdioms 模块审计维度 ⭐ 新增维度

> **新增日期** — 2026-04-17(V1.2 同步扩充)
> **背景** — V3.5 引入 idioms/ 子系统、AnchorBackbone、AnchorDecisionStage、PhraseContourPlanner 与全链路 subgenre/grooveDNA。原 §1~§10 维度无法覆盖这些新模块的特定不变量,故新增 §14。
> **审计触发条件** — 任何对 `/src/core/generation/idioms/`、`/composing/AnchorBackbone.ts`、`/composing/AnchorDecisionStage.ts`、`/composing/PhraseContourPlanner.ts` 或 subgenre 池(`StructureEngine.ts:128-143`)的改动。

### 14.1 DrumIdiomRouter + 6 DrumIdiom

#### 14.1.1 评分公平性 (Score Range & Tie-Breaking)

- **检查点**:每个 DrumIdiom 的 `score(ctx)` 返回值是否在合理范围(典型 [20, 100])?同分时是否按 `name` 字典序确定性排序?
- **证据位置**:`src/core/generation/idioms/drums/DrumIdiomRouter.ts:62-79`(评分循环 + sort)
- **硬约束**:
  - 任意 idiom 的 score 必须为有限正数(无 NaN / Infinity)
  - tie-break 必须用 `idiom.name` 字典序,**禁止** Math.random() 或 PRNG
- **当前状态**:✅ 已实现

#### 14.1.2 切换保护阈值 (Switch Hysteresis)

- **检查点**:相邻 section 选择 idiom 时,若 `prevIdiom` 在前两名且分差 < 10%,是否保持上一段 idiom?
- **证据位置**:`DrumIdiomRouter.ts:62-79`,阈值常数 `0.10`
- **硬约束**:`diffPct = (primaryScore - secondaryScore) / primaryScore`,必须用 `< 0.10`(严格小于,非 `<=`)
- **当前状态**:✅ 已实现

#### 14.1.3 华彩借调 PRNG 消耗一致性 (Flourish Determinism)

- **检查点**:Bridge / PreChorus / Solo_Bridge / 高能 Chorus(energy≥9)+ 段长≥16 拍时,30% 概率切第二高分 idiom。无论是否触发,PRNG 消耗次数必须**恒定**。
- **证据位置**:`DrumIdiomRouter.ts:83-108`(line 98 触发消耗,line 107 占位消耗)
- **硬约束**:每个符合借调候选条件的 section,PRNG 消耗 == 1(无论结果如何);非候选 section 消耗 == 0
- **当前状态**:✅ 已实现

#### 14.1.4 过渡 Fill 完整性 (Transition Fill Integrity)

- **检查点**:华彩借调触发时,主 idiom 末 1 拍是否含完整 4 音 Tom 链(Hi → Mid → Low → Snare)?华彩 idiom 首拍是否带 crash(pitch=49, duration=1.5, velocity≥0.85)?
- **证据位置**:`DrumIdiomRouter.ts:113-148`
- **硬约束**:
  - Tom 链 onset 步进恰好 0.25 拍
  - velocity 递增梯度 0.70 → 0.75 → 0.80 → 0.85
  - 回归主 idiom 时,若 idiom 名不同且 energy≥4,首拍必须有重 kick + crash anchor
- **当前状态**:✅ 已实现

#### 14.1.5 Melody/Bass Listening 实际触发 (Listening Activation)

- **检查点**:每个 DrumIdiom 是否真正消费传入的 `melodyNotes[]` / `bassNotes[]`,而非仅签名占位?
- **证据位置**:`SteadyDrumIdiom.ts:46-49`(maskAccent 同拍位检测)、`SteadyDrumIdiom.ts:105-108`(bass ghost 弱拍检测)
- **硬约束**:至少 SteadyDrumIdiom / HighEnergyDrumIdiom 两个主流 idiom 必须读 melody/bass(其余 idiom 可视设计意图豁免)
- **当前状态**:✅ Steady 已实现;其他 idiom 实际消费率待逐一审计

---

### 14.2 CounterMelodyRouter + 3 模式

#### 14.2.1 InterplayMode 哈希纯函数性 (Hash Purity)

- **检查点**:`pickInterplayMode(sectionName, sectionType, energy)` 必须是纯函数,零 PRNG 消耗,同输入恒定输出
- **证据位置**:`src/core/generation/idioms/countermelody/ICounterMelodyIdiom.ts:33-53`
- **硬约束**:
  - hash 公式 `hash = ((hash << 5) - hash + char) | 0` 必须用 `| 0` 强制 32-bit signed(C 移植一致性)
  - 选择映射表(Chorus/Drop → 3 种,PreChorus/BuildUp → 2 种,默认 → 2:1 偏向 CallAndResponse)必须文档化
- **当前状态**:✅ 已实现

#### 14.2.2 主旋律密度互锁 (Density Hocketing)

- **检查点**:CallAndResponseIdiom 的副旋律 onset 是否真正落在主旋律的休止区?
- **证据位置**:`CallAndResponseIdiom.ts`(generate() 内部需读 melodyNotes 找空隙)
- **硬约束**:CallAndResponse 模式下,副旋律 onset 与主旋律 onset 的同拍位重叠率 ≤ 20%
- **当前状态**:🧪 实现存在但缺定量验证

---

### 14.3 PianoIdiomRouter + 5 策略

#### 14.3.1 5 策略 score 上下界 (Score Bounds)

- **检查点**:Block / Arpeggio / Rhythmic / Pad / Pulsing 五策略的 score 必须在 [20, 100],严格 `Math.min(score, 100)` 封顶
- **证据位置**:`src/core/generation/idioms/piano/PianoIdiomRouter.ts:30-88`
- **硬约束**:每个 strategy 的 base + bonus 总和 ≤ 100,任何 score 出现 >100 视为评分逻辑 bug
- **当前状态**:✅ 已实现(代码内 Math.min 硬封顶)

#### 14.3.2 切换保护 (Texture Hysteresis)

- **检查点**:`prevTexture` 在前两名且分差 < 15% 时保持(注意阈值与 §14.1.2 不同 — 钢琴比鼓更宽容)
- **证据位置**:`PianoIdiomRouter.ts:90-134`
- **硬约束**:`diffPct < 0.15`(严格小于)
- **当前状态**:✅ 已实现

#### 14.3.3 texture 字符串与下游接口对齐 (Interface Contract)

- **检查点**:Router 返回的 texture 字符串("Block"/"Arpeggio"/"Rhythmic"/"Pad"/"Pulsing")必须是 `TextureMapper.generateChordTexture()` 接受的合法值
- **证据位置**:`PianoIdiomRouter.ts:105-130`(返回值)与 TextureMapper 实际生成代码
- **硬约束**:Router 返回值集合 ⊆ TextureMapper 接受集合,新增 strategy 必须同步更新两侧
- **当前状态**:⚠️ Pad / Pulsing 在 Router 已声明,TextureMapper 端实际差异化生成尚未深度验证

---

### 14.4 AnchorBackbone

#### 14.4.1 anchor 数量自适应 (Anchor Count Adaptive)

- **检查点**:每个 PhraseGroup 的 anchor 数量按长度自适应:≥13 拍 → 5,≥9 拍 → 4,≥5 拍 → 3,否则 2
- **证据位置**:`src/core/generation/composing/AnchorBackbone.ts:110-126`
- **硬约束**:`anchorCount ∈ [2, 5]`,**禁止** 1 或 6+
- **当前状态**:✅ 已实现

#### 14.4.2 anchor 间最大跳跃 (Max Anchor Interval)

- **检查点**:相邻 anchorPitches[i] / anchorPitches[i+1] 跳跃 ≤ 7 半音(MAX_ANCHOR_INTERVAL,纯五度)
- **证据位置**:`AnchorBackbone.ts:149-156`,`pickMidAnchorPitch()` 强制
- **硬约束**:违反此约束的骨架必须被 reject 或 snap 修复
- **当前状态**:✅ 已实现

#### 14.4.3 cadenceTarget chord tone 对齐 (Cadence Lock)

- **检查点**:末位 anchor 必须落在当前 chord 的 chord tone(或被 snap 吸附)
- **证据位置**:`AnchorBackbone.ts:128-158`,`pickPitchForDegree()` + `precomputedCadenceDegree`
- **硬约束**:cadenceTarget 必须由 `group.precomputedCadenceDegree` 或 `cadenceType`(Closed→root/3, Open→5/2)显式决定
- **当前状态**:✅ 已实现

#### 14.4.4 零 PRNG 消耗 (Zero PRNG Consumption)

- **检查点**:整个 AnchorBackbone.buildForSection() 流程必须**零** `PRNGManager.next()` 调用(纯确定性算法)
- **证据位置**:整个 `AnchorBackbone.ts`
- **硬约束**:在 ACVE stateB → stateB' 之间穿插 anchorBackbone.buildForSection() 调用,PRNG state 必须不变
- **当前状态**:✅ 已实现
- **审计命令**:`grep -n "PRNGManager" src/core/generation/composing/AnchorBackbone.ts` — 应为空

---

### 14.5 AnchorDecisionStage

#### 14.5.1 7 规则覆盖完整性 (Rule Coverage)

- **检查点**:7 条规则(小节首末 / 局部极值 / 大跳目的地 / 长音 / 附点起音 / 段落末 / 装饰音排除)必须按声明顺序应用
- **证据位置**:`src/core/generation/composing/AnchorDecisionStage.ts:58-142`
- **硬约束**:规则编号 1~6 为 OR 关系打标 anchor;规则 7(装饰音排除)为 AND-NOT,必须**最后**执行覆盖前 6 项
- **当前状态**:✅ 已实现

#### 14.5.2 snap 位移上限 (Snap Displacement Cap)

- **检查点**:非和弦音的 anchor 调用 `HarmonyCore.snapToScale()` 后,位移 > 3 半音 → 降级为非 anchor(保留原 pitch)
- **证据位置**:`AnchorDecisionStage.ts:144-180`
- **硬约束**:snap 位移 ≤ 3 半音是硬上限,违反必须 fallback 而非强行修改
- **当前状态**:✅ 已实现

#### 14.5.3 isPreBuiltAnchor 信任契约 (Pre-Built Anchor Trust)

- **检查点**:P6a (AnchorBackbone) 写入 `isPreBuiltAnchor=true` 的音符,DecisionStage 必须**跳过** snap 校验(信任前置决策)
- **证据位置**:`AnchorDecisionStage.ts:51-55`(初始化保留),`AnchorDecisionStage.ts:144-180`(snap 跳过条件)
- **硬约束**:isPreBuiltAnchor 与 isAnchor 必须独立位,前者优先级高于规则打标
- **当前状态**:✅ 已实现

---

### 14.6 PhraseContourPlanner

#### 14.6.1 三层权重和 (Tension Weight Sum)

- **检查点**:`tension = 0.5×songLevel + 0.3×sectionLevel + 0.2×phraseLevel`,权重和必须 == 1.0
- **证据位置**:`src/core/generation/composing/PhraseContourPlanner.ts:177-186`
- **硬约束**:0.5 + 0.3 + 0.2 = 1.0(若改权重,必须保持和为 1.0)
- **当前状态**:✅ 已实现

#### 14.6.2 张力值 ∈ [0, 1] clamped

- **检查点**:每个层级返回值必须在 [0, 1],最终 tension 必须 clamp
- **证据位置**:`PhraseContourPlanner.ts:177-186`
- **硬约束**:clamp 必须用 `Math.max(0, Math.min(1, x))`,**禁止** 直接返回未约束值
- **当前状态**:✅ 已实现

#### 14.6.3 边界连续性 (Boundary Continuity)

- **检查点**:section 边界处 tension 必须连续(section_i 末 ≈ section_{i+1} 首,误差 ε < 0.05)
- **证据位置**:`PhraseContourPlanner.ts:31-43`(songLevel 映射表),`PhraseContourPlanner.ts:120-157`(sectionLevel 形态函数)
- **硬约束**:相邻 SectionType 的张力差 ≤ 0.4 应通过形态函数自然过渡;>0.4 时由 §6.3 能量断崖 ramp 兜底
- **当前状态**:🧪 形态函数已实现,边界连续性缺自动化测试

#### 14.6.4 velocity / timing 公式 (Velocity & Timing Formula)

- **检查点**:
  - velocity 应用 `note.velocity *= (0.6 + 0.4 × tension)`
  - timing jitter 应用 `jitter = baseJitter × (1.1 - tension)`(高张力 → 精准)
- **证据位置**:`PhraseContourPlanner.ts` 头部注释 L14-16,实际应用在 ToplineEngine / Orchestrator
- **硬约束**:tension=0 时 velocity 系数 0.6(柔);tension=1 时 1.0(满力);tension=1 时 jitter 系数 0.1(高度精准)
- **当前状态**:⚠️ 公式已声明,实际应用点的执行率待逐一审计

---

### 14.7 全链路律动统一 (Subgenre + grooveDNA)

#### 14.7.1 subgenre 抽样权重比 (Subgenre Sampling)

- **检查点**:Pop / Funk / Lo-fi / Latin 4 池权重比必须严格 4:2:2:1
- **证据位置**:`src/core/generation/composing/StructureEngine.ts:128-143`
- **硬约束**:
  - 任意 1000 seed 的统计分布必须满足 χ² 检验 p > 0.05
  - 单池删改必须同步更新权重表(避免归一化错误)
- **当前状态**:✅ 已实现

#### 14.7.2 syncRange / swingRange 严格遵守 (Range Bounds)

- **检查点**:抽样后的 songSyncopation / songSwing 必须落在 subgenre 对应区间内
- **证据位置**:`StructureEngine.ts:139-140`(PRNG 抽样)
- **硬约束**:
  - Pop: sync ∈ [0.15, 0.35], swing ∈ [0.50, 0.52]
  - Funk: sync ∈ [0.55, 0.80], swing ∈ [0.50, 0.54]
  - Lo-fi: sync ∈ [0.30, 0.50], swing ∈ [0.55, 0.62]
  - Latin: sync ∈ [0.45, 0.70], swing ∈ [0.50, 0.52]
- **当前状态**:✅ 已实现

#### 14.7.3 grooveDNA 数组单调递增 (grooveDNA Monotonicity)

- **检查点**:每个 section 的 `grooveDNA[]` 排序后必须严格单调递增,长度 ≥ 2,值范围 ∈ [0, 2×beatsPerBar)
- **证据位置**:`GrooveEngine.ts:33-162`(generateRhythmFingerprint),`GrooveEngine.ts:9`(MAX_CONSECUTIVE_OFFBEAT=2 capping)
- **硬约束**:重复 onset 必须去重,溢出 loopLength 必须裁剪
- **当前状态**:✅ 已实现

#### 14.7.4 swing 参数实际消费 (Swing Consumption)

- **检查点**:IDrumIdiom 接口接收 `swing` 参数,各 DrumIdiom 的 generate() 是否真正用 swing 调制 hi-hat / kick 时值?
- **证据位置**:`IDrumIdiom.ts:53` 接口定义,各 idiom 的 generate() 实现
- **硬约束**:至少 SteadyDrumIdiom / AcousticSwingDrumIdiom 必须真正消费 swing(后者名字含 Swing)
- **当前状态**:❌ **审计发现** — 6 个 DrumIdiom 均**未消费** swing 参数(grep 验证零处使用)。AcousticSwingDrumIdiom 名字误导
- **tech debt**:登记为 P2 — DrumIdiom swing 消费实装

---

## 15. MomentumStage 动量与阻尼系统 ⭐ 新增维度 (V3.6)

> **新增日期** — 2026-04-17(V1.4 同步扩充)
> **背景** — V3.6 引入 MomentumStage 物理动量系统(Luis 旋律连贯性诊断 #1),给非 anchor 过渡音注入运动学惯性。完整设计契约见 `docs/momentum_stage_design.md`。
> **审计触发条件** — 任何对 `/composing/MomentumStage.ts`、MelodyEngine 中 MomentumStage 集成点、StyleConfig.melody.useMomentum 配置的改动。

### 15.1 PRNG 纯洁性 (PRNG Purity)

- **检查点**:MomentumStage 整个 smooth() 流程必须零 `PRNGManager.next()` 调用
- **证据位置**:`src/core/generation/composing/MomentumStage.ts` 全文
- **硬约束**:
  - ACVE stateC / stateD 在 MomentumStage 开/关下必须严格相等
  - 任何引入 PRNG 消耗的修改必须重跑全部黄金种子
- **当前状态**:✅ 已实现
- **审计命令**:`grep -n "PRNGManager\|Math.random" src/core/generation/composing/MomentumStage.ts` — 应为空

### 15.2 Anchor 不变性 (Anchor Invariance)

- **检查点**:所有 `isPreBuiltAnchor === true` 的音符 pitch 在 MomentumStage 前后严格相等;`isGraceNote === true` 的装饰音也不动
- **证据位置**:`MomentumStage.ts:smooth()` 跳过保护(`if (curr.isPreBuiltAnchor === true) { resetMomentum; continue; }`)
- **硬约束**:违反此约束直接破坏 AnchorBackbone 的骨架契约
- **当前状态**:✅ 已实现
- **审计方法**:开/关 useMomentum 跑同 seed,逐 anchor 比对 pitch 必须 === 

### 15.3 调整幅度上限 (Adjustment Cap)

- **检查点**:单音 pitch 修改的绝对值 ≤ `MAX_ADJUSTMENT_SEMITONES` (默认 4 半音,≈ 2 diatonic step)
- **证据位置**:`MomentumStage.ts:smooth()` 第 7 步 — `if (adjustment > MAX_ADJUSTMENT_SEMITONES) continue;`
- **硬约束**:超阈值必须 **skip**(保留原音),禁止 clamp 后强行写入(会破坏 melodic intent)
- **当前状态**:✅ 已实现

### 15.4 Pitch Space RELATIVE 合规 (Pitch Space Compliance)

- **检查点**:MomentumStage 内部禁读 `GlobalContext.currentKeyOffset`,所有 pitch 操作必须在 RELATIVE 空间
- **证据位置**:`MomentumStage.ts` 不 import `GlobalContext`,只调 `HarmonyCore.shiftDiatonic` / `snapToScale`(均 RELATIVE-safe)
- **硬约束**:K-1 / K-3 / K-5 契约
- **当前状态**:✅ 已实现
- **审计命令**:`grep -n "keyOffset\|GlobalContext" src/core/generation/composing/MomentumStage.ts` — 应为空

### 15.5 阻尼债务消耗 (Damping Debt Discharge)

- **检查点**:大跳(|chromaStep| ≥ `LEAP_THRESHOLD` = 5 半音)后,必须有连续 `LEAP_DAMPING_DEBT`(默认 2)个反 mSign 方向的强制 shiftDiatonic 调整(直到 dampingDebt 归零)
- **证据位置**:`updateMomentum()` 设 dampingDebt;`smooth()` 第 6 步分支
- **硬约束**:dampingDebt > 0 时,目标 pitch 必须由 `shiftDiatonic` 强制反向,**不受 strength 缩放影响**(阻尼是硬性的)
- **当前状态**:✅ 已实现

### 15.6 Style 开关 (Style Toggle)

- **检查点**:`StyleConfig.melody.useMomentum === false` 时,MomentumStage 必须完全跳过(等价于 V3.5 行为)
- **证据位置**:`MelodyEngine.ts` 集成处 `if (style.melody?.useMomentum !== false ...)`
- **硬约束**:开关 false 时,melody 输出必须**逐字段相等**于 V3.5 基线(给予回滚保险)
- **当前状态**:✅ 已实现
- **审计方法**:同 seed 下 `useMomentum: true/false` 的 melody pitch 数组比对(false 必须与 V3.5 黄金种子哈希匹配)

### 15.7 张力耦合公式 (Tension Coupling)

- **检查点**:strength 公式 = `TENSION_STRENGTH_BASE` + `TENSION_STRENGTH_GAIN × tension`,默认 `0.5 + 0.5 × tension`,所以 strength ∈ [0.5, 1.0]
- **证据位置**:`MomentumStage.ts` 常数定义 + `smooth()` 第 5 步
- **硬约束**:
  - tension 必须 clamp 到 [0, 1]
  - strength 仅影响**软推动分支**(非阻尼债务分支)
  - 缺省 tensionEnvelope 时按 strength=1.0 处理(行为最强,适合无段落上下文测试)
- **当前状态**:✅ 已实现

### 15.8 仅主旋律应用 (Melody-Only Scope)

- **检查点**:MomentumStage 不应用于 vocal、counterMelody、bass 等其它声部
- **证据位置**:`MelodyEngine.ts` 集成处仅传 `reviewed.melody`,vocal 不调用
- **硬约束**:vocal / counterMelody / bass 的 pitch 在 MomentumStage 前后必须**严格相等**
- **当前状态**:✅ 已实现
- **理由**:per design Q3 决策 a,副旋律有自己的 ParallelHarmony 约束,注入动量可能冲突

---

## 13. 文档维护

- **版本管理**:本文档每次大型架构调整后升级主版本号(V1.0 → V2.0)
- **增补机制**:新增维度时,编号顺延(不修改已有编号,保证历史 PR 审计报告可追溯)。新增维度示例:V1.2 在 §13 之前插入 §14(V3.5 RichIdioms 模块)
- **分层原则**(V1.3 重构后):
  - **本文件(rules-tier)** — 只放恒定不变的检查维度定义(§1~§11、§14)。违反 = bug。
  - **`docs/audits/current_state.md`** — 当前实现状态快照(各项 ✅/⚠️/❌ + 证据 + tech debt)。每个 PR 维护。
  - **`docs/audits/<date>_<event>_audit.md`** — 历史快照(如 `2026-04-15_pr7_baseline_audit.md`)。永不修改。
- **PR 审计执行流程**:
  1. 开发者按本文件 §1~§11、§14 列出涉及的检查项
  2. 跑 ACVE 快照验证(§8.3)
  3. 更新 `docs/audits/current_state.md` 对应行
  4. 大型 PR(累积 3+)发布 Vx.x 更新说明
- **与其他文档关系**:
  - `music_generation_pipeline_rule.md` — 管道拓扑硬约束(本文档 §8.x, §9.x 引用)
  - `music_domain_knowledge.md` — 音乐理论知识(本文档 §7.1 增益梯度引用)
  - `docs/audits/current_state.md` — 当前实现状态快照(原 §12,V1.3 剥离)
  - `docs/v35_module_topology.md` — V3.5 模块拓扑(原 pipeline_rule 附录 B,V1.3 剥离)
  - `docs/todo_plan.md` — tech debt 长期登记处(从 current_state.md 导出)
