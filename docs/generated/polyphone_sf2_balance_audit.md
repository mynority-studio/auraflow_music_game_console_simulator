# Polyphone SF2 Balance Audit

SF2: `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/public/Aura25_GM128.sf2`
Polyphone CSV: `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/docs/generated/polyphone_audit/Aura25_GM128_polyphone`
Samples: `109` + EOS, sample rates `[24000]`, bit depths `[16]`
Sample length frames: min `39`, median `2721`, max `27931`

## Preset / Zone Balance

| Preset | Role | Zones | Attenuation dB min/median/max | Reverb max | Chorus max | Copych raw peak | Device peak | ESP 4.28 est | Flags |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 0:0 大钢琴 | lead | 33 | 12.70/13.50/13.50 | 70 | 0 | -22.86 | -12.14 | -10.23 | OK |
| 0:5 GU Electric Grand | comp | 80 | 17.50/17.50/30.00 | 0 | 0 | -14.73 | -5.94 | -2.1 | OK |
| 0:11 Vibraphone | lead | 8 | 21.00/22.25/26.30 | 0 | 0 | -14.63 | -5.91 | -2.01 | OK |
| 0:24 尼龙吉他 | comp | 11 | 17.00/17.80/19.30 | 16 | 0 | -18.44 | -7.53 | -5.82 | OK |
| 0:25 民谣木吉他 | comp | 11 | 17.00/17.80/19.30 | 16 | 0 | -18.44 | -7.53 | -5.82 | OK |
| 0:32 原声贝斯 | bass | 5 | 15.60/15.60/15.60 | 24 | 0 | -17.66 | -7.95 | -5.03 | OK |
| 0:38 合成贝斯 1 | bass | 9 | 18.70/18.70/18.70 | 24 | 0 | -22.37 | -15.21 | -9.74 | OK |
| 0:67 上低音萨克斯 | lead | 6 | 0.00/12.00/13.00 | 70 | 0 | -15.16 | -5.96 | -2.53 | OK |
| 0:89 暖 Pad | pad | 8 | 14.60/14.60/14.60 | 70 | 80 | -27.3 | -16.28 | -14.68 | OK |
| 0:108 卡林巴 | lead | 5 | 18.30/18.30/19.00 | 70 | 0 | -14.18 | -7.1 | -1.55 | OK |
| 8:5 GU Chorused FM EP | comp | 174 | 15.50/43.25/110.00 | 0 | 160 | -26.69 | -16.66 | -14.06 | OK |
| 128:8 Room 鼓组 | drum | 68 | 5.00/9.00/28.70 | 1 | 0 | -9.44 | 0 | 3.19 | WEB_SOFT, WEB_HARD, ESP_GAIN_RISK |
| 128:25 TR-808 鼓组 | drum | 121 | 3.50/6.50/28.20 | 1 | 0 | -13.05 | -5.67 | -0.42 | OK |
| 128:40 Brush 鼓组 | drum | 109 | 3.50/6.50/28.20 | 1 | 0 | -12.78 | -5.04 | -0.15 | HIGH_5K |

## Judgment

- Polyphone structure audit: PASS for embedded basics. All non-EOS samples are 24 kHz / 16-bit, and all preset/instrument CSVs export correctly.
- Generator-level leveling: mostly PASS. Hot drum kits now have extra InitialAttenuation, and missing drum-zone attenuation generators were inserted instead of changing PCM samples.
- Copych headroom: PASS for melodic instruments, vibraphone, TR-808, and Brush in the stress table; Room kit still fails only in the artificial simultaneous 10-hit v120 stress case.
- Fully flat raw loudness: NOT YET. The stress raw peaks still span about 18 dB from warm pad / chorused FM EP to Room kit. This is safe-oriented and musical, not mathematically flat.
- Recommended next action: do not keep flattening Room kick in SF2. Fix Room extreme clipping in drum performance timing / same-frame transient limiting, then use final bus protection.
