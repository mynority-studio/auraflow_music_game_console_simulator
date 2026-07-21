# Take Five 视频钢琴复刻与 Jazz 5/4 抽象任务

任务 ID：`jazz-video-replica-take-five-v1`

> 2026-07-21 边界变更：固定视频转录已经从 UI、`MusicGenerationRequest`、
> `runPipeline` 和 `MusicGenerationService` 完全剥离。它现在只通过
> `videoReplica/takeFiveFiveFourAuditFixture.ts` 作为 `audit-only`、
> `descriptive-non-authoritative`、`productEligible=false` 的临时对照夹具存在。
> 该谱仍是 provisional、不完全准确；只能提供描述性比较，不能作为 5/4 生成正确性的
> pass/fail oracle，也不能进入播放、Arranger、Renderer 或产品 bundle。

## 目标

先把用户提供的视频钢琴完整复刻为可逐事件、逐段 A/B 的固定谱；复刻通过后，再从固定谱提炼可随机生成同类音乐的 Jazz 5/4 Groove、角色交互、和声与 Arranger 语法。

参考视频由 SHA-256 固定：

`73810e3c4dc69f8337c392642e47f52e84ce890c7995949895ca5317100d01e7`

## 不可偏离的音乐定义

- 当前只讨论 5/4 与 4/4；本任务先完成视频中的 5/4。
- 5/4 首先是 Groove/时间组织问题，不是把拍号写成 5/4 就结束。
- 引擎功能声部固定为低/中/高三层：`bass`、`comp`、`lead`。
- 演奏相对 0–15 秒：`bass + lead`。
- performed tick 24000 之后：`comp + lead`；Bass 不再发起新攻击，但边界前的 Bass 尾音可继续发声。
- 第一 Comp 攻击是 tick 24722，不得在 tick 24000 强造下拍和弦。
- 三轨当前全部使用 Acoustic Grand Piano；确认编配后才讨论换乐器。
- 不要求复刻钢琴家的物理手势分手方式；音符可按功能层建模，但听到的音高、起音、时值、力度与滚奏关系必须保留。
- Lead 不得被移到过高音区；旋律以视频实际音区为准。
- 固定复刻不受 seed、普通 Jazz picker、GrooveContract 或生成重试影响。

## 架构边界

```text
Video source
  -> immutable Evidence events
  -> human-curated role / gesture assignments
  -> VideoReplicaScore
  -> exact 1:1 MusicalIR projection
  -> offline audit MIDI / audio

VideoReplicaScore
  -> analysis sidecars (form / harmony / nominal groove)
  -> only after user approval: extracted Jazz 5/4 generation knowledge
  -> Arranger -> Harmony -> Role Planner -> Performance -> MusicalIR
```

禁止反向依赖：

- Groove、Harmony、Arranger 或 Renderer 不得修改固定谱事件。
- nominal grid 只能解释 performed tick，不能替代 performed tick。
- 不得用 `snapToGrid`、逐小节 pattern 或 carrier pulse 重新合成 Bass/Comp。
- Evidence 中的旧角色标签是 provisional hint；人工确认前不能冒充功能真值。

## 当前事实基线

- PPQ 480，200 BPM，5/4，3+2 分组。
- tick 0 对应视频绝对 1.547 秒。
- A/B 波形拟合 anchor 约 1.536858 秒；这是源音频对齐，不改 score tick。
- 名义 bar origin 保持 tick 0；2101/4481/... 是跨线 anticipation，不是新的 barline。
- 第一版无网格重写基线：555 events；Bass 102、Comp 275、Lead 178。
- performed 0–15 秒：161 events；Bass 102、Lead 59、Comp 0。
- 物理击键按 32 ticks 固定 anchor 聚类；前段 89 groups，全段 340 groups。
- 最后 Bass attacks：23905/23924；Bass 最长尾音到 24945。
- 第一 Comp attack：24722，约为新小节第 2.5 拍。
- Vamp 不能再标成 0–36000 的单一静态 Em9；Em9/Bm7 的实际交替点等待逐事件确认。
- 全段最后检测音结束于 82809；视频/曲式尾部保留到 85860。

