# newEngine Pad 使用与 Pad-Comp 分工执行方案

日期: 2026-06-06  
目标: 在 `comp` 继续延续 GM/现有手感的前提下,重构 `pad` 的使用方式,解决 pad 与伴奏织体互相打架的问题  
结论: **pad 不是第二条和弦轨,pad 是 sustain / air / width / slow voice-leading layer**

---

## 1. 背景判断

当前 newEngine 已经多出独立 `pad` 轨。代码现状大致是:

```text
renderCoordinator
  -> renderBass(...)
  -> renderAccompaniment(...)  // comp,GM 乐器,texture/pocket/polyVelocity/CC7 已调过
  -> renderPad(...)            // 独立常驻铺底
  -> renderDrums(...)
  -> renderMelody(...)
```

当前风险:

```text
padRenderer:
  每个 chord span 消费 stableToneMap
  在 [55,79] 长时值铺稳定音

accompanimentRenderer:
  comp 也在中声部做 texture / wide voicing / block / stab / arp

结果:
  pad 和 comp 同时在中频和声层弹完整和弦身份
  两者共享音区、共享 pitch class、共享长时值、共享中频能量
  导致厚、糊、压旋律
```

现代编曲里,`pad` 与 `comp` 的关系不是“两套完整和弦叠加”,而是:

```text
bass = low-frequency harmonic identity
comp = rhythm / transient / chord gesture layer
pad  = sustain / air / width / slow emotional color layer
lead = listener focus
```

因此本方案的核心是:

```text
comp 保持 GM 与当前手感。
pad 改成受约束的 sustain/color layer。
当 pad 与 comp 同时 active 时,双方进入 pad-aware interaction mode。
```

---

## 2. 不可违反的前提

### 2.1 Comp 继续延续 GM

本方案不要求重做 comp 音色系统。

必须保留:

- GM program 分配
- `renderAccompaniment(...)` 的主伴奏职责
- texture schedule
- pocketize lay-back
- polyVelocity
- CC7 均衡
- bass 音区修复
- comp 作为 rhythm/transient/action layer 的身份

不得因为 pad 重构而回退:

- `pocketizeBeat`
- `polyVelocity`
- `ROLE_VOICE.comp`
- 已调好的 comp/pad 音量平衡
- bass/comp/drum 共享 texture schedule 的逻辑

### 2.2 Pad 不再是完整和弦复制层

当 `comp` active 时,`pad` 禁止默认长铺完整 `stableToneMap`。

禁止:

- pad 长铺 root + 3rd + 5th + 7th 全集
- pad 与 comp 在同一八度内大量重复绝对音高
- pad 与 comp 同时弹完整 block chord
- pad 与 comp 同时长时值 sustain
- pad 在 bass active 时低区重复 root/fifth

允许:

- 1 音 drone
- 1-2 音 guide-tone / color-tone
- common-tone sustain
- 慢速 inner voice line
- 轻微 cluster mist
- gated pad,但此时 comp 必须更稀疏

### 2.3 Lead 与 Bass 优先

优先级:

```text
lead > bass > comp > pad
```

含义:

- `lead` 区域内不允许 pad/comp 强行占位。
- `bass` 已经承担 root/slash/pedal 时,pad 不重复低 root。
- `comp` 是主动作层,pad 应该绕开 comp,不是让 comp 给 pad 打工。
- `pad` 是最容易被削减、变暗、变少的层。

---

## 3. 角色分工

### 3.1 Bass

职责:

- root
- slash bass
- pedal
- fifth motion
- low-frequency groove

Bass 已经在低频陈述和声身份时,pad 不需要再陈述 root。

### 3.2 Comp

职责:

- 节奏推进
- 瞬态起音
- 和弦动作
- answer gesture
- stab / chop / roll / arp
- 段落能量

Comp 在 GM 前提下继续是主要伴奏乐手。

当 pad active 时,comp 不一定 mute,但需要 pad-aware:

```text
shorter duration
fewer voices
less pedal
avoid exact pitch overlap with pad
avoid full block when pad is sustaining
```

### 3.3 Pad

职责:

- 空气感
- 宽度
- 慢 attack 的背景
- 段落持续能量
- common tone
- guide tone color
- 内声部慢线条
- 情绪下沉/抬升

Pad 不负责:

