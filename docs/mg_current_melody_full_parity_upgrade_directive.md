# Current MG Melody Full-Parity Upgrade Directive

Date: 2026-06-27

This directive supersedes the earlier incremental melody notes. The goal is no
longer to preserve the historical `Newengine_Demo-v1` melody behavior. The goal
is to make simulator's newEngine melody path faithfully follow the current
`../melodygenerative` melody generation pipeline.

## Non-Negotiable Principle

Do not treat the old simulator port as the source of truth.

The old port is useful only as integration scaffolding: path names, NoteIR
conversion, timebase conversion, and simulator render contracts. For melody
generation behavior, the source of truth is the current `../melodygenerative`
code.

If current MG output changes existing simulator POP/JAZZ/LOFI/RNB seeds, accept
the change and rebaseline tests. Do not preserve old seed output by adding
legacy gates, stale parser branches, or partial compatibility modes.

## Claude Must Read First

Claude must read both sides before editing. Do not copy blind.

Current MG source:

- `../melodygenerative/src/lib/improvisor/generateImprovisorMelody.ts`
- `../melodygenerative/src/lib/improvisor/FunctionalRoadMap.ts`
- `../melodygenerative/src/lib/improvisor/ImprovisorBrickCatalog.ts`
- `../melodygenerative/src/lib/improvisor/BrickParser.ts`
- `../melodygenerative/src/lib/improvisor/BrickDictionary.ts`
- `../melodygenerative/src/lib/improvisor/FunctionalGrammar.ts`
- `../melodygenerative/src/lib/improvisor/BuiltinGrammar.ts`
- `../melodygenerative/src/lib/improvisor/EnrichedGrammar.ts`
- `../melodygenerative/src/lib/improvisor/GrammarRuntime.ts`
- `../melodygenerative/src/lib/improvisor/GrammarTypes.ts`
- `../melodygenerative/src/lib/improvisor/LofiGrammarTags.ts`
- `../melodygenerative/src/lib/improvisor/GuideTonePlanner.ts`
- `../melodygenerative/src/lib/improvisor/LickGen.ts`
- `../melodygenerative/src/lib/improvisor/NoteChooser.ts`
- `../melodygenerative/src/lib/improvisor/PitchClassSets.ts`
- `../melodygenerative/src/lib/localScaleResolver.ts`
- `../melodygenerative/src/lib/musicEngine.ts`
- `../melodygenerative/src/lib/musicTheory.ts`
- `../melodygenerative/src/lib/styleDictionary.ts`

Simulator target:

- `src/core/generation/newEngine/render/mgLeadRenderer.ts`
- `src/core/generation/newEngine/render/mgRoadMapParser.ts`
- `src/core/generation/newEngine/render/mgGrammarRuntime.ts`
- `src/core/generation/newEngine/render/mgGuideTonePlanner.ts`
- `src/core/generation/newEngine/render/mgMelodyRealizer.ts`
- `src/core/generation/newEngine/render/mgNoteChooser.ts`
- `src/core/generation/newEngine/render/mgPitchClassSets.ts`
- `src/core/generation/newEngine/render/mgMelodyShaper.ts`
- `src/core/generation/newEngine/knowledge/mgLocalScaleResolver.ts`
- `src/core/generation/newEngine/knowledge/mgMusicTheory.ts`
- `src/core/generation/newEngine/knowledge/mgStyleDictionary.ts`
- `src/core/generation/newEngine/knowledge/melodyBuiltinGrammar.ts`
- `src/core/generation/newEngine/knowledge/melodyStyleGrammarProfiles.ts`
- `src/core/generation/newEngine/knowledge/melodyGrammarTypes.ts`
- `src/core/generation/newEngine/knowledge/melodyLofiGrammarTags.ts`
- `src/core/generation/newEngine/knowledge/melodyBrickDictionary.ts`

## Target Architecture

Simulator should have one current-MG melody path:

1. Convert simulator harmony spans into MG-compatible chord defs.
2. Build `ChordPart`.
3. Parse functional RoadMap with style-aware matching.
4. Expand current MG grammar by style.
5. Schedule tokens:
   - ACG uses current MG cycle-cadence scheduling.
   - other styles use current MG brick scheduling.
