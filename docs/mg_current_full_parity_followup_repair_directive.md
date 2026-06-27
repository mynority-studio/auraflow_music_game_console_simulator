# MG Current Full-Parity Follow-up Repair Directive

Date: 2026-06-28

Audience: Claude / next migration agent.

Scope: `auraflow_music_game_console_simulator` `newEngine`, comparing against the
current sibling source tree `../melodygenerative`.

## 0. Executive Summary

Claude's previous migration made real progress, but it is not complete. The
simulator now contains many MG-named modules and several local parity tests, yet
the production path still diverges from current MG in load-bearing places:

- RoadMap/family matching still uses the older `parseRoadMap` path instead of
  current MG `parseFunctionalRoadMap({ part, songKeyPc, style })`.
- ACG scheduling exists, but it does not propagate current MG brick metadata.
- `MgNoteEvent` does not carry the current MG grammar metadata that the shaper
  uses for boundary and resolution decisions.
- GrooveContract is owned by arranger, which is correct, but most non-ACG
  styles still receive a legacy zero-pocket contract. This contradicts the new
  decision: current MG fidelity is more important than preserving old simulator
  seeds.
- Texture selection does not consume GrooveContract, and several current MG
  POP/RNB texture cases exist only as strings in GrooveContract preferences, not
  as selectable/renderable texture profiles.
- The existing parity tests are too narrow. They verify parts of the old port,
  not full current-MG behavior over a multi-style seed matrix.

This directive supersedes any earlier "zero-shuffle first" migration guidance.
The goal is not to preserve `Newengine_Demo-v1` seed output. The goal is to make
the simulator faithfully consume current MG melody, family matching, grammar,
texture, and GrooveContract semantics while preserving simulator layer
ownership.

## 1. Non-Negotiable Design Decisions

### 1.1 Current MG is the source of truth

Do not treat the existing simulator port as truth just because tests are green.
The simulator port is scaffolding. Current `../melodygenerative` owns musical
behavior for:

- functional family matching
- grammar expansion
- token scheduling
- local scale and chord-contract admission
- NoteChooser voice-leading
- melody style feel
- melody harmonic shaping
- ACG texture identity
- style texture cases and texture selection policy

### 1.2 Layer ownership still matters

Do not copy MG as one giant engine blob. Keep the simulator architecture:

- **Arranger** owns selected GrooveContract.
- **Instrumental / arranger-adjacent planning** chooses texture cases using the
  selected GrooveContract.
- **Knowledge Base** stores reusable static contracts, grammar, scales,
  texture profiles, and theory tables.
- **Render** consumes the selected harmony, texture, GrooveContract, and MG
  melody chain. Render must not secretly re-pick GrooveContract.
- **Simulator-only drums and PAD** are not strict MG parity targets.

### 1.3 No historical compatibility gates

Remove or bypass old gates whose only purpose is "non-ACG zero shuffle." If a
current MG change moves POP/JAZZ/LOFI/RNB seed output, accept it and update the
oracle/audit baseline from current MG.

Forbidden patterns:

```ts
style === 'ACG' ? currentMgBehavior : legacySimulatorBehavior
```

unless the current MG source itself has an ACG-specific branch.

### 1.4 Clarifications to prevent misread

**"Full parity" means full current-MG melody/render logic for the shared
subsystems, not a wholesale replacement of simulator's arranger or product
shell.** The simulator may still own section layout, GM program assignment,
drums, PAD, mix/controller events, and final Timebase/NoteIR conversion. When
testing MG melody stages, feed both sides the same normalized chord/contract
inputs and then require exact parity. When testing end-to-end simulator seeds,
report the first divergence stage and use invariant parity for simulator-owned
surfaces.

**"All styles" means the active MG-backed migration styles: POP, JAZZ, RNB,
LOFI, and ACG.** BLUES is archived/legacy unless the current product surface
explicitly re-enables it. Do not expand this repair into a BLUES migration
unless a test or product entry point proves BLUES is active.

**ACG is a current MG macro/style preference in the new chain, not a request to
revive the old `runMgEngine` store path.** Wire ACG through the same current
simulator newEngine style surfaces that already support it: arranger,
GrooveContract, harmony/progression, texture KB, melody grammar/render, and
audit. Do not add ACG to obsolete UI/store paths unless the product entry point
actually uses those paths.

