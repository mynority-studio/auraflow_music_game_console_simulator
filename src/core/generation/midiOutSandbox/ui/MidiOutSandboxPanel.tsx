// ============================================================
// midiOutSandbox · UI
// ------------------------------------------------------------
// 5-track Web MIDI output bridge for real Q+H/Q+R playback events.
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Cable, Play, Power, RefreshCw, Square, X, Zap } from 'lucide-react';
import { useDevPanelChannel } from '../../../../components/devPanels';
import { globalMidiScheduler, type MidiEvent } from '../../../audio/MidiScheduler';
import {
  DEFAULT_CHANNELS,
  MIDI_OUT_TRACKS,
  buildSandboxStep,
  midiEventToRoutedMessage,
  requestMidiOutputAccess,
  sendMidiMessage,
  sendNotes,
  sendPanic,
  type MidiOutputMode,
  type MidiOutputAccessHandle,
  type MidiOutDeviceInfo,
  type MidiOutRole,
  type MidiOutSupport,
} from '../midiOut';

type MidiStatus = MidiOutSupport | 'idle';
type RoleMap<T> = Record<MidiOutRole, T>;

const ROLE_STYLES: RoleMap<{ dot: string; text: string; pulse: string }> = {
  lead: { dot: 'bg-sky-400', text: 'text-sky-200', pulse: 'bg-sky-400/20' },
  comp: { dot: 'bg-fuchsia-400', text: 'text-fuchsia-200', pulse: 'bg-fuchsia-400/20' },
  bass: { dot: 'bg-emerald-400', text: 'text-emerald-200', pulse: 'bg-emerald-400/20' },
  pad: { dot: 'bg-amber-400', text: 'text-amber-200', pulse: 'bg-amber-400/20' },
  drum: { dot: 'bg-rose-400', text: 'text-rose-200', pulse: 'bg-rose-400/20' },
};

const emptyRoleMap = <T,>(value: T): RoleMap<T> => MIDI_OUT_TRACKS.reduce(
  (acc, track) => ({ ...acc, [track.role]: value }),
  {} as RoleMap<T>,
);

function defaultRouteMap(outputs: MidiOutDeviceInfo[]): RoleMap<string | null> {
  return MIDI_OUT_TRACKS.reduce((acc, track) => {
    const roleName = track.role.toLowerCase();
    const label = track.label.toLowerCase();
    const matched = outputs.find((d) => {
      const name = `${d.name} ${d.manufacturer}`.toLowerCase();
      return name.includes(roleName) || name.includes(label);
    });
    acc[track.role] = matched?.id ?? outputs[0]?.id ?? null;
    return acc;
  }, {} as RoleMap<string | null>);
}

function hasSelectedOutput(outputs: MidiOutDeviceInfo[], id: string | null): boolean {
  return !!id && outputs.some((d) => d.id === id);
}

