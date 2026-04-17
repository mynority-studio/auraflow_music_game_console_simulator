---
name: Core Engine Purity Principle
description: 核心引擎必须是纯音乐计算，零风格偏好零乐器技巧，先调试好核心再加风格层
type: feedback
---

核心引擎（MelodyEngine, Orchestrator, TextureMapper/Arrangement）必须只做纯音乐计算，不含任何风格偏好或乐器演奏技巧。

**Why:** 用户经历了多轮因风格/idiom系统与核心引擎耦合导致的级联崩溃。风格化逻辑混入核心引擎后难以调试，且任何核心变更都会引发不可预测的风格侧效果。

**How to apply:** 
- 先确保核心引擎（和声、旋律、编配）在无风格/无idiom的纯计算模式下输出正确
- Style/Idiom 层作为独立的后处理层叠加，不影响核心正确性
- 调试核心时完全删除所有 style 和 idiom 代码
