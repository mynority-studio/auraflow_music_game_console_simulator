# LOFI Hip Hop 慢速 Boom-bap 编曲修复任务书

状态：已完成首版生成闭环、200-seed 机器门禁与五组分层 MIDI 导出（2026-07-30）

任务代号：`LOFI-HIPHOP-ARRANGEMENT-V1`

当前范围：只修编曲与生成结构，不评价、不修改 EQ、混音、音色、采样质感或母带。

> 实施快照：LOFI 已接通 9 个 song-level 两小节 DrumPhrase，覆盖 slow Boom-bap、
> dusty Dilla Boom-bap 与 slow soul half-time；Arranger 逐小节冻结 phrase placement、
> 4/8 小节 cadence mutation 与 Lead response/rest。和声选择默认使用 2–4 chord cell，
> MG Lead 在 token/score 阶段消费 intentional rest，并为每个 active response bar
> 实现至少一个 off-downbeat entry。200 个 seed 与固定 `0/2/7/42/99` 已全部通过
> `docs/generated/lofi_hiphop_arrangement_audit.md` 的编曲门禁。

## 1. 一句话目标

把当前偏“爵士钢琴伴奏 + 不断变化的鼓”的 LOFI，修成以**稳定、可重复的慢速 Hip Hop / Boom-bap 两小节鼓 Loop**为核心，以**短和声采样循环、段落加减法和旋律留白**为主要编曲语言的 LOFI Hip Hop。

最终听感排序必须是：

1. 第一耳朵先听到 Hip Hop / Boom-bap pocket。
2. 第二层才是温暖、含爵士色彩的短和声 Loop。
3. Lead 只在少量位置回应，不持续占据前景。

## 2. 风格定义

### 2.1 主风格

- Tempo 保持在 `70–86 BPM`，默认中心约 `78 BPM`。
- 主鼓型是慢速 Boom-bap：Kick 与 Snare/Rim 构成明确的 Hip Hop 骨架。
- 经典 Boom-bap 以人类拍号的第 2、4 拍为 backbeat；在当前零起点 beat 表示中对应 `beat: 1`、`beat: 3`。
- Dilla / dusty 变化允许 Kick、Snare、Hat 产生不同方向的松弛，但不能破坏名义上的主鼓骨架。
- Half-time soul 是次要分支：主要 Snare/Rim 落在人类第 3 拍，即当前表示中的 `beat: 2`。
- 主循环以 2-bar cell 为最小音乐单位，可组成 4-bar call/answer 与 8-bar phrase。
- 同一首歌里要“重复中有少量变化”；不同 seed 之间才需要显著多样。

### 2.2 本任务必须覆盖的三类鼓语言

| family | 定位 | 必须保留的骨架 | 允许变化 |
| --- | --- | --- | --- |
| `slow-boombap` | 默认主风格 | Snare/Rim 在 2、4 拍；Kick 明确建立第 1 拍并在拍间回应 | 第二小节改变一个 Kick 回答或增加一个弱 pickup |
| `dusty-dilla-boombap` | 松弛、偏拍的 Boom-bap | 仍能听出 Boom-bap backbeat | 分声部 late/early pocket、ghost note、稀疏的 16 分 Hat |
| `slow-soul-halftime` | 次要半拍灵魂分支 | Snare/Rim 在第 3 拍；Kick 保持 1 拍重心 | 少量 offbeat Kick、Hat 缺拍、4/8 小节尾 pickup |

要求它们共享 LOFI Hip Hop 身份，但不能退化成：

- Trap 连续 roll；
- Pop 四踩；
- Funk 每小节大量切分变化；
- Jazz 鼓手式逐小节自由演奏；
- 只有速度慢，却没有清晰 backbeat 的“泛 Chill”节奏。

## 3. 当前问题基线

本轮分析的当前生成结果显示：

