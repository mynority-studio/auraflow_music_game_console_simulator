# Motif Brick + Progression Template Integration Directive

Date: 2026-06-16

Scope: Q+R motif sandbox first, designed to merge into `newEngine`

Depends on:

- `docs/motif_weaver_sandbox_claude_implementation.md`
- `docs/motif_weaver_hidden_grid_capture_directive.md`
- `docs/motif_weaver_hidden_grid_followup_directive.md`
- `docs/mg_melody_strict_newengine_migration_directive.md`

## 1. Purpose

The current Q+R sandbox can capture a user motif, quote it, develop it, and generate a simple 16-bar result. Its weak point is harmony: the current `motifHarmony.ts` still behaves like local melody-to-chord guessing, so sparse or ambiguous motifs can collapse into simple progressions such as `V-I-I-I`.

This directive replaces that weak path with a New Engine aligned architecture:

```text
User MIDI motif
  -> UserMotif
  -> UserMelodicBrick
  -> HarmonyIntent
  -> ProgressionPrototype candidate ranking
  -> selected ProgressionSlot[]
  -> HarmonicPlan / RoadMap
  -> anchor user brick
  -> fill remaining melodic bricks with New Engine / MG melody logic
```

The sandbox is allowed to be a prototype UI, but the musical model must move toward `newEngine`, not away from it.

## 2. Product Goals

### Goal 1: Recognize The User Melody As A Brick

The user's captured melody must be promoted from a raw `UserMotif` into a named melodic brick.

Because key, mode, and scale are already fixed before recording, do not overbuild key inference. The first pass should focus on:

- head note
- tail note
- long notes
- strong-beat notes
- structural tone scores
- melodic direction from head to tail
- final approach/resolution motion
- whether the tail lands stable or remains open

The system should classify the motif as one or more likely functions:

```ts
export type UserMelodicBrickFunction =
  | 'opening'
  | 'approach'
  | 'cadence'
  | 'resolution'
  | 'launcher'
  | 'answer'
  | 'passing'
  | 'neighbor'
  | 'arpeggio'
  | 'sequence'
  | 'ambiguous';
```

This classification is probabilistic. Keep multiple candidates with confidence and evidence.

### Goal 2: Select A Chord Progression Template

Do not build the full progression by greedily guessing one chord per bar.

Instead:

1. Load candidate `ProgressionPrototype` objects from `newEngine`.
2. Filter by style, mode, section role, length, and non-jazz preference.
3. Score each template against the user's melodic brick.
4. Pick one template deterministically from the best candidates.
5. Fit it to the target 16-bar sandbox form.
6. Realize it into chords.
7. Parse or expose a RoadMap/brick view.

Primary reference:

- `src/core/generation/newEngine/knowledge/progressions.ts`
- `src/core/generation/newEngine/harmony/progressionRealizer.ts`
- `src/core/generation/newEngine/render/mgRoadMapParser.ts`
- `src/core/generation/newEngine/knowledge/melodyBrickDictionary.ts`

### Goal 3: Build A RoadMap And Reserve Brick Slots

After selecting and realizing the progression:

- Build a harmonic RoadMap from the selected chords.
- Create a parallel melodic roadmap with placeholders.
- Reserve the user's melodic brick at fixed anchor positions.
- Leave explicit slots for assumed bricks: answer, connector, cadence, continuation.

Default anchor policy:

```text
16 bars total
4-bar harmonic cycles
user brick anchor at bars 1, 5, 9, 13
beats 0, 16, 32, 48
```

If the captured motif is 4 bars long, quote only the strongest 1-2 bar sub-brick at repeated cycle heads, preserving development space.

### Goal 4: Fill Non-User Melody With New Engine Logic

The final melody must contain the exact normalized user motif or quote unit at anchor spans.

All other melodic material should be generated using New Engine / MG melody logic where possible:

- Use `renderMgMelody` / MG chain as the long-term target.
- For Phase 1, it is acceptable to keep the current sandbox weaver for non-anchor gaps, but design the data shape so it can be replaced by New Engine lead generation.
- Do not create a second permanent melody engine in `motifSandbox`.

