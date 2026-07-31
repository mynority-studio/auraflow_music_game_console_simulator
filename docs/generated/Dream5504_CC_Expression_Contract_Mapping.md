# Dream 5504 CC 表情合同：首轮地址匹配

生成日期：2026-07-28

## 范围

- 完整官方目录：407 个可试听地址（269 个现代 GM 旋律地址、10 套 Channel 10 鼓组、128 个 CC0=127 MT-32 兼容地址）。
- 本文件只完成**音色地址 -> 六类 CC 表情合同**的分类，不改动现有风格白名单、生成器的 CC 授权或实际 MIDI 下发。
- 目录身份仍由完整 `CC0 + Program` 决定；同一 PC 的不同 Bank 不共享分类结论。CC0=127 仍严格仅试听。

## 六类合同

| CC 表情合同 | 物理演奏覆盖范围 | 完整目录地址数 | 未来可供器配数 | 总谱/人工事件数 | 仅试听地址数 | 本轮状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 钢琴延音 | 原声钢琴；未来由 PedalPlan 决定 CC64 与 CC11。 | 6 | 3 | 0 | 3 | 已完成地址匹配；未改变当前 CC 下发。 |
| 连续声学 | 吹管、弓弦、口琴、风笛；不继承钢琴 CC64。 | 90 | 50 | 1 | 39 | 已完成地址匹配；未改变当前 CC 下发。 |
| 键控持续 | 风琴、手风琴/班多钮、风琴 Bass；本轮不自动下发 CC。 | 31 | 23 | 0 | 8 | 已完成地址匹配；未改变当前 CC 下发。 |
| 电声键盘 | 电钢、Clav、合成键盘/Pad/Bass、人声采样；本轮不自动下发 CC。 | 100 | 64 | 9 | 27 | 已完成地址匹配；未改变当前 CC 下发。 |
| 弹拨/击打 | 吉他与泛音、Bass、键控拨弦、击槌/拨弦打击；由音符、速度、时值塑形。 | 121 | 62 | 12 | 47 | 已完成地址匹配；未改变当前 CC 下发。 |
| 鼓组 | Channel 10 鼓组；由鼓音符映射、时值与力度塑形，不走通道表情 CC。 | 10 | 10 | 0 | 0 | 已完成地址匹配；未改变当前 CC 下发。 |
| 无合同（效果/事件） | 效果音、预制 fall、feedback 等不进入五轨自动器配，也不自动发 CC。 | 49 | 0 | 45 | 4 | 保持人工总谱/试听边界。 |

## 审计规则

1. `piano-damper`：只表达“原声钢琴可使用踏板计划”的物理事实；具体是否发 CC64/CC11，继续由地址级 `dreamCcCapabilities` 与 Arranger 的 PedalPlan 共同授权。
2. `continuous-acoustic`：萨克斯、铜管、木管、弓弦、口琴、风笛与真实弦乐变体统一进入连续声学合同；它们不继承钢琴 CC64。
3. `keyed-sustain`、`electronic-keybed`、`plucked-struck`、`drum` 本轮只是安全的表情边界，不新增任何推测性的 CC 参数。
4. 吉他泛音保留 `guitar-harmonics` 子族，归入 `plucked-struck`；Guitar Feedback 等效果音没有合同，只能人工总谱事件。
5. 例如 CC0=3 / PC89 Rotary String 已按其真实弓弦身份归入 `continuous-acoustic`，不会因为 PC89 的 GM 默认槽位而被误作合成 Pad。

## 关联文件

- 完整逐地址审计表：`docs/generated/Dream5504_GMBK5X128_Performance_Classification.xlsx` 的“CC 表情合同”和“完整音色分类”工作表。
- 注册表：`src/core/generation/newEngine/instrumental/dreamVoiceProfiles.ts`。
- 当前实际 CC 授权：`src/core/generation/newEngine/instrumental/dreamCcCapabilities.ts`。
