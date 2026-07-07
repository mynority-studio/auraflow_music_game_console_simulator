# AuraFlow 器配层 / Aura25 SF2 路径说明

> 目的：给工程师快速定位“器配世界 → 手势表情 → 混音空间 → render 消费 → MIDI 播放 → SF2 音色包 / UI 试听 / 测试审计”的全链路。

## 当前关键结论

- Lead sax 听不见的真实原因：当前 SF2 的 GM67 `Low_Bari_Sax` sample zone 原来只覆盖到 MIDI 60，而生成器会把 GM67 lead 写到 MIDI 60-72；60 以上没有 sample zone 时浏览器 synth 会静音。
- 已修复：两个当前 SF2 文件的 GM67 最高 sample zone 从 `(57, 60)` 扩到 `(57, 72)`。
- 已加测试：`Aura25Palette.test.ts` 会检查 GM67 在两个 SF2 文件里都覆盖到 MIDI 72。

## 当前 SF2 文件

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/public/Aura25_GM128_generaluser_folkguitar_24k_locked.sf2`
  - 运行时实际加载的 Aura25 24k SF2。
  - 当前 GM67 sax 已修到 keyRange `(57,72)`。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/public/Aura25_GM128.sf2`
  - 测试与基准审计用 SF2。
  - 当前 GM67 sax 已修到 keyRange `(57,72)`。

## 音色包 / Program 映射

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/sound/Aura25Palette.ts`
  - Aura25 音色白名单、UI 中文名、各音色采样大小、GM program fallback。
  - 运行时 SF2 URL：`AURA25_SF2_URL`。
  - GM67 = 上低音萨克斯；GM11 = 颤音琴；GM108 = 卡林巴。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/audio/SynthManager.ts`
  - SoundFont 加载入口。
  - `SOUND_FONT_BANKS` 定义 UI 里可切换的音色包。
  - `addSoundBank(buffer, bank.bankManagerId, 0)` 加载当前 SF2。

## 器配世界 / 乐器选择

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/knowledge/instruments.ts`
  - 五种 macro 风格的主动乐器池、权重、乐器家族、现实/运行音域。
  - Jazz lead 当前高概率选择 GM67 sax。
  - `preferredRegisterForRole` 控制 lead/comp/bass/pad 的角色音区。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/knowledge/gmOrchestrationChains.ts`
  - 链式器配选择：根据 comp/lead/bass 的兼容关系生成完整乐队。
  - Jazz / modal / ACG 等风格链路在这里收口。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/instrumental/instrumentalPlanner.ts`
  - 器配计划总装配：roleProgram、分段 programChanges、mixByRoleSection、gestureExpressionByRole。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/instrumental/InstrumentationPlan.ts`
  - 器配层数据结构合同。
  - 包括 role program、mix、gesture、continuity、articulation、tailPolicy 等字段。

