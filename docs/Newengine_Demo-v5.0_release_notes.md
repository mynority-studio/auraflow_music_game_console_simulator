# Newengine Demo v5.0 工程交接说明

发布日期：2026-07-21

对比基线：`Newengine_Demo-v4.45`

交付标签：`Newengine_Demo-v5.0`

用途：冻结当前 TypeScript 参考实现，供嵌入式工程师拆分、验证并翻译为 C。

## 4.45 → 5.0 升级清单

1. **输出架构切换到 Dream 5504 实机。** 移除浏览器 Copych/WebAudio 合成与设备后级依赖，正式播放、实时音符、上传 MIDI 和音色试听统一走 Web MIDI → Dream 5504 EK。
2. **建立五角色固定通道契约。** Lead/Comp/Bass/Pad/Drum 默认使用 MIDI 1/2/3/4/10 通道；支持单端口和五路上游端口映射，但到板端后始终保持角色通道隔离，避免 PC/CC 串轨。
3. **输出改为 Firm5504 raw-default 基线。** 每个生成通道先发 `CC121=0` 恢复固件默认，再发送音色地址和音符；旋律音色使用 `CC0 + Program Change`，鼓组使用通道 10 的 Program Change。
4. **取消软件音色校平和总线染色。** 正常歌曲不再下发 `CC7/10/91/93`，不下发 Pitch Bend、Master Volume NRPN、Master EQ 或软件 Master FX；保留的 CC 只属于通道初始化、安全停音和经音色地址白名单批准的演奏行为。
5. **把钢琴表情收紧到具体音色地址。** 当前歌曲链只允许 Bank 0 的 Acoustic Piano `PC 0/1/3` 使用谱面生成的 `CC11` 与 `CC64`；Electric Piano、Pad、吹管、Bass、Drum 等不因 GM 类别相似而继承钢琴踏板或表情 CC。
6. **增加 MIDI 安全与静音边界。** 未连接/未授权时明确静音；停播、切换和 Panic 发送必要的 All Sound Off、All Notes Off、Reset Controllers、踏板释放及弯音归中，避免粘音和跨曲状态污染。
7. **忠实接入 GMBK5X128 音色表。** 新增官方主音色、Variation Bank 和 Drum Kit 的 Bank/Program 目录、地址解析、试听目录和回归测试，器配层不再用名称猜 Program，也不再把相同 Program 的不同 Bank 当成同一音色。
8. **新增 Dream 音色演奏分类。** 按 family、subfamily、voice mode、expression family、可用角色和 CC 证据状态分类；“硬件文档支持”与“该具体 GMBK 音色可自动使用”被拆成两层，未实机确认的控制器保持 audition-only 或 blocked。
9. **重做器配约束。** 乐器选择按角色、音色家族、音域、织体和组合关系约束；修复 Electric Piano/FM EP 等音色错配、角色借用和跨 Bank 继承行为，器配只选择固化音色，不修改音色内部参数。
10. **引入 Arrangement Archetype 契约。** Form、段落角色、foundation owner、边界、开场、终止、和声、Bass/Comp/Lead pattern 和鼓组策略由 Arranger 明确拥有，Renderer 不再临时猜编配决定。
11. **新增 Groove Score 层。** 把全局时钟、角色节奏、重音、力度、互锁、段落转换和 performance residual 分开建模；统一 Bass、Comp、Lead、Pad、Drum 的节奏所有权，减少入口突变和五轨抢拍。
12. **升级鼓组生成。** 新增鼓件能力表、performance knowledge、fill vocabulary、逐段 performance planner/realizer、力度与微时值人性化审计；保持结构重拍，同时降低机械重复、密度突跳和不合理同击。
13. **升级 ACG 原声钢琴链。** 增加完整 Piano ScorePlan、段落/乐句/左右手职责、Comp sentence、Bass motion、踏板窗口、Lead presence、回归段和 modal counterpoint；最终渲染以 score ownership 为准，避免重复塑形。
14. **新增可生成的 Jazz 5/4 产品链。** 建立 5/4、3+2 全局时钟，Bass/Comp/Drum/Lead 分层 KB，逐小节 Ensemble Score、Harmony/Lead ScoreCompiler、timing link、纯 Score projector 以及 Gate G/Gate L/IR 恒等门禁；普通 4/4 风格不会误入该路径。
15. **强化和声与旋律实现。** 扩展 chord-scale、progression、secondary dominant、tonicization、style grammar、rhythm-shape matcher、slot/token scheduler、和声音高实现、Lead 连续性和受保护休止。
16. **强化用户 Motif 主链。** 改进 Motif Weaver → Override 桥、slot planner、progression selector、lead sanitizer、repeat-group replay、用户 motif brick 绑定和 Lead Takeover 节拍器，减少吞音、重复组漂移和时长越界。
17. **修正四风格的五轨组织。** Pop/Jazz/Lofi/RnB 的 form、开场、角色进入、密度、Bass/Comp/Pad 互动、Lead 空间和结束处理统一受 Arranger/Groove/Instrumentation 契约约束；混音审计保留为分析，不再转成 CC7 音色校平。
18. **升级监控和试听工具。** Pipeline Monitor、MIDI Output Sandbox、SoundFont Selector 与钢琴卷帘窗补充板端路由、通道、音色地址、事件、审计和静音状态显示；新增 GM128 MIDI sweep 与鼓机试听面板。
19. **增加工程审计与导出。** 新增 Dream 音色分类/器配 XLSX、mix/drum audit、Acoustic palette 专项门禁、Jazz 5/4 MIDI 导出以及离线参考复刻的 MIDI/音频/对照脚本。
20. **扩大自动化回归覆盖。** 新增 Dream 全通道/CC/音色地址、五轨 POP、问题种子、ACG、Jazz 5/4、鼓组、Groove、Score ownership、Motif、Harmony 和最终 IR 等回归用例，并把普通测试、审计测试和产物导出测试拆成独立配置。
21. **清理旧实现和迁移资料。** 删除 Copych 合成后端、浏览器 Master 后级及已完成的阶段性指令文档；引入 `components/samvs` 作为当前 Dream 侧参考子模块，保留 SoundFont/音色包审计资料用于对照，不作为量产播放链。

## C 移植边界

- **必须移植的生产逻辑：** `src/core/generation/newEngine/` 中的 KB、Harmony、Arranger、Instrumentation、Score/Renderer；`src/core/audio/musicalIrToMidi.ts` 的 MIDI 物化；`src/core/sound/GMBK5X128*` 的音色地址数据和约束。
- **必须保持的板端协议：** 角色通道 1/2/3/4/10、CC121 初始化、CC0/PC 顺序、鼓通道规则、音色地址级 CC 白名单，以及停播/Panic 安全消息。
- **不应移植为量产算法：** React UI、Web MIDI 设备枚举、`videoReplica/` 固定参考谱、审计报告生成器、试听 WAV/MP3、浏览器专用调试面板。
- **不可重新引入：** 按音色写 CC7 校平、四风格统一 CC91/93、软件总线 EQ/FX、基于音色名称的 Program 猜测、Renderer 内临时补编配。

## 验证命令

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm run test:acoustic-palette
pnpm run audit:mix
```

审计/导出命令可能写入 `docs/generated/` 或 `deliverables/`；它们用于复现和人工验收，不是嵌入式运行时依赖。
