// ============================================================
// newEngine · sandbox · Q+N 控制板(出声)
// ------------------------------------------------------------
// 独立沙盒 UI:同时按住 Q + N 调出 / Esc 关闭(也可点左侧 DevDock 的"新引擎")。
// 调 generateSong(request) 端到端生成 → playMusicalIR 发声。不走主系统 / 旧引擎。
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { traceGeneration } from '../generation';
import type { GenerationTrace } from '../generation';
import { playMusicalIR, stopNewEngine } from './audioOut';
import { buildPianoRoll, type PianoRoll } from './pianoRoll';
import { musicalIRToSMF } from './midiFile';
import { compareTraces, type TraceComparison } from './traceDiff';
import { PianoRollWindow } from './PianoRollWindow';
import { useDevPanelChannel } from '../../../../components/devPanels';
import { QnGenerationMonitorView, deriveQnMonitorReadout, type QnMonitorReadout } from '../../../../components/QnGenerationMonitorView';

// ★ 4 大 macro 风格(genre 轴);modal 是正交 regime,单独开关。
const STYLES = ['pop', 'jazz', 'lofi', 'rnb', 'acg'] as const;
const STYLE_LABEL: Record<(typeof STYLES)[number], string> = { pop: 'POP', jazz: 'JAZZ', lofi: 'LOFI', rnb: 'RNB', acg: 'ACG' };

