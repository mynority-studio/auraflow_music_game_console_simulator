# Q+N Final Lead Sanitizer Directive

Date: 2026-06-23

## 目的

修复 Q+R motif 走 A 接入 Q+N full arrangement 后,在 render 末端重新出现的同 pitch overlap / 同 tick 重触发问题。

这不是 motif capture 的吞音问题,而是 Q+N renderCoordinator 的后处理顺序问题:上游已经清洗过的 lead,经过 `fillLeadBarGaps` / `applyRepeatGroupReplay` / `applySwing` / `humanizeTiming` 等末端处理后,仍可能重新产生同 pitch overlap。MIDI 导出时旧 noteOff 会提前关掉后一个同 pitch note,听起来像用户 motif 突然断音或消失。

本 directive 只修复 render 层最终安全闸。不要改 motif grammar、motif brick 分类、RoadMap、和声模板、Q+R weaver 的 quote/vary 策略。

## 已知复现

Q+R preview 链路当前没有复现系统性 overlap,但 Q+R -> Q+N full arrangement 走 A 可复现:

```text
style=pop
seed=10
variant=1
route=generateMotifWeave -> buildMotifSongOverride -> generateSongFromMotif

lead same-pitch overlap:
pitch 79
note A: startTick=30480 durationTicks=360 endTick=30840
note B: startTick=30720 durationTicks=360
overlap=120 ticks
```

这两个 note 在 MIDI 层是同 pitch 重叠。若事件排序或播放器实现中 noteOff 关闭同 pitch 当前发声,后一个 note 会被前一个 noteOff 截断。

## 根因

当前已有 tick 域清洗工具:

- [src/core/generation/newEngine/render/leadSanitizer.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/render/leadSanitizer.ts)

当前已有上游调用:

- [src/core/generation/newEngine/generation/generateSongFromMotif.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/generation/generateSongFromMotif.ts) 在 override lead 初次转 TrackIR 时调用 `sanitizeLeadNoteIR()`

但最终 render 末端只在 jazz/blues legato 分支里做了最终处理:

- [src/core/generation/newEngine/render/renderCoordinator.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/render/renderCoordinator.ts:386)

当前形态:

```ts
const humanizedTracks = humanizeTiming(...);
const legatoOpts = fastLeadLegatoOptionsForStyle(band.style, timebase.ppq);
const articulatedTracks = legatoOpts.enabled
  ? humanizedTracks.map((t) => t.role === 'lead' ? { ...t, notes: connectFastLeadNoteIR(t.notes, legatoOpts) } : t)
  : humanizedTracks;
```

问题:

1. `pop/lofi/rnb` 的 `legatoOpts.enabled=false`,所以 final lead safety 完全跳过。
2. `humanizeTiming` 之后没有全风格 `sanitizeLeadNoteIR()`。
3. 上游 `generateSongFromMotif.motifLeadToTrackIR()` 的 sanitizer 只能保护初始 override lead,不能保护 renderCoordinator 后续变换重新制造的 overlap。

## 硬性目标

1. 所有 Q+N full arrangement 的 lead 轨,在进入最终 MIDI / IR 输出前,必须满足:
   - 无同 pitch 同 startTick 双 note。
   - 无同 pitch overlap。
   - 同 pitch 连续 note 的前一个 noteOff 必须早于后一个 noteOn,至少留 `1 tick` gap。
2. 该规则对所有 style 生效: `pop / lofi / rnb / jazz / blues`。
3. 该规则对所有 lead 来源生效:
   - 默认 `renderMgMelody` lead。
   - Q+R route A `overrideLeadTrack`。
   - 未来任何注入 lead。
4. 不改变 pitch、startTick、note count,除非存在同 pitch 同 startTick duplicate 时需要合并。
5. 不因为 sanitizer 破坏 jazz/blues 快速 16 分 legato。jazz/blues 仍应先保留/应用 `connectFastLeadNoteIR()` 的连奏手感,但最终不得留下同 pitch collision。

