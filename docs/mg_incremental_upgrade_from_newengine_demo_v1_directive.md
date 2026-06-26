# MG Incremental Upgrade Directive from Newengine_Demo-v1

目标: 基于 `Newengine_Demo-v1` 之后已经完成的 simulator/newEngine 分层成果,把 `../melodygenerative` 当前工作树里的新增能力做**版本升级接入**。  
关键要求: **不要全量覆盖,不要重新搬一次。先通读两边代码并自检,再做增量升级。**

---

## 0. 给 Claude 的总指令

你现在要在当前项目 `../auraflow_music_game_console_simulator` 中,把 `../melodygenerative` 当前升级后的音乐引擎能力接入进 simulator/newEngine。

这不是第一次移植,上一轮移植完成态已经打 tag:

```bash
git tag --list 'Newengine_Demo-v1'
git show --stat --oneline --decorate Newengine_Demo-v1
```

当前目标不是把 `../melodygenerative/src/lib` 全量复制覆盖到 simulator,而是以 `Newengine_Demo-v1` 为历史基线,保护当前 simulator 在 tag 之后已经做完的 Q+R / motif / blues / lead / mix / render 改动,只把新能力按现有 newEngine 分层补进去。

必须先做代码阅读和自检。不要跳过。

---

## 1. 升级前必须通读与自检

### 1.1 先确认 simulator 当前状态

在 `../auraflow_music_game_console_simulator`:

```bash
git status --short
git branch --show-current
git log --oneline --decorate --max-count=30
git diff --stat Newengine_Demo-v1..HEAD -- src/core/generation src/state docs package.json
npm run lint
npm run test
```

当前已知健康基线:

- `npm run lint` 应通过。
- `npm run test` 应通过。
- 当前已有大量 tag 后新增工作,尤其是:
  - Q+R motif sandbox / 走 A override bridge
  - blues motif/chord-contract 修复
  - jazz 16 分 run grid owner
  - fast lead legato
  - lead sanitizer
  - mix / GM / wind-breath / lead 音量修复

这些都是 simulator 当前资产,升级时必须保护。

### 1.2 通读 melodygenerative 当前工作树

在 `../melodygenerative`:

```bash
git status --short
npm run lint
npm run audit:groove-contract
```

重点阅读:

```text
../melodygenerative/src/lib/grooveContract.ts
../melodygenerative/src/lib/styleDictionary.ts
../melodygenerative/src/lib/musicEngine.ts
../melodygenerative/src/lib/musicTheory.ts
../melodygenerative/src/lib/localScaleResolver.ts
../melodygenerative/src/lib/dynamicHarmony.ts
../melodygenerative/src/lib/borrowedChordPlanner.ts
../melodygenerative/src/lib/tonicizationPlanner.ts
../melodygenerative/src/lib/localTonicizationColorPlanner.ts
../melodygenerative/src/lib/compingVoicing.ts
../melodygenerative/src/lib/improvisor/generateImprovisorMelody.ts
../melodygenerative/src/lib/improvisor/StyleRenderer.ts
../melodygenerative/src/lib/improvisor/FunctionalGrammar.ts
../melodygenerative/src/lib/improvisor/FunctionalRoadMap.ts
../melodygenerative/src/lib/improvisor/ImprovisorBrickCatalog.ts
```

重点识别当前新增能力:

- Groove Contract
- ACG macro
- ACG progression prototypes
- ACG texture cases
- ACG piano render behavior
- comping voicing upgrade
- local scale / melody contract 修正
- voice-leading / boundary melody shaper 修正
- improvisor grammar / brick / roadmap 新增模块

### 1.3 通读 simulator 现有接入层

在 `../auraflow_music_game_console_simulator` 阅读:

```text
src/core/generation/mgEngine/
src/core/generation/newEngine/arranger/
src/core/generation/newEngine/knowledge/
src/core/generation/newEngine/harmony/
src/core/generation/newEngine/render/
src/core/generation/newEngine/band/
src/core/generation/newEngine/instrumental/
src/core/generation/pipeline/
src/state/MgStyleStore.ts
```

