# MG ↔ Simulator bass/comp/lead fidelity report

- MG source: `../melodygenerative` @ 24dfd6f (string seed) · SIM 主链路 generateMusicSync (numeric seed)
- 方法:per-bar 密度比较(非 byte parity);忽略 pad/drum。styles=acg/pop/jazz/lofi/rnb seeds=0/7/42/99/12345 key=C
- 列:count(总)· /bar(per-bar 密度)· SIM/MG per-bar 比率。texUniq=MG texturePerBar 唯一织体数。

| style | seed | bars MG/SIM | bass MG/SIM(/bar → x) | comp MG/SIM(/bar → x) | lead MG/SIM(/bar → x) | MG texUniq | SIM prog L/C/B | ⚠ |
|---|---|---|---|---|---|---|---|---|
| acg | 0 | 16/38 | 41/124 (2.56→3.26 = 1.27x) | 99/341 (6.19→8.97 = 1.45x) | 32/98 (2→2.58 = 1.29x) | 6 | 0/0/32 | ok |
| acg | 7 | 16/46 | 46/140 (2.88→3.04 = 1.06x) | 71/373 (4.44→8.11 = 1.83x) | 32/99 (2→2.15 = 1.07x) | 6 | 0/0/32 | ok |
| acg | 42 | 16/54 | 47/182 (2.94→3.37 = 1.15x) | 86/296 (5.38→5.48 = 1.02x) | 33/138 (2.06→2.56 = 1.24x) | 7 | 0/0/32 | ok |
| acg | 99 | 16/54 | 47/166 (2.94→3.07 = 1.04x) | 61/307 (3.81→5.69 = 1.49x) | 35/87 (2.19→1.61 = 0.74x) | 7 | 0/0/32 | ok |
| acg | 12345 | 16/38 | 46/150 (2.88→3.95 = 1.37x) | 82/236 (5.13→6.21 = 1.21x) | 33/62 (2.06→1.63 = 0.79x) | 6 | 0/0/32 | ok |
| pop | 0 | 17/54 | 17/106 (1→1.96 = 1.96x) | 128/536 (7.53→9.93 = 1.32x) | 65/215 (3.82→3.98 = 1.04x) | 1 | 1/2/33 | ok |
| pop | 7 | 16/52 | 48/112 (3→2.15 = 0.72x) | 114/380 (7.13→7.31 = 1.03x) | 28/192 (1.75→3.69 = 2.11x) | 1 | 2/1/34 | ok |
| pop | 42 | 16/54 | 32/116 (2→2.15 = 1.07x) | 114/337 (7.13→6.24 = 0.88x) | 48/186 (3→3.44 = 1.15x) | 1 | 1/2/33 | ok |
| pop | 99 | 16/54 | 17/63 (1.06→1.17 = 1.1x) | 256/499 (16→9.24 = 0.58x) | 70/239 (4.38→4.43 = 1.01x) | 1 | 4/4/34 | ok |
| pop | 12345 | 17/54 | 33/114 (1.94→2.11 = 1.09x) | 113/431 (6.65→7.98 = 1.2x) | 43/231 (2.53→4.28 = 1.69x) | 1 | 2/4/33 | ok |
| jazz | 0 | 16/60 | 60/112 (3.75→1.87 = 0.5x) | 220/546 (13.75→9.1 = 0.66x) | 71/342 (4.44→5.7 = 1.28x) | 1 | 0/4/32 | ok |
| jazz | 7 | 18/60 | 48/118 (2.67→1.97 = 0.74x) | 232/793 (12.89→13.22 = 1.03x) | 75/349 (4.17→5.82 = 1.4x) | 1 | 0/0/35 | ok |
| jazz | 42 | 16/60 | 59/118 (3.69→1.97 = 0.53x) | 240/696 (15→11.6 = 0.77x) | 79/248 (4.94→4.13 = 0.84x) | 1 | 4/4/32 | ok |
| jazz | 99 | 17/60 | 59/112 (3.47→1.87 = 0.54x) | 133/1088 (7.82→18.13 = 2.32x) | 100/315 (5.88→5.25 = 0.89x) | 1 | 4/0/35 | ok |
| jazz | 12345 | 17/56 | 61/104 (3.59→1.86 = 0.52x) | 252/641 (14.82→11.45 = 0.77x) | 84/307 (4.94→5.48 = 1.11x) | 1 | 4/4/32 | ok |
| lofi | 0 | 16/56 | 42/52 (2.63→0.93 = 0.35x) | 154/370 (9.63→6.61 = 0.69x) | 40/213 (2.5→3.8 = 1.52x) | 5 | 4/5/33 | ok |
| lofi | 7 | 16/40 | 41/39 (2.56→0.97 = 0.38x) | 117/285 (7.31→7.13 = 0.98x) | 35/82 (2.19→2.05 = 0.94x) | 5 | 4/4/39 | ok |
| lofi | 42 | 16/56 | 42/58 (2.63→1.04 = 0.4x) | 122/852 (7.63→15.21 = 1.99x) | 36/170 (2.25→3.04 = 1.35x) | 4 | 4/5/33 | ok |
| lofi | 99 | 16/40 | 42/39 (2.63→0.97 = 0.37x) | 186/151 (11.63→3.77 = 0.32x) | 34/192 (2.13→4.8 = 2.25x) | 4 | 4/4/39 | ok |
| lofi | 12345 | 16/40 | 42/39 (2.63→0.97 = 0.37x) | 120/378 (7.5→9.45 = 1.26x) | 35/182 (2.19→4.55 = 2.08x) | 5 | 4/5/33 | ok |
| rnb | 0 | 19/56 | 30/104 (1.58→1.86 = 1.18x) | 151/601 (7.95→10.73 = 1.35x) | 73/234 (3.84→4.18 = 1.09x) | 1 | 4/5/35 | ok |
| rnb | 7 | 16/56 | 56/107 (3.5→1.91 = 0.55x) | 130/409 (8.13→7.3 = 0.9x) | 38/179 (2.38→3.2 = 1.34x) | 1 | 4/4/37 | ok |
| rnb | 42 | 18/56 | 66/79 (3.67→1.41 = 0.38x) | 325/403 (18.06→7.2 = 0.4x) | 82/222 (4.56→3.96 = 0.87x) | 1 | 4/5/39 | ok |
| rnb | 99 | 16/56 | 35/52 (2.19→0.93 = 0.42x) | 126/410 (7.88→7.32 = 0.93x) | 68/240 (4.25→4.29 = 1.01x) | 1 | 5/4/37 | ok |
| rnb | 12345 | 17/56 | 61/68 (3.59→1.21 = 0.34x) | 128/489 (7.53→8.73 = 1.16x) | 75/222 (4.41→3.96 = 0.9x) | 1 | 5/5/35 | ok |

