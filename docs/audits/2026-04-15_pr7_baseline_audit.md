# 审计报告 — 2026-04-15 · PR #7 基线 · V1.0 首次全量审计

> **审计标准文档**: `docs/music_engine_audit_standard.md` V1.0
> **审计范围**: 全部十维 28 项
> **基准 commit**: `38922a8`(PR #7 完成后)
> **涉及 commit**: `b8380bc..38922a8`(PR #1~#7 共 5 次 fix + 2 次 feat)
> **审计执行人**: Claude Opus 4.6(代码侧)+ 用户(听感侧,§10 待填)
> **审计日期**: 2026-04-15
> **方法论**: 4 个 Explore agent 并行代码深挖 + 证据逐项验证

---

## 0. 执行摘要

### 0.1 一句话结论

**PR #1~#7 的 Viterbi 和声管线架构已到位,代码侧 28 项检查通过 20 项,6 项部分实现,2 项缺失。相对审计标准 V1.0 §12 基线有 3 处偏差需同步更新。**

### 0.2 与基线对比的关键偏差(📍 需更新 §12)

| # | 项目 | 基线评级 | 实测评级 | 变动原因 |
|---|------|---------|---------|---------|
| 1.4 | Avoid Notes / m9 检测 | ✅(附"缺 m9") | ✅(m9 已实现) | ToplineEngine:2118,2126 已有 m9 检测,基线注释过时 |
| 2.2 | 节奏模板池碎片化 | ✅ | ⚠️ | RhythmCells 仅按 styleId 分组,未与 energyLevel 交叉(tag 过滤替代) |
| 7.1 | 增益级联 | ✅ | ✅ + ⚠️ 备注 | 实现用 dB 相对缩放(+3/0/+1/-2/-4),非基线列的 118/108/98 绝对值 |
| 7.2 | 伪侧链 | ⚠️ | ⚠️(补充) | **发现 Luis's Fake Sidechain 代码段被 `needsSidechain = false` 硬关闭** — PlaybackEngine.ts:500-537 |

### 0.3 红线项(P0 阻断合并?)

本次为基线审计,无 PR 要合并 → **无红线**。但记录以下 tech debt 需进入 todo_plan:

| 优先级 | 项目 | 说明 |
|-------|------|------|
| **P0** | 4.2 切分音收敛 cap | 无连续反拍约束,听感层反映过 "节拍感混乱" |
| **P1** | 1.3 全局 DensityTracker | 声部拥挤靠听感,无代码层统计 |
| **P1** | 4.1 Kick 锚点显式传递 | Bass 不接收 kickAnchors 参数,只能靠 GrooveDNA 间接同步 |
| **P1** | 7.2 伪侧链唤醒 | 代码已写但被 `needsSidechain=false` 禁用,一行改动即可启用 |
| **P2** | 2.4 Humanization 扩展 | humanize=0.01 过低,melody/chord 缺独立 velocity 随机 |
| **P2** | 5.3 平行禁忌检测 | 完全缺失,Pop 非 P0 |
| **P2** | 6.3 能量断崖自动缓冲 | SectionType 有枚举,无自动插入 |
| **P3** | 8.2 Orchestrator 零 GC | 安排层多处 `.push()` / `[...spread]`,核心 Viterbi 已优化 |

---

## 1. 维度一:纵向和声与声部协同

### 1.1 全局和声下发 ✅

- **证据**: `harmony/HarmonyPipeline.ts:171-177` — `generateHarmonyViaPipeline()` 单一入口
  ```typescript
  export function generateHarmonyViaPipeline(
      sections: SectionMetadata[],
      tonality: Tonality,
      timeSignature: [number, number],
  ): GeneratedChord[] {
      return _runPipeline(sections, tonality, timeSignature).chords;
  }
  ```
- **旁路扫描**: `grep "new HarmonyPipeline\|ViterbiChordSelector" src/core/generation/` 仅命中 HarmonyPipeline 内部
- **发现**: 符合 §1.1 全部三条硬约束。所有声部通过 `GeneratedChord[]` 显式参数接收和弦,无全局旁路。

### 1.2 频段隔离 ✅

- **证据**:
  - `arrangement/TextureMapper.ts:9-13` — `clampToRange()` while-loop 八度调整
  - `config/InstrumentFlags.ts:339-387` — `InstrumentProfiles.safeRange` 查表(Bass 28-43、Violin 55-84、Flute 60-84、Pad 48-72)
  - `composing/ToplineEngine.ts:2569-2574, 2023-2024` — Climax 和 Melisma 路径**结束前最终 clamp**(PR #5 教训)
- **发现**: 完整实现,PR #5 D7 pitch 逃逸已修复。

### 1.3 节奏互锁 / Hocketing ⚠️

- **证据**:
  - `arrangement/TextureMapper.ts:336` — CounterMelody 存在三模式
  - `arrangement/TextureMapper.ts:449` — `generateSecondaryFillLine` 在主旋律休止窗口(gap ≥ 1 拍)中填补
- **缺口**: **未找到全局 DensityTracker** — 主旋律密集时 CounterMelody fallback 依赖生成时序,无实时 onset 统计
- **发现**: 与基线一致 ⚠️。Call-and-Response 作为**发声时机互斥**起作用,但无 onset 总量限制。

### 1.4 Avoid Notes 与和弦外音碰撞 ✅ 📍

- **证据**:
  - `composing/ToplineEngine.ts:1845-1846` — 强拍/长音强制吸附和弦内音
  - `composing/ToplineEngine.ts:1984-2012` — PR #7 半音 crash 过滤(仅 `minSemitoneDist === 1` 时降级,保留 9/13 tension)
  - `composing/ToplineEngine.ts:2118, 2126` — **m9(小九度)检测已存在**(chromatic lead + Bebop 路径)
  - `harmony/ViterbiChordSelector.ts:146` — `W_TOP_VOICE=3`
- **📍 基线偏差**: §12 原备注"缺 m9 vs Bass 检测"过时,应移除。m9 检测实际已在 ToplineEngine 的两个路径实现。
- **发现**: 升级至完整 ✅。

---

## 2. 维度二:多样性与反固化

### 2.1 和弦池深度 ✅

- **证据**: `harmony/CandidatePool.ts:41-86` 共 28 候选
  - 6 自然三和弦 + 6 七和弦 + 4 高级色彩 + **4 Secondary Dominants(V/V、V/vi、V/ii、V/iii)** + **4 Modal Mixture(bIII、bVI、bVII、iv)** + 4 sus/dim
  - `functionalBonus`: Secondary +2,Modal Mixture +3
- **Viterbi 权重**: `W_FUNCTIONAL=8`,`W_REPEAT_PENALTY=-10`,`W_COMPLEXITY_TAX=-1`(PR #1 平衡)
- **发现**: 完整。Tritone Substitution 未显式列出但 bVII 可代理,后续可考虑 PR #8。

### 2.2 节奏模板池碎片化 ⚠️ 📍

- **证据**: `melody/RhythmCells.ts:6-58` — 按风格分组(`PopRhythmCells` / `FunkRhythmCells` / `JazzRhythmCells` / ...),**无 styleId × energyLevel 交叉维度**
- `melody/RhythmCells.ts:66-76` — `getRandomRhythmCell()` 按 `energyLevel < LOW_MAX` 过滤带 `fast` tag 的 cell
- **📍 基线偏差**: §12 原评 ✅,实际是 tag 驱动而非交叉表。从 ✅ 降级为 ⚠️。
- **备注**: tag 过滤实用性足够,不是 bug,但记账上要反映真实结构。未找到整小节硬编码 `[0, 0.5, 1, 1.5, ...]`,合规。

### 2.3 乐器随机池 ✅

- **证据**: `arrangement/EnsembleDrafter.ts:6-79`
  - **精确消耗 10 PRNG slot**(melody/secondary/chord/bass/drums/counterMelody 各 1-2)
  - `EnsembleDrafter.ts:21-44` — Secondary 强制 Plucked 约束(从 `melodyPool` 筛选 `AcousticEnvelope.Plucked`)
- **发现**: 完整。

### 2.4 人性化微调 ⚠️

- **证据**:
  - `config/styles/StyleRegistry.ts:70` — `humanize: 0.01`(极低)
  - `composing/ToplineEngine.ts:2263` — velocity 在高音段(>72)按 0.012/半音递减
  - **Drums 充分随机化**(TextureMapper drum 生成内有独立 jitter)
- **缺口**: Melody / Chord / Bass 缺独立 velocity 随机化模块,全局靠 0.01 humanize 微调
- **发现**: 与基线一致 ⚠️,列为 P2 tech debt。

---

## 3. 维度三:横向曲式与旋律发展

### 3.1 Motif 生命周期 ✅

- **证据**:
  - `composing/ToplineEngine.ts:23-57` — **MotifMap 线性数组实现**(C 可移植)
  - `composing/ToplineEngine.ts:454` — `primaryMotifKey = 'M'`,PR #6 'A'→'M' bug 已彻底修复
  - `arrangement/MotifLooper.ts:5-77` — `loopMotif()` AABA 硬编码(`phraseIndex % 4`)
  ```typescript
  class MotifMap {
      private entries: { key: string; value: MotifTemplate }[] = [];
      get(key: string): MotifTemplate | undefined {
          for (let i = 0; i < this.entries.length; i++) {
              if (this.entries[i].key === key) return this.entries[i].value;
          }
      }
  }
  ```
- **发现**: 完整 ✅。PR #6 的 slot key 一致性已验证,chorusMotifs.get() 在 L466/483/493 全部统一用 'M'。

### 3.2 乐句呼吸与休止符 ✅

- **证据**:
  - `types.ts:134-137` — `CadenceType` 枚举(Open=0 / Closed=1)
  - `composing/ToplineEngine.ts:290-292` — 群组末尾 `isLastGroup` 强制 `CadenceType.Closed`,否则偶数群组 Open
  - `arrangement/TransitionEngine.ts:22-48` — `injectDrumFill` 在 Verse→Chorus 转折处
- **发现**: 完整 ✅。符合预期的"无硬约束休止,靠 RhythmCells 权重间接达成"。

### 3.3 宏观能量曲线 ✅

- **证据**:
  - `config/EnergyThresholds.ts:16-37` — 7 级阈值(`SILENT_MAX=2` 至 `PEAK_MIN=8`)
  - `arrangement/TextureMapper.ts:65` — Bass step: `energyLevel >= HIGH_MIN(7) ? 1 : 2`
  - `composing/StructureEngine.ts:54-100` — 标准模板明确分配 Intro:4、Verse:4-5、Chorus:8-9、Outro 递减
- **发现**: 完整 ✅。

---

## 4. 维度四:律动与地基

### 4.1 Kick & Bass 锁定 ⚠️

- **证据**: `arrangement/TextureMapper.ts:22-31` — `generateBassLine()` 完整签名
  ```typescript
  public static generateBassLine(
      chord: GeneratedChord,
      energyLevel: number,
      isSparseSection: boolean = false,
      isSectionEnd: boolean = false,
      melodyNotes: NoteData[] = [],
      isBassSolo: boolean = false,
      nextChord?: GeneratedChord,
      nextEnergyLevel: number = 3,
  ): NoteData[]
  ```
- **关键缺口**: **不接收 `kickAnchors: number[]` 参数**,Bass 强拍与 Kick 重合完全靠 GrooveDNA 间接同步
- **发现**: 与基线一致 ⚠️。登记为 **P1 tech debt**(显式传递 Kick 锚点)。

### 4.2 切分音收敛 ❌

- **证据**:
  - `composing/GrooveEngine.ts:46-64` — `syncopationProb` 完全驱动切分概率,**无 cap**
    ```typescript
    if (isOnOffbeat(stepPos)) {
        baseWeight = 0.6 + syncopationProb * 0.4;
    } else if (syncopationProb >= 0.7) {
        baseWeight = 0.4 + syncopationProb * 0.3;
    }
    ```
  - 全文 grep `syncopation|offBeat|off_beat|offbeatCap`:无 cap 逻辑
- **发现**: **P0 tech debt**。听感层多次反馈"节拍感混乱"可能源于此。建议 PR #8 候选。

---

## 5. 维度五:声部引导 (Voice Leading)

### 5.1 公共音保留 ✅

- **证据**:
  - `harmony/ChordMask.ts:66-68` — `commonTones(a, b) = popcount12(a & b)`(bitmask SWAR)
  - `harmony/ViterbiChordSelector.ts:149-150` — `W_VOICE_LEADING=2`, `VOICE_LEADING_CAP=3`
  - `ViterbiChordSelector.ts:206-208` — `voiceLeading = ct > CAP ? CAP : ct`(防 self-loop 坍塌)

### 5.2 Top Voice 平滑 ✅

- **证据**:
  - `harmony/ChordScoreTable.ts:41-104` — `SCORE_TABLE` 17×12 二维数组,值域 [-4, +4]
  - `ChordScoreTable.ts:124-141` — **编译期自检**(throw if length != 17 / row.length != 12)
  - `topVoiceScore()` 函数签名 L111-118 — O(1) 查表

### 5.3 平行禁忌 ❌

- **证据**: grep `parallelFifth|parallelOctave|parallel5|P5|P8|平行五度` → 仅 HarmonyCore.ts 的注释/数据,**无主动检测代码**
- **发现**: ToplineEngine + TextureMapper 独立生成,理论上可能出现主旋律 + Bass 连续平行五度。Pop 风格容忍度高,**P2 tech debt**,未来若加 Jazz/Classical 风格必须补齐。

---

## 6. 维度六:段落衔接与转场

### 6.1 段落边界平滑 ✅

- **证据**:
  - `audio/PlaybackEngine.ts:382-391` — 非鼓组段落开头 4 步 CC7 从 `vol*0.6` 渐至 `vol*1.0`
  - `arrangement/Orchestrator.ts:367` — Verse bass entry delay **15%**(PR #5 修复后的值)

### 6.2 Turnaround 与 Fill ✅

- **证据**:
  - `arrangement/MotifLooper.ts:39-55` — `phraseIndex % 4` 驱动:
    - `phraseIndex === 2`(B 段)→ `pitch += 5`(上行四度)
    - `phraseIndex === 3`(Turnaround)→ `pitch -= 7`(下行五度)
  - `arrangement/TransitionEngine.ts:22-263` — `injectDrumFill` 多种 fill pattern + 能量感知

### 6.3 能量断崖检测 ⚠️

- **证据**:
  - `types.ts` — `SectionType.BuildUp=8` / `Breakdown=7` 枚举存在
  - `arrangement/TransitionEngine.ts:320-322` — 仅在 `sec.name.includes('BuildUp')` 时注入 epic buildup,**无自动检测**
- **缺口**: 无 `if (nextEnergy - curEnergy > 4) insertBuildUp()` 这类主动断崖检测
- **发现**: 与基线一致 ⚠️,P2 tech debt。

---

## 7. 维度七:伪混音 (MIDI CC)

### 7.1 初始增益级联 ✅ 📍

- **证据**: `config/styles/StyleRegistry.ts` — 各 role dB 配置:
  | Role | dB | ≈ CC7 |
  |------|-----|-------|
  | Vocal | +3 | ~100 |
  | Melody | 0 | ~80 |
  | Drums | +1 | ~89 |
  | Bass | -2 | ~64 |
  | Chord | -4 | ~50 |
  | CounterMelody | -4 | ~50 |
- **计算公式**: `PlaybackEngine.ts:376` — `Math.round(80 * Math.pow(10, dB / 20))`
- **📍 基线偏差**: §7.1 基线写的是 `Vocal(118) > Melody(118) > Drums(108) > Bass(98) > Chord(85) > CounterMelody(60)` — 那是来自 `music_domain_knowledge.md` 的**理想梯度**。实际实现用 dB 相对缩放,顺序一致但数值略低。**建议** `music_engine_audit_standard.md §7.1` 改为"顺序约束 + 实现用 dB 缩放"。
- **发现**: 顺序合规 ✅,但数值与基线表不一致,需同步文档。

### 7.2 伪侧链 (Kick-Triggered Sidechain) ⚠️ 📍

- **证据**:
  - `audio/PlaybackEngine.ts:441-469` — CC11 呼吸包络 40→90→30,仅对 `needsCC11` 乐器(counterMelody / secondaryMelody)
  - **`audio/PlaybackEngine.ts:500-503`** — 发现关键代码:
    ```typescript
    const needsSidechain = false;  // 💡 硬关闭!
    if (needsSidechain && song.drums) {
        song.drums.forEach(n => {
            const isKick = n.pitch === 35 || n.pitch === 36;
            // ... Kick-triggered CC11 注入代码
    ```
- **📍 基线偏差**: §12 原评 ⚠️,实际情况更精确:**Luis's Fake Sidechain 代码段已存在,但被 `needsSidechain = false` 硬关闭**
- **发现**: 升级 P1 tech debt(一行 `true` 即可启用测试)。需要先验证 CC11 与长音呼吸包络不冲突。

### 7.3 动态声场 ✅

- **证据**:
  - `audio/PlaybackEngine.ts:374-380` — `spread = (energyLevel-1) / 7`,CC10 Pan 和 CC91 Reverb 按 spread 动态分配
  - `PlaybackEngine.ts:572-574` — Intro Filter Sweep CC74 线性 20→127
- **发现**: 完整 ✅。

---

## 8. 维度八:决定论与底层合规

### 8.1 PRNG 纯洁度 ✅

- **执行**: `grep -rn "Math\.random\|Date\.now\|performance\.now" src/core/generation/`
- **结果**: 生成管道下**零命中**
- **音频层命中**(合规): `audio/MidiScheduler.ts:72,203` 使用 `performance.now` 仅用于播放计时
- **LCG 常数**: `utils/PRNG.ts:29-31` — `a=1664525, c=1013904223, m=2^32` ✓
- **发现**: 完整合规 ✅。

### 8.2 零 GC 压力 ⚠️

- **核心层 ✅**:
  - `harmony/ViterbiChordSelector.ts:138-140` — `Int32Array(MAX_N*MAX_K)` DP + `Uint8Array(MAX_N*MAX_K)` PATH
  - `MAX_N=32, MAX_K=40`(预分配 51K 转移评分预算)
  - `ToplineEngine.MotifMap` 线性数组(entries:{key,value}[],非 ES Map)
- **安排层 ⚠️**: `Orchestrator.ts` 多处 `.push()` 与 `[...spread]`(L245, 262, 469, 555, 560, 599, 610, 614, 616, 643, 693, 694, 716, 839, 910)
- **发现**: 分层评级 — 核心严格,安排层可接受(非 MIDI 生成路径热点)。P3 tech debt。

### 8.3 ACVE 快照完整性 ✅

- **四快照点全部打点**:
  - **A**: `apps/AuraRadio/EndlessRadioManager.ts:102`, `apps/AuraBar/EndlessRadioManager.ts:446`, `components/SeedController.tsx:84`
  - **B**: `core/generation/MelodyEngine.ts:23`(generateFullSong 入口)
  - **C**: `core/generation/arrangement/Orchestrator.ts:74`(arrange 入口)
  - **D**: `core/audio/PlaybackEngine.ts:74`(loadSong 入口)
- **实现**: `utils/PRNG.ts:61-70` `recordSnapshot` / `getSnapshot`
- **发现**: 完整合规 ✅,§5.1 四点绑定不可移动。

---

## 9. 维度九:Pitch Space 契约

### 9.1 双空间分离 ✅

- **执行**: `grep -rn "keyOffset" src/core/generation/` 全量 27 处
- **合法读取**:
  - `arrangement/Orchestrator.ts:864-865` — **唯一 applyOffset 转换点**
    ```typescript
    const finalKeyOffset = track.keyOffset || 0;
    const applyOffset = (notes: NoteData[]) => {
        notes.forEach(n => {
            const chordKeyOffset = activeChord.keyOffset !== undefined
                ? activeChord.keyOffset : finalKeyOffset;
            n.pitch += chordKeyOffset;
        });
    };
    ```
  - `GlobalContext.initializeNewEra` — 初始化时赋值(合规)
  - `GeneratedTrack.keyOffset` / `GeneratedChord.keyOffset` 字段传递(合规)
- **生成阶段零读**: MelodyEngine / HarmonyCore / ToplineEngine 均未读 keyOffset
- **发现**: K-1~K-3 完整合规 ✅。

### 9.2 禁止预补偿 ✅

- **执行**: 全文搜索 `targetCenter - keyOffset` / `center - keyOffset` → **零结果**
- **证据**: `Orchestrator.ts:598, 609, 629` 有明确注释 `// K-4: 禁止预补偿 keyOffset,由 applyOffset() 统一处理`
- **发现**: PR #3~#5 清理彻底,零违规。

### 9.3 后处理空间声明 ✅

- **证据**:
  - `GlobalReviewer.ts:103-104` — 接收 ABSOLUTE pitch 后,调用 HarmonyCore 时用 `note.pitch % 12` 桥接到 pitch class
  - `HarmonyCore.ts:93` — `getChordTones()` 签名上方注释标注 RELATIVE 返回
  - `ToplineEngine.ts:1633` — 新函数带 "相对空间" 注释
- **发现**: K-6/K-7 完整合规 ✅。

---

## 10. 维度十:听感主观验证协议

### 10.1 Seed Lab 工具完备性 ✅

- **证据**:
  - `components/SeedController.tsx` 242 行(PR #6 后实现)
  - 复现 `EndlessRadioManager` 的 PRNG 序列(`setSeed → recordSnapshot('A') → next() for style`)
  - 7 个 mute toggles(Vocal/Melody/Secondary/Counter/Chord/Bass/Drums)
  - Loop 播放(activeSeedRef + playStateRef 防闭包陈旧)
  - `AudioEngine.setPartMute(partName, mute)` + `PlaybackEngine.getPartChannel()` 动态通道映射
- **发现**: 工具链完备,可执行 §10.1~§10.4 全部主观验证。

### 10.2~10.4 主观听感打分 ⏸️ 待用户执行

本次为代码侧基线审计,主观听感部分需用户用 Seed Lab 执行。建议的固定 seed 池:

```
固定核心: 42, 12345, 2332053069, 88888888, 1, 999
历史反馈好听: (PR #6/#7 测试期间用户标记的 seed)
历史反馈有问题: (PR #4 曾报告过的 seed)
```

**待用户填写的表格**(按 §10.3 五维评分 1-5):

| Seed | Catchy | Flow | Balance | Groove | Variety | 均值 |
|------|--------|------|---------|--------|---------|------|
| 42   | ?      | ?    | ?       | ?      | ?       | ?    |
| 12345| ?      | ?    | ?       | ?      | ?       | ?    |
| ...  | ?      | ?    | ?       | ?      | ?       | ?    |

**合格线**: 10 seed 5 维平均 ≥ 3.5,任何单维度 < 2.5 视为回归。

---

## 11. 维度最终状态表(本次审计结果)

| # | 检查项 | 基线 §12 | 本次实测 | 证据 |
|---|--------|---------|---------|------|
| 1.1 | 全局和声下发 | ✅ | ✅ | HarmonyPipeline 单一入口 |
| 1.2 | 频段隔离 | ✅ | ✅ | clampToRange + InstrumentProfiles |
| 1.3 | 节奏互锁 | ⚠️ | ⚠️ | 无全局 DensityTracker |
| 1.4 | Avoid Notes | ✅ | **✅** 📍 | m9 检测已在 ToplineEngine:2118,2126 实现 |
| 2.1 | 和弦池深度 | ✅ | ✅ | 28 候选 + Viterbi |
| 2.2 | 节奏碎片化 | ✅ | **⚠️** 📍 | 仅 styleId 分组 + tag 过滤,无 styleId×energyLevel 交叉 |
| 2.3 | 乐器随机池 | ✅ | ✅ | EnsembleDrafter 10 slot |
| 2.4 | 人性化微调 | ⚠️ | ⚠️ | humanize=0.01, Drums only |
| 3.1 | Motif 生命周期 | ✅ | ✅ | MotifMap 线性 + AABA 硬编码 |
| 3.2 | 乐句呼吸 | ✅ | ✅ | CadenceType + TransitionEngine |
| 3.3 | 能量曲线 | ✅ | ✅ | 7 级 + 动态 step |
| 4.1 | Kick+Bass 锁定 | ⚠️ | ⚠️ | 不接收 kickAnchors 参数 |
| 4.2 | 切分音收敛 | ❌ | ❌ | 无 cap |
| 5.1 | 公共音保留 | ✅ | ✅ | bitmask popcount |
| 5.2 | Top Voice 平滑 | ✅ | ✅ | 17×12 SCORE_TABLE |
| 5.3 | 平行禁忌 | ❌ | ❌ | 无检测 |
| 6.1 | 边界平滑 | ✅ | ✅ | CC7 渐变 + 15% delay |
| 6.2 | Turnaround/Fill | ✅ | ✅ | MotifLooper + TransitionEngine |
| 6.3 | 能量断崖 | ⚠️ | ⚠️ | 无自动插入 |
| 7.1 | 增益级联 | ✅ | **✅** 📍 | dB 相对缩放,顺序合规但数值与基线表不符 |
| 7.2 | 伪侧链 | ⚠️ | **⚠️** 📍 | **发现 needsSidechain=false 硬关闭** |
| 7.3 | 动态声场 | ✅ | ✅ | CC10/CC74/CC91 完整 |
| 8.1 | PRNG 纯洁度 | ✅ | ✅ | 零命中 |
| 8.2 | 零 GC | ⚠️ | ⚠️ | 核心严格,安排层可接受 |
| 8.3 | ACVE 快照 | ✅ | ✅ | A/B/C/D 全部打点 |
| 9.1 | 双空间分离 | ✅ | ✅ | applyOffset 唯一转换 |
| 9.2 | 禁止预补偿 | ✅ | ✅ | 零残留 |
| 9.3 | 后处理空间 | ✅ | ✅ | K-6/K-7 合规 |
| 10.1 | Seed Lab | ✅ | ✅ | SeedController 就绪 |

### 11.1 统计

| | 代码检查项(28) | §10.x 主观(待填) |
|---|---|---|
| ✅ 已实现 | **20** | 1.1 就绪 |
| ⚠️ 部分 | **6** | 待用户执行 |
| ❌ 缺失 | **2** | - |
| **基线偏差 📍** | **4** | - |

---

## 12. Tech Debt 登记(导出到 todo_plan.md)

```
[P0] 4.2 切分音收敛 cap         — 连续反拍 onset ≤ 2 后强制回正拍
[P1] 1.3 全局 DensityTracker   — 跨声部 onset 统计 + 超阈值触发 Pad fallback
[P1] 4.1 Kick 锚点显式传递      — DrumEngine 生成 kickAnchorList → TextureMapper.generateBassLine
[P1] 7.2 伪侧链唤醒             — PlaybackEngine:501 needsSidechain 改 true + 验证 CC11 不冲突
[P2] 2.4 Humanization 扩展      — Melody/Chord velocity 独立随机,humanize 从 0.01 提升
[P2] 5.3 平行禁忌检测           — Pop 风格非 P0,Jazz/Classical 风格必须
[P2] 6.3 能量断崖自动缓冲        — if (nextEnergy - curEnergy > 4) insertBuildUp()
[P3] 8.2 Orchestrator 零 GC     — 安排层 .push / [...spread] 清理
```

## 13. 审计标准文档 V1.0 → V1.1 变更建议

基于本次审计发现的 4 处基线偏差,建议对 `docs/music_engine_audit_standard.md` 执行以下更新:

1. **§1.4 当前状态** — 移除"缺少 m9 vs Bass 检测"备注,改为 ✅ 完整
2. **§2.2 当前状态** — 从 ✅ 改为 ⚠️,注明"按 styleId 分组 + tag 过滤,无 styleId×energyLevel 交叉"
3. **§7.1 硬约束** — 数值从 `Vocal(118) > Melody(118) > ...` 改为"**顺序约束**: Vocal ≥ Melody ≥ Drums > Bass > Chord ≥ CounterMelody",实际 dB 数值写入"实现备注"
4. **§7.2 当前状态** — 补充"**已发现 Kick-triggered 代码段存在但被 `needsSidechain=false` 硬关闭**,启用需一行改动 + 侧链不冲突验证"
5. **§12 状态快照表** — 同步上述 4 处更新,并刷新统计数字

## 14. ACVE 快照验证(本次审计未执行)

本次为**静态代码审计**,未运行运行时 ACVE 验证。建议下一次 PR 合并前执行:

```
seed = 42, 12345
期望: stateA/B/C/D 四个快照与历史录制值严格相等
执行方式: 用 Seed Lab 播放 seed → 从 console log 读取 PRNG state → 与 2026-04-15 录制值对比
```

**待录制**: 42 / 12345 两个 seed 的四快照基线值,存入 `docs/audits/acve_snapshots_2026-04-15.json`。

---

## 15. Reviewer 签收

- **代码侧 Reviewer**: Claude Opus 4.6
- **结论**: 代码侧 ✅ 通过基线审计。20/28 项合规,无红线,8 项 tech debt 已登记。
- **听感侧 Reviewer**: 用户(待执行 §10.2~§10.4)
- **审计标准版本**: V1.0 → 建议升级至 V1.1 同步 4 处基线偏差
- **下次审计触发**: PR #8 合并前

---

## 附录 A:审计执行元数据

- **Agent 分组**: 4 个并行 Explore agent
  - Agent A(维度 1+2):`ae3787dbcc369bebe` · 39 tool uses · 85 秒 · 71K tokens
  - Agent B(维度 3+4):`a7029155797171daa` · 24 tool uses · 64 秒 · 52K tokens
  - Agent C(维度 5+6+7):`a9866197cd2fb7e48` · 40 tool uses · 108 秒 · 62K tokens
  - Agent D(维度 8+9):`a5fd283665c8900e9` · 38 tool uses · 64 秒 · 38K tokens
- **总调研时长**: 约 108 秒(并行)
- **总 tool use**: 141 次(Grep / Read / Bash 综合)
- **证据总字数**: 约 6200 字(agent 原始输出)
