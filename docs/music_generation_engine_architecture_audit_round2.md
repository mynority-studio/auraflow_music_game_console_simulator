# 架构审计反馈 round-2(针对 CODEX 修正稿)

日期: 2026-06-03
对象: `music_generation_engine_architecture.md`(CODEX round-1 修正稿)
读法: 第 1 节确认"做对了、别动";第 2 节是这一轮的核心——Motif × Auditor × 重跑环 三角的完整规格;第 3 节其他要修;第 4 节是 punch list。

---

## 0. 总判

CODEX round-1 执行力强:9 条改动清单落地 8 条,4 个开放问题答了 3 个。**唯一没对齐的是新加的那块机器**——MotifStore 复述(§8.3)与 Auditor 触发重跑(§10)。两台机器都对,但**互相对撞、且没有缓冲/收敛**。经过乐理层面的推敲,这块现在收敛成一套自洽方案,本文件就是它的规格。

核心结论一句话:**A、B、C 不是三个独立 bug,是同一个子系统的三个面**——动机复述(B)、撞音消解(A)、纠错环(C)。要一起改。

---

## 1. ✅ 已落地,确认保留(不要在重做时改回去)

- faithful 全删、单管线 accompaniment-first
- Auditor 只读、密度不审计、硬边界"Resolver 改 / Auditor 报"
- ArrangementPlan 补全 tempo/meter/feel/phraseBreathing + 能量/高潮目标下发 Harmony
- 和声节奏归属:Arranger 给目标、Harmony 落实 chord count/duration
- primaryScalePolicy 分流(modal 主约束 / tonal jazz 仅身份提示,实际看 chordScaleMap)
- Arranger 拆 FormPlanner / TimePlanner / DynamicsPlanner
- 旋律 Skeleton→Variation→Recall 串联,grammar 定位成变体工具
- melodyReservationPlan + OccupationMap.reservedMelodyWindows
- KB ClimaxCalmRecipeLibrary + DynamicsPlanner.harmonicRhythmTarget

---

## 2. 核心修正:Motif × Auditor × 重跑环 三角

### 2.1 【新模型】动机身份是分层的:节奏 > 轮廓 > 音高

参照系是生日快乐(全程弱排比,却是最好记的旋律之一):

```
P1  [1 1 2 1] 4 3       head=1121   tail=43    起
P2  [1 1 2 1] 6 5       head 同      tail=65    承(整体抬高)
P3  [1 1] 5 3 1 7 6     起手仍 11,跳到 5 = 全曲最高点   转(高潮)
P4  [4 4] 3 1 2 1       head 换 44,但保留"两重复音+下行"   合(全终止)
```

- P1/P2 共享 head `1121`、只换尾 → **头不变=认得出,尾变=往前走**。
- 更深一层:**"两个重复音起+接续"这个节奏 cell 四句全保留**,连 P4 换音高(44)都留着。
- 结论:**身份最硬在节奏,其次在轮廓,音高最自由。**

MotifStore 的 motif 模型据此细化(取代当前的 `rhythmicShape + contour + 整条 skeleton`):

```
Motif:
  id
  rhythmCell          # 身份最硬,几乎所有复述都锁
  contourGesture      # 中等
  noteSlots[]:
    scaleDegree
    lockWeight        # 节奏位 > 轮廓 > 音高 派生,或显式
    segment: head | tail
  # head = 身份锚(高 lockWeight);tail = 功能段(低 lockWeight,按乐句功能再生成)
```

### 2.2 【B】restatementStrength = "锁多深"的阈值,不是段落类型的函数

当前 §8.3 把强度钉死成 `verse=light / chorus=strong`,这是退步。锁定方案:

```
restatementStrength ∈ [松 ... 强],由 Arranger 逐 repeatGroup 下发的连续标量(与段落类型解耦)
锁阈值 = f(strength):
  弱: 只锁 rhythmCell + head 轮廓     → tail 自由,按 cadence 功能生成   ← 默认,天生干净
  中: 锁 rhythmCell + contourGesture → 放 pitch
  强: 锁到 pitch(literal)            → 进 2.4 的 voicing 支撑阶梯
```

