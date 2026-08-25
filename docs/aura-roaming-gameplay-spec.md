# 「光律漫游 · Aura Key」玩法规格（行为真源）

- **版本**:v1.0(2026-08-22 用户裁定)
- **实现**:本仓 `src/features/auraRoaming/`(weslay-0810,`91cdd1dc..9ab5770b` 12 个提交迭代收敛)
- **角色**:本文档是玩法行为的**真源**;auraflow_engine 侧复刻以此为验收基准,对应计划见
  engine 仓 `docs/aura_key_gameplay_port_plan_20260822.md`。
- **规格数值均为用户实测调优后的裁定值**;改动任何数值须先改本文档。

## 一、玩法定义

两个模式,挂在产品播放态之上:

1. **氛围漫游** = 现有音乐生成播放,零新增设置(配置走 Q+H);
2. **Aura Key**(可开关):生成曲照常播放(**lead 不静音**),15 键变为"亮哪按哪"引导层。
   按键发接管音色(与 Q+T 用户接管沙盒同链路、同映射、同音色选择),未亮键自由弹奏。

实现要点:复用 `LeadTakeoverController({ nativeLeadMuteEnabled: false })` 即天然去掉
lead-mute;不跑 `reconcileNativeLeadMute`;不传 nativeLeadNoteTargets/Range。

## 二、提示音选择(生成期,纯函数,seed 确定)

### 2.1 lead 重音打分(`accent/leadAccents.ts`)

对最终 lead NoteIR 只读逐音打分(分数仅用于排序):

| 维度 | 加分 |
|---|---|
| 乐句头(曲首或休止 ≥1 拍后) | +3(半拍休止 +1.2) |
| 小节正拍 | +2.5;偶数拍小节中点 +1.5;其他整数拍 +0.8;八分位 +0.3 |
| 时值 | ≥2 拍 +3;≥1 拍 +2;≥0.5 拍 +0.75 |
| 局部力度峰 | +1.2 |
| 局部音高峰(轮廓顶点) | +0.8 |

### 2.2 节奏型抽取(`cue/cuePlanner.ts`,防节拍器)

- 逐小节从权重库抽槽位:rest 0.4 / whole 1.5 / half 3 / halfOff 1.2 /
  quarterPair 3.5 / quarterTriple 3 / quarterFull 1.5 / withEighth 1.6;
- 8 小节正弦能量波调权(各型 energyBias 不同,verse 疏 chorus 密的近似);
- 槽位 → 候选对齐容差 **±0.45 拍**(真实 lead 有休止,容差过窄密度骤降);
- 硬规则:相邻提示 ≥0.45 拍;八分间隔占比 ≤15%;**连续相同间隔 ≤3**;
- 密度契约:密集候选下 ≥1.3 提示/小节(测试锁定)。

### 2.3 和声填充(`cue/harmonicFill.ts`,ACG 等稀疏风格密度救星)

接管布局是逐和弦重建的安全音图(cell 自带 classRole),lead 空窗里补亮依然和谐:

- 与既有提示间距 ≥1 拍的空整数拍上:强拍(小节头/中点)p=0.65 亮 **chord 结构音**,
  弱拍 p=0.3 亮 **scale/approach 色彩音**;
- 键位取安全音图中离中心最近的前 3 个 seeded 抽 1;时值:强拍 1 拍 / 弱拍 0.5 拍;
- 填充提示的判定/贴谱/延音/计分与 lead 提示完全同权(`source:'harmonic'` 标记)。

### 2.4 键位绑定(`cue/padLookup.ts`)

lead 音高 → 精确 midi 匹配 → 同 pitch-class 八度折叠 → 无则**跳过该提示**(引导必须诚实);
round-robin 重复 cell 取离中心键(索引 7)最近。

## 三、亮灯(呼吸包络,per-cue 独立排程)

- 该键 **9 颗灯同步**:余弦缓升 **620ms** → 峰值落在音符发声前 **120ms** →
  保持 **480ms** → 渐灭 **260ms**;主色相 272(紫);
- **每个提示只按自己的峰值时刻倒推起亮点**(统一上升时长),窗口重叠即多键同时呼吸,
  与前一个灯的状态完全无关(禁止"等前灯熄灭才亮");
