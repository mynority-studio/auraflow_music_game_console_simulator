# 主旋律生成完整逻辑文档

> **生成时间**：2026-04-16
> **目的**：为外部音乐 / 算法专家审阅当前主旋律生成的全部决策链路
> **作者视角**：算法工程师，整理自代码（MelodyEngine + ToplineEngine + AnchorDecisionStage 等共 ~3700 行）
> **核心问题**：旋律"局部合规但全局不像人写的"——本文档是为了让外部专家定位这种"黑盒"提供完整 context

---

## 0. TL;DR — 看一眼就能懂

主旋律生成 = **13 阶段确定性流水线**，从一个 32-bit seed 推导出全曲所有音符。

```
seed → PRNG.setSeed
  ① 抽 mood / bpm / keyOffset / tonality / timeSignature
  ② StructureEngine 生成段落序列（Verse-Chorus-...-Outro）
  ③ HarmonyEngine / Viterbi 生成全曲和弦（罗马数字 → 绝对音）
  ④ P5f：扫和弦 chord tones 反推真实 tonality（修复 minor pool ↔ major chord 不匹配）
  ⑤ EnsembleDrafter 抽乐器编制
  ⑥ ToplineEngine.generateTrackMelody —— 主旋律核心
       ⑥a 提取 firstChorus 的 motifs + phraseGroups（跑一次 generateMotifsOnly=true）
       ⑥b 按 section 顺序生成（Chorus 复用 / Verse 简化 / PreChorus 插值 / Outro 碎裂化）
       ⑥c generateSectionMelody → realizeMotif（per slot）
            - 节奏 anticipation
            - rest window
            - pitch contour（Ascending/Arch/Bowl/...）
            - chord tone 偏好 + Pentatonic Gap + Pentatonic Shift
            - maxJump clamp
            - Meyer's Leap rule
            - 同音反复（anchorProbability）
            - chord boundary chromatic approach
            - 装饰音（grace/neighbor/trill/chromatic approach/appoggiatura）
            - humanize timing & velocity
  ⑦ 跑 reharmonize（仅 useViterbi=false 时）
  ⑧ GlobalReviewer.reviewAndFix（Phase 1）：修悬挂高张力和弦 + 乐句末未解决 + 极端大跳
  ⑨ P5a/b/c cleanMelodyPostProcessing：大跳 clamp + 三全音/大七度拦截 + 同音 4 连强制变化
  ⑩ AnchorDecisionStage.annotate（按 section）：标 anchor + snap 到和弦音
  ⑪ Orchestrator.arrange：Phase 2 counterpoint + applyOffset + absoluteClampHigh + humanize
  → 最终 NoteData[]（绝对空间）
```

**确定性**：相同 seed → 相同 melody（PRNG 全局唯一可变状态）。

**当前已知问题**（按严重度排序）：
1. **缺失全局意图（Global Intent）**：每个音"局部合规"但乐句没有目的地，像盲人走斑马线
2. **动机变换深度不足**：transformMotif 存在但触发条件少，副歌之间的"主题发展"不强
3. **张力曲线无显式规划**：力度/Rubato/音高 jitter 是三个独立随机过程，没有统一的"弱起→推进→收尾"曲线
4. **反向寻路（Backward Pathfinding）未实现**：算法是"顺向逐音生成"，每一步都对，但没有"为了到达 X 而铺垫"

---

## 1. 模块职责清单

| 文件 | 行数 | 主要职责 | 关键类/函数 |
|---|---|---|---|
| `src/core/generation/MelodyEngine.ts` | 354 | 顶层入口，编排 13 阶段 | `MelodyEngine.generateFullSong()` |
| `src/core/generation/composing/ToplineEngine.ts` | 2750 | **主旋律生成核心**（90% 的"音乐性逻辑"在这里） | `ToplineEngine.generateTrackMelody()`、`generateSectionMelody()`、`realizeMotif()`；内嵌私有类 `PhraseGroupPlanner` |
| `src/core/generation/composing/AnchorDecisionStage.ts` | 195 | 标"关键音"+ snap 到和弦音 | `AnchorDecisionStage.annotate()` |
| `src/core/generation/composing/HarmonyCore.ts` | ~1100 | 和弦解析、和弦音、安全音阶 | `HarmonyCore.parseRomanNumeral()`、`getChordTones()`、`getSafeScalePitches()`、`snapToScale()`、`shiftDiatonic()` |
| `src/core/generation/composing/StructureEngine.ts` | ~250 | 段落序列规划（Verse-Chorus-...） | `StructureEngine.generateFullSongStructure()` |
| `src/core/generation/composing/GrooveEngine.ts` | ~300 | 节奏指纹（grooveDNA）生成 | `GrooveEngine.generateRhythmFingerprint()` |
| `src/core/generation/composing/MusicTheoryRules.ts` | ~150 | 和弦功能分类（T/S/D） | `MusicTheoryRules.getChordFunction()` |
| `src/core/generation/review/GlobalReviewer.ts` | 372 | 全局检查与修复 | `reviewAndFix()`（Phase 1）、`reviewCounterpoint()`、`reviewParallelMotion()`（Phase 2，在 Orchestrator 调用） |
| `src/core/generation/config/styles/StyleRegistry.ts` | ~250 | 风格配置（chord pool、density、density 等所有可调参数） | `DefaultStyleConfig` |
| `src/core/generation/types.ts` | ~600 | 数据契约：NoteData、MotifTemplate、PhraseGroup、SubMotifSlot 等 | — |
| `src/core/generation/utils/PRNG.ts` | ~80 | LCG 伪随机数 | `PRNGManager` |
| `src/core/generation/arrangement/Orchestrator.ts` | ~1200 | 编配（伴奏、应用 keyOffset、混音、Phase 2 review） | `Orchestrator.arrange()` |

---

## 2. 关键数据结构

### 2.1 NoteData（最终音符）

