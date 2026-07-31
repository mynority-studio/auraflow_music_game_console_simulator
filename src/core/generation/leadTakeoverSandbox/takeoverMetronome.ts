// ============================================================
// leadTakeoverSandbox · groove metronome overlay
// ------------------------------------------------------------
// Schedules a bounded audio-clock metronome for Q+T takeover practice.
// It follows the current bpm + grooveContract without injecting permanent
// events into the main playback scheduler or mutating the native drum track.
// ============================================================

import { beatsPerBarOf, grooveTargetForBase } from './rhythmQuantizer';
import type { TakeoverGrooveContract, TakeoverMusicSnapshot } from './types';

// GM wood blocks live on percussion channel 10 (zero-based channel 9).
// Q+T only sends the one-shot notes below: it never changes this channel's
// kit, controllers, or all-notes state, so the generated drum track is intact.
export const TAKEOVER_METRONOME_CHANNEL = 9;

const LOOKAHEAD_MS = 520;
const CLEANUP_BEHIND_BEATS = 2;
const DEFAULT_BPM = 120;
const FALLBACK_TICK_WINDOW_MS = 35;
// One fixed wood-block pitch keeps the metronome non-melodic. Accents are
// communicated only by velocity, never by a high/low pitch pattern.
const METRONOME_WOOD_BLOCK_NOTE = 76;

export interface TakeoverMetronomeAudioTarget {
  noteOn?(channel: number, note: number, velocity: number): void;
  noteOff?(channel: number, note: number): void;
  getAudioTime?(): number;
  noteOnAt?(channel: number, note: number, velocity: number, audioTime: number): void;
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
      { baseBeat, grooveBeat, note: METRONOME_WOOD_BLOCK_NOTE, velocity: 104, durationMs: 1, downbeat, strong },
    ];
  }
  if (strong) {
    return [
      { baseBeat, grooveBeat, note: METRONOME_WOOD_BLOCK_NOTE, velocity: 86, durationMs: 1, downbeat, strong },
    ];
  }
  return [
    { baseBeat, grooveBeat, note: METRONOME_WOOD_BLOCK_NOTE, velocity: 66, durationMs: 1, downbeat, strong },
  ];
}

function sendNoteOn(target: TakeoverMetronomeAudioTarget, hit: TakeoverMetronomeHit, audioTime: number | null): void {
  if (audioTime !== null && target.noteOnAt) {
    target.noteOnAt(TAKEOVER_METRONOME_CHANNEL, hit.note, hit.velocity, audioTime);
    return;
  }
  target.noteOn?.(TAKEOVER_METRONOME_CHANNEL, hit.note, hit.velocity);
}

export class TakeoverMetronomeRuntime {
  private scheduledBaseBeats = new Set<number>();

  public schedule(target: TakeoverMetronomeAudioTarget, snapshot: TakeoverMusicSnapshot, currentBeat: number): void {
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

  public stop(_target?: TakeoverMetronomeAudioTarget): void {
    this.scheduledBaseBeats.clear();
  }

  private scheduleHit(
    target: TakeoverMetronomeAudioTarget,
    hit: TakeoverMetronomeHit,
    currentBeat: number,
    beatMs: number,
  ): void {
    const delayMs = Math.max(0, (hit.grooveBeat - currentBeat) * beatMs);
    if (target.getAudioTime && target.noteOnAt) {
      const onTime = target.getAudioTime() + delayMs / 1000;
      sendNoteOn(target, hit, onTime);
      return;
    }

    if (delayMs > FALLBACK_TICK_WINDOW_MS) return;
    sendNoteOn(target, hit, null);
  }
}
