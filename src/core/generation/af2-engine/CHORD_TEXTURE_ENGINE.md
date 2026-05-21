# AF2 ChordTextureEngine 设计 v0.1 — Phase 2b 真理之源

> **状态**:草稿,等用户拍板 §5 schema 后开工实装。
> 完成后合并 ARCHITECTURE.md / 替代 PHASE2A.md 同级。

## §1 设计哲学

mg 的 38 个 textureType 是"枚举式 grammar"。**节奏维度可以压缩**为参数化族
+ 概率网格,**音高维度仍需 grammar primitive**(chord-aware / scale-aware /
next-chord-aware / cross-track-aware)。

ChordTextureEngine 是 AF2 自有的 chord 演绎层,**取代 mg.applyTexture 的调用**。
mg 的 `generateProgressions`(和声进行 + voicing)仍用,只换 chord 演绎层。

## §2 9 个音高 primitive(从 mg 提取为 AF2 纯函数库)

```ts
// af2-engine/instruments/chord-texture/PitchPrimitives.ts
export const PitchPrimitives = {
    /** 基础 bass — chord.bassMidi 直接读 */
    bassMidi(chord: ChordDef): number,
    
    /** 八度低 bass,带 BASS_RANGE.LOW 保护 */
    bassMidiLow(chord: ChordDef): number,
    
    /** 根音锚点(处理转位 — bass 可能是 3rd 或 5th,但 root anchor 永远是 1) */
    rootAnchor(chord: ChordDef): number,
    
    /** chord 全音(已 Smart Omit 过滤;**调用方负责传 already-filtered cM**) */
    chordVoicing(chord: ChordDef): number[],  // = chord.notesMidi
    
    /** quality-aware chord tones [root, 3rd, 5th, 7th] */
    chordTones(chord: ChordDef): number[],
    
    /** quality-aware 七度音程数 */
    seventhInterval(chord: ChordDef): 10 | 11,
    
    /** quality-aware 第三度 */
    thirdInterval(chord: ChordDef): 3 | 4,
    
    /** next-chord chromatic approach(±1 or ±2,random 决定) */
    approachTone(currentChord: ChordDef, nextChord: ChordDef, rng: Random): number,
    
    /** Boogie 1-3-5-6-b7 quality-aware pattern */
    boogiePattern(chord: ChordDef): number[],  // 8 个 MIDI 数(一 octave 内的偏移)
};
```

**关键约束**:
- 这些是**纯函数**,不依赖 class 状态
- Random 显式注入(不用 `this.random`)
- Smart Omit 由**调用方上游处理**,本层不重算 `chord.tensionState`

## §3 9 个子族(Phase 2b.1 范围)

### §3.1 子族 A — Sustained
```ts
{
    family: 'Sustained',
    bass_octave_double: boolean,  // true = Root_Octave;false = Single_Root
    velocity: number,             // 0.8 (Single) 或 0.85 (Octave)
}
```
**覆盖**:Single_Root, Root_Octave(2 个)

### §3.2 子族 B1 — PureWalk
```ts
{
    family: 'PureWalk',
    grid_points: number[],            // [0, 0.5, 1, 1.5] 等
    bass_offsets: ('root' | '5th' | '7th' | 'octave' | 'low_octave')[],
                                      // 等长于 grid_points
    velocity_sequence: number[],      // 等长
}
```
**覆盖**:Root_5_8, Root_7_5_8, Root_5_7_5, Root_Fifth_Bass, Root_Octave_Pulse(5 个)

### §3.3 子族 B2 — WalkingBass
```ts
{
    family: 'WalkingBass',
    middle_pick: 'random_chord_tone' | 'scale_pick',
    approach_enabled: true,
    approach_half_step_ratio: number,  // 0.6 默认
}
```
**覆盖**:Jazz_Walking_Bass(1 个)

### §3.4 子族 B3a — Bossa(Clave Driven)
```ts
{
    family: 'Bossa',
    clave_points: number[],           // [0, 0.75, 1.5, 2.5, 3.25] 3-2 clave
    bass_layer: 'fixed_2bar_cycle' | 'simple',
    chord_velocity: number,
}
```
**覆盖**:Bossa_Piano_Arp, Bossa_Clave_Comping(2 个)

### §3.5 子族 B3b — Hemiola(3-against-4)
```ts
{
    family: 'Hemiola',
    hemiola_points: number[],         // [0, 1.5, 3.0]
    velocity: number,
}
```
**覆盖**:Jazz_Waltz_Hemiola(1 个)

