# 和声丝滑重配指南 — 共同音驱动的 Viterbi 选和弦

> **文档性质**：算法说明 + 指导手册
> **适用范围**：`/src/core/generation/harmony/` 下的三阶段和声生成管线
> **关联 Rule**：`.claude/rules/music_generation_pipeline_rule.md`（最高约束）
> **关联 PR**：PR#1（基础设施）、PR#2（三阶段管线）、PR#3（旋律节奏锚点修复 + 借调 bonus）

---

## 0. 为什么要写这份文档

历史问题：早期版本的和声生成是**硬切**的 —— 先在调内随机选一套功能进行（I-V-vi-IV 模板），然后生成旋律，结束。整首曲子的和弦就是那四个调内三和弦在 4 小节内循环，听感单调、转折生硬，尤其在段落交界处明显"跳"。

本次重构（PR#2）的核心立意是：**让离调 (secondary dominant)、借调 (modal interchange)、扩展色彩 (Rnb-flavored extended chords) 自然涌现**，而不是靠事后"补一刀"。关键突破是把"共同音"作为过渡平滑度的**量化判据**，用 12-bit 位运算 + Viterbi 动态规划在候选池中挑出全局最优和弦序列。

---

## 1. 核心哲学：申克分析的三层递进

借鉴申克分析法 (Schenkerian Analysis)，我们把和声生成拆成**三个抽象层次**，从粗到细：

```
背景层 (Background)   Phase 1: 影子骨架
  └── 抽象的 T-S-D 功能方向，完全不管具体和弦色彩
      例：Verse = [T, T, S, D]

中景层 (Middleground) Phase 2: 骨架旋律
  └── 在 T/S/D 功能约束下生成"骨架音 anchor"（pitch class 0~11）
      仅依赖功能，不依赖具体和弦

前景层 (Foreground)   Phase 3: Viterbi 选和弦
  └── 基于骨架旋律 + 候选池 + 共同音评分，全局最优选和弦
      离调/借调/扩展色彩在这一层通过 +bonus 自然胜出
```

**关键设计点**：**和弦进行不是一次定下的**。Phase 1 只定"方向性"（T-S-D），具体是 C / Am / F / G 还是 Cmaj7 / vi9 / IVmaj7 / V7sus4 —— 这要等 Phase 3 看到旋律后才决定。

---

## 2. 五阶段总流程

```
sections + tonality + timeSig
  │
  ▼
[Phase 1] ShadowSkeletonGenerator.generateShadowSkeleton()
  │        输出: ShadowSlot[]  (function ∈ {T, S, D}, suggestedRootPc, isStrong)
  │        PRNG: ×1 per section (选模板)
  │
  ▼
[Phase 2] SkeletonMelodyGenerator.generateSkeletonMelody()
  │        输出: anchor[]  (pitch class 0~11, 每个 shadow slot 一个)
  │        PRNG: ×0.5~×1 per slot (强位 50% 走 smoothing / 弱位 100% smoothing)
  │
  ▼
[Phase 3] ViterbiChordSelector.selectChords()
  │        输出: GeneratedChord[]  (具体和弦, 含 root + quality)
  │        评分: Top Voice + 前瞻2拍 + Voice Leading(共同音) + 功能匹配 + 扩展税
  │        算法: per-section Viterbi DP, K=28 候选, N=段落槽位数
  │
  ▼
[Phase 4] ToplineEngine.generateTrackMelody()
  │        基于最终 chords[] 生成细节旋律 (装饰音、切分、填充)
  │        旋律此时"回填"到和弦上，但不再反馈调整和弦
  │
  ▼
[Phase 5] (Viterbi 管线下跳过) HarmonyCore.reharmonize()
           旧版非 Viterbi 风格才会走，用贪心 DP 做二次重配
```

**一个关键事实**：用户印象里那次"非常大的调整"对应 PR#2 —— 我们**不再跑事后 reharmonize**。因为 Viterbi 在 Phase 3 已经基于骨架旋律做了全局最优选择，再跑贪心 reharmonize 反而会破坏长线连贯性。**想要"丝滑"，就把所有候选（包括离调/借调）一次性丢进 Viterbi 的候选池，让它自己挑**。

---

## 3. 核心算法公式

### 3.1 和弦的位掩码表示 (ChordMask)

每个和弦被编码为 12-bit 整数，bit *i* = 1 表示包含 pitch class *i*。

$$
\text{mask}(\text{root}, \text{quality}) = \bigcup_{v \in I_q} \{(\text{root} + v) \bmod 12\}
$$