Relevant New Engine path:

- `src/core/generation/newEngine/render/mgLeadRenderer.ts`
- `src/core/generation/newEngine/render/mgRoadMapParser.ts`
- `src/core/generation/newEngine/render/mgGrammarRuntime.ts`
- `src/core/generation/newEngine/render/mgTokenScheduler.ts`
- `src/core/generation/newEngine/render/mgMelodyRealizer.ts`

## 3. Non-Goals And Boundaries

Do not:

- Reintroduce a 4-second capture limit.
- Infer key/BPM from free raw timing in this phase.
- Directly port Java Impro-Visor runtime code.
- Replace `generateSong`.
- Change existing New Engine production behavior unless this work is explicitly wired in later.
- Mutate `renderMgMelody` output for the main generation path.
- Make jazz the default unless `style === 'jazz'`.
- Keep the current `motifHarmony.ts` greedy bar picker as the final harmony path.

Allowed:

- Add sandbox-local adapters that import New Engine knowledge.
- Add new pure functions in `motifSandbox/model`.
- Add future-facing types that can later move into `newEngine`.
- Add debug UI rows showing melodic brick classification, selected prototype, roadmap, and anchor slots.

## 4. Current Problem To Replace

Current path:

```text
UserMotif
  -> harmonizeMotif()
  -> buildPhrase()
  -> buildProgression()
```

Current issue:

- It scores each bar locally.
- Empty/sparse bars fall back to I.
- It cannot understand phrase function.
- It does not know whether a motif is approaching, resolving, opening, or answering.
- It does not use the existing New Engine progression templates.

Replacement path:

```text
UserMotif
  -> analyzeUserMelodicBrick()
  -> inferHarmonyIntent()
  -> rankProgressionTemplates()
  -> selectProgressionForMotif()
  -> realizeRoadmapForMotif()
  -> weaveAnchoredMotifMelody()
```

## 5. Recommended New Files

Keep implementation in `motifSandbox` for the first pass, but use New Engine types as much as possible.

```text
src/core/generation/motifSandbox/model/melodicBrickTypes.ts
src/core/generation/motifSandbox/model/melodicBrickAnalyzer.ts
src/core/generation/motifSandbox/model/melodicBrickHarmonyIntent.ts
src/core/generation/motifSandbox/model/progressionCandidateProvider.ts
src/core/generation/motifSandbox/model/melodyProgressionScorer.ts
src/core/generation/motifSandbox/model/motifProgressionSelector.ts
src/core/generation/motifSandbox/model/motifRoadmap.ts
src/core/generation/motifSandbox/model/anchoredMelodyWeaver.ts
```

Tests:

```text
src/core/generation/motifSandbox/model/melodicBrickAnalyzer.test.ts
src/core/generation/motifSandbox/model/motifProgressionSelector.test.ts
src/core/generation/motifSandbox/model/motifRoadmap.test.ts
src/core/generation/motifSandbox/model/anchoredMelodyWeaver.test.ts
```

Future merge target:

```text
src/core/generation/newEngine/interactiveMotif/
```

Do not move files there yet unless this feature is being wired into production New Engine.

## 6. Data Contracts

### 6.1 UserMelodicBrick

Add a separate brick layer above `UserMotif`.

```ts
export interface UserMelodicBrick {
  id: string;
  sourceMotifId: string;
  keyPc: number;
  mode: 'major' | 'minor';
  lengthBeats: number;
  lengthBars: 1 | 2 | 3 | 4;
  quoteBeats: number;
  head: StructuralMelodyTone | null;
  tail: StructuralMelodyTone | null;
  structuralTones: StructuralMelodyTone[];
  contour: number[];
  rhythmSignature: number[];
  cadenceMotion: CadenceMotion | null;
  functions: UserMelodicBrickFunctionScore[];
  primaryFunction: UserMelodicBrickFunction;
  evidence: string[];
}
```

