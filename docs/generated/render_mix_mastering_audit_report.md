# Render Mix / Mastering Audit

Scope: final MusicalIR tracks after instrumentation mix attachment and render mix balance.

Summary: pass=30, warning=19, error=1, no-ir=0.

## Style Master Lift Calibration

| Style | Target Playback LUFS | Allowed | Current Lift | Recommended From Avg | Avg Playback LUFS | Playback Range | Avg Delta | Max Drive Proxy dBFS | Diagnosis |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| pop | -13.5 | -15.5..-10.5 | 1.50 | 1.17 | -11.3 | -12.8..-9.7 | 2.2 | 3.9 | 软削工作<br>音量偏大 |
| jazz | -13.0 | -14.5..-11.0 | 1.50 | 1.36 | -12.1 | -12.7..-11.5 | 0.9 | 2.6 | 软削工作 |
| lofi | -13.0 | -15.5..-11.0 | 1.65 | 1.43 | -11.7 | -13.3..-10.3 | 1.3 | 3.3 | 音量偏大<br>软削工作 |
| rnb | -12.4 | -14.4..-10.9 | 1.50 | 1.27 | -10.9 | -12.3..-9.9 | 1.5 | 4.8 | 软削工作<br>音量偏大<br>软削偏多 |
| acg | -12.4 | -13.6..-11.2 | 2.40 | 2.03 | -10.9 | -11.1..-10.7 | 1.5 | 3.5 | 音量偏大<br>软削工作 |

External basis:
- ITU-R BS.1770-5: programme loudness and true-peak measurement algorithm.
- EBU R128: programme loudness, loudness range, maximum true peak, -1 dBTP production ceiling.
- Spotify for Artists: -14 LUFS playback reference and -1 dBTP mastering guidance.
- Apple Digital Masters: leave at least 1 dB headroom to avoid oversampling/AAC clipping.

Hardware speaker target: YD3411-H-YC16-8B, 34x11x4mm, 4ohm, 2W RMS, F0 630Hz in 4cc box.
Speaker mix guardrails: kick/body 100-400Hz, mid body 630-2000Hz, presence attack 2000-4000Hz, harshness control 5000-10000Hz; drum reverb CC <= 18, drum transient CC <= 78.

