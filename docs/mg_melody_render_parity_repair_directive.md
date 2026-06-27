# MG Melody Render Parity Repair Directive

Date: 2026-06-27

## Problem

The simulator's rendered melody can sound different from the current
`../melodygenerative` engine even when the harmony/arranger inputs are close.
This is not just a feel or swing issue. The simulator's MG lead chain is still
partly pinned to an older port:

- RoadMap/family matching uses the old `parseRoadMap` + local brick dictionary.
- ACG does not use the current long-cycle cadence scheduler.
- raw token realization does not receive `localScaleContext`.
- `mgPitchClassSets` lacks the current orthogonal admission path:
  chord contract intersected with the resolved local scale.
- `mgLocalScaleResolver` is behind current MG for Jazz/RNB scale policy.

Result: `voice-leading` exists, but it is choosing from older candidate pitch
sets. Post-render shaping can repair some notes, but it cannot recreate the
same grammar family, phrase timing, or source candidate pool as MG.

## Source Of Truth

Before changing simulator code, Claude must read the current source files in
`../melodygenerative`:

- `src/lib/improvisor/generateImprovisorMelody.ts`
- `src/lib/improvisor/FunctionalRoadMap.ts`
- `src/lib/improvisor/ImprovisorBrickCatalog.ts`
- `src/lib/improvisor/BrickDictionary.ts`
- `src/lib/improvisor/FunctionalGrammar.ts`
- `src/lib/improvisor/GrammarRuntime.ts`
- `src/lib/improvisor/GuideTonePlanner.ts`
- `src/lib/improvisor/LickGen.ts`
- `src/lib/improvisor/PitchClassSets.ts`
- `src/lib/localScaleResolver.ts`

Then compare against simulator:

- `src/core/generation/newEngine/render/mgLeadRenderer.ts`
- `src/core/generation/newEngine/render/mgRoadMapParser.ts`
- `src/core/generation/newEngine/render/mgGrammarRuntime.ts`
- `src/core/generation/newEngine/render/mgGuideTonePlanner.ts`
- `src/core/generation/newEngine/render/mgMelodyRealizer.ts`
- `src/core/generation/newEngine/render/mgPitchClassSets.ts`
- `src/core/generation/newEngine/knowledge/mgLocalScaleResolver.ts`
- `src/core/generation/newEngine/knowledge/melodyBrickDictionary.ts`
- `src/core/generation/newEngine/knowledge/melodyBuiltinGrammar.ts`
- `src/core/generation/newEngine/knowledge/melodyStyleGrammarProfiles.ts`

## Required Fixes

### 1. Replace stale family matching with current functional RoadMap

Current MG calls:

```ts
parseFunctionalRoadMap({ part: chordPart, songKeyPc, style })
```

Simulator currently calls:

```ts
parseRoadMap({ part, songKeyPc })
```

Port the current `FunctionalRoadMap` path into simulator under the existing
newEngine naming style. It must preserve the `style` argument because current
MG gates Jazz-only bricks when style is not Jazz.

Do not keep the old parser as the melody render path once this is wired. It may
remain only as legacy test/debug support if needed.

### 2. Port ACG long-cycle cadence scheduling

Current MG does not schedule ACG tokens per brick. It stretches one cadence-like
cell across a harmonic cycle:

```ts
styleKey === 'ACG'
  ? scheduleAcgCycleCadencePhrases(perBrick, chordPart)
  : scheduleBrickExpansions(perBrick)
```

Simulator currently always uses `scheduleBrickExpansions(perBrick)`. Port:

- `scheduleAcgCycleCadencePhrases`
- `inferAcgCycleSpans`
- `hasRepeatedHalves`
- `pickAcgCadenceExpansion`
- `spreadTokensAcrossAcgCycle`
- `fallbackAcgCycleCadenceTokens`

This is a primary reason ACG melody breathes differently in simulator.

### 3. Thread `localScaleContext` through raw realization

Build the context in `mgLeadRenderer` from the same values already used by
`shapeMelodyHarmony`:

```ts
const localScaleContext = { style, key: musicKey, mode: musicMode }
```

Pass it into:

- `buildGuideTonePlan({ chordPart: part, localScaleContext })`
- `realizeTokens({ ..., localScaleContext })`

Update simulator type imports accordingly.

### 4. Restore orthogonal pitch admission in `mgPitchClassSets`

Current MG `PitchClassSets` has:

```ts
if (localScaleContext) {
  return buildOrthogonalPitchSets(chord, nextChord ?? null, localScaleContext);
}
```

Port the missing functions:

- `chordLikeFromBlock`
- `buildOrthogonalPitchSets`
- `isDeclaredColorPc`
- `priorityPcsForOrthogonalContract`

