# Render Mix / Mastering Audit

Scope: final MusicalIR tracks after instrumentation mix attachment and render mix balance.

Summary: pass=23, warning=26, error=0, no-ir=1.

External basis:
- ITU-R BS.1770-5: programme loudness and true-peak measurement algorithm.
- EBU R128: programme loudness, loudness range, maximum true peak, -1 dBTP production ceiling.
- Spotify for Artists: -14 LUFS playback reference and -1 dBTP mastering guidance.
- Apple Digital Masters: leave at least 1 dB headroom to avoid oversampling/AAC clipping.

| Style | Seed | Status | Est. LUFS | Wet Energy | Peak Proxy dBFS | Tracks | Findings |
|---|---:|---|---:|---:|---:|---|---|
| pop | 0 | warning | -15.7 | 0.507 | 0.1 | bass:15%/cc62 comp:31%/cc88 drum:9%/cc100 lead:45%/cc86 | warning:master.limiterWillWork |
| pop | 1 | warning | -15.7 | 0.507 | -0.1 | bass:21%/cc66 comp:35%/cc74 drum:10%/cc100 lead:34%/cc93 | warning:master.limiterWillWork |
| pop | 2 | warning | -13.8 | 0.778 | 0.7 | bass:19%/cc66 comp:38%/cc78 drum:6%/cc100 lead:37%/cc92 | warning:master.limiterWillWork |
| pop | 3 | warning | -14.5 | 0.668 | 0.5 | bass:21%/cc66 comp:28%/cc84 pad:6%/cc77 drum:7%/cc100 lead:37%/cc88 | warning:master.limiterWillWork |
| pop | 4 | warning | -15.2 | 0.575 | -0.2 | bass:20%/cc62 comp:27%/cc89 pad:10%/cc77 drum:8%/cc100 lead:36%/cc83 | warning:master.limiterWillWork |
| pop | 5 | warning | -16.4 | 0.434 | -0.3 | bass:22%/cc62 comp:29%/cc90 drum:12%/cc100 lead:37%/cc82 | warning:master.limiterWillWork |
| pop | 7 | warning | -15.5 | 0.526 | -0.5 | bass:23%/cc66 comp:24%/cc85 pad:10%/cc77 drum:12%/cc100 lead:30%/cc80 | warning:master.limiterWillWork |
| pop | 11 | warning | -14.1 | 0.739 | 0.2 | bass:15%/cc62 comp:34%/cc80 pad:8%/cc77 drum:6%/cc100 lead:38%/cc95 | warning:master.limiterWillWork |
| pop | 42 | warning | -15.2 | 0.572 | -0.0 | bass:19%/cc62 comp:26%/cc90 pad:8%/cc77 drum:7%/cc100 lead:40%/cc85 | warning:master.limiterWillWork |
| pop | 99 | warning | -14.5 | 0.664 | 0.1 | bass:15%/cc66 comp:44%/cc81 drum:2%/cc100 lead:39%/cc90 | warning:master.limiterWillWork |
| jazz | 0 | pass | -16.0 | 0.475 | -2.5 | bass:29%/cc66 comp:24%/cc89 drum:4%/cc100 lead:44%/cc81 | ok |
| jazz | 1 | warning | -15.6 | 0.519 | -1.9 | bass:26%/cc66 comp:17%/cc85 drum:3%/cc100 lead:54%/cc100 | warning:mix.leadCompRatio |
| jazz | 2 | warning | -15.3 | 0.559 | -2.2 | bass:26%/cc66 comp:18%/cc84 drum:3%/cc100 lead:53%/cc100 | warning:mix.leadCompRatio |
| jazz | 3 | pass | -15.8 | 0.490 | -2.5 | bass:27%/cc66 comp:27%/cc89 drum:4%/cc100 lead:42%/cc82 | ok |
| jazz | 4 | pass | -15.0 | 0.601 | -1.9 | bass:24%/cc66 comp:27%/cc85 drum:3%/cc100 lead:46%/cc100 | ok |
| jazz | 5 | pass | -15.2 | 0.570 | -2.7 | bass:23%/cc66 comp:27%/cc85 drum:1%/cc100 lead:49%/cc100 | ok |
| jazz | 7 | warning | -15.3 | 0.554 | -2.0 | bass:25%/cc66 comp:22%/cc84 drum:3%/cc100 lead:50%/cc100 | warning:mix.leadCompRatio |
| jazz | 11 | pass | -15.6 | 0.517 | -2.1 | bass:27%/cc66 comp:29%/cc90 drum:3%/cc100 lead:41%/cc83 | ok |
| jazz | 42 | pass | -15.6 | 0.520 | -2.1 | bass:27%/cc66 comp:26%/cc90 drum:3%/cc100 lead:44%/cc84 | ok |
| jazz | 99 | warning | -15.3 | 0.560 | -2.1 | bass:24%/cc66 comp:20%/cc84 drum:2%/cc100 lead:54%/cc100 | warning:mix.leadCompRatio |
| lofi | 0 | pass | -15.0 | 0.593 | -2.1 | bass:8%/cc66 comp:45%/cc77 drum:1%/cc100 lead:46%/cc93 | ok |
| lofi | 1 | pass | -15.5 | 0.532 | -3.1 | bass:9%/cc62 comp:41%/cc72 pad:6%/cc77 drum:1%/cc100 lead:43%/cc91 | ok |
| lofi | 2 | pass | -14.7 | 0.632 | -2.3 | bass:9%/cc62 comp:40%/cc77 pad:6%/cc77 drum:2%/cc100 lead:43%/cc93 | ok |
| lofi | 3 | warning | -17.8 | 0.311 | -5.0 | bass:16%/cc62 comp:22%/cc93 pad:10%/cc77 drum:4%/cc100 lead:48%/cc73 | warning:mix.totalWetEnergy |
| lofi | 4 | no-ir | n/a | n/a | n/a | n/a | generation returned no IR |
| lofi | 5 | pass | -16.7 | 0.406 | -4.5 | bass:13%/cc66 comp:34%/cc93 pad:9%/cc77 drum:2%/cc100 lead:43%/cc76 | ok |
| lofi | 7 | pass | -15.5 | 0.537 | -3.0 | bass:8%/cc62 comp:49%/cc81 drum:1%/cc100 lead:42%/cc81 | ok |
| lofi | 11 | pass | -14.8 | 0.631 | -2.4 | bass:10%/cc66 comp:43%/cc82 pad:6%/cc77 drum:2%/cc100 lead:39%/cc88 | ok |
| lofi | 42 | warning | -17.8 | 0.311 | -5.3 | bass:17%/cc66 comp:21%/cc93 pad:12%/cc77 drum:4%/cc100 lead:45%/cc71 | warning:mix.totalWetEnergy |
| lofi | 99 | pass | -17.1 | 0.364 | -4.7 | bass:12%/cc62 comp:35%/cc89 pad:9%/cc77 drum:3%/cc100 lead:42%/cc74 | ok |
| rnb | 0 | warning | -15.1 | 0.585 | -0.5 | bass:16%/cc62 comp:38%/cc75 drum:3%/cc100 lead:43%/cc88 | warning:master.limiterWillWork |
| rnb | 1 | warning | -16.2 | 0.447 | -1.2 | bass:23%/cc66 comp:25%/cc78 drum:3%/cc100 lead:49%/cc82 | warning:mix.totalWetEnergy<br>warning:master.limiterWillWork<br>warning:mix.leadCompRatio |
| rnb | 2 | warning | -14.9 | 0.607 | -0.5 | bass:24%/cc66 comp:36%/cc73 drum:3%/cc100 lead:38%/cc90 | warning:master.limiterWillWork |
| rnb | 3 | warning | -14.0 | 0.747 | -0.6 | bass:19%/cc66 comp:37%/cc72 pad:5%/cc77 drum:2%/cc100 lead:37%/cc97 | warning:master.limiterWillWork |
| rnb | 4 | warning | -13.8 | 0.794 | 0.8 | bass:13%/cc62 comp:42%/cc62 pad:5%/cc77 drum:2%/cc100 lead:37%/cc99 | warning:master.limiterWillWork |
| rnb | 5 | warning | -14.1 | 0.730 | -0.7 | bass:12%/cc62 comp:45%/cc63 drum:2%/cc100 lead:40%/cc98 | warning:master.limiterWillWork |
| rnb | 7 | warning | -14.0 | 0.755 | -0.5 | bass:15%/cc66 comp:40%/cc65 pad:6%/cc77 drum:2%/cc100 lead:37%/cc96 | warning:master.limiterWillWork |
| rnb | 11 | warning | -14.6 | 0.651 | -0.3 | bass:16%/cc62 comp:35%/cc69 pad:7%/cc77 drum:2%/cc100 lead:39%/cc95 | warning:master.limiterWillWork |
| rnb | 42 | warning | -14.5 | 0.668 | -0.8 | bass:18%/cc62 comp:40%/cc69 pad:4%/cc77 drum:2%/cc100 lead:35%/cc91 | warning:master.limiterWillWork |
| rnb | 99 | warning | -14.5 | 0.664 | -0.4 | bass:21%/cc66 comp:40%/cc75 drum:2%/cc100 lead:38%/cc88 | warning:master.limiterWillWork |
| acg | 0 | pass | -19.2 | 0.227 | -6.0 | bass:22%/cc54 comp:17%/cc92 lead:60%/cc84 | ok |
| acg | 1 | pass | -18.9 | 0.240 | -5.5 | bass:21%/cc54 comp:19%/cc98 lead:60%/cc84 | ok |
| acg | 2 | pass | -19.3 | 0.220 | -5.4 | bass:23%/cc54 comp:23%/cc98 lead:54%/cc84 | ok |
| acg | 3 | pass | -19.3 | 0.223 | -5.8 | bass:23%/cc54 comp:19%/cc98 lead:58%/cc84 | ok |
| acg | 4 | pass | -19.0 | 0.236 | -5.4 | bass:21%/cc54 comp:21%/cc98 lead:58%/cc84 | ok |
| acg | 5 | pass | -19.0 | 0.235 | -5.7 | bass:21%/cc54 comp:21%/cc92 lead:57%/cc84 | ok |
| acg | 7 | pass | -19.6 | 0.205 | -5.8 | bass:25%/cc54 comp:20%/cc98 lead:55%/cc84 | ok |
| acg | 11 | pass | -19.3 | 0.219 | -5.9 | bass:23%/cc54 comp:22%/cc98 lead:55%/cc84 | ok |
| acg | 42 | pass | -19.0 | 0.238 | -5.7 | bass:21%/cc54 comp:21%/cc98 lead:58%/cc85 | ok |
| acg | 99 | pass | -19.2 | 0.227 | -5.5 | bass:22%/cc54 comp:17%/cc96 lead:60%/cc85 | ok |

ESP32-S3 interpretation: warnings with `master.limiterWillWork` mean the shared post-TSF limiter/softclip stage is required; without that post-processing, the same MIDI balance can clip at the DAC.
