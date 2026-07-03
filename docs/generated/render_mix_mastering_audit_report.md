# Render Mix / Mastering Audit

Scope: final MusicalIR tracks after instrumentation mix attachment and render mix balance.

Summary: pass=20, warning=29, error=0, no-ir=1.

External basis:
- ITU-R BS.1770-5: programme loudness and true-peak measurement algorithm.
- EBU R128: programme loudness, loudness range, maximum true peak, -1 dBTP production ceiling.
- Spotify for Artists: -14 LUFS playback reference and -1 dBTP mastering guidance.
- Apple Digital Masters: leave at least 1 dB headroom to avoid oversampling/AAC clipping.

| Style | Seed | Status | Est. LUFS | Wet Energy | Peak Proxy dBFS | Tracks | Findings |
|---|---:|---|---:|---:|---:|---|---|
| pop | 0 | warning | -13.0 | 0.944 | 1.6 | bass:13%/cc66 comp:35%/cc81 drum:20%/cc100 lead:32%/cc94 | warning:master.limiterWillWork |
| pop | 1 | warning | -14.3 | 0.704 | 1.4 | bass:15%/cc64 comp:36%/cc77 drum:22%/cc100 lead:27%/cc97 | warning:master.limiterWillWork |
| pop | 2 | warning | -13.5 | 0.841 | 1.4 | bass:15%/cc66 comp:31%/cc83 drum:20%/cc100 lead:33%/cc97 | warning:master.limiterWillWork |
| pop | 3 | warning | -13.9 | 0.765 | 1.4 | bass:15%/cc66 comp:21%/cc89 pad:6%/cc74 drum:25%/cc100 lead:32%/cc87 | warning:master.limiterWillWork |
| pop | 4 | warning | -13.5 | 0.839 | 1.4 | bass:16%/cc66 comp:25%/cc88 pad:8%/cc77 drum:23%/cc100 lead:29%/cc92 | warning:master.limiterWillWork |
| pop | 5 | warning | -14.7 | 0.640 | 1.9 | bass:16%/cc62 comp:26%/cc87 drum:27%/cc100 lead:32%/cc94 | warning:master.limiterWillWork |
| pop | 7 | pass | -15.3 | 0.561 | -3.3 | bass:22%/cc64 comp:27%/cc82 pad:12%/cc77 lead:39%/cc95 | ok |
| pop | 11 | warning | -13.2 | 0.896 | 1.6 | bass:13%/cc62 comp:28%/cc81 pad:5%/cc64 drum:22%/cc100 lead:31%/cc95 | warning:master.limiterWillWork |
| pop | 42 | warning | -14.0 | 0.743 | 1.4 | bass:16%/cc66 comp:24%/cc90 pad:5%/cc64 drum:23%/cc100 lead:31%/cc82 | warning:master.limiterWillWork |
| pop | 99 | warning | -13.3 | 0.887 | 1.7 | bass:10%/cc64 comp:36%/cc81 drum:19%/cc100 lead:35%/cc97 | warning:master.limiterWillWork |
| jazz | 0 | pass | -15.9 | 0.487 | -2.7 | bass:23%/cc66 comp:31%/cc89 lead:45%/cc82 | ok |
| jazz | 1 | warning | -15.0 | 0.590 | -0.1 | bass:19%/cc66 comp:27%/cc89 drum:13%/cc100 lead:41%/cc83 | warning:master.limiterWillWork |
| jazz | 2 | warning | -14.9 | 0.606 | 0.4 | bass:20%/cc66 comp:28%/cc90 drum:13%/cc100 lead:40%/cc85 | warning:master.limiterWillWork |
| jazz | 3 | warning | -14.6 | 0.656 | 0.2 | bass:17%/cc66 comp:32%/cc89 drum:12%/cc100 lead:39%/cc94 | warning:master.limiterWillWork |
| jazz | 4 | warning | -14.2 | 0.723 | 0.4 | bass:17%/cc66 comp:31%/cc84 drum:11%/cc100 lead:41%/cc94 | warning:master.limiterWillWork |
| jazz | 5 | warning | -14.3 | 0.699 | -0.5 | bass:16%/cc66 comp:31%/cc85 drum:10%/cc100 lead:44%/cc93 | warning:master.limiterWillWork |
| jazz | 7 | pass | -14.7 | 0.640 | -2.1 | bass:18%/cc66 comp:34%/cc88 lead:48%/cc94 | ok |
| jazz | 11 | warning | -14.7 | 0.640 | -0.2 | bass:18%/cc66 comp:30%/cc85 drum:10%/cc100 lead:42%/cc97 | warning:master.limiterWillWork |
| jazz | 42 | warning | -14.8 | 0.625 | 0.5 | bass:19%/cc66 comp:30%/cc88 drum:12%/cc100 lead:39%/cc88 | warning:master.limiterWillWork |
| jazz | 99 | warning | -14.4 | 0.690 | 1.0 | bass:16%/cc66 comp:31%/cc89 drum:11%/cc100 lead:42%/cc93 | warning:master.limiterWillWork |
| lofi | 0 | pass | -14.5 | 0.666 | -2.2 | bass:12%/cc66 comp:48%/cc85 lead:40%/cc93 | ok |
| lofi | 1 | pass | -14.7 | 0.639 | -2.1 | bass:11%/cc62 comp:44%/cc82 pad:4%/cc64 lead:40%/cc95 | ok |
| lofi | 2 | pass | -14.3 | 0.699 | -1.9 | bass:13%/cc62 comp:42%/cc87 pad:5%/cc64 lead:40%/cc95 | ok |
| lofi | 3 | warning | -16.5 | 0.422 | -0.9 | bass:20%/cc62 comp:21%/cc93 pad:6%/cc64 drum:15%/cc100 lead:38%/cc75 | warning:master.limiterWillWork |
| lofi | 4 | no-ir | n/a | n/a | n/a | n/a | generation returned no IR |
| lofi | 5 | pass | -15.8 | 0.491 | -4.0 | bass:17%/cc66 comp:34%/cc94 pad:5%/cc64 lead:43%/cc84 | ok |
| lofi | 7 | warning | -13.8 | 0.782 | -0.4 | bass:9%/cc62 comp:46%/cc90 drum:8%/cc100 lead:37%/cc91 | warning:master.limiterWillWork |
| lofi | 11 | warning | -13.8 | 0.784 | -0.7 | bass:14%/cc66 comp:37%/cc87 pad:6%/cc74 drum:9%/cc100 lead:36%/cc95 | warning:master.limiterWillWork |
| lofi | 42 | warning | -16.6 | 0.416 | -1.0 | bass:22%/cc66 comp:20%/cc93 pad:9%/cc74 drum:16%/cc100 lead:33%/cc72 | warning:master.limiterWillWork |
| lofi | 99 | pass | -16.1 | 0.460 | -4.1 | bass:16%/cc62 comp:34%/cc93 pad:6%/cc64 lead:44%/cc86 | ok |
| rnb | 0 | pass | -14.2 | 0.724 | -1.7 | bass:14%/cc62 comp:42%/cc75 lead:44%/cc95 | ok |
| rnb | 1 | warning | -15.1 | 0.582 | 1.4 | bass:17%/cc64 comp:27%/cc78 drum:18%/cc100 lead:38%/cc87 | warning:master.limiterWillWork |
| rnb | 2 | warning | -13.9 | 0.776 | 1.3 | bass:17%/cc62 comp:35%/cc73 drum:15%/cc100 lead:33%/cc96 | warning:master.limiterWillWork |
| rnb | 3 | warning | -13.1 | 0.917 | 0.5 | bass:14%/cc62 comp:37%/cc68 pad:4%/cc71 drum:13%/cc100 lead:33%/cc100 | warning:master.limiterWillWork |
| rnb | 4 | warning | -12.9 | 0.974 | 1.2 | bass:11%/cc62 comp:39%/cc62 pad:7%/cc77 drum:14%/cc100 lead:29%/cc99 | warning:master.limiterWillWork |
| rnb | 5 | warning | -13.1 | 0.918 | 1.5 | bass:11%/cc66 comp:45%/cc63 drum:12%/cc100 lead:32%/cc100 | warning:master.limiterWillWork |
| rnb | 7 | pass | -13.5 | 0.839 | -2.5 | bass:14%/cc64 comp:45%/cc65 pad:7%/cc77 lead:34%/cc99 | ok |
| rnb | 11 | warning | -13.1 | 0.920 | 1.7 | bass:14%/cc66 comp:33%/cc70 pad:5%/cc64 drum:14%/cc100 lead:34%/cc99 | warning:master.limiterWillWork |
| rnb | 42 | warning | -13.3 | 0.875 | 1.3 | bass:14%/cc62 comp:37%/cc69 pad:4%/cc64 drum:14%/cc100 lead:31%/cc96 | warning:master.limiterWillWork |
| rnb | 99 | warning | -13.4 | 0.870 | 1.4 | bass:15%/cc64 comp:36%/cc74 drum:13%/cc100 lead:36%/cc97 | warning:master.limiterWillWork |
| acg | 0 | pass | -18.3 | 0.279 | -5.2 | bass:34%/cc74 comp:21%/cc96 lead:45%/cc82 | ok |
| acg | 1 | pass | -18.2 | 0.287 | -4.8 | bass:33%/cc74 comp:19%/cc96 lead:48%/cc82 | ok |
| acg | 2 | pass | -18.4 | 0.272 | -4.9 | bass:35%/cc74 comp:24%/cc96 lead:42%/cc82 | ok |
| acg | 3 | pass | -18.4 | 0.270 | -5.1 | bass:35%/cc74 comp:27%/cc96 lead:37%/cc82 | ok |
| acg | 4 | pass | -18.2 | 0.285 | -4.9 | bass:33%/cc74 comp:23%/cc98 lead:43%/cc80 | ok |
| acg | 5 | pass | -18.2 | 0.282 | -5.3 | bass:33%/cc74 comp:24%/cc97 lead:42%/cc81 | ok |
| acg | 7 | pass | -18.7 | 0.252 | -5.1 | bass:38%/cc74 comp:23%/cc97 lead:39%/cc81 | ok |
| acg | 11 | pass | -18.4 | 0.274 | -4.9 | bass:35%/cc74 comp:21%/cc98 lead:45%/cc80 | ok |
| acg | 42 | pass | -18.3 | 0.278 | -4.7 | bass:34%/cc74 comp:22%/cc95 lead:44%/cc83 | ok |
| acg | 99 | pass | -18.7 | 0.257 | -5.0 | bass:37%/cc74 comp:24%/cc97 lead:39%/cc81 | ok |

ESP32-S3 interpretation: warnings with `master.limiterWillWork` mean the shared post-TSF limiter/softclip stage is required; without that post-processing, the same MIDI balance can clip at the DAC.
