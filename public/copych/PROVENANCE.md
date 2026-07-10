# copych_synth.mjs 来源（vendored 构建产物）

- 源：auraflow_synth 仓库 `ports/wasm/`（commit 7c982b4，D2 voice steal + CPU 复音上限 + C1 健壮性收官；
  重灌 2026-07-10，旧值 d762547/M1 批1）
- 构建：`ports/wasm/build.sh`（emcc 6.0.2，-O3 -ffp-contract=off，SINGLE_FILE+MODULARIZE+EXPORT_ES6，
  -sENVIRONMENT=web,worker,node,shell）
- 重生成：在 auraflow_synth 仓库跑 `ports/wasm/build.sh` 后拷贝 `copych_synth.mjs` 至此，
  并更新本文件 commit 号与下方 sha256。
- node 冒烟基线：fnv64=0xb0cc19e73578831d（emcc 6.0.2 口径；7c982b4 重灌后逐位持平——
  D2/CPU 默认=legacy 未触发 steal，渲染未变，仅源码变→二进制字节变→sha256 变）
- host 冒烟基线：fnv64=0x5229fbf2e3c4dc8d（本机 clang；run_smoke.sh 6/6 PASS 核过）
- License：GPL-3.0-only（含上游 copych MIT 部分，见 auraflow_synth 仓 NOTICE）
- sha256: f9dfa61e706a3f4f2096c65c69bc92391b7b68c1d1a90b334b62b60f0b344ae4
