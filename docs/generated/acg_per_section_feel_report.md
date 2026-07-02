# ACG 逐段 feel 审计(MG 16-bar 标尺 vs SIM 全曲逐段)

- 只审 bass/comp/lead(禁 pad/drum)。MG=16bar loop(拆 4-bar phrase 看自身范围);SIM=全曲逐段。
- 指标:comp/bar · bass/bar · comp onset(single/block/offVel)· lead cov/maxGap/register。⚠=该段偏离 MG 标尺。

## seed 0
**MG 标尺(16bar):** comp 6.19/bar · bass 2.56/bar · comp onset single 1/block 0/offVel 29.9 · lead cov 0.523/maxGap 4.77/reg 75
  MG 4-bar phrase 范围: comp/bar 5–7 · lead cov 0.443–0.605 · lead maxGap 1.5–3.57 · lead reg 73–76

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 2 | 4.5 | 3 | 1/0/48.2 | 0.464/1.97/77 | ok |
| verse | 8 | 3.88 | 3 | 1/0/50.9 | 0.701/1.86/80 | ok |
| chorus | 8 | 3.63 | 2.75 | 1/0/53.4 | 0.517/3.52/76 | ok |
| verse | 8 | 4.13 | 3 | 0.969/0.031/51.1 | 0.7/1.86/80 | ok |
| chorus | 8 | 3.5 | 2.75 | 1/0/52.9 | 0.519/3.52/76 | ok |
| outro | 4 | 7 | 3 | 1/0/53.7 | 0.156/12.19/72 | ⚠ lead 覆盖 0.156 < MG phrase min 0.443; lead 太空 gap 12.19 > MG phrase max 3.57 |

**texture 宏观 family:** MG: 空旷 31% · 推进 25% · 块状 25% · 水洗 19% · SIM: 空旷 24% · 推进 50% · 块状 16% · 水洗 11%

## seed 7
**MG 标尺(16bar):** comp 4.44/bar · bass 2.88/bar · comp onset single 0.971/block 0.029/offVel 30.1 · lead cov 0.475/maxGap 10.91/reg 74
  MG 4-bar phrase 范围: comp/bar 3.25–5.75 · lead cov 0.327–0.576 · lead maxGap 1.86–5.49 · lead reg 72–76

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 4 | 4.75 | 3 | 1/0/52 | 0.561/1.97/76 | ok |
| verse | 8 | 4 | 3 | 0.933/0.067/49.8 | 0.584/2.69/77 | ok |
| verse | 8 | 4.13 | 3 | 0.862/0.138/49.6 | 0.55/2.68/77 | ⚠ 块状床(single 0.862) |
| chorus | 8 | 2.88 | 2.88 | 1/0/52.4 | 0.474/2.76/72 | ok |
| verse | 8 | 4.38 | 3 | 0.971/0.029/49.6 | 0.549/2.71/77 | ok |
| chorus | 8 | 3.25 | 2.88 | 0.96/0.04/51.7 | 0.474/2.77/72 | ok |
| outro | 2 | 2.5 | 3 | 1/0/48.4 | 0.246/2.59/76 | ok |

**texture 宏观 family:** MG: 空旷 6% · 推进 44% · 块状 31% · 水洗 19% · SIM: 空旷 54% · 推进 22% · 块状 22% · 水洗 2%

## seed 42
**MG 标尺(16bar):** comp 5.38/bar · bass 2.94/bar · comp onset single 0.988/block 0.012/offVel 30.4 · lead cov 0.525/maxGap 9.24/reg 76
  MG 4-bar phrase 范围: comp/bar 3.5–8.5 · lead cov 0.411–0.492 · lead maxGap 3.5–5.49 · lead reg 74–77

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 2 | 4 | 3 | 0.857/0.143/52.8 | 0.512/2.58/74 | ⚠ 块状床(single 0.857) |
| verse | 8 | 3 | 3 | 1/0/47.9 | 0.584/2.89/74 | ok |
| chorus | 8 | 3.13 | 2.88 | 1/0/50.6 | 0.605/1.87/75 | ok |
| verse | 8 | 3.38 | 3 | 1/0/49 | 0.542/2.89/74 | ok |
| chorus | 8 | 3.13 | 2.88 | 0.958/0.042/49.6 | 0.605/1.87/75 | ok |
| bridge | 8 | 5.88 | 2.75 | 1/0/53.7 | 0.614/4.81/72 | ok |
| chorus | 8 | 3.38 | 2.88 | 0.962/0.038/49.1 | 0.606/1.88/75 | ok |
| outro | 4 | 3.25 | 3 | 1/0/51.8 | 0.547/2.82/72 | ok |

**texture 宏观 family:** MG: 空旷 6% · 推进 50% · 块状 38% · 水洗 6% · SIM: 空旷 22% · 推进 52% · 块状 17% · 水洗 9%

## seed 99
**MG 标尺(16bar):** comp 3.81/bar · bass 2.94/bar · comp onset single 1/block 0/offVel 29.4 · lead cov 0.538/maxGap 4.61/reg 75
  MG 4-bar phrase 范围: comp/bar 3–4.5 · lead cov 0.445–0.605 · lead maxGap 1.04–3.56 · lead reg 74–76

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 2 | 4.5 | 3 | 1/0/50.9 | 0.518/0.64/76 | ok |
| verse | 8 | 4.38 | 2.88 | 0.971/0.029/49 | 0.656/1.59/80 | ok |
| chorus | 8 | 3.75 | 3 | 1/0/52.4 | 0.611/5.06/74 | ok |
| verse | 8 | 4.63 | 2.88 | 0.972/0.028/51.9 | 0.616/4.24/80 | ok |
| chorus | 8 | 3.5 | 3 | 0.963/0.037/52.3 | 0.611/5.06/74 | ok |
| bridge | 8 | 4.25 | 2.88 | 1/0/52.8 | 0.575/3.86/76 | ok |
| chorus | 8 | 3.38 | 3 | 1/0/51.2 | 0.62/5.05/72 | ok |
| outro | 4 | 3.5 | 3 | 1/0/52.7 | 0.636/1.44/77 | ok |

**texture 宏观 family:** MG: 空旷 50% · 推进 31% · 块状 13% · 水洗 6% · SIM: 空旷 11% · 推进 59% · 块状 19% · 水洗 11%

## seed 12345
**MG 标尺(16bar):** comp 5.13/bar · bass 2.88/bar · comp onset single 1/block 0/offVel 30.1 · lead cov 0.492/maxGap 7.42/reg 75
  MG 4-bar phrase 范围: comp/bar 3.5–6.75 · lead cov 0.447–0.565 · lead maxGap 1.49–3.75 · lead reg 73–77

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |
|---|---|---|---|---|---|---|
| intro | 4 | 4 | 3 | 1/0/48.7 | 0.468/3.94/74 | ok |
| verse | 8 | 2.75 | 2.88 | 0.952/0.048/49.5 | 0.806/1.19/74 | ok |
| chorus | 8 | 3.5 | 3 | 1/0/53.8 | 0.56/3.25/75 | ok |
| verse | 8 | 2.63 | 2.88 | 0.895/0.105/49.8 | 0.806/1.19/74 | ⚠ 块状床(single 0.895) |
| chorus | 8 | 3.88 | 3 | 1/0/51.7 | 0.433/5.45/76 | ok |
| outro | 2 | 7.5 | 3 | 1/0/55.3 | 0/8/0 | ok |

**texture 宏观 family:** MG: 空旷 6% · 推进 56% · 块状 31% · 水洗 6% · SIM: 空旷 21% · 推进 53% · 块状 21% · 水洗 5%
