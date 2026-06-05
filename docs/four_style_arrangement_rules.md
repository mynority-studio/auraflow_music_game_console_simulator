# V4 Minimal Four-Style Arrangement Rules for Q+N

本文档是 V3 `Producer-Audited Four-Style Arrangement Rules` 的收敛版。

目标不是让 Q+N 在 arranger 层模拟完整制作人,而是让当前 newEngine 能稳定消费:

- 简单但有效的歌曲分段。
- 每段能量和密度的变化。
- 乐器谁先进、谁后进、谁留白。
- render 应该选择哪类 KB 模板。

鼓怎么打、comp 具体织体怎么弹、R&B pocket 如何对拍、Jazz walking bass 如何装饰、
Lofi 如何 stutter 或降调,都不应该写成 arranger 的复杂算法。它们应该放在 KB 模板里,
由 render 按模板执行。

## Hard Scope

只考虑 Q+N newEngine 的四个 macro styles:

- `pop`
- `rnb`
- `lofi`
- `jazz`

本版明确不追求:

- 复杂微时序生成器。
- 完整 sidechain 物理模拟。
- 自动混音系统。
- 每小节实时推导高级鼓型。
- 让 arranger 直接生成具体织体音符。

本版只要求 Q+N 能听到“编曲结构变了”:

- verse 比 chorus 少。
- pre / build 能推向 hook。
- final chorus 更宽更高,不是更乱更密。
- lofi 靠 loop/mute/filter/chop 做段落,不是写 pop B 段。
- jazz 有 head / solo / head-out 的段落感。
- rnb 有 vamp / hook / breakdown 的层次。

## Gemini Audit Accepted Fixes

V3 中过重或容易误导 render 的规则按以下方式修正。

### 1. Pocket 不做大区间随机

错误方向:

```ts
microTimingMode: 'probabilisticRange'
snare: +12..+35ms randomly per hit
```

V4 改法:

- Arranger 不下发具体 ms。
- Instrumentation 只下发 `grooveTemplateId`。
- KB 模板内部可以定义 `anchorOffsetMs + jitterMs`。
- Backbeat 的 snare anchor 必须稳定,jitter 只做极小范围 humanize。

示例:

```ts
{
  id: 'rnb_dilla_pocket_01',
  anchorOffsetMs: { kick: -4, snare: 24, comp: 14 },
  jitterMs: { kick: 2, snare: 3, hat: 4, comp: 5 }
}
```

### 2. Anticipation 是全军提前,不是只推和声

错误方向:

- 和弦在上一小节 beat 4& 提前。
- kick/crash/bass 仍落在下一小节 beat 1。

V4 改法:

- Arranger 只标记 transition template。
- 如果 KB 模板选择 `push_4and`,则 kick、crash、bass anchor、comp attack 必须一起提前。
- 原本 beat 1 位置由模板决定 tie / mute / lighter hit,避免 flam。

示例:

```ts
transitionTemplateId: 'pop_push_4and_full_band'
```

### 3. Ducking 不做一次性假包络

错误方向:

```ts
dynamicDucking: { afterAttackBeats: 1.0, gainDb: -6 }
```

V4 改法:

- 当前 Q+N 不强制实现真实 sidechain。
- 如果 render 已支持,只通过 KB 模板选择 `kick_sidechain_pump`。
- 如果 render 不支持,用更简单的编配避让:pad 低速、comp 短音、hook 后半留白。

示例:

```ts
mixMotionTemplateId: 'kick_sidechain_pump_light'
```

### 4. Final Chorus 变宽变高,不是变密

错误方向:

- final chorus 一味增加 comp/drum/pad activity。

V4 改法:

- final chorus 不提高 comp 节奏密度。
- 增加 octave layer、wide pad、counter melody、crash/open hat、backing hook。
- 如果 melody 很密,comp density 反而下降。

### 5. Jazz Bass 的细节交给 KB

错误方向:

- arranger 直接规定 walking bass 每拍 target。
- 强拍随机落 3rd / 7th。

V4 改法:

- Arranger 只标记 `bassTemplateId: 'jazz_walking_basic'`。
- KB 模板规定:
  - beat 1 强制 root 或 fifth。
  - beat 3 优先 root/fifth,允许少量 third。
  - beat 4 可 approach 下一和弦。
  - skip note / ghost pickup 由模板概率处理。

