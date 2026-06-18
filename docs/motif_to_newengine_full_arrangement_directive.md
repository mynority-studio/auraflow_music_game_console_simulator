# Motif → New Engine Full Arrangement(走 A)

> 现状对齐横幅(以本横幅为准):**PR1–5 已实现并全绿(1275 vitest / tsc / build 净)。** Q+R 的 motif/slot
> 结果作为【权威 lead + 权威和声】喂进 Q+N 成曲生产链,Q+N 负责 arranger / 器配 / bass / comp / pad / drum /
> mix / render / audit。入口 = `generateSongFromMotif()`(并行,不污染 `generateSong`)。**剩:耳朵复核整编 +
> 富和声上 pad 偶发 avoid 挂音的和声-渲染质量打磨(warning,非 fail)。**

---

## 1. 目标与拍板

**走 A**(用户 2026-06-18 拍板):Q+R sandbox 的 motif/slot weaver 产出是【权威】,喂进 Q+N 生产链成曲。

- **lead 权威** = Q+R motif slot weaver;`renderMgMelody` 在这条链让位(无 motif override 时才 fallback)。
- **harmony 权威** = Q+R selected progression / RoadMap;Q+N 的 bass/comp/pad/drum 必须吃【同一套 chord timeline】。
- **Q+N 只接管成曲生产**:arrangement sections / instrumentation / bass·comp·pad·drum render / mix / FinalIR /
  audit·retry。**不能改用户 motif quote,不能重写 sandbox lead。**

**不走 B**(不把 Q+N 器配复制进 sandbox):短期独立、长期必双线分叉,维护成本不可接受。

---

## 2. 接缝地图(Q+N 成曲管线)

`generateSong`(`GenerationController.ts`)序列:
`buildBandSpec → buildArrangementPlan → buildHarmonicPlanFromArrangement → buildInstrumentationPlan →
createTimebase → renderSongFull(bass→pad→comp→drum→renderMgMelody=lead → gate/duck/dynamics/humanize/swing →
freeze → auditHarmony) → runGenerationControl(audit/retry)`。

**两个干净注入点(additive、retry-safe):**

| 点 | 机制 | 为什么干净 |
|---|---|---|
| **A 和声** | `HarmonicPlan` 是【单一真源】(深冻 `chordTimeline` + tension/stable/color/avoid/scale map);bass/comp/pad/drum/lead **全只读** | 换和声 → 所有伴奏【自动跟随】;retry 改不动(冻结) |
| **B lead** | `renderMgMelody` 输出的【单轨 TrackIR】 | lead 完全独立;retry 不重生 lead(seed 不变)、lead error 不阻断重跑、gate/swing/humanize 全跳过 lead |

---

## 3. 实现(PR1–5)

| PR | commit | 内容 |
|---|---|---|
| PR1 | `3ccb95d` | `generateSongFromMotif` 并行入口(镜像 generateSong + 注入钩子,**generateSong 本体零改动**);`renderSongFull` 加 additive 可选参 `overrideLeadTrack`;`MotifSongOverride` 合同 |
| PR2 | `1e64f38` | `bridge/sandboxToHarmonicPlan`:Q+R progression(SandboxChord)→ ResolvedChord → `assemble()`(改 export,纯函数)→ HarmonicPlan(自动算全套 map)|
| PR3 | `309ca03` | lead 转换(MotifNote beats → TrackIR ticks,内部用 Q+N timebase);`bridge/sandboxToOverride.buildMotifSongOverride(weave,key,mode)` 高层桥 → `{harmony, lead, key}` |
| PR4 | `b989de9` | **曲长对齐**(16bar 和声/lead **tile 满 arrangement** + 逐 span 按拍归到对应段落再 assemble)+ **宽容审计**(`acceptNonLeadErrors`)→ 端到端成曲不 failed |
| PR5 | `f4a1dee` | Q+R 加「▶ 整编成曲」按钮 → buildMotifSongOverride → generateSongFromMotif → 走压缩母带播放;「▶ 试听」(lead-only)保留 |

### 合同 `MotifSongOverride`(`generateSongFromMotif.ts`)

```ts
interface MotifSongOverride {
  harmony?: HarmonicPlan;            // 注入点 A(整曲权威和声)
  lead?: readonly MotifLeadNote[];   // 注入点 B(整曲权威 lead,beats 制,内部转 TrackIR)
  key?: { keyPc: number; mode: DiatonicMode }; // 把 16bar 和声 tile 满 arrangement 后重装配用
}
interface MotifLeadNote { pitch: number; onsetBeat: number; durationBeat: number; velocity: number; }
```