| 项目 | 当前表现 | 问题判断 |
| --- | --- | --- |
| Tempo | 200 个 LOFI seed 为 71–85 BPM，平均约 78.3 BPM | 已符合，不是本任务重点 |
| 鼓结构重复 | 典型 16-bar 样本为 `16/16` 个不同 rhythm signature，`repeatedRhythmBarRatio = 0` | 严重不像 sample-loop 型 Hip Hop |
| 鼓密度 | 抽样约 16 hits/bar | 密度本身不是唯一问题，核心问题是逐小节结构变化 |
| 和声周期 | 200 个 seed 中没有 2–4 chord identity 的最短周期；主要为 8、12、16 chord progression | 太像完整作曲，不像短采样 Loop |
| Lead | 主循环段几乎一直 active，约 2.5–5 notes/bar | 容易变成钢琴/旋律主导的 Jazzhop |
| Macro form | 已有 intro、loop、outro 和 section repeat | 框架可保留，需改为 4/8 小节的加减法编配 |

现有 `docs/generated/drum_humanity_baseline.md` 已直接暴露最关键的问题：LOFI 鼓在单首歌内部过度追求变化，缺少稳定 groove identity。

## 4. 不可违反的架构边界

### 4.1 数据职责

| 层 | 本任务应拥有 | 禁止拥有 |
| --- | --- | --- |
| Knowledge Base | 完整 2-bar DrumPhrase、4-bar answer/turnaround 变体、2–4 chord loop vocabulary | 具体歌曲的 section 位置 |
| GrooveContract | tempo、meter、swing/pocket 身份、合法 family | 每一小节临时挑哪个 pattern |
| Arranger | song-level groove identity、phrase placement、`coreA/coreB/turnaround/breakdown`、和声 Loop、Lead presence | 音色、EQ、FX、临时逐 hit 删除 |
| Instrumental/ScoreCompiler | 把已选 phrase 和 presence directive 编译成逐小节 nominal score | 按 bar role 做隐式 modulo 轮换 |
| Performance | 一次性 microtiming、力度、已声明 ghost expression | 新增/删除结构性鼓点、改变 phrase identity |
| Renderer | 纯投影 resolved score | 根据 `LOFI` 名称补鼓、删鼓、删 Lead 或重选变体 |

### 4.2 强制结论

1. 生成随机化单位由“每小节选一个新鼓型”改为“整首先选一个 2-bar 主 phrase，再在明确的 4/8 小节边界选 answer 或 turnaround”。
2. 同一 2-bar core phrase 再次出现时，Kick/Snare/Hat 的 nominal onset mask 必须可完全复现。
3. 微时序和力度可以重复时不同；结构 onset 不得因此被改写。
4. `Arranger` 必须产出可审计的 phrase score，至少包含：
   - `grooveIdentity`
   - `phraseId`
   - `phraseBarIndex`
   - `phraseRole`
   - `structuralMutation`
   - `leadPresence`
5. 不允许在 `instrumentalPlanner.ts` 中继续用 `baseVariant + bar.role + phraseIndex` 的逐小节 modulo 轮换制造变化。
6. 不允许在 `drumRenderer.ts` 中对每小节独立随机加入 open hat、ghost hit 或 fill，使已经重复的 nominal phrase 再次变成 16 个不同小节。
7. 不允许先生成复杂长和声，再在 Renderer 或导出后删除和弦来伪造短 Loop。

## 5. 实施顺序

严格执行：

`Baseline Audit → Drum Phrase Model → Arranger Repetition → Harmony Short Loop → Lead Presence → Integrated Gate`

鼓的 Gate G 未通过前，不进入“和声是否更 LOFI”的主观验收。

## Batch 0：建立 LOFI 编曲专项审计

### 任务

- `LHB-A01`：新增 `scripts/audit-lofi-hiphop-arrangement.ts`，固定分析 200 个 LOFI seed。
- `LHB-A02`：按 `intro / main-loop / turnaround / outro` 分开统计，不能让 intro 或 outro 掩盖主循环问题。
- `LHB-A03`：为鼓增加 2-bar phrase signature；现有单小节 `rhythmSignatureCount` 保留，但不能作为唯一指标。
- `LHB-A04`：报告每首歌的：
  - main-loop bar count；
  - groove family；
  - 1-bar unique signature ratio；
  - 2-bar phrase reuse coverage；
  - structural mutation bar ratio；
  - backbeat anchor coverage；
  - fill 所在小节；
  - 和声最短 chord-identity period；
  - Lead active-bar coverage 与最长连续休止。
- `LHB-A05`：将当前结果冻结为 before snapshot，不覆盖既有 baseline。

### Gate A

