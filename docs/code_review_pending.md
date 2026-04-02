# Code Review 待处理清单

> **依据** — Music Generation Pipeline Rule（最高约束文档，32 条硬约束 + 3 条 guideline）
> **生成时间** — 2026-04-02
> **状态** — 本 session 已完成大部分合规修复，以下为仍待处理的剩余项

---

## 背景：已完成的修复

本轮 code review 已完成以下修复（tsc 零错误通过）：

- ✅ 浮点 `===` → epsilon 容差（D-4）
- ✅ ChordQuality / Tonality / SectionType 字符串 → 数值枚举（T-1/T-2）
- ✅ StyleFlag 位掩码替代 style.id.includes() 子串匹配（T-1）
- ✅ Map/Set 业务查表 → Record/数组（P-1）
- ✅ PRNG 初始种子修复（D-1）
- ✅ `any` 类型消除（T-3）
- ✅ ToplineEngine S-2 合规：moodId 参数化、beatsPerBar 参数化、globalContext 读取移除
- ✅ TextureMapper / Orchestrator：TextureRenderContext 显式传递
- ✅ Piano/Drum/Guitar/String/Synth/CounterMelody/VocalHarmony Idiom：S-2 参数化
- ✅ BasePianoIdiom / BlockChordPianoIdiom / BaseCounterMelodyIdiom：S-2 合规

---

## 待处理：S-2 GlobalContext 残余读写

### 优先级说明

| 标记 | 含义 |
|------|------|
| 🔴 **写操作** | GlobalContext.updateCurrentSlice / initializeNewEra — 违反 S-1/L-3 中的"禁止共享可变全局变量" |
| 🟡 **读操作** | GlobalContext.currentXxx — 违反 S-2 |
| 🟢 **渐进 fallback** | `renderCtx?.X ?? GlobalContext.X` — 已加入参数路径，fallback 仅在 renderCtx 为 null 时触发，优先级较低 |

---

### 1. GlobalContext 写操作（最高优先级）

#### `MelodyEngine.ts` line 84
```typescript
GlobalContext.initializeNewEra(style, bpm, keyOffset, tonality, timeSig, finalMoodId);
```
- **现状**：MelodyEngine 调用此方法设置全局状态，后续子模块通过 GlobalContext 读取
- **期望**：完全消除后，initializeNewEra 可废弃（context 通过返回值 MusicContext 传递）
- **依赖**：需要先清理所有下游读取，再移除此写操作

#### `ToplineEngine.ts` line 386
```typescript
GlobalContext.updateCurrentSlice(section, chords[0], sectionGroove);
```
- **现状**：生成每个段落时写入 GlobalContext，供 BassBassIdiom / SteadyBassIdiom 等读取 grooveDNA
- **期望**：grooveDNA 通过 idiomPreferences.sections 传递（已为 Piano/Drum 建立通道）
- **依赖**：需要同步修复 Bass Idiom 系列读取

#### `Orchestrator.ts` lines 503, 714
```typescript
GlobalContext.updateCurrentSlice(activeSection, chord, activeSection.grooveDNA || [0,1,2,3]);
GlobalContext.updateCurrentSlice(sec, track.chords[0], sec.grooveDNA || [0,1,2,3]);
```
- **现状**：Orchestrator 在编配循环中写入 GlobalContext，供 Bass/Riff Idiom 读取
- **期望**：通过 idiomPrefsWithSections（已含 sections 字段）传递，Bass Idiom 自行 lookup

---

### 2. Bass Idiom 系列（中优先级）

这些 Bass Idiom 通过 `IBassIdiom.apply(chords, idiomPreferences)` 接口接收数据，
`idiomPreferences` 已通过 Orchestrator 注入 `sections` 和 `timeSignature`（同 Piano/Drum 路径）。

#### `BaseBassIdiom.ts` lines 29, 40, 63
```typescript
const activeSection = GlobalContext.getActiveSection();           // line 29
const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;  // line 40
const isValidTriggerPoint = beat % 1 === 0 || GlobalContext.isGrooveHit(beat); // line 63
```
- line 29/40：可用 `idiomPreferences?.sections` 的 getEnergyAt 模式替换（同 PianoIdiom）
- line 63：`isGrooveHit` 依赖 grooveDNA slice — 需要从 idiomPreferences 读取 grooveDNA

#### `SteadyBassIdiom.ts` lines 47, 66, 69, 112, 137
```typescript
const nextKeyOffset = nextChord.keyOffset ?? (GlobalContext.currentKeyOffset || 0); // line 47
const activeSection = GlobalContext.getActiveSection();           // line 66
const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;  // line 69
const isGrooveHit = GlobalContext.isGrooveHit(beat);             // line 112
GlobalContext.isInterleavingHit(beat)                            // line 137
```
- `isGrooveHit` / `isInterleavingHit`：依赖 grooveDNA slice，需要 idiomPreferences 传入

#### `SyncopatedBassIdiom.ts` lines 12, 14, 25, 32
```typescript
const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;  // line 12
const activeSection = GlobalContext.getActiveSection();           // line 14
GlobalContext.isLayeringHit(beat)                                // line 25
GlobalContext.isInterleavingHit(beat)                            // line 32
```

