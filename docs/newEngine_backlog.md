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
- [ ] 6.3 A/B seed 对比 + 日志 diff
- [ ] 6.4 ESP32 C 移植同步(/sync-to-c,远期)

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
