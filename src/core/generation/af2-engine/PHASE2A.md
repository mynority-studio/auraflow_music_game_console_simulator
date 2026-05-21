# AF2 Phase 2a 设计 — Bass + Pad + Drums 三件套

> **状态**:v0.2 — §10 四决策点已拍板,可启动实施。
> 本文件是 Phase 2a 的真理之源,完成后合并入 `ARCHITECTURE.md` v2.0。

## §1 范围

Phase 2a 把 AF2 从"钢琴 solo + 段落骨架"升级为"完整带节奏 / 低音 / 氛围的乐队"。
**核心约束:mg.melody / mg.chord / mg.bass 输出**继续 bit-exact 保留**,新增 3 件套不动 mg 任何东西**。

| 子项 | 输入源 | 是否触碰 mg | 复杂度 |
|------|--------|-----------|---------|
| Bass 换乐器(电贝斯) | mg.bass(已路由到 Bass 槽位) | 否(只改音色 + 通道) | 低 |
| Pad 自生成 | mg.chords 时间结构 + sections.energyLevel | 否(读 mg.chord 时间和 pc,自定 voicing) | 中 |
| Drums 自生成 | bpm + sections.energyLevel | 否(完全 AF 自生成) | 中 |

## §2 数据流(Phase 2a vs Phase 1)

```
Phase 1:
  SectionPlanner → MgKernelInvoker → SectionMapper → SlotRouter
                                                          ↓
                                            ┌─────────────┼─────────────┐
                                            ↓             ↓             ↓
                                        melody        chord         bass
                                            ↓             ↓             ↓
                                        PianoIdiom    PianoIdiom   PianoIdiom
                                            (Phase 1 全员钢琴直通)
                                            ↓             ↓             ↓
                                       装配 GeneratedTrack (atmosphere=[], drums=[])

Phase 2a:
  SectionPlanner → MgKernelInvoker → SectionMapper → SlotRouter
                       ↓                                   ↓
              ┌────────┴────────┐         ┌──────────────┼─────────────┐
              ↓                 ↓         ↓              ↓             ↓
            chords           sections   melody         chord         bass
              ↓                 ↓         ↓              ↓             ↓
              │                 │     PianoIdiom    PianoIdiom    BassIdiom (新)
              │                 │         ↓              ↓             ↓
              ↓                 ↓         │              │             │
       PadGenerator(新)   DrumGenerator(新)          │             │
              ↓                 ↓                       │             │
       padNotes            drumNotes                    │             │
              ↓                 ↓                       │             │
              └─────────────────┴───────────────────────┴─────────────┘
                                            ↓
                              装配 GeneratedTrack(atmosphere=padNotes, drums=drumNotes, electricBass=...)
```

**关键变化**:
1. SlotRouter 输出不变(part→slot 映射不动)
2. Realizer 阶段按 `musician.instrumentFamily` 分支:
   - `Piano` → PianoIdiom(直通,Phase 1 行为)
   - `Bass` → BassIdiom(新,直通 mg.bass + 路由 electricBass 通道)
3. 新增并行步骤 PadGenerator / DrumGenerator,消费 mg.chords + sections,产 atmosphere / drums

## §3 BassIdiom 设计

### 3.1 输入 / 输出

```ts
interface BassIdiomInput {
    notes: NoteData[];  // mg.bass 路由后的音符(已经在 chord+bass 合并前从 SlotRouter Bass 槽位接收)
}

interface BassIdiomOutput {
    notes: NoteData[];      // 直通 mg.bass(同输入)
    gmProgram: number;      // GM 33 (Acoustic Bass) — 给 gmProgramOverrides.electricBass
    channelKey: 'electricBass';  // audio path 走 electricBass 通道(已存在,Phase 1 未用)
}
```

### 3.2 算法

Phase 2a 简化:**纯直通**。不动 mg.bass 的 pitch / onset / duration / velocity。
唯一差异 = 输出通道(从 Phase 1 的 pianoLH 合并 → Phase 2a 独立 electricBass 通道)+ 音色(从 GM 0 钢琴 → GM 33 电贝斯)。

### 3.3 物理参数

