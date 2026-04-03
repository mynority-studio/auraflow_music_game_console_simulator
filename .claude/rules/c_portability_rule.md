# C 可移植性约束（ESP32-S3）

> **适用范围** — `/src/core/generation/` 及所有受 Pipeline Rule 管辖的代码
> **目的** — 确保 TypeScript 代码可 1:1 翻译为 ESP32-S3 C 代码
> **优先级** — 与 Pipeline Rule 同级，冲突时以本规则为准

---

## 浮点安全

| ID | 约束 |
|----|------|
| C-1 | **禁止两个浮点变量直接 `===` 比较**。`beat === chord.startBeat` 必须写为 `Math.abs(beat - chord.startBeat) < 1e-6`。JS 可能侥幸通过，C 浮点累加后必定失配 |
| C-2 | **beat 循环累加风险意识**。`for (let beat = start; beat < end; beat += 0.25)` 循环超过 100 次后浮点误差累积。循环内所有比较必须用 epsilon |

## 数据结构

| ID | 约束 |
|----|------|
| C-3 | **禁止 `Map` / `Set`**（含临时去重）。C 无对应数据结构。去重用 `array.some()` 或排序+线性扫描 |
| C-4 | **禁止依赖 sort 稳定性**。C `qsort` 不保证稳定。所有 `.sort()` 比较器必须消除全部 tie（同 onset → 按 pitch，同 pitch → 按 duration） |
| C-5 | **禁止字符串做逻辑决策**。`chord.numeral.includes('dim')` 必须用 `ChordQuality` 枚举位掩码。`section.name.includes('Chorus')` 必须用 `SectionType` 枚举。和弦罗马数字仅用于日志显示 |

## 内存模式

| ID | 约束 |
|----|------|
| C-6 | **热循环内 `.push()` 可接受**（C 翻译时改为 `buf[count++]`），但禁止在热循环内使用 `.map()` / `.filter()` / `[...spread]` 创建临时数组 |
| C-7 | **输出数组无上界时必须文档化最大长度**。新增 NoteData 数组的函数须在注释中标注预期最大元素数（如 `// max ~300 notes for 3-min song`） |

## 类型安全

| ID | 约束 |
|----|------|
| C-8 | **所有分类标识必须使用数值枚举**。StyleId、SectionType、Tonality、ChordQuality、InstrumentId 已实现。新增分类时必须定义枚举 + 翻译表（`XxxName[]`） |
| C-9 | **PRNG 初始化禁止 `Date.now()`**。使用固定初始种子，由调用方显式 `setSeed()` 覆盖 |

## 约束编号速查

| 编号 | 数量 |
|------|------|
| C-1 ~ C-9 | 9 条硬约束 |
