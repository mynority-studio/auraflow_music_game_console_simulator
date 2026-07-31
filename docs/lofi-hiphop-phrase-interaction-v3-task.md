# LOFI-HIPHOP-PHRASE-INTERACTION-V3

状态：完成。本文是编曲层任务总纲与执行记录，不包含 EQ、混音、音色替换或成品
NoteIR 后处理。

## 1. 目标

让 LOFI Hip Hop 的各声部由同一份上游乐句意图共同演奏，而不是在各自独立的随机管道中
“合法地发音”：

1. 微观 humanize 服从 2–4 小节动态弧线，不以逐音随机抖动代替乐句语气。
2. Kick、Snare/Rim、Hat 的推拉是可复现的系统性 Groove 关系。
3. Lead、Comp、Bass 与 Drum 共享 call / response / rest / turnaround 语义。
4. Lead 以短动机复现、变形、制造张力并解决，而不是逐和弦无目的漫游。
5. Grammar terminal 与 Comp/Pad 织体填音必须服从每个 onset 所在的局部和声。
6. Clark Audio MIDI 派生进行只进入完整 LOFI progression pool，不成为整首固定特殊用例。

## 2. 架构约束

```text
Knowledge vocabulary
  → song/phrase interaction score
  → harmony + role score compilation
  → grammar/texture realization
  → performance projection
  → NoteIR/MIDI
  → read-only audit
```

- Knowledge 保存可复用 archetype、和声、节奏、动机与织体语法，不保存参考曲绝对音符。
- Arranger/Score 在生成音符前决定乐句弧线、角色轮换与允许的变奏预算。
- Grammar/Texture realizer 只从当前 HarmonicPlan 的稳定音、色彩音、局部音阶与 avoid 集合中消费。
- Performance 只实现已写好的重音、系统性 pocket 与 articulation，不新增结构音符。
- Renderer 不读取最终 Lead 音符后再删 Comp、补 Drum fill 或修正非法音。
- Auditor 只读采样与报告，永不修改生成结果。

## 3. 分批任务

### V3-A — LOFI 和声池所有权

状态：完成。

- `LofiFoundationPlan` 只携带 `lofi-progression-pool:major|minor`。
- HarmonyEngine 按 mode、section role 与 repeat group 从完整 LOFI 池选择。
- LOFI 不再经过“从池抽 6 次再由 coherence 取最高分”的隐式重排；curated pool 的声明权重
  直接生效。其他风格的候选择优保持不变。
- 池允许少数单和弦 ambient vamp 与原谱三和弦 planing；2–4 和弦短单元及七/九和弦仍必须
  在总体分布中占主导，不把“每首都扩展和弦化”当作硬门。
- HarmonicPlan 的每个 span 记录实际 `sourcePrototypeId`，用于审计而非强制回放。
- Clark-derived 7 个模板和原有模板共享同一选择机制与各自权重。

验收：

- Foundation 中不存在 `harmonicLoopId` 或 preferred/forced progression 通道。
- 固定种子可复现。
- 大样本中 Clark 与非 Clark 模板都可达。

### V3-B — Grammar / Texture 局部和声

状态：完成。

审计对象：

- Grammar 结构 terminal：`C / G / B / Triadic`。
- Grammar 填音 terminal：`S / L / H / X / Slope`。
- Grammar 趋近音：`A` 必须真实半音解决，或使用明示的局部音阶 fallback。
- Comp/Pad：攻击音与跨和弦延音。

局部和声合同：

- 结构 terminal 只能消费当前 span 的 stable/color 集合。
- 填音只能消费 resolved local scale，并排除 avoid tones。
- 织体允许 literal chord spelling 加 HarmonicPlan 明示的 9/11/13 stable/color。
- 跨越下一个和弦的长音，必须也被下一个 span 接纳；否则在 realizer/score 层于边界释放。
- 极小的负 timing pocket 只允许归属即将到来的和弦，不能被错误归到前一个 span。

已修复的源头问题：

- LOFI realizer 以前自行重算 scale，可能与 HarmonicPlan 分叉；现直接消费 plan 合同。
- `X`、未配对 `A` 的 fallback 曾能进入局部音阶外；现回落到 admitted local tones。
- 配对 `A` 曾只移动 approach 的八度，破坏真实半音关系；现保持实际一半音。
- 浮点边界会把和弦起点错成前一和弦；现仅在 realizer 输入边界做 epsilon snap。
- Grammar/Comp 长音会把当前合法音拖入下一个不接纳的和弦；现由上游 realization 在边界释放。
- 两个 chromatic-planing / dominant 模板缺少显式局部 scale；已分别声明 Ionian / Mixolydian。

200 种子硬门：

- Grammar structural / fill / approach conformance ≥ 99.5% / 99% / 99.5%。
- Comp attack / Pad attack conformance ≥ 99.9% / 99.5%。
- 非法长跨和弦暴露 ≤ 0.2%，且不能集中在单一 progression。
- 审计报告不得通过修改成品 NoteIR 获得。

### V3-C — 句法级动态弧线

状态：完成。

- 新增 `LofiPhraseInteractionPlan`，在 Arranger 中为每个四小节句子下发
  `settle → grow → crest → release`。
- Lead / Comp / Bass / Drum 各自读取同一 bar cue 中的角色力度比例；句法曲线先于逐音残差。
- LOFI 通用 velocity humanize 上限收窄到 `0.035`；Lead 的 phrase scale 在 MG StyleFeel
  之后落地，因此微观触键不能覆盖整句的 build / release。

验收：

