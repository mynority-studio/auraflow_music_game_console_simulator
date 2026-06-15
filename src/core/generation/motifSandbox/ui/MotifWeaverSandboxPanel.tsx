// ============================================================
// motifSandbox · ui · Q+R Motif 续写沙盒面板
// ------------------------------------------------------------
// 录(MIDI,后接)/ 注入示例 motif → 分析归一化 → VERSE1/VERSE2 quote + 续写 → lead-only 试听。
// 完全独立于 newEngine 生产链。播放共享 globalMidiScheduler(与新引擎面板互斥,先 stop 再 play)。
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { Piano, X } from 'lucide-react';
import { useDevPanelChannel } from '../../../../components/devPanels';
import { analyzeAndNormalize, generateSampleCaptured, fitRecordingToBars, MotifAnalysisError, type AnalyzeResult } from '../model/motifAnalysis';
import { generateMotifWeave } from '../model/motifWeaver';
import { buildLeadOnlyIr, LEAD_PROGRAM_BY_STYLE } from '../model/leadOnlyIr';
import type { CapturedMidiNote, MotifWeaverResult, SandboxStyle, ScaleMode } from '../model/types';
import { playMusicalIR, stopNewEngine } from '../../newEngine/sandbox/audioOut';
import { requestMidiAccess, type MidiAccessHandle, type MidiDeviceInfo, type MidiSupport, type ParsedMidiMessage } from '../midi/webMidi';
import { MidiMotifRecorder } from '../capture/MidiMotifRecorder';

