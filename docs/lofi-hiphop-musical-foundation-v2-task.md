# LOFI Hip Hop 慢速灵魂 / Boom-bap 音乐骨架 V2 任务书

状态：自动实现与 500-seed Gate 已完成；16-seed 人工盲听待复核

执行日期：2026-07-30

任务代号：`LOFI-HIPHOP-MUSICAL-FOUNDATION-V2`

自动结果：

- [500-seed before/after 与参考包络报告](generated/lofi_musical_foundation_comparison.md)
- [V2 after 完整 JSON](generated/lofi_musical_foundation_after.json)
- [参考编曲 manifest](lofi-reference-arrangement-manifest.json)
- 分层审听包：`tmp/lofi-musical-foundation-review/seed-*/`

执行说明：

- 生产实现、TypeScript、LOFI 定向测试、V1 200-seed 回归和 V2 500-seed Gate
  均已通过。
- V1 当时只保存了 200-seed schema；V2 before 文件如实冻结该已知基线，对当时没有
  测量的 Kick、TopLoop、Final voicing 与 Pad 字段保留 `null`，没有伪造 500-seed
  历史数据。
- `REF-A` 是高置信结构参考；`REF-B–G` 只作为宽家族边界。长合集尚未进行逐窗口人工
  转录，因此不把不确定检测值当硬 Gate。
- 16 颗 seed 已自动分层导出 MIDI、日志、feature comparison 与盲听表；最终主观盲听
  分数仍需在本机播放链中填写。

前置基线：`LOFI-HIPHOP-ARRANGEMENT-V1` 已完成，见
`docs/lofi-hiphop-boombap-arrangement-repair-task.md` 与
`docs/generated/lofi_hiphop_arrangement_audit.md`。

当前范围：只修改作曲、编曲、角色互动、音符选择与原生演奏计划。暂不修改
EQ、压缩、响度、空间、鼓采样、乐器预置、黑胶噪声、磁带抖动或母带。

## 1. 目标

让 LOFI 从“已经会稳定循环”进化为“稳定循环本身就具有慢速 Soul / Boom-bap
的音乐身份”：

1. 鼓先建立 Hip Hop pocket，经典 2/4 backbeat 是默认主干。
2. Kick 稀疏、有重心，依靠两小节问答而不是持续切分制造存在感。
3. 允许低密度的四小节上层打击乐 Loop，但不把参考视频的具体素材写死。
4. 和声以 2–4 个有爵士色彩的短 Loop 为主，Comp 与 Pad 使用真正连续的声部连接。
5. Bass、Comp、Pad 先形成完整 foundation，Lead 再从其留下的空间中生成。
6. 变化由 Arranger 的段落意图与预算产生；Renderer 不在最后补“Lo-Fi 味”。
7. 多颗 seed 应覆盖多种 LOFI，而不是复制一条参考的 BPM、鼓点或和弦。

最终听感优先级：

`Hip Hop pocket → 短 Soul/Jazz Loop → Bass/Comp/Pad 胶合 → 稀疏旋律回应`

## 2. V1 已解决什么，V2 还缺什么

V1 的 200-seed 审计已经通过：

- Tempo `71–85 BPM`；
- 两小节 core phrase 平均复用率 `87.8%`；
- 一小节鼓型 unique ratio 平均 `9.1%`；
- backbeat anchor `100%`；
- 2–4 chord 短 Loop 占比 `80%`；
- Lead active bar 平均 `38.8%`。

这些指标证明当前系统不再逐小节随机作曲，但尚未回答以下问题：

| V2 问题 | 当前证据 | 音乐后果 |
| --- | --- | --- |
| 默认鼓不是足够明确的经典 Boom-bap | Groove 权重为 `4:3:2`，经典两拍 backbeat 只占主池约一半 | 第一耳朵可能更像 dusty break 或 half-time chill |
| Kick 偏密且切分位过多 | 多个 core phrase 每小节有 2–3 个 Kick，常出现 `0.5/0.75/1.5/1.75/2.25/2.75/3.5` | 重心不够朴素，和参考中的慢速点头感有差距 |
| 变化是固定日历，不是音乐意图 | 每个 Loop section 的第 8 小节强制 `turnaround` | 所有歌出现同一种周期性“提醒” |
| Renderer 仍会补 LOFI 边界击打 | `drumRenderer.ts` 的 `lofi-one-shot` 固定补 side-stick 与 Kick | Final IR 出现无法回溯到上层 phrase 的结构音符 |
| 缺少独立上层打击乐语法 | DrumPhrase 只有单一 hits 数组 | 无法泛化参考中的 4-bar auxiliary percussion / foley loop |
| Pad 的 LOFI 策略在渲染期决定 | Verse + Comp 默认选择 `cluster-mist` | “雾感”被当成风格硬规则，且不消费前一和弦 voicing |
| Comp 有两套不一致的配音路径 | 钢琴走 wide semantic lanes，其他乐器走 octave-search placement | 同一和声意图因乐器类型得到不同 voice-leading 质量 |
| 现有和声审计只看 chord identity | 尚未审计最终 Comp/Pad 的真实 MIDI 移动 | 和弦名称正确不代表相邻和弦连接自然 |