## 当前校订候选（不替换历史审计基线）

### Opening v3

- 原 Evidence 仍为 161 events；候选固定谱为 144 notes。
- 17 个 traceable rejections：15 个右手高八度/高次谐波假音、`bass-011` 假 B3、`lead-007` 连续音检测分裂。
- 唯一连续音合并：`lead-006` C#5 从 tick 4462 延长到 5243；其他被怀疑的同音分裂均保留为真实或尚不可破坏的重击。
- 独立时值/力度审计确认 tick 4667 没有第二次 C#5 note-on；5243 是 detector-supported sounding tail，精确 key-off 与踏板/自然尾音仍未决。没有证据支持新增力度修正或全局归一化。
- 10 个 B3 经手部坐标确认由右手承担，从旧 `bass` 阈值标签改为 `lead`：
  `bass-028/035/036/045/047/054/070/079/082/091`。
- 3 个确认的 micro-roll 只增加手势语义，绝不移动 onset：9276–9424、14072–14109、21525–21562。
- 4 组高置信 reattack 与 1 组 legato-continuation 已成为一等手势标注。
- 事件级 baseline→v3 差分：17 removed、11 modified，其中 10 个只是角色归属变化；真正改变声音的事件为 18 个。

### Full curation v3

- 将 Opening v3 原样嵌入全曲，不重新生成前段。
- tick 24000 本身仍无攻击；最后 Bass attack 23924，首 Comp attack 24722，Bass 尾音最长保留到 24945。
- post-handoff 首轮只加入两个高置信音高事实：`lead-069` E5→E4；删除 `lead-073` 的假 F#5。
- 中段确认四组同音事件都是真实 reattack，禁止合并：`lead-071/072`、`comp-061/065`、`lead-085/087`、`comp-092/093`；并确认 `comp-053→comp-054→lead-071` 的低到高滚入。
- 尾段删除三个经视频确认的上泛音假音：`comp-187` G#3、`lead-168/170` F#5；真实低八度/F#4 attacks 全部保留。
- 尾段新增三个只读手势语义：53942–53980 上行 roll、54444–54481 下行 roll、76155–76174 两级 flam/roll；所有 performed onset 原样保留。
- reharm 内经视频确认的真实高音/八度叠置保留，禁止全局 octave-dedup。
- 全曲候选为 534 notes：Bass 91、Comp 274、Lead 169；21 rejections、2 corrections、19 gesture annotations。555-note `v1-first-raw-lossless` 只保留为历史审计基线。
- 事件级 baseline→candidate 差分：21 removed、12 modified；真正改变声音的事件为 23 个，角色-only 为 10 个。
- 全曲四阈值只读 oracle 对 post-handoff 390 个候选事件中的 389 个找到同音近时匹配；唯一未匹配的短 F#4 仍有源频谱攻击，故没有自动删除。没有任何四套阈值一致且与既有事件无关的确定漏音。
- full v3 使用 `video-replica-approval-v2`，除全部事件、角色和 gesture 外还锁定 score revision、Evidence artifact 与 detector revision。canonical approval candidate SHA-256：`97265094f1c43514384830ea33f1a059faa749f64ac68c1fdda697839b0ffb95`。当前状态明确为 `unapproved`；批准状态由独立 typed receipt 表达，不混入候选内容 hash。

### Full curation v4（历史审听候选）

