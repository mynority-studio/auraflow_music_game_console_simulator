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

## 0.5 用户裁决（2026-08-10,四期起生效)：两层约束定稿

用户实听三期后反馈:motif 只是"被插播的元素",90% 时间与动机无关 —— 属实
(引用式集成的架构必然)。据此裁决:

1. **motif 本身的出现**(陈述/再现/片段):逐级音高不变,底线不动。
2. **衍生材料**(生成的乐句头/应答/连接):允许基于动机做**延展、模进、渐变、
   拆分** —— 保轮廓、保节奏 cell、保音程行进,音高由和声现场重定(这正是
   动机饱和全曲的经典手段)。
3. **时值不神圣**:每个音的时值可在歌里合理 sustain、踏板式连贯(同音重复
   的有意断奏除外,镜像 healer 规则)。
4. 目标从"找个合适的地方播放一下"升级为"动机是这首歌的 DNA,在合理合适的
   地方持续在场"。核心产品目标:用户有一小段不完整的灵感,算法帮他拓展成曲,
   把灵感动机保存下来。
5. **补充标准(同日)**:非"瞎按"输入尽量还原动机音序、**尽量少加经过音**
   (加多了听不出是自己的 motif)→ 经过音插入仅限治愈档;完善动机优先用
   动机**外部**的手段(前起始音/后延续音框接、衍生材料),不动内部。
6. 理论基础:方案对应 Schoenberg 句子结构(陈述→重复→片段化→终止)与
   developing variation;"先和声骨架后融入"在本管线中本来成立(和声进行
   按 motif 的 brick 功能选择),起承转合由发展弧线(statement→develop→
   return)+ 段落在场配额承担。

### 四期 · 会饱和了(已实现,2026-08-10)
- **motif 语法化**(`render/userMotifGrammar.ts`):motif + head/tail/augmented
  四个变体编码为 grammar 规则(节奏含休止;逐步 SlopeEnter[音程±1] 窗口 =
  近似模进/渐变;首音 C 锚和弦)注入当前风格语法 —— 注入点是
  `expandForRhythmIdentity` 单一漏斗,仅在有用户 motif 时生效;节奏重掷 8 次
  机制天然放大 motif 规则命中率 → 生成材料全曲"说"动机形状。
  family-only 下按 RHS 签名 cap(≈4×2.5%/brick 被选),legacy 风格按权重
  (40/24 vs 语料 1..11)。测试证明采样真实可达。
- **每段落在场配额**:有段落数据时每段保证 ≥1 次动机事件(在场优先于手法
  多样性),间隔放宽到 2 拍;无段落数据回退旧配额。
- **sustain 连贯**:物化层异音高小间隙(≤1 拍)连到下一音、末音延满 span、
  同音断奏不连(镜像 healer);只延不缩、onset 不动。
- 经过音插入按补充标准收紧到仅治愈档。
- 后备(未做):前起始音/后延续音的显式框接音(需 occurrence 窗口预留呼吸
  空间,目前由 head/tail 衍生规则 + sustain 近似覆盖);衍生音 origin 染色
  (复用 origin:'motif' 会误触 shaper 保护语义,需新字段)。

### 四期后调优(2026-08-10 实听反馈轮)
- **authored quote 审计豁免**:avoid-long-exposure / structural-tone-outside-
  intersection 在 authored lead 窗口内降级 warning(镜像沙盒 quote 哲学);
  接不住的长音仍压 <1 拍;sustain 延展和声感知。修掉"长音密 motif 必定
  生成失败"(120 组合探针:36 失败 → 0)。
- **轮廓保留**:有用户 motif 时全风格开 preserveSlopeGrammar —— 此前 POP/RNB
  导音规划覆盖衍生规则的音程轮廓,只剩节奏,听不出"基于动机的拓展"。
