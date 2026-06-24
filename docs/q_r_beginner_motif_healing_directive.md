# Q+R Beginner Motif Healing Directive

Date: 2026-06-24  
Owner: Claude implementation task  
Scope: Q+R motif sandbox melody input/healing only. Do not rewrite harmony selection, RoadMap, or Q+N default generation. A small render-articulation gate is allowed only where needed to preserve Q+R repeated-note staccato in Q+R preview and Q+R -> Q+N motif override paths.

## 0. Purpose

Q+R motif input must become more beginner-friendly without destroying user identity.

Two user-facing problems need to be solved:

1. Beginner users may input a motif with repeated, emphasized adjacent melodic friction: harsh minor seconds, tritones, sevenths, or other scale/style-inappropriate intervals. The first statements should remain recognizable, but repeated emphasized mistakes should be softened in later developed/varied material.
2. Beginner users may play very short disconnected notes because of finger technique. The system should heal unintended tiny gaps into connected musical durations, while preserving intentional repeated-note staccato.

Important boundary:

- The recording metronome/click is only a capture aid.
- Generation must use the motif's relative shape and then fit/stretch it into brick slots and the song's actual BPM.
- Do not treat capture BPM or count-in timing as the final musical tempo contract.

## 1. Music Theory Basis

This task must distinguish melodic intervals from harmonic intervals.

- A melodic interval is formed by adjacent notes played one after another, so friction detection must scan adjacent note pairs, not only structural-tone pairs.
- Dissonance is style/context dependent. Seconds, tritones, and sevenths cannot be banned globally.
- Weak passing dissonances are often valid when approached and left correctly.
- Jazz and blues deliberately use chromatic approaches, blue notes, b5/#4 colors, and tritone language.

Useful references:

- Open Music Theory, Intervals: melodic intervals are separate successive notes, harmonic intervals are simultaneous notes; consonance/dissonance is contextual. https://viva.pressbooks.pub/openmusictheory/chapter/intervals/
- Music Theory for the 21st-Century Classroom, Second Species Counterpoint: a dissonance on a weak position can be valid as a passing tone when approached and left by step. https://musictheory.pugetsound.edu/mt21c/SecondSpecies.html
- Open Music Theory, First Species Counterpoint: tritone/seventh melodic leaps are strict-style forbidden, which supports treating them as high risk in non-jazz/non-blues beginner repair. https://viva.pressbooks.pub/openmusictheory/chapter/first-species-counterpoint/
- Open Music Theory, 16th-Century Contrapuntal Style: seconds/thirds/fourths/fifths/octaves are common melodic materials, while sevenths and tritones are avoided in strict style. https://viva.pressbooks.pub/openmusictheory/chapter/16th-century-contrapuntal-style/

Do not copy strict counterpoint rules literally. Use them only as a conservative beginner-healing heuristic for modern Q+R styles.

## 2. Non-Goals

- Do not mutate the first user motif quote into a different melody just to pass a rule.
- Do not ban major seconds.
- Do not ban minor seconds in jazz/blues/chromatic approach contexts.
- Do not ban tritones in blues scale, jazz dominant/altered, or chord-scale-supported contexts.
- Do not quantize all user rhythms into boring quarter/eighth notes.
- Do not erase intentional repeated-note staccato.
- Do not make the recording click determine final song BPM.
- Do not change Q+N default generation behavior outside the Q+R motif override path.

## 3. Architecture Overview

Add a small, explicit Q+R "beginner motif healing" layer:

```text
raw MIDI / pad input
  -> hidden-grid or free timing capture
  -> trim head/tail to motif-local time
  -> snap pitch to chosen tonality
  -> build MotifNote[]
  -> heal unintended articulation gaps
  -> recompute accent/structuralToneScore/rhythmCell
  -> analyze user melodic brick
  -> choose progression / RoadMap / melodic slot plan
  -> weave quote/develop/generated lead
  -> repair repeated adjacent melodic friction in non-protected occurrences
  -> sanitize no swallowed notes
  -> render preview or bridge to Q+N
```

