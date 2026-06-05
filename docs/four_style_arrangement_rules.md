# V4.1 Engine-Audited Minimal Arrangement Rules for Q+N

本文档是对 V4 的再次收敛版,依据当前
`src/core/generation/newEngine/` 代码审计后输出。

目标只有一个:

让 Q+N 能在段落之间听到差异,并让 harmony 知道每个段落的和声功能,从而选择更合适的
和声进行并完成段落衔接。

本版不追求完整现代制作系统,不做复杂配器协议,也不让 arranger 直接管理鼓型、织体、
micro-timing、sidechain 或 walking bass 细节。这些都继续交给 KB 和现有 render 模板。

## Current Engine Reality

当前 Q+N newEngine 的关键事实:

- `ArrangementPlan.Section.role` 只有
  `intro | verse | chorus | bridge | outro`。
- `formPlanner` 对所有风格共用 pop 式 verse-chorus 模板。
- `progressionSelector` 选择和声 prototype 时只看
  `style + mode + section.role + bars`。
- `dynamicsPlanner` 当前把所有 `chorus` 固定为 2 chords/bar。
- `instrumentalPlanner.activityBySection` 已经存在,但 render 基本不消费它。
- render 已经有 `textureSchedule`,bass/comp/drum 会共享这个中央织体入口。

因此,最小有效升级不是新增大协议,而是:

1. 让 arranger 输出不同风格的曲式。
2. 让每个 section 带一个轻量 `harmonyRole`。
3. 让 harmony selector 优先用 `harmonyRole` 选 prototype。
4. 让 energy/density 只做段落强弱,不要负责复杂配器。
5. 让器配和 render 继续用现有 `textureBySection` / `textureSchedule`。

## Hard Non-Goals

以下内容暂不做:

- 不新增 `SectionRolePlan`。
- 不新增 `SectionTemplateRefs`。
- 不做 bar-level directive。
- 不做 role-level activity window。
- 不做 producer 级 ducking / anticipation / micro-timing 协议。
- 不让 arranger 生成具体鼓点、comp voicing、bass line。

这些能力将来可以作为 KB 模板或 render 内部模板升级,但不是本阶段 arranger 的职责。

## Minimal Contract

### Keep Existing Role

`role` 保持现有五类,用于当前 render、texture、trace 的 legacy projection。

```ts
export type SectionRole = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro';
```

### Add Harmony Role

新增一个很小的 `harmonyRole`,专门给 harmony selector 消费。

```ts
export type HarmonySectionRole =
  | 'intro'
  | 'verse'
  | 'chorus'
  | 'bridge'
  | 'ending'
  | 'loop';

export type SectionFunctionTag =
  | 'setup'
  | 'story'
  | 'build'
  | 'hook'
  | 'breakdown'
  | 'loop'
  | 'head'
  | 'solo'
  | 'headOut'
  | 'tag'
  | 'outro';

export interface Section {
  id: SectionId;
  role: SectionRole;              // existing legacy projection
  harmonyRole?: HarmonySectionRole;
  functionTag?: SectionFunctionTag;
  bars: number;
  repeatGroup?: RepeatGroupId;
  hookPolicy: HookPolicy;
}
```

解释:

- `role`: 给当前 render / texture / trace 用。
- `harmonyRole`: 给 progression selector 用。
- `functionTag`: 给 trace、dynamics、phrase planner 做轻量语义,不参与复杂 render。

### Selector Change

`progressionSelector` 只做一处小改:

```ts
const functionRole = section.harmonyRole ?? ROLE_MAP[section.role];
```

然后传给现有 `pickProgressionPrototype`。

不需要新增和声大系统。

## Minimal Data Flow

```text
BandSpec(style)
  -> FormPlanner(style): sections(role + harmonyRole + functionTag)
  -> TimePlanner(style): tempo / feel
  -> DynamicsPlanner: energyBySection / densityBySection
  -> PhrasePlanner: hook/cadence/motif binding
  -> Harmony: select prototype by style + mode + harmonyRole + bars
  -> Instrumentation: existing textureBySection
  -> Render: existing textureSchedule + existing renderers
```

## Style Forms

