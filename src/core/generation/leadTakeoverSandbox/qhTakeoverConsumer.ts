// ============================================================
// leadTakeoverSandbox · Q+H consumer adapter
// ------------------------------------------------------------
// Minimal bridge from the Q+T sandbox to the current Q+H playback state.
// It consumes AudioEngine-like read/write methods without importing the
// Q+H generation UI or mutating the main generation pipeline.
// ============================================================

import type { MidiEvent } from '../../audio/MidiScheduler';
import { mapProgramToAura25 } from '../../sound/Aura25Palette';
import type { MusicGenerationResult, MusicGenerationUiSnapshot, UiChord, UiGrooveContract } from '../musicGeneration/types';
import { fitMidiToProgramRange } from '../newEngine/knowledge/instruments';
import type { LeadTakeoverAction, TakeoverChordSource, TakeoverGrooveContract, TakeoverMusicSnapshot } from './types';

export const TAKEOVER_USER_CHANNEL = 15;
const NATIVE_LEAD_CHANNEL = 1;
const DEFAULT_LEAD_PROGRAM = 0;
const DEFAULT_LEAD_VOLUME = 74;
const DEFAULT_LEAD_PAN = 64;
const DEFAULT_LEAD_REVERB = 36;
const DEFAULT_LEAD_CHORUS = 0;
const DEFAULT_LEAD_EXPRESSION = 127;
const DEFAULT_LEAD_DELAY = 0;
const TAKEOVER_VOLUME_CEILING = 72;
const TAKEOVER_REVERB_CEILING = 18;
const TAKEOVER_CHORUS_CEILING = 6;
const TAKEOVER_EXPRESSION_CEILING = 112;
const TAKEOVER_DELAY_SEND = 0;
const CC_RELEASE_TIME = 72;
const CC_BRIGHTNESS = 74;
const CC_SUSTAIN_PEDAL = 64;
const CC_DELAY_SEND = 95;
const DEFAULT_RELEASE_TIME = 64;
const DEFAULT_BRIGHTNESS = 64;
const ELECTRIC_KEY_RELEASE = 68;
const ELECTRIC_KEY_BRIGHTNESS = 54;
const TAKEOVER_AUDIO_SCHEDULE_LOOKAHEAD_MS = 25;
const MAX_TAKEOVER_TRACKED_NOTES = 32;
const pendingHardMuteTimers = new Map<number, ReturnType<typeof setTimeout>>();
const userVoiceSetupKeys = new WeakMap<object, Map<number, string>>();
const pendingNoteTimers = new WeakMap<object, Map<string, PendingTakeoverNote>>();
const activeNoteCounts = new WeakMap<object, Map<string, number>>();

export interface LeadTakeoverAudioTarget {
  getCurrentTick(): number;
  getPpq(): number;
  getCurrentMusicGeneration(): MusicGenerationResult | null;
  injectMidiEvent(ev: MidiEvent): void;
  muteChannel?(channel: number, mute: boolean): void;
  noteOn?(channel: number, note: number, velocity: number): void;
  noteOff?(channel: number, note: number): void;
  getAudioTime?(): number;
  noteOnAt?(channel: number, note: number, velocity: number, audioTime: number): void;
  noteOffAt?(channel: number, note: number, audioTime: number): void;
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
  delay: number;
  release: number;
  brightness: number;
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
}

export interface LeadTakeoverExecuteOptions {
  userChannel?: number;
  nativeLeadChannel?: number;
  hardMuteDelayMs?: number;
}

function clampMidi(v: number): number {
  return Math.max(0, Math.min(127, Math.round(v)));
}

