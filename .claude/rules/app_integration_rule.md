# App Integration Rule — App / 嵌入式集成 API 契约

> **写 App 层 / 嵌入式集成前必读。改引擎内部规则不在本文件范畴(那是 `engine_architecture_rule.md`)。**

本文件描述 App 开发者 / 嵌入式开发者**只能**与引擎对接的"公开 API 表面",
不暴露引擎内部模块。任何越界 import(如直接调 `af2-engine/*`)视为反模式。

**2026-05-24 更新**:AF/MG 已删,AF2 为唯一内核。runPipeline 始终路由 Af2EngineFacade。

---

## §0 ⚠ Single Pipeline Principle(单一管道原则)— 核心原则

**所有 app(AuraBar / AuraJam / Q+H / 未来新 app)消费"离线全曲生成"必须**
**通过 `runPipeline()` 唯一入口。任何 app 不允许设计自己的平行 pipeline。**

理由:
- **一个 pipeline = 一份听感 baseline** — 跨 app 听感一致性
- **pipeline 调整自动同步到所有 app** — 改一处生效全场,不必每个 app 重写
- **Q+H 是 app 的调试窗口,不是独立 app** — 与 AuraBar / AuraJam 共享同一 pipeline

### 允许偏离(白名单,任何其他偏离都视为反模式)

| 例外 | 理由 |
|------|------|
| `scripts/*` 工具脚本可直接调 af2-engine 内部 | 离线 debug / 算法验证 |
| Jam 模式实时演奏(按键触发单音)| 不走"全曲生成",直接 AudioEngine.playNote |
| 未来 Live mode 走专用 LiveAccompanist | 实时流 ≠ 离线全曲(尚未实装)|

### 跨 app 共享配置(单一真理之源)

任何"用户可配置 + 多个 app 都要用"的状态,必须放在**模块级 store**,**不要**用各自的
useState / Context / 局部 ref。

| 共享配置 | Store 模块 |
|---------|-----------|
| 乐队选择(forcedBand / forcedGmPrograms)| `src/state/BandSelectionStore.ts` |
| MgStyle 选择(POP/JAZZ/BLUES/RNB)| `src/state/EngineSelectionStore.ts`(setMgStyle / getMgStyle)|
| 未来其他跨 app 状态 | 沿用模式新建 `src/state/XxxStore.ts` |

PipelineMonitor 点 Apply / 修改 → 写入 store;
AuraBar / AuraJam 等其他 app 在 `runPipeline` 调用时读 store。

### 违反信号(任一命中触发 review)

- ❌ 新 app 含 `XxxPipeline.ts` / `XxxGenerator.ts` 自定义生成模块
- ❌ 新 app 不经 runPipeline,直接调 `Af2EngineFacade` / `Af2Arranger` / `PianoIdiom` 等底层(scripts 除外)
- ❌ 新 app 跳过 runPipeline,自己拼装 `GeneratedTrack`
- ❌ 跨 app 状态分散在各 app 的 useState / 局部 Context
- ❌ 不同 app 对同 seed 产出不同结果

### 当前 3 个 app 的合规状态

- `src/components/PipelineMonitor.tsx`(Q+H)→ `runPipeline({ forcedBand, forcedGmPrograms })` ✓
- `src/apps/AuraBar/EndlessRadioManager.ts:triggerGeneration` → `runPipeline({ forcedStyleId, forcedBand: BandSelectionStore.getBand() })` ✓
- `src/apps/AuraJam/JamSessionManager.ts` → `runPipeline({ forcedStyleId, forcedBand, generation: {...motif...} })` ✓

---

## 1. 何时读本文件

任一条件命中,**先读完再动手**:

- 写 React 组件 / UI 层直接调引擎生成或播放
- 写嵌入式 C 端,需要对接 IR 数据结构
- 改 `AudioEngine` / `MidiConverter` / `PlaybackEngine` 的公开方法签名
- 加新 MIDI Mixer / 通道控制 / Visual 订阅
- 接入新的可视化层
- 实现"运行时改 MIDI 事件"功能

---

## 2. 三大公开入口

App / 嵌入式只通过以下三个入口与引擎对话。**禁止**绕过它们直接调引擎内部模块。

### 2.1 `PRNGManager.setSeed(seed: number)` — 决定性种子

每次生成开始前必调。**同 seed + 同 options → 同输出**(D-5 保证)。

```ts
import { PRNGManager } from '../core/utils/PRNG';
PRNGManager.setSeed(42);
```

### 2.2 `runPipeline(options: PipelineRunOptions)` — 一键生成

