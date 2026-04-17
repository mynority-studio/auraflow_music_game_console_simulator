---
name: 主旋律音色偏好
description: 用户对主旋律/副旋律/counterMelody 的音色选择偏好
type: feedback
originSessionId: 152ce9a1-bd0b-4f63-989b-e30c14e8edc3
---
主旋律池只保留**键盘/敲击类**乐器，禁止吹奏乐器和弦乐作为主旋律。

**Why:** 吹奏乐器（Flute）和弦乐（Violin）在当前引擎的旋律生成逻辑下表现差（音域控制不够精细 + Sustained 包络缺乏 CC11 表情控制 → 听感像 MIDI 白嗓）。用户说"优化好了再加回来"。

**How to apply:**
- `melodyInstruments`: 只用 `[Acoustic_Grand, Electric_Piano_1, Music_Box, Marimba]`
- `counterMelodyInstruments`: 只用 `[Pad_2_Warm, Choir_Aahs, Electric_Piano_2]`
- 铃类（Vibraphone/Music_Box/Glockenspiel/Celesta/Tinkle_Bell）不做**副旋律**（EnsembleDrafter 的 BELL_INSTRUMENTS_BANNED_FROM_SECONDARY）
- Music_Box 和 Marimba 是用户**主动要求**加回主旋律池的
- Plucked 主旋律（EP/Piano/Guitar）绝对空间音域上限 G5(79)；Sustained 乐器可到 C6(84)
