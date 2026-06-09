# newEngine 活清单(backlog)

日期起: 2026-06-04
用途: newEngine **音乐性 + 内容深化**的执行清单。架构脊柱已闭环(见 `newEngine_conformance_audit.md`),本清单是其后的内容/质量工作。
真理源: 架构 = `newEngine_architecture.md`;本文 = 任务与进度。

---

## 给自治循环(/loop)的协议

```
每轮:
  1. 读「执行顺序」,挑【第一个未勾(- [ ])】任务。
  2. TDD 实现:写/补用例 → 实现 → `npm test`(vitest)+ `tsc --noEmit` + `vite build` 全绿。
  3. 把该任务在「执行顺序」里勾上(- [x]),在末尾「进度日志」记一行(commit 短哈希 + 一句话)。
  4. commit(`feat(newEngine): <id> <标题>`)。
  5. 一轮一项(强相关的小项可合并一轮)。
原则:
  · 纯引擎不塞 console.log(观测走 traceGeneration)。
  · 保确定性(同 seed 同输出)、深不可变、fail-closed —— 不得回退已锁不变量。
  · 听感类改动无法在无音频环境自听:用「结构性断言」锁(如 comp 起音数变多/有切分、bass 非纯根音、
    旋律有休止、swing 后 tick 偏移),并在进度日志注明"需用户耳朵复核"。
  · 每改一处 traceGeneration 日志同步反映(让用户能从日志核对)。
全部勾完 → 停循环 + PushNotification。
```

---

## 待用户决断(架构项 · ⚠️ 不进 /loop 自动执行)

> 这些是需要**用户拍板方向**的架构决策,**不属于「执行顺序」清单,/loop 不得自动挑选**。

### D-1 · MG 旋律 ↔ Motif 子系统:再耦合 or 正式退役 — ✅ **已执行 option (c) 退役(2026-06-07)**

> **用户拍板 (c) 退役。** 删 `motifAnchorPrepass`/`MotifStore`/`Motif`/`MelodyAnchorPlan`/`occurrenceResolver`/
> 旧 `melodyRenderer`(6 源 + 7 测试)+ escalateOverride rung2/rung3 + RetryContext/RenderOverlay 的
> `candidateSwap`/`restatementOverride`/`candidateIndex`/`tailRegenerate`/`accompDensityReduction` 字段;
> locator 瘦成只 `spanAtTick`,撞音阶梯收为 **rung1 voicingSafer → rung4 fallback(重掷 melody 子流)**。
> **验收全过**:tsc/build 净;809 vitest 绿;**200 seed×风格生成逐字节完全一致(零行为变化)**;rung1
> voicingSafer 实战仍生效(lofi comp error 仍被处理)。架构文档「现状对齐」横幅 + Part 1/5/7 已同步为"已删"。

**背景**:MG 旋律迁移(decision C 全量接收 MG)后,旋律改走 MG 链(`renderMgMelody`,读 HarmonicPlan 不读 MotifStore)。架构原 **Motif/撞音消解/重跑环子系统**(`newEngine_architecture.md` Part 7「audit 命根」)在**旋律侧被有意旁路**:
- Prepass 仍跑、MotifStore 仍建,但旋律不消费(`renderCoordinator` `void anchorPlan/motifStore`)= **死重**(每首跑、输出没人用)。
- retry 旋律杠杆(`candidateSwap`/`restatementOverride`)被 `void`,只 `voicingSafer`(comp 瘦身)活 = **旋律撞音 retry 改不动**(只能瘦 comp),安全押在 MG `shapeMelodyHarmony` 上游预防。

承重不变量全 HOLD(权威链/和声不可变/accompaniment-first/确定性/只读 Auditor/render-only retry),偏离只在这一个支柱。文档已回写对齐现状(顶部「现状对齐」+ Part 1/5/7 内联 ⚠️)。

**三条候选路线(择一,用户定)**:
- **(a) 维持现状 + 只回写文档**(已做):承认 MG 链是旋律真理源,Motif 子系统作原意参考留存。**最省**。代价:死重 + 旋律 retry 网薄(押 shapeMelodyHarmony 够稳)。
- **(b) 再耦合**:让 MG 旋律消费 Prepass 候选池 / 接回 `candidateSwap`,把 C 重跑环的旋律杠杆接回。**最贵**(范式桥接:Motif 实例 ↔ MG token 流;需给 MG 造 per-乐句变体池供切换)。恢复"出错可纠正"。
- **(c) 正式退役**:删 Prepass/MotifStore/locator 旋律分支 + escalateOverride rung2/rung3 + RetryContext 的 candidateSwap/restatementOverride + 旧 renderMelody + void 死行;locator 瘦成只 spanAtTick。保留 rung1 voicingSafer。**低-中**。

**已核实的关键事实(2026-06-06,降低 (c) 成本/风险)**:
- ✅ `voicingSafer`(rung1)只依赖 `HarmonicPlan.chordTimeline + Timebase`(`retryMapping.spanAtTick`),**不依赖 motifStore** → (c) 删 Motif 不动唯一活着的 retry 杠杆。
- ✅ `runPrepass` 用 `rng.substream('prepass')`,而 substream 按名纯派生、不扰动其它子流(`randomContext.ts`)→ **删 Prepass 生成结果 bit 不变**(原"保 rng 流"注释过度保守)。