其中 $I_q$ 是质别 $q$ 的音程表（如 Major = [0, 4, 7]）。

**代码** (`ChordMask.ts:66-68`)：

```typescript
export function commonTones(a: ChordMask, b: ChordMask): number {
    return popcount12(a & b);
}
```

**共同音数公式**：

$$
\text{CT}(C_i, C_j) = \text{popcount}(\text{mask}(C_i) \wedge \text{mask}(C_j))
$$

**例**：
- C Major (`0b000010010001`) & F Major (`0b001000010001`) → CT = 2 (C, F 重合两个音中的那两个 … 实际是 C, F 调上 → C/E/G & F/A/C → 共 1 个 C)
- C Major & Am (`0b001000010001 ... 实际 A/C/E = 0b000100010001`) → CT = 2 (C, E)

**性能**：2 ops (`&` + popcount)，极快。ESP32 上 1 周期完成。

---

### 3.2 Viterbi 评分函数 (scoreStep)

对于候选和弦 $c$，在骨架音 $a_t$ 处、前一和弦 $c_{prev}$、功能约束 $f_t$ 下的单步评分：

$$
\text{score}(c, c_{prev}, a_t, a_{t+1}, a_{t+2}, f_t) = 10 \cdot \left[ \text{base}(c, \ldots) \right] + \text{jitter}
$$

其中 `base` 的展开：

$$
\begin{aligned}
\text{base} =
  & \underbrace{3 \cdot S[q_c][(a_t - r_c) \bmod 12]}_{\text{Top Voice}} \\
  + & \underbrace{1 \cdot \lfloor S[q_c][(a_{t+1} - r_c) \bmod 12] / 2 \rfloor}_{\text{Lookahead 1}} \\
  + & \underbrace{1 \cdot \lfloor S[q_c][(a_{t+2} - r_c) \bmod 12] / 4 \rfloor}_{\text{Lookahead 2}} \\
  + & \underbrace{2 \cdot \min(\text{CT}(c, c_{prev}), 3)}_{\text{Voice Leading (共同音)}} \\
  + & \underbrace{8 \cdot \mathbb{1}[f_c = f_t]}_{\text{功能匹配}} \\
  + & \underbrace{-10 \cdot \mathbb{1}[c = c_{prev}]}_{\text{自环硬惩罚}} \\
  + & \underbrace{-1 \cdot \max(0, \text{bitCount}(c) - 3)}_{\text{扩展音税}} \\
  + & \underbrace{\text{bonus}(c)}_{\text{风格驱动补偿}}
\end{aligned}
$$

- $S[q][i]$：Top Voice 评分表（17 质 × 12 音程，值域 -4 … +4，见 §3.3）
- $r_c, q_c$：候选的根音、质别
- $f_c$：候选的功能分类（T/S/D）
- $f_t$：当前槽位的功能约束（来自 Phase 1）
- `jitter`：PRNG 扰动 0~9（解 tie，保确定性）
- `×10` 放大：让 base 占据十位以上，jitter 只在个位起 tiebreak 作用

**权重表**（`ViterbiChordSelector.ts:145-156`）：

| 符号 | 值 | 意义 |
|------|----|----|
| W_TOP_VOICE | 3 | 当前骨架音最重要 |
| W_LOOKAHEAD_1 | 1 (×½) | 下一骨架音 |
| W_LOOKAHEAD_2 | 1 (×¼) | 下下骨架音 |
| W_VOICE_LEADING | 2 | 每个共同音 |
| VOICE_LEADING_CAP | 3 | 共同音最多算 3 个（防 self-loop 满分坍塌） |
| W_FUNCTIONAL | 8 | 功能匹配（压过 voice leading）|
| W_REPEAT_PENALTY | -10 | 相邻同和弦硬惩罚 |
| W_COMPLEXITY_TAX | -1 | 每个超出三和弦的扩展音 |
| TIEBREAKER_RANGE | 9 | jitter 范围 |

---

### 3.3 Top Voice 评分表 (SCORE_TABLE)

以 Major 质为例（`ChordScoreTable.ts`）：

```
音程:    R   b9   9   b3   3   11  #11  5   b6   6   b7  maj7
值:     +3  -4   +2  -3   +4  -1  -2  +3  -3   +3  -1   +3
```

**评分哲学**：
- `+4` = 定义音（3 度、maj7）
- `+3` = 根音或甜美扩展（9, 6）
- `+2` = 稳定五音
- `0` = 中性
- `-1` 至 `-4` = 与定义音半音冲突（b9 最差）

