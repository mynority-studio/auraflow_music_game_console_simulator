# MG Intent Planning Layer Migration Directive

> 交给 Claude 的总迁移任务。
>
> 目标:不回退已有成果,不继续堆 render 末端补丁,而是把 MG 的生成链路拆成 **musical intent contracts**, 分层迁移到 Simulator 的 style / harmony / arranger-plan / KB / render 各层。
>
> 核心原则:
>
> **Arranger owns musical intent. KB owns legal materials. Render owns realization. Postprocess only enforces safety.**

---

## 0. 背景与拍板

之前已经做了大量迁移和修复:

- ACG GrooveContract / texture / pedal / dynamics / chord-roll / pad exclusion 等修复。
- MG roadmap / brick / melody staged parity。
- 非 ACG bass density floor。
- 多个 MG vs SIM 审计脚本。

这些不要回退。问题不是“全做坏了”,而是我们已经通过多轮尝试确认:

1. **只在 render 末端补救会变成屎山。**
2. LOFI texture bridge 如果 render 后补,会撞 repeat consistency / accent alignment / texture switch 契约。
3. RNB lead cap 如果 render 后缩,会撞 replay / legato / pocket ordering。
4. RNB comp onset-form 不是 render 后处理问题,而是 texture family / musical-story intent 没有先定义。
5. ACG 能修好,是因为我们逐步给 final form 补了很多隐式 contract；非 ACG 要系统化,必须把这些 contract 前移到 plan 层。

所以本 directive 的策略是:

> **迁移,不是回退。**
>
> 把现有有效补丁逐步收编成 intent plan,让 render 消费 plan,而不是在最终音符之后反向修。

---

## 1. 不要动的边界

### 1.1 不回退这些成果

必须保留:

- ACG 已有听感修复。
- `GrooveContract` 在 arranger 层调配的架构。
- MG melody / roadmap / brick staged parity。
- 非 ACG bass floor 的有效成果。
- SIM 的完整成曲结构:intro / verse / chorus / bridge / outro。
- SIM 的 pad / drum 产品层。
- 现有 audit scripts 与 generated reports。

### 1.2 不做这些事

禁止:

- 不要把 SIM 改成 MG 16-bar loop generator。
- 不要全量搬运 MG engine 直接替换 SIM pipeline。
- 不要继续在 render 最后补 seed-specific hack。
- 不要靠 pad / drum 掩盖 bass / comp / lead 不像。
- 不要为了让报告变绿而放宽 audit 阈值。
- 不要使用 `git stash` 处理用户并行工作树。
- 不要 broad `git add .`。
- 不要修改 `../melodygenerative`。

---

## 2. 目标架构

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

## 3. 新增核心类型

### 3.1 MusicIntentPlan

新增一个集中计划对象。建议位置:

- `src/core/generation/musicGeneration/intent/MusicIntentPlan.ts`

建议结构:

```ts
export interface MusicIntentPlan {
  version: 1;
  style: StyleName;
  sections: SectionMusicIntent[];
}

export interface SectionMusicIntent {
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

不要求第一刀填满全部字段。必须支持增量迁移:

- 字段缺失时走旧逻辑。
- 字段存在时 render 必须优先消费 intent。

### 3.2 TextureFamilySchedule

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

export interface TextureFamilySlot {
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

### 3.3 CompOnsetFormSchedule

```ts
export type CompOnsetForm =
  | 'blockHeavy'
  | 'rollHeavy'
  | 'singleLine'
  | 'sparseAnswer'
  | 'mixed';

export interface CompOnsetFormSlot {
  startBeat: number;
  endBeat: number;
  form: CompOnsetForm;
  targetBlockRatio?: [number, number];
  targetSingleRatio?: [number, number];
  offgridVelocityRange?: [number, number];
}
```

### 3.4 BassPatternSchedule

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

export interface BassPatternSlot {
  startBeat: number;
  endBeat: number;
  family: BassPatternFamily;
  minAnchorsPerBar?: number;
  targetNotesPerBar?: [number, number];
  allowEnergyThinning?: boolean;
}
```