- 主节奏
- 主和弦柱式
- 主低频
- 主旋律
- 反复完整复读 comp 的 voicing

---

## 4. Pad 工作模式

新增概念:

```ts
type PadMode =
  | 'silent'
  | 'drone'
  | 'guide-tone'
  | 'inner-line'
  | 'cluster-mist'
  | 'gated-pad'
  | 'full-support';
```

### 4.1 silent

Pad 休息。

适用:

- comp 很 dense
- lead 很 dense
- bass 很活跃
- jazz/combo 语境
- verse 需要留白

### 4.2 drone

Pad 只长铺一个音。

优先选择:

- tonic
- dominant
- 当前 progression 的 common tone
- 上一个 chord 到下一个 chord 的共同音

特点:

- 最安全
- 极少打架
- 适合 LOFI / ambient / modal / intro / breakdown

限制:

- bass active 时不要在低区重复 root。
- 如果 drone 与当前 chord 产生张力,必须低 velocity、慢 attack、宽声场。

### 4.3 guide-tone

Pad 长铺 1-2 个 guide/color tones。

优先:

```text
3rd
7th
9th
6th/13th
sus4
common tone
```

通常省略:

```text
root
5th
```

适用:

- POP
- R&B
- Neo-Soul
- LOFI warm pad
- chorus 背景宽度

### 4.4 inner-line

Pad 写成慢速内部声部线条。

例:

```text
Fmaj7 -> Fm7 -> Em7 -> A7
pad top: E -> Eb -> D -> C#
```

特点:

- 高级感强
- 不靠完整和弦堆叠
- 适合 R&B / Neo-Soul / emotional pop

实现要求:

- 每个 chord span 只改 1-2 个音。
- 尽量半音/全音移动。
- 不跳大音程。
- 与 comp 绝对音高避让。

### 4.5 cluster-mist

Pad 使用轻微二度簇。

例:

```text
Cmaj7:
  D-E
  B-C-D
  D-E-G-A
```

适用:

- LOFI
- ambient
- dark verse
- underwater / muffled section

限制:

- 不能低区密集。
- 不能 velocity 高。
- 不能与 comp 同时 full block。
- cluster 最大 2-3 音。
- 与 lead 重叠时必须退成 1 音或 silent。

### 4.6 gated-pad

Pad 自带门限节奏。

适用:

- modern pop
- EDM-pop
- rhythmic R&B
- chorus lift

关键规则:

```text
gated pad active => comp sparse mode
```

因为 gated pad 已经承担一部分 rhythm layer,comp 不能再 dense。

### 4.7 full-support

Pad 可以 2-3 音承担更多和声身份。

只允许在:

```text
comp inactive
comp floating
breakdown
intro
outro
pad-only section
```

禁止在 comp active dense 段使用 full-support。

---

## 5. Pad-Comp 互动模式

新增概念:

```ts
type PadCompInteractionMode =
  | 'comp-only'
  | 'pad-only'
  | 'pad-under-comp'
  | 'comp-answer-over-pad'
  | 'gated-pad-drives'
  | 'breath-space';
```

### 5.1 comp-only

条件:

- padDensity 低
- style 不适合 pad
- comp texture 已足够 dense

行为:

```text
pad silent
comp 保持现有 GM / texture 行为
```

### 5.2 pad-only

条件:

- breakdown
- intro
- outro
- floating section
- comp 不在 activeRolesBySection

行为:

```text
pad voices <= 3
pad 可承担更多和声身份
comp mute 或极少 answer
```

### 5.3 pad-under-comp

条件:

- pad 和 comp 同时 active
- comp 是主要节奏层

行为:

```text
pad voices <= 1-2
pad omit root
pad usually omit fifth
pad low velocity
pad long sustain
comp 保持动作层,但避免 full long block
```

### 5.4 comp-answer-over-pad

条件:

- pad 已经铺住情绪
- comp 只需要回应/点缀

行为:

```text
pad sustain
comp short upper gesture
comp max voices <= 2-3
comp duration <= 0.25-0.75 beat
comp no long pedal
```

### 5.5 gated-pad-drives

条件:

- padMode = gated-pad

行为:

```text
pad 负责门限律动
comp sparse
drum/bass 负责 groove anchor
```

### 5.6 breath-space

条件:

- lead dense
- section 需要留白
- audit 检测到遮蔽风险

行为:

```text
pad silent or 1 common tone
comp sparse or shell
```

