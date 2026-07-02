# ACG MG Fidelity Audit Conclusion

Date: 2026-07-02

Scope: Simulator main chain ACG output vs current MG ACG audit output. This document merges the latest audit conclusions for Claude and future follow-up work.

## Executive Summary

The latest Claude implementation fixed the main previously identified ACG issues:

- ACG no longer emits a `pad` track in the Simulator main chain.
- ACG keeps separate `lead + comp + bass` tracks.
- ACG comp final form now matches MG's broken-arpeggio/onset shape.
- ACG comp pedal, bass density, comp density, and offgrid arpeggio velocity are within the current audit thresholds.

However, the full listening result can still differ from MG because the remaining differences are not in pad or comp arpeggio anymore. The largest remaining gap is:

- Some Simulator ACG sections have lead phrases that are too empty compared with MG phrase-level reference.
- Texture macro family balance is still not always MG-like, even when the individual texture cases are legal.
- Simulator remains a full-song arranger, while MG audit is a fixed 16-bar loop. The 16-bar MG reference should be used as a diagnostic ruler, not as the final product form.

## What Was Actually Compared

This audit used real generation on both sides.

MG source:

```ts
generateAuditSong(String(seed), 'ACG', 'C')
```

Simulator source:

```ts
generateMusicSync({
  seed,
  styleHint: 'acg',
  mood: 'build',
  targetDuration: 90,
  key: 'C',
})
```

Seeds:

```text
0, 7, 42, 99, 12345
```

Reports:

- `docs/generated/mg_bass_comp_lead_fidelity_report.md`
- `docs/generated/acg_per_section_feel_report.md`

Validation commands run:

```bash
npm test -- --run src/core/generation/musicGeneration/acgCompHardContract.test.ts src/core/generation/newEngine/render/mgBassCompLeadFidelity.test.ts src/core/generation/newEngine/render/acgCompAir.test.ts src/core/generation/musicGeneration/MusicGenerationService.test.ts
npm run lint
npm run build
npx tsx scripts/audit-mg-bass-comp-lead-fidelity.ts --write-report-only
npx tsx scripts/audit-acg-per-section-feel.ts
```

Observed result:

- Tests: 4 files, 39 tests passed.
- TypeScript: passed.
- Build: passed, with only the existing Vite large chunk warning.
- MG/SIM bass-comp-lead fidelity: 25 cases, 0 warning/error.

## Confirmed Fixed

### 1. ACG Pad Removed

ACG should be pure piano-core output: `lead + comp + bass`. MG ACG has no pad, and Simulator pad was changing space, sustain, harmonic fog, and thickness.

Direct main-chain check:

```text
seed 0:     roles=bass,comp,lead hasPad=false
seed 7:     roles=bass,comp,lead hasPad=false
seed 42:    roles=bass,comp,lead hasPad=false
seed 99:    roles=bass,comp,lead hasPad=false
seed 12345: roles=bass,comp,lead hasPad=false
seed 2024:  roles=bass,comp,lead hasPad=false
seed 777:   roles=bass,comp,lead hasPad=false
```

ACG pad should remain excluded from lineup/instrumentation. If a future change reintroduces `role === 'pad'` for ACG, treat it as a regression.

### 2. Comp Arpeggio Final Form Fixed

The earlier failure was that Simulator had ACG texture cases, but the final comp still contained too many same-onset dyad/block groups. MG's final ACG chord events are mostly single-note rolled events.

Current ACG final-form audit:

```text
seed 0:     single 1 -> 0.992, block 0 -> 0.008, offVel 29.9 -> 28.9
seed 7:     single 0.971 -> 0.975, block 0.029 -> 0.025, offVel 30.1 -> 28.4
seed 42:    single 0.988 -> 0.992, block 0.012 -> 0.008, offVel 30.4 -> 28.6
seed 99:    single 1 -> 0.996, block 0 -> 0.004, offVel 29.4 -> 29.9
seed 12345: single 1 -> 0.990, block 0 -> 0.010, offVel 30.1 -> 29.1
```

This means the previous "soft block chord bed" problem is fixed. The hard contract should remain:

- ACG comp single-onset ratio should be at least `0.9`.
- ACG comp block-onset ratio should be at most `0.05`.
- Offgrid arpeggio velocity should remain near MG, roughly `28-30`, with current test bounds `25-34`.

### 3. Bass/Comp/Pedal Core Is Acceptable

