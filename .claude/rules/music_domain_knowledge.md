# 音乐领域知识 & 算法编曲（自动加载）

> 修改 `/src/core/generation/` 下的代码、讨论音乐创作/编曲/生成算法时自动生效。

## 和声与和弦进行

- 精通和声学、对位法，覆盖 1950-2026 年国内外所有曲风（古典、爵士、摇滚、Pop、R&B、Soul、Funk、民谣、影视/游戏配乐、Trap、Lo-fi Beat、Jazzy Beat、Chillwave、Synthwave、House、Techno、EDM、电子圆舞曲、Vaporwave 等）
- 功能和声（T-S-D）为骨架，概率变异增加色彩（调式互换、副属和弦、三全音替代）
- 熟悉国内外海量歌手、乐队、经典作品，可快速模仿与解构风格

## 旋律与动机生成

- 级进为主（2度/3度）、跳进（4度+）需解决、乐句结尾落在和弦音（1/3/5）
- 解决同质化：变奏、填充、休止、力度变化、情绪递进、随机与可控平衡机制
- 从零构建完整段落结构（Intro-Verse-Chorus-Bridge-Outro）

## 节奏与律动设计

- GrooveDNA 控制强拍/弱拍/切分分布，density 控制音符密度，syncopation 控制反拍概率
- 熟练 DJ 技巧、采样思路、Beat 制作、律动设计

## 编配与织体

- 层次：Foreground（旋律）> Midground（和弦/副旋律）> Background（Pad/Bass/Drums）
- 动态起伏：energyLevel 1-10 驱动力度/密度/音域/织体复杂度
- 用算法、规则池、概率逻辑、结构模板进行自动编曲，输出工程师友好的音乐逻辑（规则清单、状态机、参数范围、和弦池、节奏模板）

## 乐器演奏逻辑

- 通晓钢琴、吉他、贝斯、鼓、弦乐、管乐、合成器等所有主流乐器的音域、演奏逻辑与编写规则
- Piano：正拍重、反拍轻；Jazz 强调反拍；扫弦有方向（下拨低→高，上拨高→低）
- Bass：根音为主，五音/三音辅助；Walking Bass 逐拍级进；Slap 使用八度 Pop
- Drums：Kick 强拍/反拍，Snare 2/4 拍，Hi-hat 持续，Ghost Note 16 分弱拍
- Strings：长弓持续音，Tremolo 颤音，Pizzicato 拨弦短音

## 混音约束（MIDI CC 驱动，无 DSP）

- 增益级联：Vocal(118) > Melody(118) > Drums(108) > Bass(98) > Chord(85) > CounterMelody(60)（CC7 Volume）
- 频段隔离：Bass E1-B2（MIDI 28-47），PianoRH/CounterMelody >= C3（MIDI 48+）
- 伪侧链：Kick 触发时向 Bass/Chord/CounterMelody 注入 CC11 自动化（40→65→100→127，150ms 恢复）
- 动态声场：energyLevel 映射到 CC10(Pan) spread 和 CC91(Reverb) 深度

## 回答原则

- 专业、精准、可落地，优先给出可实现、可编码的音乐规则
- 按需输出：和弦谱、节奏型、编曲思路、生成规则、参数建议、风格模板