- v3 历史候选与全部产物保持不变；v4 是独立 revision，不原地改写既有批准载荷。
- 四阈值连续检测、目标频带衰减与视频手部保持共同确认：`lead-178` 的最终 E4 起音仍为 tick 81137、MIDI 64、velocity 74，但 279 ticks 是纹理变化造成的错误分段；可听时值改为 760 ticks，结束于 tick 81897。
- `lead-006` C#5 保持 tick 4462 + 781 ticks；原第二 detector fragment 没有新攻击能量或抬指重击，不能恢复为第二个 note-on。
- tick 38570 保持 C3 + E5，不新增内声部；四套检测和独立频谱均无新增攻击证据。
- `comp-137` F#2 保持原样；视频低音键位、三个检测配置与基频关系共同证明它是真实低音攻击。
- tick 43288 的弱 F3 候选仍有冲突：三个灵敏配置和单帧键位支持，独立攻击频谱与 default 配置不支持。用户将决定委托给保守工程默认：不加入 F3、不猜测 velocity，v4 固定谱保持不变；隔离变体仅作为历史证据保留。
- v4 仍为 534 notes：Bass 91、Comp 274、Lead 169；21 rejections、3 corrections、0 additions、19 gesture annotations。v3→v4 只有 `lead-178` 一项 duration 可听变化；555-note baseline 不再具有产品路线。
- canonical approval candidate SHA-256：`74d350b6ee11838a070496c580ea05406b20321e21946b28be1915f4eb4f828f`。当前状态仍为 `unapproved`，没有用户批准 receipt。

### Full curation v5（COMP 同键重击生命周期候选）

- 用户指出 COMP 进入后的中段有错拍感。源/候选 onset 时钟审计排除了 Tempo、5/4 bar phase 与 GrooveContract：入口 `comp-001 @24722` 的去趋势残差约 `+2.7ms`，tick 24000–60000 等效速度约 `199.998 BPM`，无累积漂移。
- 根因是 Standard MIDI 同声道同音高的 note 生命周期冲突：Basic Pitch 独立舍入出的前音在下一次真实重击后 1 tick 才 note-off，使新 note-on 只响 `0.625ms` 就被旧 off 截断。
- v4 的整个 post-handoff COMP 区共有 13 处该类 1-tick overlap。v5 将十三个前音 duration 各减 1 tick；534 个 note-on 的 tick、pitch、velocity、role 全部不变，Tempo、5/4、Groove、roll 与和声均不变。
- 新的 `findVideoReplicaSameKeyReattackCollisions` / `assertNoVideoReplicaSameKeyReattackCollisions` 是只读审计与导出门禁，不在 compiler 或 MIDI adapter 内静默裁音。v5 导出前强制验证 tick 24000–85860 无同键重击碰撞；v4 保持历史不变。
- 直接 SMF 与正式浏览器/调度链均验证十三处变成同 tick `noteOff → noteOn`。前三处关键恢复结果：
  - `comp-053 D3 @35168`：v4 瞬态迟到 `+9.3～+19.5ms`，v5 收敛至 `−0.86～+2.04ms`；攻击后 D3 能量提高 `4.3～8.5dB`。
  - `comp-069 Bb2 @37362`：v4 四种 onset detector 强度全为 0，v5 恢复为 `0.983 / 0.736 / 1.040 / 0.875`。
  - `comp-141 B2 @56749`：攻击后 80ms 的窄带衰减由 v4 `−17.0dB` 恢复为 v5 `−6.4dB`，源为 `−6.8dB`。
- 21–24 秒节拍窗口相关度由 `0.520068` 提升至 `0.552421`；21–22.5 秒由 `0.736605` 提升至 `0.792550`。v5 时钟仍约 `199.996 BPM`，没有新漂移。
- v5 仍为 534 notes：Bass 91、Comp 274、Lead 169；相对 v4 只有 13 项 duration 变化。canonical approval candidate SHA-256：`d5d176a67613a682d977c68259cad0ee39bccdee5848b928ecb61bb3312569b7`，状态仍为 `unapproved`。
- 固定谱 MIDI SHA-256：`118cd68e6c942bedbc8755eacc46629c4a14d87092c0197e4c397561d065efaf`；锁定 SoundFont WAV SHA-256：`27916b250d0a0cb31d546b589ff807223f1b41e97d7ab5656042f91e2403fe4d`。

### Full curation v6 / v7（当前全视频复核候选）

