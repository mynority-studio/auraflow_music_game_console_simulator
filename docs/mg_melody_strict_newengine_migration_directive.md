# MG Melody Strict Migration Directive

日期: 2026-06-06  
目标: 将 `../melodygenerative` 当前旋律系统一比一分层移植进 newEngine  
结论: **MG 是新主旋律引擎,newEngine 旧旋律生成废弃为 legacy**

---

## 1. 总判断

newEngine 当前旋律生成是旧产物,不能继续作为主链承重模块。它可以保留在仓库里作为 legacy 参考或历史测试对象,但不再参与新主旋律生成。

迁移后的权威关系:

```text
MG melody system
  = 新主旋律引擎
  = 行为真源
  = strict parity oracle

newEngine render
  = 分轨承载层
  = TrackIR / NoteIR / MusicalIR 输出外壳
  = bass / comp / pad / drum / lead 分轨组织者

newEngine KB
  = MG 模板 / grammar / slope / brick / texture 数据库
  = 只存知识、模板、规则、权重、profile

newEngine audit
  = 分轨之后的只读安全网
  = 处理伴奏和旋律无法互看带来的跨轨问题
```

核心原则:

```text
冲突时 follow MG。
不要为了兼容 newEngine 旧旋律降低 MG 表达能力。
不要把 MG 塞进旧 melodyRenderer。
要用 MG 取代旧 melodyRenderer 的生成职责。
```

---

## 2. 保留与废弃边界

### 2.1 保留 newEngine 的部分

保留这些外壳和契约:

- `BandSpec`
- `ArrangementPlan`
- `HarmonicPlan`
- `InstrumentationPlan`
- `RenderCoordinator`
- `TrackIR / NoteIR / MusicalIR`
- `Timebase`
- `GenerationController`
- `AuditReport`
- `ReadOnlyHarmonyAuditor`
- 分轨角色: `bass / comp / pad / drum / lead`
- program / pedal / final MIDI 输出链

这些模块的职责是承载、分轨、调度、审计,不是重新发明旋律。

### 2.2 废弃为 legacy 的部分

以下不再作为主旋律生成资产:

- `render/melodyRenderer.ts` 当前 MotifStore/head-lock 主逻辑
- `render/MotifStore.ts`
- `render/motifAnchorPrepass.ts` 中为旧 melody 服务的候选池逻辑
- `knowledge/grammarLibrary.ts` 当前 clean-room variation ops
- `knowledge/motifShapes.ts`
- `render/melodyGravity.ts`
- 当前 guide-tone fallback melody path
- 当前 scaleGravity 主旋律 steering
- 当前 chord-contract snap 作为 melody 主生成策略

这些旧逻辑可以保留给 legacy tests,但主链禁止调用。

---

## 3. 新主链

新的 lead 生成链必须来自 MG:

```text
HarmonicPlan
  -> MG-equivalent ChordDef[]
  -> ChordPart
  -> RoadMap / BrickParser
  -> Style Grammar Profile
  -> GrammarRuntime
  -> Token Scheduler
  -> GuideTonePlan
  -> LickGen / NoteChooser
  -> StyleRenderer
  -> MelodyShaper
  -> TrackIR(role='lead')
```

对应 MG 源:

- `../melodygenerative/src/lib/improvisor/generateImprovisorMelody.ts`
- `../melodygenerative/src/lib/improvisor/ChordPart.ts`
- `../melodygenerative/src/lib/improvisor/BrickDictionary.ts`
- `../melodygenerative/src/lib/improvisor/BrickParser.ts`
- `../melodygenerative/src/lib/improvisor/RoadMap.ts`
- `../melodygenerative/src/lib/improvisor/GrammarTypes.ts`
- `../melodygenerative/src/lib/improvisor/BuiltinGrammar.ts`
- `../melodygenerative/src/lib/improvisor/EnrichedGrammar.ts`
- `../melodygenerative/src/lib/improvisor/SlopeAdapter.ts`
- `../melodygenerative/src/lib/improvisor/LofiGrammarTags.ts`
- `../melodygenerative/src/lib/improvisorSlopes.ts`
- `../melodygenerative/src/lib/improvisorVocab.ts`
- `../melodygenerative/src/lib/improvisor/PitchClassSets.ts`
- `../melodygenerative/src/lib/improvisor/NoteChooser.ts`
- `../melodygenerative/src/lib/improvisor/LickGen.ts`
- `../melodygenerative/src/lib/improvisor/GuideTonePlanner.ts`
- `../melodygenerative/src/lib/improvisor/StyleRenderer.ts`
- `../melodygenerative/src/lib/musicEngine.ts` 中的 melody shaping methods

---

