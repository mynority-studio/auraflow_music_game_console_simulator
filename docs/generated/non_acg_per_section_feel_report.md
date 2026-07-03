# T1 POP/JAZZ/LOFI/RNB 逐段 MG feel 审计

- MG: `../melodygenerative` @ 24dfd6f (dirty) · SIM: `154a019` (dirty)
- 方法:和 ACG 一样,用 MG 16-bar reference 拆 4-bar phrase 作为标尺,再审 SIM 主链完整成曲的每个 section。
- 范围:只判 bass / comp / lead。pad / drum 只记录为 SIM 产品层,不计入 MG 保真缺口。
- 关键读法:section flags 不是 byte parity,而是听感形态偏离:密度、连接感、音域、块状/滚奏、织体覆盖。

## POP

### seed 0
- roles/programs: bass:33 · comp:1 · drum:0 · lead:66
- MG 标尺: comp 8/bar · bass 1.06/bar · lead cov 0.832/maxGap 5/reg 72 · comp single/block/offVel 1/0/58.5
- MG 4-bar 范围: comp 8–8/bar · bass 1–1.25/bar · lead cov 0.563–0.984 · gap 0.25–5 · block 0–0
- texture: MG 1: Pop_Alberti_Lyrical · SIM 2: Pop_Anthem_Pulse, Pop_Half_Arp_Sweep

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 2 | 12 | 1 | 0.5/0.5/57.1 | 0.943/0.5/67 | ok |
| verse(story) | 12 | 12 | 2 | 0.5/0.5/65.2 | 0.953/2/67 | ⚠ bass 过密 2 vs MG 1.06 |
| verse(story) | 12 | 12 | 2 | 0.5/0.5/65 | 0.868/6/67 | ⚠ bass 过密 2 vs MG 1.06 |
| chorus(hook) | 12 | 7.33 | 2 | 0.8/0.2/78.9 | 0.956/1.5/67 | ⚠ bass 过密 2 vs MG 1.06 |
| chorus(hook) | 12 | 7.33 | 2 | 0.8/0.2/78.8 | 0.956/1.5/67 | ⚠ bass 过密 2 vs MG 1.06 |
| outro(outro) | 4 | 12 | 2 | 0.5/0.5/61.2 | 0.571/4/66 | ⚠ bass 过密 2 vs MG 1.06 |

### seed 7
- roles/programs: bass:34 · comp:5 · pad:89 · lead:1
- MG 标尺: comp 7.13/bar · bass 3/bar · lead cov 0.452/maxGap 12.5/reg 68 · comp single/block/offVel 0/1/70.1
- MG 4-bar 范围: comp 7–7.5/bar · bass 3–3/bar · lead cov 0.281–0.717 · gap 2–10.5 · block 1–1
- texture: MG 1: Pop_Ballad_158_Sweep · SIM 3: Pop_Wave_16ths, Pop_Broken_8ths_Sync, —

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| verse(story) | 16 | 11.13 | 2 | 0.533/0.467/74.2 | 0.378/26/72 | ⚠ lead 断裂 gap 26 > MG phrase max 10.5 |
| chorus(hook) | 16 | 6.31 | 2 | 1/0/81.2 | 0.773/8.5/68 | ⚠ comp 过度滚开 block 0 vs MG 1–1 |
| chorus(hook) | 16 | 6.31 | 2 | 1/0/81.3 | 0.773/8.5/68 | ⚠ comp 过度滚开 block 0 vs MG 1–1 |
| outro(outro) | 4 | 0 | 4 | 0/0/0 | 0.718/4/70 | ⚠ comp 过稀 0 vs MG 7.13; comp 过度滚开 block 0 vs MG 1–1 |

