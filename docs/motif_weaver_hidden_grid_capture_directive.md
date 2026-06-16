# Q+R Motif Sandbox Hidden Grid Capture Directive

Date: 2026-06-15

Owner: Q+R motif sandbox only

Status: implementation directive for the next Claude coding pass

## 1. Goal

Upgrade the Q+R motif sandbox so user MIDI input is recorded against a hidden musical clock instead of trying to infer true BPM from an arbitrary free-timed melody.

Update from follow-up directive: the earlier "within 4 seconds" capture constraint is canceled by user decision. Normal hidden-grid capture may use up to a 4-bar musical window.

The user experience should still feel simple: choose or receive a scale, press record, play a short motif, hear a completed melody continuation. The grid, bars, and beat math should stay hidden from the normal user. Internally, however, the system must have a tempo, meter, capture window, metrical phase, and accent model before motif analysis and continuation run.

This follows the core Impro-Visor lesson: Impro-Visor does not solve motif timing by guessing BPM from raw free input. It records or selects material inside an existing score/leadsheet timeline with known tempo, meter, chord progression, and slot grid.

## 2. Current Problem

Current Q+R code can run and generate a non-jazz motif continuation, but its recording-time model is musically fragile.

Relevant current files:

- `src/core/generation/motifSandbox/model/motifAnalysis.ts`
- `src/core/generation/motifSandbox/model/motifWeaver.ts`
- `src/core/generation/motifSandbox/model/motifHarmony.ts`
- `src/core/generation/motifSandbox/model/accompaniment.ts`
- `src/core/generation/motifSandbox/ui/MotifWeaverSandboxPanel.tsx`

Current issue summary:

- `fitRecordingToBars` adjusts BPM so the raw span becomes an integer number of bars. This is useful as a fallback, but it is not a reliable main musical interpretation.
- `analyzeAndNormalize` assumes a BPM, aligns the first note to beat 0, quantizes to a 1/16 grid, and computes accent from velocity/on-beat/edge/duration.
- If the user plays a pickup, late first note, or loose phrase, the system treats the first note as the downbeat.
- Harmony and accompaniment depend on accent/structure; wrong metrical phase causes wrong chord choice and wrong comp/bass hits.
- A short raw melody by itself cannot uniquely determine BPM, bar count, pickup, or strong beats. The data is underdetermined.

## 3. Decision

Default recording mode must be `hiddenGrid`, not free BPM inference.

`hiddenGrid` means:

- The sandbox creates a musical capture context before recording.
- The context contains BPM, meter, bar count, grid resolution, count-in length, key/mode/tonality, and capture start.
- The user may not see the grid, but they must receive a musical timing reference through count-in and/or a quiet pulse.
- Captured MIDI timestamps are mapped onto this pre-existing clock.
- Normalized motif onsets/durations are derived from clock position, not by forcing the captured span to fit bars afterward.

Free capture remains available only as a fallback/debug mode:

- It can keep `fitRecordingToBars`.
- It must expose a confidence/debug summary.
- It must not be treated as the primary path for production-quality motif continuation.

## 4. Impro-Visor Reference Points

Use these as behavioral guidance, not as code to copy.

- `~/vibe_coding/Impro-Visor/src/imp/midi/MidiRecorder.java`
  - `getTick()` reads the active sequencer tick and tempo.
  - Notes are snapped to Impro-Visor slots via `snapRecordingSlotsToIndex` and `snapRecordingSlotsToDuration`.
- `~/vibe_coding/Impro-Visor/src/imp/gui/Notate.java`
  - `startRecordingHelper()` calls `playScore()` and then starts `MidiRecorder`.
  - Count-in is attached to the score before playback/recording.
- `~/vibe_coding/Impro-Visor/src/imp/trading/PassiveTradingDialog.java`
  - Trading happens against `tradingQuantum` and current playback slot.
  - The recorder is suspended/un-suspended by user/system turn windows.

Interpretation:

Impro-Visor can show/offer count-in and playback, but the important part is deeper than a metronome UI. The recorded motif already lives in a known score clock.

## 5. Non-Goals

Do not touch the main generation chain.

Do not change `generateSong`, `renderMgMelody`, oracle, or the production newEngine path.

Do not reintroduce the old `improCore`/full Impro-Visor port.

Do not attempt a "magical BPM detector" as the default path. It will create false confidence and unstable musical output.

Do not add visible piano-roll/grid editing in Phase 1. Debug-only readouts are allowed.

## 6. Target UX

Normal user flow:

1. User opens Q+R.
2. Sandbox chooses or lets user choose key/mode/scale.
3. Sandbox internally chooses a BPM and motif capture window.
4. User presses record.
5. System plays a short count-in or a subtle pulse.
6. User plays the motif on MIDI input or the existing scale pad keyboard.
7. Recording ends automatically at the hidden window end, or user stops early.
8. System normalizes the motif against the hidden clock.
9. System generates the full 16-bar melody with the user motif clearly quoted in Verse 1 and Verse 2.
10. Preview playback uses the existing sandbox preview path.

Debug/dev affordances:

- Keep "Inject Sample Motif" for no-hardware testing.
- Add optional debug text showing BPM, bars, grid confidence, pickup, and structural-tone notes.
- Add a toggle to compare `hiddenGrid` vs `freeFallback` only for development.

## 7. Hidden Capture Context

Add a sandbox-local context model. Suggested file:

`src/core/generation/motifSandbox/capture/hiddenGridClock.ts`

Suggested types:

```ts
export type CaptureMode = 'hiddenGrid' | 'freeFallback';

export interface HiddenGridCaptureContext {
  mode: 'hiddenGrid';
  seed: number;
  keyPc: number;
  scaleMode: ScaleMode;
  tonality: SandboxTonality;
  style: SandboxStyle;
  bpm: number;
  meterNumerator: 4;
  meterDenominator: 4;
  beatsPerBar: 4;
  gridStepsPerBeat: 4; // 1/16 grid
  captureBars: 1 | 2 | 3 | 4;
  countInBars: 1 | 2;
  pickupBeats: 0 | 0.5 | 1;
  captureStartMs: number;
  captureEndMs: number;
  clockSource: 'audioContext' | 'performance';
}

export interface GridCapturedNote {
  midi: number;
  velocity: number;
  rawOnMs: number;
  rawOffMs: number;
  rawDurationMs: number;
  onsetBeat: number;
  durationBeat: number;
  quantizedOnsetBeat: number;
  quantizedDurationBeat: number;
  barIndex: number;
  beatInBar: number;
  timingErrorBeat: number;
  metricalWeight: number;
}
```

Notes:

- Superseded by `docs/motif_weaver_hidden_grid_followup_directive.md`: the 4-second capture limit is canceled.
- `captureBars` may be 1-4 bars. A 4-bar hidden-grid window is allowed in the normal Q+R path.
- If a long captured motif leaves no answer space inside a 4-bar harmonic cycle, the weaver should quote a recognizable head/sub-motif and still create development.
- `pickupBeats` can be 0 in Phase 1, but the type should allow adding pickup support cleanly.

## 8. BPM And Window Selection

Do not infer BPM from the captured motif in default mode.

Choose BPM before recording:

- `pop`: 92-116
- `rnb`: 76-98
- `lofi`: 70-90
- `jazz`: 120-160, only if jazz mode is explicitly selected

For non-jazz/default sandbox, prefer:

- `style = pop`
- `bpm = deterministic random 96-108`
- `captureBars = 4` unless a debug/test mode explicitly requests fewer bars
- `countInBars = 1`
- `gridStepsPerBeat = 4`

Capture-length rule:

- Superseded by follow-up directive: do not clamp to 4 seconds.
- Allow `captureBars = 1 | 2 | 3 | 4`.
- The musical window is bar-based; users may stop early.

The user does not need to see raw timing math in normal mode. Debug mode can show BPM, bar count, and capture-window details.

## 9. Count-In And Hidden Pulse

Implement a minimal audible time reference.

Phase 1 requirement:

- Before capture begins, play 1 bar count-in.
- The count-in can be a simple hi-hat/click, or a short neutral percussion tick through the existing preview/audio path.
- Beat 1 should be subtly stronger than beats 2-4.
- After count-in, recording starts at exact hidden beat 0.

Optional but recommended:

- During capture, play a very quiet pulse or metronome tick.
- For a more musical feel, use a soft closed hat or muted woodblock rather than a harsh click.
- In normal UX, do not display "metronome" as a complex control. Just make the timing reference feel like part of the capture.

Acceptance:

- The first recorded note is not automatically treated as beat 0.
- A late first note remains late relative to the hidden grid.
- Rests before the first note are preserved as musical timing.

## 10. Recorder Changes

Update the sandbox recorder path, not the global app.

Suggested files:

- `src/core/generation/motifSandbox/capture/MidiMotifRecorder.ts`
- `src/core/generation/motifSandbox/midi/webMidi.ts`
- `src/core/generation/motifSandbox/ui/MotifWeaverSandboxPanel.tsx`
- new `src/core/generation/motifSandbox/capture/hiddenGridClock.ts`

Required behavior:

- `armHiddenGridCapture(context)` prepares count-in and capture timing.
- During count-in, MIDI input may be ignored or stored as pre-roll debug data.
- At `captureStartMs`, start accepting notes.
- At `captureEndMs`, stop accepting notes and finalize.
- Map raw note-on/note-off times to beat positions using the context BPM and capture start.
- Quantize onsets to 1/16 grid with a small tolerance.
- Quantize durations to musically useful values, but do not destroy deliberate short notes.
- Keep raw timing error for confidence/audit.

Important:

- Do not call `fitRecordingToBars` in the normal hidden-grid path.
- Do not subtract the first note onset from all notes in hidden-grid mode.
- Only freeFallback may align first note to 0 and fit BPM afterward.

## 11. Motif Analysis Changes

Split analysis into two paths:

1. `analyzeHiddenGridMotif(gridNotes, context)`
2. `analyzeFreeFallbackMotif(capturedNotes, keyPc, mode, initialBpm)`

The existing `analyzeAndNormalize` can be refactored internally, but public behavior should make the distinction explicit.

`analyzeHiddenGridMotif` should:

- Use `quantizedOnsetBeat` and `quantizedDurationBeat` from the hidden clock.
- Preserve rests before the first note.
- Determine motif length from `context.captureBars * 4`, not captured span.
- Monophonize overlapping notes using current policy or highest-velocity/highest-pitch priority.
- Snap to selected tonality only after raw pitch is stored/audited.
- Track whether a note was changed by scale snap.
- Compute contour and rhythm cell from the grid-normalized motif.

Add analysis output:

```ts
export interface MotifTimingAnalysis {
  captureMode: CaptureMode;
  bpm: number;
  captureBars: number;
  lengthBeats: number;
  phaseConfidence: number;
  quantizeErrorMean: number;
  quantizeErrorMax: number;
  hasPickup: boolean;
  leadingRestBeats: number;
}
```

## 12. Accent And Structural Tone Model

Replace "accent only" thinking with two related scores:

- `accent`: performance/energy emphasis
- `structuralToneScore`: harmony/melodic importance

Suggested formula for Phase 1:

```txt
accent =
  0.40 * velocityNorm
  + 0.30 * metricalWeight
  + 0.15 * durationNorm
  + 0.15 * phraseEdgeWeight

structuralToneScore =
  0.35 * metricalWeight
  + 0.25 * durationNorm
  + 0.20 * velocityNorm
  + 0.15 * phraseBoundaryWeight
  + 0.05 * contourPeakOrTurn
```

Metrical weights for 4/4:

- Bar downbeat beat 1: `1.0`
- Beat 3: `0.75`
- Beats 2 and 4: `0.55`
- Eighth offbeats: `0.35`
- Sixteenth subdivisions: `0.2`

Use `structuralToneScore` for harmony choice and phrase identity. Use `accent` for comp/bass hit placement.

Acceptance:

- A quiet long note on beat 1 can still be a structural tone.
- A loud passing note on a weak 16th does not dominate harmony.
- Harmony scoring should prefer structural tones over raw velocity alone.

## 13. Harmony And Accompaniment Changes

Update `motifHarmony.ts`:

- Score chord candidates against `structuralToneScore`, not raw accent alone.
- Favor I/vi/IV/V for non-jazz pop defaults.
- Keep non-jazz `chromaticRatio = 0`.
- If scale snap changed important notes, record that in audit and avoid over-weighting the snapped duplicate.

Update `accompaniment.ts`:

- Use `accent` for rhythmic hits.
- Use `structuralToneScore` for bass/chord landing decisions where relevant.
- Do not over-follow every user note. The accompaniment should support the hidden meter.

## 14. Motif Weaving / Verse Behavior

Keep the current Motif Weaver "statement + development" direction, but tune quote placement toward the product requirement:

- The user motif must appear clearly in Verse 1.
- The same user motif must appear clearly in Verse 2.
- The latter part of each verse should contain continuation/development, not repeated copies only.

Default 16-bar structure:

- Verse 1: bars 1-8
- Verse 2: bars 9-16

Recommended quote placement:

- Exact quote at bar 1 beat 1.
- Exact quote at bar 9 beat 1.
- Optional softer quote/fragment at bar 5 or bar 13, but not mandatory.

Current behavior quotes at every 4-bar phrase head. This is musically clear but may be too literal. Make quote placement configurable:

```ts
quotePlan: 'verseHeadsOnly' | 'phraseHeads'
```

Default should be `verseHeadsOnly` for product UX. Keep `phraseHeads` as debug/regression option if existing tests depend on it.

> ⚠️ **SUPERSEDED** by the follow-up directive §3 (`motif_weaver_hidden_grid_followup_directive.md`): the product **default is now `phraseHeads`** (motif repeats after each 4-bar harmonic cycle = 排比). `verseHeadsOnly` is the optional debug/comparison mode, not the default.

## 15. Free Fallback Mode

