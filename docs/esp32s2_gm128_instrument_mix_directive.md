# ESP32-S2 GM128 Instrument Mix Directive

Date: 2026-06-10

Audience: Claude

This directive is only about the instrumentation layer's selected GM instruments and their mix/space controls. Do not modify accompaniment texture, voicing density, melody generation, harmony generation, or MG migration logic.

## Goal

The user has already selected the instrument palette. The next step is to make those selected GM programs sound better, especially under the ESP32-S2 target constraint.

The engine must stop treating CC values as fixed by role only. It should choose:

- CC7 Volume
- CC10 Pan
- CC91 Reverb Send
- CC93 Chorus Send
- optional CC11 Expression, only as a static/section-level value

from:

```text
style + timbreWorld + role + selected GM program
```

The result should be a coherent "band in a room", not five unrelated GM patches.

## Strict Non-Goals

Do not change:

- melody generation
- harmony generation
- accompaniment texture switching
- comp voicing
- pad voicing
- bass patterning
- drum groove generation
- MG lead parity
- texture dry parity

Do not solve this by changing note events. This task is about instrument mix metadata and MIDI CC emission only.

Do not replace the user's current instrument palette. You may add metadata/classification for already selected programs, but do not redesign the program pools unless a test proves a program cannot be represented at all.

## ESP32-S2 Constraint

On ESP32-S2, GM128 should be treated as:

```text
GM program number = arrangement/instrument identity label
device patch      = small safe implementation for that identity
```

Therefore the mix logic must be small, table-driven, deterministic, and integer-friendly.

Requirements:

- No runtime-heavy DSP assumptions.
- No dense CC automation streams.
- Emit CC setup at tick 0.
- If a role changes program at a section boundary, emit the matching CC setup at that same boundary after the program change.
- If ESP32-S2 firmware ignores CC93, the event may be a no-op, but the web/MIDI path should still emit it for preview parity.
- Clamp all CC values to `0..127`.

## Current Code Context

Relevant files:

- `src/core/generation/newEngine/knowledge/instruments.ts`
- `src/core/generation/newEngine/instrumental/InstrumentationPlan.ts`
- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`
- `src/core/generation/newEngine/ir/MusicalIR.ts`
- `src/core/generation/newEngine/render/renderCoordinator.ts`
- `src/core/generation/newEngine/sandbox/irToMidi.ts`

Current issue:

- Instrument selection and `timbreWorld` already exist in the instrumentation layer.
- MIDI output still has role-fixed CC defaults in `irToMidi.ts`.
- CC values are not sufficiently aware of selected GM program.
- CC93 chorus is not emitted.
- Mix values are not owned by the instrumentation layer.

## Architecture Required

### 1. Add Mix Types

Add a compact mix type. Exact names may follow local style, but the shape should be equivalent:

```ts
export interface RoleMix {
  volume: number;      // CC7
  pan: number;         // CC10
  reverb: number;      // CC91
  chorus: number;      // CC93
  expression?: number; // CC11, optional static value only
}
```

Add to `InstrumentationPlanData`:

```ts
mixByRoleSection: Record<InstrumentRoleName, Record<SectionId, RoleMix>>;
spaceProfile: 'popWarmRoom' | 'lofiTapeRoom' | 'rnbPlateRoom' | 'jazzClub' | 'dryFront' | 'syntheticSoftRoom';
```

Reason:

- `programByRoleSection` can differ across sections.
- Mix must follow the effective section program.
- If the same role changes program, the CC setup must change with it.

### 2. Carry Mix Into IR

Recommended implementation:

Extend `TrackIR`:

```ts
export interface TrackMix {
  volume: number;
  pan: number;
  reverb: number;
  chorus: number;
  expression?: number;
}

export interface TrackIR {
  ...
  mix?: TrackMix;
  mixChanges?: { atTick: Ticks; mix: TrackMix }[];
}
```

Then in `renderCoordinator.ts`, when it attaches `program` / `programChanges`, also attach:

- initial `mix`
- `mixChanges` at the same section boundary ticks where the section mix differs

Do not let `irToMidi.ts` query `InstrumentationPlan` directly. MIDI conversion should consume the final IR only.

### 3. MIDI Output Must Consume Track Mix

Update `irToMidi.ts`:

- Add `CC_CHORUS = 93`.
- Add optional `CC_EXPRESSION = 11`.
- Keep role channel routing.
- Use `track.mix` first.
- Fall back to old role defaults only if `track.mix` is absent.

At tick 0, emit:

```text
programChange
CC7
CC10
CC91
CC93
CC11 if present
CC64 pedal if present
```

At each `programChanges` tick:

```text
programChange
matching CC7/10/91/93/11 for that section
```

Ordering must remain:

```text
programChange before CC before noteOn
```

## Mix Selection Rules

### Global Role Defaults

Use these as fallback before instrument-specific overrides:

```text
bass:
  volume 58-72
  pan 64
  reverb 0-8
  chorus 0-8

comp:
  volume 78-96
  pan 46-56 if pad exists, otherwise 54-64
  reverb 28-52
  chorus 8-65

lead:
  volume 74-92
  pan 60-68
  reverb 35-65
  chorus 0-45