**Texture selection belongs outside render even when its policy is ported from
MG.** Port MG's contract-aware scoring/filtering, but execute it in arranger /
instrumental planning using the arranger-selected GrooveContract. Render only
consumes the selected texture case and contract fields.

**Use a stable MG source snapshot.** Before regenerating oracle or audit data,
record the current `../melodygenerative` commit hash and dirty-worktree status
in the generated report. If MG is dirty, the report must say it used the dirty
worktree as source of truth.

## 2. Files Claude Must Read Before Editing

Claude must read and compare both sides before changing code.

### 2.1 Current MG source

- `../melodygenerative/src/lib/improvisor/generateImprovisorMelody.ts`
- `../melodygenerative/src/lib/improvisor/FunctionalRoadMap.ts`
- `../melodygenerative/src/lib/improvisor/ImprovisorBrickCatalog.ts`
- `../melodygenerative/src/lib/improvisor/BrickDictionary.ts`
- `../melodygenerative/src/lib/improvisor/BrickParser.ts`
- `../melodygenerative/src/lib/improvisor/FunctionalGrammar.ts`
- `../melodygenerative/src/lib/improvisor/BuiltinGrammar.ts`
- `../melodygenerative/src/lib/improvisor/EnrichedGrammar.ts`
- `../melodygenerative/src/lib/improvisor/GrammarRuntime.ts`
- `../melodygenerative/src/lib/improvisor/GrammarTypes.ts`
- `../melodygenerative/src/lib/improvisor/LickGen.ts`
- `../melodygenerative/src/lib/improvisor/GuideTonePlanner.ts`
- `../melodygenerative/src/lib/improvisor/NoteChooser.ts`
- `../melodygenerative/src/lib/improvisor/PitchClassSets.ts`
- `../melodygenerative/src/lib/localScaleResolver.ts`
- `../melodygenerative/src/lib/musicEngine.ts`
- `../melodygenerative/src/lib/musicTheory.ts`
- `../melodygenerative/src/lib/styleDictionary.ts`

### 2.2 Simulator target files

- `src/core/generation/newEngine/arranger/groovePlanner.ts`
- `src/core/generation/newEngine/arranger/ArrangementPlan.ts`
- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`
- `src/core/generation/newEngine/knowledge/grooveContracts.ts`
- `src/core/generation/newEngine/knowledge/textureProfiles.ts`
- `src/core/generation/newEngine/knowledge/mgLocalScaleResolver.ts`
- `src/core/generation/newEngine/knowledge/mgMusicTheory.ts`
- `src/core/generation/newEngine/knowledge/melodyStyleGrammarProfiles.ts`
- `src/core/generation/newEngine/knowledge/melodyGrammarTypes.ts`
- `src/core/generation/newEngine/render/mgLeadRenderer.ts`
- `src/core/generation/newEngine/render/mgRoadMapParser.ts`
- `src/core/generation/newEngine/render/mgGrammarRuntime.ts`
- `src/core/generation/newEngine/render/mgTokenScheduler.ts`
- `src/core/generation/newEngine/render/mgAcgCycleScheduler.ts`
- `src/core/generation/newEngine/render/mgGuideTonePlanner.ts`
- `src/core/generation/newEngine/render/mgMelodyRealizer.ts`
- `src/core/generation/newEngine/render/mgPitchClassSets.ts`
- `src/core/generation/newEngine/render/mgNoteChooser.ts`
- `src/core/generation/newEngine/render/mgMelodyShaper.ts`
- `src/core/generation/newEngine/render/mgStyleRenderer.ts`
- `src/core/generation/newEngine/render/accompanimentRenderer.ts`
- `src/core/generation/newEngine/render/textureRenderer.ts`
- `src/core/generation/newEngine/render/renderCoordinator.ts`

## 3. Verified Current Gaps

This section records the audit findings that must be fixed. Do not re-debate
these unless code has changed after this directive.

### 3.1 P0: RoadMap/family matching is stale

Current MG production:

```ts
const roadMap = parseFunctionalRoadMap({ part: chordPart, songKeyPc, style });
```

Source:

- `../melodygenerative/src/lib/improvisor/generateImprovisorMelody.ts:52`
- `../melodygenerative/src/lib/improvisor/FunctionalRoadMap.ts:111`

Simulator production still imports and calls old `parseRoadMap` without style:

- `src/core/generation/newEngine/render/mgLeadRenderer.ts:23`
- `src/core/generation/newEngine/render/mgLeadRenderer.ts:84`

Required fix:

1. Port or re-sync current `FunctionalRoadMap` and `ImprovisorBrickCatalog`.
2. Expose a simulator-local wrapper named consistently with the current
   newEngine naming style, for example `parseFunctionalRoadMap`.
3. Pass `style` from `mgLeadRenderer`.
4. Retire old `parseRoadMap` from the production lead path. It may remain only
   for legacy tests/debug if clearly named as legacy.

Acceptance:

- A test proves simulator production lead uses style-aware functional RoadMap.
- Existing `mgRoadMap.parity` must be rebaselined against current MG functional
  RoadMap, not old fixtures.
- Include ACG fixtures.

### 3.2 P0: GrooveContract is not fully consumed

Correct ownership already exists:

- `ArrangementPlan.songGrooveContract`
- `ArrangementPlan.grooveContractBySection`
- `arranger` calls `planGrooveContract`

But current simulator `groovePlanner` still does:

```ts
const song = isACG && rng
  ? pickGrooveContract('ACG', rng.substream('grooveContract'))
  : legacyContractForStyle(style, feel);
