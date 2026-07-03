// ============================================================
// leadTakeoverSandbox · headless controller
// ------------------------------------------------------------
// Converts pad presses + beat clock into lead-note and lead-mute actions.
// No AudioEngine dependency: future consumers execute returned actions.
// ============================================================

import { buildTakeoverPadMap } from './harmonicNoteMap';
import {
  beatsPerBarOf,
  quantizeTakeoverBeat,
  type TakeoverQuantizeGrid,
  type TakeoverQuantizeResult,
} from './rhythmQuantizer';
import type {
  LeadTakeoverAction,
  LeadTakeoverConfig,
  LeadTakeoverTiming,
  LeadTakeoverState,
  TakeoverMusicSnapshot,
  TakeoverPadMap,
} from './types';

interface HeldPad {
  midi: number;
  noteId: string;
  noteOnSourceBeat: number;
  noteOnTargetBeat: number;
  noteOnRhythmBeat: number;
  quantizeGrid: TakeoverQuantizeGrid;
}

export const DEFAULT_LEAD_TAKEOVER_CONFIG: LeadTakeoverConfig = {
  leadChannel: 1,
  takeoverThreshold: 3,
  silenceBarsToRelease: 1,
  handoffBars: 1,
  defaultVelocity: 104,
  quantizeEnabled: true,
  quantizeGrid: '16th',
  fastInputGrid: '32nd',
  fastInputBeatWindow: 0.25,
  lateGraceMs: 42,
  strongBeatLateGraceMs: 86,
  noteOffTailMs: 34,
};

function initialState(): LeadTakeoverState {
  return {
    mode: 'idle',
    inputCount: 0,
    firstInputBeat: null,
    lastInputBeat: null,
    muteAtBeat: null,
    leadMuted: false,
  };
}

function handoffBeat(anchorBeat: number, beatsPerBar: number, handoffBars: number): number {
  return anchorBeat + beatsPerBar * handoffBars;
}

function timingFromQuantize(q: TakeoverQuantizeResult, targetBeat = q.targetBeat, delayMs = q.delayMs): LeadTakeoverTiming {
  return {
    sourceBeat: q.sourceBeat,
    targetBeat,
    delayMs,
    grid: q.grid,
    gridStepBeats: q.gridStepBeats,
    ...(q.baseTargetBeat !== undefined ? { baseTargetBeat: q.baseTargetBeat } : {}),
    ...(q.grooveOffsetMs !== undefined ? { grooveOffsetMs: q.grooveOffsetMs } : {}),
    ...(q.grooveContractId ? { grooveContractId: q.grooveContractId } : {}),
  };
}

export class LeadTakeoverController {
  private readonly config: LeadTakeoverConfig;
  private state: LeadTakeoverState = initialState();
  private snapshot: TakeoverMusicSnapshot | null = null;
  private currentPadMap: TakeoverPadMap | null = null;
  private currentPadMapKey: string | null = null;
  private heldPads = new Map<number, HeldPad>();
  private noteIdSeq = 0;
  private lastNoteOnBeat: number | null = null;

  constructor(config: Partial<LeadTakeoverConfig> = {}) {
    this.config = { ...DEFAULT_LEAD_TAKEOVER_CONFIG, ...config };
  }

  public getState(): LeadTakeoverState {
    return { ...this.state };
  }

  public setSnapshot(snapshot: TakeoverMusicSnapshot | null, beat = 0): TakeoverPadMap | null {
    this.snapshot = snapshot;
    this.currentPadMapKey = snapshot ? this.padMapKeyForBeat(beat) : null;
    this.currentPadMap = snapshot ? buildTakeoverPadMap(snapshot, beat) : null;
    return this.currentPadMap;
  }

  public getPadMap(beat: number): TakeoverPadMap | null {
    if (!this.snapshot) return null;
    const key = this.padMapKeyForBeat(beat);
    if (key && this.currentPadMap && key === this.currentPadMapKey) return this.currentPadMap;
    this.currentPadMap = buildTakeoverPadMap(this.snapshot, beat);
    this.currentPadMapKey = key;
    return this.currentPadMap;
  }