pad:
  volume 68-86
  pan 78-100 or 28-50, opposite comp when possible
  reverb 65-95
  chorus 45-90

drum:
  volume 92-108
  pan 64
  reverb 12-30
  chorus 0
```

### Space Profiles

Pick one per song from style/timbreWorld.

```text
popWarmRoom:
  bass dry, comp medium, lead medium, pad wet

lofiTapeRoom:
  bass very dry, drum modest, comp warm but not huge, lead slightly dry, pad wet

rnbPlateRoom:
  bass dry, comp short plate, lead moderate, pad wide/wet, drums controlled

jazzClub:
  bass dry-small room, comp small room, lead small-medium room, pad restrained

dryFront:
  everything drier, used when no pad or very sparse instrumentation

syntheticSoftRoom:
  synth bass dry, electric keys medium chorus, pad wet and wide
```

Suggested mapping:

```text
style jazz -> jazzClub
style lofi -> lofiTapeRoom
style rnb  -> rnbPlateRoom
style pop + timbreWorld syntheticSoft -> syntheticSoftRoom
style pop + no pad -> dryFront or popWarmRoom with lower reverb
default -> popWarmRoom
```

### Program-Specific Rules

Use exact GM program numbers from current palette.

#### Piano Family: GM0/1/2/3

```text
comp:
  volume 82-88
  pan 48-56
  reverb 34-46
  chorus 0-12

lead:
  volume 80-86
  pan 64
  reverb 42-52
  chorus 0-10
```

Bright piano (`1`) should not be too wet. If it sounds sharp, reduce volume by 4 and reverb by 5.

#### Electric Piano: GM4/5

```text
comp:
  volume 86-92
  pan 50-56
  reverb 38-48
  chorus 48-68

lead:
  volume 78-84
  pan 64
  reverb 40-50
  chorus 38-58
```

This is the most important GM family for POP / LOFI / RNB. Chorus is allowed to carry width, but volume must not overpower lead.

#### Harpsichord: GM6

```text
lead or comp:
  volume 76-84
  pan 54-74 depending on role
  reverb 24-34
  chorus 0-8
```

Keep it dry enough to preserve attack. Too much reverb makes it noisy.

#### Clavinet: GM7

```text
comp:
  volume 80-86
  pan 46-54
  reverb 18-28
  chorus 8-24
```

Clav should be dry, short, and forward.

#### Vibraphone: GM11

```text
lead:
  volume 76-82
  pan 64
  reverb 52-64
  chorus 24-40
```

Vibraphone can be wetter than marimba because the metallic sustain benefits from space.

#### Marimba / Kalimba: GM12 / GM108

```text
lead:
  volume 78-84
  pan 64
  reverb 36-46
  chorus 0-14
```

Keep the wooden attack clear. Do not over-chorus.

#### Organ: GM16

Only use as pad/sustain layer in current policy.

```text
pad:
  volume 66-76
  pan 72-88
  reverb 44-58
  chorus 55-75
```

Organ should support space, not dominate.

#### Acoustic / Electric Bass: GM32/33/35

```text
bass:
  volume 62-70
  pan 64
  reverb 2-8
  chorus 0-4
```

Fretless bass (`35`) may use chorus up to 8 if needed, but keep it subtle.

#### Synth Bass: GM38/39

```text
bass:
  volume 58-66
  pan 64
  reverb 0-4
  chorus 4-10
```

Very dry. Width belongs to upper layers, not low end.

#### Warm Pad Family: GM88/89/94/95

```text
pad:
  volume 70-84
  pan 82-96 or 32-46
  reverb 76-92
  chorus 68-90
```

Pad should feel wide, not loud. If pad is present with active comp, prefer lower volume and higher width.

#### FX Pads: GM98/99/100/102

```text
pad:
  volume 56-72
  pan 86-100 or 28-42
  reverb 84-100
  chorus 72-92
```

These are air layers. Keep volume lower than warm pad. They should not become the harmonic foreground.

#### Drums

```text
drum:
  volume 96-106
  pan 64
  reverb 14-28
  chorus 0
```

If using brush/jazz kit in the future, reverb may rise slightly, but keep kick dry.

## Pan Rules

Lead, bass, and kick/snare center:

```text
lead pan 60-68
bass pan 64
drum pan 64
```

Comp and pad should create width:

```text
if pad active:
  comp pan 48-56
  pad pan 78-96

if no pad:
  comp pan 56-64
