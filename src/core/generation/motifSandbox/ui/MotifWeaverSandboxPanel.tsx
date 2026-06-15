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
import { analyzeAndNormalize, analyzeHiddenGridMotif, generateSampleCaptured, fitRecordingToBars, MotifAnalysisError, type AnalyzeResult, type MotifTimingAnalysis } from '../model/motifAnalysis';
import { generateMotifWeave } from '../model/motifWeaver';
import { buildSandboxIr, LEAD_PROGRAM_BY_STYLE } from '../model/leadOnlyIr';
import { buildAccompaniment } from '../model/accompaniment';
import { SANDBOX_TONALITIES, TONALITY_LABEL, tonalityParentMode, scaleNoteMap, snapMidiToTonality, type SandboxTonality } from '../model/sandboxScales';
import { createHiddenGridContext, capturedToGridNotes, msPerBeat, type HiddenGridCaptureContext } from '../capture/hiddenGridClock';
import type { CapturedMidiNote, MotifWeaverResult, SandboxStyle, UserMotif } from '../model/types';
import { playMusicalIR, stopNewEngine, auditionNoteOn, auditionNoteOff, playClick } from '../../newEngine/sandbox/audioOut';
import { requestMidiAccess, type MidiAccessHandle, type MidiDeviceInfo, type MidiSupport, type ParsedMidiMessage } from '../midi/webMidi';
import { MidiMotifRecorder } from '../capture/MidiMotifRecorder';
import { PadKeyboard } from './PadKeyboard';

type RecordPhase = 'idle' | 'count-in' | 'recording' | 'analyzing' | 'ready';

