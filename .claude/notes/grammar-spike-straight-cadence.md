# Grammar Spike Report — Straight-Cadence

> 生成于 2026-05-26 | 单 brick name 切片化可行性验证

**假设**:`brick name × BRICK length → unique body 矩阵` 可大幅压缩 grammar 规模。
**spike 目标**:吃透 `Straight-Cadence`(audit 数据中最大池,1858 rule × 42 grammar)

## A. per-length 桶基础统计

总共 1858 条 `Straight-Cadence` rule,来自 42 个 grammar。

| BRICK length | beat | rule 数 | grammar 数 | unique body | clone body | 共用 rule 占比 | 唯一/总数 比 |
|---|---|---|---|---|---|---|---|
| 480 | 1 | 28 | 10 | 12 | 6 | 78.6% | 42.9% |
| 960 | 2 | 1442 | 42 | 364 | 255 | 92.4% | 25.2% |
| 1440 | 3 | 180 | 22 | 77 | 50 | 85.0% | 42.8% |
| 1920 | 4 | 208 | 16 | 60 | 52 | 96.2% | 28.8% |
| **TOTAL** | — | **1858** | — | **513** | — | — | **27.6%** |

**核心数据**:1858 条 `Straight-Cadence` rule → 去重后 513 条 unique body(**压缩率 72.4%**)。

## B. 抽样 body 字面(Top 5 共用 + 5 random unique,per length 桶)

看 body 是否真的"看起来一样的就是一样的"(字面去重靠谱否),以及 unique body 之间到底差在哪。

### length=480(1 beat)桶 — 28 rule / 12 unique

**Top 共用 body**:

| 用次 | grammar 数 | grammar 列表(前 5) | body 摘要(前 100 字符)|
|---|---|---|---|
| 4 | 4 | TomHarrell, TomHarrellMotif, VincentHerring, WesMontgomery | `(X 1 16) (X 3 16) (X 5 16) (X 7 16) (X 6 8) (X 5 8) (X 1 8) (X 6 8) (X 3 8) (X 1 8)` |
| 4 | 4 | TomHarrell, TomHarrellMotif, VincentHerring, WesMontgomery | `(slope 0 0 R16 C16) (slope 3 4 C16 C16) (slope -5 -1 L8 C8 C8 L8 C8 C8)` |
| 4 | 4 | TomHarrell, TomHarrellMotif, VincentHerring, WesMontgomery | `(X 1 8) (X 2 8) (X 3 8) (X 4 8) (X b2 8) (X b3 8) (X 3 8) (X 5 8)` |
| 4 | 4 | TomHarrell, TomHarrellMotif, VincentHerring, WesMontgomery | `(slope 0 0 C8) (slope 1 3 L8 C8 L8 L8 L8 C8 C8)` |
| 3 | 3 | LesterYoung, MilesDavis, NickBrignola | `(X 4 8) (X b2 8) (X 2 8) (X 4 8) (X 7 8) (X #5 8) (X 6 8) (X 1 8)` |

**抽样 unique body**:

| grammar | body 摘要(前 120 字符)|
|---|---|
| BudPowell | `(X 5 8) (X #3 8) (X 1 8/3) (X #7 8/3) (X 7 8/3) (X 3 8) (X b2 8) (X 1 8) (X 7 8)` |
| BudPowell | `(slope 0 0 C8) (slope -4 -1 X8 C8/3 A8/3 C8/3 C8) (slope 9 9 C8) (slope -2 -1 C8 C8)` |
| TommyFlanagan | `(X 3 8) (X 4 8) (X 5 8) (X 7 8) (X #5 8) (X 6 8) (X 3 8) (X 5 8)` |
| TommyFlanagan | `(slope 0 0 C8) (slope 1 3 L8 C8 C8 L8 L8) (slope -5 -5 C8) (slope 3 3 C8)` |
| greatMoments | `(X 1 8) (X 3 8) (X 5 8) (X 7 8) (X 3 4+8) (X 2 8)` |