**实测数据(50 seed × 4 风格 = 200 次,2026-06-06)**:
- 首次渲染 **lead error/fatal = 1/200(0.5%)**;那 1 次终态也收敛(终残留 lead error=0)。
- lead warning 104(非阻塞,不触发 retry)= MG shapeMelodyHarmony 上游预防够稳。
- 真正干活的 retry 是 rung1 voicingSafer(10 个 comp/bass/pad error 全 lofi;1 首靠它收敛、1 首 budget 耗尽 failed)——(c) 保留。
- → **数据支持 (c) 退役**:旋律候选机器触发率 0.5% 且非决定性 = 纯死重;(b) 为 0.5% 场景做范式桥接不划算。

**验收(等方向定后再写)**:(b) 注入旋律撞音 → retry 用候选切换修好;(c) 删除后 844+ 测试仍绿、200 seed 生成 bit 不变(死码删除=零行为变化)、rung1 voicingSafer 实战仍生效。

---

## 执行顺序(勾选清单 = 循环的下一项来源)

**Tier A · 听感立竿见影**
- [x] 1.1 Comp 织体化(风格化 comping 节奏型)
- [x] 1.2 Bass 行进(walking / 根-五-八 / 分解)
- [x] 1.4 鼓变化(per-style groove + 段落 fill + 力度人性化)
- [x] 2.1 乐句呼吸 / 休止(消费 phraseBreathing)
- [x] 2.5 swing / feel 落地(swingRatio 改 tick)

**Tier B · 伴奏 / 旋律加厚**
- [x] 1.5 Pad / 铺底轨(floating 段长音)
- [x] 1.3 真 Voicing(drop2 / rootless / open + 顶音 voice-leading)
- [x] 2.4 旋律轮廓弧线(音区 / 密度随能量,高潮冲峰)

**Tier C · 真内容引擎**
- [x] 2.2 真 grammar 变体(变体机制:transform/divide/development;85-grammar data-port 留作子步)
- [x] 2.3 GuideTone tail(connector/cadence 句按 cadenceTarget 导音解决)

**Tier D · 结构 / 和声起伏**
- [x] 3.1 Dynamics 真消费(energy/density/climax 落力度/密度/音区)
- [x] 3.4 终止式(乐句尾真 cadence,V-I 落点对齐 cadenceTarget)
- [x] 3.2 副属(V7/V,secondaryTarget 落地)
- [x] 3.3 借和弦(borrowedChordMap 落地)
- [x] 3.6 真 chord-scale(取代 stable∪acceptable 占位)
- [x] 3.5 曲式多样(seed 选模板 + 段落长度变化)

**Tier E · 表现力 / 纠错环**
- [x] 5.3 力度 / 微时序人性化(velocity 曲线 + 微 timing)
- [x] 5.1 Auditor finding → 精确返回点(真用 candidateSwap/restatementOverride)
- [x] 5.2 撞音阶梯实战验证(构造难例跑通全阶梯)
- [x] 5.4 混音(各轨相对音量 / 声像)

**Tier F · regime / 边界**
- [x] 4.1 modal regime(modal vamp + primaryScale 着色)
- [x] 4.2 小调打磨(harmonic minor V7 / 终止)
- [x] 4.3 转调(modulationMap 落地)

**Tier G · 工具 / 观测 / 移植**
- [x] 6.1 面板 piano-roll(各轨音符可视化)
- [x] 6.2 MIDI 导出(.mid)
- [x] 6.3 A/B seed 对比 + 日志 diff
- [ ] 6.4 ESP32 C 移植同步(/sync-to-c,远期)— ⏸ **挂起(2026-06-04 用户决定)**:换语言/工具链/硬件目标,需先定范围(全量 vs 子集)/目标硬件/C 音频后端(板载 DAC·I2S·或只导 MIDI)/起步时机,再开

---

## 任务详情(what / why / 在哪 / 验收)

### Tier A
**1.1 Comp 织体化** — 整块和弦 → per-style comping 节奏型(lofi 慵懒疏 / pop 八分律动 / jazz 切分)。新 `knowledge/grooves`(comping pattern 库,按 styleProfile.accompDensity + 段落 active 度选)。`render/accompanimentRenderer` 按 pattern 落 hit。验收:comp 起音数显著多于"每和弦 1 块"且有非整拍 hit;Auditor 仍 pass;trace RENDER 行反映。

**1.2 Bass 行进** — 新 `render/bassRenderer`:jazz=walking(逐拍经过音,贴下个和弦根)/ pop=根-五-八 / lofi=根+分解。验收:bass 非纯根音(每和弦 >1 音 / 有经过音),落和弦音/导音;Auditor pass。

**1.4 鼓变化** — `drumRenderer` 扩:per-style groove(lofi swing hat / pop backbeat / jazz ride),段落转折(verse→chorus)加 fill,velocity 抖动(非每小节同)。验收:相邻小节鼓不完全相同;段落边界有 fill。

**2.1 乐句呼吸 / 休止** — `melodyRenderer` 消费 `arrangement.phraseBreathing`(已存契约未用):句尾留白、按 breathSlots 插休止,旋律不再每小节填满。验收:lead 音数较现状下降且分布有"句"感(句间空隙)。

**2.5 swing / feel 落地** — `feel.swingRatio`(已存未用)在 render 落实:八分音符的偶位后移(swing)。验收:swing 风格下,八分 offbeat 的 tick 有可测偏移;straight 不变。

### Tier B
**1.5 Pad / 铺底轨** — 新 `render/padRenderer`:floating 段(texture=pad/sustained)出长音和弦铺底(整段持续)。验收:intro/outro 有 pad 轨非空;Auditor pass(pad 用安全音)。

