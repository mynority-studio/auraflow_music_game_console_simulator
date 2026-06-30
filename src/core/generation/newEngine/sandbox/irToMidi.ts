// ============================================================
// newEngine · sandbox · IR → MidiEvent(re-export 正式实现)
// ------------------------------------------------------------
// ★ Q+N 升格为主引擎(qn_main_engine_takeover §2):IR→MIDI 的【唯一实现】已移到正式 audio 层
//   `src/core/audio/musicalIrToMidi.ts`。本文件只 re-export,保 sandbox/诊断/测试旧 import 路径不破。
//   不要在此重新实现转换逻辑(单一真源)。
// ============================================================

export { musicalIRToMidiEvents, ROLE_CHANNEL, roomWetFor } from '../../../audio/musicalIrToMidi';
