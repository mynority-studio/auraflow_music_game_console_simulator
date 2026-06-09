# MusicGenerative Strict NewEngine Migration Directive

日期: 2026-06-09  
目标: 让 Claude 按严格链路把 `../melodygenerative` / MusicGenerative 当前最强旋律与伴奏语义迁入 newEngine  
状态: 本文是 `docs/mg_melody_strict_newengine_migration_directive.md` 的审计后补强版  

---

## 0. 最高判断

当前 newEngine 不能再把旧旋律、旧伴奏织体当主链。  
MusicGenerative 是行为真源；newEngine 是产品化分轨外壳。

必须保留:

- `GenerationController`
- `BandSpec`
- `ArrangementPlan`
- `HarmonicPlan`
- `InstrumentationPlan`
- `RenderCoordinator`
- `TrackIR / NoteIR / MusicalIR`
- `bass / comp / pad / drum / lead` 分轨输出
- `AuditReport` / audit 外壳
- MIDI/program/pedal/final export 外壳

必须替换为 MusicGenerative 语义真源:

- lead melody generation
- melody grammar / slope / brick / preference
- melody shaper
- texture vocabulary
- texture selection semantics
- texture render semantics
- LOFI dense melody comping
- MG post-mix rules that决定 comp/bass 是否让位 melody

不要改大管道链路。  
不要把 MusicGenerative 塞进旧 `melodyRenderer.ts`。  
不要让旧 newEngine melody / motif / guide-tone fallback 继续影响主链结果。  

---

## 1. 正确分层

### 1.1 newEngine 外壳

newEngine 仍然负责:

```text
GenerationController
  -> Arrangement
  -> Harmony
  -> Instrumentation
  -> RenderCoordinator
  -> Audit
  -> MIDI export
```

这些模块只提供结构、和声时间线、分轨、乐器、审计和输出。

### 1.2 KB 层

只放知识、模板、词汇、profile、权重、规则表。

必须从 MusicGenerative 迁入:

- brick dictionary
- grammar token schema
- builtin grammar
- enriched grammar
- slope corpus
- slope adapter
- LOFI grammar tags
- improvisor vocab
- pitch class set data
- style preferences
- phrase cell role / density / energy
- modern texture profiles
- LOFI texture profiles
- legacy texture profiles
- voicing / texture behavior metadata

禁止把模板逻辑硬塞进 render 主函数里。render 只解释 KB。

### 1.3 Render 层

放算法解释器和事件生成:

- MG RNG adapter
- MG-equivalent `ChordDef[]` adapter
- `ChordPart`
- `RoadMap`
- `GrammarRuntime`
- `GuideTonePlanner`
- `NoteChooser`
- `LickGen`
- `StyleRenderer`
- `MelodyShaper`
- `TextureRenderer`
- `TextureClock`
- `PostMixShaper`

Render 层可以把 MusicGenerative 的一轨 `melody/chord/bass` 语义翻译成 newEngine 的多轨:

```text
MG melody -> newEngine lead
MG chord  -> newEngine comp
MG bass   -> newEngine bass
MG texture schedule -> comp / bass / drum shared schedule
newEngine pad -> 独立 pad 层,但必须 pad-aware 避让 comp
```

不要把 Harmony 整体搬进 comp。  
Harmony 生成和声计划，comp 只是和声的一个可听声部。

### 1.4 Harmony 层

Harmony 层只放计算式和声能力:

- borrowed chord rule
- tonicization rule
- secondary dominant rule
- modal interchange rule
- cadential rule
- voice-leading-aware harmonic plan

模板型和声进行放 KB。  
计算式规则可以在 Harmony 消费 KB，但不能污染 comp render。

### 1.5 Audit 层

Audit 必须只读。

Audit 可以报告:

- lead/comp clash
- pad/comp mud
- bass/comp register conflict
- unresolved tension
- section transition gap
- texture switch gap
- clock misalignment

Audit 不允许改 lead。  
需要 retry 时，只能让 Controller 调度 render 层重新生成 overlay 或重新选择 texture，不允许 audit 自己改事件。

---

## 2. 当前审计发现的硬缺口