下面的曲式是最小建议。它们不是最终音乐工业标准,只是为了让 Q+N 先听到风格级段落差异。

### Pop

目标:有 verse / build / hook / bridge / final hook 的线性推进。

```text
intro(2/4)
-> verse1(8)
-> build1(4)
-> chorus1(8)
-> verse2(8)
-> build2(4)
-> chorus2(8)
-> bridge(8)
-> finalChorus(8)
-> outro(2/4)
```

Section projection:

| id | role | harmonyRole | functionTag | hookPolicy | repeatGroup |
| --- | --- | --- | --- | --- | --- |
| intro | intro | intro | setup | none | - |
| verse1 | verse | verse | story | light | V |
| build1 | bridge | bridge | build | none | BLD |
| chorus1 | chorus | chorus | hook | main | C |
| verse2 | verse | verse | story | light | V |
| build2 | bridge | bridge | build | none | BLD |
| chorus2 | chorus | chorus | hook | main | C |
| bridge | bridge | bridge | breakdown | none | - |
| finalChorus | chorus | chorus | hook | main | C |
| outro | outro | ending | outro | none | - |

Energy:

- intro: 0.30
- verse: 0.52
- build: 0.68
- chorus: 0.82
- bridge/breakdown: 0.55
- finalChorus: 0.88
- outro: 0.30

Harmonic rhythm:

- 默认 1 chord/bar。
- build 可在 fallback 时使用 1 或 2 chords/bar,但不强制。
- chorus 不再无条件强制 2 chords/bar;优先让 prototype 决定。

### RNB

目标:vamp 起势,hook 有落点,breakdown 真正抽离。

```text
introVamp(4/8)
-> verse1(8)
-> preHook1(4)
-> hook1(8)
-> verse2(8)
-> preHook2(4)
-> hook2(8)
-> breakdown(8)
-> finalHook(8/16)
-> outroVamp(4)
```

Section projection:

| id | role | harmonyRole | functionTag | hookPolicy | repeatGroup |
| --- | --- | --- | --- | --- | --- |
| introVamp | intro | intro | setup | light | VAMP |
| verse1 | verse | verse | story | light | V |
| preHook1 | bridge | bridge | build | none | PRE |
| hook1 | chorus | chorus | hook | call-response | H |
| verse2 | verse | verse | story | light | V |
| preHook2 | bridge | bridge | build | none | PRE |
| hook2 | chorus | chorus | hook | call-response | H |
| breakdown | bridge | bridge | breakdown | none | - |
| finalHook | chorus | chorus | hook | call-response | H |
| outroVamp | outro | ending | outro | light | VAMP |

Energy:

- introVamp: 0.42
- verse: 0.55
- preHook: 0.65
- hook: 0.74
- breakdown: 0.45
- finalHook: 0.80
- outroVamp: 0.38

Important:

- RNB 的区别主要来自 style 的 harmony prototype、groove KB 和 textureSchedule。
- Arranger 不写 snare offset。
- preHook 是和声/织体准备,不是 pop 式全员加密。

### Lofi

目标:短 loop 的 mute / filter / return,不强套传统 chorus。

```text
loopIntro(4/8)
-> loopA(8)
-> loopA2(8)
-> filterBreak(4/8)
-> loopOpen(8)
-> loopReturn(8)
-> outroFade(4/8)
```

Section projection:

| id | role | harmonyRole | functionTag | hookPolicy | repeatGroup |
| --- | --- | --- | --- | --- | --- |
| loopIntro | intro | loop | setup | none | L |
| loopA | verse | loop | loop | light | L |
| loopA2 | verse | loop | loop | light | L |
| filterBreak | bridge | loop | breakdown | none | L |
| loopOpen | verse | loop | loop | light | L |
| loopReturn | verse | loop | loop | light | L |
| outroFade | outro | ending | outro | none | L |

Energy:

- loopIntro: 0.25
- loopA: 0.42
- loopA2: 0.50
- filterBreak: 0.28
- loopOpen: 0.58
- loopReturn: 0.48
- outroFade: 0.22

Important:

- 大部分段落 `harmonyRole='loop'`,这样 harmony 会优先选 LOFI loop prototype。
- 不使用 `chorus` 作为主结构。
- 段落差异先靠 energy、texture、pad/comp presence、filter/chop KB 模板。
- 如果当前 render 还不能 filter/chop,也至少能通过 texture 与 dynamics 听出段落强弱。

### Jazz

目标:head / bridge / solo / head-out,不套 pop chorus 爆发。

```text
intro(4)
-> headA(8)
-> headA2(8)
-> bridgeB(8)
-> headA3(8)
-> solo(16/32)
-> headOut(16/32)
-> tag(4)
```

Section projection:

| id | role | harmonyRole | functionTag | hookPolicy | repeatGroup |
| --- | --- | --- | --- | --- | --- |
| intro | intro | intro | setup | none | - |
| headA | verse | verse | head | light | A |
| headA2 | verse | verse | head | light | A |
| bridgeB | bridge | bridge | build | none | B |
| headA3 | verse | verse | head | light | A |
| solo | bridge | bridge | solo | none | SOLO |
| headOut | chorus | chorus | headOut | light | A |
| tag | outro | ending | tag | none | - |

Energy:

- intro: 0.42
- head: 0.62
- bridgeB: 0.68
- solo: 0.72
- headOut: 0.70
- tag: 0.45

Important:

- `headOut` 可以 legacy project 成 `chorus`,但 hookPolicy 不要强制 `main`。
- Jazz 的高潮不是 pop final chorus,而是 solo late 或 head-out return。
- Bass walking、ride、comp 细节继续交给现有 style render / KB。

## Dynamics Rule

`dynamicsPlanner` 只做段落级能量,不要做复杂配器。

Minimal change:

```ts
const e = section.functionTag
  ? ENERGY_BY_FUNCTION[section.functionTag]
  : ROLE_ENERGY[section.role];
```

Density 可以暂时等于 energy,或者略低:

```ts
densityBySection[id] = Math.min(e, section.functionTag === 'hook' ? 0.78 : e);
```

关键原则:

- final hook 可以更强,但不要靠无脑增加 chordsPerBar。
- lofi 的 peak 也不超过 0.6 左右。
- jazz 不需要 0.9 的 chorus peak。
- breakdown 必须显著低于前后段。

## Harmonic Rhythm Rule

现阶段建议:

```ts
chordsPerBarBySection[id] = 1;
```

例外只给 fallback 使用:

- very short build: 可 2。
- jazz turnaround: 以后由 prototype beats 决定,不要 arranger 硬推。
- lofi: 保持 1 或 prototype 自带 loop。

原因:

- 当前 prototype-first 已经能给每段实际 slot。
- 强行把所有 chorus 设成 2 chords/bar 对 pop、lofi、jazz 都容易过密。
- 段落和声功能应该由 `harmonyRole` 选 prototype,而不是靠 chordsPerBar 伪装层次。

## Phrase Rule

`phrasePlanner` 暂时只做一个小修:

```ts
if (section.functionTag === 'hook') {
  return slot <= 1 ? 'hook' : 'connector';
}
if (section.functionTag === 'head' || section.functionTag === 'headOut') {
  return slot === 0 ? 'hook' : 'connector';
}
if (section.functionTag === 'loop') {
  return slot === 0 ? 'hook' : 'connector';
}
```

不要再让整个 `chorus` 的所有 phrase 都是 hook。

收益:

- pop hook 能保留 A/A' 记忆点。
- jazz head 不会全段被当商业副歌处理。
- lofi loop 只保留 motif anchor,不会变成 full chorus。

## Instrumentation Rule

本阶段不新增 `RoleState`。

保留现有:

- `textureBySection`
- `textureYieldPolicy`
- `programByRoleSection`
- `melodyReservationPlan`

只做一个可选小优化:

```ts
const textureRole = section.functionTag === 'breakdown'
  ? 'bridge'
  : section.role;
textureBySection[id] = pickGenericTexture(textureRole);
```

如果要让 breakdown 更明显,先用现有 texture:

- intro/outro: `pad`
- verse/loop/head: `arpeggio`
- hook/headOut: `active-comp`
- build/breakdown/solo: `sustained-block` 或 `active-comp`

不要此时新增乐器开关协议,因为 render 还没有消费 `activityBySection`。