- 同一句内的 velocity 与 phrase phase 显著相关。
- seed 间可变，但同 seed 完全复现。
- 关闭微随机后仍能保留可辨认的动态弧线。

### V3-D — 声部呼应与系统性 Groove

状态：完成。

- 主循环句法固定为 `statement → variation → answer/rest → return`。
- Lead 活跃小节的 Comp 只保留轻 shell / 和声入口；Lead 留白小节才允许中后拍 answer。
  过滤在 finger-legato 编译之前完成，避免删完攻击后留下非音乐性断洞。
- Drum turnaround 从 Lead-rest answer cue 产生；结构变奏从旧的 return bar `7/15`
  前移到 answer bar `6/14`。
- LOFI systemic pocket 由总谱明示：Kick anchor `0 ms`、offbeat Kick `-5 ms`、
  Snare/Rim `+20 ms`、Hat on/offbeat `+1/+10 ms`。鼓的逐 bar / limb 时序噪声在此路径停用。
- Bass 与 Comp 继续通过同一 GrooveScore 投影 phrase arc；Kick follow 仍受既有 response limit
  约束，不逐颗复制 Bass。

验收：

- Comp answer onset 只出现在计划的 Lead rest window。
- Lead 活跃窗口内 Comp 密度显著低于 Lead 休止窗口。
- Snare 相对 Kick 的中位 offset 稳定为正，离散度远小于无约束 jitter。
- 任何 turnaround 都能追溯到 phrase score，而不是 renderer boundary detector。

### V3-E — 动机与张力释放

状态：完成。

- 首个 statement 在 MG score-event 层建立 3–5 音 motif identity；相同 repeat group
  共用 LOFI answer motif id。
- variation 保留主体节奏指纹并允许尾音位移；return 恢复 statement 节奏指纹。
- 复现音高不复制参考 MIDI 绝对音，而是重新投影到目标 span 的 local scale / avoid 合同；
  return 尾音必须投影到目标 span 的 stable/color 集合。
- Phrase compiler 在 NoteIR 之前完成，并再次检查 post-shaper grammar terminal 与长跨和弦暴露；
  不依赖成品旋律修音。

验收：

- repeat group 的 motif similarity 高于非关联 section。
- 至少一个主循环包含 statement → variation → return。
- 所有标记为 terminal resolution 的张力在 deadline 内落到局部稳定音。

## 4. 完成证据

生产链只读审计：

- 200 个 major/minor 交替种子。
- 完整 LOFI pool：30 个 progression prototypes。
- 实际命中 22 个 prototype；Clark-derived 7/7 命中，同时命中 15 个既有模板。
- 任一 Clark-derived 模板的最高歌曲命中率为 16%，低于 20% 防独占硬门。
- Grammar 结构/填音/趋近音一致率均为 100%，非法跨和弦长音 0。
- Comp / Pad 局部攻击一致率均为 100%，非法跨和弦长音 0。
- 编译出 398 个 `statement → variation → return` 句子；variation / return 节奏指纹匹配
  均为 100%，return 稳定音解决 100%，动态 build→release 100%。
- Lead-support 小节 Comp 平均 2.25 个 onset，Lead-rest 小节 2.73 个；544 个 answer bar
  内部 Lead onset 为 0，544/544 Drum turnaround 可追溯到同一 answer cue。
- Kick 结构锚点中位偏移 `0.00 ms`、标准差 `0.00 ms`；Snare/Rim 中位拖后
  `19.37 ms`、标准差 `0.93 ms`。
- 200 种子全部 interaction / harmony hard gates 通过，finding count 为 0。

机器验收报告：

- `docs/generated/lofi_phrase_interaction_local_harmony_audit.md`
- `docs/generated/lofi_phrase_interaction_local_harmony_audit.json`

## 5. 听感验收（后续，不在本批自动门内）

本轮以 MIDI/编曲证据完成自动验收，不把混音或音色作为失败归因。固定种子的人耳 A/B
仍应检查：动机辨识、呼应清晰度、Pocket 稳定度、句尾释放和整体“像同一组乐手”五项。
自动指标证明结构合同成立，但不替代最终听感判断。

## 6. 后续修正：Comp 柱式连续性

状态：完成。

听感复查发现柱式 Comp 的攻击之间仍可能出现过大的物理断层。原因不是和声或混音，而是：

- `Piano_HalfTime_Soft_Pulse` 的柱式攻击间隔为 2 拍，原始 gate 只有 0.75 拍。
- Lead-support 过滤发生在 texture clock 之前，Dusty Chops 的 `0.58 / 1.58 ...` 原始位置
  可能全部被误判为非结构位。
- 原有 `realizeCompPerformance` 只连接 arp，block / chop / sustain 不消费连续演奏合同。

修正：

- Lead-support 接纳原始 `.5 / 2.5` 邻域，Dusty Chops 保留每小节两个轻支撑攻击。
- Block / chop / sustain / answer 在 NoteIR 之前拆成“较长 lower guide + 有呼吸的 upper chord”。
- 上层 gate 按 texture continuity 使用 `0.94 / 0.84 / 0.64 / 0.78` 比率，仍保留不同织体的
  连续、半连续、稀疏与延迟进入差异。
- 换和弦时只允许被下一和弦接纳的 common tone 延续到下一 texture 入口，其他旧和弦音仍在
  边界释放；不注入 CC64，也不把整块和弦涂成 Pad。

回归样例中，HalfTime 仍只有原来的两次柱式攻击；lower guide 在两柱之间连续，上层三音约
保留 1.68 拍，在下一柱前留约 0.32 拍呼吸。
