# NewEngine 伴奏织体切换音乐性修复指令

目标: 修复 newEngine 在伴奏织体切换时出现的 comp 自身空拍/断层问题。  
核心判断: 当前问题不是 CC 关音量,也不是 bass/pad 托底缺失,而是 rich texture 被逐 span 随机切换,且缺少结构点约束、兼容性检查和过渡补丁。  
架构归属: **织体切换决策必须放在 Instrumentation / 器配层**,由器配层读取 Arranger 的段落排布、section functionTag、repeatGroup、activeRoles 后生成 `RichTexturePlan`;render 层只消费计划并落事件,不得再自行 per-span 随机切换。
执行对象: Claude / newEngine implementation loop。

---

## 1. 问题复现与根因

### 1.1 复现 seed

重点 seed:

- `633823 / POP`
- `633823 / LOFI`
- 相关历史 seed: `64062 / LOFI`

`633823 / POP` 的当前 newEngine comp 轨在 bar4 到 bar5 附近出现明显空缺:

- bar4 texture: `Low_Pedal_Color_Wash`
- bar5 texture: `Piano_Question_Answer`
- bar4 comp 事件约结束于 beat `15.792`
- bar5 的 `Piano_Question_Answer` 第一击在小节内 `+2.0 beat`,即绝对 beat `18.000`
- 中间 comp 自身空缺约 `2.21 beat`

这就是用户听到的“柱式和弦变换到分解/回答前,伴奏自己断掉”的直接原因。

### 1.2 关键代码位置

当前逐 span 选择 rich texture:

- `src/core/generation/newEngine/render/textureSchedule.ts`
- 函数: `buildTextureSchedule`
- 问题点: 对每个 `ChordSpan` 调一次 `pickTextureForBar`,导致 bar-to-bar 可以硬切不同 texture。

当前 `Piano_Question_Answer` 本身是延迟进入型:

- `src/core/generation/newEngine/render/textureRenderer.ts`
- case: `Piano_Question_Answer`
- 第一击: `tRel = 2.0`

```ts
case 'Piano_Question_Answer':
  if (dur >= 4) {
    push(cM, 2.0, 0.5, 0.45);
    push(cM.slice(-2), 3.0, 0.35, 0.34);
  }
```

这个 texture 单独看没错,它是“回答型/留白型”。错在它被放在一个没有 pickup/carry 的硬切边界上。

### 1.3 MG 为什么没有这个问题

`../melodygenerative/src/lib/musicEngine.ts` 对非 LOFI 的策略是:

- POP / RNB / JAZZ: 先选一个 `songTextureCase`,整首歌沿用。
- LOFI: 允许 per-bar variation,但有独立 `lofiTextureRandom`、fallback、pocket/velocity shaping、bass pattern、melody fill。

MG 源码注释已经说明: 非 LOFI 混用多个 texture 会破坏 arrangement consistency,所以整首固定一个 texture。

因此,MG 没有 `Low_Pedal_Color_Wash -> Piano_Question_Answer` 这种不兼容硬切;newEngine 当前有。

---

## 2. 制作侧原则

联网参考结论:

- iZotope 的 arrangement 文章强调先按 verse / chorus / breakdown 等大段落标记结构,再围绕段落做编曲变化。  
  Source: https://www.izotope.com/en/learn/arranging-music-for-better-mixdown
- iZotope 关于 verse 与 chorus 对比的文章强调段落之间需要 contrast,但这个 contrast 是服务情绪和叙事,不是随机拼接 loop。  
  Source: https://www.izotope.com/en/learn/music-production-tips-to-create-contrast-between-verse-and-chorus
- Ableton 的 Making Music 提到 arrangement 是 timeline 上各部分的布局,组合不合适会马上听出来,常见处理是加减元素而不是机械拼接。  
  Source: https://makingmusic.ableton.com/arranging-as-a-subtractive-process
- MusicRadar 关于走出 4-bar loop 的文章提出: 新 section 可以通过 add/remove/change element 产生能量变化,但需要 transition FX / crash / reverse / riser 等把 section 串起来,否则会像 loop 硬拼。  
  Source: https://www.musicradar.com/tutorials/music-theory-songwriting/want-to-finally-finish-that-track-heres-how-to-escape-the-4-bar-loop-trap-and-actually-make-some-music

落到 newEngine:

