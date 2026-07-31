// ============================================================
// leadTakeoverSandbox · Q+H consumer adapter
// ------------------------------------------------------------
// Minimal bridge from the Q+T sandbox to the current Q+H playback state.
// It consumes AudioEngine-like read/write methods without importing the
// Q+H generation UI or mutating the main generation pipeline.
// ============================================================

import type { MidiEvent, MidiNoteRange, MidiNoteTarget } from '../../audio/MidiScheduler';
import { isAcousticPianoVoice, mapProgramToDream5504 } from '../../sound/GMBK5X128Voices';
import type { MusicGenerationResult, MusicGenerationUiSnapshot, UiChord, UiGrooveContract } from '../musicGeneration/types';
import { fitMidiToProgramRange } from '../newEngine/knowledge/instruments';
import { DREAM5504_DEFAULT_CHANNEL_VOLUME } from '../newEngine/knowledge/gmMixProfile';
import {
  TAKEOVER_UPLOADED_BACKING_GAIN_SCALE,
  type LeadTakeoverAction,
  type TakeoverChordSource,
  type TakeoverGrooveContract,
  type TakeoverMusicSnapshot,
} from './types';
import { getTakeoverLeadVoiceSelection } from './takeoverVoiceSelection';

export const TAKEOVER_USER_CHANNEL = 15;
export const NATIVE_LEAD_CHANNEL = 1;
const DEFAULT_LEAD_BANK = 0;
const DEFAULT_LEAD_PROGRAM = 0;
const DEFAULT_LEAD_VOLUME = DREAM5504_DEFAULT_CHANNEL_VOLUME;
const DEFAULT_LEAD_EXPRESSION = 127;
const CC_SUSTAIN_PEDAL = 64;
const CC_DELAY_SEND = 95;
const CC_BANK_MSB = 0;
const CC_RESET_ALL_CONTROLLERS = 121;
// Queue the full default snap window in Web MIDI instead of main-thread timers.
const TAKEOVER_AUDIO_SCHEDULE_LOOKAHEAD_MS = 60;
const TAKEOVER_SIMULTANEOUS_NOTE_WINDOW_MS = 24;
const TAKEOVER_PIANO_PEDAL_PEAK = 72;
const TAKEOVER_PIANO_PEDAL_MID = 46;
const TAKEOVER_PIANO_PEDAL_MID_MS = 22;
const TAKEOVER_PIANO_PEDAL_END_MS = 56;
const MAX_TAKEOVER_TRACKED_NOTES = 32;
const pendingHardMuteTimers = new Map<number, ReturnType<typeof setTimeout>>();
const userVoiceSetupKeys = new WeakMap<object, Map<number, string>>();
const pendingNoteTimers = new WeakMap<object, Map<string, PendingTakeoverNote>>();
const activeNoteCounts = new WeakMap<object, Map<string, number>>();
const activeNoteOnTimes = new WeakMap<object, Map<string, number>>();
const leadVoiceTimelineStates = new WeakMap<object, LeadVoiceTimelineState>();

export interface LeadTakeoverAudioTarget {
  getCurrentTick(): number;
  getPpq(): number;
  getCurrentMusicGeneration(): MusicGenerationResult | null;
  injectMidiEvent(ev: MidiEvent): void;
  muteChannel?(channel: number, mute: boolean): void;
  muteChannelGracefully?(channel: number, mute: boolean): void;
  isChannelMuted?(channel: number): boolean;
  muteNoteRange?(channel: number, range: MidiNoteRange, mute: boolean): void;
  isNoteRangeMuted?(channel: number, range: MidiNoteRange): boolean;
  muteNoteTargets?(targets: ReadonlyArray<MidiNoteTarget>, mute: boolean): void;
  muteNoteTargetsGracefully?(targets: ReadonlyArray<MidiNoteTarget>, mute: boolean): void;
  areNoteTargetsMuted?(targets: ReadonlyArray<MidiNoteTarget>): boolean;
  setUploadedMidiGainScale?(scale: number): void;
  getUploadedMidiGainScale?(): number;
  noteOn?(channel: number, note: number, velocity: number): void;
  noteOff?(channel: number, note: number): void;
  getAudioTime?(): number;
  noteOnAt?(channel: number, note: number, velocity: number, audioTime: number): void;
  noteOffAt?(channel: number, note: number, audioTime: number): void;
  programChange?(channel: number, program: number): void;
  controllerChange?(channel: number, controller: number, value: number): void;
  controllerChangeAt?(channel: number, controller: number, value: number, audioTime: number): void;
}

