# Q+R Motif Sandbox · Blues Chord Contract Directive

Date: 2026-06-24  
Owner: Claude implementation task  
Scope: Q+R motif sandbox first, Q+R -> Q+N bridge contract second. Do not rewrite capture, hidden grid, MIDI recorder, or render timing.

## 0. Goal

Fix the musical mismatch when the user records a motif using `majorBlues` or `minorBlues`.

The target behavior is **not** "every generated melody/accompaniment note must stay inside the fixed blues scale." That is too strict and musically wrong.

The target behavior is:

- User quote notes remain recognizable and may contain blues color notes.
- Generated/continued melody **structural tones** must be supported by the current chord contract.
- Weak passing/neighbor/approach notes may use chord-scale notes, blues color notes, or chromatic approach notes when they are rhythmically weak and resolved.
- Accompaniment/comp/bass may keep following chord tones. The problem is not comp using chord tones; the problem is when the chosen/realized chord cannot support the user motif's structural blues tones.
- When the selected tonality is `majorBlues` or `minorBlues`, add a small amount of blues-compatible chord realization/seasoning, especially around S/D positions and borrowed/secondary positions, to expand the legal orthogonal pitch space without turning the whole song into a jazz/blues progression.

In one sentence:

> Keep the existing "motif -> brick -> progression template -> RoadMap -> melodic slots" flow, but add a per-chord pitch contract that both harmony choice/realization and melodic slot filling must obey.

## 1. Current Diagnosis

The generation order is already mostly correct:

1. analyze user motif
2. infer user melodic brick
3. choose progression template
4. realize `SandboxChord[]`
5. parse/build RoadMap
6. build melodic slot plan
7. fill slots with quote/develop/generated melody
8. optionally build accompaniment from progression

So this is **not** primarily a "generate chords first" bug. The code already picks chords before filling most generated melody.

The actual problem is that the chord decision and melody decision do not share a rich enough pitch contract:

- `majorBlues` / `minorBlues` is currently mostly an input snap vocabulary.
- `UserMotif` only stores parent `mode: major | minor`, not the original sandbox tonality.
- Progression scoring checks structural motif tones against real chord tones, but it does not treat blues-color structural tones specially.
- `adaptToHarmony()` only checks `onBeat || duration >= 1`, not final structural-tone weight.
- Development transforms use parent major/minor diatonic tools, then do a coarse chord-tone rectification.
- The audit uses parent mode + quote exceptions, not a per-chord structural/weak-tone contract.

Relevant files:

- `src/core/generation/motifSandbox/model/sandboxScales.ts`
- `src/core/generation/motifSandbox/model/types.ts`
- `src/core/generation/motifSandbox/model/motifAnalysis.ts`
- `src/core/generation/motifSandbox/model/melodicBrickAnalyzer.ts`
- `src/core/generation/motifSandbox/model/melodyProgressionScorer.ts`
- `src/core/generation/motifSandbox/model/motifProgressionSelector.ts`
- `src/core/generation/motifSandbox/model/motifRoadmap.ts`
- `src/core/generation/motifSandbox/model/motifWeaver.ts`
- `src/core/generation/motifSandbox/model/accompaniment.ts`
- `src/core/generation/motifSandbox/model/jazzinessAudit.ts`
- `src/core/generation/motifSandbox/bridge/sandboxToHarmonicPlan.ts`
- `src/core/generation/motifSandbox/bridge/sandboxToOverride.ts`

## 2. Non-Goals

Do not do these in this task:

- Do not change MIDI recording, hidden-grid count-in, pre-capture grace, or swallowed-note fixes.
- Do not force all notes into `majorBlues` / `minorBlues`.
- Do not switch every blues-tonality generation to JAZZ style.
- Do not make the whole song a 12-bar blues unless the user explicitly asks later.
- Do not rewrite the Q+N default production chain.
- Do not remove POP/RNB/LOFI progression templates from Q+R.
- Do not make accompaniment ignore chord tones. Comp/bass should still follow realized chords.

## 3. Core Design

Add a new explicit pitch contract layer for the motif sandbox.

### 3.1 Contract Concept

For every chord span, derive:

- `stablePcs`: chord tones that are safe for strong/long/structural melody notes.
- `colorPcs`: chord-supported color tones, including safe sevenths/ninths/blue-color extensions.
- `scalePcs`: local chord-scale notes available for weak passing/neighbor tones.
- `approachPcs`: chromatic or blues approach notes available only on weak rhythmic positions when resolved by step.
- `avoidPcs`: notes that should not be used as structural tones over this chord.
- `bluesFlavor`: optional metadata explaining whether this chord was seasonally altered for blues input.