| Style | Seed | Status | Est. LUFS | Playback LUFS | Target | Delta | Master Lift | Recommended | Wet Energy | Copych Drive Proxy dBFS | Tracks | Diagnosis | Findings |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| pop | 0 | pass | -15.3 | -11.8 | -13.5 | 1.7 | 1.50 | 1.23 | 0.552 | 2.9 | bass:19%/cc72/rv1% comp:32%/cc92/rv13% drum:3%/cc60/rv1% lead:46%/cc92/rv85% | 软削工作 | info:master.limiterWillWork |
| pop | 1 | pass | -15.4 | -11.9 | -13.5 | 1.6 | 1.50 | 1.24 | 0.543 | 3.4 | bass:25%/cc74/rv20% comp:37%/cc78/rv10% drum:6%/cc78/rv7% lead:32%/cc94/rv64% | 软削工作 | info:master.limiterWillWork |
| pop | 2 | warning | -13.2 | -9.7 | -13.5 | 3.8 | 1.50 | 0.97 | 0.892 | 3.9 | bass:21%/cc74/rv2% comp:40%/cc84/rv19% drum:2%/cc60/rv1% lead:38%/cc100/rv79% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| pop | 3 | pass | -14.4 | -10.9 | -13.5 | 2.6 | 1.50 | 1.11 | 0.678 | 3.4 | bass:27%/cc74/rv2% comp:28%/cc87/rv10% pad:4%/cc62/rv2% drum:3%/cc60/rv1% lead:39%/cc91/rv86% | 软削工作 | info:master.limiterWillWork |
| pop | 4 | pass | -15.2 | -11.7 | -13.5 | 1.8 | 1.50 | 1.22 | 0.564 | 3.2 | bass:27%/cc72/rv1% comp:22%/cc80/rv1% pad:6%/cc60/rv3% drum:5%/cc78/rv0% lead:40%/cc87/rv96% | 软削工作 | info:master.limiterWillWork |
| pop | 5 | pass | -16.4 | -12.8 | -13.5 | 0.7 | 1.50 | 1.39 | 0.436 | 3.2 | bass:30%/cc72/rv1% comp:23%/cc80/rv1% drum:7%/cc78/rv0% lead:40%/cc86/rv98% | 软削工作 | info:master.limiterWillWork |
| pop | 7 | pass | -15.5 | -12.0 | -13.5 | 1.5 | 1.50 | 1.26 | 0.529 | 3.1 | bass:29%/cc74/rv8% comp:20%/cc79/rv6% pad:6%/cc60/rv19% drum:7%/cc78/rv3% lead:37%/cc88/rv64% | 软削工作 | info:master.limiterWillWork |
| pop | 11 | warning | -13.9 | -10.4 | -13.5 | 3.1 | 1.50 | 1.05 | 0.764 | 3.0 | bass:20%/cc72/rv0% comp:36%/cc84/rv18% pad:5%/cc64/rv2% drum:2%/cc60/rv0% lead:37%/cc96/rv80% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| pop | 42 | pass | -14.8 | -11.3 | -13.5 | 2.2 | 1.50 | 1.16 | 0.622 | 3.1 | bass:23%/cc72/rv0% comp:25%/cc92/rv11% pad:5%/cc64/rv2% drum:2%/cc60/rv0% lead:44%/cc93/rv86% | 软削工作 | info:master.limiterWillWork |
| pop | 99 | pass | -14.2 | -10.7 | -13.5 | 2.8 | 1.50 | 1.08 | 0.720 | 3.9 | bass:17%/cc74/rv2% comp:44%/cc79/rv2% drum:1%/cc78/rv0% lead:38%/cc92/rv96% | 软削工作 | info:master.limiterWillWork |
| jazz | 0 | pass | -15.4 | -11.9 | -13.0 | 1.1 | 1.50 | 1.32 | 0.544 | 2.2 | bass:31%/cc74/rv2% comp:23%/cc93/rv11% drum:2%/cc78/rv0% lead:44%/cc87/rv87% | 软削工作 | info:master.limiterWillWork |
| jazz | 1 | pass | -16.2 | -12.7 | -13.0 | 0.3 | 1.50 | 1.44 | 0.453 | 1.5 | bass:38%/cc74/rv3% comp:16%/cc79/rv1% drum:2%/cc78/rv0% lead:44%/cc84/rv96% | 软削工作 | info:master.limiterWillWork |
| jazz | 2 | pass | -15.9 | -12.3 | -13.0 | 0.7 | 1.50 | 1.39 | 0.488 | 1.3 | bass:37%/cc74/rv3% comp:18%/cc78/rv1% drum:2%/cc78/rv0% lead:43%/cc84/rv96% | 软削工作 | info:master.limiterWillWork |
| jazz | 3 | pass | -15.9 | -12.4 | -13.0 | 0.6 | 1.50 | 1.40 | 0.480 | 1.6 | bass:35%/cc74/rv3% comp:24%/cc80/rv4% drum:2%/cc78/rv0% lead:39%/cc84/rv93% | 软削工作 | info:master.limiterWillWork |
| jazz | 4 | pass | -15.2 | -11.7 | -13.0 | 1.3 | 1.50 | 1.29 | 0.565 | 1.8 | bass:32%/cc74/rv2% comp:31%/cc89/rv17% drum:2%/cc78/rv0% lead:35%/cc84/rv80% | 软削工作 | info:master.limiterWillWork |
| jazz | 5 | pass | -15.5 | -12.0 | -13.0 | 1.0 | 1.50 | 1.33 | 0.532 | 1.2 | bass:30%/cc74/rv2% comp:31%/cc89/rv16% drum:1%/cc78/rv0% lead:37%/cc84/rv81% | 软削工作 | info:master.limiterWillWork |
| jazz | 7 | pass | -15.9 | -12.4 | -13.0 | 0.6 | 1.50 | 1.39 | 0.486 | 1.4 | bass:36%/cc74/rv3% comp:21%/cc78/rv1% drum:2%/cc78/rv0% lead:41%/cc84/rv96% | 软削工作 | info:master.limiterWillWork |
| jazz | 11 | pass | -15.5 | -12.0 | -13.0 | 1.0 | 1.50 | 1.34 | 0.525 | 1.7 | bass:33%/cc74/rv2% comp:28%/cc89/rv15% drum:2%/cc78/rv0% lead:37%/cc84/rv83% | 软削工作 | info:master.limiterWillWork |
| jazz | 42 | pass | -15.0 | -11.5 | -13.0 | 1.5 | 1.50 | 1.26 | 0.595 | 2.6 | bass:29%/cc74/rv2% comp:24%/cc93/rv11% drum:2%/cc78/rv0% lead:45%/cc91/rv87% | 软削工作 | info:master.limiterWillWork |
| jazz | 99 | pass | -15.9 | -12.4 | -13.0 | 0.6 | 1.50 | 1.39 | 0.486 | 1.3 | bass:35%/cc74/rv3% comp:20%/cc78/rv1% drum:2%/cc78/rv0% lead:44%/cc84/rv96% | 软削工作 | info:master.limiterWillWork |
| lofi | 0 | warning | -14.9 | -10.6 | -13.0 | 2.4 | 1.65 | 1.25 | 0.609 | 3.3 | bass:12%/cc82/rv2% comp:40%/cc74/rv66% drum:1%/cc78/rv0% lead:47%/cc96/rv32% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| lofi | 1 | pass | -15.5 | -11.1 | -13.0 | 1.9 | 1.65 | 1.33 | 0.537 | 2.2 | bass:14%/cc80/rv3% comp:42%/cc73/rv13% pad:4%/cc60/rv12% drum:1%/cc78/rv1% lead:39%/cc87/rv70% | 软削工作 | info:master.limiterWillWork |
| lofi | 2 | warning | -14.7 | -10.3 | -13.0 | 2.7 | 1.65 | 1.21 | 0.645 | 3.1 | bass:15%/cc80/rv1% comp:36%/cc74/rv61% pad:4%/cc64/rv5% drum:1%/cc78/rv0% lead:44%/cc95/rv32% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| lofi | 3 | pass | -17.7 | -13.3 | -13.0 | -0.3 | 1.65 | 1.71 | 0.323 | 0.6 | bass:25%/cc80/rv2% comp:21%/cc93/rv23% pad:7%/cc64/rv6% drum:2%/cc78/rv0% lead:44%/cc72/rv69% | 软削工作 | info:master.limiterWillWork |
| lofi | 4 | pass | -16.4 | -12.1 | -13.0 | 0.9 | 1.65 | 1.48 | 0.431 | 1.6 | bass:17%/cc82/rv6% comp:32%/cc72/rv9% pad:6%/cc60/rv16% drum:2%/cc78/rv1% lead:43%/cc78/rv69% | 软削工作 | info:master.limiterWillWork |
| lofi | 5 | pass | -16.8 | -12.5 | -13.0 | 0.5 | 1.65 | 1.55 | 0.393 | 0.8 | bass:20%/cc82/rv1% comp:25%/cc79/rv1% pad:6%/cc60/rv2% drum:1%/cc78/rv0% lead:48%/cc79/rv96% | 软削工作 | info:master.limiterWillWork |
| lofi | 7 | pass | -15.5 | -11.1 | -13.0 | 1.9 | 1.65 | 1.33 | 0.537 | 2.2 | bass:14%/cc80/rv4% comp:41%/cc74/rv13% drum:1%/cc78/rv0% lead:44%/cc84/rv83% | 软削工作 | info:master.limiterWillWork |
| lofi | 11 | warning | -14.7 | -10.4 | -13.0 | 2.6 | 1.65 | 1.22 | 0.636 | 3.1 | bass:16%/cc82/rv2% comp:36%/cc77/rv61% pad:4%/cc64/rv5% drum:1%/cc78/rv0% lead:43%/cc92/rv31% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| lofi | 42 | pass | -17.2 | -12.9 | -13.0 | 0.1 | 1.65 | 1.63 | 0.356 | 0.8 | bass:23%/cc82/rv4% comp:18%/cc94/rv39% pad:7%/cc64/rv12% drum:2%/cc78/rv1% lead:49%/cc78/rv44% | 软削工作 | info:master.limiterWillWork |
| lofi | 99 | pass | -17.3 | -13.0 | -13.0 | 0.0 | 1.65 | 1.64 | 0.351 | 0.4 | bass:20%/cc80/rv4% comp:23%/cc73/rv6% pad:6%/cc60/rv16% drum:2%/cc78/rv1% lead:49%/cc78/rv73% | 软削工作 | info:master.limiterWillWork |
| rnb | 0 | pass | -15.1 | -11.6 | -12.4 | 0.8 | 1.50 | 1.36 | 0.585 | 3.0 | bass:22%/cc72/rv4% comp:33%/cc69/rv10% drum:2%/cc78/rv1% lead:44%/cc89/rv85% | 软削工作 | info:master.limiterWillWork |
| rnb | 1 | pass | -15.8 | -12.3 | -12.4 | 0.1 | 1.50 | 1.48 | 0.496 | 2.5 | bass:26%/cc74/rv1% comp:24%/cc80/rv1% drum:2%/cc78/rv0% lead:48%/cc86/rv98% | 软削工作 | info:master.limiterWillWork |
| rnb | 2 | pass | -14.9 | -11.4 | -12.4 | 1.0 | 1.50 | 1.33 | 0.612 | 3.2 | bass:30%/cc74/rv10% comp:30%/cc68/rv10% drum:2%/cc78/rv1% lead:39%/cc90/rv80% | 软削工作 | info:master.limiterWillWork |
| rnb | 3 | warning | -14.0 | -10.5 | -12.4 | 1.9 | 1.50 | 1.20 | 0.748 | 3.1 | bass:24%/cc74/rv2% comp:34%/cc67/rv3% pad:3%/cc60/rv3% drum:1%/cc78/rv0% lead:38%/cc98/rv92% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| rnb | 4 | error | -13.4 | -9.9 | -12.4 | 2.5 | 1.50 | 1.13 | 0.853 | 4.8 | bass:17%/cc72/rv4% comp:44%/cc64/rv14% pad:3%/cc60/rv10% drum:1%/cc78/rv1% lead:35%/cc99/rv71% | 音量偏大 / 软削偏多 | warning:master.playbackEstimatedLufs<br>error:master.outputClipRisk |
| rnb | 5 | warning | -13.8 | -10.2 | -12.4 | 2.2 | 1.50 | 1.17 | 0.793 | 3.6 | bass:15%/cc72/rv3% comp:46%/cc66/rv16% drum:1%/cc78/rv1% lead:38%/cc98/rv81% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| rnb | 7 | warning | -13.8 | -10.3 | -12.4 | 2.1 | 1.50 | 1.17 | 0.785 | 3.2 | bass:19%/cc74/rv6% comp:41%/cc65/rv13% pad:3%/cc60/rv11% drum:1%/cc78/rv1% lead:36%/cc95/rv70% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| rnb | 11 | pass | -14.7 | -11.1 | -12.4 | 1.3 | 1.50 | 1.30 | 0.644 | 3.2 | bass:22%/cc72/rv4% comp:32%/cc65/rv9% pad:4%/cc60/rv13% drum:1%/cc78/rv1% lead:40%/cc95/rv73% | 软削工作 | info:master.limiterWillWork |
| rnb | 42 | warning | -14.2 | -10.6 | -12.4 | 1.8 | 1.50 | 1.23 | 0.722 | 2.8 | bass:23%/cc72/rv5% comp:40%/cc68/rv14% pad:2%/cc60/rv9% drum:1%/cc78/rv1% lead:33%/cc92/rv72% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| rnb | 99 | pass | -14.6 | -11.0 | -12.4 | 1.4 | 1.50 | 1.28 | 0.659 | 3.2 | bass:27%/cc74/rv9% comp:33%/cc69/rv11% drum:1%/cc78/rv1% lead:39%/cc89/rv80% | 软削工作 | info:master.limiterWillWork |
| acg | 0 | warning | -18.6 | -11.0 | -12.4 | 1.4 | 2.40 | 2.05 | 0.257 | 2.9 | bass:29%/cc66/rv12% comp:15%/cc91/rv6% lead:56%/cc86/rv81% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| acg | 1 | warning | -18.4 | -10.8 | -12.4 | 1.6 | 2.40 | 1.99 | 0.274 | 3.5 | bass:28%/cc66/rv1% comp:17%/cc100/rv8% lead:55%/cc86/rv91% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| acg | 2 | warning | -18.7 | -11.1 | -12.4 | 1.3 | 2.40 | 2.07 | 0.253 | 3.5 | bass:30%/cc66/rv1% comp:21%/cc100/rv11% lead:50%/cc86/rv88% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| acg | 3 | warning | -18.7 | -11.1 | -12.4 | 1.3 | 2.40 | 2.06 | 0.256 | 3.2 | bass:30%/cc66/rv1% comp:17%/cc100/rv8% lead:53%/cc86/rv90% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| acg | 4 | warning | -18.4 | -10.8 | -12.4 | 1.6 | 2.40 | 2.01 | 0.269 | 3.5 | bass:28%/cc66/rv1% comp:19%/cc100/rv9% lead:53%/cc86/rv90% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| acg | 5 | warning | -18.5 | -10.9 | -12.4 | 1.5 | 2.40 | 2.02 | 0.265 | 3.1 | bass:28%/cc66/rv12% comp:18%/cc91/rv8% lead:53%/cc86/rv80% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| acg | 7 | warning | -18.6 | -11.0 | -12.4 | 1.4 | 2.40 | 2.05 | 0.258 | 3.4 | bass:29%/cc66/rv1% comp:17%/cc100/rv8% lead:54%/cc86/rv91% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| acg | 11 | warning | -18.7 | -11.1 | -12.4 | 1.3 | 2.40 | 2.08 | 0.252 | 3.1 | bass:30%/cc66/rv1% comp:20%/cc100/rv11% lead:50%/cc86/rv88% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| acg | 42 | warning | -18.4 | -10.8 | -12.4 | 1.6 | 2.40 | 2.00 | 0.272 | 3.2 | bass:28%/cc66/rv1% comp:19%/cc100/rv10% lead:53%/cc87/rv89% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |
| acg | 99 | warning | -18.3 | -10.7 | -12.4 | 1.7 | 2.40 | 1.97 | 0.280 | 3.4 | bass:27%/cc66/rv11% comp:15%/cc99/rv6% lead:58%/cc87/rv83% | 音量偏大 / 软削工作 | warning:master.playbackEstimatedLufs<br>info:master.limiterWillWork |

ESP32-S3 interpretation: `info:master.limiterWillWork` means the shared post-TSF limiter/softclip stage is expected to work; warnings are reserved for mix balance issues that still need musical or routing fixes.
