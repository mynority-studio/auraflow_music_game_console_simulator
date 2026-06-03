# 音乐生成引擎架构 — 审计修正终版

日期: 2026-06-03
配套文档: `music_generation_engine_architecture.md`(CODEX 初稿)
用途: 执行端审计 + 项目所有者裁决,交回 CODEX 重新设计。
读法: 第 0 节是**已锁定、不再讨论**的硬约束;第 1–8 节是每条战线的"裁决 → 架构改动 → 残留待解";第 9 节是给 CODEX 的改动清单;第 10 节是 CODEX 必须自己回答的开放问题。

---

## 0. 已锁定的决策(架构必须按此收敛)

1. **抛弃 faithful。** 不复刻 Impro-Visor 旋律管道;只借 grammar 做**变体/发展**。删除任何 faithful/improved 模式二元性。
2. **Auditor 只判和声/音程,只读。** 密度不审计——密度是 Arranger 下发的约束,下游生成期照做。
3. **节奏脊柱归 Arranger。** tempo / 拍号 / feel(直·swing) / 乐句呼吸,由 Arranger 按风格要素决定,查 KB 取参考。
4. **render order 锁死 accompaniment-first。** 先伴奏后旋律,全曲单一路径,删 melody-first 分支和开关。
5. **凝聚力 = 重复 + TSD。** 记忆点来自"重复的选择"(同动机跨和弦复现 + 同功能段落排比);"归家感"来自 Arranger 的 TSD 功能进行。
6. **宏观先于和声。** 先定全曲走向(高潮/平淡)→ 再放和声级数 → 级数匹配段落(高潮一般在 Chorus);"高潮/平淡怎么实现"查 KB,并据此丰富 KB。
7. **Arranger 只说关系,不点具体。** Arranger 下发"这里排比/这里同句式/重复几次/排比强度",但**具体选哪个 grammar、用 grammar 还是 guidetone,是 Render 的事**。

---

## 战线 1 · Faithful + 末端 Auditor

**裁决:** faithful 抛弃;grammar = 变体工具;Auditor 只判和声/音程,密度不审计。

**架构改动:**
- 删原则 8(faithful/improved 显式分模式)及一切模式二元性。只有一条管线。
- §8.6 Auditor 收窄为**纯和声/音程校验,只读**;删除"段落密度是否符合曲线"项。密度合规上移到 Instrumental/Render 的**生成期构造**,不在末端回查。
- 由此清掉 Resolver/Auditor 的重叠:
  - **Interaction Resolver** = 生成期、可改、处理 track 间音区/节奏让步。
  - **Auditor** = 末端、只读、只判和声/音程对错。

**残留待 CODEX 解:** Auditor 判出和声违规时是**只报告**还是**就地改**?按"render 只解决 render 的问题",建议 render 按构造产出和声正确的音,Auditor 是极少触发的只读终检。请明确,别让它又变回会 mutate 的修补器。

---

## 战线 2 · 节奏/时间脊柱

**裁决:** tempo / 拍号 / 节奏 / 乐句呼吸全部归 Arranger,按风格要素决定,查 KB 取参考。

**架构改动:**
- 不新增 Time 层,但 **ArrangementPlan(§5.2)输出契约必须补全**:`tempo`、`meter`(拍号)、`feel`(直/swing)、`phraseBreathing`。当前 §5.2 缺这四个。
- KB 新增"风格 → 时值/feel/呼吸参考"查询项。

**残留待 CODEX 解:** **和声节奏(每小节几个和弦)归谁?** 它既是"节奏"(Arranger)又是"和声"(Harmony)。建议:Arranger 给目标(如"chorus 和声节奏加密"作为高潮手段),Harmony 落实实际和弦数。请明确归属。

---

## 战线 3 · render order

**裁决:** 锁死 accompaniment-first(先伴奏后旋律)。

**架构改动:**
- §8.2 双镜像分支塌成单链:伴奏(drums/bass/comp/voicing)→ 分析占用(节奏空隙/音区/重音)→ 旋律按空隙生成。**删 melody-first 分支和 Arranger 的 renderOrderPolicy 开关**。
- 天然适配 GuideTone(导音 = 已渲染和弦的 3/7 音)。