### 3.5 LeadGrammarIntent

```ts
export interface LeadGrammarIntent {
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

### 3.6 TextureTransitionPlan

```ts
export interface TextureTransitionPlan {
  slots: TextureTransitionSlot[];
}

export interface TextureTransitionSlot {
  atBeat: number;
  fromFamily: TextureFamily;
  toFamily: TextureFamily;
  bridge: 'none' | 'carryTail' | 'downbeatAnchor' | 'softShell';
  repeatGroupId?: string;
}
```

---

## 4. 分层职责

### 4.1 Style / Macro 层

负责定义偏好,不生成音符:

- style macro。
- texture family preference。
- brick / grammar preference。
- bass pattern preference。
- comp onset preference。
- lead register / coverage preference。

建议落点:

- `knowledge/finalEventProfile.ts`
- 新增 `knowledge/styleIntentProfiles.ts`

当前 `finalEventProfile.ts` 里已有 bass floor 的思路,不要删。把它升级为 style intent profile 的一部分。

### 4.2 Harmony 层

负责和声事实:

- chord timeline。
- harmonic function。
- borrowed chord。
- secondary dominant。
- tonicization。
- local tonal center。
- local scale context。

输出给 arranger / render 共享,不要在各 renderer 里重复推断。

### 4.3 Arranger / Plan 层

负责“音乐意图”:

- section form / energy。
- GrooveContract。
- roadmap / brick plan。
- texture family schedule。
- comp onset-form schedule。
- bass pattern schedule。
- lead grammar intent。
- texture transition plan。

**重要:** roadmap、brick 填充、织体选择 family 归 arranger / plan 层,不归 render 末端。

### 4.4 KB 层

负责合法材料:

- texture profiles。
- texture family mapping。
- brick catalog。
- grammar templates。
- bassline rules。
- comp onset-form metadata。

KB 不应该根据 seed 自己决定 musical story。它只回答:

> 在这个 family / intent 下,有哪些合法材料可以用?

### 4.5 Render 层

负责 realization:

- lead renderer 消费 `LeadGrammarIntent` / `BrickSchedule`。
- comp renderer 消费 `TextureFamilySchedule` / `CompOnsetFormSchedule`。
- bass renderer 消费 `BassPatternSchedule`。
- groove / pocket / humanize 消费 `GrooveContract`。

Render 允许安全后处理:

- range clamp。
- overlap cleanup。
- voice-leading safety。
- avoid-note correction。
- tail clamp。
- velocity normalize。

Render 不允许私自决定:

- 这段是 block 还是 roll。
- 这段 lead 要不要更满。
- 这段 bass 要不要删。
- 这段 texture 是否突然换 family。

---

## 5. 现有补丁如何收编

### 5.1 Bass floor

现状:render 里补 bass density floor。

迁移目标:

```ts
BassPatternSlot {
  family: 'rootAnchor' | 'walking' | 'syncopated';
  minAnchorsPerBar: ...;
  targetNotesPerBar: ...;
}
```

renderer 不再说“补 floor”,而是执行 bass pattern schedule。

### 5.2 ACG chord-roll

现状:ACG comp 后处理把同 onset chord roll 开。

迁移目标:

```ts
CompOnsetFormSlot {
  form: 'rollHeavy';
  targetSingleRatio: [0.95, 1.0];
}
```

ACG renderer 根据 onset form intent 做 roll,不是无语义后处理。

### 5.3 ACG pad exclusion

保留为 style arrangement policy:

```ts
styleIntentProfiles.acg.allowedRoles = ['lead', 'comp', 'bass'];
```

### 5.4 LOFI bridge / carryTail

不要再做 render 后补。

迁移目标:

```ts
TextureTransitionSlot {
  bridge: 'carryTail' | 'downbeatAnchor' | 'softShell';
  repeatGroupId: ...
}
```

bridge 必须在 plan 层决定,并随 repeat group replay,保证 verse1 / verse2 一致。

### 5.5 RNB lead coverage

不要在 replay / legato / pocket 后 cap。

迁移目标:

```ts
LeadGrammarIntent {
  targetCoverage: [min, max];
  maxGapBeats: ...;
  preserveRests: true;
}
```

lead coverage 在 grammar / phrase plan 阶段决定,而不是最终缩 duration。

### 5.6 RNB comp onset-form

不要 render 后强行 block/roll。

迁移目标:

```ts
TextureFamilySlot { family: 'block' | 'roll' | 'sparseAnswer'; ... }
CompOnsetFormSlot { form: 'blockHeavy' | 'rollHeavy' | ... }
```

SIM 可以选自己的具体 texture,但必须先满足 MG-like family intent。

---

## 6. 分批任务

### Phase 0:Inventory / Marking

目标:盘点现有 render 末端补丁,分类为:

- `renderSafety`:保留在 render。
- `moveToIntent`:迁移到 plan。
- `deleteAfterMigration`:迁移完成后删除。

任务:

1. 搜索并列出这些关键词:

```bash
rg -n "floor|gap|fill|cap|roll|duck|normalize|coverage|carry|bridge|tail|pocket|humanize|legato" src/core/generation/musicGeneration
```

2. 生成文档:

- `docs/generated/intent_migration_inventory.md`

3. 不改输出。

验收:

```bash
npm run lint
```

---

### Phase 1:Intent Types + Passive Derivation

目标:新增 `MusicIntentPlan`,但先只记录,不改变输出。

任务:

1. 新增 `src/core/generation/musicGeneration/intent/`。
2. 定义核心类型。
3. 新增 `deriveMusicIntentPlan(...)`。
4. 在 `MusicGenerationResult.report` 或 debug report 中输出 intent 摘要。
5. 先从现有 ArrangementPlan / GrooveContract / style profile 派生:
   - section role。
   - energy。
   - groove contract id。
   - bass density intent。
   - texture family placeholder。

验收:

```bash
npm run lint
npx tsx scripts/audit-non-acg-per-section-feel.ts
npx tsx scripts/audit-mg-current-parity.ts --full --write-report-only
```

要求:

- 输出不应该变化。
- parity 仍 30/30。

---

### Phase 2:Bass Pattern Intent Migration

目标:把已有效的 bass floor 收编到 `BassPatternSchedule`。

任务:

1. 将 `bassDensityFloor` 的 style thresholds 上移到 `BassPatternSchedule`。
2. bass renderer 改为消费 `BassPatternSchedule`。
3. 保留现有听感结果,但删除无语义的 floor 命名或注释。
4. 对 ACG / POP / JAZZ / LOFI / RNB 都生成 bass intent。

验收:

```bash
npx tsx scripts/audit-non-acg-per-section-feel.ts
npx tsx scripts/audit-mg-bass-comp-lead-fidelity.ts --write-report-only
npx tsx scripts/audit-mg-current-parity.ts --full --write-report-only
npm run lint
```

要求:

- JAZZ / LOFI / RNB bass 仍保持 MG 50%+。
- ACG 不回归。
- parity 30/30。

---

### Phase 3:Texture Family Intent + KB Metadata

目标:织体选择不再只选具体 case,而是先定 family intent。

任务:

1. 给 texture profiles 增加 metadata:

```ts
family;
densityRange;
onsetForm;
allowsPhraseSwitch;
needsBridge;
supportsCarryTail;
clockSafety;
```

2. 新增 texture family resolver:

```ts
resolveTextureProfileForIntent(intentSlot, candidates, rng)
```

3. arranger / plan 层生成 `TextureFamilySchedule`。
4. render 只从匹配 family 的 profiles 里选具体 case。
5. 暂不启用 LOFI phrase switch;只先让 family 可见、可审计。

验收:

```bash
npx tsx scripts/audit-non-acg-per-section-feel.ts
npx tsx scripts/audit-mg-bass-comp-lead-fidelity.ts --write-report-only
npm run lint
```

新增审计:

- `scripts/audit-mg-intent-family.ts`

检查:

- 每个 section 的 intended family。
- 实际 texture case 是否属于该 family。
- 不检查 seed-by-seed case 一致,只检查 family-level 一致。

---

### Phase 4:Comp Onset-Form Intent

目标:comp block / roll / arp / sparse answer 由 intent 决定。

任务:

1. 新增 `CompOnsetFormSchedule`。
2. ACG chord-roll 改为消费 `rollHeavy` intent。
3. RNB / JAZZ / POP 不再全局处理,按 texture profile metadata 执行。
4. renderer 输出后,用 audit 检查 actual onset form 是否落在 intent range。

验收:

```bash
npx tsx scripts/audit-non-acg-per-section-feel.ts
npx tsx scripts/audit-acg-per-section-feel.ts
npm run lint
```

新增审计:

- `scripts/audit-comp-onset-intent.ts`

检查:

- `blockHeavy` section: block ratio 在目标范围。
- `rollHeavy` section: single ratio 在目标范围。
- `sparseAnswer`: density 不超过目标上限。

---

### Phase 5:LOFI Repeat-Safe Texture Transition Plan

目标:重新做 LOFI bridge,但放在 plan 层,不是 render 后补。

前置:

- Phase 3 完成。
- Phase 4 完成。

任务:

1. 新增 `TextureTransitionPlan`。
2. LOFI texture switch 允许 phrase-level variation,但必须满足:
   - repeatGroupId 一致。
   - bridge plan 可 replay。
   - accent alignment clock-safe。
   - outro tail clamp。
3. 修改 `textureSwitchMusicality` 契约:
   - 旧:段内 ≤2。
   - 新:phrase-level switch allowed only if bridged + repeat-consistent + clock-safe。
4. 不允许 render 后独立补洞。

验收:

```bash
npx tsx scripts/audit-non-acg-per-section-feel.ts
npm test -- --run textureSwitchMusicality repeatGroupConsistency accentAlignment textureClockAlignment outroResolution
npm run lint
```

目标:

- LOFI texture variety 接近 MG。
- comp gap 不回归。
- repeatGroupConsistency 绿。
- accentAlignment 绿。

---

### Phase 6:Lead Grammar Intent

目标:lead 覆盖率、rest、slope、register 在 grammar / phrase plan 阶段决定,不是 final cap。

任务:

1. 将 MG grammar / brick / roadmap 输出挂到 `LeadGrammarIntent`。
2. lead renderer 消费:
   - targetCoverage。
   - maxGapBeats。
   - registerRange。
   - preserveRests。
   - preserveSlope。
   - boundaryResolution。
3. RNB lead-too-full 不再用 post cap 修。
4. 如果 legato / pocket 会改变 coverage,必须让它们读 intent boundary。

验收:

```bash
npx tsx scripts/audit-non-acg-per-section-feel.ts
npx tsx scripts/audit-mg-current-parity.ts --full --write-report-only
npm test -- --run mgFinalLeadParity productLeadNonMutation leadArticulation repeatGroupConsistency
npm run lint
```

目标:

- RNB lead coverage flags 下降。
- repeatGroupConsistency 不破。
- parity staged chain 不破。

---

### Phase 7:Cleanup

目标:删除迁移后无语义的 render 末端补丁。

任务:

1. 删除或改名:
   - 无语义 gap fill。
   - seed-specific cap。
   - style if scattered patch。
   - duplicated texture family decision。
2. 更新注释,禁止写历史叙事。
3. 更新 docs。

验收:

```bash
npm run lint
npm test -- --run
npx tsx scripts/audit-non-acg-per-section-feel.ts
npx tsx scripts/audit-acg-per-section-feel.ts
npx tsx scripts/audit-mg-bass-comp-lead-fidelity.ts --write-report-only
npx tsx scripts/audit-mg-current-parity.ts --full --write-report-only
```

---

## 7. Audit Strategy

以后不能只看 final event 一个层面。必须分三层审计。

### 7.1 Intent Audit

新增:

```bash
npx tsx scripts/audit-mg-intent-family.ts
```

检查:

- style → texture family preference 是否合理。
- section → texture family schedule 是否合理。
- bass pattern family 是否合理。
- lead grammar intent 是否合理。
- comp onset-form intent 是否合理。

输出:

- `docs/generated/mg_intent_family_audit_report.md`

### 7.2 Render Invariant Audit

新增:

```bash
npx tsx scripts/audit-render-intent-invariants.ts
```

检查:

- `rollHeavy` 是否真的 single-heavy。
- `blockHeavy` 是否真的 block-heavy。
- `sparseAnswer` 是否没有被填满。
- `bassPatternSchedule` 是否被执行。
- `LeadGrammarIntent.preserveRests` 是否被后处理破坏。

输出:

- `docs/generated/render_intent_invariants_report.md`

### 7.3 Final-Event Feel Audit

保留现有:

```bash
npx tsx scripts/audit-non-acg-per-section-feel.ts
npx tsx scripts/audit-acg-per-section-feel.ts
npx tsx scripts/audit-mg-bass-comp-lead-fidelity.ts --write-report-only
```

用途:

- 只作为最终听感形态验证。
- 不再用它倒推出随机补丁。

### 7.4 MG Current Parity Audit

保留:

```bash
npx tsx scripts/audit-mg-current-parity.ts --full --write-report-only
```

用途:

- 确认 staged MG chain 没漂。
- 不要求 final product note byte parity。

---

## 8. 每个 Phase 的汇报格式

Claude 每完成一个 phase,必须汇报:

```md
## Phase X Summary