```ts
export const BASS_INSTRUMENT_SPEC = {
    gmProgram: 33,           // Acoustic Bass(默认;persona 可覆盖到 34/35/43)
    rangeLo: 28,             // E1
    rangeHi: 67,             // G4
    eligibleSlots: [BandRole.Bass],
} as const;
```

### 3.4 Af2EngineFacade 改造点

Step 5 钢琴直通的 Bass 部分:
```ts
// Phase 1:
const renderedBass = PianoIdiom.realize(routed[BandRole.Bass].notes);

// Phase 2a:
const bassMusician = routed[BandRole.Bass].musician;
const renderedBass = bassMusician?.instrumentFamily === InstrumentFamily.Bass
    ? BassIdiom.realize(routed[BandRole.Bass].notes)
    : PianoIdiom.realize(routed[BandRole.Bass].notes);
```

Step 6 装配改造:
```ts
// Phase 1: accompaniment 合并 chord + bass
const accompaniment = [...renderedAccomp, ...renderedBass];
// + track.bass = []

// Phase 2a: bass 单独路由到 electricBass 通道
const accompaniment = renderedAccomp;
const electricBass = bassMusician?.instrumentFamily === InstrumentFamily.Bass
    ? renderedBass
    : [];
const accompanimentFinal = bassMusician?.instrumentFamily === InstrumentFamily.Bass
    ? accompaniment       // bass 单独走 electricBass 通道
    : [...accompaniment, ...renderedBass];  // 钢琴 bass 合并到 accompaniment(Phase 1 行为兼容)
// track.bass = electricBass

// gmProgramOverrides.electricBass = BASS_INSTRUMENT_SPEC.gmProgram
```

## §4 PadIdiom / PadGenerator 设计

### 4.1 输入 / 输出

```ts
interface PadGeneratorInput {
    chords: GeneratedChord[];      // mg.chords(时间结构 + voicing pc 池)
    sections: SectionMetadata[];   // 段落骨架(消费 energyLevel)
}

interface PadGeneratorOutput {
    notes: NoteData[];             // 长音 pad 事件,onset 升序
    gmProgram: number;             // GM 89 (Warm Pad) — 默认
    channelKey: 'atmosphere';
}
```

### 4.2 算法(Q1 C 决策 — 借用 mg SATB voicing + pad 音区适配)

```
for chord in mg.chords:
    # Step 1: 借用 mg.chord.voicing 已优化的 voice-leading
    voicing = chord.voicing.slice().sort((a, b) => a - b)  // 升序
    if voicing.length < 2: continue  // chord 缺音,跳过
    voicing.shift()  // 去最低音(bass)— 由 mg.bass 通道单独处理
    
    # Step 2: 整体八度移动到 pad 中心区(目标平均 pitch = 67 ≈ G4)
    avg = mean(voicing)
    while avg > 72: voicing = voicing.map(m => m - 12); avg -= 12
    while avg < 60: voicing = voicing.map(m => m + 12); avg += 12
    
    # Step 3: 边界 clamp 到 [PAD_RANGE_LO, PAD_RANGE_HI]
    voicing = voicing.filter(m => PAD_RANGE_LO <= m <= PAD_RANGE_HI)
    if voicing.length === 0: continue
    
    # Step 4: 段落 energy 决定 velocity
    sectionIdx = find section containing chord.startBeat
    energy = sections[sectionIdx].energyLevel  // 1-10
    velocity = clamp(0.3 + energy * 0.06, 0.3, 0.9)
    
    # Step 5: 整个 chord 区间一击长音
    duration = chord.endBeat - chord.startBeat
    for midi in voicing:
        emit NoteData(pitch=midi, onset=chord.startBeat, duration=duration, velocity=velocity)
```

**为什么这样设计**:
- 复用 mg 已经做好的 SATB voice-leading,不重写,符合"mg 优先"原则
- 整体八度移动 = 音乐上 octave equivalent,听感保留 mg 和声色彩 / 张力 / 紧张度
- 去最低音避免与 electricBass 通道重叠

### 4.3 物理参数

```ts
export const PAD_INSTRUMENT_SPEC = {
    gmProgram: 89,           // Warm Pad
    rangeLo: 48,             // C3(不沉到 bass 区)
    rangeHi: 84,             // C6(不顶到 melody 区)
    eligibleSlots: [BandRole.Atmosphere],
    voiceCount: 3,
} as const;
```

### 4.4 Af2EngineFacade 改造点

