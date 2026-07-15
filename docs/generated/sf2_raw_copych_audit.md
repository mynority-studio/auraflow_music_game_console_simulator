# SF2 Raw / Copych Device Audit

SF2: /Users/mynority/vibe_coding/auraflow_music_game_console_simulator/public/Aura25_GM128.sf2
Sample rate: 24000 Hz
SHA256: 81a0ef82258c429caa4b9cbdf0805ab89e63d65d5f2bd8669d2a20bdde84a850
Scope: CC7=100, CC11=127, CC91/93/95=0, stress polyphony; device chain uses current web Copych postchain; ESP estimate uses raw peak * 4.28

| Preset | Role | Raw Peak | Device Peak | Device RMS | ESP 4.28 Peak Est. | Soft | Hard | Flags | Worst |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| 0:0 大钢琴 | lead | -22.86 | -12.14 | -29.48 | -10.23 | 0 | 0 | OK | v120 48/53/59/64/69/75/80/85/91/96 |
| 0:5 GU Electric Grand | comp | -14.73 | -5.94 | -23.92 | -2.1 | 0 | 0 | OK | v120 48/53/59/64/69/75/80/85/91/96 |
| 8:5 GU Chorused FM EP | comp | -26.69 | -16.66 | -34.94 | -14.06 | 0 | 0 | OK | v120 48/53/59/64/69/75/80/85/91/96 |
| 0:24 尼龙吉他 | comp | -18.44 | -7.53 | -23.06 | -5.82 | 0 | 0 | OK | v120 40/45/51/56/61/67/72/77/83/88 |
| 0:25 民谣木吉他 | comp | -18.44 | -7.53 | -23.06 | -5.82 | 0 | 0 | OK | v120 40/45/51/56/61/67/72/77/83/88 |
| 0:32 原声贝斯 | bass | -17.66 | -7.95 | -25.18 | -5.03 | 0 | 0 | OK | v120 28/32/37/41/45/50/54/58/63/67 |
| 0:38 合成贝斯 1 | bass | -22.37 | -15.21 | -29.47 | -9.74 | 0 | 0 | OK | v120 24/33/42/51/60 |
| 0:67 上低音萨克斯 | lead | -15.16 | -5.96 | -22.79 | -2.53 | 0 | 0 | OK | v120 36/40/44/48/52/56/60/64/68/72 |
| 0:89 暖 Pad | pad | -27.3 | -16.28 | -28.35 | -14.68 | 0 | 0 | OK | v120 48/53/59/64/69/75/80/85/91/96 |
| 0:108 卡林巴 | lead | -14.18 | -7.1 | -24.76 | -1.55 | 0 | 0 | OK | v120 60/63/66/69/72/76/79/82/85/88 |
| 128:8 Room 鼓组 | drum | -9.44 | 0 | -22.74 | 3.19 | 0.001563 | 0.000911 | WEB_SOFT, WEB_HARD, ESP_GAIN_RISK | v120 36/38/42/46/49/51/57/36/38/42 |
| 128:25 TR-808 鼓组 | drum | -13.05 | -5.67 | -30.54 | -0.42 | 0 | 0 | OK | v120 36/38/42/46/49/51/57/36/38/42 |
| 128:40 Brush 鼓组 | drum | -12.78 | -5.04 | -28.61 | -0.15 | 0 | 0 | HIGH_5K | v120 36/38/42/46/49/51/57/36/38/42 |

Notes: Room kit single kick body is preserved by design. The remaining Room warning is a deliberately extreme simultaneous 10-hit stress case; the next fix belongs in drum performance/timing and bus protection rather than further SF2 kick attenuation.