**残留待 CODEX 解:** accompaniment-first 对 chorus 的"主旋律 hook"会偏弱(伴奏先占音区/节奏,旋律只能填空)。建议给 Instrumental Planner 一条**"为即将到来的旋律预留空间"**的规则(尤其 chorus),做成 accompaniment-first 但 **melody-aware**,而不是伴奏占满。

---

## 战线 5 · 结构意图 vs 实现产物切错层

**裁决:** 先定全曲走向(高潮/平淡)→ 再放和声级数 → 级数匹配段落;高潮一般在 Chorus;"高潮/平淡怎么实现"查 KB,这会丰富 KB。

**架构改动:**
- **modulation / 高潮强度的意图上移到 Arranger**(能量曲线 + climaxMap),实现留在 Harmony。修掉原图"modulationMap 挂 Harmony 却无人下发意图"的断点。
- **新增层间契约:** Arranger 发 per-section 能量/高潮目标 → Harmony 消费它来选/加强进行(加密和声节奏、加副属、必要时转调),手段从 **KB 新增的"强度配方库(climax/calm recipes)"** 查。
- **KB 显式扩容:** "如何用和声/织体实现高潮 vs 平淡"的配方库,要列成具体条目,不能是空概念。

**残留待 CODEX 解:** 原图 Band Engine 全局定死 `primaryScale`,对 jazz(逐和弦 tonicize,音阶是 per-chord 属性)是风格错配。标注:调式音乐用全局 primaryScale,调性 jazz 走 Harmony 的 chordScaleMap,别让全局音阶变成死字段或过度约束。

---

## 战线 6 · KB "只定义不决策"

**裁决:** 交给 CODEX 思考(见第 10 节)。

---

## 战线 7(新) · Arranger 正在变成上帝层

几条裁决叠加后,Arranger 要管:曲式 + 段落长度 + 能量 + 密度 + 高潮 + tempo + 拍号 + feel + 乐句呼吸 + 排比/重复计划 + 避让优先级 + 驱动和声级数选择。这是一个会失控的单体。

**架构改动:** Arranger 仍是一层,但**内部拆子模块**:
- `FormPlanner` — 曲式 / 段落 / 段落功能 / MotifID 绑定与排比
- `TimePlanner` — tempo / meter / feel / 乐句呼吸
- `DynamicsPlanner` — 能量 / 密度 / 高潮 → 下发给 Harmony 的强度目标

---

## 战线 4 · 凝聚力机制(完整规格)

**裁决合并:** 记忆点 = 重复的选择,不是逐音复印——是"押韵"。同动机在不同和弦上复现(模进)+ 同功能段落(verse1/verse2)排比。TSD 给和声归家,**重复给旋律记忆点**。

### 4.1 机制:MotifID 注册表(存抽象 cell,不存成品音符)
- Arranger 给乐句槽位派 **MotifID**;同功能段落共享同一批 MotifID 并标"排比"。
- Render 在某 MotifID **首次出现**时选具体 grammar/源、生成抽象 cell(节奏+轮廓+音级意图)、**把 cell memo 在自己这儿**;**后续出现**时按 MotifID 从缓存复述。

### 4.2 Ownership(谁说关系,谁说哪一个)

| | Arranger 下发(抽象·只说关系/意图) | Render 解析(具体·只它能碰) |
|---|---|---|
| 派 MotifID / 标"这几个槽位排比" | ✅ | — |
| 排比强度(松呼应 ↔ 强排比)、重复几次 | ✅ | — |
| 槽位角色(hook 句 / 连接句) | ✅(它知道 climax、段落功能) | — |
| 具体选哪个 .grammar / 用 grammar 还是 guidetone | ❌ | ✅ |
| 生成 cell、把 cell memo 住 | ❌ | ✅ |
| 复述时 literal↔adaptive 选哪档技法 | ❌(只下"排比强度") | ✅ |

**关键:memo 存在 Render,不在 Arranger。** "保证 verse1≈verse2 是同一动机"由 Render 用 MotifID 当 key 查自己的缓存实现,不是 Arranger 塞成品给它。Arranger 全程不碰具体音符/具体 grammar,符合原图"Arranger 不写具体"。

