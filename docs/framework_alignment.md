# 框架对齐状态

> 记录目标接口设计与当前源码的差异。标记 ✅ 表示已对齐。
> **v1.34.0**: 生成管道核心（`/src/core/generation/`）的 GlobalContext 解耦已 100% 完成。

| 项 | 当前源码 | 目标框架 | 状态 |
|---|---|---|---|
| **生成管道（Pipeline Rule 管辖）** | | | |
| styleId 类型 | `StyleId`（enum） | `StyleId`（enum） | ✅ |
| 风格分类 | `StyleFlagTable` 位掩码 | `StyleFlagTable` 位掩码 | ✅ |
| PRNG | `PRNGManager` 模块 | `PRNGManager` 模块 | ✅ |
| 上下文传递 | `MusicContext` 显式传递（零 GlobalContext） | `MusicContext` 显式传递 | ✅ |
| idiomPreferences | `IdiomPreferences` / `RuntimeIdiomPreferences` | 类型化接口 | ✅ |
| 浮点比较 | epsilon 容差 | epsilon 容差 | ✅ |
| 生成引擎签名 | `generateFullSong(styleId): { track, context }` | 同左 | ✅ |
| HarmonyCore | tonality/keyOffset 显式参数 | tonality/keyOffset 显式参数 | ✅ |
| 编配引擎签名 | `arrange(track, styleId, context)` | 同左 | ✅ |
| TextureMapper | `TextureRenderContext` 零 GlobalContext | 显式参数 | ✅ |
| Bass Idiom | `BassIdiomContext` 含完整上下文 | 显式参数 | ✅ |
| Groove 判定 | `BaseBassIdiom.isGrooveHit()` 纯函数 | 纯函数 | ✅ |
| **平台层（不受 Pipeline Rule 管辖）** | | | |
| 风格配置查询 | `getStyleConfig(id)` 哈希表 | `StyleConfigTable[id]` 数组 | 待迁移 |
| 播放引擎终点 | `AudioEngine.playSong()` 内调用 | 独立 `PlaybackEngine.convert()` | 待迁移 |
| 历史栈存储 | `{ track, style: StyleConfig }` | `{ track, styleId, context }` | 待迁移 |
| GlobalContext 平台层 | audio/apps/components 仍引用 | 不受管辖 | N/A |

---

## 可测试性

按框架实施后，四个黑盒均可独立测试：
- **PRNGManager**: `setSeed()` + 调用序列 → 验证输出数列
- **生成引擎**: `setState(stateA)` + styleId + options → 验证 GeneratedTrack + MusicContext
- **编配引擎**: `setState(stateC)` + 预录 track/styleId/context → 验证 ArrangedTrack
- **MIDI 转换层**: 预录 ArrangedTrack + styleId → 验证 MidiEvent[]（不消耗 PRNG）

---

## 机械替换兼容性

**全部 7 项替换零差异可行。其中生成管道核心项已于 v1.34.0 完成实施。**
- StyleId enum 替换 string：✅ 已实施
- GlobalContext → MusicContext 显式传递：✅ 已实施
- globalPRNG → PRNGManager：✅ 已实施
- userMotifRoot 类型 enum 化：✅ 零差异
- detectedTonality enum 化：✅ 零差异
- motifExpertise 删除：✅ 零差异
- 返回值 { track, context }：✅ 已实施
