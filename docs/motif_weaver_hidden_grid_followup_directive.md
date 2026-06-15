# Q+R Motif Sandbox Follow-up Directive

Date: 2026-06-15

Scope: Q+R motif sandbox only

Depends on: `docs/motif_weaver_hidden_grid_capture_directive.md`

## 1. Purpose

This is a supplemental directive after auditing the current Q+R hidden-grid implementation.

The main direction is correct:

- Hidden-grid capture is the default.
- The user does not need to see the grid.
- The system gives a count-in and records against a known clock.
- Motif continuation uses a statement + development structure.
- The motif should repeat after a full harmonic cycle.

This follow-up clarifies the remaining product requirements and fixes implementation drift.

## 2. Updated Requirement: Cancel The 4-Second Input Limit

The previous 4-second user-input limit is canceled by user decision.

This is not a bug in the current implementation. The Q+R sandbox may allow a longer hidden-grid capture window so the user can play a more complete motif.

Current status:

- `MotifWeaverSandboxPanel.tsx` calls `createHiddenGridContext(... desiredBars: 4)`.
- `hiddenGridClock.ts` accepts `desiredBars = 4` directly.
- At pop tempos such as 98 BPM, 4 bars equals about 9.8 seconds.

Required behavior:

- Normal hidden-grid capture may request up to 4 bars.
- Do not clamp capture duration to 4 seconds.
- Count-in still defines the hidden clock start.
- The recorder must still stop automatically at the configured capture window end.
- The UI should communicate capture in musical bars, not in "within 4 seconds" language.

Suggested implementation:

```ts
const MAX_CAPTURE_BARS = 4;

function clampCaptureBars(
  requestedBars: 1 | 2 | 3 | 4,
): 1 | 2 | 3 | 4 {
  return Math.max(1, Math.min(requestedBars, MAX_CAPTURE_BARS)) as 1 | 2 | 3 | 4;
}
```

Default product behavior:

- `desiredBars = 4`
- `countInBars = 1`
- The user may stop early.
- Motif length should still be derived from the actual played material inside the hidden grid.

Acceptance:

- For pop 98 BPM and `desiredBars = 4`, capture window may be about 9.8 seconds.
- `captureBars` can be 1, 2, 3, or 4.
- Count-in notes are still filtered out.
- Notes after the capture window are still ignored.
- No test or UI copy should assert a 4-second maximum.

## 3. Formalize New Decision: Repeat Motif After One Harmonic Cycle

The user added a musical requirement:

After one full harmonic cycle, the motif should repeat.

This means the current `phraseHeads` behavior is intentional, not a bug.

Default structure:

- 16 bars total.
- Harmony is organized as 4-bar cycles.
- Exact motif quote appears at the head of each harmonic cycle:
  - bar 1 / beat 0
  - bar 5 / beat 16
  - bar 9 / beat 32
  - bar 13 / beat 48
- The space after each quote is used for continuation/development.

Required default:

```ts
quotePlan: 'phraseHeads'
```

Keep `verseHeadsOnly` as an optional debug/comparison mode, but do not make it the product default.

Acceptance:

- With a 1-bar motif, exact quotes occur at beats `0, 16, 32, 48`.
- Verse 1 contains motif quotes at bars 1 and 5.
- Verse 2 contains motif quotes at bars 9 and 13.
- The generated melody still has development material after the quote in each harmonic cycle.

## 4. Keep Continuation Space Even With Longer Capture

The capture window may be longer than 4 seconds, but the generated melody still needs quote + development.

Current issue:

- Hidden-grid can currently create up to a 4-bar motif.
- If motif length is 4 bars, a 4-bar harmonic cycle has no answer/development space.

Required behavior:

- Normal Q+R capture may use a 4-bar window.
- If the user only plays in the first 1 or 2 bars, derive motif length from the actual played material.
- If the analyzed motif consumes the full 4-bar harmonic cycle, the weaver must still create continuation by using one of these strategies:
  - quote only the motif head or strongest sub-motif at the next cycle head;
  - use a shortened quote for cycle repetition;
  - create answer/development in the following cycle while preserving a recognizable motif recurrence.
- Do not let a long captured motif collapse the whole 16-bar result into four literal copies.

