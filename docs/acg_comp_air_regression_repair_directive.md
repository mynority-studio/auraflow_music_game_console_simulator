# ACG Comp Air Regression Repair Directive

> Audience: Claude / next migration agent.
> Scope: simulator `newEngine` only.
> Goal: restore melodygenerative ACG piano accompaniment spaciousness without undoing prior POP/JAZZ/LOFI/RNB texture work.

## 0. Executive Summary

ACG migration is structurally present, but the ACG accompaniment does not sound like the upgraded `melodygenerative` source on the same seed. The audible symptom is specific:

- ACG arpeggio / comp layer lost the open cinematic piano air.
- Sparse upper color drops sound too filled-in or mid-register.
- The accompaniment feels closer to ordinary dense comping than Hisaishi / Sakamoto-style piano space.

This is not a seed determinism problem. It is a render policy conflict:

1. `melodygenerative` ACG texture cases intentionally generate high-register air/color notes around MIDI 69-81+.
2. simulator `renderAccompaniment` clamps comp under the lead reserved floor (`lead.lowMidi = 67`) before texture rendering.
3. simulator then globally boosts rich texture velocity and may add a downbeat guide-tone shell anchor for no-pad sections.
4. Those policies are useful for many band-style textures, but they erase the ACG piano writing contract.

Correct fix: add an ACG texture render policy path. Do not blanket change all styles.

## 1. Source Evidence

### 1.1 melodygenerative ACG writes high air/color notes

Source file:

- `../melodygenerative/src/lib/musicEngine.ts`

Key source behavior:

- `acgUpperColorMidis(targetMidi = 77)` searches written chord intervals in the upper melody/air zone.
- `acgUpperChordMidis(targetMidi = 69)` searches chord tones in the high comp zone.
- ACG cases call these helpers with targets such as `76`, `77`, `78`, `79`, `81`.

Relevant source locations:

- `musicEngine.ts:9339` `acgUpperColorMidis`
- `musicEngine.ts:9348` `acgUpperChordMidis`
- `musicEngine.ts:10331` `Piano_TopVoice_Planing`
- `musicEngine.ts:10367` `ACG_Quartal_Arp_Wave`
- `musicEngine.ts:10382` `ACG_Sakamoto_LH_Arp_RH_Penta`
- `musicEngine.ts:10483` `ACG_Open_Broken_10th`
- `musicEngine.ts:10529` `ACG_Pedal_Wash_Color_Drops`

Musical meaning: ACG comp is not merely "the same voicing with ACG rhythm." It relies on upper color events as part of the texture identity.

### 1.2 simulator currently removes that air before texture render

Files:

- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`
- `src/core/generation/newEngine/render/renderCoordinator.ts`
- `src/core/generation/newEngine/render/accompanimentRenderer.ts`

Current policy:

- `REGISTER_BY_ROLE.lead = rr(67, 84)`
- `renderCoordinator` passes `melodyFloorMidi: reservedReg.lowMidi`
- `renderAccompaniment` applies `yieldUnderMelody(ms, ctx.melodyFloorMidi, compFloor)`
- Result: comp voices at or above MIDI 67 are folded down or removed.

Relevant simulator locations:

- `instrumentalPlanner.ts:37` register policy
- `renderCoordinator.ts:286` passes `melodyFloorMidi`
- `accompanimentRenderer.ts:177` "comp top must be below lead reserved floor"
- `accompanimentRenderer.ts:180` `clampUnder`
- `accompanimentRenderer.ts:224-228` wide voicing is clamped before ACG texture cases consume it

This is correct for generic band comp avoiding the lead register, but wrong for ACG piano textures where upper color drops are authored texture events.

### 1.3 simulator ACG texture renderer uses already-clamped `cM`

File:

- `src/core/generation/newEngine/render/textureRenderer.ts`

Current ACG helper:

- `acgChordHits(cM, dur, tc)` derives `colorTop()` from `cM`.
- But `cM` is already the accompaniment voicing after register/yield constraints.
- Therefore ACG "colors" are often not true upper chord colors.

Relevant locations:

- `textureRenderer.ts:280` `colorTop`
- `textureRenderer.ts:304` `Piano_TopVoice_Planing`
- `textureRenderer.ts:315` `ACG_Quartal_Arp_Wave`
- `textureRenderer.ts:323` `ACG_Sakamoto_LH_Arp_RH_Penta`
- `textureRenderer.ts:354` `ACG_Open_Broken_10th`
- `textureRenderer.ts:377` `ACG_Pedal_Wash_Color_Drops`

This explains the seed-level listening difference: the same case name exists, but pitch/register semantics are not source-equivalent.

### 1.4 simulator globally boosts texture velocity

File:

- `src/core/generation/newEngine/render/accompanimentRenderer.ts`

Current mapping:

```ts
const vel = Math.max(1, Math.min(120, Math.round((h.vel * 0.92 + 0.42) * 127)));
```

Relevant location:

- `accompanimentRenderer.ts:281-284`

For ACG source hits around `0.18-0.28`, melodygenerative emits very soft notes. The simulator mapping lifts those into a much louder range, especially for single-note roll/air hits where `polyVelocity` does not attenuate. This fills the negative space.

### 1.5 simulator may add structural downbeat anchors over sparse ACG

Files:

- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`
- `src/core/generation/newEngine/render/accompanimentRenderer.ts`

