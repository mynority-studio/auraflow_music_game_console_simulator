// ============================================================
// newEngine · sandbox · MixProfile(re-export 正式实现)
// ------------------------------------------------------------
// ★ Q+N 升格为主引擎(qn_main_engine_takeover §2):roomWetFor(共享房间湿度)已并入正式 audio 层
//   `src/core/audio/musicalIrToMidi.ts`。本文件只 re-export,保 sandbox 旧 import 路径不破。
// ============================================================

export { roomWetFor } from '../../../audio/musicalIrToMidi';
