# App Integration Rule — App / 嵌入式集成 API 契约

> **写 App 层 / 嵌入式集成前必读。改引擎内部规则不在本文件范畴(那是 `engine_architecture_rule.md`)。**

本文件描述 App 开发者 / 嵌入式开发者**只能**与引擎对接的"公开 API 表面",
不暴露引擎内部模块。任何越界 import(如直接调 `primitives/*` 或 `realizers/*`)
视为反模式。

---

## §0 ⚠ Single Pipeline Principle(单一管道原则)— 核心原则

**所有 app(AuraBar / AuraJam / Q+H / 未来新 app)消费"离线全曲生成"必须**
**通过 `runPipeline()` 唯一入口。任何 app 不允许设计自己的平行 pipeline。**

理由:
- **一个 pipeline = 一份 golden seed baseline** — 跨 app 听感一致性
- **pipeline 调整自动同步到所有 app** — 改一处生效全场,不必每个 app 重写
- **Q+H 是 app 的调试窗口,不是独立 app** — 与 AuraBar / AuraJam 共享同一 pipeline

### 允许偏离(白名单,任何其他偏离都视为反模式)

| 例外 | 理由 | 例子 |
|------|------|------|
| `scripts/*` 验证脚本可直接调 Idiom.render | 单元测试 / 算法 debug,非用户面向生成 | `walking-verify.ts` / `voice-pattern-verify.ts` |
| Phase 8+ Live 模式走 `LiveAccompanist` | 实时流 ≠ 离线全曲,语义不同 | (Phase 8+ 实装) |
| Jam 模式实时演奏(按键触发单音) | 不走"全曲生成",直接 AudioEngine.playNote | AuraJam 用户按键 |

### 跨 app 共享配置(单一真理之源)

任何"用户可配置 + 多个 app 都要用"的状态,必须放在**模块级 store**,**不要**用各自的
useState / Context / 局部 ref。

| 共享配置 | Store 模块 |
|---------|-----------|
| 乐队选择(forcedBand / forcedGmPrograms) | `src/state/BandSelectionStore.ts` |
| 引擎选择(AF / MG 双引擎切换) | `src/state/EngineSelectionStore.ts` |
| 未来其他跨 app 状态(motif / mood / etc.) | 沿用模式新建 `src/state/XxxStore.ts` |

PipelineMonitor 点 Apply / 修改 → 写入 store;
AuraBar / AuraJam 等其他 app 在 `runPipeline` 调用时读 store。

### 引擎双路由(2026-05-21 起新增,符合 Single Pipeline 原则)

`runPipeline()` 内部可基于 `EngineSelectionStore.getEngine()` 路由到 AF / MG
不同子引擎,**app 侧调用契约保持不变**:

- AF(默认):走 Stage 1-5 + Conductor 完整管线
- MG:跳过 weather / band / musicians,直接调 melodygenerative 引擎(Phase 0:stub)

**为什么这不违反 Single Pipeline**:
- app 入口仍是唯一 `runPipeline({...})`,返回类型仍是 `{ track, context }`
- 内部分流由 store 全局控制,所有 app 同时跟随,不存在"app A 走 AF / app B 走 MG"的分裂
- Q+H 顶部 Engine Toggle 改 store → AuraBar / AuraJam 下次生成自动跟随

**MG 模式下 app 的合理行为**:
- `forcedBand` / `forcedGmPrograms` 在 MG 内被忽略(MG 无乐手概念)
- UI 应在 MG 模式下 disable 相关控件(参照 PipelineMonitor 实现)
- AuraBar / AuraJam 无需特别适配 — 它们读 BandSelectionStore 但 MG 内会忽略

### 违反信号(任一命中触发 review)

- ❌ 新 app 含 `XxxPipeline.ts` / `XxxGenerator.ts` 自定义生成模块
- ❌ 新 app 不经 runPipeline,直接调 `PianoAccompIdiom` / `BassIdiom` / `DrumIdiom` / `AtmosphereRenderer` 等底层(scripts 除外)
- ❌ 新 app 跳过 runPipeline,自己拼装 `GeneratedTrack`
- ❌ 跨 app 状态分散在各 app 的 useState / 局部 Context,而不是模块级 Store
- ❌ 不同 app 对同 seed 产出不同结果(只可能由 Single Pipeline 违规导致)

### 当前 3 个 app 的合规状态(基线时间 2026-05-20)

