# MG Bass / Comp / Lead Fidelity Directive

Date: 2026-07-01

Audience: Claude / next implementation agent.

Scope: simulator Q+N main music generation path, specifically the musical core:

```txt
bass + comp + lead
```

Do not use this directive for pad/drum parity. Pad and drum are simulator-owned
extensions and may keep their product-specific behavior. The three voices above
are the part that must preserve current `../melodygenerative` musical identity.

## 0. Non-Negotiable Goal

The simulator must follow current MG logic for `bass`, `comp`, and `lead`.

Reason:

```txt
MG currently sounds musically better. Simulator currently does not.
```

This is not a cosmetic issue. The audible gap comes from simulator replacing
MG's generation decisions with product-layer approximations:

- section-level texture choices instead of MG per-bar/per-cell texture logic;
- different comp density and register behavior;
- bass/comp/lead note-count and rhythm density drifting far from MG;
- extra render/mix normalization changing the lead-vs-comp balance;
- Band Selection / lineup logic interfering with the three core voices.

The target is not "make simulator pleasant." The target is:

```txt
Given the same musical style intent, simulator bass/comp/lead should obey MG's
music-generation decisions unless a divergence is explicitly documented and
accepted by the user.
```

## 1. Current Audit Evidence

Actual cross-check on 2026-07-01:

```txt
styles: ACG / POP / JAZZ / LOFI / RNB
seeds: 0 / 7 / 42
compared: MG timeline events vs simulator main-chain IR
ignored: pad / drum
```

Important methodology note:

```txt
This is not byte parity.
```

MG currently receives string seeds, while simulator's public main-chain request
uses numeric seeds. For this audit, use a deterministic seed mapping such as:

```txt
MG seed = String(simulatorNumericSeed)
SIM seed = simulatorNumericSeed
```

Then compare musical structure, density, texture variety, family/program, and
role ownership. Do not claim exact same random stream unless a dedicated shared
RNG bridge is implemented.

Result:

- Simulator now structurally emits `bass`, `comp`, and `lead`.
- ACG now has independent `comp` again.
- Family/program mapping is mostly correct:
  - ACG lead = GM0 keyboard
  - ACG comp = GM0 keyboard
  - ACG bass = GM32/43 bass
  - other macro styles use keyboard lead/comp and bass-family bass.
- But the generated music still does not match MG's core behavior.

Concrete examples:

```txt
ACG seed 0:
  MG        bass=41  comp=99  lead=32
  simulator bass=124 comp=338 lead=64

ACG seed 7:
  MG        bass=46  comp=71  lead=32
  simulator bass=140 comp=373 lead=99

ACG seed 42:
  MG        bass=47  comp=86  lead=33
  simulator bass=182 comp=299 lead=90
```

Texture evidence:

```txt
MG ACG per song:        usually 6-7 active texture cases across bars/cells
simulator ACG per song: usually 2 section-level texture cases
```

This is enough to explain the listening report: simulator has the right track
names, but not the same musical decision chain.

## 2. Architecture Boundary

### 2.1 MG is the music authority

For `bass`, `comp`, and `lead`, MG is the musical source of truth:

- harmony-to-melody grammar;
- local scale and chord contract logic;
- groove contract consumption;
- texture case selection;
- comp rhythm / register / air behavior;
- bass rhythm and anchor behavior;
- lead phrase grammar and final shaping;
- style-specific density and rhythm decisions.

Simulator may keep its IR, UI, MIDI, retry, and playback architecture, but these
must be adapters around MG musical decisions, not replacements.

### 2.2 Simulator-owned layers

Simulator may still own:

- pad generation;
- drum generation;
- UI projection;
- MIDI channel mapping;
- final browser / ESP32 playback adapter;
- product trace formatting;
- retry control around fatal collisions.

But simulator-owned layers must not rewrite the musical identity of
`bass/comp/lead`.

## 3. P0: ACG Core Must Stay MG-like

ACG is the most audible failure case.

MG ACG is a piano writing model:

```txt
lead = melody / topline / right-hand cantabile line
comp = independent piano accompaniment / arpeggio / air color / harmonic body
bass = low anchor / left-hand or acoustic-bass support
```

Required:

1. ACG always emits `lead + comp + bass`.
2. `lead` and `comp` must remain separate tracks even when both use GM program
   `0`.
3. ACG must not collapse into `lead only`, `drum + lead`, or
   `lead + bass` without comp.
