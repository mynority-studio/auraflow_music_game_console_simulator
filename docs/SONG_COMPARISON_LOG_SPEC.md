# Song Comparison Log Spec

> 跨音乐生成系统 A/B 对比的标准化日志格式。
> 两个系统生成同一首歌后各自输出一份，字段对齐方便 diff。

---

## 目的

当听感上发现 "系统 A 比系统 B 好听/难听" 时，两份 log 的字段差异能直接暴露**哪些音乐属性不同**（密度、音区、级进/跳跃比例、和声复杂度等），避免空聊。

---

## 输出格式（必须严格按此格式）

```
╔══════════════════════════════════════════════════════════╗
║ 🎵 SONG COMPARISON LOG — <ENGINE_NAME>                   ║
╚══════════════════════════════════════════════════════════╝
META: seed=<seed> key=<key_name> tempo=<bpm> timeSig=<x/y> beats=<total>
TRACKS: melody=<N> chord=<N> bass=<N> drums=<N> counter=<N> secondary=<N> vocal=<N>

STRUCTURE (name, bars, beats, energy)
  <section_name>    bars=<N>  beats=<N>  E=<1~10>
  ...

MELODY STATS (name, count, midi_range, density_n_per_beat, step%/leap%)
  <section_name>    count=<N>  range=<midi_min>-<midi_max>  dens=<X.XX>  step=<N>%/leap=<N>%
  ...

HARMONY (name, chord progression)
  <section_name>    <chord1> <chord2> <chord3> ...
  ...
══════════════════════════════════════════════════════════
```

---

## 字段定义

### META 行

| 字段 | 说明 | 示例 |
|---|---|---|
| `seed` | PRNG 种子（整数或 hex） | `2934395440` |
| `key` | 调式，格式 "<tonic> <mode>" | `C major` / `Db minor` |
| `tempo` | BPM 整数 | `95` |
| `timeSig` | 拍号 | `4/4` 或 `3/4` |
| `beats` | 全曲总拍数 | `224` |

### TRACKS 行

每个轨道的**音符事件总数**（不是小节数也不是持续时长）。

| 字段 | 说明 |
|---|---|
| `melody` | 主旋律音符数 |
| `chord` | 和弦/伴奏音符数（多声部和弦每个音分别计数） |
| `bass` | 贝斯音符数 |
| `drums` | 鼓音符数（打击乐事件） |
| `counter` | 对位旋律/副音轨音符数 |
| `secondary` | 副旋律音符数（如有） |
| `vocal` | 人声音符数（如有） |

若某轨道不存在或为 0，写 `0` 不要省略字段。

### STRUCTURE 段

每行一个段落，按时间顺序：

| 字段 | 说明 |
|---|---|
| `<section_name>` | 段落名，必须稳定字符串，如 `Verse_1` / `Chorus_Main` / `Bridge` |
| `bars=<N>` | 段落小节数（可以带小数） |
| `beats=<N>` | 段落拍数（= bars × beatsPerBar） |
| `E=<1~10>` | 能量等级 1-10（1=最轻 10=最重）。若你的系统有 0-1 或别的量级，请线性映射到 1-10 |

### MELODY STATS 段

按段落给**主旋律**的统计（只统计 `melody` 轨，不算 counter/secondary）：

| 字段 | 计算方法 |
|---|---|
| `count=<N>` | 该段落内 melody 音符事件数 |
| `range=<midi_min>-<midi_max>` | 该段落 melody 最低音 / 最高音的 MIDI 值（C4=60） |
| `dens=<X.XX>` | 密度 = count / beats（每拍音符数） |
| `step=<N>%` | 连续音程 ≤ 2 半音的占比（音阶级进） |
| `leap=<N>%` | 连续音程 ≥ 5 半音的占比（跳跃） |

**step/leap 计算细节**：
- 遍历段落内相邻两个 melody 音符
- 计算 `|pitch[i] - pitch[i-1]|` 的绝对值
- ≤2 半音 → step 计数 +1
- ≥5 半音 → leap 计数 +1
- 3-4 半音为"中跳"**不计入**两类（专注两端）
- 最后除以"相邻音程总数"得百分比

### HARMONY 段

每段落的和弦进行，用**罗马数字**或**绝对和弦名**（你系统用哪种就用哪种）：

```
  Verse_1         I V vi IV I V vi IV
  Chorus_1        vi IV I V vi IV I V
```

如果段落内有不同 keyOffset（转调），在每个和弦旁可选加 `@<offset>`（如 `I@3 V@3`），但不是必须。

---

## 实现建议（伪代码）

