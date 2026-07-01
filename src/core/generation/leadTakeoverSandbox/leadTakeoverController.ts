// ============================================================
// leadTakeoverSandbox · headless controller
// ------------------------------------------------------------
// Converts pad presses + beat clock into lead-note and lead-mute actions.
// No AudioEngine dependency: future consumers execute returned actions.
// ============================================================

import { beatsPerBarOf, buildTakeoverPadMap } from './harmonicNoteMap';
import type {
  LeadTakeoverAction,
  LeadTakeoverConfig,
  LeadTakeoverState,
  TakeoverMusicSnapshot,
  TakeoverPadMap,
} from './types';

export const DEFAULT_LEAD_TAKEOVER_CONFIG: LeadTakeoverConfig = {
  leadChannel: 1,
  takeoverThreshold: 3,
  silenceBarsToRelease: 1,
  handoffBars: 1,
  defaultVelocity: 104,
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

export class LeadTakeoverController {
  private readonly config: LeadTakeoverConfig;
  private state: LeadTakeoverState = initialState();
  private snapshot: TakeoverMusicSnapshot | null = null;
  private currentPadMap: TakeoverPadMap | null = null;
  private heldPads = new Map<number, number>();

  constructor(config: Partial<LeadTakeoverConfig> = {}) {
    this.config = { ...DEFAULT_LEAD_TAKEOVER_CONFIG, ...config };
  }

  public getState(): LeadTakeoverState {
    return { ...this.state };
  }

  public setSnapshot(snapshot: TakeoverMusicSnapshot | null, beat = 0): TakeoverPadMap | null {
    this.snapshot = snapshot;
    this.currentPadMap = snapshot ? buildTakeoverPadMap(snapshot, beat) : null;
    return this.currentPadMap;
  }

  public getPadMap(beat: number): TakeoverPadMap | null {
    if (!this.snapshot) return null;
    this.currentPadMap = buildTakeoverPadMap(this.snapshot, beat);
    return this.currentPadMap;
  }

  public noteOn(padIndex: number, beat: number, velocity = this.config.defaultVelocity): LeadTakeoverAction[] {
    const map = this.getPadMap(beat);
    const cell = map?.cells[padIndex];
    if (!cell) return [];

    this.heldPads.set(padIndex, cell.midi);
    if (this.state.inputCount === 0) this.state.firstInputBeat = beat;
    this.state.inputCount += 1;
    this.state.lastInputBeat = beat;

    const actions: LeadTakeoverAction[] = [{
      type: 'lead-note-on',
      channel: this.config.leadChannel,
      midi: cell.midi,
      velocity,
    }];

    if (this.state.mode === 'idle' && this.state.inputCount >= this.config.takeoverThreshold && this.snapshot) {
      const bpb = beatsPerBarOf(this.snapshot.timeSignature);
      this.state.mode = 'pending-handoff';
      this.state.muteAtBeat = handoffBeat(this.state.firstInputBeat ?? beat, bpb, this.config.handoffBars);
    }

    return actions;
  }

  public noteOff(padIndex: number): LeadTakeoverAction[] {
    const midi = this.heldPads.get(padIndex);
    if (midi === undefined) return [];
    this.heldPads.delete(padIndex);
    return [{
      type: 'lead-note-off',
      channel: this.config.leadChannel,
      midi,
    }];
  }

  public tick(beat: number): LeadTakeoverAction[] {
    if (!this.snapshot) return [];
    const actions: LeadTakeoverAction[] = [];
    const bpb = beatsPerBarOf(this.snapshot.timeSignature);
    const silenceBeats = this.state.lastInputBeat === null ? 0 : beat - this.state.lastInputBeat;

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
      && beat - releaseAnchor >= bpb * this.config.silenceBarsToRelease) {
      this.state = initialState();
      actions.push({ type: 'lead-mute', channel: this.config.leadChannel, muted: false });
      actions.push({ type: 'panic', channel: this.config.leadChannel });
    }

    return actions;
  }

  public reset(): LeadTakeoverAction[] {
    const actions: LeadTakeoverAction[] = [];
    for (const midi of this.heldPads.values()) {
      actions.push({ type: 'lead-note-off', channel: this.config.leadChannel, midi });
    }
    this.heldPads.clear();
    if (this.state.leadMuted) {
      actions.push({ type: 'lead-mute', channel: this.config.leadChannel, muted: false });
      actions.push({ type: 'panic', channel: this.config.leadChannel });
    }
    this.state = initialState();
    return actions;
  }
}