## 4. 分层落点

### 4.1 KB 层

MG 的模板、规则、权重、profile 进入 KB。

新增建议:

```text
src/core/generation/newEngine/knowledge/melodyGrammarTypes.ts
src/core/generation/newEngine/knowledge/melodyBuiltinGrammar.ts
src/core/generation/newEngine/knowledge/melodySlopeCorpus.ts
src/core/generation/newEngine/knowledge/melodySlopeAdapter.ts
src/core/generation/newEngine/knowledge/melodyStyleGrammarProfiles.ts
src/core/generation/newEngine/knowledge/melodyLofiGrammarTags.ts
src/core/generation/newEngine/knowledge/melodyBrickDictionary.ts
src/core/generation/newEngine/knowledge/improvisorChordVocab.ts
src/core/generation/newEngine/knowledge/melodyResolutionProfiles.ts
src/core/generation/newEngine/knowledge/textureProfiles.ts
src/core/generation/newEngine/knowledge/textureLegacyProfiles.ts
```

KB 只负责提供:

- Abstract melody token schema
- grammar rule schema
- builtin grammar rules
- slope corpus
- style preference filters
- LOFI / POP / RNB / JAZZ grammar profile
- brick pattern dictionary
- chord vocab spell/color/priority/approach/scales
- texture templates
- resolution/crawl-hold 参数表

KB 禁止:

- 不输出 `NoteIR`
- 不消费 `Timebase`
- 不持有 `prevMidi`
- 不消费 RNG
- 不做实际音符生成

### 4.2 Render 层

MG 的解释器和实际音符生成进入 render。

新增建议:

```text
src/core/generation/newEngine/render/mgMelodyRenderer.ts
src/core/generation/newEngine/render/mgChordDefAdapter.ts
src/core/generation/newEngine/render/mgChordPart.ts
src/core/generation/newEngine/render/mgRoadMapParser.ts
src/core/generation/newEngine/render/mgGrammarRuntime.ts
src/core/generation/newEngine/render/mgTokenScheduler.ts
src/core/generation/newEngine/render/mgPitchClassSets.ts
src/core/generation/newEngine/render/mgNoteChooser.ts
src/core/generation/newEngine/render/mgLickGen.ts
src/core/generation/newEngine/render/mgGuideTonePlanner.ts
src/core/generation/newEngine/render/mgStyleRenderer.ts
src/core/generation/newEngine/render/mgMelodyShaper.ts
src/core/generation/newEngine/render/mgPostMixShaper.ts
```

render 负责:

- `HarmonicPlan -> MG-equivalent ChordDef[]`
- ChordPart/RoadMap parsing
- grammar expansion
- token scheduling
- per-token pitch realization
- guide-tone binding
- style feel rendering
- melody shaping
- final lead `TrackIR`
- LOFI dense melody comping post-mix thinning

### 4.3 Audit 层

audit 不替代 MG render shaper。audit 只接住分轨后不可避免的跨轨问题。

新增/增强 finding:

- `lead-comp-close-clash`
- `dense-melody-comping-mask`
- `slash-bass-structural-double`
- `pop-rhythm-grammar-violation`
- `mg-held-color-cross-chord-warning`
- `texture-pocket-mismatch`

strict parity 下,audit 不能修改 lead。

---

## 5. 源到目标映射

### 5.1 Melody source map