```typescript
interface NoteData {
    pitch: number;        // MIDI 0-127
                          // ★ 在生成管道内是 RELATIVE 空间（C=60 为参考中心）
                          // ★ Orchestrator.applyOffset() 后才加 keyOffset 进入 ABSOLUTE 空间
    onset: number;        // 起始拍位（拍）
    duration: number;     // 时长（拍）
    velocity: number;     // 力度 0.0-1.0
    isGraceNote?: boolean;   // 装饰音标记（grace/neighbor 等）
    isUserMotif?: boolean;
    isAnchor?: boolean;      // 关键音标记（AnchorDecisionStage 写入）
    pitchBend?: number;
    pitchBendDuration?: number;
    fadeOutDuration?: number;
}
```

### 2.2 MotifTemplate（动机模板）

```typescript
interface MotifTemplate {
    rhythm: { pickup: number[]; body: number[]; tail: number[] };  // 三段式节奏
    rhythmOffsets: number[];   // 完整节奏（pickup + body + tail）
    relativePitches?: number[]; // 相对 targetCenter 的预计算音高轮廓
    contour: 'Ascending' | 'Descending' | 'Arch' | 'Bowl' | 'Static' | 'Wandering';
    noteCount: number;
    phraseLengthBeats: number;
    pickupShape?: 'ascending' | 'descending' | 'held' | 'zigzag';
    isMutated?: boolean;
    anchors?: { bodyStartPitch?: number };
}
```

### 2.3 PhraseGroup（大乐句容器）

```typescript
interface PhraseGroup {
    startBeat: number;          // 全曲绝对拍位
    lengthBeats: number;        // 长度（拍）= lengthBars × beatsPerBar
    subMotifs: SubMotifSlot[];  // 子动机槽位序列（4-8 个）
    cadenceType: CadenceType;   // Open(半终止) / Closed(全终止)
    hookPlan?: HookPlan;        // 仅 Chorus 设置：标记 peak slot
    formLabel?: string;         // 'M-M-N-M_prime' 等，调试用
}

interface SubMotifSlot {
    label: string;              // 'M' | 'M_prime' | 'N' | 'M_resolve' 等（共享 label = 共享 motif 模板）
    role: 'statement' | 'repeat' | 'vary' | 'contrast' | 'resolve' | 'climax';
    lengthBars: number;
    isPeak?: boolean;
    pitchShift?: number;
}
```

---

## 3. Pipeline 详解（13 阶段）

### 阶段 ①：抽参数（MelodyEngine.ts:22-87）

```typescript
// PRNG 消耗顺序固定，不可改变（PRNG 确定性约束）：
1. moodId        = mood pool 加权抽
2. baseBpm       = bpmRange 内随机
3. bpm           = baseBpm × mood.bpmMultiplier
4. keyOffset     = 0~11 随机
5. tonality      = tonalityPool 加权抽（Major / Minor / Dorian / Mixolydian / Pentatonic 等）
6. timeSig       = 通常 4/4
```

**关键**：`tonality` 在这里决定，但**和弦池的罗马数字是用 major 习惯写的**（见阶段 ④ 的 bug）。

### 阶段 ②：StructureEngine（StructureEngine.ts）

从 `style.global.structureTemplates` 抽一个段落序列模板，例如：
```
[Intro, Verse_1, PreChorus_1, Chorus_1, Verse_2, PreChorus_2, Chorus_Main, Bridge, Chorus_Epic, Outro]
```
每个 SectionMetadata 包含：
- `name`（'Verse_1'）
- `sectionType`（SectionType.Verse 数值枚举）
- `startBeat`、`endBeat`
- `lengthBars`
- `energyLevel`（1-10）
- `grooveDNA`（节奏指纹，由 GrooveEngine 生成）

### 阶段 ③：HarmonyEngine 和弦生成（HarmonyCore.ts:651+）

两条管线（按 `style.useViterbiHarmony` 切换）：

**A. 旧版 `generateHarmonyTimeline`**（全局 chord pool 抽签）
- 从 `style.harmony.chorusPool / versePool / preChorusPool` 各抽一个进行
- `generateDynamicProgression()` 决定是否插入借调和弦（passing chords）
- 每个段落的进行是**独立**的（除非 `globalProgressionProbability` 触发，则全曲共用一套）

**B. 新版 Viterbi 管线**（`generateHarmonyViaPipeline`）
- Phase 1：生成 ShadowSlot 影子骨架（每小节一个功能槽 T/S/D）
- Phase 2：根据骨架旋律生成候选 chord
- Phase 3：Viterbi 选最优 voice leading 序列

罗马数字用 `HarmonyCore.parseRomanNumeral` 解析为 `{root: number, quality: ChordQuality}`。

### 阶段 ④：P5f tonality 反推（MelodyEngine.ts:101-130）

**为什么要这一步**：和弦池里的小写罗马数字（vi、iii、vii）在 minor 调下不被 `parseRomanNumeral` 自动降半音，导致 tonality=Minor 但 chord 实际是 major 风格。

**做法**：扫所有 chord 的 chord tones，统计：
- `pc=4`（major 3）vs `pc=3`（minor 3）
- `pc=9`（major 6）vs `pc=8`（minor 6）
- `pc=11`（major 7）vs `pc=10`（minor 7）

如果 major 票数 > minor × 1.5 但原 tonality 是 minor 系，覆盖为 Major（反之亦然）。

### 阶段 ⑤：EnsembleDrafter（EnsembleDrafter.ts）

抽 6 个乐器：
1. `melodySound` — 主旋律（从 `melodyInstruments` 池抽）
2. `secondaryMelodySound` — 副旋律（强制 Plucked envelope，且**排除铃类**：Vibraphone/Music_Box/Glockenspiel/Celesta/Tinkle_Bell）
3. `chordSound` — 和弦织体（优先选与主旋律不同包络）
4. `bassSound`
5. `drumSound`
6. `counterMelodySound`（按 `counterMelodyProbability` 概率抽）