```ts
export interface StructuralMelodyTone {
  midi: number;
  scaleDegree: number;
  onsetBeat: number;
  durationBeat: number;
  weight: number;
  role: 'head' | 'tail' | 'long' | 'strongBeat' | 'peak' | 'valley';
}

export interface UserMelodicBrickFunctionScore {
  function: UserMelodicBrickFunction;
  confidence: number;
  evidence: string[];
}

export interface CadenceMotion {
  fromDegree: number;
  toDegree: number;
  pattern: '2-1' | '7-1' | '4-3' | '5-1' | '6-5' | 'stepToStable' | 'leapToStable' | 'none';
  strength: number;
}
```

### 6.2 HarmonyIntent

Translate melodic brick evidence into harmony preference.

```ts
export interface MotifHarmonyIntent {
  targetFunctions: Array<'T' | 'S' | 'D'>;
  cadenceNeed: 'none' | 'weak' | 'strong';
  startStability: 'stable' | 'unstable' | 'ambiguous';
  endingStability: 'stable' | 'unstable' | 'open';
  preferTemplateCadence: Array<'open' | 'weak' | 'loop' | 'modal' | 'soft_authentic'>;
  preferredStartDegrees: number[];
  preferredLandingDegrees: number[];
  avoidDegenerateProgressions: string[];
}
```

Default degenerate blacklist:

```text
I-I-I-I
V-I-I-I
I-V-I-I
```

These are not impossible, but they need a much stronger score than richer templates.

### 6.3 SelectedMotifProgression

The selector should return template identity and debug scores.

```ts
import type { ProgressionSlot } from '../../newEngine/knowledge/progressions';
import type { RoadMap } from '../../newEngine/render/mgRoadMapParser';

export interface ProgressionScoreBreakdown {
  templatePrior: number;
  structuralToneSupport: number;
  headFit: number;
  tailFit: number;
  cadenceFit: number;
  functionArcFit: number;
  phraseCycleFit: number;
  degeneratePenalty: number;
  strongNonChordPenalty: number;
}

export interface SelectedMotifProgression {
  prototypeId: string;
  style: string;
  mode: 'Major' | 'Minor';
  slots: ProgressionSlot[];
  fittedBars: number;
  score: number;
  scoreBreakdown: ProgressionScoreBreakdown;
  topCandidates: Array<{
    prototypeId: string;
    score: number;
    scoreBreakdown: ProgressionScoreBreakdown;
  }>;
  harmonicRoadmap?: RoadMap;
  melodicRoadmap: MotifMelodicRoadmap;
}
```

Path note:

- The relative imports above assume the implementation file lives in `src/core/generation/motifSandbox/model`.
- If these types move into `src/core/generation/newEngine/interactiveMotif`, update imports instead of keeping sandbox-relative paths.

## 7. Melodic Brick Analyzer Rules

Implement `analyzeUserMelodicBrick(motif)` as a pure function.

### 7.1 Structural Tone Weight

Use existing `structuralToneScore` when present.

Recommended weight:

```ts
weight =
  0.35 * structuralToneScore
  + 0.25 * durationWeight
  + 0.20 * metricWeight
  + 0.20 * velocityAccent
```

Where:

- long notes matter more than short passing notes.
- downbeat and half-bar notes matter more than offbeat notes.
- the final note gets an extra tail bonus.
- the first note gets a smaller head bonus.

### 7.2 Stability

In major/minor parent scale:

```text
stable degrees: 1, 3, 5
soft stable: 6
tension/open degrees: 2, 4, 7
```

Rules:

- Tail on 1/3/5 with high weight -> `cadence` or `resolution`.
- Tail on 2/4/7 with high weight -> `opening`, `launcher`, or `approach`.
- Head on 1/3/5 with upward motion -> `opening`.
- Long 2 resolving to 1 -> `cadence`.
- 7 to 1 -> `approach` + `resolution`.
- 4 to 3 -> `approach` + `resolution`.
- 5 to 1 -> strong `cadence`.
- Repeated contour shifted by interval -> `sequence`.
- 1-3-5 / 3-5-1 / 5-1-3 -> `arpeggio`.
- Weak short tones between two stronger tones -> `passing`.
- Upper/lower neighbor around a stable tone -> `neighbor`.

