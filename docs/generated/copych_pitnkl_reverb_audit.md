# Copych Reverb Audit: pitnkl

Date: 2026-07-10

Scope: Copych safe-FX fix verification. Generated Copych 24 kHz offline renders and static IR/mix metrics for seed `pitnkl`.

## Inputs

- String seed: `pitnkl`
- Numeric seed: `3306999508`
- SF2: `public/Aura25_GM128.sf2`
- Render backend: `public/copych/copych_synth.mjs`
- Sample rate: 24000 Hz
- Styles swept statically: `pop`, `jazz`, `lofi`, `rnb`, `acg`
- Offline audio rendered: `pop`, `rnb`

## Generated Artifacts

- `docs/generated/copych_pitnkl_rnb_render/full.wav`
- `docs/generated/copych_pitnkl_rnb_render/{bass,comp,pad,drum,lead}.wav`
- `docs/generated/copych_pitnkl_rnb_render/meta.json`
- `docs/generated/copych_pitnkl_rnb_render/analysis.json`
- `docs/generated/copych_pitnkl_pop_render/full.wav`
- `docs/generated/copych_pitnkl_pop_render/{bass,comp,pad,drum,lead}.wav`
- `docs/generated/copych_pitnkl_pop_render/meta.json`
- `docs/generated/copych_pitnkl_pop_render/analysis.json`

## Static Mix Findings

Original `pnpm audit:mix` did not fail this case before the fix:

- Summary: `pass=23, warning=26, error=0, no-ir=1`
- For `pitnkl/rnb`, status was only `warning`.
- Previous audit blind spot: `wetEnergyPerBeat` was based on note velocity and CC7 only. It did not include CC91, CC93, song reverb level, or Copych's routing where chorus send is also added into the reverb input.

Copych-aware proxy for `pitnkl/rnb` after the fix:

| Role | Program | CC7 | CC91 | CC93 | Active | Copych Reverb Proxy Share |
|---|---:|---:|---:|---:|---:|---:|
| bass | 38 | 62 | 2 | 7 | 92.2% | 0.1% |
| comp | 5 | 78 | 56 | 52 | 74.4% | 29.5% |
| pad | 89 | 77 | 84 | 79 | 69.2% | 17.9% |
| drum | 0 | 100 | 20 | 0 | 12.9% | 1.0% |
| lead | 0 | 82-84 | 47 | 5 | 73.8% | 51.5% |

Static red flags before the fix:

- `rnb` pad reverb pressure is about `11.67x` drum reverb pressure.
- `pop` pad reverb pressure is about `6.99x` drum reverb pressure.
- The rule `pad.reverb >= comp.reverb + 20` is good for "background behind comp" in a shallow browser preview, but too aggressive for Copych's real shared reverb bus.
- Copych routes `s + chorus` into reverb, so high CC93 on pad/electric keys increases the reverb feed even when CC91 looks controlled.

Fix result:

- `rnb` pad Copych reverb-input share: `36.8% -> 17.9%`.
- `pop` pad Copych reverb-input share: `26.9% proxy / 7.6% fixed audit share` after safe-FX scaling and lower song-space level.
- New audit tracks `copychReverbInputEnergyPerBeat` and role share, so this class of failure is visible.

## Offline Copych Audio Findings

RNB song space:

```json
{
  "id": "rnbPlateRoom",
  "reverbTime": 0.52,
  "reverbLevel": 0.36,
  "predelayMs": 20,
  "damping": 0.58,
  "chorusDepth": 0.16,
  "delayMode": "dotted-eighth",
  "delaySeconds": 0.441
}
```

RNB rendered stem RMS:

| Stem | RMS dBFS | Peak dBFS | Crest dB |
|---|---:|---:|---:|
| full | -35.86 | -20.54 | 15.32 |
| comp | -37.14 | -21.80 | 15.33 |
| drum | -44.88 | -21.82 | 23.06 |
| lead | -47.91 | -31.36 | 16.55 |
| bass | -47.66 | -36.58 | 11.08 |
| pad | -60.13 | -43.66 | 16.48 |

RNB frequency concentration:

- Full mix energy is still concentrated in `250-500 Hz` and `500-2000 Hz`, but lower overall:
  - mud band `250-500 Hz`: 38.6%
  - mid band `500-2000 Hz`: 33.1%
- The strongest sustained contributor remains comp electric piano, not the pad sample itself:
  - comp mud band: 45.6%
  - comp mid band: 41.9%
- Drum transient exists by peak/crest, but its RMS is far lower than the sustained comp bed:
  - drum RMS `-44.88 dBFS`
  - comp RMS `-37.14 dBFS`
  - gap: about `7.74 dB`

POP rendered stem RMS:

| Stem | RMS dBFS | Peak dBFS | Crest dB |
|---|---:|---:|---:|
| full | -34.17 | -14.96 | 19.20 |
| drum | -38.95 | -15.81 | 23.13 |
| comp | -38.42 | -24.43 | 13.99 |
| lead | -40.93 | -24.83 | 16.10 |
| bass | -46.22 | -35.83 | 10.38 |
| pad | -58.56 | -42.63 | 15.93 |

Interpretation:

- The user-visible symptom "pad covers piano/drums" was real as a Copych shared-FX texture problem.
- After the fix, pad no longer owns the room. Remaining RNB muddiness is mostly comp electric piano sustain/voicing in `250 Hz - 2 kHz`, which is a separate instrument/arrangement refinement.
- Existing generic `wetEnergy` remains a loudness proxy; Copych wet-bus risk is now tracked separately.

## Recommended External Tooling

Use an automated chain:

1. Render Copych and Spessa/reference stems to WAV.
2. Analyze loudness/peak/crest with FFmpeg `astats` and `ebur128` or equivalent.
3. Analyze music descriptors and frequency bands with Essentia `streaming_extractor_music`.
4. Use Pyroomacoustics RT60 only for impulse responses, not for full mixed music; for our case it is useful if we render/test the reverb impulse itself.

Primary sources:

- Essentia `streaming_extractor_music` computes spectral, time-domain, rhythm, tonal, and high-level descriptors.
- FFmpeg `astats` reports RMS, peak, crest factor, dynamic range, DC offset, and related channel stats.
- Pyroomacoustics `measure_rt60` estimates RT60 from an impulse response using Schroeder decay.

## Fix Direction

Implemented fix direction:

1. Added a Copych-aware mix audit metric:
   - `copychReverbInput = dryRms * CC7 * (1 + CC93) * CC91 * songReverbLevel`
   - per-role wet share ceiling, especially pad and comp.
2. Split browser-Spessa and Copych expectations:
   - Spessa: CC91/93 are synth internals.
   - Copych: CC91/93 feed shared post-FX, and chorus is summed into reverb/delay input.
3. Reduced Copych shared-FX pressure:
   - lower song-space reverb level/time and feedback for Copych profiles.
   - Copych C++ maps role channels to safer CC91/93/95 sends.
4. Reduced electric-key comp wetness in Copych:
   - comp/pad true delay is disabled inside Copych safe-FX mapping.
   - comp reverb/chorus sends are reduced before entering the shared bus.
5. Added a regression fixture:
   - seed `pitnkl`, styles `rnb` and `pop`.
   - assert drum crest/transient is not buried and Copych wet share is within bounds.
