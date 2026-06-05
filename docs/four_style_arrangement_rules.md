# Producer-Audited Four-Style Arrangement Rules for Q+N

本文档把当前 newEngine 暴露的四个 macro 风格 `pop` / `jazz` / `rnb` / `lofi`
整理成 Q+N 管道可以消费的编曲规则范式。它不是替代 `melodygenerative`
的 render 织体,而是在 render 之前下发完整歌曲结构、段落功能、和声节奏、
密度曲线、乐器进出、留白、冲击点、动态避让和微时序策略。

本版按一线 producer / beatmaker / jazz rhythm-section 的听觉习惯重新审计:

- 避免“自动伴奏琴式”的全段均匀铺满。
- 避免把 hook 让位误写成高潮首拍静音。
- 避免把 R&B/Neo-Soul pocket 降维成“snare late”。
- 避免给 lofi 强套 pop 的 B 段高潮。
- 避免把 jazz walking bass 写成 root/5th 上下楼梯。

## Scope

当前仓库有两个风格体系:

- 旧 `StyleId`: `ModernPop` / `ChillJazz` / `NeoSoul`。
- newEngine/mg macro: `POP` / `JAZZ` / `RNB` / `LOFI`,同时知识库仍保留 `BLUES`。

本方案按 newEngine 注释里的 UI 四风格处理: `pop` / `jazz` / `rnb` / `lofi`。
`BLUES` 建议继续作为 harmony/groove 资料库和未来第五风格,暂不放进主规则。

## Q+N Upgrade Summary

Q+N 面板走的是 `src/core/generation/newEngine/`。因此本方案升级为
“分层下发协议”,不再只写风格经验:

- `StyleArrangementRules` 是 KB 真源,只存风格知识和默认策略。
- `Arranger` 把 KB 解析成结构意图:曲式、段落功能、phrase 功能、bar 级能量/密度、
  和声节奏目标。
- `InstrumentationPlanner` 把结构意图解析成编配意图:角色进出、每段/每 phrase 织体、
  register reservation、hook 让位、pad/comp/bass 的活动上限。
- `RenderCoordinator` 把编配意图解析成渲染指令:谁静音、谁降密度、comp 用 shell 还是
  answer、pad 是否允许 attack、drum fill 是否允许、groove 微时序如何偏移。

核心兼容原则:

1. `Section.role` 先不强行扩展。继续保留现有
   `intro | verse | chorus | bridge | outro`,避免打碎 harmony/render 旧调用。
2. 新增 `functionTag` 承载音乐语义。`preChorus / preHook / head / solo / breakdown`
   这类信息都通过 `functionTag` 下发。
3. 所有消费者先读 `functionTag`,没有时回退到 `role`。这样 Q+N 可以渐进升级。
4. `activityBySection` 必须变成可听层的指令,不能只停在 plan 字段里。

## Producer And Tutorial Anchors