Do not force a single label. Return candidate scores.

## 8. Progression Candidate Provider

Implement `getProgressionCandidatesForMotif(args)`.

Use:

- `listProgressionPrototypes`
- `fitProgressionToBars`
- style mapping from sandbox style to `HarmonyStyleName`

Style mapping:

```text
pop  -> POP
lofi -> LOFI
rnb  -> RNB
jazz -> JAZZ
```

Mode mapping:

```text
major -> Major
minor -> Minor
```

Default section role:

```text
verse
```

Candidate policy:

- Prefer `POP`, `LOFI`, `RNB` over `JAZZ` unless style is jazz.
- Prefer 8-bar or 16-bar templates.
- Fit to 16 bars for sandbox output.
- Keep top N debug candidates, at least 5.
- Include fallback candidates only if prototype pool is empty.

## 9. Melody-Progression Scoring

Implement `scoreProgressionAgainstMelodicBrick(brick, candidate)`.

Score should combine:

```text
total =
  templatePrior
  + structuralToneSupport
  + headFit
  + tailFit
  + cadenceFit
  + functionArcFit
  + phraseCycleFit
  - degeneratePenalty
  - strongNonChordPenalty
```

### 9.1 Structural Tone Support

For each structural tone, find the chord active at the same relative beat in the candidate.

Reward:

- structural tone is chord tone
- tail tone is chord tone in the landing chord
- head tone is plausible over the first chord
- long notes are consonant

Light penalty:

- weak/offbeat passing tones not in chord

Strong penalty:

- long/strong tail note clashes with selected cadence chord

### 9.2 Cadence Fit

If melodic brick says `cadence` / `resolution`:

- reward templates with `cadence === 'soft_authentic'` or clear final `V -> I`.
- reward `ii -> V -> I`, `IV -> V -> I`, `V -> I`.
- penalize templates that leave the final anchor unresolved.

If melodic brick says `approach`:

- reward dominant/subdominant motion into a stable landing.
- reward `V`, `ii`, `IV`, `V/target`, `secondary_ii_v`.

If melodic brick says `opening` / `launcher`:

- reward open or loop templates.
- do not over-cadence the first 4 bars.

### 9.3 Degenerate Penalty

Hard-penalize the current bad failure mode:

```text
V-I-I-I
I-I-I-I
I-V-I-I
```

These can still win only if every richer template badly conflicts with the melody.

## 10. RoadMap And Placeholder Bricks

Implement `buildMotifRoadmap(selectedProgression, brick)`.

It should produce a debug-friendly object:

```ts
export interface MotifMelodicRoadmap {
  totalBars: number;
  harmonicBricks: import('../../newEngine/render/mgRoadMapParser').BrickMatch[];
  melodicSlots: MotifMelodicSlot[];
}

export interface MotifMelodicSlot {
  id: string;
  startBeat: number;
  durationBeats: number;
  role: 'userBrick' | 'answer' | 'connector' | 'cadence' | 'continuation';
  source: 'user' | 'generated' | 'placeholder';
  requiredFunction?: UserMelodicBrickFunction;
  anchorMotifId?: string;
}
```

Default 16-bar slots:

```text
bar 1:  userBrick
bar 2-4: answer / continuation
bar 5:  userBrick
bar 6-8: answer / cadence
bar 9:  userBrick
bar 10-12: answer / continuation
bar 13: userBrick
bar 14-16: cadence / outro resolution
```

If `quoteBeats` is 8, userBrick occupies two bars. If the original motif is 4 bars, use the strongest 1-2 bar quote unit as the recurring userBrick and keep the full source motif available through `sourceMotifId` and the caller's original `UserMotif` context.

## 11. Anchored Melody Weaving

Implement `weaveAnchoredMotifMelody(args)`.

Required behavior:

- User motif quote unit is exact after normalization.
- Anchor spans are protected.
- Generated notes must not overlap protected anchor spans.
- Generated notes should be created for all non-anchor melodic slots.
- The final melody should remain sorted and monophonic.