### 6. Lofi 的破坏感通过模板开放

V4 保留简单 loop/mute/filter,但允许 KB 模板实现更像 SP-404 / MPC 的变异:

- `lofi_filter_down`
- `lofi_stutter_chop`
- `lofi_octave_down_halftime`
- `lofi_tape_stop`
- `lofi_chop_retrigger`

Arranger 不直接实现这些效果,只在 breakdown / transition 处选择模板。

## Q+N Minimal Data Contract

### ArrangementPlan 只做结构

```ts
export type MacroStyle = 'pop' | 'rnb' | 'lofi' | 'jazz';

export type SectionFunction =
  | 'intro'
  | 'verse'
  | 'build'
  | 'hook'
  | 'breakdown'
  | 'solo'
  | 'head'
  | 'headOut'
  | 'outro';

export interface SimpleSectionPlan {
  id: string;
  role: 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro'; // legacy projection
  function: SectionFunction;
  bars: number;
  energy: 'low' | 'mid' | 'high' | 'peak';
  density: 'sparse' | 'medium' | 'full';
  repeatGroup?: string;
}
```

### InstrumentationPlan 只做乐器进出

```ts
export type RoleState =
  | 'off'
  | 'ghost'
  | 'support'
  | 'main'
  | 'wide';

export interface SectionRolePlan {
  sectionId: string;
  lead: RoleState;
  comp: RoleState;
  pad: RoleState;
  bass: RoleState;
  drums: RoleState;
}
```

解释:

- `off`: 不出现。
- `ghost`: 极少量提示或过门。
- `support`: 支撑,不抢主线。
- `main`: 该角色承担主要识别度。
- `wide`: 只用于 final chorus / hook lift,表示加宽或高八度层,不是增加节奏密度。

### RenderPlan 只拿模板 ID

```ts
export interface SectionTemplateRefs {
  sectionId: string;
  grooveTemplateId?: string;
  compTemplateId?: string;
  bassTemplateId?: string;
  padTemplateId?: string;
  leadTemplateId?: string;
  transitionTemplateId?: string;
  mixMotionTemplateId?: string;
}
```

关键原则:

- arranger 不写具体鼓点。
- arranger 不写具体 voicing。
- arranger 不写具体 ms timing。
- arranger 只选择模板类别和乐器进出。

## Layer Responsibilities

### Arranger

Arranger 只回答:

- 这首歌分几段。
- 每段几小节。
- 哪段是主 hook。
- 哪段是 build / breakdown / return。
- 每段能量大概高低。

Arranger 不回答:

- 鼓每拍怎么打。
- R&B snare 拖多少 ms。
- Jazz bass 每拍弹什么音。
- Lofi stutter 具体切多少刀。

### Instrumentation Planner

Instrumentation 只回答:

- 每段 lead / comp / pad / bass / drums 是 off、support、main 还是 wide。
- 哪些段落要留白。
- final chorus 是加宽还是加密。
- breakdown 抽掉哪些角色。

### Render

Render 只回答:

- 根据 role state 决定是否出音。
- 根据 template id 从 KB 取鼓型、织体、bass、pad、transition。
- 套用模板内部的人味、push、chop、walking、sidechain 或 filter。

## Global Musical Rules

这些规则要简单,但必须硬。

1. Hook 首拍不能空。
   Pop/RNB 的主 hook 第一拍至少要有 drums + bass + comp 的共同确认。

2. Final chorus 不加密。
   final chorus 优先 `wide`、octave、pad air、backing hook,不要让 comp 切得更碎。

3. Build 要有方向。
   build 可以加 open hat、riser、swell、bass pickup,但最后要推向 hook。

4. Breakdown 要真的少。
   至少抽掉 drums、bass、pad、comp 中的两个角色。

5. Lofi 不写大 B 段。
   lofi 的变化靠 mute/filter/chop/noise/bass in/out,不是传统 chorus 换和弦。

6. Jazz 不用 pop chorus 逻辑。
   jazz 的段落是 head、solo、head-out、tag。hook 不是全员爆炸。

7. RNB 不要全员加密。
   RNB 的厚度来自和声色彩、pocket、空间和 call-response,不是所有角色一起变忙。

## Style Rules

## Pop

### Form