- 相同 seed 的报告完全确定性。
- 审计能明确复现当前“典型 16-bar 主循环有 16 个不同小节鼓型”的失败。
- 统计口径只看 nominal rhythm structure；velocity 和 microtiming 另列，不混入 phrase signature。

## Batch 1：把一小节 DrumHit 变成两小节 Hip Hop Phrase

### 任务

- `LHB-G01`：在 Drum KB 中新增 `DrumPhrase` 或等价结构，最小长度为 2 bars。
- `LHB-G02`：把现有 `TR808_LOFI_BOOMBAP`、`TR808_LOFI_DUSTY_BREAK`、`TR808_LOFI_MINIMAL` 整理为完整 phrase vocabulary，而不是相互独立的一小节候选池。
- `LHB-G03`：每个 phrase 明确声明：
  - `family`
  - `bars`
  - `backbeatMode: 'two-four' | 'halftime-three'`
  - `core | answer | turnaround | breakdown`
  - 可变 voice 与不可变 anchor
  - 允许出现的位置
- `LHB-G04`：至少提供：
  - 4 个 `slow-boombap` core phrases；
  - 3 个 `dusty-dilla-boombap` core phrases；
  - 2 个 `slow-soul-halftime` core phrases；
  - 每个 core 至少 1 个受控 turnaround。
- `LHB-G05`：默认 timekeeper 使用稀疏八分 Hat；16 分 Hat 只作为 dusty/Dilla family 的弱力度纹理，禁止每小节 roll。
- `LHB-G06`：turnaround 只能出现在 4 或 8 小节 phrase 尾；不得改变下一轮 core 的第 1 拍重心。

### Gate G1：Pattern 语义

对所有 KB phrase 做机器验证：

1. `slow-boombap` 的 Snare/Rim anchor 在人类第 2、4 拍存在。
2. `slow-soul-halftime` 的主 Snare/Rim anchor 在人类第 3 拍存在。
3. 每个 2-bar phrase 都有 Kick 重心或明确 pickup 通向第一拍。
4. Core phrase 不含大编制 tom fill、EDM rise 或 trap roll。
5. 相同 phraseId 编译两次时，nominal onset mask 完全一致。

## Batch 2：Arranger 选择整首 Groove，不再逐小节轮换

### 任务

- `LHB-G07`：Arranger 每首歌只选择一个 primary groove identity；breakdown 可以切换到同 family 的 minimal phrase，但不能换成另一种流派。
- `LHB-G08`：主循环按以下语义编排：
  - Bars 1–2：`coreA`
  - Bars 3–4：再次使用 `coreA`，或只在第 4 小节使用受控 `answer`
  - Bars 5–6：`coreA` 或低预算 `coreB`
  - Bars 7–8：`coreA + turnaround`
- `LHB-G09`：4-bar phrase 内最多 1 个 structural mutation bar；8-bar phrase 内最多 2 个。
- `LHB-G10`：删除 Instrumental 层按 `bar.role / phraseIndex` 自动轮换 variant 的路径；改为只消费 Arranger 已确定的 phrase placement。
- `LHB-G11`：RepeatGroup 重放 section 时，默认重放同一 DrumPhrase score；只允许 Arranger 显式声明的 second-pass mutation。
- `LHB-G12`：Performance 层只改变 microtiming/velocity；结构 ghost、open hat、pickup 必须来自 phrase 中已声明的 variation slot。

### Gate G2：单首歌内部重复

在 200 个 LOFI seed 的 main-loop eligible bars 上：

- 2-bar core phrase reuse coverage：每首歌 `>= 70%`。
- 1-bar unique rhythm signature ratio：每首歌 `<= 0.35`。
- Structural mutation bar ratio：每首歌 `<= 25%`。
- 4/8 小节边界外的 fill：`0`。
- 不允许再出现 eligible bars 全部拥有不同 rhythm signature 的歌曲。
- 经典 Boom-bap family 的 2/4 backbeat anchor coverage：`100%`。
- Half-time family 的第 3 拍 backbeat anchor coverage：`100%`。

跨 seed 仍需保持多样：

- 200 个 seed 必须覆盖上述 3 个 groove family。
- 至少使用 8 个不同 song-level core phrase identity。
- 同 seed 重跑时 phrase 与 placement 完全一致。

