# POP/JAZZ/LOFI/RNB MG Final-Event Fidelity Directive

> 交给 Claude 的修改任务。
>
> 目标:在不破坏 Simulator 主架构、成曲结构、section energy、pad/drum 产品层的前提下,让 POP / JAZZ / LOFI / RNB 的 **COMP / BASS / LEAD final events** 更接近当前 MG 的输出听感。
>
> 这不是 byte parity 任务,也不是全量搬运 MG。判断标准是最终听感事件形态:密度、连接感、空拍、音域、comp 块状/滚奏形态、bass 支撑、lead 覆盖率。

---

## 0. 必须先读

Claude 开始改之前,必须通读这些文件和报告:

### MG 侧

- `../melodygenerative/src/lib/musicEngine.ts`
- `../melodygenerative/src/lib/styleDictionary.ts`
- `../melodygenerative/src/lib/localScaleResolver.ts`
- `../melodygenerative/src/lib/basslineRules.ts`
- `../melodygenerative/tests/audit/harness.ts`

### Simulator 侧

- `src/core/generation/musicGeneration/MusicGenerationService.ts`
- `src/core/generation/musicGeneration/qnUiProjection.ts`
- `src/core/generation/musicGeneration/renderCoordinator.ts`
- `src/core/generation/musicGeneration/renderers/mgLeadRenderer.ts`
- `src/core/generation/musicGeneration/renderers/accompanimentRenderer.ts`
- `src/core/generation/musicGeneration/renderers/bassRenderer.ts`
- `src/core/generation/musicGeneration/arranger.ts`
- `src/core/generation/musicGeneration/arrangementPlan.ts`
- `src/core/generation/musicGeneration/textureProfiles.ts`
- `src/core/generation/musicGeneration/textureScheduler.ts`
- `src/core/generation/musicGeneration/groovePlanner.ts`

### 审计报告

- `docs/generated/non_acg_per_section_feel_report.md`
- `docs/generated/mg_bass_comp_lead_fidelity_report.md`
- `docs/generated/mg_current_parity_audit_report.md`

### 审计脚本

- `scripts/audit-non-acg-per-section-feel.ts`
- `scripts/audit-mg-bass-comp-lead-fidelity.ts`
- `scripts/audit-mg-current-parity.ts`

---

## 1. 总原则

### 1.1 不能破坏 Simulator 主架构

Simulator 仍然保留:

- arranger 成曲结构
- section energy
- intro / verse / chorus / bridge / outro 等段落
- pad / drum 作为 SIM 产品层
- Q+N 主链路
- render 层分轨输出

不要把 POP/JAZZ/LOFI/RNB 改成 MG 的 16-bar loop 生成器。

### 1.2 只对 bass / comp / lead 做 MG-like final-event shaping

pad / drum 不参与 MG 保真判断。

本轮只修:

- `bass`
- `comp`
- `lead`

判断不是“有没有调用 MG 模块”,而是 final events 是否接近 MG:

- 每 bar 事件密度
- note duration / coverage
- 最大静默 gap
- comp onset form: single / block / off-grid velocity
- lead register
- bass 支撑连续性
- texture family 覆盖

### 1.3 当前已确认:MG 中间链路不是主要问题

`scripts/audit-mg-current-parity.ts --full --write-report-only` 当前结果:

- POP 6/6 pass
- JAZZ 6/6 pass
- RNB 6/6 pass
- LOFI 6/6 pass
- ACG 6/6 pass
- Total: 30 pass / 0 fail

也就是说 roadmap / melody staged parity 已经对齐。现在的问题在 Simulator 主链 render / arrangement 把 final events 重新塑形之后,听感偏离 MG。

---

## 2. 最新审计结论

审计命令:

```bash
npx tsx scripts/audit-non-acg-per-section-feel.ts
npx tsx scripts/audit-mg-bass-comp-lead-fidelity.ts --write-report-only
npx tsx scripts/audit-mg-current-parity.ts --full --write-report-only
npm run lint
```

当前结果:

| style | section flags | texture flags | 风险 |
|---|---:|---:|---|
| LOFI | 42 | 2 | 高 |
| RNB | 45 | 0 | 高 |
| JAZZ | 23 | 0 | 中 |
| POP | 32 | 0 | 低到中 |

优先级:

1. LOFI
2. RNB
3. JAZZ
4. POP

---

## 3. P0:LOFI 修复

### 3.1 当前问题

LOFI 是非 ACG 里最不像 MG 的风格。

典型审计现象:

- MG 织体多样性:4-5 种
- SIM 织体多样性:1-2 种
- SIM bass 普遍过稀
- SIM comp 有时过稀、有时过密
- 不能简单逐 bar 切换 texture,因为 LOFI 织体本身稀疏,裸切会造成 comp 洞

示例:

- seed 0: MG texture 5 种,SIM 2 种;SIM bass `1/bar` vs MG `2.63/bar`
- seed 42: SIM comp `15.5/bar` vs MG `7.63/bar`,bass `1/bar` vs MG `2.63/bar`
- seed 99: SIM comp `4.25/bar` vs MG `11.63/bar`,bass `1/bar` vs MG `2.63/bar`,lead register 明显偏低

### 3.2 修改目标

LOFI 必须实现 MG-like 的:

- 稀疏但不断裂的 comp
- bass 稳定支撑
- 多 texture family 覆盖
- lead 不被填得太满,也不因为 section 切换断裂

### 3.3 实现要求

#### A. 不允许裸逐-bar texture random

LOFI 不要照 ACG 那样直接逐 bar 切 texture。

必须先实现或移植 MG-like transition bridge:

- `allowWithBridge`
- `downbeatAnchor`
- `carryTail`
- section / texture switch 边界补轻 shell
- 切换后第一拍要有 anchor 或 tail,避免 comp 空洞

如果 MG 里的命名不同,按 MG 实际代码为准,但行为必须一致:

> 稀疏 texture 之间切换时,用轻量和声承接,不要让伴奏突然断掉。

#### B. LOFI texture scheduler 需要从“段级固定”升级为“带桥接的 bar-level / phrase-level variation”

要求:

- 每首 LOFI 至少覆盖接近 MG 的 texture variety
- 不能让 `Piano_Lofi_OneShot_Space` 这类稀疏 case 连续吞掉整段
- 可以使用 2-bar / 4-bar phrase window,不要机械每 bar 换
- transition 必须检测前后 texture 的 `partPolicy` / sparsity

#### C. Bass 密度对齐 MG

当前 LOFI SIM bass 常见 `0.9-1/bar`,MG 常见 `2.4-2.7/bar`。

目标:

- intro/outro 可低,但 verse 主体不能长期低于 MG 的 50%
- 如果 section energy 低,可以降低 velocity,不要直接删 bass event
- 优先修 `bassRenderer` 或 style-specific bass profile,不要在 arranger 里硬塞

#### D. Lead register 修正

部分 LOFI seed SIM lead 明显比 MG 低:

- seed 99: MG reg `76`,SIM `65-67`
- seed 12345: MG reg `78`,SIM `65-68`

要求:

- 检查 render 层是否对 LOFI lead 做了统一降八度/低位约束
- 保留 MG grammar,但 final register 要按 MG 当前输出范围约束
- 不要用 pad 补空间感来替代 lead register

### 3.4 LOFI 验收

跑:

```bash
npx tsx scripts/audit-non-acg-per-section-feel.ts
```

LOFI 目标:

- section flags 明显下降
- texture flags 清零
- 主体 section bass 不再长期低于 MG 50%
- comp 不出现长 section 空洞
- lead register 与 MG 差距尽量 < 8 semitones

---

## 4. P0:RNB 修复

### 4.1 当前问题

RNB 的主要问题不是 texture 数量,而是 final-event shape:

- bass 普遍过稀
- lead 经常过满
- 部分 comp 从 MG 的块状 / groove 形态变成另一套形态
- seed 42 这类 high-density RNB,SIM comp/bass 明显不足

典型审计:

- seed 42: MG comp `20.31/bar`,SIM verse `9.33-9.58/bar`,chorus `6.75/bar`
- seed 42: MG bass `4.13/bar`,SIM `1-2/bar`
- seed 7: MG lead cov max `0.541`,SIM 常见 `0.807-0.998`,明显过满
- seed 99/12345:bass 多段低于 MG 50%

### 4.2 修改目标

RNB 要恢复 MG 的:

- bass pocket 支撑
- comp groove density
- lead 呼吸空间
- neo-soul / gospel / quartal 的 block/roll 形态

### 4.3 实现要求

#### A. Bass 不能被 section energy 过度削弱

RNB bass 是 groove 角色,不是装饰角色。

要求:

- 主体 section 的 bass density 向 MG 靠拢
- 低能量段可以降 velocity / register,不要砍事件数到 `0.25-1/bar`
- 对 RNB 建 style-specific bass density floor
- floor 应由 GrooveContract / style profile 派生,不要写死在全局

#### B. Lead coverage 要遵守 MG 的呼吸

RNB 当前很多 section lead 太满。

要求:

- 检查 `fillLeadBarGaps` / legato / sustain / sanitize 是否对 RNB 过度填空
- RNB 不要继承 POP 的“填满 hook”逻辑
- 按 MG phrase coverage 范围限制 section lead coverage
- 如果需要补连接,优先短 pickup / grace / neighbor,不要把长空拍全拉满

#### C. Comp block/roll 形态要按 MG texture final form

RNB 中有些 MG texture 是块状,有些是滚动/回答。

要求:

- 不要统一 chord-roll 或统一 block
- 每个 RNB texture case 要声明或继承 MG-like onset form:
  - block-heavy
  - roll-heavy
  - answer / call-response
  - sparse stab
- render 后处理不能把 block-heavy case 全部滚成 single,也不能把 roll-heavy case 压成同时起音

### 4.4 RNB 验收

目标:

- bass 过稀 warning 大幅下降
- lead 太满 warning 大幅下降
- seed 42 comp/bass 接近 MG high-density 形态
- seed 7 lead coverage 不再从 MG `0.375-0.541` 变成 SIM `0.8-1.0`

---

## 5. P1:JAZZ 修复

### 5.1 当前问题

JAZZ 不是最大问题,但存在:

- bass 常偏稀
- 个别 seed comp 过密
- lead gap 在部分 section 超过 MG phrase 范围

典型:

- seed 0:bass `0.5-2/bar` vs MG `3.75/bar`
- seed 99:comp `18.67/bar` vs MG `8.31/bar`
- seed 42:lead gap `~8` vs MG phrase max `4`

### 5.2 修改目标

JAZZ 要维持 SIM 成曲能力,但 final events 应接近 MG 的:

- walking / anchor bass 支撑
- block comp density
- head / solo lead 呼吸

### 5.3 实现要求

#### A. Bass density floor

JAZZ bass 不能在 intro / outro 之外长期低到 `0.5-1.5/bar`。

要求:

- 对 head / solo / chorus section 设 MG-like bass density floor
- intro/outro 可稀疏,但需要 intentional pickup / tag 逻辑
- 优先调整 bass renderer 的 jazz style profile

#### B. Comp density cap

seed 99 说明 JAZZ comp 可被 SIM texture/energy 推得过密。

要求:

- 建 style-specific comp density cap
- cap 按 MG reference per-bar 和 section role 调整
- 不要用全局 cap 影响 RNB/POP/LOFI

#### C. Lead gap 修正

JAZZ lead 可以有呼吸,但不应在 head section 出现明显超过 MG phrase max 的断裂。

要求:

- 查 section boundary replay / lead scheduling 是否漏掉 phrase continuation
- 如果需要补,补 pickup/approach,不要强行整拍 sustain

---

## 6. P1:POP 修复

### 6.1 当前问题

POP 整体风险最低,但仍有几类偏离:

- 有的 seed bass 过密
- 有的 seed lead gap 太大
- comp block/single 形态和 MG texture 不一致
- outro 有时 comp 直接归零,bass 翻倍

典型:

- seed 0:bass `2/bar` vs MG `1.06/bar`
- seed 7:lead gap `26` vs MG phrase max `10.5`
- seed 42/12345:MG block-heavy,但 SIM 多段变 single-heavy
- outro 多次出现 comp `0/bar`,bass `4/bar`

### 6.2 修改目标

POP 不需要大搬运,只做定点修:

- bass 不要因为 section energy 重复翻倍
- lead 不要出现超长断裂
- comp onset form 按 texture case 对齐
- outro 不要用“删 comp + 加 bass”来收尾

### 6.3 实现要求

#### A. Outro balance

POP outro 多次出现:

- comp `0/bar`
- bass `4/bar`

这和 MG 听感不一致。

要求:

- outro 应该保留轻量 comp shell / tail
- bass 可以收束,但不要替代 comp 承担全部和声

#### B. Texture onset-form contract

POP texture 有些是 block-heavy,有些是 arp/single-heavy。

要求:

- 为 POP texture case 增加 onset-form metadata 或复用 MG texture family
- render 后处理按 metadata 决定是否 roll / block / split
- 不要风格级统一滚开或统一块状

#### C. Lead gap

seed 7 的 `26 beat gap` 是明显异常。

要求:

- 查 lead repeatGroup replay / section boundary / gap fill 的交互
- POP 可以填 gap,但不能把 MG phrase 逻辑打断后只在下一大段恢复

---

## 7. Cross-Style 技术要求

### 7.1 建立 style-specific final-event profile

建议在 render 层建立每风格 profile,不要散落 if:

