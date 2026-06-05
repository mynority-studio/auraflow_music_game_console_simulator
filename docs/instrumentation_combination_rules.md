# Instrumentation Combination Rules for Q+N

本文档针对当前 `newEngine` 的器配层做乐器组合分类。

本版只解决一个问题:

```text
这些乐器放在一起像不像同一个风格世界里的 band?
```

它不解决:

- lead 和 comp 如何避让。
- 同乐器双轨如何分音区。
- 钢琴右手旋律、左手织体如何拆分。
- comp 在旋律下如何降密度。
- pad 与 lead 的频段冲突。

这些属于已有避让/织体/render 规则,不放在器配层里。

## Current Code Reality

当前 Q+N 的角色只有五类:

```ts
export type InstrumentRoleName = 'bass' | 'comp' | 'pad' | 'lead' | 'drum';
```

当前 `knowledge/instruments.ts` 同时做了两件事:

1. 选乐手 lineup:哪些角色出现。
2. 选具体 GM program:这些角色拿什么乐器。

从职责上看,第 1 件事可以留给 `BandEngine`;第 2 件事更适合由
`InstrumentationPlanner` 根据风格和组合规则修正。

短期兼容策略:

- `BandSpec.roleProgram` 继续存在。
- `InstrumentationPlanner` 把它当作 provisional program。
- 器配层只做风格组合修正,不做同乐器互抢判定。

## Key Principle

同一种乐器可以同时承担多个角色。

尤其钢琴:

- 可以做 lead。
- 可以做 comp。
- 可以同时承担旋律、和声、低音支撑。
- 两个钢琴声部也可以成立。

因此器配层不因为下面这种情况直接 reject:

```ts
leadProgram === compProgram
```

如果 lead 和 comp 使用同一个 GM program,器配层最多打一个观察标记:

```ts
sameInstrumentPair: true
```

这个标记只供后续避让层参考,不阻断器配。

## Current Instrument Library

当前可用 GM program:

| GM | Name | Family | Source | Best Roles |
| --- | --- | --- | --- | --- |
| 0 | 大钢琴 | keyboard | acoustic | comp, lead |
| 1 | 亮钢琴 | keyboard | acoustic-bright | pop comp, lead |
| 4 | Rhodes 电钢 | keyboard | electro-acoustic | rnb/lofi comp, lead |
| 5 | FM 电钢 | keyboard | digital-electric | rnb/lofi comp |
| 8 | Celesta | keyboard | acoustic/mechanical | modal/ambient lead |
| 11 | 颤音琴 | mallet | acoustic | jazz/lofi lead |
| 12 | 马林巴 | mallet | acoustic | jazz/lofi/pop lead |
| 32 | 立式贝斯 | bass | acoustic | jazz/acoustic bass |
| 33 | 指弹贝斯 | bass | electric-organic | pop/rnb/lofi bass |
| 38 | 合成贝斯1 | bass | synth | modern pop bass |
| 39 | 合成贝斯2 | bass | synth-soft | rnb/lofi bass |
| 48 | 弦乐合奏1 | pad | acoustic-sampled | pop/jazz ballad pad |
| 49 | 弦乐合奏2 | pad | acoustic-sampled | jazz/modal soft pad |
| 50 | 合成弦乐1 | pad | synth-string | pop pad |
| 89 | 暖 Pad | pad | synth-warm | pop/rnb/lofi pad |
| 91 | 合唱 Pad | pad | synth-choir | rnb/lofi/modal pad |
| drum 0 | GM Drum Kit | drum | style-dependent | all styles |

## Timbre Worlds

器配层先选一个 `timbreWorld`,再从这个世界里挑具体 program。

```ts
export type TimbreWorld =
  | 'acousticPianoBand'
  | 'brightPopHybrid'
  | 'electricKeys'
  | 'lofiTapeKeys'
  | 'jazzCombo'
  | 'modalAmbient'
  | 'syntheticSoft';
```

### acousticPianoBand

核心听感:原声钢琴、小型 rhythm section、自然暖。

Recommended:

- comp: 大钢琴 GM0 / 亮钢琴 GM1
- lead: 大钢琴 GM0 / 颤音琴 GM11 / 马林巴 GM12
- bass: 立式贝斯 GM32 / 指弹贝斯 GM33
- pad: 弦乐 GM48/49,少量暖 Pad GM89
- drum: GM Drum Kit

Good for:

- pop ballad
- jazz ballad
- modal/chill

Caution:

- 如果用了合成贝斯,这个 world 应该转成 `brightPopHybrid`,不要仍叫 acoustic。

### brightPopHybrid

核心听感:现代流行,钢琴/电钢 + 电贝斯/合成贝斯 + pad。

Recommended:

- comp: 亮钢琴 GM1 / Rhodes GM4 / FM GM5
- lead: 亮钢琴 GM1 / Rhodes GM4 / 马林巴 GM12
- bass: 指弹贝斯 GM33 / 合成贝斯1 GM38
- pad: 暖 Pad GM89 / 合成弦 GM50 / 弦乐 GM48
- drum: GM Drum Kit

Good for:

- pop
- pop/R&B crossover

Caution:

- 大钢琴 + 合成贝斯可以成立,但应视为 hybrid pop,不是 acoustic trio。

### electricKeys

核心听感:Rhodes/FM 电钢主导,适合 R&B / Neo-Soul。

Recommended:

- comp: Rhodes GM4 / FM GM5
- lead: Rhodes GM4 / FM GM5 / 颤音琴 GM11
- bass: 指弹贝斯 GM33 / 合成贝斯2 GM39
- pad: 暖 Pad GM89 / 合唱 Pad GM91
- drum: GM Drum Kit

Good for:

- rnb
- neo-soul
- chill pop

Caution:

- 大钢琴可作为变化色彩,但不要默认替代 Rhodes/FM 的核心位置。

### lofiTapeKeys

核心听感:柔和电钢、短 loop、mallet motif、暖 pad。

Recommended:

- comp: Rhodes GM4 / FM GM5
- lead: 颤音琴 GM11 / 马林巴 GM12 / Rhodes GM4
- bass: 指弹贝斯 GM33 / 合成贝斯2 GM39
- pad: 暖 Pad GM89 / 合唱 Pad GM91
- drum: GM Drum Kit,由 lofi groove 模板决定 soft/dusty feel

Good for:

- lofi
- chillhop

Caution:

- 亮钢琴 GM1 不做默认 comp;如果出现,应是更 pop/bright 的 lofi 子风格。

### jazzCombo

核心听感:钢琴/Rhodes、立式贝斯、鼓、少量旋律乐器。

Recommended:

- comp: 大钢琴 GM0 / Rhodes GM4
- lead: 颤音琴 GM11 / 马林巴 GM12 / Rhodes GM4
- bass: 立式贝斯 GM32
- pad: 默认无;ballad/chill 时可少量弦乐 GM49
- drum: GM Drum Kit,由 jazz groove 模板决定 ride/swing

Good for:

- jazz
- chill jazz

Caution:

- synth bass GM38/39 不进入 jazz 默认世界。
- pad 不常驻。

### modalAmbient

核心听感:静态调式、pad、mallet/celesta 点状旋律。

Recommended:

- lead: 马林巴 GM12 / 颤音琴 GM11 / Celesta GM8
- comp: Rhodes GM4 / 大钢琴 GM0
- bass: 立式贝斯 GM32 / 指弹贝斯 GM33
- pad: 暖 Pad GM89 / 弦乐 GM48/49 / 合唱 Pad GM91
- drum: optional

Good for:

- modal
- ambient/chill

Caution:

- 如果 bass 是合成贝斯,整体更接近 `syntheticSoft`。

### syntheticSoft

核心听感:柔和合成、电钢、合成贝斯、pad。

Recommended:

- comp: FM GM5 / Rhodes GM4
- lead: Rhodes GM4 / Celesta GM8 / 颤音琴 GM11
- bass: 合成贝斯1 GM38 / 合成贝斯2 GM39
- pad: 暖 Pad GM89 / 合成弦 GM50 / 合唱 Pad GM91
- drum: GM Drum Kit

Good for:

- modern pop
- rnb electronic variant
- lofi electronic variant

Caution:

- 立式贝斯不作为默认 bass。

## Compatibility Rules

这些规则只判断“音色世界是否统一”,不判断谁抢谁。

### Comp To Bass

| Comp | Best Bass | Also Works | World |
| --- | --- | --- | --- |
| 大钢琴 GM0 | 立式 GM32,指弹 GM33 | 合成 GM38/39 | acousticPianoBand / brightPopHybrid |
| 亮钢琴 GM1 | 指弹 GM33,合成 GM38 | 立式 GM32 | brightPopHybrid |
| Rhodes GM4 | 指弹 GM33,合成 GM39 | 立式 GM32 | electricKeys / lofiTapeKeys / jazzCombo |
| FM GM5 | 合成 GM39,指弹 GM33 | 合成 GM38 | electricKeys / syntheticSoft |

