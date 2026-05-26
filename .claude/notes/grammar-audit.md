# Grammar Audit Report

> 生成于 2026-05-26 | 数据源 `public/grammars/*.grammar`

目标:量化 Impro-Visor 85 grammar 的内部冗余度,为后续"切片化重构"提供数据依据。

## 1. 基础统计

| 指标 | 值 |
|---|---|
| Grammar 文件数 | 82 |
| 总 size | 4538.6 KB |
| 平均 size / grammar | 55.3 KB |
| 总 rule 数(含 P/BRICK/其他) | 42837 |
| 总 base rule 数 | 7989 |
| 平均 rule / grammar | 522 |

**Rule head 分布**(前 10):

| head | rule 数 |
|---|---|
| `BRICK` | 12158 |
| `Q0` | 1654 |
| `Q4` | 1652 |
| `Q1` | 1575 |
| `Q2` | 1294 |
| `Q3` | 1107 |
| `Q6` | 1062 |
| `Q5` | 1000 |
| `P` | 802 |
| `UseMotif` | 638 |

## 2. BRICK length 分布

每条 BRICK rule 的 length(ticks)= phrase 时长。960=2 beat,1920=4 beat,2880=6 beat,3840=8 beat,...

| length(ticks) | beat | rule 数 |
|---|---|---|
| 480 | 1 | 2468 |
| 960 | 2 | 5460 |
| 1440 | 3 | 1322 |
| 1920 | 4 | 2314 |
| 2400 | 5 | 240 |
| 2880 | 6 | 202 |
| 3360 | 7 | 36 |
| 3840 | 8 | 88 |
| 4320 | 9 | 24 |
| 5760 | 12 | 2 |
| 9600 | 20 | 2 |

## 3. builtin brick name(句式语义)分布

每条 BRICK rule 可能带 `(builtin brick Name)` marker,标记适用的 cadence / phrase role。
**这是 "PICKUP / BODY / TAIL" 切片维度最直接的来源**。

总共 137 种独立 brick name,覆盖 12052 条 rule。

| brick name | 涉及 grammar 数 | 总 rule 数 | 跨 grammar? |
|---|---|---|---|
| `Straight-Cadence` | 42 | 1858 | ✓ |
| `Sad-Cadence` | 29 | 910 | ✓ |
| `POT` | 32 | 744 | ✓ |
| `Surprise-Major-Cadence` | 14 | 636 | ✓ |
| `Dominant-Cycle` | 24 | 506 | ✓ |
| `Minor-On` | 46 | 490 | ✓ |
| `Straight-Approach` | 32 | 448 | ✓ |
| `Giant-Steps` | 12 | 424 | ✓ |
| `Major-On` | 27 | 342 | ✓ |
| `Happenstance-Turnaround` | 23 | 328 | ✓ |
| `SPOT` | 23 | 298 | ✓ |
| `Dropback` | 31 | 282 | ✓ |
| `Straight-Launcher` | 22 | 278 | ✓ |
| `Nowhere-Approach` | 14 | 218 | ✓ |
| `Dominant-Cycle-Cadence` | 16 | 214 | ✓ |
| `Tension-Cadence` | 14 | 202 | ✓ |
| `Minor-POT` | 13 | 174 | ✓ |
| `On-Off-Major-VII` | 10 | 156 | ✓ |
| `Nowhere-Launcher` | 10 | 150 | ✓ |
| `IV-n-Back` | 10 | 144 | ✓ |

## 4. 完整 body 字面克隆率(剽窃量)

指标:不同 grammar 之间 rule body 是否字面完全相同 — 直接量化"冗余度"。

| 指标 | 值 |
|---|---|
| 唯一 body 字面数 | 3616 |
| BRICK rule 总数 | 12158 |
| 唯一/总数 比 | 29.7% |
| 被克隆 body 数(被 ≥ 2 grammar 共用)| 2557 |
| 涉及 rule 总数(共用 body) | 11079 |
| 字面冗余度 = 共用 rule / 总 rule | 91.1% |