- `src/components/PipelineMonitor.tsx:playSeed` → `runPipeline({ forcedBand, forcedGmPrograms, ... })` ✓
- `src/apps/AuraBar/EndlessRadioManager.ts:triggerGeneration` → `runPipeline({ forcedStyleId, forcedBand: BandSelectionStore.getBand(), ... })` ✓
- `src/apps/AuraJam/JamSessionManager.ts` → `runPipeline({ forcedStyleId, forcedBand: ..., generation: { processedUserMotif, ... } })` ✓

`MelodyEngine.generateFullSong` 是 thin wrapper(留作向后兼容,新代码请直调 `runPipeline`)。

---

## 0. 何时读本文件

任一条件命中,**先读完再动手**:

- 写 React 组件 / UI 层直接调引擎生成或播放
- 写嵌入式 C 端,需要对接 IR 数据结构 / 黄金种子 baseline
- 改 `AudioEngine` / `MidiConverter` / `PlaybackEngine` 的公开方法签名
- 加新的 MIDI Mixer / 通道控制 / Visual 订阅
- 接入新的可视化层
- 实现"运行时改 MIDI 事件"功能(如 in-game 静音、调节)

---

## 1. 三大公开入口

App / 嵌入式只通过以下三个入口与引擎对话。**禁止**绕过它们直接调引擎内部模块。

### 1.1 `PRNGManager.setSeed(seed: number)` — 决定性种子

每次生成开始前必调。**同 seed + 同 options → 同输出**(D-5 保证)。

```ts
import { PRNGManager } from '../core/utils/PRNG';
PRNGManager.setSeed(42);  // 或任何 32-bit 整数
```

### 1.2 `runPipeline(options: PipelineRunOptions)` — 一键生成

```ts
import { runPipeline } from '../core/generation/pipeline';
const { track, context } = runPipeline({
    forcedStyleId: StyleId.ModernPop,
    forcedBand: { mainInst: 'alex_piano', bass: 'frank_bass', drums: 'dave_drums', atmosphere: 'nina_pad' },
    forcedGmPrograms: { mainInst: 0 /* Acoustic Grand */ },
});
```

- 返回 `{ track: GeneratedTrack, context: MusicContext }`
- `track` 内容 **Pitch Space = RELATIVE**(未加 keyOffset)
- 调用前必须 setSeed,否则结果不确定

### 1.3 `AudioEngine.playSong(track, styleId, context, generator)` — 播放

```ts
import { AudioEngine } from '../core/audio/AudioEngine';
import { MelodyEngine } from '../core/generation/MelodyEngine';

AudioEngine.init();
const generator = new MelodyEngine();
await AudioEngine.playSong(track, context.style!.id, context, generator);
```

- 内部走 `AbsoluteTransposer.arrange()`(K-2 唯一加 keyOffset 点)→ MidiConverter → PlaybackEngine
- async,返回 Promise<void>
- 并发安全:快速连点 Play 只有最后一次会播

---

## 2. 标准调用时序

```
App                    Engine
 │                       │
 │  setSeed(seed)        │
 │──────────────────────▶│  PRNGManager 锁定状态 A
 │                       │
 │  runPipeline(options) │
 │──────────────────────▶│  Stage 1-5 + Conductor + Reconciler
 │◀──────────────────────│  { track (RELATIVE), context }
 │                       │
 │  playSong(...)        │
 │──────────────────────▶│  AbsoluteTransposer.arrange → RELATIVE→ABSOLUTE (K-2)
 │                       │  MidiConverter.convert → MidiEvent[]
 │                       │  PlaybackEngine.loadSong → play
 │◀──────────────────────│  (Promise resolves when loading done)
 │                       │
 │  [可选] subscribe     │
 │  addVisualListener    │
 │──────────────────────▶│
 │◀──────────────────────│  VisualEvent (note on/off, beat tick)
```

---

## 3. `PipelineRunOptions` 字段详解

| 字段 | 类型 | 必填 | 含义 |
|------|------|------|------|
| `forcedStyleId` | `StyleId` | 否 | 强制曲风(ModernPop=0 / ChillJazz=1 / NeoSoul=2)。不传则按 `allowedStyleIds` 抽 |
| `allowedStyleIds` | `StyleId[]` | 否 | 允许 PRNG 抽取的曲风池。不传则全 3 个 |
| `forcedBand` | `Partial<Record<BandRole, string \| null>>` | 否 | 强制乐队编制。Key 是 BandRole,value 是 musician ID 或 null(空槽) |
| `forcedGmPrograms` | `Partial<Record<BandRole, number>>` | 否 | per-role GM 程式号覆盖(0-127)。优先级最高 |
| `generation` | `GenerationOptions` | 否 | 进阶选项:`seed` / `length` / `userMotif` / `motifRole` / `detectedTimeSignature` / `detectedTonality` |

