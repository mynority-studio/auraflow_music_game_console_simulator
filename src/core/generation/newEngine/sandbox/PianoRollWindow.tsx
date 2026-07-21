// ============================================================
// newEngine · sandbox · PianoRollWindow(DAW 式逐轨音符弹窗)
// ------------------------------------------------------------
// DAW 布局:左轨头 gutter(名称 + 显示 + M/S)+ 右音符 strip(全轨共享时间轴)。
//   - 顶部【段落标尺】:intro/verse/chorus… 彩条 + 标签,看清曲式结构。
//   - 每轨 strip 叠【段落底纹 + 段落分隔竖线】→ 段落贯穿所有轨,纵向对齐。
//   - 显示开关 / 静音 M / 独奏 S(实时,走 audioOut 按通道)。
//   - playhead 红竖线随播放,正在发声音符高亮。
// 纯展示 + 通过 audioOut 间接碰音频(不直接 import scheduler)。
// ============================================================

import React, { useEffect, useMemo, useState } from 'react';
import type { MusicalIR, InstrumentRole } from '../ir/MusicalIR';
import { buildTrackLanes, buildSectionBands } from './pianoRoll';
import { applyMuteSolo, getIsPlaying, getPlaybackTick } from './audioOut';

const ROLE_LABEL: Record<InstrumentRole, string> = {
  lead: '主旋律 lead',
  comp: '和声 comp',
  bass: '贝斯 bass',
  pad: '铺底 pad',
  drum: '鼓 drum',
};
const SECTION_LABEL: Record<string, string> = {
  intro: 'INTRO', verse: 'VERSE', chorus: 'CHORUS', bridge: 'BRIDGE', outro: 'OUTRO',
};

export interface PianoRollSection { id: string; role: string; startTick: number; endTick: number; bars: number }

