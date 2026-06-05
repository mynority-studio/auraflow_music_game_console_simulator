# Instrumentation Combination Rules for Q+N

本文档针对当前 `newEngine` 的器配层做乐器组合分类。目标不是让系统变成完整自动配器大师,
而是让 `InstrumentationPlanner` 能理解:

- 哪些乐器放在一起自然。
- 电声、原声、合成乐器怎么组合不违和。
- 大钢琴应该搭配什么 bass / drum / pad。
- 当前 GM program 候选应该如何分组、约束和重选。

## Current Code Reality

当前代码里的角色只有五类:

```ts
export type InstrumentRoleName = 'bass' | 'comp' | 'pad' | 'lead' | 'drum';
```

当前 `knowledge/instruments.ts` 已经做了两件事:

1. 选 lineup:哪些乐手出现。
2. 选 roleProgram:每个角色用什么 GM program。

但从职责上看,第 2 件事更像器配层的工作。`BandEngine` 应该决定“有什么乐手”,
`InstrumentationPlanner` 应该决定“这些乐手具体拿什么乐器、能不能搭”。

为兼容当前代码,短期不强行迁移字段:

- `BandSpec.roleProgram` 继续存在。
- `InstrumentationPlanner` 可以把它视为 provisional program。
- 器配层根据本规则修正或重选 `programByRoleSection`。

## Research Anchors

这些资料只用于建立稳定配器常识:

- [Berklee Online: Arranging 1, Rhythm Section](https://online.berklee.edu/courses/arranging-1-rhythm-section):
  rhythm section 的核心是 drums、bass、guitar/keyboards 的组合与 groove。
- [LiveAbout: What Is a Rhythm Section?](https://www.liveabout.com/what-is-a-rhythm-section-2456822):
  contemporary groove music 常见 rhythm section 由 drumbeat、bass、chord comping 组成,
  comping 常由 guitar 或 piano/keyboard 承担。
- [Rhythm Section overview](https://everything.explained.today/%5C/rhythm_section/):
  bass 可是 double bass、electric bass 或 synth bass; keyboard 可是 piano、electric piano、
  organ、synth,具体取决于 style。
- [Jazz Piano Comping Guide](https://jazz-library.com/articles/comping/):
  jazz comping 的职责是支撑 chord changes、rhythmic style,并 complement 旋律/soloist。
- [The Jazz Piano Site: How to Comp](https://www.thejazzpianosite.com/jazz-piano-lessons/jazz-chord-voicings/how-to-comp/?amp=1):
  jazz comping 需要 rhythm variety;与 walking bass/rootless chords 共同形成 rhythm section。
- [Jazz trio overview](https://www.melodigging.com/genre/jazz-trio):
  piano trio 常见配置是 piano、double bass、drums;chordal instrument、bass、drums 各自负责
  harmony/texture、time/voice-leading、time feel/form cues。
- [Lofi Chill reference](https://en.audiocrowd.net/tracks/3927-lofi-chill):
  lofi/chillhop 常见 soft electronic drums、vinyl noise、piano chords、bass guitar、
  clean guitar、smooth electric piano。
- [Lo-Fi Rhodes sample pack reference](https://lofi-sounds.com/products/melancholic-rhodes):
  Rhodes / electric piano 是 lofi 里非常稳定的 mellow harmonic color。

## Current Instrument Catalog

当前候选 GM programs:

| GM | Name | Current Roles | Source Class | Timbre Class |
| --- | --- | --- | --- | --- |
| 0 | 大钢琴 | comp, lead | acoustic | acoustic-keyboard |
| 1 | 亮钢琴 | comp, lead | acoustic | bright-keyboard |
| 4 | 电钢 Rhodes | comp, lead | electro-acoustic | warm-electric-keyboard |
| 5 | 电钢 FM | comp, lead | digital-electric | bright-electric-keyboard |
| 8 | Celesta | lead | acoustic/mechanical | high-keyboard |
| 11 | 颤音琴 | lead | acoustic/mallet | bell-mallet |
| 12 | 马林巴 | lead | acoustic/mallet | wood-mallet |
| 32 | 立式贝斯 | bass | acoustic | upright-bass |
| 33 | 指弹贝斯 | bass | electric | organic-electric-bass |
| 38 | 合成贝斯1 | bass | synthetic | synth-bass |
| 39 | 合成贝斯2 | bass | synthetic | soft-synth-bass |
| 48 | 弦乐合奏1 | pad | acoustic-sampled | string-pad |
| 49 | 弦乐合奏2 | pad | acoustic-sampled | string-pad |
| 50 | 合成弦乐1 | pad | synthetic | synth-string-pad |
| 89 | 暖 Pad | pad | synthetic | warm-pad |
| 91 | 合唱 Pad | pad | synthetic | choir-pad |
| drum 0 | GM Drum Kit | drum | acoustic/electronic by style | drum-kit |

## Timbre Worlds

器配层先选择一个 `timbreWorld`,再在其中挑乐器。这样比逐个 role 随机更稳定。

```ts
export type TimbreWorld =
  | 'acousticTrio'
  | 'hybridPop'
  | 'electricKeys'
  | 'lofiTape'
  | 'syntheticSoft'
  | 'jazzCombo';
```

### acousticTrio

Core:

- comp: 大钢琴 / 亮钢琴
- bass: 立式贝斯 或 指弹贝斯
- drum: drum kit
- pad: 弦乐合奏可选,暖 Pad 谨慎

Good for:

- jazz
- pop ballad
- modal / chill

Avoid:

- 合成贝斯 + 大钢琴 + 大弦乐同时出现。
- Celesta / vibraphone 再叠很亮的钢琴高音。

### hybridPop

Core:

- comp: 亮钢琴 或 Rhodes
- bass: 指弹贝斯 或 合成贝斯1
- drum: drum kit
- pad: 暖 Pad / 合成弦乐 / 弦乐合奏

Good for:

- pop
- pop/R&B crossover

Avoid:

- upright bass + heavy synth pad + synth bass 的身份混乱。

### electricKeys

Core:

- comp: Rhodes 或 FM EP
- bass: 指弹贝斯 / 合成贝斯2
- drum: drum kit
- pad: 暖 Pad / 合唱 Pad

Good for:

- rnb
- neo-soul
- lofi

Avoid:

- comp 和 lead 同时都是 Rhodes,除非 lead 只是 ghost motif。
- FM EP + Celesta + bright piano 同时出现,高频会显薄。

### lofiTape

Core:

- comp: Rhodes / FM EP
- lead: Rhodes / 颤音琴 / 马林巴
- bass: 指弹贝斯 / 合成贝斯2
- pad: 暖 Pad / 合唱 Pad
- drum: soft drum template

Good for:

- lofi
- chillhop

Avoid:

- 亮钢琴作为主 comp。
- 大弦乐 pad 太满。
- lead 和 comp 都选择同一个 Rhodes program。

### syntheticSoft

Core:

- comp: FM EP / Rhodes
- bass: 合成贝斯1 / 合成贝斯2
- pad: 暖 Pad / 合成弦乐 / 合唱 Pad
- drum: pop/rnb/lofi style drum kit

Good for:

- modern pop
- rnb
- lofi electronic variant

Avoid:

- 立式贝斯。
- 大钢琴 full comp,除非只是 intro/bridge 少量出现。

### jazzCombo

Core:

- comp: 大钢琴 / Rhodes
- bass: 立式贝斯
- drum: jazz drum template
- lead: 颤音琴 / Rhodes / 马林巴
- pad: 默认 off;只在 chill/ballad intro/outro 使用弦乐合奏2

Good for:

- jazz

Avoid:

- synth bass。
- warm/choir pad 常驻。
- lead/comp 同 program。

## Program Compatibility Matrix

### Comp To Bass

| Comp | Best Bass | Allowed Bass | Avoid Bass |
| --- | --- | --- | --- |
| 大钢琴 GM0 | 立式贝斯 GM32 | 指弹贝斯 GM33 | 合成贝斯 GM38/39 unless hybrid pop |
| 亮钢琴 GM1 | 指弹贝斯 GM33 | 合成贝斯 GM38,立式 GM32 | - |
| Rhodes GM4 | 指弹贝斯 GM33,合成贝斯2 GM39 | 立式 GM32,合成贝斯1 GM38 | - |
| FM EP GM5 | 合成贝斯2 GM39,指弹 GM33 | 合成贝斯1 GM38 | 立式 GM32 |

### Comp To Pad

| Comp | Best Pad | Allowed Pad | Avoid/Limit |
| --- | --- | --- | --- |
| 大钢琴 GM0 | 弦乐 GM48/49 | 暖 Pad GM89 | 合唱 Pad full sustain |
| 亮钢琴 GM1 | 暖 Pad GM89,合成弦 GM50 | 弦乐 GM48/49 | 过亮 Celesta lead + choir pad |
| Rhodes GM4 | 暖 Pad GM89,合唱 Pad GM91 | 弦乐 GM49 | 大弦乐 full range |
| FM EP GM5 | 暖 Pad GM89,合成弦 GM50,合唱 Pad GM91 | - | acoustic strings as main pad |

### Lead To Comp

| Lead | Best Comp | Avoid |
| --- | --- | --- |
| 大钢琴 GM0 | Rhodes GM4,弦乐/pad support | 大钢琴 GM0 as comp |
| 亮钢琴 GM1 | Rhodes GM4/FM GM5 | 亮钢琴 GM1 as comp |
| Rhodes GM4 | 大钢琴 GM0/亮钢琴 GM1/FM GM5 | Rhodes GM4 as comp |
| FM EP GM5 | Rhodes GM4/亮钢琴 GM1 | FM GM5 as comp |
| 颤音琴 GM11 | 大钢琴 GM0/Rhodes GM4 | Celesta GM8 + choir pad heavy |
| 马林巴 GM12 | Rhodes GM4/大钢琴 GM0 | bright piano high comp |
| Celesta GM8 | 暖 Pad GM89/大钢琴 sparse | bright piano/Rhodes busy comp |

### Bass To Pad

| Bass | Best Pad | Avoid |
| --- | --- | --- |
| 立式贝斯 GM32 | 弦乐 GM49,low warm pad | choir pad + synth strings heavy |
| 指弹贝斯 GM33 | 暖 Pad GM89,弦乐 GM48/49 | - |
| 合成贝斯1 GM38 | 暖 Pad GM89,合成弦 GM50 | acoustic string ensemble as main identity |
| 合成贝斯2 GM39 | 暖 Pad GM89,合唱 Pad GM91 | upright/acoustic jazz world |

## Style Instrument Packs

这些 pack 是当前四风格最小可用的组合池。器配层可以先选 pack,再从 pack 内按 seed 选具体 program。

### Pop

Preferred worlds:

- `hybridPop`
- `syntheticSoft`
- `acousticTrio` for ballad

Packs:

```ts
pop_piano_band = {
  lead: [1, 4, 12],
  comp: [1, 4],
  bass: [33],
  pad: [89, 50, 48],
  drum: [0]
}

pop_modern_synth_bass = {
  lead: [1, 4],
  comp: [1, 4, 5],
  bass: [38, 39],
  pad: [89, 50],
  drum: [0]
}

pop_ballad_acoustic = {
  lead: [0, 11, 12],
  comp: [0, 4],
  bass: [32, 33],
  pad: [48, 49],
  drum: [0]
}
```

Rules:

- 大钢琴 comp 优先搭 32/33,不要默认搭 38/39。
- 亮钢琴可搭 33/38,更现代。
- final hook 可以换 pad 或 lead octave,不要换到完全不同乐器身份。

### RNB

Preferred worlds:

- `electricKeys`
- `syntheticSoft`

Packs:

```ts
rnb_rhodes_finger_bass = {
  lead: [4, 11],
  comp: [4, 5],
  bass: [33],
  pad: [89, 91],
  drum: [0]
}

rnb_fm_synth_bass = {
  lead: [4, 5, 11],
  comp: [5, 4],
  bass: [39, 33],
  pad: [89, 91],
  drum: [0]
}
```

Rules:

- Rhodes/FM 是核心,不要把大钢琴作为默认 comp。
- Finger bass 更 organic; synth bass 更 modern。
- Pad 只做 glue,不应抢 Rhodes。
- lead 与 comp 不要同 program。

### Lofi

Preferred worlds:

- `lofiTape`
- `electricKeys`

Packs:

```ts
lofi_rhodes_vibe = {
  lead: [11, 12, 4],
  comp: [4, 5],
  bass: [33, 39],
  pad: [89, 91],
  drum: [0]
}

lofi_soft_keys = {
  lead: [4, 11],
  comp: [5, 4],
  bass: [39, 33],
  pad: [89],
  drum: [0]
}
```

Rules:

- Rhodes/FM 是最安全 comp。
- Vibraphone/marimba 做 lead 很合适。
- 合唱 pad 可用,但要低密度。
- bright piano 不进默认池。

### Jazz

Preferred worlds:

- `jazzCombo`
- `acousticTrio`

Packs:

```ts
jazz_piano_trio = {
  lead: [11, 4, 12],
  comp: [0, 4],
  bass: [32],
  pad: [],
  drum: [0]
}

jazz_chill_ballad = {
  lead: [11, 12, 4],
  comp: [0, 4],
  bass: [32],
  pad: [49],
  drum: [0]
}
```

Rules:

- Upright bass 是 jazz 默认。
- Pad 默认 off;只在 intro/outro/ballad-like sections 开。
- Grand piano + upright bass + drums 是最稳的核心。
- Rhodes 可以作为 chill jazz / neo-soul crossover 色彩。
- synth bass 不进入 jazz 默认池。

## Selection Algorithm

器配层建议使用一个很小的评分器,不要做复杂推理。

### Step 1: choose timbreWorld

```ts
const world = pickWorld(style, seed, mood);
```

Recommended weights:

| Style | Worlds |
| --- | --- |
| pop | hybridPop 0.55, syntheticSoft 0.25, acousticTrio 0.20 |
| rnb | electricKeys 0.70, syntheticSoft 0.30 |
| lofi | lofiTape 0.75, electricKeys 0.25 |
| jazz | jazzCombo 0.80, acousticTrio 0.20 |

### Step 2: choose comp first

Comp defines the harmonic color.

Priority:

1. Choose comp from world/style pack.
2. Choose bass compatible with comp.
3. Choose lead that is not same program as comp.
4. Choose pad only if compatible with comp+bass.
5. Drum remains role-level for now; actual drum feel is style renderer/KB.

### Step 3: score candidates

```ts
score =
  styleWeight
  + worldFit
  + compBassCompatibility
  + compPadCompatibility
  + leadContrast
  - duplicateProgramPenalty
  - acousticSyntheticMismatchPenalty
  - brightnessClashPenalty;
```

Hard penalties:

- `leadProgram === compProgram`: reject unless lead is ghost-only.
- `style === 'jazz' && bass in [38, 39]`: reject.
- `style === 'lofi' && comp === brightPiano`: reject by default.
- `comp === grandPiano && bass is synthBass`: penalize unless world is `hybridPop`.
- `pad === choirPad && lead is celesta/vibraphone`: penalize for high shimmer stacking.

## Minimal Contract Change

Do not add a big instrumentation protocol.

Add one optional field to `InstrumentationPlanData`:

```ts
export interface InstrumentationPlanData {
  // existing fields...
  timbreWorld?: TimbreWorld;
  instrumentationPackId?: string;
}
```

Then let current `programByRoleSection` continue to carry actual GM programs.

## Migration Plan

### Phase 1: Move Program Choice Into Instrumental Planner

Files:

- `src/core/generation/newEngine/knowledge/instruments.ts`
- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`
- `src/core/generation/newEngine/band/bandEngine.ts`

Changes:

1. Keep `pickBandInstrumentation` compatible for now.
2. Add pure data tables: `TimbreWorld`, `InstrumentPack`, compatibility matrix.
3. `buildInstrumentationPlan` scores `band.roleProgram` and can replace bad combinations.
4. Trace prints `timbreWorld` and pack id.

Acceptance:

- Jazz never selects synth bass.
- RNB prefers Rhodes/FM + finger/synth bass + warm/choir pad.
- Lofi never starts from bright piano comp.
- Pop grand piano prefers upright/finger bass instead of synth bass.
- Lead and comp do not use the same GM program.

### Phase 2: Style Pack Selection

Changes:

1. For each style, choose one pack before selecting role programs.
2. Pack respects current lineup:if a role is absent, skip it.
3. Optional pad/drum still follows existing lineup probability.

Acceptance:

- Same seed/style produces deterministic pack.
- Different seeds produce different but coherent timbre worlds.
- Program changes remain same-family only.

### Phase 3: Section-Level Timbre Variation

Keep the current idea:only comp/lead may switch same-family program in stronger sections.

Rules:

- Switch only one role per song.
- Switch only within same family.
- Do not switch physical mallet instruments as if they were effects.
- Do not change bass identity mid-song yet.

Acceptance:

- Rhodes -> FM or piano -> bright piano allowed.
- Vibraphone -> marimba not used as a casual chorus switch.
- Upright -> synth bass never happens mid-song.

## Minimum Audible Cut

The smallest useful implementation:

1. Add instrument metadata: source class, timbre class, brightness, acousticness.
2. Add style packs.
3. In `InstrumentationPlanner`, validate and repair `band.roleProgram`.
4. Prevent same-program lead/comp.
5. Prevent obvious style mismatches: jazz synth bass, lofi bright piano comp, grand piano + synth bass unless hybrid pop.

This is enough for the器配层 to make musical choices without making the engine complex.