The latest `mg_bass_comp_lead_fidelity_report.md` shows no ACG warning:

- Comp per-bar density is within current tolerance.
- Bass per-bar density is within current tolerance.
- Pedal count exists and follows ACG chord spans.
- Texture cases are ACG/Piano cases.

This means the next major listening mismatch should not be debugged first as "pad" or "comp arpeggio missing".

## Still Not Fully MG-Like

### P1. Some Sections Have Too Little Lead

The main remaining listening issue is lead emptiness in some sections.

From `acg_per_section_feel_report.md`:

Seed 99 MG phrase reference:

```text
lead cov range: 0.445-0.605
lead maxGap max: 3.56 beats
```

Simulator seed 99 problematic sections:

```text
chorus: lead cov 0.209, gap 10.25
chorus: lead cov 0.148, gap 13.03
chorus: lead cov 0.148, gap 13.04
```

Seed 12345 MG phrase reference:

```text
lead maxGap max: 3.75 beats
```

Simulator seed 12345 problematic sections:

```text
verse: lead gap 9.22
verse: lead gap 9.22
```

Interpretation:

Even with correct comp arpeggio and no pad, the listener will still hear "not MG" if the lead disappears for too long. ACG is melody-first. The next repair should focus on section-level lead coverage and max-gap, not on comp texture.

Suggested next hard contract:

- For ACG non-intro/non-outro sections, compare each section to the MG 4-bar phrase reference range.
- If `lead coverage` falls below MG phrase minimum by a meaningful margin, repair or re-render the section lead.
- If `lead maxGap` exceeds MG phrase max by a meaningful margin, repair or re-render the section lead.
- Keep ACG breathing silence, but do not allow chorus/verse to become empty beds.

### P2. Texture Macro Family Balance Still Drifts

Individual ACG texture cases are valid, but the macro family balance can still change the whole-song feeling.

Examples:

Seed 99:

```text
MG:  空旷 50% · 推进 31% · 块状 13% · 水洗 6%
SIM: 空旷 13% · 推进 48% · 块状 31% · 水洗 7%
```

Seed 12345:

```text
MG:  空旷 6% · 推进 56% · 块状 31% · 水洗 6%
SIM: 空旷 29% · 推进 13% · 块状 50% · 水洗 8%
```

Interpretation:

The engine is now using legal ACG textures, but sometimes the macro story is not MG-like. This does not break the hard comp contract, but it can alter the listening impression: more drive/block vs more space/wash.

Suggested next contract:

- Keep per-song texture character, but audit against MG macro family balance.
- Do not only compare `textureUniq`.
- Compare family ratios: `space / drive / block / wash`.
- For ACG, section-level texture choice should support the melody-first arc. Do not overuse block/drive when MG reference is spacious.

### P3. Full Song Form Is Intentionally Different

MG audit output is a fixed 16-bar loop.

Simulator ACG main chain is a full arranger output, commonly 38-54 bars, with intro/verse/chorus/bridge/outro and energy arcs.

Decision:

- Keep Simulator as a full-song arranger.
- Use MG 16-bar output as a diagnostic reference, not as the product target.
- A "16-bar reference mode" is useful as a test tool to isolate whether one section's `bass + comp + lead` feel is MG-like.
- Do not turn Simulator ACG into a 16-bar loop unless explicitly requested as a separate product mode.

## Current Priority

Do not spend the next round on pad or comp arpeggio unless a regression appears.

Next Claude task should be:

1. Fix ACG lead section-level emptiness.
2. Add hard tests or warnings for ACG section `lead coverage` and `lead maxGap`.
3. Keep the no-pad and comp-onset contracts locked.
4. Then tune texture macro family balance.

Recommended repair target:

```text
P1: ACG lead coverage/maxGap per section
P2: ACG texture macro family ratio
P3: Optional 16-bar reference diagnostic mode
```

## Non-Negotiable ACG Contracts

- ACG output must include `lead + comp + bass`.
- ACG output must not include `pad`.
- ACG output must not include `drum` for MG-fidelity comparison.
- ACG comp must be separate from lead, even if both use piano program.
- ACG comp final form must be mostly single-note rolled arpeggio, not same-onset block bed.
- ACG should remain melody-first: lead audible and present, comp soft/airy, bass supportive.
- MG 16-bar audit is the reference ruler for feel, not necessarily the full-song product form.
