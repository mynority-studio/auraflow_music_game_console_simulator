# 架构审计反馈 round-3(针对 CODEX round-2 修正稿)

日期: 2026-06-03
对象: `music_generation_engine_architecture.md`(已含 GenerationController / Motif-Anchor Prepass / tensionModel 等 round-2 改动)
前序: `..._audit.md`(round-1 六战线裁决)、`..._audit_round2.md`(Motif×Auditor×重跑环三角)
读法: 第 0 节总判;第 1 节两条新原则(写进 §14);第 2 节 G1–G5 逐条裁决 + 改动;第 3 节 punch list。

---

## 0. 总判

CODEX round-2 把 round-2 punch list 9 条全部落地,有几条比要求更好(Prepass 独立成阶段、hybrid 源、`fallback still fails → failed report 不静默输出`、noteSlots 带 functionalTarget、OccupationMap 加 anchorConflictRisk、§3.2 worked example)。**A/B/C 主体已对齐、可开工。**

本轮处理的是新机器(Prepass / 重跑环 / 跨段动机)接缝处冒出的 5 个二阶问题。用户已逐条裁决,**结果是架构反而更简单了**——其中 G2 的洞因"和声不重跑"自行消失,G4 不需要新通道。

---

## 1. 两条新原则(请写进 §14 架构原则)

```text
A. Arranger 权威 / 和声不可变:
   Arranger 是最高权威,定死 调式/调性 regime 与和声。
   render / retry / hook 一律只能在这个框内适应,永远不能反过来改和声。

B. 让位按织体分流:
   active comp 要为 hook 让位(预定锚点 + voicing 瘦身);
   pad / 柱式长音织体不用让位,旋律自由浮在其上。
```

---

## 2. G1–G5 裁决与改动

### G1 · 排比用全局视角求安全音

**裁决:** 做排比时临时切到全局视角。

**改动:**
1. `commonSafeToneSet` 加**作用域模式**:
   - `local span`(默认):句内模进 / 非复现句,逐和弦区间查;
   - `global span`(复现 hook 的 head):对该 `motifId` **所有出现位置的和弦并集**求交集,一次定死 head 锚点 → 每次出现一致。
2. **全局交集为空**(hook 跨太远和声)→ 该 hook **自动降为弱排比**(head 跨这段锁不住),不报错。
3. **复现 hook 的消解阶梯换序**:`voicing → 降锁深度 → 换 hook`(换 hook 毁跨段身份,只能垫底)。非复现句沿用 §8.5 原序。

> 安全音是局部 span 视角,动机身份是全局 repeatGroup 视角——给 head 锚点接上全局视角,这两者才一致。

---

### G2 + G4 · 合并:Arranger 权威,和声不可变

**裁决:**
- G2:不允许重跑和声,和声在 Arranger 层定死,Arranger 权限更高。
- G4:和声必须优先(调性音乐);调式音乐则和声宽松、旋律跑 scale 构成色彩。也是 Arranger 层的事,下游不能改和声。

**改动:**
1. **删除 GenerationController 的 `harmony section retry` 返回点**(§1 / §2 mermaid `GC→MG` 回边 / §11)。重跑只能动 render 层(resolver / melody phrase / voicing),**碰不到和声**。
2. **`fatal` fallback 重写**(§11):render 层兜不住时,只能**接受 + warning** 或**返回 failed generation report**,**绝不静默改写 Arranger 的和声**。
3. **G2"锚点过期"问题随之消失**:和声永不重跑 → Prepass 锚点不会因和声变动过期。**不需要补 `GC→Prepass` 边**,此洞自然闭合。
4. **调式 / 调性做成一等 regime 开关**(挂 `BandSpec.tonalityKind`,Arranger 权威),它改变整套"和声 vs 旋律谁约束谁"的松紧:
   ```text
   tonal:  和声严格、优先;旋律 / hook 适应和声(可降弱,接受)。
   modal:  和声宽松 / 静态(modal vamp);旋律跑 scale 音阶构成色彩,对旋律约束松。
   ```
   要写进原则,不只是 BandSpec 一个字段。

---

### G3 · hook 让位三条路(含和声 voicing 瘦身)

