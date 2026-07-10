# copych_synth.mjs 来源（vendored 构建产物）

- 源：本仓 git submodule `components/synth/auraflow_synth/ports/wasm/`（commit e05c2a99568e416d836a82c8c2caa590d972d262，copych-synth-latest）
- 构建：`ports/wasm/build.sh`（emcc 6.0.2，-O3 -ffp-contract=off，SINGLE_FILE+MODULARIZE+EXPORT_ES6，
  -sENVIRONMENT=web,worker,node,shell）
- 重生成：在 submodule 跑 `components/synth/auraflow_synth/ports/wasm/build.sh` 后拷贝 `copych_synth.mjs` 至此，
  并更新本文件 commit 号与下方 sha256。
- node 冒烟基线：fnv64=0x266566d8d3d18fed（emcc 6.0.2 口径）
- License：GPL-3.0-only（含上游 copych MIT 部分，见 submodule `components/synth/auraflow_synth/NOTICE`）
- sha256: c18cd1f7cd24d5026fe8a2a59ec103a75bbb0d58877ca23809f71e356d899de9