### 阶段 ⑥：ToplineEngine.generateTrackMelody（ToplineEngine.ts:398+）

**这是主旋律的核心**。三阶段：

**⑥a. groove 生成**（per section）
```typescript
section.grooveDNA = GrooveEngine.generateRhythmFingerprint(
    density, syncopationProb, beatsPerBar, userMotif
);
```

**⑥b. firstChorus motif 提取**（line 422-438）
```typescript
const firstChorus = sections.find(s => s.sectionType === SectionType.Chorus);
const result = generateSectionMelody(firstChorus, ..., generateMotifsOnly=true);
chorusMotifs = result.motifs;          // Map<label, MotifTemplate>
chorusPhraseGroups = result.phraseGroups;
```
**目的**：让所有 Chorus 段共享同一套动机和布局，避免"Chorus_1 和 Chorus_Main 像两首歌"。

**⑥c. 按 section 顺序生成**（line 447-538）
```typescript
sections.forEach((section, index) => {
    let providedMotifs, providedPhraseGroups;
    if (section.sectionType === Chorus) {
        providedMotifs = chorusMotifs;
        // 🌟 P5d 修复：克隆 phraseGroups 并按 section.startBeat 平移 group.startBeat
        providedPhraseGroups = clonedAndShiftedPhraseGroups;
    } else if (section.sectionType === PreChorus) {
        // morphMotifs(downgradeMotif(motifA, ...), motifA, steps=2) → 用最后一个插值版本
    } else if (section.sectionType === Verse) {
        // 80% 概率 downgradeMotif(motifA)（主歌简化版的副歌）
    } else if (Bridge / Break) {
        // 60% 概率 downgradeMotif(motifA)
    } else if (Outro && !hard_stop) {
        // generateFadingEchoOutro(chorusNotes) 碎裂化
    }
    // 其他段落（Solo_Bridge / Intro 等）独立生成
    
    const result = generateSectionMelody(section, sectionChords, ..., providedMotifs, providedPhraseGroups);
    sectionMelodies[index] = result.notes;
});
```

### 阶段 ⑥c-detail：generateSectionMelody → realizeMotif

**generateSectionMelody**（line 818-1295）的内部流程：

1. **拿到 phraseGroups**（providedPhraseGroups 或 PhraseGroupPlanner.planSection）
2. **PhraseGroupPlanner 抉择布局**（line 132-211）：
   - slot 数 = 1 → `[M]`
   - slot 数 = 2 → `[M, M_prime]` 或 `[M, M_resolve]`
   - slot 数 = 4：roll < 0.2 longform `[M, M_dev1, M_dev2, M_resolve]`；roll < 0.55 AABA `[M, M, N, M_prime]`；roll < 0.8 ABAB' `[M, N, M_prime, N_prime]`；otherwise ABAC' `[M, N, M, O_resolve]`
   - slot 数 = 8 → 两个 4-slot 拼接，第二组 label 加 `_2` 后缀
3. **HookPlan**（仅 Chorus）：选择 peak slot（黄金分割位 idx ≈ 0.618 × slotCount）+ 爬升曲线（gradual/steep/plateau）
4. **逐 group 逐 slot 生成**：
   - 每个 slot 的 baseLabel（'M'、'N' 等）查 motifs 字典
   - 如未存在则**创建新 motif**（节奏由 generateMotifRhythm 生成 + 轮廓 Ascending/Arch 等抽签）
   - 调用 `realizeMotif(template, phraseStart, ...)` 落音

**generateMotifRhythm**（line 1289-1504）：
- 三段式生成：pickup（弱起）→ body（主体）→ tail（结尾）
- 弱起轮廓：ascending / descending / held / zigzag
- 节奏密度由 sectionDensity × instrumentDensityMult（Sustained 乐器 ×0.6）

**realizeMotif**（line 1507-2750）— **这是音乐性决策最密集的地方**：

