# 音乐领域知识（自动加载）

> 修改 `/src/core/generation/` 下的和声、旋律、编配、节奏、混音相关代码时参考。

## 算法编曲核心原则

- 和弦进行：功能和声（T-S-D）为骨架，概率变异增加色彩（调式互换、副属和弦、三全音替代）
- 旋律生成：级进为主（2度/3度）、跳进（4度+）需解决、乐句结尾落在和弦音（1/3/5）
- 节奏设计：GrooveDNA 控制强拍/弱拍/切分分布，density 控制音符密度，syncopation 控制反拍概率
- 编配层次：Foreground（旋律）> Midground（和弦/副旋律）> Background（Pad/Bass/Drums）
- 动态起伏：energyLevel 1-10 驱动力度/密度/音域/织体复杂度

## 混音约束（MIDI CC 驱动，无 DSP）

- 增益级联：Vocal(118) > Melody(118) > Drums(108) > Bass(98) > Chord(85) > CounterMelody(60)（CC7 Volume）
- 频段隔离：Bass E1-B2（MIDI 28-47），PianoRH/CounterMelody >= C3（MIDI 48+）
- 伪侧链：Kick 触发时向 Bass/Chord/CounterMelody 注入 CC11 自动化（40→65→100→127，150ms 恢复）
- 动态声场：energyLevel 映射到 CC10(Pan) spread 和 CC91(Reverb) 深度

## 乐器演奏逻辑

- Piano：正拍重、反拍轻；Jazz 强调反拍；扫弦有方向（下拨低→高，上拨高→低）
- Bass：根音为主，五音/三音辅助；Walking Bass 逐拍级进；Slap 使用八度 Pop
- Drums：Kick 强拍/反拍，Snare 2/4 拍，Hi-hat 持续，Ghost Note 16 分弱拍
- Strings：长弓持续音，Tremolo 颤音，Pizzicato 拨弦短音
