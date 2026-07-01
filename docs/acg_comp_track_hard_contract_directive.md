# ACG Comp Track Hard Contract Directive

Date: 2026-07-01

Audience: Claude / next implementation agent.

Scope: `auraflow_music_game_console_simulator` Q+N main music generation path.

Source of truth: current `../melodygenerative` ACG production behavior.

## 0. Executive Summary

This is a P0 repair.

Simulator ACG must not collapse accompaniment into the lead track. Current MG
ACG is a piano-writing model:

```txt
lead = melody / topline
comp = independent piano accompaniment, arpeggio, air color, harmonic body
```

Even when both roles use the same GM program `0` Acoustic Grand, they are still
two musical roles and must remain two IR tracks, two MIDI channels, two mix
lanes, and two render responsibilities.

The current simulator path can lose that contract when Band Selection / Q+N
lineup constraints remove `comp`, or when product logic treats "same piano
program" as if lead and comp are one instrument. That is not MG fidelity.

Do not fix this by making the lead bus louder, adding more lead notes, or
stuffing accompaniment notes into `lead`. The fix is to make ACG comp a hard
generation contract.

## 1. Required Preflight

Before editing, read these files in both repositories and verify current code,
not memory:

Simulator:

- `src/core/generation/musicGeneration/MusicGenerationService.ts`
- `src/core/generation/musicGeneration/participantConstraint.ts`
- `src/core/generation/newEngine/band/bandEngine.ts`
- `src/core/generation/newEngine/knowledge/instruments.ts`
- `src/core/generation/newEngine/render/renderCoordinator.ts`
- `src/core/generation/newEngine/render/accompanimentRenderer.ts`
- `src/core/audio/musicalIrToMidi.ts`
- `src/core/generation/musicGeneration/qnUiProjection.ts`

MG reference:

- `../melodygenerative/src/lib/musicEngine.ts`
- `../melodygenerative/src/lib/styleDictionary.ts`

Run `git status --short` in both repos and record the commit/worktree state in
your final note.

## 2. P0 Contract

For every ACG generation in simulator:

1. Final `MusicalIR.tracks` must contain a `lead` track.
2. Final `MusicalIR.tracks` must contain a `comp` track.
3. `lead` and `comp` must not be merged, even if both use GM program `0`.
4. `lead` must stay on the lead role/channel.
5. `comp` must stay on the comp role/channel.
6. ACG texture scheduling and ACG accompaniment rendering must write to `comp`,
   not to `lead`.
7. If ACG comp cannot be rendered, generation should fail an invariant/test,
   not silently degrade to lead-only.

Minimum ACG role set:

```txt
lead + comp + bass
```

Pad may remain optional. Drum is not part of the MG-faithful ACG core.

For this P0, do not add a drum workaround. The required repair is:

```txt
ACG core = lead + comp + bass
```

If the UI has a selected drummer state, that state must not delete or replace
the ACG core. Either ignore/disable the drummer selection for ACG fidelity, or
leave drummer integration to a separate explicit product decision. It must never
produce `drum + lead` without `comp`.

## 3. Current Failure Mode

Observed same-seed ACG behavior:

```txt
default ACG:
  tracks = bass + comp + pad + lead

selected drummer:
  tracks = drum + lead
  comp missing
  bass missing
  pad missing

keyboardist disabled:
  tracks = bass + pad + lead
  comp missing
```

This explains the audible report:

```txt
"Simulator ACG arpeggio comp layer and MG sound completely different."
```

When `comp` is absent, the ACG arpeggio / air / harmonic body cannot exist in
the correct musical lane. The lead melody cannot compensate for that without
changing MG's writing model.

## 4. Root Cause

### 4.1 Participant constraints can remove comp

`deriveLineupConstraint` turns selected participants into an `allowedRoles`
whitelist. For example, selecting only drummer yields:

```txt
allowedRoles = drum
requiredRoles = drum
```

`bandEngine` then auto-fills `lead` as the minimum melodic role, but it does not
auto-fill `comp` for ACG. The result is `drum + lead`, which is legal for the
generic Q+N participant model but illegal for MG ACG fidelity.

### 4.2 RenderCoordinator only renders comp if comp is in lineup

`renderSongFull` currently does:

```ts
if (inLineup('comp')) tracks.push(...renderAccompaniment(...));
tracks.push(renderMgMelody(...));
```

So once band/instrumentation drops `comp`, render has no ACG accompaniment lane.

### 4.3 Same program is not same role

ACG intentionally uses:

```txt
lead program = 0
comp program = 0
```

This means "same piano timbre", not "same track". `musicalIrToMidi` already has
separate role channels:

```txt
lead -> channel 1
comp -> channel 2
```

Keep that. Do not dedupe/merge by program.

## 5. Required Repair

### 5.1 Add an ACG hard-core role policy

Implement a central policy, preferably in the band/instrument layer so all Q+N
entry points inherit it:

```ts
function hardRequiredRolesForStyle(style: string): InstrumentRoleName[] {
  return style.toLowerCase() === 'acg' ? ['lead', 'comp', 'bass'] : [];
}
```

Apply this after user participant constraints are interpreted but before the
final `BandSpec` is returned. This must live in the band/instrument layer so
every Q+N entry point receives the same ACG role contract.

Required behavior:

- ACG always contains `lead`, `comp`, `bass`.
- User selected/disabled states cannot remove these hard roles.
- `autoFilledRoles` should mark roles restored by the hard policy when useful
  for UI transparency.
- For non-ACG styles, preserve current participant behavior unless a test proves
  an existing regression.

Implementation requirements:

1. Enforce in `buildBandSpec` / role selection normalization.
2. `MusicGenerationService.toQnRequest` may also normalize ACG constraints for
   product clarity, but it must not be the only enforcement point.