Step 4.5(新增):
```ts
const atmosphereMusician = routed[BandRole.Atmosphere].musician;
const padNotes = atmosphereMusician?.instrumentFamily === InstrumentFamily.Pad
    ? PadGenerator.generate({ chords: mg.chords, sections })
    : [];
```

装配:
```ts
track.atmosphere = padNotes;
// gmProgramOverrides.atmosphere = PAD_INSTRUMENT_SPEC.gmProgram
```

## §5 DrumIdiom / DrumGenerator 设计

### 5.1 输入 / 输出

```ts
interface DrumGeneratorInput {
    sections: SectionMetadata[];   // 段落骨架(消费 energyLevel + 总 beats)
    beatsPerMeasure: number;       // 默认 4
}

interface DrumGeneratorOutput {
    notes: NoteData[];             // GM Drum Map pitch(K-8 第三空间)
    // 无 gmProgram — drums 走 Channel 9 GM Drum Map 硬路由
    channelKey: 'drums';
}
```

### 5.2 算法(Phase 2a 简化版)

```
GM Drum Map:
  Kick=36, Snare=38, ClosedHihat=42, OpenHihat=46

for section in sections:
    bars = (section.endBeat - section.startBeat) / beatsPerMeasure
    energy = section.energyLevel  // 1-10

    for bar in 0..bars-1:
        barStartBeat = section.startBeat + bar * beatsPerMeasure
        
        # Kick on beat 1+3(基础)
        emit Kick at barStart + 0
        emit Kick at barStart + 2
        
        if energy >= 4:
            # Snare on beat 2+4
            emit Snare at barStart + 1
            emit Snare at barStart + 3
        
        if energy >= 6:
            # Closed Hihat 8th notes
            for i in 0..7:
                emit ClosedHihat at barStart + i * 0.5
        elif energy >= 3:
            # Closed Hihat 4分 (quarter)
            for i in 0..3:
                emit ClosedHihat at barStart + i
```

velocity 由 energy 决定(各类型不同基线):
- Kick:0.7 + energy * 0.02
- Snare:0.6 + energy * 0.03
- Hihat:0.4 + energy * 0.04

### 5.3 物理参数

```ts
export const DRUM_INSTRUMENT_SPEC = {
    eligibleSlots: [BandRole.Drums],
    // pitch 是 GM Drum Map 物理键位,K-8 第三空间,**禁止 keyOffset 加移**
} as const;
```

### 5.4 Af2EngineFacade 改造点

Step 4.6(新增):
```ts
const drumMusician = routed[BandRole.Drums].musician;
const drumNotes = drumMusician?.instrumentFamily === InstrumentFamily.Percussion
    ? DrumGenerator.generate({ sections, beatsPerMeasure: 4 })
    : [];
```

装配:
```ts
track.drums = drumNotes;
// 不设 gmProgramOverrides — drums 走 Channel 9 GM Drum Map 硬路由
```

## §6 UI 改动

### 6.1 PipelineMonitor disabledSlots

```ts
// Phase 1:engine === 'AF2' 时 disable Vocal / Drums / Atmosphere
disabledSlots={engine === 'AF2' ? [BandRole.Vocal, BandRole.Drums, BandRole.Atmosphere] : undefined}

// Phase 2a:engine === 'AF2' 时只 disable Vocal
disabledSlots={engine === 'AF2' ? [BandRole.Vocal] : undefined}
```

### 6.2 状态条文案

```ts
// Phase 1: 'AF2 fusion · MainInst/Accomp/Bass only'
// Phase 2a: 'AF2 fusion · 5 slots active (no vocal)'
```

## §7 musician 卡复用(无需新建)

| 槽位 | 推荐 musician 卡 | 复用方式 |
|------|------------------|----------|
| MainInst | alex_piano / billy_piano | Phase 1 已用,Phase 2a 沿用 |
| Accomp | alex_piano / billy_piano | Phase 1 已用,Phase 2a 沿用 |
| Bass | **frank_bass**(已存在) | Phase 2a 解锁 — 读 musician.instrumentFamily=Bass 触发 BassIdiom |
| Atmosphere | **nina_pad**(已存在) | Phase 2a 解锁 — 读 musician.instrumentFamily=Pad 触发 PadGenerator |
| Drums | **dave_drums**(已存在) | Phase 2a 解锁 — 读 musician.instrumentFamily=Percussion 触发 DrumGenerator |
| Vocal | (无) | Phase 2a 仍 disable |