Structural melody notes must land in:

```ts
stablePcs ∪ colorPcs
```

Weak passing/neighbor notes may land in:

```ts
stablePcs ∪ colorPcs ∪ scalePcs ∪ approachPcs
```

But approach notes must be short/weak and should resolve by step to a supported note.

### 3.2 Suggested Types

Create a small model file:

```txt
src/core/generation/motifSandbox/model/pitchContract.ts
```

Suggested interfaces:

```ts
export interface ChordPitchContract {
  chordIndex: number;
  startBeat: number;
  durationBeats: number;
  stablePcs: number[];
  colorPcs: number[];
  scalePcs: number[];
  approachPcs: number[];
  avoidPcs: number[];
  bluesFlavor?: 'none' | 'dominant7' | 'blue3' | 'blue5' | 'sus' | 'borrowed' | 'backdoor' | 'secondary';
}

export interface PitchContractContext {
  keyPc: number;
  mode: ScaleMode;
  inputTonality?: SandboxTonality;
  isBluesInput: boolean;
  contracts: ChordPitchContract[];
}
```

Suggested helpers:

```ts
export function buildPitchContractContext(args: {
  progression: readonly SandboxChord[];
  keyPc: number;
  mode: ScaleMode;
  inputTonality?: SandboxTonality;
}): PitchContractContext;

export function contractAtBeat(ctx: PitchContractContext, beat: number): ChordPitchContract;

export function isStructuralMelodyNote(note: MotifNote): boolean;

export function classifyMelodyNoteAgainstContract(args: {
  note: MotifNote;
  prev?: MotifNote;
  next?: MotifNote;
  contract: ChordPitchContract;
}): 'structural-supported' | 'color-supported' | 'scale-passing' | 'approach' | 'quote-blue' | 'unsupported-structural' | 'unsupported-weak';

export function nearestContractTone(midi: number, contract: ChordPitchContract, opts?: {
  structural?: boolean;
  preferDirection?: 1 | -1 | 0;
}): number;
```

Keep this file pure and deterministic.

## 4. Propagate Input Tonality

`inputTonality` must survive past analysis.

### 4.1 Extend `UserMotif`

Add optional field:

```ts
inputTonality?: SandboxTonality;
```

Set it in both:

- `analyzeAndNormalize(...)`
- `analyzeHiddenGridMotif(...)`

When the caller provides a pre-analyzed `motif`, `generateMotifWeave()` should derive:

```ts
const inputTonality = input.inputTonality ?? motif.inputTonality;
```

Do not break existing tests that manually construct `UserMotif`; the new field must be optional.

### 4.2 Extend Result Debug Data

Optionally expose:

```ts
pitchContract?: PitchContractContext;
```

on `MotifWeaverResult`, so UI/debug/audit can show why a note was accepted or rectified.

## 5. Blues-Aware Chord Realization, Not Full Jazz Rewrite

The style template pool should remain style-driven:

- POP uses POP templates.
- RNB uses RNB templates.
- LOFI uses LOFI templates.
- JAZZ uses JAZZ templates.

But when `inputTonality` is `majorBlues` or `minorBlues`, selected slots may be realized with small blues-compatible seasoning.

### 5.1 Add a Seasoning Budget

Add a deterministic budget so the song does not become all blues chords:

```ts
interface BluesSeasoningBudget {
  maxAlteredSlots: number;      // e.g. max(1, floor(totalSlots * 0.18))
  maxConsecutiveAltered: number; // usually 1
  preferFunctions: Array<'S' | 'D'>;
  allowTonicSeasoningAtPhraseHead: boolean; // true but sparse
}
```

Recommended first version:

- 16-bar sandbox: 2 to 4 altered slots max.
- Prefer S and D positions.
- Permit tonic seasoning on phrase heads only when the user motif has strong blue 3 or blue 5 on that tonic span.
- Do not alter every repeated slot. If a 4-bar template repeats four times, season selected repeated occurrences, not all copies.

### 5.2 What "Blues Seasoning" Means

For `majorBlues`:

- Blue note: `b3` relative to key.
- Tonic I may sometimes become a dominant/shell/sus/no3-compatible support, e.g. I7, I7(no3), I7#9 flavor, or a voicing contract that admits both 3 and b3 but avoids stacking both as hard comp thirds.
- IV and V are good places for dominant 7 color.
- Backdoor/bVII or borrowed iv may be allowed if the selected template already contains borrowed/backdoor/modal-interchange behavior, or if the S/D position calls for color.

