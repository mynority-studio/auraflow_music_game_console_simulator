# Lo-fi / Pop 结构感审计与改造计划

本文档用于判断当前 `newEngine` 的 lo-fi / pop 风格、verse 结构切分、和声骨架与编配是否符合音乐原理和市面常见听感，并给 Claude 一套可执行改造计划。

## 联网参考结论

参考资料：

- Song structure: https://en.wikipedia.org/wiki/Song_structure
- Structure-Enhanced Pop Music Generation via Harmony-Aware Learning: https://arxiv.org/abs/2109.06441
- POP909 dataset: https://arxiv.org/abs/2008.07142
- What Is Lo-Fi Music? Sound, Origins, and Production: https://orphiq.com/resources/what-is-lofi-music
- How to Make LoFi Music: https://emastered.com/blog/how-to-make-lofi-music
- Lo-Fi Chord Progressions Guide: https://chordmap.io/blog/lofi-chord-progressions-guide

外部资料给出的稳定判断：

1. Pop 的主流结构仍是 sectional form，核心是 intro / verse / pre-chorus / chorus / verse / pre-chorus / chorus / bridge / final chorus / outro。
2. Verse 和 chorus 不只是名字不同，而是功能不同：verse 承载叙事和铺垫，chorus 承载 hook、重复、情绪回报，通常更高能量、更厚织体。
3. Pre-chorus 的作用是 build / channel：通过和声、旋律、节奏或编配把 verse 推向 chorus，常见手法包括 subdominant、secondary dominant、harmonic probing、鼓/织体渐密。
4. Bridge / middle eight 的核心是 contrast：打破 verse-chorus 重复，通常换旋律、换织体、换和声重心或降低/重置能量，然后把 final chorus 推得更有回报。
5. 生成系统里，和声不是孤立的 chord list。研究也把 chord progression 看作连接 texture 和 form 的关键结构层；换句话说，和声骨架应该服务段落功能。
6. Lo-fi 可以比 pop 更循环、更克制，但不是“整首一个 loop 无变化”。市面听感通常靠 4/8/16 小节的加减法、滤波、静音、鼓组变化、bass 进出、简单 motif 复现来建立结构。
7. Lo-fi 的典型参数是 70-90 BPM 左右、boom-bap / swung / off-grid 鼓、jazz-influenced 7th/9th/extended chords、Rhodes/piano/warm synth、vinyl/tape/noise 质感。
8. Lo-fi 和声应更多使用 maj7、m7、9th、ii-V-I、平滑声部进行、共同音保留、低密度但有颜色的 voicing。

## 当前实现判断

当前实现已经有结构意识，但还停留在“section role 粗粒度驱动”，还没有达到风格化段落叙事。

### 已经做对的部分

- `formPlanner.ts` 已经有 intro / verse / chorus / bridge / outro 曲式模板。
- `phrasePlanner.ts` 已经把 section 切成 4-bar phrases，并区分 antecedent / consequent / cadence。
- `dynamicsPlanner.ts` 已经有 section-level energy / density，chorus 高于 verse。
- `harmonyEngine.ts` 已经让同 repeatGroup 共享 progression，保证 verse1 / verse2、chorus1 / chorus2 的排比和记忆点。
- `harmonyEngine.ts` 已经把 phrase cadenceTarget 反映到段尾 authentic / half cadence。
- `renderCoordinator.ts` 已经在段落边界加 drum fill，并按 section energy 做 dynamics。
- `instrumentalPlanner.ts` 已经让 intro/outro 偏 pad、verse 偏 arpeggio、chorus 偏 active-comp、bridge 偏 sustained-block。

这些是正确方向。

### 主要不足

#### 1. Pop 缺 pre-chorus，因此缺“推向副歌”的段落坡道

当前 `SectionRole` 只有：

```ts
'intro' | 'verse' | 'chorus' | 'bridge' | 'outro'
```

没有 `preChorus` / `postChorus`。这会导致 verse 直接跳到 chorus，虽然能听出强弱，但少了现代 pop 常见的 build 功能。