```
for (let i = 0; i < adjustedOffsets.length; i++) {
    onset = phraseStart + adjustedOffsets[i]
    duration = nextOnset - onset

    // 1. Anticipation（提前奏）：15% 概率把 onset 提前 0.25 / 0.5 拍
    
    // 2. Rest Window：高密度连续音后 90% 概率休止；其他位置 5-15% 随机休止
    
    // 3. Duration 量化：吸附到 {0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0}
    
    // 4. activeChord = chords.find(...) 当前活动和弦
    //    chordTones = HarmonyCore.getChordTones(activeChord, targetCenter)
    //    safeScalePcs = HarmonyCore.getSafeScalePitches(activeChord, tonality)
    
    // 5. Pentatonic Gap：30% 概率从 safeScale 移除 4 音 / 7 音（major 调）
    
    // 6. Pentatonic Shift：Neo-Soul 技巧（minor7 → 五度上的 minor pentatonic 等）
    
    // 7. Dynamic Simplification：复杂和弦尾部弱拍 25% 概率跳过
    
    // 8. willBeAnchor 预判：装饰音守卫用
    
    // 9. Pitch decision：
    //    isTail / isLastNote → macroTargetDegree 解决（70% macro + 30% contour）
    //    isPickup → pickupShape (ascending/descending/held/zigzag)
    //    isBody → relativePitches[i]（预计算轮廓）或按 contour 实时计算
    
    // 10. Harmonic Gravity：靠近 dominant chord 微升、靠近 tonic 微降
    
    // 11. isAnswer & isLastNote → 强解决到 chordTones 中最稳定音 (root/3/5)
    
    // 12. Chord-aware adjustment：
    //     - 强拍：吸附到 chord tone（getNearestOctave）
    //     - 弱拍：保持 idealPitch 但吸附到 safeScalePcs
    
    // 13. Pitch range clamp：
    //     - vocal: maxPitch = 72 (C5), Verse/PreChorus -5
    //     - non-vocal Plucked: maxPitch = 79 (G5)（Plucked 在 G5+ 长音廉价）
    //     - non-vocal Sustained: maxPitch = profile.safeRange[1]
    //     - chordKeyOffset 扣除：maxPitch -= chord.keyOffset || GlobalContext.currentKeyOffset
    //     - clamp：currentPitch > maxPitch → shiftDiatonic(-2) → while > 减 12
    
    // 14. Meyer's Leap Rule：
    //     - 如果 absInterval > maxJump（默认 7）→ 缩小到 maxJump
    //     - getNearestOctave fallback：snap 后仍超 maxJump → shiftDiatonic 兜底
    
    // 15. anchorProbability（同音反复）：5-15% 概率 currentPitch = previousPitch
    
    // 16. Final maxJump clamp：再次保护
    
    // 17. Final pitch range clamp
    
    // 18. Chord boundary chromatic lead-in：
    //     - 如果距 chord 切换 ≤0.5 拍 → 选择半音趋近下一和弦的 root/3rd
    
    // 19. 装饰音生成（per 主音）：
    //     a. Grace Note (倚音)：级进 + willBeAnchor + 长音前
    //     b. Neighbor Tone (辅助音)：interval=0 + willBeAnchor → 拆分前音为辅助音
    //     c. Trill (颤音)：长音 + (PhraseEnd or StrongBeat) + 概率
    //     d. Chromatic Approach (强拍半音趋近)：strongBeat + 概率 → 前一拍 -1 半音
    //     e. Appoggiatura (强拍倚音)：strongBeat + 概率 → 强拍上的非和弦音
    //     f. Melisma (转音瀑布)：长音 phraseEnd + 概率（仅有 melismaProbability 风格）
    
    // 20. Velocity humanize：
    //     - metricAccent (强拍 1.0, 次强 0.85, 弱 0.6)
    //     - mood velocity multiplier
    //     - 高音衰减：pitch > 72 时每半音 -0.012
    //     - clamp 到 [0.15, 0.85]
    
    // 21. Timing humanize：
    //     - rubatoShift (开头 -0.02 抢拍 / 末尾 +0.04 拖拍)
    //     - laidBack (R&B/Neo-Soul 风格才有 > 0)
    //     - 默认 jitter ±0.02 × (1.1 - metricAccent)
    //     - cap 到 ±0.05 拍（默认）/ ±0.08 拍（laidBack）
    
    // 22. Push to notes[]
    
    // 23. Diatonic Passing Tone Chain：
    //     - 前后两音间隔 ≥3 半音 → 12% 概率插入 1-3 个调内经过音
}
```

最后**Chorus golden note**（line 1259-1280）：
- 找出 sectionMelody 里的最高音
- 如果有多个相同最高音，保留位置最靠"强拍 + 长音"的那个
- 其他相同最高音用 shiftDiatonic 降低 1 度（避免重复"塌顶"）
- 保留的金音 velocity ×1.2、duration 至少 1.0 拍

### 阶段 ⑦：Reharmonize（HarmonyCore.ts:HarmonyEngine）

仅 `useViterbi=false` 时跑：根据已生成的 melody，对部分 chord 做 voice leading 优化（贪心算法）。Default style 启用 useViterbi，所以**这一步通常被跳过**。

### 阶段 ⑧：GlobalReviewer Phase 1（GlobalReviewer.ts:11-201）

```typescript
reviewAndFix(vocal, melody, chords, style, tonality):
    1. fixHangingTensionChords(chords)
       - 段尾 V7/dim/aug 等高张力和弦如果未解决到 I/i → 替换为 V/Im
    
    2. fixMelodyClashesAndResolutions(melody, chords)
       - 乐句末长音不在 chord tone → getNearestOctave snap 到 root/3/5
       - 强拍长音与 chord 形成 b9 冲突 → 半音下移
       - ★ P0 契约 warn：anchor 落非和弦音时报警
    
    3. fixMelodyHorizontalLogic(melody)
       - 极端大跳（≥8半音）+ 后续同方向继续 ≥5半音 → 50% 概率反向 shiftDiatonic
```

### 阶段 ⑨：P5a/b/c cleanMelodyPostProcessing（MelodyEngine.ts:158-259）

**P5a 大跳清零**（基于真实音 ≥0.2 拍，跳过装饰音）：
```typescript
if (Math.abs(gap) > globalMaxJump) {
    while (Math.abs(newPitch - refPitch) > globalMaxJump) newPitch -= dir * 12;
    n.pitch = newPitch;
}
```

**P5b 三全音 / 大七度拦截**（双方 duration ≥0.3 拍）：
```typescript
if (interval === 6 || interval === 11) {
    const scalePcs = getSafeScaleForOnset(b.onset);
    const shifted = HarmonyCore.shiftDiatonic(b.pitch, scalePcs, -dir);
    b.pitch = shifted;  // 用 diatonic 级进，不是 chromatic ±1
}
```

**P5c 同音 ≥4 强制变化**：
```typescript
if (streak >= 4) {
    const adjDir = (streak % 2 === 0) ? 1 : -1;
    notes[i].pitch = HarmonyCore.shiftDiatonic(notes[i].pitch, scalePcs, adjDir);
    streak = 1;
}
```

### 阶段 ⑩：AnchorDecisionStage（AnchorDecisionStage.ts）

**7 条规则标 anchor**（每个 section 调用一次）：
1. 每小节首音 + 末音（duration ≥ 0.5 拍）
2. 局部最高音 + 最低音（duration ≥ 0.5 拍）
3. 大跳（≥4 度 = 5 半音）的目的地音
4. 长音（duration ≥ 1.5 拍）
5. 附点起音（{0.75, 1.5, 3.0} 且落在强拍）
6. 段落末 phrase 的末音
7. 装饰音永远不是 anchor（覆盖以上规则）