```

If a future role uses a right-heavy comp, put pad left. The invariant is:

```text
abs(comp.pan - pad.pan) >= 22 when both are active
```

Do not hard-pan lead.

## Volume Balance Rules

Do not make pad loud just because it is wet.

Expected relative loudness:

```text
bass: stable but not booming
comp: audible body
lead: clear center
pad: felt more than heard
drum: present, not louder than the whole band
```

Guardrails:

```text
bass.reverb <= 8
drum.chorus == 0
pad.reverb >= comp.reverb + 20 when pad is active
pad.volume <= comp.volume unless pad is the only harmonic support
fxPad.volume <= 72
electricPiano.chorus >= 38 when role is lead/comp
clav.reverb <= 30
marimbaOrKalimba.chorus <= 16
```

## Implementation Hints

Suggested helper:

```ts
export function mixForProgram(args: {
  style: string;
  timbreWorld: TimbreWorld;
  role: InstrumentRoleName;
  program: number;
  hasPad: boolean;
  padActiveInSection: boolean;
  compProgram?: number;
  padProgram?: number;
}): RoleMix
```

Suggested planner flow:

```text
1. pick/repair roleProgram
2. classify timbreWorld
3. build programByRoleSection
4. choose spaceProfile
5. build mixByRoleSection from effective programByRoleSection
6. freeze InstrumentationPlan
```

Important:

- Use the effective program after `repairCompCapability`, `repairWorldMismatches`, and `coherentLeadComp`.
- Do not use provisional `band.roleProgram` as the final mix source.
- If `programByRoleSection` changes at chorus, `mixByRoleSection` must change too if the new program requires different mix.

## Validation Required

Claude must add/adjust tests. Do not mark complete without tests.

### Required Unit Tests

Add:

```text
src/core/generation/newEngine/instrumental/gmMixProfile.test.ts
```

Assertions:

- Every selected role/program in POP, LOFI, RNB, JAZZ receives a `RoleMix`.
- All CC values are integers in `0..127`.
- Bass reverb is always `<= 8`.
- Drum chorus is always `0`.
- Pads have higher reverb than comp by at least `20` when both are active.
- FX pads `98/99/100/102` have volume `<= 72` and reverb `>= 84`.
- Electric piano `4/5` has chorus `>= 38` when used as lead or comp.
- Clav `7` has reverb `<= 30`.
- Marimba/Kalimba `12/108` has chorus `<= 16`.
- Lead pan stays near center: `58..70`.
- If comp and pad are both active, their pan distance is at least `22`.

Add or update:

```text
src/core/generation/newEngine/sandbox/irToMidiMix.test.ts
```

Assertions:

- CC7, CC10, CC91, and CC93 are emitted at tick 0 for every track.
- If CC11 exists in `track.mix`, it is emitted.
- Program change boundary emits matching CC refresh at the same tick.
- Program change occurs before CC at the same tick.
- CC occurs before noteOn at the same tick.
- Fallback old role defaults only apply when `track.mix` is missing.

Add or update an end-to-end render test:

```text
src/core/generation/newEngine/render/gmMixAttachment.test.ts
```

Assertions:

- `renderSongFull(...)` attaches `mix` to all tracks.
- If a track has `programChanges`, it also has corresponding `mixChanges`.
- `lead` event parity remains untouched. This test should not compare or mutate lead notes.

### Golden Seeds To Check

Run at least:

```text
7 / lofi
396040 / pop
777870 / rnb
633823 / pop
64062 / lofi
959571 / rnb
```

For each seed, print or assert a compact mix summary:

```text
role GM program volume pan reverb chorus expression?
```

Expected qualitative checks:

- Bass is dry and centered.
- Lead is centered and not over-wet.
- Pad is wider/wetter than comp.
- Electric keys have chorus.
- Clav stays dry.
- FX pad, if selected, is low-volume air.

### Test Commands

Run:

```bash
npx vitest run \
  src/core/generation/newEngine/instrumental/gmMixProfile.test.ts \
  src/core/generation/newEngine/sandbox/irToMidiMix.test.ts \
  src/core/generation/newEngine/render/gmMixAttachment.test.ts \
  src/core/generation/newEngine/knowledge/instrumentCapability.test.ts \
  src/core/generation/newEngine/knowledge/instrumentPairing.test.ts \
  src/core/generation/newEngine/knowledge/timbreWorld.test.ts \
  src/core/generation/newEngine/instrumental/instrumentalPlanner.test.ts \
  src/core/generation/newEngine/render/mgFinalLeadParity.test.ts \
  src/core/generation/newEngine/render/productLeadNonMutation.test.ts
```

Then run:

```bash
npx vitest run src/core/generation/newEngine
```

## Acceptance Criteria

This task is complete only when:

- Mix/space is decided by instrumentation layer, not hard-coded by MIDI conversion.
- `irToMidi.ts` consumes final track mix metadata.
- CC93 chorus is emitted.
- Bass/drum remain dry enough.
- Pad is wet/wide but not loud.
- Electric piano gets useful chorus.
- FX pads are low-volume air layers.
- Existing lead parity tests still pass.
- Full newEngine test suite passes.

## Final Report Format

Claude should report:

```text
Completed:
- Instrumentation-owned mixByRoleSection: yes/no
- TrackIR mix/mixChanges attached: yes/no
- irToMidi consumes CC7/10/91/93 from track mix: yes/no
- ESP32-S2-safe sparse CC emission: yes/no

Files changed:
- ...

Tests run:
- ...

Golden seed mix summaries:
- 7/lofi: ...
- 396040/pop: ...
- 777870/rnb: ...
- 633823/pop: ...
- 64062/lofi: ...
- 959571/rnb: ...

Known leftovers:
- ...
```

Do not claim this task changes musical texture. It is only an instrument mix and CC routing task.
