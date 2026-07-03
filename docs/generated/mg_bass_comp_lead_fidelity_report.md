# MG ↔ Simulator bass/comp/lead fidelity report

- MG source: `../melodygenerative` @ 24dfd6f (string seed) · SIM 主链路 generateMusicSync (numeric seed)
- 方法:per-bar 密度比较(非 byte parity);忽略 pad/drum。styles=acg/pop/jazz/lofi/rnb seeds=0/7/42/99/12345 key=C
- 列:count(总)· /bar(per-bar 密度)· SIM/MG per-bar 比率。texUniq=MG texturePerBar 唯一织体数。

| style | seed | bars MG/SIM | comp/bar MG→SIM | bass/bar MG→SIM | pedal MG/SIM | lead cov MG/SIM | lead maxGap MG/SIM | texUniq MG/SIM | comp single MG/SIM | comp block MG/SIM | comp offVel MG/SIM | ⚠ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| acg | 0 | 16/38 | 6.19→4.16 (0.67x) | 2.56→2.89 (1.13x) | 32/76 | 0.523/0.567 | 4.77/12.19 | 6/10 | 1/1 | 0/0 | 29.9/46.7 | ok |
| acg | 7 | 16/46 | 4.44→3.76 (0.85x) | 2.88→2.96 (1.03x) | 32/92 | 0.475/0.536 | 10.91/3.31 | 6/9 | 0.971/1 | 0.029/0 | 30.1/45.2 | ok |
| acg | 42 | 16/54 | 5.38→3.63 (0.67x) | 2.94→2.91 (0.99x) | 32/108 | 0.525/0.629 | 9.24/2.98 | 7/9 | 0.988/1 | 0.012/0 | 30.4/45.4 | ok |
| acg | 99 | 16/54 | 3.81→3.96 (1.04x) | 2.94→2.94 (1x) | 32/108 | 0.538/0.642 | 4.61/5.06 | 7/9 | 1/1 | 0/0 | 29.4/46.3 | ok |
| acg | 12345 | 16/38 | 5.13→3.5 (0.68x) | 2.88→2.95 (1.02x) | 32/76 | 0.492/0.605 | 7.42/13.45 | 6/9 | 1/1 | 0/0 | 30.1/46.3 | ok |
| pop | 0 | 17/54 | 7.53→9.93 (1.32x) | 1→1.96 (1.96x) | 34/108 | 0.832/0.908 | 5/6 | 1/2 | 1/0.6 | 0/0.4 | 58.5/68.3 | ok |
| pop | 7 | 16/52 | 7.13→7.31 (1.03x) | 3→2.15 (0.72x) | 32/128 | 0.452/0.647 | 12.5/26 | 1/2 | 0/0.826 | 1/0.174 | 70.1/77.8 | ok |
| pop | 42 | 16/54 | 7.13→6.24 (0.88x) | 2→2.15 (1.07x) | 32/108 | 0.477/0.751 | 12/9.5 | 1/2 | 0/1 | 1/0 | 0/74.5 | ok |
| pop | 99 | 16/54 | 16→9.24 (0.58x) | 1.06→1.17 (1.1x) | 32/128 | 0.929/0.84 | 2.5/9 | 1/2 | 1/0.48 | 0/0.52 | 63.9/0 | ok |
| pop | 12345 | 17/54 | 6.65→7.98 (1.2x) | 1.94→2.11 (1.09x) | 34/120 | 0.727/0.811 | 9/9.5 | 1/2 | 0/0.829 | 1/0.171 | 0/76 | ok |
| jazz | 0 | 16/60 | 13.75→9.1 (0.66x) | 3.75→3.6 (0.96x) | 0/0 | 0.655/0.896 | 3.33/6.5 | 1/1 | 0/0 | 1/1 | 0/64 | ok |
| jazz | 7 | 18/60 | 12.89→13.17 (1.02x) | 2.67→3.7 (1.39x) | 0/0 | 0.82/0.961 | 7.25/3.5 | 1/2 | 0/0 | 1/1 | 83.3/64.3 | ok |
| jazz | 42 | 16/60 | 15→11.67 (0.78x) | 3.69→3.7 (1x) | 0/0 | 0.821/0.744 | 4/8 | 1/2 | 0/0 | 1/1 | 83.6/55.8 | ok |
| jazz | 99 | 17/60 | 7.82→18.23 (2.33x) | 3.47→3.6 (1.04x) | 0/0 | 0.713/0.924 | 3.33/4.5 | 1/1 | 0/0 | 1/1 | 65.1/57.6 | ok |
| jazz | 12345 | 17/56 | 14.82→11.45 (0.77x) | 3.59→3.57 (0.99x) | 0/0 | 0.78/0.805 | 7.49/4.68 | 1/1 | 0/0 | 1/1 | 83.2/51.5 | ok |
| lofi | 0 | 16/56 | 9.63→6.75 (0.7x) | 2.63→1.79 (0.68x) | 32/112 | 0.771/0.796 | 4.25/4 | 5/2 | 0.167/0.699 | 0.833/0.301 | 31.4/75.5 | ok |
| lofi | 7 | 16/40 | 7.31→7.13 (0.98x) | 2.56→1.77 (0.69x) | 32/80 | 0.674/0.756 | 6/7.99 | 5/2 | 0.857/0.641 | 0.143/0.359 | 23.3/77.3 | ok |
| lofi | 42 | 16/56 | 7.63→14.14 (1.85x) | 2.63→1.79 (0.68x) | 32/112 | 0.69/0.662 | 5.24/7.56 | 4/1 | 0.8/0 | 0.2/1 | 23.7/41.6 | ok |
| lofi | 99 | 16/40 | 11.63→3.77 (0.32x) | 2.63→1.77 (0.67x) | 32/80 | 0.593/0.879 | 6/4 | 4/1 | 0/0 | 1/1 | 36.2/0 | ok |
| lofi | 12345 | 16/40 | 7.5→12.3 (1.64x) | 2.63→1.73 (0.66x) | 32/80 | 0.644/0.794 | 8.01/4 | 5/2 | 0.847/0.564 | 0.153/0.436 | 22.4/40.7 | ok |
| rnb | 0 | 19/56 | 7.95→10.77 (1.35x) | 1.58→2.71 (1.72x) | 38/112 | 0.842/0.848 | 4/11.97 | 1/2 | 0.752/0.699 | 0.248/0.301 | 41.3/75.2 | ok |
| rnb | 7 | 16/56 | 8.13→7.32 (0.9x) | 3.5→2.77 (0.79x) | 32/112 | 0.44/0.825 | 8/4 | 1/2 | 0.802/0.957 | 0.198/0.043 | 53.2/67.7 | ok |
| rnb | 42 | 18/56 | 18.06→7.2 (0.4x) | 3.67→2.7 (0.74x) | 36/112 | 0.611/0.892 | 4.17/5.53 | 1/2 | 0/0.645 | 1/0.355 | 73.8/65.8 | ok |
| rnb | 99 | 16/56 | 7.88→7.29 (0.93x) | 2.19→2.64 (1.21x) | 32/112 | 0.806/0.854 | 3.98/4.01 | 1/2 | 0/0.667 | 1/0.333 | 45.9/54.5 | ok |
| rnb | 12345 | 17/56 | 7.53→8.77 (1.16x) | 3.59→2.64 (0.74x) | 34/112 | 0.657/0.838 | 4/4.99 | 1/2 | 0.779/0.467 | 0.221/0.533 | 53.1/69.2 | ok |

