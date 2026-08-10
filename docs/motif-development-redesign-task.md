# Motif 续写智能化重构（三期方案）

> 状态：一期进行中 · 定稿于 2026-08-10 · 背景：现有逻辑把用户 motif 原样硬凹进歌里
> （单一 owned span、逐音原封、±20% 等比缩放、放不下就静默消失），本方案的目标是
> **让 motif 变好听而不是重复它，在好听的基础上保证用户听得出这是自己的动机**。

## 0. 现状诊断（探索结论摘要）

- 分析层（`motifSandbox/model/motifAnalysis.ts`）是机械规整：1/16 吸附 + 音阶吸附 +
  accent/structuralToneScore 加权分，无任何"音乐性/角色"判断。
- `melodicBrickAnalyzer` 已有功能分类（opening/cadence/launcher/琶音/模进 + 置信度 +
  中文 evidence），但只用于挑和声进行。
- 落位（`newEngine/render/userMotifBrick.ts`）：motif 全曲仅出现一次，音高逐音不动，
  时值单次等比缩放硬限 ±20%；打分 = 和声支持度(压倒性) + 越早越好，**段落角色不参与**；
  ±20% 内无候选 → `planAuthoredUserMotifBrick` 返回 undefined，motif 静默消失。
- 变奏机器（`motifWeaver`：模进/倒影/逆行/片段化/quote-develop-connect）存在但产品链不调用。
- 已做对的一件事：有 motif 时每个 brick 的 grammar 展开重掷 8 次挑节奏形状最像的
  （`mgRhythmShapeMatcher`），全曲 lead 已继承 motif 的节奏性格。
- 预留未用的语义位：`MotifNote.occurrenceKind('quote'|'develop'|'connect')`、
  `MgNoteEvent.origin:'motif'`（从未写入）。

## 1. 不变量（所有出现位置一律适用）

1. **用户音符的音高、先后顺序永不改变**。
2. 引擎自由度仅三种：
   - 在音符**之间**插入经过音/趋近音；
   - 不适合做骨干的音**降级**（缩短时值、降力度、挪弱拍位，音高不动）；
   - 时值/落拍在容差内对齐 groove。
3. 发展算子只允许保音高保序的：完整引用、连续片段化（取头/取尾）、增减时值、
   尾音延长/延后（delay-tail / terminal-hold / omit-middle 音高安全，可从 LOFI 通用化）、加花。
   **模进（移调）、倒影、逆行明确排除**。

## 2. 干预程度判定：MotifConfidenceProfile（六维）

核心思想：用户输入可能是"演奏"也可能是"灵感草稿"，干预力度必须由算法判断，
不能一刀切。每维输出 0–1 分 + `informative` 标记（无信息维度从加权平均**剔除**而非记零分）。

| # | 维度 | 信号 | 数据来源 |
|---|------|------|----------|
| ① | 时值控制 | 量化误差均值/峰值、同型节奏 cell 重复一致性、赶拍/拖拍漂移 | `MotifTimingAnalysis.quantizeErrorMean/Max`、`GridCapturedNote.timingErrorBeat`（均已有） |
| ② | 音高把控 | 吸附前离调率（`originalMidi`）、无消解大跳（>P5 后无反向级进回收） | 吸附时写 `originalMidi`；跳进统计新写 |
| ③ | 力度意图 | velocity×metricalWeight 相关性、力度方差 | `MotifNote.velocity` + 节拍权重（已有） |
| ④ | 破碎度 | 治愈器修掉的夹短音数、异常短音比例 | `articulationGapsHealed` 等治愈审计（已有） |
| ⑤ | 结构完形 | 轮廓拱形清晰度、收尾稳定性（`cadenceMotionOf`）、内部自相似、长度收边 | `melodicBrickAnalyzer`（大半已有） |
| ⑥ | 和声接洽 | 最佳落位 `harmonicSupportRatio`——本来接得住的不动 | `planAuthoredUserMotifBrick`（已有） |

- 按位输入（产品 pad）时 ② 从构造上失效、③ 可能恒定力度失效 → 判定入口带
  `inputSource: 'position' | 'pitch'`，权重自动向时值/结构维度转移。
- **全局分定档，逐音分定点**：
  - overall ≥ 0.75 → **保真档**：原样陈述，装饰关闭或极轻；
  - 0.45–0.75 → **修饰档**：弱音降级 + 大跳/长间隙填经过音 + pocket 对齐；
  - < 0.45 → **治愈档**：完整装饰词汇 + 节奏向风格 pocket 规整。
  - 逐音：`structuralToneScore` × 落位和声支持 × 全局档 → 骨干锚点 or 降级装饰。
- 阈值做成可审计常量；档位 + 中文 evidence 链显示到 Q+R 面板

## 3. 干预机制：定高锚点 + 语法结缔组织

