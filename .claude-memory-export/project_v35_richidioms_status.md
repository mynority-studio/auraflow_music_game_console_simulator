---
name: V3.5 RichIdioms 项目状态
description: 2026-04-17 V3.5 发布后的完整项目状态、架构变更、待办清单
type: project
originSessionId: 152ce9a1-bd0b-4f63-989b-e30c14e8edc3
---
## 当前版本

**AuraFlowV3.5（RichIdioms）** — tag 已推送到 remote，commit `050b682`

## 本次大改动总结（+3733 行，28 文件）

### 新增架构模块

1. **AnchorBackbone**（`composing/AnchorBackbone.ts`）— 骨架优先旋律生成
   - Bresenham 线性插值 + contour 弧度叠加
   - 每个 PhraseGroup 生成 2-5 个 anchor（chord tone，间距 ≤ 纯五度）
   - 零 PRNG 消耗

2. **PhraseContourPlanner**（`composing/PhraseContourPlanner.ts`）— 三层张力曲线
   - L1 song-level（sectionType 映射 + 线性插值）
   - L2 section-level（Chorus 抛物线 / Bridge 下凹 / Verse 平稳）
   - L3 phrase-level（弱起→推进→收尾）
   - 驱动 velocity（base × (0.6 + 0.4 × tension)）和 timing jitter（高张力=精准）

3. **DrumIdiom 系统**（`idioms/drums/` 8 文件）
   - 6 种 Idiom：Steady / Syncopated / HighEnergy / Sparse / AcousticSwing / Cinematic
   - DrumIdiomRouter：评分选择 + 华彩借调（Bridge/PreChorus 30% 概率切第二高分 idiom）
   - Melody/Bass Listening（maskAccent + bass ghost 同步）

4. **CounterMelody Idiom 系统**（`idioms/countermelody/` 4 文件）
   - 3 种 interplay 模式：ParallelHarmony / CallAndResponse / OctaveDoubling
   - CounterMelodyRouter：按 sectionType + energy 确定性选择模式

5. **PianoIdiomRouter**（`idioms/piano/PianoIdiomRouter.ts`）— 轻量级和弦织体路由
   - 5 种策略（Block/Arpeggio/Rhythmic/Pad/Pulsing）评分选择
   - 切换保护（分差 < 15% 保持上一段 texture）

### 已修复的硬 bug

- P5a：大跳 >12 半音清零（MelodyEngine 全局守卫）
- P5b：三全音/大七度拦截（diatonic shiftDiatonic，不是 chromatic ±1）
- P5c：同音 ≥4 连续强制变化（diatonic 级进）
- P5d：Chorus_Main/Epic 主旋律空白（chorusPhraseGroups 克隆 + offset startBeat）
- P5e：humanize timing cap（默认 ±0.05 拍）
- P5f：tonality vs chord pool 不匹配（chord tones 投票反推真实 tonality）
- F4：主旋律 Plucked 乐器音域上限 G5（79 绝对空间 clamp）
- F-Bass-Mix：贝斯低频补偿（lowShelf +2dB / peaking 250→350Hz）
- Chorus_Epic 15 小节空白（phraseGroups.startBeat 引用复用 bug）

### 已知残留问题

- **seed 7777777 bass=0**：Orchestrator 的 playBass gating 旧逻辑（energy 阈值否决），不是新代码引入
- **AnchorStage contract violation warn**：P5b/c 的 diatonic 微调偶尔推 anchor 到非 chord tone，GlobalReviewer 自动修复，warn 是监控点可忽略
- **parseRomanNumeral 在 minor 调下不降 vi/iii/vii**：P5f 用投票反推 workaround，根因未修

## 待做（下次对话起点）

### 高优先
1. **Piano Idiom 完整版**：当前 PianoIdiomRouter 是轻量级（只选 texture）；完整版需要 IPianoIdiom + BasePianoIdiom + 5 个实现（Block/Arpeggiated/Rhythmic/Sparse/Virtuoso）+ HarmonyCore 扩展（getSmoothVoicing 多参数 / getDynamicChordScale）
2. **Luis 阶段 2：动机变换分级表**：statement 0% / repeat 5-15% / vary 30-50% / contrast 70-90% / resolve 20-40%
3. **Luis 阶段 3：呼吸预算**（Rest Budgeting）：连续发声 ≤ 2 小节硬限 + 预算按张力曲线动态分配

### 中优先
4. **装饰音配额分配**：按段落 budget 而非独立概率
5. **Cadence-Aware 尾音处理**：Open(短切) / Closed(长 fade) / Deceptive(惊讶)
6. **跨段落主题钩子**：hook peak 音在 Intro/Verse/Bridge 以不同形态再现

### 低优先
7. **副旋律 4 模式按张力切换**：Pedal(低) / CallResponse(中) / Parallel(高) / Contrary(极高)
8. **parseRomanNumeral 根治**：minor 调下 vi/iii/vii 自动降半音
9. **seed 7777777 bass=0 修复**：排查 trackThresholds.bass

## 外部顾问

**Luis**：专业算法音乐工程师，提供了 4 个核心建议（逆向寻路/动机变换/张力曲线/音程黑名单），方向 90% 准确，细节偶有过度理想化（如 maxJump 4 太激进、100% 装饰音触发太机械）。用户对 Luis 的信任度高。
