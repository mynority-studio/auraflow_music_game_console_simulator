// ============================================================
// leadTakeoverSandbox · headless controller
// ------------------------------------------------------------
// Converts pad presses + beat clock into lead-note and lead-mute actions.
// No AudioEngine dependency: future consumers execute returned actions.
// ============================================================

import { buildTakeoverPadMap } from './harmonicNoteMap';
import { findMeasureAtBeat } from './measureNoteMap';
import {
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
import { TAKEOVER_UPLOADED_BACKING_GAIN_SCALE } from './types';

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
  nativeLeadMuteEnabled: true,
  defaultVelocity: 104,
  quantizeEnabled: true,
  quantizeGrid: '16th',
  fastInputGrid: '32nd',
  fastInputBeatWindow: 0.25,
  simultaneousInputWindowMs: 24,
  maxSnapDelayMs: 60,
  noteOffTailMs: 34,
};

function initialState(): LeadTakeoverState {
  return {
    mode: 'idle',
    inputCount: 0,
    firstInputBeat: null,
    lastInputBeat: null,
    leadMuted: false,
    backingDucked: false,
  };
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
  private heldPads = new Map<string, HeldPad>();
  private noteIdSeq = 0;
  private lastNoteOnBeat: number | null = null;
  private lastNoteOnTargetBeat: number | null = null;

  constructor(config: Partial<LeadTakeoverConfig> = {}) {
    this.config = { ...DEFAULT_LEAD_TAKEOVER_CONFIG, ...config };
  }

  public getState(): LeadTakeoverState {
    return { ...this.state };
  }

  public setSnapshot(snapshot: TakeoverMusicSnapshot | null, beat = 0): TakeoverPadMap | null {
    const sameSnapshot = this.snapshot === snapshot;
    this.snapshot = snapshot;
    if (!snapshot) {
      this.currentPadMapKey = null;
      this.currentPadMap = null;
      return null;
    }
    const nextKey = this.padMapKeyForBeat(beat);
    if (sameSnapshot && this.currentPadMap && nextKey === this.currentPadMapKey) {
      return this.currentPadMap;
    }
    this.currentPadMapKey = nextKey;
    this.currentPadMap = buildTakeoverPadMap(snapshot, beat);
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
    if (this.snapshot.source === 'midi-analysis'
      && this.snapshot.layoutMode === 'measure-notes') {
      const measure = findMeasureAtBeat(this.snapshot.measures ?? [], beat);
      return measure
        ? `measure-notes:${measure.id}:${measure.startBeat}:${measure.notes.length}`
        : `measure-notes:fallback:${this.snapshot.measures?.length ?? 0}`;
    }
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

  private isSequentialInput(deltaBeats: number): boolean {
    if (!this.snapshot || !this.isFastInput(deltaBeats)) return false;
    const deltaMs = deltaBeats * (60000 / this.snapshot.bpm);
    return deltaMs > this.config.simultaneousInputWindowMs;
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

  private heldPadKey(padIndex: number, sourceId?: string): string {
    return sourceId ?? `pad:${padIndex}`;
  }

  public noteOn(
    padIndex: number,
    beat: number,
    velocity = this.config.defaultVelocity,
    sourceId?: string,
  ): LeadTakeoverAction[] {
    const heldKey = this.heldPadKey(padIndex, sourceId);
    if (this.heldPads.has(heldKey)) return [];
    const noteOnDelta = this.lastNoteOnBeat === null ? Number.POSITIVE_INFINITY : beat - this.lastNoteOnBeat;
    const grid = this.gridForNoteOn(beat);
    const grooveContract = this.grooveContractForBeat(beat);
    const timing = this.snapshot && this.config.quantizeEnabled
      ? quantizeTakeoverBeat({
        beat,
        bpm: this.snapshot.bpm,
        timeSignature: this.snapshot.timeSignature,
        grid,
        grooveContract,
        maxDelayMs: this.config.maxSnapDelayMs,
        ...(this.lastNoteOnTargetBeat !== null && this.isSequentialInput(noteOnDelta)
          ? { afterTargetBeat: this.lastNoteOnTargetBeat }
          : {}),
      })
      : null;
    const targetBeat = timing?.targetBeat ?? beat;
    const map = this.getPadMap(targetBeat);
    const cell = map?.cells[padIndex];
    if (!cell) return [];

    const noteId = `lt-${++this.noteIdSeq}`;
    this.heldPads.set(heldKey, {
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
    this.lastNoteOnTargetBeat = targetBeat;
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

    if (!this.state.backingDucked && this.snapshot?.source === 'midi-analysis') {
      this.state.backingDucked = true;
      actions.unshift({ type: 'backing-gain', scale: TAKEOVER_UPLOADED_BACKING_GAIN_SCALE });
    }

    if (this.state.mode === 'idle' && this.snapshot) {
      if (this.config.nativeLeadMuteEnabled) {
        this.state.mode = 'takeover';
        this.state.leadMuted = true;
        actions.unshift({
          type: 'lead-mute',
          channel: this.config.leadChannel,
          muted: true,
        });
      } else {
        // A Standard MIDI File may put lead and accompaniment on the same
        // channel. Channel-level mute is unsafe there, but the selected-note
        // layout and takeover voice remain usable.
        this.state.mode = 'takeover';
      }
    }

    return actions;
  }

  public noteOff(padIndex: number, beat?: number, sourceId?: string): LeadTakeoverAction[] {
    const heldKey = this.heldPadKey(padIndex, sourceId);
    const held = this.heldPads.get(heldKey);
    if (!held) return [];
    this.heldPads.delete(heldKey);
    const grid = beat !== undefined ? this.gridForNoteOff(held, beat) : held.quantizeGrid;
    const timing = this.snapshot && this.config.quantizeEnabled && beat !== undefined
      ? quantizeTakeoverBeat({
        beat,
        bpm: this.snapshot.bpm,
        timeSignature: this.snapshot.timeSignature,
        grid,
        grooveContract: this.grooveContractForBeat(beat),
        maxDelayMs: this.config.maxSnapDelayMs,
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
    void beat;
    return [];
  }

  /**
   * A cleared pad state must not hand the generated lead back to the engine.
   * Only closing Q+T explicitly restores it.
   */
  public reset(options: { restoreNativeLead?: boolean } = {}): LeadTakeoverAction[] {
    const actions: LeadTakeoverAction[] = [];
    for (const held of this.heldPads.values()) {
      actions.push({ type: 'lead-note-off', channel: this.config.leadChannel, noteId: held.noteId, midi: held.midi });
    }
    this.heldPads.clear();
    const preserveMute = this.state.leadMuted && !options.restoreNativeLead;
    const preserveBackingDuck = this.state.backingDucked && !options.restoreNativeLead;
    if (preserveMute) {
      // Reassert the transport mute after a Q+H result swap or sandbox reset.
      // The previous delayed hard-mute may have been cancelled during cleanup.
      actions.push({ type: 'lead-mute', channel: this.config.leadChannel, muted: true });
    }
    if (this.state.leadMuted && options.restoreNativeLead) {
      actions.push({ type: 'lead-mute', channel: this.config.leadChannel, muted: false });
      actions.push({ type: 'panic', channel: this.config.leadChannel });
    }
    if (preserveBackingDuck) {
      actions.push({ type: 'backing-gain', scale: TAKEOVER_UPLOADED_BACKING_GAIN_SCALE });
    } else if (this.state.backingDucked && options.restoreNativeLead) {
      actions.push({ type: 'backing-gain', scale: 1 });
    }
    this.state = preserveMute || preserveBackingDuck
      ? {
          ...initialState(),
          mode: preserveMute ? 'takeover' : 'idle',
          leadMuted: preserveMute,
          backingDucked: preserveBackingDuck,
        }
      : initialState();
    this.noteIdSeq = 0;
    this.lastNoteOnBeat = null;
    this.lastNoteOnTargetBeat = null;
    return actions;
  }
}
