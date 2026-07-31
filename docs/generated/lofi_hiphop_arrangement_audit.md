# LOFI Hip Hop Arrangement Audit

Generated from 200 deterministic LOFI seeds. This report audits arrangement only; it does not score timbre, EQ, mix, noise, saturation or mastering.

## Hard gates

| Gate | Result | Evidence |
|---|---|---|
| Tempo 70–86 BPM | PASS | 71–85 BPM |
| Two-bar core phrase coverage ≥70% | PASS | average 99.1% |
| Unique one-bar signature ratio ≤35% | PASS | average 11.6% |
| Structural mutation bars ≤25% | PASS | average 0.9% |
| Boom-bap / half-time backbeat anchors | PASS | average 100.0% |
| 2–4 chord short-loop rate ≥70%; all periods ≤8 | PASS | short-loop 91.0%, max period 8 |
| Lead plan 25–45% active + ≥4-bar rest | PASS | average 33.6% |
| Review Lead audible bars 25–45% and no rest-window onset | PASS | seeds 0, 2, 7, 42, 99 |
| Review FinalIR drum unique ratio ≤35% | PASS | seeds 0, 2, 7, 42, 99 |

## Vocabulary coverage

- Phrase identities used: 16.
- Family counts: slow-boombap=127, slow-soul-halftime=36, dusty-dilla-boombap=37.
- Review MIDI: `tmp/lofi-hiphop-arrangement/seed-{0,2,7,42,99}/`.

## Fixed review seeds

| Seed | Contract | Phrase | Planned Lead | Audible Lead | Lead-onsets-in-rest | Final drum unique ratio |
|---:|---|---|---:|---:|---:|---:|
| 0 | lofi_soul_boombap | lofi-boombap-soul-08 | 25.0% | 25.0% | 0 | 17.1% |
| 2 | lofi_soul_boombap | lofi-boombap-soul-08 | 37.5% | 37.5% | 0 | 15.6% |
| 7 | lofi_tape_late_chords | lofi-dilla-dust-01 | 37.5% | 37.5% | 0 | 12.9% |
| 42 | lofi_halftime_dusty | lofi-halftime-soul-03 | 25.0% | 25.0% | 0 | 8.6% |
| 99 | lofi_tape_late_chords | lofi-dilla-dust-04 | 37.5% | 37.5% | 0 | 9.4% |

## Interpretation

- Within one song, the Arranger reuses a selected two-bar phrase; variety is primarily across seeds.
- Bars marked as structural mutations are restricted to scored 4/8-bar cadence positions.
- Dilla timing and velocity remain Performance concerns and are deliberately excluded from structural signatures.
- Lead rests are admitted before NoteIR realization; the final density gate does not manufacture them.
