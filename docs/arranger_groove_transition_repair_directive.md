# newEngine Arranger Groove / Melody Timing / Transition Repair Directive

> 给 Claude 执行。目标是修复当前 newEngine 的 arranger groove 下发、旋律时值/groove 对齐、intro/outro 戛然开始/结束、器配衔接、鼓弱拍起等音乐性问题。
>
> 硬约束：不允许改变引擎大管道链路。只能在现有阶段内部补充契约、计划字段、render 消费和 audit/test。

## 0. 不可改的大管道

禁止修改以下顺序和顶层职责：

```text
GenerationRequest
  -> BandSpec
  -> ArrangementPlan
  -> InstrumentationPlan
  -> HarmonicPlan
  -> renderSongFull
  -> AuditReport
  -> GenerationController retry / pass / warning / failed
```

禁止事项：

- 不要把 HarmonyPlan 合并进 comp 轨。
- 不要把 MG melody 链替换回 newEngine 旧旋律。
- 不要把 texture / transition 的选择重新埋回 render 随机逻辑。
- 不要新增第二套 GenerationController 或新的全局 retry loop。
- 不要通过删除 tests、降低生成复杂度、强行静音问题轨道来“修复”。
- 不要改变 `generateSong()` 顶层 stage 顺序。

允许事项：

- 在 `ArrangementPlan` / `InstrumentationPlan` 里增加只读字段。
- 在 `instrumentalPlanner` 内基于 ArrangementPlan 生成更细的器配计划。
- 在 `renderSongFull` 内消费这些计划。
- 在现有 `AuditReport` 中追加音乐性 warning。
- 增加 focused tests 和诊断 helper。

## 1. 当前审计结论

### 1.1 lead-in 写了但会被 density gate 吃掉

现状：

- `renderCoordinator.ts` 根据 `arrangement.entryBySection[next.id] === 'lead-in'` 标记上一段末小节 `leadInBars`。
- `drumRenderer.ts` 会在 `bigFillBars` 里写 snare roll / open hat。
- 但之后 `gateByDensity()` 按音符起点所在段落过滤 role。
- 如果上一段 intro/setup 不含 drum，写在 intro 最后一小节的 drum pickup 会被删掉。

结论：

这是分层移植导致的器配衔接 bug，不是 CC 问题。  
lead-in 应该由器配层授权“上一段末小节允许下一段角色预进入”，不能只在 render 里临时加 fill。

### 1.2 no-pad outro 的 comp 兜底会被 gate 删除

现状：

- `renderCoordinator.ts` 已经尝试在 pad 不在场时让 comp 兜底 floating 段。
- 但 pop 的 `DENSITY_ARC.outro` 是 `['pad', 'bass', 'lead']`。
- 如果编制没有 pad，render 里生成出来的 comp 会被 `gateByDensity()` 删掉。

结论：

outro 的 harmonic support 应该由 InstrumentationPlan 决定：  
当 pad 不在 lineup 或该段 pad inactive 时，comp 必须进入 outro/tag/setup 的和声托底角色。

### 1.3 旋律 timing ownership 矛盾

现状：

- `mgLeadRenderer.ts` 把 MG `feelForStyle(style)` 的 swing 强制压成 `swingRatio: 0.5`。
- `swing.ts` 又跳过 lead，注释说 lead 已经由 MG StyleRenderer 上 swing。

结论：

这两个逻辑互相矛盾。  
如果继续以 MG 为旋律真源，应恢复 MG StyleRenderer 对 lead 的 timing ownership：lead 使用 MG style feel；全局 `applySwing` 继续跳过 lead，避免 double swing。

### 1.4 RNB 缺少 TimeFeel

现状：

- `timePlanner.ts` 没有 `rnb` 项，RNB 落到 `default`。
- `groovePlanner.ts` 却把 RNB content 标为 `laidback`。

结论：

Arranger 下发的 groove 不是完整音乐身份。RNB 至少需要独立 tempo / feel profile，再让 laidback groove 和 texture pocket 共同表达。

### 1.5 intro / song start 缺少 entry contract

现状：

- procedural form 可以没有 intro。
- 第一段若直接是 verse/loop/head，器配层会按 core activeRoles 直接起。
- 没有“无 intro 时第一小节怎样进入”的计划。

结论：

不要强行所有歌都有 intro。  
但必须有 `songEntryPlan`：如果没有 intro，第一小节不能全员硬切；必须有 downbeat anchor、staged entry 或 internal pickup。

### 1.6 outro 和声已回归，但器配没有共同 cadence gesture

