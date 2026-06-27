# MG Current-Melody Full-Parity Upgrade — Divergence Map + Execution Plan

Source directive: `docs/mg_current_melody_full_parity_upgrade_directive.md` (2026-06-27).
Source of truth: `../melodygenerative` @ `24dfd6f` (pinned). Simulator port is treated as
integration scaffolding only — its melody musical decisions are to be replaced by current MG.

This document is the committed audit-output + execution spine. It is regenerated/refined as
the cross-engine audit (Phase 3·A) produces classified mismatches.

## 1. Divergence Map (read both sides — Phase 3·0, done)

Current MG melody pipeline (`generateImprovisorMelody.ts`, ~19.6k lines total incl. 13.7k-line
`ImprovisorBrickCatalog`):

```
buildChordPart → parseFunctionalRoadMap({part,songKeyPc,style})         [554-brick DP cover]
  → improvisorFunctionalGrammarForStyle(style) + expandGrammarForRoadMap
  → BRANCH: ACG → scheduleAcgCycleCadencePhrases ; else → scheduleBrickExpansions
  → buildGuideTonePlan({chordPart, localScaleContext})
  → realizeTokens({..., guideTonePlan, localScaleContext, preserveSlopeGrammar})
       buildPitchSets(localScaleContext) → buildOrthogonalPitchSets (contract ∩ local scale)
  → renderStyleFeel(feel)
```

Simulator port (`mgLeadRenderer.renderMgMelody`) divergences (the gaps to close):

| # | Gap | Source-of-truth | Simulator now | Bucket |
|---|---|---|---|---|
| G1 | RoadMap family matching | `parseFunctionalRoadMap` over **554-brick** catalog (`ImprovisorBrickCatalog`) | `parseRoadMap` over **73-brick** `melodyBrickDictionary` | roadmap |
| G2 | `localScaleContext` threading | `{style,key,mode}` into guide-tone + realize + every `buildPitchSets` | not threaded anywhere | local-scale |
| G3 | Orthogonal pitch sets | `buildOrthogonalPitchSets` + `chordLikeFromBlock`/`isDeclaredColorPc`/`priorityPcsForOrthogonalContract` (contract ∩ local scale, empty→fallback) | only vocab `buildPitchSets` (context-blind) | intersection |
| G4 | ACG cycle scheduler | `scheduleAcgCycleCadencePhrases` + 5 helpers (cycle-spread cadence line) | ACG uses plain `scheduleBrickExpansions` | scheduler |
| G5 | localScaleResolver | 11-step cascade incl. `jazzChordScale`/`jazzDominantScale`/`rnbDefaultBarScale`/`stableChoice`/altered-#5; `source='jazz-chord-scale'` | 8-step; missing those hooks | local-scale |
| G6 | scale coverage | MG returns scales incl. (verify Neapolitan/Ultra-Locrian/Dom-Diminished) | ~42 scales; verify no missing name the resolver can return | local-scale |
| G7 | grammar stack | functional/builtin/enriched/profiles/runtime/types/LOFI+ACG slope (current) | stale port; assume divergent until proven | grammar |
| G8 | NoteChooser | IV window/softmax/slope/guide-tone over **orthogonal** candidate sets | present, but runs over stale candidate sets (G3) | voice-leading |
| G9 | MelodyShaper | current post-process (local-scale admission, contract, boundary, avoid, slope, slash-bass, borrowed/tonicized, tonal/modal urgency) | stale `shapeMelodyHarmony`; re-audit | shaper |

GrooveContract selection stays arranger-owned (directive §Ownership); renderer consumes the
injected/frozen contract — no repick. For parity, inject the same contract both sides.

## 2. Cross-engine mechanism (Phase 3·A)

- Simulator is a **standalone port** (no live `../melodygenerative` import — comments only).
- Parity = **captured oracle JSON** (`render/__mgOracle__/*.json`).
- MG has `tests/oracle/dump-mg-oracle.ts` (tsx) capturing roadMap + rawMelody + styledMelody +
  scheduledTokens + shaper for POP/LOFI/JAZZ/RNB (no ACG yet), writing INTO the simulator dir.
