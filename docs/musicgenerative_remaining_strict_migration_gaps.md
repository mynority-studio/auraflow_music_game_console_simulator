# MusicGenerative Remaining Strict Migration Gaps

Date: 2026-06-09

Audience: Claude

This document contains only the unfinished parts from the MusicGenerative strict migration audit. Do not re-run the whole migration. Do not rewrite the already stable MG lead chain.

## Current Verdict

The current newEngine implementation has completed these parts and they must be preserved:

- MG lead chain is the source of truth for `lead`.
- `renderMgMelody(..., songSeed)` uses the song seed directly.
- Final production lead equals raw MG lead at event level for golden seeds.
- Audit, retry, swing, humanize, dynamics, ending, and density gate do not mutate lead.
- LOFI dense melody post-mix is implemented and only changes `comp` / `bass`.
- Texture vocabulary is present and selectable from the KB layer.

The remaining strict gaps are:

1. `ChordDef` full-field equivalence is still incomplete.
2. Texture render coverage exists, but dry semantic parity with MG is not complete.
3. The exact required parity test files are still missing.

## Non-Negotiable Constraints

Do not change the engine's macro pipeline:

```text
band -> arranger -> harmony -> instrumental/orchestration -> render -> audit/controller
```

Layering rules:

- KB layer stores templates, texture profiles, chord type metadata, borrowed/tonicization labels, and reusable theory data.
- Harmony layer realizes progression slots into full chord definition spans.
- Render layer consumes the full chord definitions and renders MG-compatible melody/texture events.
- Audit layer is read-only. It may report/fail/retry, but must not mutate IR.

Do not move template logic into the main render pipe. Templates belong in KB. Harmony may select/realize them. Render may consume the realized result.

Do not touch these stable behaviors unless a test proves they regressed:

- No `RandomContext.substream('melody')` for MG lead seed.
- No `rng.int(...)` derived MG seed.
- No final tonic snap on lead.
- No lead mutation in `gateByDensity`, `applyDynamics`, `applyEnding`, `applyLeadIns`, `applyHumanize`, `applySwing`, or resolver.
- No lead mutation during `GenerationController` retry.

## Gap A: ChordDef Full Equivalence

### Problem

MG's original `ChordDef` carries more information than the current newEngine render adapter preserves.

The KB progression slots already contain fields such as:

- `borrowedFrom`
- `effectiveFunc`
- `analysisKeyPc`
- `localRoman`
- `tonicizationPlacement`

But the current path drops or rewrites some of them before render:

```text
knowledge/progressions.ts
  -> harmony/progressionRealizer.ts
  -> harmony/HarmonicPlan.ts
  -> render/mgChordDefAdapter.ts
  -> render/mgMelodyShaper.ts / mgLocalScaleResolver.ts
```

The most serious issue is that `mgChordDefAdapter` synthesizes `borrowedFrom` from `roman` when `borrowedSource` exists. This loses source labels such as:

- `parallel minor iv`
- `parallel minor bVI`
- `Dorian IV`
- `Phrygian bII color`
- `soft V/vi`
- `V/ii`
- `ii/IV`

Those strings are musically meaningful. `mgLocalScaleResolver` uses them to choose modal colors such as Dorian, Phrygian, Mixolydian, and Aeolian. Replacing them with roman text changes MG color behavior.

### Required Implementation

Extend the full field path without changing the macro pipeline.

1. Expand harmony definition types.

Files to inspect and update:

- `src/core/generation/newEngine/harmony/progressionRealizer.ts`
- `src/core/generation/newEngine/harmony/HarmonicPlan.ts`
- `src/core/generation/newEngine/harmony/harmonyEngine.ts`

`ResolvedChord` and `ChordSpan` must preserve at least:

- `chordType`
- `bassRole`
- `bassPedalPc`
- `borrowedSource`
- `borrowedFrom`
- `mustResolve`
- `effectiveFunc`
- `forcedScale`
- `localTonalCenterPc`
- `tonicizationPlacement`
- `analysisKeyPc`
- `localRoman`
- `widePianoVoicing` if attached by the wide voicing layer

2. Pass fields through instead of reconstructing them late.

Required behavior:

- `borrowedFrom` must be copied from the source slot or planner output.
- `effectiveFunc` must prefer the harmony-realized value, then fall back to derived T/S/D only if absent.
- `analysisKeyPc` and `localRoman` must not be invented in render. They must be carried from harmony when the chord belongs to a local tonicization/analysis region.
- `tonicizationPlacement` must survive from planner/slot to final `ChordDef`.
- `widePianoVoicing` must survive when present.

