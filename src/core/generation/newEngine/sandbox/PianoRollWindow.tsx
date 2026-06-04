// ============================================================
// newEngine · sandbox · PianoRollWindow(独立逐轨音符弹窗)
// ------------------------------------------------------------
// 从主面板拆出的独立窗口:每轨一条泳道(主旋律 / 伴奏分组),可单独开关每一轨,
// 每轨显示音名标签 + 时间序音名序列(看清哪个轨播什么音、前后音符)。
// 纯展示,消费 buildTrackLanes 的几何;不碰引擎 / 音频。
// ============================================================

import React, { useMemo, useState } from 'react';
import type { MusicalIR, InstrumentRole } from '../ir/MusicalIR';
import { buildTrackLanes } from './pianoRoll';

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
  const lr = useMemo(() => (ir ? buildTrackLanes(ir, { width: 660, laneHeight: 50 }) : null), [ir]);

  if (!open || !lr) return null;
  const toggle = (role: string) => setHidden((h) => ({ ...h, [role]: !h[role] }));

  const bars = Math.max(1, Math.ceil(lr.totalTicks / (lr.ppq * 4)));
  const barLines = Array.from({ length: bars + 1 }, (_, b) => (b * lr.ppq * 4 / lr.totalTicks) * lr.width);

  const renderLane = (lane: typeof lr.lanes[number]) => {
    const off = hidden[lane.role];
    return (
      <div key={lane.role} className="rounded border border-white/5 bg-zinc-950/50">
        {/* 轨头:开关 + 名称 + 信息 */}
        <div className="flex items-center gap-2 px-2 py-1 text-[11px]">
          <input type="checkbox" checked={!off} onChange={() => toggle(lane.role)} className="accent-emerald-500" />
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: lane.color }} />
          <span className={off ? 'text-zinc-500' : 'text-zinc-200'}>{ROLE_LABEL[lane.role] ?? lane.role}</span>
          <span className="text-zinc-500">· {lane.count} 音 · {lane.group === 'melody' ? '主旋律' : '伴奏'}</span>
        </div>
        {!off && (
          <>
            <svg viewBox={`0 0 ${lr.width} ${lr.laneHeight}`} width="100%" style={{ height: lr.laneHeight }} preserveAspectRatio="none">
              <rect x={0} y={0} width={lr.width} height={lr.laneHeight} fill="#0a0a0b" />
              {barLines.map((x, i) => <line key={i} x1={x} y1={0} x2={x} y2={lr.laneHeight} stroke="#27272a" strokeWidth={1} />)}
              {lane.notes.map((n, i) => (
                <g key={i}>
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={1} fill={lane.color} opacity={0.9}>
                    <title>{`${n.label} · v${n.velocity}`}</title>
                  </rect>
                  {n.w >= 15 && n.h >= 7 && (
                    <text x={n.x + 1.5} y={n.y + n.h - 1} fontSize={7} fill="#0a0a0b" style={{ pointerEvents: 'none' }}>{n.label}</text>
                  )}
                </g>
              ))}
            </svg>
            {/* 时间序音名序列(前 → 后) */}
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
          <button className="rounded px-2 text-zinc-400 hover:text-white" onClick={onClose} aria-label="关闭">✕</button>
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
          <p className="text-[10px] text-zinc-500">勾选框单独开关每一轨 · 矩形即音符(悬停看音名+力度)· 底部为该轨时间序音名(前→后)。</p>
        </div>
      </div>
    </div>
  );
};
