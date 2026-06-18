# Jazz / Bebop Fast-Note Legato Render Directive

Date: 2026-06-18

Scope:

- Q+N / newEngine jazz lead render.
- Q+R / motifSandbox jazz preview render.
- Render / IR / MIDI articulation layer only.

Non-goals:

- Do not rewrite jazz grammar.
- Do not change RoadMap parsing.
- Do not change motif brick analysis.
- Do not change harmonic template selection.
- Do not solve full Q+N orchestration integration here.

## 1. Problem

Impro-Visor bebop lines sound connected even when notes are fast.

Reference MIDI files analyzed:

- `BluesForGary.mid`
- `AFoggyDaySolo.mid`

Observed solo-track facts:

```text
PPQ: 120
Tempo: 160 / 180
Main fast grid: 80 / 40 ticks, i.e. 2:1 swing eighth
Adjacent note touch rate: 87.7%
Overlap: 0%
Velocity: constant 85
```

The important part is not velocity humanization. Impro-Visor is mostly constant velocity in these examples.

The connected feel comes from:

```text
swing onset timing
+ note durations that reach the next onset
+ clean note-off / note-on contact
```

Current Q+N jazz already has swing onset timing, but many fast notes are shortened after swing.

Likely cause:

```ts
// src/core/generation/newEngine/render/mgStyleRenderer.ts
bebop: 0.85
```

`renderStyleFeel()` first swings the offbeat and extends the previous note to close the swing gap, then later multiplies duration by the articulation scale. For bebop this reopens a gap:

```text
good swing timing:   |--------|----|
after 0.85 scaling: |------|  |---|
```

That produces the machine-gun effect.

Q+R has a related issue at the preview/IR layer:

```text
motifSandbox lead notes -> leadOnlyIr.toNoteIR() -> MusicalIR -> MIDI/audio
```

Q+R applies swing in `leadOnlyIr.ts`, but it does not have a bebop fast-note legato normalizer either.

## 2. Design Decision

Fix this at the render layer, not in generation.

Add one shared pure utility that operates on a lead line after timing has been chosen:

```ts
connectFastLeadNotes(notes, options) -> notes
```

It should not change:

- pitch
- start tick
- note count
- ordering
- chord selection
- motif identity
- RoadMap slot placement

It only changes:

- duration ticks
- optional same-pitch safety gap

The utility should be used by both:

- Q+N `renderMgMelody()`
- Q+R `leadOnlyIr.ts`

## 3. Target Behavior

For monophonic lead-note pairs:

```text
current note start = A
current note end   = A + duration
next note start    = B
IOI                = B - A
```

If the next note is close enough to be part of a fast line:

```text
IOI <= maxConnectIoi
```

then extend the current note so it reaches the next onset:

```text
current.duration = B - A
```

For same-pitch repeated notes, keep a tiny safety gap so the note-off cannot kill the next note-on on the same channel:

```text
current.duration = max(minDuration, B - A - samePitchGapTicks)
```

For different-pitch notes, touching is allowed:

```text
current.duration = B - A
```

Do not connect across phrase breaks:

```text
IOI > maxConnectIoi
```

Do not extend beyond:

- next note start for same lead channel
- track end
- song end

## 4. Recommended Defaults

Use tick-level options so Q+N and Q+R share the same behavior.

```ts
export interface FastLeadLegatoOptions {
  ppq: number;
  enabled: boolean;
  maxConnectIoiTicks: number;
  samePitchGapTicks: number;
  minDurationTicks: number;
  maxExtensionTicks?: number;
}
```

Recommended jazz / blues defaults:

```ts
{
  enabled: true,
  maxConnectIoiTicks: Math.round(ppq * 0.75),
  samePitchGapTicks: 1,
  minDurationTicks: Math.max(1, Math.round(ppq * 0.03)),
}
```

Why `0.75 beat`:

- includes swung eighth long side, around `0.67 beat`
- includes sixteenth and triplet subdivisions
- does not connect across real phrase rests

For non-jazz styles:

```ts
enabled: false
```

Later we can add per-style variants, but this directive only requires jazz and blues.

## 5. Placement

### 5.1 Shared Utility

Preferred file:

```text
src/core/generation/newEngine/render/leadArticulation.ts
```

This utility must be pure and independent:

- no DOM
- no scheduler state
- no audio side effects
- no generator RNG
- no motifSandbox imports

It may use `NoteIR` type if convenient, but it should be easy to call from Q+R.

Suggested exports:

```ts
export interface FastLeadLegatoOptions { ... }

export function connectFastLeadNotes<T extends {
  pitch: number;
  startTick: number;
  durationTicks: number;
}>(notes: readonly T[], options: FastLeadLegatoOptions): T[]
```

If branded `Ticks` / `Midi` types make the generic awkward, provide a `NoteIR` wrapper:

```ts
export function connectFastLeadNoteIR(
  notes: readonly NoteIR[],
  options: FastLeadLegatoOptions,
): NoteIR[]
```

### 5.2 Q+N Integration

Apply after MG timing / shaping has finished and before `renderMgMelody()` returns the lead `TrackIR`.

Current path:

```text
renderMgMelody()
  -> realizeTokens()
  -> renderStyleFeel()
  -> shapeMelodyHarmony()
  -> MgNoteEvent[] to NoteIR[]
  -> return { role: 'lead', notes }
```

Required path:

```text
renderMgMelody()
  -> realizeTokens()
  -> renderStyleFeel()
  -> shapeMelodyHarmony()
  -> MgNoteEvent[] to NoteIR[]
  -> connectFastLeadNoteIR(notes, jazzOptions)
  -> return { role: 'lead', notes }
```

Do not apply this to:

- comp
- bass
- pad
- drum

Only lead.

Do not remove swing in `mgStyleRenderer`.

Do not blindly change every `bebop` articulation value to `1.0` as the only fix. That would also affect slower notes. The render pass should specifically connect fast line notes.

### 5.3 Q+R Integration

Apply inside `motifSandbox/model/leadOnlyIr.ts`, after `toNoteIR()` builds lead notes.

Current Q+R path:

```text
MotifNote[] lead
  -> toNoteIR(lead, swing)
  -> MusicalIR lead track
```

Required Q+R path:

```text
MotifNote[] lead
  -> toNoteIR(lead, swing)
  -> connectFastLeadNoteIR(notes, jazzOptions)
  -> MusicalIR lead track
```

Only apply to lead track.

Do not apply to comp/bass in sandbox accompaniment. Bass and comp articulation have different musical jobs.

## 6. Micro-Note Policy

Current Q+N jazz can contain very short notes, e.g. around:

```text
8 / 10 / 26 / 34 ticks at PPQ-normalized 120
```

Impro-Visor reference solos mostly use:

```text
40 / 80 ticks
```

Phase 1 should not delete notes. It should only connect durations.

Add an audit counter for micro notes:

```ts
microNoteCount = notes where durationTicks < ppq * 0.12
microIoiCount  = pairs where IOI < ppq * 0.12
```

If machine-gun feel remains after legato normalization, Phase 2 may add a micro-note policy:

- reduce velocity for ornamental micro notes
- merge same-pitch micro repeats
- drop interior notes in extreme clusters only when they are not structural

Do not implement Phase 2 unless Phase 1 fails listening tests.

## 7. Tests

### 7.1 Unit: Fast Notes Touch

Create three lead notes:

```text
0.00 beat, dur 0.30
0.67 beat, dur 0.20
1.00 beat, dur 0.30
```

After normalization:

```text
note 1 duration ~= 0.67 beat
note 2 duration ~= 0.33 beat
```

No pitch or start changes.

### 7.2 Unit: Same-Pitch Safety

Two same-pitch notes:

```text
C4 @ 0.00
C4 @ 0.50
```

After normalization:

```text
first note end <= second note start - 1 tick
```

This prevents MIDI note-off collision.

### 7.3 Unit: Phrase Break Preserved

Two notes separated by more than `0.75 beat` must not connect.

```text
C4 @ 0.00
D4 @ 1.50
```

The first duration must not be extended to `1.50`.

### 7.4 Q+N Regression

Generate several jazz seeds through `generateSong()`.

Measure lead track:

```text
fastPairs = adjacent lead notes with IOI <= 0.75 beat
fastTouchOrTinyGapRate >= 0.80
medianFastArticulation >= 0.97
samePitchCollisionCount == 0
pitch/start signatures unchanged except duration
```

Also assert:

```text
default non-jazz generateSong behavior unchanged
```

### 7.5 Q+R Regression

Generate Q+R motif sandbox jazz preview.

Measure lead track after `buildLeadOnlyIr()` and `buildSandboxIr()`:

```text
fastTouchOrTinyGapRate >= 0.80
samePitchCollisionCount == 0
lead starts still swung
lead pitch/start signatures unchanged except duration
comp/bass notes unchanged
```

### 7.6 Reference Benchmark Script

Add or reuse a local analysis helper that can print:

```text
notes
bars
notes/bar
duration histogram
IOI histogram
gap/touch/overlap rates
articulation ratio
onset mod beat histogram
stepwise interval ratio
```

Use it manually against:

```text
BluesForGary.mid
AFoggyDaySolo.mid
Q+N jazz generated MIDI
Q+R jazz preview MIDI
```

The reference files do not need to become committed fixtures.

## 8. Acceptance Criteria

The implementation is accepted when:

1. Q+N jazz lead no longer has machine-gun gaps in fast lines.
2. Q+R jazz preview lead no longer has machine-gun gaps in fast lines.
3. Swing onset timing remains intact.
4. No lead pitch starts are moved.
5. No lead pitches are changed.
6. No note count changes in Phase 1.
7. Same-pitch repeated notes do not create note-off collisions.
8. Comp, bass, pad, drum behavior is unchanged.
9. Existing motif identity / exact quote checks still pass.
10. `npm run test -- motifSandbox` passes.
11. `npm run lint` passes.
12. New Q+N render tests pass.

## 9. Suggested Implementation Order

1. Add `leadArticulation.ts` pure utility.
2. Add unit tests for fast touch, same-pitch safety, phrase break.
3. Apply to Q+N `renderMgMelody()` lead track only.
4. Add Q+N jazz metric regression test.
5. Apply to Q+R `leadOnlyIr.ts` lead track only.
6. Add Q+R metric regression test.
7. Run existing motifSandbox and newEngine render tests.
8. Listen to:
   - Q+N jazz generated song
   - Q+R jazz motif sandbox preview
   - Impro-Visor reference MIDI

## 10. Important Guardrails

Do not move this logic into:

- `mgGrammarRuntime`
- `mgTokenScheduler`
- `mgMelodyRealizer`
- motif weaver generation
- harmony selection

This is a render-articulation problem.

Do not use sustain pedal as the fix. Pedal blurs harmony and does not solve bebop line articulation.

Do not connect all notes globally. Only connect lead notes inside fast-line thresholds.

Do not connect accompaniment. Bass and comp need their own articulation rules.

Do not make this jazz-only by hard-coded string checks scattered across files. Centralize the decision:

```ts
fastLeadLegatoOptionsForStyle(style, ppq)
```

Then Q+N and Q+R should both call that helper.

## 11. Expected Musical Result

Before:

```text
da  da  da  da
short gaps between fast notes
machine-gun articulation
```

After:

```text
da-da-da-da
fast notes touch cleanly
bebop line feels blown / connected
```

This should make fast sixteenth / swung-eighth jazz runs feel closer to Impro-Visor while preserving our existing pitch grammar and harmonic logic.