应补：

- `preChorus`: 4 或 8 bars，energy 从 verse 到 chorus 之间。
- `postChorus`: 可选，保持或略增 sonic energy，承担 instrumental hook。
- final chorus: 不是普通 chorus copy，应有 climax flag 或 final repeat strategy。

#### 2. Lo-fi 不应该完全套 pop verse-chorus 逻辑

当前 lo-fi 也会从同一个 `FORM_POOL` 里选 pop-like 模板。lo-fi 可以有 verse/chorus 标签，但实际听感更像：

- intro loop
- A section
- A2 variation
- B / hook / drop
- breakdown / bridge
- final A/B
- outro fade

它的结构感更多来自“层次加减”和“loop mutation”，不是强烈的副歌爆发。

应补 style-specific form profile：

- pop 使用 `verse-pre-chorus-chorus` 型。
- lo-fi 使用 `loop-variation` 型，可映射为 intro / verseA / hookB / breakdown / return / outro，但内部字段要表达 layer changes。

#### 3. 当前 energy 是 per-section 常数，没有段内曲线

`dynamicsPlanner.ts` 目前只给每个 section 一个 energy 标量：

```ts
verse = 0.6
chorus = 0.9
bridge = 0.7
```

这会造成同一段内部没有起伏。真实音乐需要：

- verse 前半留白，后半略加元素。
- pre-chorus 逐小节 build。
- chorus 第 1 小节 drop，第 4/8 小节响应或 fill。
- bridge reset 或 contrast。
- final chorus 比前面 chorus 更满。

应新增 `energyCurveByBar` / `densityCurveByBar`，至少 bar-level。

#### 4. Phrase role 太机械

当前 `phraseRoleAt` 只按 slot 奇偶：

```ts
slot even => antecedent
slot odd => consequent
last => cadence
```

这对 8-bar 段落的 4+4 问答是对的，但不够表达：

- pre-chorus build phrase
- chorus hook phrase / post-hook answer
- bridge contrast phrase
- lo-fi A1/A2 的微变化 phrase
- 4-bar section 的 fill/link

应新增 `PhraseFunction`，不要只靠 `PhraseRole`：

```ts
type PhraseFunction =
  | 'setup'
  | 'answer'
  | 'build'
  | 'hook'
  | 'postHook'
  | 'breakdown'
  | 'return'
  | 'cadence'
  | 'turnaround';
```

#### 5. Chorus 全句都是 hook，容易变得“过满”

当前：

```ts
if (section.role === 'chorus') return 'hook';
```

这会让 chorus 里每个 phrase 都是 hook source。更合理的是：

- chorus phrase 0: main hook
- chorus phrase 1: answer / postHook / cadence
- final chorus phrase 0: main hook strong restatement
- final chorus phrase 1: adlib / high variation / final cadence

Hook 应该是“重点位置”，不是整个 chorus 都同等强度。

#### 6. 和声候选太少，且不区分 pop / lo-fi

当前 `progressions.ts` 是 role-based：

```ts
verse: [[1,6,4,5], [2,5,1,6]]
chorus: [[1,5,6,4], [4,5,1,1]]
bridge: [[6,4,1,5]]
```

这对 pop 是最小可用，但：

- pop 需要 pre-chorus progression pool，如 `IV-V-vi-V`、`ii-IV-V-V`、`vi-IV-V-V`、`ii-V/V-V`。
- pop chorus 可以和 verse 同进行，但需要更强 hook / rhythm / register / density。
- lo-fi 需要 maj7/m7/9th/ii-V-I/iv/borrowed color/common-tone loop，而不是只有 degree list + diatonic 7th。

应拆成：

```ts
StyleProgressionProfile {
  style: 'pop' | 'lofi';
  sectionRole: SectionRole;
  phraseFunction?: PhraseFunction;
  candidates: ProgressionCandidate[];
  harmonicRhythmPolicy: ...
  cadencePolicy: ...
  colorPolicy: ...
}
```

#### 7. Chorus 一律 2 chords/bar 不适合所有风格

当前：

