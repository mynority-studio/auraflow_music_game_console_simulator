# Legacy Diagnostics

These scripts reference retired harmony-engine / old MG comparison paths.
They are preserved for historical debugging only and are excluded from active TypeScript checks.
Do not use them as current migration audit tools.

---

归档隔离(2026-07-06,用户签字):以下旧诊断脚本引用已删模块(harmony-engine / 旧 MG 对比路径),
`tsc --noEmit` 会报错污染工程健康度。移到此处 + 在 `tsconfig.json` `exclude` 排除,不删除(保留历史排查材料)。

- `mg-2-polluter-deep.ts`
- `mg-engine-mutation-detector.ts`
- `mg-engine-statefulness-probe.ts`
- `mg-vs-auraflow-compare.ts`
- `mg-vs-auraflow-deep-diff.ts`
- `parent-key-check.ts`
- `runpipeline-melody-chord-check.ts`

当前生产/迁移审计工具在 `scripts/` 根下(如 `audit-mg-current-parity` / `audit-comp-onset-intent` /
`audit-mg-intent-family` / `audit-intent-phase1-no-output-change` / `audit-non-acg-per-section-feel` 等)。
