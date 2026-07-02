# ACG T2 Quick Close Directive

Date: 2026-07-03

## Purpose

ACG is now much better by ear and mostly passes the current MG-feel audits. Do not restart the ACG migration. This T2 directive is only for small closure tasks.

The product decision remains:

```text
Simulator architecture stays intact.
ACG is rendered through SIM's full-song arranger/harmony/instrumentation pipeline.
Render layer supplies the MG-like ACG piano-performance lens.
```

Do not replace the arranger, do not force 16-bar MG loop output, and do not reintroduce pad.

## Current Good State To Preserve

Keep these locked:

- ACG emits `bass + comp + lead`.
- ACG emits no `pad`.
- ACG emits no `drum` for MG-fidelity mode.
- Lead and comp are separate tracks, even when both use piano program.
- Lead/comp use the same piano identity.
- Comp is audible in the current Aura25 / master-chain playback context.
- Comp is mostly rolled/single-note rather than block-bed.
- ACG uses section-aware render profile and texture-family selection.
- Existing ACG tests and audits should remain green unless this directive explicitly changes thresholds.

## Evidence From Latest Audit

Latest checks:

```text
6 test files / 63 tests passed
mg_bass_comp_lead_fidelity: 25 cases, 0 warning/error
lint: pass
build: pass
```

Direct ACG role check:

```text
seed 0:     roles=bass,comp,lead hasPad=false
seed 7:     roles=bass,comp,lead hasPad=false
seed 42:    roles=bass,comp,lead hasPad=false
seed 99:    roles=bass,comp,lead hasPad=false
seed 12345: roles=bass,comp,lead hasPad=false
```

Remaining warnings from `audit-acg-per-section-feel.ts` are small and localized.

## T2.1 Fix Local Block-Return Warnings

Some sections still show a local block-bed warning, even though whole-song ACG comp passes.

Latest warning examples:

```text
seed 7    verse: singleRatio 0.862
seed 42   intro: singleRatio 0.857
seed 12345 verse: singleRatio 0.895
```

Target:

```text
ACG section-level singleRatio >= 0.9
ACG section-level blockRatio <= 0.05
```

Implementation guidance:

- Keep `chordRoll` as the final ACG comp cleanup pass.
- Do not change the texture pool.
- Do not lower comp audibility.
- Prefer one of:
  - widen the final cleanup grouping only for ACG comp sections that fail the section audit;
  - add a second lightweight final `onsetCleanup` pass after all ACG comp shaping;
  - make `chordRoll` section-aware and re-run only inside failing local windows.
- Avoid rolling true arpeggio notes into unnatural over-quantized timing. The cleanup should target same-onset or near-same-onset clusters only.

Acceptance:

- `scripts/audit-acg-per-section-feel.ts` has no block-bed warnings for the current seed set.
- `mg_bass_comp_lead_fidelity` remains green.
- ACG comp remains audible.

## T2.2 Outro Lead Exception Policy

Latest warning:

```text
seed 0 outro: lead coverage 0.156, maxGap 12.19
```

This may be musically acceptable because outro can breathe. Decide and encode the rule explicitly.

Allowed options:

1. Accept outro sparseness:
   - Update the audit to treat outro lead gaps as informational unless the outro becomes fully empty.
   - Keep generation unchanged.

2. Add a minimal outro tail:
   - Add only a small cadence/tail note or held final landing.
   - Do not apply POP-style gap fill.
   - Do not fill the whole outro.

Recommendation:

Use option 1 unless the user specifically says the outro feels broken. ACG outro silence can be a feature.

## T2.3 Lock ACG Comp Audibility Contract

Current ACG comp was raised from MG raw pp values to an audible mf-ish range for the Simulator's Aura25 playback chain.

This is intentional.

Do not mechanically force SIM comp velocity back to MG's raw `~30` if it makes the Aura25 playback feel too small.

Documented interpretation:

```text
MG MIDI pp value (~30) maps to a louder SIM playback-layer value (~50) because the SF2 / master chain differ.
The musical contract is melody-first but audible comp, not numeric velocity parity.
```

Acceptance:

- Lead remains clearly above comp in perceived melody priority.
- Comp remains audible as piano body.
- No pad is used to fake space.
- Existing mix tests remain green.

If needed, adjust audit language so this does not look like a regression against MG raw velocity.

## T2.4 Texture Family Micro-Balance

Do not chase exact same-seed texture order. SIM is a full arranger.

But avoid ACG becoming too generic drive/block.

Use section-energy texture family as the control point:

- intro/outro: prefer `space` / `wash`
- verse/story: balanced `space` / `drive`, avoid heavy block
- chorus/build: allow `drive`, limited `block`
- bridge/lift: allow `wash` or controlled block if energy asks for it

Current examples still worth watching:

```text
seed 99:
MG  space 50% / drive 31% / block 13% / wash 6%
SIM space 11% / drive 59% / block 19% / wash 11%
```

This is not a hard blocker now, but if the ear-check reports "too driven / not airy", reduce drive/block pressure before changing comp mechanics.

Acceptance:

- Texture family report stays musically plausible by section.
- No section becomes dense J-pop block unless the section energy calls for it.
- ACG still feels airy enough overall.

## T2.5 Audit Threshold Cleanup

Clean up the audit semantics so generated reports match the product decision.

Required clarifications:

- Outro lead gaps may be treated differently from verse/chorus.
- ACG comp numeric velocity is playback-chain adjusted; do not compare it as raw MG byte parity.
- Whole-song exact parity is not the target.
- The target is MG-like ACG piano performance inside SIM full-song architecture.

Do not loosen critical hard contracts:

- no pad
- separate lead/comp/bass
- comp not empty
- comp mostly rolled/single-note

## T2.6 Regression Test Set

After changes, run:

```bash
npm test -- --run \
  src/core/generation/musicGeneration/acgCompHardContract.test.ts \
  src/core/generation/newEngine/render/mgBassCompLeadFidelity.test.ts \
  src/core/generation/newEngine/render/acgCompAir.test.ts \
  src/core/generation/newEngine/instrumental/gmMixProfile.test.ts \
  src/core/generation/newEngine/render/mgAcgCycleScheduler.test.ts \
  src/core/generation/newEngine/render/textureClockAlignment.test.ts

npx tsx scripts/audit-mg-bass-comp-lead-fidelity.ts --write-report-only
npx tsx scripts/audit-acg-per-section-feel.ts
npm run lint
npm run build
```

Acceptance for T2:

- Tests pass.
- `mg_bass_comp_lead_fidelity` stays at 0 warning/error.
- `audit-acg-per-section-feel` has no active-section block-bed warnings.
- Any remaining outro warning is documented as accepted or fixed minimally.

## Do Not Do

- Do not rewrite ACG arranger/harmony.
- Do not reintroduce pad.
- Do not collapse lead and comp.
- Do not lower comp back to inaudible pp just to match MG raw velocity.
- Do not make ACG a 16-bar loop.
- Do not broaden this into POP/JAZZ/LOFI/RNB fixes. Those belong to T1 follow-up tasks.

## Short Version For Claude

ACG is mostly good now. Only close the edges:

1. Remove the few local block-bed warnings.
2. Decide/document outro lead gap behavior.
3. Preserve the audible comp mix.
4. Keep texture family airy by section.
5. Keep all ACG hard contracts green.