For `minorBlues`:

- Blue note: `b5` relative to key; minor pent tones `1 b3 4 5 b7` are stable vocabulary.
- i/iv/v or i/iv/bVII-type movement can work.
- b5 should usually be approach/color unless the chord is diminished/m7b5/altered-compatible.
- S/D positions may allow m7b5/dim/altered dominant support if the motif places b5 as a structural tone.

Keep this conservative. The point is to expand legality and flavor, not to make every progression a 12-bar blues.

### 5.3 Where To Implement

Prefer extending the sandbox realization layer:

- `src/core/generation/motifSandbox/model/motifRoadmap.ts`
- `realizeToSandboxChords(...)`

But do not overload the existing function with too many optional parameters if it becomes messy. It is acceptable to add:

```ts
realizeToSandboxChords(slots, keyPc, mode, opts?)
```

where `opts` includes:

```ts
{
  inputTonality?: SandboxTonality;
  userBrick?: UserMelodicBrick;
  seed?: number;
}
```

Call sites in `generateMotifWeave()` should pass the new options after `brick` is known.

### 5.4 Important Invariant

After realization:

- `effectiveTonePcs(chord)` must represent the actual chord-tone contract used by accompaniment and melody rectification.
- `realTonePcs` should be updated if seasoning changes the chord.
- `realRoman` / `realType` should expose debug-friendly labels.
- For Q+R -> Q+N, `sandboxToHarmonicPlan.ts` must preserve the chord type/quality enough for Q+N's `assemble()` to build useful `chordScaleMap`.

## 6. Progression Scoring Update

`scoreProgressionAgainstMelodicBrick(...)` should become blues-aware when `inputTonality` is blues.

Current scoring mostly rewards structural tones that are real chord tones. Keep that, but add two ideas:

### 6.1 Structural Blue Tone Support

If a structural motif note is a blue note:

- Weak/short blue note: small penalty or neutral.
- Strong/long blue note on tonic/S/D location: require either a chord tone, a color admission, or a seasoning opportunity.
- If the candidate template has S/D slots near this note, reward it because those positions can carry blues flavor.

### 6.2 Passing Blue Tone Tolerance

If a blue note is not structural:

- Do not force the progression to explain it as a chord tone.
- It may be accepted as `approach` or `scale-passing` if it resolves by step.

Suggested function:

```ts
export function isBlueColorPc(pc: number, keyPc: number, tonality: SandboxTonality): boolean;
```

Suggested scoring metadata:

```ts
bluesStructuralSupport
bluesPassingTolerance
bluesSeasoningOpportunity
```

Add these to `ProgressionScoreBreakdown` only if it is not too disruptive; otherwise keep them internal and add test assertions through selected template behavior.

## 7. Melody Slot Filling Update

Once progression and pitch contracts exist, generated/developed melody should consume them.

### 7.1 Quote Policy

Quote remains mostly verbatim:

- First quote/exposition should not be rectified away.
- Later `quote:vary` may choose contract-supported alternatives.
- If a quote structural note is unsupported by the current chord, that is primarily a **harmony realization/scoring issue**, not a reason to mutate the user's original quote.

However, audit should report unsupported quote structural tones so we can tune harmony selection/seasoning.

### 7.2 Develop / Reference / Generated Policy

For non-quote notes:

- After transforms (`transpose`, `invert`, `retro`, etc.), recompute or at least reinterpret structural status at the final onset/duration.
- Structural notes should snap to `stablePcs ∪ colorPcs`.
- Weak short notes should prefer `scalePcs`, blues color, or approach notes that resolve.
- `passingScaleTone(...)` should not only use parent major/minor. It should use the local contract's `scalePcs` / `approachPcs` for the current span.
- `generateForFunction(...)` should target contract tones, not just nearest raw chord tone and parent scale.

### 7.3 Replace Coarse `adaptToHarmony`

Current logic:

```ts
if ((onBeat || duration >= 1) && !isChordTone(...)) snapToNearestChordTone(...)
```

Replace or wrap it with:

```ts
rectifyToPitchContract(notes, pitchContext, {
  preserveQuote: true,
  preserveFirstQuote: true,
  allowWeakApproach: true,
})
```

Rules:

- Quote: preserve, but classify/audit.
- Develop/generated structural: rectify to nearest stable/color pc.
- Develop/generated weak: keep if admitted by scale/approach; otherwise rectify to nearest scale/stable pc.
- Final cadence note: must land on stable pc of final chord unless it is a preserved quote.

