// ============================================================
// GlobalContext — Apps 共享拍号(2026-05-24 大清理后退化)
// ============================================================
//
// 历史:原 GlobalContextManager 是生成管道运行时的可变单例(BPM / 调式 / 调号 /
//        时间签名 / 当前段落 / 当前和弦 / GrooveDNA 等)。
//
// 删 AF 后 writer 全死,只剩 Apps(EndlessRadioManager / JamSessionManager)
//   读 currentTimeSignature 用于 Jam 拍量算法。
//
// 当前形态:只暴露一个 readonly [4, 4] 常量。未来若 Apps 真需要从播放上下文读
//   timeSignature,改为从 AudioEngine.getCurrentContext() 派生即可。
// ============================================================

export const GlobalContext = {
    currentTimeSignature: [4, 4] as [number, number],
};
