// ============================================================
// newEngine · sandbox · 发声出口
// ------------------------------------------------------------
// 沙盒唯一与音频系统接触的点:MusicalIR → MidiEvent[] → globalMidiScheduler → 发声。
// 复用【中立】音频回放层(src/core/audio),不碰 improCore/mgEngine。
// newEngine 引擎核心仍 0 import 音频;只有这个 sandbox 文件 import 它(harness)。
// ============================================================

import { globalMidiScheduler } from '../../../audio/MidiScheduler';
import { startAudioContext } from '../../../audio/SynthManager';
import type { InstrumentRole, MusicalIR } from '../ir/MusicalIR';
import { musicalIRToMidiEvents, ROLE_CHANNEL } from './irToMidi';
import { roomWetFor } from './mixProfile';
import { resolveAudibleRoles } from './pianoRoll';

/** 播放一首 newEngine 生成的曲子。会先确保 AudioContext / synth 已启动。style → 共享房间混响湿度。 */
export async function playMusicalIR(ir: MusicalIR, bpm: number, style?: string): Promise<void> {
  await startAudioContext();
  const events = musicalIRToMidiEvents(ir, roomWetFor(style ?? 'default'));
  globalMidiScheduler.stop();
  globalMidiScheduler.loadTrack(events, bpm);
  globalMidiScheduler.start();
}

export function stopNewEngine(): void {
  globalMidiScheduler.stop();
}

/** 计算并应用 mute/solo:solo 非空 → 只放 solo 轨;否则放未静音轨。按通道实时 muteChannel,播放中可切。 */
export function applyMuteSolo(muted: Set<string>, solo: Set<string>): void {
  const roles = Object.keys(ROLE_CHANNEL) as InstrumentRole[];
  const audible = resolveAudibleRoles(roles, muted, solo);
  for (const role of roles) globalMidiScheduler.muteChannel(ROLE_CHANNEL[role], !audible.has(role));
}

/** 当前播放位置(tick),供 playhead 读取。 */
export function getPlaybackTick(): number {
  return globalMidiScheduler.getCurrentTick();
}

/** 是否正在播放。 */
export function getIsPlaying(): boolean {
  return globalMidiScheduler.isPlaying;
}