Recommended new files:

```text
src/core/generation/motifSandbox/model/scaleStyleIntervalTolerance.ts
src/core/generation/motifSandbox/model/motifArticulationHealer.ts
src/core/generation/motifSandbox/model/motifFrictionRepair.ts
src/core/generation/motifSandbox/model/motifHealingAudit.ts
```

Keep functions pure and deterministic. No DOM/audio/MIDI device dependencies in model files.

## 4. Data Model Additions

Add optional metadata only where useful. Do not make existing call sites rewrite everything.

Suggested additions to `MotifNote`:

```ts
healingTags?: Array<
  | 'intentional-repeat-staccato'
  | 'gap-healed-legato'
  | 'friction-repaired'
  | 'protected-user-quote'
>;
originalMidi?: number;
originalDurationBeat?: number;
articulationLock?: 'staccato-repeat';
```

If this feels too invasive, keep metadata in separate audit structures. But tests need to prove when a note was healed/repaired.

Suggested audit fields in `MotifWeaveAudit` or a sibling debug object:

```ts
articulationGapsHealed: number;
intentionalRepeatStaccatoCount: number;
frictionPairsScanned: number;
frictionPairsFlagged: number;
frictionPairsRepaired: number;
frictionRepairsSkippedByStyleScale: number;
frictionRepairsProtectedQuote: number;
captureBpmUsedForTimingOnly: boolean;
```

UI debug can show these later, but UI work is not required unless trivial.

## 5. Scale x Style Interval Tolerance Table

Implement a two-dimensional tolerance table:

```ts
type IntervalClass = 0 | 1 | 2 | 3 | 4 | 5 | 6;
// 0 unison/octave
// 1 m2 / M7
// 2 M2 / m7
// 3 m3 / M6
// 4 M3 / m6
// 5 P4 / P5
// 6 tritone

type MelodicSpanKind =
  | 'unison'
  | 'step'
  | 'third'
  | 'fourthOrFifth'
  | 'tritone'
  | 'sixth'
  | 'seventh'
  | 'compound';

type IntervalTolerance = {
  baseRisk: number;             // 0..1
  allowedAsPassing: boolean;
  allowedAsStructural: boolean;
  repeatLimit: number;          // strong repeated friction allowed before repair. Usually 2.
  requiresResolution?: boolean;
  reason: string;
};

type ScaleStyleIntervalToleranceProfile = {
  style: 'pop' | 'lofi' | 'rnb' | 'jazz';
  tonality: SandboxTonality;
  intervals: Record<IntervalClass, IntervalTolerance>;
};
```

Important: `IntervalClass` alone is not enough.

Examples:

- M2 and m7 both map to interval class 2, but M2 is common stepwise melody while m7 is a large leap.
- m2 and M7 both map to interval class 1, but m2 can be chromatic approach while M7 is usually a risky leap.

Therefore tolerance lookup must use:

```text
intervalClass + absoluteSemitoneSpan + melodic span kind + direction
```

Do not let an "M2 allowed" rule accidentally allow repeated m7 leaps.

The table must combine:

1. The selected input tonality/scale.
2. The macro style.
3. Whether the interval actually exists naturally inside the current scale's pitch-class set.

Important rule:

```text
Track two separate scale facts:

1. `producedByScalePcs`: the interval can be formed by any two pitch classes in the selected scale.
2. `producedByAdjacentScaleSteps`: the interval occurs between neighboring degrees in the selected scale order.

If an interval is absent from scale pitch classes, it is high risk unless style explicitly permits chromaticism.
If it exists only as a non-adjacent leap, it is more risky than a normal adjacent scale step.
```

Examples:

- `majorPent` / `minorPent` + pop:
  - m2 and tritone are mostly absent -> high risk if emphasized.
  - M2, m3, M3, P4/P5 are normal.