- 已再次完成整段视频的逐音、逐物理击键（strike）与逐计量桶复核：v7 共核对 `550/550` 个音符事件、`339/339` 个 physical strikes、`36/36` 个 5/4 计量桶；其中 35 个是完整小节，第 36 个是 84000–85860 的空白残尾桶，不算完整小节。角色计数为 Bass `96`、Comp `282`、Lead `172`。
- v6 是首次汇总该轮全视频复核的历史候选，现已被独立 revision v7 取代，不再作为当前审听或批准对象。保留 v6 代码与产物只为差分和证据溯源，不原地改写历史。
- v6→v7 严格只有一个事件变化：`observed-v6-76318-e3`（Comp E3）由 `startTick 76318 / duration 204` 修正为 `startTick 76273 / duration 249`；两版 `endTick` 均为 `76522`，其余 `549` 个事件的 role、pitch、start、duration、velocity 全部不变。该修正来自源音频尾段的独立攻击瞬态复核，不是 Groove、量化或小节网格回写。
- 以 v5 为共同基线，v7 仍是 `17 additions / 1 removal / 6 common-note duration corrections`；除上述新增 E3 在 v6→v7 中进一步校正起音与时值外，没有把其余音符 onset 移到名义拍点。
- `D4 @ tick 40295` 的证据仍相互冲突，继续保持 hold-out，不写入固定谱；自动 detector/oracle 无权代替该人工裁决。
- MIDI 生命周期门禁无同键重击碰撞；tick 24000 不新增 Comp 下拍，最后 Bass attack 仍为 23924，第一 Comp attack 仍为 24722，三轨严格沿用固定 performed ticks。
- v7 canonical approval candidate SHA-256：`335f5ffa1671ffdf89dc8620e94a193909b4b31181856a234273cc84e379ee3c`。状态仍为 `unapproved`；所有版本均为离线审计材料，等待用户完整试听和明确批准。

辅助证据均为只读 oracle，不可自动导入固定谱：

- Basic Pitch 多阈值 sweep：`tmp/video-replica/take-five-basic-pitch-sweep/opening-threshold-sweep.json`
- 全曲 Basic Pitch 多阈值 sweep：`tmp/video-replica/take-five-basic-pitch-sweep-full/full-threshold-sweep.json`
- 全曲候选/多阈值共识审计：`tmp/video-replica/take-five-basic-pitch-sweep-full/post-handoff-consensus-review-v3.json`
- 原生 Vision 手部/琴键坐标审计：`scripts/audit-piano-hand-pose.swift`
- onset/clock 波形审计：`scripts/audit-video-replica-opening-onsets.py`
- 所有候选日志内嵌完整 event-level diff；任何批准后的变化都必须使 approval 失效。

## 批准前审听包

当前 v7 全视频复核候选：

