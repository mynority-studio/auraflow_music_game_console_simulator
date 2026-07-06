# Intent Migration Status(Phases 0-7 · 整体审计用)

> `mg_intent_planning_layer_migration_directive_v2.md` 全 phase 跑完的状态图。**核心不变量:所有 enforce 都 byte-identical(纯所有权迁移,零音符改动);会改 musical story 的 enforce 全 deferred(记录原因)。**

## A. ENFORCED —— render 消费 intent,byte-identical(零输出改动)

| Phase | 迁移 | 机制 | 等价证据 |
|---|---|---|---|
| 2 | bass floor → `BassPatternSchedule` | `applyBassPatternSchedule`(共享 `addRootAnchorFloor`)替 `enforceBassDensityFloor` | `bassPatternScheduleEquivalence.test` 逐字节 · non-acg bass 不变 |
| 3A | ACG texture family → `acgBarFamilyBySpan` | `deriveAcgBarFamilies`(原 ACG 分支抽取);texture 分支从 intent 读 | ACG texturePerBar 逐字一致 · audit-acg 无 FAIL |
| 4 | ACG comp onset-form → `rollHeavy` | chordRoll 实现之(intent 声明所有权,realization 不变) | audit-comp-onset ACG single≥0.6 18/20 |

## B. OBSERVE —— intent 已声明但 render 不消费(零输出改动)

| Phase | 声明 | 来源 |
|---|---|---|
| 1 | section role/energy/grooveContractId | ArrangementPlan |
| 3 | 非 ACG texture family(song-level) | GrooveContract preferred 主导 family |
| 4 | 非 ACG comp onset-form | GrooveContract preferred 主导 onset-form |
| 5 | TextureTransitionPlan(空 slots) | — |
| 6 | LeadGrammarIntent(targetCoverage/maxGap) | styleIntentProfiles(MG 参考区间) |

## C. DEFERRED ENFORCE —— 会改 musical story / 撞契约,需专门任务(记录墙)

| # | 目标 | 墙 | 解法方向 |
|---|---|---|---|
| 3C | 非 ACG per-section texture 收敛(每段一 family) | 改 musical story,现 render 段级已选,收敛可能减多样性 | 需听感 + 审计,用户单独签字 |
| 4E | 非 ACG comp onset-form 对齐 MG(block/roll) | 是【器配纹理选择】per-seed 差异(RNB 诊断:SIM 选 roll,MG 进行给 block),非 render 可清修 | arranger 定 family → resolver 选 case(resolveTextureCaseForIntent 已建骨架,未接线) |
| 5E | LOFI phrase-level texture 变化(接近 MG variety) | 撞 5 契约:accentAlignment/textureSwitchMusicality/textureClockAlignment/outroResolution/repeatGroupConsistency | repeat-safe bridge(replay 前规划)+ accent-preserving 选择 + 改 ≤2 设计契约 + outro clamp |
| 6E | 非 ACG lead coverage 对齐 MG(RNB 太满) | parity byte-lock + replay→legato→pocket ordering 死结(cap 在 replay 前被 re-extend,在后破 repeat) | grammar 阶段让旋律本身稀(改 renderMgMelody/scheduler)OR legato/pocket 变 intent-boundary-aware,replay-safe 前只 observe |

## D. 可用审计

- `scripts/audit-intent-phase1-no-output-change`(确定性/无 RNG 漂移)
- `scripts/audit-mg-intent-family`(texture family match rate)
- `scripts/audit-comp-onset-intent`(comp onset-form 意图 vs 实际)
- 既有:`audit-non-acg-per-section-feel` · `audit-acg-per-section-feel` · `audit-mg-current-parity --full` · `audit-mg-bass-comp-lead-fidelity`

## E. 验证状态

- **parity 30/30 · tsc 净 · vite build 绿**。全 ENFORCED 部分 byte-identical。
- ⚠️ 已知 12 测失败(9 文件)= **非本迁移**:6 用户并行 WIP(leadArticulation/leadSanitizer/leadLegato/jazzInstrumentPriority/keyboardCompColor/widePianoVoicings)+ 3 SLOPE 降权旋律位移连带(musicalityAuditor/pianoCompAudit/productLeadNonMutation,基线待更新)。

## E2. ★ 经验探测(2026-07-06)—— 为何 4 个 enforce 必须要耳朵,不能自动 flip

直接 enforce【现 SIM-native intent】= 大回归,证据(非 ACG 实际 texturePerBar 的 family/onset vs 现 intent):

| seed/style | family match | onset match | 直接 enforce 后果 |
|---|---|---|---|
| 7/pop | 85% | 15% | onset 收敛改多数 comp 形态 |
| 42/pop | 48% | 100% | family 收敛改半数 texture |
| 42/rnb | 54% | 46% | 两者都大改 |
| 99/rnb | 100% | 100% | 无变(巧合已对齐) |
| **99/lofi** | **0%** | **0%** | **LOFI 全段被逼成 'wash' → 毁掉 dusty-chop/oneshot 变化** |
| 3/jazz | 53% | 47% | 大改 |

**结论**:现 intent 是 **song-level 主导 family**(Phase 3 首版),对【每段变化的非 ACG】太粗 → enforce = flatten 回归(尤 LOFI)。要非回归 enforce,需**先把非 ACG intent 派生做成 per-section MG-like**(不是 song-level 主导),这是【音乐知识 + 耳朵】的活,不是 enforce 机制的活。ACG 能 byte-identical enforce 是因为 `deriveAcgBarFamilies` 把 render 已有的【好】逐-bar 逻辑抽出;非 ACG 没有等价的"已有好逐-bar 逻辑"可抽(器配段级选择本身就是待改进对象)。

**★ Phase 7 收尾已做(`d953e9d`,byte-identical)**:单源 intent(render 挂 report,消双派生)+ 修 ACG bar-family audit gap(report.intent.acgBarFamilySpanCount 现 ACG=54)。

## F. 整体审计建议

1. **听感**:ENFORCED 部分应【听不出变化】(全 byte-identical)。若 ACG/bass 听感与 v4 tag 前一致 → 迁移是干净的所有权搬迁,成功。
2. **架构**:intent 现在是显式 plan-layer 产物(`newEngine/intent` 类型 · `arranger/deriveMusicIntentPlan` 派生 · `knowledge/styleIntentProfiles`+`textureFamilyMap` 规则),render 只 realize。§11 分层达成。
3. **决策**:C 表 4 个 deferred enforce 各是一个专门子任务(会改 musical story,需你听感定优先级)。建议顺序:4E(器配 resolver,最结构化)→ 5E(LOFI bridge)→ 6E(lead,最高风险)→ 3C。