特别注意:

- `mgEngine/adapter.ts` 是旧直跑桥,不是这次升级唯一入口。
- `newEngine/arranger` 是全曲结构与 groove 调配的权威层。
- `newEngine/knowledge` 是模板、texture、profile、规则表的归属层。
- `newEngine/render` 是 voice-leading、melody、texture realization、humanize、跨轨让位的归属层。
- `newEngine/harmony` 负责 HarmonicPlan,不是 render 负责。

---

## 2. 架构边界: 这次升级必须遵守

### 2.1 Groove 层必须在 arranger 调配

Groove Contract 是 song/section-level 的编曲身份,不属于单个 renderer 的私有随机选择。

正确方向:

```text
newEngine/knowledge/grooveContracts.ts
  保存 GrooveContract 数据、权重、查询、picker

newEngine/arranger/groovePlanner.ts
  选择 songGrooveContract / grooveContractBySection
  同时派生旧 grooveBySection 以保持现有 drum/render 兼容

ArrangementPlan
  下发 songGrooveContract / songGrooveContractId / grooveContractBySection

render layer
  只消费 ArrangementPlan 下发的 groove contract
```

禁止:

- 在 `renderMgMelody` 内自己重新 `pickGrooveContract`。
- 在 `accompanimentRenderer` / `bassRenderer` / `textureSchedule` 各自用 seed 再抽不同 groove。
- 只保留旧 `GrooveKind` 而不接 MG 的完整 `GrooveContract`。

旧 `grooveBySection: Record<SectionId, GrooveKind>` 可以保留,但它应从 MG GrooveContract 派生,作为兼容字段。

命名建议:

```ts
interface ArrangementPlanData {
  songGrooveContract: GrooveContract;
  songGrooveContractId: string;
  grooveContractBySection: Record<SectionId, GrooveContract>;
  grooveBySection: Record<SectionId, GrooveKind>; // legacy compatibility, derived
}
```

`renderCoordinator.ts` 当前负责调用 `renderMgMelody(...)`。升级时要把 `arrangement.songGrooveContract` 或按段解析的 contract 显式传进 `renderMgMelody`,不要只改 `mgLeadRenderer.ts` 的函数签名而忘了接调用点。

### 2.2 ACG 是 macro 偏好,不是新管道

ACG 应作为 Style/Macro preference 接入现有 newEngine,不是另建一条旁路。

需要接入:

```text
StyleName / MgStyle / HarmonyStyleName / TextureStyleName
MgStyleStore options
MG_STYLE_PREFIX
progression selector style map
texture style map
instrumental rich texture style map
mgLeadRenderer style map
mgMusicTheory StyleName
```

注意: simulator 还有旧的数值 `StyleId` 枚举用于历史 StyleConfig/外层兼容。不要重排或扩展旧 `StyleId` 数值顺序来接 ACG;ACG 应进入 MG/newEngine 的 macro/style union 与 store/pipeline 映射,避免破坏旧 golden seed 和历史 UI 枚举语义。

ACG 行为应进入这些层:

- Harmony preference: ACG progression prototypes / harmonic policy
- Texture preference: ACG texture cases / texture metadata
- Render preference: ACG piano texture realization / top-voice ownership / touch / voice-leading
- Groove preference: ACG groove contracts

禁止:

- 把 ACG 做成独立 pipeline。
- 用字符串子串匹配临时绕过 style union。
- 只给 UI 加 ACG 但 harmony/render 没有真实行为。

### 2.3 Texture 必须进 KB

Texture 是知识层数据,不是 arranger/render 的散落硬编码。

正确方向:

```text
newEngine/knowledge/textureProfiles.ts
  加 ACG TextureProfile
  加 ACG texture behavior metadata
  加 pick/rate/compatibility 查询

newEngine/render/textureSchedule.ts
  根据 ArrangementPlan + HarmonicPlan + texture KB 选择/调度

newEngine/render/textureRenderer.ts or accompanimentRenderer.ts
  只实现 textureCase 的事件渲染
```

禁止:

- 在 arranger 里写具体 note pattern。
- 在 harmony 里决定 textureCase。
- 在 render 里散落 texture profile 大表。

### 2.4 Voice-leading 与旋律规则在 render 层升级

Voice-leading、melody timing、boundary shaper、melody/comp collision、top voice touch 属于 render/melody realization 层。

正确方向:

```text
newEngine/render/mgLeadRenderer.ts
newEngine/render/mgStyleRenderer.ts
newEngine/render/mgMelodyShaper.ts
newEngine/render/mgPostMixShaper.ts
newEngine/render/accompanimentRenderer.ts
newEngine/render/bassRenderer.ts
newEngine/render/textureClock.ts
newEngine/render/humanize.ts
newEngine/render/interactionResolver.ts
```

需要升级:

- `renderMgMelody` 接受/读取 arranger 下发的 GrooveContract feel。
- melody timing 使用 contract 的 `melodySwingRatio`, `pushProbability`, `melodyStrongPocketMs`, `melodyWeakPocketMs`。
- comp/bass timing 使用 contract 的 `compSwingRatio`, `bassPocketMs`, `chordPocketMs`, `velocityHumanize`。
- ACG top-voice / boundary / piano touch 规则进入 render 层。
- 当前 simulator 已有 lead sanitizer、fast run grid owner、legato 等 tag 后资产,不得删除。

禁止:

- 在 render 层改和声 progression。
- 在 render 层插入 secondary dominant / borrowed chord。
- 用旧 melody fallback 覆盖 MG lead 真源。

---

## 3. 推荐落点与文件映射

### 3.1 Groove Contract

源:

```text
../melodygenerative/src/lib/grooveContract.ts
```

目标:

```text
src/core/generation/newEngine/knowledge/grooveContracts.ts
src/core/generation/newEngine/arranger/ArrangementPlan.ts
src/core/generation/newEngine/arranger/groovePlanner.ts
src/core/generation/newEngine/arranger/arranger.ts
src/core/generation/newEngine/render/mgStyleRenderer.ts
src/core/generation/newEngine/render/mgLeadRenderer.ts
src/core/generation/newEngine/render/textureSchedule.ts
src/core/generation/newEngine/render/textureClock.ts
src/core/generation/newEngine/render/humanize.ts
```

Contract 形状应保留 MG 语义:

```ts
type GrooveStyleName = 'POP' | 'JAZZ' | 'BLUES' | 'RNB' | 'LOFI' | 'ACG';
type GrooveGrid = 'straight' | 'swing' | 'shuffle' | 'dilla' | 'rubato';
type GrooveDensity = 'sparse' | 'medium' | 'active';

interface GrooveContract {
  id: string;
  name: string;
  style: GrooveStyleName;
  weight: number;
  grid: GrooveGrid;
  density: GrooveDensity;
  compSwingRatio: number;
  melodySwingRatio: number;
  bassPocketMs: [number, number];
  chordPocketMs: [number, number];
  melodyStrongPocketMs: [number, number];
  melodyWeakPocketMs: [number, number];
  velocityHumanize: number;
  accentPattern: number[];
  articulation: string;
  pushProbability?: number;
  bassPattern?: string;
  preferredTextureCases?: string[];
  allowedTextureCases?: string[];
  forbiddenTextureCases?: string[];
}
```

### 3.2 ACG Macro

源:

```text
../melodygenerative/src/lib/styleDictionary.ts
../melodygenerative/src/lib/musicEngine.ts
../melodygenerative/src/lib/grooveContract.ts
```

目标:

```text
src/state/MgStyleStore.ts
src/core/generation/pipeline/index.ts
src/core/generation/newEngine/knowledge/mgMusicTheory.ts
src/core/generation/newEngine/knowledge/progressions.ts
src/core/generation/newEngine/harmony/progressionSelector.ts
src/core/generation/newEngine/harmony/progressionRealizer.ts
src/core/generation/newEngine/knowledge/textureProfiles.ts
src/core/generation/newEngine/render/textureSchedule.ts
src/core/generation/newEngine/instrumental/instrumentalPlanner.ts
src/core/generation/newEngine/render/mgLeadRenderer.ts
src/core/generation/newEngine/render/mgStyleRenderer.ts
```

必须补:

- `ACG` style union
- `ACG` UI/store option
- `acg_` seed prefix
- ACG progression prototypes
- ACG fill scale / gravity preference / chord policy
- ACG texture profiles
- ACG groove contracts
- ACG render cases
- ACG melody/top-voice rules

### 3.3 Texture KB

源:

```text
../melodygenerative/src/lib/styleDictionary.ts
../melodygenerative/src/lib/musicEngine.ts
```

目标:

```text
src/core/generation/newEngine/knowledge/textureProfiles.ts
src/core/generation/newEngine/render/textureRenderer.ts
src/core/generation/newEngine/render/accompanimentRenderer.ts
src/core/generation/newEngine/render/textureSchedule.ts
```

要做:

- 把 ACG texture cases 加入 `TEXTURE_POOL`。
- 把 ACG texture behavior metadata 加入 `TEXTURE_BEHAVIOR`。
- `pickTextureForBar` / schedule 应能根据 GrooveContract 的 allow/prefer/forbid 做过滤与加权。
- renderer 覆盖 ACG cases:
  - `Piano_TopVoice_Planing`
  - `ACG_Quartal_Arp_Wave`
  - `ACG_Sakamoto_LH_Arp_RH_Penta`
  - `ACG_Ostinato_Hook_Pulse`
  - `ACG_Stride_Cantabile_Ballad`
  - `ACG_Anthem_Block_Push`
  - `ACG_Open_Broken_10th`
  - `ACG_Suspended_Block_Arrival`
  - `ACG_Bass_Tremolo_Color`
  - `ACG_Pedal_Wash_Color_Drops`

### 3.4 Harmony / Progression

源:

```text
../melodygenerative/src/lib/styleDictionary.ts
../melodygenerative/src/lib/dynamicHarmony.ts
../melodygenerative/src/lib/borrowedChordPlanner.ts
../melodygenerative/src/lib/tonicizationPlanner.ts
../melodygenerative/src/lib/localTonicizationColorPlanner.ts
```

目标:

```text
src/core/generation/newEngine/knowledge/progressions.ts
src/core/generation/newEngine/knowledge/dynamicTsdDictionary.ts
src/core/generation/newEngine/knowledge/tonicizationPolicies.ts
src/core/generation/newEngine/harmony/progressionSelector.ts
src/core/generation/newEngine/harmony/progressionRealizer.ts
src/core/generation/newEngine/harmony/dynamicHarmonyDecorator.ts
src/core/generation/newEngine/harmony/tonicizationPlanner.ts
src/core/generation/newEngine/harmony/harmonyEngine.ts
```

原则:

- progression template / policy 进 KB。
- selection / realization / decoration 进 harmony。
- render 不改 progression。
- ACG 是 style preference,不另起管道。

### 3.5 Melody / Voice-leading

源:

```text
../melodygenerative/src/lib/improvisor/
../melodygenerative/src/lib/localScaleResolver.ts
../melodygenerative/src/lib/musicTheory.ts
../melodygenerative/src/lib/musicEngine.ts
```

目标:

```text
src/core/generation/newEngine/knowledge/mgMusicTheory.ts
src/core/generation/newEngine/knowledge/mgLocalScaleResolver.ts
src/core/generation/newEngine/knowledge/melody*.ts
src/core/generation/newEngine/render/mgLeadRenderer.ts
src/core/generation/newEngine/render/mgStyleRenderer.ts
src/core/generation/newEngine/render/mgMelodyShaper.ts
src/core/generation/newEngine/render/mgNoteChooser.ts
src/core/generation/newEngine/render/mgPitchClassSets.ts
src/core/generation/newEngine/render/mgGuideTonePlanner.ts
```

注意:

- simulator 已有 MG lead 链,不要废掉。
- 只升级缺口: ACG、groove feel、current MG melody/voice-leading rules。
- 保留 simulator tag 后新增 lead grid / sanitizer / legato 修复。

---

## 4. 禁止事项

1. 禁止全量复制 `../melodygenerative/src/lib` 覆盖 `src/core/generation/mgEngine`。
2. 禁止回滚 tag 后 simulator 的 Q+R / motif / blues / lead / mix 改动。
3. 禁止让 render 自己抽 groove。
4. 禁止让 harmony/render 各自拥有不同 groove 随机流。
5. 禁止把 ACG 做成临时字符串 hack。
6. 禁止 texture 数据散落在 arranger/harmony/render 多处。
7. 禁止在 render 层改和声结构。
8. 禁止删除现有通过的测试来换通过。

---

## 5. 验收要求

至少跑:

```bash
npm run lint
npm run test
```

新增或更新测试建议:

```text
newEngine/arranger/grooveContract.test.ts
  - arranger 为每首歌选择稳定 GrooveContract
  - 同 seed 同 style 得到同 contract
  - grooveBySection 从 contract 派生且旧字段仍存在

newEngine/knowledge/grooveContracts.test.ts
  - POP/JAZZ/LOFI/RNB/ACG 均有 pool
  - pick 不越界
  - allowed/preferred/forbidden texture cases 可查询

newEngine/knowledge/textureProfiles.test.ts
  - ACG texture profiles 进 TEXTURE_POOL
  - ACG texture behavior metadata 完整

newEngine/harmony/acgProgressions.test.ts
  - ACG progression prototypes 可被 selector 命中
  - ACG major/minor 至少各有有效模板

newEngine/render/acgTextureRenderer.test.ts
  - ACG texture cases 可渲染出 comp/bass 或 piano events
  - 不产生空 span / NaN / 越界音

newEngine/render/grooveContractFeel.test.ts
  - lead feel 读取 melodySwingRatio
  - comp/bass 读取 compSwingRatio 和 pocketMs
  - render 不重新 pick groove
```

升级完成后,请输出:

1. 读过哪些源文件与目标文件。
2. 哪些能力已接入。
3. 哪些能力只做了兼容占位。
4. 哪些现有 simulator 后续改动被保护。
5. `npm run lint` 与 `npm run test` 结果。

---

## 6. 一句话边界

这次任务是:

```text
以 Newengine_Demo-v1 为上一轮移植基线,把 melodygenerative 当前新增的 groove contract / ACG macro / texture KB / voice-leading / melody render 规则做增量升级。
Groove 由 arranger 调配。
ACG 是 macro preference。
Texture 进入 KB。
Voice-leading 与旋律规则在 render 层升级。
不要全量覆盖,不要破坏 simulator tag 后已有成果。
```

---

## 7. Claude 预检问题的拍板

以下是对升级前关键不确定性的最终决策。执行时按本节为准。

### 7.1 源快照: 先固化,不要从流动脏树直接 port

`../melodygenerative` 当前可能是 dirty worktree。不得在没有源快照的情况下直接开始大规模迁移。

执行顺序:

1. 在 `../melodygenerative` 记录当前源状态:

```bash
git status --short
git rev-parse HEAD
git diff --stat
npm run lint
npm run audit:groove-contract
```

2. 用户需要提供一个稳定 source commit/tag,或明确说“以当前 worktree 快照为准”。
3. 如果用户选择 worktree 快照,迁移者必须在交付说明里列出 port 时读取过的 dirty 文件清单。