const STYLES: SandboxStyle[] = ['pop', 'lofi', 'rnb', 'jazz'];
const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const MotifWeaverSandboxPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<SandboxStyle>('pop');
  const [keyPc, setKeyPc] = useState(0);
  const [tonality, setTonality] = useState<SandboxTonality>('major');
  const [bpm, setBpm] = useState(96);
  const [seed, setSeed] = useState(7);
  const [withAccomp, setWithAccomp] = useState(true);
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
  // —— 隐形时钟(默认捕获模式)——
  const [captureMode, setCaptureMode] = useState<'hiddenGrid' | 'freeFallback'>('hiddenGrid');
  const [recordPhase, setRecordPhase] = useState<RecordPhase>('idle');
  const [hiddenMotif, setHiddenMotif] = useState<UserMotif | null>(null);
  const [timing, setTiming] = useState<MotifTimingAnalysis | null>(null);
  const [snapChanges, setSnapChanges] = useState(0);
  const ctxRef = useRef<HiddenGridCaptureContext | null>(null);
  const recTimers = useRef<number[]>([]);
  const recorder = useRef(new MidiMotifRecorder());
  const access = useRef<MidiAccessHandle | null>(null);
  const timer = useRef<number | null>(null);
  const liveCfg = useRef({ keyPc, tonality, bpm, seed, style });
  liveCfg.current = { keyPc, tonality, bpm, seed, style };

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
    const { keyPc: k, tonality: t, bpm: b, seed: s } = liveCfg.current;
    const fit = fitRecordingToBars(cap, b);
    setBpm(fit.adjustedBpm); // 调 bpm 让这段正好整 bar
    try {
      const a = analyzeAndNormalize(cap, k, tonalityParentMode(t), fit.adjustedBpm, s, t); // 吸到选定音阶(保 blues/五声特征)
      setAnalysis(a);
      setStatus(`${label}:识别 ${fit.targetBars} bar(${fit.rawBars.toFixed(2)})· BPM ${b}→${fit.adjustedBpm} · raw ${a.rawCount}→norm ${a.normalizedCount}`);
    } catch (err) { setAnalysis(null); setStatus(err instanceof MotifAnalysisError ? err.message : '分析失败'); }
  }, []);

  // —— Web MIDI 接入 ——
  const enableMidi = useCallback(async () => {
    const onMessage = (m: ParsedMidiMessage) => {
      if (m.type === 'noteOn') {
        const { keyPc: k, tonality: t, style: st } = liveCfg.current;
        if (snapMidiToTonality(m.note, k, t) === m.note) { // 在选定音阶内(= 3×5 词汇)→ 1:1 原音高发声 + 记录
          setLastNote(`note ${m.note} · vel ${m.velocity}`);
          void auditionNoteOn(m.note, LEAD_PROGRAM_BY_STYLE[st], m.velocity);
          if (recorder.current.isActive()) recorder.current.noteOn(m.note, m.velocity);
        } else {
          setLastNote(`note ${m.note} · 离调 → 静音`); // 不在音阶内 → 不发声、不记录
        }
      } else if (m.type === 'noteOff') {
        auditionNoteOff(m.note);
        if (recorder.current.isActive()) recorder.current.noteOff(m.note);
      }
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
    stopPlayback();
    recorder.current.start(); // 手动起止,不固定秒数(30s 安全上限)。MIDI 或 3×5 键盘都可录
    setRecording(true); setElapsed(0); setCaptured([]); setResult(null);
    setStatus(access.current ? '● 录制中…(MIDI / 点 3×5 键盘,手动停止)' : '● 录制中…(点 3×5 键盘,手动停止)');
    timer.current = window.setInterval(() => {
      const e = recorder.current.elapsedMs();
      setElapsed(e);
      if (e >= 30000 || !recorder.current.isActive()) finishRecord(); // 30s 安全兜底
    }, 80);
  }, [stopPlayback, finishRecord]);

  // —— 隐形时钟录制(默认):预选 BPM + 数拍 → 捕获窗内收音 → 映射回网格 → 分析 ——
  const clearRecTimers = useCallback(() => { recTimers.current.forEach((t) => clearTimeout(t)); recTimers.current = []; }, []);

  const finishHiddenGridRecord = useCallback(() => {
    clearRecTimers();
    if (timer.current != null) { clearInterval(timer.current); timer.current = null; }
    const ctx = ctxRef.current;
    const cap = recorder.current.stop();
    setRecording(false);
    if (!ctx) { setRecordPhase('idle'); return; }
    setRecordPhase('analyzing');
    try {
      const g = capturedToGridNotes(cap, ctx);
      const { motif, timing: tm, snapChanges: sc } = analyzeHiddenGridMotif(g, ctx);
      setHiddenMotif(motif); setTiming(tm); setSnapChanges(sc);
      setAnalysis({ motif, rawCount: cap.length, normalizedCount: motif.notes.length });
      setRecordPhase('ready');
      setStatus(`隐形时钟:${tm.captureBars}bar @ BPM ${tm.bpm} · ${motif.notes.length}音 · 量化误差 ${tm.quantizeErrorMean.toFixed(2)}拍 · 吸附改 ${sc}`);
    } catch (err) { setRecordPhase('idle'); setStatus(err instanceof MotifAnalysisError ? err.message : '分析失败'); }
  }, [clearRecTimers]);

  const startHiddenGridRecord = useCallback(() => {
    stopPlayback(); clearRecTimers();
    const { keyPc: k, tonality: t, seed: s } = liveCfg.current;
    const ctx = createHiddenGridContext({ seed: s, keyPc: k, scaleMode: tonalityParentMode(t), tonality: t, style, startMs: 0, countInBars: 1, desiredBars: 4 });
    ctxRef.current = ctx;
    setBpm(ctx.bpm);
    setHiddenMotif(null); setTiming(null); setResult(null); setCaptured([]); setAnalysis(null);
    recorder.current.start({ maxMs: ctx.captureEndMs + 300 });
    setRecording(true); setRecordPhase('count-in'); setElapsed(0);
    setStatus(`◔ 数拍预备(1 小节 · BPM ${ctx.bpm})…听完 4 下开始弹`);
    const mpb = msPerBeat(ctx);
    const countInBeats = ctx.countInBars * ctx.beatsPerBar;
    for (let b = 0; b < countInBeats; b++) { // ★ 节拍器只响数拍这 1 小节,之后隐形静音(拍子继续跑=隐形时钟)
      recTimers.current.push(window.setTimeout(() => { void playClick(b % ctx.beatsPerBar === 0); }, b * mpb));
    }
    recTimers.current.push(window.setTimeout(() => { setRecordPhase('recording'); setStatus(`● 演奏中…(自由弹,最多 ${ctx.captureBars} 小节;可点 ■ 早停)`); }, ctx.captureStartMs));
    recTimers.current.push(window.setTimeout(() => finishHiddenGridRecord(), ctx.captureEndMs + 80));
    timer.current = window.setInterval(() => setElapsed(recorder.current.elapsedMs()), 80);
  }, [style, stopPlayback, clearRecTimers, finishHiddenGridRecord]);

  // —— 3×5 键盘:按下=试听(+录音器活跃时记音,数拍期会被滤掉),松开=停音 ——
  const handlePadDown = useCallback((_idx: number, midi: number) => {
    void auditionNoteOn(midi, LEAD_PROGRAM_BY_STYLE[style], 100);
    if (recorder.current.isActive()) recorder.current.noteOn(midi, 100);
  }, [style]);
  const handlePadUp = useCallback((_idx: number, midi: number) => {
    auditionNoteOff(midi);
    if (recorder.current.isActive()) recorder.current.noteOff(midi);
  }, []);

  // 卸载清理
  useEffect(() => () => { if (timer.current != null) clearInterval(timer.current); recTimers.current.forEach((t) => clearTimeout(t)); access.current?.dispose(); }, []);

  // 注入示例 motif:隐形时钟模式 → 平移进捕获窗走 hidden 分析;free 模式 → 老路径
  const injectSample = useCallback(() => {
    stopPlayback();
    const { keyPc: k, tonality: t, seed: s } = liveCfg.current;
    if (captureMode === 'hiddenGrid') {
      const ctx = createHiddenGridContext({ seed: s, keyPc: k, scaleMode: tonalityParentMode(t), tonality: t, style, startMs: 0, countInBars: 1, desiredBars: 4 });
      ctxRef.current = ctx; setBpm(ctx.bpm); setResult(null);
      const raw = generateSampleCaptured(ctx.bpm, k, tonalityParentMode(t), (s % 4 + 4) % 4).map((n) => ({ ...n, onsetMs: n.onsetMs + ctx.captureStartMs }));
      try {
        const { motif, timing: tm, snapChanges: sc } = analyzeHiddenGridMotif(capturedToGridNotes(raw, ctx), ctx);
        setHiddenMotif(motif); setTiming(tm); setSnapChanges(sc); setCaptured([]);
        setAnalysis({ motif, rawCount: raw.length, normalizedCount: motif.notes.length });
        setRecordPhase('ready');
        setStatus(`注入(隐形时钟):${tm.captureBars}bar @ BPM ${tm.bpm} · ${motif.notes.length}音`);
      } catch (err) { setStatus(err instanceof MotifAnalysisError ? err.message : '分析失败'); }
    } else {
      setHiddenMotif(null);
      applyCaptured(generateSampleCaptured(liveCfg.current.bpm, k, tonalityParentMode(t), (s % 4 + 4) % 4), '注入示例');
    }
  }, [captureMode, style, applyCaptured, stopPlayback]);

  const generate = useCallback(() => {
    const motif = captureMode === 'hiddenGrid' ? hiddenMotif : null;
    if (!motif && captured.length === 0) { setStatus('先录入/注入 motif'); return; }
    stopPlayback();
    try {
      const r = generateMotifWeave(motif
        ? { capturedNotes: [], motif, style, keyPc, mode: tonalityParentMode(tonality), bpm, seed, inputTonality: tonality, quotePlan: 'phraseHeads' }
        : { capturedNotes: captured, style, keyPc, mode: tonalityParentMode(tonality), bpm, seed, inputTonality: tonality, quotePlan: 'phraseHeads' });
      setResult(r);
      setAnalysis({ motif: r.motif, rawCount: captured.length, normalizedCount: r.motif.notes.length });
      setStatus(`生成 ${r.lead.length} 音 / ${r.totalBars} bar · 陈述 ${r.audit.themeStatements} · 发展 ${r.audit.developVariants} 种 · 留白 ${(r.audit.restRatio * 100).toFixed(0)}%`);
    } catch (err) { setStatus(err instanceof MotifAnalysisError ? err.message : '生成失败'); }
  }, [captureMode, hiddenMotif, captured, style, keyPc, tonality, bpm, seed, stopPlayback]);

  const play = useCallback(async () => {
    if (!result) { setStatus('先生成'); return; }
    stopNewEngine();
    const accomp = withAccomp ? buildAccompaniment(result.progression, style, seed, result.lead) : null; // 传 lead → 伴奏锁旋律重音/结构点
    const ir = buildSandboxIr(result.lead, accomp, bpm, style);
    setPlaying(true);
    setStatus(withAccomp ? '▶ 播放 lead + 伴奏…' : '▶ 播放 lead…');
    try { await playMusicalIR(ir, bpm, style); } catch { /* 静默 */ }
  }, [result, bpm, style, seed, withAccomp]);

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
      <div className="px-3 py-2 border-b border-zinc-900 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">Capture</span>
          <button type="button" onClick={() => setCaptureMode((m) => (m === 'hiddenGrid' ? 'freeFallback' : 'hiddenGrid'))}
            className={`rounded px-1.5 py-0.5 text-[10px] border ${captureMode === 'hiddenGrid' ? 'bg-sky-600/30 border-sky-500/50 text-sky-200' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>
            {captureMode === 'hiddenGrid' ? '隐形时钟' : 'free 回退'}
          </button>
          {captureMode === 'hiddenGrid' && recordPhase !== 'idle' && (
            <span className={`text-[10px] ${recordPhase === 'count-in' ? 'text-amber-300' : recordPhase === 'recording' ? 'text-rose-300' : 'text-zinc-400'}`}>
              {recordPhase === 'count-in' ? '◔ 数拍…' : recordPhase === 'recording' ? '● 演奏中…' : recordPhase === 'analyzing' ? '… 分析' : '✓ 就绪'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {captureMode === 'hiddenGrid'
            ? (recording
                ? <button type="button" onClick={finishHiddenGridRecord} className="rounded-lg bg-rose-500 px-2.5 py-1 text-[12px] text-white">■ 停止</button>
                : <button type="button" onClick={startHiddenGridRecord} className="rounded-lg bg-rose-600/80 hover:bg-rose-500 px-2.5 py-1 text-[12px] text-white">● 数拍录制</button>)
            : (!recording
                ? <button type="button" onClick={startRecord} className="rounded-lg bg-rose-600/80 hover:bg-rose-500 px-2.5 py-1 text-[12px] text-white">● 录制</button>
                : <button type="button" onClick={finishRecord} className="rounded-lg bg-rose-500 px-2.5 py-1 text-[12px] text-white">■ 停止</button>)}
          <button type="button" onClick={injectSample} className="rounded-lg bg-fuchsia-600/80 hover:bg-fuchsia-500 px-2.5 py-1 text-[12px] text-white">注入示例</button>
          <span className="text-[11px] text-zinc-400">{recording ? `${(elapsed / 1000).toFixed(1)}s` : a ? `${a.normalizedCount}音 / ${a.motif.lengthBeats / 4} bar` : '—'}</span>
        </div>
      </div>

      {/* 音阶 + 3×5 键盘输入 */}
      <div className="px-3 py-2 border-b border-zinc-900 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">音阶</span>
          <select className={sel} value={keyPc} onChange={(e) => setKeyPc(Number(e.target.value))}>{KEY_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}</select>
          <select className={sel} value={tonality} onChange={(e) => setTonality(e.target.value as SandboxTonality)}>{SANDBOX_TONALITIES.map((t) => <option key={t} value={t}>{TONALITY_LABEL[t]}</option>)}</select>
          {recording && <span className="ml-auto text-[10px] text-rose-300">● {(elapsed / 1000).toFixed(1)}s</span>}
        </div>
        <PadKeyboard noteMap={scaleNoteMap(keyPc, tonality)} recording={recording} onPadDown={handlePadDown} onPadUp={handlePadUp} />
        <div className="text-[10px] text-zinc-600">点 pad 试听;按【● 录制】后点 pad 即记录,【■ 停止】完成 → 自动识别整 bar。底行低音 → 顶行高音。</div>
      </div>

      {/* Generate */}
      <div className="px-3 py-2 border-b border-zinc-900 space-y-1.5">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500">Generate</div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <label>风格<select className={sel} value={style} onChange={(e) => setStyle(e.target.value as SandboxStyle)}>{STYLES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}</select></label>
          <span className="text-zinc-500">{KEY_NAMES[keyPc]} {TONALITY_LABEL[tonality]} → 母调 {tonalityParentMode(tonality)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <label>bpm<input type="number" className={`${sel} w-14`} value={bpm} min={50} max={200} onChange={(e) => setBpm(Math.max(50, Math.min(200, Number(e.target.value) || 96)))} /></label>
          <label>seed<input type="number" className={`${sel} w-16`} value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} /></label>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          <button type="button" onClick={generate} disabled={captureMode === 'hiddenGrid' ? !hiddenMotif : captured.length === 0} className="rounded-lg bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-40 px-2.5 py-1 text-[12px] text-white">生成 Lead</button>
          {!playing
            ? <button type="button" onClick={play} disabled={!result} className="rounded-lg bg-sky-600/80 hover:bg-sky-500 disabled:opacity-40 px-2.5 py-1 text-[12px] text-white">▶ 播放</button>
            : <button type="button" onClick={stopPlayback} className="rounded-lg bg-rose-600/80 hover:bg-rose-500 px-2.5 py-1 text-[12px] text-white">■ 停止</button>}
          <button type="button" onClick={() => setWithAccomp((v) => !v)} className={`rounded-lg px-2 py-1 text-[11px] border ${withAccomp ? 'bg-amber-600/30 border-amber-500/50 text-amber-200' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>伴奏 {withAccomp ? 'on' : 'off'}</button>
          <span className="ml-auto text-[10px] text-zinc-500">lead=GM{LEAD_PROGRAM_BY_STYLE[style]}</span>
        </div>
      </div>

      {/* Status */}
      <div className="px-3 py-1.5 text-[11px] text-amber-200/90 border-b border-zinc-900">{status}</div>

      {/* Analysis readout */}
      {a && (
        <div className="px-3 py-2 space-y-1 text-[11px]">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500">Analysis{timing ? ' · 隐形时钟' : ''}</div>
          {timing && <>
            <Row k="BPM / 捕获" v={`${timing.bpm} · ${timing.captureBars}bar · 数拍${1}小节`} />
            <Row k="量化误差 / 相位" v={`均 ${timing.quantizeErrorMean.toFixed(3)} · 最大 ${timing.quantizeErrorMax.toFixed(3)} 拍 · 相位置信 ${timing.phaseConfidence.toFixed(1)}`} good={timing.quantizeErrorMax < 0.15} />
            <Row k="前导休止 / 吸附改" v={`${timing.leadingRestBeats.toFixed(2)} 拍 · ${snapChanges} 音`} good={snapChanges === 0} />
          </>}
          <Row k="motif 长度" v={`${a.motif.lengthBeats} beats · ${a.motif.notes.length} 音(raw ${a.rawCount})`} />
          <Row k="contour" v={a.motif.contour.map((c) => (c > 0 ? '↑' : c < 0 ? '↓' : '→')).join('')} />
          <Row k="rhythm cell" v={a.motif.rhythmCell.map((d) => d.toFixed(2)).join(' ')} />
          {result && <>
            <Row k="和弦进行(16 bar)" v={result.progression.map((c) => c.roman).join('-')} />
            <Row k="发展弧(每槽)" v={result.arc.join(' · ')} />
            <Row k="第一槽 head 原样" v={result.audit.motifQuotedFirstCycle ? '✓' : '✗'} good={result.audit.motifQuotedFirstCycle} />
            <Row k="陈述 / 发展手法 / 连接" v={`${result.audit.themeStatements} · ${result.audit.developVariants} 种 · ${result.audit.connectSlots}`} good={result.audit.developVariants >= 2} />
            <Row k="密度 / 留白" v={`${result.audit.notesPerBar.toFixed(1)} 音·bar / 留白 ${(result.audit.restRatio * 100).toFixed(0)}%`} good={result.audit.restRatio > 0.1} />
            <Row k="chromaticRatio" v={result.audit.chromaticRatio.toFixed(2)} good={result.audit.chromaticRatio === 0 || style === 'jazz' || tonality === 'blues'} />
            <Row k="maxLeap / jazziness" v={`${result.audit.maxLeap} 半音 · ${result.audit.jazzinessScore.toFixed(2)}`} good={result.audit.jazzinessScore < 0.35 || style === 'jazz'} />
            <div className="text-[10px] text-zinc-500 pt-1">前 16 音(fuchsia=原样陈述 · cyan=变形发展 · 灰=连接留白):</div>
            <div className="text-[10px] text-zinc-400 leading-snug break-words">
              {result.lead.slice(0, 16).map((n, i) => <span key={i} className={n.occurrenceKind === 'quote' ? 'text-fuchsia-300' : n.occurrenceKind === 'develop' ? 'text-cyan-300' : 'text-zinc-500'}>{n.midi}@{n.onsetBeat.toFixed(1)} </span>)}
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