## Batch 3：和声从长 progression 改为短采样 Loop

### 任务

- `LHB-H01`：将 2、3、4 chord identity 的 LOFI loop 设为默认词汇；和弦数量与小节数量分开建模。
- `LHB-H02`：允许一个 2–4 chord cell 占据 4 或 8 bars，通过 prolongation、重复或 voicing rhythm 延长，而不是追加新和弦。
- `LHB-H03`：提高 `LOFI_SHORT_FOUR_CELL` 及同类短 cell 的选择权重，并增加：
  - 2-chord soul vamp；
  - 3-chord unresolved loop；
  - 4-chord jazz-extended loop。
- `LHB-H04`：8/12/16 chord progression 只保留为少数“composed jazzhop”分支，不再是 LOFI Hip Hop 默认。
- `LHB-H05`：同一主循环 section 使用同一 harmonic loop identity；变化优先来自 register、rhythmic comping、角色加减，不来自每轮新增功能和弦。
- `LHB-H06`：保留 `maj7/maj9/m7/m9/6/9/add9/sus` 等扩展色彩，但默认短 Loop 在 8 bars 内最多出现 1 个明显的 chromatic functional event。

### Gate H

在 200 个 LOFI seed 中：

- 至少 `70%` 的歌曲，最短和声周期为 2–4 个 chord identity。
- `100%` 的歌曲，主 core loop 不超过 8 个 chord identity。
- 8 个以上不同和弦的 composed progression 占比 `<= 30%`。
- 主循环每次重复的 chord identity 顺序完全一致；不得靠后处理删和弦通过。

## Batch 4：Lead 退到回应位置，Loop 成为 Hook

### 任务

- `LHB-L01`：Arranger 增加逐小节 `leadPresence` 或等价 directive，覆盖 main-loop，而不只覆盖 setup/breakdown/outro。
- `LHB-L02`：Lead 采用 4/8 小节的 `rest → answer → rest → turnaround response` 语法。
- `LHB-L03`：Lead 只能在已声明的 active phrase 生成音符；休止必须在 Lead 生成前确定，禁止 Renderer 事后删音。
- `LHB-L04`：Comp/sample loop 必须能独立承担 hook；Lead 不得每小节都给出新主题。
- `LHB-L05`：第二遍 section 优先使用少量 motif recall，不生成全新的持续旋律。

### Gate L

- main-loop Lead active-bar coverage 每首歌为 `25–45%`。
- 任意长度 `>= 16 bars` 的 main-loop body，至少存在一个连续 4-bar 的 Lead intentional rest。
- Lead silent bar 不得含尾音之外的新 onset。
- Lead 移除后，Drum + Bass + Comp 仍能清楚呈现完整 2-bar/4-bar hook。

## Batch 5：用加减法完成段落，而不是持续作曲

### 任务

- `LHB-F01`：保留现有 intro/loop/outro 宏观结构，统一到 4/8 小节 phrase grid。
- `LHB-F02`：section 差异优先使用角色加减：
  - intro：Comp/sample 单独出现，或只有极简鼓提示；
  - first loop：完整 core Drum + Bass + Comp；
  - second pass：增加有限 Lead answer 或高层 Hat；
  - breakdown：减 Kick、减 Hat 或 Lead 全休止，但保留 groove identity；
  - outro：回到 sample/comp，或一次干净的 final cadence。
- `LHB-F03`：禁止使用 Pop 式 pre-chorus/chorus build、EDM riser/drop 或每 4 小节不断加层直到满编。
- `LHB-F04`：每个 8-bar block 至少有一次可听出的角色加/减，但不得因此改变核心 DrumPhrase。

### Gate F

- 所有 section 边界落在 4/8 小节 phrase boundary，pickup 除外。
- 至少有一个 section change 由“减少角色”完成。
- 段落变化不能依赖新音色、滤波、噪声或自动化才能被识别。

## 6. 综合验收 Gate X

### 6.1 自动验收

固定 200 个 LOFI seed，全部满足：