- Plan: a `dump-mg-oracle-current.ts` adds ACG seeds + the full comparison surface, writes to a
  **fresh** dir (`__mgOracleCurrent__`) so existing parity tests are not clobbered before the port
  is ready. The simulator audit runner diffs each stage vs these oracles, classifies mismatches
  into the buckets above, and emits an ordered task list here.

## 3. Execution order (directive §Implementation Order; dependency-strict)

RoadMap → grammar → scheduler → pitch-sets → NoteChooser → shaper → NoteIR.

1. **3·A** Refresh current-MG oracles (incl. ACG) + build the cross-engine audit runner + classified report.
2. **3·B** Port `parseFunctionalRoadMap` + `ImprovisorBrickCatalog` (554) + current `BrickDictionary`; wire `mgLeadRenderer`. (G1)
3. **3·C-grammar** Re-sync grammar stack. (G7)
4. **3·C-scale** Re-sync `mgLocalScaleResolver` + `mgMusicTheory` scale coverage. (G5,G6)
5. **3·C-thread** Thread `localScaleContext` through guide-tone + realize + every `buildPitchSets`. (G2)
6. **3·C-ortho** Restore orthogonal `PitchClassSets`. (G3)
7. **3·C-acg** Port ACG cycle scheduler. (G4)
8. **3·C-chooser/shaper** Re-audit NoteChooser + MelodyShaper vs current MG. (G8,G9)
9. **3·D** Parity tests + oracle refresh (replace `__mgOracle__`) + non-ACG rebaseline + comment cleanup.

## 4. Rebaseline reality

Non-ACG POP/JAZZ/LOFI/RNB melody seeds **will change**. No legacy zero-shuffle gates for melody.
Melody parity oracles get replaced wholesale at 3·D. The melody parity suite is expected RED
during the port and is driven green stage-by-stage against the fresh oracles. (Comp/bass/harmony
zero-shuffle from prior phases is unaffected until their renderer logic is touched.)

## 5. Invariant fallback (directive §10)

Where a simulator integration boundary makes byte-parity impossible, assert musical invariants
instead (structural notes ∈ contract ∩ local scale or MG empty-intersection fallback; avoid-note
parity; tonicization/modal local-center parity; VL clamp/nearest-midi; ACG cycle span; LOFI/ACG
slope protection; injected feel). Invariant-only acceptance must be justified in the audit report.

## 6. Followup-repair progress (directive `mg_current_full_parity_followup_repair_directive.md`, A–F)

- **A** — live cross-engine audit runner (`scripts/audit-mg-current-parity.ts`, 5-seed; `--full`=30). **done**
- **B** — G1 functional RoadMap: copied `melodyBrickCatalog.ts` (554, verbatim) + ported `mgFunctionalRoadMap.ts`
  (7/7 byte-exact); full ScheduledToken→MgNoteEvent metadata thread (brickName/family/grammarTokenKind/slopeRole). **done**
- **C** — G5 resolver RNB pentatonic/blues candidates; ported post-shaper chain (enforceMonophonic /
  boundaryVL / tailHolds / finalizeVL) into production `renderMgMelody`; oracle re-capture. **done**
- **D** — GrooveContract **all MG-backed styles** (directive 3.2, reverse zero-shuffle): `groovePlanner`
  picks real pool for POP/JAZZ/RNB/LOFI/ACG (was ACG-only); `mgLeadRenderer` lead feel = injected contract
  for all styles (ACG gate removed); `applyGroovePocket` lay-back on lead+bass (excludeRoles skips 走A
  override lead — keeps directive §2.1 no-micro-IOI). Parity expected chains now mirror production
  `fill→replay→pocket→sanitize→legato→sanitize`; repeatGroup lead invariant relaxed to pitch+velocity
  sequence (decision ② 各自人性化, pocket per-section). 1469 green · tsc/build clean. **done — needs ear-check**
  (POP/JAZZ/LOFI/RNB lead feel + lead/bass pocket all changed vs zero-shuffle era; Phase F rebaselines oracle).
- **E** — texture: 4 POP/RNB cases + render + contract-aware `pickTextureForBarWithGroove` + ACG comp density. **todo**
- **F** — re-capture final-lead oracle from MG; expand audit to 30-seed all-stages; ear-check. **todo**