### seed 42
- roles/programs: bass:33 · comp:1 · pad:98 · drum:0 · lead:66
- MG 标尺: comp 7.13/bar · bass 2/bar · lead cov 0.477/maxGap 12/reg 68 · comp single/block/offVel 0/1/0
- MG 4-bar 范围: comp 7–7.5/bar · bass 2–2/bar · lead cov 0.188–0.656 · gap 5.5–13 · block 1–1
- texture: MG 1: HalfTime_Emotional_Pulse · SIM 3: Pop_Alberti_Lyrical, Broken_Chord, —

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 2 | 4.5 | 2 | 1/0/63.3 | 0.88/1/68 | ⚠ comp 过度滚开 block 0 vs MG 1–1 |
| verse(story) | 12 | 8 | 2 | 1/0/69.3 | 0.866/7.5/66 | ⚠ comp 过度滚开 block 0 vs MG 1–1 |
| verse(story) | 12 | 8 | 2 | 1/0/69.5 | 0.78/7.5/66 | ⚠ comp 过度滚开 block 0 vs MG 1–1 |
| chorus(hook) | 12 | 5.67 | 2 | 1/0/82.3 | 0.663/9.5/66 | ⚠ comp 过度滚开 block 0 vs MG 1–1 |
| chorus(hook) | 12 | 5.67 | 2 | 1/0/82 | 0.663/9.5/66 | ⚠ comp 过度滚开 block 0 vs MG 1–1 |
| outro(outro) | 4 | 0 | 4 | 0/0/0 | 0.537/4/69 | ⚠ comp 过稀 0 vs MG 7.13; bass 过密 4 vs MG 2; comp 过度滚开 block 0 vs MG 1–1 |

### seed 99
- roles/programs: bass:34 · comp:4 · drum:25 · lead:4
- MG 标尺: comp 16/bar · bass 1.06/bar · lead cov 0.929/maxGap 2.5/reg 68 · comp single/block/offVel 1/0/63.9
- MG 4-bar 范围: comp 16–16/bar · bass 1–1.25/bar · lead cov 0.844–1 · gap 0–2.5 · block 0–0
- texture: MG 1: Arpeggio_Flow · SIM 2: Lyrical_Felt_Piano_Sparse, Piano_Wide_Color_Motion

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 2 | 9 | 0.5 | 0/1/0 | 0.938/0.5/70 | ⚠ bass 过稀 0.5 vs MG 1.06; comp 块状偏多 block 1 vs MG 0–0 |
| verse(story) | 12 | 10.33 | 1 | 0/1/0 | 0.927/2/67 | ⚠ comp 块状偏多 block 1 vs MG 0–0 |
| verse(story) | 12 | 10.42 | 1 | 0/1/0 | 0.927/2/68 | ⚠ comp 块状偏多 block 1 vs MG 0–0 |
| chorus(hook) | 12 | 8.08 | 1.42 | 0.724/0.276/0 | 0.729/9/68 | ⚠ lead 断裂 gap 9 > MG phrase max 2.5 |
| chorus(hook) | 12 | 8.08 | 1.42 | 0.787/0.212/0 | 0.729/9/68 | ⚠ lead 断裂 gap 9 > MG phrase max 2.5 |
| outro(outro) | 4 | 9.5 | 1 | 0/1/0 | 0.937/1/74 | ⚠ comp 块状偏多 block 1 vs MG 0–0 |

### seed 12345
- roles/programs: bass:33 · comp:4 · pad:98 · drum:25 · lead:1
- MG 标尺: comp 7.06/bar · bass 2.06/bar · lead cov 0.727/maxGap 9/reg 70 · comp single/block/offVel 0/1/0
- MG 4-bar 范围: comp 6.5–7.5/bar · bass 2–2.25/bar · lead cov 0.344–1 · gap 0–8.5 · block 1–1
- texture: MG 1: HalfTime_Emotional_Pulse · SIM 3: Pop_Alberti_Lyrical, Pop_Broken_8ths_Sync, —

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 2 | 8 | 1 | 1/0/65 | 0.5/4/71 | ⚠ bass 过稀 1 vs MG 2.06; comp 过度滚开 block 0 vs MG 1–1 |
| verse(story) | 16 | 8 | 2 | 1/0/69.9 | 0.867/8.5/68 | ⚠ comp 过度滚开 block 0 vs MG 1–1 |
| verse(story) | 16 | 8 | 2 | 1/0/69.5 | 0.82/8.5/68 | ⚠ comp 过度滚开 block 0 vs MG 1–1 |
| chorus(hook) | 16 | 9.94 | 2 | 0.344/0.656/84.5 | 0.691/9.5/69 | ok |
| outro(outro) | 4 | 0 | 4 | 0/0/0 | 0.937/0.5/68 | ⚠ comp 过稀 0 vs MG 7.06; bass 过密 4 vs MG 2.06; comp 过度滚开 block 0 vs MG 1–1 |

