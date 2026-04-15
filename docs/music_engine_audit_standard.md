# 🎵 AuraFlow 算法编曲引擎全维度审计标准 (V1.0)

> **文档等级** — 最高约束(与 `music_generation_pipeline_rule.md` 并列)
> **用途** — 每次大型优化 / 架构调整 / PR 合并后,必须按本文档逐项复盘
> **读者** — 算法开发者 / AI Agent / Code Reviewer
> **版本基线** — 2026-04-15,基于 PR #1~#7(Viterbi 和声管线完成后的状态)

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
3. Seed 回归    → 用 Seed Lab 抽查 10 个固定 seed,逐项听感验证(§12)
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

## 12. 当前实现状态快照 (V1.0 基线)

基于 2026-04-15 对代码库的扫描结果(PR #7 合并后):

| # | 检查项 | 状态 | 证据 / 备注 |
|---|--------|------|-------------|
| 1.1 | 全局和声下发 | ✅ | HarmonyPipeline + Orchestrator.arrange |
| 1.2 | 频段隔离 | ✅ | TextureMapper.clampToRange |
| 1.3 | 节奏互锁 | ⚠️ | Call-and-Response 已实现,缺全局 DensityTracker |
| 1.4 | Avoid Notes | ✅ | m9 检测已实现(ToplineEngine:2118,2126) |
| 2.1 | 和弦池深度 | ✅ | 28 候选,功能加分 +8 |
| 2.2 | 节奏碎片化 | ⚠️ | RhythmCells 按 styleId 分组 + tag 过滤,无 styleId×energyLevel 交叉 |
| 2.3 | 乐器随机池 | ✅ | EnsembleDrafter 10 slot |
| 2.4 | 人性化微调 | ⚠️ | humanize=0.01,仅 Drums 充分 |
| 3.1 | Motif 生命周期 | ✅ | PR #6 修复 'A'→'M' bug |
| 3.2 | 乐句呼吸 | ✅ | CadenceType + 强制休止 |
| 3.3 | 能量曲线 | ✅ | EnergyThresholds 7 级 |
| 4.1 | Kick+Bass 锁定 | ⚠️ | 无显式锚点,靠 GrooveDNA 间接 |
| 4.2 | 切分音收敛 | ❌ | 无 cap 机制 |
| 5.1 | 公共音保留 | ✅ | ChordMask + Viterbi |
| 5.2 | Top Voice 平滑 | ✅ | ChordScoreTable |
| 5.3 | 平行禁忌 | ❌ | 无显式检测 |
| 6.1 | 段落边界平滑 | ✅ | CC7 渐变 + entry delay |
| 6.2 | Turnaround/Fill | ✅ | MotifLooper |
| 6.3 | 能量断崖 | ⚠️ | 有段落类型无自动插入 |
| 7.1 | 增益级联 | ✅ | dB 相对缩放,顺序合规(Vocal+3/Melody 0/Drums+1/Bass-2/Chord-4) |
| 7.2 | 伪侧链 | ⚠️ | Kick-triggered 代码被 needsSidechain=false 硬关闭 (PlaybackEngine:501) |
| 7.3 | 动态声场 | ✅ | CC10/CC74/CC91 |
| 8.1 | PRNG 纯洁度 | ✅ | 零 Math.random |
| 8.2 | 零 GC | ⚠️ | Viterbi/MotifMap 已优化,Orchestrator 仍有分配 |
| 8.3 | ACVE 快照 | ✅ | A/B/C/D 已打点 |
| 9.1 | 双空间分离 | ✅ | K-1 契约 |
| 9.2 | 禁止预补偿 | ✅ | K-4 契约 |
| 9.3 | 后处理空间 | ✅ | K-6 契约 |
| 10.x | 听感验证 | ✅ | Seed Lab 工具就绪 |

### 统计

- **总检查项**: 28(含技术检查,不含 §10 主观验证)
- ✅ 已实现: 20
- ⚠️ 部分实现: 6
- ❌ 缺失: 2

> **V1.1 更新**(2026-04-15 基线审计): 1.4 升级 ✅(m9 已实现)、2.2 降级 ⚠️(记账修正)、7.1 保持 ✅(数值备注修正)、7.2 保持 ⚠️(发现硬关闭)。数字持平,但具体项目归类已同步。完整审计报告见 `docs/audits/2026-04-15_pr7_baseline_audit.md`。

### 主要 tech debt(按优先级)

1. **P0** — 4.2 切分音收敛 cap(可能导致节拍感混乱)
2. **P1** — 1.3 全局 DensityTracker(解决声部拥挤)
3. **P1** — 4.1 Kick 锚点显式传递给 Bass
4. **P2** — 2.4 Humanization 扩展到 Melody/Chord
5. **P2** — 7.2 Kick 触发伪侧链
6. **P2** — 5.3 平行禁忌检测(Pop 风格非 P0)
7. **P3** — 1.4 m9 vs Bass 碰撞检测
8. **P3** — 6.3 能量断崖自动缓冲

---

## 13. 文档维护

- **版本管理**:本文档每次大型架构调整后升级主版本号(V1.0 → V2.0)
- **增补机制**:新增维度时,编号顺延(不修改已有编号,保证历史 PR 审计报告可追溯)
- **基线快照**:每次版本升级时,§12 的状态表必须重新扫描更新
- **与其他文档关系**:
  - `music_generation_pipeline_rule.md` — 管道拓扑硬约束(本文档 §8.x, §9.x 引用)
  - `music_domain_knowledge.md` — 音乐理论知识(本文档 §7.1 增益梯度引用)
  - `todo_plan.md` — tech debt 登记处(本文档 §12 主要 tech debt 导出)
