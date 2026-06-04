// ============================================================
// newEngine · sandbox · Q+N 控制板(出声)
// ------------------------------------------------------------
// 独立沙盒 UI:同时按住 Q + N 调出 / Esc 关闭(也可点左侧 DevDock 的"新引擎")。
// 调 generateSong(request) 端到端生成 → playMusicalIR 发声。不走主系统 / 旧引擎。
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { generateSong } from '../generation';
import type { GenerationResult } from '../generation';
import { playMusicalIR, stopNewEngine } from './audioOut';
import { useDevPanelChannel } from '../../../../components/devPanels';

const STYLES = ['pop', 'lofi', 'jazz'] as const;
const STATUS_COLOR: Record<string, string> = {
  pass: 'text-emerald-300',
  warning: 'text-amber-300',
  failed: 'text-rose-300',
};

interface Readout {
  status: string;
  attempts: number;
  bpm: number;
  bars: number;
  tracks: { role: string; count: number }[];
}

function deriveReadout(r: GenerationResult): Readout {
  const ir = r.ir;
  const bpm = ir?.timebase.tempoMap[0]?.bpm ?? 100;
  const bars = ir ? Math.round(ir.durationTicks / (480 * 4)) : 0; // 4/4, ppq 480
  const tracks = ir ? ir.tracks.map((t) => ({ role: t.role, count: t.notes.length })) : [];
  return { status: r.status, attempts: r.attempts, bpm, bars, tracks };
}

export const NewEnginePanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState(7);
  const [style, setStyle] = useState<(typeof STYLES)[number]>('pop');
  const [status, setStatus] = useState('就绪');
  const [readout, setReadout] = useState<Readout | null>(null);
  const lastIR = useRef<GenerationResult['ir']>(undefined);
  const lastBpm = useRef(100);
  const heldKeys = useRef<Set<string>>(new Set());

  useDevPanelChannel('newengine', open, setOpen);

  // 全局 Q+N 调出 / Esc 关闭
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      heldKeys.current.add(k);
      if (!open && heldKeys.current.has('q') && heldKeys.current.has('n') && !isTyping()) {
        e.preventDefault();
        setOpen(true);
      } else if (open && k === 'escape') {
        setOpen(false);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { heldKeys.current.delete(e.key.toLowerCase()); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [open]);

  const generate = (): GenerationResult => {
    const r = generateSong({ seed, styleHint: style, mood: 'calm-build', targetDuration: 120 });
    lastIR.current = r.ir;
    lastBpm.current = r.ir?.timebase.tempoMap[0]?.bpm ?? 100;
    setReadout(deriveReadout(r));
    return r;
  };

  const onGenerateAndPlay = async () => {
    const r = generate();
    if (r.status === 'failed' || !r.ir) { setStatus('生成失败(已拦非法结果)'); return; }
    setStatus('播放中…');
    try {
      await playMusicalIR(r.ir, lastBpm.current);
      setStatus(`▶ 播放中 · ${r.status}`);
    } catch (err) {
      setStatus(`音频启动失败:${String(err)}`);
    }
  };

  const onReplay = async () => {
    if (!lastIR.current) return;
    setStatus('播放中…');
    try { await playMusicalIR(lastIR.current, lastBpm.current); setStatus('▶ 重播'); }
    catch (err) { setStatus(`音频失败:${String(err)}`); }
  };

  const onStop = () => { stopNewEngine(); setStatus('已停止'); };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onPointerDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="w-[min(560px,92vw)] rounded-xl border border-emerald-500/40 bg-zinc-900 text-zinc-100 shadow-2xl">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-wide text-emerald-300">newEngine</span>
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">音乐生成引擎 · Slice 0-1 · Q+N</span>
          </div>
          <button className="rounded px-2 text-zinc-400 hover:text-white" onClick={() => setOpen(false)} aria-label="关闭">✕</button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <p className="text-[11px] leading-relaxed text-zinc-400">
            独立分叉引擎,0 import 旧管线。<span className="text-emerald-300">▶ 生成并播放</span> = generateSong(request)
            端到端 Request→FinalIR,经中立音频层发声(bass+comp+lead)。
          </p>

          {/* 参数 */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
              seed
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value) || 0)}
                className="w-24 rounded border border-white/10 bg-zinc-800 px-2 py-1 text-sm text-zinc-100"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
              style
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value as (typeof STYLES)[number])}
                className="w-28 rounded border border-white/10 bg-zinc-800 px-2 py-1 text-sm text-zinc-100"
              >
                {STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setSeed((s) => s + 1)}
              className="rounded border border-white/10 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700"
              title="换种子"
            >
              🎲 seed+1
            </button>
          </div>

          {/* 操作 */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onGenerateAndPlay}
              className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-emerald-400"
            >
              ▶ 生成并播放
            </button>
            <button
              type="button"
              onClick={onReplay}
              className="rounded-lg border border-emerald-500/40 px-3 py-2 text-sm text-emerald-300 hover:bg-emerald-500/10"
            >
              ↻ 重播
            </button>
            <button
              type="button"
              onClick={onStop}
              className="rounded-lg border border-white/10 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              ■ 停止
            </button>
          </div>

          {/* 状态 + 读出 */}
          <div className="rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2 text-[12px]">
            <div className="text-zinc-300">{status}</div>
            {readout && (
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-zinc-400">
                <div>状态 <span className={STATUS_COLOR[readout.status] ?? 'text-zinc-200'}>{readout.status}</span></div>
                <div>尝试次数 <span className="text-zinc-200">{readout.attempts}</span></div>
                <div>tempo <span className="text-zinc-200">{readout.bpm} bpm</span></div>
                <div>长度 <span className="text-zinc-200">{readout.bars} 小节</span></div>
                <div className="col-span-2 mt-1 flex flex-wrap gap-2">
                  {readout.tracks.map((t) => (
                    <span key={t.role} className="rounded bg-zinc-800 px-2 py-0.5">
                      {t.role}:{t.count}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