Phase 1 acceptable method:

```text
1. Generate New Engine / MG lead for the selected HarmonicPlan if a sandbox adapter is ready.
2. Remove MG notes inside protected userBrick spans.
3. Insert exact normalized user brick at anchor spans.
4. Smooth only the generated notes around anchors.
5. Never alter the user's protected quote notes.
```

If direct `HarmonicPlan -> renderMgMelody` setup is too much for the first PR, keep current `motifWeaver` answer generation for non-anchor slots, but route harmony through selected `ProgressionPrototype` first.

Long-term target:

```text
Selected ProgressionSlot[]
  -> HarmonicPlan
  -> MG RoadMap
  -> anchor-aware grammar scheduling
  -> TrackIR lead
```

## 12. Integration Steps

### Phase A: Types And Analyzer

Files:

- `melodicBrickTypes.ts`
- `melodicBrickAnalyzer.ts`
- `melodicBrickAnalyzer.test.ts`

Tasks:

- Add `UserMelodicBrick` types.
- Extract structural tones.
- Detect head/tail/long tones.
- Score `approach`, `cadence`, `resolution`, `opening`, `launcher`, etc.
- Keep confidence and evidence for UI/debug.

Acceptance:

- `2 -> 1` tail with long final 1 scores cadence/resolution high.
- `7 -> 1` scores approach/resolution high.
- Long final 4 scores open/launcher higher than cadence.
- Short weak passing notes do not dominate classification.

### Phase B: Template Candidate Provider

Files:

- `progressionCandidateProvider.ts`
- `motifProgressionSelector.test.ts`

Tasks:

- Import `listProgressionPrototypes` and `fitProgressionToBars`.
- Map sandbox style/mode to New Engine style/mode.
- Return fitted 16-bar candidate slots.
- Preserve prototype id and metadata.

Acceptance:

- `pop/major` returns POP candidates.
- `lofi/minor` returns LOFI minor candidates when available.
- `jazz` can return JAZZ candidates.
- Non-jazz styles do not default to JAZZ.

### Phase C: Scoring And Selection

Files:

- `melodicBrickHarmonyIntent.ts`
- `melodyProgressionScorer.ts`
- `motifProgressionSelector.ts`

Tasks:

- Convert brick classification into `MotifHarmonyIntent`.
- Score candidates.
- Select deterministic top candidate using `seed` only for tie-break/top-band selection.
- Penalize degenerate fallback progressions.
- Return top candidates for UI.

Acceptance:

- A cadence-like motif picks a template with strong cadence behavior.
- An opening-like motif picks an open/loop/verse template.
- Sparse motif does not collapse to `V-I-I-I`.
- Empty bars are filled by template, not by local I default.

### Phase D: Realization And RoadMap

Files:

- `motifRoadmap.ts`
- `motifRoadmap.test.ts`

Tasks:

- Convert selected `ProgressionSlot[]` into sandbox chords for Q+R preview.
- Also expose enough data to later produce a real `HarmonicPlan`.
- Build `MotifMelodicRoadmap`.
- Parse harmonic bricks using New Engine `parseRoadMap` when possible.
- Add placeholders for assumed melodic bricks.

Implementation warning:

- `progressionRealizer.ts` is useful as a reference for converting `ProgressionSlot` to realized chord data, but it currently needs `Section`, style, color budget, and RNG context.
- `harmonyEngine.ts` can assemble a full `HarmonicPlan`, but its internal `assemble()` helper is not exported.
- Therefore Phase D should not assume that `ProgressionSlot[] -> HarmonicPlan` is a one-line public API today.
- First PR may build sandbox-local chord data plus `ChordPart -> parseRoadMap`.
- A later PR may add an explicit New Engine adapter such as `buildHarmonicPlanFromProgressionSlots()` if MG lead generation is wired into this feature.

Acceptance:

- Result has 16 bars.
- Roadmap includes harmonic brick matches or explicit Unknown fallbacks.
- Melodic roadmap includes userBrick anchors at beats `0, 16, 32, 48`.
- Each userBrick slot has non-overlapping continuation/cadence slots after it.