```ts
chordsPerBarBySection[chorus] = 2
else = 1
```

这对某些 pop chorus 能制造推动，但对 lo-fi 往往太忙。lo-fi 常见更慢和声节奏，靠 groove、纹理、滤波、旋律 motif 变化保持运动。

应改成 style-aware：

- pop chorus: 1 或 2 chords/bar，按 energy 选。
- pop pre-chorus: 后半可加密。
- lo-fi: 多数 0.5-1 chords/bar；B/hook 可增强 voicing/color，而不是必然加速。

#### 8. Lo-fi feel 目前太直

`timePlanner.ts` 里：

```ts
lofi: feel.kind = 'straight', swingRatio = 0.5
```

这和市面 lo-fi 的 swung/off-grid/lazy beat 不吻合。可以不是 jazz swing，但至少应有：

- swingRatio: 0.55-0.62
- snare/hat late offset
- kick slightly ahead or relaxed
- velocity variation 比 pop 更大、更柔

#### 9. 编配织体还只是 section-role 映射，没有“段落起伏”

当前：

```ts
intro -> pad
verse -> arpeggio
chorus -> active-comp
bridge -> sustained-block
outro -> pad
```

这是好的起点，但不够细：

- verse1 和 verse2 应有同骨架不同层次。
- chorus2 应比 chorus1 多一个 layer 或更宽 voicing。
- bridge 应 contrast，不一定只是 sustained-block。
- final chorus 应有最高密度或最高 register。
- lo-fi 应通过 mute/unmute layers、filter、dust/noise、wide color motion 建立段落，而不是强 active-comp。

## 应新增的核心抽象

### 1. StyleFormProfile

把 form 从通用模板改成风格可选：

```ts
interface StyleFormProfile {
  style: 'pop' | 'lofi';
  templates: FormTemplateSpec[];
  defaultPhraseBars: 4 | 8;
  sectionLengthRange: Record<SectionRole, readonly number[]>;
  allowPreChorus: boolean;
  allowPostChorus: boolean;
  climaxPolicy: ClimaxPolicy;
}
```

Pop 推荐模板：

```text
intro 4
verse1 8
preChorus1 4
chorus1 8
verse2 8
preChorus2 4
chorus2 8
bridge 8
finalChorus 8
outro 4
```

Lo-fi 推荐模板：

```text
intro 4/8
loopA 8/16
loopA_variation 8/16
hookB 8
breakdown 4/8
returnA 8
outro 4/8
```

如果内部必须沿用 `SectionRole`，可先用：

- loopA -> verse
- hookB -> chorus
- breakdown -> bridge
- returnA -> verse 或 chorus

但要新增 `sectionFunction`，不要只靠 `role`。

### 2. SectionFunction

新增比 `role` 更细的段落功能：

```ts
type SectionFunction =
  | 'introEstablish'
  | 'verseSetup'
  | 'preChorusBuild'
  | 'chorusPayoff'
  | 'postChorusHook'
  | 'bridgeContrast'
  | 'breakdownReset'
  | 'finalChorusClimax'
  | 'outroRelease'
  | 'lofiLoopA'
  | 'lofiLoopVariation'
  | 'lofiHookB'
  | 'lofiReturn';
```

它应该进入 `Section` 或建立 `sectionFunctionById`。

### 3. Bar-level Arrangement Curve

新增：

```ts
interface BarShape {
  barIndex: number;
  sectionId: SectionId;
  phraseId?: PhraseId;
  energy: number;
  density: number;
  harmonicRhythm: number;
  textureIntensity: number;
  fillIntensity: number;
  layerMask: Partial<Record<InstrumentRoleName, boolean>>;
}
```

用途：

- Harmony 读取 `harmonicRhythm`。
- Instrumentation 读取 `layerMask` 和 `textureIntensity`。
- DrumRenderer 读取 `fillIntensity`。
- Dynamics 读取 bar energy，而不是只读 section energy。

### 4. StyleProgressionProfile

把 progression 从 role 表升级为 style + function 表。

Pop 示例：