- 完整音符日志：`tmp/video-replica/take-five-full-curation-v7/take-five-full-curation-v7.notes.json`。
- 固定谱 MIDI / 锁定 SoundFont 渲染：`tmp/video-replica/take-five-full-curation-v7/take-five-full-curation-v7.mid`、`tmp/video-replica/take-five-full-curation-v7/take-five-full-curation-v7.wav`。
- 渲染溯源：`tmp/video-replica/take-five-full-curation-v7/take-five-full-curation-v7.render-provenance.json`；重渲染与审听 WAV 逐字节一致。
- 全曲原视频 vs v7 分段 A/B：`tmp/video-replica/take-five-full-curation-v7/ab/take-five-v7-AB-by-segment.wav`；索引与逐段 hash：`tmp/video-replica/take-five-full-curation-v7/ab/take-five-v7-AB-manifest.json`。
- 尾段 E3 修正聚焦 A/B：`tmp/video-replica/take-five-full-curation-v7/focus/e3-source-vs-v7/take-five-e3-focus-AB-sequential.wav`；索引：`tmp/video-replica/take-five-full-curation-v7/focus/e3-source-vs-v7/take-five-e3-focus-AB-manifest.json`。
- 全量音高复核：`tmp/video-replica/take-five-full-curation-v7/full-audit/pitch/full-pitch-audit.json`、`tmp/video-replica/take-five-full-curation-v7/full-audit/pitch/README.md`。
- 全量起音、strike 与 5/4 小节复核：`tmp/video-replica/take-five-full-curation-v7/full-audit/timing/full-timing-audit.json`、`tmp/video-replica/take-five-full-curation-v7/full-audit/timing/strike-onset-residuals.csv`、`tmp/video-replica/take-five-full-curation-v7/full-audit/timing/bar-metric-audit.csv`。
- 最终集成门禁与逐音 5/4 清单：`tmp/video-replica/take-five-full-curation-v7/full-audit/final-verification/README.md`、`tmp/video-replica/take-five-full-curation-v7/full-audit/final-verification/all-notes-with-5-4-beats.csv`、`tmp/video-replica/take-five-full-curation-v7/full-audit/final-verification/take-five-v7-video-comparison.json`。
- 批准载荷：`tmp/video-replica/take-five-full-curation-v7/take-five-full-curation-v7.approval-canonical.jsonl`；canonical SHA-256 为 `335f5ffa1671ffdf89dc8620e94a193909b4b31181856a234273cc84e379ee3c`，当前仍是 `unapproved`。

V7 的完整音高/onset/event 记录均已审计，但 duration/key-off 仍会受踏板、共鸣与检测分段影响，不能宣称 550 个物理抬键时刻均有逐帧精确真值。E3 修订由独立源瞬态和专家复核支持；其局部自动 timing confidence 仍为 low，不将其包装成高置信自动检测。

历史 v4：

- 全曲分段 A/B：`tmp/video-replica/take-five-full-curation-v4/ab/take-five-full-v4-AB-by-segment.wav`。
- 审听索引：`tmp/video-replica/take-five-full-curation-v4/take-five-full-curation-v4.review-manifest.json`。它验证完整 Score→MIDI→锁定 SoundFont render→18 段 A/B 溯源；F3 已按用户委托的保守默认收口，不再存在未决低置信音符队列。
- 完整音符日志：`tmp/video-replica/take-five-full-curation-v4/take-five-full-curation-v4.notes.json`。
- 固定谱 MIDI：`tmp/video-replica/take-five-full-curation-v4/take-five-full-curation-v4.mid`。
- 渲染溯源：`tmp/video-replica/take-five-full-curation-v4/take-five-full-curation-v4.render-provenance.json`；重渲染与审听 WAV 逐字节一致。
- 批准载荷：`tmp/video-replica/take-five-full-curation-v4/take-five-full-curation-v4.approval-canonical.jsonl`；当前仍是 `unapproved`。

历史 v5 COMP 修复候选：

- 聚焦 20.5–25.5 秒，原视频 vs v5：`tmp/video-replica/take-five-full-curation-v5/focus/source-vs-v5/take-five-comp-focus-source-vs-v5-AB-sequential.wav`。
- 同一聚焦窗口，v4 vs v5（共增益、唯一变量为十三个 1-tick key-off 中落在窗口内的两项）：`tmp/video-replica/take-five-full-curation-v5/focus/v4-vs-v5/take-five-comp-focus-v4-vs-v5-AB-sequential.wav`。
- 全曲原视频 vs v5 分段 A/B：`tmp/video-replica/take-five-full-curation-v5/ab-source/take-five-source-vs-v5-AB-by-segment.wav`。
- 全曲 v4 vs v5 分段 A/B：`tmp/video-replica/take-five-full-curation-v5/ab-v4-v5/take-five-v4-vs-v5-AB-by-segment.wav`。
- 完整音符与碰撞门禁日志：`tmp/video-replica/take-five-full-curation-v5/take-five-full-curation-v5.notes.json`。
- 固定谱 MIDI / 渲染：`tmp/video-replica/take-five-full-curation-v5/take-five-full-curation-v5.mid`、`tmp/video-replica/take-five-full-curation-v5/take-five-full-curation-v5.wav`。
- 渲染溯源：`tmp/video-replica/take-five-full-curation-v5/take-five-full-curation-v5.render-provenance.json`；重渲染与审听 WAV 逐字节一致。
- 可重复 onset/lifecycle 审计：`scripts/audit-video-replica-comp-reattacks.py`；机器结果与报告位于 `tmp/video-replica/take-five-full-curation-v5/onset-audit/comp-reattack-onset-audit.json`、`tmp/video-replica/take-five-full-curation-v5/onset-audit/README.md`，六项门禁全部通过。