export const MidiOutSandboxPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<MidiStatus>('idle');
  const [outputs, setOutputs] = useState<MidiOutDeviceInfo[]>([]);
  const [mode, setMode] = useState<MidiOutputMode>('single-port');
  const [singleOutputId, setSingleOutputId] = useState<string | null>(null);
  const [roleOutputs, setRoleOutputs] = useState<RoleMap<string | null>>(() => emptyRoleMap<string | null>(null));
  const [channels, setChannels] = useState<RoleMap<number>>(DEFAULT_CHANNELS);
  const [armed, setArmed] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const [pulse, setPulse] = useState<RoleMap<boolean>>(() => emptyRoleMap(false));
  const [lastEvent, setLastEvent] = useState('等待开启');

  const handleRef = useRef<MidiOutputAccessHandle | null>(null);
  const modeRef = useRef(mode);
  const singleOutputIdRef = useRef(singleOutputId);
  const roleOutputsRef = useRef(roleOutputs);
  const channelsRef = useRef(channels);
  const sentCountRef = useRef(0);
  const lastUiUpdateRef = useRef(0);
  const pulseTimersRef = useRef<Set<number>>(new Set());
  const heldKeys = useRef<Set<string>>(new Set());

  useDevPanelChannel('midiOut', open, setOpen);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { singleOutputIdRef.current = singleOutputId; }, [singleOutputId]);
  useEffect(() => { roleOutputsRef.current = roleOutputs; }, [roleOutputs]);
  useEffect(() => { channelsRef.current = channels; }, [channels]);

  const selectedOutputName = useCallback((id: string | null): string => {
    if (!id) return 'None';
    return outputs.find((d) => d.id === id)?.name ?? 'Missing output';
  }, [outputs]);

  const routeOutputId = useCallback((role: MidiOutRole): string | null => {
    return modeRef.current === 'single-port' ? singleOutputIdRef.current : roleOutputsRef.current[role];
  }, []);

  const routedOutputs = useCallback((): MIDIOutput[] => {
    const handle = handleRef.current;
    if (!handle) return [];
    const ids = new Set<string>();
    for (const track of MIDI_OUT_TRACKS) {
      const id = routeOutputId(track.role);
      if (id) ids.add(id);
    }
    const out: MIDIOutput[] = [];
    ids.forEach((id) => {
      const output = handle.getOutput(id);
      if (output) out.push(output);
    });
    return out;
  }, [routeOutputId]);

  const flashRole = useCallback((role: MidiOutRole): void => {
    setPulse((prev) => ({ ...prev, [role]: true }));
    const timer = window.setTimeout(() => {
      pulseTimersRef.current.delete(timer);
      setPulse((prev) => ({ ...prev, [role]: false }));
    }, 120);
    pulseTimersRef.current.add(timer);
  }, []);

  const panic = useCallback(() => {
    const now = performance.now();
    for (const output of routedOutputs()) {
      try { sendPanic(output, now); } catch { /* keep panic best-effort */ }
    }
    setPulse(emptyRoleMap(false));
    setLastEvent('panic sent');
  }, [routedOutputs]);

  const disableOutput = useCallback(() => {
    setArmed(false);
    panic();
    setLastEvent('输出已关闭');
  }, [panic]);

  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      heldKeys.current.add(key);
      if (!open && heldKeys.current.has('q') && heldKeys.current.has('m') && !isTyping()) {
        e.preventDefault();
        setOpen(true);
      } else if (open && key === 'escape') {
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

  useEffect(() => () => {
    panic();
    handleRef.current?.dispose();
    pulseTimersRef.current.forEach((timer) => clearTimeout(timer));
    pulseTimersRef.current.clear();
  }, [panic]);

  const refreshOutputs = useCallback(() => {
    const devices = handleRef.current?.listOutputs() ?? [];
    setOutputs(devices);
    setSingleOutputId((prev) => hasSelectedOutput(devices, prev) ? prev : devices[0]?.id ?? null);
    setRoleOutputs((prev) => {
      const fallback = defaultRouteMap(devices);
      return MIDI_OUT_TRACKS.reduce((acc, track) => {
        const current = prev[track.role];
        acc[track.role] = hasSelectedOutput(devices, current) ? current : fallback[track.role];
        return acc;
      }, {} as RoleMap<string | null>);
    });
    setLastEvent(`${devices.length} MIDI outputs`);
  }, []);

  const enableMidi = useCallback(async () => {
    const result = await requestMidiOutputAccess((devices) => {
      setOutputs(devices);
      setSingleOutputId((prev) => hasSelectedOutput(devices, prev) ? prev : devices[0]?.id ?? null);
      setRoleOutputs((prev) => {
        const fallback = defaultRouteMap(devices);
        return MIDI_OUT_TRACKS.reduce((acc, track) => {
          const current = prev[track.role];
          acc[track.role] = hasSelectedOutput(devices, current) ? current : fallback[track.role];
          return acc;
        }, {} as RoleMap<string | null>);
      });
    });
    setStatus(result.status);
    handleRef.current = result.handle ?? null;
    if (result.status === 'ready') {
      const count = result.handle?.listOutputs().length ?? 0;
      setArmed(count > 0);
      setLastEvent(count > 0 ? `输出已开启 · ${count} ports` : 'no MIDI outputs');
    } else if (result.status === 'unsupported') {
      setLastEvent('Web MIDI unsupported');
    } else {
      setLastEvent('MIDI permission denied');
    }
  }, []);

  const canArm = useMemo(() => {
    if (status !== 'ready') return false;
    if (mode === 'single-port') return hasSelectedOutput(outputs, singleOutputId);
    return MIDI_OUT_TRACKS.every((track) => hasSelectedOutput(outputs, roleOutputs[track.role]));
  }, [mode, outputs, roleOutputs, singleOutputId, status]);

  const enableOutput = useCallback(async () => {
    if (status === 'idle') {
      await enableMidi();
      return;
    }
    if (!canArm) {
      setLastEvent(mode === 'five-port' ? '先给 5 轨选择输出端口' : '先选择输出端口');
      return;
    }
    setArmed(true);
    setLastEvent('输出已开启 · 监听 Q+H/Q+R 播放');
  }, [canArm, enableMidi, mode, status]);

  const routeSchedulerEvent = useCallback((event: MidiEvent) => {
    const routed = midiEventToRoutedMessage(event, channelsRef.current);
    if (!routed) return;
    const output = handleRef.current?.getOutput(routeOutputId(routed.role) ?? null) ?? null;
    if (!output) return;

    try {
      sendMidiMessage(output, routed.message);
      flashRole(routed.role);
      sentCountRef.current++;
      const now = performance.now();
      if (now - lastUiUpdateRef.current > 140) {
        lastUiUpdateRef.current = now;
        setEventCount(sentCountRef.current);
        setLastEvent(`${routed.role} · ch ${routed.message.channel} · ${routed.message.type}`);
      }
    } catch {
      setLastEvent(`${routed.role} send failed`);
    }
  }, [flashRole, routeOutputId]);

  useEffect(() => {
    if (!armed) return undefined;
    sentCountRef.current = 0;
    setEventCount(0);
    setLastEvent('输出已开启 · 等待播放');
    return globalMidiScheduler.addMidiEventListener(routeSchedulerEvent);
  }, [armed, routeSchedulerEvent]);

  const sendRoleNotes = useCallback((
    role: MidiOutRole,
    pitches: readonly number[],
    eventVelocity: number,
    durationMs: number,
  ): boolean => {
    const handle = handleRef.current;
    const id = routeOutputId(role);
    const output = handle?.getOutput(id ?? null) ?? null;
    if (!output) return false;
    const channel = channelsRef.current[role];
    try {
      sendNotes(output, channel, pitches, eventVelocity, durationMs);
      flashRole(role);
      return true;
    } catch {
      return false;
    }
  }, [flashRole, routeOutputId]);

  const pingTrack = useCallback((role: MidiOutRole) => {
    const track = MIDI_OUT_TRACKS.find((t) => t.role === role);
    if (!track) return;
    const ok = sendRoleNotes(role, [track.testNote], 110, 360);
    setLastEvent(ok ? `${track.label} ping` : `${track.label} no route`);
  }, [sendRoleNotes]);

  if (!open) return null;

  const selectClass = 'bg-zinc-900 text-zinc-100 rounded px-2 py-1 text-[11px] border border-zinc-700 min-w-0';
  const numberClass = 'bg-zinc-900 text-zinc-100 rounded px-1.5 py-1 text-[11px] border border-zinc-700 w-14';

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed right-3 top-3 z-[70] w-[520px] max-w-[calc(100vw-1.5rem)] max-h-[92vh] overflow-auto rounded-2xl border border-emerald-500/30
                 bg-zinc-950/95 text-zinc-200 shadow-[0_8px_40px_rgba(0,0,0,0.72)] backdrop-blur-md"
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800">
        <Cable size={15} className="text-emerald-300" />
        <span className="text-[12px] font-semibold tracking-wide text-emerald-200">MIDI Out Bridge</span>
        <span className="text-[10px] text-zinc-500">Q+M</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${armed ? 'bg-emerald-500/15 text-emerald-200' : 'bg-zinc-800 text-zinc-500'}`}>
          {armed ? 'ON' : 'OFF'}
        </span>
        <button type="button" onClick={() => setMode((m) => m === 'single-port' ? 'five-port' : 'single-port')}
          className={`ml-2 rounded px-2 py-0.5 text-[10px] border ${mode === 'single-port' ? 'border-sky-500/50 bg-sky-500/15 text-sky-200' : 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'}`}>
          {mode === 'single-port' ? '1 port / 5 ch' : '5 ports'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto text-zinc-500 hover:text-zinc-200">
          <X size={15} />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-zinc-900">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={armed ? disableOutput : enableOutput}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] text-white ${armed ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600/85 hover:bg-emerald-500'}`}
          >
            <Power size={12} />
            {armed ? '关闭输出' : '开启 MIDI 输出'}
          </button>
          {status !== 'idle' && <button type="button" onClick={refreshOutputs} className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1 text-[12px] text-zinc-200 hover:bg-zinc-700"><RefreshCw size={12} /> Refresh</button>}
          {status === 'unsupported' && <span className="text-[11px] text-rose-300">当前浏览器不支持 Web MIDI</span>}
          {status === 'denied' && <span className="text-[11px] text-amber-300">MIDI 未授权</span>}
          {status === 'ready' && <span className="text-[11px] text-zinc-400">{outputs.length} outputs · {eventCount} events · {lastEvent}</span>}
          <button type="button" onClick={panic} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[12px] text-rose-200 hover:bg-rose-500/20">
            <Zap size={12} /> Panic
          </button>
        </div>

        {mode === 'single-port' && status === 'ready' && (
          <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px]">
            <span className="text-zinc-500">Port</span>
            <select className={`${selectClass} flex-1`} value={singleOutputId ?? ''} onChange={(e) => setSingleOutputId(e.target.value || null)}>
              <option value="">None</option>
              {outputs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <span className="text-zinc-500">Cubase tracks listen on Ch 1/2/3/4/10</span>
          </div>
        )}

        {status === 'ready' && outputs.length === 0 && (
          <div className="mt-2 text-[11px] text-amber-300">
            先在系统里创建 IAC / loopMIDI 虚拟端口，Cubase 和浏览器才会同时看到它。
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-b border-zinc-900">
        <div className="grid grid-cols-[74px_minmax(0,1fr)_58px_52px] gap-2 text-[10px] uppercase tracking-widest text-zinc-500">
          <span>Track</span>
          <span>{mode === 'five-port' ? 'Port' : 'Route'}</span>
          <span>Ch</span>
          <span>Ping</span>
        </div>
        <div className="mt-1 space-y-1">
          {MIDI_OUT_TRACKS.map((track) => {
            const style = ROLE_STYLES[track.role];
            return (
              <div key={track.role}
                className={`grid grid-cols-[74px_minmax(0,1fr)_58px_52px] items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors
                           ${pulse[track.role] ? `${style.pulse} border-white/15` : 'border-zinc-900 bg-zinc-900/55'}`}>
                <span className={`flex items-center gap-2 text-[12px] ${style.text}`}>
                  <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                  {track.label}
                </span>
                {mode === 'five-port'
                  ? (
                    <select className={selectClass} value={roleOutputs[track.role] ?? ''} onChange={(e) => setRoleOutputs((prev) => ({ ...prev, [track.role]: e.target.value || null }))}>
                      <option value="">None</option>
                      {outputs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  )
                  : <span className="truncate text-[11px] text-zinc-500">{selectedOutputName(singleOutputId)}</span>}
                <input
                  aria-label={`${track.label} MIDI channel`}
                  type="number"
                  min={1}
                  max={16}
                  className={numberClass}
                  value={channels[track.role]}
                  onChange={(e) => setChannels((prev) => ({ ...prev, [track.role]: Math.max(1, Math.min(16, Number(e.target.value) || track.defaultChannel)) }))}
                />
                <button type="button" onClick={() => pingTrack(track.role)} className="rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700">
                  {track.shortLabel}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-[10px] text-zinc-500">
        <span className={armed ? 'text-emerald-300' : 'text-zinc-500'}>{armed ? '监听真实播放事件' : '未监听'}</span>
        <span>Q+H / Q+R 播放时输出 5 轨 MIDI</span>
      </div>
    </motion.div>
  );
};
