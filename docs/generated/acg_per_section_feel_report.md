# ACG 逐段 feel 审计(MG 16-bar 标尺 vs SIM 全曲逐段)

- 只审 bass/comp/lead(禁 pad/drum)。MG=16bar loop(拆 4-bar phrase 看自身范围);SIM=全曲逐段。
- 指标:comp/bar · bass/bar · comp onset(single/block/offVel)· lead cov/maxGap/register。⚠=该段偏离 MG 标尺。

## seed 0
**MG 标尺(16bar):** comp 6.19/bar · bass 2.56/bar · comp onset single 1/block 0/offVel 29.9 · lead cov 0.523/maxGap 4.77/reg 75
  MG 4-bar phrase 范围: comp/bar 5–7 · lead cov 0.443–0.605 · lead maxGap 1.5–3.57 · lead reg 73–76

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 2 | 2.5 | 3 | 1/0/29.2 | 0.561/0.63/75 | ok |
| verse | 8 | 3.63 | 2.63 | 0.964/0.036/29.5 | 0.508/4.17/75 | ok |
| chorus | 8 | 4 | 2.88 | 1/0/29.5 | 0.5/4.67/75 | ok |
| verse | 8 | 3.88 | 2.63 | 1/0/29.1 | 0.509/4.16/75 | ok |
| chorus | 8 | 4.38 | 2.88 | 1/0/29.5 | 0.5/4.68/75 | ok |
| outro | 4 | 2.75 | 3 | 1/0/28.3 | 0.592/2.08/76 | ok |

## seed 7
**MG 标尺(16bar):** comp 4.44/bar · bass 2.88/bar · comp onset single 0.971/block 0.029/offVel 30.1 · lead cov 0.475/maxGap 10.91/reg 74
  MG 4-bar phrase 范围: comp/bar 3.25–5.75 · lead cov 0.327–0.576 · lead maxGap 1.86–5.49 · lead reg 72–76

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 4 | 5.5 | 3 | 1/0/29.3 | 0.273/5.28/76 | ok |
| verse | 8 | 5.25 | 2.88 | 1/0/28.2 | 0.469/3.56/76 | ok |
| verse | 8 | 5 | 2.88 | 1/0/28.8 | 0.468/3.56/76 | ok |
| chorus | 8 | 4.88 | 2.88 | 0.974/0.026/27.2 | 0.46/2.65/75 | ok |
| verse | 8 | 5.25 | 2.88 | 1/0/28.4 | 0.468/3.54/76 | ok |
| chorus | 8 | 4.38 | 2.88 | 1/0/28.8 | 0.46/2.64/75 | ok |
| outro | 2 | 3.5 | 3 | 1/0/26 | 0.612/1.43/77 | ok |

## seed 42
**MG 标尺(16bar):** comp 5.38/bar · bass 2.94/bar · comp onset single 0.988/block 0.012/offVel 30.4 · lead cov 0.525/maxGap 9.24/reg 76
  MG 4-bar phrase 范围: comp/bar 3.5–8.5 · lead cov 0.411–0.492 · lead maxGap 3.5–5.49 · lead reg 74–77

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 2 | 3.5 | 3 | 1/0/29.2 | 0.387/1.98/75 | ok |
| verse | 8 | 4.88 | 2.75 | 1/0/28.4 | 0.416/7.24/76 | ok |
| chorus | 8 | 4.88 | 2.75 | 0.974/0.026/28.3 | 0.429/5.55/74 | ok |
| verse | 8 | 5 | 2.75 | 0.974/0.026/28.6 | 0.416/7.25/76 | ok |
| chorus | 8 | 4.88 | 2.75 | 0.974/0.026/30.2 | 0.428/5.56/74 | ok |
| bridge | 8 | 4.38 | 2.88 | 1/0/27.6 | 0.5/4.69/74 | ok |
| chorus | 8 | 4.88 | 2.75 | 1/0/28.6 | 0.428/5.53/74 | ok |
| outro | 4 | 3.25 | 2.75 | 1/0/27.8 | 0.585/2.4/73 | ok |

## seed 99
**MG 标尺(16bar):** comp 3.81/bar · bass 2.94/bar · comp onset single 1/block 0/offVel 29.4 · lead cov 0.538/maxGap 4.61/reg 75
  MG 4-bar phrase 范围: comp/bar 3–4.5 · lead cov 0.445–0.605 · lead maxGap 1.04–3.56 · lead reg 74–76

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 2 | 3.5 | 3 | 1/0/29.2 | 0.524/0.63/72 | ok |
| verse | 8 | 4 | 3 | 1/0/26.9 | 0.482/3.74/75 | ok |
| chorus | 8 | 7 | 3 | 1/0/32.6 | 0.209/10.26/72 | ⚠ comp 密度 7 vs MG 3.81; lead 覆盖 0.209 < MG phrase min 0.445; lead 太空 gap 10.26 > MG phrase max 3.56 |
| verse | 8 | 3.5 | 3 | 1/0/28.4 | 0.494/4.36/75 | ok |
| chorus | 8 | 7.5 | 3 | 1/0/31.6 | 0.148/13.04/72 | ⚠ comp 密度 7.5 vs MG 3.81; lead 覆盖 0.148 < MG phrase min 0.445; lead 太空 gap 13.04 > MG phrase max 3.56 |
| bridge | 8 | 6.13 | 2.75 | 1/0/29.2 | 0.42/6.13/74 | ⚠ lead 太空 gap 6.13 > MG phrase max 3.56 |
| chorus | 8 | 7.63 | 3 | 1/0/31.8 | 0.148/13.05/72 | ⚠ comp 密度 7.63 vs MG 3.81; lead 覆盖 0.148 < MG phrase min 0.445; lead 太空 gap 13.05 > MG phrase max 3.56 |
| outro | 4 | 4 | 3 | 1/0/27.7 | 0.562/2.25/76 | ok |

## seed 12345
**MG 标尺(16bar):** comp 5.13/bar · bass 2.88/bar · comp onset single 1/block 0/offVel 30.1 · lead cov 0.492/maxGap 7.42/reg 75
  MG 4-bar phrase 范围: comp/bar 3.5–6.75 · lead cov 0.447–0.565 · lead maxGap 1.49–3.75 · lead reg 73–77

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 4 | 5 | 3 | 1/0/29 | 0.393/3.56/76 | ok |
| verse | 8 | 7 | 2.38 | 1/0/29.3 | 0.401/8.72/74 | ⚠ lead 太空 gap 8.72 > MG phrase max 3.75 |
| chorus | 8 | 5.88 | 2.75 | 0.978/0.022/30.1 | 0.439/4.98/78 | ok |
| verse | 8 | 7 | 2.38 | 1/0/29 | 0.4/8.74/74 | ⚠ lead 太空 gap 8.74 > MG phrase max 3.75 |
| chorus | 8 | 5.75 | 2.75 | 1/0/29.5 | 0.439/4.96/78 | ok |
| outro | 2 | 4 | 3 | 1/0/25.2 | 0.613/1.42/74 | ok |
