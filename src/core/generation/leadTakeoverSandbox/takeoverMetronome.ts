// ============================================================
// leadTakeoverSandbox · groove metronome overlay
// ------------------------------------------------------------
// Schedules a bounded audio-clock metronome for Q+T takeover practice.
// It follows the current bpm + grooveContract without injecting permanent
// events into the main playback scheduler or touching the native drum track.
// ============================================================

import { beatsPerBarOf, grooveTargetForBase } from './rhythmQuantizer';
import type { TakeoverGrooveContract, TakeoverMusicSnapshot } from './types';

export const TAKEOVER_METRONOME_CHANNEL = 14;

const LOOKAHEAD_MS = 520;
const CLEANUP_BEHIND_BEATS = 2;
const DEFAULT_BPM = 120;
const FALLBACK_TICK_WINDOW_MS = 35;
// Aura25's Kalimba is the least intrusive dedicated click available on a
// melodic channel. Keep all pitches in its reliable sampled range so the
// metronome remains a clear, ordinary tick rather than a sharp drum-like hit.
const METRONOME_PROGRAM = 108;
const METRONOME_DOWNBEAT_NOTE = 84;
const METRONOME_STRONG_NOTE = 81;
const METRONOME_WEAK_NOTE = 78;
const METRONOME_NOTES = [METRONOME_DOWNBEAT_NOTE, METRONOME_STRONG_NOTE, METRONOME_WEAK_NOTE] as const;

export interface TakeoverMetronomeAudioTarget {
  noteOn?(channel: number, note: number, velocity: number): void;
  noteOff?(channel: number, note: number): void;
  getAudioTime?(): number;
  noteOnAt?(channel: number, note: number, velocity: number, audioTime: number): void;
  noteOffAt?(channel: number, note: number, audioTime: number): void;
  programChange?(channel: number, program: number): void;
  controllerChange?(channel: number, controller: number, value: number): void;
}

export interface TakeoverMetronomeHit {
  baseBeat: number;
  grooveBeat: number;
  note: number;
  velocity: number;
  durationMs: number;
  downbeat: boolean;
  strong: boolean;
}

function safeBpm(snapshot: TakeoverMusicSnapshot): number {
  return Number.isFinite(snapshot.bpm) && snapshot.bpm > 0 ? snapshot.bpm : DEFAULT_BPM;
}