### length=960(2 beat)桶 — 1442 rule / 364 unique

**Top 共用 body**:

| 用次 | grammar 数 | grammar 列表(前 5) | body 摘要(前 100 字符)|
|---|---|---|---|
| 24 | 4 | LeeMorgan, LesterYoung, MilesDavis, NickBrignola | `R1 R1` |
| 24 | 4 | LeeMorgan, LesterYoung, MilesDavis, NickBrignola | `(slope 0 0 R1+1)` |
| 15 | 8 | JohnColtrane, JohnColtraneMotif, KennyGarrett, LeeMorgan, LesterYoung, +3 | `(X 5 8) (X 6 8) (X 7 8) (X 1 8) (X 6 8) (X 5 8) (X 3 8) (X 2 8) (X 5 8) (X 4 8) (X 3 8) (X 7 8) (X 2...` |
| 14 | 7 | JohnColtrane, JohnColtraneMotif, KennyGarrett, LeeMorgan, LesterYoung, +2 | `(X 4 8) (X #3 8) (X 3 8) (X 2 8) (X 5 8) (X 4 8) (X 3 8) (X 2 8) (X 5 8) (X 4 8) (X 3 8) (X 7 8) (X ...` |
| 14 | 7 | JohnColtrane, JohnColtraneMotif, KennyGarrett, LeeMorgan, LesterYoung, +2 | `(slope 0 0 L8) (slope -2 -1 A8 C8 C8 C8 L8 C8 C8 C8) (slope 10 10 A8) (slope -5 -1 C8 C8) (slope 3 3...` |

**抽样 unique body**:

| grammar | body 摘要(前 120 字符)|
|---|---|
| CedarWalton | `(X 4 8) (X 3 8) (X 2 8) (X 3 8) (X 2 8) (X 4 8) (X 6 8) (X #5 8) (X 7 8) (X 5 8) (X 2 8) (X 1 8) (X 7 8) (X 1 8) (X 3 8)...` |
| NickBrignola | `(X b6 8) (X 4 8) (X b5 8) (X b6 8) (X 6 8) (X #7 8) (X b2 8) (X 3 8) (X b3 8) (X 3 8) (X b3 8) (X b2 8) (X 1 8) (X 7 8) ...` |
| StanGetz | `(slope 0 0 L4+8) (slope -3 -3 L8) (slope 1 2 A8/3 C8/3 L8/3) (slope -3 -3 A8/3) (slope 1 2 C8/3 L8/3) (slope -4 -3 L8 L8...` |
| StanGetz | `(X 4 2+8) (X 1 4) (X 7 8) (X 3 4) R2 (X 1 4)` |
| TommyFlanagan | `R2 (X 1 4) (X #7 4) (X 5 4) R8 (X 3 8) (X 2 8) (X 1 8) R4` |

### length=1440(3 beat)桶 — 180 rule / 77 unique

**Top 共用 body**:

| 用次 | grammar 数 | grammar 列表(前 5) | body 摘要(前 100 字符)|
|---|---|---|---|
| 4 | 4 | ArtFarmer, PatMartino, RoyHargrove, TommyFlanagan | `R8 (X 7 8) (X 3 8) (X 4 8) (X 5 8) (X 6 8) (X 4 8) (X 3 8) (X b3 4) (X b3 16/3) (X 7 16/3) (X #5 16/...` |
| 4 | 4 | ArtFarmer, PatMartino, RoyHargrove, TommyFlanagan | `(slope 0 0 R8 C8) (slope 1 5 C8 L8 C8 L8) (slope -3 -2 L8 C8) (slope 5 5 C4) (slope 0 0 C16/3) (slop...` |
| 4 | 4 | ArtFarmer, PatMartino, RoyHargrove, TommyFlanagan | `R16 (X #7 16) (X 1 16) (X 2 16) (X 3 16) (X 4 16) (X 5 16) (X 7 16) (X 3 16) (X 5 16) R16 (X 1 16) (...` |
| 4 | 4 | ArtFarmer, PatMartino, RoyHargrove, TommyFlanagan | `(slope 0 0 R16 A16) (slope 1 3 C16 L16 C16 L16 C16 C16) (slope -1 -1 C16) (slope 3 3 C16) (slope -7 ...` |
| 4 | 4 | CharlieParker, CharlieParkerMotif, CliffordBrown, ColemanHawkins-Ballads | `(X b5 8) (X 1 8) (X 7 8) (X b5 8) (X 1 4+8) (X 7 8) (X 1 8) R8 R4 R4 (X 4 4) (X 1 4) (X 2 4+8) (X 4 ...` |