**1.3 真 Voicing** — `knowledge/voicings` 扩:drop2 / rootless / open;相邻和弦**顶音平滑**(最近音 voice-leading)。comp 用之取代 48+pc 簇。验收:comp 音不再是单八度簇;相邻和弦顶音跳动小。

**2.4 旋律轮廓弧线** — melody 消费 `energyCurve`:音区/密度随能量爬升,climax 句冲音区峰。验收:chorus2(高潮)旋律平均音高/密度 > verse。

### Tier C
**2.2 真 grammar 变体** — 接 grammar 资产(data-port,标 provenance):用 transform/divide/development 取代手搓 `DEV_STEPS`。新 `knowledge/grammarLibrary`(0 import 旧 improCore,搬数据+adapter)。验收:动机发展来自 grammar 规则而非常数;不同 grammar 产不同发展。

**2.3 GuideTone tail** — 新 `knowledge/guideTonePolicies`;connector/cadence 句的 tail 按 `cadenceTarget`(open/half/authentic)走导音(3/7 解决),取代 dev-step。验收:cadence 句尾落到解决音(I 的 3/根);connector 句贴和弦顺滑。

### Tier D
**3.1 Dynamics 真消费** — energy/density/climax 落到各 renderer 的力度/密度/音区(现在只存不用)。验收:trace 显示各段力度/密度随 energyCurve 变;chorus 比 verse 满。
**3.4 终止式** — 乐句尾和声真 cadence(V→I 对齐 cadenceTarget);段尾 authentic。验收:cadence 乐句末和弦为 V→I。
**3.2 副属** — `V7/V`(secondaryTarget 已存未用)进 progression 候选。验收:部分进行含副属;Auditor pass。
**3.3 借和弦** — borrowedChordMap 落地(bVII/iv 色彩)。验收:可选开关下出现借和弦。
**3.6 真 chord-scale** — chordScaleMap 用真调式音阶(取代 stable∪acceptable 占位)。验收:per-chord scale = 该和弦的调式音阶。
**3.5 曲式多样** — formPlanner 按 seed 选模板 + 段落长度变化。验收:不同 seed 出不同曲式。

### Tier E
**5.3 人性化** — velocity 曲线(乐句内强弱)+ 微 timing 抖动(±少量 tick)。验收:同音力度/起音非完全网格(可测抖动)。
**5.1 finding→返回点** — controller 把 Auditor finding 映射到具体 binding/voicing,真用 candidateSwap/restatementOverride(现泛泛推 rng)。验收:注入撞音 → retry 用对应 override 修好。
**5.2 撞音实战** — 构造会撞难例,跑通 voicing→降锁→换hook→重跑全阶梯。验收:难例下阶梯逐级生效的测试。
**5.4 混音** — 各轨相对音量/声像(audio adapter)。验收:bass/comp/lead/drum 音量分层。

### Tier F
**4.1 modal regime** — modal vamp + primaryScale 着色 + 逐和弦约束放松(band/harmony/melody modal 分支)。验收:tonalityKind=modal 出静态 vamp + scale 跑动。
**4.2 小调打磨** — harmonic minor 的 V7 / 终止。验收:小调出 V7-i。
**4.3 转调** — modulationMap 落地。验收:可选下出现段落转调。

### Tier G
**6.1 piano-roll** — 面板各轨音符可视化。**6.2 MIDI 导出** — .mid 下载。**6.3 A/B** — 两 seed 并排 + 日志 diff。**6.4 C 移植** — /sync-to-c。

---

