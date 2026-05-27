# improCore — Grammar ROM 资产

> **2026-05-27 wipe music engines** 之后,本目录是 improCore 残留的**只读数据资产**:
> 85 个 Impro-Visor 移植 grammar(`.grammar` Lisp 源)+ 它们压缩成的二进制 ROM。
> 所有生成算法(lick-gen / voicing-generator / sty-parser / 145 .sty styles /
> 19 .fv voicings / ImproEngineFacade)已物理删除。
>
> 本 README 是给未来新音乐引擎的接入说明 — 怎么读 grammar、用 grammar 做什么、
> 哪些字段什么含义。

---

## 1. 公开 API(从 `improCore/index.ts` 导出)

```ts
import {
    ALL_GRAMMAR_DATA_MAP,    // Map<grammarName, GrammarData> — 85 entry
    ALL_GRAMMAR_DATA_NAMES,  // ReadonlyArray<string>         — 字母序 sorted
    getGrammarData,          // (name: string) => GrammarData | undefined
} from '../core/generation/improCore';

import type {
    GrammarData,             // 单个 grammar 解析后结构
    GrammarRule,             // grammar 内一条 rule
    GrammarToken,            // rule body 内单 token(atom string 或 nested list)
} from '../core/generation/improCore';
```

加载方式:base64 binary inline 进 TS bundle(`data/grammars-rom-bytes.ts` 991KB),
模块顶层同步解码,**无 async**、**无 fetch**。Vite/Webpack build 时统一处理,
浏览器 + Node + 嵌入式 (vite-build) 都通用。首次 import 触发解码,后续查表 O(1)。

---

## 2. 数据结构

```ts
type GrammarToken = string | GrammarToken[];

interface GrammarRule {
    head:        string;                              // LHS 非终结符,如 'P' / 'BRICK' / 'Seg1' / 'Motif_X'
    params:      string[];                            // LHS 参数变量,如 (P Y) → ['Y']
    body:        GrammarToken[];                      // RHS 子树(含 nested expressions)
    weight:      number;                              // weighted random 权重(base rule 通常 1.0)
    builtin?:    { type: string; name: string };     // 可选 (builtin brick Sad-Cadence) marker
    headFixedArg?: number;                            // LHS 字面数字 arg,如 (BRICK 1920) → 1920
    isBase?:     boolean;                             // 是 base rule(termination,如 Y === 0)
}

interface GrammarData {
    name:           string;                                          // grammar 名(无 .grammar 后缀)
    parameters:     Map<string, string | number | boolean>;          // (parameter ...) 全局参数字典
    startSymbol:    string;                                          // (startsymbol P) 入口非终结符
    rules:          GrammarRule[];                                   // 递归 rules(weighted random)
    baseRules:      GrammarRule[];                                   // termination rules
    rulesByHead:    ReadonlyMap<string, ReadonlyArray<GrammarRule>>; // O(1) head 查表(性能用)
    baseRulesByHead:ReadonlyMap<string, ReadonlyArray<GrammarRule>>;
    headSet:        ReadonlySet<string>;                             // 非终结符全集(判定 atom vs nonterminal)
}
```

---

## 3. Grammar 源格式(Impro-Visor Lisp .grammar 文件)

每个 grammar 是一段 Lisp,顶层 list 三种:

| 形式 | 语义 | 解析去向 |
|---|---|---|
| `(parameter (KEY VALUE))` | 全局参数(chord-tone-weight / leap-prob / max-pitch ...) | `parameters` Map |
| `(startsymbol P)` | 入口非终结符(典型 'P' 或 'P_motif') | `startSymbol` |
| `(rule (HEAD ...) (BODY ...) WEIGHT)` | 重写规则 | `rules` / `baseRules` |
| `(base (HEAD 0) (BODY ...))` | 终结规则(termination) | `baseRules` |

**Rule body 内常见 token**(原 Impro-Visor NoteChooser 词汇):

| Token 形式 | 含义 |
|---|---|
| `(X N D)` | Chord-tone X 度,duration D(8ths/16ths/half/...) |
| `(slope a b ...)` | Slope-window 节奏型:范围 [a,b] 内节奏 cells |
| `(BRICK N)` | 子 phrase 长度 N(单位 480 ticks/beat) |
| `(- Y N)` | 参数减法:Y → Y - N(decrement) |
| `R N` / `L N` / `C N` / `A N` | Rest / Leap / Color / Approach tone(durations) |
| `(builtin brick Name)` | builtin brick marker(进 GrammarRule.builtin) |

详见 Impro-Visor 源 `NoteChooser.java` / `Grammar.java`(harvey mudd CS 学术工具,Java 1.8;
本仓 .claude/notes/impro-visor-audit.md 有审计)。

**注意**:body 内 token 只是**重写规则的字面 RHS**,**怎么解释成实际音符** 是
*消费方引擎* 的职责(原 `lick-gen.ts` / `grammar-runner.ts` 干这事,**已删**)。
新引擎需要自己实现 grammar-driven generation(参考 Impro-Visor `LickGen.java`)。

