# Render Mix / Mastering Audit

Scope: final MusicalIR tracks after instrumentation mix attachment and render mix balance.

Summary: pass=50, warning=0, error=0, no-ir=0.

## Style Master Lift Calibration

| Style | Target Playback LUFS | Allowed | Current Lift | Recommended From Avg | Avg Playback LUFS | Playback Range | Avg Delta | Max Drive Proxy dBFS | Diagnosis |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| pop | -13.5 | -15.5..-11.5 | 1.22 | 1.17 | -13.1 | -14.6..-11.7 | 0.4 | 3.0 | 软削工作 |
| jazz | -13.0 | -14.5..-11.8 | 1.34 | 1.26 | -12.5 | -12.9..-12.1 | 0.5 | 1.8 | 软削工作 |
| lofi | -13.0 | -15.5..-11.0 | 1.48 | 1.44 | -12.7 | -14.0..-11.3 | 0.3 | 2.2 | 软削工作 |
| rnb | -12.4 | -14.4..-10.9 | 1.32 | 1.26 | -12.0 | -13.4..-11.0 | 0.4 | 3.9 | 软削工作 |
| acg | -12.4 | -13.6..-11.2 | 2.20 | 2.05 | -11.8 | -12.0..-11.5 | 0.6 | 2.6 | 软削工作 |

External basis:
- ITU-R BS.1770-5: programme loudness and true-peak measurement algorithm.
- EBU R128: programme loudness, loudness range, maximum true peak, -1 dBTP production ceiling.
- Spotify for Artists: -14 LUFS playback reference and -1 dBTP mastering guidance.
- Apple Digital Masters: leave at least 1 dB headroom to avoid oversampling/AAC clipping.

Hardware speaker target: YD3411-H-YC16-8B, 34x11x4mm, 4ohm, 2W RMS, F0 630Hz in 4cc box.
Speaker mix guardrails: kick/body 100-400Hz, mid body 630-2000Hz, presence attack 2000-4000Hz, harshness control 5000-10000Hz; drum reverb CC <= 18, Room kit reverb CC <= 30, drum transient CC <= 90.

