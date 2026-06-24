# Q+R Blues Chord Contract · Follow-up Audit Directive

Date: 2026-06-24  
Purpose: supplement and repair the previous `q_r_blues_chord_contract_directive.md` implementation.  
Scope: targeted fixes only. Do not rewrite the whole Q+R motif sandbox.

## 0. Context

Claude implemented the main blues chord contract task in phases:

- input tonality propagation
- `pitchContract.ts`
- bounded blues chord seasoning
- contract-aware melody rectification
- audit counters/UI
- Q+R -> Q+N bridge tests
- comp no-3 shell avoidance

The direction is good, but audit found several important gaps. This document is a **follow-up audit directive**, not a replacement for the previous MD.

## 1. Findings To Fix

### P1. Q+R -> Q+N bridge loses blues chord-scale color

Current issue:

- Q+R `seasonChord()` may add a blue note into `realTonePcs`.
- But `realType` is often collapsed to plain `'7'`.
- `sandboxToHarmonicPlan.ts` only passes `realType/chordType` into Q+N `assemble()`.
- Q+N therefore builds a normal dominant chord-scale and loses the Q+R blue-color note.

Observed example:

```txt
Q+R seasoned G7 realTonePcs contains Eb
Q+N HarmonicPlan span becomes chordType "7"
Q+N chordScaleMap does not contain Eb
```

This violates the contract goal: Q+R's realized blues-compatible chord must remain the authority when routed into Q+N.

### P1. `approachPcs` is too broad and weak audit becomes meaningless

Current issue:

- `pitchContract.ts` sets `approachPcs` to every remaining pitch class not in stable/color/scale.
- `classifyMelodyNoteAgainstContract()` labels any weak note in `approachPcs` as `approach`.
- It does not check whether the note is actually a chromatic/blue approach that resolves by step to a supported note.

Observed behavior:

Over C major I, weak C#/Eb/F#/Ab/Bb all classify as `approach` even with no context/resolution check.

This makes:

- `weakUnsupported` too low
- `contractPassRatio` too high
- bad weak chromatic notes look valid

### P2. Quote structural blue notes are hidden as `quote-blue`

Current issue:

- `classifyMelodyNoteAgainstContract()` returns `quote-blue` for unsupported quote blue notes.
- `jazzinessAudit.ts` treats that as supported, not as `quoteStructuralUnsupported`.

But the desired behavior is:

- Preserve first quote and user identity.
- Do **not** mutate quote just to pass audit.
- Still report unsupported quote structural tones clearly, because that means harmony did not fully support the user's motif.

### P2. Progression selection is still not blues-aware

Current issue:

- `selectProgressionForMotif(...)` does not receive `inputTonality`.
- `scoreProgressionAgainstMelodicBrick(...)` does not know whether the user input was `majorBlues` or `minorBlues`.
- Current implementation mainly selects a template as before, then applies seasoning after realization.

This is acceptable as a first pass, but incomplete. At minimum, scoring should know when strong structural blue notes exist and reward templates/slots that provide S/D/borrowed/secondary seasoning opportunities at those beats.

## 2. Required Fixes

## 2.1 Preserve blues chord-scale into Q+N

### Goal

When Q+R creates a blues-seasoned chord, the Q+N `HarmonicPlan` must preserve a chord-scale that admits the same blue-color note.

### Preferred implementation

Add explicit metadata to `SandboxChord` for melody/chord-scale color, separate from comp voicing tone lists:

```ts
bluesColorPcs?: number[];
forcedScale?: string;
localTonalCenterPc?: number;
```

Use the smallest additive fields needed. Do not break existing call sites.

### Important separation

Do not use `realTonePcs` as the only place to store melody color.

- `realTonePcs`: actual core chord tones that comp/bass may use.
- `bluesColorPcs` or contract metadata: melody/chord-scale admissible color.

If the current implementation already puts blue color inside `realTonePcs`, do not necessarily remove it in this follow-up unless it is easy and safe. But Q+N bridge must not depend on `realTonePcs` alone, because `sandboxToHarmonicPlan.ts` currently ignores it after deriving `realType`.