完整 17 质 × 12 音程矩阵见 `ChordScoreTable.ts:41-100`。

---

### 3.4 候选池 + bonus 机制

候选池含 28 个和弦，分 6 层（`CandidatePool.ts:41-97`）：

| 层 | 数量 | 代表 | bonus | 说明 |
|----|------|------|-------|------|
| 自然三和弦 | 6 | I, ii, iii, IV, V, vi | 0 | 调内骨架 |
| 七和弦扩展 | 6 | Imaj7, ii7, V7 … | 0 | 基本扩展 |
| 高级色彩 | 4 | Imaj9, Cadd9, ii9, vi9 | 0 | 直接扩展 9 度 |
| **副属和弦** | 4 | V/V=D7, V/vi=E7, V/ii=A7, V/iii=B7 | **+2** | 离调，但 bonus 让它在合适时机浮现 |
| **借调和弦** | 4 | bIII, bVI, bVII (Maj), iv (min) | **+3 / +2** | Modal interchange |
| Sus & 半减 | 4 | Vsus4, V7sus4, Isus4, viim7b5 | 0 | 张力铺垫 |

**为什么副属 +2、借调 +3？**

- 借调 +3 的本质：骨架旋律（Phase 2）严守调内（符合 Pitch Space 契约 K-3），借调和弦的 chord tones 永远不会落在 anchor 上，在 `topVoice` 评分上天然吃亏。+3 bonus 就是**对"骨架不可触碰"这件事的补偿**，让 `bVI → I` 这样的史诗过渡能自然涌现。
- 副属 +2 的本质：副属本身不是调内，但如果后续旋律刚好在其 leading tone 上，它是最优选。+2 bonus 抵消"调外"劣势，让 `ii → V/V → V → I` 这种经典结构在 Viterbi 路径里胜出。
- **不是+10**（那会导致频繁离调、突兀）、**不是+0.5**（那等于没给）。+2/+3 是校准后的"临界值"：旋律平淡时不会选，旋律"特别适合"时才选，产生"精妙感"。

---

### 3.5 Viterbi DP 递推

令 $V[t][k]$ = 到达第 $t$ 个槽位、选择第 $k$ 个候选时的累积最优得分，$\text{bt}[t][k]$ = 回溯指针。

$$
V[t][k] = \max_{j \in \{0, \ldots, K-1\}} \left( V[t-1][j] + \text{score}(c_k, c_j, a_t, a_{t+1}, a_{t+2}, f_t) \right)
$$

$$
\text{bt}[t][k] = \arg\max_{j} \left( V[t-1][j] + \text{score}(\ldots) \right)
$$

复杂度：$O(N \cdot K^2)$，其中 $N$ 是段落槽位数（上限 32），$K$ = 28。

**per-section 分片**：Viterbi **按段落独立运行**，段落边界不跨区做 DP。理由：
1. 避免 $N$ 随整首曲子线性增长
2. 段落感保护（Chorus 结束后重新选择，不受 Verse 末尾的 voice leading 惯性拖累）
3. 内存：$32 \times 28 \approx 900$ 个 int，ESP32 friendly

---

## 4. 离调 / 借调 / Rnb 色彩的完整触发路径

以经典进行 `I → bVI → IV → I`（摇滚式 Axis）为例，说明引擎如何**自然选出** bVI：

### 4.1 Phase 1：影子骨架

假设当前是 Chorus，PRNG 选中模板 `[[T, 0], [T, 9], [S, 5], [T, 0]]`：
```
slot[0] = T, rootPc=0  (I 方向)
slot[1] = T, rootPc=9  (vi 方向)
slot[2] = S, rootPc=5  (IV 方向)
slot[3] = T, rootPc=0  (I 方向)
```

### 4.2 Phase 2：骨架旋律

在 C Major 下（tonality=Major, keyOffset=0），各 slot 的 T/S 候选音：
- T_PREFERRED = [0, 4, 7]  → C, E, G
- S_PREFERRED = [5, 9, 2]  → F, A, D

PRNG 决策后假设生成 `anchor[] = [0, 9, 5, 4]`（C → A → F → E）。

### 4.3 Phase 3：Viterbi 评分

考虑 slot[1]（anchor = A = pc 9），候选对比：

