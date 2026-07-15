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
import { AudioEngine } from '../../audio/AudioEngine';
import { buildTakeoverPadMap, findChordAtBeat } from './harmonicNoteMap';
import { TAKEOVER_ASCENDING_PAD_INDICES } from './padLayout';
import { DEFAULT_LEAD_TAKEOVER_CONFIG, LeadTakeoverController } from './leadTakeoverController';
import { resetTakeoverPadInputState, subscribeTakeoverPadInput } from './takeoverInputBus';
import { TakeoverMetronomeRuntime } from './takeoverMetronome';
import {
  executeLeadTakeoverActions,
  resetLeadTakeoverRuntimeState,
  takeoverSnapshotFromMusicGeneration,
} from './qhTakeoverConsumer';
import type { MusicGenerationResult } from '../musicGeneration/types';
import type { LeadTakeoverAction, LeadTakeoverState, TakeoverMusicSnapshot, TakeoverPadCell } from './types';

const DEMO_SNAPSHOT: TakeoverMusicSnapshot = {
  styleHint: 'jazz',
  key: 'C',
  tonality: 'major',
  bpm: 112,
  timeSignature: [4, 4],
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
  if (a.type === 'lead-mute') return `${a.muted ? 'mute' : 'unmute'} lead ch${a.channel}`;
  return `panic ch${a.channel}`;
}

type LeadNoteTiming = NonNullable<Extract<LeadTakeoverAction, { type: 'lead-note-on' | 'lead-note-off' }>['timing']>;

interface LeadTakeoverSandboxPanelProps {
  activeKeys?: Set<string>;
}

function padIndexFromKeyId(keyId: string): number | null {
  const parts = keyId.split('-');
  if (parts.length !== 3 || parts[0] !== 'key') return null;
  const col = Number(parts[1]);
  const row = Number(parts[2]);
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || col > 4 || row < 0 || row > 2) return null;
  return row * 5 + col;
}

