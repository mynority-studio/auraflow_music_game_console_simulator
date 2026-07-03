# Intent Migration Inventory (Phase 0)

> `mg_intent_planning_layer_migration_directive_v2.md` Phase 0 产物。**只读盘点,不改任何输出。**
> 目的:枚举 render 层现有 pass/patch,分类为 `renderSafety` / `moveToIntent` / `deleteAfterMigration`,
> 并标出各自的 intent 迁移目标 + 所属 Phase。**决策锁**(用户 2026-07-03):派生来源 = SIM-native 纯函数
> (StyleIntentProfile / GrooveContract / HarmonicPlan / ArrangementPlan / 已移植 MG-KB / `deriveAcgTextureCharacter` 样板;
> MG oracle 仅校准/审计);intent 位置 = `newEngine/intent`(类型)+ `newEngine/arranger/deriveMusicIntentPlan`(派生)
> + `newEngine/knowledge/styleIntentProfiles`(风格规则)。

---

## A. 三类定义(含 §5 realization vs safety 澄清)

- **renderSafety** — intent-无关的安全后处理。**保留**,不迁移。仅:range clamp · overlap cleanup(sanitize)·
  voice-leading safety · avoid-note correction · tail clamp · 在 GrooveContract 下的 timing/velocity humanize · mix。
- **intent-realization pass** — **实现某个已存在 intent** 的渲染步骤,**可以晚期执行**(如 ACG `chordRoll` 必须在
  humanize 之后跑,以重组被 humanize 散开的同起点块)。归入 `moveToIntent`:它本体保留,但要显式挂到 enforce intent 上,
  **不再是 unowned final patch**。禁止的是 *unowned post-render patch*,不是所有 late pass。
- **moveToIntent** — 现在活在 render/knowledge 层的 musical intent(谁 block/roll、lead 多满、bass 密度、texture family、
  曲式能量),要把【决策】上移到 arranger/plan;render 只保留【实现】。
- **deleteAfterMigration** — 迁移后可删的 unowned/seed-specific patch。当前**几乎为空**(本 session 尝试过的 LOFI floor /
  RNB lead cap 已全回滚,未入库);迁移用 adapter 包裹,Phase 7 才删。

---

## B. Render pipeline pass 顺序(`renderSongFull`,决策/塑形相关)

```text
1  enforceBassDensityFloor          bass 主体段强拍补 root anchor
2  renderAccompaniment→renderTextureCompDryStrictMg / family interpreter   comp(onset-form 来自 oracle cardinality)
3  renderMgMelody                   lead(MG grammar/brick/roadmap;byte-parity 源)
4  resolveInteractions              occupation/撞音消解
5  gateByDensity                    按 activeRolesBySection 丢不在场角色的音
6  (mix/CC 投影)
7  duckUnderLead                    comp 撞 lead → ×0.9
8  applyDynamics                    段能量 velocity 缩放
9  applyEnding / applyLeadIns       收尾 / 前导
10 fillLeadBarGaps                  末音后大空拍→延 bar 末(ACG 跳过)
11 applyRepeatGroupReplay           ★重复段一致点(此后动 body 会破 repeat)
12 snapCompLaidback                 comp 弱16分去拖拍(straightFeel)
13 humanizeVelocity → applySwing    force/swing humanize
14 (freeze auditedIR = 审计点)
15 humanizeTiming → applyGroovePocket  timing humanize + GrooveContract ms-pocket
16 sanitizeLead → connectFastLeadNoteIR(legato) → sanitizeLead
17 [ACG only] tuckAcgLead → resolveAcgTailExpectations → repairAcgLeadGaps
              → shapeAcgComp(addInnerVoice/carve/harmonyFloor/chordRoll/deCollideOnsets)
              → spaceAcgBass → normalizeAcgDynamics → legato → sanitize
18 applyRenderMixBalance            lead/comp 有效响度平衡(CC7)
```