**Phase 2a 只读 `musician.instrumentFamily`**,不消费 `musician.persona`。Persona DNA(colorBias / syncopationAssault / wakeK 等)留 Phase 2b+。

## §8 PRNG 策略

| 模块 | PRNG |
|------|------|
| MgKernelInvoker(mg 内核) | mg.Random + `mg_*` seedString(Phase 1 已定) |
| SectionPlanner | PRNGManager 抽模板(Phase 1 已定) |
| PadGenerator | **决定性 hash**(基于 chord index + voice index),**不消费 PRNG**。理由:pad 是和声 derived,无须随机 |
| DrumGenerator | **决定性,基于 energy + bar index**,**不消费 PRNG**。Phase 2b 加 fill / build-up 时再考虑引入 PRNG |

**好处**:Phase 2a 完全不增加 PRNG 消耗,不影响 mg 内 random stream,bit-exact 验收脚本继续通过。

## §9 验收锚点

1. ✅ **mg bit-exact 保留** — `scripts/af2-vs-mg-bitexact.ts`(需要重建,Phase 1 删了)对比同 seed:
   - AF2.melody = MG.melody(都来自 mg.melody)
   - AF2.accompaniment = MG.accompaniment(都来自 mg.chord)
   - AF2.electricBass(新) = MG.accompaniment 中 part='bass' 那部分(都来自 mg.bass)
   - AF2.atmosphere / drums 是 AF2 独有(MG 无),不参与对账
2. ✅ **AF 模式 0 regression** — `npm run golden-seed` 7/7 不变
3. ✅ **lint 0 errors**
4. ✅ **听感**:
   - BandSelection 全 piano → 听感等于 Phase 1(MG 一致)
   - BandSelection 加 frank_bass → 贝斯换电贝斯音色
   - BandSelection 加 dave_drums → 鼓型响起(Phase 2a 简易版)
   - BandSelection 加 nina_pad → pad 长音铺底
   - 任意组合 → 不破不冲

## §10 决策记录(2026-05-21 用户拍板)

- **Q1 Pad voicing**:**C — 借用 mg.chord.voicing(去 bass)+ 整体八度移动到 pad 中心区**。算法详见 §4.2。比简单"取前 3 个 pc"更忠实 mg 智慧,比"重新 SATB 安排"更轻便,折中最优。
- **Q2 Drums energy**:**A — 阈值跳变**(energy 1-3 仅 Kick / 4-5 加 Snare / 6+ 加 Hihat 8th)。Phase 2a 简化,Phase 2b 评估 B/C。
- **Q3 Bass GM**:**B — GM 34 Electric Bass Finger**。尊重 `frank_bass.defaultSound='Electric_Bass_Finger'` 字段语义。
- **Q4 Bass 通道**:**A — 独立 electricBass 通道**(V5.3 预留通道真正启用,独立 mix / pan / damp)。

## §11 实施任务清单(决策点拍板后启动)

1. 新建 `instruments/BassIdiom.ts`
2. 新建 `instruments/PadIdiom.ts` (含 PadGenerator)
3. 新建 `instruments/DrumIdiom.ts` (含 DrumGenerator,**改名避开** AF 端 `primitives/DrumIdiom.ts` 命名冲突)
4. 改 `Af2EngineFacade.ts`:Step 4.5/4.6 加 Pad/Drum 生成,Step 5 按 instrumentFamily 分支
5. 改 `PipelineMonitor.tsx`:disabledSlots 从 3 个缩到 1 个(只 Vocal)+ 状态条文案
6. 加 `scripts/af2-vs-mg-bitexact.ts` 回归脚本(Phase 1 删了),改造为支持 part 切片比对
7. lint + golden-seed + Q+H 听感验收

## §12 修订记录

- v0.1(2026-05-21):初稿,等用户拍板 §10 四决策点。
- v0.2(2026-05-21):§10 四决策点拍板 — Q1 C(借用 mg voicing)/ Q2 A(阈值跳变)/ Q3 B(GM 34)/ Q4 A(独立 electricBass 通道)。可启动 §11 实施。