Claude 必须先修这些缺口，不要继续堆新功能。

### 2.1 final lead 仍会被 newEngine 后处理改写

当前 `renderMgMelody()` 已接入主链，但最终 lead 仍会经过:

- `gateByDensity`
- `applyDynamics`
- `applyEnding`
- `applyLeadIns`
- 任何后续全局 processor

这会造成:

- velocity 被改
- intro/setup/outro 等段落 lead 被 activeRoles gate 删除
- outro/cold/fade 改 lead duration 或 velocity
- 末音 snap 改 pitch

硬要求:

```text
renderMgMelody()
  -> final lead TrackIR
  -> 不再被任何 newEngine post-process 修改
```

所有全局 post-process 必须显式跳过 `role === 'lead'`，包括但不限于:

- density gate
- dynamics
- ending
- lead-in crescendo
- humanize velocity
- humanize timing
- swing
- interaction resolver
- final tonic snap
- cold stop/fade

如果某段需要器乐 intro，不要在 strict parity 路径里删除 lead。  
要么由 MusicGenerative 源链本身生成对应结果，要么作为非 strict 产品模式的 mute automation，不能污染 strict parity。

### 2.2 RNG 仍不是 MG seed 直通

不能这样:

```ts
renderMgMelody(plan, band, timebase, rng.substream('melody'))
const seed = rng.int(...)
const mgRng = makeSeededRng(seed)
```

必须这样:

```text
user seed / song seed
  -> MG makeSeededRng(seed)
  -> MG melody chain
```

`RandomContext.substream('melody')` 可以继续给 newEngine 伴奏、人性化、器配使用，但不能替代 MG seed。

验收:

```text
同一个 seed:
MusicGenerative final melody
  === newEngine final lead
```

比较字段:

- order
- pitch
- start
- duration
- velocity

### 2.3 ChordDef 还原不完整

`HarmonicPlan` 进入 MG melody 前，必须还原成 MG-equivalent `ChordDef[]`。

字段不能丢:

- `root`
- `rootMidi`
- `type`
- `roman`
- `bass`
- `bassMidi`
- `forcedScale`
- `notes`
- `notesMidi`
- `duration`
- `effectiveFunc`
- `borrowedFrom`
- `borrowedSource`
- `mustResolve`
- `tonicizationPlacement`
- `analysisKeyPc`
- `localRoman`
- `localTonalCenterPc`
- `widePianoVoicing`

特别要求:

- `span.chordType` 优先于 `span.quality`
- slash/inversion/pedal bass 必须还原真实 `bass/bassMidi`
- borrowed / tonicization / secondary dominant 信息不能丢
- `notes/notesMidi` 必须来自真实和弦音或 wide voicing，不要只拿 stable tones 凑数

### 2.4 LOFI dense melody comping 未实际执行

MusicGenerative 源逻辑:

```text
events.push(...improvisorMelody)
if style === LOFI:
  events = shapeLofiDenseMelodyComping(events, chords)
```

newEngine 必须新增 render 层 post-mix shaper:

```text
tracks after lead/comp/bass render
  -> applyMgLofiDenseMelodyComping(tracks, chordEquivalentList)
  -> final comp/bass adjusted tracks
```

行为必须等价:

- dense melody bar 保留 melody
- dense melody bar 删除 chord/comp 的 dense hits
- dense melody bar bass 每 bar 最多保留一个
- bass duration 缩到 MG 同等上限
- bass velocity 乘 MG 同等比例

这不是 audit warning。必须实际改 comp/bass。

### 2.5 texture 没有全量覆盖

必须迁入:

- modern rich texture cases
- LOFI rich texture cases
- legacy texture cases
- `_legacyTexturesAsPool()`
- MG `applyTexture` switch cases
- MG texture pick rules
- MG texture timing/pocket rules

当前只做 rich 17 不够。  
`TEXTURE_POOL` 必须包含 modern + LOFI + legacy。  
`textureRenderer/interpreter` 必须覆盖 MusicGenerative 里所有 case。

---

## 3. 正确渲染链路

### 3.1 Strict MG dry mode

先实现一个可测试的 strict dry path。

