# ACG 逐段 feel 审计(MG 16-bar 标尺 vs SIM 全曲逐段)

- 只审 bass/comp/lead(禁 pad/drum)。MG=16bar loop(拆 4-bar phrase 看自身范围);SIM=全曲逐段。
- 指标:comp/bar · bass/bar · comp onset(single/block/offVel)· lead cov/maxGap/register。⚠=该段偏离 MG 标尺。

## seed 0
**MG 标尺(16bar):** comp 6.19/bar · bass 2.56/bar · comp onset single 1/block 0/offVel 29.9 · lead cov 0.523/maxGap 4.77/reg 75
  MG 4-bar phrase 范围: comp/bar 5–7 · lead cov 0.443–0.605 · lead maxGap 1.5–3.57 · lead reg 73–76

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 2 | 2.5 | 3 | 1/0/29 | 0.576/0.59/75 | ok |
| verse | 8 | 3.5 | 2.88 | 1/0/28.8 | 0.487/3.57/75 | ok |
| chorus | 8 | 3.63 | 2.75 | 1/0/30.1 | 0.494/4.67/75 | ok |
| verse | 8 | 3.75 | 2.88 | 1/0/27.3 | 0.487/3.54/75 | ok |
| chorus | 8 | 4 | 2.75 | 0.968/0.032/30.1 | 0.494/4.69/75 | ok |
| outro | 4 | 2.5 | 3 | 1/0/27.2 | 0.632/2.08/76 | ok |

**texture 宏观 family:** MG: 空旷 31% · 推进 25% · 块状 25% · 水洗 19% · SIM: 空旷 29% · 推进 34% · 块状 18% · 水洗 18%

## seed 7
**MG 标尺(16bar):** comp 4.44/bar · bass 2.88/bar · comp onset single 0.971/block 0.029/offVel 30.1 · lead cov 0.475/maxGap 10.91/reg 74
  MG 4-bar phrase 范围: comp/bar 3.25–5.75 · lead cov 0.327–0.576 · lead maxGap 1.86–5.49 · lead reg 72–76

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 4 | 4 | 3 | 1/0/28.1 | 0.57/1.33/75 | ok |
| verse | 8 | 4.13 | 3 | 0.935/0.065/27.8 | 0.633/1.49/76 | ok |
| verse | 8 | 4.25 | 3 | 1/0/28.3 | 0.633/1.51/77 | ok |
| chorus | 8 | 4.5 | 2.75 | 0.941/0.059/27.9 | 0.509/3.27/75 | ok |
| verse | 8 | 4.5 | 3 | 0.971/0.029/27.8 | 0.6/1.96/76 | ok |
| chorus | 8 | 4 | 2.75 | 1/0/28.5 | 0.509/3.29/75 | ok |
| outro | 2 | 3.5 | 3 | 1/0/24.8 | 0.612/1.45/77 | ok |

**texture 宏观 family:** MG: 空旷 6% · 推进 44% · 块状 31% · 水洗 19% · SIM: 空旷 43% · 推进 20% · 块状 33% · 水洗 4%

## seed 42
**MG 标尺(16bar):** comp 5.38/bar · bass 2.94/bar · comp onset single 0.988/block 0.012/offVel 30.4 · lead cov 0.525/maxGap 9.24/reg 76
  MG 4-bar phrase 范围: comp/bar 3.5–8.5 · lead cov 0.411–0.492 · lead maxGap 3.5–5.49 · lead reg 74–77

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 2 | 4 | 3 | 1/0/28.9 | 0.387/1.98/75 | ok |
| verse | 8 | 3.13 | 3 | 1/0/28.5 | 0.575/2.58/74 | ok |
| chorus | 8 | 3.75 | 2.88 | 1/0/27.7 | 0.586/1.99/74 | ok |
| verse | 8 | 3.25 | 3 | 1/0/28.1 | 0.576/2.58/74 | ok |
| chorus | 8 | 3.75 | 2.88 | 0.966/0.034/26.6 | 0.586/1.99/74 | ok |
| bridge | 8 | 6.63 | 2.63 | 1/0/29.1 | 0.496/5.01/74 | ok |
| chorus | 8 | 3.88 | 2.88 | 0.967/0.033/27.4 | 0.587/2/74 | ok |
| outro | 4 | 3.5 | 2.75 | 1/0/28.5 | 0.546/2.38/73 | ok |

**texture 宏观 family:** MG: 空旷 6% · 推进 50% · 块状 38% · 水洗 6% · SIM: 空旷 24% · 推进 33% · 块状 28% · 水洗 15%

## seed 99
**MG 标尺(16bar):** comp 3.81/bar · bass 2.94/bar · comp onset single 1/block 0/offVel 29.4 · lead cov 0.538/maxGap 4.61/reg 75
  MG 4-bar phrase 范围: comp/bar 3–4.5 · lead cov 0.445–0.605 · lead maxGap 1.04–3.56 · lead reg 74–76

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 2 | 3.5 | 3 | 1/0/22.3 | 0.527/0.64/72 | ok |
| verse | 8 | 4 | 3 | 1/0/27 | 0.502/3.74/74 | ok |
| chorus | 8 | 3.5 | 3 | 0.963/0.037/29.9 | 0.631/4.04/73 | ok |
| verse | 8 | 3.63 | 3 | 1/0/27.9 | 0.533/4.36/75 | ok |
| chorus | 8 | 3.13 | 3 | 1/0/28.5 | 0.665/3.2/73 | ok |
| bridge | 8 | 4.75 | 2.88 | 1/0/29.7 | 0.421/4.86/74 | ok |
| chorus | 8 | 3.38 | 3 | 1/0/29 | 0.644/3.2/74 | ok |
| outro | 4 | 4.25 | 3 | 1/0/28.9 | 0.446/4.95/76 | ok |

**texture 宏观 family:** MG: 空旷 50% · 推进 31% · 块状 13% · 水洗 6% · SIM: 空旷 13% · 推进 48% · 块状 31% · 水洗 7%

## seed 12345
**MG 标尺(16bar):** comp 5.13/bar · bass 2.88/bar · comp onset single 1/block 0/offVel 30.1 · lead cov 0.492/maxGap 7.42/reg 75
  MG 4-bar phrase 范围: comp/bar 3.5–6.75 · lead cov 0.447–0.565 · lead maxGap 1.49–3.75 · lead reg 73–77

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 4 | 4.75 | 3 | 1/0/28.8 | 0.392/3.56/76 | ok |
| verse | 8 | 4.13 | 2.88 | 1/0/27.8 | 0.581/2.18/76 | ok |
| chorus | 8 | 5.13 | 2.88 | 1/0/29.2 | 0.418/4.65/78 | ok |
| verse | 8 | 4.25 | 2.88 | 0.97/0.03/28.1 | 0.581/2.18/76 | ok |
| chorus | 8 | 4.5 | 2.88 | 1/0/28.9 | 0.519/2.75/76 | ok |
| outro | 2 | 4 | 3 | 1/0/29.1 | 0.533/1.41/75 | ok |

**texture 宏观 family:** MG: 空旷 6% · 推进 56% · 块状 31% · 水洗 6% · SIM: 空旷 29% · 推进 13% · 块状 50% · 水洗 8%