```ts
import { runPipeline } from '../core/generation/pipeline';
const { track, context } = runPipeline({
    forcedStyleId: StyleId.ModernPop,
    forcedBand: {
        mainInst: 'alex_piano',
        bass: 'frank_bass',
        drums: 'dave_drums',
        atmosphere: 'nina_pad',
    },
    forcedGmPrograms: { mainInst: 0 /* Acoustic Grand */ },
});
```

- 返回 `{ track: GeneratedTrack, context: MusicContext }`
- `track` 内容 **Pitch Space = RELATIVE**(未加 keyOffset)
- 调用前必须 setSeed
- 内部:**始终**路由 `Af2EngineFacade.generate(options)`(2026-05-24 后)

### 2.3 `AudioEngine.playSong(track, styleId, context)` — 播放

```ts
import { AudioEngine } from '../core/audio/AudioEngine';

AudioEngine.init();
await AudioEngine.playSong(track, context.style!.id, context);
```

- 内部走 `AbsoluteTransposer.arrange()`(K-2 唯一加 keyOffset 点)→ MidiConverter → PlaybackEngine
- async,Promise<void>
- 并发安全:快速连点 Play 只有最后一次会播
- **2026-05-24 后签名变更**:删 `generator` 参数(原 MelodyEngine 实例,已无作用)

---

## 3. 标准调用时序

```
App                    Engine
 │                       │
 │  setSeed(seed)        │
 │──────────────────────▶│  PRNGManager 锁定状态
 │                       │
 │  runPipeline(options) │
 │──────────────────────▶│  Af2EngineFacade.generate
 │                       │    Section/Conductor/Arranger/Composer/
 │                       │    Dispatcher/Reconciler/GM 8 层
 │◀──────────────────────│  { track (RELATIVE), context }
 │                       │
 │  playSong(...)        │
 │──────────────────────▶│  AbsoluteTransposer.arrange (K-2)
 │                       │  MidiConverter → PlaybackEngine
 │◀──────────────────────│  (Promise resolves)
 │                       │
 │  addVisualListener    │
 │──────────────────────▶│
 │◀──────────────────────│  VisualEvent (noteOn/noteOff/beat)
```

---

## 4. `PipelineRunOptions` 字段详解

| 字段 | 类型 | 必填 | 含义 |
|------|------|------|------|
| `forcedStyleId` | `StyleId` | 否 | 强制曲风(ModernPop=0 / ChillJazz=1 / NeoSoul=2)。不传则按 `allowedStyleIds` 抽 |
| `allowedStyleIds` | `StyleId[]` | 否 | 允许 PRNG 抽取的曲风池。不传则全 3 个 |
| `forcedBand` | `Partial<Record<BandRole, string \| null>>` | 否 | 强制乐队编制。Key 是 BandRole,value 是 musician ID 或 null(空槽)|
| `forcedGmPrograms` | `Partial<Record<BandRole, number>>` | 否 | per-role GM 程式号覆盖(0-127)。优先级最高 |
| `generation` | `GenerationOptions` | 否 | 进阶选项:`seed` / `length` / `userMotif` / `motifRole` / `detectedTimeSignature` / `detectedTonality`(Major/Minor)/ `detectedKey`(0-11 pc,K5 阶段 2026-05-24)/ `detectedSubStyle`(15 个 sub-style 字符串,P 阶段 2026-05-24)|

**`generation.detectedKey`(K5)**:user 显式指定 keyOffset,`0=C / 1=Db / 2=D / 3=Eb / 4=E / 5=F / 6=Gb / 7=G / 8=Ab / 9=A / 10=Bb / 11=B`。
越界(<0 / >11 / 非整数)→ ignore,fallback `af2_key_${seed}` PRNG 随机抽 0-11。
跟 `detectedTonality` 独立 — user 可单独锁 key 而保持 tonality 随机,或反之。

**`generation.detectedTonality`(K2 + K5)**:user 显式指定调性(`Tonality.Major` / `Tonality.Minor`)。未传 → fallback `af2_tonality_${seed}` PRNG(70% Major / 30% Minor)。

**`generation.detectedSubStyle`(P 阶段)**:user 显式指定 sub-style(15 个,跨 4 mgStyle 细分)。
有效取值取决于当前 mgStyle:
- POP:`'PopBallad' / 'SynthPop' / 'MaxMartinPop' / 'AsianPopWalkdown' / 'ModernStadiumPop' / 'ModernTrap'`
- JAZZ:`'JazzSwing' / 'JazzChromaticDrop' / 'BossaNova'`
- BLUES:`'DominantBlues' / 'MinorBlues' / 'BluesTurnaround'`
- RNB:`'NeoSoulRnB' / 'GospelNeoSoul' / 'MotownSoul'`