The structural pool must be:

```txt
melody chord contract ∩ resolved local scale
```

If the intersection is empty, fall back to the chord contract, matching MG.

### 5. Update `mgMelodyRealizer` to use orthogonal sets per token

Current MG `LickGen.realizeTokens` passes `localScaleContext` into both:

- the normal current-chord `buildPitchSets`
- the approach target-chord `buildPitchSets`

Simulator currently calls both without local scale context. Fix both call sites.

### 6. Re-sync `mgGuideTonePlanner`

Current MG guide-tone planning accepts `localScaleContext` and builds guide
tones from the same orthogonal pitch sets. Simulator currently plans guide
tones from older chord/vocab sets only. This causes structural melody anchors
to diverge before NoteChooser even runs.

### 7. Re-sync `mgLocalScaleResolver`

Simulator is missing current MG policy:

- `ResolvedLocalScale.source = 'jazz-chord-scale'`
- RNB contract-fit candidates:
  - `Major Pentatonic`
  - `Minor Pentatonic`
  - `Major Blues`
  - `Minor Blues`
  - `Blues`
- `rnbDefaultBarScale`
- `stableChoice`
- `jazzDominantScale`
- `jazzChordScale`
- current altered-dominant ordering including `#5`
- current placement of minor-dominant handling before altered-dominant

This affects Jazz/RNB macro melody too, not only ACG.

### 8. Keep voice-leading, but fix its input pool

Simulator already has MG-style `mgNoteChooser` voice-leading through `prevMidi`,
nearest-midi choice, slope constraints, guide-tone binding, and softmax choice.
Do not rewrite that logic first.

The bug is that voice-leading is currently applied to stale pitch sets. Fix the
RoadMap/local-scale/orthogonal pool first, then compare `mgNoteChooser` against
MG for small residual drift only.

## Macro Risk Audit

- ACG: high risk and confirmed. Missing cycle cadence scheduling and missing
  orthogonal pitch pools both affect the spacious ACG line.
- JAZZ: high risk. Current MG has `jazzChordScale` / `jazzDominantScale`;
  simulator lacks them, so altered/bebop/lydian-dominant choices can differ.
- RNB: high risk. Current MG has RNB default bar scale and pentatonic/blues
  candidate scales; simulator lacks them.
- LOFI: medium risk. Simulator preserves slope grammar for LOFI, but raw pitch
  pools still miss orthogonal admission.
- POP: medium risk. Fewer exotic scale branches, but secondary dominants,
  borrowed chords, and contract-fit chords can still diverge.

## Tests To Add Or Update

Add tests before re-blessing broad fixtures:

1. `mgPitchClassSets.orthogonal.test.ts`
   - borrowed/modal-interchange chord where local scale excludes one declared
     chord pc.
   - secondary dominant with local tonal center.
   - assert `chordTones` equals contract/intersection behavior from MG.

2. `mgLeadRenderer.acgCycleScheduler.test.ts`
   - ACG progression with repeated halves.
   - assert scheduled token starts are spread across the full cycle, not per
     brick.

3. `mgLocalScaleResolver.currentParity.test.ts`
   - Jazz altered `7#5` / `7b9` / `13`.
   - RNB ordinary diatonic bar.
   - RNB contract-fit fallback using pentatonic/blues candidates.

4. `mgFunctionalRoadMap.parity.test.ts`
   - same chords through MG and simulator produce the same brick family/name
     sequence for POP, JAZZ, LOFI, RNB, ACG.

5. Refresh the existing `__mgOracle__` fixtures from current MG after the code
   paths above are aligned. Current fixtures do not include ACG, so add at
   least two ACG oracle seeds.

## Acceptance Criteria

- `mgLeadRenderer` mirrors current MG stage order:
  1. `buildChordPart`
  2. `parseFunctionalRoadMap`
  3. style grammar expansion
  4. ACG cycle scheduling or normal brick scheduling
  5. guide-tone plan with local scale context
  6. token realization with local scale context
  7. style feel from GrooveContract for ACG, legacy feel for non-ACG if the
     zero-shuffle policy is still required
  8. `shapeMelodyHarmony`

- ACG melody no longer sounds like short brick-by-brick licks; it should regain
  the long upper-line/cadence breathing of current MG.
- Jazz/RNB local scale decisions match current MG.
- Voice-leading still passes existing behavior tests, but now runs over the
  current MG candidate pools.
- If non-ACG zero-shuffle is no longer a product requirement, rebaseline the
  old POP/JAZZ/LOFI/RNB melody oracle fixtures from current MG. If zero-shuffle
  is still required, gate only the new ACG path and document which current MG
  melody upgrades are intentionally not active for legacy styles.
