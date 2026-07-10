# copych_synth.mjs 来源（vendored 构建产物）

- 源：auraflow_synth 仓库 `ports/wasm/`（commit 7005973，关闭 ENABLE_CHORUS——FX 取舍：
  mono 下 chorus 立体声价值归零；旧值 7c982b4/D2+CPU+C1 收官）
- 构建：`ports/wasm/build.sh`（emcc 6.0.2，-O3 -ffp-contract=off，SINGLE_FILE+MODULARIZE+EXPORT_ES6，
  -sENVIRONMENT=web,worker,node,shell）
- 重生成：在 auraflow_synth 仓库跑 `ports/wasm/build.sh` 后拷贝 `copych_synth.mjs` 至此，
  并更新本文件 commit 号与下方 sha256。
- node 冒烟基线：fnv64=0xf4ac8cc9ebcae8b1（emcc 6.0.2 口径；关 ENABLE_CHORUS 后重锁——chorus
  不处理 + reverb/delay send 不再叠 chorus 干声，渲染变；旧值 0xb0cc19e73578831d 带 chorus 退役）
- host 冒烟基线：fnv64=0xd20bbcff10093b59（本机 clang；同因关 chorus 重锁，旧值 0x5229fbf2e3c4dc8d；
  run_smoke.sh 6/6 PASS 核过）
- License：GPL-3.0-only（含上游 copych MIT 部分，见 auraflow_synth 仓 NOTICE）
- sha256: b3834bd85ab8699f2d1e15ff9d3b1eba669b740245ba3f1639b51170968e0b67