这些资料只作为稳定音乐范式依据,具体参数以本引擎可控性为准。
文档里的规则不逐字绑定任何单一视频,而是抽取 producer 教程、song breakdown、
mixing 教程和 jazz/beatmaking 教学中的共识。

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
- [MusicRadar: Max Martin songwriting formula](https://www.musicradar.com/tutorials/music-theory-songwriting/the-verse-and-chorus-of-that-song-are-exactly-the-same-but-you-dont-really-notice-since-the-energy-of-the-chorus-is-completely-different-cracking-open-max-martins-uber-succesful-songwriting-formula):
  商业 pop 的副歌记忆点常靠重复、能量和编配差异放大,不一定靠完全换和弦。
- [Reverb: Sampled / gated synth chords](https://reverb.com/featured/sampled-gated-synth-chords-sound-recipes),
  [Elizabeth Records: Creating loops for lofi tracks](https://www.elizabethrecords.net/blog/creating-loops-for-lofi-tracks-tips-and-techniques):
  lofi/beatmaking 的 loop、chop、block chord、filter/mute 变化比线性 B 段更重要。
- [L.Dre official site](https://prodbyldre.com/pages/about-l-dre) 与
  [Waves: L.Dre beatmaking video](https://www.waves.com/different-sounding-beats-ldre-studioverse):
  作为 lofi/chill beat producer 工作流参考,强调声音个性、texture 和 beatmaking 操作。
- [The Jazz Piano Site: Walking Bass-lines](https://www.thejazzpianosite.com/jazz-piano-lessons/jazz-chord-voicings/walking-bass-lines/),
  [StudyBass: Chromatic Approach Notes](https://www.studybass.com/lessons/common-bass-patterns/chromatic-approach-notes/):
  walking bass 需要 target note、passing tone、chromatic/diatonic approach,不是 root/5th 映射。
- [MusicProductionWiki: Sidechain Compression Guide](https://musicproductionwiki.com/articles/sidechain-compression-guide.html),
  [Avid: Sidechain Compression](https://www.avid.com/pro-tools/user-guide/sidechain-compression):
  编曲避让应允许冲击点同时出现,再通过 ducking / automation / multiband carving 让出 sustain 空间。
- [Roast Your Mix: Frequency Masking](https://roastyourmix.com/learn/frequency-masking),
  [Automatic Minimisation of Masking in Multitrack Audio](https://arxiv.org/abs/1803.09960):
  频段掩蔽需要动态和编配共同处理,不能只靠固定 MIDI register 分区。
- [Does it Swing? Microtiming Deviations and Swing Feeling in Jazz](https://arxiv.org/abs/1904.03442),
  [ISMIR 2019 timing strategies](https://archives.ismir.net/ismir2019/paper/000095.pdf):
  micro-timing 是风格化、概率化、上下文相关的时间感,不是把某一轨固定拖后。

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

## Layered Contract V2

```ts
export type MacroStyle = 'pop' | 'jazz' | 'rnb' | 'lofi';

/**
 * functionTag 是 Q+N 的音乐语义主字段。
 * role 只保留为 legacy projection,用于现有 harmony/render fallback。
 */
export type SectionFunctionTag =
  | 'setup'
  | 'story'
  | 'build'
  | 'mainHook'
  | 'postHook'
  | 'head'
  | 'headOut'
  | 'contrast'
  | 'solo'
  | 'breakdown'
  | 'return'
  | 'cadence'
  | 'fade';

export type LegacySectionRole = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro';

export interface SectionRecipe {
  idHint: string;
  /**
   * 兼容投影。preChorus/preHook/breakdown/head/solo 都投影到这五类之一。
   * 真正音乐功能看 functionTag。
   */
  role: LegacySectionRole;
  functionTag: SectionFunctionTag;
  bars: readonly number[];
  hookPolicy: 'none' | 'light' | 'main' | 'call-response';
  repeatGroup?: string;
  /**
   * normalized bar/phrase shapes. Arranger 会按实际 bars resample 成每小节曲线。
   */
  energyShape: readonly number[];
  densityShape: readonly number[];
  harmonicRhythmShape: readonly number[]; // chords/bar by phrase or bar
  harmonyTags: readonly HarmonyTag[];
  climaxWeight: number; // 0..1,用于 final chorus / head-out / loop-open 等峰值识别
}

export type HarmonyTag =
  | 'popLoop'
  | 'preDominantBuild'
  | 'dominantPedal'
  | 'hookAnticipation'
  | 'relativeMinor'
  | 'iiV'
  | 'turnaround'
  | 'rhythmChanges'
  | 'neoSoulVamp'
  | 'backdoor'
  | 'passingTail'
  | 'lofiLoop'
  | 'sampleLoop'
  | 'chromaticApproach'
  | 'softCadence';

export interface PhraseDirective {
  sectionId: string;
  phraseId: string;
  functionTag: SectionFunctionTag | 'answer' | 'turnaround';
  hookStrength: 0 | 1 | 2 | 3; // 0 none,1 light,2 main,3 final/restatement
  restatementStrength: number;
  melodyDensityCeiling: number;
  compDensityCeiling: number;
  cadenceTarget: 'open' | 'half' | 'authentic' | 'loop' | 'tag';
}

export interface BarDirective {
  sectionId: string;
  barIndexGlobal: number;
  barIndexInSection: number;
  energy: number;
  density: number;
  chordsPerBar: 0.5 | 1 | 2;
  /**
   * 和声/织体提前量。0.5 = 在上一小节 beat 4& 提前进入,
   * 用于 pop/RNB 推背感;lofi 通常 0 或随机 off-grid chop。
   */
  anticipationBeats: 0 | 0.25 | 0.5;
  /**
   * 首拍冲击策略。高潮首拍默认 full/wall,不允许被 hook 让位规则抽空。
   */
  downbeatImpact: 'none' | 'light' | 'full' | 'wall';
  /**
   * attack 后的动态避让窗口。替代“首拍不弹”的错误做法。
   */
  duckAfterAttackBeats: number;
  fillPermission: 'none' | 'light' | 'strong';
  textureCell: 'establish' | 'develop' | 'lift' | 'cadence';
  loopMutation?: 'none' | 'muteDrum' | 'muteBass' | 'filterDown' | 'filterOpen' | 'vinylStop';
}

export interface TextureRecipe {
  textureCases: readonly string[];
  compingMode: 'full_voicing' | 'shell_only' | 'bass_plus_shell' | 'answer_only';
  melodySpace: 'high' | 'medium' | 'low';
  maxCompDensityWhenHook: number;
  padAttackPolicy: 'noneNearHook' | 'sustainOnly' | 'free';
}

export interface RoleActivityRecipe {
  bass: number;
  comp: number;
  pad: number;
  drum: number;
  lead: number;
}

export interface RoleActivityWindow {
  sectionId: string;
  role: 'bass' | 'comp' | 'pad' | 'drum' | 'lead';
  startBeat: number;
  endBeat: number;
  activity: number;  // 0 = mute, <0.25 = ghost/optional, 1 = full
  velocityScale: number;
  densityScale: number;
}

export interface RenderDirective {
  sectionId: string;
  role: 'bass' | 'comp' | 'pad' | 'drum' | 'lead';
  compingMode?: 'full_voicing' | 'shell_only' | 'bass_plus_shell' | 'answer_only';
  padAttackPolicy?: 'noneNearHook' | 'sustainOnly' | 'free';
  bassPocket?: 'kickLock' | 'walkingApproach' | 'syncopated' | 'rootPulse';
  walkingApproachPolicy?: WalkingApproachPolicy;
  drumPocket?: 'backbeat' | 'rideSwing' | 'latePocket' | 'softSwingHalfTime';
  timingOffsetMs?: { kick?: number; snare?: number; hat?: number; comp?: number };
  downbeatImpactPolicy?: 'stackedAttackThenDuck' | 'subtractiveLoop' | 'jazzTimeKeep' | 'none';
  dynamicDucking?: { targetRole: 'comp' | 'pad' | 'allHarmony'; afterAttackBeats: number; gainDb: number };
  allowSubBass?: boolean;
  subHarmonicSupport?: 'none' | 'octaveLayer' | 'saturation' | 'octaveLayerAndSaturation';
  filterPolicy?: 'none' | 'lowpassBed' | 'bandlimitSample' | 'highAirOnly';
  fillPolicy?: 'none' | 'sectionTailLight' | 'sectionTailStrong' | 'phraseTailOnly';
}

export interface WalkingApproachPolicy {
  /**
   * 不是每小节硬塞 chromatic note。概率控制用于避免机械爵士味。
   */
  approachProbability: number;
  chromaticProbability: number;
  enclosureProbability: number;
  diatonicStepProbability: number;
  commonToneOrPedalProbability: number;
  targetPriority: readonly ('root' | 'third' | 'fifth' | 'seventh')[];
}

export interface MicroTimingProfile {
  kickMs: readonly [number, number];   // negative = ahead
  snareMs: readonly [number, number];  // positive = behind
  hatSwingRatio: readonly [number, number];
  hatRandomMs: readonly [number, number];
  compMs: readonly [number, number];
}

export interface RegisterMaskPolicy {
  bassFundamental: readonly [number, number]; // allow E1/C#1 region when style needs weight
  bassBody: readonly [number, number];
  compBody: readonly [number, number];
  leadPresence: readonly [number, number];
  padMode:
    | 'lowMidBed'      // C3-C4 支撑,低通/低速度
    | 'airOnly'        // C5 以上空气层
    | 'wideDucked'     // 可重叠,但 attack 后 duck
    | 'off';
}

export interface ProducerSafetyRules {
  /**
   * Wall impact 是稀缺事件。用太多会变成每段都吵,没有峰值。
   */
  wallImpactMaxPerSong: number;
  wallImpactAllowedFunctions: readonly SectionFunctionTag[];
  microTimingMaxAbsMs: number;
  microTimingMode: 'probabilisticRange' | 'fixedForbidden';
  lofiProgressionChangePolicy: 'textureOnly' | 'rareTurnaroundOnly';
  walkingBassChromaticEveryBar: 'forbidden';
  subBassRequiresHarmonicSupport: boolean;
  duckingRequiredWhenPadOverlapsLead: boolean;
}

export interface StyleArrangementRule {
  style: MacroStyle;
  formTemplates: readonly SectionRecipe[][];
  roleActivityByFunction: Record<SectionFunctionTag, RoleActivityRecipe>;
  textureByFunction: Partial<Record<SectionFunctionTag, TextureRecipe>>;
  producerSafety: ProducerSafetyRules;
  drumPolicy: DrumPolicy;
  bassPolicy: BassPolicy;
  melodyPolicy: MelodyPolicy;
  harmonyPolicy: HarmonyPolicy;
}
```

Q+N 最小字段升级:

```ts
// arranger/ArrangementPlan.ts
export interface Section {
  id: SectionId;
  role: SectionRole;                 // legacy projection
  functionTag?: SectionFunctionTag;   // new semantic function
  bars: number;
  repeatGroup?: RepeatGroupId;
  hookPolicy: HookPolicy;
  climaxWeight?: number;
}

export interface Phrase {
  id: PhraseId;
  sectionId: SectionId;
  functionTag?: SectionFunctionTag | 'answer' | 'turnaround';
  hookStrength?: 0 | 1 | 2 | 3;
  // existing fields unchanged...
}

export interface ArrangementPlanData {
  // existing fields unchanged...
  barDirectives?: BarDirective[];
  phraseDirectives?: PhraseDirective[];
}

// instrumental/InstrumentationPlan.ts
export interface InstrumentationPlanData {
  // existing fields unchanged...
  activityWindows?: RoleActivityWindow[];
  renderDirectives?: RenderDirective[];
}
```

## Style KB Producer Defaults

这些默认值建议直接放进 `styleArrangementRules.ts`。它们是审计后的硬安全阀,
用于防止风格规则被过度机械化。

```ts
export const producerSafetyByStyle: Record<MacroStyle, ProducerSafetyRules> = {
  pop: {
    wallImpactMaxPerSong: 2,
    wallImpactAllowedFunctions: ['mainHook', 'postHook', 'return'],
    microTimingMaxAbsMs: 18,
    microTimingMode: 'probabilisticRange',
    lofiProgressionChangePolicy: 'textureOnly',
    walkingBassChromaticEveryBar: 'forbidden',
    subBassRequiresHarmonicSupport: true,
    duckingRequiredWhenPadOverlapsLead: true,
  },
  rnb: {
    wallImpactMaxPerSong: 1,
    wallImpactAllowedFunctions: ['mainHook', 'return'],
    microTimingMaxAbsMs: 35,
    microTimingMode: 'probabilisticRange',
    lofiProgressionChangePolicy: 'textureOnly',
    walkingBassChromaticEveryBar: 'forbidden',
    subBassRequiresHarmonicSupport: true,
    duckingRequiredWhenPadOverlapsLead: true,
  },
  jazz: {
    wallImpactMaxPerSong: 0,
    wallImpactAllowedFunctions: [],
    microTimingMaxAbsMs: 22,
    microTimingMode: 'probabilisticRange',
    lofiProgressionChangePolicy: 'textureOnly',
    walkingBassChromaticEveryBar: 'forbidden',
    subBassRequiresHarmonicSupport: false,
    duckingRequiredWhenPadOverlapsLead: true,
  },
  lofi: {
    wallImpactMaxPerSong: 0,
    wallImpactAllowedFunctions: [],
    microTimingMaxAbsMs: 28,
    microTimingMode: 'probabilisticRange',
    lofiProgressionChangePolicy: 'textureOnly',
    walkingBassChromaticEveryBar: 'forbidden',
    subBassRequiresHarmonicSupport: true,
    duckingRequiredWhenPadOverlapsLead: true,
  },
};
```

## Layer Parsers

### Arranger Parser

输入: `BandSpec.style` + `StyleArrangementRules[style]`。

输出:

- `sections`: 保持 legacy `role`,新增 `functionTag`。
- `phrases`: 用 `functionTag` 分配 hook/answer/cadence/solo,不要再把整个 chorus 都标 hook。
- `barDirectives`: 每小节的 energy/density/chordsPerBar/fillPermission。
- `harmonicRhythmTarget`: 仍保留旧 `chordsPerBarBySection`,但新增后续字段可从
  `barDirectives` 读细分值。
- `climaxMap`: 由 `climaxWeight` 选峰,不是简单最后一个 chorus。

解析规则:

- `role` 用于旧引擎兼容;`functionTag` 用于音乐语义。
- Arranger 在输出前必须应用 `producerSafety`:限制 wall 次数、限制 lofi progression change、
  避免把所有 chorus 都标成最高峰。
- Pop/RNB 的 pre-chorus/preHook 投影为 `role='bridge'`,但 `functionTag='build'`。
- Jazz 的 head/headOut 投影为 `verse/chorus`,但 hook 语义看 `head/headOut`。
- Lofi 的 loopA/loopA_muted/return 投影为 `verse`,loopA_open 可投影为 `chorus`
  但 `functionTag` 仍是 `return/mainHook` 的轻量 loop-open,不是传统 B 段换和弦。

### Instrumentation Parser

输入: `ArrangementPlan.sections/phrases/barDirectives` + style rule。

输出:

- `activityWindows`: 角色级进出和强弱,render 必须消费。
- `textureBySection`: 保持旧字段,作为 fallback。
- `textureByPhrase` 或 future `textureWindows`: 让 verse2/finalHook/loop-open 与第一次不同。
- `melodyReservationPlan`: 只给 main hook/head-out/final hook 强制 anchor,answer 句不强制。
- `renderDirectives`: compingMode、padAttackPolicy、bassPocket、drumPocket、fillPolicy。

解析规则:

- activity 不是能量的复制。不同风格同样 energy 下,角色活动不同。
- pad 的 activity 与 attack policy 分开:可以 sustain,也可以在 impact downbeat attack,
  但 attack 后必须 duck 或转为 sustain-only。
- `hookStrength >= 2` 时,首拍允许 full attack;从首拍后 0.25-1.5 拍开始,
  comp/pad density ceiling 降到 0.35-0.45,而不是在首拍静音。
- 如果 `downbeatImpact='wall'`,Instrumentation 必须同时下发 `dynamicDucking`;
  如果 pad 与 lead register 重叠,必须下发 `filterPolicy` 或 `padMode`。
- Jazz 默认 comp shell/rootless,但 solo 段允许更高 answer density。
- Lofi 的 activity 主要做 mute/unmute,不是把所有轨同时推高。

### Render Parser

输入: `InstrumentationPlan.activityWindows/renderDirectives` +
`ArrangementPlan.barDirectives` + `HarmonicPlan`。

必须新增消费能力:

- `activityWindows`: 每个 renderer 在生成前判断该 beat 的 role activity。
  `activity=0` 静音,低 activity 降低 hit 数/velocity。
- `compingMode`: comp renderer 在 span/window 级切换 full/shell/answer。
- `padAttackPolicy`: pad renderer 只在非 impact 窗口禁止 hook 附近新 attack;
  impact downbeat 可 attack,随后 duck/sustain-only。
- `fillPermission/fillPolicy`: drum renderer 不再每个 section tail 都 fill。
- `drumPocket/timingOffsetMs`: RNB micro-timing matrix、lofi hat swing/soft late、jazz ride swing。
- `bassPocket`: pop kickLock,jazz walkingApproach,rnb syncopated,lofi rootPulse。
- `producerSafety`: render 最后一关要 clamp micro-timing、限制 wall、校验 sub-bass harmonic support。

render fallback:

- 没有 `activityWindows` 时,沿用当前 lineup 全轨渲染。
- 没有 `renderDirectives` 时,沿用当前 style groove + textureSchedule。
- 没有 `barDirectives` 时,沿用 `energyBySection`。

## Global Impact and Masking Rules

这些规则替换旧版“Anti-Clash”。现代制作里的避让不是把 attack 拿掉,
而是允许关键瞬间全层下砸,再用时值、速度、register、ducking 把 sustain 让出来。

1. Hook/downbeat 优先级不是“旋律独奏”,而是
   `impact stack -> transient clear -> sustain duck -> melody readable`。
   `hookStrength >= 2` 的第一拍必须允许 kick/crash/bass/comp/pad 同时 attack。
2. 禁止在高潮首拍使用纯 `answer_only` 或纯 `shell_only`。正确策略是
   `stackedAttackThenDuck`:首拍 full/wide voicing,随后 0.5-1.5 拍内 comp/pad 降 velocity、
   缩 duration 或掉中高声部。
3. Pad 不固定占 MIDI 55-84。它只能处于三种模式之一:
   `lowMidBed`(C3-C4 低速支撑)、`airOnly`(C5 以上空气层)、`wideDucked`
   (可与 lead 重叠但必须 duck)。默认禁止 pad 在 lead presence 区持续无遮罩。
4. Bass 必须允许 sub-fundamental。pop/RNB/lofi 的 bass fundamental 范围至少开放
   MIDI 28-43,body 可在 36-55。Jazz upright 可较高,但也不能机械锁 36-52。
5. 频段冲突不靠固定 MIDI 窗口解决。应靠 `RegisterMaskPolicy + dynamicDucking +
   noteDurationShortening`。同 pitch/register 的 m2/m9 clash 仍需 resolver 处理。
6. 和声推进不应全在小节线。Pop/RNB 可使用 `anticipationBeats=0.5` 在 beat 4& 提前换和弦
   或提前打 comp/bass pickup;Jazz 可在 bar 4 用趋近音预告下一和弦;Lofi 可用 off-grid chop。
7. Drum fill 不是每段尾巴默认出现。fill 必须读 `fillPermission`,并且副歌/drop 前允许强 fill,
   lofi 大多数 transition 只做 mute/filter/noise,不做 showy fill。

## Producer Safety Gate

这些是防止规则被机器过度执行的安全阀。它们比风格偏好优先级更高。

1. `wall` 不是普通 chorus 默认值。每首最多 1-2 次,只允许 final hook/final chorus/drop reveal
   或 head-out peak。普通 hook 首拍用 `full`,不是 `wall`。
2. `downbeatImpact='wall'` 必须伴随 `dynamicDucking`。没有 ducking 的 wall 只会制造糊墙,
   不会制造高级感。
3. `microTimingProfile` 必须是概率区间。禁止把 kick/snare/hat/comp 写成每个事件固定同一 ms 偏移。
   固定偏移会从 pocket 变成“错拍”。
4. RNB/Neo-Soul 的 pocket 需要多轨相互拉扯:
   kick 可轻微 ahead,snare behind,hat swing/jitter,comp lay-back。单独拖 snare 视为失败。
5. Jazz walking bass 需要 approach intent,但不能每小节都 chromatic。render 应在
   chromatic approach、diatonic step、enclosure、common tone/pedal 之间按上下文抽样。
6. Lofi 禁止靠“明显换到 B 段 progression”制造高潮。允许 melodic fragment、register、
   filter、mute、noise、drum/bass open 来做变化。
7. Sub-bass 开放 MIDI 28-43 时必须提供听感支撑:
   saturation、octave layer 或可感知的 upper harmonic。否则小音箱上会消失。
8. Pad 与 lead presence 重叠时,必须满足至少一个条件:
   `airOnly`、`lowpassBed`、`wideDucked`、短 duration、低 velocity。否则判定为 masking risk。
9. `answer_only` 是 phrase 内让位策略,不是 climax downbeat 策略。
   main hook 第一拍如果没有 comp/bass/drum 的共同确认,会听起来塌。

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
  普通 chorus 首拍 `downbeatImpact='full'`;final chorus 或首次 drop reveal 才能升级为 `wall`,
  且必须随后 duck harmony sustain。
- Bridge: energy 0.50-0.70,换和声重心或 register,最后 2 小节 build 回 final chorus。
- Final chorus: chorus2 +0.05 energy,允许 pad/高八度 hook/鼓 crash。

Harmony:

- Verse/chorus 可共享四和弦 schema,但 chorus 靠 register、rhythm、density 变大。
- Pre-chorus 禁止用会提前落地的 `IV-V-iii-vi` 作为结尾。它可以出现在 chorus/hook,
  但 pre-chorus 尾部必须悬停:长 V、V(sus)、IV pedal、ii-V、V/V->V,
  或 dominant pedal 不解决。目标是憋住,不是提前给 vi 的假落点。
- Bridge 可用 relative minor、borrowed iv/bVI/bVII,但 tension carrier 主要给 melody。
- Pop/RNB hook 可在上一小节 beat 4& 使用 `anticipationBeats=0.5`,
  让和弦或 bass pickup 提前推入下一小节。

Instrumentation:

- Intro: pad/soft piano motif,drum 可静音或只 hat/filter。
- Verse1: lead + sparse comp + bass;drum backbeat 轻。
- Verse2: 加 pad 或更明确 bass/kick。
- Pre: comp 八分/切分逐渐加密,pad swell,drum open hat 或 fill tail。
- Chorus: full backbeat,bass 锁 kick,comp/pad 在首拍全层 attack,随后 duck。
- Melody: chorus phrase 0 和 phrase 1 应高度镜像复读(A/A' 或 A/A),phrase 2 后才 answer、
  post-hook 或 variation。商业 pop 的 hook 不能只打一遍就让位。

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

- Bass: walking quarter notes 不是 root/5th 映射。它必须是 target-driven:
  beat 1 明确当前和弦 root/3rd/5th 之一,beat 2-3 走 chord tone/scale tone,
  beat 4 必须有“面向下一和弦目标音”的意图。render 在 chromatic approach、enclosure、
  diatonic step、common tone/pedal 之间选择;chromatic 是高价值选项,但不能每小节硬塞。
  连续 4 小节没有任何 beat-4 approach intent 的 walking bass 视为失败。
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

- Comp: Rhodes/FM EP/clean guitar 风格,以短句回答旋律;但 hook 的 "The One" 必须 full chord
  或 wide color attack,之后再进入 answer/切分。禁止 hook 第一拍 `answer_only`。
- Bass: syncopated,可比 pop 更旋律化,但必须保持 pocket。kick 相关低音可微 ahead,
  与 snare behind 形成前后拉扯。
- Drum: 不是简单地后拖军鼓。RNB/Neo-Soul 使用 micro-timing matrix:
  kick -8..-2ms ahead,snare +12..+35ms behind,hat swing 0.58..0.65 且有不规则微抖,
  comp/Rhodes +8..+25ms lay-back。所有偏移必须按事件概率抽样并受
  `microTimingMaxAbsMs` 限制。单独拖 snare 会听成节奏不稳。
- Pad: warm pad 小音量支撑,不做明显节奏。
- Melody: conversational,允许 melisma/slide/anticipation;伴奏在尾音后回答。

## Lofi Rule

音乐目标:短 loop 的层次加减、低能量但有结构、dusty/soft/swing/off-grid 的亲密感。

推荐曲式:

```text
loopA(8) -> loopA_muted(8) -> loopA_open(8)
-> breakdown/filter(4/8) -> loopA_return(8) -> outro/fade(4/8)
```

Arranger:

- 不用强 verse-chorus 爆发,也不写明显 B 段换和弦高潮。Lofi 是 beat-making /
  loop culture,结构靠 mute/unmute、滤波、drum/bass 进出、noise/chop 变化、
  melody fragment 复现。
- Energy 0.20-0.65,density 0.15-0.55;高潮也不超过 0.75。
- Harmonic rhythm 多数 0.5-1 chord/bar;整曲通常复用同一个 4/8 小节 loop。
  允许 A/A' 变化 voicing 或 mute,不优先换 progression。
- Phrase cell: establish -> develop -> lift -> cadence,但 lift 是 texture lift,不是 pop build。

Harmony:

- maj7/m7/m9/9sus/common-tone/soft ii-V-I;少用强 V7alt。
- 允许 unresolved color 和 loop-back;tonicization/borrrowed planner 概率应接近 0。
- `harmonyTags` 默认 `lofiLoop | sampleLoop | softCadence`。同一 loop 的声部进行和共同音
  比新和弦数量更重要。

Instrumentation:

- Comp: 优先 block/cluster/chop aesthetic:粘稠柱式和弦、短采样块、off-grid pad-hit。
  Broken 10th 只能作为少量 lofi-piano 子风格,不能做默认。
- Bass: optional pulse,少音符,跟 kick 或 chord roots。
- Drum: soft boom-bap/half-time,hat swing 0.55-0.62,力度变化更大。
- Pad/noise: 作为 texture layer,attack 稀少;可在 breakdown 独立出现。
- Melody: short motif、碎片化、留白多;允许 A/A' 的微型旋律变体,
  但不允许通过明显 B 段主旋律把 lofi 推成 pop song。高密度旋律不应和 comp 同时滚动。

## Style Matrix

| Style | Form Shape | Energy Peak | Harmony Rhythm | Main Texture | Drum Rule | Comp Rule |
| --- | --- | --- | --- | --- | --- | --- |
| pop | verse-pre-chorus-chorus | final chorus downbeat | verse 1,pre suspended,chorus anticipates | attack stack + ducked sustain | backbeat 2/4,eighth hat | full hit then duck,no empty hook |
| jazz | AABA/head-solo-head | solo late or head-out | 1-2 chords/bar,turnaround split | walking approach + sync comp | ride swing,pedal hat 2/4 | shell/rootless,answer melody |
| rnb | vamp-verse-preHook-hook | final hook The One | 0.5-1 + passing tails | Rhodes/guitar full hit then answer | kick ahead/snare behind/hat swing | extended voicings,not answer on beat 1 |
| lofi | loop/mute/filter/return | subtle loop-open | same 4/8 loop mostly | block/chop cluster + dust | soft swing/half-time | sparse block/chop,not default broken 10th |

## Q+N Rollout Plan

### Phase 1: Arranger understands form semantics

Files:

- `src/core/generation/newEngine/knowledge/styleArrangementRules.ts`
- `src/core/generation/newEngine/arranger/ArrangementPlan.ts`
- `src/core/generation/newEngine/arranger/formPlanner.ts`
- `src/core/generation/newEngine/arranger/phrasePlanner.ts`
- `src/core/generation/newEngine/arranger/dynamicsPlanner.ts`

Changes:

1. Add pure KB file `styleArrangementRules.ts`.
2. Add `functionTag?: SectionFunctionTag`, `climaxWeight?: number` to `Section`.
3. Add `functionTag?`, `hookStrength?` to `Phrase`.
4. Add optional `barDirectives` and `phraseDirectives` to `ArrangementPlanData`.
5. Change `planForm(style)` to choose style-specific templates.
6. Change `phrasePlanner`:
   - Pop: phrase 0 and 1 of main hook are mirrored hook statements(A/A' or A/A);
     phrase 2+ becomes answer/post-hook/variation.
   - RNB: hook phrase 0 lands "The One" with full color attack; later phrases answer/call-response.
   - Jazz: head/headOut phrases can be hook-like,solo phrases are not hook.
   - Lofi: all sections reuse the same loop motif; loop-open may expose melody fragment,
     but no pop-style B hook.
7. Change `dynamicsPlanner`:
   - Build `barDirectives` from recipe shapes.
   - Keep old `energyBySection` and `chordsPerBarBySection` as averaged fallback.

Acceptance:

- Q+N trace shows `functionTag` beside section ids.
- Pop/RNB output contains build/preHook semantics.
- Jazz output has head/bridge/headOut or equivalent function tags.
- Lofi output has loop/mute/filter/return semantics without chorus energy = 0.9.

### Phase 2: Instrumentation understands role activity

Files:

- `src/core/generation/newEngine/instrumental/InstrumentationPlan.ts`
- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`
- `src/core/generation/newEngine/generation/trace.ts`

Changes:

1. Add `activityWindows?: RoleActivityWindow[]`.
2. Add `renderDirectives?: RenderDirective[]`.
3. `buildInstrumentationPlan` reads section/phrase function tags,not only section role.
4. Keep old `activityBySection`,but compute it from activity windows average.
5. Hook reservation:
   - force only `hookStrength >= 2`;
   - answer/postHook only light reservation;
   - jazz solo has no forced hook anchor.
6. Trace prints role activity per section,not just texture.

Acceptance:

- Lofi breakdown can mute drum or bass through activity window.
- Jazz pad is mostly inactive except intro/outro/ballad-like setup.
- Pop final chorus adds pad/drum/comp activity relative to chorus1.
- RNB hook does not make every role max activity; comp/pad stay supportive.

### Phase 3: Render consumes directives

Files:

- `src/core/generation/newEngine/render/renderCoordinator.ts`
- `src/core/generation/newEngine/render/accompanimentRenderer.ts`
- `src/core/generation/newEngine/render/bassRenderer.ts`
- `src/core/generation/newEngine/render/drumRenderer.ts`
- `src/core/generation/newEngine/render/padRenderer.ts`
- `src/core/generation/newEngine/render/textureSchedule.ts`
- `src/core/generation/newEngine/knowledge/grooves.ts`

Changes:

1. Add a small runtime query:

```ts
function roleActivityAt(
  instrumentation: InstrumentationPlan,
  role: InstrumentRoleName,
  beat: number,
): RoleActivityState
```

2. All renderers call it before emitting notes:
   - `activity <= 0`: skip;
   - `activity < 0.25`: emit sparse/ghost only;
   - otherwise scale velocity and density.
3. `renderCoordinator` builds fill bars from `barDirectives.fillPermission`,not every section tail.
4. `buildTextureSchedule` uses `barDirectives.energy/density/textureCell` instead of recomputing
   from section role only.
5. `accompanimentRenderer` accepts span/window compingMode:
   - `full_voicing`: current full/wide;
   - `shell_only`: current shell;
   - `answer_only`: skip attacks during melody windows,except bars whose `downbeatImpact`
     is `full/wall`;
   - `bass_plus_shell`: only one/two guide tones.
6. `padRenderer` consumes `padAttackPolicy`.
7. `grooves.ts` adds `rnb` comp/drum patterns and lofi soft swing policy.

Acceptance:

- Activity window changes are audible in MIDI note count and velocity.
- `hookStrength >= 2` produces stacked downbeat attack,then audible comp/pad ducking.
- Lofi has fewer notes than pop at comparable duration.
- RNB has its own groove path,not default groove.

### Phase 4: Harmony consumes section intent

Files:

- `src/core/generation/newEngine/knowledge/progressions.ts`
- `src/core/generation/newEngine/harmony/progressionSelector.ts`
- `src/core/generation/newEngine/harmony/harmonyEngine.ts`

Changes:

1. Add `functionTag` and `harmonyTags` to progression selection input.
2. Let `barDirectives.chordsPerBar` override section average when assembling spans.
3. Pop/RNB build sections prefer `preDominantBuild`.
4. Jazz head/bridge/headOut prefer AABA/rhythm/iiV/turnaround prototypes.
5. Lofi sections prefer `lofiLoop`,soft cadence,and low tonicization budget.

Acceptance:

- Pop pre/build resolves into chorus with stronger D/T setup.
- Jazz bridge uses contrasting cycle/ii-V behavior.
- RNB has passing tails/backdoor without overfiring full jazz tonicization.
- Lofi does not get forced chorus `2 chords/bar`.

## Minimum Audible Cut

最快能让 Q+N 听到结构提升的切片:

1. `functionTag` + style-specific forms。
2. `barDirectives` with energy/density/chordsPerBar/fillPermission。
3. `activityWindows` consumed by renderers。
4. `downbeatImpact + dynamicDucking + anticipationBeats` consumed by renderers。
5. RNB micro-timing matrix + lofi loop/mute behavior。
6. Hook phrase 改成 pop A/A' 镜像复读,不是只让第一 phrase 做 main hook。

这些完成后,本方案就不是文档级建议,而是 Q+N 管道可解析、可下发、可听见的编曲规则。