```text
intro(2/4) -> verse1(8) -> build/pre(4) -> hook1(8)
-> verse2(8) -> build/pre(4) -> hook2(8)
-> breakdown/bridge(4/8) -> finalHook(8) -> outro(2/4)
```

### Section Role Plan

| Section | Lead | Comp | Pad | Bass | Drums |
| --- | --- | --- | --- | --- | --- |
| intro | ghost | support | support | off | ghost/off |
| verse1 | main | support | off/ghost | support | support |
| build | main | support | support | support | support |
| hook1 | main | main | support | main | main |
| verse2 | main | support | ghost/support | support | support |
| hook2 | main | main | support | main | main |
| breakdown | main/ghost | support | support | off/support | off/ghost |
| finalHook | main | support | wide | main | main |
| outro | ghost | support | ghost | off/support | ghost/off |

### Template Families

```ts
pop: {
  groove: ['pop_backbeat_light', 'pop_backbeat_full', 'pop_open_hat_build'],
  comp: ['pop_sparse_piano', 'pop_chorus_stabs', 'pop_short_syncopation'],
  bass: ['pop_kick_lock_root', 'pop_octave_pulse'],
  pad: ['pop_low_sustain', 'pop_air_wide_final'],
  transition: ['pop_fill_tail', 'pop_push_4and_full_band'],
  mixMotion: ['none', 'kick_sidechain_pump_light']
}
```

### Producer Guardrails

- Pre/build 不要用已经落地的副歌进行当结尾。尾部要悬停在 V、sus、dominant pedal 或类似不稳定位置。
- Hook phrase 0 和 phrase 1 要能形成 A/A 或 A/A' 记忆点。
- Final hook 的提升来自 `pad: wide`、高八度层、backing hook,不是 comp density 继续上升。

## RNB / Neo-Soul

### Form

```text
introVamp(4/8) -> verse1(8) -> preHook(4) -> hook1(8)
-> verse2(8) -> preHook2(4) -> hook2(8)
-> breakdown(8) -> finalHook(8/16) -> outroVamp(4)
```

### Section Role Plan

| Section | Lead | Comp | Pad | Bass | Drums |
| --- | --- | --- | --- | --- | --- |
| introVamp | ghost | main | ghost/support | off/support | ghost/off |
| verse1 | main | support | off/ghost | support | support |
| preHook | main | support/main | support | support | support |
| hook1 | main | main | support | main | main |
| verse2 | main | support | ghost | support/main | support |
| hook2 | main | main | support | main | main |
| breakdown | main/ghost | main | off/support | support | off/ghost |
| finalHook | main | support/main | wide/support | main | main |
| outroVamp | ghost | main | ghost | support | ghost/off |

### Template Families

```ts
rnb: {
  groove: ['rnb_laidback_anchor_01', 'rnb_half_time_pocket', 'rnb_hook_the_one'],
  comp: ['rnb_rhodes_answer', 'rnb_guitar_chops', 'rnb_the_one_full_chord'],
  bass: ['rnb_syncopated_pocket', 'rnb_kick_relation'],
  pad: ['rnb_warm_low_support', 'rnb_air_final'],
  transition: ['rnb_pickup_fill_light', 'rnb_stop_the_one'],
  mixMotion: ['none', 'vocal_space_duck_light']
}
```

### Producer Guardrails

- `rnb_hook_the_one` 必须让 hook 第一拍有 full chord / bass / drum 地基。
- Groove 模板必须使用 anchor offset + small jitter,不要每次 snare 大范围随机。
- Comp 多回答旋律尾巴,不要和 lead 同时高速滚动。
- Final hook 可以加 backing harmony 或 wide pad,不要把 Rhodes 切得更密。

## Lofi

### Form

```text
loopA_intro(4/8) -> loopA_drumsIn(8) -> loopA_bassIn(8)
-> filterBreak(4/8) -> loopA_open(8) -> outro/fade(4/8)
```

### Section Role Plan

| Section | Lead | Comp | Pad/Noise | Bass | Drums |
| --- | --- | --- | --- | --- | --- |
| loopA_intro | ghost/off | main | support | off | off/ghost |
| drumsIn | ghost | main | support | off/support | support |
| bassIn | ghost/support | main | support | support | support |
| filterBreak | off/ghost | main | main | off | off/ghost |
| loopA_open | ghost/support | main | support | support | support |
| outro | off/ghost | support | main | off/support | ghost/off |

### Template Families

