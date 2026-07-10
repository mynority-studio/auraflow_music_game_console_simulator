# copych_synth.mjs 来源（vendored 构建产物）

- 源：auraflow_synth 仓库 `ports/wasm/`（commit d762547，M1 批1）
- 构建：`ports/wasm/build.sh`（emcc 6.0.2，-O3 -ffp-contract=off，SINGLE_FILE+MODULARIZE+EXPORT_ES6，
  -sENVIRONMENT=web,worker,node,shell）
- 重生成：在 auraflow_synth 仓库跑 `ports/wasm/build.sh` 后拷贝 `copych_synth.mjs` 至此，
  并更新本文件 commit 号与下方 sha256。
- node 冒烟基线：fnv64=0xb0cc19e73578831d（emcc 6.0.2 口径）
- License：GPL-3.0-only（含上游 copych MIT 部分，见 auraflow_synth 仓 NOTICE）
- sha256: 413d51a76cd52fb82d1e42d862f4214fceaaddc0b1410f59d5414a5b7e4b100b
