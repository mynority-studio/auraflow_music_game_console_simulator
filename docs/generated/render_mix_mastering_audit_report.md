# Render Mix / Mastering Audit

Scope: final MusicalIR tracks after instrumentation mix attachment and render mix balance.

Summary: pass=3, warning=47, error=0, no-ir=0.

## Dream 5504 Score Master Plan

| Style | Target Playback LUFS | Allowed | Avg Master NRPN | Master NRPN Range | Avg Master Gain | Avg Playback LUFS | Playback Range | Avg Delta | Max Drive Proxy dBFS | Diagnosis |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| pop | -14.0 | -20.0..-11.0 | 73 | 64..79 | 0.57 | -16.9 | -18.0..-15.8 | -2.9 | -1.5 | 鼓瞬态偏前 |
| jazz | -14.0 | -20.0..-11.0 | 85 | 81..87 | 0.67 | -16.8 | -17.5..-16.5 | -2.8 | -1.5 | 鼓瞬态偏前 |
| lofi | -14.0 | -20.0..-11.0 | 111 | 96..118 | 0.87 | -16.4 | -17.1..-15.7 | -2.4 | -1.5 | 鼓瞬态偏前<br>bass听感偏低 |
| rnb | -14.0 | -20.0..-11.0 | 77 | 70..84 | 0.61 | -16.2 | -17.3..-15.2 | -2.2 | -1.5 | bass听感偏低<br>鼓瞬态偏前 |
| acg | -14.0 | -20.0..-11.0 | 127 | 127..127 | 1.00 | -20.5 | -21.5..-19.4 | -6.5 | -3.5 | 音量小 |

External basis:
- ITU-R BS.1770-5: programme loudness and true-peak measurement algorithm.
- EBU R128: programme loudness, loudness range, maximum true peak, -1 dBTP production ceiling.
- Spotify for Artists: -14 LUFS playback reference and -1 dBTP mastering guidance.
- Apple Digital Masters: leave at least 1 dB headroom to avoid oversampling/AAC clipping.

Hardware speaker target: YD3411-H-YC16-8B, 34x11x4mm, 4ohm, 2W RMS, F0 630Hz in 4cc box.
Speaker mix guardrails: kick/body 100-400Hz, mid body 630-2000Hz, presence attack 2000-4000Hz, harshness control 5000-10000Hz; drum reverb CC <= 18, drum transient CC <= 78.

