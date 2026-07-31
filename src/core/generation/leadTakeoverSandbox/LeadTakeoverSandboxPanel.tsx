// ============================================================
// leadTakeoverSandbox · UI panel
// ------------------------------------------------------------
// Q+T user takeover sandbox panel. It consumes the current Q+H
// MusicGenerationResult when available, without modifying the Q+H pipeline.
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Hand, RotateCcw, StepForward, X } from 'lucide-react';
import { useDevPanelChannel } from '../../../components/devPanels';
import {
  getMidiAnalysisSession,
  subscribeMidiAnalysisSession,
  type MidiAnalysisSessionState,
} from '../../analysis/midi';
import { AudioEngine, startAudioContext } from '../../audio/AudioEngine';
import type { MidiNoteRange, MidiNoteTarget } from '../../audio/MidiScheduler';
import { buildTakeoverPadMap, findChordAtBeat } from './harmonicNoteMap';
import { findMeasureAtBeat } from './measureNoteMap';
import {
  takeoverSnapshotFromMidiAnalysis,
  type MidiTakeoverSnapshotResult,
} from './midiTakeoverSnapshot';
import { midiName, TAKEOVER_ASCENDING_PAD_INDICES } from './padLayout';
import { DEFAULT_LEAD_TAKEOVER_CONFIG, LeadTakeoverController } from './leadTakeoverController';
import { resetTakeoverPadInputState, subscribeTakeoverPadInput } from './takeoverInputBus';
import { modulateTakeoverMidiMessage, TAKEOVER_MIDI_POSITION_NOTES } from './takeoverMidiModulator';
import { TakeoverMetronomeRuntime } from './takeoverMetronome';
import { silenceRawMidiAudition } from '../newEngine/sandbox/audioOut';
import {
  executeLeadTakeoverActions,
  reconcileNativeLeadMute,
  reconcileUploadedMidiGain,
  prepareLeadTakeoverVoice,
  resetLeadTakeoverRuntimeState,
  takeoverSnapshotFromMusicGeneration,
} from './qhTakeoverConsumer';
import type { MusicGenerationResult } from '../musicGeneration/types';
import {
  claimMidiInputExclusive,
  midiInputTransportLabel,
  requestMidiAccess,
  type MidiAccessHandle,
  type MidiDeviceInfo,
  type MidiSupport,
  type ParsedMidiMessage,
} from '../motifSandbox/midi/webMidi';
import {
  getTakeoverMidiInputPreference,
  resolveTakeoverMidiInput,
  setTakeoverMidiInputPreference,
  subscribeTakeoverMidiInputPreference,
} from '../../../state/TakeoverMidiInputStore';
import type {
  LeadTakeoverAction,
  LeadTakeoverSourceMode,
  LeadTakeoverState,
  TakeoverLayoutMode,
  TakeoverMusicSnapshot,
  TakeoverPadCell,
} from './types';

const DEMO_SNAPSHOT: TakeoverMusicSnapshot = {
  styleHint: 'jazz',
  key: 'C',
  tonality: 'major',
  bpm: 112,
  timeSignature: [4, 4],
  source: 'demo',
  chords: [
    { rootPc: 2, quality: 'm7', roman: 'ii', startBeat: 0, durationBeats: 4, sectionId: 'A' },
    { rootPc: 7, quality: '7', roman: 'V', startBeat: 4, durationBeats: 4, sectionId: 'A' },
    { rootPc: 0, quality: 'maj7', roman: 'I', startBeat: 8, durationBeats: 4, sectionId: 'A' },
    { rootPc: 9, quality: 'm7', roman: 'vi', startBeat: 12, durationBeats: 4, sectionId: 'A' },
  ],
};

const ROLE_STYLE: Record<TakeoverPadCell['classRole'], string> = {
  chord: 'border-emerald-400/60 bg-emerald-500/20 text-emerald-100',
  scale: 'border-sky-400/50 bg-sky-500/15 text-sky-100',
  approach: 'border-amber-400/50 bg-amber-500/15 text-amber-100',
  fallback: 'border-zinc-600 bg-zinc-800 text-zinc-300',
  structural: 'border-fuchsia-300/70 bg-fuchsia-500/20 text-fuchsia-100',
  selected: 'border-sky-300/55 bg-sky-500/15 text-sky-100',
  ornament: 'border-amber-300/45 bg-amber-500/10 text-amber-100',
};

const LIVE_POLL_INTERVAL_MS = 125;

function formatAction(a: LeadTakeoverAction): string {
  if (a.type === 'lead-note-on') {
    const groove = a.timing?.grooveOffsetMs ? ` g${Math.round(a.timing.grooveOffsetMs)}ms` : '';
    const q = a.timing ? ` @${a.timing.targetBeat.toFixed(2)} +${Math.round(a.timing.delayMs)}ms${groove}` : '';
    return `noteOn ch${a.channel} ${a.midi} v${a.velocity}${q}`;
  }
  if (a.type === 'lead-note-off') {
    const groove = a.timing?.grooveOffsetMs ? ` g${Math.round(a.timing.grooveOffsetMs)}ms` : '';
    const q = a.timing ? ` @${a.timing.targetBeat.toFixed(2)} +${Math.round(a.timing.delayMs)}ms${groove}` : '';
    return `noteOff ch${a.channel} ${a.midi}${q}`;
  }
  if (a.type === 'backing-gain') return `backing ${Math.round(a.scale * 100)}%`;
  if (a.type === 'lead-mute') return `${a.muted ? 'mute' : 'unmute'} lead ch${a.channel}`;
  return `panic ch${a.channel}`;
}