**关键排序事实(本 session 血泪):** ① repeat replay(11)是重复段一致点 —— lead coverage / comp 续洞若在 11 之后决定,
就会破 repeatGroupConsistency。② legato/pocket(15-16)在 replay 之后会 re-extend lead → 任何"replay 前的 coverage 决定"
被下游放大。③ 所以 **LeadGrammarIntent 必须在 11 之前生成,且 legato/pocket 必须消费其 boundary**(Phase 6 高风险点)。

---

## C. 分类清单

### C.1 moveToIntent — bass

| pass / 文件 | 现状 | 迁移目标 | Phase |
|---|---|---|---|
| `enforceBassDensityFloor` (`render/bassDensityFloor.ts`) | 主体段强拍补 root anchor(clean win) | `BassPatternSchedule`{family rootAnchor/walking, minAnchorsPerBar, targetNotesPerBar} | 2 |
| `finalEventProfile.bassFloorBeats` (`knowledge/finalEventProfile.ts`) | 逐 style 地板拍位 | `styleIntentProfiles` bass 偏好 + 派生 `BassPatternSchedule` | 2 |
| `spaceAcgBass` (`render/acgCompShape.ts`) | ACG bass 瘦身到 anchor+支撑 | `BassPatternSchedule`{family minimal/rootAnchor}(ACG) | 2 |

### C.2 moveToIntent — texture family(决策上移,SIM 仍选具体 case)

| pass / 文件 | 现状 | 迁移目标 | Phase |
|---|---|---|---|
| `buildTextureSchedule` 非 ACG 段级/LOFI 选择 (`render/textureSchedule.ts`) | 器配 richTextureBySection + 逐 span pick | `TextureFamilySchedule`(arranger 定 family)+ resolver 选 case | 3 |
| `pickAcgTextureForBar` + `deriveAcgTextureCharacter` (`knowledge/textureProfiles.ts`) | ACG 逐-bar family(和声动量派生 character)★**样板** | `TextureFamilySchedule`(ACG);character 派生逻辑上移 arranger | 3 |
| `acgRenderProfile.sectionFamilyBias` (`knowledge/acgRenderProfile.ts`) | intro/outro 空·chorus 推进·section-energy family | `styleIntentProfiles.acg` + `TextureFamilySchedule` | 3 |
| `resolveTextureProfileForIntent`(**待建**) | — | KB resolver:只在已定 family 内选合法 case,**不重决 story**,专用 RNG 子流 | 3 |

### C.3 moveToIntent — comp onset-form(realization,pass 保留挂 intent)

| pass / 文件 | 现状 | 迁移目标 | Phase |
|---|---|---|---|
| `renderTextureCompDryStrictMg` (`render/mgTextureCompDry.ts`) | oracle cardinality 决定 single/block(n≤1单/n≥2块) | `CompOnsetFormSlot` realization(block/roll/sparseAnswer);oracle 仅**校准** | 4 |
| `shapeAcgComp`→`chordRoll`/`deCollideOnsets` (`render/acgCompShape.ts`) | ACG 同起点块→滚动琶音(intent-realization,late OK) | `CompOnsetFormSlot`{form rollHeavy, targetSingleRatio[0.95,1]} | 4 |
| family interpreter comp(4 无 oracle 的 RNB case) (`render/textureRenderer.ts`) | classifyLegacyFamily 名字归类 | `onsetForm` metadata + arranger family intent | 3-4 |

### C.4 moveToIntent — lead grammar / coverage(Phase 6 高风险,先 observe)

| pass / 文件 | 现状 | 迁移目标 | Phase |
|---|---|---|---|
| `fillLeadBarGaps` (`render/leadGapFill.ts`) | 末音后大空拍→延 bar 末(抬 coverage) | `LeadGrammarIntent`{maxGapBeats, targetCoverage, preserveRests};部分 renderSafety | 6 |
| `tuckAcgLead`/`resolveAcgTailExpectations`/`repairAcgLeadGaps` (`render/acgLeadShape.ts`) | ACG 落点塑形/尾音解决/空床填充 | ACG `LeadGrammarIntent` shaping(realization) | 6 |
| `normalizeAcgDynamics` (`render/acgDynamics.ts`) | ACG 三轨力度归一(mf 亮层) | ACG velocity intent(styleIntentProfile);部分 renderSafety | 6/2 |
| **RNB lead coverage**(本 session 回滚) | 无(reverted) | `LeadGrammarIntent`{targetCoverage};**调 grammar/scheduler 让旋律本身更稀**,不 post-cap;repeat-safe 前只 observe | 6 |