因此 V2 不重做 V1，而是在其稳定 Loop 基线上补齐“音乐分布、角色互动与最终音符
质量”的门禁。

## 3. 参考集：多家族，不以单曲为真值

### 3.1 参考音频

| ID | 参考 | 在本任务中的用途 | 不用于 |
| --- | --- | --- | --- |
| `REF-A` | [用户提供的 rly Beats Shorts](https://www.youtube.com/shorts/Dlum-dlNz24) | 约 86 BPM 的干净 Study Lo-Fi；严格 2/4 backbeat、八分 Hat、约 2.25 Kick/bar、稳定 2-bar 鼓与 4-bar 上层打击乐 | 复制其具体 MIDI、工程轨名或素材 |
| `REF-B` | [Lofi Girl — Best of lofi hip hop 2021](https://www.youtube.com/watch?v=n61ULEU7CO0) | 现代 Study Lo-Fi 的宽分布；用于避免只适配教学短视频 | 把整张合集平均成一个固定 pattern |
| `REF-C` | [Chillhop Essentials · Spring 2021](https://www.youtube.com/watch?v=lve6KTZTKDw) | Jazzy Chillhop 的鼓、和声、Bass 与旋律互动范围 | 要求所有 seed 都具有同等旋律密度 |
| `REF-D` | [J Dilla — Time: The Donut of the Heart](https://www.youtube.com/watch?v=c6qOBFkvdG0) | Sample-loop 组织、Dilla pocket 与非对称重复的极端参照 | 把 Dilla timing 设成所有 LOFI 的默认 |
| `REF-E` | [Nujabes — Feather](https://www.youtube.com/watch?v=hQ5x8pHoIPA) | Jazz harmony、Bass/Comp/Lead 共存和较明亮分支的对照 | 约束慢速主风格的 BPM |
| `REF-F` | [idealism — Sit In Silence](https://www.youtube.com/watch?v=VXzjpjANMOc) | Ambient / minimal Study 分支、Pad 与留白 | 让 Pad 取代 Hip Hop 鼓骨架 |
| `REF-G` | [saib. — West Lake](https://www.youtube.com/watch?v=wbysDvxmgd0) | Jazzy instrumental beat 的角色平衡与短循环 | 复制旋律或绝对和弦 |

参考优先级：

- 主分布：`REF-A + REF-B + REF-C`；
- 风格边界：`REF-D + REF-E + REF-F + REF-G`；
- 任一生成结果只需接近一个合理的 LOFI 家族，不需要同时接近所有参考。

### 3.2 参考数据纪律

- 不把受版权保护的完整音频提交到仓库。
- 仓库只保存 URL、时间窗、人工标注、派生统计、算法版本与置信度。
- 每个长合集固定抽取至少 6 个不同曲目的 8-bar 主 Loop；单曲至少抽取 2 个稳定段落。
- 鼓 onset 与 chord 标注必须注明 `manual | detector | hybrid` 和 confidence。
- 参考音频只比较编曲特征；频谱、响度、噪声、音色 embedding 不进入本任务分数。
- 音频识别不确定的维度不参与硬 Gate，不能用低置信检测反向改写生成器。

## 4. 不可违反的架构原则

### 4.1 自上而下的唯一数据流

```text
LOFI Style
  → song-level LofiFoundationArchetype
  → immutable LofiFoundationPlan
  → section layer projections
  → Drum / Bass / Comp / Pad score plans
  → foundation occupancy map
  → Lead plan and notes
  → faithful NoteIR / MIDI projection
```

### 4.2 各层职责

| 层 | 应拥有 | 不应拥有 |
| --- | --- | --- |
| Knowledge | 风格 archetype、DrumPhrase/TopLoop/和声/voicing/pad 词汇及权重 | 某个 seed 的 section 位置、参考曲绝对音符 |
| Arranger | 整首 foundation identity、phrase ID、mutation budget、可用和声池身份、角色加减、Lead 空间 | 指定某一条和声模板整首常驻、乐器 program、EQ、最终音符删除 |
| Score/Instrumental planner | 把上层意图解析为最终 nominal onset、pitch、duration、velocity intent | 按 `style === LOFI` 自行另选 pattern |
| Performance | 已声明音符的力度、发音与微时序 | 新增 Kick/Snare、改写和弦、制造休止 |
| Renderer / MIDI adapter | 忠实投影、MIDI 生命周期安全 | 风格填充、自动“纠错”、为了 Gate 删事件 |
| Auditor | 只读测量与报告 | 修改生成结果 |

### 4.3 明确禁止

- 不得保存 `86 BPM + 某一套绝对 beat 数组` 作为“参考视频模式”。
- 不得出现以视频 ID、轨名 `Fake plants` 或参考曲名命名的生产知识。
- 不得在 Renderer 中新增 `if (style === 'LOFI')` 的结构性音符增删。
- 不得先生成复杂 MIDI，再量化、稀释、删音或重排来通过审计。
- 不得把音色识别误差归因于编曲并用音符补偿。
- 不得只试听一颗 seed 后不断局部调参。

## 5. 目标数据模型

新增或等价实现一个整首只选择一次的 `LofiFoundationPlan`。这里“整首只选择一次”仅指鼓组、
Groove、voicing、Pad 与 Lead-space 等 Foundation 身份；和声仍由 HarmonyEngine 从完整 LOFI
池中按 repeat group 选择，Foundation 只声明 mode-aware pool，不持有具体 progression ID：

```ts
interface LofiFoundationPlan {
  archetypeId:
    | 'slow-soul-boombap'
    | 'dusty-dilla-boombap'
    | 'slow-soul-halftime'
    | 'ambient-study-boombap';
  grooveContractId: string;
  drumPhraseId: string;
  topLoopId?: string;
  harmonyPoolId: `lofi-progression-pool:${'major' | 'minor'}`;
  mutationBudget: {
    coreBars: number;
    maxMutatedBars: number;
    allowedFunctions: readonly ('answer' | 'dropout' | 'pickup')[];
  };
  voicingIntent: {
    family: 'close' | 'drop2' | 'rootless-guide';
    register: readonly [number, number];
    maxVoicesWithBass: number;
  };
  padIntent: {
    family: 'common-tone' | 'guide-bed' | 'slow-two-voice' | 'none';
    anticipationProbability: number;
  };
  leadSpace: {
    activeBarTarget: readonly [number, number];
    minimumContiguousRestBars: number;
  };
}
```

具体字段名可按现有类型系统调整，但必须满足：

1. 同一首歌的主 DrumPhrase 与 foundation archetype 只选择一次；和声从完整 LOFI 池按
   repeat group 选择，Clark-derived 进行与既有进行都是普通候选，均不得被 Foundation 强制常驻。
2. Section 只能投影 `full / reduced / dropout / answer` 等 layer state。
3. 角色开关不会偷偷换成另一个流派。
4. 所有随机选择来自可命名的 forked RNG 子流，同 seed 可重现。
5. Audit 能从计划与 HarmonicPlan 反查 archetype、phrase、top loop、实际消费的 progression
   prototype 与 voicing intent；`harmonyPoolId` 本身不是实际 progression identity。

建议初始 archetype 权重：

| archetype | 初始权重 | 说明 |
| --- | ---: | --- |
| `slow-soul-boombap` | 60 | 默认身份，严格 2/4 backbeat、稀疏 Kick |
| `dusty-dilla-boombap` | 20 | 偏拍与 ghost 变化，但不破坏 backbeat |
| `slow-soul-halftime` | 12 | 次要半拍分支 |
| `ambient-study-boombap` | 8 | 更稀疏的 Comp/Pad/Lead，鼓仍保留 Hip Hop 身份 |

权重是知识库初始先验，Batch 0 的参考分布与 Batch 7 的盲听可以调整；不得按单颗 seed
修改。

## 6. 实施批次

严格顺序：

`Reference Baseline → Foundation Plan → Drum Grammar → Harmony/Voicing → Pad/Bass → Lead/Form → Multi-seed Comparison`

前一批硬 Gate 未通过，不进入后一批的主观调音。

## Batch 0：建立可复现的参考特征与 V2 before 基线

### 任务

- `LF2-A01`：新增参考 manifest，记录 `REF-A…G`、URL、曲目/时间窗、使用维度与置信度。
- `LF2-A02`：新增只读参考特征脚本；输出 MIDI 等价的编曲特征，不保存音频。
- `LF2-A03`：固定每个家族的 feature envelope，保存 `p10 / median / p90`，不只保存均值。
- `LF2-A04`：对当前 500 个 LOFI seed 运行同一特征 schema，冻结为 V2 before。
- `LF2-A05`：保留 V1 的 200-seed Gate，不覆盖现有报告。
- `LF2-A06`：每个参考窗口同时保留一页人工复核表，自动识别结果必须能被纠错。

### 特征 schema

鼓：

- BPM、meter；
- 2/4 或 half-time backbeat coverage；
- beat 1 Kick coverage；
- Kick hits/bar、Kick slot histogram、syncopation index；
- Hat 主细分、on/off-beat velocity contrast；
- 1-bar / 2-bar / 4-bar onset autocorrelation；
- structural mutation 与 fill bars/16 bars；
- auxiliary percussion 是否存在、周期、hits/bar；
- kick/snare/hat/aux 的角色间碰撞。

和声与配音：

- chord identities/cycle、cycle bars；
- 每个和弦 sustain bars 与 harmonic rhythm entropy；
- 7th/9th/11th/13th 或 add/sus 色彩覆盖；
- strong dominant-tonic cadence rate；
- 相邻和弦最小一一配对移动的 mean / p95；
- top voice jump p95；
- common-tone retention；
- voice crossing、低区小二度/小九度碰撞；
- Bass active 时 Comp/Pad root doubling。

角色密度：

- Bass onsets/bar、与 Kick 同起比例；
- Comp attacks/bar；
- Pad attacks/bar、voices/attack、sustain coverage；
- Lead active bars、notes/bar、最长连续休止；
- Foundation 与 Lead 的 onset/register collision。

### Gate A

- 相同输入与 detector 版本产生相同 JSON。
- 每个特征带单位、有效样本数与 confidence。
- 参考缺失值不会被填成 0。
- V2 before 能复现当前 200-seed V1 指标，并额外暴露 Kick、fill、aux、voicing、Pad 指标。

## Batch 1：整首 Foundation Archetype 与 Plan

### 任务

- `LF2-P01`：新增 `LofiFoundationArchetype` 知识库，不把四个家族散落在多个 Renderer policy。
- `LF2-P02`：Arranger 在开始生成角色之前选择一次 `LofiFoundationPlan`。
- `LF2-P03`：将 plan 写入 `ArrangementPlan`，并为 section 生成只含加减法的 layer projection。
- `LF2-P04`：GrooveContract、DrumPhrase、Harmony prototype、Pad plan 必须由同一 archetype 约束，避免各角色独立抽到互相冲突的子风格。
- `LF2-P05`：RepeatGroup 默认复用同一 foundation identity；第二遍只能消费 plan 中的 mutation budget。
- `LF2-P06`：为所有 plan choice 建立 provenance，Final IR 审计可追踪。

### Gate P

- 每首 LOFI 恰有一个 `LofiFoundationPlan`。
- 任一 section 不得切换到另一 archetype。
- 相同 seed 的 plan 深度相等。
- 500 seeds 覆盖四个 archetype，实际占比在配置权重的统计容差内。
- 非 LOFI style 的 ArrangementPlan 与输出无回归。

## Batch 2：重写为稀疏 Boom-bap Drum Grammar

### 任务

- `LF2-D01`：把 DrumPhrase 拆成语义 lane：
  - `kick`
  - `backbeat`
  - `timekeeper`
  - 可选 `ghost`
  - 可选 `auxiliaryTopLoop`
- `LF2-D02`：默认 `slow-soul-boombap` 至少提供 6 个 core 2-bar phrase；不能只是同一 mask 的力度变体。
- `LF2-D03`：新增至少 4 个可复用的 4-bar `auxiliaryTopLoop`，使用 shaker、side-stick、low percussion 或抽象 percussion role；它们不能依赖具体音色名字。
- `LF2-D04`：经典分支的 backbeat 固定在人类第 2、4 拍；half-time 只能由显式 archetype 选择。
- `LF2-D05`：经典分支每小节必须建立 beat 1，Kick 的其他位置来自带权候选语法，而不是固定复制 `1 → 2.5 → 3.5`。
- `LF2-D06`：A/B 两小节的差异通常只改变一个 Kick response、一个 Hat 缺拍或一个低力度 ghost。
- `LF2-D07`：移除“每第 8 小节必然 turnaround”；mutation 由 Arranger budget 选择，可为 0。
- `LF2-D08`：移除 Renderer 的 `lofi-one-shot` 结构补音路径；如需 pickup，必须先存在于 `GrooveBoundaryScore` 的完整 hit score。
- `LF2-D09`：section boundary 默认通过减层、Hat dropout 或保持 core 实现，不要求 fill。
- `LF2-D10`：保留 Performance 的力度/微时序职责，但四个 archetype 使用各自 profile；直拍 Study 分支不能自动继承最重的 Dilla 延迟。

### Drum 目标区间

| 指标 | `slow-soul-boombap` | `dusty-dilla` | `half-time` |
| --- | ---: | ---: | ---: |
| backbeat anchor | 2/4 = 100% | 2/4 ≥ 95% | beat 3 = 100% |
| beat 1 Kick | ≥ 95% bars | ≥ 90% bars | ≥ 95% bars |
| Kick density | `1.75–2.75/bar` | `2.0–3.25/bar` | `1.5–2.75/bar` |
| 主 Hat | ≥ 75% 为八分语法 | 八分为骨架，可有弱 16 分 | 八分或有意缺拍 |
| core 2-bar reuse | ≥ 85% eligible bars | ≥ 75% | ≥ 85% |
| mutation | `0–1/16 bars` | `0–2/16 bars` | `0–1/16 bars` |

以上是初始生成区间，不是要求每一首同时命中所有参考 median。最终以 Batch 0
多参考 envelope 校准。

### Gate D

- 所有 core phrase 通过静态音乐规则测试。
- 500 seeds 中经典 `slow-soul-boombap` 成为多数。
- 不再存在“所有 8-bar block 的最后一小节必定 fill”。
- Final IR 的所有结构性鼓 onset 都能回溯到 DrumPhrase、TopLoop 或完整 BoundaryScore。
- 同一 exact 2-bar Kick mask 不得占全部 500 seeds 的 `20%` 以上。
- 至少出现 16 个不同的 2-bar Kick mask，以及 4 个不同的 aux identity。

## Batch 3：短 Soul/Jazz 和声与统一 Final Voicing

### 任务

- `LF2-H01`：保留当前 2/3/4 chord 短 Loop，并增加以下“功能原型”，不是固定绝对和弦：
  - 下行 `IVmaj7/9 → iii7/9 → ii7/9 → Imaj7/9`；
  - 软 `ii9 → V7 altered/sus → Imaj9`；
  - 2-chord soul vamp；
  - 3-chord unresolved/modal float；
  - minor `i9 ↔ VImaj7/9` 及其弱中间和弦。
- `LF2-H02`：短 Loop 可以跨 4–8 bars 延长，同一 chord identity 可持续或重复，不追加新功能和弦填满小节。
- `LF2-H03`：至少一个色彩音是默认目标；不强制每个 slot 都成为九/十一和弦。
- `LF2-H04`：将最终 Comp pitch 选择放入统一的 `FoundationVoicingPlanner` 或等价 score 阶段。
- `LF2-H05`：钢琴与非钢琴共享相同的 candidate/cost contract，再通过乐器能力过滤候选；不再各自解释“最小移动”。
- `LF2-H06`：candidate 至少覆盖 close、inversion、Drop-2、rootless guide-tone；Bass active 时优先 3/7/9/13，避免根音堆叠。
- `LF2-H07`：cost 必须执行真正的一一声部匹配，包含：
  - common-tone reward；
  - 总移动与最大单声部移动；
  - top voice 连续；
  - voice crossing；
  - register 与低区小音程；
  - Bass–Comp 间距；
  - 角色保留是软约束，不得阻止更近的合理交叉映射。
- `LF2-H08`：Comp 默认集中于 `C3–C5` 附近，但允许 Drop-2 / piano capability 合理越界；范围是 archetype intent，不是事后 octave clamp。
- `LF2-H09`：和弦选择器的抽象 ledger 继续负责功能解决；Final Voicing auditor 单独验证真正发声的 MIDI，不把两者混为一个 Gate。

### Gate H

- 500 seeds 中至少 `85%` 使用 2–4 chord identity 的主 Loop。
- 主分支至少 `80%` 的 chord slots 含 7th、6/9、add9、sus 或更高色彩之一。
- 强属主终止不超过参考主分布的上界；Loop 不应每轮像歌曲结尾。
- Final Comp：
  - voice crossing = `0`；
  - 低区非法 cluster = `0`；
  - adjacent top jump p95 `≤ 7 semitones`；
  - matched voice movement median `≤ 5 semitones`；
  - Bass active 时无意 root doubling 在参考上界内。
- Keyboard 与非 keyboard 用相同和声输入时，功能音选择一致；差异只来自 capability。

## Batch 4：Pad 与 Bass 是 Foundation，不是补丁

### 任务

- `LF2-F01`：把 LOFI Pad mode 从渲染期 `style + sectionRole` 特判上移到 `LofiFoundationPlan`。
- `LF2-F02`：Comp active 时默认 Pad 为：
  - 单一 common tone；
  - 3rd + 7th guide bed；
  - 或低概率 slow two-voice；
  - `cluster-mist` 不再是 Verse 默认。
- `LF2-F03`：Comp inactive 时 Pad 可承担 2–3 声部 full support。
- `LF2-F04`：所有 Pad voicing 都消费 previous voicing；`cluster-mist` 若保留也必须 prev-aware。
- `LF2-F05`：相同 RepeatGroup 和同一 harmonic loop 跨 section 时不重置 previous voicing。
- `LF2-F06`：Pad 默认一和弦一次 attack、持续整个 chord span，并延续真实 common tones。
- `LF2-F07`：半拍 anticipation 只能在 plan 中以低概率声明；Renderer 不自行提前。
- `LF2-F08`：Bass pattern 由同一 archetype 选择，默认根音/五音/级进连接的低密度两小节 Loop。
- `LF2-F09`：Bass 可以强化或避让既有 Kick，但不得反向新增/删除 Kick；保留当前 LOFI `kickResponseLimit = 0`。
- `LF2-F10`：Foundation planner 产出 Comp/Pad/Bass 的真实 register occupancy，供 Lead 使用。

### Gate F

- Comp active 时 Pad 平均 `≤ 2 voices/attack`；Pad-only 时 `≤ 3`。
- Pad attacks 不超过和弦攻击数的参考上界。
- 可延续的 common tone 不允许无理由重击。
- Pad adjacent movement、top jump 与 crossing 使用与 Comp 同口径审计。
- Bass onset density 落在对应参考家族 envelope 内。
- Drum + Bass + Comp + Pad 在没有 Lead 时已经形成可辨认的 2/4/8-bar hook。

## Batch 5：在 Foundation 之后生成 Lead 与段落

### 任务

- `LF2-L01`：Lead planner 必须消费已完成的 foundation occupancy map，不得只看抽象 chord。
- `LF2-L02`：Lead register、active bars、入口拍点与最长 phrase 先规划，再生成音高。
- `LF2-L03`：Lead 与 Comp/Pad 的共享音高允许作为有意 common tone，但避免相同 register 的同步反复攻击。
- `LF2-L04`：主分支保留 V1 的 `25–45%` active bars 与 4-bar intentional rest。
- `LF2-L05`：Jazzy/Nujabes-like 分支可以提高旋律存在感，但必须由 archetype 明确声明，不能抬高整个 LOFI 池。
- `LF2-L06`：段落变化优先为：
  - intro：和声 foundation 或极简 timekeeper；
  - main：完整 core；
  - second pass：TopLoop 或 Lead answer；
  - breakdown：减 Kick、Hat、Lead 或 Pad；
  - outro：减层并保留 loop identity。
- `LF2-L07`：任何 section change 不依赖滤波、噪声、FX automation 才能成立。

### Gate L

- Lead silence 在生成前就存在，Final IR 不得靠删音制造。
- 主分支 active bars 仍为 `25–45%`。
- Foundation/Lead 同音同 register 同 onset 的无意碰撞低于参考上界。
- 移除 Lead 后，groove 与 harmonic hook 仍完整。
- 所有主要段落差异在纯 MIDI 中可以听辨。

## Batch 6：Renderer 去风格化与可追踪性

### 任务

- `LF2-R01`：清点 `drumRenderer.ts`、`padRenderer.ts`、`accompanimentRenderer.ts` 中全部 LOFI 结构特判。
- `LF2-R02`：把音乐决策上移；Renderer 只保留事件投影、物理范围与 MIDI 生命周期安全。
- `LF2-R03`：Final note provenance 至少标记：
  - `foundationPlanId`
  - `sourcePhraseId/sourceTopLoopId/sourceHarmonySlot`
  - `role`
  - `section/bar`
  - `performanceProfileId`
- `LF2-R04`：新增“不可解释 onset”审计；Renderer 注入的安全事件不计音乐事件且通常应为 0。
- `LF2-R05`：禁止任何 Final IR style shaper 通过删 Kick、删 Pad、稀释 Lead 或重排 voicing 来过 Gate。

### Gate R

- LOFI Final IR 的结构 onset provenance coverage = `100%`。
- Renderer 中不存在新建音乐性的 LOFI branch。
- 修改前后非 LOFI renderer 行为保持现有测试结果。
- 所有 MIDI 同键重击、note-off 与范围安全测试通过。

## Batch 7：500-seed 结果对照与人工审听

### 7.1 自动对照方法

生成 seed `0…499`，对每首 Final IR 计算 Batch 0 相同的 feature vector。

比较对象不是某首参考的音符，而是每个参考家族的区间：

```text
distance(feature, envelope) =
  0                         feature 在 p10…p90 内
  到最近边界的标准化距离       feature 在区间外

familyDistance =
  confidence-weighted RMS(valid feature distances)
```

- 缺失或低置信参考特征不进入分母。
- 每个 seed 记录最近参考家族、距离、命中维度与偏离维度。
- Drum、Harmony/Voicing、Role Density 分别评分，不用单一总分掩盖失败。
- 不比较绝对 pitch、旋律序列、音色或 waveform 相似度。

### 7.2 统计 Gate

500 seeds 必须同时满足：

- V1 的全部 hard gates 无回归。
- 至少 `75%` 的 seed 在三个主评分面中有两个落入某个合理参考家族 envelope。
- 至少 `85%` 的 seed 通过 LOFI core musical constraints：
  - 慢速；
  - 明确 Hip Hop backbeat；
  - 可复用两小节鼓身份；
  - 2–4 chord 短 Loop；
  - Foundation 独立成立；
  - Lead 有留白。
- 四个 archetype 均有样本，不能靠删除难分支提高总分。
- 没有单一 exact DrumPhrase、harmonic loop 或完整 foundation combination 占比超过 `20%`。
- 同 seed 重跑的 Plan、Final nominal notes 与报告完全确定。
- 固定 leave-one-reference-out 检查：去掉 `REF-A` 重新计算分布门槛后，主 Gate 仍通过，证明没有只适配用户视频。

### 7.3 分层审听包

由脚本按 archetype 确定性选择最早命中的 seed，不允许人工挑“最好听”的：

- 每个 archetype 3 颗，共 12 颗；
- 另加 4 颗距离 envelope 边界最近的压力 seed；
- 总计 16 颗。

每颗导出：

- `drum.mid`
- `drum+top.mid`
- `foundation.mid`（Drum + Bass + Comp + Pad）
- `full.mid`
- 若现有固定渲染链可用：对应 audition WAV；
- `arrangement-log.json`
- `feature-comparison.json`
- `review.md`

审听顺序：

1. Drum：两小节内是否先听出慢速 Hip Hop，而不是泛 Chill、Trap 或 Funk。
2. Drum + Top：上层打击乐是否增强循环，不像独奏 fill。
3. Foundation：无 Lead 时是否已经像一个完整 beat。
4. Full：Lead 是否只回应空位。
5. 对照参考：判断相似特征，不判断是否复制旋律或音色。

人工评分每项 `0/1/2`：

- Boom-bap identity；
- slow-soul weight；
- loop coherence；
- harmony/voicing naturalness；
- foundation completeness；
- melodic space；
- originality / non-copy。

以下任一项直接失败：

- 只有加低通、噪声或旧唱片音色后才像 LOFI；
- Kick 忙到压过 backbeat；
- 每 8 小节机械出现同一 turnaround；
- Pad 每次换和弦都跳到新 cluster；
- Comp 和弦名称复杂但真实声部大跳；
- Lead 拿掉后作品不成立；
- 某颗 seed 失败后在 Renderer 加定向特判；
- 与 `REF-A` 出现长段完全相同的鼓 onset 序列。

## 7. 测试策略

### 7.1 单元与 property tests

- archetype → compatible contract/vocabulary；
- DrumPhrase anchor、density、A/B mutation budget；
- TopLoop 周期与 voice 合法性；
- Harmony loop length 与 chord color；
- 一一声部连接、common tone、crossing、register；
- Pad previous-voicing continuity；
- Bass 不改 Drum score；
- Lead 消费 foundation occupancy；
- Final provenance；
- same-seed determinism。

### 7.2 集成与回归

- 固定 500-seed V2 audit；
- 16-seed 分层导出；
- 现有 LOFI V1 audit；
- 全部 newEngine targeted tests；
- `npm run lint`；
- `npm test`。

新增建议命令：

```text
npm run audit:lofi-reference-envelope
npm run audit:lofi-musical-foundation
npm run export:lofi-musical-foundation-review
```

审计命令可以生成报告，但不得修改任何 production knowledge。

## 8. 调参闭环

只允许以下闭环：

1. 修改 Knowledge 权重、候选语法或 Arranger contract。
2. 运行全部 500 seeds。
3. 查看分布和最差分位，不只看平均值。
4. 自动选择固定审听 seed。
5. 完成盲听表。
6. 只按跨 seed 的系统性问题调整。
7. 重跑完整 Gate。

禁止以下闭环：

- 听 seed 42；
- 给 seed 42、某个 phrase ID 或某个 Renderer 路径加例外；
- 只重跑 seed 42；
- 宣称整体改善。

## 9. 预计代码落点

新增：

- `src/core/generation/newEngine/knowledge/lofiFoundationArchetypes.ts`
- `src/core/generation/newEngine/arranger/lofiFoundationPlanner.ts`
- `src/core/generation/newEngine/instrumental/foundationVoicingPlanner.ts` 或现有等价层
- `scripts/audit-lofi-reference-envelope.ts`
- `scripts/audit-lofi-musical-foundation.ts`
- 对应 `.test.ts`

修改：

- `src/core/generation/newEngine/arranger/ArrangementPlan.ts`
- `src/core/generation/newEngine/arranger/grooveScorePlanner.ts`
- `src/core/generation/newEngine/knowledge/grooveContracts.ts`
- `src/core/generation/newEngine/knowledge/grooves.ts`
- `src/core/generation/newEngine/knowledge/progressions.ts`
- `src/core/generation/newEngine/knowledge/voicingPlacement.ts`
- `src/core/generation/newEngine/knowledge/widePianoVoicings.ts`
- `src/core/generation/newEngine/render/padCompPolicy.ts`
- `src/core/generation/newEngine/render/padRenderer.ts`
- `src/core/generation/newEngine/render/accompanimentRenderer.ts`
- `src/core/generation/newEngine/render/drumRenderer.ts`
- `package.json`

预期生成：

- `docs/generated/lofi_reference_arrangement_envelope.json`
- `docs/generated/lofi_musical_foundation_before.json`
- `docs/generated/lofi_musical_foundation_after.json`
- `docs/generated/lofi_musical_foundation_comparison.md`
- `tmp/lofi-musical-foundation-review/`

文件列表表达职责落点，不授权在 Renderer 中实现风格决策。若现有目录命名与真实职责不符，
优先把新逻辑放到拥有音乐意图的上游层。

## 10. 非目标

本任务不修改：

- 鼓采样、SoundFont program、乐器预置；
- EQ、滤波、饱和、压缩、Limiter、响度；
- vinyl hiss、wow/flutter、bit crushing；
- reverb、delay、声像、send；
- 音频引擎或硬件输出；
- 非 LOFI 风格的音乐语言；
- 参考音频的逐音复刻。

人工审听如果结论是“节奏与和声已经像，但鼓声音仍不像”，记录为后续
`LOFI-TIMBRE-AND-MIX` 任务，不得在本任务扩大范围。

## 11. 完成定义

只有以下项目全部具备，任务才算完成：

- 整首 `LofiFoundationPlan` 已接入真实生产路径；
- 默认多数为慢速 Soul / 经典 Boom-bap；
- DrumPhrase 支持独立 4-bar auxiliary top loop；
- 固定第 8 小节 turnaround 与 Renderer `lofi-one-shot` 结构补音已移除；
- 2–4 chord 短 Loop 和统一 Final Voicing 已接通；
- Pad 计划上移且所有模式消费 previous voicing；
- Bass/Comp/Pad 先完成 foundation，Lead 后生成；
- Final IR 音乐事件 provenance 为 100%；
- 500-seed before/after 和多参考 envelope 报告齐全；
- 16-seed 分层 MIDI/审听包齐全；
- 人工盲听没有硬失败项；
- V1 audit、targeted tests、TypeScript 与全量测试全部通过；
- 没有参考曲专用知识、seed 特判或生成后的风格修补。

## 12. V2.1：LOFI Piano MIDI 和声 KB 扩充

状态：已加入实现任务；不包含听感验收

素材范围：8 份外部 LOFI Piano MIDI。只抽取可转调的和声功能、和弦色彩、低音角色与
和声节奏；不复制源文件、绝对音高、文件名、逐音符演奏或装饰旋律。

### 12.1 人工复核结果

| 素材标注 | 复核后的和声骨架 | 可泛化知识 |
| --- | --- | --- |
| G major | `IVmaj9 → iii11 → ii11 → Imaj9` | 4–3–2–1 下行、缺省根/五音的共同音 shell |
| A minor | `IIImaj7 \| iiø7–V7#9 \| i9 \| V9/5–V` | 小调 iiø–V–i、末小节开放属功能 |
| B minor（8 bars） | `iv7(no5)–v7(no5)–VImaj9 shell–v7 \| iv7–v7–i–VII` | Aeolian 往返；扩展 shell 与普通三和弦并存，不依赖强终止 |
| C modal | `Imaj7 → II/IImaj7` | 整音上行恒定结构 planing，不强判成传统功能终止 |
| B minor tonic texture | 持续 `i9/3` | 三音低音的主和弦 vamp；上层活动不误判成新和弦 |
| C minor | `i（2 bars）→ VI → VII`，末半小节加速 | 慢速 Soul 的长主和弦与句尾和声加速 |
| C# major | `IVadd9/3–ii9 → Imaj7` | 第一转位 IV、非对称首小节、plagal 下行 |
| D major | `I → i → bVII` | 平行小调借用与 bVII 模态下落 |

自动分析器只作为 MIDI 事件读取器使用：文件没有 key-signature 事件，而且滚奏、持续音和
内嵌旋律会让逐切片 chord classifier 把装饰音误认成换和弦，因此最终 Roman numeral 以
人工声部/低音复核为准。

### 12.2 生产落地

- [x] 升级既有 `lofi_descending_soul_4` 的两个中间 shell 为 `m11`。
- [x] 新增 7 个通用、可转调的 LOFI progression prototype。
- [x] 保留 `1.5 + 2.5`、`8 + 6 + 2`、四小节单和弦等有音乐意义的和声节奏。
- [x] 二次复核后保留原素材的品质层级：扩展和弦、稀疏 shell 与普通三和弦并存，
  不把所有骨架统一扩写成 9 和弦。
- [x] 通过 `bassRole` 表达第一转位、五音低音与三音低音，不写绝对 MIDI note。
- [x] 将新原型分配到 slow-soul、Dilla、half-time、ambient 四类 Foundation。
- [x] Foundation 仍先选整首 archetype，再从兼容和声词汇中选择；Renderer 不识别素材名。
- [x] Instrumentation 消费 Foundation 的 Comp 发音所有权；已写出的 finger-legato 不再被通用
  keyboard `0.9 gate` 二次缩短。
- [x] 增加 chord-type、总拍数、KB lookup、全原型 seed 可达性测试。
- [ ] 听感验收另行执行，不与本次 KB 结构验收混在一起。

### 12.3 非目标与版权边界

- 不把下载的 MIDI 放入仓库或测试 fixture。
- 不保存源文件的绝对音符、力度、微时值或完整钢琴演奏。
- 不增加某个文件名、某颗 seed 或某个 section 的特殊分支。
- 本阶段不修改 EQ、混音、音色、混响、CC 或 Renderer 后处理。
