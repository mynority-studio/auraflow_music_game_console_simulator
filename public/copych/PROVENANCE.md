# copych_synth.mjs 来源（vendored 构建产物）

- 源：本仓 git submodule `components/synth/auraflow_synth/ports/wasm/`（基于 commit e05c2a99568e416d836a82c8c2caa590d972d262，含当前 Copych safe-FX 工作树变更）
- 构建：`ports/wasm/build.sh`（emcc 6.0.2，-O3 -ffp-contract=off，SINGLE_FILE+MODULARIZE+EXPORT_ES6，
  -sENVIRONMENT=web,worker,node,shell）
- 重生成：在 submodule 跑 `components/synth/auraflow_synth/ports/wasm/build.sh` 后拷贝 `copych_synth.mjs` 至此，
  并更新本文件 commit 号与下方 sha256。
- node 冒烟基线：fnv64=0x70ed4efa9ae937ad（emcc 6.0.2 口径）
- License：GPL-3.0-only（含上游 copych MIT 部分，见 submodule `components/synth/auraflow_synth/NOTICE`）
- sha256: aa9639f48b193754e94f53c87c50bc430cb88df690bfa7d3346f387a0891388c