| 迁移内容 | MG 源文件 | newEngine 目标 |
|---|---|---|
| ChordPart / ChordBlock | `../melodygenerative/src/lib/improvisor/ChordPart.ts` | `render/mgChordPart.ts` / `render/mgChordDefAdapter.ts` |
| BrickFamily / BrickPattern | `../melodygenerative/src/lib/improvisor/BrickDictionary.ts` | `knowledge/melodyBrickDictionary.ts` |
| DP parser | `../melodygenerative/src/lib/improvisor/BrickParser.ts` | `render/mgRoadMapParser.ts` |
| RoadMap / KeySegment | `../melodygenerative/src/lib/improvisor/RoadMap.ts` | `render/mgRoadMapParser.ts` or shared render type export |
| Grammar token schema | `../melodygenerative/src/lib/improvisor/GrammarTypes.ts` | `knowledge/melodyGrammarTypes.ts` |
| Builtin rules | `../melodygenerative/src/lib/improvisor/BuiltinGrammar.ts` | `knowledge/melodyBuiltinGrammar.ts` |
| Enriched profile assembly | `../melodygenerative/src/lib/improvisor/EnrichedGrammar.ts` | `knowledge/melodyStyleGrammarProfiles.ts` |
| Slope adapter | `../melodygenerative/src/lib/improvisor/SlopeAdapter.ts` | `knowledge/melodySlopeAdapter.ts` |
| LOFI tags | `../melodygenerative/src/lib/improvisor/LofiGrammarTags.ts` | `knowledge/melodyLofiGrammarTags.ts` |
| Slope corpus | `../melodygenerative/src/lib/improvisorSlopes.ts` | `knowledge/melodySlopeCorpus.ts` |
| Chord vocab / spelling | `../melodygenerative/src/lib/improvisorVocab.ts` | `knowledge/improvisorChordVocab.ts` |
| Grammar runtime | `../melodygenerative/src/lib/improvisor/GrammarRuntime.ts` | `render/mgGrammarRuntime.ts` |
| Pitch sets | `../melodygenerative/src/lib/improvisor/PitchClassSets.ts` | `render/mgPitchClassSets.ts` |
| Note chooser | `../melodygenerative/src/lib/improvisor/NoteChooser.ts` | `render/mgNoteChooser.ts` |
| LickGen | `../melodygenerative/src/lib/improvisor/LickGen.ts` | `render/mgLickGen.ts` |
| GuideTone | `../melodygenerative/src/lib/improvisor/GuideTonePlanner.ts` | `render/mgGuideTonePlanner.ts` |
| Style feel | `../melodygenerative/src/lib/improvisor/StyleRenderer.ts` | `render/mgStyleRenderer.ts` |
| Melody shaping | `../melodygenerative/src/lib/musicEngine.ts` melody shaping methods | `render/mgMelodyShaper.ts` |
| LOFI dense melody comping | `../melodygenerative/src/lib/musicEngine.ts` post-mix shaping | `render/mgPostMixShaper.ts` |

### 5.2 Texture source map

| 迁移内容 | MG 源文件 | newEngine 目标 |
|---|---|---|
| PhraseCellRole / density / energy | `../melodygenerative/src/lib/styleDictionary.ts` section 3 | `knowledge/textureProfiles.ts` |
| modern profiles | `../melodygenerative/src/lib/styleDictionary.ts` `_MODERN_TEXTURE_PROFILES` | `knowledge/textureProfiles.ts` |
| LOFI profiles | `../melodygenerative/src/lib/styleDictionary.ts` `_LOFI_TEXTURE_PROFILES` | `knowledge/textureProfiles.ts` |
| legacy auto pool | `../melodygenerative/src/lib/styleDictionary.ts` `_legacyTexturesAsPool()` | `knowledge/textureLegacyProfiles.ts` |
| rich 17 textureCase render | `../melodygenerative/src/lib/musicEngine.ts` rich texture render block | `render/textureRenderer.ts` |
| legacy textureCase render | `../melodygenerative/src/lib/musicEngine.ts` legacy switch cases | `render/textureRenderer.ts` |

MG 当前 textureCase 总类包括:

```text
Modern/Rich:
  Lyrical_Felt_Piano_Sparse
  Lyrical_10th_Broken
  Ambient_Pad_Breath
  Ambient_Reverse_Swell
  Soft_Guitar_Pluck_8ths
  Piano_Question_Answer
  Low_Pedal_Color_Wash
  HalfTime_Emotional_Pulse

LOFI/Rich:
  Piano_Lofi_OneShot_Space
  Piano_Lofi_Late_Chord_Answer
  Piano_Emo_Broken_10th
  Piano_Ambient_Sustain_Wash
  Piano_HalfTime_Soft_Pulse
  Piano_Lofi_Dusty_Chops
  Piano_Lofi_Tape_Wobble_Arp
  Piano_Wide_Color_Motion
  Piano_CommonTone_Soft_Roll

Legacy primary/applyTexture:
  Pop_Piano_Arp_16ths
  Pop_Broken_8ths_Sync
  Pop_Anthem_Pulse
  Pop_Ballad_158_Sweep
  Pop_Ostinato_Rock
  Pop_Alberti_Lyrical
  Pop_Half_Arp_Sweep
  Pop_Wave_16ths
  RnB_Neo_Soul_Roll
  RnB_Gospel_Triplets
  RnB_Laid_Back_Groove
  RnB_16th_Funk_Stabs
  RnB_Classic_Soul_Arp
  Jazz_Drop_2_Comp
  Jazz_Charleston_Comp
  Jazz_Red_Garland_Block
  Bossa_Piano_Arp
  Jazz_Waltz_Hemiola
  Blues_Slow_12_8_Arp
  Blues_Tremolo_Comp
  Blues_Boogie_Woogie
  Blues_Chicago_Shuffle
  Blues_Slow_Chops
  plus older generic cases:
  Block_Chord, Broken_Chord, Arpeggio_Flow, Ostinato_16s,
  Syncopated_Stabs, Call_And_Response, Root_* bass cases, etc.
```

