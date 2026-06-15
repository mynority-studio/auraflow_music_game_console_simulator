// ============================================================
// newEngine · sandbox · 发声出口
// ------------------------------------------------------------
// 沙盒唯一与音频系统接触的点:MusicalIR → MidiEvent[] → globalMidiScheduler → 发声。
// 复用【中立】音频回放层(src/core/audio),不碰任何旧引擎(自包含)。
// newEngine 引擎核心仍 0 import 音频;只有这个 sandbox 文件 import 它(harness)。
// ============================================================

import { globalMidiScheduler } from '../../../audio/MidiScheduler';
import { startAudioContext, spessaSynth } from '../../../audio/SynthManager';
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

// —— 实时单音试听(Q+R 3×5 键盘点击用)——
// 用一条专用通道(不与曲子 5 轨抢),按下 noteOn、松开 noteOff;失败(synth 未就绪)静默降级。
const AUDITION_CHANNEL = 15;
const CC_SUSTAIN = 64;
const SUSTAIN_LIGHT = 64; // 微微踩下(半踏板量级;松手后留一点音尾 ring)
let auditionProgram = -1;

/** 试听单音 on:确保就绪 → 设音色 → 先抬踏板清上一音余音 → noteOn → 微微踩下(松手后 ring,不糊)。 */
export async function auditionNoteOn(midiNote: number, program: number, velocity = 100): Promise<void> {
  await startAudioContext();
  if (!spessaSynth) return;
  if (program !== auditionProgram) { spessaSynth.programChange(AUDITION_CHANNEL, program); auditionProgram = program; }
  spessaSynth.controllerChange(AUDITION_CHANNEL, CC_SUSTAIN, 0);            // 抬:清掉上一个音的余音(避免越叠越糊)
  spessaSynth.noteOn(AUDITION_CHANNEL, Math.round(midiNote), velocity);
  spessaSynth.controllerChange(AUDITION_CHANNEL, CC_SUSTAIN, SUSTAIN_LIGHT); // 微微踩下:这个音松手后留一点 ring
}

/** 试听单音 off(踏板踩着 → 音尾微微 ring 到下次按键)。 */
export function auditionNoteOff(midiNote: number): void {
  if (!spessaSynth) return;
  spessaSynth.noteOff(AUDITION_CHANNEL, Math.round(midiNote));
}

// —— 隐形时钟数拍/暗拍 click(GM 打击通道 9)——
const DRUM_CHANNEL = 9;
/** 数拍 click:强拍(beat1)= side stick 重、弱拍 = 闭镲轻。打击乐一击即衰减。 */
export async function playClick(strong: boolean): Promise<void> {
  await startAudioContext();
  if (!spessaSynth) return;
  const note = strong ? 37 : 42;            // 37=side stick / 42=closed hi-hat
  const vel = strong ? 104 : 64;
  spessaSynth.noteOn(DRUM_CHANNEL, note, vel);
  spessaSynth.noteOff(DRUM_CHANNEL, note);  // 打击乐 noteOff 不切尾,只防挂音
}