### 转换链

```
Q+R weave (lead: MotifNote[] · progression: SandboxChord[])
  │ buildMotifSongOverride(result, keyPc, mode)
  ▼ { harmony: HarmonicPlan(via assemble), lead: MotifLeadNote[], key }
generateSongFromMotif(request, override)
  ├─ 注入 A:harmony tile 满 arrangement + 逐 span 按拍归段 → re-assemble → bass/comp/pad/drum 全跟
  ├─ 注入 B:lead tile 满曲长 → MotifLeadNote→TrackIR(本 timebase)→ 跳过 renderMgMelody
  └─ runGenerationControl(..., acceptNonLeadErrors=true)
  ▼ 完整成曲 IR(编制==默认 · lead==motif · 和声==sandbox 选择)
```

---

## 4. 曲长对齐 + 宽容审计(PR4 关键)

- **曲长**:sandbox 和声/lead = `form.totalBars`(默认 16bar),arrangement 由 targetDuration 决定(~40bar)→
  和声/lead **tile 满 arrangement 总拍**;每 chord span 按所在拍【重新归到对应 arrangement 段落】(否则 section-id
  不匹配 → comp/pad/drum 按段 gate 全空轨)。末尾截到曲尾。
- **宽容审计**:override 时和声是用户权威、retry 只能改 comp voicing(改不动 pad/bass)→ 富和声让 Q+N pad 暴露
  avoid 音会 hard fail。`runGenerationControl` 加 `acceptNonLeadErrors`(**仅 override 路径开**;默认 generateSong
  严格不变):非 lead 的 `error` 降为 warning,只 `fatal` 阻断。

---

## 5. 边界守恒(不变量)

1. **`generateSong` 本体零改动**(并行入口,默认链字节不变 —— 4 风格测试锁)。
2. `renderSongFull` 只加一个 additive 可选参(默认 undefined → 走 MG 链)。
3. `assemble` 改 export(纯函数,原行为不变)。
4. `runGenerationControl.acceptNonLeadErrors` 默认 false(默认链严格)。
5. **用户 motif lead 不被改**:override lead 被 `renderSongFull` 原样采用为 lead 轨(program 取器配生效值保混音一致),
   gate/duck/swing/humanize 全跳过 lead。
6. **和声单一真源**:override harmony 深冻;retry 碰不到。

---

## 6. 测试覆盖

- `generateSongFromMotif.test`:默认链字节不变(4 风格 `generateSongFromMotif(无 override) === generateSong`)·
  harmony passthrough · lead override 原样采用(tile 首份)+ 编制不变。
- `bridge/sandboxToHarmonicPlan.test`:chordTimeline 逐和弦对齐(rootPc/dur/start/总拍)+ 全 map 齐备 · 宽
  chordType(借/七和弦)透传 · 端到端 bass 吃 sandbox 和声。
- `bridge/sandboxToOverride.test`:MotifNote→MotifLeadNote · buildMotifSongOverride 对齐 · **PR4 端到端验收**
  (4 风格成曲不 failed · lead tile 首音对齐 · bass/comp 非空覆盖全曲 · 编制==默认 generateSong)。

---

## 7. 已知质量项 + 后续

- **⚠️ pad avoid 挂音(warning,非 fail)**:sandbox 富和声(maj9/7b13/9sus4…)上 Q+N pad 偶尔留一个 avoid 音
  (如 Bb 压在 Fmaj9 上)。当前降为 warning 放行。打磨方向(待耳朵复核后定):① 转换时按段简化富 chordType
  ② Q+N pad avoid-resolution 增强(Q+N 侧)③ override 时给 pad 更严的 avoid 钳位。
- **4/4 隐性假设**:`BAR=4` 仍硬编(Q+R 全 4/4 无碍);接任意拍号时 `MotifSongOverride`/timebase 需带 meter。
- **功能型生成轻量**:Q+R generatedOnly 的 opening/approach/cadence 行为已分化但需耳朵迭代。
- **真 verse≠chorus**:当前 lead/harmony 是 16bar tile(loop 式重复);未来可让 Q+N 段落驱动 motif 的发展/变奏
  (verse 用 quote、chorus 用 develop)而非整段重复。
