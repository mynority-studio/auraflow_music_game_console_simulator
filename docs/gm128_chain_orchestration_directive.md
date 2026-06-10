# GM128 Chain Orchestration Directive

Date: 2026-06-10

Audience: Claude

This directive is about instrument selection priority only. It is not about accompaniment texture polyphony, comp voicing, melody generation, harmony generation, or MIDI mix CC values.

## User Intent

BandEngine should decide the band lineup:

```text
keyboard comp player
keyboard/lead player
bass player
drum player
optional pad player
```

But BandEngine should not be the final authority for exact GM128 program choices.

Instrumentation should receive the lineup and then choose exact GM programs through a chain-priority orchestration table:

```text
choose timbre world
-> choose comp instrument first
-> choose lead instrument by comp compatibility
-> choose bass by world
-> choose pad by world and comp/lead pair
-> choose drum kit
-> expose final programByRoleSection
```

The goal is a coherent ensemble, where instruments are same-family or musically compatible. The engine should sound like one band in one room, not five roles randomly drawing unrelated GM patches.

## Current Problem

Current code still lets `BandEngine` pick exact GM program numbers through `pickBandInstrumentation(...)`, and `InstrumentationPlanner` later repairs/adjusts them.

Current path:

```text
BandEngine
  -> instrumentPool + roleProgram
InstrumentationPlanner
  -> repairWorldMismatches
  -> repairCompCapability
  -> coherentLeadComp
  -> programByRoleSection
```

This is better than pure random, but the final sound is still downstream repair. We want Instrumentation to become the owner of exact GM program choice.

## Non-Goals

Do not change:

- melody generation
- harmony generation
- accompaniment texture selection
- comp voicing
- pad voicing
- bass patterning
- drum groove generation
- MG lead parity
- texture dry parity
- GM mix/CC logic from `docs/esp32s2_gm128_instrument_mix_directive.md`

Do not add new instruments unless explicitly required. Use the current selected palette first.

Do not reintroduce harsh GM programs as default choices:

- trumpet/brass lead
- sax lead
- solo violin lead
- distortion/overdriven guitar
- choir lead
- aggressive synth lead

## GM128 Source Boundary

GM128 gives official program names and broad families. It does not give a canonical compatibility table.

Therefore:

- GM program family classification is KB data.
- Compatibility is our arrangement/orchestration rule.
- Chain profiles should live in `knowledge`, not in render.

Recommended new file:

```text
src/core/generation/newEngine/knowledge/gmOrchestrationChains.ts
```

Keep `knowledge/instruments.ts` as the public facade if that matches local style.

## Layering Rule

Band layer:

```text
style/key/mode/timbre request/lineup roles
```

Instrumentation layer:

```text
exact GM program selection
timbreWorld
programByRoleSection
sameInstrumentPairs
instrument compatibility diagnostics
```

Render layer:

```text
consume final effective program
attach program/programChanges to TrackIR
```

MIDI layer:

```text
emit program changes and CC from final IR
```

## Required Architecture Change

### Phase 1: Non-Breaking Migration

Keep `BandSpec.roleProgram` temporarily for compatibility, but treat it as provisional.

Add to `InstrumentationPlanData`:

```ts
roleProgram: Record<InstrumentRoleName, number>;
orchestrationChain: {
  world: TimbreWorld;
  profileId: string;
  compProgram?: number;
  leadProgram?: number;
  bassProgram?: number;
  padProgram?: number;
  drumProgram?: number;
  decisions: string[];
};
```

The new `InstrumentationPlan.roleProgram` is the effective role program selected by the chain table.

`programByRoleSection` must be derived from this effective `roleProgram`, not from `band.roleProgram`.

`renderCoordinator` must consume `instrumentation.roleProgram.comp` or the section-effective `programByRoleSection`, not `band.roleProgram.comp`, when deciding comp instrument family.

### Phase 2: BandEngine Cleanup

After tests are stable, move exact GM selection out of BandEngine.

Possible end state:

```ts
export interface BandSpec {
  ...
  instrumentPool: InstrumentRoleName[];
  roleProgram?: Record<InstrumentRoleName, number>; // deprecated/provisional, test-only fallback
}
```