Keep free capture as a fallback, with honest confidence.

Fallback behavior:

- Use current `fitRecordingToBars`.
- Try candidate bar counts 1 and 2 first.
- Penalize BPM outside style range.
- Penalize high quantization error.
- Penalize first-note-as-downbeat assumptions when there is likely leading silence.

Output must include:

- estimated BPM
- estimated bars
- quantization confidence
- phase confidence
- warning if confidence is low

Do not silently use fallback in normal mode unless Web MIDI timing/count-in is unavailable.

## 16. UI Tasks

Update `MotifWeaverSandboxPanel.tsx`:

- Default capture mode: hidden grid.
- Add record state labels:
  - idle
  - count-in
  - recording
  - analyzing
  - ready
- Keep debug sample motif injection.
- Add debug-only display:
  - key/mode
  - BPM
  - capture bars
  - count-in bars
  - quantize error
  - structure tones
  - scale-snap changes
- Do not expose a visible piano-roll/grid editor in Phase 1.

If using an on-screen scale pad:

- Pad input should also go through hidden-grid capture, not immediate free timestamps.
- Mouse/touch notes need note-on/note-off timing or a controlled default duration.

## 17. Testing Plan

Add/adjust unit tests under:

- `src/core/generation/motifSandbox/capture/*.test.ts`
- `src/core/generation/motifSandbox/model/*.test.ts`

Required tests:

1. Hidden grid maps raw ms to beat positions at fixed BPM.
2. Count-in does not become part of motif.
3. Late first note preserves leading rest instead of shifting to beat 0.
4. 1-bar capture produces `lengthBeats = 4`.
5. 2-bar capture produces `lengthBeats = 8` only when allowed by <=4 second rule.
6. Quantization error is reported.
7. Strong beat quiet note can become structural.
8. Loud weak passing note does not dominate harmony.
9. Hidden-grid path does not call `fitRecordingToBars`.
10. Free fallback still passes old parser/recorder tests.
11. Verse quote plan places exact motif at bars 1 and 9.
12. Non-jazz snap reports changed notes and keeps `chromaticRatio = 0`.

Manual browser test:

- Open Q+R.
- Connect a MIDI keyboard.
- Start hidden-grid recording.
- Hear count-in.
- Play a motif after count-in.
- Verify the first note position matches when played late/early.
- Generate preview.
- Confirm motif appears in Verse 1 and Verse 2.

Existing command to run after implementation:

```bash
npm run test -- motifSandbox
```

## 18. Phased Implementation

### Phase A: Hidden Clock Core

- Add `hiddenGridClock.ts`.
- Add context creation, ms-to-beat conversion, quantize helpers.
- Add unit tests for clock math.

### Phase B: Recorder Integration

- Wire hidden context into `MidiMotifRecorder`.
- Add count-in/recording states.
- Stop capture at context end.
- Preserve raw timing and grid timing.

### Phase C: Analysis Split

- Add `analyzeHiddenGridMotif`.
- Keep free fallback explicit.
- Remove first-note-to-zero behavior from hidden-grid mode.

### Phase D: Accent / Structural Tone

- Add `structuralToneScore`.
- Update harmony scoring.
- Update accompaniment use of accent vs structural tone.

### Phase E: Verse Quote Plan

- Add `quotePlan`.
- Default to `verseHeadsOnly`.
- Keep existing phrase-head behavior available for comparison.

### Phase F: UI And Debug

- Update Q+R panel states.
- Add debug readout.
- Keep sample motif injection.
- Ensure no main-chain imports are introduced.

### Phase G: Verification

- Run unit tests.
- Run one generated sample through hidden-grid injection.
- Manual Web MIDI test in browser.
- Listen for: stable downbeat, motif identity, Verse 1/Verse 2 quote, non-jazz continuation.

## 19. Acceptance Criteria

The task is done when:

- Q+R still opens with the existing shortcut.
- Hidden-grid capture is the default path.
- Recording uses preselected BPM/meter/window.
- Count-in or subtle pulse is audible before/during capture.
- First note is not forced to beat 0 in hidden-grid mode.
- Motif analysis outputs timing/audit info.
- Harmony uses structural tones rather than raw accent only.
- The generated 16-bar melody contains the user motif in Verse 1 and Verse 2.
- Free BPM fitting remains available only as fallback/debug.
- `npm run test -- motifSandbox` passes.
- No production newEngine or main generation path is changed.

## 20. Product Judgment

This is the correct direction.

Trying to infer BPM, bar count, strong beats, and pickup from a short scale-only melody with no timing reference is not musically reliable. The robust product solution is to hide the grid from the user, not remove the grid from the system.

The user can feel like they are freely playing. The engine should behave like a quiet accompanist who already knows the count.
