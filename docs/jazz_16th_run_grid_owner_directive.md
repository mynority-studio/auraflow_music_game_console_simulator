# Jazz 16th-Run Grid Owner Render Directive

Date: 2026-06-19

Owner: Claude implementation task

Scope:

- Q+N / newEngine jazz lead timing render.
- Q+R / motifSandbox jazz preview lead timing render.
- Render-layer timing / articulation only.

Related previous directive:

- `docs/jazz_bebop_fast_note_legato_render_directive.md`

## 0. Executive Summary

The previous fast-note legato fix is necessary but not sufficient.

Current `564417 jazz` no longer mainly fails because notes are detached. It fails because continuous 16th-note runs are being swing-warped as if every `.5` beat onset were an eighth-note offbeat.

Concrete bad transform:

```text
raw 16th run:
28.00, 28.25, 28.50, 28.75, 29.00

current jazz style output:
28.00, 28.25, 28.67, 28.75, 29.00

resulting IOI:
0.25, 0.42, 0.08, 0.25
```

The `0.08 beat` interval is the audible "rush / machine stutter / wrong beat" problem.

This task must add a fast-line grid owner so that 16th runs remain rhythmically coherent before the existing legato pass connects durations.

## 1. Evidence

Reference Impro-Visor MIDI files:

- `BluesForGary.mid`
- `AFoggyDaySolo.mid`

Observed Impro-Visor solo-track behavior, normalized to PPQ120:

```text
Main IOI grid: 80 / 40 swing eighth
Occasional fast cells: 60 / 30
Micro IOI < 0.12 beat: 0
Adjacent fast-note touch rate: 100% for fast pairs
Overlap: 0%
```

Current exported `564417 jazz` after the legato patch:

```text
Output MIDI:
tmp/midi-analysis/seed-564417-jazz.mid

Lead notes: 374
Fast-pair touch rate: 100%
Median fast articulation: 1
Micro IOI pairs: 27
Main IOI histogram normalized to PPQ120:
40:112 81:101 30:54 10:27 51:27 120:23 ...
```

The bad `10` tick IOIs are not an articulation gap problem. They are start-time grid damage.

Seed `564417` localized example:

```text
raw before style:
28.0000  dur 0.2500
28.2500  dur 0.2500
28.5000  dur 0.2500
28.7500  dur 0.2500
29.0000  dur 0.2500

after current mgStyleRenderer:
28.0000  dur 0.2125
28.2500  dur 0.4200
28.6700  dur 0.0680
28.7500  dur 0.2125
29.0000  dur 0.2125
```

The short `0.0680` duration and `0.08` IOI are caused by context-free swing, not by the note generator.

## 2. Current Code Paths

Q+N production lead:

```text
src/core/generation/newEngine/render/mgLeadRenderer.ts

realizeTokens()
-> renderStyleFeel()
-> shapeMelodyHarmony()
-> NoteIR conversion
-> connectFastLeadNoteIR()
-> renderCoordinator final humanize
-> connectFastLeadNoteIR() final safety gate
```

Problem location:

```text
src/core/generation/newEngine/render/mgStyleRenderer.ts
```

Current behavior:

```ts
if (Math.abs(beatFrac - 0.5) < 0.05 && feel.swingRatio !== 0.5) {
  time = time + offset; // .5 -> .67
}
```

This is correct for eighth-note swing:

```text
0.00, 0.50, 1.00 -> 0.00, 0.67, 1.00
```

But wrong inside a 16th run:

```text
0.00, 0.25, 0.50, 0.75, 1.00
```

Q+R sandbox preview:

```text
src/core/generation/motifSandbox/model/leadOnlyIr.ts

PlayNote[]
-> toNoteIR()
-> swungBeat()
-> connectFastLeadNoteIR()
```

Q+R has a different swing implementation, but it still needs the same fast-line protection policy so a user motif / weaver-generated 16th run is not mangled at preview render time.

### 2.1 Boundary: Q+R -> Q+N "Route A" Override Lead

There is one important boundary that should not be mistaken for a missing integration.

The Route A full-arrangement path:

```text
motifSandbox user motif / weaver lead
-> sandboxToOverride
-> renderSongFull(..., overrideLeadTrack)
```

