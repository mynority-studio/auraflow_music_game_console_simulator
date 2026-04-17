---
name: Idiom 不强绑风格
description: 用户明确要求乐器 idiom 按需求评分选择，不与 subgenre 强绑定
type: feedback
originSessionId: 152ce9a1-bd0b-4f63-989b-e30c14e8edc3
---
乐器 idiom（鼓组/副旋律/和弦）**不与风格强绑定**，而是按 energy/syncopation/swing/sectionType 等参数评分选择。

**Why:** 用户认为强绑定会让变化太少。真实乐队的做法是"看段落需要什么来决定打法"——同一首 Funk 歌，Verse 低能量可以用 SparseDrumIdiom，Chorus 高能量用 SyncopatedDrumIdiom，Bridge 突然切 AcousticSwing 做华彩。

**How to apply:**
- subgenre 只作为评分**加分项**（+10~15 分），不作为决定项
- 评分由 `IDrumIdiom.score(ctx)` / `PianoIdiomRouter.pickTexture(...)` 等实现
- 华彩借调：Bridge/PreChorus/Solo_Bridge 段末 30% 概率切到第二高分 idiom（带 crash 声明 + tom fill 过渡）
- 用户举例：前面段落都是 Pop，Bridge 突然变 Jazz swing 几小节，顺滑回 Chorus 回归主题
- 切换保护：分差 < 10-15% 时保持上一段 idiom（避免频繁切换）