- Major/minor blues + pop:
  - b5/#4 tritone can be a valid blue-note passing color.
  - Blue note as a short/weak neighbor is allowed.
  - Strong repeated blue tritone leaps may still be repaired after repeat limit.
- Major/minor blues + jazz:
  - m2 chromatic approach and tritone colors get broad exemptions when resolved or chord-scale-supported.
- Major/minor + pop/lofi/rnb:
  - M2 is normal melodic motion.
  - m2 is allowed mainly as passing/neighbor motion, not as repeated strong structural emphasis.
  - tritone/seventh leaps are high risk.

Provide defaults for every current `SandboxTonality` and every Q+R style. If a tonality is not known, fall back to parent mode + style.

Current `SandboxTonality` names are:

```ts
'major' | 'minor' | 'majorPent' | 'minorPent' |
'majorBlues' | 'minorBlues' | 'majorBluesPent' | 'minorBluesPent'
```

## 6. Adjacent Melodic Friction Scanner

Create a scanner that uses all adjacent notes, not only structural tones:

```ts
type AdjacentFrictionPair = {
  indexA: number;
  indexB: number;
  onsetA: number;
  onsetB: number;
  midiA: number;
  midiB: number;
  intervalClass: IntervalClass;
  semitones: number;          // signed midiB - midiA
  absoluteSemitones: number;  // abs(semitones), not octave-reduced
  spanKind: MelodicSpanKind;
  direction: -1 | 0 | 1;
  risk: number;
  emphasized: boolean;
  resolved: boolean;
  producedByScalePcs: boolean;
  producedByAdjacentScaleSteps: boolean;
  styleScaleExempt: boolean;
  reason: string[];
};
```

Risk formula should be simple and tunable:

```text
risk = table.baseRisk
     + emphasisBoost
     + unresolvedBoost
     + outOfScaleIntervalBoost
     - passingResolutionDiscount
     - styleScaleExemptionDiscount
     - chordScaleSupportDiscount
```

Suggested scoring:

```text
emphasisBoost:
  either note on beat/downbeat: +0.15..0.25
  either note duration >= 1 beat: +0.20
  either note structuralToneScore >= STRUCTURAL_TONE_MIN: +0.20
  both notes high velocity/accent: +0.10

resolution:
  stepwise into and out of friction note: -0.35
  resolves to pitch-contract stable/color: -0.35
  leaps away unresolved: +0.25

scale/style:
  interval absent from scale pitch classes: +0.25
  interval in scale but not adjacent scale-step language: +0.10
  jazz chromatic approach: -0.45
  blues blue-note/b5 passing: -0.45
  chord-scale supported in current harmony: -0.30
large span:
  m7/M7/seventh leap: +0.35 unless jazz/blues context proves it intentional
  compound leap > octave: +0.45
```

Repair candidate threshold:

```text
risk >= 0.65
and pair is emphasized
and not styleScaleExempt
and occurrence count exceeds repeatLimit
```

## 7. Repetition Rule

The user's intended rule:

```text
If an emphasized friction pattern appears repeatedly, allow at most two appearances.
From the third appearance onward, repair one note to a neighboring/transition tone.
```

Define repeat identity as a "friction cell":

```ts
frictionCellKey = `${intervalClass}:${direction}:${scaleDegreeA}->${scaleDegreeB}`;
```

If scaleDegree is unreliable for chromatic/blues notes, use pitch-class relation:

```ts
frictionCellKey = `${intervalClass}:${direction}:${pcA}->${pcB}`;
```

Count across the final woven lead, not just the raw user motif, so repeated phrase heads are included.

Skip these from friction repair:

- interval class 0 / repeated same-pitch gestures
- notes tagged `intentional-repeat-staccato`
- same-pitch repeated-note runs detected by the articulation healer

Protected cases:

- First user quote occurrence: never repair pitch.
- `occurrenceKind === 'quote'` and label is first-cycle quote: protect.
- First note of the motif: protect.
- Intentional jazz/blues style-scale idioms: protect or strongly discount.

Repairable cases:

- `develop`
- `connect`
- generated slot material
- `quote:vary`
- later quote repetitions after the first two emphasized friction occurrences, if and only if repair is necessary and small.

## 8. Friction Repair Strategy

When repair is needed:

1. Prefer changing the second note of the pair.
2. Never change the first note of the entire motif.
3. Avoid changing notes tagged `protected-user-quote`.
4. Candidate target notes:
   - current pitch contract `stablePcs`
   - then `colorPcs`
   - then `scalePcs`
   - then nearest tonality scale tone
5. Prefer small movement:
   - first try +/-1 semitone
   - then +/-2 semitones
   - max +/-3 semitones unless no valid choice
6. Preserve contour when possible:
   - if original pair was ascending, repaired target should not invert direction unless required.
7. Reclassify/refresh `scaleDegree`, `octave`, and optional `structuralToneScore` after edit.

Do not repair into another high-risk adjacent pair. After editing one note, re-evaluate local pairs `(i-1,i)` and `(i,i+1)`.

## 9. Articulation Healing

Create `healMotifArticulation(notes, opts)` that extends unintended short gaps while preserving repeated-note staccato.

Input:

- normalized local motif notes
- motif length
- style
- tonality
- beatsPerBar

Do not move onsets. Only adjust durations and tags.

### 9.1 Detect Intentional Repeated-Note Staccato

If two or more consecutive notes have the same `midi` and distinct onsets:

```text
C C
C C C
G G G G
```

Mark the run as intentional repeated-note staccato.

Rules:

- Do not extend one repeated same-pitch note into the next same-pitch note.
- Preserve short gaps between repeated same-pitch attacks.
- Render-layer legato must not connect these same-pitch repeated attacks.
- Existing no-swallowed-note sanitizer must still prevent noteOff/noteOn collision.

This is a real performance/phrase gesture, not a beginner mistake.

Implementation requirement:

- In Q+R preview, `buildLeadNotes(...)` / `connectFastLeadNoteIR(...)` must either receive enough metadata to skip `articulationLock === 'staccato-repeat'`, or run a post-legato restore pass for tagged same-pitch repeat notes.
- In Q+R -> Q+N motif override, the same lock must survive through the bridge or be re-derived from adjacent same-pitch repeated notes before rendering.
- Do not change default Q+N generated lead behavior globally; this is only for Q+R motif override lead material.

### 9.2 Heal Non-Repeated Short Gaps

For adjacent notes with different pitch:

```ts
gap = next.onsetBeat - (current.onsetBeat + current.durationBeat)
```

Suggested behavior:

- `gap <= 0`: leave to sanitizer.
- `0 < gap <= 0.25`: extend current duration to nearly next onset.
- `0.25 < gap <= 0.5` and current duration is very short: extend to next clean value if it does not erase a real breath.
- `gap >= 0.75`: treat as intentional rest by default.

Use a small safety gap:

```text
different pitch safety gap: 0.00..0.01 beat
same pitch safety gap: keep original or at least 0.03 beat
```

Allowed target durations:

```text
0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4
```

This allows normal sixteenth/eighth/quarter/half values plus dotted/floating values when musically useful.

### 9.3 Do Not Destroy Motif Shape

Articulation healing must preserve:

- onset sequence
- pitch contour
- note count
- repeated-note attacks
- motif-local identity

It may change:

- durationBeat
- accent/structuralToneScore after recompute
- rhythmCell
- audit tags

## 10. Head/Tail Trimming and BPM Separation

The user clarified an important principle:

```text
Recording click/metronome helps recording only.
It must not become the final generation BPM.
```

Implementation requirements:

1. Leading rest:
   - Default remains no empty start.
   - First real note becomes motif-local onset 0.
   - This is already mostly true in hidden-grid path; audit and preserve it.