```ts
lofi: {
  groove: ['lofi_soft_boom_bap', 'lofi_half_time_soft', 'lofi_hat_swing_soft'],
  comp: ['lofi_block_chords', 'lofi_sample_chop_chords', 'lofi_sparse_keys'],
  bass: ['lofi_root_pulse_sparse', 'lofi_warm_sub_support'],
  pad: ['lofi_vinyl_noise', 'lofi_tape_pad_lowpass'],
  transition: [
    'lofi_filter_down',
    'lofi_filter_open',
    'lofi_stutter_chop',
    'lofi_octave_down_halftime',
    'lofi_tape_stop'
  ],
  mixMotion: ['none', 'lofi_lowpass_motion']
}
```

### Producer Guardrails

- 不做明显 pop B 段。
- 同一个 4/8 小节 loop 可以贯穿全曲。
- 变化靠 mute、filter、noise、chop、bass/drums in-out。
- `lofi_stutter_chop` 和 `lofi_octave_down_halftime` 只在 breakdown / transition 使用,不要常态滥用。

## Jazz

### Form

```text
intro(4) -> headA(8) -> headA2(8) -> bridgeB(8) -> headA3(8)
-> solo(optional 16/32) -> headOut(16/32) -> tag/outro(4)
```

当前 `SectionRole` 可投影为:

- `headA/headA2/headA3`: `verse`
- `bridgeB/solo`: `bridge`
- `headOut`: `chorus`
- `tag/outro`: `outro`

### Section Role Plan

| Section | Lead | Comp | Pad | Bass | Drums |
| --- | --- | --- | --- | --- | --- |
| intro | ghost | support | off/ghost | support | support |
| head | main | support | off | main | main |
| bridgeB | main | support/main | off | main | main |
| solo | main | support/main | off | main | main |
| headOut | main | support | off/ghost | main | main |
| tag/outro | ghost/main | support | off/ghost | support/main | support |

### Template Families

```ts
jazz: {
  groove: ['jazz_ride_swing_basic', 'jazz_brush_ballad', 'jazz_solo_lift'],
  comp: ['jazz_shell_comp_sparse', 'jazz_rootless_answer', 'jazz_solo_comp'],
  bass: ['jazz_two_feel', 'jazz_walking_basic', 'jazz_walking_skip_notes'],
  pad: ['none', 'jazz_ballad_air'],
  transition: ['jazz_turnaround_tag', 'jazz_drum_setup_light'],
  mixMotion: ['none']
}
```

### Producer Guardrails

- Walking bass 细节必须在 KB 模板里定义。
- 基础模板应保证 beat 1 护根:root/fifth 优先。
- skip note / ghost pickup 是模板装饰,不是 arranger 字段。
- Pad 默认 off,除非 ballad/chill jazz intro/outro。

## Minimal Implementation Plan

### Phase 1: Style-specific form

Files:

- `src/core/generation/newEngine/knowledge/styleArrangementRules.ts`
- `src/core/generation/newEngine/arranger/formPlanner.ts`
- `src/core/generation/newEngine/arranger/ArrangementPlan.ts`

Implement:

1. 新增四风格 form template。
2. `Section` 增加轻量 `function?: SectionFunction`。
3. 保持旧 `role` 字段,作为 legacy projection。
4. 不加复杂 bar-level 指令。

Acceptance:

- Pop 有 verse/build/hook/finalHook。
- RNB 有 vamp/preHook/hook/breakdown。
- Lofi 没有传统 chorus B 段。
- Jazz 有 head/solo/headOut。

### Phase 2: Role entry/exit

Files:

- `src/core/generation/newEngine/instrumental/InstrumentationPlan.ts`
- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`

Implement:

1. 新增 `SectionRolePlan`。
2. 每个 section 给 lead/comp/pad/bass/drums 一个 `RoleState`。
3. `activityBySection` 可以继续保留,但由 RoleState 平均映射。

Suggested mapping:

```ts
off = 0
ghost = 0.15
support = 0.45
main = 0.8
wide = 0.65 // wide 不是更密,只是更宽
```

Acceptance:

- Breakdown 至少两个角色被 mute/ghost。
- Final chorus 不把所有角色 activity 拉到 1。
- Lofi filterBreak 明显少于 loopA_open。

### Phase 3: Template refs

Files:

- `src/core/generation/newEngine/knowledge/styleArrangementRules.ts`
- `src/core/generation/newEngine/render/renderCoordinator.ts`

Implement:

1. 每个 section 输出 `SectionTemplateRefs`。
2. RenderCoordinator 优先使用 template refs。
3. 没有模板时 fallback 当前 render 逻辑。

Acceptance:

- Q+N trace 能看到每段 template id。
- RNB 不再 fallback 到 generic groove。
- Lofi breakdown 能触发 filter/chop 类 transition template。
- Jazz 能选 walking 或 two-feel bass template。

### Phase 4: Renderer consumes RoleState

Files:

- `src/core/generation/newEngine/render/*Renderer.ts`

Implement:

1. `off`: 不发音。
2. `ghost`: 只允许少量 pickup/noise/transition。
3. `support`: 降 velocity、降 note count。
4. `main`: 正常模板输出。
5. `wide`: 不增加节奏密度,只允许 octave/pad/stereo layer 类模板。

Acceptance:

- 同一首歌中 verse/hook/breakdown/finalHook MIDI note count 有明显差异。
- finalHook 的 comp note count 不高于 hook2,但 pad/upper layer 可以增加。
- lofi 不因为 loopOpen 变成 pop chorus。

## KB Template Requirements

模板不是本文件实现内容,但 KB 至少要覆盖这些类别。

### Groove Template

```ts
interface GrooveTemplate {
  id: string;
  style: MacroStyle;
  family: 'backbeat' | 'rnbPocket' | 'lofiBoomBap' | 'jazzSwing';
  anchorOffsetMs?: Record<string, number>;
  jitterMs?: Record<string, number>;
}
```

### Comp Template

```ts
interface CompTemplate {
  id: string;
  style: MacroStyle;
  densityClass: 'sparse' | 'medium' | 'full';
  behavior: 'sustain' | 'stabs' | 'answer' | 'blockChop' | 'shellComp';
}
```

### Bass Template

```ts
interface BassTemplate {
  id: string;
  style: MacroStyle;
  behavior: 'kickLock' | 'syncopated' | 'rootPulse' | 'twoFeel' | 'walking';
  strongBeatPolicy?: 'rootOrFifth';
  ornamentPolicy?: 'none' | 'approach' | 'skipNotes';
}
```

### Transition Template

```ts
interface TransitionTemplate {
  id: string;
  style: MacroStyle;
  behavior:
    | 'fill'
    | 'pushFullBand'
    | 'filterDown'
    | 'filterOpen'
    | 'stutterChop'
    | 'octaveDownHalfTime'
    | 'tapeStop'
    | 'turnaroundTag';
}
```

## Minimum Audible Cut

最小可落地切片:

1. `function` 标记四风格分段。
2. `SectionRolePlan` 控制乐器进出。
3. `SectionTemplateRefs` 控制模板选择。
4. Render 消费 `off/ghost/support/main/wide`。
5. KB 提供每个 style 至少 2 个 groove、2 个 comp、2 个 bass、2 个 transition 模板。

做到这五点,就能先获得大多数编配多样性。后续再逐步增加更细的 groove / chop /
sidechain / walking bass 模板,不需要把 arranger 变成一个过度复杂的制作系统。

## Reference Anchors

- [MusicRadar: Max Martin songwriting formula](https://www.musicradar.com/tutorials/music-theory-songwriting/the-verse-and-chorus-of-that-song-are-exactly-the-same-but-you-dont-really-notice-since-the-energy-of-the-chorus-is-completely-different-cracking-open-max-martins-uber-succesful-songwriting-formula)
- [L.Dre official site](https://prodbyldre.com/pages/about-l-dre)
- [Waves: L.Dre beatmaking video](https://www.waves.com/different-sounding-beats-ldre-studioverse)
- [Reverb: Sampled / gated synth chords](https://reverb.com/featured/sampled-gated-synth-chords-sound-recipes)
- [The Jazz Piano Site: Walking Bass-lines](https://www.thejazzpianosite.com/jazz-piano-lessons/jazz-chord-voicings/walking-bass-lines/)
- [StudyBass: Chromatic Approach Notes](https://www.studybass.com/lessons/common-bass-patterns/chromatic-approach-notes/)
- [MusicProductionWiki: Sidechain Compression Guide](https://musicproductionwiki.com/articles/sidechain-compression-guide.html)