**BandRole 取值**:`'vocal' / 'mainInst' / 'accomp' / 'bass' / 'drums' / 'atmosphere'`

**Musician ID** 查 `src/core/generation/idioms/MusicianRegistry.ts`(当前 MVP:`alex_piano` / `frank_bass` / `dave_drums` / `nina_pad` / `billy_piano` / `flash_master` 等)。

**互斥规则**:
- `forcedStyleId` 提供时 `allowedStyleIds` 忽略
- `forcedBand` 里给某 role 传 `null` = 强制空槽(那个乐器不演奏)
- `forcedGmPrograms` 不影响生成,只影响 MIDI 音色

---

## 4. 返回值结构

### 4.1 `GeneratedTrack`(Pitch Space: RELATIVE)

```ts
{
  chords: GeneratedChord[];        // 全曲和弦(含 voicing,RELATIVE)
  vocal?: NoteData[];              // 人声(预留,V1 通常空)
  melody: NoteData[];              // 主旋律(RELATIVE pitch)
  counterMelody?: NoteData[];      // 副旋律(预留)
  drums?: NoteData[];              // 鼓(GM Drum Map 第三空间,不参与 keyOffset)
  bpm: number;
  key: string;                     // 调号字符串(如 "C", "Db")
  keyOffset: number;               // 0-11,加到 RELATIVE pitch 得 ABSOLUTE
  tonality: Tonality;
  timeSignature: [number, number];
  sections: SectionMetadata[];
  processedUserMotif?: NoteData[];
  accompaniment?: NoteData[];      // 钢琴 RH comping
  bass?: NoteData[];               // 电贝斯
  atmosphere?: NoteData[];         // Pad/Strings
  // ... 其他字段见 types.ts:531
}
```

⚠️ **NoteData.pitch ∈ RELATIVE 空间**(0-11 + 八度偏移,未加 keyOffset),
**禁止** App 层自己加 keyOffset —— 那是 `AbsoluteTransposer.arrange()` 的职责。

### 4.2 `MusicContext`

```ts
{
  keyOffset: number;
  tonality: Tonality;
  bpm: number;
  timeSignature: [number, number];
  grooveDNA: number[];
  ensemble?: EnsembleDraft;
  style?: StyleConfig;
  band?: Musician[];              // 实际就位的乐手数组
  gmProgramOverrides?: {...};
}
```

`playSong()` 需要原样把 `context` 传回去,内部要靠它做 AbsoluteTransposer 转置。

---

## 5. `AudioEngine` API 速查

### 5.1 播放控制
```ts
AudioEngine.init()                    // 初始化(playSong 内部会自动调,可省)
AudioEngine.playSong(track, styleId, context, generator)
AudioEngine.stop()
AudioEngine.getCurrentBeat() / getCurrentTick() / getBpm() / getPpq()
AudioEngine.getDuration() / getCurrentArrangedTrack() / getCurrentContext()
```

### 5.2 Channel / Part 静音控制
```ts
AudioEngine.muteChannel(channelNum, mute: boolean)
AudioEngine.isChannelMuted(channelNum): boolean
AudioEngine.setPartMute(partName, mute: boolean)   // partName: 'melody' / 'pianoRH' / 'bass' / 'drums' / 'atmosphere' / ...
AudioEngine.isPartMuted(partName): boolean
AudioEngine.getPartChannels(): Partial<Record<PartName, number>>
```

### 5.3 运行时 MIDI 注入 / 替换(进阶)
```ts
AudioEngine.injectMidiEvent(ev)
AudioEngine.getChannelEvents(channel): MidiEvent[]
AudioEngine.replaceChannelEvents(channel, startTick, newEvents, endTick?)
```

### 5.4 Visual 订阅
```ts
AudioEngine.addVisualListener(listener)       // 已 mute 过滤后的事件(对应实际可听音)
AudioEngine.addRawVisualListener(listener)    // 未过滤,所有事件
AudioEngine.removeVisualListener / removeRawVisualListener
AudioEngine.setVisualsMode('all' | 'gameplay-only')
```

