// ============================================================
// Dream 5504 MIDI Output Panel
// ------------------------------------------------------------
// UI-only controller for the core Dream5504MidiOutput singleton. The MIDI
// bridge stays alive outside this panel; opening Q+M only reveals controls.
// ============================================================

import React, { useMemo, useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Cable, Power, RefreshCw, X, Zap } from 'lucide-react';
import { useDevPanelChannel } from '../../../../components/devPanels';
import { Dream5504MidiOutput } from '../../../audio/Dream5504MidiOutput';
import {
  DEFAULT_CHANNELS,
  MIDI_OUT_TRACKS,
  type MidiOutDeviceInfo,
  type MidiOutRole,
} from '../midiOut';

type RoleMap<T> = Record<MidiOutRole, T>;

const ROLE_STYLES: RoleMap<{ dot: string; text: string }> = {
  lead: { dot: 'bg-sky-400', text: 'text-sky-200' },
  comp: { dot: 'bg-fuchsia-400', text: 'text-fuchsia-200' },
  bass: { dot: 'bg-emerald-400', text: 'text-emerald-200' },
  pad: { dot: 'bg-amber-400', text: 'text-amber-200' },
  drum: { dot: 'bg-rose-400', text: 'text-rose-200' },
};

function hasSelectedOutput(outputs: MidiOutDeviceInfo[], id: string | null): boolean {
  return !!id && outputs.some((d) => d.id === id);
}