---

## 6. 音高选择规则

### 6.1 当 comp active

Pad 选音:

```text
maxVoices = 1 or 2
omit root if bass exists
usually omit fifth
prefer:
  common tone
  3rd
  7th
  9th
  6th/13th
  sus4
```

Comp 选音:

```text
maxVoices = 2 or 3 when pad is sustaining
prefer:
  shell
  upper fragment
  answer gesture
  short stab
avoid:
  same absolute pitch as pad
  full long block
  low root duplication
```

### 6.2 当 comp inactive

Pad 可以:

```text
maxVoices = 2 or 3
include 3rd + 7th
include one extension
occasionally include fifth
still avoid low root if bass exists
```

### 6.3 Root / fifth policy

Root:

```text
bass active => pad omit root
no bass / pad-only => pad may include root, but not low and not loud
```

Fifth:

```text
usually omit
only include when pad-only/full-support needs harmonic body
```

### 6.4 Common-tone priority

优先找:

```text
current chord ∩ previous chord
current chord ∩ next chord
current chord ∩ local scale color set
```

如果有共同音,优先用共同音作为 pad anchor。

---

## 7. 音区与避让

不要机械地规定:

```text
pad 永远低
comp 永远高
```

正确原则:

```text
pad 找空白频段
comp 找动作窗口
lead 永远优先
bass 低频优先
```

### 7.1 绝对音高避让

当 pad 与 comp 同时 active:

```text
for each pad note:
  avoid same absolute midi as comp notes in same time window
```

允许同 pitch class,但尽量不要同一绝对 MIDI 音高。

### 7.2 推荐音区

当前 `padRenderer` 使用:

```text
PAD_LOW = 55
PAD_HIGH = 79
```

改造后不要固定全域铺满,而是根据 context 选择窗口:

```text
mid-soft:
  55..66
  pad-under-comp 时常用,但避免 bass/root/fifth

high-air:
  67..79
  只在 lead 不占用或 velocity 很低时使用

single-common:
  choose closest common tone outside comp exact pitches

pad-only-wide:
  55..79 内 2-3 音宽排列,但不要密集堆中频
```

### 7.3 Lead reserve 约束

如果存在:

```ts
instrumentation.melodyReservationPlan.reservedRegister
```

pad 需要参考它:

```text
如果 pad note 落入 lead reserved register:
  允许条件:
    velocity 很低
    voices <= 1
    no exact overlap with lead anchor pitch
  否则:
    move octave / choose another tone / drop
```

---

## 8. 时间、时值与包络

### 8.1 Comp 包络

Comp 是动作层:

```text
fast attack
shorter duration
clear rhythm
stab/chop/roll/arp
```

当 pad active:

```text
comp block duration should shrink
comp long pedal should be reduced
comp full chord sustain should be avoided
```

### 8.2 Pad 包络

Pad 是背景层:

```text
slow attack
long sustain
soft velocity
wide pan/reverb
```

在 MIDI 层无法直接表达 attack,所以第一期只用:

```text
lower velocity
long duration
GM pad program
CC7 lower than comp/lead
pan wider than comp
```

后续如果音频引擎支持,再加:

```text
attack parameter
filter cutoff
expression ducking
sidechain
```

---

## 9. 混音与侧链

当前 IR 支持:

```ts
TrackIR.program
TrackIR.programChanges
TrackIR.pedalEvents
```

当前 IR 不支持通用:

```ts
ccEvents
automationEvents
expressionEvents
filterEvents
```

因此不要在第一期强行改 IR。

### 9.1 第一期:编曲层解决

第一期只做:

- pad 减音
- pad 减声部
- pad 避让音区
- comp sparse/short mode
- comp 避免 exact pitch overlap
- 保留现有 CC7 / pan / reverb

### 9.2 第二期:可选自动化

如果后续要做 sidechain,再扩展:

```ts
interface TrackIR {
  ccEvents?: { atTick: Ticks; controller: number; value: number }[];
}
```

可实现:

```text
comp noteOn -> pad CC11/CC7 duck 20%-30%
kick noteOn -> pad low-mid/cutoff duck
lead active -> pad presence duck
```

但这是第二期,不要阻塞第一期 pad-aware 编曲重构。

---

## 10. 经典 Golden Case

使用 Fmaj7 -> Fm7 验证 pad-aware 分工。