### 5.5 Mixer / Focus(预留)
```ts
AudioEngine.getMixerState()
AudioEngine.setMixerParam(category, param, value)
AudioEngine.setFocusTrack(trackType)           // 当前 no-op,预留
AudioEngine.setDrumDucking(enabled)            // 当前 no-op,预留
```

### 5.6 实时演奏(当前 NO-OP,Phase 5 实装)
```ts
AudioEngine.playNote / noteOn / noteOff / pitchBend
```

⚠️ 当前都是空实现,**不要在 App 里依赖这些做实时演奏功能**。Phase 5 后才能用。

---

## 6. 错误处理

引擎层错误以 `throw` 方式抛出(`HarmonyCoreError` / `CastingEngineError` / `ConductorError` 等),
App 层必须 try-catch:

```ts
try {
    PRNGManager.setSeed(seed);
    const { track, context } = runPipeline(options);
    await AudioEngine.playSong(track, context.style!.id, context, generator);
} catch (e) {
    if (e instanceof Error) console.error('Pipeline failed:', e.message);
    // 显示用户友好错误,不要崩溃
}
```

**常见 pitfall**:
- 忘记 setSeed → 输出非确定性,且 D-5 快照不对齐
- `forcedStyleId` 传了枚举范围外的值 → throw
- `forcedBand` 里 musician ID 拼错 → `CastingEngineError: musician not eligible`
- `forcedBand.mainInst === null && forcedBand.accomp === null` → 钢琴轨完全空,生成出无和声段(目前不报错,V2 会做"角色升降"自动补位)
- AudioEngine.playSong 在 SF2 加载完前调用 → `await startAudioContext()` 内部已处理,但要给 user 加 Loading UI

---

## 7. 可视化层接入

```ts
const listener = (ev: VisualEvent) => {
    if (ev.type === 'noteOn') {
        // ev.pitch (ABSOLUTE), ev.channel, ev.velocity, ev.tick, ev.beat
        flashKey(ev.pitch);
    } else if (ev.type === 'beat') {
        // beat tick callback
        tickProgressBar(ev.beat);
    }
};
AudioEngine.addVisualListener(listener);

// 卸载时务必移除
useEffect(() => () => AudioEngine.removeVisualListener(listener), []);
```

**`addVisualListener` vs `addRawVisualListener`**:
- `add` —— mute 过滤后,只收到实际可听的事件(适合大多数 UI)
- `addRaw` —— 未过滤,所有事件(适合 debug / 全量可视化)

---

## 8. 嵌入式 C 端对接

### 8.1 黄金种子作为对账 baseline

TS 端用 `npm run golden-seed` 生成 `scripts/golden-seed-output.json`(含 7 个 seed 在 3 种风格下的 sha256 + 状态快照)。

C 端用 `python scripts/json2c.py` 转换 → `scripts/golden_seed_data.h`,
作为头文件 #include 进 C 工程。C 端跑同 seed,sha 必须 bit-exact 一致。

**任一端的引擎改动 → 必须重跑 `npm run golden-seed` + `python scripts/json2c.py`,
两端 sha 重新对账。**

### 8.2 PRNG 算法承诺

```
LCG: state = (state * 1664525 + 1013904223) mod 2^32
```

C 端 PRNG 必须 1:1 实现此公式(含整数溢出截断),状态字 `state_a/b/c/d` 在
不同 stage 的 snapshot 必须与 TS 端 sha 一致。

### 8.3 IR 类型对应的 C struct 承诺

**`NoteData`** 在 `ir/index.ts` 头部已注明 C++ 移植对照:

```c
struct NoteData {
    uint8_t pitch;       // 0-127
    uint8_t velocity;    // 0-127 (TS 端 0.0-1.0 float 折算)
    float onset;         // Beat position
    float duration;      // Beat length
    uint8_t flags;       // isGraceNote / isUserMotif / pitchBend... 打包
    // pitchBend / pitchBendDuration / fadeOutDuration: 可选字段单独 struct
};
```

**`GeneratedChord`**:root + quality + startBeat + endBeat + voicing[],
voicing 数组长度 0-6,空间 RELATIVE。

**`SectionMetadata`**:name + startBeat/endBeat + energyLevel + sectionType + ...
全部 RELATIVE 空间。