保留的 v3 历史包：

- 全曲分段 A/B：`tmp/video-replica/take-five-full-curation-v3/ab/take-five-full-v3-AB-by-segment.wav`。每个窗口依次为 A 原视频、0.25 秒静音、B 固定谱候选；没有对 score 做时间拉伸或网格改写。
- 审听索引：`tmp/video-replica/take-five-full-curation-v3/take-five-full-curation-v3.review-manifest.json`。它把 23 个可听事件变化、10 个 role-only 变化、19 个 gesture 变化和 5 个低置信问题定位到实际存在的 3 秒 A/B 文件。
- 完整音符日志：`tmp/video-replica/take-five-full-curation-v3/take-five-full-curation-v3.notes.json`。
- 固定谱 MIDI：`tmp/video-replica/take-five-full-curation-v3/take-five-full-curation-v3.mid`。
- 渲染溯源：`tmp/video-replica/take-five-full-curation-v3/take-five-full-curation-v3.render-provenance.json`；当前 MIDI 用锁定的 renderer、SoundFont 与 `tail=0` 重渲染后，和审听 WAV 逐字节相等。
- 批准载荷：`tmp/video-replica/take-five-full-curation-v3/take-five-full-curation-v3.approval-canonical.jsonl`；当前仍是 `unapproved`。

已收口、不得由 oracle 自动写入的位置：

- segment 10：tick 43288（主 A2+C5 前 23 ticks）的极弱 F3 候选已按用户委托的保守工程默认关闭：固定谱不加。除非出现新的独立物理攻击证据，否则不重开；任何未来变体也不能直接污染 v4。

该位置已具备独立、无 score authority 的试听变体：

- 审听变体只在编译后的临时 MusicalIR 副本加入 `comp / tick 43288 / duration 167 / MIDI 53 / velocity 55`；v4 `VideoReplicaScore`、MIDI 与 approval payload 均未修改。
- velocity 55 是由同源 detector/score 匹配事件的局部与全局回归得到的单一审听值，不是宣称已经确认的物理击键力度。
- 变体 MIDI 相对 v4 严格只多一组事件：channel 2 的 `note-on 43288/53/55` 与 `note-off 43455/53/0`；534 个原事件全部不变。
- 固定谱哈希在变体导出前后仍为 `74d350b6...828f`；变体不具备 approval candidate、product、extraction 或 fixed-score 权限。
- 聚焦窗口为 performed 26.25–28.00 秒，目标 F3 位于窗口内约 0.805 秒：
  - 原视频 vs v4 无 F3：`tmp/video-replica/auditions/take-five-f3-isolation/focus/source-vs-no-f3/take-five-focus-source-vs-no-f3-AB-sequential.wav`
  - 原视频 vs F3 试听变体：`tmp/video-replica/auditions/take-five-f3-isolation/focus/source-vs-f3/take-five-focus-source-vs-f3-AB-sequential.wav`
  - v4 无 F3 vs F3 试听变体：`tmp/video-replica/auditions/take-five-f3-isolation/focus/no-f3-vs-f3/take-five-focus-no-f3-vs-f3-AB-sequential.wav`；两边使用完全相同的增益，MIDI 的唯一变量就是该 F3。
- 隔离审听索引：`tmp/video-replica/auditions/take-five-f3-isolation/take-five-full-v4-f3-43288-isolation.review-manifest.json`。

