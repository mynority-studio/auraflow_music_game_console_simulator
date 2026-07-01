// ============================================================
// leadTakeoverSandbox · Q+H consumer adapter
// ------------------------------------------------------------
// Minimal bridge from the Q+T sandbox to the current Q+H playback state.
// It consumes AudioEngine-like read/write methods without importing the
// Q+H generation UI or mutating the main generation pipeline.
// ============================================================

import type { MidiEvent } from '../../audio/MidiScheduler';
import type { MusicGenerationResult, MusicGenerationUiSnapshot, UiChord } from '../musicGeneration/types';
import type { LeadTakeoverAction, TakeoverChordSource, TakeoverMusicSnapshot } from './types';

export const TAKEOVER_USER_CHANNEL = 15;
const NATIVE_LEAD_CHANNEL = 1;
const DEFAULT_LEAD_PROGRAM = 73;
const DEFAULT_LEAD_VOLUME = 74;
const DEFAULT_LEAD_PAN = 64;
const DEFAULT_LEAD_REVERB = 36;
const DEFAULT_LEAD_CHORUS = 0;
const DEFAULT_LEAD_EXPRESSION = 127;
const pendingHardMuteTimers = new Map<number, ReturnType<typeof setTimeout>>();
const userVoiceSetupKeys = new WeakMap<object, Map<number, string>>();

export interface LeadTakeoverAudioTarget {
  getCurrentTick(): number;
  getPpq(): number;
  getCurrentMusicGeneration(): MusicGenerationResult | null;
  injectMidiEvent(ev: MidiEvent): void;
  muteChannel?(channel: number, mute: boolean): void;
  noteOn?(channel: number, note: number, velocity: number): void;
  noteOff?(channel: number, note: number): void;
  programChange?(channel: number, program: number): void;
  controllerChange?(channel: number, controller: number, value: number): void;
}

interface LeadVoice {
  program: number;
  volume: number;
  pan: number;
  reverb: number;
  chorus: number;
  expression: number;
}

export interface LeadTakeoverExecuteOptions {
  userChannel?: number;
  nativeLeadChannel?: number;
  hardMuteDelayMs?: number;
}

function clampMidi(v: number): number {
  return Math.max(0, Math.min(127, Math.round(v)));
}

function currentTick(target: LeadTakeoverAudioTarget): number {
  return Math.max(0, Math.ceil(target.getCurrentTick()));
}

function leadVoiceFromResult(result: MusicGenerationResult | null): LeadVoice {
  const leadTrack = result?.ir?.tracks.find((t) => t.role === 'lead');
  const uiLead = result?.uiSnapshot.tracks.find((t) => t.role === 'lead');
  const mix = leadTrack?.mix;
  return {
    program: clampMidi(leadTrack?.program ?? uiLead?.program ?? DEFAULT_LEAD_PROGRAM),
    volume: clampMidi(mix?.volume ?? DEFAULT_LEAD_VOLUME),
    pan: clampMidi(mix?.pan ?? DEFAULT_LEAD_PAN),
    reverb: clampMidi(mix?.reverb ?? DEFAULT_LEAD_REVERB),
    chorus: clampMidi(mix?.chorus ?? DEFAULT_LEAD_CHORUS),
    expression: clampMidi(mix?.expression ?? DEFAULT_LEAD_EXPRESSION),
  };
}

function voiceKey(voice: LeadVoice): string {
  return [
    voice.program,
    voice.volume,
    voice.pan,
    voice.reverb,
    voice.chorus,
    voice.expression,
  ].join(':');
}

function sendProgramChange(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  program: number,
): void {
  if (target.programChange) {
    target.programChange(channel, program);
    return;
  }
  target.injectMidiEvent({ ticks: tick, type: 'programChange', channel, data1: program, data2: 0 });
}

function sendControlChange(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  controller: number,
  value: number,
): void {
  if (target.controllerChange) {
    target.controllerChange(channel, controller, value);
    return;
  }
  target.injectMidiEvent({ ticks: tick, type: 'cc', channel, data1: controller, data2: value });
}

function sendNoteOn(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  midi: number,
  velocity: number,
): void {
  if (target.noteOn) {
    target.noteOn(channel, midi, velocity);
    return;
  }
  target.injectMidiEvent({ ticks: tick, type: 'noteOn', channel, data1: midi, data2: velocity });
}

function sendNoteOff(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  midi: number,
): void {
  if (target.noteOff) {
    target.noteOff(channel, midi);
    return;
  }
  target.injectMidiEvent({ ticks: tick, type: 'noteOff', channel, data1: midi, data2: 0 });
}

function injectVoiceSetup(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  voice: LeadVoice,
): void {
  sendProgramChange(target, tick, channel, voice.program);
  sendControlChange(target, tick, channel, 7, voice.volume);
  sendControlChange(target, tick, channel, 10, voice.pan);
  sendControlChange(target, tick, channel, 91, voice.reverb);
  sendControlChange(target, tick, channel, 93, voice.chorus);
  sendControlChange(target, tick, channel, 11, voice.expression);
}