```text
seed
  -> makeMgSeededRng(seed)
  -> HarmonicPlanToMgChordDef(full fields)
  -> ChordPart
  -> RoadMap
  -> GrammarRuntime
  -> GuideTonePlanner
  -> NoteChooser
  -> LickGen
  -> StyleRenderer
  -> shapeMelodyHarmony
  -> final MG melody events
  -> TrackIR lead
```

dry mode 下:

- lead 不受任何 newEngine 后处理
- 不做 final tonic snap
- 不做 activeRoles gate
- 不做 dynamics/fade/cold/lead-in
- 不做 humanize/swing/resolver
- 只做单位转换: beat -> tick

### 3.2 Product split-track mode

strict dry path 过后，再接产品分轨。

```text
Arrangement/Harmony/Instrumentation
  -> MG texture schedule
  -> bass render
  -> comp render
  -> pad render
  -> drum render
  -> lead = strict MG lead
  -> LOFI dense post-mix shaper(comp/bass only)
  -> pad-aware comp avoidance(comp/pad only)
  -> non-lead pocket/balance/humanize
  -> read-only audit
  -> MusicalIR
```

Product mode 可保留 newEngine 的:

- split track
- comp/pad separation
- pocketize lay-back
- polyVelocity
- CC7 balance
- pad/comp volume balancing
- bass register constraint
- texture switch structural policy

但这些只允许作用于 non-lead。  
lead 永远以 MusicGenerative final melody 为准。

### 3.3 两层验收

必须分清:

```text
strict parity
  = 证明 MG 行为被完整迁移

product render
  = 证明 newEngine 分轨产品化不破坏 lead,且伴奏音乐性正确
```

不要用 product handfeel 当借口破坏 strict parity。  
也不要为了 dry parity 回退已经修好的 non-lead pocket/balance。

---

## 4. Claude 执行 Loop

### Loop 0: 冻结审计基线

动作:

- 不改大链路
- 读取本文档
- 读取 `docs/mg_melody_strict_newengine_migration_directive.md`
- 扫描当前 `src/core/generation/newEngine`
- 扫描 `../melodygenerative/src/lib`
- 列出当前已完成/未完成项

终止:

- 输出 checklist
- 不允许声称完成迁移，只能声称完成审计

### Loop 1: RNG 所有权修正

动作:

- 给 `renderMgMelody` 传原始 song seed
- `renderMgMelody` 内部直接 `makeSeededRng(seed)`
- 禁止使用 `RandomContext.substream('melody')` 派生 MG seed
- newEngine 其他模块仍可使用 `RandomContext`

新增测试:

- 同 seed 调用 MG oracle 与 newEngine lead seed adapter 结果一致
- grep/单测保证 lead path 不出现 `substream('melody')` 派生 MG seed

终止:

- seed 直通测试通过

### Loop 2: ChordDef full equivalence

动作:

- 扩展 `mgChordDefAdapter`
- 扩展 `MgChordDef` 类型
- 保留 full fields
- slash/inversion/pedal bass 全部正确还原
- borrowed/tonicization/secondary/local key 信息完整还原
- notes/notesMidi 使用真实 chord notes / wide voicing

新增测试:

- maj7/m7/7alt/sus/add9/m11/13 等 chord type 不丢
- slash chord bassMidi != rootMidi
- pedal bassMidi 正确
- borrowedSource / mustResolve / localTonalCenterPc 不丢
- widePianoVoicing 不丢

终止:

- MG shaper 消费字段完整
- 不再有窄 ChordDef 导致的 fallback

### Loop 3: lead 绝对保护

动作:

- `gateByDensity` 永远不删 lead
- `applyDynamics` 跳过 lead
- `applyEnding` 跳过 lead velocity/duration/drop
- `applyLeadIns` 跳过 lead
- `humanizeVelocity` 跳过 lead
- `humanizeTiming` 跳过 lead
- `applySwing` 跳过 lead
- `InteractionResolver` 不改 lead
- 删除或移入 MG 源 shaper 的 final tonic snap

新增测试:

```text
rawLead = renderMgMelody(...)
finalLead = renderSongFull(...).tracks.lead
assertEventExact(rawLead, finalLead)
```