## JAZZ

### seed 0
- roles/programs: bass:32 · comp:0 · lead:4
- MG 标尺: comp 13.75/bar · bass 3.75/bar · lead cov 0.654/maxGap 3.33/reg 70 · comp single/block/offVel 0/1/0
- MG 4-bar 范围: comp 13–14/bar · bass 3.5–4/bar · lead cov 0.448–0.789 · gap 0.58–4 · block 1–1
- texture: MG 1: Jazz_Red_Garland_Block · SIM 1: Jazz_Drop_2_Comp

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 4 | 9.75 | 0.5 | 0/1/53.7 | 0.981/0.29/66 | ⚠ bass 过稀 0.5 vs MG 3.75; lead 太满 cov 0.981 > MG phrase max 0.789 |
| verse(head) | 12 | 9 | 4 | 0/1/64.6 | 0.863/6.5/75 | ⚠ lead 断裂 gap 6.5 > MG phrase max 4 |
| verse(head) | 12 | 9 | 4 | 0/1/65 | 0.864/6.5/75 | ⚠ lead 断裂 gap 6.5 > MG phrase max 4 |
| bridge(solo) | 16 | 9 | 4 | 0/1/67.4 | 0.92/3.46/74 | ok |
| chorus(headOut) | 12 | 9 | 4 | 0/1/64.3 | 0.863/6.5/75 | ⚠ lead 断裂 gap 6.5 > MG phrase max 4 |
| outro(tag) | 4 | 9.75 | 1.5 | 0/1/58.3 | 0.746/4.01/74 | ⚠ bass 过稀 1.5 vs MG 3.75 |

### seed 7
- roles/programs: bass:32 · comp:4 · lead:66
- MG 标尺: comp 14.5/bar · bass 3/bar · lead cov 0.82/maxGap 7.25/reg 70 · comp single/block/offVel 0/1/83.3
- MG 4-bar 范围: comp 14–15/bar · bass 2.25–4/bar · lead cov 0.744–0.997 · gap 0.01–4 · block 1–1
- texture: MG 1: Bossa_Piano_Arp · SIM 2: Jazz_Red_Garland_Block, Jazz_Drop_2_Comp

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 4 | 11.75 | 2 | 0/1/0 | 1.058/0.01/66 | ⚠ lead 太满 cov 1.058 > MG phrase max 0.997 |
| verse(head) | 12 | 12.5 | 4 | 0/1/64.6 | 0.949/3.5/66 | ok |
| verse(head) | 12 | 12.5 | 4 | 0/1/64.2 | 0.95/3.5/66 | ok |
| bridge(solo) | 16 | 15.38 | 4 | 0/1/0 | 0.969/1.98/67 | ok |
| chorus(headOut) | 12 | 12.5 | 4 | 0/1/64.1 | 0.95/3.5/66 | ok |
| outro(tag) | 4 | 11.75 | 1.5 | 0/1/0 | 0.924/0.94/67 | ok |

### seed 42
- roles/programs: bass:32 · comp:0 · drum:40 · lead:0
- MG 标尺: comp 15/bar · bass 3.69/bar · lead cov 0.82/maxGap 4/reg 68 · comp single/block/offVel 0/1/83.6
- MG 4-bar 范围: comp 15–15/bar · bass 3.25–4/bar · lead cov 0.622–0.994 · gap 0.02–4 · block 1–1
- texture: MG 1: Bossa_Piano_Arp · SIM 2: Jazz_Charleston_Comp, Jazz_Red_Garland_Block

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 4 | 9.75 | 2 | 0/1/50.1 | 0.907/1/71 | ok |
| verse(head) | 12 | 10.42 | 4 | 0/1/56.5 | 0.651/8/67 | ⚠ lead 断裂 gap 8 > MG phrase max 4 |
| verse(head) | 12 | 10.42 | 4 | 0/1/56.5 | 0.651/7.99/67 | ⚠ lead 断裂 gap 7.99 > MG phrase max 4 |
| bridge(solo) | 16 | 15.44 | 4 | 0/1/0 | 0.767/4.67/67 | ok |
| chorus(headOut) | 12 | 10.42 | 4 | 0/1/56.6 | 0.65/7.98/67 | ⚠ lead 断裂 gap 7.98 > MG phrase max 4 |
| outro(tag) | 4 | 9.75 | 1.5 | 0/1/55.2 | 0.533/4/66 | ⚠ bass 过稀 1.5 vs MG 3.69 |