  private padMapKeyForBeat(beat: number): string | null {
    if (!this.snapshot) return null;
    const currentIdx = this.snapshot.chords.findIndex((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats);
    if (currentIdx < 0) return `fallback:${this.snapshot.chords.length}`;
    const current = this.snapshot.chords[currentIdx];
    const next = this.snapshot.chords[currentIdx + 1] ?? null;
    return [
      currentIdx,
      next ? currentIdx + 1 : -1,
      current.rootPc,
      current.quality,
      current.chordType ?? '',
      current.forcedScale ?? '',
      current.localTonalCenterPc ?? '',
      current.borrowedFrom ?? '',
      current.borrowedSource ?? '',
      next?.rootPc ?? '',
      next?.quality ?? '',
      next?.chordType ?? '',
    ].join('|');
  }

  private grooveContractForBeat(beat: number) {
    if (!this.snapshot) return null;
    if (!this.snapshot.grooveContractBySection) return this.snapshot.grooveContract ?? null;
    const chord = this.snapshot.chords.find((c) => beat >= c.startBeat && beat < c.startBeat + c.durationBeats);
    if (!chord?.sectionId) return this.snapshot.grooveContract ?? null;
    return this.snapshot.grooveContractBySection[chord.sectionId] ?? this.snapshot.grooveContract ?? null;
  }

  private isFastInput(deltaBeats: number): boolean {
    return Number.isFinite(deltaBeats)
      && deltaBeats > 1e-6
      && deltaBeats < this.config.fastInputBeatWindow;
  }

  private gridForNoteOn(beat: number): TakeoverQuantizeGrid {
    if (this.lastNoteOnBeat === null) return this.config.quantizeGrid;
    return this.isFastInput(beat - this.lastNoteOnBeat)
      ? this.config.fastInputGrid
      : this.config.quantizeGrid;
  }

  private gridForNoteOff(held: HeldPad, beat: number): TakeoverQuantizeGrid {
    if (held.quantizeGrid === this.config.fastInputGrid) return this.config.fastInputGrid;
    return this.isFastInput(beat - held.noteOnSourceBeat)
      ? this.config.fastInputGrid
      : this.config.quantizeGrid;
  }

  public noteOn(padIndex: number, beat: number, velocity = this.config.defaultVelocity): LeadTakeoverAction[] {
    if (this.heldPads.has(padIndex)) return [];
    const grid = this.gridForNoteOn(beat);
    const timing = this.snapshot && this.config.quantizeEnabled
      ? quantizeTakeoverBeat({
        beat,
        bpm: this.snapshot.bpm,
        timeSignature: this.snapshot.timeSignature,
        grid,
        lateGraceMs: this.config.lateGraceMs,
        strongBeatLateGraceMs: this.config.strongBeatLateGraceMs,
        grooveContract: this.grooveContractForBeat(beat),
      })
      : null;
    const targetBeat = timing?.targetBeat ?? beat;
    const map = this.getPadMap(targetBeat);
    const cell = map?.cells[padIndex];
    if (!cell) return [];

    const noteId = `lt-${++this.noteIdSeq}`;
    this.heldPads.set(padIndex, {
      midi: cell.midi,
      noteId,
      noteOnSourceBeat: beat,
      noteOnTargetBeat: targetBeat,
      noteOnRhythmBeat: timing?.delayMs === 0 && timing.baseTargetBeat !== undefined
        ? timing.baseTargetBeat
        : targetBeat,
      quantizeGrid: timing?.grid ?? grid,
    });
    this.lastNoteOnBeat = beat;
    if (this.state.inputCount === 0) this.state.firstInputBeat = beat;
    this.state.inputCount += 1;
    this.state.lastInputBeat = beat;

    const actions: LeadTakeoverAction[] = [{
      type: 'lead-note-on',
      channel: this.config.leadChannel,
      noteId,
      midi: cell.midi,
      velocity,
      ...(timing
        ? {
          timing: timingFromQuantize(timing),
        }
        : {}),
    }];

    if (this.state.mode === 'idle' && this.state.inputCount >= this.config.takeoverThreshold && this.snapshot) {
      const bpb = beatsPerBarOf(this.snapshot.timeSignature);
      this.state.mode = 'pending-handoff';
      this.state.muteAtBeat = handoffBeat(this.state.firstInputBeat ?? beat, bpb, this.config.handoffBars);
    }

    return actions;
  }

  public noteOff(padIndex: number, beat?: number): LeadTakeoverAction[] {
    const held = this.heldPads.get(padIndex);
    if (!held) return [];
    this.heldPads.delete(padIndex);
    const grid = beat !== undefined ? this.gridForNoteOff(held, beat) : held.quantizeGrid;
    const timing = this.snapshot && this.config.quantizeEnabled && beat !== undefined
      ? quantizeTakeoverBeat({
        beat,
        bpm: this.snapshot.bpm,
        timeSignature: this.snapshot.timeSignature,
        grid,
        lateGraceMs: 0,
        strongBeatLateGraceMs: 0,
        grooveContract: this.grooveContractForBeat(beat),
      })
      : null;
    const noteOffTargetBeat = timing
      ? Math.max(
        timing.targetBeat,
        held.noteOnRhythmBeat + timing.gridStepBeats,
        held.noteOnTargetBeat + timing.gridStepBeats,
      ) + (this.config.noteOffTailMs / (60000 / this.snapshot!.bpm))
      : beat;
    const delayMs = timing
      ? Math.max(0, (noteOffTargetBeat - timing.sourceBeat) * (60000 / this.snapshot!.bpm))
      : 0;
    if (beat !== undefined) this.state.lastInputBeat = beat;

    return [{
      type: 'lead-note-off',
      channel: this.config.leadChannel,
      noteId: held.noteId,
      midi: held.midi,
      ...(timing
        ? {
          timing: timingFromQuantize(timing, noteOffTargetBeat, delayMs),
        }
        : {}),
    }];
  }

  public tick(beat: number): LeadTakeoverAction[] {
    if (!this.snapshot) return [];
    const actions: LeadTakeoverAction[] = [];
    const bpb = beatsPerBarOf(this.snapshot.timeSignature);

    if (this.state.mode === 'pending-handoff'
      && this.state.muteAtBeat !== null
      && beat >= this.state.muteAtBeat
      && !this.state.leadMuted) {
      this.state.mode = 'takeover';
      this.state.leadMuted = true;
      actions.push({ type: 'lead-mute', channel: this.config.leadChannel, muted: true });
    }

    const releaseAnchor = Math.max(
      this.state.lastInputBeat ?? beat,
      this.state.muteAtBeat ?? beat,
    );
    if (this.state.mode === 'takeover'
      && this.heldPads.size === 0
      && beat - releaseAnchor >= bpb * this.config.silenceBarsToRelease) {
      this.state = initialState();
      actions.push({ type: 'lead-mute', channel: this.config.leadChannel, muted: false });
      actions.push({ type: 'panic', channel: this.config.leadChannel });
    }

    return actions;
  }

  public reset(): LeadTakeoverAction[] {
    const actions: LeadTakeoverAction[] = [];
    for (const held of this.heldPads.values()) {
      actions.push({ type: 'lead-note-off', channel: this.config.leadChannel, noteId: held.noteId, midi: held.midi });
    }
    this.heldPads.clear();
    if (this.state.leadMuted) {
      actions.push({ type: 'lead-mute', channel: this.config.leadChannel, muted: false });
      actions.push({ type: 'panic', channel: this.config.leadChannel });
    }
    this.state = initialState();
    this.noteIdSeq = 0;
    this.lastNoteOnBeat = null;
    return actions;
  }
}
