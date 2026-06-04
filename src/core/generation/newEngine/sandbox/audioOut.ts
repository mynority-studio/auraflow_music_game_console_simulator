// ============================================================
// newEngine · sandbox · 发声出口
// ------------------------------------------------------------
// 沙盒唯一与音频系统接触的点:MusicalIR → MidiEvent[] → globalMidiScheduler → 发声。
// 复用【中立】音频回放层(src/core/audio),不碰 improCore/mgEngine。
// newEngine 引擎核心仍 0 import 音频;只有这个 sandbox 文件 import 它(harness)。
// ============================================================

import { globalMidiScheduler } from '../../../audio/MidiScheduler';
import { startAudioContext } from '../../../audio/SynthManager';
import type { MusicalIR } from '../ir/MusicalIR';
import { musicalIRToMidiEvents } from './irToMidi';

/** 播放一首 newEngine 生成的曲子。会先确保 AudioContext / synth 已启动。 */
export async function playMusicalIR(ir: MusicalIR, bpm: number): Promise<void> {
  await startAudioContext();
  const events = musicalIRToMidiEvents(ir);
  globalMidiScheduler.stop();
  globalMidiScheduler.loadTrack(events, bpm);
  globalMidiScheduler.start();
}

export function stopNewEngine(): void {
  globalMidiScheduler.stop();
}