or:

```ts
export interface BandSpec {
  ...
  instrumentPool: InstrumentRoleName[];
  requestedInstrumentWorld?: TimbreWorld;
}
```

Do not do Phase 2 if it creates broad test churn. Phase 1 is sufficient for this task if final render consumes `InstrumentationPlan` effective programs.

## Chain Profiles

Use current 0-based GM program numbers.

### electricKeys

Best for RNB, neo-soul, city-pop, warm pop.

```ts
{
  id: 'electricKeys',
  compPriority: [4, 5, 7],
  leadByComp: {
    4: [4, 5, 11, 2],
    5: [5, 4, 11, 2],
    7: [4, 5, 11],
  },
  bassPriority: [33, 35, 39],
  padPriority: [89, 94, 16, 99],
  drumPriority: [0, 40],
}
```

Notes:

- Rhodes/FM EP comp pairs best with Rhodes/FM/Vibraphone lead.
- Clav is dry/funky and should prefer Rhodes/FM lead.
- Slap bass should not be default here unless a high-energy/funk flag is added later.

### lofiTapeKeys

Best for LOFI/chill.

```ts
{
  id: 'lofiTapeKeys',
  compPriority: [4, 5, 6],
  leadByComp: {
    4: [4, 11, 12, 108, 6],
    5: [4, 5, 11, 12, 108],
    6: [11, 12, 108, 4],
  },
  bassPriority: [33, 35, 39],
  padPriority: [89, 94, 88, 92, 98, 102],
  drumPriority: [0, 40],
}
```

Notes:

- Harpsichord comp should pair with mallet/kalimba/vibraphone lead.
- FX pads `98/102` are allowed only as low-volume air in the later mix layer.
- Pan flute/shakuhachi may remain metadata or rare color, but should not be a default chain lead unless explicitly enabled.

### acousticPianoBand

Best for pop ballad / simple acoustic band.

```ts
{
  id: 'acousticPianoBand',
  compPriority: [0, 1, 2],
  leadByComp: {
    0: [11, 12, 4, 6, 2],
    1: [11, 12, 2, 4],
    2: [2, 4, 11, 12],
  },
  bassPriority: [32, 33, 35],
  padPriority: [48, 49, 89],
  drumPriority: [0, 40],
}
```

Notes:

- Acoustic piano comp is broad-compatible.
- Mallet lead over acoustic piano is a safe GM sound.
- Bright piano should be treated carefully and not paired with bright FX pad as foreground.

### jazzCombo

Best for jazz.

```ts
{
  id: 'jazzCombo',
  compPriority: [0, 4],
  leadByComp: {
    0: [11, 4, 6],
    4: [4, 11, 6],
  },
  bassPriority: [32, 35],
  padPriority: [49, 16],
  drumPriority: [40, 0],
}
```

Notes:

- Pad should be rare in jazz.
- Do not use synth bass in jazz.
- Brush kit should be preferred if the device path supports it.

### syntheticSoft

Best for soft synth-pop / modal synthetic.

```ts
{
  id: 'syntheticSoft',
  compPriority: [5, 4, 2],
  leadByComp: {
    5: [5, 4, 11],
    4: [4, 5, 11],
    2: [2, 4, 11],
  },
  bassPriority: [38, 39, 33],
  padPriority: [88, 89, 94, 95, 99, 102],
  drumPriority: [0],
}
```

Notes:

- Keep low end dry later in mix.
- FX pads are permitted but must be treated as air, not harmonic foreground.

### modalAmbient

Best for modal/static/ambient.

```ts
{
  id: 'modalAmbient',
  compPriority: [4, 0, 6],
  leadByComp: {
    4: [11, 12, 107, 108, 4],
    0: [11, 12, 107, 108],
    6: [11, 12, 108],
  },
  bassPriority: [32, 33, 39],
  padPriority: [89, 48, 91, 94, 92, 97, 98, 102],
  drumPriority: [0],
}
```

Notes:

- Modal worlds may prefer pad + lead over dense comp.
- Wind leads can remain rare and should be tested by ear before becoming common.

## World Selection

Choose chain profile by style first, then allow seed variation inside a safe set.