### 4.3 两个粒度,别混
- **句内**:同一动机在一串和弦上滚动复现(模进)。归 Render 的乐句逻辑。
- **段间**:verse1≈verse2 共享乐句计划(排比)。归 Arranger(FormPlanner)。

### 4.4 restatement 强度 = hook 强弱的唯一真旋钮
- 复述的**不变量**必须锁死:节奏 cell + 轮廓方向;**变量**只有音高映射,在 literal↔adaptive 之间动。
- **松呼应(adaptive,把音重映射进新和弦)和强排比(literal,音程不变)两端都合法、一首歌里共存。** 它是 Arranger 逐 MotifID 关系下发的**标量**,不是全局模式;Render 按标量挑技法。
- 太 adaptive 杀 hook,太 literal 撞和声——所以这个标量必须显式存在,不能交给 grammar 随机。

### 4.5 源选择规则(角色驱动,不是随机)
- **Arranger 标角色**(hook / 连接),**Render 把角色映射成源**:hook 句 → grammar cell(可复述、可模进);连接句 → guidetone(贴和弦、顺滑)。
- 理由:GuideTone 旋律天生逐和弦走,锁不住固定轮廓 = **最差的 hook 源**;grammar 的抽象 cell 才是好 hook 源。
- 由此原 §8.3 的"GuideTone / Grammar 两条互斥并列路"改成**"生成 → 发展"串联管线**:
  ```
  和弦 → [角色=hook: grammar 生成 cell / 角色=连接: guidetone 生成] → [grammar transform/divide 变体发展] → 旋律
  ```

### 4.6 与 Auditor 的连带(迷你战线 1)
- **强排比/literal 复述造成的撞音是要的张力,Auditor 绝不能修掉。** Render 复述出的音要带 `intentional` 标记,Auditor 见标记跳过,否则它会把 hook 当违规抹平。

---

## 9. 给 CODEX 的改动清单

1. 删 faithful、删原则 8、删 renderOrderPolicy 开关、删 §8.2 melody-first 分支。
2. Auditor 收窄为"只读·只判和声/音程";密度合规上移到生成期构造。
3. ArrangementPlan 补全 `tempo` / `meter` / `feel` / `phraseBreathing`,并显式发 per-section 能量/高潮目标给 Harmony。
4. 旋律渲染改成"生成(角色→grammar/guidetone)→ grammar 变体发展"串联;grammar 重定位为变体工具。
5. 新增 **MotifID 注册表**:Arranger 发 binding plan(slot→MotifID + 排比强度 + 角色),Render 选 grammar/源 + 生成 cell + memo + 按强度复述。memo 在 Render。
6. restatement 强度做成 per-MotifID 标量(松呼应↔强排比共存);Render 复述音带 `intentional` 标记供 Auditor 跳过。
7. KB 新增"高潮/平淡强度配方库";明确 Arranger→Harmony 的"能量目标→和声强度旋钮"契约。
8. Arranger 内部拆 `FormPlanner` / `TimePlanner` / `DynamicsPlanner`,避免上帝层。
9. 标注:全局 primaryScale 仅用于调式;调性 jazz 走逐和弦 chordScaleMap。

---

## 10. CODEX 必须自己回答的开放问题

1. **(架构级)数据驱动 vs 算法驱动的比例。** 这首音乐有多少由 KB 查表、多少由引擎算?StyleDictionary / GuideTonePolicy / GrooveLibrary 这类"看着像数据、其实预决定下游一大半选择"的条目,算"定义"还是"决策"?原则 1("只定义不决策")的措辞要么收紧,要么承认 KB 是带查询接口的决策表。别用漂亮原则盖住这个比例问题。
2. **和声节奏归属**(战线 2 残留):Arranger 给目标 vs Harmony 落实,在哪切。
3. **Auditor 触发后**(战线 1 残留):只报告 vs 就地改。
4. **accompaniment-first 的旋律空间预留**(战线 3 残留):Instrumental 怎么为 chorus hook 留位。
