// ============================================================
// newEngine · sandbox · PianoRollWindow(独立逐轨音符弹窗)
// ------------------------------------------------------------
// 从主面板拆出的独立窗口:每轨一条泳道(主旋律 / 伴奏分组)。
//   - 显示开关:单独折叠隐藏某一轨(视图)。
//   - 静音 M / 独奏 S:实时控制该轨发声(走 audioOut 按通道 muteChannel)。
//   - 音名标签 + 时间序音名序列(看清哪个轨播什么音、前后音符)。
//   - playhead:随播放走一根竖线,正在发声的音符高亮。
// 纯展示 + 通过 audioOut 间接碰音频(不直接 import scheduler)。
// ============================================================

import React, { useEffect, useMemo, useState } from 'react';
import type { MusicalIR, InstrumentRole } from '../ir/MusicalIR';
import { buildTrackLanes } from './pianoRoll';
import { applyMuteSolo, getIsPlaying, getPlaybackTick } from './audioOut';

const ROLE_LABEL: Record<InstrumentRole, string> = {
  lead: '主旋律 lead',
  comp: '和声 comp',
  bass: '贝斯 bass',
  pad: '铺底 pad',
  drum: '鼓 drum',
};

export const PianoRollWindow: React.FC<{
  ir: MusicalIR | undefined;
  open: boolean;
  onClose: () => void;
  title?: string;
}> = ({ ir, open, onClose, title }) => {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [solo, setSolo] = useState<Set<string>>(new Set());
  const [playTick, setPlayTick] = useState<number | null>(null);
  const lr = useMemo(() => (ir ? buildTrackLanes(ir, { width: 660, laneHeight: 50 }) : null), [ir]);

  // playhead:随播放轮询当前 tick(只读 audioOut,不动调度)
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const loop = () => {
      setPlayTick(getIsPlaying() ? getPlaybackTick() : null);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  if (!open || !lr) return null;

  const toggleHidden = (role: string) => setHidden((h) => ({ ...h, [role]: !h[role] }));
  const toggleMute = (role: string) => {
    const m = new Set<string>(muted);
    if (m.has(role)) m.delete(role); else m.add(role);
    setMuted(m); applyMuteSolo(m, solo);
  };
  const toggleSolo = (role: string) => {
    const s = new Set<string>(solo);
    if (s.has(role)) s.delete(role); else s.add(role);
    setSolo(s); applyMuteSolo(muted, s);
  };
  const resetAudio = () => { setMuted(new Set()); setSolo(new Set()); applyMuteSolo(new Set(), new Set()); };

  const silent = (role: string) => (solo.size > 0 ? !solo.has(role) : muted.has(role));
  const playX = playTick != null ? (playTick / lr.totalTicks) * lr.width : null;
  const bars = Math.max(1, Math.ceil(lr.totalTicks / (lr.ppq * 4)));
  const barLines = Array.from({ length: bars + 1 }, (_, b) => (b * lr.ppq * 4 / lr.totalTicks) * lr.width);

  const renderLane = (lane: typeof lr.lanes[number]) => {
    const off = hidden[lane.role];
    const mute = muted.has(lane.role);
    const sol = solo.has(lane.role);
    const isSilent = silent(lane.role);
    return (
      <div key={lane.role} className={`rounded border bg-zinc-950/50 ${sol ? 'border-amber-400/50' : 'border-white/5'}`}>
        {/* 轨头:显示开关 + 名称 + M/S */}
        <div className="flex items-center gap-2 px-2 py-1 text-[11px]">
          <input type="checkbox" checked={!off} onChange={() => toggleHidden(lane.role)} className="accent-emerald-500" title="显示/隐藏该轨" />
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: lane.color, opacity: isSilent ? 0.3 : 1 }} />
          <span className={off || isSilent ? 'text-zinc-500' : 'text-zinc-200'}>{ROLE_LABEL[lane.role] ?? lane.role}</span>
          <span className="text-zinc-500">· {lane.count} 音 · {lane.group === 'melody' ? '主旋律' : '伴奏'}</span>
          <span className="ml-auto flex gap-1">
            <button
              type="button" onClick={() => toggleMute(lane.role)}
              className={`rounded px-1.5 py-0.5 text-[10px] ${mute ? 'bg-rose-500/80 text-zinc-900' : 'border border-white/10 text-zinc-400 hover:text-white'}`}
              title="静音该轨"
            >M</button>
            <button
              type="button" onClick={() => toggleSolo(lane.role)}
              className={`rounded px-1.5 py-0.5 text-[10px] ${sol ? 'bg-amber-400/90 text-zinc-900' : 'border border-white/10 text-zinc-400 hover:text-white'}`}
              title="独奏该轨(只听这条)"
            >S</button>
          </span>
        </div>
        {!off && (
          <>
            <svg viewBox={`0 0 ${lr.width} ${lr.laneHeight}`} width="100%" style={{ height: lr.laneHeight, opacity: isSilent ? 0.4 : 1 }} preserveAspectRatio="none">
              <rect x={0} y={0} width={lr.width} height={lr.laneHeight} fill="#0a0a0b" />
              {barLines.map((x, i) => <line key={i} x1={x} y1={0} x2={x} y2={lr.laneHeight} stroke="#27272a" strokeWidth={1} />)}
              {lane.notes.map((n, i) => {
                const sounding = playTick != null && n.startTick <= playTick && playTick < n.startTick + n.durationTicks;
                return (
                  <g key={i}>
                    <rect
                      x={n.x} y={n.y} width={n.w} height={n.h} rx={1}
                      fill={sounding ? '#fff' : lane.color} opacity={sounding ? 1 : 0.9}
                      stroke={sounding ? lane.color : 'none'} strokeWidth={sounding ? 1.5 : 0}
                    >
                      <title>{`${n.label} · v${n.velocity}`}</title>
                    </rect>
                    {n.w >= 15 && n.h >= 7 && (
                      <text x={n.x + 1.5} y={n.y + n.h - 1} fontSize={7} fill="#0a0a0b" style={{ pointerEvents: 'none' }}>{n.label}</text>
                    )}
                  </g>
                );
              })}
              {playX != null && <line x1={playX} y1={0} x2={playX} y2={lr.laneHeight} stroke="#f43f5e" strokeWidth={1.5} />}
            </svg>
            <div className="max-h-12 overflow-auto border-t border-white/5 px-2 py-1 font-mono text-[9px] leading-snug text-zinc-400">
              {lane.sequence.join(' ')}
            </div>
          </>
        )}
      </div>
    );
  };

  const melody = lr.lanes.filter((l) => l.group === 'melody');
  const accomp = lr.lanes.filter((l) => l.group === 'accomp');

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[88vh] w-[min(760px,94vw)] flex-col rounded-xl border border-sky-500/40 bg-zinc-900 text-zinc-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <span className="text-sm font-semibold text-sky-300">音轨视图 · 逐轨音符{title ? ` · ${title}` : ''}</span>
          <div className="flex items-center gap-2">
            {(muted.size > 0 || solo.size > 0) && (
              <button type="button" onClick={resetAudio} className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800">↺ 恢复全部</button>
            )}
            <button className="rounded px-2 text-zinc-400 hover:text-white" onClick={onClose} aria-label="关闭">✕</button>
          </div>
        </div>
        <div className="space-y-3 overflow-auto px-5 py-4">
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-emerald-300/70">主旋律</div>
            {melody.length ? melody.map(renderLane) : <div className="text-[11px] text-zinc-500">(无主旋律音符)</div>}
          </div>
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-violet-300/70">伴奏</div>
            {accomp.map(renderLane)}
          </div>
          <p className="text-[10px] text-zinc-500">勾选=显示/隐藏 · M 静音 / S 独奏(实时,播放中可切)· 红线=播放头,白色=正在发声 · 底部为该轨时间序音名(前→后)。</p>
        </div>
      </div>
    </div>
  );
};
