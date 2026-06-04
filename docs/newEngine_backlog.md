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
- [ ] 2.5 swing / feel 落地(swingRatio 改 tick)

**Tier B · 伴奏 / 旋律加厚**
- [ ] 1.5 Pad / 铺底轨(floating 段长音)
- [ ] 1.3 真 Voicing(drop2 / rootless / open + 顶音 voice-leading)
- [ ] 2.4 旋律轮廓弧线(音区 / 密度随能量,高潮冲峰)

**Tier C · 真内容引擎**
- [ ] 2.2 真 grammar 变体(接 grammar 资产 transform/divide/development)
- [ ] 2.3 GuideTone tail(connector/cadence 句按 cadenceTarget 导音解决)

**Tier D · 结构 / 和声起伏**
- [ ] 3.1 Dynamics 真消费(energy/density/climax 落力度/密度/音区)
- [ ] 3.4 终止式(乐句尾真 cadence,V-I 落点对齐 cadenceTarget)
- [ ] 3.2 副属(V7/V,secondaryTarget 落地)
- [ ] 3.3 借和弦(borrowedChordMap 落地)
- [ ] 3.6 真 chord-scale(取代 stable∪acceptable 占位)
- [ ] 3.5 曲式多样(seed 选模板 + 段落长度变化)

**Tier E · 表现力 / 纠错环**
- [ ] 5.3 力度 / 微时序人性化(velocity 曲线 + 微 timing)
- [ ] 5.1 Auditor finding → 精确返回点(真用 candidateSwap/restatementOverride)
- [ ] 5.2 撞音阶梯实战验证(构造难例跑通全阶梯)
- [ ] 5.4 混音(各轨相对音量 / 声像)

**Tier F · regime / 边界**
- [ ] 4.1 modal regime(modal vamp + primaryScale 着色)
- [ ] 4.2 小调打磨(harmonic minor V7 / 终止)
- [ ] 4.3 转调(modulationMap 落地)

**Tier G · 工具 / 观测 / 移植**
- [ ] 6.1 面板 piano-roll(各轨音符可视化)
- [ ] 6.2 MIDI 导出(.mid)
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
- 2026-06-04 2.1 — 旋律句尾呼吸:末小节稀疏单长音解决(cadence 落主音/其余回锚点,贴和弦安全音)+ 末 cadenceBreath 拍留白;消费 phraseBreathing;Auditor 抓出主音落属和弦的 avoid 暴露→已 snap 修;+3 用例(193 绿)。**需耳朵复核**(留白量/解决感)
- 2026-06-04 1.4 — 鼓变化:per-style groove(pop backbeat/lofi 半拍/jazz swing ride)+ 段落转折 fill(末小节 16 分 roll)+ 确定性力度人性化(逐小节抖动);drumPattern 进 grooves;+3 用例(190 绿)。**需耳朵复核**(groove/fill/抖动幅度)