does not go through:

- `renderMgMelody()`
- `mgStyleRenderer.ts`
- `leadOnlyIr.ts`

Therefore this grid-owner fix will not automatically run on the Route A override lead.

That is expected for Phase 1.

Reason:

- Route A lead is already snapped by the motif hidden-grid / two-stage alignment flow.
- It does not pass through the MG `.5 -> .67` swing transform.
- It already receives the final `connectFastLeadNoteIR()` safety gate in `renderCoordinator.ts`.

So Route A currently has the legato safety fix, but it should not need this specific MG/Q+R swing squeeze fix unless a future change adds swing timing to override leads.

Do not add a new Route A timing pass in this task unless a failing test proves the same `0.25 -> 0.67 -> 0.75` squeeze exists there.

## 3. Design Decision

Keep the existing fast-note legato utility.

Do not solve this by extending durations more. The onset grid is already damaged before legato runs.

Add a shared render-layer timing policy:

```text
fast-line grid owner
```

It must decide, per local run, whether the phrase is:

- eighth-note swing material
- straight/coherent 16th-note run
- triplet-authored material
- mixed/free material that should be left alone or minimally repaired

Only eighth-note swing material should receive `.5 -> swingRatio` movement.

16th runs must not be transformed into `.25 -> .67 -> .75` squeeze patterns.

## 4. Recommended Architecture

Create a shared pure utility:

```text
src/core/generation/newEngine/render/leadGridTiming.ts
```

Suggested exports:

```ts
export interface TimedLeadEvent {
  time: number;
  duration: number;
}

export interface LeadGridTimingOptions {
  swingRatio: number;
  beatsPerMeasure: number;
  protectFastRuns: boolean;
  epsilon?: number;
}

export function applyContextAwareLeadSwing<T extends TimedLeadEvent>(
  events: readonly T[],
  options: LeadGridTimingOptions,
): T[];

export function leadGridMetrics(events: readonly TimedLeadEvent[]): {
  microIoiCount: number;
  minIoi: number;
  squeezedSwing16thCount: number;
  coherentFastRunCount: number;
};
```

The exact names can differ, but the implementation must be:

- pure
- deterministic
- no DOM
- no audio scheduler
- no MIDI file I/O
- no RNG
- reusable by Q+N and Q+R

## 5. Fast-Run Detection

Sort by `time`, but return in original order if the caller expects stable identity.

For an event at index `i`, inspect local neighbors:

```text
prev2, prev1, current, next1, next2
```

A local region is a fast run if at least 3 adjacent IOIs in a window are:

```text
IOI <= 0.375 beat
```

This includes:

- 16ths: `0.25`
- triplet 8ths: `0.333`
- 16th triplets: `0.166`

It excludes normal swing eighth:

```text
0.67 / 0.33
```

Additional direct 16th-run signal:

```text
fraction set contains at least three of:
0.00, 0.25, 0.50, 0.75
within one beat or across adjacent beats
```

Important squeezed-pattern detector:

```text
prev onset frac around 0.25
current onset frac around 0.50
next onset frac around 0.75
```

When this pattern exists, do not swing the `.50` event.

## 6. Swing Rules

### 6.1 Eighth Swing

For ordinary eighth material:

```text
0.00, 0.50, 1.00
```

Apply swing:

```text
0.00, swingRatio, 1.00
```

Preserve the current behavior of extending the previous event to close the swing gap before articulation scaling.

### 6.2 Protected 16th Runs

For continuous 16th material:

```text
0.00, 0.25, 0.50, 0.75, 1.00
```

Do not swing only the `.50` onset.

Recommended Phase 1 behavior:

```text
leave these onsets straight:
0.00, 0.25, 0.50, 0.75, 1.00
```

Then let the existing jazz legato pass connect durations.

Rationale:

- It avoids `0.08 beat` squeeze artifacts.
- It is deterministic.
- It is easy to test.
- It is musically better than context-free partial swing.

Future option, not required in this task:

```text
convert whole 16th runs into a coherent swung-16th or triplet feel
```

Do not attempt that in Phase 1 unless necessary.

### 6.3 Triplet-Authored Material

Events already near:

```text
0.333, 0.667
```

should remain unchanged.

