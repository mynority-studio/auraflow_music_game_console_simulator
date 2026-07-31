// ============================================================
// newEngine · sandbox · 发声出口
// ------------------------------------------------------------
// 沙盒唯一与音频系统接触的点:MusicalIR → MidiEvent[] → globalMidiScheduler → 发声。
// 复用【中立】音频回放层(src/core/audio),不碰任何旧引擎(自包含)。
// newEngine 引擎核心仍 0 import 音频;只有这个 sandbox 文件 import 它(harness)。
// ============================================================

import { globalMidiScheduler } from '../../../audio/MidiScheduler';
import { AudioEngine, startAudioContext } from '../../../audio/AudioEngine';
import { Dream5504MidiOutput } from '../../../audio/Dream5504MidiOutput';
import { applyPopFiveTrackMidiGuard } from '../../../audio/popFiveTrackMidiGuard';
import { mapProgramToDream5504 } from '../../../sound/GMBK5X128Voices';
import type { MusicGenerationResult } from '../../musicGeneration/types';
import { getMidiInputExclusiveOwner } from '../../motifSandbox/midi/webMidi';
import type { InstrumentRole, MusicalIR } from '../ir/MusicalIR';
import { musicalIRToMidiEvents, ROLE_CHANNEL } from './irToMidi';
import { roomWetFor } from './mixProfile';
import { resolveAudibleRoles } from './pianoRoll';

/** ★ sandbox 试听/预听出口(audition/preview,非成品主链路)。成品完整成曲统一走
 *  AudioEngine.playMusicGeneration;此函数仅供 Motif 沙盒 lead-only 预听等诊断预听。
 *  会先确保 Dream 5504 MIDI 输出已开启。style → 共享房间混响湿度。 */
export async function auditionMusicalIR(ir: MusicalIR, bpm: number, style?: string): Promise<void> {
  await startAudioContext();
  const outputStyle = style ?? 'default';
  const events = applyPopFiveTrackMidiGuard(musicalIRToMidiEvents(ir, roomWetFor(outputStyle), outputStyle), outputStyle);
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
const DEFAULT_AUDITION_BANK = 0;

/** Dream 5504 melodic voices are addressed by the complete CC0 + Program pair. */
export interface DreamAuditionVoice {
  bank: number;
  program: number;
}

type AuditionVoiceInput = number | DreamAuditionVoice;

let auditionVoiceKey = '';

function clamp7(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)));
}

function normalizeAuditionVoice(input: AuditionVoiceInput): DreamAuditionVoice {
  if (typeof input === 'number') {
    return { bank: DEFAULT_AUDITION_BANK, program: clamp7(input) };
  }
  return { bank: clamp7(input.bank), program: clamp7(input.program) };
}

/**
 * The external-MIDI audition must use exactly the voice currently selected for
 * the generated song's lead. It deliberately reads the IR first: user voice
 * overrides update that source before replay, while the UI projection is only
 * a display snapshot. No active song falls back to the caller's lead preset.
 */
export function resolveCurrentLeadAuditionVoice(
  result: MusicGenerationResult | null,
  fallbackProgram = 0,
): DreamAuditionVoice {
  const style = result?.styleHint ?? result?.uiSnapshot.styleHint;
  const irLead = result?.ir?.tracks.find((track) => track.role === 'lead');
  const uiLead = result?.uiSnapshot.tracks.find((track) => track.role === 'lead');
  const rawProgram = irLead?.program ?? uiLead?.program ?? fallbackProgram;
  const bank = irLead?.bank ?? uiLead?.bank ?? DEFAULT_AUDITION_BANK;
  return {
    bank: clamp7(bank),
    program: mapProgramToDream5504(rawProgram, 'lead', style),
  };
}

/** Resolve the live song's selected lead address for raw external MIDI input. */
export function currentLeadAuditionVoice(fallbackProgram = 0): DreamAuditionVoice {
  return resolveCurrentLeadAuditionVoice(AudioEngine.getCurrentMusicGeneration(), fallbackProgram);
}

function isRawMidiAuditionBlocked(): boolean {
  return getMidiInputExclusiveOwner() === 'takeover';
}

/**
 * Q+T claims external MIDI as a position controller. Clear any note left by
 * Q+R's raw-pitch audition before the takeover mapper is allowed to speak.
 */
