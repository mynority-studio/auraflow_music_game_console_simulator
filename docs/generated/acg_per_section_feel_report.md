# ACG 逐段 feel 审计(MG 16-bar 标尺 vs SIM 全曲逐段)

- 只审 bass/comp/lead(禁 pad/drum)。MG=16bar loop(拆 4-bar phrase 看自身范围);SIM=全曲逐段。
- 指标:comp/bar · bass/bar · comp onset(single/block/offVel)· lead cov/maxGap/register。⚠=该段偏离 MG 标尺;ⓘ=informational(接受的特性)。

**审计语义(acg_t2_quick_close T2.5):**
- 目标 = MG-like ACG 钢琴演奏【在 SIM 全曲架构里】,**不是** whole-song exact MG parity(异引擎/异进行,per-seed 不对齐是设计接受)。
- **outro** lead 稀疏 = ACG 收尾留白【特性】→ informational(ⓘ),非 ⚠(除非完全无 lead);verse/chorus 的 lead 空仍硬判。
- **comp velocity 是 playback-chain 调整值**(mf ≈50,不是 MG raw pp ≈30)—— SF2/master chain 不同,契约=melody-first 但 comp 可听,**不比 raw MG 字节**。
- 硬契约不松:no pad · lead/comp/bass 分轨 · comp 不空 · comp 多为 rolled/单音(single≥0.9)。

## seed 0
**MG 标尺(16bar):** comp 6.19/bar · bass 2.56/bar · comp onset single 1/block 0/offVel 29.9 · lead cov 0.523/maxGap 4.77/reg 75
  MG 4-bar phrase 范围: comp/bar 5–7 · lead cov 0.443–0.605 · lead maxGap 1.5–3.57 · lead reg 73–76

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 2 | 4.5 | 3 | 1/0/43.3 | 0.464/1.97/77 | ok |
| verse | 8 | 3.88 | 3 | 1/0/45.8 | 0.712/1.86/80 | ok |
| chorus | 8 | 3.63 | 2.75 | 1/0/48 | 0.527/3.52/76 | ok |
| verse | 8 | 4.13 | 3 | 1/0/46 | 0.711/1.86/80 | ok |
| chorus | 8 | 3.5 | 2.75 | 1/0/46.7 | 0.528/3.52/76 | ok |
| outro | 4 | 7 | 3 | 1/0/48.5 | 0.156/12.19/72 | ⓘ outro 留白 cov 0.156/gap 12.19(ACG 收尾特性,接受) |

**texture 宏观 family:** MG: 空旷 31% · 推进 25% · 块状 25% · 水洗 19% · SIM: 空旷 24% · 推进 50% · 块状 16% · 水洗 11%

## seed 7
**MG 标尺(16bar):** comp 4.44/bar · bass 2.88/bar · comp onset single 0.971/block 0.029/offVel 30.1 · lead cov 0.475/maxGap 10.91/reg 74
  MG 4-bar phrase 范围: comp/bar 3.25–5.75 · lead cov 0.327–0.576 · lead maxGap 1.86–5.49 · lead reg 72–76

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 4 | 4.75 | 3 | 1/0/46.7 | 0.566/1.97/76 | ok |
| verse | 8 | 4 | 3 | 1/0/44.5 | 0.619/2.56/77 | ok |
| verse | 8 | 4.13 | 3 | 1/0/44.4 | 0.585/2.57/77 | ok |
| chorus | 8 | 2.88 | 2.88 | 1/0/47.1 | 0.47/2.76/72 | ok |
| verse | 8 | 4.38 | 3 | 1/0/44.3 | 0.584/2.59/77 | ok |
| chorus | 8 | 3.25 | 2.88 | 1/0/46.5 | 0.469/2.77/72 | ok |
| outro | 2 | 2.5 | 3 | 1/0/41.4 | 0.246/2.59/75 | ⓘ outro 留白 cov 0.246/gap 2.59(ACG 收尾特性,接受) |

**texture 宏观 family:** MG: 空旷 6% · 推进 44% · 块状 31% · 水洗 19% · SIM: 空旷 54% · 推进 22% · 块状 22% · 水洗 2%