- motif 音符进 token 层变**定高锚点 token**（音高直通，realizer 不得改写）。
- 插入的经过音 = 锚点之间的 `A/S` token，`SlopeEnter` 窗口取两锚点音高闭区间、
  方向同锚点音程符号 → **构造上保证插入音不破坏轮廓与顺序**；时值从前一锚点长音
  切出，落弱分位；锚点 onset 顺序不动。
- 降级音 = 锚点属性变化（时值缩到装饰级、力度压低），音高不动。

## 4. 三期实施

### 一期 · 会判断了（进行中）
- 新建 `motifSandbox/model/motifConfidence.ts`：六维 profiler + 三档策略。
- `melodicBrickAnalyzer` 补 `rolePotential`（hook 潜质 vs 主题潜质 + evidence）：
  信号 = 跨度、音集紧凑度、节奏 cell 重复强度、轮廓拱形、收尾类型。
- `userMotifBrick.ts` 落位打分接入段落角色（hook 型 → 副歌/hook 段位，主题型 →
  段落头；"要不要一开始进来"由角色分决定）。
- **修静默消失**：±20% 无候选时降级安置（`placementQuality: 'exact'|'relaxed'|'forced'`）
  并写审计，绝不整段丢弃。

### 二期 · 会发展了（已实现，见实现说明）
- 风格无关变奏词汇 `render/motifDevelopmentPlan.ts`：exact-recap / fragment-head /
  fragment-tail / delay-tail / terminal-hold / omit-middle（全部保音高保序；
  LOFI 变奏词汇思想的通用化）。
- owned span 从 1 段放开为多段弧线：陈述(quote) → develop → return；
  `authoredLeadSpans` 返回全部 span，`reserveScheduledTokensForAuthoredSpans`
  原生吃数组，装配端按全部 span 过滤生成音。
- 置信档管道：面板分析 → `override.confidenceTier` → render；保真档零修饰，
  修饰/治愈档做经过音插入 + 弱音降级（陈述与 occurrence 同规则）。

**二期实现说明（2026-08-10）**：
- 结缔组织在【锚点音符层】实现（`refineMotifNotes`），不在 grammar token 层：
  插入音音高严格限制在相邻锚点音高开区间内 + chord-scale 准入 → 构造上保序保
  轮廓，且逐段复用一期 materialize 的 groove 对齐/保真钳制。token 层定高锚点
  深改（realizer 原生长结缔组织）列为三期后备优化——行为等价、风险更低。
- occurrence 选址两道门：加权和声支持度 ≥ 0.6 + **长音硬门**
  （`motifLongExposureSupported`，镜像 avoid-long-exposure 审计：≥1 拍的音必须
  被覆盖和弦 stable/color 接住）。找不到达标位置宁缺毋滥。
- occurrence 数量 = min(3, floor(totalBeats/32))，彼此及与陈述间隔 ≥ 4 拍，
  变奏手法不重复；再现类（recap/hold）偏后段（回归感），片段类偏中段（发展感）。

### 三期 · 会自省了（已实现，见实现说明）
- grammar 亲和度：motif 节奏 profile 对各风格语料反向匹配（复用
  `mgRhythmShapeMatcher`），结论进 UI（"这个动机在 RNB 语法里最自在"）。
- 辨识度审计 `motifRecognizabilityAudit`：每次出现算节奏形状相似度 + 锚点轮廓
  符号匹配率 + 全曲覆盖保证（≥1 次保真陈述）。**先 report-only** 挂生成审计,
  阈值校准后升级为测试硬门。

**三期实现说明（2026-08-10）**：
- 亲和度：`knowledge/motifGrammarAffinity.ts` —— 动机节奏形状 vs 各风格 slope
  语料重建的规则节奏形状（复用 `buildGrammarRhythmShapeProfile` +
  `melodyRhythmShapeSimilarity`，与生产链节奏匹配同一把尺）；每风格取权重前
  200 条规则，得分 = top-8 邻域平均相似度；语料 profile 模块级懒缓存。
  面板在分析行显示"亲和 RNB .82 · LOFI .76 · POP .71"。
- 辨识度审计：`auditMotifRecognizability`（motifDevelopmentPlan.ts），
  `withMotifDevelopment` 自动挂到 `plan.recognizability`。每 occurrence 记
  节奏相似度（警告线 0.5）、保序不变量校验（非装饰音须为陈述音高的保序
  子序列，装饰音以 structuralToneScore ≤ 0.15 识别剔除）、音数比。
  **report-only**：warnings 只记录不拦截，阈值实听校准后再升硬门。
- 后备优化（未做，有意留）：token 层定高锚点深改；辨识度审计接入
  GenerationController 的 AuditReport findings 通道。

## 5. 验证纪律

每期收尾：`pnpm exec tsc --noEmit` + `pnpm test -- --run`，与分支基线对照
（当前分支存量失败以 stash 对照法确认），新增代码必须全绿。
