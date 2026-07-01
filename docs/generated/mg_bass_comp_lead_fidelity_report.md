# MG ↔ Simulator bass/comp/lead fidelity report

- MG source: `../melodygenerative` @ 24dfd6f (string seed) · SIM 主链路 generateMusicSync (numeric seed)
- 方法:per-bar 密度比较(非 byte parity);忽略 pad/drum。styles=acg/pop/jazz/lofi/rnb seeds=0/7/42/99/12345 key=C
- 列:count(总)· /bar(per-bar 密度)· SIM/MG per-bar 比率。texUniq=MG texturePerBar 唯一织体数。

| style | seed | bars MG/SIM | comp/bar MG→SIM | bass/bar MG→SIM | pedal MG/SIM | lead cov MG/SIM | lead maxGap MG/SIM | texUniq MG/SIM | ⚠ |
|---|---|---|---|---|---|---|---|---|---|
| acg | 0 | 16/38 | 6.19→7.79 (1.26x) | 2.56→3.68 (1.44x) | 32/76 | 0.523/0.593 | 4.77/3.58 | 6/10 | ok |
| acg | 7 | 16/46 | 4.44→9.59 (2.16x) | 2.88→3.17 (1.1x) | 32/92 | 0.475/0.543 | 10.91/5.3 | 6/9 | ok |
| acg | 42 | 16/54 | 5.38→5.43 (1.01x) | 2.94→2.85 (0.97x) | 32/108 | 0.525/0.589 | 9.24/3.58 | 7/9 | ok |
| acg | 99 | 16/54 | 3.81→4.87 (1.28x) | 2.94→4.43 (1.51x) | 32/108 | 0.538/0.395 | 4.61/10.01 | 7/9 | ok |
| acg | 12345 | 16/38 | 5.13→6.47 (1.26x) | 2.88→3.16 (1.1x) | 32/76 | 0.492/0.464 | 7.42/9.83 | 6/8 | ok |
| pop | 0 | 17/54 | 7.53→9.93 (1.32x) | 1→1.96 (1.96x) | 34/108 | 0.832/0.928 | 5/4 | 1/2 | ok |
| pop | 7 | 16/52 | 7.13→7.31 (1.03x) | 3→2.15 (0.72x) | 32/128 | 0.452/0.818 | 12.5/26 | 1/2 | ok |
| pop | 42 | 16/54 | 7.13→6.24 (0.88x) | 2→2.15 (1.07x) | 32/108 | 0.477/0.868 | 12/9.5 | 1/2 | ok |
| pop | 99 | 16/54 | 16→9.24 (0.58x) | 1.06→1.17 (1.1x) | 32/128 | 0.929/0.981 | 2.5/1.5 | 1/2 | ok |
| pop | 12345 | 17/54 | 6.65→7.98 (1.2x) | 1.94→2.11 (1.09x) | 34/120 | 0.727/0.96 | 9/4 | 1/2 | ok |
| jazz | 0 | 16/60 | 13.75→9.1 (0.66x) | 3.75→1.87 (0.5x) | 0/0 | 0.655/0.945 | 3.33/3.46 | 1/1 | ok |
| jazz | 7 | 18/60 | 12.89→13.22 (1.03x) | 2.67→1.97 (0.74x) | 0/0 | 0.82/0.929 | 7.25/3.5 | 1/2 | ok |
| jazz | 42 | 16/60 | 15→11.6 (0.77x) | 3.69→1.97 (0.53x) | 0/0 | 0.821/0.857 | 4/4.67 | 1/2 | ok |
| jazz | 99 | 17/60 | 7.82→18.13 (2.32x) | 3.47→1.87 (0.54x) | 0/0 | 0.713/0.891 | 3.33/4.49 | 1/1 | ok |
| jazz | 12345 | 17/56 | 14.82→11.45 (0.77x) | 3.59→1.86 (0.52x) | 0/0 | 0.78/0.803 | 7.49/2.67 | 1/1 | ok |
| lofi | 0 | 16/56 | 9.63→6.61 (0.69x) | 2.63→0.93 (0.35x) | 32/112 | 0.771/0.843 | 4.25/4 | 5/2 | ok |
| lofi | 7 | 16/40 | 7.31→7.13 (0.98x) | 2.56→0.97 (0.38x) | 32/80 | 0.674/0.759 | 6/7.99 | 5/2 | ok |
| lofi | 42 | 16/56 | 7.63→15.21 (1.99x) | 2.63→1.04 (0.4x) | 32/112 | 0.69/0.794 | 5.24/4 | 4/1 | ok |
| lofi | 99 | 16/40 | 11.63→3.77 (0.32x) | 2.63→0.97 (0.37x) | 32/80 | 0.593/0.907 | 6/4 | 4/1 | ok |
| lofi | 12345 | 16/40 | 7.5→9.45 (1.26x) | 2.63→0.97 (0.37x) | 32/80 | 0.644/0.903 | 8.01/4 | 5/2 | ok |
| rnb | 0 | 19/56 | 7.95→10.73 (1.35x) | 1.58→1.86 (1.18x) | 38/112 | 0.842/0.925 | 4/7.98 | 1/2 | ok |
| rnb | 7 | 16/56 | 8.13→7.3 (0.9x) | 3.5→1.91 (0.55x) | 32/112 | 0.44/0.831 | 8/4 | 1/2 | ok |
| rnb | 42 | 18/56 | 18.06→7.2 (0.4x) | 3.67→1.41 (0.38x) | 36/112 | 0.611/0.95 | 4.17/7.98 | 1/2 | ok |
| rnb | 99 | 16/56 | 7.88→7.32 (0.93x) | 2.19→0.93 (0.42x) | 32/112 | 0.806/0.899 | 3.98/4.01 | 1/2 | ok |
| rnb | 12345 | 17/56 | 7.53→8.73 (1.16x) | 3.59→1.21 (0.34x) | 34/112 | 0.657/0.872 | 4/4 | 1/2 | ok |