```text
verseSetup:
  I-vi-IV-V
  vi-IV-I-V
  I-V-vi-IV

preChorusBuild:
  IV-V-vi-V
  ii-IV-V-V
  ii-V/V-V-V

chorusPayoff:
  I-V-vi-IV
  IV-I-V-vi
  vi-IV-I-V

bridgeContrast:
  vi-IV-I-V
  ii-vi-IV-V
```

Lo-fi 示例：

```text
lofiLoopA:
  Imaj7-vi7-IVmaj7-V7
  ii7-V7-Imaj7-vi7
  IVmaj7-iii7-vi7-ii7

lofiLoopVariation:
  Imaj9-vi9-IVmaj9-V13
  ii9-V13-Imaj9-vi9

lofiHookB:
  IVmaj7-V7-iii7-vi7
  ii7-V7-Imaj7-Imaj7

breakdownReset:
  Imaj7 / vi7 vamp
  IVmaj7 / Imaj7 pedal
```

注意：lo-fi 这里要支持 chord type，不只是 diatonic degree + narrow quality。

### 5. TextureArcProfile

新增风格化织体弧线，而不是 `role -> textureKind` 一张表。

Pop 织体原则：

- verse: 少鼓/少低频/较薄 comp，给 vocal 或 lead 留空间。
- pre-chorus: hats/riser/bass motion/和声节奏逐渐增强。
- chorus: full drums + bass + active comp + higher register hook。
- bridge: 降低或换音色，制造 contrast。
- final chorus: chorus + extra layer / octave / wider voicing。

Lo-fi 织体原则：

- intro: vinyl/noise/pad/chord sample 先建立房间感。
- loopA: drums + warm chord + simple bass。
- A variation: 加 sparse motif / answer chord / offbeat hit。
- hookB: 加 lead motif 或更宽 voicing，但不要过爆。
- breakdown: 去鼓或低通，只留 chord/noise。
- return: drums 回来，短 fill 或 reverse cymbal。
- outro: fade，减 bass/drum。

建议：

```ts
interface TextureArcProfile {
  style: string;
  sectionFunction: SectionFunction;
  phraseFunction?: PhraseFunction;
  preferredTextures: TextureCaseId[];
  layerPolicy: LayerPolicy;
  registerPolicy: RegisterPolicy;
  transitionPolicy: TransitionPolicy;
}
```

## 具体改造计划

### Phase 1: 扩展 ArrangementPlan 契约

修改：

- `src/core/generation/newEngine/arranger/ArrangementPlan.ts`

新增：

- `preChorus`、`postChorus` 可选 section role，或保持 role 不变但新增 `sectionFunction`。
- `sectionFunctionById`
- `barShapePlan`
- `phraseFunction`。

验收：

- 不破坏已有测试。
- old templates 仍能转成默认 `sectionFunction`。

### Phase 2: Style-aware FormPlanner

修改：

- `src/core/generation/newEngine/arranger/formPlanner.ts`

新增：

- `STYLE_FORM_PROFILES`
- pop form pool
- lo-fi form pool
- final chorus / climax section 标记

验收：

- pop seeds 能产生含 pre-chorus 的结构。
- lo-fi seeds 能产生 loop-variation / breakdown / return 结构。
- compact 模板保留给短 demo。

### Phase 3: Bar-level DynamicsPlanner

修改：

- `src/core/generation/newEngine/arranger/dynamicsPlanner.ts`

新增：

- `energyCurveByBar`
- `densityCurveByBar`
- `fillIntensityByBar`
- `layerMaskByBar`

验收：

- pre-chorus energy 逐 bar 上升。
- final chorus energy >= previous chorus。
- lo-fi 每 4 或 8 小节有 layer change。

### Phase 4: PhrasePlanner 功能化

修改：

- `src/core/generation/newEngine/arranger/phrasePlanner.ts`

新增 phrase function mapping：

- pop verse: setup / answer / cadence
- pop pre-chorus: build / build / cadence
- pop chorus: hook / postHook / cadence
- bridge: contrast / return
- lo-fi: loopStatement / loopMutation / hookMotif / breakdown / return