现状：

- Harmony 层 tonal ending 已强制末两和弦 `V7 -> I`。
- 但器配层只给 `endingPlan.exitBarByRole`。
- `applyEnding()` 只改已有音符：fade、延长、截尾。
- `HOLD_ROLES` 包含 lead，tag 可能把 MG lead 最后音强行拉长。

结论：

和声落家不等于编曲落家。  
Ending 需要器配层计划：谁先退、谁延留、谁给最后 I 的 anchor、谁不允许被强行延长。

### 1.7 现有 audit 不覆盖音乐性断层

现状：

- `readOnlyHarmonyAuditor.ts` 只审和声/音程。
- `compContinuity.ts` 只在 tests 中使用，生产路径不报告 comp 断层。

结论：

需要新增只读 `musicalityAuditor`，并把 findings 追加进现有 `AuditReport`。  
全部先用 `warning`，不触发 retry，避免改变控制环语义。

## 2. 修复总原则

### 2.1 决策层级

```text
Arranger:
  只下发宏观结构意图
  - sections
  - energy / density
  - grooveBySection
  - entryBySection
  - endingStyle

Instrumentation:
  负责把宏观意图变成可执行器配计划
  - activeRolesBySection
  - drumPatternBySection
  - richTextureBySection
  - transitionPlan
  - endingPlan

Render:
  只消费计划并投影为 NoteIR / controller events
  - 不做新的高层随机决策
  - 不重新决定段落织体
  - 不临时改变 form / harmony

Audit:
  只读报告
  - harmony audit 保持现有职责
  - musicality audit 追加 warning
```

### 2.2 修改边界

允许新增：

- `InstrumentationPlan.transitionPlan`
- `InstrumentationPlan.songEntryPlan`
- `InstrumentationPlan.endingPlan` 字段扩展
- `render/musicalityAuditor.ts`
- focused tests

不允许：

- 改 `GenerationController.generateSong()` 的 stage 顺序。
- 把 transition 选择放进 `textureSchedule.ts` fallback 随机逻辑。
- 让 `renderDrums()` 自己猜“下一段要不要 lead-in”。

## 3. 具体修复 Loop

### Loop A: 修复 MG lead timing ownership

文件：

- `src/core/generation/newEngine/render/mgLeadRenderer.ts`
- `src/core/generation/newEngine/render/swing.ts`
- `src/core/generation/newEngine/render/melodyGrooveAlign.test.ts`

要求：

1. `renderMgMelody()` 恢复使用 `feelForStyle(style)` 的原始 swingRatio。
2. 保持 `applySwing()` 跳过 lead，避免 double swing。
3. 修正注释，明确：
   - lead timing owner = MG StyleRenderer。
   - accompaniment timing owner = arranger feel + render global swing。
4. 不要改变 MG `realizeTokens()` / `shapeMelodyHarmony()` 的时值逻辑。

验收：

- POP/RNB lead 仍为 straight。
- JAZZ lead 不应被 double swing。
- JAZZ lead 与 comp/drum 的听感 swing 一致，不能 lead 直、伴奏 swing。

测试建议：

- 更新 `melodyGrooveAlign.test.ts`：
  - 不再断言 jazz lead “像 pop 一样在直 8 分格”。
  - 改为断言单一 ownership：`renderMgMelody(jazz)` 已带 MG swing，`applySwing()` 不二次作用于 lead。

### Loop B: 补 RNB TimeFeel

文件：

- `src/core/generation/newEngine/arranger/timePlanner.ts`

要求：

1. 增加 `rnb` profile。
2. 建议值：

```ts
rnb: {
  tempoBpm: 96,
  tempoRange: 10,
  meter: { numerator: 4, denominator: 4 },
  feel: { kind: 'straight', swingRatio: 0.5 },
}
```

3. RNB 的 laidback 不通过 global swing 表达，而通过 groove pattern、texture pocket、velocity/timing micro-feel 表达。

验收：

- RNB 不再落 default tempo。
- `traceGeneration()` 中 RNB 的 tempo/feel/groove 可读且一致。

### Loop C: 在 InstrumentationPlan 增加 transitionPlan

文件：

- `src/core/generation/newEngine/instrumental/InstrumentationPlan.ts`
- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`

新增类型建议：

```ts
export interface BoundaryGesturePlan {
  fromSectionId: SectionId;
  toSectionId: SectionId;
  boundaryBar: number;        // 下一段开始的小节序号
  prepBar: number;            // 上一段最后一小节序号
  entry: SectionEntry;        // downbeat | lead-in
  pickupRoles: InstrumentRoleName[];
  releaseRoles: InstrumentRoleName[];
  downbeatAnchorRoles: InstrumentRoleName[];
  protectPickupFromGate: boolean;
}