3. Expand render-facing MG types.

Files to inspect and update:

- `src/core/generation/newEngine/render/mgChordDefAdapter.ts`
- `src/core/generation/newEngine/render/mgChordPart.ts`
- `src/core/generation/newEngine/render/mgMelodyShaper.ts`

The render-facing `MgChordDef` / `ShaperChord` must not be a narrow subset if downstream MG shapers can consume those fields.

Required final `ChordDef` fields:

- `root`
- `rootMidi`
- `type`
- `roman`
- `bass`
- `bassMidi`
- `duration`
- `forcedScale`
- `notes`
- `notesMidi`
- `effectiveFunc`
- `chordSymbol`
- `borrowedFrom`
- `borrowedSource`
- `mustResolve`
- `tonicizationPlacement`
- `analysisKeyPc`
- `localRoman`
- `widePianoVoicing`

4. Preserve notes correctly.

Rules:

- `notesMidi` must use real chord tones for the wide `chordType`, not the narrow triad fallback.
- `notes` must be a display projection of the same pitch-class content.
- Slash/pedal bass must affect `bass` / `bassMidi`, not silently alter chord tone identity.
- Wide piano voicing should be carried separately as `widePianoVoicing`; do not overwrite the canonical chord tones unless the MG source behavior does so.

### Required Tests

Add:

```text
src/core/generation/newEngine/render/mgChordDefAdapter.fullParity.test.ts
```

The test must include synthetic and real-plan coverage.

Synthetic cases:

- `maj7`, `m7`, `7alt`, `sus`, `add9`, `m11`, `13sus4` keep exact `type`.
- slash chord: `bassMidi % 12 !== rootMidi % 12`.
- pedal bass: `bassMidi` equals the pedal pitch class.
- `borrowedFrom` preserves exact strings, not generated roman fallback.
- `borrowedSource`, `mustResolve`, `forcedScale`, `localTonalCenterPc` survive.
- `tonicizationPlacement`, `analysisKeyPc`, and `localRoman` survive.
- `effectiveFunc` uses harmony-provided value when present.
- `widePianoVoicing` survives by deep equality.
- `notesMidi` contains the real chord tones for the wide type.

Real-plan cases:

- Include at least POP, LOFI, RNB, and JAZZ seeds.
- Include one JPOP/canon ii-V style case if available in current test helpers.
- Assert no final MG shaper path falls back because of missing chord definition fields.

Stop condition for Gap A:

- `mgChordDefAdapter.fullParity.test.ts` passes.
- No code path in `mgChordDefAdapter` fabricates `borrowedFrom` from roman.
- `mgLocalScaleResolver` can see the original borrowed/modal source labels.

## Gap B: Texture Dry Semantic Parity

### Problem

Current texture implementation covers the names and produces non-silent output, but legacy cases are rendered through a family interpreter. That is useful for product handfeel, but it is not strict MG dry parity.

Strict migration requires this distinction:

```text
MG dry renderer:
  exact semantic source of textureCase timing, duration, velocity ratio, and pitch set

Product handfeel layer:
  may apply newEngine pocket, velocity balancing, CC, pad-aware thinning, and anti-gap guards
  but only after dry semantic parity is testable
```

Do not fake parity by comparing newEngine output to itself. The test oracle must come from MG behavior or from fixtures generated from MG behavior.

### Required Implementation

Files to inspect and update:

- `src/core/generation/newEngine/knowledge/textureProfiles.ts`
- `src/core/generation/newEngine/render/textureRenderer.ts`
- `src/core/generation/newEngine/render/textureSchedule.ts`
- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`

Required behavior:

1. Keep texture case metadata in KB.

The KB should continue to expose:

- modern rich profiles
- LOFI profiles
- legacy MG texture cases that are eligible for selection
- render-only MG texture cases that are not selected but must be supported if referenced

2. Add or expose a strict dry texture renderer.

The dry renderer must cover every MG textureCase and produce comparable dry hits:

- `textureCase`
- part role intent: chord/comp/bass where applicable
- `tRel`
- `duration`
- velocity ratio
- pitch set or pitch role set
- voice intent for bass patterns when pitch is filled later

3. Split strict dry semantics from product handfeel if necessary.

Acceptable design:

```text
renderTextureDryHitsStrictMg(...)
  -> exact MG dry semantic events

renderTextureChordHits(...) / renderTextureBassHits(...)
  -> product rendering can call strict dry then apply newEngine handfeel
