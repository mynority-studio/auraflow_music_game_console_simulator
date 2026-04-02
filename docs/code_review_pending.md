# Code Review 待处理清单

> **依据** — Music Generation Pipeline Rule（最高约束文档，32 条硬约束 + 3 条 guideline）
> **生成时间** — 2026-04-02
> **最后更新** — 2026-04-02
> **状态** — **全部完成**（S-2/T-3/D-4/T-4 违规清零），生成管道内零 GlobalContext 引用

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

## 本次完成的修复（S-2 GlobalContext 全面解耦）

### 1. ✅ Bass Idiom 系列（6 个文件）
- `IBassIdiom.ts`：BassIdiomContext 新增 `beatsPerBar`、`activeSection`、`keyOffset`、`grooveDNA` 字段
- `BaseBassIdiom.ts`：新增 `isGrooveHit`/`isLayeringHit`/`isInterleavingHit` 纯静态方法（替代 GlobalContext 方法）
- `SteadyBassIdiom.ts`：5 处 GlobalContext 读取 → ctx 参数
- `SyncopatedBassIdiom.ts`：4 处 GlobalContext 读取 → ctx 参数
- `MelodicBassIdiom.ts`：3 处 GlobalContext 读取 → ctx 参数
- `SparseBassIdiom.ts`：1 处 GlobalContext 读取 → ctx 参数
- `BassSoloIdiom.ts`：3 处 GlobalContext 读取 → ctx 参数
- `TextureMapper.generateBassLine`：注入 beatsPerBar/activeSection/keyOffset/grooveDNA 到 BassIdiomContext

### 2. ✅ HarmonyCore.ts（14 处 GlobalContext 读取）
- `generateHarmonyTimeline` 签名新增 `tonality: string, keyOffset: number` 参数
- `generateDynamicProgression`、`generateFromFunction`、`applyStyleSpices` 签名新增 `tonality` 参数
- 所有内部 `GlobalContext.currentTonality` → `tonality` 参数
- 所有内部 `GlobalContext.currentKeyOffset` → `keyOffset` 参数
- MelodyEngine 调用方传入 `tonality` 和 `keyOffset`

### 3. ✅ DefaultRiffIdiom / RnBVocalHarmonyIdiom（3 处）
- `IRiffIdiom.ts`：RiffContext 新增 `keyOffset`、`tonality` 字段
- `DefaultRiffIdiom.ts`：2 处 GlobalContext 读取 → ctx 参数
- `RnBVocalHarmonyIdiom.ts`：1 处 GlobalContext 读取 → ctx 参数
- `TextureMapper.generateRiff`：新增 renderCtx 参数并注入 keyOffset/tonality

### 4. ✅ TextureMapper.ts fallback 清理（17 处）
- 所有 `renderCtx?.X ?? GlobalContext.X` fallback → `renderCtx?.X ?? defaultValue`
- 确认 Orchestrator 始终提供 renderCtx，GlobalContext fallback 为死代码
- 移除 GlobalContext import

### 5. ✅ Performance Idiom fallback 清理（8 个文件）
- DrumIdiom/BassIdiom/PianoIdiom/GuitarIdiom/StringIdiom：`GlobalContext.currentTimeSignature[0]` fallback 移除
- PianoIdiom/SynthIdiom：`GlobalContext.getCurrentEnergyLevel()` fallback → 默认值 5
- BaseIdiom/SingerPersona：移除未使用的 GlobalContext import

### 6. ✅ 移除 GlobalContext 写操作（3 处）
- `MelodyEngine.ts`：移除 `GlobalContext.initializeNewEra()`
- `ToplineEngine.ts`：移除 `GlobalContext.updateCurrentSlice()`
- `Orchestrator.ts`：移除 2 处 `GlobalContext.updateCurrentSlice()`
- 移除 MelodyEngine/ToplineEngine/Orchestrator/GlobalReviewer/PopVocalHarmonyIdiom 的 GlobalContext import

### 7. ✅ T-3: `any` 类型消除（~30 处）
- `types.ts`：新增 `IdiomPreferences` / `RuntimeIdiomPreferences` 接口
- `BaseIdiom.ts` / 全 Performance Idiom（10 文件）：`idiomPreferences?: any` → `RuntimeIdiomPreferences`
- `InstrumentIdiom.ts`：`Record<string, unknown>` → `RuntimeIdiomPreferences`
- `IBassIdiom.ts` / `IDrumIdiom.ts`：`any` → `RuntimeIdiomPreferences`
- `EnsembleDrafter.ts`：`pool: any[]` → `{ id: string; tags: string[] }[]`
- `Orchestrator.ts`：`tempoCurves: any[]` → `TempoCurve[]`

### 8. ✅ D-4: 浮点 `===` 比较 → epsilon 容差（~22 处）
- 涵盖 drum/bass/piano/vocal/transition idiom 中的 beat 位置比较
- `beat % X === Y` → `Math.abs(beat % X - Y) < 1e-6`
- 文件：HighEnergyDrumIdiom、SyncopatedDrumIdiom、AcousticSwingDrumIdiom、SteadyBassIdiom、SyncopatedBassIdiom、BlockChordPianoIdiom、ArpeggiatedPianoIdiom、RhythmicPianoIdiom、PopVocalHarmonyIdiom、RnBVocalHarmonyIdiom、GospelVocalHarmonyIdiom、DynamicChoirIdiom、TransitionEngine、DrumIdiom（performance）

### 9. ✅ T-4: `as` 强转安全注释 + 冗余 cast 移除（~10 处）
- 移除 Performance Idiom 中已类型化 idiomPreferences 上的冗余 `as` 断言
- TextureMapper `bassStyle as string` → 直接访问（已类型化）
- ToplineEngine `as any` → 移除（`isGraceNote` 已在 NoteData 接口中）
- HarmonyCore `passingType as any` → 缩窄为具体联合类型 + 安全注释
- TextureMapper 字面量元组 `[4, 4] as [number, number]` 添加安全注释

---

## 验证结果（最终）

- `npm run lint`（tsc --noEmit）：**零错误**
- `/src/core/generation/` 目录内 `import.*GlobalContext`：**零匹配**
- `/src/core/generation/` 目录内 `GlobalContext\.`（非注释）：**零匹配**
- `/src/core/generation/` 目录内 `: any`：**零匹配**
- `/src/core/generation/` 目录内浮点 `===`（非整数）：**零匹配**

---

## 剩余状态

生成管道（`/src/core/generation/`）内 **Pipeline Rule 合规已 100% 完成**（S-2/T-3/D-4/T-4 全部清零）。

`GlobalContext.ts` 本身仍存在于项目中，被以下非生成管道代码引用：
- `/src/core/audio/` — 播放层（不属于生成管道规范范围）
- `/src/apps/` — 应用状态机
- `/src/components/` — React UI

这些引用属于平台层，不受 Music Generation Pipeline Rule 管辖。
