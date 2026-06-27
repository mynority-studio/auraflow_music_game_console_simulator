# ACG Music Fidelity Repair Directive

Date: 2026-06-28

Audience: Claude / next migration agent.

Scope: simulator `newEngine` ACG style, compared against current
`../melodygenerative` ACG output.

## 0. Goal

Restore the musical identity of current MG ACG inside simulator.

The target is not "make simulator ACG pleasant in its own way." The target is:

```txt
simulator ACG should follow current melodygenerative ACG decisions for
family matching, melody grammar, cycle breathing, groove contract, texture
selection, accompaniment register, velocity air, and final melody shaping.
```

Do not solve this by local ear-tuning only. If the upstream family/grammar or
GrooveContract path is different, velocity/reverb tweaks will only mask the
real mismatch.

## 1. Audible Problem

The current simulator ACG migration can sound very different from
`../melodygenerative` on comparable seeds:

- arpeggio/comp layer loses the open cinematic piano space;
- sparse high color notes become mid-register dense support;
- melody phrasing feels less like a long breathed piano sentence;
- lead resolution/tail behavior differs from MG;
- texture case names may look ACG, but the resulting musical behavior is closer
  to generic simulator comping.

This is expected from the current code state. ACG sound is not one module. It is
the combined result of:

```txt
functional family -> grammar -> ACG cycle scheduler -> metadata -> local scale
-> NoteChooser / voice-leading -> style/groove feel -> post-shaper final lead
-> contract-aware texture selection -> ACG air-aware comp render
```

## 2. Root Cause Summary

### 2.1 Family matching starts from the wrong source

Current MG production uses:

```ts
parseFunctionalRoadMap({ part: chordPart, songKeyPc, style })
```

Simulator production still uses the older:

```ts
parseRoadMap({ part, songKeyPc })
```

This means the same ACG harmony may be classified into different brick families.
Once the family differs, grammar expansion, source cadence choice, phrase
contour, and resolution behavior all diverge.

Required repair:

- Port current MG `FunctionalRoadMap` and `ImprovisorBrickCatalog`.
- Use style-aware functional RoadMap in `mgLeadRenderer`.
- Include ACG fixtures in RoadMap parity.

### 2.2 ACG melody breath depends on cycle scheduling plus metadata

MG ACG does not schedule melody as a normal brick-by-brick lick chain. It
stretches a cadence-like upper-line phrase across a harmonic cycle, leaving the
arpeggiated piano body room to breathe.

Current MG ACG scheduler also carries source brick metadata forward:

- `brickIndex`
- `brickStartBeat`
- `brickEndBeat`
- `brickName`
- `brickFamily`

Simulator's ACG scheduler currently has the scheduling idea, but does not fully
carry the same metadata. That prevents downstream boundary and final lead rules
from making MG-equivalent decisions.

Required repair:

- Re-sync `scheduleAcgCycleCadencePhrases` from current MG.
- Re-sync `spreadTokensAcrossAcgCycle` metadata behavior.
- Add ACG scheduler parity tests against current MG, including metadata.

### 2.3 Final lead parity is more than `shapeMelodyHarmony`

MG production lead does not stop at `shapeMelodyHarmony`. Current production
also applies post-shaper rules such as:

- monophonic melody cleanup;
- boundary voice-leading contract;
- tail hold extension;
- final boundary voice-leading.

Those rules depend on grammar and brick metadata such as:

- `grammarTokenKind`
- `grammarSlopeRole`
- `brickIndex`
- `brickStartBeat`
- `brickEndBeat`
- `brickName`
- `brickFamily`

If simulator only proves `shapeMelodyHarmony` parity, the final lead can still
sound different.

Required repair:

- Extend `ScheduledToken` and `MgNoteEvent` to carry full current MG metadata.
- Ensure `mgMelodyRealizer` emits metadata on every audible event.
- Port the post-shaper final lead chain from current MG.
- Update oracle capture so metadata is not stripped from parity tests.

### 2.4 GrooveContract is not yet the full ACG music contract

ACG feel is not just a `textureCase`. It is a contract spanning:

- melody swing;
- comp swing;
- bass/chord/melody pocket;
- accent pattern;
- articulation;
- bass pattern;
- preferred texture cases;
- allowed / forbidden texture cases.

Simulator already places GrooveContract in arranger, which is correct. The
problem is incomplete consumption downstream.

Required repair:

- Arranger selects ACG GrooveContract once.
- Render consumes selected contract; render must not re-pick it.
- Texture planning consumes preferred/allowed/forbidden texture cases.
- Melody style feel consumes `melodySwingRatio`, `articulation`, and
  `accentPattern`.
- Comp/bass/pocket rendering consumes the selected timing fields without
  double humanize/swing.

### 2.5 Generic simulator comp policy erases ACG piano air

MG ACG textures intentionally use:

- high-register color/air notes;
- soft velocities;
- sparse gaps;
- broken 10ths and wide upper color;
- delayed or non-obvious downbeat support.

Generic simulator band-comp policies can destroy that:

- clamp comp under lead floor;
- derive ACG top colors from already-clamped voicing;
- boost velocity globally;
- inject downbeat guide-shell anchors when no pad exists.

Those generic policies are useful for band comp, but wrong for ACG piano air.

Required repair:

- Keep ACG air/high-color notes for ACG texture cases.
- Do not clamp all ACG comp notes below lead floor.
- Avoid automatic downbeat shell injection for sparse ACG air textures.
- Use ACG-specific velocity mapping so soft air notes remain soft.
- Preserve pad collision handling, but do not delete intentional sparse upper
  color.

See also:

- `docs/acg_comp_air_regression_repair_directive.md`

### 2.6 Texture case coverage is incomplete

If GrooveContract prefers a texture case that does not exist in
`TEXTURE_POOL` or render switch, selection silently drifts.

Required repair:

- Ensure all ACG preferred/allowed texture cases exist in the texture KB.
- Ensure all ACG texture cases render.
- Add a coverage test:

```txt
every ACG GrooveContract preferred/allowed texture case
must resolve to a selectable and renderable texture case
or an explicit documented alias.
```

## 3. Required Implementation Order

Do not start by hand-tuning velocity. Fix source-of-truth layers first.

### Phase A: Establish live ACG audit

Add a live audit script or mode that compares simulator ACG against current
`../melodygenerative`.

Minimum first pass:

- 5 ACG seeds;
- include at least one sparse/low-energy seed;
- include at least one arpeggio/top-voice seed;
- include one seed with ACG cycle cadence scheduling;
- output first divergence stage.

Final acceptance should be folded into the broader 30-seed live audit from:

- `docs/mg_current_full_parity_followup_repair_directive.md`

Audit surfaces for ACG:

- selected GrooveContract;
- harmony/chord metadata;
- functional RoadMap bricks;
- grammar tokens;
- scheduled tokens with metadata;
- raw melody;
- styled melody;
- post-shaper final melody;
- selected texture by section/span;
- rendered comp/bass events, excluding simulator-only drums/PAD;
- ACG air-note register and velocity invariants.

### Phase B: Fix family and grammar source

1. Switch ACG production path to current `parseFunctionalRoadMap`.
2. Port current `ImprovisorBrickCatalog`.
3. Ensure ACG style is passed into RoadMap parsing.
4. Rebaseline ACG RoadMap fixtures from current MG.

Acceptance:

- Same normalized ACG chord part yields same RoadMap as current MG.
- Fixture includes brick `name`, `family`, timing, chord indices, and key pc.

### Phase C: Fix ACG scheduler and melody metadata

1. Re-sync current MG ACG cycle scheduler.
2. Carry full metadata through `ScheduledToken`.
3. Carry full metadata through `MgNoteEvent`.
4. Ensure grammar token kind and slope role are emitted.

Acceptance:

- ACG scheduled token parity includes metadata.
- ACG raw melody parity includes metadata.
- Tests fail if metadata is removed.

### Phase D: Fix final lead production chain

1. Port the post-shaper final lead rules from current MG.
2. Ensure the post-shaper chain receives full metadata.
3. Compare final ACG lead against current MG before NoteIR conversion.

Acceptance:

- `shapeMelodyHarmony` parity alone is not accepted as final lead parity.
- Final ACG lead event count, pitch, start, duration, velocity, origin, and
  metadata match current MG in normalized stage tests unless a documented
  simulator ownership boundary applies.

### Phase E: Fix GrooveContract consumption

1. Ensure arranger selects the ACG GrooveContract.
2. Ensure melody renderer consumes selected contract feel.
3. Ensure texture planning consumes selected contract preferences.
4. Ensure comp/bass/melody pocket fields are applied once.

Acceptance:

- Injecting a synthetic ACG GrooveContract changes melody feel and texture
  selection in predictable tests.
- Render does not re-pick GrooveContract.
- Timing tests prove no double swing/humanize.

### Phase F: Fix ACG texture and comp air

1. Use ACG air-aware voicing for ACG texture cases.
2. Preserve high color notes.
3. Lower ACG air velocity mapping to MG-like softness.
4. Prevent generic downbeat shell anchors on sparse ACG air textures.
5. Keep generic band-comp behavior unchanged for non-ACG textures.

Acceptance:

- ACG high-air events remain above the normal comp clamp zone when the current
  MG texture case expects upper color.
- Sparse ACG textures can intentionally start without a downbeat shell.
- Velocity of single-note air/color hits stays soft.
- Existing non-ACG comp collision/yield tests still pass.

## 4. Tests To Add Or Update

Required ACG-specific tests:

- `mgAcgFunctionalRoadMap.parity.test.ts`
- `mgAcgScheduledTokens.currentParity.test.ts`
- `mgAcgMelodyMetadata.test.ts`
- `mgAcgFinalLead.currentParity.test.ts`
- `acgGrooveContractConsumption.test.ts`
- `acgTextureContractSelection.test.ts`
- `acgCompAirFidelity.test.ts`
- `acgMusicLiveAudit.test.ts` or script smoke coverage

Existing tests to treat as insufficient until updated:

- `mgFinalLeadParity.test.ts` if it does not include ACG and current MG live
  comparison.
- `mgRoadMap.parity.test.ts` if it still targets old `parseRoadMap`.
- `mgMelodyShaper.parity.test.ts` if it excludes grammar/brick metadata or
  post-shaper final lead.
- `acgTexture.test.ts` if it only proves case existence, not MG-like register /
  velocity / contract selection.

## 5. Do Not Do These

- Do not fix ACG by only changing velocity, reverb, or EQ.
- Do not keep ACG on old family matching.
- Do not schedule ACG as ordinary brick-by-brick melody.
- Do not strip metadata from fixtures to make tests pass.
- Do not let render pick GrooveContract.
- Do not remove texture names from GrooveContract to hide missing render cases.
- Do not clamp every ACG comp note below lead floor.
- Do not add generic downbeat shell anchors to sparse ACG air textures.
- Do not count simulator-owned drums/PAD as MG parity failures.

## 6. Completion Criteria

ACG music fidelity repair is complete only when:

1. ACG production uses current functional RoadMap with style.
2. ACG scheduler matches current MG cycle scheduling and metadata.
3. `ScheduledToken` and `MgNoteEvent` carry full current MG metadata.
4. Final lead parity includes post-shaper production rules, not only
   `shapeMelodyHarmony`.
5. ACG local scale / chord contract / NoteChooser path uses current MG logic.
6. Arranger-selected GrooveContract drives melody feel, texture choice, and
   pocket timing.
7. ACG texture selection is contract-aware.
8. ACG comp render preserves MG-like high air, soft velocity, and intentional
   gaps.
9. ACG live audit reports either exact normalized parity or explicit invariant
   parity with first divergence stage.
10. ACG listening spot checks are repeated after structural parity, not before.

## 7. Suggested Claude Final Report

Claude should report:

```txt
Implemented ACG repairs:
- ...

MG source snapshot:
- commit:
- dirty:

ACG parity:
- functional RoadMap:
- scheduled tokens:
- raw melody:
- final lead:
- texture selection:
- comp air:

Tests:
- npm test:
- live ACG audit:

Known residual ACG differences:
- ...
```