当前 newEngine 即使已经具备 rich 17 texture,也不能视为全量完成。用户要求是 MG 全量迁移,所以 legacy profile 和 legacy renderer 也必须进入 KB/render。

---

## 6. 数据契约

### 6.1 MG-equivalent ChordDef

strict parity 不允许直接从 `HarmonicPlan` 粗略生成 `ChordPart`。必须先生成 MG 等价 `ChordDef`:

```ts
interface MgEquivalentChordDef {
  root: string;
  rootMidi: number;
  type: string;
  roman: string;
  bass: string;
  bassMidi: number;
  forcedScale?: string;
  notes: string[];
  notesMidi: number[];
  duration: number;
  tensionState?: unknown;
  effectiveFunc?: 'T' | 'S' | 'D';
  virtualExtensions?: number[];
  chordSymbol?: string;
  borrowedFrom?: string | null;
  borrowedSource?: string;
  mustResolve?: boolean;
  tonicizationPlacement?: string;
  analysisKeyPc?: number;
  localRoman?: string;
  bassPattern?: unknown[];
  localTonalCenterPc?: number;
  arrangementMode?: string;
  widePianoVoicing?: unknown;
}
```

### 6.2 MelodyChordPart

`MelodyChordPart` 必须从 MG 等价 `ChordDef` 构造,与 MG `buildChordPart()` 逻辑一致。

```ts
interface MelodyChordBlock {
  index: number;
  spanId: string;
  rootPc: number;
  bassPc: number;
  chordType: string;
  narrowQuality: string;
  romanLabel: string;
  durationBeats: number;
  startBeat: number;
  endBeat: number;
  functionHint?: 'T' | 'S' | 'D';
  localKeyPc?: number;
  forcedScale?: string;
  sectionId: string;
}

interface MelodyChordPart {
  blocks: MelodyChordBlock[];
  totalBeats: number;
  meter: [number, number];
}
```

Adapter 来源:

```text
HarmonicPlan.chordTimeline[*]
  rootPc -> rootPc
  chordType ?? quality -> chordType
  bassRole / bassPedalPc / inversion / slash -> bassPc
  durationBeats / startBeat -> timeline
  forcedScale / localTonalCenterPc -> local context
  chordFunctionTimeline[i] -> functionHint
```

风险点:

- `ChordSpan.quality` 只是窄品质,MG melody 需要 `chord.type` 的宽类型。必须优先用 `span.chordType`。
- `bassPc` 不能只用 rootPc。必须由 `bassRole / bassPedalPc / inversion / slash` 还原实际 `bassMidi`。
- `roman` 不能丢 secondary target、本地 roman、borrowed source。RoadMap 和 shaper 会读。
- `forcedScale` 和 `localTonalCenterPc` 是离调/借和弦旋律一致性的关键字段。
- `widePianoVoicing` 不直接影响 melody pitch,但会影响 texture/post-mix 一致性,需要在 chord equivalent 中保留。

### 6.3 Melody render trace

不要把 MG 的 `origin / lickSource / degree` 直接塞入最终 `NoteIR`。建议保留 sidecar:

```ts
interface MgMelodyTraceEvent {
  noteIndex: number;
  source: 'grammar' | 'guideTone' | 'resolution' | 'lofi-crawl-hold' | 'tonicization-anchor';
  brickName?: string;
  brickFamily?: string;
  tokenKind?: string;
  degree?: string;
  chordSpanId?: string;
  styleTags?: string[];
}

interface MgMelodyRenderResult {
  track: TrackIR;
  trace: MgMelodyTraceEvent[];
}
```

最终 IR 仍是纯 `TrackIR`。audit 若需要解释 MG 行为,由 `RenderCoordinator` 在 audit options 里传 trace。

---

## 7. Strict Parity 硬要求

目标不是“像 MG”,而是 **同输入得到同旋律事件**。

### 7.1 RNG 必须一致

MG melody 内部必须使用 MG 的 RNG:

```ts
function makeMgSeededRng(seed: string | number): () => number {
  let s = typeof seed === 'number' ? seed : hashString(seed);
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

不能用 `RandomContext.substream('melody')` 代替。

### 7.2 ChordDef 必须等价

`HarmonicPlan` 进入 MG melody 前,必须还原成 MG 等价 `ChordDef[]`。

关键字段不能丢:

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

尤其不能把 `span.quality` 当成完整 chord type。必须优先使用 `span.chordType`。

### 7.3 newEngine 后处理不得改 lead

strict parity 下,这些模块必须跳过 `role='lead'`:

- `applySwing`
- `applyDynamics`
- `humanizeVelocity`
- `humanizeTiming`
- `InteractionResolver` 的 lead pitch mutation

MG lead 已经由:

```text
LickGen
  -> StyleRenderer
  -> shape*MelodyHarmony
