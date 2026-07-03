# MG Intent Planning Layer Migration Directive

> 交给 Claude 的总迁移任务。
>
> 目标:不回退已有成果,不继续堆 render 末端补丁,而是把 MG 的生成链路拆成 **musical intent contracts**, 分层迁移到 Simulator 的 style / harmony / arranger-plan / KB / render 各层。
>
> 核心原则:
>
> **Arranger owns musical intent. KB owns legal materials. Render owns realization. Postprocess only enforces safety.**

---

## 0. Non-negotiable Intent

这些是本任务的硬边界,不可误解、不可绕开:

1. This is a migration, not a rewrite and not a rollback.
2. Phase 1 is observe-only. No generated output may change.
3. Intent fields do not affect render unless their mode is `enforce`.
4. Arranger / Plan decides musical intent:
   - roadmap
   - brick schedule
   - texture family
   - comp onset-form
   - bass pattern
   - lead grammar
   - groove contract
   - texture transition
5. KB only maps intent to legal materials.
6. Render only realizes intent and applies safety postprocess.
7. Do not chase seed-by-seed MG concrete texture-case parity.
8. Do match MG-like family / grammar / final-form invariants.
9. Do not add new final-event patches to pass audits.
10. If final-event feel differs, first locate whether the cause is:
    - missing intent
    - missing KB mapping
    - renderer not consuming intent
    - safety postprocess violating intent
11. Do not fix final-event differences by adding another post-render patch.
12. SIM remains a full-song arranger, not an MG 16-bar loop generator.
13. ACG remains high-fidelity; non-ACG follows family / grammar / final-form invariants.
14. Existing clean wins must be preserved and migrated, not reverted.

---

## 1. Background and Decision

之前已经做了大量迁移和修复:

- ACG GrooveContract / texture / pedal / dynamics / chord-roll / pad exclusion 等修复。
- MG roadmap / brick / melody staged parity。
- 非 ACG bass density floor。
- 多个 MG vs SIM 审计脚本。

这些不要回退。问题不是“全做坏了”,而是我们已经通过多轮尝试确认:

1. 只在 render 末端补救会变成屎山。
2. LOFI texture bridge 如果 render 后补,会撞 repeat consistency / accent alignment / texture switch 契约。
3. RNB lead cap 如果 render 后缩,会撞 replay / legato / pocket ordering。
4. RNB comp onset-form 不是 render 后处理问题,而是 texture family / musical-story intent 没有先定义。
5. ACG 能修好,是因为我们逐步给 final form 补了很多隐式 contract；非 ACG 要系统化,必须把这些 contract 前移到 plan 层。

所以本 directive 的策略是:

> 迁移,不是回退。
>
> 把现有有效补丁逐步收编成 intent plan,让 render 消费 plan,而不是在最终音符之后反向修。

---

## 2. Boundaries

### 2.1 Must Preserve

必须保留:

- ACG 已有听感修复。
- `GrooveContract` 在 arranger 层调配的架构。
- MG melody / roadmap / brick staged parity。
- 非 ACG bass floor 的有效成果。
- SIM 的完整成曲结构:intro / verse / chorus / bridge / outro。
- SIM 的 pad / drum 产品层。
- 现有 audit scripts 与 generated reports。

### 2.2 Must Not Do

禁止:

- 不要把 SIM 改成 MG 16-bar loop generator。
- 不要全量搬运 MG engine 直接替换 SIM pipeline。
- 不要继续在 render 最后补 seed-specific hack。
- 不要靠 pad / drum 掩盖 bass / comp / lead 不像。
- 不要为了让报告变绿而放宽 audit 阈值。
- 不要使用 `git stash` 处理用户并行工作树。
- 不要 broad `git add .`。
- 不要修改 `../melodygenerative`。
- 不要在 Phase 1 改变任何生成输出。
- 不要让 texture resolver 变成新的隐形 arranger。
- 不要让 renderer 私自决定 musical story。

---

## 3. Target Architecture

当前应该收敛到这条链路:

```text
Style / Macro Preferences
  ↓
Harmony Plan
  ↓
ArrangementPlan + MusicIntentPlan
  - section roles / energy
  - groove contract
  - roadmap plan
  - brick schedule
  - lead grammar intent
  - texture family schedule
  - comp onset-form schedule
  - bass pattern schedule
  - texture transition plan
  ↓
KB Material Resolution
  - brick catalog
  - grammar templates
  - texture profiles
  - bassline rules
  - final-event family metadata
  ↓
Render Realization
  - lead
  - comp
  - bass
  ↓
Safety Postprocess
  - range clamp
  - overlap cleanup
  - voice-leading safety
  - avoid-note correction
  - tail clamp
  - timing / velocity humanize under contract
  ↓
Audit
  - intent audit
  - render invariant audit
  - final-event feel audit
```

---

## 4. Core Types

### 4.1 Intent Mode

Every intent field must be explicit about whether it is only observed or actively enforced.

```ts
export type IntentMode = 'observe' | 'enforce';

export type IntentSource =
  | 'legacy'
  | 'mg-derived'
  | 'sim-derived'
  | 'manual-override';

export interface IntentMeta {
  mode: IntentMode;
  source: IntentSource;
  repeatGroupId?: string;
  createdBy: string;
}
```

Rules:

- `observe`: may be logged and audited, but must not change generated output.
- `enforce`: renderer may consume it and alter output.
- Phase 1 must only produce `observe` intent.
- Any phase switching a field from `observe` to `enforce` must state it explicitly in its summary.

---

### 4.2 MusicIntentPlan

Suggested location:

- `src/core/generation/musicGeneration/intent/MusicIntentPlan.ts`

```ts
export interface MusicIntentPlan {
  version: 1;
  style: StyleName;
  mode: IntentMode;
  source: IntentSource;
  sections: SectionMusicIntent[];
}

export interface SectionMusicIntent {
  meta: IntentMeta;

  sectionId: string;
  sectionRole: string;
  functionTag?: string;
  startBeat: number;
  endBeat: number;
  bars: number;
  energy: number;

  grooveContractId?: string;
  roadmapPlan?: RoadmapPlan;
  brickSchedule?: BrickSchedule;
  leadGrammarIntent?: LeadGrammarIntent;
  textureFamilySchedule?: TextureFamilySchedule;
  compOnsetFormSchedule?: CompOnsetFormSchedule;
  bassPatternSchedule?: BassPatternSchedule;
  textureTransitionPlan?: TextureTransitionPlan;
}
```

Incremental migration rule:

- Missing field → old logic.
- Field with `mode: observe` → log/audit only, no output change.
- Field with `mode: enforce` → renderer must consume it before falling back to old logic.

---

### 4.3 TextureFamilySchedule

```ts
export type TextureFamily =
  | 'block'
  | 'roll'
  | 'arp'
  | 'broken'
  | 'sparseAnswer'
  | 'pulse'
  | 'wash'
  | 'pedal'
  | 'stride'
  | 'ostinato';

export interface TextureFamilySchedule {
  meta: IntentMeta;
  slots: TextureFamilySlot[];
}

export interface TextureFamilySlot {
  meta: IntentMeta;
  startBeat: number;
  endBeat: number;
  family: TextureFamily;
  densityHint: 'sparse' | 'medium' | 'dense';
  switchPolicy: 'section' | 'phrase' | 'bar';
  requiresBridge?: boolean;
  allowsCarryTail?: boolean;
  clockSafety?: 'strict' | 'loose';
}
```

Important:

- This does not require SIM to pick the same exact texture case as MG.
- It requires SIM to pick a texture case from the intended family.
- Concrete instrument / texture case can remain SIM-owned.

---

### 4.4 CompOnsetFormSchedule