### seed 99
- roles/programs: bass:32 · comp:4 · drum:40 · lead:66
- MG 标尺: comp 8.31/bar · bass 3.69/bar · lead cov 0.713/maxGap 3.33/reg 69 · comp single/block/offVel 0/1/65.1
- MG 4-bar 范围: comp 8.25–8.5/bar · bass 3.25–4/bar · lead cov 0.681–0.747 · gap 0.75–3.33 · block 1–1
- texture: MG 1: Jazz_Drop_2_Comp · SIM 1: Bossa_Piano_Arp

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 4 | 15 | 0.5 | 0/1/54 | 1.047/0.01/67 | ⚠ comp 过密 15 vs MG 8.31; bass 过稀 0.5 vs MG 3.69; lead 太满 cov 1.047 > MG phrase max 0.747 |
| verse(head) | 12 | 18.67 | 4 | 0/1/57.3 | 0.904/4/67 | ⚠ comp 过密 18.67 vs MG 8.31 |
| verse(head) | 12 | 18.67 | 4 | 0/1/57.2 | 0.905/4/67 | ⚠ comp 过密 18.67 vs MG 8.31 |
| bridge(solo) | 16 | 18.69 | 4 | 0/1/58.7 | 0.946/4.51/66 | ⚠ comp 过密 18.69 vs MG 8.31 |
| chorus(headOut) | 12 | 18.67 | 4 | 0/1/57.2 | 0.905/3.99/67 | ⚠ comp 过密 18.67 vs MG 8.31 |
| outro(tag) | 4 | 15.75 | 1.5 | 0/1/59 | 0.887/2/68 | ⚠ comp 过密 15.75 vs MG 8.31; bass 过稀 1.5 vs MG 3.69 |

### seed 12345
- roles/programs: bass:32 · comp:0 · drum:40 · lead:0
- MG 标尺: comp 14.82/bar · bass 3.59/bar · lead cov 0.734/maxGap 7.49/reg 68 · comp single/block/offVel 0/1/83.2
- MG 4-bar 范围: comp 0–16/bar · bass 0–4/bar · lead cov 0–0.963 · gap 0.51–4 · block 0–1
- texture: MG 1: Bossa_Piano_Arp · SIM 1: Jazz_Charleston_Comp

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 4 | 9.75 | 0.5 | 0/1/49.4 | 0.537/4/77 | ⚠ bass 过稀 0.5 vs MG 3.59; lead 音域偏移 77 vs MG 68 |
| verse(head) | 16 | 11.75 | 4 | 0/1/51.6 | 0.832/1.77/68 | ok |
| verse(head) | 16 | 11.75 | 4 | 0/1/51.3 | 0.832/1.76/68 | ok |
| chorus(headOut) | 16 | 11.75 | 4 | 0/1/51.5 | 0.832/1.77/68 | ok |
| outro(tag) | 4 | 9.5 | 1.5 | 0/1/53.9 | 0.75/1.57/66 | ⚠ bass 过稀 1.5 vs MG 3.59 |

## LOFI

### seed 0
- roles/programs: bass:33 · comp:7 · lead:4
- MG 标尺: comp 9.63/bar · bass 2.63/bar · lead cov 0.77/maxGap 4.25/reg 70 · comp single/block/offVel 0.167/0.833/31.4
- MG 4-bar 范围: comp 7.5–11.5/bar · bass 2–3/bar · lead cov 0.566–0.897 · gap 1.02–4.25 · block 0.429–1
- texture: MG 5: Piano_CommonTone_Soft_Roll, Piano_Lofi_Tape_Wobble_Arp, Piano_Lofi_Late_Chord_Answer, Piano_HalfTime_Soft_Pulse, Piano_Lofi_Dusty_Chops · SIM 2: Piano_Lofi_OneShot_Space, Piano_CommonTone_Soft_Roll · ⚠ LOFI 织体多样性不足 SIM 2 < 50% MG 5

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 4 | 2.5 | 0.25 | 0/1/0 | 0.746/4/64 | ⚠ comp 过稀 2.5 vs MG 9.63; bass 过稀 0.25 vs MG 2.63 |
| verse(loop) | 16 | 7.38 | 2 | 0.747/0.253/75 | 0.804/3.98/72 | ok |
| verse(loop) | 16 | 7.38 | 2 | 0.763/0.237/0 | 0.804/3.99/72 | ok |
| verse(loop) | 16 | 7.38 | 2 | 0.657/0.343/76 | 0.803/3.98/72 | ok |
| outro(outro) | 4 | 3.5 | 0.75 | 0/1/0 | 0.75/3.98/66 | ⚠ comp 过稀 3.5 vs MG 9.63; bass 过稀 0.75 vs MG 2.63 |