审听索引是只读派生产物：它无权改 score、切换产品基线或写入批准状态。主 fixed-score exporter 与审听索引 exporter 分离；前者可在无 A/B 临时文件的干净环境独立运行，后者会验证完整音符日志、Score→MIDI 字节、MIDI→WAV 重渲染溯源、A/B 输入和 18 段逐文件 hash 后生成索引。

## 批准后如何抽象进现有架构

当前 Jazz Arranger 注册表只有 `jazz_4_4_standard`。视频复刻批准后，新增的 5/4 不是替换它，也不是把固定谱塞回 `GrooveContract`，而是作为第二个可选编配主型注册。

```text
approved VideoReplicaScore + approval event hash
  -> offline, pure extractor
  -> versioned Jazz 5/4 knowledge assets
     - Groove identity
     - role interaction grammar
     - harmonic/form grammar
     - performance vocabulary
  -> new 5/4 ArrangementArchetype
  -> existing Harmony / Role Planner / Performance / MusicalIR pipeline
```

四类知识的职责边界：

1. `GrooveContract` 只保存 5/4、`3+2`、名义细分、重音、swing/pocket 与密度身份；不保存逐小节固定事件。
2. `rolePatternByRole` 分别引用 Bass ostinato、Comp answer/voicing rhythm、Lead phrase grammar；三轨从同一 metric clock 投影，但禁止强制同起音。
3. Harmony library 保存 vamp 与 reharm 的功能原型、每个和弦的 beat span、替代属/副属语义和 voice-leading 约束；不能从和弦名倒推出参考谱缺失音。
4. Arranger archetype 保存 section 的 `activeRoles`、`foundationOwner`、段落切换与共享钢琴角色组；它选择知识 ID，不携带参考视频音符。

第一套 5/4 archetype 的最低语义应为：

- meter family：`5/4`，beat grouping：`3+2`；
- 前段：`bass + lead`，Bass 承担 foundation，Comp inactive；
- 后段：`comp + lead`，Comp 接管中低声部组织，Bass 不再发起 attack；
- handoff 允许上一段尾音跨界，不要求新段下拍 attack；
- 三个角色可以映射为同一钢琴音色，但功能层仍独立；
- 生成时学习分布与约束，不复制参考曲绝对音高或完整 onset 序列。

抽象层的版本必须记录来源 approval hash。固定谱变化后，旧抽象资产自动失效并要求重新提炼；运行时生成器不能导入 `videoReplica/`，固定谱编译器也不能导入 Groove、Harmony、Arranger、Renderer 或 RNG。

现有骨架在正式接入前还有四个必须正面完成的连接点，不能用 renderer 特判绕过：

- `ArrangementMeterFamily` 从只有 `4/4` 扩为 `4/4 | 5/4`，新增独立 `jazz_5_4_modern_piano`，不修改 `jazz_4_4_standard`。
- `rolePatternByRole` 目前只有 Bass pattern 被实质消费；需要有类型的 Bass/Comp/Lead pattern ref 与 Arranger 输出的 `RoleRhythmScorePlan`。
- `harmonyPolicyId` 必须通过 registry 真正选择 vamp/reharm progression；`formBlueprintId` 必须真正展开 Bass+Lead → Comp+Lead，而不是仅作标签。
- section boundary 增加 pattern-owned attack 与 cross-boundary-tail 语义；该风格允许尾音跨界，禁止段首强造 downbeat。

首轮 5/4 只允许通过内部强制 archetype ID 调试。用户批准复刻和生成 A/B 后，才把 4/4/5/4 选择权开放给普通 Jazz 的 seed/权重系统。

## 验收门禁