前提:

```text
bass 已经踩 F
comp 延续 GM
pad active
style = RNB or POP
```

### 10.1 错误输出

禁止:

```text
Bass:
  F

Pad:
  F-A-C-E long full chord

Comp:
  F-A-C-E block chord with pedal
```

问题:

- root 重复
- fifth 重复
- pad 和 comp 完整和弦堆叠
- 中频糊
- 旋律被压

### 10.2 正确输出示例

Fmaj7:

```text
Bass:
  F

Pad:
  E4-A4
  or E4 only

Comp:
  G4-C5 short stab
  9th + 5th upper fragment
```

Fm7:

```text
Bass:
  F

Pad:
  Eb4-Ab4

Comp:
  Bb4 -> Ab4 -> F4 short answer
  11th -> b3 -> root gesture
```

重点不是固定这些音,而是:

```text
pad 负责持续的情绪变化
comp 负责短促的时间动作
bass 负责和声地基
lead 负责听众焦点
```

---

## 11. 代码落点

### 11.1 新增 policy helper

建议新增:

```text
src/core/generation/newEngine/render/padCompPolicy.ts
```

职责:

```ts
export type PadMode = ...;
export type PadCompInteractionMode = ...;

export interface PadCompContext {
  style: string;
  sectionId: string;
  sectionRole: string;
  padDensity: number;
  compActive: boolean;
  leadReservedLow: number;
  leadReservedHigh: number;
  compTextureCase?: string;
}

export interface PadCompDecision {
  padMode: PadMode;
  interactionMode: PadCompInteractionMode;
  padMaxVoices: number;
  compMaxVoices?: number;
  compDurationScale?: number;
  compAllowPedal: boolean;
  padOmitRoot: boolean;
  padOmitFifth: boolean;
  avoidExactPitchOverlap: boolean;
}
```

### 11.2 修改 padRenderer

目标文件:

```text
src/core/generation/newEngine/render/padRenderer.ts
```

需要改:

- 不再默认消费完整 `stableToneMap`。
- 根据 `PadCompDecision` 选择 `PadMode`。
- 当 comp active:
  - `padMaxVoices <= 2`
  - omit root
  - usually omit fifth
  - prefer common/guide/color tone
- 当 comp inactive:
  - `padMaxVoices <= 3`
  - 可进入 full-support
- 输出仍为 `TrackIR role='pad'`。

### 11.3 修改 accompanimentRenderer

目标文件:

```text
src/core/generation/newEngine/render/accompanimentRenderer.ts
```

需要新增 context:

```ts
padCompDecision?: PadCompDecision;
padOccupiedPitchesBySpan?: Record<string, number[]>;
```

当 pad active:

- comp block hit 缩短 duration。
- comp full voicing 限制到 2-3 音。
- comp 避免与 pad 同绝对 pitch。
- comp 长 pedal/长 sustain 降低。
- comp 保留 GM、texture、pocketize、polyVelocity。

注意:

```text
不要为了 pad 改坏 comp 的 GM 手感。
只在 pad active 的 span 做 pad-aware thinning。
```

### 11.4 修改 renderCoordinator

目标文件:

```text
src/core/generation/newEngine/render/renderCoordinator.ts
```

职责:

- 根据 section、style、activeRolesBySection、padDensity、textureSchedule 计算 `PadCompDecision`。
- 先得到 pad decision。
- 将 decision 传给 `renderPad` 和 `renderAccompaniment`。
- 保持 `comp` / `pad` 都是独立 track。
- 不回到旧的 XOR:不是 comp 和 pad 二选一,而是 interaction mode。

推荐顺序:

```text
buildTextureSchedule
buildPadCompDecisions
renderBass
renderPad with decision
renderComp with decision + pad occupied pitches
renderDrums
renderLead
```

如果实现上需要 comp 知道 pad pitches,可以先 render pad,再 render comp。

### 11.5 暂不修改 IR

第一期不改:

```text
src/core/generation/newEngine/ir/MusicalIR.ts
```

不要为了 sidechain 立刻加入 CC automation。

---

## 12. 测试要求

### 12.1 Golden Fmaj7 -> Fm7

新增测试:

```text
src/core/generation/newEngine/render/padCompInteraction.test.ts
```

断言:

- bass 有 F。
- pad active + comp active 时,pad 每个 span voices <= 2。
- Fmaj7 pad 不输出完整 F-A-C-E。
- Fm7 pad 不输出完整 F-Ab-C-Eb。
- pad 不输出低 root F。
- comp 不与 pad 在同 tick/time window 大量 exact pitch overlap。
- comp hit duration 短于 pad duration。

### 12.2 Pad 不复制 stableToneMap

断言:

```text
comp active span:
  pad.notes per span < stableToneMap[span.id].length
  pad root/fifth omitted when bass active
```

### 12.3 Comp GM 不回退

断言:

- `renderAccompaniment` 仍使用 texture schedule。
- `pocketizeBeat` 行为不变。
- `polyVelocity` 行为不变。
- `musicalIRToMidiEvents` 的 `ROLE_VOICE.comp` 不因本改动被回退。
- `ROLE_VOICE.pad` 不被抬回过厚。

### 12.4 Gated pad -> comp sparse

当 `PadMode='gated-pad'`:

```text
comp note count decreases
comp max voices <= 2 or 3
```

### 12.5 LOFI cluster 安全

当 `PadMode='cluster-mist'`:

```text
cluster voices <= 3
no low-register dense seconds
velocity low
if lead dense => cluster reduces to 1 note or silent
```

### 12.6 No exact overlap threshold

统计同一时间窗口内 pad 与 comp 的 exact MIDI pitch overlap。

目标:

```text
pad-active + comp-active:
  exact overlap count should be 0 or very low
```

允许例外:

- 故意 common tone,但只能低 velocity 且不能 comp full block 同响。

---

## 13. Claude 执行提示词

```text
你要在 newEngine 中实现 Pad-Comp 分工规则。

最高前提:
comp 继续延续 GM 和当前已调好的手感。不要回退 pocketize、polyVelocity、CC7 均衡、bass 音区、texture schedule。
pad 不是第二条和弦轨,而是 sustain / air / width / slow voice-leading layer。

当前问题:
padRenderer 默认长铺 stableToneMap,compRenderer 也在中声部做 texture/wide voicing,导致 pad 与 comp 在同一音区、同一和弦完整度、同一长时值里互相打架。

目标:
当 pad 与 comp 同时 active 时,进入 pad-aware mode:
- pad voices <= 1-2
- pad omit root when bass exists
- pad usually omit fifth
- pad prefer common tone / 3rd / 7th / 9th / 6th / sus color
- comp max voices <= 2-3 when pad sustaining
- comp short duration
- comp no full long block over sustaining pad
- comp avoid exact absolute MIDI pitch overlap with pad
- lead and bass priority over both

需要新增:
- render/padCompPolicy.ts
- PadMode
- PadCompInteractionMode
- PadCompDecision

需要修改:
- render/padRenderer.ts: 不再默认 full stableToneMap;按 PadMode 选 drone/guide-tone/inner-line/cluster/gated/full-support。
- render/accompanimentRenderer.ts: 接收 pad-aware decision;在 pad active span 做 comp thinning/shortening/exact-pitch avoidance,但保留 GM 手感。
- render/renderCoordinator.ts: 为每个 section/span 计算 pad-comp decision,同时传给 pad 和 comp。

第一期不要改 MusicalIR 契约。
Sidechain/CC automation 留第二期。

必须新增测试:
- Fmaj7 -> Fm7 golden case
- pad active 不复制完整 stableToneMap
- comp GM/pocket/polyVelocity/CC7 不回退
- gated pad 触发 comp sparse
- LOFI cluster-mist 不低区密集
- pad/comp exact pitch overlap 极低

冲突时:
lead > bass > comp > pad。
不要牺牲 lead 清晰度。
不要牺牲 comp 的 GM 主伴奏手感。
pad 是最先减声部、变暗、休息的层。
```

---

## 14. 参考资料

这些资料只用于抽取编曲原则,不要照搬成硬编码文字:

- Native Instruments: pads as sustained background texture  
  https://blog.native-instruments.com/pads-in-music/
- Garnish Music Production: pads/strings should fill space without swamping arrangement  
  https://www.garnishmusicproduction.com/pads-and-strings/
- Beat Kitchen: layered sounds should complement,not compete  
  https://beatkitchen.io/guides/electronic-music/07-sound-selection/
- iZotope: piano has wide frequency range and can mask other elements  
  https://www.izotope.com/community/blog/how-to-mix-piano