### seed 7
- roles/programs: bass:39 · comp:4 · drum:25 · lead:4
- MG 标尺: comp 7.31/bar · bass 2.56/bar · lead cov 0.674/maxGap 6/reg 65 · comp single/block/offVel 0.857/0.143/23.3
- MG 4-bar 范围: comp 6.75–8/bar · bass 2–3.25/bar · lead cov 0.557–0.742 · gap 3.73–6 · block 0.077–0.385
- texture: MG 5: Piano_Lofi_OneShot_Space, Piano_Lofi_Tape_Wobble_Arp, Piano_HalfTime_Soft_Pulse, Piano_Ambient_Sustain_Wash, Piano_Emo_Broken_10th · SIM 2: Piano_Lofi_OneShot_Space, Piano_Wide_Color_Motion · ⚠ LOFI 织体多样性不足 SIM 2 < 50% MG 5

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 4 | 4.25 | 1 | 0/1/0 | 0.75/4/64 | ⚠ bass 过稀 1 vs MG 2.56 |
| verse(loop) | 16 | 7.94 | 2 | 0.676/0.324/78.3 | 0.742/7.99/65 | ok |
| verse(loop) | 16 | 7.94 | 2 | 0.676/0.324/74 | 0.743/7.98/65 | ok |
| outro(outro) | 4 | 3.5 | 0.75 | 0/1/0 | 0.87/2/81 | ⚠ bass 过稀 0.75 vs MG 2.56; lead 音域偏移 81 vs MG 65 |

### seed 42
- roles/programs: bass:33 · comp:7 · pad:49 · drum:25 · lead:4
- MG 标尺: comp 7.63/bar · bass 2.63/bar · lead cov 0.69/maxGap 5.24/reg 67 · comp single/block/offVel 0.8/0.2/23.7
- MG 4-bar 范围: comp 7.5–8/bar · bass 2–3/bar · lead cov 0.514–0.867 · gap 0.99–5.24 · block 0.077–0.429
- texture: MG 4: Piano_Emo_Broken_10th, Piano_Ambient_Sustain_Wash, Piano_HalfTime_Soft_Pulse, Piano_Lofi_Tape_Wobble_Arp · SIM 2: Piano_Lofi_Dusty_Chops, —

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 4 | 12 | 1 | 0/1/49.4 | 0.687/4/63 | ⚠ bass 过稀 1 vs MG 2.63 |
| verse(loop) | 16 | 15.5 | 1.88 | 0/1/41 | 0.645/7.56/67 | ⚠ comp 过密 15.5 vs MG 7.63 |
| verse(loop) | 16 | 15.5 | 1.88 | 0/1/41.1 | 0.646/7.54/67 | ⚠ comp 过密 15.5 vs MG 7.63 |
| verse(loop) | 16 | 15.5 | 1.88 | 0/1/41.1 | 0.646/7.55/67 | ⚠ comp 过密 15.5 vs MG 7.63 |
| outro(outro) | 4 | 0 | 1.5 | 0/0/0 | 0.832/1.54/65 | ⚠ comp 过稀 0 vs MG 7.63 |