The current comment in `mgStyleRenderer.ts` says triplet positions are left unchanged. Preserve that intent.

### 6.4 Micro-IOI Guard

After context-aware swing, no generated lead line should contain unintentional IOIs below:

```text
0.12 beat
```

If a post-swing result produces an IOI below this threshold, that is a red flag.

Phase 1 policy:

- Prefer preventing the swing move that caused it.
- Do not blindly quantize all notes after the fact.
- Do not delete notes.

## 7. Q+N Implementation Plan

### Step 1: Preserve strict utility behavior by default

`renderStyleFeel()` currently has parity tests against MG oracle fixtures.

Do not silently break the oracle tests without making the design explicit.

Recommended approach:

```ts
export interface RenderArgs {
  events: NoteEvent[];
  feel: ImprovisorStyleFeel;
  rng?: () => number;
  protectFastRuns?: boolean; // default false to preserve old strict behavior in oracle tests
}
```

Then production Q+N calls:

```ts
renderStyleFeel({
  events: melody,
  feel: feelForStyle(style),
  rng: mgRng,
  protectFastRuns: style === 'JAZZ' || style === 'BLUES',
});
```

This keeps old direct `renderStyleFeel()` tests meaningful while allowing production to choose the musicality-safe fusion path.

If Claude chooses to change the default instead, update the existing oracle/parity tests and comments so they no longer claim exact MG timing parity for production-safe jazz 16th runs.

### Step 2: Add context-aware `.5` swing gate

Inside the swing section, replace:

```ts
if (Math.abs(beatFrac - 0.5) < 0.05 && feel.swingRatio !== 0.5) {
```

with a helper decision:

```ts
if (shouldSwingAsEighthOffbeat(events, i, feel, options)) {
```

Expected behavior:

```text
[0.00, 0.50, 1.00]           -> swing .50
[0.00, 0.25, 0.50, 0.75]    -> do not swing .50
[0.00, 0.333, 0.667, 1.00]  -> do not change triplets
```

### Step 3: Keep legato after timing

Do not remove:

```text
connectFastLeadNoteIR()
```

The correct final order is:

```text
raw MG events
-> context-aware style timing
-> pitch/harmony shaping
-> NoteIR tick conversion
-> fast-note legato
-> final renderCoordinator humanize
-> final fast-note legato safety gate
```

Legato must remain after timing, because it depends on final onset positions.

## 8. Q+R Implementation Plan

Q+R currently uses:

```text
src/core/generation/motifSandbox/model/leadOnlyIr.ts
swungBeat()
toNoteIR()
```

Add the same fast-line protection for lead notes.

Recommended low-risk approach:

1. Keep `swungBeat()` for non-lead accompaniment if needed.
2. For lead notes, sort the `PlayNote[]`.
3. Apply shared context-aware swing to lead `onsetBeat` and `durationBeat`.
4. Convert to `NoteIR`.
5. Run existing `connectFastLeadNoteIR()`.

Do not change motif analysis, brick detection, roadmap slot planning, or weaver behavior.

This task is only preview/render timing.

Acceptance example for Q+R:

```text
input lead beats:
0.00, 0.25, 0.50, 0.75, 1.00

jazz preview output:
must not contain IOI < 0.12 beat
must not produce .25 -> .67 -> .75 squeeze
```

## 9. Tests To Add

### 9.1 Unit: Q+N style renderer

File suggestion:

```text
src/core/generation/newEngine/render/leadGridTiming.test.ts
```

or extend:

```text
src/core/generation/newEngine/render/mgStyleRenderer.test.ts
```

Required cases:

```text
case A: eighth swing still works
input:  0.00, 0.50, 1.00
output: 0.00, 0.67, 1.00
```

```text
case B: straight 16th run is protected
input:  0.00, 0.25, 0.50, 0.75, 1.00
output: no IOI < 0.12 beat
output: .50 is not moved to .67 while .75 stays .75
recommended output: 0.00, 0.25, 0.50, 0.75, 1.00
```

```text
case C: triplet-authored line remains unchanged
input:  0.00, 0.333, 0.667, 1.00
output: same onsets, within epsilon
```