**裁决:** tail 也要锁;或长音 pad/柱式不用让位;伴奏可让某音,全局和声可松动到只保留该和弦基本色彩(7 和弦降三和弦 / 三和弦只留两音)。

**改动——hook 让位按下列分流:**

1. **强排比 → Prepass 预定 tail 锚点**:`MelodyAnchorPlan.selectedAnchorPitches` 在 `restatementStrength` 高时扩展到锁定的 tail,伴奏对整条锁死动机让位。
2. **pad / 柱式长音织体 → 不让位**:AccompanimentRenderer 的让位策略**按织体类型分流**,长音织体跳过让位(旋律自由浮于其上)。
3. **voicing 支撑阶梯加一档"和声瘦身"**——注意这是**改 voicing,不改和声**(HarmonicPlan 里 Dm7 仍是 Dm7,只是少弹几个音):

```text
按"可丢弃度"从高到低丢音,为锁死的 hook 让出音位:
  5 音    ← 最先丢(纯五度无色彩)
  根音    ← 次丢(bass 已覆盖 = rootless)
  7 音    ← 再丢(7 和弦 → 三和弦,基本色彩仍在)
  3 音    ← 永不丢(定大小调 = 和弦身份)
保底:3+7 = guide-tone shell;降到两音则留 根/3 或 3/7
约束:保住定性音(3 音,其次 7 音),只丢冗余音(5 音、根音)
```

   "7 和弦降三和弦" = 丢 7 音;"三和弦只剩两音" = 丢 5 音留根 + 3。接到 §3 VoicingLibrary 已有的 `omit rules`,扩成"为锁死 hook 让位时的瘦身次序"。

---

### G5 · 化繁为简:读 + 改尽力,改不动无妨

**裁决:** 按 round-2 G5 做,但简化;读、改最好,做不到也没关系,不影响架构。

**改动:** 不搞复杂三方握手。

```text
Resolver = 读 + best-effort 就地改(用共用 tensionModel)
  → 改不动也无妨,放过,Auditor 只读报告
  → 真过不了才 Controller 升级(少数情况)
```

唯一硬要求:**Resolver 也用同一张 `ConstraintLibrary.tensionModel`**(§3.1 现在只列了选音 + 审计两处共用,补上 Resolver)。其余不过度工程化。

---

## 3. round-3 punch list

1. `commonSafeToneSet` 加 `local | global` 作用域;复现 hook 的 head 用 global span;空交集 → 该 hook 降弱排比。
2. 复现 hook 的消解阶梯换序:voicing → 降锁深度 → 换 hook。
3. **删 `harmony section retry` 返回点**(§1/§2/§11);和声对 render/retry 不可变。
4. **`fatal` fallback 重写**:render 兜不住 → 接受+warning 或 failed report,绝不改写和声。
5. 删除待补的 `GC→Prepass` 边需求(G2 洞已因 #3 自然闭合)。
6. **调式/调性 regime 一等化**:tonal=和声严格旋律适应 / modal=和声松旋律跑 scale,写进 §14。
7. 强排比 → Prepass 预定 tail 锚点(selectedAnchorPitches 扩展)。
8. AccompanimentRenderer 让位策略**按织体分流**:active comp 让位 / pad·柱式不让位。
9. voicing 阶梯加"和声瘦身"档(丢 5→根→7,永不丢 3;保 3/7 shell),接 VoicingLibrary.omit rules。
10. §3.1 tensionModel 共用方扩到 **Resolver**;G5 流程简化为 best-effort 读改、改不动放过。
11. §14 加两条新原则:Arranger 权威/和声不可变;让位按织体分流。

---

## 4. 一句话收尾

5 条全部落地,**架构因这轮裁决变得更简单**:少了 harmony retry 这条回边和它的 fallback 复杂度,多了一条清晰的权威链(Arranger 定死和声与 regime,下游只在框内适应)。Motif 系统的命根子——跨段身份——靠 G1 的全局视角立住;强排比的尾靠 G3 的"预定 tail + voicing 瘦身"接住;两者都没碰和声不可变这条底线。可以进入实现设计了。
