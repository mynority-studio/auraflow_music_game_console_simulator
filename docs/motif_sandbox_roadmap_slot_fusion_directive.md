# Q+R Motif Sandbox: RoadMap Slot Fusion Directive

Date: 2026-06-16

Scope: Q+R motif sandbox first, designed to merge with Q+N / New Engine later.

Depends on:

- `docs/motif_brick_progression_newengine_integration_directive.md`
- `docs/motif_sandbox_grid_alignment_structural_tone_directive.md`
- `docs/mg_melody_strict_newengine_migration_directive.md`

## 1. Purpose

Q+R currently captures a user motif, classifies it into a rough melodic brick function, selects a New Engine progression template, generates a RoadMap, and uses the motif weaver to quote/develop the motif.

The next step is to make the chain structurally correct:

```text
User motif
  -> UserMelodicBrick
  -> New Engine progression candidates
  -> selected full harmonic structure
  -> RoadMap harmonic bricks
  -> melodic slot plan that follows the RoadMap
  -> user motif brick placed into matching slots
  -> related generated/developed slots
  -> lead melody
```

The important change:

- Do not hard-code a 16-bar form.
- Do not hard-code motif quotes at `0 / 16 / 32 / 48`.
- Do not treat RoadMap as debug-only.
- The melodic slot plan must follow the RoadMap structure.
- User motif recurrence must be structural recurrence, not fixed-bar recurrence.

Impro-Visor is only a conceptual reference:

- theme/motif reuse
- theme variation
- grammar fill for empty regions
- rectify to harmony

Do not faithfully port Impro-Visor's Java architecture.

## 2. Current State

Already exists:

- Hidden-grid capture.
- Head-trim alignment: user motif begins at local `beat 0`.
- Structural tone filtering.
- Rough melodic brick classification:
  - `opening`
  - `approach`
  - `cadence`
  - `resolution`
  - `answer`
  - `launcher`
  - `ambiguous`
- New Engine progression prototype access.
- Template scoring against motif structural tones.
- RoadMap parsing.
- Weaver-based motif quote/develop/answer generation.

Current weakness:

- Q+R still assumes a fixed 16-bar target in several places.
- Progression candidate pool does not expose all Q+R-style New Engine templates.
- RoadMap output is not the primary melodic plan.
- Weaver still controls phrase layout directly.
- User motif recurrence is fixed-position, not RoadMap-structure-driven.

## 3. Design Principle

### RoadMap Owns Structure

RoadMap is the structural source of truth for melodic slots.

RoadMap should answer:

- Where is a harmonic approach?
- Where is a cadence?
- Where is a launcher/opening area?
- Which harmonic bricks recur?
- Which sections are structurally equivalent?

### Weaver Owns Motif Realization

The existing weaver should remain responsible for:

- exact user motif quote
- user motif transposition
- inversion
- sequence
- rhythmic shift
- answer generation
- cadence tail generation

But the weaver must stop deciding the global form by itself.

### User Motif Becomes A Melodic Seed Brick

The user motif should be treated as a melodic seed brick with a rough function:

```ts
type UserMelodicBrickFunction =
  | 'opening'
  | 'approach'
  | 'cadence'
  | 'resolution'
  | 'launcher'
  | 'answer'
  | 'passing'
  | 'neighbor'
  | 'arpeggio'
  | 'sequence'
  | 'ambiguous';
```

This rough function is enough. Do not overbuild a perfect classifier in this phase.

## 4. Non-Negotiable Requirements

1. No hard-coded `16` as the universal song length.
2. No hard-coded user motif anchors at `0 / 16 / 32 / 48`.
3. Q+R styles are:
   - `POP`
   - `LOFI`
   - `RNB`
   - `JAZZ`
4. `BLUES` does not need to be exposed in Q+R for this phase.
5. All New Engine progression templates that belong to those Q+R styles should be reachable by Q+R.
6. Section role should be a soft weighting signal, not a hard filter.
7. RoadMap harmonic bricks must be converted into melodic slots.
8. User motif quote/develop placement must follow melodic slots.
9. Generated slots must retain lineage to the user motif or to another slot when musically related.
10. Existing Q+R playback and UI must continue to work.

## 5. Target Data Model

### 5.1 Form Context

Add a form context instead of assuming fixed 16 bars.

```ts
export interface MotifSandboxFormContext {
  // Total length comes from sandbox UI, selected progression, or future Q+N form.
  // It must not be a hidden constant inside motifWeaver.
  totalBars: number;
  beatsPerBar: number;

  // Minimal first phase can use one synthetic section.
  // Future Q+N integration should pass real sections.
  sections: MotifSandboxSection[];
}

export interface MotifSandboxSection {
  id: string;
  role: 'intro' | 'verse' | 'chorus' | 'bridge' | 'ending' | 'loop';
  startBeat: number;
  durationBeats: number;
}
```