```text
case D: mixed local squeeze is prevented
input:  28.00, 28.25, 28.50, 28.75, 29.00
output: no 28.67 -> 28.75 micro IOI
```

### 9.2 Integration: seed 564417 jazz

Extend existing lead articulation tests or add:

```text
src/core/generation/newEngine/render/leadGridTiming.integration.test.ts
```

Generate:

```ts
generateSong({
  seed: 564417,
  styleHint: 'jazz',
  mood: 'build',
  targetDuration: 120,
  key: pc(0),
});
```

Assertions:

```text
lead exists
leadLegatoMetrics(...).touchOrTinyGapRate >= 0.8
leadLegatoMetrics(...).microIoiCount === 0
no adjacent lead IOI < ppq * 0.12
```

If a tiny number of intentional grace notes appears later, the threshold can become:

```text
microIoiCount <= 2
```

But for seed `564417`, target should be `0`.

### 9.3 Q+R sandbox preview test

File suggestion:

```text
src/core/generation/motifSandbox/model/leadGridTiming.test.ts
```

Construct a jazz lead-only preview from motif notes:

```text
0.00, 0.25, 0.50, 0.75, 1.00
```

Assert:

```text
no IOI < ppq * 0.12
fast notes still touch after connectFastLeadNoteIR()
pitch/start count unchanged except intended timing warp
```

## 10. MIDI / Ear-Check Commands

After implementation, export `564417 jazz` again:

```bash
mkdir -p tmp/midi-analysis
npx tsx --eval "
import { writeFileSync } from 'node:fs';
import { generateSong } from './src/core/generation/newEngine/generation/GenerationController';
import { musicalIRToSMF } from './src/core/generation/newEngine/sandbox/midiFile';
const res = generateSong({ seed: 564417, styleHint: 'jazz', mood: 'build', targetDuration: 120, key: 0 as any } as any);
if (!res.ir) throw new Error('generation failed');
const bpm = res.ir.tempoMap?.[0]?.bpm ?? 120;
writeFileSync('tmp/midi-analysis/seed-564417-jazz-after-grid-owner.mid', Buffer.from(musicalIRToSMF(res.ir, bpm, 'jazz')));
console.log('tmp/midi-analysis/seed-564417-jazz-after-grid-owner.mid');
"
```

Compare against:

```text
tmp/midi-analysis/seed-564417-jazz.mid
tmp/midi-analysis/seed-564417-jazz-lead-raw-before-style.mid
tmp/midi-analysis/seed-564417-jazz-lead-after-style.mid
```

Expected listening result:

- The fast run should no longer feel like it hiccups or jumps ahead.
- The line can still be busy and bebop-like.
- The run should feel connected because legato still runs after timing.

## 11. Non-Goals

Do not do these in this task:

- Do not rewrite MG grammar.
- Do not remove enriched jazz grammar.
- Do not alter RoadMap / brick parsing.
- Do not change chord progression selection.
- Do not alter motif brick classification.
- Do not solve full Q+N orchestration integration.
- Do not delete the existing fast-note legato pass.
- Do not globally quantize every lead note to a fixed grid after rendering.

## 12. Acceptance Checklist

- `564417 jazz` no longer has the `30, 51, 10, 30` squeezed run pattern.
- `564417 jazz` lead has `microIoiCount === 0` or an explicitly justified near-zero threshold.
- Eighth swing still works for ordinary `0, .5, 1` material.
- 16th runs are protected from `.5 -> .67` partial swing.
- Triplet-authored material remains unchanged.
- Q+N and Q+R both use the same timing policy or equivalent shared helper.
- Existing legato metrics remain good.
- No production behavior changes for non-jazz styles unless tests explicitly prove no-op behavior.

## 13. Why This Is The Right Layer

This is a render-layer timing problem.

The generator produced a coherent raw 16th run:

```text
28.00, 28.25, 28.50, 28.75
```

The render style layer changed only one point in that run:

```text
28.50 -> 28.67
```

Therefore the fix belongs where swing timing is applied, not in melody generation, harmony, or motif analysis.

Final desired pipeline:

```text
melody grammar decides notes
roadmap decides phrase/brick structure
render grid owner decides coherent timing feel
legato connects fast lead durations
MIDI export/audio plays the already-coherent result
```