### §3.6 子族 E1 — PureStab
```ts
{
    family: 'PureStab',
    stab_positions: number[],         // [0.25, 0.75, 1.25, 1.75] 等
    stab_duration: number,            // 0.1-0.15(短促)
    bass_at_zero: boolean,            // 是否在 beat 0 出 bass
    velocity: number,
}
```
**覆盖**:Stabs, Syncopated_Stabs, Block_Chord_Staccato, RnB_16th_Funk_Stabs(4 个)

### §3.7 子族 E2 — GhostStab
```ts
{
    family: 'GhostStab',
    main_stab_period: number,         // 每 N beat 一个主 stab
    syncopate_probability: number,    // 20% 切分 jitter
    ghost_probability: number,        // 70% ghost 概率
    ghost_offset: number,             // ghost 时间偏移(主后)
}
```
**覆盖**:Blues_Stabs(1 个)

### §3.8 子族 E3 — ScratchSlap
```ts
{
    family: 'ScratchSlap',
    pattern_kind: 'offbeat_skip_strong' | 'slap_anchor_points',
    points: number[],                 // [0.25, 0.5, 0.75] 等 / [0, 0.75, 1.5, 2.25]
    short_duration: number,           // 0.1
}
```
**覆盖**:Funk_Guitar_Scratch, Slap_Bass_Line(2 个)

### §3.9 子族 E4 — ShuffleChop
```ts
{
    family: 'ShuffleChop',
    shuffle_offset: number,           // 0.66(Chicago)/ 0(直拍)
    grace_lead_ms: number | null,     // -0.05(Slow_Chops) / null
    chop_duration: number,            // 0.5
    velocity: number,
}
```
**覆盖**:Blues_Chicago_Shuffle, Blues_Slow_Chops(2 个)

## §4 ChordTextureEngine 主入口

```ts
// af2-engine/instruments/chord-texture/ChordTextureEngine.ts
export interface ChordTextureInput {
    chord: ChordDef;
    nextChord: ChordDef | null;
    startBeat: number;
    duration: number;
    family: FamilyName;
    params: FamilyParams;
    rng: Random;       // 显式注入
}

export const ChordTextureEngine = {
    apply(input: ChordTextureInput): NoteEvent[] {
        switch (input.family) {
            case 'Sustained':     return applySustained(input);
            case 'PureWalk':      return applyPureWalk(input);
            case 'WalkingBass':   return applyWalkingBass(input);
            case 'Bossa':         return applyBossa(input);
            case 'Hemiola':       return applyHemiola(input);
            case 'PureStab':      return applyPureStab(input);
            case 'GhostStab':     return applyGhostStab(input);
            case 'ScratchSlap':   return applyScratchSlap(input);
            case 'ShuffleChop':   return applyShuffleChop(input);
        }
    }
};
```

每个 `apply*` 函数 50-150 行,内部用 PitchPrimitives 取音高,按 params 生成
节奏 schedule。

## §5 textureType → family + params 映射表

(Phase 2b.1 内的 20 个 textureType 一表)