```ts
export type CompOnsetForm =
  | 'blockHeavy'
  | 'rollHeavy'
  | 'singleLine'
  | 'sparseAnswer'
  | 'mixed';

export interface CompOnsetFormSchedule {
  meta: IntentMeta;
  slots: CompOnsetFormSlot[];
}

export interface CompOnsetFormSlot {
  meta: IntentMeta;
  startBeat: number;
  endBeat: number;
  form: CompOnsetForm;
  targetBlockRatio?: [number, number];
  targetSingleRatio?: [number, number];
  offgridVelocityRange?: [number, number];
}
```

---

### 4.5 BassPatternSchedule

```ts
export type BassPatternFamily =
  | 'rootAnchor'
  | 'walking'
  | 'syncopated'
  | 'pedal'
  | 'broken'
  | 'octaveAlternate'
  | 'fifthDrop'
  | 'minimal';

export interface BassPatternSchedule {
  meta: IntentMeta;
  slots: BassPatternSlot[];
}

export interface BassPatternSlot {
  meta: IntentMeta;
  startBeat: number;
  endBeat: number;
  family: BassPatternFamily;
  minAnchorsPerBar?: number;
  targetNotesPerBar?: [number, number];
  allowEnergyThinning?: boolean;
}
```

---

### 4.6 LeadGrammarIntent

```ts
export interface LeadGrammarIntent {
  meta: IntentMeta;
  roadmapId?: string;
  grammarFamily?: string;
  targetCoverage?: [number, number];
  maxGapBeats?: number;
  registerRange?: [number, number];
  preserveRests: boolean;
  preserveSlope: boolean;
  boundaryResolution: 'mg' | 'sim-safe' | 'off';
}
```

Lead ordering rule:

- LeadGrammarIntent must be created before repeat replay.
- Legato / pocket / humanize may not independently expand coverage beyond intent boundary.
- If legato / pocket changes duration or coverage, it must consume intent limits.

---

### 4.7 TextureTransitionPlan

```ts
export interface TextureTransitionPlan {
  meta: IntentMeta;
  slots: TextureTransitionSlot[];
}

export interface TextureTransitionSlot {
  meta: IntentMeta;
  atBeat: number;
  fromFamily: TextureFamily;
  toFamily: TextureFamily;
  bridge: 'none' | 'carryTail' | 'downbeatAnchor' | 'softShell';
  repeatGroupId?: string;
}
```

LOFI transition rule:

- Bridge must be planned before replay.
- Bridge must be replay-consistent.
- No render-after-the-fact comp-gap filler.

---

## 5. Layer Responsibilities

### 5.1 Style / Macro Layer

负责定义偏好,不生成音符:

- style macro
- texture family preference
- brick / grammar preference
- bass pattern preference
- comp onset preference
- lead register / coverage preference

Suggested locations:

- `knowledge/finalEventProfile.ts`
- `knowledge/styleIntentProfiles.ts`

Current `finalEventProfile.ts` should not be deleted. Upgrade it into part of the style intent profile.

---

### 5.2 Harmony Layer

负责和声事实:

- chord timeline
- harmonic function
- borrowed chord
- secondary dominant
- tonicization
- local tonal center
- local scale context

The harmony layer outputs shared facts for arranger and render.

Do not duplicate local-scale or chord-contract inference inside individual renderers.

---

### 5.3 Arranger / Plan Layer

负责 musical intent:

- section form / energy
- GrooveContract
- roadmap / brick plan
- texture family schedule
- comp onset-form schedule
- bass pattern schedule
- lead grammar intent
- texture transition plan

Important:

> Roadmap, brick fill, texture family selection, comp form, bass pattern, and lead grammar belong to arranger / plan.
>
> They do not belong to render-end patching.

---

### 5.4 KB Layer

负责合法材料:

- texture profiles
- texture family mapping
- brick catalog
- grammar templates
- bassline rules
- comp onset-form metadata

KB only answers:

> Given this family / intent, what materials are legal?

KB must not decide musical story from seed by itself.

---

### 5.5 Render Layer

负责 realization:

- lead renderer consumes `LeadGrammarIntent` / `BrickSchedule`
- comp renderer consumes `TextureFamilySchedule` / `CompOnsetFormSchedule`
- bass renderer consumes `BassPatternSchedule`
- groove / pocket / humanize consumes `GrooveContract`

Render may do safety postprocess:

- range clamp
- overlap cleanup
- voice-leading safety
- avoid-note correction
- tail clamp
- velocity normalize

Render must not decide:

- whether a section is block or roll
- whether lead should be fuller
- whether bass should be deleted
- whether texture family should suddenly change
- how to fix audit by post-render event surgery

---

## 6. How Existing Work Gets Migrated

### 6.1 Bass Floor

Current state:

- render has bass density floor logic.
- This is a clean win and must be preserved.

Migration target:

```ts
BassPatternSlot {
  family: 'rootAnchor' | 'walking' | 'syncopated';
  minAnchorsPerBar: ...;
  targetNotesPerBar: ...;
}
```

Implementation rule:

- First wrap existing behavior with `BassPatternSchedule`.
- Do not delete adapter code until behavior equivalence is proven.
- Cleanup belongs to Phase 7.

---

### 6.2 ACG Chord-Roll

Current state:

- ACG comp postprocess rolls same-onset chord clusters.

Migration target:

```ts
CompOnsetFormSlot {
  form: 'rollHeavy';
  targetSingleRatio: [0.95, 1.0];
}
```

Implementation rule:

- Roll behavior remains.
- It becomes realization of onset intent, not an unowned final patch.

---

### 6.3 ACG Pad Exclusion

Keep as style arrangement policy:

```ts
styleIntentProfiles.acg.allowedRoles = ['lead', 'comp', 'bass'];
```

---

### 6.4 LOFI Bridge / CarryTail

Do not reintroduce render-end comp filler.

Migration target:

```ts
TextureTransitionSlot {
  bridge: 'carryTail' | 'downbeatAnchor' | 'softShell';
  repeatGroupId: ...
}
```

Rule:

- bridge must be planned before replay.
- bridge must be repeat-consistent.
- bridge must be clock-safe.
- outro tail must be clamped.

---

### 6.5 RNB Lead Coverage

Do not use post-replay cap.

Migration target:

```ts
LeadGrammarIntent {
  targetCoverage: [min, max];
  maxGapBeats: ...;
  preserveRests: true;
}
```

Rule:

- coverage is decided in grammar / phrase plan stage.
- legato / pocket must obey intent boundary.
- no final duration shrink to pass audit.

---

### 6.6 RNB Comp Onset-Form

Do not force block / roll in render after texture is already chosen.

Migration target:

```ts
TextureFamilySlot {
  family: 'block' | 'roll' | 'sparseAnswer';
}

CompOnsetFormSlot {
  form: 'blockHeavy' | 'rollHeavy' | 'sparseAnswer';
}
```

SIM can choose its own concrete texture case, but it must satisfy MG-like family intent.

---

## 7. Phased Tasks

### Phase 0: Inventory / Marking

Goal:

- Inventory existing render-end patches.
- Classify them as:
  - `renderSafety`
  - `moveToIntent`
  - `deleteAfterMigration`

Tasks:

1. Search:

```bash
rg -n "floor|gap|fill|cap|roll|duck|normalize|coverage|carry|bridge|tail|pocket|humanize|legato" src/core/generation/musicGeneration
```

2. Create:

```text
docs/generated/intent_migration_inventory.md
```

3. Do not change output.

Acceptance:

```bash
npm run lint
```

---

### Phase 1: Intent Types + Passive Derivation

Goal:

- Add `MusicIntentPlan`.
- Observe only.
- No generated output may change.

Tasks:

1. Add `src/core/generation/musicGeneration/intent/`.
2. Define core types.
3. Add `deriveMusicIntentPlan(...)`.
4. Expose intent summary in `MusicGenerationResult.report` or debug report.
5. Derive initial observe-only fields from existing `ArrangementPlan` / `GrooveContract` / style profile:
   - section role
   - energy
   - groove contract id
   - bass density intent
   - texture family placeholder