```

This keeps POP/JAZZ/LOFI/RNB on legacy no-pocket/no-contract behavior.

Required fix:

1. For every active MG-backed style with a current MG GrooveContract pool
   (POP/JAZZ/RNB/LOFI/ACG), arranger must pick a real GrooveContract from
   `grooveContracts.ts`.
2. Preserve deterministic RNG by using a dedicated `grooveContract` substream.
3. Remove the old "non-ACG legacy contract" behavior from the production path.
4. Keep a narrow fallback only for unknown styles or tests that explicitly
   request legacy behavior.
5. `mgLeadRenderer` must consume `melodySwingRatio`, `articulation`, and
   `accentPattern` from the selected contract for all styles, not only ACG.
6. Global pocket application must consume `bassPocketMs`, `chordPocketMs`,
   `melodyStrongPocketMs`, and `melodyWeakPocketMs` without double-applying
   humanize/swing. Make timing ownership explicit in comments and tests.

Acceptance:

- Tests prove POP/JAZZ/LOFI/RNB/ACG get non-legacy contract IDs when the pool
  has entries. BLUES is not required unless it is active in the product surface.
- Tests prove renderer receives the arranger-selected contract, not a renderer
  re-pick.
- Tests prove lead feel changes when a synthetic injected contract changes
  `melodySwingRatio`.

### 3.3 P1: ACG scheduler lacks current MG brick metadata

Current MG passes source brick metadata through ACG cycle scheduling:

- `../melodygenerative/src/lib/improvisor/generateImprovisorMelody.ts:98`
- `../melodygenerative/src/lib/improvisor/generateImprovisorMelody.ts:184`
- `../melodygenerative/src/lib/improvisor/generateImprovisorMelody.ts:197`

Simulator explicitly does not:

- `src/core/generation/newEngine/render/mgAcgCycleScheduler.ts:9`

Required fix:

1. Extend simulator `ScheduledToken` to carry current MG fields:
   - `brickIndex`
   - `brickStartBeat`
   - `brickEndBeat`
   - `brickName`
   - `brickFamily`
2. Update `scheduleBrickExpansions` and `scheduleAcgCycleCadencePhrases` to
   populate all fields where MG does.
3. For ACG stretched cycles, match MG: source brick identity comes from the
   selected cadence expansion, while start/end beats reflect the stretched
   cycle.

Acceptance:

- ACG scheduler test asserts scheduled tokens contain `brickName` and
  `brickFamily`.
- ACG scheduler parity fixture is regenerated from current MG and includes
  metadata.

### 3.4 P1: Grammar metadata is missing from realized notes

Current MG `NoteEvent` carries:

- `grammarTokenKind`
- `grammarSlopeRole`
- `brickIndex`
- `brickStartBeat`
- `brickEndBeat`
- `brickName`
- `brickFamily`

MG shaper consumes these fields heavily for boundary and resolution logic:

- `../melodygenerative/src/lib/musicEngine.ts:300`
- `../melodygenerative/src/lib/musicEngine.ts:4995`
- `../melodygenerative/src/lib/musicEngine.ts:5206`
- `../melodygenerative/src/lib/musicEngine.ts:5391`
- `../melodygenerative/src/lib/musicEngine.ts:5692`

Simulator `MgNoteEvent` currently lacks several of these fields.

Required fix:

1. Extend `MgNoteEvent`.
2. Update `mgMelodyRealizer` to set:
   - token kind on every emitted audible event
   - slope role for inside/last slope positions
   - full brick metadata copied from `ScheduledToken`
3. Update merge logic to preserve MG metadata exactly, especially same-pitch
   merge behavior and same-brick guard.
4. Update `mgMelodyShaper` to use these fields where current MG uses them.
5. Update shaper oracle serialization to include all metadata, otherwise tests
   can pass while production remains wrong.

Acceptance:

- A unit test fails if metadata is stripped before `shapeMelodyHarmony`.
- Shaper parity fixture includes grammar and brick metadata.
- A boundary-resolution case verifies behavior differs when `grammarSlopeRole`
  is `inside` versus `last`.

### 3.5 P1: Local scale resolver is still behind current MG

Simulator has the orthogonal-pitch direction, but `mgLocalScaleResolver` must
be fully re-synced.

Required current MG behavior includes:

- RNB candidate scales:
  - `Major Pentatonic`
  - `Minor Pentatonic`
  - `Major Blues`
  - `Minor Blues`
  - `Blues`
- `rnbDefaultBarScale`
- current `stableChoice`
- current jazz dominant / altered dominant ordering
- current `ResolvedLocalScale.source` values
- current forced-scale and borrowed-scale precedence

Acceptance:

- Add resolver parity tests using current MG fixtures for POP/JAZZ/RNB/LOFI/ACG.
- Add at least one RNB test where the current resolver chooses a pentatonic or
  blues-family scale that the old simulator resolver could not choose.

### 3.6 P1: Texture KB/render is missing current POP/RNB cases

Current MG defines texture profiles/cases that simulator does not render:

- `Pop_Rnb_Expensive_Add9_Quartal`
- `RnB_Drop2_Color_Answer`
- `RnB_InnerTight_Wide_Color`
- `RnB_Quartal_Breath_Roll`

Current MG sources:

- `../melodygenerative/src/lib/styleDictionary.ts:3341`
- `../melodygenerative/src/lib/musicEngine.ts:9991`
- `../melodygenerative/src/lib/musicEngine.ts:10008`
- `../melodygenerative/src/lib/musicEngine.ts:10021`
- `../melodygenerative/src/lib/musicEngine.ts:10544`

Simulator currently references these names in GrooveContract preferences but
does not expose matching selectable/renderable texture cases.

Required fix:

1. Add current MG texture profiles to `textureProfiles.ts`.
2. Add current MG render cases to `textureRenderer.ts`.
3. Confirm behavior metadata exists in `TEXTURE_BEHAVIOR`.
4. Ensure texture coverage tests fail when a GrooveContract preferred or
   allowed texture case is absent from the texture pool/render switch.

Acceptance:

- A test iterates every `preferredTextureCases` and `allowedTextureCases` in
  `grooveContracts.ts` and asserts each case exists in `TEXTURE_POOL` or an
  explicit documented alias map.
- A dry render test covers all four new POP/RNB cases.

### 3.7 P1: Texture selection must be GrooveContract-aware

Current MG has contract-aware texture selection:

- `pickTextureForBarWithGroove`
- `pickAcgTextureForBar`

Simulator currently calls plain `pickTextureForBar` in instrumentation planning:

- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts:362`
- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts:374`

Required fix:

1. Add a contract-aware picker in the KB or instrumental layer.
2. It must score or filter by:
   - preferred texture cases
   - allowed texture cases
   - forbidden texture cases
   - density compatibility
   - dominant-chain avoidance
   - section role / energy compatibility
3. ACG should use its ACG-specific selection constraints, but the API should not
   be ACG-only.
4. The selected texture case by section must be traceable in audit output.

Acceptance:

- Tests prove a contract with a forbidden texture excludes that texture.
- Tests prove a contract with a preferred texture strongly selects it when all
  other filters pass.
- ACG seed tests prove the selected texture matches MG's spacious piano
  constraints and does not fall back to generic dense comping.

## 4. Cross-Engine Audit Runner Requirement

The previous migration lacks the requested 30-seed cross-engine audit. Add it.

### 4.1 Required script

Create a script, for example:

```txt
scripts/audit-mg-current-parity.ts
```

It must compare simulator against current `../melodygenerative`, not against
stale checked-in simulator oracle.

### 4.2 Seed/style matrix

Minimum matrix:

```txt
POP:  6 seeds
JAZZ: 6 seeds
RNB:  6 seeds
LOFI: 6 seeds
ACG:  6 seeds
```

Total: 30 seeds.

Use fixed deterministic seeds committed in the script. Include at least:

- one sparse/low-energy ACG seed
- one ACG seed with arpeggio/top-voice texture
- one RNB seed with neo-soul/Dilla contract
- one JAZZ dominant-chain seed
- one LOFI slope-preservation seed

### 4.3 What to compare

Drums and PAD are excluded because they are simulator-owned.

Compare or audit all shared MG-backed surfaces:

- selected GrooveContract ID and normalized fields
- harmony/chord metadata used by MG melody:
  - root
  - bass
  - type
  - roman
  - effective function
  - local tonal center
  - borrowed source
  - forced scale
- RoadMap bricks:
  - name
  - family
  - start beat
  - duration
  - chord indices
  - key pc
- grammar expansion tokens by brick
- scheduled tokens including full metadata
- guide-tone plan
- local scale per chord/bar
- raw realized melody before style feel
- styled melody after feel
- shaped melody after `shapeMelodyHarmony`
- final simulator lead `NoteIR` after timebase conversion
- selected comp texture case by section/span
- rendered comp/bass events where MG has an equivalent target

### 4.4 Exact parity versus invariant parity

Use exact parity when both sides are intentionally fed the same normalized
inputs and same random stream. This usually means isolated stage tests or the
audit runner's normalized replay mode, not a naive whole-app seed comparison:

- RoadMap
- grammar tokens
- scheduled tokens
- raw melody
- styled melody
- shaped melody

Use invariant parity only where simulator has unavoidable ownership differences:

- end-to-end simulator arrangement/harmony when it is intentionally not MG's
  full arranger
- final `NoteIR` tick conversion
- GM program assignment
- simulator-owned drum/PAD omission
- mix/controller events

Invariant checks must be explicit, not vague. Examples:

- structural melody pitch class is in `chord contract ∩ resolved local scale`
- avoid notes resolve according to current MG shaper
- `grammarSlopeRole === 'inside'` is protected from boundary rewrite
- ACG high-air texture notes are not clamped under lead floor when the texture
  case is an ACG air case
- comp/bass pocket offsets match selected GrooveContract within tick rounding

### 4.5 Output artifacts

The script must write:

```txt
docs/generated/mg_current_parity_audit_report.md
tmp/mg-current-parity-audit.json
```

The markdown report must include:

- pass/fail summary by style and seed
- first divergence stage
- compact diff for the first failing event/token/brick
- automatically generated follow-up task bullets

The JSON must be machine-readable and include enough normalized data to debug
without re-running both engines.

### 4.6 Required npm command

Add a package script:

```json
{
  "audit:mg-current": "tsx scripts/audit-mg-current-parity.ts"
}
```

Acceptance:

- `npm run audit:mg-current` runs from simulator repo root.
- It can locate `../melodygenerative`.
- It fails non-zero on parity failure unless invoked with an explicit
  `--write-report-only` flag.

## 5. Required Implementation Order

Do the work in this order. Do not start with renderer polishing before the
source candidate/family chain is current.

### Phase A: Source-of-truth audit harness

1. Add the 30-seed audit runner skeleton.
2. Produce a current failing report before behavior changes.
3. Ensure the report identifies first divergence stage.

### Phase B: Functional RoadMap and grammar metadata

1. Port `FunctionalRoadMap` and `ImprovisorBrickCatalog`.
2. Switch production `mgLeadRenderer` to style-aware functional RoadMap.
3. Rebaseline RoadMap parity from current MG.
4. Add full scheduled-token and note metadata.
5. Update ACG cycle scheduler metadata.

### Phase C: Raw melody current-MG parity

1. Re-sync `mgLocalScaleResolver`.
2. Confirm `mgPitchClassSets` uses current orthogonal admission.
3. Re-sync `mgGuideTonePlanner` and `mgMelodyRealizer` where needed.
4. Re-sync `mgMelodyShaper` only after metadata is available.
5. Rebaseline raw/styled/shaped melody fixtures from current MG.

### Phase D: GrooveContract integration

1. Arranger selects real contracts for all MG-backed styles.
2. Renderer consumes selected contract feel for all styles.
3. Pocket timing ownership is tested and documented.
4. Remove non-ACG legacy gate from production path.

### Phase E: Texture and ACG comp air

1. Add missing POP/RNB texture profiles and render cases.
2. Make texture selection GrooveContract-aware.
3. Preserve ACG high-air render policy from
   `docs/acg_comp_air_regression_repair_directive.md`.
4. Add coverage tests linking GrooveContract texture preferences to real
   selectable/renderable cases.

### Phase F: Full validation

1. Run unit tests.
2. Run `npm run audit:mg-current`.
3. Run a listening/export spot check for at least:
   - 2 ACG seeds
   - 1 RNB seed
   - 1 JAZZ seed
   - 1 LOFI seed
4. Update the generated audit report.

## 6. Test Requirements

Add or update tests. Do not rely only on existing green tests.

Required test groups:

- `mgFunctionalRoadMap.parity.test.ts`
- `mgScheduledTokens.currentParity.test.ts`
- `mgAcgCycleScheduler.currentParity.test.ts`
- `mgMelodyMetadata.test.ts`
- `mgLocalScaleResolver.currentParity.test.ts`
- `mgShaperMetadataBoundary.test.ts`
- `grooveContractAllStyles.test.ts`
- `textureGrooveContractSelection.test.ts`
- `textureProfilesGrooveCoverage.test.ts`
- `mgCurrentThirtySeedAudit.test.ts` or equivalent script-level smoke test

Existing tests that must be treated with suspicion until updated:

- `mgRoadMap.parity.test.ts` because it currently tests old `parseRoadMap`.
- `mgFinalLeadParity.test.ts` because it covers only six non-ACG seeds and
  compares simulator raw lead to simulator final lead, not current MG source.
- any shaper parity fixture that omits grammar/brick metadata.

## 7. Completion Criteria

This task is complete only when all are true:

1. Production melody path calls current functional RoadMap with `style`.
2. Scheduled tokens and realized notes carry full current MG grammar/brick
   metadata.
3. ACG cycle scheduler matches current MG metadata behavior.
4. Local scale resolver, pitch-set admission, guide-tone planning, NoteChooser,
   and shaper are all fed the same inputs current MG expects.
5. Arranger selects real GrooveContracts for all MG-backed styles.
6. Render consumes selected GrooveContract for melody feel and pocket timing.
7. Texture selection is GrooveContract-aware.
8. All GrooveContract texture preferences resolve to implemented texture cases
   or documented aliases.
9. Missing POP/RNB texture render cases are implemented.
10. `npm run audit:mg-current` exists and covers 30 seeds across POP/JAZZ/RNB/
    LOFI/ACG.
11. The generated audit report shows either exact parity or explicit invariant
    parity with a justified reason for every non-exact surface.
12. Full tests pass.

## 8. Do Not Do These

- Do not bless simulator output as the new oracle without first generating a
  current MG source comparison.
- Do not keep ACG as the only style using current GrooveContract behavior.
- Do not strip metadata from fixtures to make parity tests pass.
- Do not fix melody after the fact with broad snap rules when the candidate pool
  or family matching is stale.
- Do not hide texture gaps by removing names from GrooveContract preferences.
- Do not route GrooveContract picking into render. Arranger owns selection.
- Do not count drums/PAD differences as MG parity failures.

## 9. Suggested Final Report Format For Claude

When done, Claude should report:

```txt
Implemented:
- ...

Current MG source commit/hash or worktree status:
- ...

Parity:
- npm test: ...
- npm run audit:mg-current: ...
- generated report: docs/generated/mg_current_parity_audit_report.md

Known residual differences:
- ...

Files changed:
- ...
```

If any exact parity target is not exact, Claude must name the first divergence
stage and explain whether it is:

- a real migration bug,
- an intentional simulator ownership difference,
- or an impossible comparison due to missing source instrumentation.