## 推荐实现

文件:

- [src/core/generation/newEngine/render/renderCoordinator.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/render/renderCoordinator.ts)
- [src/core/generation/newEngine/render/leadSanitizer.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/render/leadSanitizer.ts)
- [src/core/generation/newEngine/render/leadSanitizer.test.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/render/leadSanitizer.test.ts)

### Phase 1: 把 sanitizer 提升为 renderCoordinator 的最终 lead 安全闸

在 `renderCoordinator.ts` 中 import:

```ts
import { sanitizeLeadNoteIR } from './leadSanitizer';
```

在 `humanizeTiming(...)` 之后,对所有 lead 先做一次 tick-domain sanitize:

```ts
const sanitizedLeadTracks = humanizedTracks.map((t) =>
  t.role === 'lead'
    ? { ...t, notes: sanitizeLeadNoteIR(t.notes, { gapTicks: 1, minDurTicks: 1 }) }
    : t,
);
```

然后 jazz/blues 再接 `connectFastLeadNoteIR()`:

```ts
const legatoOpts = fastLeadLegatoOptionsForStyle(band.style, timebase.ppq);
const legatoTracks = legatoOpts.enabled
  ? sanitizedLeadTracks.map((t) =>
      t.role === 'lead'
        ? { ...t, notes: connectFastLeadNoteIR(t.notes, legatoOpts) }
        : t,
    )
  : sanitizedLeadTracks;
```

最后再做一次 all-style sanitizer 作为真正最终安全闸:

```ts
const articulatedTracks = legatoTracks.map((t) =>
  t.role === 'lead'
    ? { ...t, notes: sanitizeLeadNoteIR(t.notes, { gapTicks: 1, minDurTicks: 1 }) }
    : t,
);
```

说明:

- 第一遍 sanitizer:清除 `humanizeTiming` 后已经存在的 duplicate / overlap,避免 legato 看到同 start / 同 pitch 脏输入。
- legato:只在 jazz/blues 开启,保持 bebop 快速线条连贯。
- 第二遍 sanitizer:最终保险,确保任何 legato 或未来末端处理都不能把同 pitch collision 放进输出 IR。
- `sanitizeLeadNoteIR()` 只处理同 pitch collision,不同 pitch overlap 保留,不会把旋律变成粗暴单音裁剪。

### Phase 2: 增加确定性回归测试

在 [src/core/generation/newEngine/render/leadSanitizer.test.ts](/Users/mynority/vibe_coding/auraflow_music_game_console_simulator/src/core/generation/newEngine/render/leadSanitizer.test.ts) 增加这次真实复现:

```ts
it('★ renderCoordinator final safety:Q+R route A pop seed=10 variant=1 full arrangement lead 无同 pitch overlap', () => {
  const r = generateMotifWeave({
    capturedNotes: generateSampleCaptured(96, 0, 'major', 1),
    style: 'pop',
    keyPc: 0,
    mode: 'major',
    bpm: 96,
    seed: 10,
  });
  const ov = buildMotifSongOverride(r, 0, 'major');
  const song = generateSongFromMotif(
    { seed: 10, styleHint: 'pop', mood: 'build', targetDuration: 120 },
    ov,
  );
  const lead = song.ir!.tracks.find((t) => t.role === 'lead')!;
  expect(samePitchOverlap(lead.notes), 'final lead 同 pitch overlap=0').toBe(0);
});
```

注意:

- 这个测试必须验证 `generateSongFromMotif()` 的最终 `song.ir`。
- 不要只测 `motifLeadToTrackIR()` 或 Q+R preview,因为 bug 是 renderCoordinator 后处理后重新出现的。

### Phase 3: 增加小范围 fuzz 防回归

同文件或新测试文件增加轻量 fuzz,覆盖 route A full arrangement:

```ts
const styles = ['pop', 'lofi', 'rnb', 'jazz'] as const;
for (const style of styles) {
  for (let seed = 1; seed <= 40; seed++) {
    for (const variant of [0, 1, 2]) {
      const r = generateMotifWeave({
        capturedNotes: generateSampleCaptured(96, 0, 'major', variant),
        style,
        keyPc: 0,
        mode: 'major',
        bpm: 96,
        seed,
      });
      const ov = buildMotifSongOverride(r, 0, 'major');
      const song = generateSongFromMotif(
        { seed, styleHint: style, mood: 'build', targetDuration: 120 },
        ov,
      );
      const lead = song.ir!.tracks.find((t) => t.role === 'lead')!;
      expect(samePitchOverlap(lead.notes), `${style} seed=${seed} variant=${variant}`).toBe(0);
    }
  }
}
```

要求:

- `blues` 可选,因为 Q+R 当前不需要 blues;如果测试耗时可先只覆盖 `pop/lofi/rnb/jazz`。
- 如果 full fuzz 太慢,可以降到 `seed<=20`,但至少保留 `pop seed=10 variant=1` 的确定性回归。

### Phase 4: 增加默认 Q+N lead 安全不变量

新增或扩展测试:默认 `generateSong()` / `generateSongFromMotif(req)` 无 override 的 lead 也必须无同 pitch overlap。

建议样例:

```ts
for (const style of ['pop', 'lofi', 'rnb', 'jazz'] as const) {
  for (const seed of [1, 2, 3, 7, 10, 17, 31]) {
    const song = generateSong({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
    const lead = song.ir!.tracks.find((t) => t.role === 'lead');
    if (!lead) continue;
    expect(samePitchOverlap(lead.notes), `default ${style} seed=${seed}`).toBe(0);
  }
}
```

这是 render 层 MIDI 安全不变量,不是 motif 专属行为。

## 不要做

- 不要把修复只放在 `generateSongFromMotif.motifLeadToTrackIR()`。那里太早,无法覆盖 renderCoordinator 后续变换。
- 不要把修复只绑在 `legatoOpts.enabled` 上。`pop/lofi/rnb` 同样会被 MIDI noteOff collision 影响。
- 不要改 `humanizeTiming` 的随机策略来绕开这个 bug。humanize 可以继续存在,末端 sanitizer 负责安全。
- 不要把所有不同 pitch overlap 都裁掉。lead 快速线条允许不同 pitch legato / overlap,本问题只针对同 pitch noteOff collision。
- 不要修改 Q+R motif capture / hidden grid / quote:vary。它们不是本 directive 范围。

## 验收标准

必须通过:

```bash
npx vitest run src/core/generation/newEngine/render/leadSanitizer.test.ts src/core/generation/newEngine/generation/generateSongFromMotif.test.ts src/core/generation/newEngine/render/leadArticulation.test.ts src/core/generation/newEngine/render/leadGridTiming.test.ts
npm test
npm run lint
npm run build
```

功能验收:

- `pop seed=10 variant=1` route A full arrangement final `song.ir` lead 的 `samePitchOverlap=0`。
- `pop/lofi/rnb/jazz` route A 小范围 fuzz final `song.ir` lead 的 `samePitchOverlap=0`。
- 默认 Q+N 生成 final lead 的 `samePitchOverlap=0`。
- jazz/bebop 快速 16 分 legato 测试仍通过,不能回到机关枪式断奏。
- `generateSongFromMotif(无 override) === generateSong()` 现有等价测试仍通过。

## 完成定义

这次任务完成后,Q+R 输入 motif 即使走进 Q+N full arrangement,最终输出 IR/MIDI 层也不能再出现同 pitch overlap 导致的 noteOff 截断。若用户仍感觉 motif 后续不像原样,那属于 `quote:vary` / 旋律设计问题,不属于本 directive。