## 8. Accompaniment Policy

Do not make comp/bass follow the blues scale directly.

Accompaniment should still consume `SandboxChord.realTonePcs/effectiveTonePcs`.

But if blues seasoning admits a blue structural tone, avoid voicing choices that create harsh contradictions:

- If melody structural note is major-blues `b3` over tonic, comp should avoid hammering the natural 3 in the same register at the same attack unless the intended color is I7#9 and the voicing is controlled.
- Prefer shell voicings / no3 / sus / dominant 7 support when contract says `blue3`.
- If melody structural note is minor-blues `b5`, comp should support it only when the current chord contract admits it as color/stable; otherwise treat it as approach and do not reinforce it.

Implementation can remain simple:

- Extend `triadVoicing(...)` or add `contractAwareVoicing(...)`.
- Only alter voicing when `inputTonality` is blues and lead has a structural note at/near the comp attack.
- Keep existing rhythm/alignment behavior.

If this is too big for first pass, leave comp voicing unchanged and first ensure realized chords/effective tones are correct. But add tests showing comp consumes updated `realTonePcs`.

## 9. Q+R -> Q+N Bridge

Q+R full arrangement should not lose the blues-aware realization.

The bridge already passes:

- `harmony: sandboxProgressionToHarmonicPlan(...)`
- `lead: result.lead`
- `key: { keyPc, mode }`

Required:

- Ensure `SandboxChord.realType`, `realRootPc`, `realTonePcs`, `borrowedSource`, and any seasoning metadata needed for chord-scale survive into `sandboxToHarmonicPlan.ts`.
- If a chord was seasoned as dominant/sus/borrowed/backdoor/secondary, Q+N `assemble()` should produce a chordScaleMap that supports the same contract.
- Do not add a parallel random Q+N blues reharmonization. Q+R's realized progression is the authority.

Optional but useful:

- Add `forcedScale`/`localTonalCenterPc` support to `SandboxChord` only if needed to preserve the chord-scale. Keep it additive.

## 10. Audit Update

Replace "blues notes outside parent mode are okay" with a contract-based audit.

Add audit counters:

```ts
structuralUnsupported: number;
weakUnsupported: number;
quoteStructuralUnsupported: number;
blueColorStructuralSupported: number;
bluesSeasonedChordCount: number;
contractPassRatio: number;
```

Audit rules:

- Structural generated/developed note unsupported = fail for all styles.
- Weak unsupported note = warning unless it is frequent.
- Quote structural unsupported = warning that harmony did not support user motif well; do not mutate quote to hide it.
- Blues input may have more chromaticism, but structural notes still need support.
- Non-blues input should remain at least as strict as before.

Update UI labels if easy:

- Current "离调(全 / 不证成)" can stay, but add a contract line such as:

```txt
合同: strong unsupported X / weak unsupported Y / blues chords Z
```

## 11. Tests

Add focused tests. Do not rely only on listening.

### 11.1 Major Blues Structural Blue 3

Input:

- key C
- tonality `majorBlues`
- motif contains Eb as a strong/long/on-beat structural note.

Expect:

- First quote preserves Eb.
- Selected/realized progression has at least one chord/span that admits Eb as stable/color where quote structural Eb lands, or audit reports `quoteStructuralUnsupported` and scoring should prefer a better candidate when available.
- Generated/developed structural notes have `structuralUnsupported = 0`.
- Some blues seasoning appears across seeds, but not every chord is altered.

### 11.2 Major Blues Weak Blue 3 Passing

Input:

- Eb only appears as short weak passing note between D/E or E/D.

Expect:

- No forced reharmonization solely because of weak Eb.
- Weak note admitted as approach/passing when resolved.
- Structural unsupported remains 0.

### 11.3 Minor Blues b5

Input:

- key C
- tonality `minorBlues`
- motif includes Gb.

Expect:

- Weak Gb can pass as approach.
- Strong/long Gb requires a compatible contract or produces a quote-support warning.
- Generated structural notes are contract-supported.

### 11.4 POP Does Not Become Jazz

For `style: 'pop'` + `majorBlues`:

- Candidate source remains POP templates.
- Blues seasoning count is bounded.
- No global switch to JAZZ template pool.
- RoadMap still parses and slot plan still covers the full form.

### 11.5 Accompaniment Consumes Realized Chords

For a seasoned chord:

- `buildAccompaniment(...)` uses the updated `realTonePcs`.
- Comp/bass tracks are non-empty.
- No same-pitch overlap regressions.

### 11.6 Q+R -> Q+N Preservation

For a blues-tonality Q+R result:

- `buildMotifSongOverride(...)` -> `generateSongFromMotif(...)`
- Resulting HarmonicPlan contains chord spans/chord types that correspond to Q+R's realized blues-compatible chords.
- Lead override remains unchanged in pitch count/order except existing sanitizer/timing behavior.

## 12. Suggested Implementation Order

### Phase 1: Data Propagation

- Add `inputTonality?: SandboxTonality` to `UserMotif`.
- Store it in both analysis paths.
- Thread `inputTonality` through `generateMotifWeave`.
- Add tests proving hidden-grid and free-path motif retain tonality.

### Phase 2: Pitch Contract

- Add `pitchContract.ts`.
- Build per-chord contracts from current `SandboxChord[]`.
- Include blues-aware contract additions when `inputTonality` is blues.
- Add pure unit tests for majorBlues/minorBlues contract classification.

### Phase 3: Blues-Aware Realization

- Extend `realizeToSandboxChords(...)` with optional `inputTonality`, `userBrick`, `seed`.
- Add a bounded seasoning budget.
- Prefer S/D and borrowed/secondary positions.
- Keep POP/RNB/LOFI/JAZZ template pools unchanged.
- Add tests for seasoning bounds and deterministic behavior.

### Phase 4: Melody Rectification

- Replace/wrap `adaptToHarmony(...)` with contract-aware rectification for develop/reference/generated notes.
- Keep first quote verbatim.
- Update `passingScaleTone`, `generateForFunction`, and `varyMotifQuote` to use contract sets where appropriate.
- Add tests: generated structural unsupported = 0 for blues and non-blues.

### Phase 5: Audit/UI

- Add contract audit counters.
- Update jazziness/contract readout without hiding chromatic information.
- Existing audit fields can remain for backward compatibility.

### Phase 6: Bridge/Q+N Preservation

- Ensure `sandboxToHarmonicPlan.ts` preserves seasoned chord types and any needed scale metadata.
- Add a Q+R -> Q+N route test for blues tonality.

### Phase 7: Optional Comp Voicing Polish

- If still harsh, make comp voicing avoid direct contradictions with lead structural blue notes.
- Keep this small and deterministic.

## 13. Acceptance Criteria

The task is complete when:

- Q+R with `majorBlues` / `minorBlues` no longer treats blues as merely an input snap mode.
- The selected progression is still style-template-driven, not globally jazz-switched.
- Blues seasoning appears sometimes, not everywhere.
- Generated/developed structural melody notes are supported by the current chord contract.
- Weak passing notes are allowed to be outside fixed blues scale when rhythmically/linearly justified.
- Quote remains recognizable and first quote is not mutated.
- Comp/bass keep following realized chord tones.
- Q+R -> Q+N bridge preserves the realized blues-compatible chords.
- New contract audit reports strong/weak/quote support clearly.
- Existing swallowed-note, hidden-grid, fast-run timing, and lead-sanitizer tests continue to pass.

## 14. Required Test Commands

Run targeted tests first:

```bash
npx vitest run \
  src/core/generation/motifSandbox/model/sandboxScales.test.ts \
  src/core/generation/motifSandbox/model/motifAnalysis.test.ts \
  src/core/generation/motifSandbox/model/motifHiddenGrid.test.ts \
  src/core/generation/motifSandbox/model/melodicBrickAnalyzer.test.ts \
  src/core/generation/motifSandbox/model/motifProgressionSelector.test.ts \
  src/core/generation/motifSandbox/model/motifWeaver.test.ts \
  src/core/generation/motifSandbox/model/accompaniment.test.ts \
  src/core/generation/motifSandbox/bridge/sandboxToOverride.test.ts
```

Then run the broader safety net:

```bash
npm test
npm run lint
npm run build
```

## 15. Manual Ear Check

After tests pass, manually compare:

1. C major blues motif with a strong Eb.
2. C major blues motif with weak Eb passing only.
3. C minor blues motif with weak Gb passing.
4. C minor blues motif with strong Gb.

Listen with:

- Q+R lead only.
- Q+R lead + accompaniment.
- Q+R full arrangement via Q+N.

Expected listening result:

- User motif remains audible.
- Strong notes feel harmonically held.
- Passing blues notes sound intentional rather than "wrong."
- POP/RNB/LOFI keep their style identity, with only light blues seasoning.