### seed 99
- roles/programs: bass:39 · comp:5 · pad:98 · lead:4
- MG 标尺: comp 11.63/bar · bass 2.63/bar · lead cov 0.592/maxGap 6/reg 76 · comp single/block/offVel 0/1/36.2
- MG 4-bar 范围: comp 10–13.5/bar · bass 2–3/bar · lead cov 0.371–0.745 · gap 2.72–6 · block 1–1
- texture: MG 4: Piano_Lofi_Dusty_Chops, Piano_HalfTime_Soft_Pulse, Piano_Lofi_Late_Chord_Answer, Piano_CommonTone_Soft_Roll · SIM 2: Piano_Lofi_OneShot_Space, —

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 4 | 3.75 | 0.25 | 0/1/0 | 0.624/4/67 | ⚠ comp 过稀 3.75 vs MG 11.63; bass 过稀 0.25 vs MG 2.63; lead 音域偏移 67 vs MG 76 |
| verse(loop) | 16 | 4.25 | 2 | 0/1/0 | 0.905/4/66 | ⚠ comp 过稀 4.25 vs MG 11.63; lead 音域偏移 66 vs MG 76 |
| verse(loop) | 16 | 4.25 | 2 | 0/1/0 | 0.905/4/66 | ⚠ comp 过稀 4.25 vs MG 11.63; lead 音域偏移 66 vs MG 76 |
| outro(outro) | 4 | 0 | 1.5 | 0/0/0 | 0.928/0.55/65 | ⚠ comp 过稀 0 vs MG 11.63; lead 音域偏移 65 vs MG 76; comp 过度滚开 block 0 vs MG 1–1 |

### seed 12345
- roles/programs: bass:33 · comp:5 · pad:49 · drum:25 · lead:4
- MG 标尺: comp 7.06/bar · bass 2.47/bar · lead cov 0.606/maxGap 8.01/reg 78 · comp single/block/offVel 0.847/0.153/22.4
- MG 4-bar 范围: comp 0–8/bar · bass 0–3/bar · lead cov 0–0.829 · gap 2–6 · block 0–0.429
- texture: MG 5: Piano_Lofi_Tape_Wobble_Arp, Piano_HalfTime_Soft_Pulse, Piano_Lofi_OneShot_Space, Piano_Ambient_Sustain_Wash, Piano_Emo_Broken_10th · SIM 3: Piano_Lofi_Dusty_Chops, Piano_CommonTone_Soft_Roll, —

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 4 | 16 | 0.25 | 0/1/40.2 | 0.75/4/65 | ⚠ comp 过密 16 vs MG 7.06; bass 过稀 0.25 vs MG 2.47; lead 音域偏移 65 vs MG 78 |
| verse(loop) | 16 | 13.38 | 1.94 | 0.632/0.368/41.2 | 0.801/4/68 | ⚠ comp 过密 13.38 vs MG 7.06; lead 音域偏移 68 vs MG 78 |
| verse(loop) | 16 | 13.38 | 1.94 | 0.587/0.413/40.3 | 0.801/4/68 | ⚠ comp 过密 13.38 vs MG 7.06; lead 音域偏移 68 vs MG 78 |
| outro(outro) | 4 | 0 | 1.5 | 0/0/0 | 0.777/3.54/71 | ⚠ comp 过稀 0 vs MG 7.06 |

## RNB

### seed 0
- roles/programs: bass:39 · comp:5 · lead:66
- MG 标尺: comp 9.44/bar · bass 1.88/bar · lead cov 0.842/maxGap 4/reg 71 · comp single/block/offVel 0.752/0.248/41.3
- MG 4-bar 范围: comp 8.75–10/bar · bass 1.75–2/bar · lead cov 0.739–0.953 · gap 0.52–4 · block 0.219–0.276
- texture: MG 1: RnB_Drop2_Color_Answer · SIM 2: RnB_Drop2_Color_Answer, RnB_Laid_Back_Groove

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 4 | 8 | 0.5 | 0.667/0.333/52.5 | 1.046/0.04/66 | ⚠ bass 过稀 0.5 vs MG 1.88; lead 太满 cov 1.046 > MG phrase max 0.953 |
| verse(story) | 12 | 10.58 | 3 | 0.62/0.38/62.5 | 0.911/1.98/67 | ok |
| verse(story) | 12 | 10.5 | 3 | 0.615/0.385/62.1 | 0.764/7.97/67 | ⚠ lead 断裂 gap 7.97 > MG phrase max 4 |
| chorus(hook) | 12 | 11.83 | 3 | 0.798/0.202/85.2 | 0.786/4/65 | ok |
| chorus(hook) | 12 | 11.83 | 3 | 0.752/0.248/85.5 | 0.785/4/65 | ok |
| outro(outro) | 4 | 8.5 | 1.5 | 0.64/0.36/31.6 | 1.072/0.03/65 | ⚠ lead 太满 cov 1.072 > MG phrase max 0.953 |