function clampTakeoverCc(v: number, ceiling: number): number {
  return Math.min(clampMidi(v), ceiling);
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


function leadVoiceFromResult(result: MusicGenerationResult | null): LeadVoice {
  const leadTrack = result?.ir?.tracks.find((t) => t.role === 'lead');
  const uiLead = result?.uiSnapshot.tracks.find((t) => t.role === 'lead');
  const mix = leadTrack?.mix;
  const style = result?.styleHint ?? result?.uiSnapshot.styleHint;
  const rawProgram = clampMidi(leadTrack?.program ?? uiLead?.program ?? DEFAULT_LEAD_PROGRAM);
  const program = mapProgramToAura25(rawProgram, 'lead', style);
  const electricKey = program === 4 || program === 5;
  return {
    program,
    volume: clampMidi(mix?.volume ?? DEFAULT_LEAD_VOLUME),
    pan: clampMidi(mix?.pan ?? DEFAULT_LEAD_PAN),
    reverb: clampMidi(mix?.reverb ?? DEFAULT_LEAD_REVERB),
    chorus: clampMidi(mix?.chorus ?? DEFAULT_LEAD_CHORUS),
    expression: clampMidi(mix?.expression ?? DEFAULT_LEAD_EXPRESSION),
    delay: clampMidi(mix?.delay ?? DEFAULT_LEAD_DELAY),
    release: electricKey ? ELECTRIC_KEY_RELEASE : DEFAULT_RELEASE_TIME,
    brightness: electricKey ? ELECTRIC_KEY_BRIGHTNESS : DEFAULT_BRIGHTNESS,
  };
}

function takeoverVoiceFromLeadVoice(voice: LeadVoice): LeadVoice {
  return {
    ...voice,
    volume: clampTakeoverCc(voice.volume, TAKEOVER_VOLUME_CEILING),
    reverb: clampTakeoverCc(voice.reverb, TAKEOVER_REVERB_CEILING),
    chorus: clampTakeoverCc(voice.chorus, TAKEOVER_CHORUS_CEILING),
    expression: clampTakeoverCc(voice.expression, TAKEOVER_EXPRESSION_CEILING),
    delay: TAKEOVER_DELAY_SEND,
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
    voice.delay,
    voice.release,
    voice.brightness,
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

function activeNotesFor(target: LeadTakeoverAudioTarget): Map<string, number> {
  let notes = activeNoteCounts.get(target as object);
  if (!notes) {
    notes = new Map();
    activeNoteCounts.set(target as object, notes);
  }
  return notes;
}

function incrementActiveNote(target: LeadTakeoverAudioTarget, channel: number, midi: number): void {
  const notes = activeNotesFor(target);
  const key = midiKey(channel, midi);
  notes.set(key, (notes.get(key) ?? 0) + 1);
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
  sendNoteOn(target, tick, channel, midi, velocity, audioTime);
  incrementActiveNote(target, channel, midi);
}

function sendTrackedNoteOff(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  midi: number,
  audioTime: number | null = null,
): void {
  if (shouldSendTrackedNoteOff(target, channel, midi)) {
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
): void {
  clearPendingNote(note);
  if (!note.started) return;

  const nowAudioTime = target.getAudioTime?.() ?? null;
  const futureNoteOnTime = note.scheduledNoteOnAudioTime !== null
    && nowAudioTime !== null
    && note.scheduledNoteOnAudioTime > nowAudioTime;
  const releaseAudioTime = futureNoteOnTime ? note.scheduledNoteOnAudioTime + 0.01 : null;
  sendTrackedNoteOff(target, tick, note.channel, note.midi, releaseAudioTime);
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
  };

  pending.noteOnTimer = setTimeout(() => {
    const remainingMs = Math.max(0, delayMs - (nowMs() - requestedAtMs));
    const audioTime = scheduledAudioTime(target, remainingMs);
    pending.noteOnTimer = null;
    pending.started = true;
    pending.scheduledNoteOnAudioTime = audioTime;
    ensureUserVoiceSetup(target, tick, channel, voice);
    sendTrackedNoteOn(target, tick + 1, channel, midi, velocity, audioTime);
    if (pending.releaseWhenStarted) {
      sendTrackedNoteOff(target, tick + 1, channel, midi, audioTime);
      notes.delete(key);
    }
  }, delayedTimerMs(delayMs, useAudioClock));

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
  });
  enforceTrackedNoteLimit(target, tick, channel);
}

function scheduleDelayedNoteOff(
  target: LeadTakeoverAudioTarget,
  tick: number,
  channel: number,
  midi: number,
  delayMs: number,
  noteId?: string,
): void {
  const notes = pendingNotesFor(target);
  const key = pendingKey(channel, midi, noteId);
  const requestedAtMs = nowMs();
  const useAudioClock = canScheduleNoteOffAt(target);
  let note = notes.get(key);
  if (!note) {
    note = {
      noteOnTimer: null,
      noteOffTimer: null,
      started: true,
      releaseWhenStarted: false,
      channel,
      noteId,
      midi,
      velocity: 0,
      scheduledNoteOnAudioTime: null,
    };
    notes.set(key, note);
  }
  if (note.noteOffTimer) clearTimeout(note.noteOffTimer);
  note.noteOffTimer = setTimeout(() => {
    const remainingMs = Math.max(0, delayMs - (nowMs() - requestedAtMs));
    const audioTime = scheduledAudioTime(target, remainingMs);
    note.noteOffTimer = null;
    if (note.started) {
      sendTrackedNoteOff(target, tick, channel, midi, audioTime);
      notes.delete(key);
    } else {
      note.releaseWhenStarted = true;
    }
  }, delayedTimerMs(delayMs, useAudioClock));
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
        releasePendingNote(target, tick, note);
      }
      notes.delete(key);
      released = true;
    }
    if (notes.size === 0) pendingNoteTimers.delete(target as object);
    return released;
  }

  const key = pendingKey(channel, midi, noteId);
  const note = notes.get(key);
  if (!note) {
    const suffix = `:${noteId}`;
    for (const [fallbackKey, fallbackNote] of [...notes.entries()]) {
      if (!fallbackKey.startsWith(`${channel}:`) || !fallbackKey.endsWith(suffix)) continue;
      if (!fallbackNote.started) {
        clearPendingNote(fallbackNote);
        notes.delete(fallbackKey);
      } else {
        releasePendingNote(target, tick, fallbackNote);
        notes.delete(fallbackKey);
      }
      if (notes.size === 0) pendingNoteTimers.delete(target as object);
      return true;
    }
    return false;
  }
  if (!note.started) {
    clearPendingNote(note);
    notes.delete(key);
    if (notes.size === 0) pendingNoteTimers.delete(target as object);
    return true;
  }
  releasePendingNote(target, tick, note);
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
  sendProgramChange(target, tick, channel, voice.program);
  sendControlChange(target, tick, channel, CC_SUSTAIN_PEDAL, 0);
  sendControlChange(target, tick, channel, 7, voice.volume);
  sendControlChange(target, tick, channel, 10, voice.pan);
  sendControlChange(target, tick, channel, 91, voice.reverb);
  sendControlChange(target, tick, channel, 93, voice.chorus);
  sendControlChange(target, tick, channel, 11, voice.expression);
  sendControlChange(target, tick, channel, CC_RELEASE_TIME, voice.release);
  sendControlChange(target, tick, channel, CC_BRIGHTNESS, voice.brightness);
  sendControlChange(target, tick, channel, CC_DELAY_SEND, voice.delay);
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
    sendControlChange(target, tick, channel, CC_SUSTAIN_PEDAL, 0);
    sendControlChange(target, tick, channel, 123, 0); // all notes off
    sendControlChange(target, tick, channel, CC_DELAY_SEND, 0);
    sendControlChange(target, tick, channel, 7, 0);
    sendControlChange(target, tick, channel, 11, 0);
    return;
  }
  sendControlChange(target, tick, channel, 7, voice.volume);
  sendControlChange(target, tick, channel, 11, voice.expression);
  sendControlChange(target, tick, channel, CC_DELAY_SEND, voice.delay);
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
  const nativeVoice = leadVoiceFromResult(target.getCurrentMusicGeneration());
  const voice = takeoverVoiceFromLeadVoice(nativeVoice);
  const baseTick = currentTick(target) + 1;
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
      const midiLabel = logMidi(action.midi, midi);
      if (delayMs > 0) {
        scheduleDelayedNoteOff(target, baseTick, userChannel, midi, delayMs, action.noteId);
        logs.push(`takeover qNoteOff ch${userChannel} ${midiLabel} +${Math.round(delayMs)}ms`);
      } else if (!releaseDelayedOrStartedNote(target, baseTick, userChannel, midi, action.noteId)) {
        sendNoteOff(target, baseTick, userChannel, midi);
        logs.push(`takeover noteOff ch${userChannel} ${midiLabel}`);
      } else {
        logs.push(`takeover noteOff ch${userChannel} ${midiLabel}`);
      }
    } else if (action.type === 'lead-mute') {
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