### Bridge requirement

Update `sandboxToHarmonicPlan.ts` so seasoned chords pass enough information into `ResolvedChord` for Q+N `assemble()` to build a chord-scale containing the intended blue color.

Possible options:

1. Use a known chord type that carries the color, e.g. `7#9`, `7#9#11`, `7b5`, `m7b5`, `7alt`, when musically correct.
2. Use `forcedScale` when the intended color is best represented as a scale rather than a chord tone.
3. If Q+N cannot represent the exact color with current fields, add a narrowly scoped bridge-side extension and tests.

Do **not** invent unknown chordType strings like `7(no3)`; current chord library does not support them.

### Concrete examples

For `majorBlues`:

- Key C, tonic C with strong Eb color:
  - Q+R may represent this as C7#9 flavor.
  - Q+N chord-scale must contain Eb.
- G7 with Eb as b13 color:
  - Use a type/scale that admits Eb if Q+R says that Eb is legal over that span.

For `minorBlues`:

- Key C, strong Gb:
  - Use diminished/m7b5/altered-compatible representation only when musically appropriate.
  - Otherwise Gb should remain weak approach/passing and not be marked structural-supported.

### Required tests

Add or strengthen bridge tests:

```ts
expect(qrContract.colorPcs).toContain(bluePc);
expect(qnPlan.chordScaleMap[span.id]).toContain(bluePc);
```

Do not only test `song.ir` exists. The current bridge tests pass while still losing the blue chord-scale.

## 2.2 Narrow `approachPcs` and validate resolution

### Goal

Approach notes should be legal only when they behave like real approach notes:

- weak rhythmic position
- short duration
- stepwise connection to a supported target
- preferably immediately before or after a supported note

### Required classifier behavior

Change `classifyMelodyNoteAgainstContract(...)` to use `prev` and `next` for approach validation.

Suggested rule:

```ts
const supported = stablePcs ∪ colorPcs ∪ scalePcs;
const isWeakShort = !isStructuralMelodyNote(note) && note.durationBeat <= 0.5;
const stepToPrev = prev && Math.abs(note.midi - prev.midi) <= 2;
const stepToNext = next && Math.abs(note.midi - next.midi) <= 2;
const prevSupported = prev && supported.has(pc(prev.midi));
const nextSupported = next && supported.has(pc(next.midi));

approach is valid only if:
  isWeakShort &&
  (
    (stepToNext && nextSupported) ||
    (stepToPrev && prevSupported)
  )
```

If not valid, classify as `unsupported-weak`.

### Required audit behavior

When auditing a full lead line, pass `prev` and `next` into `classifyMelodyNoteAgainstContract`.

### Required rectifier behavior

In `rectifyToPitchContract(...)`, also pass local `prev`/`next` when classifying. If a weak note is unsupported, snap to nearest allowed non-approach set:

```txt
stable ∪ color ∪ scale
```

Do not snap weak unsupported notes into arbitrary `approachPcs`.

### Required tests

Add tests:

- Weak C# before D over C major can be `approach`.
- Weak Ab with no stepwise supported neighbor over C major is `unsupported-weak`.
- Weak chromatic note that leaps away must be `unsupported-weak`.
- `weakUnsupported` increments in audit when a weak chromatic note is not resolved.

## 2.3 Quote blue notes: preserve but report unsupported structural quote

### Goal

Quote remains verbatim, but audit should reveal if harmony failed to support the quote's structural blue notes.

### Required behavior

Modify classification/audit so:

- quote blue structural note supported by stable/color -> supported
- quote blue structural note not supported by stable/color -> `quoteStructuralUnsupported++`
- quote blue weak passing note -> may classify as `quote-blue` or `scale-passing`, but do not fail hard

Do not mutate first quote.

### Required tests

Add tests:

- C majorBlues strong Eb quote over plain C major triad:
  - first quote pitch stays Eb
  - `quoteStructuralUnsupported > 0`
- Same quote over a chord contract that admits Eb:
  - `quoteStructuralUnsupported === 0`
  - `blueColorStructuralSupported > 0`

