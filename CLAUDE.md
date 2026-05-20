# Auraflow Music Game — Engine Working Guide

## 强制阅读(改 `src/core/generation/` 之前必读)

**`.claude/rules/engine_architecture_rule.md`** —— 引擎修改宪法。

涵盖:架构数据流、单一真理之源(每件事去哪个模块改)、命名约定、三大不变式
(Pitch Space / PRNG 序列 / 数据契约)、改动前决策树、改动后验证清单、抽取/
重命名 SOP、反模式禁区、Reconciler v1→v2 升级条件、模块依赖规则。

**触发条件(任一命中即读)**:

- 改 `src/core/generation/` 下任何文件
- 新增 / 重命名 / 删除引擎模块
- 调整任何模块的 PRNG 消耗
- 改 IR 类型(`ir/` 下任何 interface)
- 改风格配置中映射到管线决策的字段(`config/styles/*.ts`)
- 改 Conductor / Orchestrator / Reconciler 调用顺序

读完后再动手。偏离规则的改动,golden seed 大概率挂。

## 验证 SOP

每次 commit 前:

```bash
npm run lint           # tsc --noEmit 必过
npm run golden-seed    # 输出 7 个 seed 的 sha256
```

**算法不变的重构** → sha 必须 bit-exact 一致(参照上次 commit message 里的 sha 值)
**算法变更的 PR** → sha 必然变化,commit message 必须列新旧 sha 对照

详见 `engine_architecture_rule.md` §6。

## 历史里程碑 tag

- `v1.37.0-refactor-foundations` — IR / VoicingProcessor / CastingEngine / Realizer 四件套
- `v1.38.0-reconciler-online` — Reconciler 上线 + Conductor 重命名

## 其他规则文件

- `.claude/rules/engine_architecture_rule.md` — 上述引擎宪法(必读)
- (未来:其他领域规则放 `.claude/rules/` 下,本文件登记入口)
