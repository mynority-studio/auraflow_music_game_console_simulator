---
name: Engine vs Style Layer Separation
description: 音乐引擎分"能力层/调性层",听感不足优先怀疑 style 配置而非引擎算法
type: feedback
originSessionId: 3b022334-b51c-45dd-b4ab-bc0617c64a71
---
核心原则:**引擎是能力层,style 是调性层**,听感问题必须先定位到层次。

**Why:** 2026-04-15 PR#10 听完后用户明确表态:"目前的问题可能是在 style 的配置上没有做好,但这个不重要,核心是我们的音乐生成引擎计算不出错就行"。他不希望把"某个风格听起来不够好"解读为"引擎有 bug",而是作为"需要慢慢优化 style 配置"的正常工程任务。

**How to apply:**
- 听感反馈来时,先问"这是算法不出错但无聊,还是算法出错?"
  - 算法出错(如 m9 碰撞、pitch 逃逸、节奏崩坏)→ 改引擎,P0
  - 算法正确但无聊(如 velocity 平、音区窄、织体单一)→ 改 style 配置或增强引擎**能力**,而不是引擎**逻辑**
- 引擎能力增强时避免硬编码数值,应预留 `StyleConfig` 字段驱动
- 目前已知硬编码点需要未来 style 化:
  - `Orchestrator.applySectionVelocityCurve`:Verse 0.88 / Chorus 1.08 / Bridge 0.92 等乘数
  - `Orchestrator.applyChorusOctaveBoost`:硬编码 +12 半音和 maxPitch (84/79)
  - `TextureMapper.generateBassLine`:Root-Fifth hash 阈值 < 2(40% 概率)
- 当前只有 Default 风格真正注册(StyleRegistry.ts),PowerBallad/RussianFolkBallad/DarkSynthPop 仅在 enum 存在 — 风格扩展是未来的 tuning 工作
- 扩展 style 时做重构的好时机:把 PR#10 的三个硬编码乘数重构为 `StyleConfig.orchestration.contrastCurve`