默认策略: **不要假设 dirty worktree 是稳定版本**。

### 7.2 确定性: 默认采用零洗牌接入

选择方案: **零洗牌接入**。

目标:

- 现有非 ACG 风格默认输出尽量保持不变。
- 不因为新增 `pickGrooveContract` 消耗主 RNG 而导致所有旧 seed 下游重排。
- ACG 作为新 macro 可以走完整 GrooveContract 新能力。
- 后续若要让 POP/JAZZ/LOFI/RNB 全量启用新版 GrooveContract,必须另开 bless/rebaseline 任务。

实现要求:

- `arranger/groovePlanner.ts` 不得消耗会影响现有 generation 主流的 RNG。
- 新 contract 选择使用独立稳定派生流,例如 `rng.substream('grooveContract')`,或用 seed/style hash 直接确定。
- 非 ACG 默认可先生成 legacy-compatible contract,从现有 `feel` / `grooveBySection` 派生,使旧听感与测试保持稳定。
- ACG 使用新 contract pool。

验收要求:

- 增加测试证明同 seed/style contract 稳定。
- 增加测试证明非 ACG 的旧 critical render/generation 测试不被大面积改写。

### 7.3 Swing 调和: contract 成为细分真源,feel 保留兼容

接受把单值 `ArrangementPlan.feel.swingRatio` 调整为兼容派生字段,但不要删除它。

规则:

- `ArrangementPlan.songGrooveContract.compSwingRatio` 是 comp/bass/drum 的 swing/pocket 真源。
- `ArrangementPlan.songGrooveContract.melodySwingRatio` 是 lead/MG melody 的 swing 真源。
- `ArrangementPlan.feel.swingRatio` 保留给旧调用方、drum 兼容和 tracing,默认从 `compSwingRatio` 派生。
- lead 仍由 `mgLeadRenderer` / `mgStyleRenderer` 拥有单轨 swing,全局 `applySwing` 不得再次作用到 lead。
- 现有 jazz 16 分 run grid owner、走 A override lead 预摆、fast lead legato、双摆避免测试必须继续通过。

### 7.4 Pocket: ms pocket 是 timing owner,不要双重 humanize

GrooveContract 的 `bassPocketMs` / `chordPocketMs` / `melodyStrongPocketMs` / `melodyWeakPocketMs` 是微时值/pocket 的主要来源。

规则:

- ms pocket 按 `ArrangementPlan.tempoBpm` 转成 beat/tick。
- 同一 part 同一事件不要同时叠加 contract pocket 和旧 `humanizeTiming` 的 timing 抖动。
- `humanizeVelocity` 可继续负责力度随机。
- `humanizeTiming` 对已由 GrooveContract pocket 处理的 part 应跳过、降级为 0,或只用于未接 contract 的 legacy 角色。
- 非 ACG 零洗牌阶段可让 legacy-compatible contract 的 pocket 为 0 或等价于现有 timing,避免旧歌整体漂移。

### 7.5 分期: Phase 1 框架,Phase 2 ACG 内容

同意分两期做。

Phase 1: GrooveContract 框架

- `knowledge/grooveContracts.ts`
- `ArrangementPlan` 增加 song/section contract 字段
- `groovePlanner` 负责选择/派生
- `renderCoordinator` 把 contract 传给 lead/render
- comp/bass/lead 消费 contract,但非 ACG 默认零洗牌
- 测试: arranger contract 稳定、render 不重新 pick、旧测试通过

Phase 2: ACG macro 内容

- ACG style union / store / seed prefix
- ACG progression prototypes
- ACG GrooveContract pool
- ACG texture profiles + behavior metadata
- ACG texture render cases
- ACG melody/top-voice/voice-leading 增量
- 测试: ACG harmony 命中、texture 可渲染、无 NaN/空 span、lint/test 通过

不得把 Phase 2 内容塞进 Phase 1 造成一次性大爆炸。每期应单独跑 `npm run lint` 和 `npm run test`。