Current policy:

- If a section has comp but no pad, mark `needsDownbeatCompAnchorBySection = true`.
- If a texture has first onset later than 0.08 beats, inject a light guide-tone shell at the section downbeat.

Relevant locations:

- `instrumentalPlanner.ts:463-466`
- `accompanimentRenderer.ts:290-299`

For ACG sparse / wash / planing textures, delayed or quiet entry is a feature, not a missing support bug.

## 2. Root Cause

The migration treated ACG texture cases as ordinary rich-texture rhythm patterns. It did not preserve the ACG-specific render contract:

```text
ACG texture identity = bass gesture + high color/air notes + soft velocity + intentional gaps
```

The simulator currently applies generic band-comp policies before and after ACG texture rendering:

```text
wide voicing -> clamp under lead floor -> ACG texture derives top colors from clamped voicing
             -> global velocity body lift
             -> optional downbeat shell anchor
```

That pipeline turns open piano air into denser mid-register support.

## 3. Required Fix

### 3.1 Add an ACG texture render policy

Introduce a narrow helper, for example:

```ts
function isAcgTextureCase(tc: string | undefined): boolean {
  return tc === 'Piano_TopVoice_Planing' || !!tc?.startsWith('ACG_');
}
```

Use it only where a concrete `textureCase` is known. Do not key broad behavior only on `style === 'acg'`, because future ACG may also reuse non-ACG support textures.

### 3.2 Preserve ACG high color notes

Recommended approach:

1. In `renderAccompaniment`, compute both:
   - normal `voicedBySpan` for non-ACG and fallback
   - an `airVoicedBySpan` or unclamped wide voicing for ACG texture rendering
2. For ACG texture cases, pass the unclamped / air-aware voicing into `renderTextureChordHits`.
3. Keep pad exact-pitch avoidance, but do not use `melodyFloorMidi` to delete all ACG high texture notes.

Important nuance:

- Do not remove collision handling globally.
- ACG high air notes may overlap the lead register. That is intentional when they are sparse/soft.
- If a same-pitch or m2 clash must be resolved, resolve it locally by dropping only the colliding voice or lowering velocity, not by folding every air voice below 67.

### 3.3 Give ACG texture renderer chord context

Current signature:

```ts
renderTextureChordHits(textureCase, voiced, durationBeats)
```

This is insufficient for MG-like ACG pitch semantics.

Preferred signature extension:

```ts
renderTextureChordHits(textureCase, voiced, durationBeats, {
  rootPc,
  chordType,
  quality,
  style,
})
```

Then implement ACG equivalents of source helpers:

- `acgUpperColorMidis(rootPc, chordType, targetMidi)`
- `acgUpperChordMidis(rootPc, chordType, targetMidi)`
- `midiForChordInterval(...)`

Use source logic from `../melodygenerative/src/lib/musicEngine.ts:9339-9355` as the behavioral reference, but adapt cleanly to simulator chord KB.

Acceptance:

- `ACG_Quartal_Arp_Wave`, `Piano_TopVoice_Planing`, `ACG_Open_Broken_10th`, `ACG_Pedal_Wash_Color_Drops` must produce at least one high air/color chord note above MIDI 67 for extended chords such as `maj9`, `m9`, `13sus4`, `6/9`, unless the chord type genuinely has no available written extension.

### 3.4 Keep ACG velocity soft

Do not use the generic body-lift mapping for ACG air/roll hits.

Recommended:

```ts
const vel = isAcgTextureCase(tc)
  ? Math.max(1, Math.min(110, Math.round(h.vel * 127)))
  : Math.max(1, Math.min(120, Math.round((h.vel * 0.92 + 0.42) * 127)));
```

Optional: allow a tiny floor for full blocks only:

```ts
if (isAcg && h.midis.length >= 3) vel = Math.max(vel, 34);
```

Do not raise single-note color drops into the same loudness band as ordinary comp.

### 3.5 Do not inject downbeat guide shell into ACG sparse textures

Change:

```ts
if (needsDownbeatCompAnchor && firstOnsetBeat > 0.08) inject shell
```

to:

```ts
if (!isAcgTextureCase(tc) && needsDownbeatCompAnchor && firstOnsetBeat > 0.08) inject shell
```

Reason:

- For ACG, the missing downbeat shell is often the texture.
- Bass/pedal already provides grounding.
- The source ACG design uses sparse chord entrances and upper color drops as musical space.

### 3.6 Keep bass texture shape intact

`renderTextureBassHits` has a reasonable split for ACG bass gestures. Do not rewrite it unless a seed proves bass shape mismatch. The main audible regression is chord/comp air, not bass voice scheduling.

## 4. Other Macro Audit

### Summary Table

| Macro | Risk from same bug | Status | Action |
|---|---:|---|---|
| ACG | High | Confirmed regression | Fix now |
| LOFI | Medium | Similar sparse/soft intent, but prior texture-clock/product choices exist | Audit only; do not blanket change |
| POP | Low/Medium | Some ambient/late textures can be filled by downbeat anchor, but core pop comp tolerates support | No broad change |
| RNB | Low/Medium | Current selectable cases mostly legacy/oracle groove/roll; high-color modern RNB cases are not the same central identity in current pool | No broad change |
| JAZZ | Low | Charleston/drop2/block comp wants mid-register support; no high-air ACG contract | No change |
| BLUES | Low | Mostly legacy/generic; not part of current rich style path like ACG | No change |

### 4.1 LOFI details

LOFI has sparse/soft texture cases:

- `Piano_Lofi_OneShot_Space`
- `Piano_Lofi_Late_Chord_Answer`
- `Piano_Ambient_Sustain_Wash`
- `Piano_Lofi_Dusty_Chops`
- `Piano_Lofi_Tape_Wobble_Arp`
- `Piano_CommonTone_Soft_Roll`
- `Piano_Wide_Color_Motion`

Risk:

- Generic velocity lift can make LOFI too loud.
- Downbeat anchor can fill intentional gaps.
- `Piano_Wide_Color_Motion` may also care about upper color, though it is not as ACG-specific.

However, simulator already has explicit LOFI texture-clock work:

- `lofiTextureClockBeat`
- texture clock alignment tests
- product handfeel decisions around dusty chop grid alignment

Therefore:

- Do not apply the ACG exception to LOFI automatically.
- If LOFI listening regressions are reported, create a separate LOFI directive and rebaseline LOFI tests.

### 4.2 POP details

POP textures mostly use mid-low accompaniment patterns:

- `Pop_Piano_Arp_16ths`
- `Pop_Broken_8ths_Sync`
- `Pop_Anthem_Pulse`
- `Pop_Ballad_158_Sweep`
- `Pop_Alberti_Lyrical`
- `Pop_Half_Arp_Sweep`
- `Pop_Wave_16ths`

Modern POP ambient cases (`Ambient_Reverse_Swell`, `Piano_Question_Answer`, `Low_Pedal_Color_Wash`) can be affected by downbeat anchoring, but POP generally benefits from structural support when no pad is present. Leave as-is unless ear checks fail.

### 4.3 RNB details