## 进度日志
(循环每完成一项追加一行:`YYYY-MM-DD <id> <hash> — 一句话 [需耳朵复核?]`)
- 2026-06-04 1.1 — Comp 整块→per-style comping 节奏型(lofi疏/pop四分/jazz切分),knowledge/grooves;comp 起音>和弦数、jazz 有 offbeat;Auditor 仍 pass;+8 用例(186 绿)。**需耳朵复核**(切分/律动是否好听)
- 2026-06-04 1.2 db68717 — Bass 独立 renderer:jazz walking(逐拍+半音接入)/pop 根-五交替/lofi 根音持续+五度;bass 从 comp 渲染器拆出;非纯根音、落 [36,50];+4 用例(187 绿)。**需耳朵复核**(walking 走向是否自然)
- 2026-06-04 6.3 — A/B seed 对比:新增 sandbox/traceDiff(diffLines LCS 行对齐 diff:同/左独/右独;compareTraces 行 diff + 指标 delta bpm/小节/音符/状态);NewEnginePanel 加 ⇄A/B 按钮(seed vs seed+1 → 指标行 + 并排日志 diff,差异行高亮 + changedCount);纯 diff 单测锁(全同/单行变更/增行/两 seed 有同有异/同 seed changedCount 0);+5 用例(304 绿)。**需眼睛复核**(A/B 面板并排可读性)
- 2026-06-04 6.2 — MIDI 导出:新增 sandbox/midiFile(musicalIRToSMF:format 0 单轨 SMF;复用 musicalIRToMidiEvents 含 program+CC7/CC10 混音;加 tempo meta FF5103;绝对 tick→delta VLQ;同 tick 排序 tempo>program>cc>noteOff>noteOn);vlq 编码器;NewEnginePanel 加 ⬇MIDI 按钮(Blob 下载 newEngine-<style>-seed<n>.mid);纯字节单测锁(MThd format0/division=ppq、tempo 500000us、noteOn/Off、EOT、MTrk 长度自洽、VLQ、确定性);+6 用例(299 绿)。无需耳朵复核(字节格式;可导入 DAW 验证)
- 2026-06-04 6.1 — piano-roll:新增 sandbox/pianoRoll(buildPianoRoll 纯几何:IR→矩形,x/w∝tick、y 随音高翻转高音在上、角色配色 ROLE_COLOR);NewEnginePanel 加 SVG piano-roll(viewBox 自适应 + 角色图例),生成后渲染各轨音符;纯换算单测锁(x/w 比例、y 翻转、配色、空IR兜底不除零、矩形不溢出画布);+5 用例(293 绿)。**需眼睛复核**(面板 piano-roll 视觉:Q+N 生成后看各轨音符分布)
- 2026-06-04 4.3 — 转调:HarmonicPlan 加 ModulationInfo + modulationMap(Record<SectionId>);planModulation 可选下(band.allowModulation,默认 false)末段 chorus 升半音"换挡 lift"(确定性);harmony 按段实际调中心 sectionKey 解析根音 + 终止,ResolvedChord 带 sectionKeyPc → chord-scale 按新调中心(不变量保持);melody 读 plan.modulationMap 该段级数解析用 secKey + head 整体移调(随升 key);bass/comp/pad 走 chordTimeline 自动跟;★ opt-in 默认空 map=旧路径不变(283 测试零改);实测开启出末段升半音(进行整体+1、旋律含新调音、chord-tones⊆scale)、默认无转调、5 seed 端到端;trace 显示转调;+5 用例(288 绿)。Tier F 完(3/3)。**需耳朵复核**(lift 衔接是否自然/突兀)
- 2026-06-04 4.2 — 小调打磨 V7-i:realChordScale 加 isDominant 上下文 + PHRYGIAN_DOMINANT(和声小调第5调式),小调主属 V7 取 Phrygian dominant(含升导音 B♮ + 调内 b6/b3,Mixolydian 会错成自然6)、大调 V7/副属仍 Mixolydian;assemble 传 isDominant=quality'7';修了小调 V7 之前 chord-scale 落自然小调缺升导音(chord-tones⊄scale)的潜伏 bug;3.4 终止已强制 V7,本项补对的 chord-scale + 验证 V7→i 解决(G7→Cm7);实测小调出 V7(根=5度·含升导音)、chord-tones⊆chord-scale 不变量、V7→i 真解决、6 seed 端到端;trace 小调标 Phrygian dominant;+4 用例(283 绿)。无需耳朵复核(chord-scale 数据层 + 已有 V7 听感)
- 2026-06-04 4.1 — modal regime:新增 knowledge/modes(7 教会调式 + modalScale + modalVamp[i+特征和弦] + nearestInScale);BandSpec 加 primaryScale/modalModeName,bandEngine 加 modal style + styleHint=modal/request.tonalityKind→modal 分支(默认 Dorian,primaryScale=调式音阶,tonal 也填调内音阶);harmony buildModalHarmonicPlan 静态 vamp(每小节循环 i+特征和弦,全段同=静态,无功能 T-S-D),assemble 接 modalScalePcs→约束放松(avoid 空 / chord-scale=primaryScale / acceptable=音阶去和弦音);melody resolvePc modal 分支=nearestInScale 收进 primaryScale(逐和弦约束松=只约束全局音阶);实测 modal 出 ≤2 和弦静态 vamp+verse 静态、lead 全音∈primaryScale、avoid 空 Auditor 必 pass、6 seed 端到端、tonal pop 不受影响(和弦仍多样);trace 显示 modal vamp 分支;+9 用例(279 绿)。**需耳朵复核**(modal vamp 静态感/旋律调式色彩是否到位)
- 2026-06-04 5.4 — 混音:irToMidi 角色映射加 volume/pan,每轨发 CC7(通道音量)+CC10(声像)在 noteOn 前;音量分层 lead120>bass112>drum100>comp90>pad68(焦点最响→铺底最弱),声像 comp 偏左(50)/pad 偏右(78)展宽立体声场、bass·lead·drum 居中(64);+4 用例(270 绿)。Tier E 完(4/4)。**需耳朵复核**(音量比例/声像宽度是否平衡)
- 2026-06-04 5.2 — 撞音消解阶梯:escalateOverride 按【已用 rung】单调升级 voicing 支撑(span 瘦身 shell,回卷 accompaniment)→ 降锁深度(binding restatementOverride=0.3 弱档,回卷 melody)→ 候选池换 hook(candidateSwap,回卷 melody)→ render-fallback;★ 三类 overlay 真消费(新增 render/RenderOverlay,renderSongFull 收 overlay;accompaniment 接 voicingSaferSpans 用 shell / melody 接 restatementOverride 降 effStrength 放开刚性复述);nextRetryContext 用 escalateOverride,returnPoint 跟 rung;实测阶梯逐级生效(voicing→降锁→换hook 3 rung)、只换hook 放行=4 attempts 收敛、永撞→耗 budget→failed(ir undefined 不输出非法)、6 seed 端到端仍 pass(overlay 不破正常生成);trace 显示阶梯;+4 用例 + 改 5.1 收敛例(267 绿)。无需耳朵复核(控制流;正常生成不触发)
- 2026-06-04 5.1 — finding→精确返回点:新增 generation/retryMapping(buildRetryLocator 由 phrase 时段建 binding tick-range + chordTimeline 建 span tick-range + 候选池轮换;findingToOverride:lead→命中 binding 的 candidateSwap 切【冻结池内另一候选】/comp·bass·pad→命中 span 的 voicingSafer);nextRetryContext 接 locator 填精确 override(命中=切候选,未命中=兜底纯 rng 推进保收敛);runGenerationControl 透传 locator,generateSong 从 base prepass 建(melody/resolver/accompaniment 回卷不动 prepass 子流→swap id 跨重跑恒有效);★ 收敛证:注入 lead 撞音→映射对应 binding→2 attempts 修好(非盲推);trace 显示纠错环精确返回点;+5 用例(263 绿)。无需耳朵复核(控制流;正常生成不触发,自愈旋律本就 pass)
- 2026-06-04 5.3 — 力度/微时序人性化:新增 render/humanize(metricAccentScale 强拍1.06/次强1.02/正拍0.97/反拍0.92 + 微随机±4% → humanizeVelocity 鼓轨跳过保 groove;humanizeTiming 起音±~7tick 有界 clamp≥0);renderSongFull 接 dynamics→humanizeVelocity→swing→【审计】→humanizeTiming(★ 关键:微时序在和声审计之后施加=网格下层,否则±tick 跨和弦边界误暴露 avoid→7 测试红已修);humanize 子流加进 StageName;实测同音力度非网格+强拍>反拍、起音偏网格有界、端到端同 seed IR 逐音一致;+6 用例(258 绿)。**需耳朵复核**(人性化幅度:太大=松垮/太小=听不出)
- 2026-06-04 3.5 — 曲式多样:formPlanner 由单一固定模板扩为 4 模板池(verse-chorus / +bridge / double-verse / compact),planForm 接 rng → seed 选型 + intro/outro 长度变化(2/4 bar),verse/chorus 保 8 bar+repeatGroup 等长排比;arranger 接 ArrangementOptions{rng,template},generateSong/trace 传 seedRng → 真"不同 seed 不同曲式"(实测 seed0-7 出全部 4 种骨架);不变量【每模板≥1 chorus 高潮锚点】;无 rng=固定 verse-chorus(向后兼容,旧 ~20 测试不动);12 seed 端到端全收敛(非 failed);trace 显示曲式骨架+段数+小节数;+5 用例(252 绿)。**需耳朵复核**(各曲式段落衔接/桥段对比)
- 2026-06-04 3.6 — 真 chord-scale:新增 knowledge/chordScales(realChordScale);调内→母调音阶(大调 Ionian/小调自然小调 7 音,含旧占位漏掉的 avoid 4 度)、副属→根音 Mixolydian(含离调导音)、借和弦→根音 Dorian(含 Ab/Eb);assemble 接 keyPc+keyMode,chordScaleMap 由 stable∪acceptable(6 音残缺)换成真 7 音调式音阶;不变量【和弦音⊆chord-scale】全 style 跑通;无下游消费=零行为回归(为后续 solo/modal 备数据);trace 采样首和弦+离调和弦音阶;+8 用例(247 绿)。无需耳朵复核(纯数据层,不出声变化)
- 2026-06-04 3.3 — 借和弦:大调 colorBudget≥0.3 → body 内 IV(maj7) 借为同名小调 iv(m7,Fm7 在 C),borrowedChordMap 标记({from:'parallel-minor',label:'iv'});含 Ab/Eb 离调色彩、melody 对其安全音重 snap→Auditor pass;确定性=排比不破(verse1≡verse2);trace 显示借和弦 iv×N;+3 用例(239 绿)。**需耳朵复核**(借和弦色彩/小调忧郁感)
- 2026-06-04 3.2 — 副属 V7/X:colorBudget≥0.5(jazz)才加;tonicize body 内 V/vi 目标前和弦(根=目标上方五度,属七,func=D,secondaryTarget 标记);确定性=排比不破;melody 对离调和弦重 snap→Auditor pass;实测 jazz 出 V7/V·V7/VI 解决、pop 无;romanLabel 显示 /X;+4 用例(236 绿)。**需耳朵复核**(离调色彩)
- 2026-06-04 3.4 — 终止式:harmony 按段尾末乐句 cadenceTarget 覆写段尾和声(authentic→末两和弦 V7-I / half→末 V7);小调也用属七真解决;排比不破(verse1≡verse2 同终止);功能时间线段尾 D-T;+3 用例(232 绿)。**需耳朵复核**(终止解决感)
- 2026-06-04 3.1 — Dynamics 真消费:render/dynamics applyDynamics 全轨力度按段落能量缩放(scale=0.6+0.5*energy);renderSongFull 算 energyRanges 在 swing 前应用;音区已在 2.4 消费、此补力度;实测 chorus 均力度>verse;+3 用例(229 绿)。**需耳朵复核**(动态对比强度)
- 2026-06-04 2.3 — GuideTone tail:knowledge/guideTonePolicies(3/7 导音,voice-led 取离 prev 最近,authentic 强制 3 音解决);melody 中 connector/cadence 句(非 hook)走导音线(一弦一音、sparse、坐音区低端),与 busy hook 对比;实测 connector 全是导音、比 hook 稀疏;Auditor pass;+9 用例(226 绿)。Tier C 完(2/2)。**需耳朵复核**(连接句连贯/对比)
- 2026-06-04 2.2 — 真 grammar 变体:knowledge/grammarLibrary 变体引擎(transform=transpose/invert/retrograde + divide 节奏细分;grammar=逐小节算子序列,develop/sequence/answer);melody 用 developBar 取代手搓 DEV_STEPS;grammar 按 motifId 确定性选(不同 motif 不同发展);实测各 motif grammar 各异、Auditor pass;+7 用例(217 绿)。⚠️ 85-grammar Impro-Visor DSL data-port 留作后续子步(本项是变体【机制】)。**需耳朵复核**(发展是否自然)
- 2026-06-04 2.4 — 旋律轮廓弧线:lead 音区按段落能量抬升(lift=round(energy*8)+climax3,封顶 14)+ 高潮段冲峰;head/realize/resolve 全置入弧线音区(pc 不变=安全);实测 chorus>verse、chorus2(高潮)≥chorus1;+3 用例(210 绿)。Tier B 完(3/3)。**需耳朵复核**(抬升幅度)
- 2026-06-04 1.3 — 真 Voicing:voiceComp(jazz rootless / spread,顶音贴 prevTop=voice-leading,落 [52,76])取代 48+pc 簇;comp 预算 per-span voice-led 链 + 让位 shell 同走 voiceComp;全 chord tone→Auditor pass;实测 jazz rootless 顶音稳;+6 用例(207 绿)。**需耳朵复核**(voicing 厚度/连贯)
- 2026-06-04 1.5 — Pad 铺底轨:floating 段(intro/outro/bridge)长音和弦铺底 [55,79] soft;织体分流(active=comp / floating=pad,comp 受 activeSectionIds 限制不进 floating)→ 出 5 轨 bass/comp/pad/drum/lead;+4 用例(201 绿)。**需耳朵复核**(pad 厚度/与旋律平衡)
- 2026-06-04 2.5 — swing/feel:applySwing 全轨 onset warp(piecewise-linear,直则原样);jazz ride 改直 8 分由 swing 统一摆动(避免双重);实测 pop frac=0.5 直 / jazz frac=0.66 摆;+4 用例(197 绿)。Tier A 完(5/5)。**需耳朵复核**(摇摆量)
- 2026-06-04 2.1 — 旋律句尾呼吸:末小节稀疏单长音解决(cadence 落主音/其余回锚点,贴和弦安全音)+ 末 cadenceBreath 拍留白;消费 phraseBreathing;Auditor 抓出主音落属和弦的 avoid 暴露→已 snap 修;+3 用例(193 绿)。**需耳朵复核**(留白量/解决感)
- 2026-06-04 1.4 — 鼓变化:per-style groove(pop backbeat/lofi 半拍/jazz swing ride)+ 段落转折 fill(末小节 16 分 roll)+ 确定性力度人性化(逐小节抖动);drumPattern 进 grooves;+3 用例(190 绿)。**需耳朵复核**(groove/fill/抖动幅度)
- 2026-06-08 鼓 groove 多样化(用户直接需求,扩 1.4)— 4 macro 风格 × 4 GrooveKind(sparse/laidback/straight/driving)× 2-3 变体词汇库(knowledge/grooves `drumGrooveVariants`;jazz 用 ride)。**分层下发**:GROOVE=Arranger(`arranger/groovePlanner.planGroove` 按 functionTag 选——framing/收尾→sparse · hook/solo→driving · build→straight · content→风格基底[pop straight / rnb·lofi laidback / jazz straight],无 tag→按 role;repeatGroup 一致)→ `ArrangementPlan.grooveBySection`;变体匹配=器配(`instrumentalPlanner` 按 style×groove 确定性挑变体,同 groove→同变体;rng 抽取 append 在序列尾→既有 timbre/lead/intro/richTexture 序列 bit 不变)→ `InstrumentationPlan.drumPatternBySection`;消费=`drumRenderer`(patternBySection 主权威逐段换鼓型,texturePocket 退成次要兜底);`renderCoordinator` 接线。实测 pop intro sparse→verse straight→chorus driving→outro sparse / rnb·lofi verse laidback / jazz solo driving、repeatGroup 一致、确定性、既有 852 绿不破(+19 新=871 绿)、tsc/build 净。trace 加「鼓 groove」行(每段 kind+hit 数)。**需耳朵复核**(各风格 groove 变体律动 / 段落鼓型对比是否好听)
- 2026-06-08 段落边界:intro→verse 衔接 + outro 收尾(用户直接需求,联网研究 4 类收尾)— 根因=Arranger 只下发段落存在性+密度/groove,无「边界行为」→ 器配不知乐器怎么进/出。**用户两决策**:收尾=按风格定制 · 不改 tempo(音量+留白模拟渐慢)。**分层**:Arranger 新 `arranger/edgePlanner.planEdges`(纯 energy/style 派生,无 rng):① `entryBySection`(能量跃升≥0.10→lead-in:intro→verse / verse→chorus / build→hook;重复段·loop→loop·收尾→downbeat)② `endingStyle`(pop=cold / rnb·lofi=fade / jazz=tag / 其它=cold)→ `ArrangementPlan`。器配 `instrumentalPlanner.buildEndingPlan` 据 endingStyle 排乐器进出(fade=drum→comp→bass 错开退出+pad/lead 留;tag=节奏件末小节退+holdFinalChord;cold=齐停+button)→ `InstrumentationPlan.endingPlan`。render 新 `render/ending.ts`:`applyEnding`(fade 力度渐弱 1.0→0.18+按 exitBar 丢音 / tag 末和弦延留到曲末 / cold 末小节重音+干净停)+ `applyLeadIns`(跃升段前末小节 crescendo 0.82→1.18 推进下拍);`drumRenderer` 加 bigFillBars(lead-in 边界更密 16 分 roll);renderCoordinator 在 applyDynamics 后接入(退出=只丢音→不引入 avoid;durations 改在 audit 前=末和弦仍合法)。实测 pop lead-in[verse1,chorus1]+cold / rnb fade(comp@2,bass@3)/ jazz tag(bass@3+末延留)/ lofi fade(drum→comp→bass)、确定性、既有 871 绿不破(+14 新=885 绿)、tsc/build 净。trace 加「段落衔接」行。**需耳朵复核**(衔接推进感 / 各风格收尾是否自然)。**缓**:endingStyle 加 seed 变化(现 per-style 固定)· intro 无鼓时 lead-in fill 被 gate(现靠 pad/comp swell 承接)
- 2026-06-08 修「还是有 seed 没 outro」(戛然而止)— 实测根因【两个,非收尾手势 bug】:① `knowledge/progressions.fitProgressionToBars` 按【slot 个数】铺(`out.length<bars`),但含半小节槽(`beats:2`,副属 ii-V 等)的 prototype:bars 个 slot ≠ bars 小节 → 段落和声短缺(chorus 12bar 仅 36 拍/应 48)→ chordTimeline startBeat 按时长累加 → 整体前移 → outro 被挤掉(实测 494/1080 首 outro tick 区间 0 音)。修=按【拍】铺满 + 末槽截断到刚好(每段 cov=bars×beatsPerBar,时间线末端=总拍;split 槽 ⇒ 和弦数≥小节数)。② 残留 43 首全 rnb:无 pad 编制 + lead 被 gate(outro 是 LEAD_OPTIONAL)+ comp 虽 active 但 outro 纹理=pad(floating→comp 不渲染)+ bass/drum 被密度弧 gate → 全空。修=`DENSITY_ARC` rnb/lofi `outro` 加 `bass`(bass 从 chordTimeline 渲染不受纹理 gate,落终止根音接地;纯派生无 rng)。修后 1500 首(10 风格×150 seed)EMPTY=0、每段铺满、时间线对齐。改 1 个旧不变量测试(和弦数=Σbars → 时长铺满=Σbars×bpb,split 后和弦数本应≥小节数)。+13 用例(898 绿)、tsc/build 净。无需耳朵复核(结构修复,outro 本就该有音)
- 2026-06-08 outro 和弦兜底 + 末小节不空(承上;用户:UI 起来后让 comp 兜底)— ① `renderCoordinator` activeSectionIds:floating 段【pad 未在场】(无 pad 编制 / jazz pad 从不进 density-arc)时让 comp 也渲染 → 兜底铺和声(条件从「无 pad 编制」改细为【该段 pad 不 active】,顺带修 jazz tag);有 pad 在场段 bit 不变。② `buildEndingPlan`:fade 的 comp 只在【有 pad】时早退(pad 接渐隐尾音);无 pad → comp 留作尾音声部靠力度 ramp 渐隐到末(否则末两小节空)。③ `render/ending.applyEnding`:tag 的 holdFinalChord 延留【真正最后一个和弦】(扫 hold 声部 outro 内最晚起音作延留起点),即便它起在末小节前 → 末小节必有延留和弦。实测末小节 overlap 计数(held 也算)600 首 finalBarSilent=0、no-pad fade outro 逐 bar 不空([7,8,6,6])。+末小节有声断言进 outroCoverage.test;898 绿、tsc/build 净。**需耳朵复核**(无 pad 编制下 comp 兜底铺的 outro 手感 / fade 尾音渐隐是否自然)
- 2026-06-08 用户两问:① 旋律对不上 groove ② outro 和声没回归 T、戛然而止(参考 Impro-Visor)。**①(c493bff)旋律↔groove 对拍**:根因=mgLeadRenderer 的 renderStyleFeel 把 jazz/blues 摆到 0.67(onset 偏),renderCoordinator 末尾 applySwing 又对全轨摆一次 → 旋律【双重 swing】偏离 groove 网格(实测 jazz 56% 离 8 分格,comp/bass/drum 只摆一次)。修=MG 链 swingRatio 压回 0.5(留 articulation/accent),swing 交 applySwing 全轨统一(Impro-Visor 思路:旋律生成在直拍 slot 网格,swing 是统一渲染层)→ jazz 56%→22% 离 8 分格、91% 在 16 分格、与 comp 同格。**② outro 回归主音**:实测 outro 末和弦本就 deg1,但【倒二从不是 V(penDominant=0)→ 无属解决动力】、lead 半数被 gate(noLead 51%)、在场也仅 7% 落主音。修三处:(a) harmony `ensureAuthenticEnding`——tonal 收尾段(harmonyRole='ending')末两和弦强制 V7→I(复用 overwriteChord,chord-scale assemble 重算守不变量;modal 旁路)→ penV=120/120·lastI=120/120·无 fatal;(b) instrumentalPlanner `LEAD_NEVER_DROP_TAGS`={outro,tag}——收尾段不丢 lead(仍掷骰保 rng 对齐→intro/texture bit 不变)→ noLead 51%→<1%;(c) mgLeadRenderer——tonal 末和弦区间末音 snap 到最近八度主音 → leadTonic 7%→92%。+6 用例(906 绿)、tsc/build 净。**需耳朵复核**(jazz 旋律与鼓 ride 同摆 / outro V7→I 落家 + 旋律收主音是否自然)
- 2026-06-08 CODEX directive `arranger_groove_transition_repair` 全 8 Loop(A-H,不改大管道)— **反馈先行**:Loop A 抓到我上轮 c493bff 误判(swing.ts 本就跳过 lead,无双重 swing;压成 0.5 反让 jazz lead 直、伴奏摆=错位,实测 lead 落摆动后位 4% vs comp 40%)。**A**(校正):lead timing 单一所有权=MG StyleRenderer(feelForStyle 原 swing),applySwing 续跳过 lead → jazz lead nearSwung 4%→38% 与 groove 同摆;test 改验单一所有权。**B**:timePlanner 加 rnb profile(96bpm,laidback 靠 groove/pocket/micro 非 global swing)。**C**:`InstrumentationPlan.transitionPlan`(BoundaryGesturePlan+SongEntryPlan,器配把 entryBySection 变可执行衔接:pickupRoles/downbeatAnchor/songEntry normal-intro|staged-first-bar;纯派生确定性)。**D**:activeRolesBySection lineup-aware 修复(floating/收尾段 pad 不在场但有 comp→comp 必 active 托底;授权放器配非 render 偷渲染)→ pop/64062 no-pad outro 现含 comp;render activeSectionIds 由此派生。**E**:gateByDensity transition-aware(lead-in prepBar 内 pickup 角色不被上一段 gate 删)→ intro 无鼓也保留 verse pickup drum fill(§1.1)。**F**:humanizeTiming 加 anchorTicks(段起/曲首/末主音下拍)夹 offset>=0 → 核心 downbeat 不被负 jitter 拉过边界。**G**:EndingPlan 扩 finalAnchorRoles/sustainRoles(pad 优先无 pad 用 comp,lead 不延留)/protectLeadTiming;applyEnding 改用 sustainRoles 延留(取代默认含 lead 的 HOLD_ROLES)。**H**:新增 render/musicalityAuditor(只读 warning 追加 AuditReport;controller 仅 error/fatal 重跑→warning 不重跑);6 规则(transition-pickup/section-anchor/song-start-abrupt/outro-support/comp-gap/lead-desync)。**golden seeds(3/7/42/77/64062/633823 × pop/rnb/lofi/jazz)我的 6 条音乐性规则全 0 触发**(Loop A-G 修后干净;残留 warning=既有 harmony chromatic-exposure 非本轮)。trace 印 groove/段落衔接/衔接计划/音乐性 summary。+8 提交(4fa6bab→79c3e94),+多组用例(933 绿)、tsc/build 净。**需耳朵复核**(§5:intro 不硬切/段落 release/drum pickup 在结构点/outro 不戛然/lead 与 groove 同摆/no-pad 不空尾)
- 2026-06-09 CODEX directive 追加 §1.8 + Loop I(跨轨 clock / texture pocket 对齐,用户听感:7/lofi·396040/pop 错拍,★777870/rnb verse 正向保护)— **I.2** 中央 texture clock(新 `render/textureClock.ts`,1:1 端口 MG `shapeLofiArrangement`/`lofiPocketMs`/`beatsFromMsAtStyleTempo`):LOFI 柱式块 onset 不再把 raw `0.58` 当最终 → 16 分格吸附 + 毫秒级 pocket(MG fallback chord[4,18]/bass[-2,4]ms,确定性 hash)→ 0.58→0.50+~20ms;`Soft_Roll` spread `0.05+idx*0.03`→`0.02+idx*0.015`(对齐 MG);accompanimentRenderer LOFI 走中央 clock(非 LOFI 仍 pocketize;bass 实测已 on-grid 故无需)。**I.3** no-pad comp structural anchor:`needsDownbeatCompAnchorBySection`(comp 唯一和声支撑/无 pad)→ texture `firstOnsetBeat>0.08`(wash 0.25)时 render 在 structural 下拍补轻 guide-tone shell(vel44/0.5拍);pop/396040 4/4 content 下拍现有 anchor。**I.4** musicalityAuditor +2 clock warning(`texture-clock-drift` LOFI 柱式块离 8 分格>0.055[roll 豁免]·`structural-comp-anchor-late` no-pad section 下拍 0.08 内无 comp)。**I.5** `textureClockAlignment.test`(§4.7:7/lofi 残差<=0.055+无 drift / 396040 无 anchor-late / **★777870/rnb verse golden 快照:lead 60≥50·restMax 2.00≤2.25·首 lead 落段首·comp 边界 delta 0.023≤0.05 不被修坏**)。实测 11 golden+issue seeds 端到端 0 failed、core 音乐性(transition/outro/comp-gap/clock-drift/anchor-late/desync)全 0 触发。+2 提交(74ce001·1b8fe56)+多组用例(938 绿)、tsc/build 净。**需耳朵复核**(§5:7/lofi·396040/pop 是否还错拍 / ★777870/rnb verse 手感是否保住)
- 2026-06-09 修「重音/复调对拍」(用户:大量 seed 在重音处发声错拍)— 实测根因:**comp 在整拍处系统性晚 0.02-0.05 拍**而 bass/drum/lead 在拍上(jazz +0.046/100%晚 · pop +0.020/30% · lofi +0.025/29%)= flam/错拍。三处修:① `pocketizeBeat` 落整拍(强拍位)的 comp 锁紧 strength>=0.85(offbeat 仍保 groove pocket)② comp 柱式块整拍 ±0.06 硬锁(与 bass/drum 咬合;arp/roll 单音不锁)③ roll/arp 首声部落格(`Soft_Roll`/`Wide_Color_Motion` beat+0.02→beat;`Lyrical_10th_Broken`/`Piano_Emo_Broken_10th`/`Soft_Guitar_Pluck` 去 +0.05/+0.02 统一晚拍 → roll 从拍点起、整拍 arp 音锁拍)。实测 comp 整拍平均偏移 jazz 0.046→0.000 · rnb 0.006→0.000 · pop 0.020→0.008 · lofi 0.025→0.013,bar 下拍多轨同拍。`texture-clock-drift` 审计改按比例(系统性才报,容个别 off-grid 锚点)。★777870/rnb golden 仍保护;8 golden/issue seed 端到端 0 failed/0 core warning。+`accentAlignment.test`;942 绿、tsc/build 净。**需耳朵复核**(重音处 comp 是否与鼓/贝斯咬合了)
