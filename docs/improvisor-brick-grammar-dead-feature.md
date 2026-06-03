# Impro-Visor 的 brick 功能门控为何静默失效(根因复盘 + 修复指南)

> TL;DR — Impro-Visor 的「按和声功能块(brick)挑 lick」这个功能,在 grammar-solo
> 生成路径里**结构性失效、从不触发**。这**不是我们移植的疏漏**,而是原作 2015-08-14
> 一次善意的死循环修复(commit `91b6607f`)把 brick 规则从 4 字段顶成了 5 字段,
> 而 grammar 引擎的 `findRule` 有一道 `length()==4` 硬守卫,从此把这些规则全部静默跳过。
> 次日 `3bcdb184` 用改坏的学习器重生成了全部 grammar,坑就此铺满并发布至今。
>
> 本文用于:将来做「激活 brick 功能化选 lick」实验时直接有据可查。

调查日期 2026-06-02。IMP 源:`~/vibe_coding/Impro-Visor`(GitHub `Impro-Visor/Impro-Visor`)。
我们的移植:`src/core/generation/improCore/engine/grammar.ts`。

---

## 1. 这个功能本来要做什么

grammar 从起点 `P`(一整首)向下拆块。`P` 有两条**权重完全相同**(1,10,100,1000…)的平行岔路:

- **岔路 A —「学来的真人乐句」**:`P → START → Cluster → Q → slope/X`。从真实 solo 学出的乐句碎片。
- **岔路 B —「功能砖块 lick」**:`P → BRICK → 某条贴合当前功能块的 lick`(如 `Rainy-Cadence`、`Sad-Cadence`)。

岔路 B 的本意:用 `(builtin brick X)` 当权重,**当前功能块匹配就给高权重、不匹配给低权重**,
从而"在终止式处弹终止 lick、在过渡处弹过渡 lick" —— 这就是 brick 功能化选 lick。

求值器 `evaluateBuiltin('brick')`(IMP `Grammar.java:1142`)实现完整:
`ensureRoadmap()` → `getBlockAtSlot(chordSlot)` → 匹配返 `ONE`、不匹配返 `0.1`、无块返 `ZERO`。

## 2. 症状:岔路 B 从不触发

实测(2026-06-02,我们的移植):
- 全部 grammar:32916 条 4 字段规则,**12052 条 5 字段规则**(=那 12052 处 `(builtin brick X)`);
  **4 字段规则里引用 brick 的 = 0 条**。
- 给 MilesDavis/BillEvans/ChetBaker 各跑 `g.run(1920, ctx)`(即便供了 roadmap),
  `evaluateBuiltin('brick')` 命中 **0 次**。
- 旋律全部来自岔路 A 的 `Cluster/Q/slope`,再由 `rectify` 贴到当前和弦音阶。

## 3. 根因:两条 commit

### `91b6607f`(2015-08-14,作者 keller=Robert Keller)
提交说明:*"discovered a latent problem with generation... generation would loop forever,
because a non-terminal was repeatedly not expanded. That problem is now fixed."*

这个"展不开的 non-terminal"就是 `(BRICK n)` 块:当它的所有候选 lick 权重都为 0
(无 roadmap / 无匹配块)时没规则能展开,token 卡在栈上 → 无限循环。

keller 在**同一个 commit**做了两件事:
1. ✅ 改循环终止逻辑(`quotaReached` 布尔 → `numSlotsToFill` 槽位计数)——死循环修对了。
2. ❌ 给 brick 规则**加了独立的第 5 字段 `1.0`**(`CreateBrickGrammar.java`):

   ```diff
   -                            + "))\n");                                 // 原:4 字段
   +                            + ") 1.0)\n");        // artificial probability   // 改后:5 字段
   ```

   他的意图(看注释 `// evaluates to 1 if brick type is this brick's type; 0 otherwise`
   + `// artificial probability`)是给 brick 一个**保底概率**,避免"权重全 0 → 展不开 → 死循环"。
   但他按 `(rule 左 右 条件 概率)` 的**五段式**心智写,而引擎只支持 `(rule 左 右 权重)` 的**四段式**。

### `3bcdb184`(2015-08-15,次日)
提交说明:*"Updating grammars learned with newest version."* —— 用刚改坏的学习器
**重新生成了全部 grammar 文件**,所有 brick 规则一夜变成 5 字段。这就是发布至今、
也是我们移植进来的版本。此后再没动过(grammar 最后更新停在 2015-08-15,repo 2019 年后休眠)。

## 4. 致命的格式错位

引擎 `findRule` 只认 4 字段规则,权重取第 4 段;5 字段一律静默跳过:

```java
// Grammar.java:618
else if( type.equals(RULE) && next.length() == 4 )   // ← 这道守卫从初始 commit 就在(SVN 时代)
...
// Grammar.java:712
addToList(lhs, rhs, next.fourth(), ruleList);          // ← 权重 = 第 4 段
```

| 时期 | 学习器吐出的 brick 规则 | findRule 是否读 | 结果 |
|---|---|---|---|
| `91b6607f` 之前 | `(rule (BRICK n) (rhs) (builtin brick X))` = **4 段** | ✅ 读,权重=brick 求值 | **功能在跑** |
| `91b6607f` 之后(至今) | `(rule (BRICK n) (rhs) (builtin brick X) 1.0)` = **5 段** | ❌ 跳过 | **静默死掉** |

本想"让 brick 永远可选",实际"让 brick 永远被跳过"。
功能从「能用但偶尔死循环」→「静默地完全不工作」。