export const MidiOutSandboxPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [bridge, setBridge] = useState(() => Dream5504MidiOutput.getState());

  useDevPanelChannel('midiOut', open, setOpen);

  useEffect(() => Dream5504MidiOutput.subscribe(() => setBridge(Dream5504MidiOutput.getState())), []);

  useEffect(() => {
    const held = new Set<string>();
    const isTyping = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      held.add(key);
      if (!open && held.has('q') && held.has('m') && !isTyping()) {
        event.preventDefault();
        setOpen(true);
      } else if (open && key === 'escape') {
        setOpen(false);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => held.delete(event.key.toLowerCase());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [open]);

  const canArm = useMemo(() => {
    if (bridge.status !== 'ready') return false;
    if (bridge.mode === 'single-port') return hasSelectedOutput(bridge.outputs, bridge.singleOutputId);
    return MIDI_OUT_TRACKS.every((track) => hasSelectedOutput(bridge.outputs, bridge.roleOutputs[track.role]));
  }, [bridge.mode, bridge.outputs, bridge.roleOutputs, bridge.singleOutputId, bridge.status]);

  const selectedOutputName = (id: string | null): string => {
    if (!id) return 'None';
    return bridge.outputs.find((d) => d.id === id)?.name ?? 'Missing output';
  };

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
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Cable size={15} className="text-emerald-300" />
        <span className="text-[12px] font-semibold tracking-wide text-emerald-200">Dream 5504 MIDI Out</span>
        <span className="text-[10px] text-zinc-500">Q+M</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${bridge.armed ? 'bg-emerald-500/15 text-emerald-200' : 'bg-zinc-800 text-zinc-500'}`}>
          {bridge.armed ? 'ON' : 'SILENT'}
        </span>
        <button
          type="button"
          onClick={() => Dream5504MidiOutput.setMode(bridge.mode === 'single-port' ? 'five-port' : 'single-port')}
          className={`ml-2 rounded border px-2 py-0.5 text-[10px] ${bridge.mode === 'single-port' ? 'border-sky-500/50 bg-sky-500/15 text-sky-200' : 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'}`}
        >
          {bridge.mode === 'single-port' ? '1 port / 5 ch' : '5 ports / ch1'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto text-zinc-500 hover:text-zinc-200">
          <X size={15} />
        </button>
      </div>

      <div className="border-b border-zinc-900 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => bridge.armed ? Dream5504MidiOutput.disableOutput() : void Dream5504MidiOutput.enableOutput()}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] text-white ${bridge.armed ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600/85 hover:bg-emerald-500'}`}
          >
            <Power size={12} />
            {bridge.armed ? '关闭输出' : '开启 Dream 5504'}
          </button>
          {bridge.status !== 'idle' && (
            <button type="button" onClick={() => Dream5504MidiOutput.refreshOutputs()} className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1 text-[12px] text-zinc-200 hover:bg-zinc-700">
              <RefreshCw size={12} /> Refresh
            </button>
          )}
          {bridge.status === 'unsupported' && <span className="text-[11px] text-rose-300">当前浏览器不支持 Web MIDI</span>}
          {bridge.status === 'denied' && <span className="text-[11px] text-amber-300">MIDI 未授权</span>}
          {bridge.status === 'ready' && <span className="text-[11px] text-zinc-400">{bridge.outputs.length} outputs · {bridge.eventCount} events · {bridge.lastEvent}</span>}
          <button type="button" onClick={() => Dream5504MidiOutput.panic()} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-[12px] text-rose-200 hover:bg-rose-500/20">
            <Zap size={12} /> Panic
          </button>
        </div>

        {bridge.silentReason && (
          <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
            {bridge.silentReason}
          </div>
        )}

        {bridge.mode === 'single-port' && bridge.status === 'ready' && (
          <div className="mt-2 flex min-w-0 items-center gap-2 text-[11px]">
            <span className="text-zinc-500">Port</span>
            <select className={`${selectClass} flex-1`} value={bridge.singleOutputId ?? ''} onChange={(event) => Dream5504MidiOutput.setSingleOutputId(event.target.value || null)}>
              <option value="">None</option>
              {bridge.outputs.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
            </select>
            <span className="text-zinc-500">5504 listens on Ch 1/2/3/4/10</span>
          </div>
        )}

        {bridge.mode === 'five-port' && bridge.status === 'ready' && (
          <div className="mt-2 text-[11px] text-zinc-500">
            上游可分 5 个 DAW/虚拟端口；5504 官方为 2×16 MIDI 通道，出板仍固定按 Ch 1/2/3/4/10 分轨。
          </div>
        )}

        {bridge.status === 'ready' && bridge.outputs.length === 0 && (
          <div className="mt-2 text-[11px] text-amber-300">
            未发现 MIDI 输出端口。连接 Dream 5504 EK 后点 Refresh；未连接时系统保持静音。
          </div>
        )}

        {bridge.status === 'ready' && !canArm && bridge.outputs.length > 0 && (
          <div className="mt-2 text-[11px] text-amber-300">
            先选择有效 MIDI 输出端口；未选择时不会回退到浏览器发声。
          </div>
        )}
      </div>

      <div className="border-b border-zinc-900 px-3 py-2">
        <div className="grid grid-cols-[74px_minmax(0,1fr)_58px_52px] gap-2 text-[10px] uppercase tracking-widest text-zinc-500">
          <span>Track</span>
          <span>{bridge.mode === 'five-port' ? 'Port' : 'Route'}</span>
          <span>Ch</span>
          <span>Ping</span>
        </div>
        <div className="mt-1 space-y-1">
          {MIDI_OUT_TRACKS.map((track) => {
            const style = ROLE_STYLES[track.role];
            return (
              <div key={track.role} className="grid grid-cols-[74px_minmax(0,1fr)_58px_52px] items-center gap-2 rounded-lg border border-zinc-900 bg-zinc-900/55 px-2 py-1.5">
                <span className={`flex items-center gap-2 text-[12px] ${style.text}`}>
                  <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                  {track.label}
                </span>
                {bridge.mode === 'five-port'
                  ? (
                    <select className={selectClass} value={bridge.roleOutputs[track.role] ?? ''} onChange={(event) => Dream5504MidiOutput.setRoleOutput(track.role, event.target.value || null)}>
                      <option value="">None</option>
                      {bridge.outputs.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
                    </select>
                  )
                  : <span className="truncate text-[11px] text-zinc-500">{selectedOutputName(bridge.singleOutputId)}</span>}
                <input
                  aria-label={`${track.label} MIDI channel`}
                  type="number"
                  min={1}
                  max={16}
                  className={numberClass}
                  value={bridge.channels[track.role]}
                  onChange={(event) => Dream5504MidiOutput.setChannel(track.role, Number(event.target.value) || DEFAULT_CHANNELS[track.role])}
                />
                <button type="button" onClick={() => Dream5504MidiOutput.pingRole(track.role)} className="rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700">
                  {track.shortLabel}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-[10px] text-zinc-500">
        <span className={bridge.armed ? 'text-emerald-300' : 'text-amber-300'}>{bridge.armed ? '硬件 MIDI 已接管' : '未连接即静音'}</span>
        <span>生成曲 / 实时演奏 / 上传 MIDI / 音色试听统一输出到 Dream 5504。</span>
      </div>
    </motion.div>
  );
};