### C.5 renderSafety — 保留,不迁移

| pass | 类别 | 说明 |
|---|---|---|
| `sanitizeLeadNoteIR` | overlap cleanup | 同 pitch collision 裁短(安全) |
| `resolveInteractions` | voice-leading / avoid-note safety | occupation 撞音消解 |
| `duckUnderLead` | mix ducking | comp 撞 lead ×0.9 |
| `humanizeVelocity` / `humanizeTiming` | timing/velocity humanize under contract | 在 GrooveContract 下 |
| `applySwing` | contract feel | swing ratio 来自 contract |
| `applyGroovePocket` | contract ms-pocket | 消费 GrooveContract;⚠️ 对 lead 需 Phase 6 挂 intent boundary |
| `snapCompLaidback` | clock-safe realization | comp 弱16分去拖拍;clock-safety |
| `connectFastLeadNoteIR`(legato) | articulation safety | ⚠️ Phase 6 后需消费 lead intent boundary(不越 coverage) |
| `applyRenderMixBalance` | mix | lead/comp 有效响度平衡 |

### C.6 已是 intent-driven(arranger 已拥有,归入 realization,无需搬)

| pass | 消费的 intent | 说明 |
|---|---|---|
| `gateByDensity` | `activeRolesBySection`(arranger) | 密度弧谁进/出,已是 plan 决策的 realization |
| `applyDynamics` | `energyRanges`(arranger) | 段能量,已上游决定 |
| `applyEnding` / `applyLeadIns` | `endingPlan` / lead-in(arranger) | 收尾/前导 plan |
| `applyRepeatGroupReplay` | repeat group(arranger) | 重复段结构;**intent 必须 replay-consistent** |

### C.7 deleteAfterMigration — 当前空

本 session 尝试的 unowned patch(LOFI comp 续洞 floor、RNB lead post-cap)**已全回滚,未入库**。
现有 render 塑形都有 owner(bass floor / ACG shaping / texture family),Phase 7 用 adapter 等价证明后再删,不预删。

---

## D. Phase 映射汇总

| Phase | 搬什么 | 风险 |
|---|---|---|
| 2 | bass floor + spaceAcgBass + finalEventProfile → `BassPatternSchedule` | 低(已是 clean win,等价包裹) |
| 3 | texture family(ACG character 样板 + 非 ACG 段级)→ `TextureFamilySchedule` + KB resolver | 中(RNG 子流纪律 · resolver 不当 arranger) |
| 4 | comp onset-form(oracle/chordRoll/family)→ `CompOnsetFormSlot` | 中(realization 挂 intent,oracle 仅校准) |
| 5 | LOFI texture transition(bridge 在 replay 前、repeat-safe、clock-safe)→ `TextureTransitionPlan` | 高(撞过 5 契约) |
| 6 | lead grammar/coverage → `LeadGrammarIntent`(replay 前生成,legato/pocket 消费 boundary) | **最高**(replay/legato/pocket ordering;做不到 repeat-safe 只 observe) |
| 7 | 删已迁移的 unowned patch,保 renderSafety | 低 |

---

## E. Phase 0 验收

- 只读盘点,**未改任何代码/输出**。
- 下一步(Phase 1)前需锁:#1 派生来源(已锁=SIM-native)· #4 位置(已锁=`newEngine/intent`+`arranger`+`knowledge`)。
- RNG 纪律(#3):observe 派生**纯函数不抽 RNG**;enforce 抽样用命名子流;resolver 不碰主 RNG。
