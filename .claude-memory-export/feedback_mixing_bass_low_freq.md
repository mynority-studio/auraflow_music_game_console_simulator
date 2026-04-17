---
name: 贝斯混音低频补偿
description: AudioMixer 主总线曾过度铲低频导致贝斯"高频明显低频不行"，已修复
type: feedback
originSessionId: 152ce9a1-bd0b-4f63-989b-e30c14e8edc3
---
贝斯听感问题根因是 AudioMixer 主总线的 peaking EQ 250Hz -4dB 铲掉了贝斯肉感。

**已修复（V3.5）**：
- lowShelf 200Hz: 0 → +2 dB（补 sub bass 厚度）
- peaking EQ: 250Hz → 350Hz（避开贝斯本体）, -4 → -2.5 dB
- bass 通道: reverb 0 → 0.20 + chorus 60（声场感）, volume 0 → -1

**How to apply:** 混音调整时注意保持贝斯低频不被主总线 EQ 误伤。贝斯 pan=0（mono bass 经典做法），用 reverb + chorus 做 stereo width 而不是 pan 偏移。