1. 织体是段落身份的一部分,不是每小节随机换的装饰。
2. 主要切换点应该是结构点: intro -> verse, verse -> pre/hook, hook -> bridge, breakdown -> return。
3. 段内可以变化,但应少量、低概率,优先发生在 4/8 小节 phrase 边界。
4. 段内变化不能只换 textureCase,必须同时处理衔接: pickup / carry tail / downbeat anchor / fill / pad filter / bass continuity。
5. 如果没有衔接策略,宁可保持原 texture 不变。

---

## 3. 分层归属

### 3.0 单一 Owner: Instrumentation 层

织体切换的 owner 是 `instrumentalPlanner`,不是 `render/textureSchedule`。

原因:

- Arranger 已经给出 section 排布、section role、functionTag、repeatGroup、bar 数与能量弧。
- 器配层本来就负责 `textureBySection`、`activeRolesBySection`、`programByRoleSection`、melody reservation,它是唯一能把“段落身份 + 乐手进出 + 织体身份”统一规划的层。
- render 层只能看到 span 和和声,如果让 render 每个 span 重新 pick texture,就会绕开 arranger 的结构意图,导致 `Low_Pedal_Color_Wash -> Piano_Question_Answer` 这种不音乐的硬切。

因此新的调用关系必须是:

```text
ArrangementPlan
  -> InstrumentationPlan.richTexturePlan
  -> render/textureSchedule.ts projection(spanId -> textureCase + transition intent)
  -> bass/comp/drum renderers consume same schedule
```

禁止的调用关系:

```text
render/textureSchedule.ts
  -> for each ChordSpan pickTextureForBar(...)
```

`pickTextureForBar` 可以继续作为 KB 查询/候选选择函数存在,但它只能被器配层调用,不能由 render 层逐 span 调用。

### 3.1 KB 层

KB 保存 texture 的可查询音乐属性,不做随机流程控制。

需要扩展 `TextureProfile` 或新增 `TextureBehaviorProfile`:

```ts
interface TextureBehaviorProfile {
  textureCase: string;
  family: 'block' | 'arp' | 'pluck' | 'sustain' | 'answer' | 'chop' | 'roll' | 'wash';
  continuity: 'continuous' | 'semiContinuous' | 'sparse' | 'delayedEntry';
  firstOnsetBeat: number;
  lastReleasePolicy: 'ringsToBoundary' | 'shortTail' | 'staccato';
  minHoldBars: number;
  maxHoldBars?: number;
  switchRisk: 'low' | 'medium' | 'high';
  allowedSwitchPoints: ('sectionBoundary' | 'phraseBoundary' | 'barBoundary')[];
  needsTransitionIn?: boolean;
  needsTransitionOut?: boolean;
}
```

示例分类:

- `Low_Pedal_Color_Wash`: `family='wash'`, `continuity='continuous'`, `firstOnsetBeat=0.25`, `lastReleasePolicy='ringsToBoundary'`
- `Piano_Question_Answer`: `family='answer'`, `continuity='delayedEntry'`, `firstOnsetBeat=2.0`, `needsTransitionIn=true`
- `Piano_Lofi_Dusty_Chops`: `family='chop'`, `continuity='sparse'`, `firstOnsetBeat=0.58`
- `Piano_Lofi_Tape_Wobble_Arp`: `family='arp'`, `continuity='semiContinuous'`, `firstOnsetBeat=0.02`
- `Piano_CommonTone_Soft_Roll`: `family='roll'`, `continuity='semiContinuous'`, `firstOnsetBeat=0.05`

还需要一张兼容矩阵:

```ts
type TextureTransitionRating = 'allow' | 'allowWithBridge' | 'avoid';

interface TextureTransitionRule {
  fromFamily: string;
  toFamily: string;
  rating: TextureTransitionRating;
  bridge?: 'carryTail' | 'pickupChord' | 'downbeatAnchor' | 'drumFill' | 'padSwell';
}
```

硬规则:

- `continuous -> delayedEntry`: 默认 `avoid`;若在 section boundary 且有 `pickupChord + downbeatAnchor`,才 `allowWithBridge`。
- `block/wash -> answer`: 默认 `avoid`。
- `sustain/wash -> chop`: `allowWithBridge`,需要 bar-end pickup 或 next-bar downbeat anchor。
- `arp -> arp/roll`: `allow`。
- `sparse -> sparse`: 仅 LOFI 可 `allowWithBridge`,且 bass 或 pad 必须连续。