### seed 7
- roles/programs: bass:34 · comp:5 · pad:89 · lead:4
- MG 标尺: comp 8.13/bar · bass 3.5/bar · lead cov 0.439/maxGap 8/reg 77 · comp single/block/offVel 0.802/0.198/53.2
- MG 4-bar 范围: comp 8–8.5/bar · bass 3.5–3.5/bar · lead cov 0.375–0.541 · gap 1.51–7.99 · block 0.19–0.2
- texture: MG 1: RnB_Classic_Soul_Arp · SIM 3: RnB_Neo_Soul_Roll, RnB_Gospel_Triplets, —

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 4 | 8 | 2 | 0.968/0.032/0 | 0.998/0.02/72 | ⚠ lead 太满 cov 0.998 > MG phrase max 0.541 |
| verse(story) | 16 | 9.88 | 3 | 0.961/0.039/67.7 | 0.807/3.99/67 | ⚠ lead 太满 cov 0.807 > MG phrase max 0.541; lead 音域偏移 67 vs MG 77 |
| chorus(hook) | 16 | 6.88 | 3 | 0.952/0.048/0 | 0.817/4/70 | ⚠ lead 太满 cov 0.817 > MG phrase max 0.541 |
| chorus(hook) | 16 | 6.88 | 3 | 0.952/0.048/0 | 0.817/4/70 | ⚠ lead 太满 cov 0.817 > MG phrase max 0.541 |
| outro(outro) | 4 | 0 | 0.75 | 0/0/0 | 0.791/1.68/64 | ⚠ comp 过稀 0 vs MG 8.13; bass 过稀 0.75 vs MG 3.5; lead 太满 cov 0.791 > MG phrase max 0.541; lead 音域偏移 64 vs MG 77 |

### seed 42
- roles/programs: bass:39 · comp:5 · pad:98 · drum:25 · lead:66
- MG 标尺: comp 20.31/bar · bass 4.13/bar · lead cov 0.611/maxGap 4.17/reg 69 · comp single/block/offVel 0/1/73.8
- MG 4-bar 范围: comp 20–21.25/bar · bass 4–4.5/bar · lead cov 0.499–0.733 · gap 0.75–4.17 · block 1–1
- texture: MG 1: RnB_16th_Funk_Stabs · SIM 3: Pop_Rnb_Expensive_Add9_Quartal, RnB_Neo_Soul_Roll, —

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 4 | 3.5 | 1 | 0.6/0.4/59 | 1.032/0.04/67 | ⚠ comp 过稀 3.5 vs MG 20.31; bass 过稀 1 vs MG 4.13; lead 太满 cov 1.032 > MG phrase max 0.733 |
| verse(story) | 12 | 9.58 | 3 | 0.056/0.944/65.8 | 0.861/5.52/68 | ok |
| verse(story) | 12 | 9.33 | 3 | 0.028/0.972/67.5 | 0.754/5.53/68 | ok |
| chorus(hook) | 12 | 6.75 | 3 | 0.934/0.066/0 | 0.929/3.97/65 | ⚠ comp 过稀 6.75 vs MG 20.31; comp 过度滚开 block 0.066 vs MG 1–1 |
| chorus(hook) | 12 | 6.75 | 3 | 0.934/0.066/0 | 0.929/3.99/65 | ⚠ comp 过稀 6.75 vs MG 20.31; comp 过度滚开 block 0.066 vs MG 1–1 |
| outro(outro) | 4 | 0 | 0.75 | 0/0/0 | 1.029/0.03/66 | ⚠ comp 过稀 0 vs MG 20.31; bass 过稀 0.75 vs MG 4.13; lead 太满 cov 1.029 > MG phrase max 0.733; comp 过度滚开 block 0 vs MG 1–1 |