### Changed
- 文件列表
- 新增/迁移的 intent 字段

### Preserved
- 哪些已有成果保持不变

### Audit
- 命令
- 关键结果

### Flags
- ACG 是否回归
- LOFI / RNB / JAZZ / POP flags 前后变化
- parity 是否仍 30/30

### Remaining
- 下一 phase 前置条件
- 未解决风险
```

---

## 9. 测试命令清单

### 快速检查

```bash
npm run lint
```

### MG staged parity

```bash
npx tsx scripts/audit-mg-current-parity.ts --full --write-report-only
```

### 非 ACG final-event feel

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

## 10. Acceptance Criteria

### Phase-level

- `npm run lint` pass。
- `mg-current-parity` 仍 30/30。
- ACG 不回归。
- 不新增 seed-specific hack。
- 不降低 audit 阈值。
- 不破坏 repeatGroupConsistency。

### Architecture-level

- Musical intent 不再散落在 renderer 后处理里。
- Texture family selection 可审计。
- Comp onset-form 可审计。
- Bass pattern 可审计。
- Lead grammar / coverage / register 可审计。
- Renderer 能说明自己消费了哪个 intent。

### Product-level

- SIM 仍是完整成曲,不是 MG loop。
- pad / drum 仍是 SIM 产品层。
- bass / comp / lead 听感逐步靠近 MG 的生成规律。
- 非 ACG 不追 seed-by-seed byte parity,但追 family / grammar / final-form invariants。
- ACG 保持当前高保真目标。

---

## 11. 当前推荐执行顺序

从现在开始,不要再做 LOFI bridge / RNB lead cap / RNB comp block 这类孤立小刀。

推荐顺序:

1. Phase 0:Inventory。
2. Phase 1:Intent types + passive derivation。
3. Phase 2:Bass floor 收编为 BassPatternSchedule。
4. Phase 3:Texture family metadata + schedule。
5. Phase 4:Comp onset-form intent。
6. Phase 5:LOFI repeat-safe texture transition。
7. Phase 6:Lead grammar intent。
8. Phase 7:Cleanup。

这样既能保留已经完成的工作,又能把架构从“末端补丁”迁移回“计划驱动”。