### Phase E: Anchored Melody Fill

Files:

- `anchoredMelodyWeaver.ts`
- update `motifWeaver.ts`
- `anchoredMelodyWeaver.test.ts`

Tasks:

- Replace direct `buildProgression(motif, ...)` call with selected progression path.
- Insert exact user brick at anchor spans.
- Generate non-user spans using current sandbox development or New Engine MG adapter.
- Preserve quote unit exactly.
- Ensure generated spans know which roadmap slot they came from.

Acceptance:

- Exact user quote appears at cycle heads.
- Generated melody contains non-user material outside anchors.
- No generated note overlaps protected quote notes.
- Final lead remains monophonic and sorted.
- Existing Q+R lead preview still works.

### Phase F: UI Debugging

File:

- `src/core/generation/motifSandbox/ui/MotifWeaverSandboxPanel.tsx`

Add debug rows:

```text
melodic brick: cadence / approach / opening ...
evidence: tail 2->1, long final 1, strong beat ...
selected progression prototype: pop_4536251_8
top candidates: id + score
roadmap: harmonic brick names
anchor slots: 0 / 16 / 32 / 48
```

Acceptance:

- User can see why a template was selected.
- UI does not expose internal wall-of-text by default; concise rows are enough.
- Debug detail can be collapsible if needed.

## 13. Tests To Add

Run:

```bash
npm run test -- motifSandbox
npm run lint
```

Required test cases:

1. Cadence detection:
   - motif tail `2 -> 1`, final note long/strong.
   - expected primary function `cadence` or `resolution`.

2. Approach detection:
   - motif tail `7 -> 1` or `4 -> 3`.
   - expected `approach` and `resolution` candidates.

3. Opening detection:
   - motif starts on stable tone, moves upward, ends on 2/4/6.
   - expected `opening` or `launcher`.

4. Long-note priority:
   - short passing non-chord tones should not outweigh a long structural tail.

5. Template selection:
   - cadence-like motif chooses a cadence-capable template.
   - opening-like motif chooses a loop/open template.
   - no `V-I-I-I` collapse for sparse input.

6. Roadmap:
   - selected 16-bar progression produces harmonic roadmap.
   - melodic roadmap reserves userBrick slots.

7. Anchoring:
   - exact normalized motif/quote unit appears at all required anchors.
   - generated notes do not overlap anchor spans.

8. Determinism:
   - same motif + seed + style returns same selected prototype and lead.
   - different seed can select among top-band candidates but remains deterministic.

## 14. Migration Strategy Toward New Engine

This work starts in Q+R sandbox, but the data model should be compatible with New Engine.

Do this:

- Use `ProgressionPrototype` and `ProgressionSlot` as the progression truth.
- Keep selected progression metadata.
- Keep roadmap metadata.
- Keep protected user anchor spans as first-class data.
- Keep generated vs user-authored notes distinct.

Avoid this:

- A permanent sandbox-only chord model as the source of truth.
- A permanent sandbox-only lead generator.
- String-only roman parsing when structured `ProgressionSlot` exists.

Future merge target:

```text
New Engine interactive motif mode:

Captured UserMotif
  -> UserMelodicBrick
  -> ArrangementPlan motif binding override
  -> HarmonicPlan selected from progression templates
  -> MG melody with protected user anchors
  -> normal New Engine render coordinator
```

## 15. Final Acceptance

The feature is complete for this directive when:

- Q+R still opens and captures hidden-grid MIDI motifs.
- The captured motif is analyzed into `UserMelodicBrick`.
- UI shows motif function and evidence.
- Harmony selection uses New Engine progression templates.
- The selected template is visible by id/name.
- Generated harmony is not the old `V-I-I-I` local fallback.
- A harmonic roadmap is produced.
- A melodic roadmap reserves user brick and generated placeholders.
- User motif quote is protected and appears in the final lead.
- Non-user melody is filled outside protected spans.
- Tests and TypeScript pass.