First phase may default to:

```ts
{
  totalBars: 16,
  beatsPerBar: 4,
  sections: [{ id: 'sandbox-main', role: 'verse', startBeat: 0, durationBeats: 64 }]
}
```

But this default must be passed explicitly as context and must not be hard-coded through the chain.

### 5.2 RoadMap Brick Slot

RoadMap harmonic bricks should be normalized into a Q+R-friendly structure.

```ts
export interface RoadmapBrickSlot {
  id: string;

  // RoadMap / parser identity.
  name: string;
  type:
    | 'Approach'
    | 'Cadence'
    | 'Launcher'
    | 'Tonic'
    | 'Cycle'
    | 'Turnaround'
    | 'Other';

  startBeat: number;
  durationBeats: number;
  sectionId?: string;

  // Realized chords covered by this RoadMap brick.
  chordIds: string[];

  // Coarse harmonic information used for melodic planning.
  entryFunction?: 'T' | 'S' | 'D';
  exitFunction?: 'T' | 'S' | 'D';
  cadenceStrength?: 'none' | 'weak' | 'strong';

  // For recurrence: equivalent harmonic brick names/types can receive motif reuse.
  recurrenceKey: string;
}
```

### 5.3 Melodic Slot

Melodic slots must be derived from RoadMap brick slots.

```ts
export interface MelodicSlot {
  id: string;
  roadmapBrickId: string;

  startBeat: number;
  durationBeats: number;
  sectionId?: string;

  // Required melodic job for this RoadMap region.
  requiredFunction:
    | 'opening'
    | 'approach'
    | 'cadence'
    | 'resolution'
    | 'continuation'
    | 'answer'
    | 'fill';

  // How this slot uses the user motif.
  userMotifPolicy:
    | 'mustQuote'
    | 'mustDevelop'
    | 'mayReference'
    | 'generatedOnly';

  // Musical relatedness across slots.
  lineage: {
    sourceMotifId?: string;
    parentSlotId?: string;
    transform?:
      | 'quote'
      | 'transpose'
      | 'invert'
      | 'sequence'
      | 'rhythmicShift'
      | 'answer'
      | 'cadenceTail'
      | 'none';
  };

  // Debug evidence shown in Q+R UI.
  reason: string;
}
```

### 5.4 Melodic Slot Plan

```ts
export interface MelodicSlotPlan {
  totalBars: number;
  beatsPerBar: number;
  slots: MelodicSlot[];

  // Slot ids where user motif appears exactly.
  userQuoteSlotIds: string[];

  // Slot ids where user motif is developed or referenced.
  userDevelopSlotIds: string[];

  // Debug summary for UI.
  warnings: string[];
}
```

## 6. Progression Candidate Pool

Current Q+R candidate pool is too narrow because it prefers `verse` as a hard filter.

Replace hard role filtering with soft role weighting.

### Required Behavior

For Q+R style `pop`, candidate pool should include all `POP` prototypes, regardless of:

- `verse`
- `chorus`
- `bridge`
- `intro`
- `ending`
- `loop`

Same for:

- `lofi` -> `LOFI`
- `rnb` -> `RNB`
- `jazz` -> `JAZZ`

Do not include `BLUES` in Q+R for this phase.

### Scoring Signals

Candidate scoring should include:

```ts
export interface ProgressionScoreBreakdown {
  structuralToneSupport: number;
  headFit: number;
  tailFit: number;
  cadenceFit: number;
  functionArcFit: number;
  sectionRoleFit: number;
  templatePrior: number;
  diversityBonus: number;
  degeneratePenalty: number;
  strongNonChordPenalty: number;
}
```

Rules:

- `sectionRoleFit` should reward but not exclude.
- `diversityBonus` should keep valid templates reachable across seeds.
- Degenerate progressions should still be penalized.
- Non-jazz styles must not fall back to `JAZZ`.
- `BLUES` remains excluded unless Q+R later adds blues style.

## 7. RoadMap To Melodic Slot Planning

Add a pure planning function:

```ts
export function buildMelodicSlotPlanFromRoadMap(args: {
  form: MotifSandboxFormContext;
  roadmapBricks: RoadmapBrickSlot[];
  userBrick: UserMelodicBrick;
  seed: number;
}): MelodicSlotPlan
```

### Mapping Rules

RoadMap brick type maps to melodic function:

```text
Launcher / Tonic start -> opening
Approach               -> approach
Cadence                -> cadence or resolution
Turnaround             -> answer or continuation
Cycle                  -> continuation
Other                  -> fill
```

User motif function maps to preferred slot:

```text
opening    -> Launcher / Tonic start / section opening slot
launcher   -> Launcher / section opening slot
approach   -> Approach slot
cadence    -> Cadence slot
resolution -> Cadence or post-cadence resolution slot
answer     -> Turnaround / continuation slot
ambiguous  -> first structurally strong slot
```

### Motif Quote Policy

The planner must choose at least one `mustQuote` slot.

Preferred exact quote locations:

1. Best function-matching RoadMap slot.
2. Equivalent recurrence of that RoadMap slot in a later section.
3. If no recurrence exists, section opening of the second major section.
4. If form is too short, at least one quote at the best function match.

Do not assume bars `0 / 16 / 32 / 48`.

### Motif Development Policy

Slots related to the user motif should use:

- `mustDevelop` for structurally related RoadMap slots.
- `mayReference` for answer/continuation regions.
- `generatedOnly` only where motif reference would fight the RoadMap function.

Generated/developed slots must store lineage:

```ts
lineage: {
  sourceMotifId: userBrick.sourceMotifId,
  parentSlotId: quoteSlot.id,
  transform: 'answer'
}
```

## 8. Weaver Integration

Current weaver should be refactored from phrase-loop ownership into slot filling.

Add:

```ts
export function renderMelodicSlot(args: {
  slot: MelodicSlot;
  userMotif: UserMotif;
  userBrick: UserMelodicBrick;
  progression: readonly SandboxChord[];
  previousNotes: readonly MotifNote[];
  seed: number;
  keyPc: number;
  mode: ScaleMode;
}): MotifNote[]
```

Expected behavior:

- `mustQuote`: place user motif exactly, clipped to slot duration.
- `mustDevelop`: apply existing weaver transforms.
- `mayReference`: use motif rhythm/contour fragments.
- `generatedOnly`: use current answer/fill logic, but target `slot.requiredFunction`.

Existing transform vocabulary can remain:

- quote
- transpose
- invert
- sequence
- rhythmic shift
- answer
- cadence tail

### Important

The user motif's original phrase may be longer than the slot.

Rules:

- If motif fits, quote full motif.
- If motif is too long, quote the strongest prefix/sub-motif based on structural tones.
- If slot is a cadence slot and motif is too long, prefer tail/cadence fragment.
- Do not stretch time unless an explicit transform is chosen.

## 9. Harmony Rectification

Continue using harmony adaptation after generated/developed notes.

Rules:

- Exact user quotes should remain exact unless explicitly marked as rectifiable.
- Developed/generated material should be rectified to the active real chord at `onsetBeat`.
- Use real template harmony:
  - `realRootPc`
  - `realTonePcs`
  - `realRoman`

Do not regress to only diatonic triads when the selected progression has secondary/borrowed/color harmony.

## 10. UI / Debug Requirements

Q+R Analysis panel should show:

- selected progression prototype
- target bars / beats
- RoadMap brick count
- melodic slot count
- first user quote slot
- all user quote slots
- all user develop/reference slots
- slot plan compact text:

```text
0.0 opening mustQuote Straight-Approach quote
8.0 continuation mayReference Turnaround answer
12.0 cadence mustDevelop Cadence cadenceTail
```

Do not add a long tutorial in the UI. Keep it as compact debug rows.

## 11. Phased Implementation Plan

### Phase 1: Dynamic Form Context

Tasks:

1. Add `MotifSandboxFormContext`.
2. Thread `form.totalBars` through progression selection, RoadMap, audit, and weaver.
3. Remove hidden `TARGET_BARS = 16` ownership from `generateMotifWeave`.
4. Preserve an explicit sandbox default of 16 bars for UI, but pass it as context.

Acceptance:

- Existing Q+R behavior still works with default 16 bars.
- A test can generate 8 bars and 24 bars without code changes.
- No fixed `0 / 16 / 32 / 48` anchors remain in the main planning logic.

### Phase 2: Full Q+R Style Candidate Pool

Tasks:

1. Replace hard `functionRole: 'verse'` filtering.
2. Include all prototypes for the selected Q+R style and mode first.
3. If mode-specific pool is too small, allow same-style opposite mode only as a scored fallback, not as an untracked surprise.
4. Keep `BLUES` excluded.
5. Add candidate-pool tests that list reachable prototype ids.

Acceptance:

- All `POP`, `LOFI`, `RNB`, and `JAZZ` prototypes can enter Q+R candidate pools.
- `BLUES` prototype does not enter Q+R.
- `sectionRoleFit` changes score but does not remove templates.

### Phase 3: Normalize RoadMap Bricks

Tasks:

1. Convert parser RoadMap output into `RoadmapBrickSlot[]`.
2. Preserve:
   - name
   - type
   - startBeat
   - durationBeats
   - recurrenceKey
   - covered chord ids