⚠️ **改 IR 字段** → 必须同步:
1. 更新 `ir/` TypeScript 定义
2. 跑 sync-to-c 流程(`/sync-to-c` 命令)
3. 重新 `npm run golden-seed` 并对账

### 8.4 风格包资源对账

`config/styles/*.ts` 中的 BPM 范围 / 和声池 / personas 等参数需要在 C 端有
对应的常量表。当前 sync-to-c 流程负责生成 C 头。

---

## 9. 禁止事项(App / 嵌入式层不能做)

- ❌ **import 引擎内部模块**(以下都不行):
  - `from '../core/generation/primitives/*'`
  - `from '../core/generation/realizers/*'`
  - `from '../core/generation/pipeline/*'`(除 `pipeline/index.ts` 的 `runPipeline` 外)
  - `from '../core/generation/ir/harmonic-skeleton'`(内部 IR,不公开)
  
- ❌ **绕过 AbsoluteTransposer 自己加 keyOffset** —— K-2 铁律
- ❌ **修改 `track.chords[i].voicing`** —— Phase 1 后由 VoicingProcessor 决定
- ❌ **修改 `track.melody[i].pitch`** —— Pitch Space 已锁
- ❌ **自己实现 voicing / 织体决策 / casting 决策** —— 这是引擎职责
- ❌ **跳过 setSeed 直接 runPipeline** —— 输出非确定,无法重现 bug
- ❌ **playSong 期间改 currentArrangedTrack** —— PlaybackEngine 已加载,改了无效
- ❌ **依赖 实时演奏 API (noteOn/noteOff/playNote)** —— 当前 no-op,Phase 5 才实装

---

## 10. 调用示例(完整 React 组件)

```tsx
import { useState, useEffect, useRef } from 'react';
import { PRNGManager } from '../core/utils/PRNG';
import { runPipeline } from '../core/generation/pipeline';
import { AudioEngine } from '../core/audio/AudioEngine';
import { MelodyEngine } from '../core/generation/MelodyEngine';
import { StyleId } from '../core/generation/config/StyleFlags';
import type { VisualEvent } from '../core/audio/PlaybackEngine';

export function MyPlayer() {
    const [playing, setPlaying] = useState(false);
    const generator = useRef(new MelodyEngine()).current;

    useEffect(() => {
        const listener = (ev: VisualEvent) => {
            if (ev.type === 'noteOn') console.log('🎵', ev.pitch);
        };
        AudioEngine.addVisualListener(listener);
        return () => AudioEngine.removeVisualListener(listener);
    }, []);

    const onPlay = async () => {
        try {
            PRNGManager.setSeed(Date.now() & 0xFFFFFFFF);
            const { track, context } = runPipeline({
                forcedStyleId: StyleId.ChillJazz,
                forcedBand: {
                    mainInst: 'alex_piano',
                    bass: 'frank_bass',
                    drums: 'dave_drums',
                    atmosphere: 'nina_pad',
                },
            });
            setPlaying(true);
            await AudioEngine.playSong(track, context.style!.id, context, generator);
        } catch (e) {
            console.error('Play failed:', e);
            setPlaying(false);
        }
    };

    const onStop = () => {
        AudioEngine.stop();
        setPlaying(false);
    };

    return (
        <div>
            <button onClick={onPlay} disabled={playing}>Play</button>
            <button onClick={onStop} disabled={!playing}>Stop</button>
        </div>
    );
}
```

---

## 附录:不在本文件范畴的内容

| 主题 | 去哪儿读 |
|------|---------|
| 引擎内部架构 / 模块职责 / 重构 SOP | `engine_architecture_rule.md` |
| Reconciler v1→v2 升级路径 | `src/core/generation/pipeline/Reconciler.ts` 文件头 |
| 钢琴 voicing 算法细节 | `src/core/generation/primitives/VoicingProcessor.ts` |
| 黄金种子工具链使用 | `scripts/golden-seed.ts` + `scripts/json2c.py` |
| 风格包配置格式 | `src/core/generation/config/styles/*.ts` |
| 嵌入式 C 端工程 | (单独的 C 工程仓库,以本文件 §8 IR 契约为准) |

---

## 维护承诺

- 改 AudioEngine / runPipeline / 任何公开 API 签名 → **必须**同步更新本文件
- 改 IR 类型字段 → 同步 §4 / §8 + 通知 C 端开发
- 加新 BandRole / Musician ID → 同步 §3
- 发现本文件描述与现状不符 → 优先更新本文件(它是 App 开发的真理之源)
