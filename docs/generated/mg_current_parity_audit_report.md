# MG Current-Parity Audit Report (LIVE cross-engine)

- Generated: deterministic (no timestamp; re-run to refresh)
- MG source: `../melodygenerative` @ 24dfd6f **(DIRTY worktree — used as source of truth)**
- Matrix: 5 seeds (5 link-up), styles POP/JAZZ/RNB/LOFI/ACG
- Stages implemented: roadMap (Phase A)
- Drums/PAD excluded (simulator-owned).

## Summary by style

| style | pass | fail |
|---|---|---|
| POP | 1 | 0 |
| JAZZ | 1 | 0 |
| RNB | 1 | 0 |
| LOFI | 1 | 0 |
| ACG | 1 | 0 |

**Total: 5 pass / 0 fail.**

## First divergence per seed

- **pop_aa01** [POP]: ✓ all implemented stages exact
- **jazz_aa07** [JAZZ, dominant-chain]: ✓ all implemented stages exact
- **rnb_aa22** [RNB, neo-soul]: ✓ all implemented stages exact
- **lofi_aa11** [LOFI, slope-preservation]: ✓ all implemented stages exact
- **acg_aa01** [ACG, piano top-voice]: ✓ all implemented stages exact

## Auto follow-up tasks

- [ ] (Phase B/C) Add stages: scheduled tokens, raw/styled/shaped melody, final lead NoteIR, comp texture case.