**抽样 unique body**:

| grammar | body 摘要(前 120 字符)|
|---|---|
| CharlieParkerMotif | `(slope 0 0 R4 C8) (slope -3 -1 L8 A8 C8 L8 C8 L8 L8 L8 C8 L8 L8) (slope 2 7 C16/3 L16/3) (slope -9 -1 C16/3 C8 C8 C8) (s...` |
| ChetBaker | `(X b5 8) (X 4 8) (X 3 8) (X 2 8) (X 3 4+8) (X b2 8) (X #5 4+8) (X 5 8) (X 4 4) (X 3 4) (X 6 4+8) (X 6 8) R2` |
| ChetBaker | `(slope 0 0 R2 L4+8) (slope 1 1 C8) (slope -5 -1 C4 C4 C2) (slope 10 10 R2 A4) (slope -1 -1 C4)` |
| ChetBaker | `R4 (X 4 8) (X b5 8) (X 2 8) (X 4 8) (X 3 8) (X 4 8) (X b2 8) (X 2 8) (X b3 8) (X b2 8) (X 1 8) (X 7 8) (X 6 8) (X 1 8) (...` |
| WarneMarsh | `(slope 0 0 C16) (slope -3 -3 C16) (slope 5 5 L16) (slope -3 -3 L16) (slope 1 2 C16 L16 C16) (slope -2 -1 L16 C16 L16 C16...` |

### length=1920(4 beat)桶 — 208 rule / 60 unique

**Top 共用 body**:

| 用次 | grammar 数 | grammar 列表(前 5) | body 摘要(前 100 字符)|
|---|---|---|---|
| 5 | 5 | KennyGarrett, LeeMorgan, LesterYoung, MilesDavis, NickBrignola | `(X 1 4) R2 (X 7 8) (X 6 8) R2+4 (X #5 8) (X #4 8) (X 7 4) R8 (X 6 8) (X b7 4) R8 (X #5 8) (X 5 8) (X...` |
| 5 | 5 | KennyGarrett, LeeMorgan, LesterYoung, MilesDavis, NickBrignola | `(slope 0 0 C4) (slope -2 -1 R2 C8 L8) (slope 4 4 R2+4 L8) (slope -2 -2 L8 C4 R8 L8) (slope 1 1 X4) (...` |
| 5 | 5 | KennyGarrett, LeeMorgan, LesterYoung, MilesDavis, NickBrignola | `(X 3 4+8) (X 1 4+8) R4 R2 (X 7 8) (X 1 8) R8 (X 7 8) (X 3 4) (X 5 4) (X #5 4) (X 5 4) R2 R8 (X 2 4+8...` |
| 5 | 5 | KennyGarrett, LeeMorgan, LesterYoung, MilesDavis, NickBrignola | `(slope 0 0 C4+8) (slope -3 -3 C4+8) (slope 2 3 R2+4 C8 C8) (slope -9 -1 R8 C8 C4 C4) (slope 1 1 A4) ...` |
| 5 | 5 | KennyGarrett, LeeMorgan, LesterYoung, MilesDavis, NickBrignola | `(X b6 8) (X b5 8) (X 4 8) (X #3 8) (X 3 8) (X b6 8) (X 4 8) (X 3 8) (X 6 8) (X 1 8) R8 (X 5 8) (X 3 ...` |

**抽样 unique body**:

| grammar | body 摘要(前 120 字符)|
|---|---|
| ChetBaker | `(X 2 4) (X 5 8) (X 2 8) (X b2 4) (X 5 8) (X b2 8) (X 5 4) (X 2 8) (X 5 8) (X #5 4) (X 2 8) (X 5 8) (X b3 4) (X 3 4) (X 6...` |
| ChetBaker | `(slope 0 0 R4 C8) (slope -5 -1 L8 X4) (slope 6 6 C8) (slope -6 -1 A8 C4) (slope 7 7 L8) (slope -7 -7 C8) (slope 1 6 L4 L...` |
| ChetBaker | `(X 2 4) (X 7 4) (X 4 8) (X #3 8) (X 4 8) (X 3 8) (X 6 4) (X 4 8) (X 1 4+8) R8 (X 7 8) (X 3 4) (X 1 4) (X 5 8) (X #4 8) (...` |
| ChetBaker | `(slope 0 0 L4) (slope -5 -1 C4 L8 A8) (slope 1 10 L8 C8) (slope -5 -1 L4 L8 C4+8) (slope 10 10 R8 C8) (slope -5 -1 C4 C4...` |
| ChetBaker | `(X 3 8) R2+4+8 R4 (X 7 8) (X 1 8) (X b2 8) (X b3 16) (X b2 16) (X 1 8) (X 7 8) (X 3 4+8) (X 5 8) (X 3 4) R4 R2+4 (X 3 8)...` |

## C. PICKUP / TAIL N-gram 内部结构(N=4)

观察 body 的前 4 / 后 4 flatten token —— 是否能用 N-gram"句首库 / 句尾库"再二次切片。

### Top 10 高频 PREFIX(body 头 4 token)

| 用次 | grammar 数 | 长度桶 | prefix |
|---|---|---|---|
| 221 | 31 | 1440/1920/480/960 | `slope 0 0 C8` |
| 126 | 29 | 1440/1920/480/960 | `slope 0 0 L8` |
| 107 | 14 | 480/960 | `X 5 8 X` |
| 104 | 30 | 1440/1920/960 | `slope 0 0 R8` |
| 67 | 27 | 1440/1920/960 | `slope 0 0 R4` |
| 64 | 19 | 1440/1920/480/960 | `X 4 8 X` |
| 50 | 19 | 1440/480/960 | `X 1 8 X` |
| 49 | 24 | 1920/960 | `slope 0 0 R4+8` |
| 49 | 15 | 1920/960 | `slope 0 0 C4` |
| 46 | 17 | 1440/960 | `slope 0 0 R2` |

### Top 10 高频 SUFFIX(body 尾 4 token)

| 用次 | grammar 数 | 长度桶 | suffix |
|---|---|---|---|
| 101 | 21 | 1920/480/960 | `8 X 5 8` |
| 82 | 27 | 1440/1920/960 | `8 X 2 8` |
| 58 | 16 | 1440/480/960 | `8 X 1 8` |
| 55 | 16 | 1440/1920/960 | `8 X 6 8` |
| 36 | 8 | 960 | `3 L8 C8 C8` |
| 26 | 11 | 1920/960 | `X 5 8 R4` |
| 24 | 10 | 1440/960 | `-1 C8 C8 L8` |
| 24 | 4 | 960 | `R1 R1` |
| 24 | 4 | 960 | `slope 0 0 R1+1` |
| 22 | 8 | 480/960 | `slope 3 3 C8` |

**Prefix 多样性**:153 唯一 prefix / 1858 rule = 8.2%
**Suffix 多样性**:337 唯一 suffix / 1858 rule = 18.1%

## D. spike 结论(待审)

待人工审完上面三段数据后,在此填写:
- [ ] body 字面去重靠不靠谱(微差 body 是否被错合并?)
- [ ] 单 brick name 桶的压缩率(unique / total)是否达预期 < 30%?
- [ ] PREFIX / SUFFIX 是否有清晰的"句首库 / 句尾库"结构?
- [ ] 是否值得走"切片化重构"全套?或部分?