export interface SongEntryPlan {
  firstSectionId: SectionId;
  hasIntro: boolean;
  mode: 'normal-intro' | 'staged-first-bar' | 'direct-anchor';
  downbeatAnchorRoles: InstrumentRoleName[];
  delayedRoles: InstrumentRoleName[];
}

export interface TransitionPlan {
  boundaries: BoundaryGesturePlan[];
  songEntry: SongEntryPlan;
}
```

生成规则：

1. `entryBySection[next] === 'lead-in'`：
   - `pickupRoles` 至少包含下一段 active 的 drum/comp/bass 中可用角色。
   - 如果下一段有 drum，上一段末小节允许 drum pickup。
   - 如果下一段有 bass，允许 bass approach 或 downbeat preparation。
   - 如果下一段有 comp，允许 comp pickup/stab/swell，但不得全小节密铺。

2. `entryBySection[next] === 'downbeat'`：
   - 不做大 fill。
   - 但 `downbeatAnchorRoles` 必须包含下一段核心 grounding role：
     - 有 bass 则 bass。
     - 有 drum 则 drum。
     - 有 comp/pad 则至少一个 harmonic support。

3. song start：
   - 如果第一段是 intro/setup：`mode='normal-intro'`。
   - 如果第一段不是 intro/setup：`mode='staged-first-bar'`。
   - staged-first-bar 不新增 section，但第一小节需要：
     - downbeat anchor。
     - 非核心角色延后进入，避免全员戛然开始。
     - 不允许第一颗鼓只出现在弱拍且没有 downbeat grounding。

4. 不在这里生成 NoteIR，只生成计划。

验收：

- InstrumentationPlan 可打印 transition summary。
- 同 seed 确定性。
- 同 repeatGroup 不影响 transition，因为 transition 是 boundary 行为，不是段体模板。

### Loop D: activeRoles 必须 lineup-aware，修 no-pad floating 段

文件：

- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`

要求：

1. `activeRolesFor()` 之后增加 lineup-aware repair：
   - 如果某段 texture 是 `pad` / `sustained-block` / floating 类，但 lineup 无 pad，且 lineup 有 comp，则 comp 必须 active。
   - 如果 outro/tag/setup 段没有 pad，但有 comp，comp 必须 active。
   - 如果 endingPlan 需要 harmonic sustain，activeRoles 里必须至少有 comp 或 pad。

2. 不要在 renderCoordinator 里用 fallback 偷偷生成后再被 gate 删掉。  
   角色在不在场必须由 InstrumentationPlan 明确授权。

验收 seed：

- `64062 / pop`，如果 lineup 没 pad，outro 不能只剩 bass+lead；必须有 comp harmonic support。
- `7 / rnb`，intro/outro 中如果 pad 缺席或 inactive，comp 兜底必须保留。

### Loop E: density gate 变成 transition-aware gate

文件：

- `src/core/generation/newEngine/render/renderCoordinator.ts`

要求：

1. `gateByDensity()` 增加 transition awareness。
2. 规则：
   - 普通音符仍按起点所在段落 activeRoles gate。
   - 若音符起点位于某 boundary 的 `prepBar`，且 role 在 `pickupRoles`，并且 `protectPickupFromGate=true`，则视为下一段授权，不能被上一段 activeRoles 删除。
   - 若音符起点在 section boundary 附近因 humanize 提前少量 tick，不应被判到上一段而删除。

3. 不要通过把 intro activeRoles 强行加 drum 来绕过。  
   修的是“下一段角色预进入授权”，不是改变上一段编制。

验收：

- `seed=3 / pop` intro -> verse1，intro 本身可以无 drum，但 verse lead-in 的 drum pickup 必须保留。
- `seed=3 / lofi` loopIntro -> loop1，同理。
- `seed=42 / pop` intro -> verse1，pickup 不被 gate 删除。

### Loop F: section boundary downbeat 不允许被 humanize 拉过边界

文件：

- `src/core/generation/newEngine/render/humanize.ts`
- `src/core/generation/newEngine/render/renderCoordinator.ts`

要求：

1. 给 `humanizeTiming()` 增加可选 anchor 信息，或在 renderCoordinator 中 post-process anchor。
2. anchor ticks 至少包括：
   - 每个 section start tick。
   - song start tick 0。
   - outro final tonic downbeat。