| 候选 | Top Voice | VL (vs I) | Functional | Bonus | Base | 说明 |
|------|-----------|-----------|------------|-------|------|------|
| vi (Am) | S[min][0]=+3 (A 是根音) | CT(C, Am)=2 → 2×2=+4 | T match → +8 | 0 | 3×3 + 4 + 8 = **21** | 调内首选 |
| **bVI (Ab)** | S[maj][1]≈+4 (A是大三度) | CT(C, Ab)=1 → 2×1=+2 | T match → +8 | **+3** | 3×4 + 2 + 8 + 3 = **25** | ★ 胜出！|
| I (C) | S[maj][9]=+3 (A 是 6 度) | CT(C, C)=3 → 6, 但 repeat=-10 | T match → +8 | 0 | 3×3 + 6 + 8 - 10 = **13** | 自环被罚 |

**bVI 因 +3 bonus + A 刚好是它的大三度而胜出**。

### 4.4 后续传播

slot[2] 选 IV（F）时，与前一 bVI（Ab）的共同音 CT(Ab, F) = 2 (C, F 共享中的一个 … 实际 Ab-C-Eb vs F-A-C → CT=1 个 C）。虽然 CT 偏低，但 IV 的 `topVoice` 评分很高（F 根音 + anchor=F），加权后 IV 仍是最优。**voice leading 的平滑不是靠硬匹配，而是评分体系里一个可权衡项**。

---

## 5. Rnb 色彩和弦的扩展路径

想让引擎更 Rnb（常见 Imaj9, IVmaj7, ii9, iii7, Vm7）？两种策略：

### 5.1 候选池加权（推荐）

修改 `CandidatePool.ts`，给 Rnb 色彩和弦 +1 bonus：

```typescript
makeCandidate(0,  ChordQuality.Major9,    T, +1),  // Imaj9
makeCandidate(5,  ChordQuality.Major7,    S, +1),  // IVmaj7
makeCandidate(2,  ChordQuality.Minor9,    S, +1),  // ii9
```

**权衡**：bonus 越大越容易出现，但扩展音税 (`-1 per extra tone`) 会拉回来。Maj9 有 5 个音（4 tone extra），税 = -4；如果给 +5 bonus，净 +1 就能和普通三和弦抗衡。

### 5.2 风格驱动的 Top Voice 调整

给特定风格重写 `SCORE_TABLE`，让 9 度、13 度在 Rnb 下评分更高：

```typescript
// Rnb 风格覆写：Major 的 9 度 +2 → +3
SCORE_TABLE_RNB[Major][2] = +3;   // 9
SCORE_TABLE_RNB[Major][9] = +4;   // 13 (6)
SCORE_TABLE_RNB[Major][11] = +4;  // maj7
```

这样只要旋律里有 9/13/maj7 的骨架音，引擎会**自动升级**到 maj9 / Maj13。

---

## 6. 参数调优指南

### 6.1 当想让"离调更频繁"

- 提高 **W_FUNCTIONAL** → 让 T/S/D 约束更硬，副属（功能=D）更容易在 S 或 T 槽位挤进来？（实际上 +8 已经很高，慎动）
- 提高 **副属 bonus** (`+2 → +3`)：副属直接出现更多
- 降低 **W_COMPLEXITY_TAX** (`-1 → 0`)：让扩展和弦无税，更容易出现

### 6.2 当听感"太离"、不稳

- **降低 bonus**：借调 `+3 → +2`，副属 `+2 → +1`
- **提高 VOICE_LEADING_CAP** (`3 → 4`)：共同音多的调内和弦加分更多，拉回调内
- **提高 W_VOICE_LEADING** (`2 → 3`)：voice leading 权重加码

### 6.3 当想让 Chorus 更爆、Verse 更平

- Phase 1 模板池已分 `VERSE_TEMPLATES` / `CHORUS_TEMPLATES`
- 进一步：让 `functionalBonus` 随 section type 缩放（副属在 Chorus bonus=+3，在 Verse bonus=+1）

### 6.4 确定性注意

任何对 PRNG 消耗次数的改动（新增分支、删除分支）都会破坏确定性。改动后必须按 Rule §5 重跑四快照点 (stateA/B/C/D) 验证。

---

## 7. 代码路径索引

| 功能 | 文件 | 行号 |
|------|------|------|
| 影子骨架入口 | `src/core/generation/harmony/ShadowSkeletonGenerator.ts` | 98-134 |
| Verse/Chorus 模板 | 同上 | 41-80 |
| 骨架旋律入口 | `src/core/generation/harmony/SkeletonMelodyGenerator.ts` | 110-152 |
| 反滞留 (pickClosest) | 同上 | 82-108 |
| T/S/D 候选音池 | 同上 | 43-45 |
| Viterbi 主选择器 | `src/core/generation/harmony/ViterbiChordSelector.ts` | 323-389 |
| 评分函数 scoreStep | 同上 | 169-234 |
| 权重常数 | 同上 | 145-156 |
| 候选池构造 | `src/core/generation/harmony/CandidatePool.ts` | 41-97 |
| Top Voice 评分表 | `src/core/generation/harmony/ChordScoreTable.ts` | 41-100 |
| ChordMask 位运算 | `src/core/generation/harmony/ChordMask.ts` | 全文 |
| `commonTones()` | 同上 | 66-68 |
| `popcount12()` | 同上 | 50-56 |
| 管线总入口 | `src/core/generation/harmony/HarmonyPipeline.ts` | 88-192 |
| 旧版 reharmonize（后备） | `src/core/generation/composing/HarmonyCore.ts` | 962-1149 |
| `sharesCommonTones()` 验证 | 同上 | 272-288 |

---

## 8. 常见误区

### 误区 1：以为"重配和弦"是事后替换

**错**。在 Viterbi 管线下，和弦不是先生成再替换的 —— 候选池**一次性丢 28 个进去**，Viterbi DP 按 voice leading + 旋律契合挑最优路径。所谓"重配"是**选择过程本身**就包含了全部选项，不存在"替换"。

### 误区 2：以为共同音越多越好

**错**。`VOICE_LEADING_CAP = 3` 就是为了防止 "CT=5 或 6 的 self-loop" 霸榜。完全相同的和弦 CT 最高，但那叫停滞不叫过渡。真正的丝滑是**2~3 个共同音 + 1~2 个半音进行的新音**。

### 误区 3：以为借调就是简单替换 IV → iv

**错**。引擎的借调候选包括 `bIII, bVI, bVII (Maj), iv (min)`，每个都有独立的功能分类和 bonus。是否选中取决于**旋律骨架是否正好能在这个和弦上得高分** + **与前后和弦的共同音** + **风格补偿**。不是硬性规则替换。

### 误区 4：以为 Phase 2 的旋律是最终旋律

**错**。Phase 2 只生成**骨架音 anchor[]**（pitch class，不带时值），是为 Phase 3 选和弦服务的。真正的细节旋律在 Phase 4 (`ToplineEngine`) 生成，此时 anchor 已经被"升格"为和弦音，装饰音、切分、填充在此之上展开。

### 误区 5：以为 GlobalContext.currentKeyOffset 可以用来调 pitch

**错**。这违反 Pitch Space 契约 **K-5**。Phase 1~3 所有 pitch 都在**相对空间**（主音=0）。`keyOffset` 只在 `Orchestrator.applyOffset()` 时统一加上。如果在候选池或评分里偷偷加 keyOffset，就会"双重偏移" —— 症状是跨调不和谐，bug 极难定位。

---

## 9. 与 ESP32 移植的关系

全部算法都是 C-friendly 的：
- ChordMask 位运算：1 周期
- Viterbi DP：per-section $32 \times 28^2 \approx 25k$ 次评分，ESP32-S3 @ 240MHz 约 1~2ms
- 内存：$V[N][K]$ + $\text{bt}[N][K]$ = $32 \times 28 \times 2 \times 4$ bytes = 7KB，塞得下 SRAM
- 无 Map / Set / 闭包，全是数组 + 整数

移植清单详见 `docs/esp32_porting.md` 的 "Viterbi DP 预算" 章节。

---

## 10. 验证清单

修改本管线任何代码后，**必须**跑：

1. **PRNG 快照一致性**：`stateA / stateB / stateC / stateD` 在种子 12345 下的值与基线匹配（除非有意改动消耗次数）
2. **输出等效性**：黄金种子 12345 生成的 `GeneratedTrack` 逐字段等于 baseline snapshot
3. **听感回归**：审计 SeedLab 的 5 个标杆种子（由 `docs/music_engine_audit_standard.md` 定义），确认没有出现硬切或不和谐
4. **Pitch Space 合规**：grep 整个 `/harmony/` 目录，确认没有 `keyOffset` 被意外加入 Phase 1~3 的 pitch 计算

验证失败 = 修改不可合入（Rule §5 硬约束）。

---

**文档结束**。如需深入某个模块，直接跳 §7 代码索引。修改时请同步更新本文档的权重表、参数、流程图。