```python
def print_comparison_log(song):
    print("╔══════════════════════════════════════════════════════════╗")
    print(f"║ 🎵 SONG COMPARISON LOG — {MY_ENGINE_NAME}")
    print("╚══════════════════════════════════════════════════════════╝")
    print(f"META: seed={song.seed} key={song.key} tempo={song.tempo} "
          f"timeSig={song.time_sig} beats={song.total_beats}")
    print(f"TRACKS: melody={len(song.melody)} chord={len(song.chord)} "
          f"bass={len(song.bass)} drums={len(song.drums)} "
          f"counter={len(song.counter)} secondary=0 vocal=0")
    print()
    print("STRUCTURE (name, bars, beats, energy)")
    for s in song.sections:
        print(f"  {s.name:16} bars={s.bars:4}  beats={s.beats:5}  E={s.energy}")
    print()
    print("MELODY STATS (name, count, midi_range, density_n_per_beat, step%/leap%)")
    for s in song.sections:
        mel = [n for n in song.melody if s.start <= n.onset < s.end]
        step_pct, leap_pct = compute_interval_stats(mel)
        pitch_lo = min(n.pitch for n in mel) if mel else 0
        pitch_hi = max(n.pitch for n in mel) if mel else 0
        density = len(mel) / s.beats if s.beats > 0 else 0
        print(f"  {s.name:16} count={len(mel):3}  range={pitch_lo}-{pitch_hi}  "
              f"dens={density:.2f}  step={step_pct}%/leap={leap_pct}%")
    print()
    print("HARMONY (name, chord progression)")
    for s in song.sections:
        sec_chords = [c.numeral for c in song.chords if s.start <= c.start < s.end]
        print(f"  {s.name:16} {' '.join(sec_chords)}")
    print("══════════════════════════════════════════════════════════")

def compute_interval_stats(notes):
    step_count = leap_count = total = 0
    for i in range(1, len(notes)):
        iv = abs(notes[i].pitch - notes[i-1].pitch)
        total += 1
        if iv <= 2: step_count += 1
        elif iv >= 5: leap_count += 1
    return (
        round(100 * step_count / total) if total else 0,
        round(100 * leap_count / total) if total else 0
    )
```

---

## 输出例（AuraFlow 样本）

```
╔══════════════════════════════════════════════════════════╗
║ 🎵 SONG COMPARISON LOG — AuraFlow                        ║
╚══════════════════════════════════════════════════════════╝
META: seed=3009507646 key=B tempo=117 timeSig=4/4 beats=208
TRACKS: melody=212 chord=340 bass=0 drums=0 counter=0 secondary=0 vocal=0

STRUCTURE (name, bars, beats, energy)
  Verse_1          bars=   8  beats=   32  E=5
  PreChorus_1      bars=   4  beats=   16  E=6
  Chorus_Main      bars=   8  beats=   32  E=9
  Chorus_Epic      bars=   8  beats=   32  E=10
  Outro            bars=   2  beats=    8  E=2

MELODY STATS (name, count, midi_range, density_n_per_beat, step%/leap%)
  Verse_1          count= 38  range=55-72  dens=1.19  step=72%/leap=18%
  PreChorus_1      count= 22  range=58-76  dens=1.38  step=64%/leap=23%
  Chorus_Main      count=148  range=60-84  dens=4.63  step=55%/leap=38%
  Chorus_Epic      count=144  range=62-86  dens=4.50  step=48%/leap=45%
  Outro            count=  2  range=64-68  dens=0.25  step=100%/leap=0%

HARMONY (name, chord progression)
  Verse_1          Vsus4 Iadd9 vi7 Imaj9 Vsus4 Iadd9 vi7 Imaj7
  PreChorus_1      Imaj9 III7 Imaj9 vi7 VI7 IVmaj7 vi7 I
  Chorus_Main      Imaj9 Iadd9 Vsus4 Iadd9 Vsus4 Iadd9 Vsus4 Iadd9
  ...
══════════════════════════════════════════════════════════
```

---

## 实现位置约定

在你生成完一首歌、即将开始播放之前调用一次。**每首歌一份 log 块**，独立完整，不要跨歌拼接。

---

## 如何使用对比结果

两份 log 放一起可以一眼看出：

| 观察 | 可能原因 |
|---|---|
| A 的 `dens` 普遍比 B 高 40% | A 旋律过密，B 可能更有呼吸 |
| A `leap%` 30%，B `leap%` 5% | A 跳跃多，B 太平；哪种好听是主观判断，但原因清楚了 |
| A `range` 是 12 半音，B 是 24 半音 | B 音区跨度大 2 倍 |
| A Verse 和 Chorus 的 `dens` 接近，B Verse 明显稀疏 | B 有段落对比，A 没有 |
| A `TRACKS.drums=0`，B `drums=256` | A 没鼓，纯钢琴 |
| 和声 `IV V I` vs `I V vi IV` | 走向不同 |

这是 A/B 对比的**第一层分析**，接下来可以深挖具体音符列表。