3. 对以下角色的 anchor onset 不做负向 jitter：
   - drum downbeat kick/ride/hat anchor。
   - bass downbeat。
   - comp/pad final chord anchor。
4. 不要全局禁用 humanize；只保护结构边界。

验收：

- section start 附近的核心 downbeat 不会被拉到上一段。
- 诊断中不再出现“第一颗鼓在 +0.5/+1.0”，实际是下拍音被拉到段前导致统计错位的现象。
- 听感上新段有明确 release。

### Loop G: EndingPlan 扩展为真正的 cadence orchestration

文件：

- `src/core/generation/newEngine/instrumental/InstrumentationPlan.ts`
- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`
- `src/core/generation/newEngine/render/ending.ts`

要求：

1. 扩展 EndingPlan：

```ts
export interface EndingPlan {
  style: EndingStyle;
  outroSectionId: SectionId | null;
  outroBars: number;
  exitBarByRole: Partial<Record<InstrumentRoleName, number>>;
  holdFinalChord: boolean;
  fadeOut: boolean;
  coldStop: boolean;
  finalAnchorRoles?: InstrumentRoleName[];
  sustainRoles?: InstrumentRoleName[];
  protectLeadTiming?: boolean;
}
```

2. `sustainRoles` 默认：
   - pad 存在：pad。
   - pad 不存在但 comp 存在：comp。
   - lead 不作为默认 sustain role。

3. `protectLeadTiming=true`：
   - `applyEnding()` 不得强行延长 lead duration。
   - lead 的最终落主音仍由 `mgLeadRenderer.ts` snap 负责。

4. `HOLD_ROLES` 不应默认包含 lead。  
   建议改成 comp/pad，必要时由 `sustainRoles` 控制。

5. cold ending：
   - 末小节要有 final I anchor。
   - 若没有 pad，comp 或 bass 必须承担 harmonic/grounding anchor。

6. fade ending：
   - 不能简单把 rhythm section 删除后只剩孤立 lead。
   - no-pad 时 comp 留到最后或至少留到 final cadence。

验收：

- `seed=64062 / pop` no-pad outro 有 comp 或其他 harmonic support 到末段 cadence。
- `seed=7 / rnb` fade ending 不只剩 lead。
- `seed=42 / lofi` fade ending 末小节有 pad/comp sustain，且 bass 不抢最后空气。
- jazz tag 不强行拉长 lead，comp 可延留。

### Loop H: 新增 musicalityAuditor，只追加 warning

文件：

- 新增 `src/core/generation/newEngine/render/musicalityAuditor.ts`
- 修改 `src/core/generation/newEngine/render/renderCoordinator.ts`

要求：

1. 不改 `AuditReport` 类型。
2. `renderSongFull()` 在 `auditHarmony()` 后追加：

```ts
const harmonyAudit = auditHarmony(...);
const musicalityAudit = auditMusicality(ir, arrangement, instrumentation, timebase);
const audit = { findings: [...harmonyAudit.findings, ...musicalityAudit.findings] };
```

3. `auditMusicality()` 只读，不修改 IR。
4. 所有 musicality findings 先用 `warning`，不触发 retry。

规则建议：

```text
transition-pickup-missing:
  lead-in boundary 的 prepBar 没有任何 pickupRoles 起音。

section-downbeat-anchor-missing:
  新段开始 ±epsilon 内，没有 downbeatAnchorRoles 起音或延留覆盖。

song-start-abrupt:
  无 intro 且 first section 第一小节全员同时高力度进入。

outro-harmonic-support-missing:
  outro/tag final 1-2 bars 缺少 comp/pad harmonic support，且不是明确 cold button。

comp-continuity-gap:
  comp active range 内 gap 超过阈值。

lead-groove-desync:
  swing style 中 lead timing owner 与 accompaniment timing owner 明显不一致。