| TextureType | family | params |
|---|---|---|
| Single_Root | Sustained | `{ bass_octave_double: false, velocity: 0.8 }` |
| Root_Octave | Sustained | `{ bass_octave_double: true, velocity: 0.85 }` |
| Root_5_8 | PureWalk | `{ grid_points: [0, 0.5, 1], bass_offsets: ['root', '5th', 'octave'], velocity_sequence: [0.8, 0.7, 0.7] }` |
| Root_7_5_8 | PureWalk | `{ grid_points: [0, 0.5, 1, 1.5], bass_offsets: ['root', '7th', '5th', 'octave'], velocity_sequence: [0.8, 0.65, 0.65, 0.7] }` |
| Root_5_7_5 | PureWalk | `{ grid_points: [0, 0.5, 1, 1.5], bass_offsets: ['root', '5th', '7th', '5th'], velocity_sequence: [0.8, 0.6, 0.6, 0.6] }` |
| Root_Fifth_Bass | PureWalk | `{ grid_points: [0, 1], bass_offsets: ['root', '5th'], velocity_sequence: [0.8, 0.8] }` |
| Root_Octave_Pulse | PureWalk | `{ grid_points: [0, 0.5], bass_offsets: ['low_octave', 'root'], velocity_sequence: [0.8, 0.8] }`(循环) |
| Jazz_Walking_Bass | WalkingBass | `{ middle_pick: 'random_chord_tone', approach_enabled: true, approach_half_step_ratio: 0.6 }` |
| Bossa_Piano_Arp | Bossa | `{ clave_points: [0.5, 1.5, 2.0, 3.5], bass_layer: 'fixed_2bar_cycle', chord_velocity: 0.65 }` |
| Bossa_Clave_Comping | Bossa | `{ clave_points: [0, 0.75, 1.5, 2.5, 3.25], bass_layer: 'simple', chord_velocity: 0.7 }` |
| Jazz_Waltz_Hemiola | Hemiola | `{ hemiola_points: [0, 1.5, 3.0], velocity: 0.6 }` |
| Stabs | PureStab | `{ stab_positions: [0.25, 0.75, 1.25, 1.75], stab_duration: 0.1, bass_at_zero: true, velocity: 0.8 }` |
| Syncopated_Stabs | PureStab | `{ stab_positions: [0, 1.5], stab_duration: 1.0, bass_at_zero: true, velocity: 0.8 }` |
| Block_Chord_Staccato | PureStab | `{ stab_positions: [0, 1.0, 1.5], stab_duration: 0.1, bass_at_zero: true, velocity: 0.8 }` |
| RnB_16th_Funk_Stabs | PureStab | `{ stab_positions: [0.25, 0.75, 1.75, 2.25, 3.25], stab_duration: 0.15, bass_at_zero: true, velocity: 0.8 }` |
| Blues_Stabs | GhostStab | `{ main_stab_period: 2, syncopate_probability: 0.2, ghost_probability: 0.7, ghost_offset: 0.66 }` |
| Funk_Guitar_Scratch | ScratchSlap | `{ pattern_kind: 'offbeat_skip_strong', points: [0.25, 0.5, 0.75 ...], short_duration: 0.1 }` |
| Slap_Bass_Line | ScratchSlap | `{ pattern_kind: 'slap_anchor_points', points: [0, 0.75, 1.5, 2.25], short_duration: 0.15 }` |
| Blues_Chicago_Shuffle | ShuffleChop | `{ shuffle_offset: 0.66, grace_lead_ms: null, chop_duration: 0.5, velocity: 0.7 }` |
| Blues_Slow_Chops | ShuffleChop | `{ shuffle_offset: 0, grace_lead_ms: -0.05, chop_duration: 0.5, velocity: 0.85 }` |

(每个 `params` 是该子族 params interface 的实例)

## §6 集成路径

### §6.1 调用方改造(Af2EngineFacade)

```ts
// 当前(Phase 2a):
const mg = MgKernelInvoker.invoke(seed, style, key);  // 调 mg.generateProgressions + generateArrangement
// arrangement 内部用 mg.applyTexture

// Phase 2b.1:
const mgChords = MgKernelInvoker.invokeProgressionsOnly(seed, style, key);  // 只调 mg.generateProgressions
const events = ChordTextureEngine.applyForSong(mgChords, melodyEvents, songParams);
// AF2 自己用 ChordTextureEngine 生成 chord/bass 节奏
```

### §6.2 textureType 选择策略

mg 内部 `generateArrangement` 会按 style + bar + apex 等决定每个 bar 用哪个 textureType。
Phase 2b.1 暂时**保留 mg 的 textureType 选择逻辑**(只换演绎层),即:
- mg 决定 "bar N 用 Jazz_Walking_Bass"
- AF2 接收这个决定 → `mappingTable[textureType]` 查到 family+params → `ChordTextureEngine.apply()`

Phase 2c+ 可以让 AF2 自己决定 textureType 选择(取代 mg 的选 texture 逻辑)。

## §7 文件结构

```
af2-engine/instruments/chord-texture/
├── ChordTextureEngine.ts        # 主入口
├── PitchPrimitives.ts           # 9 个音高 primitive 纯函数
├── families/
│   ├── Sustained.ts             # applySustained
│   ├── PureWalk.ts              # applyPureWalk
│   ├── WalkingBass.ts           # applyWalkingBass
│   ├── Bossa.ts                 # applyBossa
│   ├── Hemiola.ts               # applyHemiola
│   ├── PureStab.ts              # applyPureStab
│   ├── GhostStab.ts             # applyGhostStab
│   ├── ScratchSlap.ts           # applyScratchSlap
│   └── ShuffleChop.ts           # applyShuffleChop
├── TextureTypeMapping.ts        # §5 mapping table
└── types.ts                     # 通用类型(FamilyName, FamilyParams union)
```

## §8 验收锚点

1. ✅ lint 0 errors
2. ✅ 每子族至少有 1 个 textureType 通过手动听感 PoC(听起来跟 mg 原版"差不多")
3. ✅ AF golden seed 跑(AF 路径不受影响,因为 AF 不用 mg.applyTexture)
4. ⚠️ **AF2 听感会偏离 mg-standalone**(用户已接受 Q1)
5. ⚠️ Phase 2b.1 还有 18 个 textureType 未覆盖,mg.applyTexture 仍保留(`unmapped` 时 fallback 到 mg 原实现)

## §9 修订记录

- v0.1(2026-05-21):基于 audit 报告 + 用户 9 子族细分。等启动实装。