interface LeadVoice {
  bank: number;
  program: number;
  volume: number;
  expression: number;
  acousticPiano: boolean;
}

interface LeadVoiceTimelineState {
  tick: number;
  programIndex: number;
  bank: number;
  rawProgram: number;
}

interface PendingTakeoverNote {
  noteOnTimer: ReturnType<typeof setTimeout> | null;
  noteOffTimer: ReturnType<typeof setTimeout> | null;
  started: boolean;
  releaseWhenStarted: boolean;
  channel: number;
  noteId?: string;
  midi: number;
  velocity: number;
  scheduledNoteOnAudioTime: number | null;
  acousticPiano: boolean;
}

export interface LeadTakeoverExecuteOptions {
  userChannel?: number;
  nativeLeadChannel?: number;
  nativeLeadNoteRange?: MidiNoteRange | null;
  nativeLeadNoteTargets?: ReadonlyArray<MidiNoteTarget> | null;
  nativeLeadRouting?: 'generated' | 'uploaded';
  hardMuteDelayMs?: number;
}

export function reconcileNativeLeadMute(
  target: LeadTakeoverAudioTarget,
  leadMuted: boolean,
  nativeLeadChannel = NATIVE_LEAD_CHANNEL,
  nativeLeadNoteRange: MidiNoteRange | null = null,
  nativeLeadNoteTargets: ReadonlyArray<MidiNoteTarget> | null = null,
): LeadTakeoverAction[] {
  if (!leadMuted) return [];
  if (nativeLeadNoteTargets && nativeLeadNoteTargets.length > 0) {
    if (!target.areNoteTargetsMuted
        || target.areNoteTargetsMuted(nativeLeadNoteTargets)) return [];
    return [{ type: 'lead-mute', channel: nativeLeadChannel, muted: true }];
  }
  if (nativeLeadNoteRange) {
    if (!target.isNoteRangeMuted
        || target.isNoteRangeMuted(nativeLeadChannel, nativeLeadNoteRange)) return [];
    return [{ type: 'lead-mute', channel: nativeLeadChannel, muted: true }];
  }
  if (!target.isChannelMuted || target.isChannelMuted(nativeLeadChannel)) return [];
  return [{ type: 'lead-mute', channel: nativeLeadChannel, muted: true }];
}

export function reconcileUploadedMidiGain(
  target: LeadTakeoverAudioTarget,
  backingDucked: boolean,
): LeadTakeoverAction[] {
  if (!backingDucked || !target.getUploadedMidiGainScale) return [];
  return Math.abs(
    target.getUploadedMidiGainScale() - TAKEOVER_UPLOADED_BACKING_GAIN_SCALE,
  ) < 1e-6
    ? []
    : [{ type: 'backing-gain', scale: TAKEOVER_UPLOADED_BACKING_GAIN_SCALE }];
}

function clampMidi(v: number): number {
  return Math.max(0, Math.min(127, Math.round(v)));
}