### seed 99
- roles/programs: bass:34 · comp:4 · drum:25 · lead:5
- MG 标尺: comp 7.88/bar · bass 2.19/bar · lead cov 0.806/maxGap 4.01/reg 72 · comp single/block/offVel 0/1/45.9
- MG 4-bar 范围: comp 7.5–8/bar · bass 2–2.25/bar · lead cov 0.737–0.83 · gap 2.48–4.01 · block 1–1
- texture: MG 1: Pop_Rnb_Expensive_Add9_Quartal · SIM 2: RnB_InnerTight_Wide_Color, Pop_Rnb_Expensive_Add9_Quartal

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 4 | 7 | 0.25 | 0.833/0.167/51 | 0.996/0.04/72 | ⚠ bass 过稀 0.25 vs MG 2.19; lead 太满 cov 0.996 > MG phrase max 0.83; comp 过度滚开 block 0.167 vs MG 1–1 |
| verse(story) | 12 | 6.75 | 3 | 0.875/0.125/59 | 0.822/3.99/71 | ⚠ comp 过度滚开 block 0.125 vs MG 1–1 |
| verse(story) | 12 | 6.75 | 3 | 0.875/0.125/59.4 | 0.74/3.99/73 | ⚠ comp 过度滚开 block 0.125 vs MG 1–1 |
| chorus(hook) | 12 | 7.92 | 3 | 0.139/0.861/0 | 0.904/4/69 | ok |
| chorus(hook) | 12 | 7.92 | 3 | 0.139/0.861/0 | 0.903/4.01/69 | ok |
| outro(outro) | 4 | 7 | 0.75 | 0.833/0.167/29.8 | 0.846/1.98/78 | ⚠ bass 过稀 0.75 vs MG 2.19; comp 过度滚开 block 0.167 vs MG 1–1 |

### seed 12345
- roles/programs: bass:39 · comp:4 · pad:98 · drum:25 · lead:4
- MG 标尺: comp 8/bar · bass 3.81/bar · lead cov 0.657/maxGap 4/reg 70 · comp single/block/offVel 0.779/0.221/53.1
- MG 4-bar 范围: comp 8–8/bar · bass 3.5–4/bar · lead cov 0.576–0.758 · gap 0.5–2.49 · block 0.2–0.294
- texture: MG 1: RnB_Classic_Soul_Arp · SIM 3: Pop_Rnb_Expensive_Add9_Quartal, RnB_Quartal_Breath_Roll, —

| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |
|---|---:|---:|---:|---|---|---|
| intro(setup) | 4 | 6.5 | 0.25 | 0.167/0.833/59.8 | 0.716/3.99/72 | ⚠ bass 过稀 0.25 vs MG 3.81 |
| verse(story) | 16 | 9.81 | 3 | 0.021/0.979/66.3 | 0.849/4/73 | ok |
| verse(story) | 16 | 9.5 | 3 | 0.021/0.979/66.6 | 0.849/3.99/74 | ok |
| chorus(hook) | 16 | 9.75 | 3 | 0.818/0.182/71.5 | 0.843/4.99/72 | ⚠ lead 断裂 gap 4.99 > MG phrase max 2.49 |
| outro(outro) | 4 | 0 | 0.75 | 0/0/0 | 0.814/2.46/68 | ⚠ comp 过稀 0 vs MG 8; bass 过稀 0.75 vs MG 3.81 |

## 汇总结论

| style | seeds | section flags | texture flags | 判断 |
|---|---:|---:|---:|---|
| POP | 5 | 32 | 0 | 低到中风险:多数可接受,个别 seed 的 lead gap/bass 密度需查 |
| JAZZ | 5 | 23 | 0 | 中风险:bass/comp 段落密度需复核 |
| LOFI | 5 | 30 | 2 | 高风险:织体多样性/稀疏连续性最不像 MG |
| RNB | 5 | 35 | 0 | 高风险:低频与 lead 覆盖形态偏离明显 |

## T1 任务化建议

1. 先修 LOFI:不要裸逐-bar 随机换织体,要移植 MG 的 transition bridge / carry-tail / downbeat-anchor,否则会在稀疏 one-shot 之间产生 comp 洞。
2. 再修 RNB:按 MG 的 bass/comp/lead final-event-form 逐段对齐,重点看 bass 欠密、lead 过满、comp 欠密三类。
3. JAZZ/POP 不急着大搬运,先用本报告中 flagged seed 做定点检查,避免把已经合理的 SIM 成曲层重洗牌。
4. 每次改完必须重跑本脚本和 aggregate fidelity 脚本,不能只跑单元测试;听感保真看的是 final events。