- 包络参数随事件带入、峰值时刻绝对时基(performance.now 系),渲染端每帧算亮度 →
  事件派发抖动不影响峰值精度;
- Aura Key 期间**关闭整轨氛围光**(每音符粒子雨)与按键流体拖尾;按键反馈改清脆
  3×3 暗块(不扩散,快衰减);命中后该灯快收(140ms)。

## 四、判定与发声(以音符正点为 0;含可调输入延迟补偿,默认 0)

| 判定 | 窗口 | 乐器音 | 打击反馈 | 计分/音轨 |
|---|---|---|---|---|
| Perfect | ±80ms | 贴谱发声 | 重拍手 GM39 v112 | 律光+2,combo+1 |
| 普通 | ±220ms | 贴谱发声 | 轻拍手 GM39 v88 | 律光+1,combo+1 |
| 按偏 | ±380ms | **不发声** | 鼓边边击 GM37 v80(即刻) | combo 清零,**断**律光音轨 |
| 漏过 | 超时未按 | — | — | combo 清零,**不断**音轨(A→C 语义) |
| 自由弹奏 | 窗外/未亮键 | 即按即响 | 无 | 律光音轨材料 |

- **贴谱发声**:早按 → noteOn 推迟到正点(提前 30ms 交给接管量化器 groove/16 分落格);
  正点后按 → 立即。打击音与音符 transient 同刻。**判定仍按真实按压时刻打分**。
- **时值延音**(仅亮灯键):命中音按 lead 音符时值挂住 +150ms legato 尾(封顶 5s);
  松手推迟 note-off 到时值结束;同键再按先收上一音(含作废未发声的挂起 noteOn);
  关闭 Aura Key 清全部定时器。
- **对比度**:Aura Key 期间接管通道 CC7=127(退出恢复默认 100),屏幕键默认力度 112。
  ⚠️ 教训:该 CC 必须走"**辅助实时通道豁免**"——生成曲五通道的 Firm5504 默认输出
  合同过滤器会丢弃裸 CC7(仅放行 lofi-mix 标签);scheduler role 为 null 的辅助通道
  (ch15→wire ch16)豁免该合同(`Dream5504MidiOutput.sendSchedulerChannelMessage`)。

## 五、反馈与计分

- **命中视觉**(三层叠加,2026-08-24 收敛裁定):整键爆闪(峰值 Perfect 2.8 / 普通 2.2,
  金 48 / 紫 272,340ms 二次方衰减,max 混合压过引导灯)+ 小涟漪波纹(r 0.5→5 约两键宽
  即止,speed 0.34,厚 1.4)+ 粒子爆(能量 3.6/2.8,spread 2.6);
- **🌟 HUD**(屏幕右上):成功晃动一次;**combo≥5 进入充能**(高频颤抖 + 随机光斑
  渐暗喷射);右侧 ×N 律光计数;
- **律光音轨**:两次成功命中之间 ≥1 次未亮键按压(相距 ≤8 拍)→ 异色🌟(青,
  hue-rotate)晃动 ×1;被无视(漏过)的提示可跨越,按偏打断,超 8 拍锚点过期。

## 六、输入与隔离

- 屏幕/实体 15 键(takeoverInputBus)+ MIDI 位置键(C3..C5 白键 → 15 键位,
  与 Q+T 共享设备偏好 `TakeoverMidiInputStore` 与独占权语义,owner `'auraKey'`);
- Aura Key 打开时 pad 输入不再喂给屏幕内 app(与 Q+T 同款隔离,
  `appActiveKeys = takeoverOpen || auraKeyOn ? EMPTY : activeKeys`,教义测试锁定);
- 重播/回跳(tick 大幅倒退):未来提示重新武装,曲首整局清零;换歌(result 引用变化)
  全量重建计划。

## 七、测试资产(复刻时导出为 golden 向量)

`leadAccents.test.ts` / `cuePlanner.test.ts`(密度下限/防节拍器/八分预算/确定性)/
`harmonicFill.test.ts`(强弱拍音类/间距/确定性)/ `cueGlow.test.ts`(包络形状)/
`judgement.test.ts`(窗口边界/计分)/ `luxTrail.test.ts`(A→B、A→C、按偏打断、超时)/
`padLookup.test.ts` / `auraKeyDiag.test.ts`(发声链成对出声)。
