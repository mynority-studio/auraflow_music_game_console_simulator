# SF2 Direct Balance Audit

SF2: `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/public/Aura25_GM128.sf2`
SHA256: `c2c0cb4e0dcdb5586e3116fdb45351529871aa6cf79ff179d784dba2c019e56a`
Sample rate: `24000`
Scope: SF2 direct/raw render only: CC7=100, CC11=127, FX sends=0, no Copych postchain/EQ/softclip/masterLift. Active RMS excludes release/silence; drums use short onset window.

| Preset | Role | Target active RMS | Active window | Single peak/RMS | Normal peak/RMS | Stress peak/RMS | Full normal RMS | Delta | Status |
|---|---|---:|---|---:|---:|---:|---:|---:|---|
| 0:0 大钢琴 | lead | -33 | 0.06-0.5s | -32.13/-39.2 | -21.82/-32.98 | -18.86/-30.96 | -36.97 | -0.02 | PASS |
| 0:5 GU Electric Grand | comp | -34 | 0.06-0.5s | -32.6/-38.54 | -22.73/-33.41 | -16.72/-29.36 | -37.36 | -0.59 | PASS |
| 0:11 Vibraphone | lead | -33 | 0.06-0.5s | -35.14/-40.11 | -23.54/-33.03 | -17.43/-28.96 | -36.87 | 0.03 | PASS |
| 8:5 GU Chorused FM EP | comp | -34 | 0.06-0.5s | -34.35/-45.43 | -19.22/-34.44 | -12.01/-27.51 | -37.81 | 0.44 | PASS |
| 0:24 尼龙吉他 | comp | -34 | 0.06-0.5s | -32.2/-38.73 | -23.3/-33.02 | -18.44/-29.47 | -36.93 | -0.98 | PASS |
| 0:25 民谣木吉他 | comp | -34 | 0.06-0.5s | -32.2/-38.73 | -23.3/-33.02 | -18.44/-29.47 | -36.93 | -0.98 | PASS |
| 0:32 原声贝斯 | bass | -33 | 0.06-0.5s | -29.05/-40.7 | -22.28/-34.14 | -16.91/-28.63 | -37.76 | 1.14 | PASS |
| 0:38 合成贝斯 1 | bass | -33 | 0.06-0.5s | -32.37/-39.09 | -24.74/-34.42 | -22.43/-31.86 | -38.66 | 1.42 | PASS |
| 0:67 上低音萨克斯 | lead | -33 | 0.06-0.5s | -35.42/-43.95 | -22.54/-33.73 | -17.04/-27.91 | -38.2 | 0.73 | PASS |
| 0:89 暖 Pad | pad | -38 | 0.06-0.5s | -31.58/-39.12 | -29.41/-38.21 | -22.53/-31.86 | -41.46 | 0.21 | PASS |
| 0:108 卡林巴 | lead | -33 | 0.06-0.5s | -35.52/-41.46 | -24.29/-34.41 | -15.83/-27.16 | -37.69 | 1.41 | PASS |
| 128:8 Room 鼓组 | drum | -34 | 0-0.35s | -22.37/-35.46 | -17.18/-32.98 | -11.84/-27.09 | -38.98 | -1.02 | PASS |
| 128:25 TR-808 鼓组 | drum | -34 | 0-0.35s | -23.18/-33.29 | -19.54/-32.94 | -14.93/-30.43 | -38.68 | -1.06 | PASS |
| 128:40 Brush 鼓组 | drum | -34 | 0-0.35s | -28.28/-48.26 | -18.07/-35.26 | -11.32/-28.39 | -40.86 | 1.26 | PASS |

Status: PASS within +/-1.5 dB of the role target; WATCH within +/-3 dB; OUT needs another SF2 or arrangement-layer decision.