4. ACG texture events belong to `comp`, not `lead`.
5. Band Selection must not delete ACG `comp` or `bass`.
6. Drums are not part of this MG-faithful ACG repair. Do not add drums as a
   workaround.

This P0 is already partially implemented in current simulator. Keep it and do
not regress it.

## 4. P0: Texture Calling Must Follow MG

This is the largest remaining audible divergence.

### 4.1 Current simulator behavior is not enough

Current simulator rich texture planning picks low/high section-level textures:

```txt
low  = one texture for verse-like sections
high = one texture for chorus/bridge-like sections
```

Then `textureSchedule` prioritizes that section-level decision and repeats it
across the section.

This is not MG's ACG behavior.

### 4.2 Required MG behavior

MG ACG picks texture at bar/cell granularity with musical context:

- first phrase air;
- phrase role: establish / develop / lift / cadence;
- harmonic function: T / S / D;
- loop boundary;
- song end;
- dominant-chain context;
- previous texture / repeat count;
- GrooveContract preferred / allowed / forbidden texture cases;
- density / energy for the active phrase cell.

Required implementation:

1. Port or mirror MG's ACG texture picker into simulator's main chain.
2. Produce a per-bar or per-span texture schedule equivalent to MG
   `texturePerBar`.
3. Use the schedule for `comp` rendering.
4. Do not reduce ACG to two section-level texture choices.
5. Keep section-level texture planning only for styles where MG really uses a
   song/section-level texture commitment.

Acceptance target:

```txt
For ACG seeds, simulator textureSchedule should show the same kind of
per-cell/per-bar variety as MG texturePerBar. It does not need byte parity in
the first pass, but it must no longer collapse 6-7 MG texture decisions into
2 section-level choices.
```

## 5. P0: Bass / Comp / Lead Density Must Be Audited Against MG

Do not rely on track existence tests. They are necessary but not sufficient.

Add an audit that compares MG and simulator for each style/seed:

```txt
style
seed
bars
MG bass note count
SIM bass note count
MG comp note count
SIM comp note count
MG lead note count
SIM lead note count
MG texturePerBar unique cases
SIM textureSchedule unique cases
program / family for bass, comp, lead
```

For ACG, the audit must also include:

```txt
MG texturePerBar full list
SIM textureSchedule full list
MG grooveContract id
SIM GrooveContract id
section/span mapping for SIM textureSchedule
first warning reason when thresholds fail
```

Minimum matrix:

```txt
styles: ACG / POP / JAZZ / LOFI / RNB
seeds: 0 / 7 / 42 / 99 / 12345
```

ACG must include the known listening-problem seeds once identified by user.

Suggested script:

```txt
scripts/audit-mg-bass-comp-lead-fidelity.ts
```

This script should run current `../melodygenerative` live where possible and
simulator main-chain generation live. It should write:

```txt
docs/generated/mg_bass_comp_lead_fidelity_report.md
tmp/mg-bass-comp-lead-fidelity.json
```

Do not hide divergences behind the existing `audit:mg-current` report. That
report only live-checks RoadMap and explicitly excludes final comp texture
parity.

## 6. P1: Bass Logic Must Not Become Generic Simulator Bass

For the `bass` role:

1. Preserve MG's style-specific bass rhythm and anchor rules.
2. Preserve chord-root / fifth / pedal / slash / bassRole semantics from MG.
3. For ACG, bass must support the piano body; it must not become a pop/rock
   busy bassline or drum-driven groove.
4. For LOFI, bass must remain sparse/pocketed and not fill every available
   grid slot.
5. For RNB, bass may be pocketed, but should follow MG's groove contract and
   not dominate the melody.

Acceptance:

- Bass family/program may be simulator GM-specific, but bass rhythm density and
  anchor behavior should be close to MG for the same style class.
- Audit should flag any simulator bass count above 2.5x MG for ACG unless
  explicitly justified.

## 7. P1: Comp Logic Must Not Become Generic Dense Comp

For the `comp` role:

1. Comp must consume the MG-selected texture case.
2. Comp must preserve MG texture rhythm, register, and air behavior.
3. ACG comp must keep high air/color notes and sparse gaps.
4. Generic downbeat shell injection must not overwrite intentional ACG empty
   space.
5. Render post-processing must not make comp several times denser than MG
   without an accepted reason.

Acceptance:

- ACG comp must show texture-driven sparse/arpeggiated behavior, not dense
  all-section piano comping.
- Audit should flag simulator ACG comp note count above 3x MG for the same case.
- Audit should also flag simulator ACG unique texture cases below 50% of MG's
  unique texture cases for the same case.

## 8. P1: Lead Logic Must Stay MG Lead

For the `lead` role:

1. Keep MG grammar / RoadMap / scheduled-token / local-scale / shaper logic.
2. Keep `lead` monophonic or near-monophonic.
3. Do not put comp texture notes into `lead`.
4. Do not let product mix balancing reshape lead timing or pitches.
5. Revisit current skipped MG post-shaper items:
   - ACG top-voice piano touch;
   - groove cohesion;
   - final register relationship against comp where MG applies it.

Acceptance:

- Lead should remain melody-like, not texture-like.
- Lead count may differ from MG because simulator has repeat-group replay and
  product lead handling, but large density inflation must be reported.

## 9. Render / Mix Policy

Current simulator has a render-stage mix balancer. This may be useful, but it
must not become a musical-generation substitute.

Rules:

1. Mix balancing may adjust `TrackMix.volume`.
2. It must not change notes, timing, pitch, texture choice, role, or program.
3. It must not mask a wrong comp/lead density problem.
4. It must be included in the audit report so listening differences can be
   separated into:
   - generation divergence;
   - texture divergence;
   - mix divergence.

For ACG specifically:

```txt
Do not solve missing air / wrong comp texture by only changing CC7.
```

Fix the musical source first.

## 10. Tests To Add

### 10.1 Hard role tests

Keep and extend:

```txt
src/core/generation/musicGeneration/acgCompHardContract.test.ts
```

Required:

- ACG always has `lead + comp + bass`.
- Band Selection cannot remove ACG `comp`.
- `lead` and `comp` stay separate when both use GM0.
- ACG has no drum in this MG-faithful P0.

### 10.2 Texture parity audit tests

Add a non-brittle test around the new audit script:

```txt
src/core/generation/newEngine/render/mgBassCompLeadFidelity.test.ts
```

Suggested expectations:

- For ACG seeds, simulator unique texture cases must not collapse to only 1-2
  when MG has 5+.
- Simulator ACG comp count must not exceed MG comp count by more than 3x.
- Simulator ACG bass count must not exceed MG bass count by more than 2.5x.
- Simulator ACG lead should remain monophonic / near-monophonic.
- Bass/comp/lead families must be valid for style.
- For POP/JAZZ/LOFI/RNB, report density ratios and family/program validity in
  the first pass; do not force hard thresholds until the ACG path is repaired
  unless a non-ACG regression is obvious.

Do not make pad/drum part of this test.

### 10.3 Regression command

After implementation:

```bash
npm test -- --run \
  src/core/generation/musicGeneration/acgCompHardContract.test.ts \
  src/core/generation/newEngine/render/mgBassCompLeadFidelity.test.ts \
  src/core/generation/newEngine/band/acgStyleRegistration.test.ts \
  src/core/generation/newEngine/render/textureContractCoverage.test.ts \
  src/core/generation/newEngine/render/renderMixBalance.test.ts
```

Then run:

```bash
npm run audit:mg-current -- --full --write-report-only
npx tsx scripts/audit-mg-bass-comp-lead-fidelity.ts --full --write-report-only
```

## 11. Acceptance Criteria

This repair is complete only when:

1. Simulator main-chain generation emits valid `bass + comp + lead` for all
   macro styles.
2. ACG always preserves `lead + comp + bass` and never collapses comp into lead.
3. ACG texture scheduling follows MG per-bar/per-cell logic closely enough that
   texture variety and phrase behavior are recognizably MG-like.
4. Bass/comp/lead density ratios are audited against MG and no longer show
   extreme inflation for ACG.
5. Family/program mapping remains musically valid.
6. Existing RoadMap / melody parity audits still pass.
7. The new bass/comp/lead fidelity report is generated and checked into
   `docs/generated` or attached in the final implementation note.

## 12. Explicit Non-Goals

Do not include in this repair:

- pad parity;
- drum parity;
- marketing/UI redesign;
- new style invention;
- making simulator ACG "better in its own way";
- hiding divergence through reverb/volume only.

The task is fidelity:

```txt
Make simulator bass / comp / lead obey MG because MG is the current musical
quality target.
```
