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

## 2. Non-negotiable Requirement: User Input Is Within 4 Seconds

The user motif input window must be within 4 seconds.

This is not a debug preference. It is a product requirement.

Current issue:

- `MotifWeaverSandboxPanel.tsx` calls `createHiddenGridContext(... desiredBars: 4)`.
- `hiddenGridClock.ts` accepts `desiredBars = 4` directly.
- At pop tempos such as 98 BPM, 4 bars equals about 9.8 seconds.

Required behavior:

- Normal hidden-grid capture must never exceed 4 seconds.
- The capture context must compute allowed bars from BPM.
- If requested bars exceed the 4-second limit, clamp down automatically.
- Debug mode may request longer capture only if explicitly named as debug and not used by the normal Q+R flow.

Suggested implementation:

```ts
const MAX_USER_INPUT_MS = 4000;

function clampCaptureBarsToFourSeconds(
  requestedBars: 1 | 2 | 3 | 4,
  bpm: number,
  beatsPerBar = 4,
): 1 | 2 | 3 | 4 {
  const msPerBar = beatsPerBar * 60000 / bpm;
  const maxBars = Math.max(1, Math.floor(MAX_USER_INPUT_MS / msPerBar));
  return Math.max(1, Math.min(requestedBars, maxBars, 4)) as 1 | 2 | 3 | 4;
}
```

Default product behavior:

- `desiredBars = 1`
- `countInBars = 1`
- pop/rnb/lofi usually capture 1 bar.
- jazz may allow 2 bars only when `2 * 4 * 60000 / bpm <= 4000`.

Acceptance:

- For pop 98 BPM, capture window is 1 bar, about 2.45 seconds.
- For lofi 80 BPM, capture window is 1 bar, about 3 seconds.
- For jazz 140 BPM, 2 bars may be allowed, about 3.43 seconds, only if requested.
- No normal hidden-grid capture window is longer than 4.0 seconds.

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

## 4. Prevent Long Motifs From Removing Continuation Space

The motif input is short by design.

Current issue:

- Hidden-grid can currently create up to a 4-bar motif.
- If motif length is 4 bars, a 4-bar harmonic cycle has no answer/development space.

Required behavior:

- Normal Q+R capture should produce a motif length of 1 bar by default.
- A 2-bar motif is allowed only when it fits the 4-second window and still leaves at least 2 bars of answer space in a 4-bar harmonic cycle.
- A 3- or 4-bar motif should not be produced by normal Q+R capture.

Implementation rule:

```txt
normal motif length <= 2 bars
normal capture duration <= 4 seconds
preferred motif length = 1 bar
```

If the user plays only in the first bar of a longer debug window, motif length can still derive to 1 bar. But the normal product path should not offer a 4-bar capture window.

Acceptance:

- For default pop hidden-grid capture, motif length is 4 beats unless the user plays into a valid second bar.
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

1. `createHiddenGridContext` clamps normal capture bars to <= 4 seconds.
2. Default pop hidden-grid capture is 1 bar and <= 4 seconds.
3. Jazz can allow 2 bars only when duration <= 4 seconds.
4. UI hidden-grid path no longer passes `desiredBars: 4` for normal capture.
5. Default `quotePlan` is `phraseHeads`.
6. Exact motif quotes occur at beats `0, 16, 32, 48`.
7. With a 1-bar motif, each 4-bar cycle has answer/development material after the quote.
8. Accompaniment support points use `structuralToneScore` as well as `accent`.

Command:

```bash
npm run test -- motifSandbox
```

## 9. Final Acceptance

The follow-up is complete when:

- Q+R hidden-grid capture stays within 4 seconds.
- The default motif is short enough to leave continuation space.
- The motif repeats after each 4-bar harmonic cycle.
- Verse 1 and Verse 2 both clearly contain the user motif.
- The second half of each cycle develops or answers the motif.
- Harmony uses structural tones.
- Accompaniment supports both rhythmic accents and structural tones.
- Free fallback remains available but is not the normal path.
- `npm run test -- motifSandbox` passes.