function grooveContractForBeat(snapshot: TakeoverMusicSnapshot, beat: number): TakeoverGrooveContract | null {
  const chord = snapshot.chords.find((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats);
  if (chord?.sectionId && snapshot.grooveContractBySection?.[chord.sectionId]) {
    return snapshot.grooveContractBySection[chord.sectionId];
  }
  return snapshot.grooveContract ?? null;
}

function isDownbeat(baseBeat: number, beatsPerBar: number): boolean {
  const local = ((baseBeat % beatsPerBar) + beatsPerBar) % beatsPerBar;
  return Math.abs(local) < 1e-6 || Math.abs(local - beatsPerBar) < 1e-6;
}

function accentAtBeat(contract: TakeoverGrooveContract | null, baseBeat: number, beatsPerBar: number): number {
  const local = ((baseBeat % beatsPerBar) + beatsPerBar) % beatsPerBar;
  const beatIndex = Math.max(0, Math.round(local));
  const pattern = contract?.accentPattern;
  if (!pattern || pattern.length === 0) return isDownbeat(baseBeat, beatsPerBar) ? 1.2 : 0.85;
  const accent = pattern[beatIndex % pattern.length];
  return Number.isFinite(accent) ? accent : 1;
}

export function buildTakeoverMetronomeHits(
  snapshot: TakeoverMusicSnapshot,
  baseBeat: number,
): TakeoverMetronomeHit[] {
  const bpm = safeBpm(snapshot);
  const beatsPerBar = beatsPerBarOf(snapshot.timeSignature);
  const contract = grooveContractForBeat(snapshot, baseBeat);
  const groove = grooveTargetForBase(baseBeat, bpm, contract);
  const downbeat = isDownbeat(baseBeat, beatsPerBar);
  const accent = accentAtBeat(contract, baseBeat, beatsPerBar);
  const strong = downbeat || accent >= 1;
  const grooveBeat = groove.targetBeat;

  if (downbeat) {
    return [
      { baseBeat, grooveBeat, note: METRONOME_DOWNBEAT_NOTE, velocity: 82, durationMs: 34, downbeat, strong },
    ];
  }
  if (strong) {
    return [
      { baseBeat, grooveBeat, note: METRONOME_STRONG_NOTE, velocity: 70, durationMs: 30, downbeat, strong },
    ];
  }
  return [
    { baseBeat, grooveBeat, note: METRONOME_WEAK_NOTE, velocity: 54, durationMs: 26, downbeat, strong },
  ];
}

function sendNoteOn(target: TakeoverMetronomeAudioTarget, hit: TakeoverMetronomeHit, audioTime: number | null): void {
  if (audioTime !== null && target.noteOnAt) {
    target.noteOnAt(TAKEOVER_METRONOME_CHANNEL, hit.note, hit.velocity, audioTime);
    return;
  }
  target.noteOn?.(TAKEOVER_METRONOME_CHANNEL, hit.note, hit.velocity);
}

function sendNoteOff(target: TakeoverMetronomeAudioTarget, hit: TakeoverMetronomeHit, audioTime: number | null): void {
  if (audioTime !== null && target.noteOffAt) {
    target.noteOffAt(TAKEOVER_METRONOME_CHANNEL, hit.note, audioTime);
    return;
  }
  target.noteOff?.(TAKEOVER_METRONOME_CHANNEL, hit.note);
}

export class TakeoverMetronomeRuntime {
  private scheduledBaseBeats = new Set<number>();
  private fallbackTimers: ReturnType<typeof setTimeout>[] = [];
  private setupSent = false;

  public schedule(target: TakeoverMetronomeAudioTarget, snapshot: TakeoverMusicSnapshot, currentBeat: number): void {
    this.ensureSetup(target);
    const bpm = safeBpm(snapshot);
    const beatMs = 60000 / bpm;
    const lookaheadBeats = Math.max(1, LOOKAHEAD_MS / beatMs);
    const startBeat = Math.max(0, Math.floor(currentBeat - 0.02));
    const endBeat = Math.ceil(currentBeat + lookaheadBeats);

    for (const key of [...this.scheduledBaseBeats]) {
      if (key < currentBeat - CLEANUP_BEHIND_BEATS) this.scheduledBaseBeats.delete(key);
    }

    for (let baseBeat = startBeat; baseBeat <= endBeat; baseBeat++) {
      if (this.scheduledBaseBeats.has(baseBeat)) continue;
      this.scheduledBaseBeats.add(baseBeat);
      for (const hit of buildTakeoverMetronomeHits(snapshot, baseBeat)) {
        this.scheduleHit(target, hit, currentBeat, beatMs);
      }
    }
  }

  public stop(target?: TakeoverMetronomeAudioTarget): void {
    for (const timer of this.fallbackTimers) clearTimeout(timer);
    this.fallbackTimers = [];
    this.scheduledBaseBeats.clear();
    this.setupSent = false;
    if (!target) return;
    for (const note of METRONOME_NOTES) target.noteOff?.(TAKEOVER_METRONOME_CHANNEL, note);
    target.controllerChange?.(TAKEOVER_METRONOME_CHANNEL, 123, 0);
  }

  private ensureSetup(target: TakeoverMetronomeAudioTarget): void {
    if (this.setupSent) return;
    target.programChange?.(TAKEOVER_METRONOME_CHANNEL, METRONOME_PROGRAM);
    target.controllerChange?.(TAKEOVER_METRONOME_CHANNEL, 7, 62);
    target.controllerChange?.(TAKEOVER_METRONOME_CHANNEL, 10, 64);
    target.controllerChange?.(TAKEOVER_METRONOME_CHANNEL, 11, 96);
    target.controllerChange?.(TAKEOVER_METRONOME_CHANNEL, 72, 18);
    target.controllerChange?.(TAKEOVER_METRONOME_CHANNEL, 91, 0);
    target.controllerChange?.(TAKEOVER_METRONOME_CHANNEL, 93, 0);
    this.setupSent = true;
  }

  private scheduleHit(
    target: TakeoverMetronomeAudioTarget,
    hit: TakeoverMetronomeHit,
    currentBeat: number,
    beatMs: number,
  ): void {
    const delayMs = Math.max(0, (hit.grooveBeat - currentBeat) * beatMs);
    if (target.getAudioTime && target.noteOnAt && target.noteOffAt) {
      const onTime = target.getAudioTime() + delayMs / 1000;
      sendNoteOn(target, hit, onTime);
      sendNoteOff(target, hit, onTime + hit.durationMs / 1000);
      return;
    }

    if (delayMs > FALLBACK_TICK_WINDOW_MS) return;
    sendNoteOn(target, hit, null);
    this.fallbackTimers.push(setTimeout(() => sendNoteOff(target, hit, null), hit.durationMs));
  }
}