#### `MelodicBassIdiom.ts` lines 13, 15, 33
```typescript
const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;  // line 13
const activeSection = GlobalContext.getActiveSection();           // line 15
const nextKeyOffset = nextChord.keyOffset ?? (GlobalContext.currentKeyOffset || 0); // line 33
```

#### `SparseBassIdiom.ts` line 12
```typescript
const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;
```

#### `BassSoloIdiom.ts` lines 12, 19, 20
```typescript
const beatsPerBar = GlobalContext.currentTimeSignature[0] || 4;  // line 12
const isLayeringHit = GlobalContext.isLayeringHit(beat);         // line 19
const isInterleavingHit = GlobalContext.isInterleavingHit(beat); // line 20
```

---

### 3. HarmonyCore.ts（中优先级，改动风险高）

HarmonyCore 是核心和声引擎，深度嵌套，共 **8 处** GlobalContext.currentTonality 读取。
`tonality` 已作为参数在 HarmonyEngine 公开方法中传入，需向内部方法透传。

| 行号 | 代码 |
|------|------|
| 568 | `GlobalContext.currentTonality === 'Minor'` |
| 608 | `const tonality = GlobalContext.currentTonality` |
| 731 | `GlobalContext.currentTonality === 'Major'` (sectionType 条件) |
| 824 | `const tonality = GlobalContext.currentTonality` |
| 904 | `GlobalContext.currentTonality === 'Minor'` |
| 928 | `const tonality = GlobalContext.currentTonality` |
| 983 | `GlobalContext.currentTonality === 'Minor'` |
| 1003 | `GlobalContext.currentTonality === 'Minor'` |

**建议策略**：找到这些私有方法的调用链顶部，将 `tonality` 参数向下传递，
优先从已有 `tonality` 参数的公开方法（如 `generateHarmonyTimeline`）向内注入。

---

### 4. Riff / Vocal Harmony Idiom（低优先级）

#### `DefaultRiffIdiom.ts` lines 12, 16
```typescript
const keyOffset = chord.keyOffset !== undefined ? chord.keyOffset : (GlobalContext.currentKeyOffset || 0);
GlobalContext.currentTonality
```
- `keyOffset` 可从 chord.keyOffset fallback 处理（chord.keyOffset 通常已设置）
- `tonality` 需从 idiomPreferences 或新增 RiffContext 字段传入

#### `RnBVocalHarmonyIdiom.ts` line 25
```typescript
const keyOffset = currentChord.keyOffset !== undefined ? currentChord.keyOffset : (GlobalContext.currentKeyOffset || 0);
```
- 同 GospelVocalHarmonyIdiom 的修复模式，改为 `ctx.keyOffset ?? currentChord.keyOffset ?? 0`

---

### 5. TextureMapper.ts 渐进 fallback（最低优先级）

当 `renderCtx` 始终由 Orchestrator 注入时，以下 fallback 的 GlobalContext 分支永远不会触发，
但代码中仍有残留，可在确认 renderCtx 100% 注入后清理：

- lines 55-58：`renderCtx?.X ?? GlobalContext.X`（4 处）
- lines 246-248：同上（3 处）
- lines 319, 329-331：同上（4 处）
- lines 355, 359, 383, 387-389：同上（6 处）
- line 450：`keyOffset ?? GlobalContext.currentKeyOffset ?? 0`

---

## 推荐处理顺序

```
1. Bass Idiom 系列（5 个文件）
   → 添加 beatsPerBar/activeSection/grooveDNA 到 IBassIdiom 接口
   → 由 TextureMapper.generateBassLine 注入（同 DrumIdiom 路径）

2. HarmonyCore.ts（8 处 tonality 读取）
   → 找调用链顶部，向内部私有方法透传 tonality 参数
   → 风险：改动深，建议单独 session 处理

3. DefaultRiffIdiom / RnBVocalHarmonyIdiom（3 处）
   → 同已完成的 GospelVocalHarmonyIdiom 模式

4. 移除 GlobalContext 写操作（initializeNewEra / updateCurrentSlice）
   → 必须等待所有读取清理完毕后才能移除

5. 清理 TextureMapper fallback（可最后做）
```

---

## 涉及文件汇总

| 文件 | 残余数 | 优先级 |
|------|--------|--------|
| `composing/HarmonyCore.ts` | 8 | 中（改动风险高） |
| `idioms/bass/SteadyBassIdiom.ts` | 5 | 中 |
| `idioms/bass/SyncopatedBassIdiom.ts` | 4 | 中 |
| `idioms/bass/BaseBassIdiom.ts` | 3 | 中 |
| `idioms/bass/MelodicBassIdiom.ts` | 3 | 中 |
| `idioms/bass/BassSoloIdiom.ts` | 3 | 中 |
| `arrangement/TextureMapper.ts` | 17 | 低（渐进 fallback） |
| `arrangement/Orchestrator.ts` | 2 | 高（写操作） |
| `composing/ToplineEngine.ts` | 1 | 高（写操作） |
| `MelodyEngine.ts` | 1 | 高（写操作，最后移除） |
| `idioms/bass/SparseBassIdiom.ts` | 1 | 中 |
| `idioms/riff/DefaultRiffIdiom.ts` | 2 | 低 |
| `idioms/vocal/RnBVocalHarmonyIdiom.ts` | 1 | 低 |
| **合计** | **~51** | — |