```

Or:

```text
renderTextureChordHits(..., { mode: 'strictDry' | 'product' })
renderTextureBassHits(..., { mode: 'strictDry' | 'product' })
```

The exact API is up to the existing code style, but tests must prove both:

- strict dry parity exists
- product mode still avoids obvious comp gaps and wrong-clock entrances

4. Do not reintroduce the old texture-switch gap problem.

Product rendering must keep the previous musical constraints:

- texture switches normally happen at section/bar boundaries.
- verse internal switch is low probability.
- verse internal switch only happens at a bar boundary and must use a compatible transition.
- no structural downbeat comp gap unless pad or bass explicitly holds harmony.
- delayed-entry textures should not be selected as stable section texture if they create audible empty starts.
- LOFI pocket values must not make events feel a half-beat late.

### Required Tests

Add:

```text
src/core/generation/newEngine/render/textureCoverage.parity.test.ts
src/core/generation/newEngine/render/textureDryRender.parity.test.ts
```

`textureCoverage.parity.test.ts` must assert:

- all MG modern rich texture cases are represented.
- all MG LOFI texture cases are represented.
- all MG legacy pool texture cases are represented in `TEXTURE_POOL`.
- all MG render-only legacy cases have a renderer.
- no selected textureCase lacks `hasTextureRenderer(textureCase)`.

`textureDryRender.parity.test.ts` must assert, for every textureCase:

```text
mgDryHits = MG oracle dry hits
neDryHits = newEngine strict dry hits
assert semantic equivalent:
  same event count category or same intentional role count
  same tRel grid/offsets
  same duration policy
  same velocity ratio policy
  same pitch-role/pitch-set policy
```

Use canonical chord fixtures:

- major triad
- `maj7`
- `m9`
- `7sus4`
- `13sus4`
- one slash/pedal bass case
- duration 4 beats and 8 beats where the MG case behaves differently across spans

If direct import from `../melodygenerative` is unstable, generate static oracle fixtures under:

```text
src/core/generation/newEngine/render/__mgTextureOracle__/
```

Fixtures must be generated from MG behavior, not handwritten from the newEngine implementation.

Stop condition for Gap B:

- `textureCoverage.parity.test.ts` passes.
- `textureDryRender.parity.test.ts` passes.
- Existing product texture-switch and no-gap tests still pass.

## Gap C: Required Test Command

After implementing Gap A and Gap B, run at minimum:

```bash
npx vitest run \
  src/core/generation/newEngine/render/mgFinalLeadParity.test.ts \
  src/core/generation/newEngine/render/mgChordDefAdapter.fullParity.test.ts \
  src/core/generation/newEngine/render/mgPostMixShaper.test.ts \
  src/core/generation/newEngine/render/textureCoverage.parity.test.ts \
  src/core/generation/newEngine/render/textureDryRender.parity.test.ts \
  src/core/generation/newEngine/render/productLeadNonMutation.test.ts \
  src/core/generation/newEngine/render/textureSwitchMusicality.test.ts \
  src/core/generation/newEngine/render/legacyTextureCoverage.test.ts \
  src/core/generation/newEngine/render/textureRenderer.test.ts \
  src/core/generation/newEngine/knowledge/textureProfiles.test.ts
```

Also keep the current golden lead seeds protected:

```text
7 / lofi
396040 / pop
777870 / rnb
64062 / lofi
633823 / pop
```

For those seeds:

- final production `lead` must equal raw `renderMgMelody(...)` event by event.
- retry must not change lead.
- audit must remain read-only.

## Optional P2 Cleanup

`renderSong()` still returns an empty lead placeholder. The main product path is `renderSongFull`, but this old helper can confuse future audits.

Acceptable fixes:

- mark `renderSong()` as legacy/test-only with a strong comment, or
- rename/deprecate it if no public caller depends on it, or
- add a test that confirms product/UI generation never calls it.

Do not route it into a fake MG chain unless the required `BandSpec`, `ArrangementPlan`, and `InstrumentationPlan` are actually available.

## Final Report Required From Claude

When done, report in this format:

```text
Completed:
- ChordDef full field path: yes/no
- Texture dry semantic parity: yes/no
- Required missing tests added: yes/no

Files changed:
- ...

Tests run:
- command
- result

Golden seeds:
- 7/lofi lead exact: pass/fail
- 396040/pop lead exact: pass/fail
- 777870/rnb lead exact: pass/fail
- 64062/lofi lead exact: pass/fail
- 633823/pop lead exact: pass/fail

Known non-blocking leftovers:
- ...
```

Do not claim "MG fully migrated" until Gap A and Gap B both pass their new parity tests.