> 真正该写的四段式修法应是把权重写成不为 0 的表达式,如 `(+ (builtin brick X) 0.1)`,
> 而不是另起一个 `1.0` 字段。(其实 brick 求值器对"不匹配"已返 0.1 ≠ 0,有 roadmap 时本就不会全 0。)

## 5. 为什么 11 年没人发现

教科书级「静默契约错位」,五重保护全失效:
1. **不报错**:5 字段规则被守卫静默跳过,不抛异常、不打日志。
2. **照样出音**:岔路 A 还活着,旋律照常生成。
3. **听感无破绽**:风格味道主要靠学来的真人乐句 + rectify,brick 缺席听不出。
4. **没测试**:无"grammar 展开候选集"单测,无"brick 该选 vs 实选"对照。
5. **没 issue**:GitHub issues(2026-06-02 查)全是 UI/构建/维护类,无人报——用户没有可观察症状。

根因一句话:改 grammar **生成器**(`CreateBrickGrammar`)的人用五段式心智,
grammar **解释器**(`Grammar.findRule`)只认四段式 —— 两半各自演化、从没对齐。

---

## 6. 如何修 Impro-Visor 工程本身(激活 brick)

要让 brick 门控复活,生成器与解释器必须就规则格式达成一致。两条路:

### 修法 1 — 改解释器(推荐:最小、无需重生成 grammar)
让 `findRule`(`Grammar.java:618` 的 `RULE` 分支)接受 5 字段规则,
把第 4 段当权重表达式(即 `(builtin brick X)` 条件),第 5 段(artificial probability)
忽略或相乘:

```java
// 原:
else if( type.equals(RULE) && next.length() == 4 )
// 改为(接受 4 或 5 段):
else if( type.equals(RULE) && (next.length() == 4 || next.length() == 5) )
...
// 权重:length==5 时仍取 next.fourth()(brick 条件);若想让 artificial prob 生效,
// 改成 evaluate(fourth) * toDouble(fifth)。shipped grammar 里 fifth 恒为 1.0,故取 fourth 即可。
```

- 优点:**零 grammar 重生成**,直接激活已发布的 12052 条规则。
- 必须配套:`ensureRoadmap()` 保证生成时总有 roadmap(否则全 ZERO → BRICK 块仍产空 → 留洞)。
  循环终止修复(`numSlotsToFill` 计数)已在,无需再动。

### 修法 2 — 改生成器(回退 keller 的改动)
把 `CreateBrickGrammar.writeRule`(`CreateBrickGrammar.java:270`)的 `") 1.0)\n"` 改回 `"))\n"`,
吐回 4 字段 `(rule (BRICK n) (rhs) (builtin brick X))`,然后**重新生成全部 grammar**。

- 优点:不动引擎,规则天然过现有 `length()==4` 守卫。
- 缺点:必须重生成 + 重新分发所有 grammar 文件;放弃"artificial probability"地板
  (但 brick 求值器的不匹配=0.1 在有 roadmap 时已充当地板)。

### 两法共同的副作用(务必听感评估)
`P` 层仍是 brick 岔路 vs 学来乐句岔路 **50/50** 抛硬币。激活后约**一半**乐句会变成功能化 brick lick
(更长、更"功能感"),整体听感**会明显改变**。这是个听感实验,不是无损修复。

---

## 7. 映射到我们的移植(improCore)

我们 `grammar.ts` 忠实复刻了同样的守卫与行为:
- `grammar.ts:311` `if (type === RULE && next.length === 4)` ←→ IMP `Grammar.java:618`
- `grammar.ts:336` `this.addToList(lhs, B, next[3]!, ruleList)` ←→ IMP `next.fourth()`
- `grammar.ts:412-416` brick 求值器 ←→ IMP `evaluateBuiltin` brick(我们已把无块改成忠实的 `return 0`=ZERO)

若要在我们这边做「激活 brick」实验,等价于上面的**修法 1**:把 `grammar.ts:311` 的守卫放宽到
4 或 5 段,权重取 `next[3]`(`length==5` 时第 5 个 `1.0` 忽略),并确保 `brickNameAtSlot` 有
roadmap 来源(`songSource` 的 `extractAnalysis` → `parseRoadMap` → `lickBrick` 已具备,SmartGen 路径现成;
默认 song / 手写 leadsheet 需补 roadmap)。

⚠️ 这**偏离"忠实移植"**且大改听感,须作为**独立实验**立项,不能混进忠实化任务。

---

## 8. 复现/验证命令(本文结论怎么来的)

```bash
# IMP 侧:看那两条 commit
cd ~/vibe_coding/Impro-Visor
git show 91b6607f -- src/imp/cluster/CreateBrickGrammar.java   # 看 ")1.0)" 那一行 +/-
git show 91b6607f -- src/imp/lickgen/Grammar.java              # 看死循环修复(quotaReached→numSlotsToFill)
git log -1 --format="%ci %s" -- grammars/MilesDavis.grammar    # → 2015-08-15 3bcdb184 重生成
git show 91b6607f~1:src/imp/lickgen/Grammar.java | grep -n "length() == 4"  # 守卫早已存在

# 我们侧:证明 brick 生成时 0 命中(插桩 evaluateBuiltin,跑 g.run)、全 grammar 0 条 4 段 brick 权重
# (一次性探针,跑完即删;思路见本仓库 git 历史中本次会话)
```

相关记忆:`brick_gating_dead_in_grammar_solo_2026_06_02.md`、`lickgen_faithful_fixes_2026_06_02.md`。