## Render Rule

本阶段 render 不新增协议。

继续使用:

- `textureSchedule`
- `activeSectionIds`
- `energyBySection`
- `sectionRoleById`
- existing per-style bass / drum / comp logic

唯一建议:

如果将来要让 textureSchedule 更懂段落,可以让它接收 `sectionLabelById` 或
`functionTagById`,但不要马上做。

当前最小可行:

```ts
const sectionRoleById = Object.fromEntries(
  arrangement.sections.map((s) => [s.id, s.role])
);
```

先保持不动。

## Implementation Order

### Phase 1: Add Harmony Role

Files:

- `src/core/generation/newEngine/arranger/ArrangementPlan.ts`
- `src/core/generation/newEngine/harmony/progressionSelector.ts`

Changes:

1. Add optional `harmonyRole?: HarmonySectionRole` to `Section`。
2. Add optional `functionTag?: SectionFunctionTag` to `Section`。
3. `progressionSelector` reads `section.harmonyRole ?? ROLE_MAP[section.role]`。

Acceptance:

- Lofi sections can request `loop` prototypes.
- Outro maps to `ending` without depending only on role.
- Pop build / RNB preHook can request `bridge` harmony without pretending to be chorus。

### Phase 2: Style-Specific Form

Files:

- `src/core/generation/newEngine/arranger/formPlanner.ts`
- `src/core/generation/newEngine/arranger/arranger.ts`

Changes:

1. `planForm` accepts `style?: string`。
2. `buildArrangementPlan` passes `band.style` into `planForm`。
3. Add four minimal form pools: pop / rnb / lofi / jazz。
4. Existing `template` option remains for tests。

Acceptance:

- `traceGeneration({ styleHint: 'lofi' })` no longer shows pop chorus form。
- `traceGeneration({ styleHint: 'jazz' })` shows head / solo / headOut ids。
- `traceGeneration({ styleHint: 'rnb' })` shows introVamp / preHook / breakdown。

### Phase 3: Dynamics By Function

Files:

- `src/core/generation/newEngine/arranger/dynamicsPlanner.ts`

Changes:

1. energy uses `functionTag` first, role fallback。
2. remove unconditional `chorus => 2 chords/bar`。
3. lofi loop peak stays modest。

Acceptance:

- Lofi peak energy stays below pop chorus。
- Jazz headOut does not get pop 0.9 chorus energy。
- Breakdown energy visibly lower than neighboring sections。

### Phase 4: Phrase Hook Scope

Files:

- `src/core/generation/newEngine/arranger/phrasePlanner.ts`

Changes:

1. Hook phrase scope is based on `functionTag`,not every `chorus` phrase。
2. Hook sections mark phrase 0-1 as hook; later phrases connector/cadence。
3. Head/loop only mark phrase 0 as light hook。

Acceptance:

- `hookAnchorSlots` count drops from whole chorus to meaningful hook starts。
- Melody prepass still has motif repetition。
- Accompaniment does not over-yield across an entire chorus。

## What Not To Implement Yet

Do not implement these in the next cut:

- `SectionRolePlan`
- `RoleState`
- `SectionTemplateRefs`
- `activityWindows`
- `barDirectives`
- `producerSafety`
- `microTimingProfile`
- `dynamicDucking`
- `transitionTemplateId`

They are not wrong ideas, but they are too much for the current objective.

The current objective is:

```text
style-specific sections
  + harmonyRole
  + simple energy
  + existing textureSchedule
  = audible section contrast
```

## Minimum Audible Cut

The smallest useful implementation is:

1. `Section.harmonyRole`
2. `Section.functionTag`
3. style-specific form in `formPlanner`
4. `progressionSelector` consumes `harmonyRole`
5. `dynamicsPlanner` uses `functionTag` and stops forcing chorus 2 chords/bar

After this cut, Q+N should already produce clearer section-to-section contrast:

- Pop: story/build/hook/final hook
- RNB: vamp/preHook/hook/breakdown
- Lofi: loop/filter/return without pop chorus
- Jazz: head/bridge/solo/headOut

That is enough for the next musical step. Everything else should wait until KB/render template consumption proves it needs more fields.