```

完成最终 timing / velocity / pitch。newEngine 如果再动 lead,就不可能一比一。

### 7.4 LOFI dense comping 必须实际执行

MG 的 `shapeLofiDenseMelodyComping()` 会在 melody append 之后实际改 comp/bass。

strict parity 下不能只做 audit warning。

newEngine 需要:

```text
tracks after lead append
  -> applyMgLofiDenseMelodyComping(tracks, chordEquivalentList)
  -> final tracks
```

### 7.5 验收必须事件级一致

对每个 oracle seed:

```text
mg = melodygenerative final melody NoteEvent[]
ne = newEngine final lead TrackIR converted back to beats

assert mg.length === ne.length
assert mg[i].noteNumber === ne[i].pitch
assert abs(mg[i].time - tickToBeat(ne[i].startTick)) <= 1e-6
assert abs(mg[i].duration - tickToBeat(ne[i].durationTicks)) <= 1e-6
assert mg[i].velocity === ne[i].velocity
```

不接受:

- 听感接近
- 差 1-2 tick
- velocity 近似
- pitch contour 相似
- 只过 audit

---

## 8. 方案审计和用例验收

本节是对本迁移方案的自审结果。结论:方案必须进一步明确 **以 MG 当前测试语义为 oracle**,而不只是移植文件名。

本文中 `MG` 指 `../melodygenerative` 当前版本,也就是用户口中的最强 `musicgenerative / melodygenerative` 行为真源。命名差异不改变原则:迁移时以这个仓库当前输出为准。

### 8.1 已实际运行的 MG 真源测试

在 `../melodygenerative` 已运行:

```text
npm run test:audit -- --seed-count=8
  PASS
  32 songs
  ERROR=0
  Melody events=2141
  POP chord-scale conformance=99.2%
  JAZZ chord-scale conformance=93.8%
  LOFI chord-scale conformance=99.4%
  RNB chord-scale conformance=92.8%

npm run test:audit:full -- --seed-count=8
  PASS
  41 songs, includes 9 focused regression seeds
  ERROR=0
  WARN=21

npm run test:audit:lofi-harmony -- --seed-count=8
  PASS
  structural=491
  conflicts=0
  outsideDecorViolations=0

npm run test:audit:melodic-resolution -- --seed-count=8
  PASS
  checked high-urgency tonal tails=27

npm run test:audit:pop-rhythm -- --seed-count=12
  PASS
  violations=0

npm run test:audit:slash-bass -- --seed-count=12
  PASS
  slash bass pc is treated as bass function, not default melody target

npm run test:audit:chord-parsing -- --seed-count=16
  PASS
  findings=0 errors, 13 warnings

npm run test:audit:style-musicality -- --seed-count=8
  PASS
  POP/JAZZ/LOFI/RNB style pools, orthogonal fill, harmonic perception within thresholds

npm run audit:lofi-grammar-tags
  PASS/report
  LOFI tag distribution available, including lofi_star_crawl=4

npm run lint
  PASS
```

这些测试共同定义 MG 当前强旋律/强伴奏的行为边界:

- POP: rhythm grammar 干净,不 bebop 化,结构位 100% 落在 contract ∩ scale。
- LOFI: 有色彩延伸、crawl-hold、soft cadence、vamp-friendly 留白,结构位冲突为 0。
- RNB/JAZZ: 保留 chromatic/gospel/bebop 权利,不能被 POP/LOFI 规则误杀。
- slash bass: bass pc 是低音功能,不是默认旋律目标。
- melodic resolution: 高紧张尾音必须被下一和声消费。
- chord parsing: roman/root/type/local scale/forced scale 要一致。
- texture/mix: harmonic perception 风险必须在 MG 当前阈值内。

### 8.2 已实际运行的 newEngine 现状测试

在当前 newEngine 仓库已运行:

```text
npm run lint
  PASS

npx vitest run src/core/generation/newEngine --reporter=dot
  PASS
  99 test files
  573 tests