type LeadNoteTiming = NonNullable<Extract<LeadTakeoverAction, { type: 'lead-note-on' | 'lead-note-off' }>['timing']>;

interface LeadTakeoverSandboxPanelProps {
  activeKeys?: Set<string>;
  onOpenChange?: (open: boolean) => void;
}

function padIndexFromKeyId(keyId: string): number | null {
  const parts = keyId.split('-');
  if (parts.length !== 3 || parts[0] !== 'key') return null;
  const col = Number(parts[1]);
  const row = Number(parts[2]);
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || col > 4 || row < 0 || row > 2) return null;
  return row * 5 + col;
}

export const LeadTakeoverSandboxPanel: React.FC<LeadTakeoverSandboxPanelProps> = ({ activeKeys, onOpenChange }) => {
  const [open, setOpen] = useState(false);
  const [beat, setBeat] = useState(0);
  const [connected, setConnected] = useState(false);
  const [sourceKind, setSourceKind] = useState<'demo' | 'generated' | 'uploaded'>('demo');
  const [midiLayoutMode, setMidiLayoutMode] = useState<TakeoverLayoutMode>('chord-analysis');
  const [midiAnalysisSession, setMidiAnalysisSession] = useState<MidiAnalysisSessionState>(
    getMidiAnalysisSession,
  );
  const [leadDiagnostic, setLeadDiagnostic] = useState<string>('--');
  const [nativeLeadMuteAvailable, setNativeLeadMuteAvailable] = useState(true);
  const [snapshot, setSnapshot] = useState<TakeoverMusicSnapshot>(DEMO_SNAPSHOT);
  const [state, setState] = useState<LeadTakeoverState>(() => new LeadTakeoverController().getState());
  const [metronomeEnabled, setMetronomeEnabled] = useState(true);
  const [midiHeld, setMidiHeld] = useState<Set<number>>(() => new Set());
  const [midiStatus, setMidiStatus] = useState<MidiSupport | 'idle' | 'connecting'>('idle');
  const [midiDevices, setMidiDevices] = useState<MidiDeviceInfo[]>([]);
  const [midiDeviceId, setMidiDeviceId] = useState<string | null>(null);
  const [midiPreference, setMidiPreference] = useState(getTakeoverMidiInputPreference);
  const [log, setLog] = useState<string[]>([]);
  const [lastTiming, setLastTiming] = useState<LeadNoteTiming | null>(null);
  const controllerRef = useRef(new LeadTakeoverController());
  const heldKeys = useRef<Set<string>>(new Set());
  const lastResultRef = useRef<MusicGenerationResult | null>(null);
  const activeSourceKindRef = useRef<'demo' | 'generated' | 'uploaded'>('demo');
  const activeMidiSessionIdRef = useRef<number | null>(null);
  const activeMidiLayoutModeRef = useRef<TakeoverLayoutMode>('chord-analysis');
  const nativeLeadChannelRef = useRef(DEFAULT_LEAD_TAKEOVER_CONFIG.leadChannel);
  const nativeLeadNoteRangeRef = useRef<MidiNoteRange | null>(null);
  const nativeLeadNoteTargetsRef = useRef<ReadonlyArray<MidiNoteTarget> | null>(null);
  const nativeLeadRoutingRef = useRef<'generated' | 'uploaded'>('generated');
  const metronomeSnapshotRef = useRef<TakeoverMusicSnapshot>(DEMO_SNAPSHOT);
  const metronomeRef = useRef(new TakeoverMetronomeRuntime());
  const midiAccessRef = useRef<MidiAccessHandle | null>(null);
  const midiHeldBySourceRef = useRef<Map<string, number>>(new Map());
  const midiMessageHandlerRef = useRef<(message: ParsedMidiMessage) => void>(() => undefined);
  const midiConnectAttemptRef = useRef(0);
  const wasOpenRef = useRef(false);
  const uiFrameRef = useRef<number | null>(null);
  const pendingStateSyncRef = useRef(false);
  const pendingMidiHeldSyncRef = useRef(false);
  const pendingTimingRef = useRef<LeadNoteTiming | null>(null);
  const pendingLogLinesRef = useRef<string[]>([]);

  useDevPanelChannel('takeover', open, setOpen);

  useEffect(() => subscribeMidiAnalysisSession(setMidiAnalysisSession), []);

  const midiTakeover = useMemo<MidiTakeoverSnapshotResult | null>(() => {
    if (midiAnalysisSession.status !== 'ready' || !midiAnalysisSession.report) return null;
    const declaredBpm = midiAnalysisSession.report.baseline.tempoMap[0]?.bpm ?? 120;
    return takeoverSnapshotFromMidiAnalysis(
      midiAnalysisSession.report,
      midiLayoutMode,
      declaredBpm,
    );
  }, [midiAnalysisSession, midiLayoutMode]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);

  useEffect(() => {
    if (!open) return undefined;
    // Clear the raw-pitch audition source before Q+T claims MIDI positions.
    silenceRawMidiAudition();
    resetLeadTakeoverRuntimeState(AudioEngine, [nativeLeadChannelRef.current]);
    if (AudioEngine.getCurrentPlaybackKind()) prepareLeadTakeoverVoice(AudioEngine);
    return claimMidiInputExclusive('takeover');
  }, [open]);

  const padMapBeat = useMemo(() => {
    if (snapshot.layoutMode === 'measure-notes') {
      return findMeasureAtBeat(snapshot.measures ?? [], beat)?.startBeat ?? beat;
    }
    return findChordAtBeat(snapshot.chords, beat).current?.startBeat ?? beat;
  }, [beat, snapshot]);
  const padMap = useMemo(() => buildTakeoverPadMap(snapshot, padMapBeat), [padMapBeat, snapshot]);
  const firstCell = padMap.cells.find((cell) => cell.index === TAKEOVER_ASCENDING_PAD_INDICES[0]) ?? null;
  const lastCell = padMap.cells.find((cell) => cell.index === TAKEOVER_ASCENDING_PAD_INDICES[TAKEOVER_ASCENDING_PAD_INDICES.length - 1]) ?? null;
  const spanSemitones = padMap.cells.length > 0
    ? Math.max(...padMap.cells.map((cell) => cell.midi)) - Math.min(...padMap.cells.map((cell) => cell.midi))
    : 0;
  const held = useMemo(() => {
    if (!open) return new Set<number>();
    const pads = new Set(
      [...(activeKeys ?? new Set<string>())]
        .map(padIndexFromKeyId)
        .filter((idx): idx is number => idx !== null),
    );
    midiHeld.forEach((padIndex) => pads.add(padIndex));
    return pads;
  }, [activeKeys, midiHeld, open]);

  const clearMidiHeld = useCallback(() => {
    midiHeldBySourceRef.current.clear();
    setMidiHeld(new Set());
  }, []);

  const scheduleUiFlush = useCallback(() => {
    if (uiFrameRef.current !== null) return;
    uiFrameRef.current = window.requestAnimationFrame(() => {
      uiFrameRef.current = null;
      if (pendingStateSyncRef.current) {
        pendingStateSyncRef.current = false;
        const next = controllerRef.current.getState();
        setState((previous) => (
          previous.mode === next.mode
          && previous.inputCount === next.inputCount
          && previous.firstInputBeat === next.firstInputBeat
          && previous.lastInputBeat === next.lastInputBeat
          && previous.leadMuted === next.leadMuted
          && previous.backingDucked === next.backingDucked
            ? previous
            : next
        ));
      }
      if (pendingMidiHeldSyncRef.current) {
        pendingMidiHeldSyncRef.current = false;
        setMidiHeld(new Set(midiHeldBySourceRef.current.values()));
      }
      if (pendingTimingRef.current) {
        setLastTiming(pendingTimingRef.current);
        pendingTimingRef.current = null;
      }
      if (pendingLogLinesRef.current.length > 0) {
        const lines = pendingLogLinesRef.current;
        pendingLogLinesRef.current = [];
        setLog((previous) => [...lines, ...previous].slice(0, 8));
      }
    });
  }, []);

  const syncState = useCallback(() => {
    pendingStateSyncRef.current = true;
    scheduleUiFlush();
  }, [scheduleUiFlush]);

  const syncMidiHeld = useCallback(() => {
    pendingMidiHeldSyncRef.current = true;
    scheduleUiFlush();
  }, [scheduleUiFlush]);

  const pushActions = useCallback((actions: readonly LeadTakeoverAction[]) => {
    if (actions.length === 0) return;
    const latestTiming = [...actions].reverse().find((a): a is Extract<LeadTakeoverAction, { type: 'lead-note-on' | 'lead-note-off' }> => (a.type === 'lead-note-on' || a.type === 'lead-note-off') && !!a.timing)?.timing;
    if (latestTiming) pendingTimingRef.current = latestTiming;
    const current = AudioEngine.getCurrentMusicGeneration();
    const playbackActive = current !== null || AudioEngine.getCurrentPlaybackKind() === 'uploaded';
    const executeOptions = {
      nativeLeadChannel: nativeLeadChannelRef.current,
      nativeLeadNoteRange: nativeLeadNoteRangeRef.current,
      nativeLeadNoteTargets: nativeLeadNoteTargetsRef.current,
      nativeLeadRouting: nativeLeadRoutingRef.current,
    };
    const offlineCleanup = playbackActive
      ? []
      : actions.filter((action) => (
        action.type === 'panic'
        || (action.type === 'lead-mute' && !action.muted)
        || (action.type === 'backing-gain' && action.scale === 1)
      ));
    const monitoredActions = playbackActive
      ? []
      : actions.filter((action) => !offlineCleanup.includes(action));
    const lines = [
      ...(playbackActive
        ? executeLeadTakeoverActions(AudioEngine, actions, executeOptions)
        : executeLeadTakeoverActions(AudioEngine, offlineCleanup, executeOptions)),
      ...monitoredActions.map((action) => `monitor ${formatAction(action)}`),
    ];
    pendingLogLinesRef.current = [...lines, ...pendingLogLinesRef.current].slice(0, 8);
    scheduleUiFlush();
  }, [scheduleUiFlush]);

  useEffect(() => () => {
    if (uiFrameRef.current !== null) window.cancelAnimationFrame(uiFrameRef.current);
    uiFrameRef.current = null;
  }, []);

  useEffect(() => () => {
    resetLeadTakeoverRuntimeState(AudioEngine, [nativeLeadChannelRef.current]);
    executeLeadTakeoverActions(
      AudioEngine,
      controllerRef.current.reset({ restoreNativeLead: true }),
      {
        nativeLeadChannel: nativeLeadChannelRef.current,
        nativeLeadNoteRange: nativeLeadNoteRangeRef.current,
        nativeLeadNoteTargets: nativeLeadNoteTargetsRef.current,
        nativeLeadRouting: nativeLeadRoutingRef.current,
      },
    );
  }, []);

  useEffect(() => {
    controllerRef.current.setSnapshot(snapshot, beat);
    pushActions(controllerRef.current.tick(beat));
    syncState();
  }, [beat, pushActions, snapshot, syncState]);

  useEffect(() => {
    if (!metronomeEnabled) metronomeRef.current.stop(AudioEngine);
  }, [metronomeEnabled]);

  useEffect(() => {
    if (!open) return;
    const pollQhState = () => {
      const result = AudioEngine.getCurrentMusicGeneration();
      const uploaded = !result
        && AudioEngine.getCurrentPlaybackKind() === 'uploaded'
        && midiTakeover
        ? midiTakeover
        : null;
      const nextSourceKind: 'demo' | 'generated' | 'uploaded' = result
        ? 'generated'
        : uploaded
          ? 'uploaded'
          : 'demo';
      const nextMidiSessionId = uploaded ? midiAnalysisSession.id : null;
      const sourceChanged = nextSourceKind !== activeSourceKindRef.current
        || result !== lastResultRef.current
        || nextMidiSessionId !== activeMidiSessionIdRef.current
        || (
          nextSourceKind === 'uploaded'
          && midiLayoutMode !== activeMidiLayoutModeRef.current
        );
      if (sourceChanged) {
        const currentTakeoverState = controllerRef.current.getState();
        const keepTakeoverState = currentTakeoverState.leadMuted
          || currentTakeoverState.backingDucked;
        const sameUnderlyingSource = nextSourceKind === activeSourceKindRef.current
          && (
            nextSourceKind === 'generated'
            || (
              nextSourceKind === 'uploaded'
              && nextMidiSessionId === activeMidiSessionIdRef.current
            )
          );
        resetLeadTakeoverRuntimeState(AudioEngine, [nativeLeadChannelRef.current]);
        resetTakeoverPadInputState();
        metronomeRef.current.stop(AudioEngine);
        pushActions(controllerRef.current.reset({
          restoreNativeLead: !sameUnderlyingSource,
        }));

        const nextNativeLeadChannel = uploaded?.nativeLeadChannel
          ?? DEFAULT_LEAD_TAKEOVER_CONFIG.leadChannel;
        if (!keepTakeoverState || !sameUnderlyingSource) {
          controllerRef.current = new LeadTakeoverController({
            leadChannel: nextNativeLeadChannel,
            nativeLeadMuteEnabled: uploaded
              ? uploaded.nativeMuteStrategy !== 'none'
              : true,
          });
        }
        nativeLeadChannelRef.current = nextNativeLeadChannel;
        nativeLeadNoteRangeRef.current = uploaded?.nativeLeadNoteRange ?? null;
        nativeLeadNoteTargetsRef.current = uploaded?.nativeLeadNoteTargets ?? null;
        nativeLeadRoutingRef.current = uploaded ? 'uploaded' : 'generated';
        syncState();
        clearMidiHeld();
        setLastTiming(null);
        lastResultRef.current = result;
        activeSourceKindRef.current = nextSourceKind;
        activeMidiSessionIdRef.current = nextMidiSessionId;
        activeMidiLayoutModeRef.current = midiLayoutMode;
        setSourceKind(nextSourceKind);
        setConnected(nextSourceKind !== 'demo');
        setNativeLeadMuteAvailable(uploaded
          ? uploaded.nativeMuteStrategy !== 'none'
          : true);
        metronomeSnapshotRef.current = result
          ? takeoverSnapshotFromMusicGeneration(result)
          : uploaded?.snapshot ?? DEMO_SNAPSHOT;
        setSnapshot(metronomeSnapshotRef.current);
        controllerRef.current.setSnapshot(
          metronomeSnapshotRef.current,
          nextSourceKind === 'demo' ? 0 : AudioEngine.getCurrentBeat(),
        );
        if (nextSourceKind !== 'demo') prepareLeadTakeoverVoice(AudioEngine);
        setLeadDiagnostic(uploaded
          ? uploaded.nativeMuteStrategy === 'top-voice-notes' && uploaded.nativeLeadNoteTargets
            ? `${uploaded.leadLaneId} 未独立 · mute 顶部旋律 ${uploaded.nativeLeadNoteTargets.length} 音`
            : `${uploaded.leadLaneId} · ch${uploaded.nativeLeadChannel + 1} · ${uploaded.leadSelectionSource} ${Math.round(uploaded.leadConfidence * 100)}%${uploaded.canMuteNativeLead ? '' : ' · no mute target'}`
          : result
            ? `Q+H lead · ch${DEFAULT_LEAD_TAKEOVER_CONFIG.leadChannel + 1}`
            : '--');
        const sourceLog = result
          ? 'connected Q+H musicGeneration'
          : uploaded
            ? `connected uploaded MIDI · ${midiLayoutMode}`
            : 'disconnected: demo monitor';
        setLog((prev) => [sourceLog, ...prev].slice(0, 8));
      }
      if (result || uploaded) {
        const liveBeat = AudioEngine.getCurrentBeat();
        prepareLeadTakeoverVoice(AudioEngine);
        controllerRef.current.setSnapshot(metronomeSnapshotRef.current, liveBeat);
        const handoffActions = controllerRef.current.tick(liveBeat);
        pushActions(handoffActions);
        if (handoffActions.length > 0) syncState();
        pushActions(reconcileNativeLeadMute(
          AudioEngine,
          controllerRef.current.getState().leadMuted,
          nativeLeadChannelRef.current,
          nativeLeadNoteRangeRef.current,
          nativeLeadNoteTargetsRef.current,
        ));
        if (uploaded) {
          pushActions(reconcileUploadedMidiGain(
            AudioEngine,
            controllerRef.current.getState().backingDucked,
          ));
        }
        setBeat(liveBeat);
        if (metronomeEnabled) metronomeRef.current.schedule(AudioEngine, metronomeSnapshotRef.current, liveBeat);
        else metronomeRef.current.stop(AudioEngine);
      } else {
        metronomeRef.current.stop(AudioEngine);
      }
    };
    pollQhState();
    const interval = window.setInterval(pollQhState, LIVE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [
    clearMidiHeld,
    metronomeEnabled,
    midiLayoutMode,
    midiAnalysisSession.id,
    midiTakeover,
    open,
    pushActions,
    syncState,
  ]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      resetLeadTakeoverRuntimeState(AudioEngine, [nativeLeadChannelRef.current]);
      resetTakeoverPadInputState();
      metronomeRef.current.stop(AudioEngine);
      pushActions(controllerRef.current.reset({ restoreNativeLead: true }));
      controllerRef.current = new LeadTakeoverController();
      nativeLeadChannelRef.current = DEFAULT_LEAD_TAKEOVER_CONFIG.leadChannel;
      nativeLeadNoteRangeRef.current = null;
      nativeLeadNoteTargetsRef.current = null;
      nativeLeadRoutingRef.current = 'generated';
      activeSourceKindRef.current = 'demo';
      activeMidiSessionIdRef.current = null;
      setSourceKind('demo');
      setConnected(false);
      setNativeLeadMuteAvailable(true);
      setLeadDiagnostic('--');
      syncState();
      clearMidiHeld();
      midiConnectAttemptRef.current += 1;
      midiAccessRef.current?.dispose();
      midiAccessRef.current = null;
      setMidiStatus('idle');
      setMidiDevices([]);
      setLastTiming(null);
    }
    wasOpenRef.current = open;
  }, [clearMidiHeld, open, pushActions, syncState]);

  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      heldKeys.current.add(k);
      if (!open && heldKeys.current.has('q') && heldKeys.current.has('t') && !isTyping()) {
        e.preventDefault();
        setOpen(true);
      } else if (open && k === 'escape') {
        setOpen(false);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => heldKeys.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [open]);

  const nativeNoteDown = useCallback((idx: number, velocity = DEFAULT_LEAD_TAKEOVER_CONFIG.defaultVelocity, sourceId?: string) => {
    const currentResult = AudioEngine.getCurrentMusicGeneration();
    const playbackKind = AudioEngine.getCurrentPlaybackKind();
    if (playbackKind === 'uploaded' && activeSourceKindRef.current !== 'uploaded') return;
    const liveBeat = currentResult || playbackKind === 'uploaded'
      ? AudioEngine.getCurrentBeat()
      : beat;
    if (currentResult) {
      const resultChanged = currentResult !== lastResultRef.current;
      const liveSnapshot = resultChanged
        ? takeoverSnapshotFromMusicGeneration(currentResult)
        : metronomeSnapshotRef.current;
      if (resultChanged) {
        const keepNativeLeadMuted = controllerRef.current.getState().leadMuted;
        resetLeadTakeoverRuntimeState(AudioEngine, [nativeLeadChannelRef.current]);
        pushActions(controllerRef.current.reset());
        if (!keepNativeLeadMuted) controllerRef.current = new LeadTakeoverController();
        nativeLeadChannelRef.current = DEFAULT_LEAD_TAKEOVER_CONFIG.leadChannel;
        nativeLeadNoteRangeRef.current = null;
        nativeLeadNoteTargetsRef.current = null;
        nativeLeadRoutingRef.current = 'generated';
        setNativeLeadMuteAvailable(true);
        lastResultRef.current = currentResult;
        metronomeSnapshotRef.current = liveSnapshot;
        setConnected(true);
        setSnapshot(liveSnapshot);
      }
      controllerRef.current.setSnapshot(liveSnapshot, liveBeat);
      if (resultChanged) prepareLeadTakeoverVoice(AudioEngine);
    }
    pushActions(controllerRef.current.noteOn(idx, liveBeat, velocity, sourceId));
    syncState();
  }, [beat, pushActions, syncState]);

  const nativeNoteUp = useCallback((idx: number, sourceId?: string) => {
    const playbackActive = AudioEngine.getCurrentMusicGeneration()
      || AudioEngine.getCurrentPlaybackKind() === 'uploaded';
    const liveBeat = playbackActive ? AudioEngine.getCurrentBeat() : beat;
    pushActions(controllerRef.current.noteOff(idx, liveBeat, sourceId));
    syncState();
  }, [beat, pushActions, syncState]);

  useEffect(() => {
    return subscribeTakeoverPadInput((event) => {
      if (!open) return;
      if (event.type === 'down') nativeNoteDown(event.padIndex);
      else nativeNoteUp(event.padIndex);
    });
  }, [nativeNoteDown, nativeNoteUp, open]);

  const handleMidiMessage = useCallback((message: ParsedMidiMessage) => {
    if (!open) return;
    const event = modulateTakeoverMidiMessage(message);
    if (!event) return;

    if (event.type === 'down') {
      if (midiHeldBySourceRef.current.has(event.sourceId)) return;
      midiHeldBySourceRef.current.set(event.sourceId, event.padIndex);
      syncMidiHeld();
      nativeNoteDown(event.padIndex, event.velocity, event.sourceId);
      return;
    }

    if (!midiHeldBySourceRef.current.has(event.sourceId)) return;
    midiHeldBySourceRef.current.delete(event.sourceId);
    syncMidiHeld();
    nativeNoteUp(event.padIndex, event.sourceId);
  }, [nativeNoteDown, nativeNoteUp, open, syncMidiHeld]);

  useEffect(() => {
    midiMessageHandlerRef.current = handleMidiMessage;
  }, [handleMidiMessage]);

  useEffect(() => subscribeTakeoverMidiInputPreference(setMidiPreference), []);

  useEffect(() => {
    const matched = resolveTakeoverMidiInput(midiDevices, midiPreference);
    setMidiDeviceId(matched?.id ?? null);
    midiAccessRef.current?.selectInput(matched?.id ?? null);
  }, [midiDevices, midiPreference]);

  const enableMidi = useCallback(async () => {
    const attempt = ++midiConnectAttemptRef.current;
    setMidiStatus('connecting');
    try {
      await startAudioContext();
    } catch {
      setLog((prev) => ['MIDI input ready; audio output is not ready', ...prev].slice(0, 8));
    }
    midiAccessRef.current?.dispose();
    midiAccessRef.current = null;
    const onDevices = (devices: MidiDeviceInfo[]) => {
      if (attempt !== midiConnectAttemptRef.current) return;
      setMidiDevices(devices);
      let preference = getTakeoverMidiInputPreference();
      let matched = resolveTakeoverMidiInput(devices, preference);
      // Preserve the old one-click behaviour for first-time users, then make
      // that choice explicit and persistent for every later Q+T session.
      if (!preference && devices[0]) {
        setTakeoverMidiInputPreference(devices[0]);
        preference = getTakeoverMidiInputPreference();
        matched = devices[0];
      } else if (preference && matched && matched.id !== preference.id) {
        setTakeoverMidiInputPreference(matched);
      }
      setMidiDeviceId(matched?.id ?? null);
      midiAccessRef.current?.selectInput(matched?.id ?? null);
    };
    const { status: nextStatus, handle } = await requestMidiAccess(
      (message) => midiMessageHandlerRef.current(message),
      onDevices,
      { exclusiveOwner: 'takeover' },
    );
    if (attempt !== midiConnectAttemptRef.current) {
      handle?.dispose();
      return;
    }
    setMidiStatus(nextStatus);
    if (handle) {
      midiAccessRef.current = handle;
      const matched = resolveTakeoverMidiInput(handle.listInputs(), getTakeoverMidiInputPreference());
      handle.selectInput(matched?.id ?? null);
      setMidiDeviceId(matched?.id ?? null);
    }
  }, []);

  useEffect(() => {
    if (!open || midiStatus !== 'idle' || !midiPreference) return;
    void enableMidi();
  }, [enableMidi, midiPreference, midiStatus, open]);

  useEffect(() => () => {
    midiConnectAttemptRef.current += 1;
    midiAccessRef.current?.dispose();
    midiAccessRef.current = null;
  }, []);

  const reset = useCallback(() => {
    resetLeadTakeoverRuntimeState(AudioEngine, [nativeLeadChannelRef.current]);
    resetTakeoverPadInputState();
    pushActions(controllerRef.current.reset());
    clearMidiHeld();
    setLastTiming(null);
    setLog((prev) => ['reset', ...prev].slice(0, 8));
    syncState();
  }, [clearMidiHeld, pushActions, syncState]);

  const stepBeat = useCallback(() => {
    if (connected) return;
    setBeat((b) => Math.min(16, Math.round((b + 0.5) * 2) / 2));
  }, [connected]);

  const takeoverSourceMode: LeadTakeoverSourceMode = sourceKind === 'uploaded'
    ? 'midi-score'
    : 'music-generation';

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute z-[70] max-h-[58%] overflow-auto rounded-2xl border border-teal-500/30
                 bg-zinc-950/95 text-zinc-200 shadow-[0_8px_40px_rgba(0,0,0,0.7)] backdrop-blur-md"
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        top: 'calc(427 / 1410 * 100%)',
        left: 'calc(90 / 1537 * 100% - min(280px, 35vw) - 12px)',
        width: 'min(280px, 35vw)',
      }}
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Hand size={15} className="text-teal-300" />
        <span className="text-[12px] font-semibold tracking-wide text-teal-200">
          {takeoverSourceMode === 'midi-score' ? 'MIDI谱接管模式' : '音乐生成接管模式'}
        </span>
        <span className="text-[10px] text-zinc-500">Q+T</span>
        <span className={connected ? 'text-[10px] text-emerald-300' : 'text-[10px] text-zinc-600'}>
          {sourceKind === 'generated' ? 'Q+H live' : sourceKind === 'uploaded' ? 'MIDI live' : 'demo'}
        </span>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto text-zinc-500 hover:text-zinc-200" aria-label="关闭">
          <X size={15} />
        </button>
      </div>

      <div className="space-y-2 border-b border-zinc-900 px-3 py-2 text-[11px]">
        {takeoverSourceMode === 'midi-score' ? (
          <div className="grid grid-cols-2 gap-1 border-b border-zinc-900 pb-2">
            <button
              type="button"
              onClick={() => setMidiLayoutMode('chord-analysis')}
              className={`rounded border px-2 py-1 text-[10px] ${
                midiLayoutMode === 'chord-analysis'
                  ? 'border-teal-400/60 bg-teal-500/15 text-teal-100'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-500'
              }`}
              title="使用 MIDI 分析出的当前和弦，沿用原接管安全音阶铺键"
            >
              和弦分析
            </button>
            <button
              type="button"
              onClick={() => setMidiLayoutMode('measure-notes')}
              className={`rounded border px-2 py-1 text-[10px] ${
                midiLayoutMode === 'measure-notes'
                  ? 'border-fuchsia-400/60 bg-fuchsia-500/15 text-fuchsia-100'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-500'
              }`}
              title="当前小节的旋律、Bass、伴奏共同入池；低到高排列，核心居中，半音经过音最多 4 个"
            >
              选音
            </button>
            <div className="col-span-2 text-[9px] text-zinc-600">
              {midiLayoutMode === 'chord-analysis'
                ? '当前和弦切片动态铺键'
                : '旋律+Bass+伴奏 · 核心≤5 · 半音经过≤4'}
            </div>
          </div>
        ) : (
          <div className="border-b border-zinc-900 pb-2">
            <div className="rounded border border-emerald-500/35 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-100">
              音乐生成接管模式
            </div>
            <div className="mt-1 text-[9px] text-zinc-600">
              沿用原音乐生成和弦与局部安全音阶接管链路
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-zinc-500">beat</span>
          <input
            type="range"
            min={0}
            max={connected ? Math.max(15.75, Math.ceil(beat)) : 15.75}
            step={0.25}
            value={beat}
            disabled={connected}
            onChange={(e) => { if (!connected) setBeat(Number(e.target.value)); }}
            className="min-w-0 flex-1 accent-teal-400 disabled:opacity-40"
          />
          <span className="w-10 text-right text-teal-200">{beat.toFixed(2)}</span>
          <button
            type="button"
            onClick={stepBeat}
            disabled={connected}
            className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-zinc-300 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
            title={connected ? 'live playback beat' : '步进半拍'}
          >
            <StepForward size={13} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-zinc-400">
          <div>chord <span className="text-zinc-100">{padMap.chord?.roman ?? '--'} · pc{padMap.chord?.rootPc ?? '-'}</span></div>
          <div>scale <span className="text-zinc-100">{padMap.localScaleName}</span></div>
          <div>measure <span className="text-zinc-100">{padMap.measure?.label ?? '--'}</span></div>
          <div>layout <span className="text-zinc-100">{padMap.source}</span></div>
          <div>mode <span className="text-zinc-100">{state.mode}</span></div>
          <div>input <span className="text-zinc-100">{state.inputCount}</span></div>
          <div>grid <span className="text-zinc-100">{lastTiming?.grid ?? DEFAULT_LEAD_TAKEOVER_CONFIG.quantizeGrid}</span></div>
          <div>q <span className="text-zinc-100">{lastTiming ? `${lastTiming.sourceBeat.toFixed(2)} -> ${lastTiming.targetBeat.toFixed(2)}` : '--'}</span></div>
          <div>delay <span className="text-zinc-100">{lastTiming ? `${Math.round(lastTiming.delayMs)}ms` : '--'}</span></div>
          <div>groove <span className="text-zinc-100">{lastTiming?.grooveContractId ?? snapshot.grooveContract?.id ?? '--'}</span></div>
          <div>pocket <span className="text-zinc-100">{lastTiming?.grooveOffsetMs !== undefined ? `${Math.round(lastTiming.grooveOffsetMs)}ms` : '--'}</span></div>
          <div>range <span className="text-zinc-100">{firstCell && lastCell ? `${firstCell.name}->${lastCell.name} · ${spanSemitones}st` : '--'}</span></div>
          <div className="col-span-2 truncate" title={leadDiagnostic}>lead <span className="text-zinc-100">{leadDiagnostic}</span></div>
        </div>
        <label className="flex w-fit cursor-pointer items-center gap-1.5 border-t border-zinc-900 pt-2 text-[10px] text-zinc-400" title="开关接管沙盒独立节拍器">
          <input
            type="checkbox"
            checked={metronomeEnabled}
            onChange={(event) => setMetronomeEnabled(event.target.checked)}
            className="h-3 w-3 accent-teal-400"
          />
          <span>metronome</span>
          <span className={metronomeEnabled ? 'text-teal-200' : 'text-zinc-600'}>{metronomeEnabled ? 'on' : 'off'}</span>
        </label>
        <div className="flex min-w-0 items-center gap-2 border-t border-zinc-900 pt-2 text-[10px]">
          <span className="shrink-0 uppercase tracking-widest text-zinc-500">MIDI in</span>
          {midiStatus === 'idle' && (
            <button type="button" onClick={() => void enableMidi()} className="border border-zinc-700 px-1.5 py-0.5 text-zinc-300 hover:border-teal-400/60 hover:text-teal-200">
              connect
            </button>
          )}
          {midiStatus === 'connecting' && <span className="text-teal-300">connecting fixed input…</span>}
          {midiStatus === 'unsupported' && <span className="text-rose-300">browser unsupported</span>}
          {midiStatus === 'denied' && (
            <button type="button" onClick={() => void enableMidi()} className="text-amber-300 underline underline-offset-2">permission denied · retry</button>
          )}
          {midiStatus === 'ready' && (
            midiDevices.length > 0
              ? <select
                value={midiDeviceId ?? ''}
                onChange={(event) => {
                  const device = midiDevices.find((candidate) => candidate.id === event.target.value);
                  setTakeoverMidiInputPreference(device ?? null);
                }}
                className="min-w-0 flex-1 border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200 outline-none focus:border-teal-400"
                title="这里的选择会同步保存到左上角 5504 console，并在下次打开 Q+T 时自动连接。"
              >
                {!midiDeviceId && <option value="">{midiPreference ? `固定设备离线 · ${midiPreference.name}` : '请选择设备'}</option>}
                {midiDevices.map((device) => <option key={device.id} value={device.id}>{midiInputTransportLabel(device) ? `${midiInputTransportLabel(device)} · ` : ''}{device.name}</option>)}
              </select>
              : <span className="text-zinc-500">no device</span>
          )}
        </div>
      </div>

      <div className="border-b border-zinc-900 px-3 py-2">
        <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-500">
          3x5 + MIDI Position Monitor
          <span className="ml-auto normal-case tracking-normal text-zinc-600">{sourceKind === 'generated' ? 'Q+H' : padMap.source} · {firstCell?.name ?? '--'} to {lastCell?.name ?? '--'}</span>
        </div>
        <div className="grid select-none gap-1" style={{ gridTemplateColumns: 'repeat(5, 1fr)', touchAction: 'none' }}>
          {padMap.cells.map((cell) => {
            const on = held.has(cell.index);
            return (
              <div
                key={cell.index}
                className={`rounded-md border px-1 py-2 text-center text-[10px] leading-tight transition-all duration-75
                  ${ROLE_STYLE[cell.classRole]} ${on ? 'scale-95 shadow-[0_0_12px_rgba(45,212,191,0.65)] ring-1 ring-teal-200/70' : ''}`}
                title={`MIDI ${midiName(TAKEOVER_MIDI_POSITION_NOTES[cell.index] ?? 0)} -> ${cell.name} · ${cell.degreeLabel} · ${cell.classRole}`}
              >
                <span className="block font-semibold">{cell.name}</span>
                <span className="text-[9px] opacity-80">{cell.degreeLabel}</span>
                <span className="block text-[8px] opacity-55">{midiName(TAKEOVER_MIDI_POSITION_NOTES[cell.index] ?? 0)}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 text-[10px] leading-snug text-zinc-600">
          MIDI 自然音 C3 至 C5 依左上到右下只选位置；
          {padMap.source === 'midi-measure-notes'
            ? ' 当前小节旋律、Bass、伴奏全部进入选音池；先用八度展开去重，再按低到高排列。旋律保留标记，中央优先核心，半音经过最多约 30%。'
            : ' 实际发声取当前和弦/局部安全音阶，不直通输入设备原音高。'}
        </div>
      </div>

      <div className="space-y-2 px-3 py-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={reset} className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700">
            <RotateCcw size={12} />
            reset
          </button>
          <span className={state.leadMuted ? 'text-[11px] text-rose-300' : 'text-[11px] text-zinc-500'}>
            lead {state.leadMuted
              ? takeoverSourceMode === 'midi-score'
                && midiTakeover?.nativeMuteStrategy === 'top-voice-notes'
                ? 'top voice muted'
                : 'muted'
              : nativeLeadMuteAvailable
                ? 'native'
                : 'shared · not muted'}
          </span>
          {sourceKind === 'uploaded' && (
            <span className={state.backingDucked ? 'text-[10px] text-teal-300' : 'text-[10px] text-zinc-600'}>
              MIDI {state.backingDucked ? '90%' : '100%'}
            </span>
          )}
        </div>
        <div className="rounded-lg border border-zinc-800 bg-black/30 px-2 py-1.5">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-zinc-500">
            {connected ? 'Takeover Input Consumed Actions' : 'Takeover Input Monitor Actions'}
          </div>
          {log.length === 0
            ? <div className="text-[11px] text-zinc-600">--</div>
            : log.map((line, idx) => <div key={`${line}-${idx}`} className="text-[11px] text-zinc-300">{line}</div>)}
        </div>
      </div>
    </motion.div>
  );
};