跨 mgStyle 不匹配(如 POP mgStyle 传 'JazzSwing')→ ignore,fallback `af2_substyle_${seed}` PRNG。
影响范围:仅 AccompGen textureType pool 选择(per-substyle primaryTextures 优先于 STYLE_TEXTURE_POOL)。
Arranger / Composer 仍 by mgStyle(P5 留扩)。

**BandRole 取值**:`'vocal' / 'mainInst' / 'accomp' / 'bass' / 'drums' / 'atmosphere'`

**Musician ID 当前注册的(MusicianRegistry.ts)**:
- 钢琴 4:`alex_piano` / `chloe_pop_piano` / `marcus_neosoul_piano` / `billy_bounce`
- 贝斯 2:`frank_bass` / `maya_slap_bass`
- 鼓 2:`dave_drums` / `jazz_brush_drummer`
- 氛围 1:`nina_pad`
- fallback:`stub_fallback`

**MgStyle**(影响 AF2 内部 Arranger/Composer/Conductor):
`'POP' | 'JAZZ' | 'BLUES' | 'RNB'`,通过 `EngineSelectionStore.setMgStyle()` 设置(不在 PipelineRunOptions 里)。

**互斥规则**:
- `forcedStyleId` 提供时 `allowedStyleIds` 忽略
- `forcedBand` 里给某 role 传 `null` = 强制空槽(那个乐器不演奏)
- `forcedGmPrograms` 不影响生成,只影响 MIDI 音色

---

## 5. 返回值结构

### 5.1 `GeneratedTrack`(Pitch Space: RELATIVE)

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
  accompaniment?: NoteData[];      // 钢琴 comping
  bass?: NoteData[];               // 电贝斯
  atmosphere?: NoteData[];         // Pad
}
```

⚠️ **NoteData.pitch ∈ RELATIVE 空间**(0-11 + 八度偏移,未加 keyOffset),
**禁止** App 层自己加 keyOffset —— 那是 `AbsoluteTransposer.arrange()` 的职责。

### 5.2 `MusicContext`

```ts
{
  keyOffset: number;
  tonality: Tonality;
  bpm: number;
  timeSignature: [number, number];
  ensemble?: EnsembleDraft;
  style?: StyleConfig;
  band?: Musician[];              // 实际就位的乐手数组
  gmProgramOverrides?: {...};
}
```

`playSong()` 需要原样把 `context` 传回去。

---

## 6. `AudioEngine` API 速查

### 6.1 播放控制
```ts
AudioEngine.init()                              // 初始化(playSong 内部会自动调)
AudioEngine.playSong(track, styleId, context)   // 注:无 generator 参数(2026-05-24 后)
AudioEngine.stop()
AudioEngine.getCurrentBeat() / getCurrentTick() / getBpm() / getPpq()
AudioEngine.getDuration() / getCurrentArrangedTrack() / getCurrentContext()
```

### 6.2 Channel / Part 静音控制
```ts
AudioEngine.muteChannel(channelNum, mute: boolean)
AudioEngine.isChannelMuted(channelNum): boolean
AudioEngine.setPartMute(partName, mute: boolean)
AudioEngine.isPartMuted(partName): boolean
AudioEngine.getPartChannels(): Partial<Record<PartName, number>>
```

### 6.3 运行时 MIDI 注入 / 替换(进阶)
```ts
AudioEngine.injectMidiEvent(ev)
AudioEngine.getChannelEvents(channel): MidiEvent[]
AudioEngine.replaceChannelEvents(channel, startTick, newEvents, endTick?)
```

### 6.4 Visual 订阅
```ts
AudioEngine.addVisualListener(listener)       // 已 mute 过滤后的事件
AudioEngine.addRawVisualListener(listener)    // 未过滤
AudioEngine.removeVisualListener / removeRawVisualListener
AudioEngine.setVisualsMode('all' | 'gameplay-only')
```

### 6.5 实时演奏(当前 NO-OP,未来 Live mode 实装)
```ts
AudioEngine.playNote / noteOn / noteOff / pitchBend
```

⚠️ 当前都是空实现,**不要在 App 里依赖这些做实时演奏功能**。

---

## 7. 错误处理

引擎层错误可能 throw。App 层必须 try-catch:

```ts
try {
    PRNGManager.setSeed(seed);
    const { track, context } = runPipeline(options);
    await AudioEngine.playSong(track, context.style!.id, context);
} catch (e) {
    if (e instanceof Error) console.error('Pipeline failed:', e.message);
    // 显示用户友好错误,不要崩溃
}
```

**常见 pitfall**:
- 忘记 setSeed → 输出非确定性
- `forcedStyleId` 传了枚举范围外的值 → throw
- `forcedBand` 里 musician ID 拼错 → musician not found(fallback 到 stub_fallback 或 silent)
- AudioEngine.playSong 在 SF2 加载完前调用 → `await startAudioContext()` 内部已处理,但要给 user 加 Loading UI

---

## 8. 可视化层接入

```ts
const listener = (ev: VisualEvent) => {
    if (ev.type === 'noteOn') {
        flashKey(ev.pitch);   // ev.pitch ABSOLUTE
    } else if (ev.type === 'beat') {
        tickProgressBar(ev.beat);
    }
};
AudioEngine.addVisualListener(listener);

