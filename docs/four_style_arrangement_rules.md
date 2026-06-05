# Four-Style Arrangement Rules for Arranger and Instrumentation

本文档把当前 newEngine 暴露的四个 macro 风格 `pop` / `jazz` / `rnb` / `lofi`
整理成 arranger 和器配层可以消费的规则范式。目标不是替代
`melodygenerative` 的 render 织体,而是在 render 之前下发完整歌曲结构、段落功能、
和声节奏、密度曲线、乐器进出、留白和让位策略。

## Scope

当前仓库有两个风格体系:

- 旧 `StyleId`: `ModernPop` / `ChillJazz` / `NeoSoul`。
- newEngine/mg macro: `POP` / `JAZZ` / `RNB` / `LOFI`,同时知识库仍保留 `BLUES`。

本方案按 newEngine 注释里的 UI 四风格处理: `pop` / `jazz` / `rnb` / `lofi`。
`BLUES` 建议继续作为 harmony/groove 资料库和未来第五风格,暂不放进主规则。

## Research Anchors

这些资料只作为稳定音乐范式依据,具体参数以本引擎可控性为准:

- [Open Music Theory: Verse-Chorus Form](https://viva.pressbooks.pub/openmusictheory/chapter/verse-chorus-form/):
  verse-chorus 是流行/摇滚主流 sectional form; bridge 常在后段出现并引出末次 chorus。
- [Open Music Theory: Four-Chord Schemas](https://viva.pressbooks.pub/openmusictheory/chapter/4-chord-schemas/):
  pop 常见四和弦 schema,如 I-vi-IV-V 等,适合作为 verse/chorus 骨架。
- [Open Music Theory: AABA and Strophic Form](https://pressbooks.nebraska.edu/openmusictheory/chapter/aaba-and-strophic-form/)
  与 [Maricopa Jazz Theory: Rhythm Changes](https://open.maricopa.edu/mtc130/chapter/rhythm-changes/):
  jazz 常用 32-bar AABA/head form,bridge 提供对比。
- [Open Music Theory: Swing Rhythms](https://viva.pressbooks.pub/openmusictheorycopy/chapter/swing-rhythms/):
  jazz swing 常以直八分记谱但演奏为 swing feel,ride cymbal 是关键时间感载体。
- [Tunable: Backbeat](https://tunableapp.com/rhythm/backbeat/):
  pop/rock/R&B backbeat 通常强调 4/4 的 2、4 拍,常由 snare 承担。
- [Berklee Neo-Soul ensemble](https://college.berklee.edu/courses/enrb-408),
  [MusicRadar Neo-Soul](https://www.musicradar.com/how-to/learn-4-great-neo-soul-guitar-chords),
  [Guitar Wiz Neo-Soul/R&B chords](https://guitarwiz.app/articles/neo-soul-guitar-chords/):
  neo-soul/R&B 需要旋律、和声、节奏准确性,常用扩展和弦、shell/省略音、R&B pocket。
- [EDMProd Lo-fi Hip Hop](https://www.edmprod.com/lofi-hip-hop/) 与
  [Suno Lo-Fi guide](https://usesuno.com/guide/genre/hip-hop-rap/lofi-hip-hop):
  lo-fi 重点是 dusty/soft drums、jazzy warm chords、swing/off-grid、短 loop 和稀疏编配。

## Core Principle

新增一个纯知识层 `StyleArrangementRules`,让 arranger 负责宏观结构,
instrumental planner 负责分段配器与让位,render 只忠实执行。

推荐数据流:

```text
BandSpec(style)
  -> StyleArrangementRules
  -> FormPlanner: sections / phrase functions / climax policy
  -> DynamicsPlanner: energy + density bar curves
  -> HarmonyEngine: section harmony profile + harmonic rhythm target
  -> InstrumentalPlanner: role activity + texture + register + melody reservation
  -> RenderCoordinator: per-bar texture schedule + role rendering + collision resolver
```

## Proposed Contract

```ts
export type MacroStyle = 'pop' | 'jazz' | 'rnb' | 'lofi';

export type SectionFunction =
  | 'setup'
  | 'story'
  | 'build'
  | 'mainHook'
  | 'postHook'
  | 'contrast'
  | 'solo'
  | 'breakdown'
  | 'return'
  | 'cadence'
  | 'fade';

export interface SectionRecipe {
  idHint: string;
  role: 'intro' | 'verse' | 'preChorus' | 'chorus' | 'bridge' | 'outro';
  function: SectionFunction;
  bars: readonly number[];
  hookPolicy: 'none' | 'light' | 'main' | 'call-response';
  energy: readonly number[];       // per phrase or normalized bar curve
  density: readonly number[];      // independent from energy
  harmonicRhythm: readonly number[]; // chords/bar per phrase
  harmonyTags: readonly string[];  // e.g. popLoop, iiV, neoSoulVamp
}

export interface RoleActivityRecipe {
  bass: number;
  comp: number;
  pad: number;
  drum: number;
  lead: number;
}

export interface TextureRecipe {
  textureCases: readonly string[];
  compingMode: 'full_voicing' | 'shell_only' | 'bass_plus_shell' | 'answer_only';
  melodySpace: 'high' | 'medium' | 'low';
  maxCompDensityWhenHook: number;
  padAttackPolicy: 'noneNearHook' | 'sustainOnly' | 'free';
}

export interface StyleArrangementRule {
  style: MacroStyle;
  formTemplates: readonly SectionRecipe[][];
  roleActivityByFunction: Record<SectionFunction, RoleActivityRecipe>;
  textureByFunction: Partial<Record<SectionFunction, TextureRecipe>>;
  drumPolicy: DrumPolicy;
  bassPolicy: BassPolicy;
  melodyPolicy: MelodyPolicy;
  harmonyPolicy: HarmonyPolicy;
}
```

可以先不一次性扩完 TS 类型。MVP 可在 `Section` 上加 `functionTag?: SectionFunction`
和 `isFinalChorus?: boolean`,把 `preChorus` 临时映射成 role `bridge` 或直接扩展
`SectionRole`。长期建议扩展 `SectionRole`,否则 harmony/dynamics 很难干净地区分 build。

## Global Anti-Clash Rules

所有风格共享这些“不要抢戏”的硬规则:

1. Hook 优先级: `lead hook > bass pocket/root > kick/snare time > comp answer > pad/fill`。
2. `hookPolicy === 'main'` 时,hook 起拍前后 0.25 拍内禁止新 pad attack,comp 只允许
   `answer_only` 或 `shell_only`,drum fill 只能落在 phrase tail。
3. 旋律 attack 密度高于阈值时,comp 从 full voicing 降级为 shell/answer;旋律稀疏时,
   comp 可以用 active comp 或 fill。
4. Pad 是气氛层,不负责节奏推动。高密度段 pad 只 sustain,低密度段才允许 slow swell。
5. Bass 和 kick 共享 pocket。pop/rnb/lofi 以 kick alignment 为主;jazz 以 walking
   quarter-note line 为主,drum ride 保持时间。
6. 同一频段留白:lead 67-84,comp 48-72,pad 55-84,bass 36-52。RNB/JAZZ 可用宽和弦,
   但与 lead 同时发生时必须避开 m2/m9 碰撞。
7. 段落边界 fill 不是每次都满打。intro->verse 可无 fill,pre->chorus 或 bridge->final
   chorus 才允许强 fill。

## Pop Rule

音乐目标:清楚的 verse/pre-chorus/chorus 叙事,hook 明确,节奏稳定,和声不过度抢旋律。

推荐曲式:

```text
intro(2/4) -> verse1(8) -> pre1(4) -> chorus1(8)
-> verse2(8) -> pre2(4) -> chorus2(8)
-> bridge(8) -> finalChorus(8) -> outro(2/4)
```

Arranger:

- Verse: energy 0.40-0.58,density 0.35-0.55,1 chord/bar。
- Pre-chorus: energy 0.58->0.78,density 0.55->0.75,后半可 2 chords/bar。
- Chorus: energy 0.78-0.90,density 0.70-0.85,1 chord/bar 为主,高能 seed 可 2 chords/bar。
- Bridge: energy 0.50-0.70,换和声重心或 register,最后 2 小节 build 回 final chorus。
- Final chorus: chorus2 +0.05 energy,允许 pad/高八度 hook/鼓 crash。

Harmony:

- Verse/chorus 可共享四和弦 schema,但 chorus 靠 register、rhythm、density 变大。
- Pre-chorus 用 S->D build: IV-V, ii-V, IV-V-iii-vi,或轻 secondary dominant。
- Bridge 可用 relative minor、borrowed iv/bVI/bVII,但 tension carrier 主要给 melody。

Instrumentation:

- Intro: pad/soft piano motif,drum 可静音或只 hat/filter。
- Verse1: lead + sparse comp + bass;drum backbeat 轻。
- Verse2: 加 pad 或更明确 bass/kick。
- Pre: comp 八分/切分逐渐加密,pad swell,drum open hat 或 fill tail。
- Chorus: full backbeat,bass 锁 kick,comp active 但 hook 起拍让位,pad sustain。
- Melody: chorus phrase 0 才是 main hook;phrase 1 是 answer/post-hook,不要全段满 hook。

## Jazz Rule

音乐目标:head/solo/head-out 或 AABA 的乐句逻辑,swing rhythm section,comp 与旋律对话。

推荐曲式:

```text
intro(4) -> headA(8) -> headA2(8) -> bridgeB(8) -> headA3(8)
-> soloChorus(32 optional) -> headOut(32 or 16) -> tag/outro(4)
```

如果当前 `SectionRole` 不支持 head/solo,可映射:
`verse=headA`, `bridge=bridgeB/solo`, `chorus=headOut`,并用 `functionTag` 区分。

Arranger:

- Head: energy 0.55-0.70,density 0.50-0.70。
- Bridge/B: energy 0.60-0.78,和声或旋律方向强对比。
- Solo chorus: energy 每 8 小节递增 0.05,comp/drum 互动增加。
- Head-out/tag: 回 main melody,最后 2-4 小节 cadence/tag。
- Harmonic rhythm: 常态 1-2 chords/bar;turnaround/ii-V 可半小节切。

Harmony:

- ii-V-I、rhythm changes、jazz blues、turnaround 是核心。
- JAZZ 允许最高 colorBudget/rootless/shell/altered dominant,但 guide tones 必须清楚。

Instrumentation:

- Bass: walking quarter notes,目标是连接 chord roots/5ths,不是 pop kick lock。
- Drum: ride pattern + pedal hat 2/4;snare/kick comp 只作互动。
- Comp: off-beat/syncopated comping,默认 shell/rootless;melody密时 answer_only。
- Pad: 极少使用,只在 ballad/chill jazz intro/outro 气氛层。
- Melody: head 要可复现;solo 段提高 melodyFreedom,但 phrase cadence 仍要落地。

## RNB / Neo-Soul Rule

音乐目标:中速 pocket、扩展和弦、Rhodes/EP/guitar 让位式 comp、旋律和伴奏 call-response。

推荐曲式:

```text
introVamp(4/8) -> verse1(8) -> preHook(4) -> hook(8)
-> verse2(8) -> preHook2(4) -> hook2(8)
-> breakdown/bridge(8) -> finalHook(8/16) -> outroVamp(4)
```

Arranger:

- Verse: energy 0.45-0.62,density 0.40-0.58,groove 稳,留旋律空间。
- PreHook: 不一定像 pop 一样“越响”,而是 bass/comp syncopation 或 passing chords 增强。
- Hook: energy 0.65-0.82,density 0.55-0.75,厚度来自和声色彩和背景层,不是全员加密。
- Breakdown: energy 0.35-0.55,可只留 Rhodes+bass 或 drum+bass。
- Final hook: 加 backing/harmony layer 或高 register answer。

Harmony:

- Maj7/maj9/m9/11/13/sus/backdoor 是标志;多用 common-tone 和 voice-leading。
- Passing chords 可放在 bar tail 或 phrase turn,不要整段疯狂离调。
- Harmonic rhythm 多数 0.5-1 chord/bar,装饰 passing 可 2 chords/bar。

Instrumentation:

- Comp: Rhodes/FM EP/clean guitar 风格,以短句回答旋律;hook 起拍 `answer_only`。
- Bass: syncopated,可比 pop 更旋律化,但必须保持 pocket。
- Drum: backbeat 仍在 2/4 框架,但 snare 可略 late;hat ghost/16th variation。
- Pad: warm pad 小音量支撑,不做明显节奏。
- Melody: conversational,允许 melisma/slide/anticipation;伴奏在尾音后回答。

## Lofi Rule

音乐目标:短 loop 的层次加减、低能量但有结构、dusty/soft/swing/off-grid 的亲密感。

推荐曲式:

```text
introLoop(4/8) -> A(8) -> A'(8) -> B/hook(8)
-> breakdown(4/8) -> returnA(8) -> B2(8) -> outro/fade(4/8)
```

Arranger:

- 不用强 verse-chorus 爆发。结构靠 mute/unmute、滤波、drum/bass 进出、melody fragment 复现。
- Energy 0.20-0.65,density 0.15-0.55;高潮也不超过 0.75。
- Harmonic rhythm 多数 0.5-1 chord/bar;循环感优先于强 authentic cadence。
- Phrase cell: establish -> develop -> lift -> cadence,但 lift 是 texture lift,不是 pop build。

Harmony:

- maj7/m7/m9/9sus/common-tone/soft ii-V-I;少用强 V7alt。
- 允许 unresolved color 和 loop-back;tonicization/borrrowed planner 概率应接近 0。

Instrumentation:

- Comp: piano/Rhodes broken 10th、late chord answer、one-shot space。
- Bass: optional pulse,少音符,跟 kick 或 chord roots。
- Drum: soft boom-bap/half-time,hat swing 0.55-0.62,力度变化更大。
- Pad/noise: 作为 texture layer,attack 稀少;可在 breakdown 独立出现。
- Melody: short motif、碎片化、留白多;高密度旋律不应和 comp 同时滚动。

## Style Matrix

| Style | Form Shape | Energy Peak | Harmony Rhythm | Main Texture | Drum Rule | Comp Rule |
| --- | --- | --- | --- | --- | --- | --- |
| pop | verse-pre-chorus-chorus | final chorus | verse 1,pre tail 2,chorus 1/2 | active comp + pad sustain | backbeat 2/4,eighth hat | triad/6/9,shell on hook |
| jazz | AABA/head-solo-head | solo late or head-out | 1-2 chords/bar,turnaround split | walking bass + sync comp | ride swing,pedal hat 2/4 | shell/rootless,answer melody |
| rnb | vamp-verse-preHook-hook | final hook | 0.5-1 + passing tails | Rhodes/guitar answer + warm pad | late pocket,ghost hats | extended voicings,answer_only |
| lofi | A/A'/B/breakdown/return | B2 subtle | 0.5-1 loop | sparse EP/piano + dust/pad | soft swing/half-time | sparse broken/one-shot |

## Implementation Plan

1. Add `src/core/generation/newEngine/knowledge/styleArrangementRules.ts`.
   Store the four `StyleArrangementRule` objects there. Keep it pure data.
2. Extend arranger:
   - `formPlanner.ts` selects templates by `band.style`.
   - Add `functionTag` and `isFinalChorus` to `Section`.
   - `timePlanner.ts` uses style feel: rnb pocket, lofi soft swing, jazz swing.
   - `dynamicsPlanner.ts` emits bar/phrase curves, not only section scalar.
3. Extend harmony:
   - `harmonicRhythmTarget` becomes per phrase/bar.
   - Section recipe selects progression tags and cadence policy.
   - LOFI disables heavy tonicization; JAZZ enables ii-V/full turnaround; RNB enables color/passing tails.
4. Extend instrumentation:
   - `activityBySection` comes from `roleActivityByFunction`, not `activity=e` for all roles.
   - Add `textureByPhrase` or per-bar schedule input so verse2/final chorus can differ from verse1/chorus1.
   - Hook reservation uses section function and phrase slot, not every chorus phrase.
5. Extend groove/render:
   - Add `rnb` comp/drum patterns to `grooves.ts`.
   - Change lofi feel from straight 0.5 to soft swing 0.55-0.62.
   - Let `buildTextureSchedule` call rich `pickTextureForBar` with style, phrase cell, density, energy.
6. Tests/listening:
   - Snapshot form per style: pop has preChorus, jazz has AABA/head function, rnb has preHook/breakdown, lofi has loop/breakdown/return.
   - Assert role activity: e.g. lofi chorus/B never full 1.0 all roles; jazz pad mostly low; pop final chorus denser than chorus1.
   - Render smoke tests per style with no fatal auditor finding and nonempty expected roles.

## MVP Cut

If we want the fastest audible gain:

1. Add style-specific form templates and `preChorus` for pop/rnb.
2. Make `dynamicsPlanner` style-aware and final-chorus-aware.
3. Make `instrumentalPlanner` use role activity tables.
4. Add rnb groove and lofi swing.
5. Keep render's existing five generic textures as fallback, then later wire rich texture profiles.

This gives the user immediate song-level structure without waiting for full rich render support.