## 手势表情层

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/instrumental/gestureExpression.ts`
  - 根据最终 program 下发乐器演奏手势。
  - Sax → `sax-breath-legato`。
  - Mallet → `mallet-strike`，不发 pitch bend / CC1 / portamento。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/instrumental/saxExpression.ts`
  - Sax 气口与连奏模型。
  - 当前策略：CC11/CC2 气息包络、短 overlap、无 CC1 vibrato、无默认 pitch bend / portamento。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/instrumental/gestureEvidence.ts`
  - 手势设计依据来源 ID。
  - 测试会要求非 none 手势必须带 evidenceRefs。

## 混音 / 空间层

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/knowledge/gmMixProfile.ts`
  - 器配层 mix 真源：CC7 volume、CC10 pan、CC91 reverb、CC93 chorus、CC95 delay。
  - GM67 sax 当前 chorus=0，避免 detune。
  - GM11/12/107/108 mallet 当前 chorus=0，避免“微跑音感”。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/render/renderMixBalance.ts`
  - render 后能量平衡，只改 TrackMix 音量。
  - 当前有 `JAZZ_SAX_POLICY`：jazz sax lead 保持前景，comp 收低，避免 sax 被钢琴/电钢压住。

## Render 消费路径

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/render/renderCoordinator.ts`
  - render 总协调。
  - 消费 `gestureExpressionByRole`，把器配层手势投影成 NoteIR / CC / pitchBendEvents。
  - 最终会按当前 program 做音域 fit。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/render/windBreath.ts`
  - 旧 wind breath 兼容入口。
  - 当前真实路径已归到 `instrumental/gestureExpression.ts`。

## MIDI / 播放链路

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/audio/musicalIrToMidi.ts`
  - MusicalIR → MidiEvent 唯一正式转换。
  - role 到 MIDI channel：lead=1、comp=2、bass=3、pad=4、drum=9。
  - 输出 programChange、mix CC、gesture CC、noteOn/noteOff。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/audio/MidiScheduler.ts`
  - MIDI 事件排序与调度。
  - 同 tick 顺序：noteOff → CC/programChange/pitchBend → noteOn → visual。
  - 负责把事件发给 SpessaSynth。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/audio/AudioEngine.ts`
  - App 播放入口。
  - `playMusicGeneration` 把 MusicGenerationResult 的 IR 装进 scheduler 播放。
  - UI 试听也通过这里的 `programChange` / `controllerChange` / `playNote`。

## UI 相关

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/components/SoundFontSelector.tsx`
  - 主面板音色包切换与试听列表。
  - 试听列表显示中文名与 sample size。
  - Mallet 试听当前 CC93 chorus=0。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/components/QnGenerationMonitorView.tsx`
  - 生成监视 UI。
  - 展示乐器、音色切换、参与乐手、器配信息。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/musicGeneration/qnUiProjection.ts`
  - 生成结果投影到 UI snapshot。
  - 把 role/program/gesture 转成 UI 可读结构。

## 测试 / 审计

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/sound/Aura25Palette.test.ts`
  - Aura25 SF2/preset/program/range 主审计。
  - 已新增：检查两个 SF2 的 GM67 sax sample keyRange 必须覆盖到 MIDI 72。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/instrumental/saxExpression.test.ts`
  - Sax 气口、连奏、无 CC1、无默认 pitch bend / portamento。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/instrumental/gestureExpression.test.ts`
  - 器配手势下发与 render 消费测试。
  - Mallet 无跑音 MIDI 表情测试也在这里。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/instrumental/gmMixProfile.test.ts`
  - 各风格/角色/program 的 mix CC 合法性与护栏。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/render/renderMixBalance.test.ts`
  - render 后 lead/comp 有效响度审计。
  - 已新增：Jazz sax lead 不被 comp 淹没。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/knowledge/instrumentPairing.test.ts`
  - 乐器家族、兼容性、音域 fit 审计。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/knowledge/gmOrchestrationChains.test.ts`
  - 链式器配选择审计。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/musicGeneration/MusicGenerationService.test.ts`
  - Q+N 生成主链路审计。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/render/windBreath.test.ts`
  - wind/sax 手势消费兼容测试。

## SF2 工具

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/tools/soundfont/subset_sf2.py`
  - 从大 SF2 裁剪 preset/sample，并支持 24k 重采样。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/tools/soundfont/bake_sample_roots.py`
  - 把 overridingRootKey/fineTune 烘进 sample header，避免嵌入式/简化 SF2 播放器跑调。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/tools/soundfont/dampen_guitar_sends.py`
  - 限制吉他 preset/zone 的 reverb/chorus sends。

- `/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/tools/soundfont/merge_sf2.py`
  - 合并/替换 SF2 preset 工具。

## 常用验证命令

```bash
pnpm vitest run src/core/sound/Aura25Palette.test.ts src/core/generation/newEngine/instrumental/saxExpression.test.ts src/core/generation/newEngine/render/renderMixBalance.test.ts --reporter=dot
pnpm vitest run src/core/generation/newEngine/instrumental/gestureExpression.test.ts src/core/generation/newEngine/instrumental/gmMixProfile.test.ts src/core/generation/musicGeneration/MusicGenerationService.test.ts --reporter=dot
pnpm lint
```

