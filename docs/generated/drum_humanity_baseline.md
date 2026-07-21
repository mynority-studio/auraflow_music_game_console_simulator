# Drum Humanity Production Audit

Current production path: 4 styles x 3 tempos x 3 seeds. MIDI clips are written to `tmp/drum-humanity-baseline/`.

Research anchors: [Groove MIDI Dataset](https://magenta.tensorflow.org/datasets/groove), [GrooVAE](https://magenta.tensorflow.org/groovae), [Ableton grooves](https://www.ableton.com/en/live-manual/12/using-grooves/), [Friberg and Sundstrom swing study](https://www.diva-portal.org/smash/get/diva2%3A1246291/DATASET01.pdf), [Drumeo rock guide](https://www.drumeo.com/beat/a-drummers-guide-to-rock/), [60 Must-Know Drum Fills](https://www.youtube.com/watch?v=7wskFK6HP6w).

## Vocabulary Inventory

| Style | Groove contracts | Pattern families | Base variants | Fill families | Reachable fill recipes | Kits | Authored base pitches | Rendered surfaces |
|---|---:|---:|---:|---:|---:|---|---|---|
| POP | 4 | 5 | 15 | 2 | 60 | 8 | 36, 37, 38, 39, 42, 46, 54 | crash, hat, kick, percussion, snare, tom |
| RNB | 5 | 5 | 15 | 4 | 4 | 8, 25 | 36, 37, 38, 39, 42, 46, 70 | crash, hat, kick, percussion, snare, tom |
| LOFI | 3 | 3 | 9 | 1 | 1 | 25 | 36, 37, 38, 39, 42, 46 | hat, kick, snare |
| JAZZ | 6 | 5 | 13 | 4 | 4 | 8, 40 | 36, 37, 38, 39, 42, 44, 46, 51, 53, 70 | hat, kick, ride, snare, tom |

## Style Summary

| Style | Notes | Rhythm repeat | Performance repeat | Snare accent/ghost | Hat velocity SD | Timing SD ms | Exact-grid |
|---|---:|---:|---:|---:|---:|---:|---:|
| POP | 262 | 0.0% | 0.0% | 43.3 | 10.6 | 1.7 | 51.9% |
| RNB | 276 | 0.0% | 0.0% | 39.0 | 6.7 | 3.4 | 19.7% |
| LOFI | 236 | 0.0% | 0.0% | 27.5 | 8.3 | 3.8 | 13.9% |
| JAZZ | 179 | 4.2% | 4.2% | 0.0 | 10.3 | 2.1 | 25.2% |

## Matrix

| Style | BPM | Seed | Contract | Families | Notes | Rhythm sig | Performance sig | Kick SD | Snare SD | Hat/Ride SD | Timing SD ms |
|---|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| pop | 84 | 3 | pop_citypop_boogie | citypop-syncopated-boogie, citypop-disco-boogie | 288 | 16/16 | 16/16 | 10.9 | 29.8 | 10.8 | 1.4 |
| pop | 84 | 7 | pop_jpop_push_8ths | jpop-driving-8ths, pop-backbeat | 284 | 16/16 | 16/16 | 10.6 | 32.7 | 12.0 | 1.2 |
| pop | 84 | 42 | pop_radio_straight | ballad-halftime, pop-backbeat | 215 | 16/16 | 16/16 | 10.9 | 24.9 | 9.0 | 1.1 |
| pop | 120 | 3 | pop_citypop_boogie | citypop-syncopated-boogie, citypop-disco-boogie | 288 | 16/16 | 16/16 | 10.9 | 29.8 | 10.8 | 1.4 |
| pop | 120 | 7 | pop_jpop_push_8ths | jpop-driving-8ths, pop-backbeat | 284 | 16/16 | 16/16 | 10.5 | 32.7 | 12.0 | 1.3 |
| pop | 120 | 42 | pop_radio_straight | ballad-halftime, pop-backbeat | 215 | 16/16 | 16/16 | 10.9 | 24.9 | 9.0 | 1.1 |
| pop | 168 | 3 | pop_citypop_boogie | citypop-syncopated-boogie, citypop-disco-boogie | 288 | 16/16 | 16/16 | 10.8 | 29.8 | 10.8 | 1.4 |
| pop | 168 | 7 | pop_jpop_push_8ths | jpop-driving-8ths, pop-backbeat | 284 | 16/16 | 16/16 | 10.5 | 32.7 | 12.0 | 1.3 |
| pop | 168 | 42 | pop_radio_straight | ballad-halftime, pop-backbeat | 215 | 16/16 | 16/16 | 10.9 | 24.9 | 9.0 | 1.1 |
| rnb | 84 | 3 | rnb_neo_soul_laidback | tr808-rnb-pocket | 296 | 16/16 | 16/16 | 12.5 | 23.2 | 9.4 | 3.4 |
| rnb | 84 | 7 | rnb_gospel_triplet | rnb-gospel-triplet | 267 | 16/16 | 16/16 | 10.0 | 27.6 | 1.6 | 2.9 |
| rnb | 84 | 42 | rnb_neo_soul_laidback | tr808-rnb-pocket | 264 | 16/16 | 16/16 | 13.0 | 22.8 | 9.2 | 3.6 |
| rnb | 120 | 3 | rnb_neo_soul_laidback | tr808-rnb-pocket | 296 | 16/16 | 16/16 | 12.5 | 23.2 | 9.4 | 3.3 |
| rnb | 120 | 7 | rnb_gospel_triplet | rnb-gospel-triplet | 267 | 16/16 | 16/16 | 10.0 | 27.5 | 1.6 | 2.9 |
| rnb | 120 | 42 | rnb_neo_soul_laidback | tr808-rnb-pocket | 264 | 16/16 | 16/16 | 13.0 | 22.8 | 9.2 | 3.6 |
| rnb | 168 | 3 | rnb_neo_soul_laidback | tr808-rnb-pocket | 296 | 16/16 | 16/16 | 12.5 | 23.2 | 9.4 | 3.4 |
| rnb | 168 | 7 | rnb_gospel_triplet | rnb-gospel-triplet | 267 | 16/16 | 16/16 | 10.0 | 27.5 | 1.6 | 2.8 |
| rnb | 168 | 42 | rnb_neo_soul_laidback | tr808-rnb-pocket | 264 | 16/16 | 16/16 | 13.0 | 22.8 | 9.2 | 3.6 |
| lofi | 84 | 3 | lofi_lazy_dilla | tr808-lofi-minimal, tr808-lofi-boombap | 226 | 16/16 | 16/16 | 12.8 | 15.9 | 8.3 | 4.0 |
| lofi | 84 | 7 | lofi_tape_late_chords | tr808-lofi-dusty-break, tr808-lofi-minimal | 251 | 16/16 | 16/16 | 11.9 | 15.6 | 8.3 | 3.6 |
| lofi | 84 | 42 | lofi_lazy_dilla | tr808-lofi-minimal, tr808-lofi-boombap | 230 | 16/16 | 16/16 | 13.4 | 15.8 | 8.4 | 4.2 |
| lofi | 120 | 3 | lofi_lazy_dilla | tr808-lofi-minimal, tr808-lofi-boombap | 226 | 16/16 | 16/16 | 12.8 | 15.9 | 8.3 | 4.1 |
| lofi | 120 | 7 | lofi_tape_late_chords | tr808-lofi-dusty-break, tr808-lofi-minimal | 251 | 16/16 | 16/16 | 11.9 | 15.6 | 8.3 | 3.4 |
| lofi | 120 | 42 | lofi_lazy_dilla | tr808-lofi-minimal, tr808-lofi-boombap | 230 | 16/16 | 16/16 | 13.4 | 15.8 | 8.4 | 4.1 |
| lofi | 168 | 3 | lofi_lazy_dilla | tr808-lofi-minimal, tr808-lofi-boombap | 226 | 16/16 | 16/16 | 12.8 | 15.9 | 8.3 | 4.3 |
| lofi | 168 | 7 | lofi_tape_late_chords | tr808-lofi-dusty-break, tr808-lofi-minimal | 251 | 16/16 | 16/16 | 11.9 | 15.6 | 8.3 | 2.7 |
| lofi | 168 | 42 | lofi_lazy_dilla | tr808-lofi-minimal, tr808-lofi-boombap | 230 | 16/16 | 16/16 | 13.4 | 15.8 | 8.4 | 4.2 |
| jazz | 84 | 3 | jazz_combo_swing | jazz-brush-ballad, jazz-swing-ride | 186 | 16/16 | 16/16 | 2.2 | 9.6 | 10.3 | 2.3 |
| jazz | 84 | 7 | jazz_combo_swing | jazz-swing-ride, jazz-brush-ballad | 189 | 16/16 | 16/16 | 2.2 | 7.5 | 10.3 | 2.2 |
| jazz | 84 | 42 | jazz_combo_swing | jazz-brush-ballad, jazz-swing-ride, jazz-bebop-comping | 161 | 14/16 | 14/16 | 1.8 | 7.6 | 10.4 | 1.9 |
| jazz | 120 | 3 | jazz_combo_swing | jazz-brush-ballad, jazz-swing-ride | 186 | 16/16 | 16/16 | 2.2 | 9.6 | 10.3 | 2.0 |
| jazz | 120 | 7 | jazz_combo_swing | jazz-swing-ride, jazz-brush-ballad | 189 | 16/16 | 16/16 | 2.2 | 7.5 | 10.3 | 2.3 |
| jazz | 120 | 42 | jazz_combo_swing | jazz-brush-ballad, jazz-swing-ride, jazz-bebop-comping | 161 | 14/16 | 14/16 | 1.8 | 7.6 | 10.4 | 1.9 |
| jazz | 168 | 3 | jazz_combo_swing | jazz-brush-ballad, jazz-swing-ride | 186 | 16/16 | 16/16 | 2.2 | 9.6 | 10.3 | 2.0 |
| jazz | 168 | 7 | jazz_combo_swing | jazz-swing-ride, jazz-brush-ballad | 189 | 16/16 | 16/16 | 2.2 | 7.5 | 10.3 | 2.2 |
| jazz | 168 | 42 | jazz_combo_swing | jazz-brush-ballad, jazz-swing-ride, jazz-bebop-comping | 161 | 14/16 | 14/16 | 1.8 | 7.6 | 10.4 | 1.8 |

## Interpretation

- Rhythm signatures measure score/pattern diversity; performance signatures additionally include velocity.
- Timing is measured against each bar's authored/swing-warped fine grid, so it reports performance displacement rather than the notated swing itself.
- The regression thresholds guard against grid collapse and flat dynamics; the rendered listening clips remain the musical acceptance reference.