```ts
interface FinalEventStyleProfile {
  compDensity: { minRatioToMg?: number; maxRatioToMg?: number };
  bassDensity: { minRatioToMg?: number; maxRatioToMg?: number };
  leadCoverage: { minRatioToMgPhrase?: number; maxRatioToMgPhrase?: number };
  leadRegisterToleranceSemitones: number;
  textureSwitching: 'section' | 'phrase' | 'bar-with-bridge';
  onsetFormPolicy: 'case-specific' | 'block-heavy' | 'roll-heavy';
}
```

不一定照这个接口实现,但必须有等价的集中策略。不要把风格修正散写在 renderer 各处。

### 7.2 Texture case 必须声明 final-form

每个 comp texture case 至少要知道:

- sparse / dense
- block-heavy / roll-heavy / single-line
- 是否允许 bar-level switching
- 是否需要 bridge
- 是否需要 carry tail
- 是否能在 outro 单独承担和声

这会避免 ACG 之前那种“模块都接了,但 final form 不像”的问题。

### 7.3 后处理不能无差别改所有风格

重点检查:

- `fillLeadBarGaps`
- legato / sustain
- groove pocket
- humanize
- chord roll
- section energy scaling
- outro thinning
- bass simplification

要求:

- 每个后处理都要知道 style + texture case + section role
- 不能用 POP 的补空逻辑填 RNB/LOFI
- 不能用 ACG 的 chord-roll 逻辑滚掉 RNB/JAZZ 的 block comp
- 不能用 section energy 直接砍掉 LOFI/JAZZ/RNB 的 bass 支撑

### 7.4 不要靠 pad/drum 掩盖 bass/comp/lead 不像

pad/drum 是 SIM 产品层,可以存在,但不能用它们填补 MG 中 bass/comp/lead 应该承担的听感角色。

审计只看 bass/comp/lead,所以修复也必须落在这三轨。

---

## 8. 验收命令

每次修改后必须跑:

```bash
npx tsx scripts/audit-non-acg-per-section-feel.ts
npx tsx scripts/audit-mg-bass-comp-lead-fidelity.ts --write-report-only
npx tsx scripts/audit-mg-current-parity.ts --full --write-report-only
npm run lint
```

如果改动影响测试,再跑:

```bash
npm test -- --run
```

---

## 9. 验收标准

### 9.1 硬标准

- `mg-current-parity`:仍然 30/30 pass
- `npm run lint`:pass
- 不破坏 ACG 已修复的 final form
- 不删除 SIM 的 pad/drum/section 成曲能力

### 9.2 T1 风格标准

#### LOFI

- texture flags 清零
- bass 过稀 flags 大幅下降
- comp 不出现裸切造成的洞
- lead register 不再系统性低于 MG

#### RNB

- bass 过稀 flags 大幅下降
- lead 太满 flags 大幅下降
- seed 42 high-density comp/bass 明显接近 MG
- block/roll 形态按 texture case,不能统一处理

#### JAZZ

- bass 主体 section 不再低于 MG 50%
- seed 99 comp 过密下降
- lead gap 不再明显超过 MG phrase max

#### POP

- outro 不再 comp=0 且 bass 翻倍
- seed 7 lead gap 收敛
- comp onset form 按 texture case 对齐

### 9.3 报告标准

修改后更新:

- `docs/generated/non_acg_per_section_feel_report.md`
- `docs/generated/mg_bass_comp_lead_fidelity_report.md`
- `docs/generated/mg_current_parity_audit_report.md`

并在提交说明里列:

- 每个 style 的 section flags 改善数量
- texture flags 是否清零
- 哪些 seed 仍保留 warning,为什么可接受或需后续任务

---

## 10. 不要做的事

- 不要为了通过审计放宽阈值。
- 不要把所有风格都改成 ACG chord-roll。
- 不要把所有风格都改成逐 bar texture random。
- 不要用 pad/drum 代替 bass/comp/lead 修复。
- 不要重写 arranger 让非 ACG 变成 MG 16-bar loop。
- 不要全量搬运 MG 生产引擎。
- 不要只看 aggregate fidelity 报告,它太粗,抓不到逐段听感问题。

---

## 11. 核心判断

当前问题的本质:

> MG 的中间生成逻辑已经大体接上,但 Simulator 主链在 render / section / energy / post-process 层把最终 bass、comp、lead 事件形态改掉了。

所以本轮修复的正确方向不是“再搬一遍 MG”,而是:

> 在 Simulator render 层建立每风格 final-event contract,让每个 style 的 bass/comp/lead 在完整成曲结构中仍保持 MG-like 的听感形态。