export const NewEnginePanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState(7);
  const [style, setStyle] = useState<(typeof STYLES)[number]>('pop');
  const [modal, setModal] = useState(false); // 正交 regime:modal 静态 vamp
  const [allowModulation, setAllowModulation] = useState(false);
  const [status, setStatus] = useState('就绪');
  const [readout, setReadout] = useState<QnMonitorReadout | null>(null);
  const [roll, setRoll] = useState<PianoRoll | null>(null);
  const [cmp, setCmp] = useState<TraceComparison | null>(null);
  const [rollWinOpen, setRollWinOpen] = useState(false);
  const lastIR = useRef<GenerationTrace['ir'] | undefined>(undefined);
  const lastSections = useRef<GenerationTrace['sections']>([]);
  const lastBpm = useRef(100);
  const [logLines, setLogLines] = useState<string[]>([]);
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

  const generate = (): GenerationTrace => {
    const t = traceGeneration({ seed, styleHint: style, mood: 'calm-build', targetDuration: 120, allowModulation: allowModulation && !modal, ...(modal ? { tonalityKind: 'modal' as const } : {}) });
    lastIR.current = t.ir;
    lastSections.current = t.sections;
    lastBpm.current = t.bpm;
    setReadout(deriveQnMonitorReadout({ ir: t.ir, status: t.status, attempts: t.attempts, bpm: t.bpm }));
    setRoll(buildPianoRoll(t.ir, { width: 512, height: 168 }));
    setLogLines(t.lines);
    // eslint-disable-next-line no-console
    console.log('%c[newEngine] 生成流程日志（逐层节点）\n%s', 'color:#34d399;font-weight:bold', t.lines.join('\n'));
    return t;
  };

  const onGenerateAndPlay = async () => {
    const t = generate();
    setStatus('播放中…');
    try {
      await playMusicalIR(t.ir, t.bpm, style);
      setStatus('▶ 播放中');
    } catch (err) {
      setStatus(`音频启动失败:${String(err)}`);
    }
  };

  const onReplay = async () => {
    if (!lastIR.current) return;
    setStatus('播放中…');
    try { await playMusicalIR(lastIR.current, lastBpm.current, style); setStatus('▶ 重播'); }
    catch (err) { setStatus(`音频失败:${String(err)}`); }
  };

  const onStop = () => { stopNewEngine(); setStatus('已停止'); };

  const onCompareAB = () => {
    const req = (s: number) => ({ seed: s, styleHint: style, mood: 'calm-build', targetDuration: 120, allowModulation: allowModulation && !modal, ...(modal ? { tonalityKind: 'modal' as const } : {}) });
    const a = traceGeneration(req(seed));
    const b = traceGeneration(req(seed + 1));
    setCmp(compareTraces(a, b));
    setStatus(`⇄ A/B seed ${seed} vs ${seed + 1}`);
  };

  const onExportMidi = () => {
    const ir = lastIR.current;
    if (!ir) { setStatus('先生成再导出'); return; }
    const smf = musicalIRToSMF(ir, lastBpm.current, style);
    const blob = new Blob([smf as BlobPart], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `newEngine-${style}-seed${seed}.mid`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('⬇ 已导出 .mid');
  };

  if (!open) return null;

  return (
    <>
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

          {/* 风格 macro:4 大 genre(POP/JAZZ/LOFI/RNB)*/}
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-zinc-400">风格 macro</span>
            <div className="flex flex-wrap gap-1.5">
              {STYLES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStyle(s)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold tracking-wide transition ${
                    style === s
                      ? 'bg-emerald-500/90 text-zinc-900'
                      : 'border border-white/10 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {STYLE_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

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
            <button
              type="button"
              onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))}
              className="rounded border border-white/10 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700"
              title="随机换种子(同 seed 必出同一首,可手填复现)"
            >
              🎲 随机 seed
            </button>
            <label
              className="flex items-center gap-1.5 text-[11px] text-zinc-300"
              title="正交 regime:静态 vamp(i + 特征和弦循环)+ 旋律自由跑教会调式"
            >
              <input
                type="checkbox"
                checked={modal}
                onChange={(e) => setModal(e.target.checked)}
                className="accent-violet-500"
              />
              modal
            </label>
            <label
              className={`flex items-center gap-1.5 text-[11px] ${modal ? 'text-zinc-600' : 'text-zinc-300'}`}
              title={modal ? 'modal 静态 vamp 不转调' : '末段副歌升半音 lift'}
            >
              <input
                type="checkbox"
                checked={allowModulation && !modal}
                disabled={modal}
                onChange={(e) => setAllowModulation(e.target.checked)}
                className="accent-violet-500"
              />
              转调 lift
            </label>
          </div>
          {modal && (
            <p className="-mt-2 text-[10px] text-violet-300/70">
              modal regime:静态 vamp(i + 特征和弦循环)+ 旋律自由跑教会调式,逐和弦约束放松(genre 仍取 {STYLE_LABEL[style]} 的乐器/织体)。
            </p>
          )}

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
            <button
              type="button"
              onClick={onExportMidi}
              className="rounded-lg border border-sky-500/40 px-3 py-2 text-sm text-sky-300 hover:bg-sky-500/10"
              title="导出当前生成为 .mid"
            >
              ⬇ MIDI
            </button>
            <button
              type="button"
              onClick={onCompareAB}
              className="rounded-lg border border-violet-500/40 px-3 py-2 text-sm text-violet-300 hover:bg-violet-500/10"
              title={`对比 seed ${seed} vs ${seed + 1}`}
            >
              ⇄ A/B
            </button>
            <button
              type="button"
              onClick={() => { if (!lastIR.current) generate(); setRollWinOpen(true); }}
              className="rounded-lg border border-sky-500/40 px-3 py-2 text-sm text-sky-300 hover:bg-sky-500/10"
              title="拆出独立窗口逐轨看音符(可单独开关每轨)"
            >
              🎹 音轨视图
            </button>
          </div>

          <QnGenerationMonitorView status={status} readout={readout} roll={roll} logLines={logLines} />

          {/* A/B 对比(seed vs seed+1 日志 diff + 指标)*/}
          {cmp && (
            <div className="rounded-lg border border-violet-500/20 bg-black/50">
              <div className="flex items-center justify-between border-b border-white/5 px-3 py-1.5 text-[10px] uppercase tracking-widest text-violet-300/70">
                <span>A/B 对比 · seed {seed} ⇄ {seed + 1}</span>
                <span className="text-zinc-400">{cmp.changedCount} 行差异</span>
              </div>
              <div className="grid grid-cols-4 gap-x-2 gap-y-0.5 px-3 py-2 text-[10px] text-zinc-400">
                {([['bpm', cmp.metrics.bpm], ['小节', cmp.metrics.bars], ['音符', cmp.metrics.notes], ['状态', cmp.metrics.status]] as const).map(([k, v]) => (
                  <div key={k} className={v.equal ? '' : 'text-amber-300'}>
                    {k} <span className="text-zinc-200">{String(v.a)}</span>{v.equal ? '' : ` → ${String(v.b)}`}
                  </div>
                ))}
              </div>
              <div className="max-h-48 overflow-auto border-t border-white/5 px-2 py-1 font-mono text-[9px] leading-snug">
                {cmp.rows.map((r, i) => (
                  <div key={i} className={`grid grid-cols-2 gap-2 ${r.same ? 'text-zinc-500' : 'bg-amber-500/10 text-amber-200'}`}>
                    <span className="truncate" title={r.left}>{r.left ?? ''}</span>
                    <span className="truncate" title={r.right}>{r.right ?? ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
    <PianoRollWindow
      ir={lastIR.current}
      sections={lastSections.current}
      open={rollWinOpen}
      onClose={() => setRollWinOpen(false)}
      title={`${style} · seed ${seed}`}
    />
    </>
  );
};