| Style | Seed | Status | Est. LUFS | Playback LUFS | Target | Delta | Master Gain | Master NRPN | Wet Energy | Hardware Drive Proxy dBFS | Tracks | Diagnosis | Findings |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| pop | 0 | warning | -11.2 | -17.2 | -14.0 | -3.2 | 0.50 | 64 | 1.418 | -1.6 | bass:26%/cc100/rv0% comp:37%/cc100/rv0% drum:14%/cc100/rv0% lead:23%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:speaker.drumTransientTooForward(drum) |
| pop | 1 | warning | -12.7 | -17.7 | -14.0 | -3.7 | 0.57 | 72 | 1.003 | -1.5 | bass:29%/cc100/rv0% comp:26%/cc100/rv0% drum:18%/cc100/rv0% lead:27%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| pop | 2 | warning | -12.3 | -16.7 | -14.0 | -2.7 | 0.60 | 76 | 1.115 | -1.5 | bass:28%/cc100/rv0% comp:25%/cc100/rv0% drum:19%/cc100/rv0% lead:29%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| pop | 3 | warning | -11.4 | -16.7 | -14.0 | -2.7 | 0.54 | 69 | 1.351 | -1.5 | bass:23%/cc100/rv0% comp:30%/cc100/rv0% pad:9%/cc100/rv0% drum:14%/cc100/rv0% lead:24%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| pop | 4 | warning | -11.7 | -16.7 | -14.0 | -2.7 | 0.57 | 72 | 1.263 | -1.5 | bass:26%/cc100/rv0% comp:27%/cc100/rv0% pad:12%/cc100/rv0% drum:11%/cc100/rv0% lead:23%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| pop | 5 | warning | -13.2 | -18.0 | -14.0 | -4.0 | 0.57 | 73 | 0.898 | -1.6 | bass:32%/cc100/rv0% comp:23%/cc100/rv0% drum:19%/cc100/rv0% lead:26%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| pop | 7 | warning | -12.3 | -17.1 | -14.0 | -3.1 | 0.57 | 73 | 1.105 | -1.6 | bass:28%/cc100/rv0% comp:19%/cc100/rv0% pad:14%/cc100/rv0% drum:16%/cc100/rv0% lead:22%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| pop | 11 | warning | -12.0 | -16.1 | -14.0 | -2.1 | 0.62 | 79 | 1.197 | -1.6 | bass:27%/cc100/rv0% comp:23%/cc100/rv0% pad:13%/cc100/rv0% drum:12%/cc100/rv0% lead:25%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| pop | 42 | warning | -12.7 | -17.4 | -14.0 | -3.4 | 0.58 | 74 | 1.009 | -1.5 | bass:29%/cc100/rv0% comp:18%/cc100/rv0% pad:11%/cc100/rv0% drum:15%/cc100/rv0% lead:26%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| pop | 99 | warning | -11.2 | -15.8 | -14.0 | -1.8 | 0.59 | 75 | 1.431 | -1.5 | bass:16%/cc100/rv0% comp:57%/cc100/rv0% drum:6%/cc100/rv0% lead:21%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.leadCompRatio<br>warning:speaker.drumTransientTooForward(drum) |
| jazz | 0 | warning | -13.4 | -16.9 | -14.0 | -2.9 | 0.67 | 85 | 0.867 | -1.5 | bass:34%/cc100/rv0% comp:18%/cc100/rv0% drum:16%/cc100/rv0% lead:32%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| jazz | 1 | warning | -13.5 | -16.8 | -14.0 | -2.8 | 0.69 | 87 | 0.844 | -1.6 | bass:35%/cc100/rv0% comp:25%/cc100/rv0% drum:7%/cc100/rv0% lead:34%/cc100/rv0% | 鼓瞬态偏前 | warning:speaker.drumTransientTooForward(drum) |
| jazz | 2 | warning | -13.2 | -16.8 | -14.0 | -2.8 | 0.66 | 84 | 0.910 | -1.5 | bass:34%/cc100/rv0% comp:17%/cc100/rv0% drum:16%/cc100/rv0% lead:34%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| jazz | 3 | warning | -13.1 | -16.6 | -14.0 | -2.6 | 0.67 | 85 | 0.915 | -1.6 | bass:32%/cc100/rv0% comp:24%/cc100/rv0% drum:16%/cc100/rv0% lead:28%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| jazz | 4 | warning | -13.1 | -16.6 | -14.0 | -2.6 | 0.67 | 85 | 0.920 | -1.6 | bass:33%/cc100/rv0% comp:20%/cc100/rv0% drum:16%/cc100/rv0% lead:31%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| jazz | 5 | warning | -13.2 | -16.8 | -14.0 | -2.8 | 0.66 | 84 | 0.905 | -1.6 | bass:32%/cc100/rv0% comp:27%/cc100/rv0% drum:16%/cc100/rv0% lead:25%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| jazz | 7 | warning | -13.7 | -17.2 | -14.0 | -3.2 | 0.67 | 85 | 0.797 | -1.5 | bass:34%/cc100/rv0% comp:22%/cc100/rv0% drum:17%/cc100/rv0% lead:27%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| jazz | 11 | warning | -13.6 | -17.5 | -14.0 | -3.5 | 0.64 | 81 | 0.828 | -1.6 | bass:35%/cc100/rv0% comp:20%/cc100/rv0% drum:16%/cc100/rv0% lead:29%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| jazz | 42 | warning | -13.1 | -16.5 | -14.0 | -2.5 | 0.68 | 86 | 0.913 | -1.6 | bass:32%/cc100/rv0% comp:22%/cc100/rv0% drum:15%/cc100/rv0% lead:31%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| jazz | 99 | warning | -13.2 | -16.8 | -14.0 | -2.8 | 0.66 | 84 | 0.894 | -1.5 | bass:32%/cc100/rv0% comp:24%/cc100/rv0% drum:15%/cc100/rv0% lead:29%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| lofi | 0 | warning | -13.7 | -15.7 | -14.0 | -1.7 | 0.79 | 100 | 0.809 | -1.5 | bass:14%/cc100/rv0% comp:51%/cc100/rv0% drum:6%/cc100/rv0% lead:29%/cc100/rv0% | 鼓瞬态偏前 | warning:speaker.drumTransientTooForward(drum) |
| lofi | 1 | warning | -13.6 | -16.0 | -14.0 | -2.0 | 0.76 | 96 | 0.827 | -1.6 | bass:12%/cc100/rv0% comp:59%/cc100/rv0% pad:5%/cc100/rv0% drum:5%/cc100/rv0% lead:19%/cc100/rv0% | bass听感偏低 / 鼓瞬态偏前 | warning:mix.leadCompRatio<br>warning:speaker.drumTransientTooForward(drum)<br>warning:mix.bassTooHidden(bass) |
| lofi | 2 | warning | -15.8 | -16.8 | -14.0 | -2.8 | 0.89 | 113 | 0.498 | -1.5 | bass:22%/cc100/rv0% comp:13%/cc100/rv0% pad:9%/cc100/rv0% drum:10%/cc100/rv0% lead:45%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.leadCompRatio<br>warning:speaker.drumTransientTooForward(drum) |
| lofi | 3 | warning | -15.6 | -16.4 | -14.0 | -2.4 | 0.91 | 116 | 0.518 | -1.5 | bass:23%/cc100/rv0% comp:12%/cc100/rv0% pad:11%/cc100/rv0% drum:9%/cc100/rv0% lead:45%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.leadCompRatio<br>warning:speaker.drumTransientTooForward(drum) |
| lofi | 4 | warning | -15.8 | -16.4 | -14.0 | -2.4 | 0.93 | 118 | 0.499 | -1.5 | bass:25%/cc100/rv0% comp:13%/cc100/rv0% pad:10%/cc100/rv0% drum:10%/cc100/rv0% lead:43%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.leadCompRatio<br>warning:speaker.drumTransientTooForward(drum) |
| lofi | 5 | warning | -15.4 | -16.6 | -14.0 | -2.6 | 0.87 | 111 | 0.540 | -1.6 | bass:20%/cc100/rv0% comp:33%/cc100/rv0% pad:10%/cc100/rv0% drum:9%/cc100/rv0% lead:28%/cc100/rv0% | 鼓瞬态偏前 | warning:speaker.drumTransientTooForward(drum) |
| lofi | 7 | warning | -15.1 | -16.3 | -14.0 | -2.3 | 0.87 | 111 | 0.583 | -1.5 | bass:18%/cc100/rv0% comp:34%/cc100/rv0% drum:8%/cc100/rv0% lead:40%/cc100/rv0% | 鼓瞬态偏前 | warning:speaker.drumTransientTooForward(drum) |
| lofi | 11 | warning | -15.5 | -16.5 | -14.0 | -2.5 | 0.90 | 114 | 0.528 | -1.6 | bass:23%/cc100/rv0% comp:12%/cc100/rv0% pad:13%/cc100/rv0% drum:9%/cc100/rv0% lead:43%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.leadCompRatio<br>warning:speaker.drumTransientTooForward(drum) |
| lofi | 42 | warning | -16.5 | -17.1 | -14.0 | -3.1 | 0.93 | 118 | 0.422 | -1.6 | bass:29%/cc100/rv0% comp:16%/cc100/rv0% pad:12%/cc100/rv0% drum:11%/cc100/rv0% lead:33%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.foregroundTooSmall<br>warning:speaker.drumTransientTooForward(drum) |
| lofi | 99 | warning | -14.6 | -15.8 | -14.0 | -1.8 | 0.87 | 111 | 0.651 | -1.5 | bass:16%/cc100/rv0% comp:28%/cc100/rv0% pad:7%/cc100/rv0% drum:7%/cc100/rv0% lead:42%/cc100/rv0% | 鼓瞬态偏前 | warning:speaker.drumTransientTooForward(drum) |
| rnb | 0 | warning | -13.7 | -17.3 | -14.0 | -3.3 | 0.66 | 84 | 0.800 | -1.5 | bass:9%/cc100/rv0% comp:49%/cc100/rv0% drum:12%/cc100/rv0% lead:29%/cc100/rv0% | bass听感偏低 / 鼓瞬态偏前 | warning:mix.leadCompRatio<br>warning:speaker.drumTransientTooForward(drum)<br>warning:mix.bassTooHidden(bass) |
| rnb | 1 | warning | -11.2 | -16.2 | -14.0 | -2.2 | 0.56 | 71 | 1.433 | -1.6 | bass:6%/cc100/rv0% comp:69%/cc100/rv0% drum:8%/cc100/rv0% lead:16%/cc100/rv0% | bass听感偏低 / 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.leadCompRatio<br>warning:speaker.drumTransientTooForward(drum)<br>warning:mix.bassTooHidden(bass) |
| rnb | 2 | warning | -12.6 | -16.9 | -14.0 | -2.9 | 0.61 | 77 | 1.044 | -1.6 | bass:11%/cc100/rv0% comp:58%/cc100/rv0% drum:11%/cc100/rv0% lead:21%/cc100/rv0% | bass听感偏低 / 鼓瞬态偏前 | warning:mix.leadCompRatio<br>warning:speaker.drumTransientTooForward(drum)<br>warning:mix.bassTooHidden(bass) |
| rnb | 3 | warning | -11.0 | -15.5 | -14.0 | -1.5 | 0.60 | 76 | 1.487 | -1.6 | bass:7%/cc100/rv0% comp:63%/cc100/rv0% pad:6%/cc100/rv0% drum:7%/cc100/rv0% lead:18%/cc100/rv0% | bass听感偏低 / 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.leadCompRatio<br>warning:speaker.drumTransientTooForward(drum)<br>warning:mix.bassTooHidden(bass) |
| rnb | 4 | warning | -10.6 | -15.2 | -14.0 | -1.2 | 0.59 | 75 | 1.631 | -1.6 | bass:7%/cc100/rv0% comp:63%/cc100/rv0% pad:5%/cc100/rv0% drum:7%/cc100/rv0% lead:19%/cc100/rv0% | bass听感偏低 / 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:master.estimatedLufs<br>warning:mix.leadCompRatio<br>warning:speaker.drumTransientTooForward(drum)<br>warning:mix.bassTooHidden(bass) |
| rnb | 5 | warning | -10.7 | -15.7 | -14.0 | -1.7 | 0.57 | 72 | 1.591 | -1.5 | bass:6%/cc100/rv0% comp:73%/cc100/rv0% drum:8%/cc100/rv0% lead:14%/cc100/rv0% | bass听感偏低 / 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:master.estimatedLufs<br>warning:mix.leadCompRatio<br>warning:speaker.drumTransientTooForward(drum)<br>warning:mix.bassTooHidden(bass) |
| rnb | 7 | warning | -10.9 | -16.1 | -14.0 | -2.1 | 0.55 | 70 | 1.516 | -1.5 | bass:11%/cc100/rv0% comp:58%/cc100/rv0% pad:7%/cc100/rv0% drum:8%/cc100/rv0% lead:16%/cc100/rv0% | bass听感偏低 / 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.leadCompRatio<br>warning:speaker.drumTransientTooForward(drum)<br>warning:mix.bassTooHidden(bass) |
| rnb | 11 | warning | -12.8 | -16.6 | -14.0 | -2.6 | 0.65 | 82 | 0.992 | -1.6 | bass:11%/cc100/rv0% comp:45%/cc100/rv0% pad:10%/cc100/rv0% drum:10%/cc100/rv0% lead:25%/cc100/rv0% | bass听感偏低 / 鼓瞬态偏前 | warning:mix.leadCompRatio<br>warning:speaker.drumTransientTooForward(drum)<br>warning:mix.bassTooHidden(bass) |
| rnb | 42 | warning | -11.8 | -15.6 | -14.0 | -1.6 | 0.65 | 82 | 1.254 | -1.6 | bass:9%/cc100/rv0% comp:57%/cc100/rv0% pad:6%/cc100/rv0% drum:8%/cc100/rv0% lead:20%/cc100/rv0% | bass听感偏低 / 鼓瞬态偏前 | warning:mix.totalWetEnergy<br>warning:mix.leadCompRatio<br>warning:speaker.drumTransientTooForward(drum)<br>warning:mix.bassTooHidden(bass) |
| rnb | 99 | warning | -12.7 | -16.6 | -14.0 | -2.6 | 0.64 | 81 | 1.005 | -1.6 | bass:19%/cc100/rv0% comp:48%/cc100/rv0% drum:8%/cc100/rv0% lead:25%/cc100/rv0% | 鼓瞬态偏前 | warning:mix.leadCompRatio<br>warning:speaker.drumTransientTooForward(drum) |
| acg | 0 | warning | -20.8 | -20.8 | -14.0 | -6.8 | 1.00 | 127 | 0.157 | -4.0 | bass:29%/cc74/rv1% comp:35%/cc74/rv17% lead:36%/cc92/rv82% | 音量小 | warning:mix.totalWetEnergy |
| acg | 1 | pass | -20.1 | -20.1 | -14.0 | -6.1 | 1.00 | 127 | 0.186 | -3.6 | bass:23%/cc74/rv1% comp:34%/cc80/rv14% lead:43%/cc85/rv85% | 音量小 | ok |
| acg | 2 | warning | -20.4 | -20.4 | -14.0 | -6.4 | 1.00 | 127 | 0.170 | -3.7 | bass:29%/cc74/rv1% comp:33%/cc77/rv15% lead:38%/cc88/rv84% | 音量小 | warning:mix.totalWetEnergy |
| acg | 3 | warning | -20.5 | -20.5 | -14.0 | -6.5 | 1.00 | 127 | 0.168 | -4.2 | bass:26%/cc74/rv1% comp:31%/cc78/rv13% lead:42%/cc87/rv86% | 音量小 | warning:mix.totalWetEnergy |
| acg | 4 | warning | -20.7 | -20.7 | -14.0 | -6.7 | 1.00 | 127 | 0.162 | -3.5 | bass:30%/cc74/rv1% comp:39%/cc75/rv21% lead:31%/cc90/rv78% | 音量小 | warning:mix.totalWetEnergy<br>warning:mix.leadCompRatio |
| acg | 5 | pass | -20.1 | -20.1 | -14.0 | -6.1 | 1.00 | 127 | 0.185 | -3.8 | bass:28%/cc74/rv1% comp:35%/cc78/rv16% lead:38%/cc87/rv83% | 音量小 | ok |
| acg | 7 | warning | -21.5 | -21.5 | -14.0 | -7.5 | 1.00 | 127 | 0.133 | -4.1 | bass:31%/cc74/rv1% comp:30%/cc76/rv14% lead:39%/cc90/rv85% | 音量小 | warning:mix.totalWetEnergy<br>warning:master.estimatedLufs |
| acg | 11 | pass | -19.4 | -19.4 | -14.0 | -5.4 | 1.00 | 127 | 0.216 | -3.9 | bass:27%/cc74/rv1% comp:30%/cc79/rv13% lead:43%/cc85/rv87% | ok | ok |
| acg | 42 | warning | -20.6 | -20.6 | -14.0 | -6.6 | 1.00 | 127 | 0.163 | -3.8 | bass:32%/cc74/rv1% comp:35%/cc74/rv17% lead:34%/cc92/rv81% | 音量小 | warning:mix.totalWetEnergy |
| acg | 99 | warning | -20.6 | -20.6 | -14.0 | -6.6 | 1.00 | 127 | 0.165 | -4.0 | bass:28%/cc74/rv1% comp:33%/cc76/rv15% lead:39%/cc88/rv84% | 音量小 | warning:mix.totalWetEnergy |

ESP32-S3 interpretation: `info:master.limiterWillWork` means the shared post-TSF limiter/softclip stage is expected to work; warnings are reserved for mix balance issues that still need musical or routing fixes.