export function silenceRawMidiAudition(): void {
  AudioEngine.controllerChange(AUDITION_CHANNEL, 64, 0);
  AudioEngine.controllerChange(AUDITION_CHANNEL, 123, 0);
  AudioEngine.controllerChange(AUDITION_CHANNEL, 120, 0);
  auditionVoiceKey = '';
}

/** 试听单音 on:【同步】发声(无 await → noteOn 直接在 MIDI 事件里送进 worklet,延迟最低)。
 *  每次换音色都先在专用 MIDI ch16 写入 CC0 + PC，随后才送 noteOn。
 *  未就绪则后台启动音频(这一下可能没声,下一下就有);音只在按住时响,松手即停。 */
export function auditionNoteOn(midiNote: number, voiceInput: AuditionVoiceInput, velocity = 100): void {
  if (isRawMidiAuditionBlocked()) return;
  const voice = normalizeAuditionVoice(voiceInput);
  const nextVoiceKey = `${voice.bank}:${voice.program}`;
  if (nextVoiceKey !== auditionVoiceKey) {
    // A dedicated channel prevents this reset from touching the five song
    // tracks. The order matches the Dream safe-switch sequence.
    AudioEngine.controllerChange(AUDITION_CHANNEL, 64, 0);
    AudioEngine.controllerChange(AUDITION_CHANNEL, 123, 0);
    AudioEngine.controllerChange(AUDITION_CHANNEL, 121, 0);
    AudioEngine.controllerChange(AUDITION_CHANNEL, 0, voice.bank);
    AudioEngine.programChange(AUDITION_CHANNEL, voice.program);
    auditionVoiceKey = nextVoiceKey;
  }
  const v = Math.max(78, Math.min(127, velocity)); // 试听响度兜底(只影响发声,录入真力度不变)
  AudioEngine.noteOn(AUDITION_CHANNEL, Math.round(midiNote), v);
}

/** 试听单音 off(踏板抬起时即停;踩下时由合成器延音)。 */
export function auditionNoteOff(midiNote: number): void {
  if (isRawMidiAuditionBlocked()) return;
  AudioEngine.noteOff(AUDITION_CHANNEL, Math.round(midiNote));
}

/** 试听通道透传来自控制器的 CC（例如钢琴专属的 CC64）。同步、最低延迟。 */
export function auditionControlChange(controller: number, value: number): void {
  if (isRawMidiAuditionBlocked()) return;
  AudioEngine.controllerChange(AUDITION_CHANNEL, Math.round(controller), Math.round(value));
}

/** 在用户手势(按钮点击 / 按键)里确认 Dream 5504 MIDI 输出已连接。
 *  ★ 浏览器不再本地发声;未连接硬件时保持静音并由输出层提示。 */
export async function ensureAudio(): Promise<void> {
  await startAudioContext();
}

export const setSandboxAuditionMaster = (_low: boolean): void => { /* MIDI-only: no browser master bus. */ };

/** 音频系统延迟诊断:base=worklet 处理、output=OS/输出缓冲(含蓝牙)。判断"延迟来自系统还是代码"。 */
export function getAudioLatencyMs(): { base: number; output: number; total: number; sampleRate: number; state: string } | null {
  const state = Dream5504MidiOutput.getState();
  return { base: 0, output: 0, total: 0, sampleRate: 0, state: state.armed ? 'dream5504-midi-on' : 'dream5504-midi-silent' };
}

// —— 隐形时钟数拍 click(节拍器,GM 打击通道 9)——
const DRUM_CHANNEL = 9;
/** 数拍节拍器:强拍(beat1)= 高木鱼重、弱拍 = 低木鱼轻(经典节拍器音)。一击即衰减。 */
export async function playClick(strong: boolean): Promise<void> {
  await startAudioContext();
  const note = strong ? 76 : 77;            // 76=Hi Wood Block / 77=Low Wood Block = 节拍器
  const vel = strong ? 118 : 80;
  AudioEngine.noteOn(DRUM_CHANNEL, note, vel);
  AudioEngine.noteOff(DRUM_CHANNEL, note);
}

/** ★ 录入捕获窗满(4 小节)提示音:三角铁 ding(亮、金属、ring → 区别于 wood block click),
 *  让用户听到"motif 取这前 4 小节"的边界。打击乐 noteOff 不切尾 → 自然 ring。 */
export async function playCue(): Promise<void> {
  await startAudioContext();
  AudioEngine.noteOn(DRUM_CHANNEL, 81, 122);
  AudioEngine.noteOff(DRUM_CHANNEL, 81);
}
