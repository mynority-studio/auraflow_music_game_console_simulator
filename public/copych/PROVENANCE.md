# copych_synth.mjs 来源（vendored 构建产物）

- 源：本仓 git submodule `components/synth/auraflow_synth/ports/wasm/`（commit 7754933，合并
  origin/main 7005973：关闭 ENABLE_CHORUS；同时保留 AuraFlow send 映射）
- 构建：`ports/wasm/build.sh`（emcc 6.0.2，-O3 -ffp-contract=off，SINGLE_FILE+MODULARIZE+EXPORT_ES6，
  -sENVIRONMENT=web,worker,node,shell）
- 重生成：在 submodule 跑 `components/synth/auraflow_synth/ports/wasm/build.sh` 后拷贝 `copych_synth.mjs` 至此，
  并更新本文件 commit 号与下方 sha256。
- node 冒烟基线：fnv64=0x3d2df832e8f0cf7d（emcc 6.0.2 口径；Aura25_GM128.sf2
  sha256 8e312f7f…，1380342 B）
- host 冒烟基线：fnv64=0x4b1b82bd9fa2db81（本机 clang；同一 Aura25 口径）
- License：GPL-3.0-only（含上游 copych MIT 部分，见 submodule `components/synth/auraflow_synth/NOTICE`）
- sha256: e93ba654db7e9b9ebf746f6cfc2e982e0706d3f6140cf70aaaef1faf237473c8