3. `renderSongFull` may assert or report a hard invariant if ACG reaches render
   without `comp`, but it must not be the only place that repairs the missing
   role.

Do not implement this as "if comp missing, copy lead notes into comp." That is
musically wrong.

### 5.2 Make ACG comp render a hard invariant

After rendering ACG, assert/test:

```txt
ir.tracks.some(t => t.role === 'lead' && t.notes.length > 0)
ir.tracks.some(t => t.role === 'comp' && t.notes.length > 0)
leadTrack !== compTrack
leadTrack.role === 'lead'
compTrack.role === 'comp'
```

The comp note count should be non-trivial for ACG seeds. Do not require exact
note count parity yet, because texture selection parity is a separate task, but
do require that the comp lane is real.

### 5.3 Keep role/channel separation in MIDI projection

Verify `src/core/audio/musicalIrToMidi.ts` continues to emit:

```txt
lead -> channel 1
comp -> channel 2
```

Add or update a test that creates ACG with `lead.program === comp.program === 0`
and proves MIDI events still go to two channels.

This catches any future "same program, merge voices" mistake.

### 5.4 UI snapshot must show comp as its own role

`buildUiSnapshot` must continue to expose separate roster/tracks:

```txt
lead: Acoustic Grand
comp: Acoustic Grand
```

The UI may show that both are piano, but it must not hide `comp` just because
program names match.

### 5.5 ACG texture schedule belongs to comp

ACG rich texture / arpeggio / air-color rendering is accompaniment. The texture
schedule should be consumed by `renderAccompaniment` and produce `role: 'comp'`.

Do not route ACG texture hits through `renderMgMelody`.

## 6. Tests To Add

Add tests before or with the fix. Suggested file:

```txt
src/core/generation/musicGeneration/acgCompHardContract.test.ts
```

Required cases:

### 6.1 Default ACG has independent lead and comp

For at least 8 seeds:

```ts
const r = generateMusicSync({ seed, styleHint: 'acg', mood: 'build', targetDuration: 90 });
const roles = new Set(r.ir!.tracks.map((t) => t.role));
expect(roles.has('lead')).toBe(true);
expect(roles.has('comp')).toBe(true);
expect(roles.has('bass')).toBe(true);
```

Assert:

- `lead.notes.length > 0`
- `comp.notes.length > 0`
- `lead.program === 0`
- `comp.program === 0`
- `lead.role !== comp.role`
- pad is optional; do not assert either presence or absence.
- drum should be absent unless a separate explicit product decision adds ACG
  drums after preserving the core roles.

### 6.2 Band Selection cannot delete ACG comp

Use the failure cases directly:

```ts
selected drummer
keyboardist disabled
leadPlayer selected
only synthPlayer selected
```

For all of them:

```txt
lead exists
comp exists
bass exists
comp has notes
```

For selected drummer, the P0 expectation is:

```txt
selected drummer -> lead + comp + bass
```

Do not add `drum` in this P0. If product later chooses to allow ACG drums, that
must be a separate decision and must remain additive after the core ACG roles.

### 6.3 Same piano program does not merge lead/comp

Generate ACG and convert to MIDI:

```ts
const events = musicalIRToMidiEvents(r.ir!, roomWetFor('acg'));
```

Assert:

- lead noteOn events exist on channel `1`
- comp noteOn events exist on channel `2`
- both channels may have program `0`
- channel `1` and channel `2` both receive their own CC7/mix setup

### 6.4 ACG texture produces comp, not lead

For seeds that select ACG rich texture:

- `comp.notes.length` should be greater than a minimal threshold.
- `lead.notes` should remain melody-like, not polyphonic accompaniment dumps.

Do not overfit exact counts. Use structural checks:

- comp contains repeated accompaniment onsets / multi-note or arpeggio texture;
- lead stays mostly monophonic.

## 7. Tests To Run

After implementation:

```bash
npm test -- --run \
  src/core/generation/musicGeneration/acgCompHardContract.test.ts \
  src/core/generation/musicGeneration/MusicGenerationService.test.ts \
  src/core/generation/musicGeneration/participantConstraint.test.ts \
  src/core/generation/newEngine/band/bandEngine.test.ts \
  src/core/generation/newEngine/band/acgStyleRegistration.test.ts \
  src/core/generation/newEngine/render/acgCompAir.test.ts \
  src/core/generation/newEngine/render/textureContractCoverage.test.ts
```

Then run:

```bash
npm run audit:mg-current -- --full --write-report-only
```

Important: current `audit:mg-current` only live-checks RoadMap. Passing it does
not prove ACG comp fidelity. The new hard-contract tests are required.

## 8. Acceptance Criteria

This task is complete only when:

1. ACG default generation always has `lead`, `comp`, `bass`.
2. ACG with Band Selection states still always has `lead`, `comp`, `bass`.
3. ACG `comp` has real rendered notes.
4. `lead` and `comp` remain separate `TrackIR` objects.
5. MIDI projection keeps `lead` and `comp` on separate channels even when both
   use GM program `0`.
6. UI snapshot shows both roles separately.
7. New tests fail on the current broken behavior and pass after the fix.
8. Non-ACG participant behavior is not unintentionally rewritten.

## 9. Non-Goals

Do not solve these inside this P0 unless the fix naturally touches them:

- full ACG per-bar texture picker parity;
- missing 4 ACG progression variants;
- final lead topvoice/groove cohesion parity;
- velocity/reverb ear tuning;
- full MG byte parity for final comp.

Those remain separate fidelity tasks. This directive is narrower:

```txt
ACG must have a real independent comp track in the main chain.
```

Without this, every later ACG texture or mix repair is built on the wrong
musical structure.