2. Trailing rest:
   - Do not keep meaningless capture-window silence as motif body.
   - Compute `realMotifEnd = max(onsetBeat + durationBeat)` after articulation healing.
   - `motif.lengthBeats` should represent the musical motif span needed for brick fitting, not the whole recording window.
   - Round up to a musically useful unit/bar only where existing brick logic requires it.

3. Capture BPM:
   - Can be used to convert raw milliseconds into local beats.
   - Must not be used as authoritative output tempo.
   - Q+R generation should use `MotifWeaverInput.bpm` / selected song BPM as playback BPM.
   - If `motif.bpm` is retained, document it as capture/analysis metadata, not final render tempo.
   - Current code contradicts this: `MotifWeaverResult.playbackBpm` is documented as `motif.bpm`, `generateMotifWeave(...)` returns `playbackBpm: motif.bpm`, and the UI comment says it always uses capture clock. This task must intentionally change that behavior for Q+R generation so capture BPM is not the final render authority.

4. Slot fitting:
   - When motif enters a melodic slot/brick, preserve relative timing shape and scale it to the slot/sub-motif duration.
   - This is where final BPM and form context matter.

Acceptance: the same intended motif shape, represented in motif-local beats, should render the same when fitted into the same brick slot and output BPM, regardless of the helper/capture BPM metadata stored on the motif. Do not require identical raw millisecond recordings at different BPMs to normalize identically; raw milliseconds necessarily convert differently before motif-local normalization.

## 11. Pipeline Integration Points

### 11.1 In `motifAnalysis.ts`

Integrate articulation healing after initial `MotifNote[]` is built and before `contour/rhythmCell` are finalized.

Both paths must be covered:

- `analyzeAndNormalize(...)`
- `analyzeHiddenGridMotif(...)`

After healing:

- recompute `accent`
- recompute `structuralToneScore`
- recompute `contour`
- recompute `rhythmCell`
- update `lengthBeats` if tail trim changes motif span

### 11.2 In `motifWeaver.ts`

After final woven lead is assembled and pitch-contract rectification has run, apply repeated friction repair.

Order:

```text
render slots
-> adapt/rectify generated/developed notes
-> final lead assembly
-> repairRepeatedMelodicFriction(...)
-> sanitizeMotifLeadNotes(...)
-> auditMotifWeave(...)
```

Important: friction repair needs progression/pitch contract context to select replacement tones.

### 11.3 In Q+R -> Q+N Bridge

No new Q+N behavior is required, but the Q+R override lead should carry healed/repaired durations and pitches.

If tags are stripped at bridge boundary, that is fine. The musical result must remain.

## 12. Tests Required

Add focused unit tests. Do not rely only on snapshot or listening tests.

### 12.1 Scale x Style Tolerance Tests

Required cases:

- `major + pop`: M2 allowed, m2 passing only, tritone high risk.
- `majorPent + pop`: m2/tritone absent -> high risk.
- `minorPent + pop`: m2 mostly absent -> high risk if introduced by transform; m3/P4/P5 normal.
- `majorBlues + pop`: blue-note tritone passing allowed, structural repeated tritone limited.
- `minorBlues + jazz`: m2/chromatic approach and b5 colors broadly allowed when resolved.
- `major/minor + jazz`: chromatic approach m2 allowed when step-resolved.
- M2 must not imply m7 is safe: same interval class, different absolute span.
- m2 must not imply M7 is safe: same interval class, different absolute span.

If exact tonality names differ, cover all currently exported `SandboxTonality` values.

### 12.2 Adjacent Friction Scanner Tests

Required cases:

- Scanner checks all adjacent notes, not only structural pairs.
- Weak short m2 passing tone with stepwise resolution is not repaired.
- Strong long repeated m2 in pop/major is flagged after repeat limit.
- Repeated m7/M7 leaps are high risk even though they share interval class with seconds.
- Tritone in majorBlues as b5 passing is exempt or discounted.
- Tritone strong repeated in pop/major is repair candidate from third appearance.
- Jazz chromatic approach is exempt when resolved.
- Same-pitch repeated-note runs are skipped by friction repair.

### 12.3 Friction Repair Tests

Required cases:

- First two emphasized friction occurrences preserved.
- Third occurrence repaired.
- First user quote remains unchanged.
- First motif note remains unchanged.
- Repair changes no more than 3 semitones unless no candidate exists.
- Repair does not create a new higher-risk local adjacent pair.

### 12.4 Articulation Healing Tests

Required cases:

- Different-pitch short gaps are extended into connected musical durations.
- Same-pitch repeated attacks `C C` / `C C C` keep separation and are tagged as intentional repeat staccato.
- Same-pitch repeated attacks remain staccato after Q+R preview render and Q+R -> Q+N motif override render.
- Healer does not move onsets.
- Healer does not change pitch or note count.
- Tail trim removes meaningless recording-window silence.
- Recomputed `rhythmCell` matches healed durations.

### 12.5 BPM Separation Tests

Required cases:

- Capture BPM is not final render BPM.
- Same motif-local beat shape with different stored capture/helper BPM metadata, then fitted to the same slot and output BPM, has matching rendered onset/duration shape within tolerance.
- Q+R preview playback uses the selected output BPM, not a stale capture-only BPM if the two differ.

### 12.6 Regression Tests

Must still pass:

```text
src/core/generation/motifSandbox/model/motifAnalysis.test.ts
src/core/generation/motifSandbox/model/motifHiddenGrid.test.ts
src/core/generation/motifSandbox/model/melodicBrickAnalyzer.test.ts
src/core/generation/motifSandbox/model/motifWeaver.test.ts
src/core/generation/motifSandbox/model/contractRectify.test.ts
src/core/generation/motifSandbox/model/leadLegato.test.ts
src/core/generation/motifSandbox/model/leadSanitizer.test.ts
src/core/generation/motifSandbox/bridge/bluesBridge.test.ts
src/core/generation/newEngine/generation/generateSongFromMotif.test.ts
```

Then run:

```bash
npm test
npm run lint
npm run build
```

## 13. Acceptance Criteria

This task is complete only when all are true:

- Q+R scans adjacent melodic intervals, not only structural-tone intervals.
- Scale x Style tolerance table exists and is used by friction detection.
- Intervals absent from the selected scale are treated as higher risk unless style explicitly permits chromaticism.
- Jazz/blues idioms are not over-repaired.
- Major seconds are not treated as beginner errors.
- Weak step-resolved passing dissonances are preserved.
- Repeated emphasized friction is allowed twice and repaired from the third occurrence onward.
- First user quote remains recognizable and pitch-protected.
- Same-pitch repeated-note staccato is preserved.
- Different-pitch accidental short gaps are healed into connected durations.
- Motif head/tail trimming represents the true motif, not the capture window.
- Capture metronome/BPM is timing assistance only; final generation/playback BPM is the output/song BPM.
- No swallowed-note or same-pitch noteOff regression.
- Full test/lint/build passes.

## 14. Implementation Notes

Keep the first implementation conservative:

- Prefer under-repair over over-repair.
- Use audit counters so musical behavior can be tuned by listening.
- Keep thresholds centralized in `scaleStyleIntervalTolerance.ts`.
- Do not hide repairs. Make them testable and inspectable.

Suggested default thresholds:

```text
risk repair threshold: 0.65
repeat limit for high-risk emphasized friction: 2
weak passing max duration: 0.5 beat
short unintended gap max: 0.25 beat
maybe-heal gap max: 0.5 beat
intentional rest min gap: 0.75 beat
same-pitch repeat safety gap: preserve original, minimum 0.03 beat
```

These values are not sacred. Keep them in one place and add tests around expected behavior.