export const LeadTakeoverSandboxPanel: React.FC<LeadTakeoverSandboxPanelProps> = ({ activeKeys }) => {
  const [open, setOpen] = useState(false);
  const [beat, setBeat] = useState(0);
  const [connected, setConnected] = useState(false);
  const [snapshot, setSnapshot] = useState<TakeoverMusicSnapshot>(DEMO_SNAPSHOT);
  const [state, setState] = useState<LeadTakeoverState>(() => new LeadTakeoverController().getState());
  const [held, setHeld] = useState<Set<number>>(() => new Set());
  const [log, setLog] = useState<string[]>([]);
  const [lastTiming, setLastTiming] = useState<LeadNoteTiming | null>(null);
  const controllerRef = useRef(new LeadTakeoverController());
  const heldKeys = useRef<Set<string>>(new Set());
  const lastResultRef = useRef<MusicGenerationResult | null>(null);
  const metronomeSnapshotRef = useRef<TakeoverMusicSnapshot>(DEMO_SNAPSHOT);
  const metronomeRef = useRef(new TakeoverMetronomeRuntime());
  const wasOpenRef = useRef(false);

  useDevPanelChannel('takeover', open, setOpen);

  const padMapBeat = useMemo(() => findChordAtBeat(snapshot.chords, beat).current?.startBeat ?? beat, [beat, snapshot]);
  const padMap = useMemo(() => buildTakeoverPadMap(snapshot, padMapBeat), [padMapBeat, snapshot]);
  const firstCell = padMap.cells.find((cell) => cell.index === TAKEOVER_ASCENDING_PAD_INDICES[0]) ?? null;
  const lastCell = padMap.cells.find((cell) => cell.index === TAKEOVER_ASCENDING_PAD_INDICES[TAKEOVER_ASCENDING_PAD_INDICES.length - 1]) ?? null;
  const spanSemitones = padMap.cells.length > 0
    ? Math.max(...padMap.cells.map((cell) => cell.midi)) - Math.min(...padMap.cells.map((cell) => cell.midi))
    : 0;

  const syncState = useCallback(() => {
    setState(controllerRef.current.getState());
  }, []);

  const pushActions = useCallback((actions: readonly LeadTakeoverAction[]) => {
    if (actions.length === 0) return;
    const latestTiming = [...actions].reverse().find((a): a is Extract<LeadTakeoverAction, { type: 'lead-note-on' | 'lead-note-off' }> => (a.type === 'lead-note-on' || a.type === 'lead-note-off') && !!a.timing)?.timing;
    if (latestTiming) setLastTiming(latestTiming);
    const current = AudioEngine.getCurrentMusicGeneration();
    const lines = current
      ? executeLeadTakeoverActions(AudioEngine, actions)
      : actions.map((a) => `monitor ${formatAction(a)}`);
    setLog((prev) => [...lines, ...prev].slice(0, 8));
  }, []);

  useEffect(() => {
    controllerRef.current.setSnapshot(snapshot, beat);
    pushActions(controllerRef.current.tick(beat));
    syncState();
  }, [beat, pushActions, snapshot, syncState]);

  useEffect(() => {
    if (!open) return;
    const pollQhState = () => {
      const result = AudioEngine.getCurrentMusicGeneration();
      if (result !== lastResultRef.current) {
        resetLeadTakeoverRuntimeState(AudioEngine);
        resetTakeoverPadInputState();
        metronomeRef.current.stop(AudioEngine);
        pushActions(controllerRef.current.reset());
        controllerRef.current = new LeadTakeoverController();
        syncState();
        setHeld(new Set());
        setLastTiming(null);
        lastResultRef.current = result;
        setConnected(result !== null);
        metronomeSnapshotRef.current = result ? takeoverSnapshotFromMusicGeneration(result) : DEMO_SNAPSHOT;
        setSnapshot(metronomeSnapshotRef.current);
        setLog((prev) => [result ? 'connected Q+H musicGeneration' : 'disconnected: demo monitor', ...prev].slice(0, 8));
      }
      if (result) {
        const liveBeat = AudioEngine.getCurrentBeat();
        setBeat(liveBeat);
        metronomeRef.current.schedule(AudioEngine, metronomeSnapshotRef.current, liveBeat);
      } else {
        metronomeRef.current.stop(AudioEngine);
      }
    };
    pollQhState();
    const interval = window.setInterval(pollQhState, LIVE_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [open, pushActions, syncState]);

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      resetLeadTakeoverRuntimeState(AudioEngine);
      resetTakeoverPadInputState();
      metronomeRef.current.stop(AudioEngine);
      pushActions(controllerRef.current.reset());
      controllerRef.current = new LeadTakeoverController();
      syncState();
      setHeld(new Set());
      setLastTiming(null);
    }
    wasOpenRef.current = open;
  }, [open, pushActions, syncState]);

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

  const nativeNoteDown = useCallback((idx: number) => {
    const liveBeat = connected ? AudioEngine.getCurrentBeat() : beat;
    if (connected) setBeat(liveBeat);
    pushActions(controllerRef.current.noteOn(idx, liveBeat));
    syncState();
  }, [beat, connected, pushActions, syncState]);

  const nativeNoteUp = useCallback((idx: number) => {
    const liveBeat = connected ? AudioEngine.getCurrentBeat() : beat;
    if (connected) setBeat(liveBeat);
    pushActions(controllerRef.current.noteOff(idx, liveBeat));
    syncState();
  }, [beat, connected, pushActions, syncState]);

  useEffect(() => {
    return subscribeTakeoverPadInput((event) => {
      if (!open) return;
      if (event.type === 'down') nativeNoteDown(event.padIndex);
      else nativeNoteUp(event.padIndex);
    });
  }, [nativeNoteDown, nativeNoteUp, open]);

  useEffect(() => {
    if (!open) {
      setHeld(new Set());
      return;
    }
    const current = activeKeys ?? new Set<string>();
    setHeld(new Set([...current].map(padIndexFromKeyId).filter((idx): idx is number => idx !== null)));
  }, [activeKeys, open]);

  const reset = useCallback(() => {
    resetLeadTakeoverRuntimeState(AudioEngine);
    resetTakeoverPadInputState();
    pushActions(controllerRef.current.reset());
    setHeld(new Set());
    setLastTiming(null);
    setLog((prev) => ['reset', ...prev].slice(0, 8));
    syncState();
  }, [pushActions, syncState]);

  const stepBeat = useCallback(() => {
    if (connected) return;
    setBeat((b) => Math.min(16, Math.round((b + 0.5) * 2) / 2));
  }, [connected]);

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
        <span className="text-[12px] font-semibold tracking-wide text-teal-200">用户接管沙盒</span>
        <span className="text-[10px] text-zinc-500">Q+T</span>
        <span className={connected ? 'text-[10px] text-emerald-300' : 'text-[10px] text-zinc-600'}>
          {connected ? 'Q+H live' : 'demo'}
        </span>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto text-zinc-500 hover:text-zinc-200" aria-label="关闭">
          <X size={15} />
        </button>
      </div>

      <div className="space-y-2 border-b border-zinc-900 px-3 py-2 text-[11px]">
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
            title={connected ? 'Q+H live beat' : '步进半拍'}
          >
            <StepForward size={13} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-zinc-400">
          <div>chord <span className="text-zinc-100">{padMap.chord?.roman ?? '--'} · pc{padMap.chord?.rootPc ?? '-'}</span></div>
          <div>scale <span className="text-zinc-100">{padMap.localScaleName}</span></div>
          <div>mode <span className="text-zinc-100">{state.mode}</span></div>
          <div>input <span className="text-zinc-100">{state.inputCount}</span></div>
          <div>grid <span className="text-zinc-100">{lastTiming?.grid ?? DEFAULT_LEAD_TAKEOVER_CONFIG.quantizeGrid}</span></div>
          <div>q <span className="text-zinc-100">{lastTiming ? `${lastTiming.sourceBeat.toFixed(2)} -> ${lastTiming.targetBeat.toFixed(2)}` : '--'}</span></div>
          <div>delay <span className="text-zinc-100">{lastTiming ? `${Math.round(lastTiming.delayMs)}ms` : '--'}</span></div>
          <div>groove <span className="text-zinc-100">{lastTiming?.grooveContractId ?? snapshot.grooveContract?.id ?? '--'}</span></div>
          <div>pocket <span className="text-zinc-100">{lastTiming?.grooveOffsetMs !== undefined ? `${Math.round(lastTiming.grooveOffsetMs)}ms` : '--'}</span></div>
          <div>range <span className="text-zinc-100">{firstCell && lastCell ? `${firstCell.name}->${lastCell.name} · ${spanSemitones}st` : '--'}</span></div>
        </div>
      </div>

      <div className="border-b border-zinc-900 px-3 py-2">
        <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-500">
          Native 3x5 Monitor
          <span className="ml-auto normal-case tracking-normal text-zinc-600">{connected ? 'Q+H' : padMap.source} · {firstCell?.name ?? '--'} to {lastCell?.name ?? '--'}</span>
        </div>
        <div className="grid select-none gap-1" style={{ gridTemplateColumns: 'repeat(5, 1fr)', touchAction: 'none' }}>
          {padMap.cells.map((cell) => {
            const on = held.has(cell.index);
            return (
              <div
                key={cell.index}
                className={`rounded-md border px-1 py-2 text-center text-[10px] leading-tight transition-all duration-75
                  ${ROLE_STYLE[cell.classRole]} ${on ? 'scale-95 shadow-[0_0_12px_rgba(45,212,191,0.65)] ring-1 ring-teal-200/70' : ''}`}
                title={`${cell.name} · ${cell.degreeLabel} · ${cell.classRole}`}
              >
                <span className="block font-semibold">{cell.name}</span>
                <span className="text-[9px] opacity-80">{cell.degreeLabel}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 text-[10px] leading-snug text-zinc-600">
          真实输入来自设备主 3x5 按键；Q+H live 时按 16th 优先、快速输入 32nd，并按左下到右上两八度铺键发声。
        </div>
      </div>

      <div className="space-y-2 px-3 py-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={reset} className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700">
            <RotateCcw size={12} />
            reset
          </button>
          <span className={state.leadMuted ? 'text-[11px] text-rose-300' : 'text-[11px] text-zinc-500'}>
            lead {state.leadMuted ? 'muted' : 'native'}
          </span>
          {state.muteAtBeat !== null && <span className="ml-auto text-[10px] text-teal-300">handoff @{state.muteAtBeat.toFixed(2)}</span>}
        </div>
        <div className="rounded-lg border border-zinc-800 bg-black/30 px-2 py-1.5">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-zinc-500">
            {connected ? 'Native Input Consumed Actions' : 'Native Input Monitor Actions'}
          </div>
          {log.length === 0
            ? <div className="text-[11px] text-zinc-600">--</div>
            : log.map((line, idx) => <div key={`${line}-${idx}`} className="text-[11px] text-zinc-300">{line}</div>)}
        </div>
      </div>
    </motion.div>
  );
};