**Top 10 最常被多个 grammar 共用的 body**:

| 用次 | grammar 数 | body 摘要 |
|---|---|---|
| 105 | 26 | `(slope 0 0 R1)` |
| 102 | 23 | `R1` |
| 67 | 18 | `(slope 0 0 R1+1)` |
| 64 | 16 | `R1 R1` |
| 45 | 15 | `R1 R1 R1 R1` |
| 45 | 15 | `(slope 0 0 R1+1+1+1)` |
| 11 | 11 | `R8 (X b6 8) (X 5 8) (X 4 8) (X 7 8) (X 5 8) (X b6 8/3) (X 1 ...` |
| 11 | 11 | `(slope 0 0 R8 A8) (slope -2 -1 C8 L8) (slope 5 5 C8) (slope ...` |
| 11 | 11 | `(X 2 8) (X 2 8) (X 1 8) (X 5 8) (X 7 8) (X 2 8) (X b2 8) (X ...` |
| 11 | 11 | `(slope 0 0 L8) (slope 0 0 L8) (slope -2 -2 C8) (slope 3 7 C8...` |

## 5. head / tail N-gram 重叠(PICKUP/TAIL 切片可行性)

对每条 BRICK rule body flatten 取前 N / 后 N 个 token 作"head pattern" / "tail pattern"。
问 N-gram 模式跨 grammar 重叠率 — 直接量化"用 N-gram 切片能合并多少"。

### N=3 head

- 唯一模式 / 总规则:243 / 12158 = **2.0% 唯一**
- 被 ≥ 2 grammar 共用的模式:219(占模式 90.1%)
- 共用模式覆盖的 rule 占比:**99.8%** ← 切片可合并率

**Top 5 高频共用 head pattern**:

| 用次 | grammar 数 | pattern |
|---|---|---|
| 6079 | 58 | `slope 0 0` |
| 496 | 56 | `X 1 8` |
| 434 | 53 | `X 3 8` |
| 426 | 47 | `X 5 8` |
| 238 | 41 | `X 2 8` |

### N=5 head

- 唯一模式 / 总规则:982 / 12158 = **8.1% 唯一**
- 被 ≥ 2 grammar 共用的模式:813(占模式 82.8%)
- 共用模式覆盖的 rule 占比:**98.6%** ← 切片可合并率

**Top 5 高频共用 head pattern**:

| 用次 | grammar 数 | pattern |
|---|---|---|
| 1558 | 57 | `slope 0 0 C8 slope` |
| 689 | 51 | `slope 0 0 L8 slope` |
| 351 | 52 | `slope 0 0 C4 slope` |
| 292 | 53 | `slope 0 0 R8 C8` |
| 198 | 33 | `X 1 8 X 2` |

### N=8 head

- 唯一模式 / 总规则:2508 / 12158 = **20.6% 唯一**
- 被 ≥ 2 grammar 共用的模式:1916(占模式 76.4%)
- 共用模式覆盖的 rule 占比:**94.9%** ← 切片可合并率

**Top 5 高频共用 head pattern**:

| 用次 | grammar 数 | pattern |
|---|---|---|
| 173 | 31 | `X 1 8 X 2 8 X 3` |
| 163 | 32 | `slope 0 0 C8 slope 1 2 L8` |
| 105 | 26 | `slope 0 0 R1` |
| 102 | 23 | `R1` |
| 88 | 11 | `X 5 8 X 6 8 X 7` |

### N=3 tail

- 唯一模式 / 总规则:1205 / 12158 = **9.9% 唯一**
- 被 ≥ 2 grammar 共用的模式:949(占模式 78.8%)
- 共用模式覆盖的 rule 占比:**97.8%** ← 切片可合并率

**Top 5 高频共用 tail pattern**:

| 用次 | grammar 数 | pattern |
|---|---|---|
| 487 | 56 | `X 5 8` |
| 435 | 54 | `X 1 8` |
| 343 | 47 | `X 2 8` |
| 308 | 51 | `X 7 8` |
| 242 | 47 | `X 4 8` |