Implementation rule:

```txt
normal capture window <= 4 bars
normal capture duration may exceed 4 seconds
preferred motif quote unit = 1-2 bars when a full 4-bar capture leaves no answer space
motif recurrence remains required after each harmonic cycle
```

Acceptance:

- For default pop hidden-grid capture, a 4-bar window is allowed.
- If the user plays only in bar 1, motif length is 4 beats.
- If the user plays across bars 1-4, the generated melody still contains development and is not just four literal copies.
- `answerBeats` in `motifWeaver.ts` is normally greater than 0.
- A default generated 16-bar lead contains both exact motif quotes and developed continuation.

## 5. Accompaniment Should Use Structural Tones

Current status:

- `motifHarmony.ts` uses `structuralToneScore`.
- `accompaniment.ts` still picks structure points using only `accent >= ACCENT_MIN`.

Required change:

Use both performance accent and structural-tone importance.

Suggested policy:

```ts
const isRhythmicAccent = n.accent >= 0.58;
const isStructuralTone = (n.structuralToneScore ?? 0) >= 0.58;
if (!isRhythmicAccent && !isStructuralTone) continue;
```

Or use a combined score:

```ts
const supportScore = Math.max(n.accent, n.structuralToneScore ?? 0);
if (supportScore < 0.58) continue;
```

Musical goal:

- A loud weak passing note can drive a comp accent if it feels rhythmic.
- A quiet long downbeat note can still drive bass/chord support.
- Accompaniment should support the hidden meter, not blindly follow every note.

Acceptance:

- Add a unit test where a quiet downbeat long note has low `accent` but high `structuralToneScore`; accompaniment should include a support point for it when musically relevant.
- Keep existing tests for accent-driven support points.

## 6. Update Comments And UI Text

Some comments still describe the old free-capture behavior.

Examples to update:

- `MidiMotifRecorder.ts` header still says recording is analyzed by `fitRecordingToBars`.
- Q+R pad hint says recording auto-identifies whole bars, which is now only true in free fallback.

Required:

- Normal hidden-grid UI text should say count-in recording maps to an internal clock.
- Free fallback UI text may mention automatic bar/BPM fitting.
- Comments should distinguish `hiddenGrid` from `freeFallback`.

Acceptance:

- No user-facing normal hidden-grid text implies BPM is inferred from the raw motif.
- Code comments do not claim hidden-grid capture uses `fitRecordingToBars`.

## 7. Free Fallback Remains Debug/Fallback

Keep free fallback, but do not let it become the normal path.

Required:

- `captureMode` default remains `hiddenGrid`.
- `fitRecordingToBars` remains used only in `freeFallback` or tests for fallback behavior.
- If the user switches to free fallback, UI should make it clear that timing confidence is lower.

Acceptance:

- Hidden-grid record and sample injection do not call `fitRecordingToBars`.
- Free fallback still passes existing tests.

## 8. Tests To Add Or Adjust

Add or update tests for:

1. `createHiddenGridContext` allows normal capture bars up to 4.
2. Default Q+R hidden-grid capture may pass `desiredBars: 4`.
3. A 4-bar pop capture window is allowed even when it exceeds 4 seconds.
4. Count-in and post-window notes are still filtered correctly.
5. Default `quotePlan` is `phraseHeads`.
6. Exact motif quotes occur at beats `0, 16, 32, 48`.
7. With a 1-bar motif, each 4-bar cycle has answer/development material after the quote.
8. With a 4-bar captured motif, the result still has recognizable recurrence and development rather than four literal copies only.
9. Accompaniment support points use `structuralToneScore` as well as `accent`.

Command:

```bash
npm run test -- motifSandbox
```

## 9. Final Acceptance

The follow-up is complete when:

- Q+R hidden-grid capture supports up to 4 bars and is not capped at 4 seconds.
- The default motif is short enough to leave continuation space.
- The motif repeats after each 4-bar harmonic cycle.
- Verse 1 and Verse 2 both clearly contain the user motif.
- The second half of each cycle develops or answers the motif.
- Harmony uses structural tones.
- Accompaniment supports both rhythmic accents and structural tones.
- Free fallback remains available but is not the normal path.
- `npm run test -- motifSandbox` passes.
