# MG Current-Parity Audit Report (LIVE cross-engine)

- Generated: deterministic (no timestamp; re-run to refresh)
- MG source: `../melodygenerative` @ 24dfd6f **(DIRTY worktree — used as source of truth)**
- Matrix: 5 seeds (5 link-up), styles POP/JAZZ/RNB/LOFI/ACG
- Stages implemented: roadMap (Phase A)
- Drums/PAD excluded (simulator-owned).

## Summary by style

| style | pass | fail |
|---|---|---|
| POP | 0 | 1 |
| JAZZ | 0 | 1 |
| RNB | 0 | 1 |
| LOFI | 0 | 1 |
| ACG | 0 | 1 |

**Total: 0 pass / 5 fail.**

## First divergence per seed

- **pop_aa01** [POP]: ✗ first divergence at **roadMap** — MG 7 bricks / SIM 7 bricks
  - brick[1] MG=On-Off-Major-V/Turnaround@16+8 SIM=Borrowed-bVII/Borrowed@16+4
- **jazz_aa07** [JAZZ, dominant-chain]: ✗ first divergence at **roadMap** — MG 8 bricks / SIM 10 bricks
  - brick[0] MG=Minor-On/Minor-On@0+4 SIM=Borrowed-i/Borrowed@0+4
- **rnb_aa22** [RNB, neo-soul]: ✗ first divergence at **roadMap** — MG 10 bricks / SIM 11 bricks
  - brick[0] MG=Minor-On/Minor-On@0+4 SIM=Borrowed-i/Borrowed@0+4
- **lofi_aa11** [LOFI, slope-preservation]: ✗ first divergence at **roadMap** — MG 9 bricks / SIM 11 bricks
  - brick[0] MG=On+Nobody's-Approach/GenDom@0+8 SIM=Borrowed-bVII/Borrowed@0+4
- **acg_aa01** [ACG, piano top-voice]: ✗ first divergence at **roadMap** — MG 12 bricks / SIM 11 bricks
  - brick[0] MG=To-Somewhere/GenDom@0+8 SIM=Borrowed-bVII/Borrowed@0+4

## Auto follow-up tasks

- [ ] (3.1 P0) Production RoadMap diverges from current MG `parseFunctionalRoadMap`. Port functional RoadMap + ImprovisorBrickCatalog; pass `style`; retire stale `parseRoadMap` from production.
- [ ] (Phase B/C) Add stages: scheduled tokens, raw/styled/shaped melody, final lead NoteIR, comp texture case.