1. Tempo 仍在 `70–86 BPM`。
2. Gate G1、G2、H、L、F 全部通过。
3. 同 seed 的 ArrangementPlan、nominal rhythm signature 与 harmonic loop identity 可复现。
4. `POP / RNB / JAZZ / ACG` 的现有生成测试无回归。
5. Final IR 中每个结构 onset 都能追溯到 Arranger phrase directive 或 KB variation slot。
6. Renderer 没有新增任何 LOFI 专用的结构删改条件。

### 6.2 分层人工审听

固定审听 seed：`0, 2, 7, 42, 99`。每个 seed 导出：

- `drum.mid`
- `drum+bass.mid`
- `drum+bass+comp.mid`
- `full.mid`
- `arrangement-log.json`

审听顺序：

1. 先只听 Drum：不看工程，能否在 2 小节内认出稳定的慢速 Hip Hop/Boom-bap pocket。
2. 加 Bass：Bass 是否增强 Kick 重心，而不是形成另一套繁忙节奏。
3. 加 Comp：是否像短 soul/jazz sample loop，而不是完整钢琴曲和声推进。
4. 最后加 Lead：Lead 是否只在空位回应，拿掉 Lead 后歌曲是否仍成立。

以下任一情况直接判定失败：

- 鼓听起来每小节都在换 pattern；
- 找不到稳定的 Snare/Rim backbeat；
- 必须依赖尘埃噪声、低通滤波或旧唱片音色才能像 LOFI；
- 和声不断去新地方，听不出 sample-loop 重复；
- Lead 连续演奏，抢走 beat 的主角位置；
- 只在最终 Renderer 或 MIDI 导出后删事件才达到指标。

## 7. 明确非目标

本任务禁止顺手修改：

- EQ、滤波、声像、压缩、Limiter、响度；
- 乐器音色、鼓采样、Piano preset、Bass preset；
- vinyl hiss、wow/flutter、tape saturation、bit crushing；
- reverb、delay、send、CC7/91/93；
- Dream 5504 音频引擎、硬件渲染或母线；
- 非 LOFI 风格的编曲逻辑。

如果人工审听发现“鼓点对但声音不像”，记录到后续音色/混音任务，不在本任务内处理。

## 8. 主要落点

预期修改位置：

- `src/core/generation/newEngine/knowledge/grooves.ts`
- `src/core/generation/newEngine/knowledge/grooveContracts.ts`
- `src/core/generation/newEngine/knowledge/progressions.ts`
- `src/core/generation/newEngine/arranger/ArrangementPlan.ts`
- `src/core/generation/newEngine/arranger/drumPerformancePlanner.ts`
- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`
- `src/core/generation/newEngine/render/drumRenderer.ts`
- `src/core/generation/newEngine/render/drumHumanityAudit.ts`
- `scripts/audit-lofi-hiphop-arrangement.ts`
- 对应的 Vitest 测试与 `docs/generated/lofi_hiphop_arrangement_audit.md`

文件列表是预期落点，不是授权在 Renderer 里打风格补丁。实施时如果职责应上移，优先修改数据模型与 Arranger。

## 9. 完成定义

只有同时具备以下交付物，任务才算完成：

- 新的 2-bar LOFI DrumPhrase 数据模型与至少 9 个 core phrase。
- Arranger-owned phrase placement、structural mutation 与 Lead presence。
- 2–4 chord identity 为主的 LOFI harmonic loop vocabulary。
- 200-seed before/after 审计报告。
- 5 个固定 seed 的分层 MIDI 审听包。
- 专项测试通过。
- `pnpm exec tsc --noEmit` 通过。
- `pnpm test -- --run` 通过。

## 10. 编曲参考锚点

这些参考只用于确认编曲语言，不要求复制任何作品：

- [Oxford Academic：LOFI Hip Hop 的短和声 Loop、Boom-bap 与 microrhythm](https://academic.oup.com/book/58670/chapter/485385463)
- [Berklee：Hip Hop 的 2/4 backbeat 与松弛 Hat 语言](https://www.berklee.edu/berklee-now/news/essential-features-of-hip-hop-production-tempo-instrumentation-rhythmic-feel-and-sonic-density)
- [Native Instruments：LOFI 的慢速、简单重复编曲与爵士和声](https://blog.native-instruments.com/lo-fi-hip-hop-beats/)
- [Ableton：松弛、非完全量化的 Hip Hop pocket](https://www.ableton.com/en/packs/lofi-hiphop/)