export const PianoRollWindow: React.FC<{
  ir: MusicalIR | undefined;
  open: boolean;
  onClose: () => void;
  title?: string;
  sections?: readonly PianoRollSection[];
  /** Defaults to 4 for legacy callers; reference scores supply their actual meter numerator. */
  beatsPerBar?: number;
}> = ({ ir, open, onClose, title, sections, beatsPerBar = 4 }) => {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [solo, setSolo] = useState<Set<string>>(new Set());
  const [playTick, setPlayTick] = useState<number | null>(null);
  const lr = useMemo(() => (ir ? buildTrackLanes(ir, { width: 660, laneHeight: 50 }) : null), [ir]);
  const bands = useMemo(
    () => (lr && sections ? buildSectionBands(sections, lr.totalTicks, lr.width) : []),
    [lr, sections],
  );

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
  const W = lr.width;
  const H = lr.laneHeight;
  const playX = playTick != null ? (playTick / lr.totalTicks) * W : null;
  const safeBeatsPerBar = Number.isFinite(beatsPerBar) && beatsPerBar > 0 ? beatsPerBar : 4;
  const bars = Math.max(1, Math.ceil(lr.totalTicks / (lr.ppq * safeBeatsPerBar)));
  const barLines = Array.from({ length: bars + 1 }, (_, b) => (b * lr.ppq * safeBeatsPerBar / lr.totalTicks) * W);

  // 段落底纹 + 分隔线(贯穿每条 strip,纵向对齐曲式)
  const sectionOverlay = (h: number) => (
    <>
      {bands.map((b) => <rect key={`bg-${b.id}`} x={b.x} y={0} width={b.w} height={h} fill={b.color} opacity={0.1} />)}
      {bands.slice(1).map((b) => <line key={`dv-${b.id}`} x1={b.x} y1={0} x2={b.x} y2={h} stroke={b.color} strokeOpacity={0.6} strokeWidth={1} />)}
    </>
  );

  const GUTTER = 'w-[112px] shrink-0';

  const renderLane = (lane: typeof lr.lanes[number]) => {
    const off = hidden[lane.role];
    const mute = muted.has(lane.role);
    const sol = solo.has(lane.role);
    const isSilent = silent(lane.role);
    return (
      <div key={lane.role} className={`flex items-stretch border-b border-white/5 ${sol ? 'bg-amber-400/5' : ''}`}>
        {/* 左轨头 gutter(DAW 风格) */}
        <div className={`${GUTTER} flex flex-col justify-center gap-1 border-r border-white/10 bg-zinc-950/60 px-2 py-1`}>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: lane.color, opacity: isSilent ? 0.3 : 1 }} />
            <span className={`truncate text-[11px] ${off || isSilent ? 'text-zinc-500' : 'text-zinc-100'}`}>{ROLE_LABEL[lane.role] ?? lane.role}</span>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => toggleHidden(lane.role)} className={`rounded px-1 py-0.5 text-[9px] ${off ? 'bg-zinc-700 text-zinc-300' : 'border border-white/10 text-zinc-400'}`} title="显示/隐藏">{off ? '显示' : '👁'}</button>
            <button type="button" onClick={() => toggleMute(lane.role)} className={`rounded px-1.5 py-0.5 text-[9px] ${mute ? 'bg-rose-500/80 text-zinc-900' : 'border border-white/10 text-zinc-400 hover:text-white'}`} title="静音">M</button>
            <button type="button" onClick={() => toggleSolo(lane.role)} className={`rounded px-1.5 py-0.5 text-[9px] ${sol ? 'bg-amber-400/90 text-zinc-900' : 'border border-white/10 text-zinc-400 hover:text-white'}`} title="独奏">S</button>
            <span className="ml-auto text-[9px] text-zinc-600">{lane.count}</span>
          </div>
        </div>
        {/* 右音符 strip */}
        <div className="min-w-0 flex-1">
          {off ? (
            <div className="flex h-[28px] items-center px-2 text-[9px] text-zinc-600">(已隐藏)</div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ height: H, display: 'block', opacity: isSilent ? 0.4 : 1 }} preserveAspectRatio="none">
              <rect x={0} y={0} width={W} height={H} fill="#0a0a0b" />
              {sectionOverlay(H)}
              {barLines.map((x, i) => <line key={i} x1={x} y1={0} x2={x} y2={H} stroke="#ffffff" strokeOpacity={0.06} strokeWidth={1} />)}
              {lane.notes.map((n, i) => {
                const sounding = playTick != null && n.startTick <= playTick && playTick < n.startTick + n.durationTicks;
                return (
                  <g key={i}>
                    <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={1} fill={sounding ? '#fff' : lane.color} opacity={sounding ? 1 : 0.92} stroke={sounding ? lane.color : 'none'} strokeWidth={sounding ? 1.5 : 0}>
                      <title>{`${n.label} · v${n.velocity}`}</title>
                    </rect>
                    {n.w >= 15 && n.h >= 7 && <text x={n.x + 1.5} y={n.y + n.h - 1} fontSize={7} fill="#0a0a0b" style={{ pointerEvents: 'none' }}>{n.label}</text>}
                  </g>
                );
              })}
              {playX != null && <line x1={playX} y1={0} x2={playX} y2={H} stroke="#f43f5e" strokeWidth={1.5} />}
            </svg>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[90vh] w-[min(880px,96vw)] flex-col rounded-xl border border-sky-500/40 bg-zinc-900 text-zinc-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <span className="text-sm font-semibold text-sky-300">音轨视图 · DAW 分层{title ? ` · ${title}` : ''}</span>
          <div className="flex items-center gap-2">
            {(muted.size > 0 || solo.size > 0) && (
              <button type="button" onClick={resetAudio} className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800">↺ 恢复全部</button>
            )}
            <button className="rounded px-2 text-zinc-400 hover:text-white" onClick={onClose} aria-label="关闭">✕</button>
          </div>
        </div>

        <div className="overflow-auto">
          {/* 段落标尺(DAW 顶部曲式条) */}
          <div className="sticky top-0 z-10 flex items-stretch border-b border-white/10 bg-zinc-900">
            <div className={`${GUTTER} flex items-center border-r border-white/10 px-2 text-[9px] uppercase tracking-widest text-zinc-500`}>段落</div>
            <div className="min-w-0 flex-1">
              {bands.length ? (
                <svg viewBox={`0 0 ${W} 22`} width="100%" style={{ height: 22, display: 'block' }} preserveAspectRatio="none">
                  {bands.map((b) => (
                    <g key={b.id}>
                      <rect x={b.x} y={1} width={Math.max(0, b.w - 1)} height={20} fill={b.color} opacity={0.85} rx={2} />
                      {b.w >= 26 && <text x={b.x + 4} y={15} fontSize={9} fontWeight={700} fill="#fff" style={{ pointerEvents: 'none' }}>{SECTION_LABEL[b.role] ?? b.role}</text>}
                    </g>
                  ))}
                  {playX != null && <line x1={playX} y1={0} x2={playX} y2={22} stroke="#f43f5e" strokeWidth={1.5} />}
                </svg>
              ) : (
                <div className="px-2 py-1 text-[9px] text-zinc-600">(无段落信息)</div>
              )}
            </div>
          </div>

          {/* 轨道泳道 */}
          <div>
            {lr.lanes.length ? lr.lanes.map(renderLane) : <div className="px-5 py-4 text-[11px] text-zinc-500">(无音符)</div>}
          </div>
        </div>

        <p className="border-t border-white/10 px-5 py-2 text-[10px] text-zinc-500">
          顶部彩条=段落(intro/verse/chorus…)· 竖线=段落分隔贯穿各轨 · 👁 显示 / M 静音 / S 独奏(实时)· 红线=播放头,白色=正在发声。
        </p>
      </div>
    </div>
  );
};