```

阈值建议：

- POP/RNB comp active gap warning：`> 1.5 beats`
- LOFI comp active gap warning：`> 2.5 beats`
- JAZZ comp active gap warning：`> 2.0 beats`
- section boundary anchor epsilon：`<= 0.04 beat`
- humanize boundary tolerance：`<= 2 ticks` 或 exact anchor

验收：

- warnings 可在 trace 中汇总。
- 修复后核心 golden seeds 不应出现上述 warning。
- 即便出现 warning，GenerationController 不重跑，不 failed。

## 4. 测试矩阵

必须新增或更新以下测试。

### 4.1 No Pipeline Change Guard

文件建议：

- `src/core/generation/newEngine/generation/pipelineContract.test.ts`

断言：

- `generateSong()` 仍按当前 stage 顺序构建。
- 不新增第二个控制环。
- `GenerationController` 对 warning 仍不 retry。

### 4.2 Transition Gate Tests

文件建议：

- `src/core/generation/newEngine/render/transitionMusicality.test.ts`

用例：

1. `seed=3 / pop`
   - intro -> verse1 是 lead-in。
   - intro activeRoles 可不含 drum。
   - 但 prepBar 内 drum pickup 不被 gate 删除。

2. `seed=3 / lofi`
   - loopIntro -> loop1 的 drum/bass/comp pickup 或 downbeat release 合理存在。

3. `seed=42 / pop`
   - chorus lead-in 前一小节有 fill/pickup。
   - chorus downbeat 有 anchor。

### 4.3 No-Pad Outro Tests

用例：

1. `seed=64062 / pop`
   - lineup 无 pad 时，outro activeRoles 必须包含 comp 或 EndingPlan.sustainRoles 包含 comp。
   - final 2 bars 有 harmonic support。

2. `seed=7 / rnb`
   - fade outro 不得只剩 lead。

### 4.4 Lead Timing Tests

用例：

1. POP/RNB lead straight。
2. JAZZ lead 由 MG StyleRenderer 负责 swing。
3. `applySwing()` 不二次作用 lead。
4. 不允许出现“lead 被压成 straight，但伴奏 swing”的状态。

### 4.5 Boundary Humanize Tests

用例：

1. section start 的 bass/drum anchor 不被负向 jitter 拉到上一段。
2. final tonic anchor 不被拉出 songEnd 或拉到前一 span。
3. 普通 offbeat 仍可 humanize。

### 4.6 Musicality Audit Tests

用例：

1. 手造缺 pickup 的 lead-in IR，触发 `transition-pickup-missing` warning。
2. 手造 comp active range 大空洞，触发 `comp-continuity-gap` warning。
3. 修复后 golden seeds 不触发这些 warning：
   - `3 pop`
   - `3 rnb`
   - `3 lofi`
   - `7 pop`
   - `42 pop`
   - `77 jazz`
   - `64062 pop`
   - `633823 pop`
   - `633823 lofi`

## 5. Golden Seed 听感验收

跑以下诊断，并保存摘要到测试输出或 trace 注释。

```text
seed=3:
  pop / rnb / lofi / jazz

seed=7:
  pop / rnb / lofi / jazz

seed=42:
  pop / rnb / lofi / jazz

seed=77:
  pop / rnb / lofi / jazz

seed=64062:
  pop / rnb / lofi / jazz

seed=633823:
  pop / rnb / lofi / jazz
```

重点人工听：

- intro 不戛然开始。
- verse/hook/loop 进入有结构 release。
- drum 弱拍 pickup 出现在合理边界，而不是被 gate 删除。
- chorus/headOut 不因为 humanize 产生边界抢拍错觉。
- outro 有和声回归，也有器配回落。
- no-pad 编制不出现只有 bass+lead 的空尾。
- lead 与 accompaniment groove 一致。
- comp 织体切换不出现突发空洞。

## 6. 终止条件

Claude 完成循环的条件：

1. 不改大管道链路。
2. 所有新增/更新测试通过。
3. Golden seeds 端到端生成不 failed。
4. musicalityAuditor 对 golden seeds 无核心 transition/outro/comp-gap warning。
5. `traceGeneration()` 能清楚打印：
   - grooveBySection
   - transitionPlan summary
   - endingPlan summary
   - musicality finding summary
6. 人工听感通过：
   - 开头不硬切。
   - 段落进入不空。
   - 鼓 pickup / fill 在结构点出现。
   - outro 不戛然而止。

## 7. 最小实施顺序

按这个顺序做，不要跳：

1. 修 Loop A：lead timing ownership。
2. 修 Loop B：RNB TimeFeel。
3. 建 Loop C：InstrumentationPlan.transitionPlan。
4. 修 Loop D/E：activeRoles lineup-aware + transition-aware gate。
5. 修 Loop F：section boundary humanize anchor。
6. 修 Loop G：EndingPlan cadence orchestration。
7. 接 Loop H：musicalityAuditor warning。
8. 跑 golden seeds 和测试矩阵。

这个顺序的原因：

- 先修 timing owner，否则后面听感判断会被 lead/groove 错位污染。
- 先让器配层拥有 transitionPlan，再改 render gate。
- 先修真实生成，再接 audit，否则 audit 会只是在报告已知坏结果。