### 3.2 Instrumentation 层

器配层应拥有“织体身份计划”,而不是让 render 每个 span 现场随机。器配层必须根据 `ArrangementPlan.sections` 生成 rich texture 切换计划。

新增或扩展 `InstrumentationPlan`:

```ts
interface RichTexturePlan {
  textureBySection: Record<SectionId, string>;
  intraSectionSwitches: Record<SpanId, TextureSwitchIntent>;
  transitionByBoundary: Record<string, TextureTransitionIntent>;
}

interface TextureSwitchIntent {
  textureCase: string;
  reason: 'sectionIdentity' | 'phraseVariation' | 'energyLift' | 'breakdown' | 'return';
  switchPoint: 'sectionBoundary' | 'phraseBoundary' | 'barBoundary';
  requiresBridge: boolean;
}

interface TextureTransitionIntent {
  fromTexture: string;
  toTexture: string;
  bridge: 'none' | 'carryTail' | 'pickupChord' | 'downbeatAnchor' | 'drumFill' | 'padSwell';
  maxAllowedGapBeats: number;
}
```

器配层选择策略:

1. POP / RNB / JAZZ 默认 section-level texture:
   - 同 role 的 repeat sections 复用同 texture,例如 verse1/verse2 同 texture。
   - hook/chorus 可以换更强 texture,但只在 section boundary 换。
   - 如果只有 verse + chorus,最多 2 个核心 texture。
   - 选择输入必须来自 arranger: `section.role`, `section.functionTag`, `section.bars`, `repeatGroup`, `energyBySection`, `activeRolesBySection`。

2. 非 LOFI 的 song-level fallback:
   - 若无法安全规划 section transition,退回 MG 策略:整首一个 `songTextureCase`。
   - 这是最稳的兜底。

3. LOFI:
   - 允许 per-bar / phrase-cell variation,但必须使用 LOFI 专用 picker 和 transition safety。
   - 不允许把 POP/RNB/JAZZ 的现代 texture 随机逻辑直接套到 LOFI。

4. 段内切换概率:
   - POP: 0.05
   - RNB: 0.08
   - JAZZ: 0.03
   - LOFI: 0.20-0.30,但必须在 LOFI pool 内
   - 只允许在 4-bar phrase boundary,例如 section 内 bar 4/8/12。
   - 若 `toTexture.firstOnsetBeat > 0.75`,必须插入 bridge,否则拒绝。

### 3.3 Render 层

Render 层不再决定换哪个 texture,只消费器配层的计划。

`render/textureSchedule.ts` 改造方向:

- 输入从 `style + plan + random` 改成 `InstrumentationPlan.richTexturePlan`。
- 输出仍为 `spanId -> textureCase`,保持 bass/comp/drum 共享同一 textureCase。
- 不在 `buildTextureSchedule` 内每 span 调 `pickTextureForBar`。
- 这个模块只能做 projection / validation: 把 section-level / phrase-level 的 texture plan 展开到具体 span,并附带 transition intent。

`render/textureRenderer.ts` 增加 transition bridge 渲染能力:

```ts
interface TextureRenderContext {
  transitionIn?: TextureTransitionIntent;
  transitionOut?: TextureTransitionIntent;
}
```

桥接方式:

- `carryTail`: 将上一个 texture 的最后一个 comp hit 延长到边界前 `0.03 beat`。
- `pickupChord`: 在切换前 `-0.5` 或 `-0.25 beat` 插入下一和弦的 2-3 音 pickup。
- `downbeatAnchor`: 若下一 texture 第一击太晚,在下一小节 `0.0` 插入轻的 shell hit,再让原 texture 继续回答。
- `drumFill`: drum 层在边界前填充,但不能替代 comp continuity。
- `padSwell`: pad 层可做铺垫,但不能掩盖 comp 自身断裂的测试。

---

## 4. 具体修复策略

### 4.1 第一优先级: 非 LOFI 不再逐 span 随机切 rich texture

对 POP/RNB/JAZZ:

- 默认使用 section-level core texture。
- 若没有 section-level rich texture 规划,使用 song-level texture,对齐 MG。
- 禁止当前这种每个 `ChordSpan` 都重新 pick。

`633823 / POP` 应不再出现:

```text
Low_Pedal_Color_Wash -> Piano_Question_Answer
```

如果确实要切到 `Piano_Question_Answer`,必须满足:

- 发生在 verse -> hook 或 phrase boundary。
- boundary 前有 pickup 或 previous carry。
- boundary 后有 downbeat anchor。
- comp-only coverage audit 通过。

### 4.2 第二优先级: 建立 transition compatibility gate

在生成 texture schedule 前评估:

```ts
function canSwitchTexture(args: {
  fromTexture: string;
  toTexture: string;
  switchPoint: SwitchPoint;
  style: string;
  sectionRole: SectionRole;
  phraseBoundary: boolean;
  hasBassContinuity: boolean;
  hasPadContinuity: boolean;
}): TextureTransitionIntent | null
```

返回 `null` 表示拒绝切换,沿用原 texture。

### 4.3 第三优先级: comp continuity audit

新增只看 comp 的连续性测试,不要用 bass/pad 兜底遮过去。

建议指标:

```ts
interface CompContinuityReport {
  maxGapBeats: number;
  gaps: { startBeat: number; endBeat: number; reason: string }[];
}
```

阈值:

- section boundary: max gap <= `0.75 beat`,若标记为 intentional break 可到 `1.0 beat`。
- intra-section switch: max gap <= `0.5 beat`。
- sparse LOFI: max gap <= `0.75 beat`,但必须有 melody/bass/pad continuity 另行通过。
- POP/RNB/JAZZ: 不允许 `>1.0 beat` 的 comp-only gap 出现在非 breakdown 段。

注意: 这个 audit 不代替音乐判断,只抓硬断层。

---

## 5. Claude 执行 Loop

### Loop 1: 复现与测试先行

新增诊断测试:

- `633823 / POP`: comp 在 bar4->bar5 不允许出现 `>1.0 beat` 空隙。
- `633823 / LOFI`: LOFI sparse 允许小空隙,但 texture switch 必须有 bridge 或被标记为 intentional。
- `64062 / LOFI`: 保留历史 regression,避免低频/texture 拆分再次造成断层。

测试工具建议:

- 写一个 `measureCompGaps(ir, startBeat, endBeat)` helper。
- 输出最大 gap 和发生的 texture boundary。

终止条件:

- 当前 main 上测试能复现失败。
- 加上修复后测试通过。

### Loop 2: KB 元数据

在 `knowledge/textureProfiles.ts` 增加:

- `TextureBehaviorProfile`
- `TEXTURE_BEHAVIOR`
- `TEXTURE_TRANSITION_RULES`
- 查询函数:
  - `textureBehavior(textureCase)`
  - `rateTextureTransition(from, to)`
  - `firstOnsetBeat(textureCase)`
  - `isDelayedEntryTexture(textureCase)`

终止条件:

- 所有已 render 的 textureCase 都有 behavior profile。
- `Piano_Question_Answer` 被标记为 `delayedEntry / needsTransitionIn`。

### Loop 3: 器配层接管 rich texture plan

在 Instrumentation 层引入 `richTexturePlan`。

候选落点:

- `src/core/generation/newEngine/instrumental/InstrumentationPlan.ts`
- `src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`

原则:

- `textureBySection` 继续保留 generic texture,兼容旧逻辑。
- rich texture plan 是新增字段,用于 render 层替代 per-span picker。
- POP/RNB/JAZZ 先做 section-level,LOFI 才做 phrase/bar-level。
- rich texture plan 必须从 `ArrangementPlan.sections` 推导:
  - section boundary 是主要切换点。
  - repeatGroup 相同的 section 默认复用 texture。
  - verse 内 variation 只能在 phrase boundary 低概率触发。
  - hook/chorus 的 texture 可更强,但需要 transition compatibility gate。

终止条件:

- `render/textureSchedule.ts` 不再对 POP/RNB/JAZZ 每 span 随机 pick。
- 同一 section 内默认 textureCase 稳定。
- section boundary 可切,但必须经过 compatibility gate。

### Loop 4: Render bridge

改造:

- `render/textureSchedule.ts`: 消费 `richTexturePlan`。
- `render/accompanimentRenderer.ts`: 将 transition intent 传给 texture render。
- `render/textureRenderer.ts`: 支持 `carryTail / pickupChord / downbeatAnchor`。

最小可行策略:

1. 先实现 `downbeatAnchor`:
   - 如果 `toTexture.firstOnsetBeat > 0.75`,在新 span `tRel=0` 插一个轻 shell hit。
