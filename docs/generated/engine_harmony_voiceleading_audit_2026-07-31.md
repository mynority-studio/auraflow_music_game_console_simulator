# 当前引擎和声、局部旋律与声部连接审计

审计日期：2026-07-31。范围是当前工作区的生成代码；本报告只读取生成结果，不改写音符、和声、MIDI 或音色配置。

## 运行范围

- 五种宏风格：POP、JAZZ、LOFI、RNB、ACG。
- 每种 100 个 seed（0..99），`targetDuration=90`，共 500 首。
- 真实路径：`traceGeneration` -> 最终 `renderSongFull` -> `auditHarmony` + `auditMusicality`。
- LOFI 另跑 200 seed 的 grammar/局部和声专项审计，以及 500 seed 的 Foundation 声部连接审计。

## 全风格最终 IR 结果

| 风格 | seed | 失败 | 带 warning 的曲目 | finding | 规则分布 |
|---|---:|---:|---:|---:|---|
| POP | 100 | 0 | 20 | 46 | chromatic 38；vertical clash 4；comp anchor late 4 |
| JAZZ | 100 | 0 | 41 | 51 | note-context avoid 34；vertical clash 17 |
| LOFI | 100 | 0 | 38 | 140 | vertical clash 74；chromatic 64；note-context avoid 2 |
| RNB | 100 | 0 | 26 | 54 | vertical clash 30；note-context avoid 24 |
| ACG | 100 | 0 | 67 | 178 | note-context avoid 82；vertical clash 49；chromatic 47 |
| 合计 | 500 | 0 | 192 | 469 | vertical clash 174；chromatic 149；note-context avoid 142；comp anchor late 4 |

所有 finding 当前都是 `warning`，没有 `error` 或 `fatal`；控制环平均尝试次数为 1。因此这不是“无问题通过”，而是“带 warning 交付”：当前控制环只会对 error/fatal 重跑。

## 现有审计到底检查了什么

`readOnlyHarmonyAuditor` 在最终 IR 上检查：

1. avoid note 在当前和弦内持续至少一拍：error。
2. Lead 的结构落点是否属于 `stable/color tone ∩ local chord-scale`：error。
3. 任意非鼓轨是否在当前 chord-scale 外持续至少两拍：warning。
4. Lead 的持续音是否被统一语境评判器认作高紧迫度 avoid：warning。
5. Lead 和 Comp 是否同响实际小二度或小九度：warning。

这覆盖“当前音对不对”和“当前垂直叠置是否浑”，但并不在五种风格上统一验证“被标记为 avoid 的这一个音，下一事件是否真的落到它的 resolution target”。

## 可复现的 warning 样本

| 风格 | seed | 规则 | 证据 |
|---|---:|---|---|
| POP | 3 | chromatic-exposure | Comp 的 pc5 在 c16 的 chord-scale 外持续至少两拍。 |
| POP | 27 | dissonant-vertical-clash | Lead 70 与 Comp 69 同响小二度。 |
| JAZZ | 2 | note-context-avoid | Lead pc8 在 c35 被判 urgency 1.00 avoid，目标为 7/4/11/2/6/1/9。 |
| JAZZ | 4 | dissonant-vertical-clash | Lead 67 与 Comp 66 同响小二度。 |
| LOFI | 3 | dissonant-vertical-clash | Lead 71 与 Comp 58 同响小九度。 |
| LOFI | 6 | chromatic-exposure | Pad 的 pc6 在 c2 的 chord-scale 外持续至少两拍。 |
| RNB | 0 | note-context-avoid | Lead pc2 在 c15 被判 urgency 1.00 avoid。 |
| RNB | 10 | dissonant-vertical-clash | Lead 76 与 Comp 63 同响小九度。 |
| ACG | 0 | chromatic-exposure | Bass pc11 在 c18 的 chord-scale 外持续至少两拍。 |
| ACG | 0 | note-context-avoid | Lead pc2 在 c3 被判 urgency 1.00 avoid。 |

## LOFI 专项：局部和声与解决

200 seed 的专项报告为零 finding：

- 13,356 个 grammar 旋律事件：结构 terminal、fill terminal、A approach 都是 100% 合格。
- 243 个 A approach 中，129 个有相邻半音解决，114 个使用了经过已授权的本地音阶 fallback；没有未解决 approach。
- 38,379 个 Comp 音与 9,099 个 Pad 音：attack 合规 100%，跨和弦非法长暴露均为 0。
- statement -> variation -> return 的终止稳定解决为 100%。

这证明 LOFI 的 score-time grammar 与局部和声合同是健康的。最终 IR 里的 LOFI warning 需要单独追踪到渲染后时值、跨声部叠置或通用 chord-scale 评判，不能直接归因于 LOFI grammar 填错音。

完整明细：[lofi_phrase_interaction_local_harmony_audit.md](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/docs/generated/lofi_phrase_interaction_local_harmony_audit.md)。

## Voice Leading 结论

引擎已经有真正的一对一最小移动分配，不是“每个新声部就近找任意旧声部”的假平滑。钢琴/Comp 的 placement 同时考虑最近声部、顶音跳进、平行五八度、低音区小二度和 Bass 上方小九度；Pad 也使用同一对一分配。

LOFI 500 seed Foundation 审计通过：Comp 平均移动 1.33 半音、p90 1.82 半音、顶声部跳进总体 p95 为 7 半音，且所有审计样本 crossing count 为 0。完整报告：[lofi_musical_foundation_comparison.md](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/docs/generated/lofi_musical_foundation_comparison.md)。

但跨风格的最终审计尚未把以下内容做成统一 hard gate：

1. 每个高紧迫 avoid/tension 的下一可听事件是否落在 `resolutionTargets`，并在规定拍数内解决。
2. 每个和弦转换时 Comp/Pad/Bass 的一对一移动、共同音保留、crossing、顶声部跳进是否满足量化阈值。
3. 句末/终止式 lead 是否落在当前功能允许的 cadence target，而不是仅“不属于 avoid”。

LOFI 已覆盖第 1 项的 score-time grammar，Jazz 5/4 有独立 Gate L；POP、RNB、普通 Jazz 与 ACG 仍缺同一份 final-IR resolution/voice-leading ledger。

## 本轮验证

- 审计器与规则回归：23 项通过。
- LOFI grammar/local-harmony 200 seed 导出：通过。
- LOFI Foundation/voice-leading 500 seed 导出：通过。
- Comp/非键盘 voicing/foundation voice-leading 回归：6 项通过。

## 结论

局部和声 hard gate 没有失效，但当前五风格的成品并不处于“无不协和 warning”的状态。优先处理顺序应是：先建立全风格共享的 resolution ledger，把 142 个 `note-context-avoid` 变成可验证的解决或 error；再处理 174 个 lead/comp 小二度、小九度同响；最后复核 149 个跨和弦 chromatic exposure 是否属于明示延留，还是时值跨界。