ownership:**Arranger 给标量(戏剧意图),Render 读标量选锁深度(技法)。** reusePolicy 不再凭段落类型硬编码。

### 2.3 【接线】tail 由乐句功能驱动 → MotifStore 必须接 Arranger 乐句层

生日快乐四个尾巴是 **起/承/转/合**(开放/半收/冲高潮/全终止)——同一个 head 靠四个不同尾服务四种结构功能。所以 **tail 生成不是随机,是被乐句功能驱动的**:

```
Arranger:  这句 = antecedent(开放) | consequent(半收) | climax | cadence,+ restatementStrength
Render:    head 锁;tail 按该乐句的终止功能生成(落到对应的开放/半收/高潮/终止音)
```

当前 §8.3 复述策略 和 §5 `phraseBreathing` / `cadenceBreathPolicy` 是**断开的**,必须接通。

### 2.4 【A】撞音消解:选音 + voicing 阶梯,Auditor 不开豁免

**先废弃上一版讨论里的 `intentional` 豁免方案**——那是治标(放行撞音)。治本是:**在选 hook / 写 riff 时就让它跨和弦合法;真撞,用 voicing 和锁深度化解。Auditor 保持铁面,不开任何豁免口。**

依据(实例):hook `1121`+ 重音 C/G,首句在 Cmaj7 干净;下一和弦换 A7,**旋律不变**、伴奏换 `A3 G4`(省掉 3 音 C#)、宽阔排列 → G=b7(共同音)、C=#9(可接受张力)、B=9,撞音不出现。

落地分三件:

**(a) 和声跨度感知的选音(预防):**
```
设计会被复述的 hook 时:
  取其复述跨度上"所有和弦"的 chordScaleMap / avoidNoteMap,做交集
  → 共同安全音集(各和弦的 和弦音 ∪ 可接受张力)
  骨干音 / 重音 / head 必须落在共同安全音集;真 avoid note 不得做骨干
数据现成:HarmonicPlan 已有 chordScaleMap/avoidNoteMap,只需按 hook 跨度做交集,而非逐和弦单看
```

**(b) 撞音消解阶梯(仅"强排比"档才需要,弱排比天生不进):**
```
1. 宽阔排列 first:把 2 度拉成 9 度;voicing 省掉会撞的和弦音(如省 3 音)
   ★ accompaniment-first → 伴奏迁就已知 hook 锚点
     ⇒ melodyReservationPlan 必须为 hook 段携带"锚点音高",不只是空窗口
2. 换 hook:该复述槽位换一个动机
3. 沿锁链退一层(强→中→弱):让 tail 解锁去贴和弦(= 2.2 的强度降档)
```

**(c) KB 须有细分的张力模型(地基):**
```
ConstraintLibrary 必须区分:
  acceptable tension(#9/9/11/13,按和弦品质 + 风格)  ≠  avoid note
  选音 与 Auditor 共用同一张表
  否则:选得再好,Auditor 仍把 "C 压 A7 = #9" 误判成违规
```

**Auditor 结论:** 仍然只读、严格;但其 avoid 判定走上面的张力模型。阶梯保证到达 Auditor 前输出已干净,所以**不需要 intentional 豁免**,也基本不会因 hook 触发重跑。

### 2.5 【C】重跑是控制环:要 owner、要预算、要收敛——现在三样都缺

§10 的 `error→返回 resolver/renderer`、`fatal→返回 section` 是个**反馈环**,方向对,但:

- **环是隐形的**:§2 流程图、§11 数据流还是纯直线,回边没画。控制流就是架构,回边不画就没人设计。
- **没人 own**:谁读 AuditReport、谁决定重跑哪级、谁防死循环?未指定。RenderCoordinator 只写了"排顺序"。
- **不收敛**:确定性重跑(同 seed 同输入)→ 产出一模一样 → 同样 error → **无限循环**。

修法:
```
1. 把回边画进 §2 / §11
2. 指定 controller(RenderCoordinator 扩职 或 新 GenerationController):
     读 AuditReport.suggestedReturnPoint → 选重跑级 → 用"变化过的输入"重跑 → 再审
3. 收敛三要素:
     a. 每次重跑必须有变化(推进 RNG / 松一档约束 / strength 降一档 / 取次优候选)
     b. retry budget(如每 section ≤ N 次)
     c. budget 耗尽 fallback(接受+warning 降级,或退回保证过审的安全进行/voicing)
```

注:因为 2.4 的"弱排比默认 + 选音 + voicing 阶梯"在 renderer 内就把绝大多数 hook 撞音消解了,**这个环主要处理别处的真错误,hook 这条不再喂它,负载大幅下降。**

---

## 3. 其他要修(次要,可一并)

- **D · 源选择规则没写。** §8.3 列了 GuideTone / Grammar 两个 skeleton 源,但没写谁按什么选。规则:**hook 句 → grammar cell(可复述);连接句 → guidetone(贴和弦,但天生锁不住轮廓 = 差 hook 源)**,由 `section.hookPolicy / role` 驱动。
- **F · MotifStore 键太粗 + 句内粒度缺。** `sectionRole → motifId` 会丢掉"一个 verse 里多动机"和"bridge 引用 verse 动机"。改 **`motifId` 为主键**,绑定关系用 Arranger 的 `repeatGroup`/slot 表达。另外**"句内同动机跨和弦模进"这个细粒度目前没人 own**(只有段落级 repeatGroup),补上。
- **E · KB 边界还偏"漂亮原则"。** §3/§13 收成"KB 给候选/权重/模板/约束,Engine 选择组合绑定",比"只定义不决策"诚实,但**没拿具体例子证明不漏**。补一个 worked example(如"lofi:KB 出带权进行候选,engine 按 seed+energy 选")钉死数据 vs 算法的比例。

---

## 4. round-2 punch list

1. **MotifStore 模型分层化**:rhythmCell / contourGesture / noteSlots(lockWeight + head|tail)。
2. **restatementStrength = 锁深度阈值**,Arranger 下发连续标量,与段落类型解耦。
3. **tail 接乐句功能**:复述时 head 锁、tail 按 Arranger 的 cadence/energy 功能生成 → 接通 §8.3 与 §5 phraseBreathing。
4. **撞音走选音 + voicing 阶梯,不加 intentional 豁免**:
   - (a) 和声跨度感知选音(共同安全音集做骨干);
   - (b) 阶梯:宽阔排列(2度→9度/省音)→ 换 hook → 沿锁链退档;
   - (c) KB ConstraintLibrary 加"张力 vs avoid note"细分模型,选音与 Auditor 共用。
5. **melodyReservationPlan 为 hook 段携带锚点音高**(让 accompaniment-first 迁就已知 hook)。
6. **重跑环显式化**:画回边 + 指定 controller + retry budget + fallback + 每次重跑必有变化(收敛)。
7. D:写 role→源 选择规则(hook→grammar / 连接→guidetone)。
8. F:MotifStore 改 motifId 主键;补"句内模进"粒度归属。
9. E:KB 补 worked example 钉死数据/算法比例。

---

## 5. 依赖关系(给 CODEX 的一句话)

**A / B / C 是一个子系统,别分开做:**
- **B** 给出强度滑块 = 锁到身份链(节奏>轮廓>音高)多深;
- **A** 是这条滑块在"强"档撞和弦时的消解阶梯(选音 + voicing,退档=滑回 B 的中/弱);
- **C** 是这一切都失败后的兜底纠错环(有预算、有 fallback、会收敛)。
- 心智模型:**Auditor = 传感器(只读、严格),controller = 执行器(预算化重跑),张力模型 = 传感器的判据,锁深度阶梯 = 执行器在 renderer 内的预消解。** 弱排比是稳健默认,强排比是需要 voicing 撑的特例。
