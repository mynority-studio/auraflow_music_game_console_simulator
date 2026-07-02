# ACG Render-Layer MG Feel Directive

Date: 2026-07-02

## Non-Negotiable Constraint

Do not break or bypass the Simulator main architecture.

ACG must still use the Simulator pipeline:

```text
request -> band -> arranger -> harmony -> instrumentation -> render -> audit -> IR/audio
```

Do not replace the Simulator arranger with MG's 16-bar generator. Do not turn ACG into a fixed 16-bar MG loop. Do not import the MG engine as the product path.

The goal is:

```text
Keep Simulator's full-song architecture, but make the render-layer interpretation of ACG sound like MG ACG.
```

In other words, render should act as an "MG ACG piano-performance lens" over the Simulator's existing chord timeline and section plan.

## Important Reframe

Recent audits showed that the remaining mismatch is not because comp arpeggio or pad removal failed. Those are now mostly fixed.

The true reason the full song can still sound unlike MG is:

- MG audit is a 16-bar loop.
- Simulator is a full arranger song, often 38-54 bars.
- The same numeric seed does not produce the same harmonic story.
- Simulator section/texture narrative is different from MG's 16-bar ACG loop.
- Audio playback chain can also differ.

Under the non-negotiable architecture constraint, exact whole-song MG parity is not the target. The target is MG-like ACG feel inside the Simulator song.

## Current Verified Good State

Keep these contracts locked.

### ACG Roles

- Must emit `lead + comp + bass`.
- Must not emit `pad`.
- Must not emit `drum` for MG-fidelity comparison.
- `lead` and `comp` may both use piano program, but they must remain separate tracks/channels.

### ACG Comp Final Form

- Comp final onset form must be mostly single-note rolled arpeggio.
- Same-onset block/dyad comp must remain rare.
- Existing hard targets:
  - `singleRatio >= 0.9`
  - `blockRatio <= 0.05`
  - offgrid arpeggio velocity roughly `25-34`, ideally near MG `28-30`

### ACG Lead Presence

- Section-level lead coverage/maxGap must not create empty chorus/verse beds.
- Keep breathing silence, but avoid long lead disappearance in active sections.

## What Must Not Be Done

Do not fix the remaining mismatch by:

- replacing `buildArrangementPlan`
- forcing all ACG output to 16 bars
- bypassing `buildHarmonicPlanFromArrangement`
- changing global `GenerationController`
- moving groove ownership out of arranger
- making ACG a separate product pipeline
- adding pad back as atmosphere
- merging lead and comp into one track

## Render-Layer Strategy

All remaining ACG feel corrections should live in or below render/instrumentation-facing render preparation.

Allowed implementation zones:

- `src/core/generation/newEngine/render/*`
- `src/core/generation/newEngine/instrumental/*` only when deciding render-facing texture/mix, not changing form/harmony ownership
- `src/core/generation/newEngine/knowledge/*` only for ACG render profile data
- audit/test scripts under `scripts/` and tests under `src/core/generation/...`

Avoid changing arranger/harmony semantics unless the change is purely exposing metadata already needed by render.

## P1: ACG Render Profile

Create or consolidate an explicit ACG render profile consumed by render.

The profile should encode the MG ACG performance identity:

- piano-only core
- melody-first
- soft rolled comp
- sparse but present bass
- no pad fog
- chord-roll after humanize
- comp ducks/carves around lead
- pedal supplies space
- texture family should respond to section energy without losing MG air

This profile should not choose the song form. It only interprets the already-planned song.

## P1: Section-Level MG Feel Lens

Because SIM uses full-song sections, render should apply MG-style local targets per section.

For every ACG section, compute render-time metrics and repair only inside render:

- comp/bar
- bass/bar
- lead coverage
- lead maxGap
- lead register
- comp onset single/block ratio
- offgrid comp velocity

Use MG 16-bar audit as a ruler, not as the product form.

Implementation direction:

- Keep the existing `audit-acg-per-section-feel.ts`.
- Add warnings/hard tests when active sections drift beyond MG-like local feel.
- If lead is too empty, use a render-layer lead-gap repair pass that inserts/extends MG-style cantabile notes using current chord context.
- If comp is too blocky, keep `chordRoll` as final pass.
- If comp is too dense, carve/duck rather than removing the whole texture identity.

## P1: Harmony-Aware Render Interpretation

The render layer must not replace the harmonic plan, but it can interpret any given chord through MG ACG piano rules.

For each `ChordSpan`:

- Use the current chord's written contract and chord-scale context.
- Generate ACG comp/bass/lead gestures using the chord as input.
- Do not require the chord progression to match MG's 16-bar progression.
- Avoid judging failure by exact roman sequence mismatch.

This matters because the Simulator may produce a different harmonic story from MG for the same seed. The render target is:

```text
Whatever chord the Simulator gives us should be performed in MG ACG piano language.
```

## P2: Texture Family Balance In Render

Do not merely count texture uniqueness. Control the macro family balance at render-facing texture selection.

Families:

- `space`: `Piano_TopVoice_Planing`, `ACG_Pedal_Wash_Color_Drops`, `ACG_Sakamoto_LH_Arp_RH_Penta`
- `drive`: `ACG_Quartal_Arp_Wave`, `ACG_Open_Broken_10th`, `ACG_Ostinato_Hook_Pulse`
- `block`: `ACG_Anthem_Block_Push`, `ACG_Suspended_Block_Arrival`
- `wash`: `ACG_Bass_Tremolo_Color`, `ACG_Stride_Cantabile_Ballad`

Desired behavior:

- Intro/outro should usually allow more `space/wash`.
- Chorus/build can use more `drive`, but should not become block-heavy unless the harmonic/energy context justifies it.
- If `block` exceeds MG-like proportions, prefer rolling/planing treatment instead of same-onset density.
- Per-song texture character is fine, but it must not erase MG air.

This remains render/instrumentation-facing texture scheduling, not arranger replacement.

## P2: Audio-Chain A/B

Even if MIDI feels close, audio can differ.

Recent workspace changes include SoundFont and playback chain changes. If the user reports that the same IR still sounds unlike MG, add a diagnostic A/B mode:

- ACG MG-feel playback preset
- same piano program for lead/comp
- same or deliberately matched reverb/chorus/pan
- no pad
- no extra master coloration beyond the selected preset

This should be a playback/mix preset, not a generation architecture change.

## Required Tests And Audits

Keep existing tests, and add/maintain:

1. ACG no-pad hard test.
2. ACG separate lead/comp/bass hard test.
3. ACG comp final onset-form hard test.
4. ACG per-section feel audit.
5. ACG texture family ratio audit.
6. ACG audio-chain/preset smoke test if playback differences remain.

Audit output should answer two separate questions:

```text
1. Does the Simulator section use MG-like local ACG performance rules?
2. Is the full-song architecture still the Simulator architecture?
```

Do not collapse these into one "same as MG" score.

## Acceptance Criteria

The ACG render-layer implementation is acceptable when:

- Simulator still emits full songs with the normal main chain.
- ACG has no pad/drum in MG-fidelity comparison.
- ACG comp is rolled/single-note, not block-bed.
- ACG lead is present enough in active sections.
- ACG bass is supportive and sparse.
- Texture family balance no longer makes the song feel like generic J-pop block comp unless the section energy calls for it.
- The user can hear the MG-like piano language while still getting a Simulator full-song arrangement.

## Short Version For Claude

Do not chase exact MG whole-song parity by changing arranger or harmony.

The task is render-only:

```text
Take the Simulator's existing chord/section plan and perform it with MG ACG piano rules.
```

If it still sounds unlike MG, debug in this order:

1. Audio chain / SoundFont / mix preset.
2. Section lead coverage and maxGap.
3. Texture family balance.
4. Comp onset-form regression.
5. Bass density/support.

Do not reintroduce pad, do not collapse lead+comp, and do not replace the Simulator song architecture.
