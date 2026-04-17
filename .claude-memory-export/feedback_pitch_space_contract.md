---
name: Pitch Space 双空间契约
description: 生成管道使用相对空间（主音=0），applyOffset 是唯一转换点。违反此契约会导致跨调不和谐 bug。
type: feedback
---

生成管道内所有 pitch 计算必须在相对空间（主音=0, C=60 为参考中心），`Orchestrator.applyOffset()` 是唯一的相对→绝对转换点。

**Why:** 2026-04-12 发现 `getSafeScalePitches` 内部加了 keyOffset（绝对空间），而 `getChordTones` 返回相对空间。两者在 `realizeMotif` 中交叉使用，加上 `applyOffset` 又加一次 keyOffset，导致弱拍音被双重偏移，旋律跨调不和谐。同时 MotifLooper 调用处用了 `targetCenter - keyOffset` 的预补偿模式，也是双重偏移隐患。

**How to apply:** 
- 新增返回 pitch 的函数时，注释标注 `// Pitch Space: RELATIVE`
- 禁止在生成函数中读取 `GlobalContext.currentKeyOffset` 做 pitch 计算
- 禁止 `targetCenter - keyOffset` 的预补偿模式
- 完整规则见 `music_generation_pipeline_rule.md` §4.7 K-1~K-7