function currentTick(target: LeadTakeoverAudioTarget): number {
  return Math.max(0, Math.ceil(target.getCurrentTick()));
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function scheduledAudioTime(target: LeadTakeoverAudioTarget, remainingMs: number): number | null {
  if (!target.getAudioTime) return null;
  return target.getAudioTime() + Math.max(0, remainingMs) / 1000;
}

function canScheduleNoteOnAt(target: LeadTakeoverAudioTarget): boolean {
  return !!target.getAudioTime && !!target.noteOnAt;
}

function canScheduleNoteOffAt(target: LeadTakeoverAudioTarget): boolean {
  return !!target.getAudioTime && !!target.noteOffAt;
}

function delayedTimerMs(delayMs: number, useAudioClock: boolean): number {
  return Math.max(0, delayMs - (useAudioClock ? TAKEOVER_AUDIO_SCHEDULE_LOOKAHEAD_MS : 0));
}

function scheduleAhead(
  callback: () => void,
  delayMs: number,
  useAudioClock: boolean,
): ReturnType<typeof setTimeout> | null {
  const timerMs = delayedTimerMs(delayMs, useAudioClock);
  if (timerMs <= 0) {
    callback();
    return null;
  }
  return setTimeout(callback, timerMs);
}


function initialLeadVoiceTimelineState(result: MusicGenerationResult): LeadVoiceTimelineState {
  const leadTrack = result.ir?.tracks.find((track) => track.role === 'lead');
  const uiLead = result.uiSnapshot.tracks.find((track) => track.role === 'lead');
  return {
    tick: Number.NEGATIVE_INFINITY,
    programIndex: 0,
    bank: clampMidi(leadTrack?.bank ?? uiLead?.bank ?? DEFAULT_LEAD_BANK),
    rawProgram: clampMidi(leadTrack?.program ?? uiLead?.program ?? DEFAULT_LEAD_PROGRAM),
  };
}

function leadVoiceFromResult(result: MusicGenerationResult | null, tick: number): LeadVoice {
  if (!result) {
    return {
      bank: DEFAULT_LEAD_BANK,
      program: DEFAULT_LEAD_PROGRAM,
      volume: DEFAULT_LEAD_VOLUME,
      expression: DEFAULT_LEAD_EXPRESSION,
      acousticPiano: true,
    };
  }

  const leadTrack = result.ir?.tracks.find((track) => track.role === 'lead');
  const style = result.styleHint ?? result.uiSnapshot.styleHint;
  let timeline = leadVoiceTimelineStates.get(result as object);
  if (!timeline || tick < timeline.tick) {
    timeline = initialLeadVoiceTimelineState(result);
    leadVoiceTimelineStates.set(result as object, timeline);
  }

  const programChanges = leadTrack?.programChanges ?? [];
  while (timeline.programIndex < programChanges.length) {
    const change = programChanges[timeline.programIndex];
    if ((change.atTick as number) > tick) break;
    timeline.bank = clampMidi(change.bank ?? timeline.bank);
    timeline.rawProgram = clampMidi(change.program);
    timeline.programIndex += 1;
  }

  timeline.tick = tick;

  const program = mapProgramToDream5504(timeline.rawProgram, 'lead', style);
  return {
    bank: timeline.bank,
    program,
    // Takeover shares the current instrument, not the generated score's mix.
    // Keep the takeover and native restore state at Firm5504 defaults.
    volume: DEFAULT_LEAD_VOLUME,
    expression: DEFAULT_LEAD_EXPRESSION,
    acousticPiano: isAcousticPianoVoice(timeline.bank, timeline.rawProgram),
  };
}

function takeoverVoiceFromResult(result: MusicGenerationResult | null, tick: number): LeadVoice {
  const nativeVoice = leadVoiceFromResult(result, tick);
  const selected = getTakeoverLeadVoiceSelection();
  if (!selected) return nativeVoice;
  const bank = clampMidi(selected.bank ?? DEFAULT_LEAD_BANK);
  const rawProgram = clampMidi(selected.program);
  const style = result?.styleHint ?? result?.uiSnapshot.styleHint;
  return {
    ...nativeVoice,
    bank,
    program: mapProgramToDream5504(rawProgram, 'lead', style),
    expression: DEFAULT_LEAD_EXPRESSION,
    acousticPiano: isAcousticPianoVoice(bank, rawProgram),
  };
}

function voiceKey(voice: LeadVoice): string {
  return [
    voice.bank,
    voice.program,
    voice.volume,
    voice.expression,
    voice.acousticPiano ? 1 : 0,
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
  audioTime: number | null = null,
): void {
  if (audioTime !== null && target.controllerChangeAt) {
    target.controllerChangeAt(channel, controller, value, audioTime);
    return;
  }
  if (target.controllerChange) {
    target.controllerChange(channel, controller, value);
    return;
  }
  target.injectMidiEvent({ ticks: tick, type: 'cc', channel, data1: controller, data2: value });
}

function sendPianoReleaseEnvelope(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  audioTime: number | null,
): void {
  const releaseTime = audioTime ?? target.getAudioTime?.() ?? null;
  if (releaseTime === null) {
    // Headless/fallback targets have no audio clock; preserve the state
    // transition without creating unbounded wall-clock timers.
    sendControlChange(target, tick, channel, CC_SUSTAIN_PEDAL, TAKEOVER_PIANO_PEDAL_PEAK);
    sendControlChange(target, tick, channel, CC_SUSTAIN_PEDAL, TAKEOVER_PIANO_PEDAL_MID);
    sendControlChange(target, tick, channel, CC_SUSTAIN_PEDAL, 0);
    return;
  }
  sendControlChange(target, tick, channel, CC_SUSTAIN_PEDAL, TAKEOVER_PIANO_PEDAL_PEAK, releaseTime);
  sendControlChange(
    target,
    tick,
    channel,
    CC_SUSTAIN_PEDAL,
    TAKEOVER_PIANO_PEDAL_MID,
    releaseTime + TAKEOVER_PIANO_PEDAL_MID_MS / 1000,
  );
  sendControlChange(
    target,
    tick,
    channel,
    CC_SUSTAIN_PEDAL,
    0,
    releaseTime + TAKEOVER_PIANO_PEDAL_END_MS / 1000,
  );
}

function sendNoteOn(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  midi: number,
  velocity: number,
  audioTime: number | null = null,
): void {
  if (audioTime !== null && target.noteOnAt) {
    target.noteOnAt(channel, midi, velocity, audioTime);
    return;
  }
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
  audioTime: number | null = null,
): void {
  if (audioTime !== null && target.noteOffAt) {
    target.noteOffAt(channel, midi, audioTime);
    return;
  }
  if (target.noteOff) {
    target.noteOff(channel, midi);
    return;
  }
  target.injectMidiEvent({ ticks: tick, type: 'noteOff', channel, data1: midi, data2: 0 });
}

function fitTakeoverMidiForVoice(midi: number, voice: LeadVoice): number {
  return fitMidiToProgramRange(clampMidi(midi), 'lead', voice.program);
}

function logMidi(original: number, fitted: number): string {
  return original === fitted ? `${fitted}` : `${original}→${fitted}`;
}

function midiKey(channel: number, midi: number): string {
  return `${channel}:${midi}`;
}

function pendingKey(channel: number, midi: number, noteId?: string): string {
  return noteId ? `${channel}:${midi}:${noteId}` : midiKey(channel, midi);
}

function pendingNotesFor(target: LeadTakeoverAudioTarget): Map<string, PendingTakeoverNote> {
  let notes = pendingNoteTimers.get(target as object);
  if (!notes) {
    notes = new Map();
    pendingNoteTimers.set(target as object, notes);
  }
  return notes;
}

function findPendingNote(
  notes: Map<string, PendingTakeoverNote>,
  channel: number,
  midi: number,
  noteId?: string,
): { key: string; note: PendingTakeoverNote } | null {
  const exactKey = pendingKey(channel, midi, noteId);
  const exact = notes.get(exactKey);
  if (exact) return { key: exactKey, note: exact };
  if (!noteId) return null;

  for (const [key, note] of notes) {
    if (note.channel === channel && note.noteId === noteId) return { key, note };
  }
  return null;
}

function activeNotesFor(target: LeadTakeoverAudioTarget): Map<string, number> {
  let notes = activeNoteCounts.get(target as object);
  if (!notes) {
    notes = new Map();
    activeNoteCounts.set(target as object, notes);
  }
  return notes;
}

function activeNoteOnTimesFor(target: LeadTakeoverAudioTarget): Map<string, number> {
  let times = activeNoteOnTimes.get(target as object);
  if (!times) {
    times = new Map();
    activeNoteOnTimes.set(target as object, times);
  }
  return times;
}

function intendedNoteOnTime(target: LeadTakeoverAudioTarget, audioTime: number | null): number {
  if (audioTime !== null) return audioTime;
  return target.getAudioTime?.() ?? nowMs() / 1000;
}

function shouldSendTrackedNoteOff(target: LeadTakeoverAudioTarget, channel: number, midi: number): boolean {
  const notes = activeNoteCounts.get(target as object);
  if (!notes) return true;
  const key = midiKey(channel, midi);
  const current = notes.get(key);
  if (current === undefined) return true;
  if (current > 1) {
    notes.set(key, current - 1);
    return false;
  }
  notes.delete(key);
  if (notes.size === 0) activeNoteCounts.delete(target as object);
  const times = activeNoteOnTimes.get(target as object);
  times?.delete(key);
  if (times?.size === 0) activeNoteOnTimes.delete(target as object);
  return true;
}

function sendTrackedNoteOn(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  midi: number,
  velocity: number,
  audioTime: number | null = null,
): void {
  const notes = activeNotesFor(target);
  const times = activeNoteOnTimesFor(target);
  const key = midiKey(channel, midi);
  const activeCount = notes.get(key) ?? 0;
  const onsetTime = intendedNoteOnTime(target, audioTime);
  const previousOnsetTime = times.get(key);
  const sequentialReattack = activeCount > 0
    && previousOnsetTime !== undefined
    && (onsetTime - previousOnsetTime) * 1000 > TAKEOVER_SIMULTANEOUS_NOTE_WINDOW_MS;

  if (sequentialReattack) {
    // One physical voice represents one pitch. Re-articulate sequential presses
    // with a matched Off/On pair; simultaneous duplicate pads share that voice.
    sendNoteOff(target, tick, channel, midi, audioTime);
    sendNoteOn(target, tick, channel, midi, velocity, audioTime);
  } else if (activeCount === 0) {
    sendNoteOn(target, tick, channel, midi, velocity, audioTime);
  }

  notes.set(key, activeCount + 1);
  times.set(key, onsetTime);
}

function sendTrackedNoteOff(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  midi: number,
  audioTime: number | null = null,
  pianoRelease = false,
): void {
  if (shouldSendTrackedNoteOff(target, channel, midi)) {
    if (pianoRelease) sendPianoReleaseEnvelope(target, tick, channel, audioTime);
    sendNoteOff(target, tick, channel, midi, audioTime);
  }
}

function clearPendingNote(note: PendingTakeoverNote): void {
  if (note.noteOnTimer) clearTimeout(note.noteOnTimer);
  if (note.noteOffTimer) clearTimeout(note.noteOffTimer);
  note.noteOnTimer = null;
  note.noteOffTimer = null;
}

function releasePendingNote(
  target: LeadTakeoverAudioTarget,
  tick: number,
  note: PendingTakeoverNote,
  expressiveRelease = false,
): void {
  clearPendingNote(note);
  if (!note.started) return;

  const nowAudioTime = target.getAudioTime?.() ?? null;
  const futureNoteOnTime = note.scheduledNoteOnAudioTime !== null
    && nowAudioTime !== null
    && note.scheduledNoteOnAudioTime > nowAudioTime;
  const releaseAudioTime = futureNoteOnTime ? note.scheduledNoteOnAudioTime + 0.01 : null;
  sendTrackedNoteOff(
    target,
    tick,
    note.channel,
    note.midi,
    releaseAudioTime,
    expressiveRelease && note.acousticPiano,
  );
}

function flushTrackedTakeoverNotes(
  target: LeadTakeoverAudioTarget,
  tick: number,
  userChannel: number,
): void {
  const notes = pendingNoteTimers.get(target as object);
  if (notes) {
    for (const note of notes.values()) releasePendingNote(target, tick, note);
    notes.clear();
    pendingNoteTimers.delete(target as object);
  }
  sendControlChange(target, tick, userChannel, CC_SUSTAIN_PEDAL, 0);
  sendControlChange(target, tick, userChannel, CC_DELAY_SEND, 0);
  sendControlChange(target, tick, userChannel, 123, 0);
  sendControlChange(target, tick, userChannel, 120, 0);
  userVoiceSetupKeys.get(target as object)?.delete(userChannel);
  activeNoteCounts.delete(target as object);
  activeNoteOnTimes.delete(target as object);
}

function enforceTrackedNoteLimit(
  target: LeadTakeoverAudioTarget,
  tick: number,
  userChannel: number,
): void {
  const notes = pendingNoteTimers.get(target as object);
  if (!notes || notes.size <= MAX_TAKEOVER_TRACKED_NOTES) return;
  flushTrackedTakeoverNotes(target, tick, userChannel);
}

function scheduleDelayedNoteOn(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  midi: number,
  velocity: number,
  delayMs: number,
  voice: LeadVoice,
  noteId?: string,
): void {
  const notes = pendingNotesFor(target);
  const key = pendingKey(channel, midi, noteId);
  const requestedAtMs = nowMs();
  const useAudioClock = canScheduleNoteOnAt(target);
  const existing = notes.get(key);
  if (existing) {
    releasePendingNote(target, tick, existing);
    notes.delete(key);
  }

  const pending: PendingTakeoverNote = {
    noteOnTimer: null,
    noteOffTimer: null,
    started: false,
    releaseWhenStarted: false,
    channel,
    noteId,
    midi,
    velocity,
    scheduledNoteOnAudioTime: null,
    acousticPiano: voice.acousticPiano,
  };

  pending.noteOnTimer = scheduleAhead(() => {
    const remainingMs = Math.max(0, delayMs - (nowMs() - requestedAtMs));
    const audioTime = scheduledAudioTime(target, remainingMs);
    pending.noteOnTimer = null;
    pending.started = true;
    pending.scheduledNoteOnAudioTime = audioTime;
    ensureUserVoiceSetup(target, tick, channel, voice);
    sendTrackedNoteOn(target, tick + 1, channel, midi, velocity, audioTime);
    if (pending.releaseWhenStarted) {
      sendTrackedNoteOff(target, tick + 1, channel, midi, audioTime, pending.acousticPiano);
      notes.delete(key);
    }
  }, delayMs, useAudioClock);

  notes.set(key, pending);
  enforceTrackedNoteLimit(target, tick, channel);
}

function sendImmediateTrackedNoteOn(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  midi: number,
  velocity: number,
  voice: LeadVoice,
  noteId?: string,
): void {
  const notes = pendingNotesFor(target);
  const key = pendingKey(channel, midi, noteId);
  const existing = notes.get(key);
  if (existing) {
    releasePendingNote(target, tick, existing);
    notes.delete(key);
  }
  ensureUserVoiceSetup(target, tick, channel, voice);
  sendTrackedNoteOn(target, tick + 1, channel, midi, velocity);
  notes.set(key, {
    noteOnTimer: null,
    noteOffTimer: null,
    started: true,
    releaseWhenStarted: false,
    channel,
    noteId,
    midi,
    velocity,
    scheduledNoteOnAudioTime: null,
    acousticPiano: voice.acousticPiano,
  });
  enforceTrackedNoteLimit(target, tick, channel);
}

function scheduleDelayedNoteOff(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  midi: number,
  delayMs: number,
  acousticPiano: boolean,
  noteId?: string,
): number {
  const notes = pendingNotesFor(target);
  const matched = findPendingNote(notes, channel, midi, noteId);
  const key = matched?.key ?? pendingKey(channel, midi, noteId);
  const requestedAtMs = nowMs();
  const useAudioClock = canScheduleNoteOffAt(target);
  const note = matched?.note ?? {
    noteOnTimer: null,
    noteOffTimer: null,
    started: true,
    releaseWhenStarted: false,
    channel,
    noteId,
    midi,
    velocity: 0,
    scheduledNoteOnAudioTime: null,
    acousticPiano,
  };
  if (!matched) {
    notes.set(key, note);
  }
  if (note.noteOffTimer) clearTimeout(note.noteOffTimer);
  note.noteOffTimer = scheduleAhead(() => {
    const remainingMs = Math.max(0, delayMs - (nowMs() - requestedAtMs));
    const audioTime = scheduledAudioTime(target, remainingMs);
    note.noteOffTimer = null;
    if (note.started) {
      sendTrackedNoteOff(target, tick, note.channel, note.midi, audioTime, note.acousticPiano);
      notes.delete(key);
    } else {
      note.releaseWhenStarted = true;
    }
  }, delayMs, useAudioClock);
  return note.midi;
}

function releaseDelayedOrStartedNote(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  midi: number,
  noteId?: string,
): boolean {
  const notes = pendingNoteTimers.get(target as object);
  if (!notes) return false;

  if (!noteId) {
    let released = false;
    const midiPrefix = `${midiKey(channel, midi)}:`;
    for (const [key, note] of [...notes.entries()]) {
      if (key !== midiKey(channel, midi) && !key.startsWith(midiPrefix)) continue;
      if (!note.started) {
        clearPendingNote(note);
      } else {
        releasePendingNote(target, tick, note, true);
      }
      notes.delete(key);
      released = true;
    }
    if (notes.size === 0) pendingNoteTimers.delete(target as object);
    return released;
  }

  const matched = findPendingNote(notes, channel, midi, noteId);
  if (!matched) return false;
  const { key, note } = matched;
  if (!note.started) {
    clearPendingNote(note);
    notes.delete(key);
    if (notes.size === 0) pendingNoteTimers.delete(target as object);
    return true;
  }
  releasePendingNote(target, tick, note, true);
  notes.delete(key);
  if (notes.size === 0) pendingNoteTimers.delete(target as object);
  return true;
}

function injectVoiceSetup(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  voice: LeadVoice,
): void {
  sendControlChange(target, tick, channel, CC_RESET_ALL_CONTROLLERS, 0);
  sendControlChange(target, tick, channel, CC_BANK_MSB, voice.bank);
  sendProgramChange(target, tick, channel, voice.program);
  sendControlChange(target, tick, channel, CC_SUSTAIN_PEDAL, 0);
  sendControlChange(target, tick, channel, 7, voice.volume);
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

export function prepareLeadTakeoverVoice(
  target: LeadTakeoverAudioTarget,
  userChannel = TAKEOVER_USER_CHANNEL,
): void {
  const tick = currentTick(target) + 1;
  const voice = takeoverVoiceFromResult(target.getCurrentMusicGeneration(), tick);
  ensureUserVoiceSetup(target, tick, userChannel, voice);
}

function injectNativeLeadSoftMute(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  muted: boolean,
  voice: LeadVoice,
): void {
  if (muted) {
    sendControlChange(target, tick, channel, CC_SUSTAIN_PEDAL, 0);
    sendControlChange(target, tick, channel, 123, 0); // all notes off
    sendControlChange(target, tick, channel, CC_DELAY_SEND, 0);
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
  flushTrackedTakeoverNotes(target, currentTick(target) + 1, TAKEOVER_USER_CHANNEL);
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

function grooveContractFromUi(c: UiGrooveContract | undefined): TakeoverGrooveContract | undefined {
  if (!c) return undefined;
  return {
    id: c.id,
    name: c.name,
    grid: c.grid,
    melodySwingRatio: c.melodySwingRatio,
    melodyStrongPocketMs: c.melodyStrongPocketMs,
    melodyWeakPocketMs: c.melodyWeakPocketMs,
    accentPattern: c.accentPattern,
  };
}

export function takeoverSnapshotFromUiSnapshot(ui: MusicGenerationUiSnapshot): TakeoverMusicSnapshot {
  const grooveContract = grooveContractFromUi(ui.grooveContract);
  const grooveContractBySection = ui.grooveContractBySection
    ? Object.fromEntries(Object.entries(ui.grooveContractBySection).map(([sectionId, contract]) => [sectionId, grooveContractFromUi(contract)!]))
    : undefined;
  return {
    styleHint: ui.styleHint,
    key: ui.key,
    tonality: ui.tonality,
    bpm: ui.bpm,
    timeSignature: ui.timeSignature,
    chords: ui.chords.map(chordFromUi),
    ...(grooveContract ? { grooveContract } : {}),
    ...(grooveContractBySection ? { grooveContractBySection } : {}),
  };
}

export function takeoverSnapshotFromMusicGeneration(result: MusicGenerationResult): TakeoverMusicSnapshot {
  return {
    ...takeoverSnapshotFromUiSnapshot(result.uiSnapshot),
    source: 'generated',
  };
}

export function executeLeadTakeoverActions(
  target: LeadTakeoverAudioTarget,
  actions: readonly LeadTakeoverAction[],
  options: LeadTakeoverExecuteOptions = {},
): string[] {
  if (actions.length === 0) return [];

  const userChannel = options.userChannel ?? TAKEOVER_USER_CHANNEL;
  const nativeLeadChannel = options.nativeLeadChannel ?? NATIVE_LEAD_CHANNEL;
  const nativeLeadNoteRange = options.nativeLeadNoteRange ?? null;
  const nativeLeadNoteTargets = options.nativeLeadNoteTargets ?? null;
  const nativeLeadRouting = options.nativeLeadRouting ?? 'generated';
  const hardMuteDelayMs = options.hardMuteDelayMs ?? (target.controllerChange ? 0 : 30);
  const baseTick = currentTick(target) + 1;
  const nativeVoice = leadVoiceFromResult(target.getCurrentMusicGeneration(), baseTick);
  const voice = takeoverVoiceFromResult(target.getCurrentMusicGeneration(), baseTick);
  const logs: string[] = [];

  for (const action of actions) {
    if (action.type === 'lead-note-on') {
      const delayMs = Math.max(0, action.timing?.delayMs ?? 0);
      const velocity = clampMidi(action.velocity);
      const midi = fitTakeoverMidiForVoice(action.midi, voice);
      const midiLabel = logMidi(action.midi, midi);
      if (delayMs > 0) {
        scheduleDelayedNoteOn(target, baseTick, userChannel, midi, velocity, delayMs, voice, action.noteId);
        logs.push(`takeover qNoteOn ch${userChannel} ${midiLabel} +${Math.round(delayMs)}ms`);
      } else {
        sendImmediateTrackedNoteOn(target, baseTick, userChannel, midi, velocity, voice, action.noteId);
        logs.push(`takeover noteOn ch${userChannel} ${midiLabel} v${velocity}`);
      }
    } else if (action.type === 'lead-note-off') {
      const delayMs = Math.max(0, action.timing?.delayMs ?? 0);
      const midi = fitTakeoverMidiForVoice(action.midi, voice);
      if (delayMs > 0) {
        const releasedMidi = scheduleDelayedNoteOff(
          target,
          baseTick,
          userChannel,
          midi,
          delayMs,
          voice.acousticPiano,
          action.noteId,
        );
        logs.push(`takeover qNoteOff ch${userChannel} ${logMidi(action.midi, releasedMidi)} +${Math.round(delayMs)}ms`);
      } else if (!releaseDelayedOrStartedNote(target, baseTick, userChannel, midi, action.noteId)) {
        sendNoteOff(target, baseTick, userChannel, midi);
        logs.push(`takeover noteOff ch${userChannel} ${logMidi(action.midi, midi)}`);
      } else {
        logs.push(`takeover noteOff ch${userChannel} ${logMidi(action.midi, midi)}`);
      }
    } else if (action.type === 'backing-gain') {
      const scale = Math.max(0, Math.min(1, action.scale));
      target.setUploadedMidiGainScale?.(scale);
      logs.push(`uploaded backing gain ${Math.round(scale * 100)}%`);
    } else if (action.type === 'lead-mute') {
      if (nativeLeadNoteTargets && nativeLeadNoteTargets.length > 0) {
        const gracefulTopVoice = !!target.muteNoteTargetsGracefully;
        const muteTopVoice = target.muteNoteTargetsGracefully ?? target.muteNoteTargets;
        if (muteTopVoice) {
          muteTopVoice.call(target, nativeLeadNoteTargets, action.muted);
          const topVoiceVerb = action.muted
            ? (gracefulTopVoice ? 'drain' : 'mute')
            : 'restore';
          logs.push(
            `${topVoiceVerb} native top voice`
            + ` ${nativeLeadNoteTargets.length} notes`,
          );
        } else {
          logs.push('native top voice mute unavailable');
        }
        continue;
      }
      if (nativeLeadNoteRange && target.muteNoteRange) {
        target.muteNoteRange(nativeLeadChannel, nativeLeadNoteRange, action.muted);
        logs.push(
          `${action.muted ? 'mute' : 'restore'} native upper notes ch${nativeLeadChannel}`
          + ` ${nativeLeadNoteRange.minMidi}-${nativeLeadNoteRange.maxMidi}`,
        );
        continue;
      }
      if (nativeLeadRouting === 'uploaded') {
        let muteVerb = 'restore';
        if (action.muted) {
          if (target.muteChannelGracefully) {
            target.muteChannelGracefully(nativeLeadChannel, true);
            muteVerb = 'drain';
          } else {
            hardMuteNativeLeadAfterFlush(target, nativeLeadChannel, 0);
            muteVerb = 'hardMute';
          }
        } else {
          cancelPendingHardMute(nativeLeadChannel);
          if (target.muteChannelGracefully) {
            target.muteChannelGracefully(nativeLeadChannel, false);
          } else {
            target.muteChannel?.(nativeLeadChannel, false);
          }
        }
        logs.push(`${muteVerb} uploaded lead ch${nativeLeadChannel}`);
        continue;
      }
      if (target.muteChannelGracefully) {
        target.muteChannelGracefully(nativeLeadChannel, action.muted);
        logs.push(`${action.muted ? 'drain' : 'restore'} native lead ch${nativeLeadChannel}`);
        continue;
      }
      if (!action.muted) {
        cancelPendingHardMute(nativeLeadChannel);
        target.muteChannel?.(nativeLeadChannel, false);
      }
      injectNativeLeadSoftMute(target, baseTick, nativeLeadChannel, action.muted, nativeVoice);
      if (action.muted) hardMuteNativeLeadAfterFlush(target, nativeLeadChannel, hardMuteDelayMs);
      logs.push(`${action.muted ? 'hardMute' : 'restore'} native lead ch${nativeLeadChannel}`);
    } else {
      resetLeadTakeoverRuntimeState(target, [nativeLeadChannel]);
      logs.push(`panic takeover ch${userChannel}`);
    }
  }
  return logs;
}