Recommended defaults:

```text
jazz -> jazzCombo
lofi -> lofiTapeKeys
rnb  -> electricKeys
modal -> modalAmbient
pop:
  if mode/mood suggests soft synth -> syntheticSoft
  else if seed branch -> acousticPianoBand
  else -> electricKeys or acousticPianoBand
default -> acousticPianoBand
```

Do not randomly mix chain profiles role-by-role.

All roles in one song should come from one selected profile, with only local fallback if a role is absent from lineup or unsupported.

## Compatibility Scoring

Implement chain priority first. Add scoring only as tie-breaker or validation.

Hard reject:

```text
comp program cannot play comp
bass role must use bass family
drum role must use drum kit
pad role must use sustained/pad/organ/string family
lead must not use harsh GM family by default
FX pad cannot be lead/comp
```

Strong bonus:

```text
lead and comp same exact program
lead and comp same GM family
lead and comp same timbreSource: acoustic/electric/synth
comp acoustic piano + mallet lead
Rhodes/FM comp + Rhodes/FM/vibraphone lead
harpsichord comp + vibraphone/marimba/kalimba lead
```

Penalty:

```text
mallet lead + electric comp unless profile explicitly allows it
bright piano + FX pad
slap bass + soft lofi
pan flute/shakuhachi + bright piano
FX pad selected as main pad in dry/acoustic world
jazz + synth bass
```

Required exported helpers:

```ts
export function chooseOrchestrationChain(style: string, rng: Rng, requested?: TimbreWorld): ChainProfile;

export function orchestrateRolePrograms(args: {
  style: string;
  lineup: readonly InstrumentRoleName[];
  rng: Rng;
  requestedWorld?: TimbreWorld;
  provisional?: Partial<Record<InstrumentRoleName, number>>;
}): {
  world: TimbreWorld;
  profileId: string;
  roleProgram: Record<InstrumentRoleName, number>;
  decisions: string[];
};

export function scoreProgramPair(a: number, b: number, relation: 'lead-comp' | 'pad-comp' | 'bass-comp'): number;
```

The `provisional` argument can be used during Phase 1 to preserve some existing seed variety, but it must not override chain compatibility. If provisional choices are incompatible, the chain table wins.

## Determinism

All choices must be deterministic from the provided `rng`.

Do not use `Math.random()`.

Use stable priority arrays. If choosing among multiple acceptable options, either:

- pick the first legal option for strict stability, or
- use `rng.pick(...)` only within the top compatible subset.

Document which one you choose.

## Integration Requirements

### BandEngine

Preferred Phase 1:

- Keep lineup logic in BandEngine.
- Keep provisional `roleProgram` if required for compatibility.
- Add a comment that exact effective GM selection is owned by Instrumentation.

Do not let tests assert that `band.roleProgram` is the final sounding program.

### InstrumentationPlanner

Required:

- Call `orchestrateRolePrograms(...)` before building `programByRoleSection`.
- Run compatibility repair inside or after chain orchestration.
- Store final effective `roleProgram` on `InstrumentationPlan`.
- Store `orchestrationChain` diagnostics.
- Build `programByRoleSection` from final effective `roleProgram`.

### RenderCoordinator

Required:

- Use `instrumentation.roleProgram` or section-effective `programByRoleSection` for role program decisions.
- Do not use `band.roleProgram` as the source of truth for comp family/voicing or TrackIR program attachment.

### Trace / Debug UI

Update trace output to show:

```text
chain world/profile
effective roleProgram
chain decisions
sameInstrumentPairs
```

This helps ear-checking and seed diagnosis.

## Tests Required

Add:

```text
src/core/generation/newEngine/knowledge/gmOrchestrationChains.test.ts
```

Assertions:

- Each chain profile has comp/lead/bass/pad/drum priorities.
- Every program in a chain has `instrumentInfo` metadata and `gmName`.
- `electricKeys` chooses compatible comp/lead pairs.
- `lofiTapeKeys` avoids bright piano comp and defaults to EP/harpsichord world.
- `jazzCombo` never chooses synth bass.
- `acousticPianoBand` allows piano comp + mallet lead.
- `syntheticSoft` can choose synth bass + synth pad without mixing harsh lead.
- Hard rejects prevent comp from becoming organ/pad/string/wind.
- Determinism: same seed/style/lineup gives same roleProgram.