## ACG texturePerBar(MG 逐 bar 织体 vs SIM textureSchedule 用到的 case 集)
- seed 0: MG(6) = [Piano_TopVoice_Planing, ACG_Stride_Cantabile_Ballad, ACG_Pedal_Wash_Color_Drops, ACG_Open_Broken_10th, ACG_Anthem_Block_Push, ACG_Ostinato_Hook_Pulse] · SIM(10) = [Piano_TopVoice_Planing, ACG_Ostinato_Hook_Pulse, ACG_Sakamoto_LH_Arp_RH_Penta, ACG_Open_Broken_10th, ACG_Quartal_Arp_Wave, ACG_Stride_Cantabile_Ballad, ACG_Pedal_Wash_Color_Drops, ACG_Suspended_Block_Arrival, ACG_Anthem_Block_Push, ACG_Bass_Tremolo_Color]
- seed 7: MG(6) = [ACG_Ostinato_Hook_Pulse, ACG_Pedal_Wash_Color_Drops, ACG_Quartal_Arp_Wave, ACG_Suspended_Block_Arrival, ACG_Bass_Tremolo_Color, ACG_Anthem_Block_Push] · SIM(9) = [Piano_TopVoice_Planing, ACG_Pedal_Wash_Color_Drops, ACG_Sakamoto_LH_Arp_RH_Penta, ACG_Ostinato_Hook_Pulse, ACG_Quartal_Arp_Wave, ACG_Open_Broken_10th, ACG_Anthem_Block_Push, ACG_Suspended_Block_Arrival, ACG_Bass_Tremolo_Color]
- seed 42: MG(7) = [ACG_Ostinato_Hook_Pulse, ACG_Pedal_Wash_Color_Drops, ACG_Suspended_Block_Arrival, ACG_Quartal_Arp_Wave, ACG_Open_Broken_10th, ACG_Bass_Tremolo_Color, ACG_Anthem_Block_Push] · SIM(9) = [ACG_Pedal_Wash_Color_Drops, Piano_TopVoice_Planing, ACG_Ostinato_Hook_Pulse, ACG_Quartal_Arp_Wave, ACG_Open_Broken_10th, ACG_Stride_Cantabile_Ballad, ACG_Anthem_Block_Push, ACG_Bass_Tremolo_Color, ACG_Suspended_Block_Arrival]
- seed 99: MG(7) = [Piano_TopVoice_Planing, ACG_Pedal_Wash_Color_Drops, ACG_Stride_Cantabile_Ballad, ACG_Ostinato_Hook_Pulse, ACG_Open_Broken_10th, ACG_Quartal_Arp_Wave, ACG_Suspended_Block_Arrival] · SIM(9) = [Piano_TopVoice_Planing, ACG_Pedal_Wash_Color_Drops, ACG_Ostinato_Hook_Pulse, ACG_Stride_Cantabile_Ballad, ACG_Open_Broken_10th, ACG_Quartal_Arp_Wave, ACG_Anthem_Block_Push, ACG_Bass_Tremolo_Color, ACG_Suspended_Block_Arrival]
- seed 12345: MG(6) = [ACG_Ostinato_Hook_Pulse, ACG_Pedal_Wash_Color_Drops, ACG_Quartal_Arp_Wave, ACG_Anthem_Block_Push, ACG_Suspended_Block_Arrival, ACG_Bass_Tremolo_Color] · SIM(9) = [ACG_Pedal_Wash_Color_Drops, Piano_TopVoice_Planing, ACG_Ostinato_Hook_Pulse, ACG_Open_Broken_10th, ACG_Quartal_Arp_Wave, ACG_Suspended_Block_Arrival, ACG_Anthem_Block_Push, ACG_Bass_Tremolo_Color, ACG_Sakamoto_LH_Arp_RH_Penta]

## 汇总:25 例,0 例有 warning/error。