const STYLES: SandboxStyle[] = ['pop', 'lofi', 'rnb', 'jazz'];
const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const MotifWeaverSandboxPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<SandboxStyle>('pop');
  const [keyPc, setKeyPc] = useState(0);
  const [mode, setMode] = useState<ScaleMode>('major');
  const [bpm, setBpm] = useState(96);
  const [seed, setSeed] = useState(7);
  const [captured, setCaptured] = useState<CapturedMidiNote[]>([]);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [result, setResult] = useState<MotifWeaverResult | null>(null);
  const [status, setStatus] = useState('注入或录入一段 motif');
  const [playing, setPlaying] = useState(false);
  const heldKeys = useRef<Set<string>>(new Set());

  // —— Web MIDI ——
  const [midiStatus, setMidiStatus] = useState<MidiSupport | 'idle'>('idle');
  const [devices, setDevices] = useState<MidiDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [lastNote, setLastNote] = useState('');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useRef(new MidiMotifRecorder());
  const access = useRef<MidiAccessHandle | null>(null);
  const timer = useRef<number | null>(null);
  const liveCfg = useRef({ keyPc, mode, bpm, seed });
  liveCfg.current = { keyPc, mode, bpm, seed };

  useDevPanelChannel('motif', open, setOpen);

  // 全局 Q+R 调出 / Esc 关闭
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      heldKeys.current.add(k);
      if (!open && heldKeys.current.has('q') && heldKeys.current.has('r') && !isTyping()) {
        e.preventDefault();
        setOpen(true);
      } else if (open && k === 'escape') setOpen(false);
    };
    const onKeyUp = (e: KeyboardEvent) => heldKeys.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [open]);

  const stopPlayback = useCallback(() => { stopNewEngine(); setPlaying(false); }, []);

  // 录到/注入 raw → 据长度识别整 bar + 调 bpm → 走完整 analyze(不绕过 analyzer)
  const applyCaptured = useCallback((cap: CapturedMidiNote[], label: string) => {
    setCaptured(cap);
    setResult(null);
    if (cap.length === 0) { setAnalysis(null); setStatus('未录到音符'); return; }
    const { keyPc: k, mode: md, bpm: b, seed: s } = liveCfg.current;
    const fit = fitRecordingToBars(cap, b);
    setBpm(fit.adjustedBpm); // 调 bpm 让这段正好整 bar
    try {
      const a = analyzeAndNormalize(cap, k, md, fit.adjustedBpm, s);
      setAnalysis(a);
      setStatus(`${label}:识别 ${fit.targetBars} bar(${fit.rawBars.toFixed(2)})· BPM ${b}→${fit.adjustedBpm} · raw ${a.rawCount}→norm ${a.normalizedCount}`);
    } catch (err) { setAnalysis(null); setStatus(err instanceof MotifAnalysisError ? err.message : '分析失败'); }
  }, []);

  // —— Web MIDI 接入 ——
  const enableMidi = useCallback(async () => {
    const onMessage = (m: ParsedMidiMessage) => {
      if (m.type === 'noteOn') { setLastNote(`note ${m.note} · vel ${m.velocity}`); recorder.current.noteOn(m.note, m.velocity); }
      else if (m.type === 'noteOff') recorder.current.noteOff(m.note);
    };
    const onDevices = (d: MidiDeviceInfo[]) => { setDevices(d); setDeviceId((prev) => prev ?? (d[0]?.id ?? null)); };
    const { status: st, handle } = await requestMidiAccess(onMessage, onDevices);
    setMidiStatus(st);
    if (handle) access.current = handle;
    if (st === 'unsupported') setStatus('当前浏览器不支持 Web MIDI');
    else if (st === 'denied') setStatus('未授权 MIDI,请允许后重试');
  }, []);
  useEffect(() => { access.current?.selectInput(deviceId); }, [deviceId]);

  const finishRecord = useCallback(() => {
    if (timer.current != null) { clearInterval(timer.current); timer.current = null; }
    const notes = recorder.current.stop();
    setRecording(false);
    applyCaptured(notes, '录制'); // 据长度识别整 bar + 调 bpm
  }, [applyCaptured]);

  const startRecord = useCallback(() => {
    if (!access.current) { setStatus('先 Enable MIDI'); return; }
    stopPlayback();
    recorder.current.start(); // 手动起止,不固定秒数(30s 安全上限)
    setRecording(true); setElapsed(0); setCaptured([]); setResult(null); setStatus('● 录制中…(手动停止)');
    timer.current = window.setInterval(() => {
      const e = recorder.current.elapsedMs();
      setElapsed(e);
      if (e >= 30000 || !recorder.current.isActive()) finishRecord(); // 30s 安全兜底
    }, 80);
  }, [stopPlayback, finishRecord]);

  // 卸载清理
  useEffect(() => () => { if (timer.current != null) clearInterval(timer.current); access.current?.dispose(); }, []);

  // 注入示例 motif:生成 raw → applyCaptured(同录制路径)
  const injectSample = useCallback(() => {
    stopPlayback();
    const { keyPc: k, mode: md, bpm: b, seed: s } = liveCfg.current;
    applyCaptured(generateSampleCaptured(b, k, md, (s % 4 + 4) % 4), '注入示例');
  }, [applyCaptured, stopPlayback]);

  const generate = useCallback(() => {
    if (captured.length === 0) { setStatus('先注入/录入 motif'); return; }
    stopPlayback();
    try {
      const r = generateMotifWeave({ capturedNotes: captured, style, keyPc, mode, bpm, seed });
      setResult(r);
      setAnalysis({ motif: r.motif, rawCount: captured.length, normalizedCount: r.motif.notes.length });
      setStatus(`生成 ${r.lead.length} 音 · 每轮 motif ${r.audit.placementsPerCycle} 次 × ${r.numCycles} 轮 · 一致=${r.audit.cyclesConsistent ? '✓' : '✗'}`);
    } catch (err) { setStatus(err instanceof MotifAnalysisError ? err.message : '生成失败'); }
  }, [captured, style, keyPc, mode, bpm, seed, stopPlayback]);

  const play = useCallback(async () => {
    if (!result) { setStatus('先生成'); return; }
    stopNewEngine();
    const ir = buildLeadOnlyIr(result.lead, bpm, style);
    setPlaying(true);
    setStatus('▶ 播放 lead…');
    try { await playMusicalIR(ir, bpm, style); } catch { /* 静默 */ }
  }, [result, bpm, style]);

  if (!open) return null;

  const sel = 'bg-zinc-800 text-zinc-100 rounded px-1.5 py-0.5 text-[11px] border border-zinc-700';
  const a = analysis;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      className="fixed right-3 top-3 z-[70] w-[340px] max-h-[92vh] overflow-auto rounded-2xl border border-fuchsia-500/30
                 bg-zinc-950/95 backdrop-blur-md shadow-[0_8px_40px_rgba(0,0,0,0.7)] text-zinc-200"
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800">
        <Piano size={15} className="text-fuchsia-300" />
        <span className="text-[12px] font-semibold tracking-wide text-fuchsia-200">Motif 续写沙盒</span>
        <span className="text-[10px] text-zinc-500">Q+R</span>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto text-zinc-500 hover:text-zinc-200"><X size={15} /></button>
      </div>

      {/* MIDI */}
      <div className="px-3 py-2 border-b border-zinc-900">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1.5">MIDI</div>
        {midiStatus === 'idle' && <button type="button" onClick={enableMidi} className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1 text-[12px]">Enable MIDI</button>}
        {midiStatus === 'unsupported' && <span className="text-[11px] text-rose-300">当前浏览器不支持 Web MIDI</span>}
        {midiStatus === 'denied' && <span className="text-[11px] text-amber-300">未授权 · <button type="button" onClick={enableMidi} className="underline">重试</button></span>}
        {midiStatus === 'ready' && (
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {devices.length === 0
              ? <span className="text-amber-300">未检测到 MIDI 输入设备</span>
              : <select className={sel} value={deviceId ?? ''} onChange={(e) => setDeviceId(e.target.value || null)}>{devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
            <span className="text-zinc-500">last: {lastNote || '—'}</span>
          </div>
        )}
      </div>

      {/* Capture */}
      <div className="px-3 py-2 border-b border-zinc-900">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1.5">Capture</div>
        <div className="flex items-center gap-2">
          {!recording
            ? <button type="button" onClick={startRecord} disabled={midiStatus !== 'ready'} className="rounded-lg bg-rose-600/80 hover:bg-rose-500 disabled:opacity-40 px-2.5 py-1 text-[12px] text-white">● 录制</button>
            : <button type="button" onClick={finishRecord} className="rounded-lg bg-rose-500 px-2.5 py-1 text-[12px] text-white">■ 停止</button>}
          <button type="button" onClick={injectSample} className="rounded-lg bg-fuchsia-600/80 hover:bg-fuchsia-500 px-2.5 py-1 text-[12px] text-white">注入示例</button>
          <span className="text-[11px] text-zinc-400">{recording ? `${(elapsed / 1000).toFixed(1)}s ≈ ${(elapsed / (240000 / bpm)).toFixed(1)} bar` : `raw ${captured.length}${a ? ` → ${a.normalizedCount}音 / ${a.motif.lengthBeats / 4} bar` : ''}`}</span>
          {captured.length > 0 && !recording && <button type="button" onClick={() => { setCaptured([]); setAnalysis(null); setResult(null); setStatus('已清空'); }} className="ml-auto text-[10px] text-zinc-500 hover:text-zinc-300">清空</button>}
        </div>
      </div>

      {/* Generate */}
      <div className="px-3 py-2 border-b border-zinc-900 space-y-1.5">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500">Generate</div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <label>风格<select className={sel} value={style} onChange={(e) => setStyle(e.target.value as SandboxStyle)}>{STYLES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}</select></label>
          <label>调<select className={sel} value={keyPc} onChange={(e) => setKeyPc(Number(e.target.value))}>{KEY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}</select></label>
          <select className={sel} value={mode} onChange={(e) => setMode(e.target.value as ScaleMode)}><option value="major">major</option><option value="minor">minor</option></select>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <label>bpm<input type="number" className={`${sel} w-14`} value={bpm} min={50} max={200} onChange={(e) => setBpm(Math.max(50, Math.min(200, Number(e.target.value) || 96)))} /></label>
          <label>seed<input type="number" className={`${sel} w-16`} value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} /></label>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          <button type="button" onClick={generate} disabled={captured.length === 0} className="rounded-lg bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-40 px-2.5 py-1 text-[12px] text-white">生成 Lead</button>
          {!playing
            ? <button type="button" onClick={play} disabled={!result} className="rounded-lg bg-sky-600/80 hover:bg-sky-500 disabled:opacity-40 px-2.5 py-1 text-[12px] text-white">▶ 播放</button>
            : <button type="button" onClick={stopPlayback} className="rounded-lg bg-rose-600/80 hover:bg-rose-500 px-2.5 py-1 text-[12px] text-white">■ 停止</button>}
          <span className="ml-auto text-[10px] text-zinc-500">lead=GM{LEAD_PROGRAM_BY_STYLE[style]}</span>
        </div>
      </div>

      {/* Status */}
      <div className="px-3 py-1.5 text-[11px] text-amber-200/90 border-b border-zinc-900">{status}</div>

      {/* Analysis readout */}
      {a && (
        <div className="px-3 py-2 space-y-1 text-[11px]">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500">Analysis</div>
          <Row k="motif 长度" v={`${a.motif.lengthBeats} beats · ${a.motif.notes.length} 音(raw ${a.rawCount})`} />
          <Row k="contour" v={a.motif.contour.map((c) => (c > 0 ? '↑' : c < 0 ? '↓' : '→')).join('')} />
          <Row k="rhythm cell" v={a.motif.rhythmCell.map((d) => d.toFixed(2)).join(' ')} />
          {result && <>
            <Row k="配和弦(一轮)" v={(() => { const per = Math.max(1, Math.round(result.progression.length / result.numCycles)); return result.progression.slice(0, per).map((c) => c.roman).join('-'); })()} />
            <Row k="每轮 motif" v={`${result.audit.placementsPerCycle} 次(${result.audit.placementsPerCycle === 2 ? '轮首原样 + 后半适配' : '仅轮首原样'})· ${result.numCycles} 轮`} />
            <Row k="轮首原样 motif" v={result.audit.motifQuotedFirstCycle ? '✓' : '✗'} good={result.audit.motifQuotedFirstCycle} />
            <Row k="各轮复制一致" v={result.audit.cyclesConsistent ? '✓' : '✗'} good={result.audit.cyclesConsistent} />
            <Row k="chromaticRatio" v={result.audit.chromaticRatio.toFixed(2)} good={result.audit.chromaticRatio === 0 || style === 'jazz'} />
            <Row k="maxLeap / jazziness" v={`${result.audit.maxLeap} 半音 · ${result.audit.jazzinessScore.toFixed(2)}`} good={result.audit.jazzinessScore < 0.35 || style === 'jazz'} />
            <div className="text-[10px] text-zinc-500 pt-1">前 16 音(fuchsia=原样 motif · cyan=适配):</div>
            <div className="text-[10px] text-zinc-400 leading-snug break-words">
              {result.lead.slice(0, 16).map((n, i) => <span key={i} className={n.occurrenceKind === 'quote' ? 'text-fuchsia-300' : n.occurrenceKind === 'adapted' ? 'text-cyan-300' : ''}>{n.midi}@{n.onsetBeat.toFixed(1)} </span>)}
            </div>
          </>}
        </div>
      )}
    </motion.div>
  );
};

const Row: React.FC<{ k: string; v: string; good?: boolean }> = ({ k, v, good }) => (
  <div className="flex items-baseline gap-2">
    <span className="text-zinc-500 w-[120px] shrink-0">{k}</span>
    <span className={good === undefined ? 'text-zinc-300' : good ? 'text-emerald-300' : 'text-rose-300'}>{v}</span>
  </div>
);