6. Build guide-tone plan using `localScaleContext`.
7. Realize tokens using `localScaleContext`.
8. Apply current MG style feel / groove feel.
9. Apply current MG melody harmony shaper.
10. Convert MG `NoteEvent` into simulator `NoteIR`.

The simulator may wrap this for type conversion, but it must not replace the
musical decisions with older simulator-local logic.

## Required Behavioral Ports

### 1. Functional family matching

Replace the old simulator `parseRoadMap({ part, songKeyPc })` path with current
MG:

```ts
parseFunctionalRoadMap({ part: chordPart, songKeyPc, style })
```

This requires porting the current functional catalog path, including:

- `FunctionalRoadMap`
- `ImprovisorBrickCatalog`
- current `BrickDictionary`
- any helpers needed by catalog compilation and contextual pattern filtering

The previous simulator `melodyBrickDictionary` is not enough. It represents an
older smaller brick universe and will produce different family selection.

### 2. Current grammar stack

Re-sync the whole grammar stack from MG:

- functional grammar selector
- builtin grammar
- enriched grammar
- style grammar profiles
- grammar runtime
- grammar token types
- LOFI/ACG slope grammar behavior

Do not assume the old simulator grammar files are still correct because tests
are green. Existing tests are against the old port.

### 3. ACG cycle-cadence scheduler

Current MG ACG melody does not behave like a normal brick-by-brick lick chain.
It stretches a cadence-like upper-line phrase over a harmonic cycle so the
piano texture can breathe.

Port from `generateImprovisorMelody.ts`:

- `scheduleAcgCycleCadencePhrases`
- `inferAcgCycleSpans`
- `hasRepeatedHalves`
- `pickAcgCadenceExpansion`
- `spreadTokensAcrossAcgCycle`
- `fallbackAcgCycleCadenceTokens`

Simulator must not schedule ACG with plain `scheduleBrickExpansions`.

### 4. Local scale context must enter the raw melody generator

Current MG builds:

```ts
const localScaleContext = key && mode
  ? { style: styleKey as StyleName, key, mode }
  : undefined;
```

Simulator must build the same context from the resolved band key/mode and pass
it to:

- `buildGuideTonePlan`
- `realizeTokens`
- every `buildPitchSets` call inside token realization

This is not a post-process-only feature. It changes the candidate pools before
voice-leading chooses a note.

### 5. Orthogonal chord/scale admission

Port the current `PitchClassSets` local-scale branch. Structural melody must be
chosen from:

```txt
written chord contract ∩ resolved local scale
```

If that intersection is empty, fall back to the written chord contract, matching
MG.

This requires the current helpers:

- `chordLikeFromBlock`
- `buildOrthogonalPitchSets`
- `isDeclaredColorPc`
- `priorityPcsForOrthogonalContract`

The simulator must not use only Impro-Visor chord vocab or chord-root scale
heuristics when `localScaleContext` is available.

### 6. Local scale resolver full re-sync

Re-sync `mgLocalScaleResolver` from current MG. Required current behavior
includes:

- `ResolvedLocalScale.source = 'jazz-chord-scale'`
- RNB scale candidates:
  - `Major Pentatonic`
  - `Minor Pentatonic`
  - `Major Blues`
  - `Minor Blues`
  - `Blues`
- `rnbDefaultBarScale`
- `stableChoice`
- `jazzDominantScale`
- `jazzChordScale`
- altered dominant handling including `#5`
- current ordering of forced scale, minor dominant, altered dominant,
  tonicization, modal interchange, RNB default, Jazz chord-scale,
  contract-fit, chord-root, global fallback

Also verify that simulator `mgMusicTheory` contains every scale name the current
resolver can return.

### 7. Voice-leading parity

Simulator already has much of `NoteChooser`, but Claude must compare it against
current MG after the pitch-set changes. Voice-leading parity means:

- same candidate pitch classes
- same register window
- same `prevMidi` nearest-note behavior
- same slope constraints
- same guide-tone binding
- same approach-token target behavior
- same RNG/softmax semantics