**和弦音校验**（snap 或降级）：
- 每个 anchor 必须是 chord tone
- 不是则 `HarmonyCore.snapToScale(pitch, chordPcs)` 吸附
- 位移 > 3 半音 → 降级为非 anchor（避免轮廓崩坏）

**当前指标**：4 个 golden seed 下 anchor 比率 47-62%、chordTone% = 100%。

### 阶段 ⑪：Orchestrator.arrange（Orchestrator.ts）

主旋律相关：
1. **Counterpoint 检查**（GlobalReviewer.reviewCounterpoint）
2. **Parallel motion 修复**（GlobalReviewer.reviewParallelMotion）
3. **Humanize 应用**（applyHumanization）
4. **applyOffset**：每个 chord 的 keyOffset 加到所有 NoteData.pitch（**这是从相对空间 → 绝对空间的唯一转换点**）
5. **absoluteClampHigh**（按乐器包络分级）：
   - melody Plucked → 79 (G5)
   - melody Sustained → 84 (C6)
   - secondaryMelody → 78 (F#5)
   - counterMelody → 81 (A5)
   - vocal → 86 (D6)

最后 melody 进 ArrangedTrack，由 PlaybackEngine 转 MIDI 事件播放。

---

## 4. 配置参数（StyleConfig.melody 全清单）

```typescript
melody: {
    // 基础
    stepwiseRatio: 0.7,           // 级进比例（实际未严格使用）
    maxJumpInterval: 7,           // 最大跳进半音数（默认纯五度）
    tensionTolerance: number,     // 不和谐音容忍度
    mutationProbability: number,  // 动机变异概率
    mutationPool: [...],          // 'inversion' | 'augmentation' | ... 变换类型池
    
    // 五声 / 调式色彩
    pentatonicPreference: number,
    extensionPreference: number,
    pentatonicShiftProbability: 0,    // Neo-Soul 五度上的 pentatonic shift
    chromaticPassingProbability: number,
    chromaticApproachProbability: 0.15,  // 强拍前一拍半音趋近概率
    passingToneChainProbability: 0.12,   // 大间隔填充经过音概率
    
    // 和声
    harmonicGravityStrength: 0.3, // 趋向下一和弦根音的引力
    leapResolutionThreshold: 5,   // 多大算大跳并需要反向解决
    syncopationResolution: 'strict' | 'loose',
    
    // 装饰音
    inflectionProbability: number,// 倚音 (Grace Note) 概率
    anchorProbability: number,    // 同音反复概率
    riffDrivenProbability: number,// 段落由 Riff 驱动的概率
    
    // 段落音域
    sectionalRegisterProfile: {
        verse: [number, number],
        preChorus: [number, number],
        chorus: [number, number],
        solo: [number, number],
    },
    
    // 节奏 / 呼吸
    breathingRoomProbability: number,
    callAndResponseProbability: number,
    
    // 层级动机系统
    phraseLengthProfile: PhraseLengthProfile,  // 各段落 PhraseGroup 长度池
    motifRecipes: { pickup: [], body: [], tail: [] },
    
    // 风格化技法
    laidBackTimingMax: 0,         // 拖拍最大偏移（R&B/Neo-Soul 才设）
    extensionTargeting: false,    // 靶向延伸音(9/11)
    melismaProbability: 0,        // 转音瀑布
    sequenceFreezeRhythm: false,  // 模进时冻结节奏
    chordMelodyProbability: 0,    // ChordMelody 织体
}
```

---

## 5. 关键代码索引

| 决策点 | 文件:行 | 备注 |
|---|---|---|
| 段落抽参数 | MelodyEngine.ts:42-86 | mood/bpm/key/tonality/timeSig |
| **P5f tonality 反推** | MelodyEngine.ts:101-130 | 修复 minor pool ↔ major chord 不匹配 |
| **P5a/b/c 旋律后处理** | MelodyEngine.ts:158-259 | 大跳/三全音/同音 4 连 |
| AnchorStage 入口 | MelodyEngine.ts:266-295 | 按 section 调 annotate |
| firstChorus motif 提取 | ToplineEngine.ts:422-438 | generateMotifsOnly=true |
| Chorus phraseGroups 克隆+offset | ToplineEngine.ts:457-487 | **P5d 修复**：原引用复用导致 Chorus_Main/Epic 空白 |
| Verse 传承 | ToplineEngine.ts:480-490 | 80% 概率 downgradeMotif |
| PreChorus morphMotifs | ToplineEngine.ts:466-479 | 副歌动机 → PreChorus 插值 |
| **PhraseGroupPlanner.pickLayout** | ToplineEngine.ts:132-211 | AABA / ABAB / longform 等 |
| HookPlan（Chorus peak） | ToplineEngine.ts:217-241 | 黄金分割位 + 爬升曲线 |
| Outro 碎裂化 | ToplineEngine.ts:350-396 | generateFadingEchoOutro |
| Intro 预示 | ToplineEngine.ts:320-347 | extractForeshadowingIntro |
| transformMotif（动机变换） | ToplineEngine.ts:619-771 | 倒影/逆行/增值/分裂/合并/移位/模进 |
| **realizeMotif 主循环** | ToplineEngine.ts:1507-2750 | 90% 音乐性决策在这里 |
| Pitch contour 计算 | ToplineEngine.ts:1697-1782 | Ascending/Descending/Arch/Bowl/Static/Wandering |
| Harmonic Gravity | ToplineEngine.ts:1786-1793 | 靠近属和弦微升 |
| Pitch range clamp（按乐器） | ToplineEngine.ts:2036-2088 | Plucked vs Sustained |
| Meyer's Leap Rule | ToplineEngine.ts:2090-2126 | 大跳缩小 + fallback |
| 同音反复 | ToplineEngine.ts:2076-2080 | anchorProbability |
| Chord boundary chromatic | ToplineEngine.ts:2128+ | 半音趋近下一和弦 |
| Final maxPitch + maxJump clamp | ToplineEngine.ts:2186-2210 | F4 + P5a final |
| Grace Note | ToplineEngine.ts:2161-2230 | 级进时倚音 |
| Neighbor Tone | ToplineEngine.ts:2231-2256 | 同音时辅助音 |
| Trill | ToplineEngine.ts:2412-2440 | 长音 + 颤音 |
| Chromatic Approach | ToplineEngine.ts:2444-2479 | 强拍前半音趋近 |
| Appoggiatura | ToplineEngine.ts:2481-2519 | 强拍非和弦音解决 |
| Velocity humanize | ToplineEngine.ts:2272-2336 | metricAccent + 高音衰减 |
| Timing humanize | ToplineEngine.ts:2354-2381 | rubato + laidBack + cap |
| Push 主音 + maxJump 兜底 | ToplineEngine.ts:2553-2585 | 最后一道关 |
| Diatonic Passing Chain | ToplineEngine.ts:2557-2600 | 大间隔填充 |
| **AnchorDecisionStage 7 规则** | AnchorDecisionStage.ts:38-181 | 标 anchor + snap |
| **GlobalReviewer Phase 1** | GlobalReviewer.ts:11-201 | hangingTensionChords + clashes + horizontalLogic |
| Counterpoint Phase 2 | GlobalReviewer.ts:207-292 | 副旋律冲突检测 |
| Parallel motion | GlobalReviewer.ts:294-368 | 平行五/八度修复 |

---

## 6. 当前的局限分析（黑盒诊断）

### 6.1 局部合规 vs 全局意图

**症状**：每个音单独看都"对"（chord tone or scale tone、不大跳、不三全音），但乐句没有方向感。

**原因**：算法是**顺向逐音生成**的马尔可夫链：
- 每一步看 [当前 chord, 当前 contour 位置, 上一个音]
- 没有"我要在第 4 小节第 1 拍落到 E5"的目的地概念
- 即使 macroTargetDegree 提供了大方向（line 1714-1729），融合是 70% macro + 30% contour 的**线性插值**，不是真正的"路径规划"

**对比人类作曲**：人脑里先有"这一句要落到那个 E5"，然后倒着推前面的音。

**症状证据**：
- Chorus_1 melody 像随机散步：`B5(1)-A5(0.47)-F#4(0.48)-D5(0.97)-B5(0.23)`
- 没有"为某个目的地铺垫"的迹象

### 6.2 动机变换深度不足

**症状**：副歌不同段落（Chorus_1 / Chorus_Main / Chorus_Epic）虽然共享 motifs，但听感上"没有发展"。

**原因**：
- `transformMotif` 支持 7 种变换（Inv/Ret/Aug/Switcheroo/Split/Merge/Shift）
- 但触发条件只在 `slot.role === 'vary' || 'resolve'`（line 1040+）
- 实际执行时大部分 slot 是 `statement` 或 `repeat`（机械复读）
- "AABA" 的 A 之间是完全相同的 motif（包括所有装饰音），没有"细微变化"

**对比**：人类作曲的 AABA 第二个 A 一定是"同动机但有 1-2 处变化"（音长延展、加 1 个倚音、改 1 个尾音等）。

### 6.3 张力曲线无显式规划

**症状**：力度、Rubato、音高 jitter 是三个独立的随机过程，没有一条"乐句弧线"贯穿。

**原因**：
- velocity 由 metricAccent + 高音衰减算（每个音独立）
- timing jitter 由 rubatoShift + laidBack（每个音独立）
- 音高由 contour + macroTarget（轮廓但不是张力）

**对比人类作曲**：人脑里有"这一乐句的能量曲线是 ___弱→渐强→爆点→收尾___"，三个维度协同变化。算法是三个独立随机过程的偶然叠加。

### 6.4 反向寻路（A* / Backward Pathfinding）未实现

**症状**：旋律没有"目的地驱动"。

**机会**：当前架构已铺好的地基：
- **AnchorDecisionStage 已标骨架音** → 可作为"目的地"
- **PhraseGroupPlanner 已规划乐句结构** → 可作为"路径段"
- **getSafeScalePitches / getChordTones** 已定义"合法落点"

**未实现的路径规划**：
- 给 phrase 末音定一个"目标 anchor"
- 算从当前位置到目标的所有"合法路径"（chord-aware）
- 评分（线性进行 > 循环、级进多 > 跳进多）选最优
- 把选出的路径作为旋律生成的硬约束

### 6.5 节奏的"塑形不足"

**症状**：节奏密度由 `density` 抽参数控制，但同一段内的节奏感比较平均，缺乏"密集 → 留白 → 密集"的呼吸节奏。

**原因**：
- GrooveEngine.generateRhythmFingerprint 生成的节奏指纹是**段落级**的，slot 之间没有动态调整
- generateMotifRhythm 内部三段式（pickup/body/tail）但比例固定

### 6.6 装饰音的"分布不音乐化"

**症状**：grace/neighbor/trill/chromatic approach/appoggiatura 是独立的概率事件，可能集中在某 1-2 个 slot 而其他 slot 完全没有装饰。

**修复方向**：装饰音应该按"整段配额"分配，避免局部过于密集 / 局部完全干净。

---

## 7. 已修复的硬 bug 清单（P0 / F1-4 / P5a-f）

| ID | bug | 修复 |
|---|---|---|
| P0 | 关键音/非关键音未分化 | AnchorDecisionStage（7 规则 + snap） |
| F1 | secondaryMelody fill 在 G5+ Vibraphone 尖叫 | clampToRange(60, 76) |
| F2 | secondaryMelody velocity/reverb 太抢戏 | velocity 0.6→0.42 + reverb 0.5→0.75 |
| F3 | EnsembleDrafter 选 Vibraphone/MusicBox 做副旋律 | 铃类黑名单 + 池清理 |
| F4 | 主旋律 Plucked 在 G5+ 长音廉价 | 按 envelope 分级上限 79/84；ToplineEngine maxPitch keyOffset fallback |
| P5a | 大跳 14-22 半音穿透 | realizeMotif fallback + push-time clamp + MelodyEngine 全局守卫 |
| P5b | 三全音/大七度音程 | diatonic shiftDiatonic 微调 |
| P5c | 同音 ≥4 连续机关枪 | streak 计数 + diatonic 强制变化 |
| P5d | Chorus_Main/Epic 主旋律全空 | chorusPhraseGroups 克隆 + 偏移 group.startBeat |
| P5e | humanize timing 总偏移过大 | cap ±0.05 拍（默认）/ ±0.08 拍（laidBack） |
| P5f | tonality 与 chord pool 不匹配 | chord tones 投票反推真实 tonality |

---

## 8. 给外部专家审阅的关键问题清单

如果要让 Luis / 其他算法作曲专家看这份代码并提建议，请重点关注：

1. **逆向寻路（Backward Pathfinding）** — 当前架构能否在不大改的前提下实现？AnchorDecisionStage 已经标了"骨架音"，是否可以把它作为 A* 的目标节点？
2. **动机矩阵变换的强制使用** — transformMotif 已存在，如何让 statement/repeat 也强制走"明确变换"而不是机械复读？
3. **张力曲线统一调度** — 当前 velocity/timing/pitch 三个维度独立随机，能否引入一个 PhraseContourPlanner 做统一规划？
4. **节奏塑形** — slot 之间的"密集-留白"节奏感怎么生成？
5. **装饰音的"配额分配"** — 当前是独立概率事件，能否按段落 budget？
6. **副旋律的"对位 vs 对话"** — 当前副旋律 100% 孤立出现（主旋律休止时填补），能否做"主副同时发声 + 三度平行"模式？

---

## 附录 A：Pipeline 时序详图

```
┌─────────────────────────────────────────────────────────────────┐
│  MelodyEngine.generateFullSong(seed)                            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ① PRNG.setSeed → mood/bpm/key/tonality/timeSig         │    │
│  │  ② StructureEngine → sections[]                          │    │
│  │  ③ HarmonyEngine / Viterbi → chords[]                    │    │
│  │  ④ P5f tonality 反推（chord tones 投票）                  │    │
│  │  ⑤ EnsembleDrafter → palette                             │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ⑥ ToplineEngine.generateTrackMelody(sections, chords)  │    │
│  │     ⑥a Section grooveDNA (per section)                   │    │
│  │     ⑥b firstChorus motif + phraseGroups 提取             │    │
│  │     ⑥c sections.forEach:                                 │    │
│  │         - Chorus → providedMotifs = chorusMotifs         │    │
│  │                    providedPhraseGroups = clone+shift    │    │
│  │         - PreChorus → morphMotifs                        │    │
│  │         - Verse → 80% downgradeMotif                     │    │
│  │         - Outro → generateFadingEchoOutro                │    │
│  │         - 其他 → 独立生成                                 │    │
│  │         generateSectionMelody(section, ...) →            │    │
│  │           PhraseGroupPlanner.planSection (or provided)   │    │
│  │           per group per slot:                            │    │
│  │             motif = motifs.get(label) or createNew       │    │
│  │             realizeMotif(motif, phraseStart, ...) →      │    │
│  │               for each rhythm offset:                    │    │
│  │                 anticipation, restWindow, quantization   │    │
│  │                 chord-aware pitch decision               │    │
│  │                 pentatonic gap / shift                   │    │
│  │                 willBeAnchor 预判                         │    │
│  │                 contour → idealPitch → currentPitch      │    │
│  │                 harmonic gravity                         │    │
│  │                 isAnswer & isLastNote → 强解决            │    │
│  │                 chord tone snap (strongBeat)             │    │
│  │                 pitch range clamp (envelope-aware)       │    │
│  │                 Meyer's Leap Rule                        │    │
│  │                 同音反复 (anchorProb)                     │    │
│  │                 final maxJump + maxPitch clamp           │    │
│  │                 chord boundary chromatic                 │    │
│  │                 装饰音生成 (grace/neighbor/trill/etc)     │    │
│  │                 velocity humanize                        │    │
│  │                 timing humanize (cap ±0.05)              │    │
│  │                 push to notes[]                          │    │
│  │                 diatonic passing chain                   │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ⑦ reharmonize（仅 useViterbi=false 跑）                  │    │
│  │  ⑧ GlobalReviewer.reviewAndFix (Phase 1)                 │    │
│  │     - fixHangingTensionChords                            │    │
│  │     - fixMelodyClashesAndResolutions                     │    │
│  │     - fixMelodyHorizontalLogic                           │    │
│  │  ⑨ P5a/b/c cleanMelodyPostProcessing                     │    │
│  │     - 大跳 clamp                                          │    │
│  │     - 三全音/大七度拦截                                    │    │
│  │     - 同音 4 连强制变化                                    │    │
│  │  ⑩ AnchorDecisionStage.annotate (per section)            │    │
│  │     - 7 规则标 anchor                                     │    │
│  │     - snap 到 chord tone                                 │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ↓ track: GeneratedTrack                                        │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  Orchestrator.arrange(track) → ArrangedTrack                    │
│  - 鼓组：DrumIdiomRouter（6 种 Idiom 评分选择 + 华彩借调）        │
│  - 副旋律：CounterMelodyRouter（ParallelHarmony / CallAndResponse）│
│  - 和弦：PianoIdiomRouter（5 策略评分选择 texture）               │
│  - 贝斯：generateBassLine(subgenre)（4 种 hits pattern）         │
│  - GlobalReviewer Phase 2 (counterpoint + parallel motion)       │
│  - applyHumanization                                             │
│  - applyOffset (+keyOffset → ABSOLUTE space)                     │
│  - absoluteClampHigh (envelope-aware: melody 79/84, sec 78, ...) │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                   final ArrangedTrack
                            ↓
                  PlaybackEngine → MIDI events → 音频
```

---

## 附录 B：约束与契约

### B.1 PRNG 确定性
- `PRNGManager` 是**全局唯一可变状态**
- LCG 算法：`state = (state × 1664525 + 1013904223) % 2^32`
- 同一 seed → 同一 melody（byte-for-byte）
- 任何代码修改都不能改变 PRNG 消耗序列（除非有意为之，需重录 ACVE 快照）

### B.2 Pitch Space 契约（K-1 ~ K-7）
- **相对空间（RELATIVE）**：`NoteData.pitch` 在管道内是相对调式主音的 MIDI 值（C=60 为参考）
- **绝对空间（ABSOLUTE）**：`Orchestrator.applyOffset()` 唯一把 `pitch += keyOffset` 的地方
- 生成函数禁止在返回值里包含 keyOffset
- 音域限制（clamp to range）在相对空间做时必须扣 chordKeyOffset

### B.3 ESP32-S3 C 移植约束
- 禁止 `Math.random()`（用 PRNGManager.next）
- 禁止 Map / Set / WeakMap（用数组 + 线性扫描）
- 禁止 async / Promise（生成管道全同步）
- 浮点比较禁止 `===`（用 epsilon 1e-6）
- 数据结构能转为 C struct + 扁平数组

---

## 附录 C：V3.5 Idiom 系统（2026-04-17 补充）

### C.1 DrumIdiom 系统

**文件位置**：`src/core/generation/idioms/drums/`

6 种 Idiom，每个实现 `IDrumIdiom { name, score(ctx), generate(ctx) }`：

| Idiom | 甜区 | 核心特征 |
|---|---|---|
| **SteadyDrumIdiom** | energy 4-7, low sync, Pop | kick 1+3, snare 2+4, melody/bass listening（maskAccent） |
| **SyncopatedDrumIdiom** | sync > 0.5, energy 5-8, Funk | 反拍 kick, ghost notes（snare vel 0.3）, open HH on "and" |
| **HighEnergyDrumIdiom** | energy ≥ 8, EDM/Drop | 4-on-floor kick, off-beat OHH, clap(39), build-up snare roll |
| **SparseDrumIdiom** | energy ≤ 3, Intro/Outro | tom_low 替代 kick, 极稀疏 crash |
| **AcousticSwingDrumIdiom** | swing > 0.55, energy 3-6, Lo-fi | ride "ding-da-ding", cross-stick, hi-hat pedal(44) |
| **CinematicDrumIdiom** | energy ≥ 7, Chorus_Epic/Solo | 3 层能量分级, snare+tom layering, double crash |

**DrumIdiomRouter**：
- 每个 section 入口评分所有 idiom → 选最高分
- 华彩借调：Bridge/PreChorus/Solo_Bridge 30% 概率切第二高分 idiom
- 顺滑过渡：crash 声明（入口）+ tom fill 告别（出口）+ 重 kick re-anchor（回归）
- 切换保护：分差 < 10% 保持上一段 idiom

### C.2 CounterMelody Idiom 系统

**文件位置**：`src/core/generation/idioms/countermelody/`

3 种 interplay 模式，由 `pickInterplayMode(sectionType, sectionName, energyLevel)` 确定性选择：

| 模式 | 适合段落 | 描述 |
|---|---|---|
| **ParallelHarmony** | Chorus, PreChorus | 与主旋律三度/六度并行，50% 概率 snap 到 chord tone |
| **CallAndResponse** | Verse, Intro, Bridge | 在主旋律休止间隙填补 1-3 个和弦音（contrary motion） |
| **OctaveDoubling** | Chorus（高能量） | 八度加厚（暂用 ParallelHarmony 代替） |

### C.3 PianoIdiomRouter（和弦织体）

**文件位置**：`src/core/generation/idioms/piano/PianoIdiomRouter.ts`

轻量级评分选择，复用现有 `TextureMapper.generateChordTexture` 的 textureType 参数：

| 策略 | 甜区 | texture 值 |
|---|---|---|
| **Block** | energy 4-7, low sync, Pop/Latin | `'Block'` |
| **Arpeggio** | energy 3-6, high swing, Lo-fi, Intro/Bridge | `'Arpeggio'` |
| **Rhythmic** | sync > 0.5, energy 6-9, Funk | `'Rhythmic'` |
| **Pad** | energy ≤ 3, Intro/Outro/Break | `'Pad'` |
| **Pulsing** | energy ≥ 8, BuildUp/Drop | `'Pulsing'` |

### C.4 全链路律动统一

每首歌从 4 套 subgenre 池（Pop / Funk / Lo-fi / Latin）PRNG 抽一个，影响：
- 鼓组：DrumIdiomRouter 评分的 subgenre 加分项
- 贝斯：4 种 hits pattern（Pop=[0,1,2,3] / Funk=[0,1.75,2,3.75] / Lo-fi=[0,2,3] / Latin=[0,2.5,3.5]）
- 和弦：PianoIdiomRouter 评分的 subgenre 加分项
- 旋律：RhythmCells 30% 概率用 subgenre 对应的风格化节奏细胞（PopCells / FunkCells / JazzCells / BossaCells）
- grooveDNA：按 PhraseGroup 级变化（每个大乐句 1-2 step 扰动，不再段落级固定）

---

**文档结束**

如需进一步信息：
- 完整源码：`src/core/generation/`
- Idiom 系统：`src/core/generation/idioms/{drums,countermelody,piano}/`
- 总规则文档：`.claude/rules/music_generation_pipeline_rule.md`
- 风格配置：`src/core/generation/config/styles/StyleRegistry.ts`
- 黄金种子测试：`scripts/golden-seed.ts`