function ensureUserVoiceSetup(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  voice: LeadVoice,
): void {
  const key = voiceKey(voice);
  let perTarget = userVoiceSetupKeys.get(target as object);
  if (!perTarget) {
    perTarget = new Map();
    userVoiceSetupKeys.set(target as object, perTarget);
  }
  if (perTarget.get(channel) === key) return;
  injectVoiceSetup(target, tick, channel, voice);
  perTarget.set(channel, key);
}

function injectNativeLeadSoftMute(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  muted: boolean,
  voice: LeadVoice,
): void {
  if (muted) {
    sendControlChange(target, tick, channel, 123, 0); // all notes off
    sendControlChange(target, tick, channel, 7, 0);
    sendControlChange(target, tick, channel, 11, 0);
    return;
  }
  sendControlChange(target, tick, channel, 7, voice.volume);
  sendControlChange(target, tick, channel, 11, voice.expression);
}

function hardMuteNativeLeadAfterFlush(
  target: LeadTakeoverAudioTarget,
  channel: number,
  delayMs: number,
): void {
  if (!target.muteChannel) return;
  const existing = pendingHardMuteTimers.get(channel);
  if (existing) clearTimeout(existing);
  const mute = () => target.muteChannel?.(channel, true);
  if (delayMs <= 0) {
    pendingHardMuteTimers.delete(channel);
    mute();
  } else {
    const handle = setTimeout(() => {
      pendingHardMuteTimers.delete(channel);
      mute();
    }, delayMs);
    pendingHardMuteTimers.set(channel, handle);
  }
}

function cancelPendingHardMute(channel: number): void {
  const existing = pendingHardMuteTimers.get(channel);
  if (!existing) return;
  clearTimeout(existing);
  pendingHardMuteTimers.delete(channel);
}

export function resetLeadTakeoverRuntimeState(
  target: LeadTakeoverAudioTarget,
  channels: readonly number[] = [NATIVE_LEAD_CHANNEL],
): void {
  userVoiceSetupKeys.delete(target as object);
  for (const channel of channels) cancelPendingHardMute(channel);
}

function chordTypeFromLabel(chord: UiChord): string {
  const suffix = chord.label.replace(/^[A-G](?:b|#|x)?/, '');
  return suffix || chord.quality;
}

function chordFromUi(c: UiChord): TakeoverChordSource {
  return {
    rootPc: c.rootPc,
    quality: c.quality,
    chordType: chordTypeFromLabel(c),
    roman: c.roman,
    startBeat: c.startBeat,
    durationBeats: c.durationBeats,
    sectionId: c.sectionId,
  };
}

export function takeoverSnapshotFromUiSnapshot(ui: MusicGenerationUiSnapshot): TakeoverMusicSnapshot {
  return {
    styleHint: ui.styleHint,
    key: ui.key,
    tonality: ui.tonality,
    bpm: ui.bpm,
    timeSignature: ui.timeSignature,
    chords: ui.chords.map(chordFromUi),
  };
}

export function takeoverSnapshotFromMusicGeneration(result: MusicGenerationResult): TakeoverMusicSnapshot {
  return takeoverSnapshotFromUiSnapshot(result.uiSnapshot);
}

export function executeLeadTakeoverActions(
  target: LeadTakeoverAudioTarget,
  actions: readonly LeadTakeoverAction[],
  options: LeadTakeoverExecuteOptions = {},
): string[] {
  if (actions.length === 0) return [];

  const userChannel = options.userChannel ?? TAKEOVER_USER_CHANNEL;
  const nativeLeadChannel = options.nativeLeadChannel ?? NATIVE_LEAD_CHANNEL;
  const hardMuteDelayMs = options.hardMuteDelayMs ?? 30;
  const voice = leadVoiceFromResult(target.getCurrentMusicGeneration());
  const baseTick = currentTick(target) + 1;
  const logs: string[] = [];

  for (const action of actions) {
    if (action.type === 'lead-note-on') {
      ensureUserVoiceSetup(target, baseTick, userChannel, voice);
      sendNoteOn(target, baseTick + 1, userChannel, action.midi, clampMidi(action.velocity));
      logs.push(`takeover noteOn ch${userChannel} ${action.midi} v${clampMidi(action.velocity)}`);
    } else if (action.type === 'lead-note-off') {
      sendNoteOff(target, baseTick, userChannel, action.midi);
      logs.push(`takeover noteOff ch${userChannel} ${action.midi}`);
    } else if (action.type === 'lead-mute') {
      if (!action.muted) {
        cancelPendingHardMute(nativeLeadChannel);
        target.muteChannel?.(nativeLeadChannel, false);
      }
      injectNativeLeadSoftMute(target, baseTick, nativeLeadChannel, action.muted, voice);
      if (action.muted) hardMuteNativeLeadAfterFlush(target, nativeLeadChannel, hardMuteDelayMs);
      logs.push(`${action.muted ? 'hardMute' : 'restore'} native lead ch${nativeLeadChannel}`);
    } else {
      sendControlChange(target, baseTick, userChannel, 123, 0);
      logs.push(`panic takeover ch${userChannel}`);
    }
  }
  return logs;
}