必须覆盖 golden seeds:

- `7` / LOFI
- `396040` / POP
- `777870` / RNB
- `64062`
- `633823`

终止:

- final lead 与 raw MG lead 完全一致

### Loop 4: MusicGenerative melody oracle 完整化

动作:

- 保留已有 RoadMap / token / raw / styled / enriched / shaper parity tests
- 增加 final lead parity test
- 增加 product render lead non-mutation test

终止:

- stage parity 通过
- final lead parity 通过
- product lead non-mutation 通过

### Loop 5: LOFI dense post-mix shaper

动作:

- 新增 `render/mgPostMixShaper.ts`
- 端口 `shapeLofiDenseMelodyComping`
- 输入 newEngine split tracks + MG-equivalent chords
- 输出只改 comp/bass，不改 lead
- 在 RenderCoordinator 中 lead/comp/bass 生成后、audit 前执行

新增测试:

- dense melody bar 删除 comp hits
- dense melody bar bass 每 bar 最多保留一个
- bass duration/velocity 与 MG 一致
- non-dense bar 不变
- lead 不变

终止:

- LOFI dense comping 与 MG fixture 一致

### Loop 6: texture KB 全量迁移

动作:

- modern profiles 入 KB
- LOFI profiles 入 KB
- legacy profiles 入 KB
- `_legacyTexturesAsPool()` 入 KB
- texture behavior metadata 入 KB
- selection rules 消费 KB，不硬编码散落

新增测试:

- MG texture pool count 与 newEngine KB count 一致
- 每个 MG texture case 都能在 KB 查到
- 每个 KB texture case 都有 renderer/interpreter 或明确 fallback contract

终止:

- rich + legacy pool 全覆盖

### Loop 7: texture render/interpreter 全覆盖

动作:

- rich 17 dry semantic 对齐
- legacy switch cases 对齐
- duration/tRel/velocity ratio/pitch set dry 对齐
- LOFI texture clock 对齐 MG shapeLofiArrangement / lofiPocketMs
- product handfeel 只在 non-lead final layer 应用

新增测试:

```text
for each textureCase:
  mgDryHits = MG dry texture hits
  neDryHits = newEngine dry texture hits
  assert semantic equivalent
```

Product 额外测试:

- no comp gap at structural downbeat unless pad or bass explicitly holds harmony
- dusty chops `0.58` 类 raw tRel 不能造成听感半拍错位
- texture switch 只能在 section/bar boundary 常态发生
- verse 内切换为低概率，且必须 bridge/overlap

终止:

- MG textureCase 全覆盖
- dry semantic 对齐
- product mode 无明显空拍/错拍

### Loop 8: pad/comp 分工保护

动作:

- pad 是 sustain/color layer
- comp 是 action/rhythm layer
- pad active 时 comp 降密度、缩时值、避让绝对音高
- pad 不复制完整 root-position chord 与 comp 打架
- comp 作为唯一和声支撑时，必须保证 structural downbeat 有 anchor

验收:

- pad+comp 同时 active 不出现同八度同音长铺
- comp-only 段落不因 delayed texture 造成下拍空洞
- pad-only 段落必须有可听和声托底

终止:

- pad/comp 不互相糊
- comp 不因 pad-aware 避让变成空轨

### Loop 9: audit 只读与 controller retry

动作:

- audit 只产 finding
- retry budget 在 Controller / RenderCoordinator overlay 层消费
- audit 不改 lead
- audit 不直接写 MIDI events

新增测试:

- audit 前后 MusicalIR 不变
- retry 后 lead 仍 exact

终止:

- audit 不破坏 strict parity

---

## 5. 验收命令

Claude 每个 loop 结束必须跑相关测试。最终至少跑:

```bash
npx vitest run \
  src/core/generation/newEngine/render/mgRoadMap.parity.test.ts \
  src/core/generation/newEngine/render/mgScheduledTokens.parity.test.ts \
  src/core/generation/newEngine/render/mgRawMelody.parity.test.ts \
  src/core/generation/newEngine/render/mgStyledMelody.parity.test.ts \
  src/core/generation/newEngine/render/mgEnrichedMelody.parity.test.ts \
  src/core/generation/newEngine/render/mgMelodyShaper.parity.test.ts \
  src/core/generation/newEngine/render/mgLeadRenderer.test.ts \
  src/core/generation/newEngine/render/melodyGrooveAlign.test.ts
```