Required mode:

```ts
mode: 'observe'
```

Acceptance:

```bash
npm run lint
npx tsx scripts/audit-non-acg-per-section-feel.ts
npx tsx scripts/audit-mg-current-parity.ts --full --write-report-only
```

Additional no-output-change proof:

- Add or run an output snapshot check proving `generateMusicSync` musical output is unchanged.
- At minimum compare before/after:
  - track roles
  - note counts per role
  - first/last note per role
  - section count and section start/end beats
  - texture schedule / texture case list
  - pedal event counts
- If any output changes in Phase 1, stop and fix.

Acceptance requirement:

- `mg-current-parity` still 30/30.
- ACG does not regress.
- No generated musical output changes.

---

### Phase 2: Bass Pattern Intent Migration

Goal:

- Migrate existing bass floor into `BassPatternSchedule`.

Tasks:

1. Wrap current bass floor behavior as `BassPatternSchedule`.
2. Bass renderer consumes `BassPatternSchedule` when mode is `enforce`.
3. Keep adapter behavior equivalent to current output.
4. Do not delete old code path until Phase 7.
5. Generate bass intent for ACG / POP / JAZZ / LOFI / RNB.

Acceptance:

```bash
npx tsx scripts/audit-non-acg-per-section-feel.ts
npx tsx scripts/audit-mg-bass-comp-lead-fidelity.ts --write-report-only
npx tsx scripts/audit-mg-current-parity.ts --full --write-report-only
npm run lint
```

Targets:

- JAZZ / LOFI / RNB bass remains MG 50%+.
- ACG does not regress.
- parity remains 30/30.

---

### Phase 3: Texture Family Intent + KB Metadata

Goal:

- Texture selection first decides family intent, then resolves legal SIM material within that family.
- This is not concrete texture-case parity.

Tasks:

1. Add metadata to texture profiles:

```ts
family;
densityRange;
onsetForm;
allowsPhraseSwitch;
needsBridge;
supportsCarryTail;
clockSafety;
```

2. Add texture family resolver:

```ts
resolveTextureProfileForIntent(intentSlot, candidates, rng)
```

Resolver rules:

- It must not decide musical story.
- It must not choose block vs roll vs arp on its own.
- It may only select a legal material inside the already planned family.
- It must avoid consuming main RNG in a way that drifts existing seeds unless this phase explicitly enforces output change.
- In observe mode, it only reports what would have matched.

3. Arranger / plan layer generates `TextureFamilySchedule`.
4. Render only selects from matching family when `mode: enforce`.
5. Do not enable LOFI phrase switch yet.
6. First make family visible and auditable.

Acceptance:

```bash
npx tsx scripts/audit-non-acg-per-section-feel.ts
npx tsx scripts/audit-mg-bass-comp-lead-fidelity.ts --write-report-only
npm run lint
```

New audit:

```bash
npx tsx scripts/audit-mg-intent-family.ts
```

Audit must report:

- intended family per section
- actual texture case per section
- whether actual case belongs to intended family
- family match rate

Minimum threshold after enforcement:

- family match rate must be 100% for enforced slots.
- observe slots may report mismatch but must not alter output.

---

### Phase 4: Comp Onset-Form Intent

Goal:

- Comp block / roll / arp / sparse answer comes from intent.

Tasks:

1. Add `CompOnsetFormSchedule`.
2. Migrate ACG chord-roll to consume `rollHeavy` intent.
3. RNB / JAZZ / POP use texture profile metadata, not global processing.
4. Renderer output must be audited against intent range.

Acceptance:

```bash
npx tsx scripts/audit-non-acg-per-section-feel.ts
npx tsx scripts/audit-acg-per-section-feel.ts
npm run lint
```

New audit:

```bash
npx tsx scripts/audit-comp-onset-intent.ts
```

Audit targets:

- `rollHeavy`: targetSingleRatio satisfied.
- `blockHeavy`: targetBlockRatio satisfied.
- `sparseAnswer`: density does not exceed target.
- enforced slots must pass.
- observe slots only report.

