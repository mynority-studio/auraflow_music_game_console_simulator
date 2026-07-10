# copych_synth.mjs 来源（vendored 构建产物）

- 源：本仓 git submodule `components/synth/auraflow_synth/ports/wasm/`（commit 407f15e3cc7c84d08021284d118e00f4d7a3d3f2，copych-synth-latest）
- 构建：`ports/wasm/build.sh`（emcc 6.0.2，-O3 -ffp-contract=off，SINGLE_FILE+MODULARIZE+EXPORT_ES6，
  -sENVIRONMENT=web,worker,node,shell）
- 重生成：在 submodule 跑 `components/synth/auraflow_synth/ports/wasm/build.sh` 后拷贝 `copych_synth.mjs` 至此，
  并更新本文件 commit 号与下方 sha256。
- node 冒烟基线：fnv64=0xc94dc8945cb231f9（emcc 6.0.2 口径）
- License：GPL-3.0-only（含上游 copych MIT 部分，见 submodule `components/synth/auraflow_synth/NOTICE`）
- sha256: f9dfa61e706a3f4f2096c65c69bc92391b7b68c1d1a90b334b62b60f0b344ae4