useEffect(() => () => AudioEngine.removeVisualListener(listener), []);
```

**`addVisualListener` vs `addRawVisualListener`**:
- `add` — mute 过滤后,只收到实际可听的事件(适合大多数 UI)
- `addRaw` — 未过滤,所有事件(适合 debug / 全量可视化)

---

## 9. 嵌入式 C 端对接

**当前状态**:2026-05-24 删 AF/MG 后,C 端 sync gap 极大。
旧 golden seed baseline / `scripts/golden-seed.ts` 已废,新 baseline 待重建。

### 9.1 IR 类型 C struct 承诺

**`NoteData`**:
```c
struct NoteData {
    uint8_t pitch;       // 0-127
    uint8_t velocity;    // 0-127 (TS 端 0.0-1.0 float 折算)
    float onset;         // Beat position
    float duration;      // Beat length
    uint8_t flags;       // optional flags 打包
};
```

**`GeneratedChord`**:root(pc 0-11)+ quality(ChordQuality enum)+ startBeat + endBeat + voicing[]
(数组长度 0-7,RELATIVE 空间)

**`SectionMetadata`**:name + startBeat/endBeat + energyLevel + sectionType
(全 RELATIVE 空间)

### 9.2 改 IR 字段时

必须同步:
1. 更新 `ir/index.ts` / `types.ts` TypeScript 定义
2. C 端 struct 跟随更新
3. 重建听感 baseline + golden seed(自行决定 sha 方案)

### 9.3 当前不推荐与 C 端对账

旧 AF / MG pipeline 已删,golden seed 已废。C 端如需对账,需要先重建 baseline 工具链。

---

## 10. 禁止事项(App / 嵌入式层不能做)

- ❌ **import 引擎内部模块**:
  - `from '../core/generation/af2-engine/*'`(除 utility 类型外)
  - `from '../core/generation/pipeline/*'`(除 `pipeline/index.ts` 的 `runPipeline` 外)

- ❌ **绕过 AbsoluteTransposer 自己加 keyOffset** — K-2 铁律
- ❌ **修改 `track.chords[i].voicing`** — Composer 决定
- ❌ **修改 `track.melody[i].pitch`** — Pitch Space 已锁
- ❌ **自己实现 voicing / 织体决策 / casting 决策** — 引擎职责
- ❌ **跳过 setSeed 直接 runPipeline** — 输出非确定
- ❌ **playSong 期间改 currentArrangedTrack** — 改了无效
- ❌ **依赖实时演奏 API(noteOn/noteOff/playNote)** — 当前 no-op
- ❌ **重建 `MelodyEngine`** — 已删,Apps 直调 runPipeline + AudioEngine.playSong

---

## 11. 调用示例(完整 React 组件)

```tsx
import { useState, useEffect } from 'react';
import { PRNGManager } from '../core/utils/PRNG';
import { runPipeline } from '../core/generation/pipeline';
import { AudioEngine } from '../core/audio/AudioEngine';
import { StyleId } from '../core/generation/config/StyleFlags';
import type { VisualEvent } from '../core/audio/PlaybackEngine';

export function MyPlayer() {
    const [playing, setPlaying] = useState(false);

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
            await AudioEngine.playSong(track, context.style!.id, context);
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
| AF2 引擎内部架构 / 模块职责 | `engine_architecture_rule.md` |
| 跨模块同步规则 | `cross_sync_rule.md` |
| 嵌入式 C 端工程 | (单独的 C 工程仓库,以本文件 §9 IR 契约为准)|

---

## 维护承诺

- 改 AudioEngine / runPipeline / 任何公开 API 签名 → **必须**同步更新本文件
- 改 IR 类型字段 → 同步 §5 / §9 + 通知 C 端开发
- 加新 BandRole / Musician ID → 同步 §4
- 发现本文件描述与现状不符 → 优先更新本文件