Do not say "voice-leading is done" if it is running over stale candidate sets.
The candidate set is part of the voice-leading contract.

### 8. Melody harmony shaper parity

Re-audit `mgMelodyShaper` against the current MG melody post-process in
`musicEngine.ts`. It must include current rules for:

- local scale admission
- melody contract enforcement
- boundary/cadence shaping
- voice-leading clamp rules
- avoid-note handling
- LOFI/ACG slope protection
- slash-bass de-duplication
- borrowed/tonicized chord behavior
- tonal vs modal urgency

If current MG has moved a rule into `localScaleResolver`, `musicTheory`, or
another helper, port the helper rather than duplicating an older local
approximation.

### 9. ACG macro integration

ACG is not just a style enum. For melody it requires:

- current grammar family selection
- ACG cycle cadence scheduling
- `preserveSlopeGrammar`
- local-scale/contract orthogonal admission
- current feel from GrooveContract
- render/shaper rules that do not collapse the long line into short licks

ACG must be included in melody oracle/parity tests. Existing simulator oracles
do not cover ACG.

## Historical Code Cleanup

While doing this work, clean misleading comments that say "strict port" or
"忠实港" when the file is no longer current-MG parity.

Allowed:

- comments that describe current behavior
- comments explaining simulator adapter boundaries

Not allowed:

- comments claiming old loop parity if code diverged
- migration-era excuses
- legacy zero-shuffle gates for melody
- "keep old tests green" branches that bypass current MG behavior

## Tests And Rebaseline

Existing green tests are not sufficient. They prove the old port is internally
stable, not that it matches current MG.

Add or refresh:

1. Functional RoadMap parity
   - compare brick names/families/key pcs against current MG for POP, JAZZ,
     LOFI, RNB, ACG.

2. Pitch-set orthogonal parity
   - borrowed chord
   - secondary dominant
   - modal interchange
   - Jazz altered dominant
   - RNB ordinary diatonic bar

3. ACG scheduler parity
   - repeated half-cycle progression
   - non-repeated long progression
   - assert token starts are cycle-spread, not brick-local.

4. Melody realization parity
   - run the same seed/chords/style through current MG and simulator adapter
   - compare note numbers, starts, durations, origins, grammar metadata where
     simulator preserves it.

5. Full melody oracle refresh
   - regenerate current MG oracles for POP, JAZZ, LOFI, RNB, ACG.
   - include at least two ACG seeds.
   - remove old oracle expectations that encode the stale parser or stale
     pitch-set behavior.

6. Render integration smoke
   - ensure converted `NoteIR` timing stays valid after MG `NoteEvent` parity:
     no negative duration, no out-of-order notes, no invalid MIDI, no dropped
     melody track.

## Acceptance Criteria

- Simulator `mgLeadRenderer` mirrors the current MG stage order.
- Simulator uses current functional family matching, not the older RoadMap
  parser, for melody generation.
- ACG melody uses long-cycle cadence scheduling and no longer sounds like
  short brick-local licks.
- `localScaleContext` reaches guide-tone planning and every token-level
  pitch-set build.
- Structural melody uses chord contract intersected with resolved local scale.
- Jazz/RNB local scale choices match current MG.
- Voice-leading is verified after pitch-set parity, not before.
- ACG is present in melody parity/oracle coverage.
- Old non-ACG simulator melody seeds may change; tests are rebaselined to
  current MG rather than preserved through compatibility gates.

## Implementation Order

1. Re-sync theory/style dependencies needed by the melody path.
2. Port functional RoadMap + catalog and wire `mgLeadRenderer` to it.
3. Re-sync grammar stack.
4. Re-sync localScaleResolver and mgMusicTheory scale coverage.
5. Thread `localScaleContext` through guide-tone and token realization.
6. Restore orthogonal `PitchClassSets`.
7. Port ACG cycle scheduler.
8. Re-audit NoteChooser and MelodyShaper against current MG.
9. Add parity tests and refresh oracles from current MG.
10. Run full test suite and manually inspect ACG/Jazz/RNB seed output.
