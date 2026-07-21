# Render Mix / Mastering Audit

Scope: final MusicalIR tracks after instrumentation mix attachment and render mix balance.

Summary: pass=40, warning=0, error=0, no-ir=0.

## Style Master Lift Calibration

| Style | Target Playback LUFS | Allowed | Current Lift | Recommended From Avg | Avg Playback LUFS | Playback Range | Avg Delta | Max Drive Proxy dBFS | Diagnosis |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| pop | -13.5 | -15.5..-10.5 | 1.25 | 1.19 | -13.0 | -14.7..-11.3 | 0.5 | 2.3 | 软削工作 |
| jazz | -13.0 | -14.5..-11.0 | 1.50 | 1.52 | -13.1 | -14.0..-12.6 | -0.1 | 2.2 | 软削工作 |
| lofi | -13.0 | -15.5..-11.0 | 1.55 | 1.48 | -12.5 | -14.3..-11.4 | 0.5 | 2.7 | 软削工作 |
| rnb | -12.4 | -14.4..-10.9 | 1.30 | 1.28 | -12.2 | -14.1..-11.0 | 0.2 | 3.1 | 软削工作 |

External basis:
- ITU-R BS.1770-5: programme loudness and true-peak measurement algorithm.
- EBU R128: programme loudness, loudness range, maximum true peak, -1 dBTP production ceiling.
- Spotify for Artists: -14 LUFS playback reference and -1 dBTP mastering guidance.
- Apple Digital Masters: leave at least 1 dB headroom to avoid oversampling/AAC clipping.

Hardware speaker target: YD3411-H-YC16-8B, 34x11x4mm, 4ohm, 2W RMS, F0 630Hz in 4cc box.
Speaker mix guardrails: kick/body 100-400Hz, mid body 630-2000Hz, presence attack 2000-4000Hz, harshness control 5000-10000Hz; drum reverb CC <= 18, drum transient CC <= 78.