3. Add defensive fallback if RoadMap parsing fails:
   - generate one slot per chord span or per section span
   - expose warning in UI

Acceptance:

- RoadMap no longer exists only as debug text.
- A selected progression produces normalized RoadMap slots with beat ranges.
- Parser failure does not silently fall back to fixed phrase looping.

### Phase 4: Build Melodic Slot Plan

Tasks:

1. Implement `buildMelodicSlotPlanFromRoadMap()`.
2. Map RoadMap brick type to required melodic function.
3. Match user motif function to the best slot.
4. Add recurrence-based quote slots.
5. Add lineage to related slots.

Acceptance:

- User motif classified as `approach` lands in an Approach slot when available.
- User motif classified as `cadence` lands in a Cadence slot when available.
- Repeated RoadMap brick structures receive quote/develop recurrence.
- No test asserts fixed bars `0 / 16 / 32 / 48`.

### Phase 5: Slot-Based Weaver Rendering

Tasks:

1. Add `renderMelodicSlot()`.
2. Refactor `generateMotifWeave()` to iterate `MelodicSlotPlan.slots`.
3. Preserve existing motif quote/develop transform behavior.
4. Add function-aware generation for:
   - opening
   - approach
   - cadence
   - continuation
   - answer
5. Keep old phrase-loop behavior only as a fallback behind a clearly named path.

Acceptance:

- Lead melody is generated by slot plan order.
- `mustQuote` slots contain user motif or allowed sub-motif.
- `mustDevelop` and `mayReference` slots share rhythm/contour/pitch lineage with user motif.
- Generated slots do not overwrite exact user quote slots.

### Phase 6: Audit And UI

Tasks:

1. Extend audit to validate slot plan.
2. Add UI debug rows.
3. Add tests for:
   - dynamic form length
   - all style candidate reachability
   - RoadMap slot conversion
   - user motif slot match
   - recurrence by RoadMap structure
   - no fixed anchor dependency

Acceptance:

- `npm run test -- motifSandbox` passes.
- `npm run lint` passes.
- Q+R UI exposes slot plan without verbose instructional copy.

## 12. Tests To Add

### Candidate Pool Reachability

For each style:

```ts
expect(pool('pop')).toContainAllPopPrototypeIdsExceptBlues();
expect(pool('lofi')).toContainAllLofiPrototypeIds();
expect(pool('rnb')).toContainAllRnbPrototypeIds();
expect(pool('jazz')).toContainAllJazzPrototypeIds();
expect(pool('pop')).not.toContain('blues_12bar_dom');
```

### Dynamic Form

```ts
expect(generate({ totalBars: 8 }).progressionBeats).toBe(32);
expect(generate({ totalBars: 24 }).progressionBeats).toBe(96);
```

### RoadMap Slot Plan

```ts
const plan = buildMelodicSlotPlanFromRoadMap(...);
expect(plan.slots.every((s) => s.roadmapBrickId)).toBe(true);
expect(plan.userQuoteSlotIds.length).toBeGreaterThanOrEqual(1);
```

### Approach Motif Placement

```ts
const userBrick = motifAs('approach');
const plan = buildMelodicSlotPlanFromRoadMap({ userBrick, roadmapBricks });
expect(slot(plan.userQuoteSlotIds[0]).requiredFunction).toBe('approach');
```

### Cadence Motif Placement

```ts
const userBrick = motifAs('cadence');
const plan = buildMelodicSlotPlanFromRoadMap({ userBrick, roadmapBricks });
expect(['cadence', 'resolution']).toContain(slot(plan.userQuoteSlotIds[0]).requiredFunction);
```

### No Fixed Anchors

Use a 12-bar or 24-bar form and verify quote locations come from RoadMap slots, not fixed 16-beat phrase heads.

## 13. Non-Goals

Do not do these in this directive:

- Do not port Impro-Visor Java code.
- Do not add `BLUES` to Q+R.
- Do not integrate full Q+N orchestration yet.
- Do not replace Q+R weaver entirely.
- Do not build a perfect melody brick dictionary.
- Do not force all generated notes to be user motif material.

## 14. Definition Of Done

This task is done when:

1. Q+R can generate from a dynamic form length.
2. Q+R selected progression templates are reachable across all Q+R styles.
3. RoadMap harmonic bricks are converted into melodic slots.
4. User motif is placed by slot/function match, not fixed bar positions.
5. Related slots carry lineage back to user motif or parent slot.
6. Existing weaver motif recurrence still works through `mustQuote` / `mustDevelop`.
7. Tests prove dynamic length, candidate reachability, RoadMap slot planning, and motif placement.
8. `npm run test -- motifSandbox` passes.
9. `npm run lint` passes.