还必须新增并跑:

```bash
npx vitest run \
  src/core/generation/newEngine/render/mgFinalLeadParity.test.ts \
  src/core/generation/newEngine/render/mgChordDefAdapter.fullParity.test.ts \
  src/core/generation/newEngine/render/mgPostMixShaper.test.ts \
  src/core/generation/newEngine/render/textureCoverage.parity.test.ts \
  src/core/generation/newEngine/render/textureDryRender.parity.test.ts \
  src/core/generation/newEngine/render/productLeadNonMutation.test.ts
```

如果测试文件尚不存在，Claude 必须创建。  
不能用“现有测试全绿”作为完成依据。

---

## 6. Golden Seed 验收

必须固定这些种子做回归:

| Seed | Style | 目的 |
| --- | --- | --- |
| `7` | LOFI | 检查 LOFI lead timing/velocity 不被后处理改 |
| `396040` | POP | 检查 POP lead velocity 不被 dynamics 改 |
| `777870` | RNB | 黄金种子，VERSE 旋律线标星，必须保护 |
| `64062` | 任意原复现场景 | 检查 BAR2-3 伴奏织体顿挫 |
| `633823` | 任意原复现场景 | 检查 BAR4 柱式到分解切换空拍 |

每个 seed 至少输出:

```text
rawLead.length
finalLead.length
pitchDiffCount
startDiffCount
durationDiffCount
velocityDiffCount
compGapReport
textureSwitchReport
auditFindingCount
```

strict 合格标准:

```text
pitchDiffCount === 0
startDiffCount === 0
durationDiffCount === 0
velocityDiffCount === 0
rawLead.length === finalLead.length
```

---

## 7. 禁止事项

Claude 不允许:

- 改大管道链路来绕开问题
- 回退 MusicGenerative melody 表达能力
- 继续让旧 `melodyRenderer.ts` 参与主链
- 用 newEngine MotifStore 混合 MG lead
- 用 guide-tone fallback 修补 MG lead
- 用 post-process 改 lead pitch/time/duration/velocity
- 用 density gate 删除 lead
- 只迁 rich texture 而忽略 legacy
- 只做 audit warning 而不执行 LOFI dense comping
- 把 Harmony 整体搬到 comp render
- 把模板型进行写进 Harmony 主管道
- 让 product handfeel 破坏 strict parity

---

## 8. Claude 最终汇报格式

Claude 完成后必须按这个格式汇报:

```text
1. 迁移范围
   - 已迁 MG melody modules:
   - 已迁 MG KB modules:
   - 已迁 MG texture modules:
   - 已迁 MG post-mix modules:

2. 保留 newEngine 外壳
   - Arrangement:
   - Harmony:
   - Instrumentation:
   - RenderCoordinator:
   - Audit:

3. Strict parity
   - stage parity:
   - final lead parity:
   - golden seeds:

4. Product render
   - non-lead pocket/balance:
   - pad/comp interaction:
   - texture switch:
   - comp gap:

5. 测试结果
   - 命令:
   - 通过:
   - 失败:

6. 未完成项
   - 必须列出,不能隐藏
```

---

## 9. Definition of Done

只有同时满足以下条件，才允许说迁移完成:

- MusicGenerative final melody 与 newEngine final lead 事件级一致
- lead 不再被 newEngine 后处理改写
- MG RNG seed 直通
- MG-equivalent ChordDef 字段完整
- LOFI dense comping 实际执行
- modern + LOFI + legacy texture 全覆盖
- dry texture semantic 对齐
- product split-track 保留 newEngine 手感但不破坏 lead
- pad/comp 不打架
- texture switch 不制造空拍/错拍
- audit 只读
- golden seeds 全部通过
- 新增 final parity tests 全部通过

如果任一项未满足，结论必须写:

```text
Migration incomplete.
```

不得写:

```text
Migration complete.
```