---

## 4. 调用示例

### 4.1 列出所有 grammar 名

```ts
import { ALL_GRAMMAR_DATA_NAMES } from '../core/generation/improCore';

console.log(`${ALL_GRAMMAR_DATA_NAMES.length} grammars:`);
ALL_GRAMMAR_DATA_NAMES.forEach((n) => console.log(`  - ${n}`));
// 85 grammars:
//   - ArtFarmer
//   - ArtPepper
//   - ...
```

### 4.2 取出某 grammar + 展开 rules

```ts
import { getGrammarData } from '../core/generation/improCore';

const g = getGrammarData('ArtFarmer');
if (!g) throw new Error('grammar not found');

console.log('start:', g.startSymbol);
console.log('chord-tone-weight:', g.parameters.get('chord-tone-weight'));  // 0.7
console.log('rules:', g.rules.length);

// O(1) head 查表(rules by head)
const pRules = g.rulesByHead.get('P') ?? [];
const baseP = g.baseRulesByHead.get('P') ?? [];
console.log(`'P' has ${pRules.length} rules + ${baseP.length} base rules`);
```

### 4.3 Weighted random pick(由新引擎实现,sample)

```ts
import { getGrammarData, type GrammarRule } from '../core/generation/improCore';
import { Random } from '/* your PRNG */';

function pickRule(rules: readonly GrammarRule[], rng: Random): GrammarRule | undefined {
    if (rules.length === 0) return undefined;
    const total = rules.reduce((s, r) => s + r.weight, 0);
    let pick = rng.next() * total;
    for (const r of rules) {
        pick -= r.weight;
        if (pick <= 0) return r;
    }
    return rules[rules.length - 1];
}

const g = getGrammarData('jazz-medium-comping')!;
const rule = pickRule(g.rulesByHead.get(g.startSymbol) ?? [], rng);
// rule.body 是 GrammarToken[],继续递归展开 ...
```

### 4.4 BRICK 长度匹配(headFixedArg)

```ts
// 找所有 (BRICK 960) rules(960 ticks = 2 beat at 480 ticks/beat)
const bricks960 = (g.rulesByHead.get('BRICK') ?? [])
    .filter((r) => r.headFixedArg === 960);
```

---

## 5. 内部文件结构(不导出,但解释一下)

| 文件 | 角色 |
|---|---|
| `data/grammars/*.grammar` | 85 个 Lisp 源(build-time `scripts/precompile-grammars.mjs` 消费) |
| `data/grammars.rom` | 编译产物:binary ROM(`GRM1` magic header + section table) |
| `data/grammars-rom-bytes.ts` | ROM base64 inline TS module(浏览器/嵌入式同构加载) |
| `data/grammar-rom-reader.ts` | ROM 解码器 → 还原成 GrammarData[](byte-exact 等价于原 parseGrammar) |
| `data/grammar-parser.ts` | 文本 .grammar → GrammarData(供 re-parse / debug 用;运行时**不用**) |
| `data/polylist.ts` | Lisp list 结构 + 遍历 helpers(parser 内部依赖) |
| `data/sexpr-reader.ts` | S-expression tokenizer(parser 内部依赖) |
| `data/raw-modules.d.ts` | Vite `?raw` import 类型声明(`.grammar` 文件) |

**ROM 格式细节**:见 `data/grammar-rom-reader.ts` 顶部注释 + `scripts/precompile-grammars.mjs`
底部 `ROM_LAYOUT`(若仓内仍有该 script)。Header 是 `'GRM1'`(magic) + version + sectionCount。

---

## 6. 修改 / 重新编译 grammar 的工作流

1. 编辑 `data/grammars/*.grammar`(Impro-Visor Lisp 文本)
2. 运行 `scripts/precompile-grammars.mjs`(如仓内尚有)→ 生成 `data/grammars.rom`
3. 把 `.rom` base64-encode 到 `data/grammars-rom-bytes.ts` 的 `GRAMMARS_ROM_BASE64` 常量
4. `npm run lint` 验证 + 抽查 `getGrammarData(name)` 返回 byte-exact 同前

(如果 precompile script 已随 engine 一起删,需要重新写一份 — 见 `data/grammars.rom`
binary 格式 + `grammar-rom-reader.ts` 解码逻辑反向推导。)

---

## 7. 历史 / 参考资料

- 来源:Impro-Visor(Harvey Mudd CS 学术工具,Java 1.8 → TS 移植)
- 仓内审计(若存在):`.claude/notes/impro-visor-audit.md`
- 完整迁移历程:`AF2 v2.2.0 impro-essence milestone`(2026-05-26)
- 85 grammars 不全是"风格",也包括 `_dottedHalfNote` / `_empty` 等占位 + `Motif_X`
  motif library + 7 muse-brainwave 实验 grammar