Notes:

- 大钢琴 + 合成贝斯不是禁用,只是要归入 hybrid/synthetic world。
- Jazz 默认不选合成贝斯。
- Lofi 默认不以亮钢琴做 comp。

### Comp To Pad

| Comp | Best Pad | Also Works |
| --- | --- | --- |
| 大钢琴 GM0 | 弦乐 GM48/49 | 暖 Pad GM89 |
| 亮钢琴 GM1 | 暖 Pad GM89,合成弦 GM50 | 弦乐 GM48/49 |
| Rhodes GM4 | 暖 Pad GM89,合唱 Pad GM91 | 弦乐 GM49 |
| FM GM5 | 暖 Pad GM89,合成弦 GM50,合唱 Pad GM91 | - |

### Lead To Comp

同乐器允许。

| Lead | Natural Comp |
| --- | --- |
| 大钢琴 GM0 | 大钢琴 GM0, Rhodes GM4,弦乐/pad support |
| 亮钢琴 GM1 | 亮钢琴 GM1, Rhodes GM4, FM GM5 |
| Rhodes GM4 | Rhodes GM4, FM GM5,大钢琴 GM0 |
| FM GM5 | FM GM5, Rhodes GM4,亮钢琴 GM1 |
| 颤音琴 GM11 | 大钢琴 GM0, Rhodes GM4,FM GM5 |
| 马林巴 GM12 | Rhodes GM4,大钢琴 GM0,FM GM5 |
| Celesta GM8 | 暖 Pad GM89,大钢琴 GM0,Rhodes GM4 |

If same program:

```ts
sameInstrumentPair = true;
```

That is a marker, not a rejection.

### Bass To Pad

| Bass | Best Pad |
| --- | --- |
| 立式贝斯 GM32 | 弦乐 GM49,低暖 Pad GM89 |
| 指弹贝斯 GM33 | 暖 Pad GM89,弦乐 GM48/49 |
| 合成贝斯1 GM38 | 暖 Pad GM89,合成弦 GM50 |
| 合成贝斯2 GM39 | 暖 Pad GM89,合唱 Pad GM91 |

## Style Packs

这些 pack 是当前四风格最小可用组合池。器配层可以先选 pack,再按 seed 选具体 program。

### Pop

Preferred worlds:

- `brightPopHybrid`
- `syntheticSoft`
- `acousticPianoBand`

```ts
pop_piano_band = {
  lead: [0, 1, 4, 12],
  comp: [0, 1, 4],
  bass: [32, 33],
  pad: [48, 49, 89],
  drum: [0]
}

pop_modern_hybrid = {
  lead: [1, 4, 12],
  comp: [1, 4, 5],
  bass: [33, 38, 39],
  pad: [89, 50],
  drum: [0]
}
```

Rules:

- 大钢琴可以同时 lead/comp。
- 亮钢琴/Rhodes + 指弹/合成贝斯是 pop 安全组合。
- 合成贝斯出现时,world 应偏 modern/hybrid。

### RNB

Preferred worlds:

- `electricKeys`
- `syntheticSoft`

```ts
rnb_rhodes_finger_bass = {
  lead: [4, 5, 11],
  comp: [4, 5],
  bass: [33],
  pad: [89, 91],
  drum: [0]
}

rnb_synth_soft = {
  lead: [4, 5, 11],
  comp: [4, 5],
  bass: [39, 33],
  pad: [89, 91],
  drum: [0]
}
```

Rules:

- Rhodes/FM 是默认和声核心。
- Finger bass 更 organic,synth bass 更 modern。
- 同 Rhodes lead/comp 可以成立,避让交给后续规则。

### Lofi

Preferred worlds:

- `lofiTapeKeys`
- `electricKeys`

```ts
lofi_rhodes_vibe = {
  lead: [11, 12, 4],
  comp: [4, 5],
  bass: [33, 39],
  pad: [89, 91],
  drum: [0]
}

lofi_soft_keys = {
  lead: [4, 11, 12],
  comp: [4, 5],
  bass: [39, 33],
  pad: [89],
  drum: [0]
}
```

Rules:

- Rhodes/FM 是最安全 comp。
- Vibraphone/marimba 做 lead 很自然。
- 亮钢琴不是默认 comp,但不永久禁止。
- 同 Rhodes lead/comp 可以成立。

### Jazz

Preferred worlds:

- `jazzCombo`
- `acousticPianoBand`

