// ============================================================
// newEngine · sandbox · 发声出口
// ------------------------------------------------------------
// 沙盒唯一与音频系统接触的点:MusicalIR → MidiEvent[] → globalMidiScheduler → 发声。
// 复用【中立】音频回放层(src/core/audio),不碰任何旧引擎(自包含)。
// newEngine 引擎核心仍 0 import 音频;只有这个 sandbox 文件 import 它(harness)。
// ============================================================

import { globalMidiScheduler } from '../../../audio/MidiScheduler';
import { startAudioContext, getAudioContext, spessaSynth, setSandboxAuditionMaster } from '../../../audio/SynthManager';
import type { InstrumentRole, MusicalIR } from '../ir/MusicalIR';
import { musicalIRToMidiEvents, ROLE_CHANNEL } from './irToMidi';
import { roomWetFor } from './mixProfile';
import { resolveAudibleRoles } from './pianoRoll';

/** 播放一首 newEngine 生成的曲子。会先确保 AudioContext / synth 已启动。style → 共享房间混响湿度。 */
export async function playMusicalIR(ir: MusicalIR, bpm: number, style?: string): Promise<void> {
  await startAudioContext();
  setSandboxAuditionMaster(false); // 成品播放 → 压缩母带(响而受控)
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
let auditionProgram = -1;

/** 试听单音 on:【同步】发声(无 await → noteOn 直接在 MIDI 事件里送进 worklet,延迟最低)。
 *  未就绪则后台启动音频(这一下可能没声,下一下就有);音只在按住时响,松手即停。 */
export function auditionNoteOn(midiNote: number, program: number, velocity = 100): void {
  if (!spessaSynth) { void startAudioContext(); return; }
  setSandboxAuditionMaster(true); // 试听/录入 → 零延迟软削波母带(仅模式变化时换接,无 glitch)
  if (program !== auditionProgram) {
    spessaSynth.programChange(AUDITION_CHANNEL, program);
    spessaSynth.controllerChange(AUDITION_CHANNEL, 7, 127);   // CC7 音量拉满
    spessaSynth.controllerChange(AUDITION_CHANNEL, 11, 127);  // CC11 表情拉满
    spessaSynth.controllerChange(AUDITION_CHANNEL, 91, 14);   // CC91 混响压低 → 干声更近
    spessaSynth.controllerChange(AUDITION_CHANNEL, 10, 64);   // CC10 居中
    auditionProgram = program;
    // ★ 不再强制 CC64=0 —— 延音踏板由 MIDI 输入的 CC64 实时控制(大钢琴随踏板延音),不踩=不糊。
  }
  const v = Math.max(78, Math.min(127, velocity)); // 试听响度兜底(只影响发声,录入真力度不变)
  // ★ 显式 time=currentTime → 立即执行(消除任何默认调度延迟,worklet 下一 quantum 即发声)。
  try { spessaSynth.noteOn(AUDITION_CHANNEL, Math.round(midiNote), v, { time: getAudioContext().currentTime }); }
  catch { spessaSynth.noteOn(AUDITION_CHANNEL, Math.round(midiNote), v); }
}

/** 试听单音 off(踏板抬起时即停;踩下时由合成器延音)。 */
export function auditionNoteOff(midiNote: number): void {
  if (!spessaSynth) return;
  spessaSynth.noteOff(AUDITION_CHANNEL, Math.round(midiNote));
}

/** 试听通道收 CC(MIDI 输入的踏板 CC64 等)→ 大钢琴随【延音踏板】延音。同步、最低延迟。 */
export function auditionControlChange(controller: number, value: number): void {
  if (!spessaSynth) return;
  type CC = Parameters<typeof spessaSynth.controllerChange>[1];
  try { spessaSynth.controllerChange(AUDITION_CHANNEL, Math.round(controller) as CC, Math.round(value)); } catch { /* ignore */ }
}

/** 在用户手势(按钮点击 / 按键)里先解锁 AudioContext。
 *  ★ MIDI 输入【不算手势】,浏览器会保持 AudioContext 挂起 → 试听无声;
 *  必须在真手势里先调一次,之后 MIDI 输入才能即时发声。多次调用安全(SynthManager 串行)。 */
export async function ensureAudio(): Promise<void> {
  await startAudioContext();
  try { const ctx = getAudioContext(); if (ctx && ctx.state === 'suspended') await ctx.resume(); } catch { /* ignore */ }
}

export { setSandboxAuditionMaster } from '../../../audio/SynthManager'; // 离开 Q+R / 成品播放时还原压缩母带

/** 音频系统延迟诊断:base=worklet 处理、output=OS/输出缓冲(含蓝牙)。判断"延迟来自系统还是代码"。 */
export function getAudioLatencyMs(): { base: number; output: number; total: number; sampleRate: number; state: string } | null {
  try {
    const ctx = getAudioContext();
    if (!ctx) return null;
    const base = (ctx.baseLatency || 0) * 1000;
    const output = ((ctx as unknown as { outputLatency?: number }).outputLatency || 0) * 1000;
    return { base, output, total: base + output, sampleRate: ctx.sampleRate, state: ctx.state };
  } catch { return null; }
}

// —— 隐形时钟数拍 click(节拍器,GM 打击通道 9)——
const DRUM_CHANNEL = 9;
/** 数拍节拍器:强拍(beat1)= 高木鱼重、弱拍 = 低木鱼轻(经典节拍器音)。一击即衰减。 */
export async function playClick(strong: boolean): Promise<void> {
  await startAudioContext();
  if (!spessaSynth) return;
  setSandboxAuditionMaster(true); // 数拍 click 也走低延迟母带(录入语境)
  const note = strong ? 76 : 77;            // 76=Hi Wood Block / 77=Low Wood Block = 节拍器
  const vel = strong ? 118 : 80;
  spessaSynth.noteOn(DRUM_CHANNEL, note, vel);
  spessaSynth.noteOff(DRUM_CHANNEL, note);  // 打击乐 noteOff 不切尾,只防挂音
}