## 2.4 Make progression selection minimally blues-aware

### Goal

Do not fully rewrite selection. Do make it aware enough that blues structural tones influence candidate ranking and seasoning opportunity.

### Required API update

Thread `inputTonality` into:

```ts
selectProgressionForMotif(...)
scoreProgressionAgainstMelodicBrick(...)
```

Either:

- add `inputTonality?: SandboxTonality` to args, or
- add it to `UserMelodicBrick`

Keep the new field optional to avoid breaking existing tests.

### Scoring requirement

For blues input only:

- Detect strong structural blue notes in `brick.structuralTones`.
- Reward candidates with S/D slots or borrowed/secondary slots under those structural beats.
- Reduce penalty for weak/non-structural blue passing tones.
- Keep degenerate progression penalties.
- Keep style template pool unchanged. Do not switch POP/RNB/LOFI to JAZZ.

Suggested scoring fields:

```ts
bluesStructuralSupport?: number;
bluesSeasoningOpportunity?: number;
bluesPassingTolerance?: number;
```

It is okay if these fields are additive and optional.

### Required tests

Add a deterministic fake-candidate test:

- Strong majorBlues Eb at beat 0 or beat 2.
- Candidate A has S/D or seasoned-capable slot under that beat.
- Candidate B is plain tonic-only support.
- Blues-aware score should prefer A or at least give A a measurable `bluesSeasoningOpportunity` advantage.

Also test non-blues input unchanged or near-unchanged.

## 3. Guardrails

Do not regress these already-correct behaviors:

- First quote/exposition remains recognizable.
- Hidden-grid capture and no-swallowed-note fixes stay untouched.
- POP/RNB/LOFI template pools remain style-driven.
- Blues seasoning remains bounded and not consecutive.
- Comp/bass can still follow chord tones.
- `realTonePcs` should not become a dumping ground for every melody approach note.
- Do not introduce unsupported chordType strings.

## 4. Acceptance Criteria

This follow-up is complete when:

- A Q+R blues-seasoned chord that admits a blue color produces a Q+N `HarmonicPlan.chordScaleMap` that also admits that color.
- `approach` classification requires actual weak/short stepwise resolution.
- Unresolved weak chromatic notes increase `weakUnsupported`.
- Unsupported structural quote blue notes are reported as `quoteStructuralUnsupported`, while the quote itself remains unmodified.
- `inputTonality` reaches progression scoring, and at least one test proves blues input can influence candidate scoring/ranking.
- Targeted tests pass.
- `npm run lint` and `npm run build` pass.
- Full `npm test` is attempted; if a known long-running/probabilistic timeout happens, rerun the failed test file individually and report both results.

## 5. Suggested Test Commands

Run the focused blues suite first:

```bash
npx vitest run \
  src/core/generation/motifSandbox/model/pitchContract.test.ts \
  src/core/generation/motifSandbox/model/bluesSeasoning.test.ts \
  src/core/generation/motifSandbox/model/contractRectify.test.ts \
  src/core/generation/motifSandbox/model/bluesComp.test.ts \
  src/core/generation/motifSandbox/bridge/bluesBridge.test.ts \
  src/core/generation/motifSandbox/model/motifProgressionSelector.test.ts
```

Then:

```bash
npm test
npm run lint
npm run build
```

## 6. Manual Probe To Keep

After implementation, run a quick probe equivalent to:

```ts
const r = generateMotifWeave({
  capturedNotes: majorBluesCaptured,
  style: 'pop',
  keyPc: 0,
  mode: 'major',
  bpm: 96,
  seed: 7,
  inputTonality: 'majorBlues',
});
const plan = sandboxProgressionToHarmonicPlan(r.progression, 0, 'major');

for each seasoned chord:
  compare Q+R pitch contract colorPcs with Q+N plan.chordScaleMap[span.id]
```

Expected:

- If Q+R contract admits the key blue note as structural/color on that chord, Q+N chordScaleMap should also contain it.
- If Q+R only treats the blue note as weak passing/approach, Q+N does not need to promote it to structural chord-scale color.