```

这说明 newEngine 的外壳、分轨、IR、audit、现有知识库测试是稳定的。迁移不是推倒整个 newEngine,而是:

```text
保留 newEngine 产品化外壳
替换 newEngine 旧旋律审美
补齐 MG 全量伴奏/织体行为
```

### 8.3 方案审计发现的必须修正点

审计 newEngine 当前主链后,确认以下风险必须写入 Claude 执行约束:

1. `renderCoordinator.ts` 仍调用旧 `renderMelody(...)`。

   迁移后主链必须调用 `renderMgMelody(...)`。旧 `renderMelody`、`MotifStore`、`melodyGravity` 只能留作 legacy,不能参与主旋律。

2. `resolveInteractions(...)` 当前会修改 lead pitch。

   它会在音域碰撞时把 lead 上移八度。strict parity 下这是硬违规。MG lead 进入 newEngine 后,`InteractionResolver` 只能改 comp/bass/pad,不能改 lead。

3. `applyDynamics(...)` 当前全轨改 velocity。

   MG melody velocity 是 oracle 的一部分。strict parity 下,lead 必须跳过 newEngine dynamics。需要段落能量可作用于伴奏,不能改 MG lead。

4. `humanizeVelocity(...)` 当前会改 lead velocity。

   strict parity 下,lead 必须跳过。MG 的人性化/力度如果存在,只来自 MG 自身。

5. `applySwing(...)` 当前会改 lead onset tick。

   strict parity 下,lead 必须跳过。MG `StyleRenderer` 已经产出最终节奏。

6. `humanizeTiming(...)` 当前会改 lead startTick。

   strict parity 下,lead 必须跳过。否则 event parity 必失败。

7. `textureProfiles.ts` 当前显式排除了 legacy pool。

   文件现状是 `TEXTURE_POOL` 只含 modern + LOFI 17 个 profile,测试也锁定“不含 legacy”。这与用户“最强伴奏引擎全量接入”冲突。迁移后必须改测试和实现:MG 的 `_legacyTexturesAsPool()` 也要进入 KB。

8. `textureRenderer.ts` 当前只实现 rich 17。

   MG `musicEngine.ts` 的 texture switch 还包含大量 legacy cases: `Pop_Piano_Arp_16ths`、`RnB_Neo_Soul_Roll`、`Jazz_Drop_2_Comp`、`Blues_Boogie_Woogie`、`Block_Chord`、`Broken_Chord`、`Root_*` 等。迁移后必须全部有 renderer 或明确等价 interpreter。

9. LOFI dense melody comping 不能只审计。

   MG `shapeLofiDenseMelodyComping()` 会在 melody append 后实际删除 dense bar 的 chord 事件、压短/降速 bass。newEngine 必须做同等 post-mix shaping。

### 8.4 迁移后必须新增的 oracle 测试

Claude 迁移时必须新增 newEngine 测试,不是只跑旧测试。

#### A. MG oracle dump 测试

为每个 focused seed dump:

```text
ChordDef[]
RoadMap bricks
grammar selected rules
scheduled tokens
raw melody
style-rendered melody
final shaped melody
post-mix tracks
textureCase per bar
```

newEngine 对同 seed 运行后逐层比较。先逐层过,再端到端过。

#### B. Lead event parity 测试

固定 seeds 至少包括:

```text
lofi_3xyhma
lofi_bneeok
lofi_uhloiw
lofi_er5a0r
pop_cztjju
pop_xm3lg3
pop_7b44e5
jazz_music_probe
rnb_music_probe
```

断言:

```text
pitch exact
start beat exact
duration exact
velocity exact
event order exact
event count exact
```

#### C. Style boundary 测试

迁入 MG 的 `style-preference-musicality` 语义:

- POP grammar pool 中 `bebop=0`。
- LOFI grammar pool 中 `bebop=0`。
- RNB 保留 `rnb_chromatic_grace / rnb_melisma_crawl`。
- JAZZ 保留 bebop/chromatic line。
- 每个 style 的 structural melody 必须 100% 落在 `contract ∩ local scale`。

#### D. LOFI 专项测试

迁入:

- `lofi-melody-harmony`
- `lofi-grammar-tags`
- `lofi_uhloiw` 的 `F -> E` 微解决固定断言
- `lofi_bneeok` return note 不被前一个尾音遮蔽
- dense melody bar 的 comp/bass post-mix shaping

#### E. POP 专项测试

迁入:

- `pop-rhythm-grammar`
- `pop_cztjju`: `G7` 上不能生成非音阶结构位 `C#`
- `pop_7b44e5`: 高紧张 tail 必须进入下个和声被消费
- POP 和声纯度: triad/add9/sus/7 为主,避免 LOFI/JAZZ 式 maj9/m9/m11/13 泛化

#### F. Chord parsing / local scale 测试

迁入:

- `chord-parsing-semantics`
- `forcedScale`
- `localTonalCenterPc`
- `borrowedSource`
- `mustResolve`
- `secondary dominant / tonicization placement`
- minor `VII` 与 borrowed `bVII` 不得混淆

#### G. Slash bass 测试

迁入 `slash-bass-melody-doubling` 语义:

```text
slash bass pc 是 bass function
不是 melody default target
bassMidi 必须从 slash/inversion/bassRole 还原
```

#### H. Texture / accompaniment parity 测试

这是“最强伴奏引擎”验收,必须覆盖:

- `TEXTURE_POOL` count/profile/id/tag 与 MG 一致。
- `_legacyTexturesAsPool()` 输出与 MG 一致。
- `pickTextureForBar()` 对同 seed / style / phraseRole / density / energy / dominantChain 输出一致。
- `textureCase per bar` 与 MG 一致。
- rich 17 texture 和 legacy texture switch cases 都必须覆盖到 renderer/interpreter。
- dry texture oracle 可以检查 MG 原始 hit 语义:相对 onset、duration、voice subset、bass/chord 分工。
- final split-track output 不要求与 MG texture bit-exact。MG 是单事件流,newEngine 是 bass/comp/pad/drum 分轨产品化输出。
- newEngine 已调好的 pocketize lay-back、polyVelocity、CC7 均衡、pad/comp 电平、bass 音区属于产品化 render/mix feel 层,不应被 MG bit-clone 回退。
- LOFI `timing.chordLateMs / bassLateMs / velocityHumanize` 以 MG 作为 profile/语义参考,但最终落地可经过 newEngine pocket/balance 适配器。
- bass/comp/drum 共享同一 texture schedule,保证段落 groove 来自同一个 texture 意图。

分层原则:

```text
MG TEXTURE_POOL / textureCase / applyTexture case
  -> 定义织体词汇、段落选择、节奏语义、声部分工

newEngine split-track renderer / pocket / polyVelocity / CC7 balance
  -> 定义最终产品手感、分轨平衡、旋律让位、音区管理
```

因此,texture 验收不是最终 MIDI bit parity,而是 **semantic + dry-render parity + productized feel preservation**。

#### I. Post-processing exclusion 测试

新增测试证明 strict parity mode 下:

```text
resolveInteractions 不改 lead pitch
applyDynamics 不改 lead velocity
humanizeVelocity 不改 lead velocity
applySwing 不改 lead startTick
humanizeTiming 不改 lead startTick
duckUnderLead 只改 comp,不改 lead
audit 只读,不改 lead
```

### 8.5 迁移验收矩阵

| 层 | 最低验收 | 失败时处理 |
|---|---|---|
| KB melody | grammar/rule/slope/tag/brick count 与 MG 一致 | 不得继续 render loop |
| KB texture | modern + LOFI + legacy profile 与 MG 一致 | 不得声称伴奏全量迁移 |
| Chord adapter | `ChordDef[]` 字段等价 | 修 adapter,不能修 MG |
| RoadMap | bricks exact | 修 BrickParser/ChordPart |
| Grammar | selected rules / tokens exact | 修 RNG/profile/weights |
| NoteChooser | raw melody exact | 修 pitch sets / degree semantics |
| Shaper | final melody exact | 修 resolution/crawl/tonicization |
| Coordinator | final lead exact | 禁止 newEngine 后处理改 lead |
| Texture | per-bar textureCase exact + dry hit semantic parity + final feel preservation | 修 texture KB/render 或 pocket/balance adapter |
| Post-mix | LOFI dense comping exact | 修 post-mix shaper |
| Audit | 只读 finding | 不得用 audit 改 melody |

---

## 9. 实施循环

### Loop 0: 建 MG oracle

从 `../melodygenerative` dump:

- `ChordDef[]`
- RoadMap bricks
- grammar expansion result
- scheduled tokens
- raw melody
- final melody
- post-mix tracks

重点 seeds:

- `lofi_uhloiw`
- `lofi_er5a0r`
- `pop_7b44e5`
- POP/RNB/JAZZ/LOFI 各 5 个固定 seed

终止:

- oracle fixtures 可重复生成。

### Loop 1: KB port

迁入:

- grammar types
- builtin grammar
- slope corpus
- slope adapter
- style grammar profiles
- lofi tags
- brick dictionary
- improvisor chord vocab
- texture profiles

终止:

- KB rule count/profile count/tag count 与 MG 一致。

### Loop 2: ChordDef adapter + RoadMap

迁入:

- MG-equivalent `ChordDef` adapter
- ChordPart
- BrickParser
- RoadMap

终止:

- RoadMap fixture 与 MG 精确一致。

### Loop 3: GrammarRuntime + Scheduler

迁入:

- MG-compatible RNG
- grammar expansion
- schedule tokens
- slope balancing
- clipped overrun token preservation

终止:

- scheduled token fixture 与 MG 精确一致。

### Loop 4: PitchSets + NoteChooser

迁入:

- PitchClassSets
- NoteChooser
- IV probability table
- G/A/B/X semantics
- slope window semantics

终止:

- raw melody fixture 与 MG 精确一致。

### Loop 5: LickGen + GuideTone + StyleRenderer

迁入:

- LickGen
- GuideTonePlanner
- StyleRenderer

终止:

- style-rendered melody fixture 与 MG 精确一致。

### Loop 6: MelodyShaper

迁入:

- `shapeMelodyHarmony`
- `applyLofiCrawlHoldParadigm`
- `applyMelodicResolutionParadigm`
- `applyLofiTonicizationColorAnchors`
- slash-bass thinning helpers

终止:

- final melody fixture 与 MG 精确一致。

### Loop 7: RenderCoordinator 替换主旋律

动作:

- 主链改为 `renderMgMelody()`
- 旧 `renderMelody()` 不再被主链调用
- lead 跳过 newEngine global post-process
- LOFI post-mix shaper 实际执行

终止:

- newEngine final lead 与 MG final melody 精确一致。

### Loop 8: 全量 texture

动作:

- modern + LOFI + legacy texture templates 进 KB
- all MG `applyTexture` cases 进 render interpreter
- bass/comp/drum 共享 texture schedule

终止:

- MG textureCase 全覆盖。

### Loop 9: Audit safety

动作:

- audit 只读
- 不改 lead
- 对跨轨问题产 finding
- retry 只在 render 层 overlay

终止:

- audit 不破坏 strict melody parity。

---

## 10. Claude 执行提示词

```text
你要把 ../melodygenerative 当前版本的旋律生成系统一比一移植进 newEngine。

最高判断:
newEngine 当前旋律生成是 legacy,不要继承,不要折中,不要补丁式接入。
MG 当前仓库是行为真源。用户要接入的是当前最强 melodygenerative/musicgenerative 旋律引擎和伴奏引擎。
MG melody system 是新主旋律引擎。
MG TEXTURE_POOL + musicEngine texture switch + dense comping 是新伴奏/织体的词汇、选择和语义真源。
但 newEngine 是分轨产品化引擎,最终伴奏手感保留 newEngine 近期修好的 pocketize lay-back、polyVelocity、CC7 均衡、pad/comp 电平和 bass 音区。

保留:
- newEngine 的 Band/Arrangement/Harmony/Instrumentation 契约
- RenderCoordinator 分轨外壳
- TrackIR/NoteIR/MusicalIR
- Controller/Audit 外壳

废弃为主链 legacy:
- render/melodyRenderer.ts 当前逻辑
- MotifStore 主旋律路径
- grammarLibrary developBar
- melodyGravity / scaleGravity 主旋律 steering
- guideTone fallback melody path

必须:
1. 以 MG generateImprovisorMelody + shape*MelodyHarmony 为行为真源。
2. 模板/grammar/slope/brick/texture/profile 放 KB。
3. ChordPart/RoadMap/GrammarRuntime/NoteChooser/LickGen/StyleRenderer/Shaper 放 render。
4. 使用 MG makeSeededRng,不能用 RandomContext 代替。
5. HarmonicPlan 必须还原为 MG 等价 ChordDef[]。
6. newEngine 的 swing/dynamics/humanize/resolver 不得改 lead。
7. LOFI shapeLofiDenseMelodyComping 必须实际 post-mix 改 comp/bass。
8. 验收按 strict event parity,pitch/time/duration/velocity/order 全一致。
9. 伴奏词汇/选择必须以 MG TEXTURE_POOL 为准,包含 modern + LOFI + legacy。
10. texture renderer/interpreter 必须覆盖 MG musicEngine.ts 里的 rich 17 + legacy switch cases。
11. texture 验收分两层:dry-render 语义对齐 MG,final split-track 保留 newEngine pocket/balance 手感。
12. 迁移后必须跑 MG oracle parity tests,不能只跑 newEngine 旧测试。

任何与 newEngine 旧旋律逻辑冲突的地方,follow MG。
任何 parity 失败,不得用听感接近关闭,必须定位漂移来源。
```

---

## 11. 最终状态

完成后,newEngine 的音乐生成职责应变成:

```text
Band / Arranger / Harmony / Instrumentation
  -> 给 MG melody 提供上下文

MG Melody Render
  -> 生成主旋律

Texture/Bass/Comp/Pad/Drum Render
  -> 分轨伴奏

Audit
  -> 只读检查跨轨冲突

Controller
  -> 只在 render 层 retry / overlay
```

一句话验收:

```text
newEngine 不再拥有自己的旧旋律审美。
newEngine 只承载 MG 的旋律审美,并用分轨和 audit 把它产品化。
```