## ACG texturePerBar(MG 逐 bar 织体;SIM 目前段级,待 §4 逐-bar 移植)
- seed 0: MG(6 uniq) = [Piano_TopVoice_Planing, Piano_TopVoice_Planing, ACG_Stride_Cantabile_Ballad, ACG_Pedal_Wash_Color_Drops, ACG_Stride_Cantabile_Ballad, Piano_TopVoice_Planing, ACG_Open_Broken_10th, ACG_Anthem_Block_Push, ACG_Open_Broken_10th, ACG_Ostinato_Hook_Pulse, ACG_Open_Broken_10th, ACG_Anthem_Block_Push, ACG_Anthem_Block_Push, ACG_Stride_Cantabile_Ballad, ACG_Anthem_Block_Push, ACG_Pedal_Wash_Color_Drops]
- seed 7: MG(6 uniq) = [ACG_Ostinato_Hook_Pulse, ACG_Ostinato_Hook_Pulse, ACG_Ostinato_Hook_Pulse, ACG_Pedal_Wash_Color_Drops, ACG_Quartal_Arp_Wave, ACG_Suspended_Block_Arrival, ACG_Quartal_Arp_Wave, ACG_Bass_Tremolo_Color, ACG_Bass_Tremolo_Color, ACG_Quartal_Arp_Wave, ACG_Quartal_Arp_Wave, ACG_Anthem_Block_Push, ACG_Bass_Tremolo_Color, ACG_Suspended_Block_Arrival, ACG_Anthem_Block_Push, ACG_Suspended_Block_Arrival]
- seed 42: MG(7 uniq) = [ACG_Ostinato_Hook_Pulse, ACG_Ostinato_Hook_Pulse, ACG_Ostinato_Hook_Pulse, ACG_Pedal_Wash_Color_Drops, ACG_Ostinato_Hook_Pulse, ACG_Ostinato_Hook_Pulse, ACG_Suspended_Block_Arrival, ACG_Suspended_Block_Arrival, ACG_Quartal_Arp_Wave, ACG_Quartal_Arp_Wave, ACG_Open_Broken_10th, ACG_Bass_Tremolo_Color, ACG_Anthem_Block_Push, ACG_Suspended_Block_Arrival, ACG_Suspended_Block_Arrival, ACG_Suspended_Block_Arrival]
- seed 99: MG(7 uniq) = [Piano_TopVoice_Planing, Piano_TopVoice_Planing, ACG_Pedal_Wash_Color_Drops, ACG_Pedal_Wash_Color_Drops, ACG_Stride_Cantabile_Ballad, ACG_Ostinato_Hook_Pulse, ACG_Ostinato_Hook_Pulse, ACG_Pedal_Wash_Color_Drops, ACG_Open_Broken_10th, ACG_Quartal_Arp_Wave, ACG_Open_Broken_10th, ACG_Suspended_Block_Arrival, ACG_Pedal_Wash_Color_Drops, ACG_Pedal_Wash_Color_Drops, ACG_Suspended_Block_Arrival, ACG_Pedal_Wash_Color_Drops]
- seed 12345: MG(6 uniq) = [ACG_Ostinato_Hook_Pulse, ACG_Ostinato_Hook_Pulse, ACG_Ostinato_Hook_Pulse, ACG_Pedal_Wash_Color_Drops, ACG_Quartal_Arp_Wave, ACG_Ostinato_Hook_Pulse, ACG_Quartal_Arp_Wave, ACG_Anthem_Block_Push, ACG_Quartal_Arp_Wave, ACG_Ostinato_Hook_Pulse, ACG_Quartal_Arp_Wave, ACG_Anthem_Block_Push, ACG_Suspended_Block_Arrival, ACG_Bass_Tremolo_Color, ACG_Suspended_Block_Arrival, ACG_Suspended_Block_Arrival]

## 汇总:25 例,0 例有 warning/error。