1. Provenance：视频 SHA、文件字节数、tick-zero anchor、证据 artifact/hash 必须一致。
2. Event identity：Score→IR 对 role、pitch、start、duration、velocity 逐事件零容差。
3. Off-grid/roll：19、427、4017/4035 等 sentinel 不得 snap、合并或删除。
4. Boundary：24000 不得截 Bass 尾音，也不得新增 Comp downbeat；首 Comp 保持 24722。
5. MIDI：CLI SMF、正式 `musicalIRToMidiEvents` 与浏览器 `musicalIRToSMF` 三条路径的 note-on/off tick、channel、pitch、velocity 逐事件相等。
6. Audio：与视频做 onset、漂移、段落与音区 A/B；自动指标只作门禁，不能代替听感。
7. Approval：用户确认后用 event hash 锁定；改一颗音即使批准失效。

## 阶段

- [x] 删除旧 ReferencePianoScore、hard snap、Bass/Comp 反向合成及 reference GrooveContract 路径。
- [x] 建立 Evidence → VideoReplicaScore → MusicalIR 的干净单向路径。
- [x] 恢复第一版整段 provisional baseline；其历史产品 reference route 已于 2026-07-21 删除。
- [x] 从 UI、产品请求/结果类型、Pipeline facade 与 MusicGenerationService 删除固定谱入口，并建立零产品依赖的架构测试。
- [x] 将 555-note baseline 重标为非权威 5/4 描述性审计夹具，明确禁止进入产品播放与主生成链。
- [x] 清除通用 `GrooveContract` 中无人使用的 fixed-score/逐小节载体接口，固定谱不再寄生在 Groove 层。
- [x] 完成前 15 秒 Bass+Lead 的逐事件校订候选并生成音频/视频 A/B；等待用户听感批准。
- [x] 完成 15 秒后 Comp+Lead 与 reharm 的首轮全跨度逐事件审计，并导出 full v3 A/B 候选。
- [x] 建立 Score→IR→SMF 零容差门禁：534 个 note-on、534 个 note-off、角色通道、tick、pitch、velocity 与 EOT 85860 全部逐事件验证。
- [x] 将同一零容差门禁覆盖到正式浏览器 MIDI adapter，并验证 Bank 0 / Acoustic Grand Piano Program 0。
- [x] 建立可执行渲染溯源：当前 MIDI 重渲染与审听 WAV 逐字节一致，A/B manifest 锁定 approval、MIDI、renderer、SoundFont 与所有分段 hash。
- [x] 建立只读审听索引，将全部差分与低置信问题映射到 18 个真实 A/B 窗口。
- [x] 以视频帧、多阈值检测和独立频谱收敛五个低置信点中的四个，并将最终 E4 的错误截断作为独立 v4 修正；不确定 F3 未写入固定谱。
- [x] 为 F3 建立单音、共增益、无 score authority 的隔离 A/B，并按用户委托的保守默认关闭为“不加入”；变体生成前后 v4 approval hash 不变。
- [x] 针对用户指出的 COMP 进入后错拍感，排除 Tempo/Groove/bar phase，定位 13 个同键 note-off 碰撞；建立独立 v5、只读生命周期门禁、三条 MIDI 传输回归和源音频复验，不修改 v4。
- [x] 完成全视频逐音、逐 strike、逐 5/4 小节的第二轮复核；v6 作为历史汇总候选保留，v7 仅修正 `observed-v6-76318-e3`，其余 549 个事件零变化。
- [x] 为 v7 导出 550-note 固定谱、339-strike/36-bar 审计、全曲分段 A/B、E3 聚焦 A/B、渲染溯源与独立 approval payload；555-note 历史基线仅作审计对照。
- [ ] 用户审听 v7 的全曲与 E3 聚焦 A/B；任何后续问题继续按独立证据逐项审核，禁止混成一次批改或用 GrooveContract 重写 performed ticks。
- [ ] 对仍属低置信的时值/力度/内声部位置做用户逐段 A/B，完成最终固定谱批准。
- [ ] 用户批准完整固定谱并写入 approval hash。
- [ ] 从批准谱提炼 Jazz 5/4 生成知识。
- [ ] 将知识接入 Arranger/Harmony/Role Planner/Performance；固定谱继续作为独立 golden oracle。