### N=5 tail

- 唯一模式 / 总规则:2265 / 12158 = **18.6% 唯一**
- 被 ≥ 2 grammar 共用的模式:1721(占模式 76.0%)
- 共用模式覆盖的 rule 占比:**95.4%** ← 切片可合并率

**Top 5 高频共用 tail pattern**:

| 用次 | grammar 数 | pattern |
|---|---|---|
| 142 | 43 | `1 8 X 7 8` |
| 124 | 30 | `3 8 X 5 8` |
| 108 | 36 | `3 8 X 1 8` |
| 105 | 26 | `slope 0 0 R1` |
| 102 | 23 | `R1` |

### N=8 tail

- 唯一模式 / 总规则:3141 / 12158 = **25.8% 唯一**
- 被 ≥ 2 grammar 共用的模式:2284(占模式 72.7%)
- 共用模式覆盖的 rule 占比:**92.7%** ← 切片可合并率

**Top 5 高频共用 tail pattern**:

| 用次 | grammar 数 | pattern |
|---|---|---|
| 105 | 26 | `slope 0 0 R1` |
| 102 | 23 | `R1` |
| 74 | 14 | `2 8 X 3 8 X 5 8` |
| 67 | 18 | `slope 0 0 R1+1` |
| 64 | 16 | `R1 R1` |

## 6. token 词汇分布

| token 类别 | 出现次数 |
|---|---|
| duration/numeric | 226596 |
| X (scale-degree note) | 88180 |
| CLA[X] (abstract pitch class) | 86866 |
| slope (contour wrapper) | 43158 |
| R (rest) | 18191 |
| other: -2 | 8389 |
| other: -3 | 7769 |
| other: -1 | 7623 |
| other: -4 | 4992 |
| other: -5 | 3275 |
| other: -6 | 974 |
| other: -7 | 951 |
| other: -9 | 899 |
| other: -8 | 626 |
| other: -12 | 220 |

## 7. per-grammar 独占率(独有 ↔ 共享)

独占率高 = grammar 个性强,本身就是独立"family";独占率低 = 大量 rule 跟其他 grammar 雷同。

**Top 10 高独占率(最独特)**:

| grammar | rule 数 | 独占数 | 独占率 |
|---|---|---|---|
| Irish | 32 | 32 | 100.0% |
| StanGetz | 78 | 78 | 100.0% |
| WarneMarsh | 52 | 52 | 100.0% |
| greatMoments | 302 | 297 | 98.3% |
| OliverNelson | 48 | 46 | 95.8% |
| RichPerry | 106 | 70 | 66.0% |
| ChetBaker | 134 | 60 | 44.8% |
| TommyFlanagan | 224 | 64 | 28.6% |
| BudPowell | 98 | 26 | 26.5% |
| PaulChambers | 154 | 37 | 24.0% |

**Top 10 低独占率(最大量复用其他 grammar)**:

| grammar | rule 数 | 独占数 | 独占率 |
|---|---|---|---|
| WayneShorter | 138 | 0 | 0.0% |
| VincentHerring | 148 | 0 | 0.0% |
| TomHarrell | 92 | 0 | 0.0% |
| RoyHargrove | 158 | 0 | 0.0% |
| RedGarland | 68 | 0 | 0.0% |
| PatMartino | 66 | 0 | 0.0% |
| MilesDavis | 996 | 0 | 0.0% |
| LesterYoung | 948 | 0 | 0.0% |
| LeeMorgan | 924 | 0 | 0.0% |
| KennyGarrett | 752 | 0 | 0.0% |

## 8. 结论与切片维度建议

结合 6 个维度数据 + 用户的"PICKUP/BODY/TAIL"直觉 → 给出切片可行性评估和建议下一步。

详见数据上方各章节,后续在审报告后补 §8 推荐切片维度 + 实施路径。
