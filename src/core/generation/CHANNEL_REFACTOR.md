# Channel 重构 — 删 pianoLH/RH,按 BandRole 分通道(2026-05-21)

> **状态**:设计 v0.1,已决策。开始实施。
> 完成后本文件挪到 `.claude/rules/` 作为长期 channel 架构真理之源。

## §0 设计哲学

钢琴是一个**乐器**,不是"两只手"。MIDI channel 应按"乐手槽位(BandRole)"分,
不按"演奏物理(LH/RH)"分。

- 当前(混淆层次):ch4=pianoRH / ch5=pianoLH(基于"演奏物理")
- 新(正确层次):ch1=mainInst / ch2=accomp / ch3=bass / ch4=atmosphere(基于"乐手槽位")
- 每 channel 的 **GM program** 由 `musician.instrumentFamily` 决定 — 钢琴/萨克斯/弦乐
  自然区分音色,不再被"LH/RH 都钢琴"概念绑定

## §1 决策(2026-05-21)

- **Q1 字段命名**:**A 保留** `melody/accompaniment/bass/drums/atmosphere` —— 最小化跨 src 重命名。
  只删 `pianoLH/pianoRH`。
- **Q2 Channel 映射**:
  - `ch1 = mainInst`(原 melody 通道)
  - `ch2 = accomp`(原 pianoRH+pianoLH 合并)
  - `ch3 = bass`(原 electricBass 通用化)
  - `ch4 = atmosphere`
  - `ch9 = drums`(GM Drum 硬路由,不可变)
  - `ch5 / ch6 / ch7` 预留 Vocal / 备用
- **Q3 钢琴 Accomp + Bass 槽位空**:**A 钢琴自带低音** ——
  mg.bass 合并到 accompaniment,一起去 accomp channel。
  bass channel 静默(无 BassRole 乐手)。

## §2 改动范围

### §2.1 类型层(IR)

`ArrangedTrack`(`types.ts` / `ir/index.ts`):
- **删**:`pianoLH`, `pianoRH`
- **加**:`accomp` (合并原 pianoRH+pianoLH 的整体)
- **重命名**:`electricBass` → `bass`(通用化,不再局限"电"贝斯)
- **保留**:`melody`, `atmosphere`, `drums`, `vocal`, `counterMelody`, `secondaryMelody`
- `gmProgramOverrides` 字段:
  - **删** `pianoLH`/`pianoRH`/`electricBass`
  - **加** `accomp`/`bass`
  - **保留** `melody`/`drums`/`atmosphere`

`GeneratedTrack` 字段不变(Q1 A 决策)。

### §2.2 转换层

`AbsoluteTransposer.arrange()`:
- **删** `pitch<48` 切 LH/RH 逻辑(L92-101)
- **删** `skipHandSplit` 分支(不再需要)
- **改** 简单透传:`arranged.accomp = applyKeyOffset(track.accompaniment ?? [], keyOffset)`
- **改** `arranged.bass = applyKeyOffset(track.bass ?? [], keyOffset)`(重命名)
- `GeneratedTrack.skipHandSplit` 字段保留(IR 兼容)但**忽略**

### §2.3 渲染层

`MidiConverter.convert()`:
- **删** `CHANNEL_PIANO_RH`(4) / `CHANNEL_PIANO_LH`(5)
- **加** `CHANNEL_MAIN_INST = 0`(MIDI ch1)/ `CHANNEL_ACCOMP = 1` / `CHANNEL_BASS = 2` /
  `CHANNEL_ATMOSPHERE = 3` / `CHANNEL_DRUMS = 9`(不变)
- **删** `MIX_PIANO_RH` / `MIX_PIANO_LH`
- **加** `MIX_MAIN_INST`(继承 MIX_MELODY)/ `MIX_ACCOMP`(继承 MIX_PIANO_RH 主导)/ `MIX_BASS`(继承 MIX_ELECTRIC_BASS volume=115)
- **删** `GM_PROGRAM_PIANO_RH` / `GM_PROGRAM_PIANO_LH` /  `GM_PROGRAM_ELECTRIC_BASS`
- **加** `GM_PROGRAM_MAIN_INST = 0`(默认钢琴)/ `GM_PROGRAM_ACCOMP = 0`(默认钢琴)/ `GM_PROGRAM_BASS = 34`(默认电贝斯)
- **改** `renderTrack` 6 次调用(melody/accomp/bass/atmosphere/drums)
- **改** Sidechain ducking:删 PianoRH/LH 双 ducking,统一 `accomp` channel 一份 ducking
- **改** `gmProgramOverrides` 字段读取(`ov.pianoRH/LH` → `ov.accomp`,`ov.electricBass` → `ov.bass`)

### §2.4 播放层

`PlaybackEngine.loadSong()`:
- `partChannels` 注册:
  - melody → `CHANNEL_MAIN_INST`
  - chord → `CHANNEL_ACCOMP`(原 pianoRH)
  - bass → `CHANNEL_BASS`(原 pianoLH or electricBass)
- `DEFAULT_CHANNEL_MAP` 更新

### §2.5 引擎适配

`Af2EngineFacade`:
- **简化**:删 `useElectricBass` 双分支(bass 总走 bass channel,GM 由 musician 定)
- **删** `skipHandSplit: false`(字段忽略)
- `gmProgramOverrides`:`pianoLH/pianoRH/electricBass` → `accomp/bass`

`MgEngineFacade`:
- **删** `skipHandSplit: true`(字段忽略,行为统一走 accomp channel)
- 输出 `melody=mg.melody` + `accompaniment=mg.chord+mg.bass`(合并,钢琴一手包办,符合 mg-standalone)
- `gmProgramOverrides`:`pianoLH/pianoRH` → `accomp`

`AF Conductor / Realizer`:
- **无须改动** — 已经按 BandRole 输出 `melody / accompaniment / bass / drums / atmosphere`

### §2.6 UI / scripts

- `VolumeController.tsx`:`pianoLH/RH` 音量 slider → `accomp` 单 slider
- `LedMatrix.tsx`:可视化按 channel 重新映射
- `scripts/test-phase4.ts` / `scripts/golden-seed.ts` / `scripts/smoke-band-engine.ts`:
  打印字段适配

## §3 验收

1. ✅ `npm run lint` 0 errors
2. ✅ AF mode 听感:接受 mix 变化(LH/RH 独立 mix 没了,合并到 accomp 单 channel)
3. ✅ AF2 mode 听感:Bass 槽位空时钢琴自带低音 / Bass 槽位有 frank_bass 时走 bass channel
4. ✅ MG mode 听感:跟 mg-standalone 仍一致(skipHandSplit 删了但行为等价 — 全部进 accomp)
5. ⚠️ **AF golden seed re-baseline**:event count + sha 都会变(channel byte 不同 + 注释顺序变 + ducking events 减少)
   - 新 baseline 列入下次 commit message

## §4 实施顺序

1. **Stage 1 IR**:改 `types.ts` / `ir/index.ts` ArrangedTrack 字段
2. **Stage 2 转换**:改 `AbsoluteTransposer`
3. **Stage 3 渲染**:改 `MidiConverter`
4. **Stage 4 播放**:改 `PlaybackEngine`
5. **Stage 5 引擎适配**:`Af2EngineFacade` + `MgEngineFacade`
6. **Stage 6 UI/scripts**:适配字段引用
7. **Stage 7 验收**:lint + golden-seed re-baseline + 听感

每 Stage 后 `npm run lint` 必过。