| Style | Seed | Status | Est. LUFS | Playback LUFS | Target | Delta | Master Lift | Recommended | Wet Energy | Hardware Drive Proxy dBFS | Tracks | Diagnosis | Findings |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| pop | 0 | pass | -15.0 | -13.1 | -13.5 | 0.4 | 1.25 | 1.19 | 0.589 | 1.8 | bass:20%/cc74/rv2% comp:31%/cc92/rv10% drum:3%/cc60/rv1% lead:46%/cc88/rv88% | 软削工作 | info:master.limiterWillWork |
| pop | 1 | pass | -15.8 | -13.8 | -13.5 | -0.3 | 1.25 | 1.30 | 0.499 | 1.0 | bass:30%/cc76/rv23% comp:33%/cc72/rv9% drum:4%/cc60/rv4% lead:34%/cc80/rv64% | 软削工作 | info:master.limiterWillWork |
| pop | 2 | pass | -13.3 | -11.3 | -13.5 | 2.2 | 1.25 | 0.97 | 0.887 | 2.3 | bass:22%/cc76/rv4% comp:39%/cc83/rv15% drum:2%/cc60/rv1% lead:36%/cc100/rv81% | 软削工作 | info:master.limiterWillWork |
| pop | 3 | pass | -14.4 | -12.5 | -13.5 | 1.0 | 1.25 | 1.11 | 0.685 | 2.3 | bass:29%/cc76/rv6% comp:28%/cc85/rv14% pad:3%/cc52/rv2% drum:3%/cc60/rv1% lead:37%/cc89/rv77% | 软削工作 | info:master.limiterWillWork |
| pop | 4 | pass | -15.3 | -13.4 | -13.5 | 0.1 | 1.25 | 1.23 | 0.552 | 1.5 | bass:31%/cc74/rv3% comp:25%/cc83/rv5% pad:6%/cc52/rv3% drum:3%/cc60/rv1% lead:36%/cc82/rv88% | 软削工作 | info:master.limiterWillWork |
| pop | 5 | pass | -16.6 | -14.7 | -13.5 | -1.2 | 1.25 | 1.43 | 0.413 | 0.9 | bass:34%/cc74/rv4% comp:27%/cc83/rv5% drum:4%/cc60/rv1% lead:35%/cc82/rv90% | 软削工作 | info:master.limiterWillWork |
| pop | 7 | pass | -16.2 | -14.2 | -13.5 | -0.7 | 1.25 | 1.36 | 0.454 | 1.1 | bass:34%/cc76/rv11% comp:21%/cc77/rv7% pad:6%/cc52/rv6% drum:4%/cc60/rv2% lead:34%/cc78/rv73% | 软削工作 | info:master.limiterWillWork |
| pop | 11 | pass | -13.9 | -12.0 | -13.5 | 1.5 | 1.25 | 1.05 | 0.762 | 1.7 | bass:22%/cc74/rv2% comp:35%/cc85/rv13% pad:4%/cc52/rv2% drum:2%/cc60/rv1% lead:37%/cc96/rv82% | 软削工作 | info:master.limiterWillWork |
| pop | 42 | pass | -14.9 | -13.0 | -13.5 | 0.5 | 1.25 | 1.18 | 0.609 | 2.2 | bass:25%/cc74/rv2% comp:27%/cc91/rv10% pad:3%/cc52/rv1% drum:2%/cc60/rv1% lead:42%/cc98/rv86% | 软削工作 | info:master.limiterWillWork |
| pop | 99 | pass | -14.0 | -12.1 | -13.5 | 1.4 | 1.25 | 1.06 | 0.749 | 2.0 | bass:18%/cc76/rv3% comp:44%/cc75/rv3% drum:1%/cc60/rv0% lead:38%/cc96/rv94% | 软削工作 | info:master.limiterWillWork |
| jazz | 0 | pass | -16.2 | -12.7 | -13.0 | 0.3 | 1.50 | 1.44 | 0.453 | 2.2 | bass:33%/cc67/rv3% comp:31%/cc94/rv18% drum:3%/cc78/rv0% lead:33%/cc84/rv79% | 软削工作 | info:master.limiterWillWork |
| jazz | 1 | pass | -16.6 | -13.0 | -13.0 | -0.0 | 1.50 | 1.51 | 0.415 | 1.7 | bass:37%/cc67/rv2% comp:19%/cc78/rv1% drum:1%/cc78/rv0% lead:42%/cc88/rv97% | 软削工作 | info:master.limiterWillWork |
| jazz | 2 | pass | -16.6 | -13.1 | -13.0 | -0.1 | 1.50 | 1.51 | 0.414 | 1.4 | bass:38%/cc67/rv2% comp:23%/cc78/rv1% drum:2%/cc60/rv0% lead:37%/cc88/rv97% | 软削工作 | info:master.limiterWillWork |
| jazz | 3 | pass | -16.6 | -13.1 | -13.0 | -0.1 | 1.50 | 1.51 | 0.414 | 1.4 | bass:37%/cc67/rv2% comp:28%/cc78/rv4% drum:2%/cc60/rv0% lead:33%/cc88/rv93% | 软削工作 | info:master.limiterWillWork |
| jazz | 4 | pass | -16.1 | -12.6 | -13.0 | 0.4 | 1.50 | 1.43 | 0.464 | 1.8 | bass:33%/cc67/rv2% comp:35%/cc80/rv15% drum:2%/cc78/rv0% lead:30%/cc88/rv82% | 软削工作 | info:master.limiterWillWork |
| jazz | 5 | pass | -16.7 | -13.2 | -13.0 | -0.2 | 1.50 | 1.54 | 0.400 | 1.4 | bass:38%/cc67/rv3% comp:36%/cc73/rv18% drum:1%/cc78/rv0% lead:26%/cc88/rv79% | 软削工作 | info:master.limiterWillWork |
| jazz | 7 | pass | -17.6 | -14.0 | -13.0 | -1.0 | 1.50 | 1.69 | 0.330 | 1.4 | bass:42%/cc67/rv3% comp:28%/cc69/rv1% drum:3%/cc78/rv1% lead:27%/cc88/rv95% | 软削工作 | info:master.limiterWillWork |
| jazz | 11 | pass | -16.7 | -13.2 | -13.0 | -0.2 | 1.50 | 1.53 | 0.405 | 1.9 | bass:36%/cc67/rv3% comp:33%/cc80/rv21% drum:2%/cc78/rv0% lead:28%/cc87/rv75% | 软削工作 | info:master.limiterWillWork |
| jazz | 42 | pass | -16.4 | -12.9 | -13.0 | 0.1 | 1.50 | 1.48 | 0.434 | 2.2 | bass:35%/cc67/rv3% comp:32%/cc87/rv19% drum:2%/cc78/rv1% lead:31%/cc86/rv77% | 软削工作 | info:master.limiterWillWork |
| jazz | 99 | pass | -17.0 | -13.4 | -13.0 | -0.4 | 1.50 | 1.58 | 0.378 | 1.3 | bass:38%/cc67/rv3% comp:30%/cc78/rv1% drum:2%/cc78/rv0% lead:30%/cc88/rv96% | 软削工作 | info:master.limiterWillWork |
| lofi | 0 | pass | -15.2 | -11.4 | -13.0 | 1.6 | 1.55 | 1.28 | 0.573 | 2.7 | bass:16%/cc86/rv3% comp:42%/cc77/rv65% drum:1%/cc78/rv0% lead:40%/cc95/rv32% | 软削工作 | info:master.limiterWillWork |
| lofi | 1 | pass | -16.1 | -12.3 | -13.0 | 0.7 | 1.55 | 1.43 | 0.460 | 2.2 | bass:17%/cc86/rv6% comp:44%/cc71/rv14% pad:5%/cc64/rv18% drum:1%/cc78/rv1% lead:33%/cc94/rv61% | 软削工作 | info:master.limiterWillWork |
| lofi | 2 | pass | -15.2 | -11.4 | -13.0 | 1.6 | 1.55 | 1.28 | 0.573 | 2.6 | bass:17%/cc86/rv3% comp:38%/cc77/rv58% pad:5%/cc64/rv7% drum:1%/cc78/rv0% lead:39%/cc95/rv32% | 软削工作 | info:master.limiterWillWork |
| lofi | 3 | pass | -17.4 | -13.6 | -13.0 | -0.6 | 1.55 | 1.65 | 0.346 | 0.4 | bass:28%/cc86/rv1% comp:19%/cc94/rv7% pad:7%/cc64/rv2% drum:2%/cc78/rv0% lead:44%/cc84/rv89% | 软削工作 | info:master.limiterWillWork |
| lofi | 4 | pass | -15.7 | -11.9 | -13.0 | 1.1 | 1.55 | 1.37 | 0.507 | 1.9 | bass:21%/cc86/rv7% comp:37%/cc71/rv11% pad:6%/cc64/rv18% drum:1%/cc78/rv1% lead:35%/cc88/rv62% | 软削工作 | info:master.limiterWillWork |
| lofi | 5 | pass | -17.2 | -13.3 | -13.0 | -0.3 | 1.55 | 1.61 | 0.363 | 1.3 | bass:25%/cc86/rv1% comp:24%/cc74/rv1% pad:8%/cc64/rv3% drum:1%/cc78/rv0% lead:42%/cc100/rv95% | 软削工作 | info:master.limiterWillWork |
| lofi | 7 | pass | -16.4 | -12.6 | -13.0 | 0.4 | 1.55 | 1.47 | 0.434 | 1.2 | bass:17%/cc86/rv6% comp:41%/cc70/rv14% drum:1%/cc78/rv1% lead:41%/cc89/rv79% | 软削工作 | info:master.limiterWillWork |
| lofi | 11 | pass | -15.2 | -11.4 | -13.0 | 1.6 | 1.55 | 1.30 | 0.562 | 2.3 | bass:19%/cc86/rv3% comp:37%/cc74/rv58% pad:5%/cc64/rv7% drum:1%/cc78/rv0% lead:39%/cc97/rv32% | 软削工作 | info:master.limiterWillWork |
| lofi | 42 | pass | -18.1 | -14.3 | -13.0 | -1.3 | 1.55 | 1.81 | 0.289 | 0.4 | bass:34%/cc86/rv7% comp:25%/cc94/rv46% pad:10%/cc64/rv17% drum:2%/cc78/rv1% lead:29%/cc78/rv29% | 软削工作 | info:master.limiterWillWork |
| lofi | 99 | pass | -17.0 | -13.2 | -13.0 | -0.2 | 1.55 | 1.59 | 0.373 | 0.2 | bass:24%/cc86/rv7% comp:23%/cc77/rv6% pad:7%/cc64/rv19% drum:1%/cc78/rv1% lead:45%/cc78/rv67% | 软削工作 | info:master.limiterWillWork |
| rnb | 0 | pass | -15.3 | -13.0 | -12.4 | -0.6 | 1.30 | 1.39 | 0.560 | 2.6 | bass:27%/cc77/rv6% comp:34%/cc66/rv12% drum:3%/cc78/rv1% lead:36%/cc93/rv81% | 软削工作 | info:master.limiterWillWork |
| rnb | 1 | pass | -16.4 | -14.1 | -12.4 | -1.7 | 1.30 | 1.58 | 0.433 | 1.2 | bass:31%/cc77/rv1% comp:27%/cc80/rv1% drum:2%/cc60/rv0% lead:40%/cc86/rv98% | 软削工作 | info:master.limiterWillWork |
| rnb | 2 | pass | -14.6 | -12.3 | -12.4 | 0.1 | 1.30 | 1.28 | 0.657 | 2.7 | bass:35%/cc77/rv9% comp:30%/cc66/rv12% drum:2%/cc78/rv1% lead:32%/cc97/rv78% | 软削工作 | info:master.limiterWillWork |
| rnb | 3 | pass | -14.1 | -11.8 | -12.4 | 0.6 | 1.30 | 1.22 | 0.730 | 3.1 | bass:29%/cc77/rv1% comp:29%/cc69/rv2% pad:5%/cc60/rv3% drum:2%/cc78/rv0% lead:35%/cc97/rv94% | 软削工作 | info:master.limiterWillWork |
| rnb | 4 | pass | -13.3 | -11.0 | -12.4 | 1.4 | 1.30 | 1.11 | 0.884 | 2.6 | bass:19%/cc77/rv4% comp:41%/cc65/rv13% pad:4%/cc60/rv14% drum:2%/cc78/rv1% lead:34%/cc99/rv69% | 软削工作 | info:master.limiterWillWork |
| rnb | 5 | pass | -14.1 | -11.8 | -12.4 | 0.6 | 1.30 | 1.22 | 0.734 | 2.1 | bass:19%/cc77/rv5% comp:50%/cc65/rv19% drum:1%/cc60/rv2% lead:30%/cc98/rv74% | 软削工作 | info:master.limiterWillWork |
| rnb | 7 | pass | -14.2 | -12.0 | -12.4 | 0.4 | 1.30 | 1.24 | 0.709 | 1.9 | bass:22%/cc77/rv4% comp:39%/cc66/rv12% pad:5%/cc60/rv17% drum:1%/cc60/rv2% lead:33%/cc96/rv65% | 软削工作 | info:master.limiterWillWork |
| rnb | 11 | pass | -14.7 | -12.4 | -12.4 | -0.0 | 1.30 | 1.30 | 0.638 | 2.8 | bass:26%/cc77/rv5% comp:34%/cc67/rv11% pad:4%/cc60/rv14% drum:2%/cc78/rv1% lead:34%/cc93/rv69% | 软削工作 | info:master.limiterWillWork |
| rnb | 42 | pass | -13.6 | -11.3 | -12.4 | 1.1 | 1.30 | 1.15 | 0.823 | 2.3 | bass:23%/cc77/rv5% comp:43%/cc65/rv15% pad:3%/cc60/rv12% drum:2%/cc78/rv1% lead:29%/cc98/rv66% | 软削工作 | info:master.limiterWillWork |
| rnb | 99 | pass | -14.7 | -12.4 | -12.4 | -0.0 | 1.30 | 1.31 | 0.635 | 2.7 | bass:33%/cc77/rv8% comp:32%/cc66/rv12% drum:2%/cc78/rv1% lead:33%/cc93/rv79% | 软削工作 | info:master.limiterWillWork |

ESP32-S3 interpretation: `info:master.limiterWillWork` means the shared post-TSF limiter/softclip stage is expected to work; warnings are reserved for mix balance issues that still need musical or routing fixes.