## ACG texturePerBar(MG 逐 bar 织体 vs SIM textureSchedule 用到的 case 集)
- seed 0: MG(6) = [Piano_TopVoice_Planing, ACG_Stride_Cantabile_Ballad, ACG_Pedal_Wash_Color_Drops, ACG_Open_Broken_10th, ACG_Anthem_Block_Push, ACG_Ostinato_Hook_Pulse] · SIM(10) = [Piano_TopVoice_Planing, ACG_Stride_Cantabile_Ballad, ACG_Pedal_Wash_Color_Drops, ACG_Ostinato_Hook_Pulse, ACG_Sakamoto_LH_Arp_RH_Penta, ACG_Quartal_Arp_Wave, ACG_Open_Broken_10th, ACG_Anthem_Block_Push, ACG_Bass_Tremolo_Color, ACG_Suspended_Block_Arrival]
- seed 7: MG(6) = [ACG_Ostinato_Hook_Pulse, ACG_Pedal_Wash_Color_Drops, ACG_Quartal_Arp_Wave, ACG_Suspended_Block_Arrival, ACG_Bass_Tremolo_Color, ACG_Anthem_Block_Push] · SIM(9) = [Piano_TopVoice_Planing, ACG_Pedal_Wash_Color_Drops, ACG_Stride_Cantabile_Ballad, ACG_Sakamoto_LH_Arp_RH_Penta, ACG_Open_Broken_10th, ACG_Suspended_Block_Arrival, ACG_Bass_Tremolo_Color, ACG_Anthem_Block_Push, ACG_Quartal_Arp_Wave]
- seed 42: MG(7) = [ACG_Ostinato_Hook_Pulse, ACG_Pedal_Wash_Color_Drops, ACG_Suspended_Block_Arrival, ACG_Quartal_Arp_Wave, ACG_Open_Broken_10th, ACG_Bass_Tremolo_Color, ACG_Anthem_Block_Push] · SIM(9) = [ACG_Sakamoto_LH_Arp_RH_Penta, ACG_Pedal_Wash_Color_Drops, ACG_Stride_Cantabile_Ballad, ACG_Ostinato_Hook_Pulse, ACG_Open_Broken_10th, ACG_Anthem_Block_Push, ACG_Quartal_Arp_Wave, ACG_Suspended_Block_Arrival, ACG_Bass_Tremolo_Color]
- seed 99: MG(7) = [Piano_TopVoice_Planing, ACG_Pedal_Wash_Color_Drops, ACG_Stride_Cantabile_Ballad, ACG_Ostinato_Hook_Pulse, ACG_Open_Broken_10th, ACG_Quartal_Arp_Wave, ACG_Suspended_Block_Arrival] · SIM(9) = [ACG_Ostinato_Hook_Pulse, ACG_Pedal_Wash_Color_Drops, ACG_Stride_Cantabile_Ballad, ACG_Quartal_Arp_Wave, ACG_Bass_Tremolo_Color, ACG_Sakamoto_LH_Arp_RH_Penta, ACG_Anthem_Block_Push, ACG_Suspended_Block_Arrival, ACG_Open_Broken_10th]
- seed 12345: MG(6) = [ACG_Ostinato_Hook_Pulse, ACG_Pedal_Wash_Color_Drops, ACG_Quartal_Arp_Wave, ACG_Anthem_Block_Push, ACG_Suspended_Block_Arrival, ACG_Bass_Tremolo_Color] · SIM(8) = [ACG_Pedal_Wash_Color_Drops, ACG_Stride_Cantabile_Ballad, ACG_Sakamoto_LH_Arp_RH_Penta, ACG_Anthem_Block_Push, ACG_Suspended_Block_Arrival, ACG_Open_Broken_10th, ACG_Bass_Tremolo_Color, ACG_Quartal_Arp_Wave]

## 汇总:25 例,0 例有 warning/error。