Add or update:

```text
src/core/generation/newEngine/instrumental/instrumentalPlanner.test.ts
```

Assertions:

- `InstrumentationPlan.roleProgram` exists and is final effective program.
- `programByRoleSection` is derived from `InstrumentationPlan.roleProgram`.
- `band.roleProgram` mismatch, if any, does not leak into final TrackIR program.
- all active roles have final programs.
- comp final program always `canPlayComp`.
- bass final program is bass family.
- pad final program is pad/sustained family.

Add:

```text
src/core/generation/newEngine/render/gmProgramSource.test.ts
```

Assertions:

- `renderSongFull` attaches TrackIR `program` from `InstrumentationPlan.programByRoleSection`.
- If `band.roleProgram.comp` is deliberately incompatible in a test fixture, render still uses repaired/chain-selected comp program.
- `renderAccompaniment` receives the final effective comp program, not provisional band program.

Update existing tests if needed:

- `instrumentCapability.test.ts`
- `instrumentPairing.test.ts`
- `timbreWorld.test.ts`
- `timbreSwitch.test.ts`
- `GenerationController.test.ts`

Do not weaken tests that protect MG lead parity.

## Golden Seeds To Print

Run and print compact summaries for:

```text
7 / lofi
396040 / pop
777870 / rnb
633823 / pop
64062 / lofi
959571 / rnb
42 / jazz
```

Summary format:

```text
seed/style
world/profile
lineup
effective roleProgram: bass=GM.. comp=GM.. lead=GM.. pad=GM.. drum=GM..
decisions: ...
```

Expected qualitative results:

- LOFI should usually be EP/harpsichord + mallet/EP + dry bass + warm/halo pad.
- RNB should usually be EP/FM/Clav-ish keys + finger/fretless/synth bass + warm/organ/halo pad.
- Jazz should be acoustic piano/Rhodes + vibraphone/Rhodes/harpsichord + acoustic/fretless bass.
- Pop should land in one coherent world, not random bright piano + FX pad + unrelated lead.

## Test Commands

Run targeted tests:

```bash
npx vitest run \
  src/core/generation/newEngine/knowledge/gmOrchestrationChains.test.ts \
  src/core/generation/newEngine/instrumental/instrumentalPlanner.test.ts \
  src/core/generation/newEngine/render/gmProgramSource.test.ts \
  src/core/generation/newEngine/knowledge/instrumentCapability.test.ts \
  src/core/generation/newEngine/knowledge/instrumentPairing.test.ts \
  src/core/generation/newEngine/knowledge/timbreWorld.test.ts \
  src/core/generation/newEngine/instrumental/timbreSwitch.test.ts \
  src/core/generation/newEngine/render/mgFinalLeadParity.test.ts \
  src/core/generation/newEngine/render/productLeadNonMutation.test.ts
```

Then run:

```bash
npx vitest run src/core/generation/newEngine
```

## Acceptance Criteria

Complete only when:

- Exact GM program choice is owned by Instrumentation, not BandEngine.
- Chain profile is visible in `InstrumentationPlan`.
- Final `programByRoleSection` comes from chain-selected effective `roleProgram`.
- Render consumes final effective programs.
- Same-family and compatible-pair priority is enforced.
- Current user-selected palette is preserved.
- No harsh GM programs enter default chains.
- Tests prove deterministic behavior and no leak from provisional `band.roleProgram`.
- MG lead parity still passes.
- Full newEngine suite passes.

## Final Report Required From Claude

Report:

```text
Completed:
- Chain profiles added: yes/no
- Instrumentation owns effective roleProgram: yes/no
- Render consumes instrumentation programs: yes/no
- BandEngine exact GM selection deprecated or bypassed: yes/no

Files changed:
- ...

Tests run:
- ...

Golden seed summaries:
- ...

Known leftovers:
- ...
```

Do not claim this task improves texture or voicing. It only improves chain-based GM program selection in the instrumentation layer.