2. 再实现 `carryTail`:
   - 若 fromTexture 最后释放早于边界,延长最后一个 hit 到边界前。
3. 最后实现 `pickupChord`:
   - 在上一小节末 `-0.5` 插入下一和弦 guide-tone / shell pickup。

终止条件:

- `Low_Pedal_Color_Wash -> Piano_Question_Answer` 即使被允许,也不产生 2 beat comp 空洞。
- bridge 事件 velocity 应低于主 hit,避免像 bug 一样突然重砸。

### Loop 5: 对齐 MG 与音乐性回归

对照 MG:

- `633823 / POP`: MG 是 `Block_Chord` 全曲稳定;newEngine 可以不 bit parity,但不能比 MG 更断。
- `633823 / RNB/JAZZ`: 若选择 section texture,边界要有明确 transition。
- LOFI 保留 per-bar variation,但不得将非 LOFI 的随机切换策略套进去。

测试矩阵:

- seeds: `633823`, `64062`, `7`, `42`, `100`, `999`
- styles: `POP`, `RNB`, `JAZZ`, `LOFI`
- 检查:
  - status 不 failed。
  - comp-only max gap 达标。
  - section boundary switch 有 transition intent。
  - intra-section switch 概率受控。

---

## 6. 不要做的修复

不要只靠以下方式掩盖:

- 不要只把 bass 改长。
- 不要只把 pad 铺满。
- 不要只开更重的 CC64。
- 不要把所有 comp note duration 机械拉满。
- 不要把 `Piano_Question_Answer` 改成永远 downbeat 进;它本身是合法的回答型 texture。
- 不要在 render 层继续每 span 随机选 texture,再用补丁到处救火。

正确修复是:

1. 器配层先规划什么时候能换。
2. KB 告诉系统哪些 texture 能接,哪些需要桥。
3. render 层按计划做少量、可解释的连接事件。
4. audit / tests 抓 comp 自己的 continuity。

---

## 7. 给 Claude 的直接提示词

你需要修复 newEngine 的伴奏织体切换断层问题。不要改旋律主链,不要用 bass/pad 掩盖 comp 自己断掉。

当前 bug:

- seed `633823 / POP`
- bar4 `Low_Pedal_Color_Wash` 切到 bar5 `Piano_Question_Answer`
- `Piano_Question_Answer` 第一击在 `+2 beat`
- 导致 comp 轨自己出现约 `2.21 beat` 空洞

请按以下顺序执行:

1. 写测试复现 `633823 / POP` comp-only gap。
2. 给 `TextureProfile` 增加 behavior metadata 和 transition compatibility 查询。
3. 把 rich texture 选择从 render 的 per-span picker 上移到 instrumentation layer:
   - POP/RNB/JAZZ 默认 section-level 或 song-level texture。
   - LOFI 才允许 phrase/bar-level variation。
   - 段内切换概率要低,且只在 phrase boundary。
4. 改 `buildTextureSchedule` 为消费 `InstrumentationPlan.richTexturePlan`,不要再每 span 随机 pick。
5. 对 delayed-entry texture 实现 transition bridge:
   - 至少支持 `downbeatAnchor`。
   - 推荐支持 `carryTail`。
6. 跑 regression:
   - `633823 / POP`
   - `633823 / LOFI`
   - `64062 / LOFI`
   - 多 style 多 seed。

验收标准:

- `633823 / POP` 不再出现 bar4->bar5 的 2 拍以上 comp 空洞。
- POP/RNB/JAZZ 不再出现非结构点的高频 texture 硬切。
- verse->hook 可以换 texture,但必须有 transition intent。
- verse 内少数切换可以保留,但概率低,只在 phrase boundary,并通过 comp continuity audit。
- LOFI 可以更灵活,但必须使用 LOFI 专用 variation 和 transition safety。

---

## 8. 最终判断

这个问题的根不是“某个 texture 写错”,而是“texture 被放错了调度层”。

MG 的经验应该被吸收为:

- 非 LOFI: texture identity 稳定,段落变化通过加减层、音色、密度、能量和少量结构点切换完成。
- LOFI: 可以循环内变化,但变化本身是风格规则的一部分,不是随机拼接。

newEngine 应该保留分轨优势,但不要让分轨后的 render 层把伴奏织体当作可随小节自由洗牌的 pattern。织体切换必须回到器配/编曲层,成为有结构、有概率、有衔接、有审计的音乐决策。