验收：

- chorus 不再每个 phrase 都是 hook。
- hookAnchorSlots 只锁真正 hook head。
- verse motif 可复现，但不抢 chorus 主 hook。

### Phase 5: StyleProgressionProfile

修改：

- `src/core/generation/newEngine/knowledge/progressions.ts`
- `src/core/generation/newEngine/harmony/harmonyEngine.ts`

新增：

- style + sectionFunction + phraseFunction progression candidates。
- pre-chorus build progression。
- lo-fi extended chord progression。
- harmonic rhythm policy 按 style/function，而不是 chorus 一律 2 chords/bar。

验收：

- pop pre-chorus 段尾能准备 chorus arrival。
- pop chorus 有 payoff cadence 或 tonic prolongation。
- lo-fi 使用 7th/9th/maj7/m7/ii-V-I/common-tone loop。
- lo-fi chorus/hook 不被强制 2 chords/bar。

### Phase 6: TextureArcProfile 与 Render 消费

修改：

- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`
- `src/core/generation/newEngine/render/renderCoordinator.ts`
- `src/core/generation/newEngine/render/accompanimentRenderer.ts`
- `src/core/generation/newEngine/render/drumRenderer.ts`
- `src/core/generation/newEngine/render/bassRenderer.ts`

新增：

- 按 `barShapePlan` 控制 layers。
- 按 `textureIntensity` 控制 comp/pad/arp 密度。
- 按 `fillIntensity` 控制 fill 类型。
- lo-fi late/off-grid/humanized groove。
- pop pre-chorus build 的 hat/riser/fill/bass activity。

验收：

- 同一和声 loop 下，verse/chorus/bridge 仍能通过编配听出段落。
- lo-fi 每 4/8 小节至少有一次 layer/texture/motif 微变化。
- pop pre-chorus 到 chorus 有明确 build/drop。

### Phase 7: Auditor 新增结构感审计

新增结构审计规则：

- `FORM_HAS_STYLE_REQUIRED_SECTIONS`
- `SECTION_ENERGY_CONTRAST`
- `PRECHORUS_BUILDS_TO_CHORUS`
- `CHORUS_HAS_HOOK_AND_PAYOFF`
- `BRIDGE_CONTRASTS`
- `FINAL_CHORUS_IS_CLIMAX`
- `LOFI_HAS_LOOP_VARIATION`
- `LOFI_NOT_OVER_DENSE`
- `TEXTURE_CHANGES_AT_SECTION_BOUNDARIES`

验收：

- audit report 能说明“为什么听起来没有段落感”。
- `GenerationController` 可据此 warning / fail / render retry。
- retry 只能调 render/texture/melody，不回改已冻结和声骨架，除非架构另行允许。

## 最终判断

当前 newEngine 的方向是对的：它已经把 form、phrase、energy、harmony、instrumentation 分层，并且有 repeatGroup 和 cadenceTarget，这是“结构感”的地基。

但它还不够像市面上的 lo-fi / pop：

- 对 pop：缺 pre-chorus build、post/final chorus 逻辑、段内能量坡道。
- 对 lo-fi：太套通用 verse/chorus，缺 swung/off-grid feel、extended chord language、loop variation、layer add/subtract。
- 对和声骨架：现在能按段落换 progression，但还没有按 section function / phrase function 设计“铺垫-推升-释放-对比-回归”。
- 对编配：现在能按段落换 texture，但还没有 bar-level layer arc，因此段落起伏容易只是“换名字”，不是“听得出来”。

正确改造方向不是简单加更多 progression 模板，而是增加：

1. style-specific form profile
2. sectionFunction / phraseFunction
3. bar-level energy-density-layer curve
4. style/function-aware progression profile
5. texture arc profile
6. structure auditor

这样贴和声骨架时，和声会知道自己是在铺垫、拉升、释放还是对比；编配时，render 层也会知道每一小节该加、该减、该留白、该爆发。结构感会从“段落名字”变成真实可听的音乐形态。