## seed 42
**MG 标尺(16bar):** comp 5.38/bar · bass 2.94/bar · comp onset single 0.988/block 0.012/offVel 30.4 · lead cov 0.525/maxGap 9.24/reg 76
  MG 4-bar phrase 范围: comp/bar 3.5–8.5 · lead cov 0.411–0.492 · lead maxGap 3.5–5.49 · lead reg 74–77

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 2 | 4 | 3 | 1/0/47.3 | 0.512/2.58/74 | ok |
| verse | 8 | 3 | 3 | 1/0/42.9 | 0.592/2.89/74 | ok |
| chorus | 8 | 3.13 | 2.88 | 1/0/45.4 | 0.602/1.87/75 | ok |
| verse | 8 | 3.38 | 3 | 1/0/43.9 | 0.55/2.89/74 | ok |
| chorus | 8 | 3.13 | 2.88 | 1/0/44.5 | 0.605/1.87/75 | ok |
| bridge | 8 | 5.88 | 2.75 | 1/0/48.2 | 0.631/4.81/72 | ok |
| chorus | 8 | 3.38 | 2.88 | 1/0/44 | 0.606/1.88/75 | ok |
| outro | 4 | 3.25 | 3 | 1/0/46.6 | 0.569/2.82/72 | ok |

**texture 宏观 family:** MG: 空旷 6% · 推进 50% · 块状 38% · 水洗 6% · SIM: 空旷 22% · 推进 52% · 块状 17% · 水洗 9%

## seed 99
**MG 标尺(16bar):** comp 3.81/bar · bass 2.94/bar · comp onset single 1/block 0/offVel 29.4 · lead cov 0.538/maxGap 4.61/reg 75
  MG 4-bar phrase 范围: comp/bar 3–4.5 · lead cov 0.445–0.605 · lead maxGap 1.04–3.56 · lead reg 74–76

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 2 | 4.5 | 3 | 1/0/45.6 | 0.528/0.64/76 | ok |
| verse | 8 | 4.38 | 2.88 | 1/0/44 | 0.667/1.59/80 | ok |
| chorus | 8 | 3.75 | 3 | 1/0/47.1 | 0.611/5.06/74 | ok |
| verse | 8 | 4.63 | 2.88 | 1/0/46.5 | 0.616/4.24/80 | ok |
| chorus | 8 | 3.5 | 3 | 1/0/46.9 | 0.611/5.06/74 | ok |
| bridge | 8 | 4.25 | 2.88 | 1/0/47.5 | 0.575/3.86/76 | ok |
| chorus | 8 | 3.38 | 3 | 1/0/46 | 0.62/5.05/72 | ok |
| outro | 4 | 3.5 | 3 | 1/0/47.5 | 0.673/1.44/77 | ok |

**texture 宏观 family:** MG: 空旷 50% · 推进 31% · 块状 13% · 水洗 6% · SIM: 空旷 11% · 推进 59% · 块状 19% · 水洗 11%

## seed 12345
**MG 标尺(16bar):** comp 5.13/bar · bass 2.88/bar · comp onset single 1/block 0/offVel 30.1 · lead cov 0.492/maxGap 7.42/reg 75
  MG 4-bar phrase 范围: comp/bar 3.5–6.75 · lead cov 0.447–0.565 · lead maxGap 1.49–3.75 · lead reg 73–77

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 4 | 4 | 3 | 1/0/43.7 | 0.468/3.94/74 | ok |
| verse | 8 | 2.75 | 2.88 | 1/0/44.4 | 0.817/1.19/74 | ok |
| chorus | 8 | 3.5 | 3 | 1/0/48.4 | 0.56/3.25/75 | ok |
| verse | 8 | 2.63 | 2.88 | 1/0/44.6 | 0.817/1.19/74 | ok |
| chorus | 8 | 3.88 | 3 | 1/0/46.4 | 0.433/5.45/76 | ok |
| outro | 2 | 7.5 | 3 | 1/0/49.8 | 0/8/0 | ⓘ outro 纯伴奏收尾(无 lead,旋律前段已收 → 接受) |

**texture 宏观 family:** MG: 空旷 6% · 推进 56% · 块状 31% · 水洗 6% · SIM: 空旷 21% · 推进 53% · 块状 21% · 水洗 5%
