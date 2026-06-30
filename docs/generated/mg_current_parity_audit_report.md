# MG Current-Parity Audit Report (LIVE cross-engine)

- Generated: deterministic (no timestamp; re-run to refresh)
- MG source: `../melodygenerative` @ 24dfd6f **(DIRTY worktree — used as source of truth)**
- Matrix: 30 seeds (30 full), styles POP/JAZZ/RNB/LOFI/ACG
- Live stages in this runner: roadMap (functional RoadMap brick cover).
- Drums/PAD excluded (simulator-owned).

## Verification coverage (what is verified where)

- **roadMap** — verified LIVE here (this runner, 30-seed): simulator `parseFunctionalRoadMap` brick-exact
  to current MG `parseFunctionalRoadMap` on the same normalized chords.
- **scheduled tokens / raw / styled / shaped melody / grammar metadata** — verified byte-exact by the
  parity test suite whose `__mgOracle__` fixtures were **re-captured from current MG @ `24dfd6f`** during
  Phase B/C (`mgScheduledTokens` · `mgEnrichedMelody.parity` · `mgMelodyShaper`/`mgPostShaperChain` ·
  `mgMelodyMetadata` · `mgLocalScaleResolver`). The melody chain uses MG `Random(seed)` faithfully ported as
  `makeSeededRng` (that is how G7/G8/G9 reached byte parity); a live re-run here would recompute the same
  fresh-seed chain → redundant with the re-captured oracles + RNG-alignment risk. Documented boundary.
- **final lead NoteIR / comp texture** — diverge by simulator-render design (repeatGroup replay · leadGapFill ·
  groove pocket · sanitize/legato · contract-aware texture). Asserted as musical invariants per directive §10,
  not byte-parity (see `mgFinalLeadParity` · `productLeadNonMutation` · `textureGrooveAware`).

## Summary by style

| style | pass | fail |
|---|---|---|
| POP | 6 | 0 |
| JAZZ | 6 | 0 |
| RNB | 6 | 0 |
| LOFI | 6 | 0 |
| ACG | 6 | 0 |

**Total: 30 pass / 0 fail.**

## First divergence per seed

- **pop_aa01** [POP]: ✓ all implemented stages exact
- **jazz_aa07** [JAZZ, dominant-chain]: ✓ all implemented stages exact
- **rnb_aa22** [RNB, neo-soul]: ✓ all implemented stages exact
- **lofi_aa11** [LOFI, slope-preservation]: ✓ all implemented stages exact
- **acg_aa01** [ACG, piano top-voice]: ✓ all implemented stages exact
- **pop_bb27** [POP]: ✓ all implemented stages exact
- **pop_cc93** [POP]: ✓ all implemented stages exact
- **pop_dd55** [POP]: ✓ all implemented stages exact
- **pop_7b44e5** [POP]: ✓ all implemented stages exact
- **pop_xm3lg3** [POP]: ✓ all implemented stages exact
- **jazz_bb31** [JAZZ]: ✓ all implemented stages exact
- **jazz_cc64** [JAZZ]: ✓ all implemented stages exact
- **jazz_music_probe** [JAZZ]: ✓ all implemented stages exact
- **jazz_dd12** [JAZZ]: ✓ all implemented stages exact
- **jazz_ee44** [JAZZ]: ✓ all implemented stages exact
- **rnb_bb58** [RNB]: ✓ all implemented stages exact
- **rnb_cc90** [RNB]: ✓ all implemented stages exact
- **rnb_music_probe** [RNB]: ✓ all implemented stages exact
- **rnb_dd17** [RNB]: ✓ all implemented stages exact
- **rnb_ee23** [RNB]: ✓ all implemented stages exact
- **lofi_bb42** [LOFI]: ✓ all implemented stages exact
- **lofi_cc88** [LOFI]: ✓ all implemented stages exact
- **lofi_dd19** [LOFI]: ✓ all implemented stages exact
- **lofi_3xyhma** [LOFI, sparse low-energy]: ✓ all implemented stages exact
- **lofi_ee71** [LOFI]: ✓ all implemented stages exact
- **acg_bb02** [ACG, sparse low-energy]: ✓ all implemented stages exact
- **acg_cc03** [ACG, arpeggio top-voice]: ✓ all implemented stages exact
- **acg_dd04** [ACG]: ✓ all implemented stages exact
- **acg_ee05** [ACG]: ✓ all implemented stages exact
- **acg_ff06** [ACG]: ✓ all implemented stages exact

## Auto follow-up tasks

- **Decided (2026-06-30, not a TODO):** melody stages stay oracle-based, only RoadMap is live. A live re-run
  reproduces the identical fresh-seed output of the re-captured pinned-MG (`@24dfd6f`) oracles → zero added
  verification value + RNG-alignment fragility; `shapeMelodyHarmony`/post-shaper are private MG Engine methods
  (live would need instantiating the Engine). Revisit only if MG un-pins. See runner header for full rationale.