---

### Phase 5: LOFI Repeat-Safe Texture Transition Plan

Goal:

- Rebuild LOFI bridge at plan level, not render-end filler.

Prerequisites:

- Phase 3 complete.
- Phase 4 complete.

Tasks:

1. Add `TextureTransitionPlan`.
2. Allow LOFI phrase-level variation only when:
   - repeatGroupId is present and consistent
   - bridge plan is replayable
   - accent alignment is clock-safe
   - outro tail clamp is present
3. Update `textureSwitchMusicality` contract:
   - old: section has ≤2 switches
   - new: phrase-level switch allowed only if bridged + repeat-consistent + clock-safe
4. Do not add render-after-the-fact comp-gap filler.

Acceptance:

```bash
npx tsx scripts/audit-non-acg-per-section-feel.ts
npm test -- --run textureSwitchMusicality repeatGroupConsistency accentAlignment textureClockAlignment outroResolution
npm run lint
```

Targets:

- LOFI texture variety approaches MG.
- comp gap does not regress.
- repeatGroupConsistency passes.
- accentAlignment passes.

---

### Phase 6: Lead Grammar Intent

Goal:

- Lead coverage, rest, slope, register are determined at grammar / phrase planning stage.
- No final cap.

Tasks:

1. Attach MG grammar / brick / roadmap output to `LeadGrammarIntent`.
2. Lead renderer consumes:
   - targetCoverage
   - maxGapBeats
   - registerRange
   - preserveRests
   - preserveSlope
   - boundaryResolution
3. RNB lead-too-full must not be fixed by post cap.
4. Legato / pocket must read intent boundary before changing duration or coverage.

Ordering rule:

- `LeadGrammarIntent` is generated before repeat replay.
- Repeat replay must replay the same intent.
- Legato / pocket must not independently expand beyond intent coverage.
- If this cannot be guaranteed, do not enforce Phase 6.

Acceptance:

```bash
npx tsx scripts/audit-non-acg-per-section-feel.ts
npx tsx scripts/audit-mg-current-parity.ts --full --write-report-only
npm test -- --run mgFinalLeadParity productLeadNonMutation leadArticulation repeatGroupConsistency
npm run lint
```

Targets:

- RNB lead coverage flags decrease.
- repeatGroupConsistency does not break.
- parity staged chain does not break.

---

### Phase 7: Cleanup

Goal:

- Remove render-end patches that have been migrated into intent.

Tasks:

1. Delete or rename:
   - unowned gap fill
   - seed-specific cap
   - scattered style if patches
   - duplicated texture family decisions
2. Keep true render-safety code.
3. Update comments. No historical narrative comments.
4. Update docs.

Acceptance:

```bash
npm run lint
npm test -- --run
npx tsx scripts/audit-non-acg-per-section-feel.ts
npx tsx scripts/audit-acg-per-section-feel.ts
npx tsx scripts/audit-mg-bass-comp-lead-fidelity.ts --write-report-only
npx tsx scripts/audit-mg-current-parity.ts --full --write-report-only
```

---

## 8. Audit Strategy

以后不能只看 final event 一个层面。必须分三层审计。

---

### 8.1 Intent Audit

New:

```bash
npx tsx scripts/audit-mg-intent-family.ts
```

Checks:

- style → texture family preference
- section → texture family schedule
- bass pattern family
- lead grammar intent
- comp onset-form intent
- mode: observe/enforce
- source
- repeatGroupId

Output:

```text
docs/generated/mg_intent_family_audit_report.md
```

---

### 8.2 Render Invariant Audit

New:

```bash
npx tsx scripts/audit-render-intent-invariants.ts
```

Checks:

- `rollHeavy` is single-heavy.
- `blockHeavy` is block-heavy.
- `sparseAnswer` is not filled.
- `BassPatternSchedule` is executed.
- `LeadGrammarIntent.preserveRests` is not violated.
- enforced slots pass hard thresholds.
- observe slots report only.

Output:

```text
docs/generated/render_intent_invariants_report.md
```

---

### 8.3 Final-Event Feel Audit

Keep:

```bash
npx tsx scripts/audit-non-acg-per-section-feel.ts
npx tsx scripts/audit-acg-per-section-feel.ts
npx tsx scripts/audit-mg-bass-comp-lead-fidelity.ts --write-report-only
```

Use:

- final listening-shape validation
- not as a reason to add post-render patches

---

### 8.4 MG Current Parity Audit

Keep:

```bash
npx tsx scripts/audit-mg-current-parity.ts --full --write-report-only
```

Use:

- confirm staged MG chain did not drift
- does not require final product note byte parity

---

## 9. Phase Report Format

Claude must report every phase like this:

```md
## Phase X Summary

### Changed
- files
- new / migrated intent fields
- fields switched from observe to enforce

### Preserved
- existing wins preserved
- ACG status
- bass floor status

### Audit
- commands
- key results

### No-output-change Proof
- required for Phase 1
- optional for later observe-only changes

### Flags
- ACG regression?
- LOFI / RNB / JAZZ / POP flags before/after
- parity still 30/30?
- family match rate
- render invariant pass rate

### Remaining
- next phase prerequisites
- unresolved risks
```

---

## 10. Test Commands

### Fast check

```bash
npm run lint
```

### MG staged parity

```bash
npx tsx scripts/audit-mg-current-parity.ts --full --write-report-only
```

### Non-ACG final-event feel

```bash
npx tsx scripts/audit-non-acg-per-section-feel.ts
```

### ACG final-event feel

```bash
npx tsx scripts/audit-acg-per-section-feel.ts
```

### Bass / comp / lead aggregate

```bash
npx tsx scripts/audit-mg-bass-comp-lead-fidelity.ts --write-report-only
```

### Full test

```bash
npm test -- --run
```

### Focused tests when touching LOFI transition

```bash
npm test -- --run textureSwitchMusicality repeatGroupConsistency accentAlignment textureClockAlignment outroResolution
```

### Focused tests when touching lead pipeline

```bash
npm test -- --run mgFinalLeadParity productLeadNonMutation leadArticulation repeatGroupConsistency
```

### Focused tests when touching ACG comp

```bash
npm test -- --run acgCompHardContract mgBassCompLeadFidelity
```

---

## 11. Acceptance Criteria

### Phase-level

- `npm run lint` passes.
- `mg-current-parity` remains 30/30.
- ACG does not regress.
- No seed-specific hack.
- No audit-threshold weakening.
- No repeatGroupConsistency break.
- Observe-mode intent does not change output.
- Enforce-mode intent must have explicit report and audit.

### Architecture-level

- Musical intent no longer lives as scattered renderer postpatches.
- Texture family selection is auditable.
- Comp onset-form is auditable.
- Bass pattern is auditable.
- Lead grammar / coverage / register is auditable.
- Renderer can report which intent it consumed.
- Resolver cannot become a hidden arranger.

### Product-level

- SIM remains full-song arranger, not MG loop.
- pad / drum remain SIM product layer.
- bass / comp / lead gradually approach MG generation rules.
- Non-ACG does not chase seed-by-seed concrete texture case parity.
- Non-ACG does chase family / grammar / final-form invariants.
- ACG keeps high-fidelity target.

---

## 12. Recommended Execution Order

From now on, do not continue isolated patch attempts like:

- LOFI bridge as render filler
- RNB lead cap after replay
- RNB comp block forcing after texture choice

Recommended order:

1. Phase 0: Inventory.
2. Phase 1: Intent types + passive derivation.
3. Phase 2: Bass floor into BassPatternSchedule.
4. Phase 3: Texture family metadata + schedule.
5. Phase 4: Comp onset-form intent.
6. Phase 5: LOFI repeat-safe texture transition.
7. Phase 6: Lead grammar intent.
8. Phase 7: Cleanup.

This preserves the work already done and migrates the architecture away from render-end patching into plan-driven generation.