```ts
jazz_piano_trio = {
  lead: [0, 11, 12, 4],
  comp: [0, 4],
  bass: [32],
  pad: [],
  drum: [0]
}

jazz_chill_ballad = {
  lead: [11, 12, 4, 0],
  comp: [0, 4],
  bass: [32],
  pad: [49],
  drum: [0]
}
```

Rules:

- Upright bass 是 jazz 默认。
- 大钢琴 + 立式贝斯 + 鼓是最稳核心。
- Rhodes 可作为 chill jazz/crossover 色彩。
- Synth bass 不进入 jazz 默认池。
- Pad 默认 off,只在 ballad/chill intro/outro 少量出现。

## Selection Algorithm

器配层使用小评分器即可。

### Step 1: Choose Timbre World

```ts
const world = pickWorld(style, seed, mood);
```

Suggested weights:

| Style | Worlds |
| --- | --- |
| pop | brightPopHybrid 0.50, syntheticSoft 0.25, acousticPianoBand 0.25 |
| rnb | electricKeys 0.70, syntheticSoft 0.30 |
| lofi | lofiTapeKeys 0.75, electricKeys 0.25 |
| jazz | jazzCombo 0.80, acousticPianoBand 0.20 |
| modal | modalAmbient 0.70, acousticPianoBand 0.20, syntheticSoft 0.10 |

### Step 2: Choose Comp First

Comp 决定和声色彩。

Priority:

1. Choose comp from selected world/style pack.
2. Choose bass compatible with comp and world.
3. Choose lead from same world; same program as comp is allowed.
4. Choose pad if the world supports pad.
5. Drum remains role-level; actual groove stays in KB/render.

### Step 3: Score Candidate Set

```ts
score =
  styleWeight
  + worldFit
  + compBassCompatibility
  + compPadCompatibility
  + leadWorldFit
  + sameInstrumentAllowedBonus
  - acousticSyntheticMismatchPenalty
  - excessiveBrightnessPenalty
  - styleMismatchPenalty;
```

Hard rejects:

- `style === 'jazz' && bass in [38, 39]`
- `style === 'lofi' && comp === 1` by default pack
- `style === 'jazz' && pad in [89, 91]` as full-song default

Not rejects:

- `leadProgram === compProgram`
- piano lead + piano comp
- Rhodes lead + Rhodes comp

These are legal combinations.

## Minimal Contract Change

不要新增复杂协议。

只建议给 `InstrumentationPlanData` 增加观测字段:

```ts
export interface InstrumentationPlanData {
  // existing fields...
  timbreWorld?: TimbreWorld;
  instrumentationPackId?: string;
  sameInstrumentPairs?: { a: InstrumentRoleName; b: InstrumentRoleName; program: number }[];
}
```

`sameInstrumentPairs` 只记录事实,不代表错误。

实际 GM program 仍由当前:

```ts
programByRoleSection
```

承载。

## Migration Plan

### Phase 1: Add Metadata And Packs

Files:

- `src/core/generation/newEngine/knowledge/instruments.ts`
- `src/core/generation/newEngine/instrumental/InstrumentationPlan.ts`

Changes:

1. Add `TimbreWorld`。
2. Add source/timbre metadata for current GM programs。
3. Add style packs。
4. Add optional trace fields: `timbreWorld`, `instrumentationPackId`, `sameInstrumentPairs`。

Acceptance:

- Trace can show selected timbre world and pack.
- Same instrument pair is reported but not rejected.

### Phase 2: Planner Repairs Bad Worlds

Files:

- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`

Changes:

1. Score current `band.roleProgram`。
2. If world mismatch is severe, replace program within current lineup role。
3. Preserve deterministic seed behavior。

Acceptance:

- Jazz does not use synth bass by default。
- Lofi does not use bright piano comp by default。
- RNB prefers Rhodes/FM。
- Pop can produce acoustic piano band or modern hybrid depending seed/world。

### Phase 3: Keep Existing Section Timbre Switch

Current same-family switching can stay:

- comp/lead only。
- same family only。
- no casual bass identity switch。

Update:

- Do not ban same program lead/comp。
- If same program pair exists, still allow same-family chorus switch if selected。

## Minimum Audible Cut

Smallest useful implementation:

1. Add timbre worlds。
2. Add style packs。
3. In `InstrumentationPlanner`, validate `band.roleProgram` against world/style。
4. Repair only obvious world mismatches。
5. Keep same-instrument pairs legal。

This gives器配层 real musical taste without mixing it with避让逻辑。