Source `melodygenerative` contains modern RNB color cases (`RnB_Drop2_Color_Answer`, `RnB_InnerTight_Wide_Color`, `RnB_Quartal_Breath_Roll`) that use color/top gestures. Current simulator pool/render path primarily covers RNB through legacy/oracle cases such as:

- `RnB_16th_Funk_Stabs`
- `RnB_Classic_Soul_Arp`
- `RnB_Gospel_Triplets`
- `RnB_Laid_Back_Groove`
- `RnB_Neo_Soul_Roll`

These are groove/roll/stab oriented and do not depend on the same ACG high-air contract. No immediate ACG-style exception needed.

If modern RNB color cases are later reintroduced into simulator's selectable `TEXTURE_POOL`, revisit this policy.

### 4.4 JAZZ / BLUES details

JAZZ rich cases are comping idioms:

- `Jazz_Charleston_Comp`
- `Jazz_Drop_2_Comp`
- `Jazz_Red_Garland_Block`
- `Jazz_Waltz_Hemiola`
- `Bossa_Piano_Arp`

They should remain under lead-space and voice-leading constraints. The ACG fix must not loosen JAZZ comp into lead register.

BLUES is mostly legacy/generic and not part of the ACG regression.

## 5. Test Plan

Add focused tests instead of broad golden rebless.

### 5.1 ACG high-air preservation unit test

File suggestion:

- `src/core/generation/newEngine/render/acgCompAir.test.ts`

Test:

- Build a simple ACG-compatible extended chord, e.g. Cmaj9 or C6/9.
- Call `renderTextureChordHits` for:
  - `Piano_TopVoice_Planing`
  - `ACG_Quartal_Arp_Wave`
  - `ACG_Open_Broken_10th`
  - `ACG_Pedal_Wash_Color_Drops`
- Assert at least one chord hit contains MIDI > 67 for those cases.
- Assert sparse color drops remain single-note or small dyad events where expected.

### 5.2 ACG no downbeat-shell injection integration test

Build a tiny render plan where:

- style = `acg`
- section has comp and no pad
- texture case = `Piano_TopVoice_Planing` or `ACG_Pedal_Wash_Color_Drops`
- `needsDownbeatCompAnchorBySection[sectionId] = true`

Assert:

- No extra guide-tone shell event is injected at section downbeat solely because first onset is > 0.08.
- Bass may still anchor the downbeat.

### 5.3 ACG velocity softness test

For ACG single-note air hits:

- Assert velocity is close to source `h.vel * 127`, not the generic lifted `(h.vel * 0.92 + 0.42) * 127`.
- A color drop with source `vel = 0.20` should remain around MIDI 25, not around MIDI 75.

### 5.4 Non-ACG regression tests

Keep existing tests green:

- `npm run lint`
- `npm run test`

Add explicit "non-ACG unchanged" checks:

- POP/RNB/JAZZ/LOFI existing texture tests still pass.
- `textureClockAlignment.test.ts` still passes for LOFI.
- `padCompLoop8.test.ts` still passes for non-ACG styles.

## 6. Implementation Guardrails

- Do not expose ACG through old `MgStyleStore` / old `MG_STYLE_PREFIX`.
- Do not change global `REGISTER_BY_ROLE`.
- Do not disable `yieldUnderMelody` globally.
- Do not change `polyVelocity` globally.
- Do not remove downbeat anchor policy globally.
- Do not change LOFI texture clock behavior in this task.
- Keep ACG repair scoped to concrete ACG texture cases.

## 7. Acceptance Definition

The repair is complete when:

1. ACG texture cases preserve high air/color notes where source MG does.
2. ACG sparse/wash cases do not get artificial downbeat shell anchors.
3. ACG single-note color drops remain soft.
4. Existing non-ACG tests remain green.
5. A same-seed ACG ear check recovers the open cinematic piano space.

Run:

```bash
npm run lint
npm run test
```

Recommended manual ear check:

- Pick 2-3 seeds that currently sound too dense in simulator ACG.
- Compare before/after with the same seed.
- Listen specifically for:
  - upper color drops above the melody floor,
  - less mid-register comp crowding,
  - softer chord air,
  - no artificial chord block on sparse texture downbeats.