| Style | Seed | Status | Est. LUFS | Playback LUFS | Target | Delta | Master Lift | Recommended | Wet Energy | Copych Drive Proxy dBFS | Tracks | Diagnosis | Findings |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| pop | 0 | pass | -15.2 | -13.5 | -13.5 | -0.0 | 1.22 | 1.22 | 0.564 | 2.3 | bass:18%/cc72/rv1% comp:31%/cc92/rv14% drum:6%/cc86/rv1% lead:44%/cc91/rv85% | 软削工作 | info:master.limiterWillWork |
| pop | 1 | pass | -15.4 | -13.7 | -13.5 | -0.2 | 1.22 | 1.24 | 0.545 | 1.9 | bass:25%/cc74/rv20% comp:37%/cc78/rv10% drum:7%/cc86/rv8% lead:32%/cc93/rv62% | 软削工作 | info:master.limiterWillWork |
| pop | 2 | pass | -13.4 | -11.7 | -13.5 | 1.8 | 1.22 | 0.99 | 0.863 | 3.0 | bass:21%/cc74/rv7% comp:41%/cc84/rv66% drum:4%/cc86/rv2% lead:34%/cc92/rv26% | 软削工作 | info:master.limiterWillWork |
| pop | 3 | pass | -14.4 | -12.6 | -13.5 | 0.9 | 1.22 | 1.10 | 0.692 | 2.7 | bass:26%/cc74/rv2% comp:28%/cc87/rv10% pad:4%/cc62/rv2% drum:5%/cc86/rv0% lead:37%/cc90/rv85% | 软削工作 | info:master.limiterWillWork |
| pop | 4 | pass | -15.3 | -13.5 | -13.5 | -0.0 | 1.22 | 1.23 | 0.560 | 1.8 | bass:27%/cc72/rv1% comp:22%/cc80/rv1% pad:6%/cc60/rv3% drum:6%/cc86/rv0% lead:39%/cc85/rv96% | 软削工作 | info:master.limiterWillWork |
| pop | 5 | pass | -16.4 | -14.6 | -13.5 | -1.1 | 1.22 | 1.39 | 0.435 | 1.7 | bass:30%/cc72/rv1% comp:23%/cc80/rv1% drum:9%/cc86/rv1% lead:38%/cc84/rv98% | 软削工作 | info:master.limiterWillWork |
| pop | 7 | pass | -15.6 | -13.8 | -13.5 | -0.3 | 1.22 | 1.27 | 0.523 | 1.7 | bass:29%/cc74/rv8% comp:21%/cc79/rv6% pad:6%/cc60/rv20% drum:9%/cc86/rv4% lead:35%/cc84/rv62% | 软削工作 | info:master.limiterWillWork |
| pop | 11 | pass | -13.8 | -12.1 | -13.5 | 1.4 | 1.22 | 1.04 | 0.785 | 2.4 | bass:19%/cc72/rv0% comp:36%/cc85/rv18% pad:5%/cc64/rv2% drum:4%/cc86/rv0% lead:36%/cc96/rv79% | 软削工作 | info:master.limiterWillWork |
| pop | 42 | pass | -14.7 | -13.0 | -13.5 | 0.5 | 1.22 | 1.15 | 0.635 | 2.4 | bass:23%/cc72/rv0% comp:25%/cc92/rv11% pad:5%/cc64/rv2% drum:5%/cc86/rv0% lead:43%/cc93/rv86% | 软削工作 | info:master.limiterWillWork |
| pop | 99 | pass | -14.2 | -12.5 | -13.5 | 1.0 | 1.22 | 1.09 | 0.715 | 2.5 | bass:17%/cc74/rv2% comp:45%/cc79/rv2% drum:1%/cc86/rv0% lead:37%/cc91/rv96% | 软削工作 | info:master.limiterWillWork |
| jazz | 0 | pass | -15.5 | -12.9 | -13.0 | 0.1 | 1.34 | 1.33 | 0.536 | 1.2 | bass:32%/cc74/rv2% comp:23%/cc93/rv11% drum:2%/cc86/rv0% lead:43%/cc85/rv87% | 软削工作 | info:master.limiterWillWork |
| jazz | 1 | pass | -15.4 | -12.8 | -13.0 | 0.2 | 1.34 | 1.31 | 0.549 | 1.5 | bass:31%/cc74/rv2% comp:16%/cc85/rv0% drum:2%/cc86/rv0% lead:51%/cc100/rv98% | 软削工作 | info:master.limiterWillWork |
| jazz | 2 | pass | -15.0 | -12.5 | -13.0 | 0.5 | 1.34 | 1.26 | 0.592 | 1.3 | bass:31%/cc74/rv2% comp:17%/cc84/rv0% drum:2%/cc86/rv0% lead:50%/cc100/rv98% | 软削工作 | info:master.limiterWillWork |
| jazz | 3 | pass | -15.2 | -12.7 | -13.0 | 0.3 | 1.34 | 1.29 | 0.566 | 1.2 | bass:30%/cc74/rv2% comp:25%/cc92/rv3% drum:2%/cc86/rv0% lead:42%/cc88/rv94% | 软削工作 | info:master.limiterWillWork |
| jazz | 4 | pass | -14.6 | -12.1 | -13.0 | 0.9 | 1.34 | 1.20 | 0.650 | 1.6 | bass:28%/cc74/rv1% comp:27%/cc90/rv10% drum:2%/cc86/rv0% lead:43%/cc100/rv88% | 软削工作 | info:master.limiterWillWork |
| jazz | 5 | pass | -14.8 | -12.3 | -13.0 | 0.7 | 1.34 | 1.24 | 0.618 | 1.0 | bass:26%/cc74/rv1% comp:28%/cc90/rv10% drum:1%/cc86/rv0% lead:45%/cc100/rv89% | 软削工作 | info:master.limiterWillWork |
| jazz | 7 | pass | -15.1 | -12.5 | -13.0 | 0.5 | 1.34 | 1.27 | 0.585 | 1.4 | bass:30%/cc74/rv2% comp:20%/cc84/rv1% drum:2%/cc86/rv0% lead:47%/cc100/rv98% | 软削工作 | info:master.limiterWillWork |
| jazz | 11 | pass | -14.6 | -12.1 | -13.0 | 0.9 | 1.34 | 1.21 | 0.646 | 1.8 | bass:27%/cc74/rv2% comp:23%/cc90/rv10% drum:2%/cc86/rv0% lead:48%/cc100/rv88% | 软削工作 | info:master.limiterWillWork |
| jazz | 42 | pass | -15.0 | -12.5 | -13.0 | 0.5 | 1.34 | 1.27 | 0.590 | 1.8 | bass:30%/cc74/rv2% comp:24%/cc93/rv11% drum:2%/cc86/rv0% lead:44%/cc89/rv87% | 软削工作 | info:master.limiterWillWork |
| jazz | 99 | pass | -15.0 | -12.5 | -13.0 | 0.5 | 1.34 | 1.26 | 0.591 | 1.3 | bass:29%/cc74/rv1% comp:19%/cc84/rv1% drum:2%/cc86/rv0% lead:51%/cc100/rv98% | 软削工作 | info:master.limiterWillWork |
| lofi | 0 | pass | -15.0 | -11.6 | -13.0 | 1.4 | 1.48 | 1.26 | 0.593 | 2.2 | bass:13%/cc82/rv2% comp:42%/cc75/rv67% drum:1%/cc86/rv0% lead:45%/cc92/rv31% | 软削工作 | info:master.limiterWillWork |
| lofi | 1 | pass | -15.6 | -12.2 | -13.0 | 0.8 | 1.48 | 1.34 | 0.524 | 1.2 | bass:14%/cc80/rv4% comp:43%/cc73/rv14% pad:4%/cc60/rv13% drum:1%/cc86/rv1% lead:37%/cc85/rv69% | 软削工作 | info:master.limiterWillWork |
| lofi | 2 | pass | -14.7 | -11.3 | -13.0 | 1.7 | 1.48 | 1.22 | 0.633 | 2.1 | bass:15%/cc80/rv1% comp:37%/cc75/rv62% pad:4%/cc64/rv5% drum:2%/cc86/rv0% lead:42%/cc92/rv30% | 软削工作 | info:master.limiterWillWork |
| lofi | 3 | pass | -17.3 | -13.9 | -13.0 | -0.9 | 1.48 | 1.63 | 0.354 | -0.1 | bass:23%/cc80/rv1% comp:19%/cc93/rv14% pad:6%/cc64/rv3% drum:3%/cc86/rv0% lead:49%/cc80/rv82% | 软削工作 | info:master.limiterWillWork |
| lofi | 4 | pass | -16.5 | -13.1 | -13.0 | -0.1 | 1.48 | 1.49 | 0.424 | 0.6 | bass:18%/cc82/rv6% comp:33%/cc72/rv9% pad:6%/cc60/rv16% drum:2%/cc86/rv1% lead:42%/cc76/rv67% | 软削工作 | info:master.limiterWillWork |
| lofi | 5 | pass | -16.9 | -13.5 | -13.0 | -0.5 | 1.48 | 1.56 | 0.386 | -0.2 | bass:21%/cc82/rv1% comp:26%/cc79/rv1% pad:6%/cc60/rv2% drum:2%/cc86/rv0% lead:46%/cc78/rv96% | 软削工作 | info:master.limiterWillWork |
| lofi | 7 | pass | -15.8 | -12.4 | -13.0 | 0.6 | 1.48 | 1.38 | 0.496 | 0.9 | bass:15%/cc80/rv4% comp:44%/cc74/rv16% drum:1%/cc86/rv1% lead:39%/cc76/rv80% | 软削工作 | info:master.limiterWillWork |
| lofi | 11 | pass | -14.8 | -11.4 | -13.0 | 1.6 | 1.48 | 1.23 | 0.620 | 2.0 | bass:16%/cc82/rv2% comp:37%/cc77/rv62% pad:4%/cc64/rv5% drum:1%/cc86/rv0% lead:42%/cc89/rv30% | 软削工作 | info:master.limiterWillWork |
| lofi | 42 | pass | -17.3 | -13.9 | -13.0 | -0.9 | 1.48 | 1.64 | 0.349 | -0.3 | bass:24%/cc82/rv4% comp:19%/cc94/rv39% pad:7%/cc64/rv12% drum:3%/cc86/rv1% lead:47%/cc76/rv43% | 软削工作 | info:master.limiterWillWork |
| lofi | 99 | pass | -17.4 | -14.0 | -13.0 | -1.0 | 1.48 | 1.66 | 0.343 | -0.5 | bass:21%/cc80/rv4% comp:24%/cc73/rv6% pad:6%/cc60/rv16% drum:2%/cc86/rv1% lead:47%/cc76/rv72% | 软削工作 | info:master.limiterWillWork |
| rnb | 0 | pass | -15.1 | -12.6 | -12.4 | -0.2 | 1.32 | 1.36 | 0.589 | 2.2 | bass:22%/cc72/rv5% comp:35%/cc71/rv11% drum:2%/cc86/rv1% lead:41%/cc86/rv83% | 软削工作 | info:master.limiterWillWork |
| rnb | 1 | pass | -15.8 | -13.4 | -12.4 | -1.0 | 1.32 | 1.48 | 0.498 | 1.8 | bass:26%/cc74/rv1% comp:24%/cc80/rv1% drum:2%/cc86/rv0% lead:48%/cc86/rv98% | 软削工作 | info:master.limiterWillWork |
| rnb | 2 | pass | -14.9 | -12.5 | -12.4 | -0.1 | 1.32 | 1.33 | 0.614 | 2.2 | bass:30%/cc74/rv10% comp:33%/cc71/rv12% drum:2%/cc86/rv1% lead:35%/cc86/rv77% | 软削工作 | info:master.limiterWillWork |
| rnb | 3 | pass | -14.0 | -11.6 | -12.4 | 0.8 | 1.32 | 1.20 | 0.747 | 2.3 | bass:24%/cc74/rv2% comp:34%/cc67/rv3% pad:3%/cc60/rv3% drum:1%/cc86/rv0% lead:38%/cc97/rv92% | 软削工作 | info:master.limiterWillWork |
| rnb | 4 | pass | -13.4 | -11.0 | -12.4 | 1.4 | 1.32 | 1.13 | 0.855 | 3.9 | bass:17%/cc72/rv4% comp:44%/cc64/rv14% pad:3%/cc60/rv10% drum:1%/cc86/rv1% lead:35%/cc99/rv71% | 软削工作 | info:master.limiterWillWork |
| rnb | 5 | pass | -13.7 | -11.3 | -12.4 | 1.1 | 1.32 | 1.17 | 0.795 | 2.6 | bass:15%/cc72/rv3% comp:46%/cc66/rv16% drum:1%/cc86/rv1% lead:38%/cc98/rv80% | 软削工作 | info:master.limiterWillWork |
| rnb | 7 | pass | -13.8 | -11.4 | -12.4 | 1.0 | 1.32 | 1.17 | 0.788 | 2.4 | bass:19%/cc74/rv6% comp:42%/cc67/rv13% pad:3%/cc60/rv11% drum:1%/cc86/rv1% lead:35%/cc94/rv69% | 软削工作 | info:master.limiterWillWork |
| rnb | 11 | pass | -14.7 | -12.3 | -12.4 | 0.1 | 1.32 | 1.30 | 0.642 | 2.3 | bass:22%/cc72/rv5% comp:36%/cc68/rv11% pad:4%/cc60/rv14% drum:2%/cc86/rv1% lead:35%/cc89/rv69% | 软削工作 | info:master.limiterWillWork |
| rnb | 42 | pass | -14.2 | -11.7 | -12.4 | 0.7 | 1.32 | 1.22 | 0.724 | 2.0 | bass:23%/cc72/rv5% comp:40%/cc68/rv14% pad:2%/cc60/rv9% drum:2%/cc86/rv1% lead:33%/cc92/rv72% | 软削工作 | info:master.limiterWillWork |
| rnb | 99 | pass | -14.6 | -12.1 | -12.4 | 0.3 | 1.32 | 1.28 | 0.660 | 2.3 | bass:27%/cc74/rv9% comp:36%/cc71/rv12% drum:1%/cc86/rv1% lead:36%/cc86/rv78% | 软削工作 | info:master.limiterWillWork |
| acg | 0 | pass | -18.8 | -11.9 | -12.4 | 0.5 | 2.20 | 2.08 | 0.251 | 2.0 | bass:30%/cc66/rv13% comp:15%/cc91/rv7% lead:55%/cc84/rv80% | 软削工作 | info:master.limiterWillWork |
| acg | 1 | pass | -18.5 | -11.6 | -12.4 | 0.8 | 2.20 | 2.01 | 0.267 | 2.6 | bass:28%/cc66/rv1% comp:17%/cc100/rv9% lead:54%/cc84/rv90% | 软削工作 | info:master.limiterWillWork |
| acg | 2 | pass | -18.8 | -12.0 | -12.4 | 0.4 | 2.20 | 2.10 | 0.247 | 2.6 | bass:30%/cc66/rv1% comp:21%/cc100/rv11% lead:48%/cc84/rv87% | 软削工作 | info:master.limiterWillWork |
| acg | 3 | pass | -18.8 | -11.9 | -12.4 | 0.5 | 2.20 | 2.08 | 0.250 | 2.3 | bass:30%/cc66/rv1% comp:17%/cc100/rv9% lead:52%/cc84/rv90% | 软削工作 | info:master.limiterWillWork |
| acg | 4 | pass | -18.6 | -11.7 | -12.4 | 0.7 | 2.20 | 2.03 | 0.263 | 2.6 | bass:29%/cc66/rv1% comp:19%/cc100/rv10% lead:52%/cc84/rv89% | 软削工作 | info:master.limiterWillWork |
| acg | 5 | pass | -18.6 | -11.8 | -12.4 | 0.6 | 2.20 | 2.05 | 0.259 | 2.2 | bass:29%/cc66/rv13% comp:19%/cc91/rv8% lead:52%/cc84/rv79% | 软削工作 | info:master.limiterWillWork |
| acg | 7 | pass | -18.7 | -11.9 | -12.4 | 0.5 | 2.20 | 2.08 | 0.251 | 2.5 | bass:30%/cc66/rv1% comp:17%/cc100/rv9% lead:53%/cc84/rv90% | 软削工作 | info:master.limiterWillWork |
| acg | 11 | pass | -18.8 | -12.0 | -12.4 | 0.4 | 2.20 | 2.10 | 0.246 | 2.2 | bass:31%/cc66/rv1% comp:21%/cc100/rv11% lead:49%/cc84/rv88% | 软削工作 | info:master.limiterWillWork |
| acg | 42 | pass | -18.5 | -11.7 | -12.4 | 0.7 | 2.20 | 2.02 | 0.265 | 2.3 | bass:28%/cc66/rv1% comp:20%/cc100/rv10% lead:52%/cc85/rv89% | 软削工作 | info:master.limiterWillWork |
| acg | 99 | pass | -18.4 | -11.5 | -12.4 | 0.9 | 2.20 | 1.99 | 0.273 | 2.6 | bass:28%/cc66/rv11% comp:15%/cc99/rv6% lead:57%/cc85/rv83% | 软削工作 | info:master.limiterWillWork |

ESP32-S3 interpretation: `info:master.limiterWillWork` means the shared post-TSF limiter/softclip stage is expected to work; warnings are reserved for mix balance issues that still need musical or routing fixes.