- **按风格融入合同**(`motifStyleIntegration.ts`,实听:POP 最自然,其余
  "为了播放而播放"):POP/RNB 每段在场;JAZZ 松散片段化;LOFI/ACG 收敛到
  陈述+1 次(它们的 lead 架构是 score-owned/通篇作曲,硬塞引用必然外来)。
  规则权重/片段偏好逐风格定,全部可听感调参。
- **LOFI 深度融入(已实现,2026-08-10)**:`render/userMotifLofiCell.ts` 把用户
  motif 头部(≤4 音)派生成 `LofiLeadMotifCell`(节奏量化 1/4 拍 + 相对轮廓
  diatonicStep + anchor/passing/terminal 角色),在 buildMotifSongBundle 替换
  blueprint 种子 → score plan 的 statement/variation/return **全曲以用户动机为
  种子**(探针:5 seed 全部 events 溯源 user cell)。三态展开/和声许可/时值
  裁剪/comp call-response 沿用构建端原生逻辑;音高按许可集重定(衍生材料),
  逐音原样出现仍由 authored span 负责,span 内 reserve 去重。派生失败(过密
  撞位)保底回内置 cell,不静默破坏。
- **后备(下一步候选)**:ACG 把 motif 编进 cantabile-theme bank 并带 acg
  稳定落点语义。

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

## 4.5 墨盒任务书 P0+P1(2026-08-11,用户裁决:锚点保真+发展节点保轮廓换音高,倒影解禁/逆行维持禁用)

**P0 · H1-H7 证据(scripts/audit-motif-development-baseline.test.ts,11 类 motif 固定集)**:
- H1/H5(伴奏不消费 motif):**弱形式不成立** —— motif-swap 反事实显示换 motif 后
  bass/comp/pad/drum 全部变化(和声按 motif 选择 → 伴奏经和声间接响应);
  **强形式成立**:无直接节奏 cell/骨架投射(P2 靶子)。
- H2(无形式功能):成立 → P1 已修。H3(无谱系):成立 → P1 已修。
- H4(单调奖励相似):变体成立(无"太近惩罚")→ P1 距离带已修。
- H6(乐句-和声无共同规划):不成立(我们的强项)。H7:部分成立(grammar 注入缓解)。
- **baseline 量化(v1=二期)**:16 次出现 / 8 次近复制(50%) / 谱系深度 0;
  **v2(谱系)**:13 次 / 2 次近复制(15%,降 69%,超任务书 ≥30% 目标)/ 9 个
  contour 节点 / 谱系链启用。

**P1 · 实现(feature flag `developmentV2`,render 默认开,baseline 走 false)**:
- `render/motifLineage.ts`:形式功能(段落位置→presentation/continuation/
  development/return)、操作阶梯(continuation:片段→模进→位移;development:
  倒影→深模进→contour-repitch→liquidation)、双向相似度带(0.5 节奏形状 +
  0.5 轮廓符号,too-close 自动叠位移加深,too-far 重罚)、chord-scale 方向
  约束吸附(保轮廓换音高的合法性由构造保证)。
- 谱系链:发展节点从上一变体生长(parentNodeId);return = root 保真 + 继承
  发展引入的时值特征(双亲合成,记 `root+<node>`)。
- occurrence 合同新增 provenance:nodeId/parentNodeId/formalFunction/
  pitchPolicy/introducedFeatures/similarityToRoot。
- 辨识度审计:contour 节点验轮廓符号(倒影按镜像),不再误报保序破坏。
- 仅在 perSectionPresence 风格(POP/RNB)启用 v2;LOFI/ACG 维持各自融入合同。

**P2 待办**:bass 级数骨架/comp 节奏 cell 直接投射;伴奏-swap 与静音主旋律
反事实;乐句级多候选全曲重排(P3)。

## 5. 验证纪律

每期收尾：`pnpm exec tsc --noEmit` + `pnpm test -- --run`，与分支基线对照
（当前分支存量失败以 stash 对照法确认），新增代码必须全绿。
