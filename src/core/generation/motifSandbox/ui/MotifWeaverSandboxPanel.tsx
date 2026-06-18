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
import { createHiddenGridContext, capturedToGridNotes, msPerBeat, type HiddenGridCaptureContext, type GridCapturedNote } from '../capture/hiddenGridClock';
import type { CapturedMidiNote, MotifWeaverResult, SandboxStyle, UserMotif } from '../model/types';
import { playMusicalIR, stopNewEngine, auditionNoteOn, auditionNoteOff, playClick, ensureAudio, getAudioLatencyMs, setSandboxAuditionMaster } from '../../newEngine/sandbox/audioOut';
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
  const [activeNotes, setActiveNotes] = useState<Set<number>>(() => new Set()); // 当前按住的音(pad 点击 + MIDI)→ 点亮对应 pad
  const heldKeys = useRef<Set<string>>(new Set());
  const noteOnVis = useCallback((m: number) => setActiveNotes((p) => new Set(p).add(m)), []);
  const noteOffVis = useCallback((m: number) => setActiveNotes((p) => { const n = new Set(p); n.delete(m); return n; }), []);

  // —— Web MIDI ——
  const [midiStatus, setMidiStatus] = useState<MidiSupport | 'idle'>('idle');
  const [devices, setDevices] = useState<MidiDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [lastNote, setLastNote] = useState('');
  const [audioLat, setAudioLat] = useState<ReturnType<typeof getAudioLatencyMs>>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // —— 隐形时钟(默认捕获模式)——
  const [captureMode, setCaptureMode] = useState<'hiddenGrid' | 'freeFallback'>('hiddenGrid');
  const [recordPhase, setRecordPhase] = useState<RecordPhase>('idle');
  const [hiddenMotif, setHiddenMotif] = useState<UserMotif | null>(null);
  const [alignFirst, setAlignFirst] = useState(true); // 对齐首音(消数拍/音频延迟造成的偏后);要 pickup 时关掉
  const [timing, setTiming] = useState<MotifTimingAnalysis | null>(null);
  const [snapChanges, setSnapChanges] = useState(0);
  const ctxRef = useRef<HiddenGridCaptureContext | null>(null);
  const gridRef = useRef<{ g: GridCapturedNote[]; ctx: HiddenGridCaptureContext } | null>(null); // 末次分析输入 → pickup 开关重分析
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
        void ensureAudio(); // 按键是手势 → 趁机解锁音频(MIDI 输入才能即时发声)
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
    await ensureAudio(); // 点击是手势 → 解锁 AudioContext,之后 MIDI 输入即时发声
    setAudioLat(getAudioLatencyMs()); // 诊断:audio 系统延迟(base=worklet / output=OS 缓冲含蓝牙)
    const onMessage = (m: ParsedMidiMessage) => {
      if (m.type === 'noteOn') {
        const { keyPc: k, tonality: t, style: st } = liveCfg.current;
        if (snapMidiToTonality(m.note, k, t) === m.note) { // 在选定音阶内(= 3×5 词汇)→ 1:1 原音高发声 + 记录
          void auditionNoteOn(m.note, LEAD_PROGRAM_BY_STYLE[st], m.velocity); // ★ 先发声(最低延迟,不让 React 状态更新挡在前面)
          if (recorder.current.isActive()) recorder.current.noteOn(m.note, m.velocity);
          noteOnVis(m.note);            // 点亮对应 pad(重面板已 memo → 不连带重渲染)
          setLastNote(`note ${m.note} · vel ${m.velocity}`);
        } else {
          setLastNote(`note ${m.note} · 离调 → 静音`);
        }
      } else if (m.type === 'noteOff') {
        auditionNoteOff(m.note);
        noteOffVis(m.note);
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
      gridRef.current = { g, ctx };
      const { motif, timing: tm, snapChanges: sc } = analyzeHiddenGridMotif(g, ctx); // 默认切头对齐(allowPickup=false)
      setHiddenMotif(motif); setTiming(tm); setSnapChanges(sc);
      setAnalysis({ motif, rawCount: cap.length, normalizedCount: motif.notes.length });
      setRecordPhase('ready');
      setStatus(`隐形时钟:${tm.captureBars}bar @ BPM ${tm.bpm} · ${motif.notes.length}音 · 量化误差 ${tm.quantizeErrorMean.toFixed(2)}拍 · 吸附改 ${sc}`);
    } catch (err) { setRecordPhase('idle'); setStatus(err instanceof MotifAnalysisError ? err.message : '分析失败'); }
  }, [clearRecTimers]);

  const startHiddenGridRecord = useCallback(async () => {
    stopPlayback(); clearRecTimers();
    const { keyPc: k, tonality: t, seed: s } = liveCfg.current;
    const ctx = createHiddenGridContext({ seed: s, keyPc: k, scaleMode: tonalityParentMode(t), tonality: t, style, startMs: 0, countInBars: 1, desiredBars: 4 });
    ctxRef.current = ctx;
    setBpm(ctx.bpm);
    setHiddenMotif(null); setTiming(null); setResult(null); setCaptured([]); setAnalysis(null); setAlignFirst(true); // 新录默认切头对齐
    setRecording(true); setRecordPhase('count-in'); setElapsed(0);
    setStatus(`◔ 数拍预备(1 小节 · BPM ${ctx.bpm})…暖音频中`);
    // ★ 先把音频时钟暖起来:否则首拍 click 因 AudioContext 启动晚响 → 用户跟着晚弹 → 整段偏后。
    await ensureAudio();
    recorder.current.start({ maxMs: ctx.captureEndMs + 300 }); // 录音起点 = 暖好这一刻 = click-0 同源
    setStatus(`◔ 数拍(BPM ${ctx.bpm})…听完 4 下开始弹`);
    const mpb = msPerBeat(ctx);
    const countInBeats = ctx.countInBars * ctx.beatsPerBar;
    void playClick(true); // 第 0 拍立即响(已暖,无启动延迟),与 recorder.start 同源
    for (let b = 1; b < countInBeats; b++) {
      recTimers.current.push(window.setTimeout(() => { void playClick(false); }, b * mpb));
    }
    recTimers.current.push(window.setTimeout(() => { setRecordPhase('recording'); setStatus(`● 演奏中…(自由弹,最多 ${ctx.captureBars} 小节;可点 ■ 早停)`); }, ctx.captureStartMs));
    recTimers.current.push(window.setTimeout(() => finishHiddenGridRecord(), ctx.captureEndMs + 80));
    timer.current = window.setInterval(() => setElapsed(recorder.current.elapsedMs()), 80);
  }, [style, stopPlayback, clearRecTimers, finishHiddenGridRecord]);

  // —— 3×5 键盘:按下=试听(+录音器活跃时记音,数拍期会被滤掉),松开=停音 ——
  const handlePadDown = useCallback((_idx: number, midi: number) => {
    void auditionNoteOn(midi, LEAD_PROGRAM_BY_STYLE[style], 110);
    noteOnVis(midi);
    if (recorder.current.isActive()) recorder.current.noteOn(midi, 110);
  }, [style, noteOnVis]);
  const handlePadUp = useCallback((_idx: number, midi: number) => {
    auditionNoteOff(midi);
    noteOffVis(midi);
    if (recorder.current.isActive()) recorder.current.noteOff(midi);
  }, [noteOffVis]);

  // 卸载清理(含还原压缩母带 → 离开 Q+R 后全局音频不残留软削波)
  useEffect(() => () => { if (timer.current != null) clearInterval(timer.current); recTimers.current.forEach((t) => clearTimeout(t)); access.current?.dispose(); setSandboxAuditionMaster(false); }, []);

  // 注入示例 motif:隐形时钟模式 → 平移进捕获窗走 hidden 分析;free 模式 → 老路径
  const injectSample = useCallback(() => {
    stopPlayback();
    const { keyPc: k, tonality: t, seed: s } = liveCfg.current;
    if (captureMode === 'hiddenGrid') {
      const ctx = createHiddenGridContext({ seed: s, keyPc: k, scaleMode: tonalityParentMode(t), tonality: t, style, startMs: 0, countInBars: 1, desiredBars: 4 });
      ctxRef.current = ctx; setBpm(ctx.bpm); setResult(null); setAlignFirst(true);
      const raw = generateSampleCaptured(ctx.bpm, k, tonalityParentMode(t), (s % 4 + 4) % 4).map((n) => ({ ...n, onsetMs: n.onsetMs + ctx.captureStartMs }));
      try {
        const g = capturedToGridNotes(raw, ctx);
        gridRef.current = { g, ctx };
        const { motif, timing: tm, snapChanges: sc } = analyzeHiddenGridMotif(g, ctx);
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

  // pickup 开关:重跑分析(切头 vs 保留前导休止);motif 由数据层产出,不在 generate() 再对齐。
  const togglePickup = useCallback(() => {
    setAlignFirst((prev) => {
      const nextAlign = !prev;
      const last = gridRef.current;
      if (last) {
        try {
          const { motif, timing: tm, snapChanges: sc } = analyzeHiddenGridMotif(last.g, last.ctx, { allowPickup: !nextAlign });
          setHiddenMotif(motif); setTiming(tm); setSnapChanges(sc);
          setAnalysis((a0) => (a0 ? { ...a0, motif, normalizedCount: motif.notes.length } : a0));
        } catch { /* 保留旧分析 */ }
      }
      return nextAlign;
    });
  }, []);

  const generate = useCallback(() => {
    const motif = captureMode === 'hiddenGrid' ? hiddenMotif : null; // 数据层已切头对齐(allowPickup 控制)
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
    const pbpm = result.playbackBpm; // ★ 永远用捕获时钟,不用 UI bpm state(录后改 bpm / state 时序差都不影响)
    const accomp = withAccomp ? buildAccompaniment(result.progression, style, seed, result.lead) : null; // 传 lead → 伴奏锁旋律重音/结构点
    const ir = buildSandboxIr(result.lead, accomp, pbpm, style);
    setPlaying(true);
    setStatus(withAccomp ? `▶ 播放 lead + 伴奏(BPM ${pbpm})…` : `▶ 播放 lead(BPM ${pbpm})…`);
    try { await playMusicalIR(ir, pbpm, style); } catch { /* 静默 */ }
  }, [result, style, seed, withAccomp]);

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
            <button type="button" onClick={() => setAudioLat(getAudioLatencyMs())} className="ml-auto rounded px-1.5 py-0.5 text-[10px] border bg-zinc-800 border-zinc-700 text-zinc-400">测延迟</button>
          </div>
        )}
        {audioLat && (
          <div className="mt-1 text-[10px]">
            <span className={audioLat.total > 60 ? 'text-rose-300' : audioLat.total > 30 ? 'text-amber-300' : 'text-emerald-300'}>
              音频延迟 ≈ {audioLat.total.toFixed(1)}ms(worklet {audioLat.base.toFixed(1)} + 输出 {audioLat.output.toFixed(1)})· {audioLat.sampleRate}Hz · {audioLat.state}
            </span>
            {audioLat.output > 40 && <span className="text-rose-300"> ← 输出缓冲大(蓝牙/驱动?)= 系统级,代码改不动;换有线设备</span>}
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
        <PadKeyboard noteMap={scaleNoteMap(keyPc, tonality)} recording={recording} activeNotes={activeNotes} onPadDown={handlePadDown} onPadUp={handlePadUp} />
        <div className="text-[10px] text-zinc-600">{captureMode === 'hiddenGrid' ? '点 pad/弹 MIDI 试听;数拍后演奏 → 对着隐形时钟落格(不猜 BPM)。' : 'free 回退:停止后据 bpm 自动识别整 bar(时序置信较低)。'}底行低音 → 顶行高音。</div>
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

      {/* Analysis readout —— 独立 memo:MIDI 试听的 activeNotes/lastNote 变化不重渲染这块重面板 = 降输入延迟 */}
      {a && <AnalysisReadout a={a} timing={timing} snapChanges={snapChanges} result={result} style={style} tonality={tonality} alignFirst={alignFirst} onTogglePickup={togglePickup} />}
    </motion.div>
  );
};

interface AnalysisReadoutProps {
  a: AnalyzeResult; timing: MotifTimingAnalysis | null; snapChanges: number;
  result: MotifWeaverResult | null; style: SandboxStyle; tonality: SandboxTonality;
  alignFirst: boolean; onTogglePickup: () => void;
}
const AnalysisReadout: React.FC<AnalysisReadoutProps> = React.memo(({ a, timing, snapChanges, result, style, tonality, alignFirst, onTogglePickup }) => {
  const togglePickup = onTogglePickup;
  return (
        <div className="px-3 py-2 space-y-1 text-[11px]">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500">Analysis{timing ? ' · 隐形时钟' : ''}</div>
          {timing && <>
            <Row k="BPM / 捕获" v={`${timing.bpm} · ${timing.captureBars}bar · 数拍${1}小节`} />
            <Row k="量化误差 / 相位" v={`均 ${timing.quantizeErrorMean.toFixed(3)} · 最大 ${timing.quantizeErrorMax.toFixed(3)} 拍 · 相位置信 ${timing.phaseConfidence.toFixed(1)}`} good={timing.quantizeErrorMax < 0.15} />
            <div className="flex items-baseline gap-2">
              <span className="text-zinc-500 w-[120px] shrink-0">晚进 / 吸附改</span>
              <span className={snapChanges === 0 ? 'text-emerald-300' : 'text-rose-300'}>{timing.leadingRestBeats.toFixed(2)} 拍 · {snapChanges} 音 {timing.aligned ? '· 首音已对齐 beat0' : '· 保留前导休止'}</span>
              <button type="button" onClick={togglePickup} className={`ml-auto rounded px-1.5 py-0.5 text-[10px] border ${alignFirst ? 'bg-sky-600/30 border-sky-500/50 text-sky-200' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>
                对齐首音 {alignFirst ? 'on' : 'off'}
              </button>
            </div>
          </>}
          <Row k="motif 长度" v={`${a.motif.lengthBeats} beats · ${a.motif.notes.length} 音(raw ${a.rawCount})`} />
          <Row k="contour" v={a.motif.contour.map((c) => (c > 0 ? '↑' : c < 0 ? '↓' : '→')).join('')} />
          <Row k="rhythm cell" v={a.motif.rhythmCell.map((d) => d.toFixed(2)).join(' ')} />
          {result && <>
            {result.brick && <Row k="旋律 brick(功能)" v={`${result.brick.primaryFunction} · ${result.brick.evidence.slice(0, 2).join('; ')}`} />}
            {result.brick && <Row k="结构音 / 总音" v={`${result.brick.structuralTones.length} / ${result.brick.allTones.length} · ${result.brick.structuralTones.slice(0, 4).map((t) => `${t.midi}@${t.onsetBeat.toFixed(1)}`).join(' ')}`} good={result.brick.structuralTones.length >= 1} />}
            <Row k="和声来源" v={result.harmonySource === 'template' ? `模板选择 ✓` : `兜底 buildProgression ⚠ ${result.harmonyError ?? ''}`} good={result.harmonySource === 'template'} />
            {result.selectedProgression && <Row k="选中进行模板" v={`${result.selectedProgression.prototypeId} · cad=${result.selectedProgression.cadence} · 分 ${result.selectedProgression.score.toFixed(1)}`} good />}
            {result.selectedProgression && <Row k="候选 top" v={result.selectedProgression.topCandidates.slice(0, 3).map((c) => `${c.prototypeId.replace(/^(pop|lofi|rnb|jazz)_/, '')}:${c.score.toFixed(1)}`).join('  ')} />}
            <Row k="和弦进行(真 roman)" v={(() => { const seen = new Set<number>(); return result.progression.filter((c) => !seen.has(c.startBeat) && seen.add(c.startBeat)).map((c) => c.realRoman ?? c.roman).join('-'); })()} />
            {result.roadmap?.harmonicBricks && result.roadmap.harmonicBricks.length > 0 && <Row k="RoadMap bricks" v={result.roadmap.harmonicBricks.map((b) => b.name).join(' · ')} />}
            {result.roadmap && (() => {
              const bs = result.roadmap.brickSlots;
              const counts = new Map<string, number>(); bs.forEach((s) => counts.set(s.recurrenceKey, (counts.get(s.recurrenceKey) ?? 0) + 1));
              const recur = [...counts.values()].filter((v) => v >= 2).length;
              return <Row k="brick slots(复现)" v={`${bs.length} 槽 · ${counts.size} 异 · ${recur} 复现键${result.roadmap.brickSlotsFromFallback ? ' · ⚠兜底逐和弦' : ''} · ${bs.slice(0, 6).map((s) => `${s.startBeat.toFixed(0)}:${s.type}`).join(' ')}`} good={!result.roadmap.brickSlotsFromFallback && recur >= 1} />;
            })()}
            {result.roadmap?.roadmapError && <Row k="RoadMap 解析失败" v={result.roadmap.roadmapError} good={false} />}
            {result.melodicSlotPlan && <Row k="旋律 slot 计划" v={`${result.melodicSlotPlan.slots.length} 槽 · quote ${result.melodicSlotPlan.userQuoteSlotIds.length} · dev/ref ${result.melodicSlotPlan.userDevelopSlotIds.length}${result.melodicSlotPlan.warnings.length ? ' · ⚠' + result.melodicSlotPlan.warnings[0] : ''}`} good={result.melodicSlotPlan.userQuoteSlotIds.length >= 1} />}
            {result.melodicSlotPlan && <div className="text-[10px] text-zinc-400 leading-snug break-words">{result.melodicSlotPlan.slots.slice(0, 6).map((s) => <span key={s.id} className={s.userMotifPolicy === 'mustQuote' ? 'text-fuchsia-300' : s.userMotifPolicy === 'mustDevelop' ? 'text-cyan-300' : s.userMotifPolicy === 'mayReference' ? 'text-sky-300' : 'text-zinc-500'}>{s.startBeat.toFixed(0)}:{s.requiredFunction}/{s.userMotifPolicy.replace('must', '').replace('Only', '')} </span>)}</div>}
            <Row k="motif / quote 单元" v={`${result.motifBars} bar → quote ${result.quoteBars} bar${result.quoteBars < result.motifBars ? '(缩子动机留发展空间)' : ''}`} />
            <Row k="发展弧(每槽)" v={result.arc.join(' · ')} />
            <Row k="head 原样(quote 单元)" v={result.audit.motifQuotedFirstCycle ? '✓' : '✗'} good={result.audit.motifQuotedFirstCycle} />
            <Row k="陈述 / 发展手法 / 连接" v={`${result.audit.themeStatements} · ${result.audit.developVariants} 种 · ${result.audit.connectSlots}`} good={result.audit.developVariants >= 2} />
            <Row k="密度 / 留白" v={`${result.audit.notesPerBar.toFixed(1)} 音·bar / 留白 ${(result.audit.restRatio * 100).toFixed(0)}%`} good={result.audit.restRatio > 0.1} />
            <Row k="离调(全 / 不证成)" v={`${result.audit.chromaticRatio.toFixed(2)} / 不证成 ${result.audit.unjustifiedChromatic}`} good={result.audit.unjustifiedChromatic === 0 || style === 'jazz' || tonality === 'blues'} />
            <Row k="maxLeap / jazziness" v={`${result.audit.maxLeap} 半音 · ${result.audit.jazzinessScore.toFixed(2)}`} good={result.audit.jazzinessScore < 0.35 || style === 'jazz'} />
            <div className="text-[10px] text-zinc-500 pt-1">前 16 音(fuchsia=原样陈述 · cyan=变形发展 · 灰=连接留白):</div>
            <div className="text-[10px] text-zinc-400 leading-snug break-words">
              {result.lead.slice(0, 16).map((n, i) => <span key={i} className={n.occurrenceKind === 'quote' ? 'text-fuchsia-300' : n.occurrenceKind === 'develop' ? 'text-cyan-300' : 'text-zinc-500'}>{n.midi}@{n.onsetBeat.toFixed(1)} </span>)}
            </div>
          </>}
        </div>
  );
});
AnalysisReadout.displayName = 'AnalysisReadout';

const Row: React.FC<{ k: string; v: string; good?: boolean }> = ({ k, v, good }) => (
  <div className="flex items-baseline gap-2">
    <span className="text-zinc-500 w-[120px] shrink-0">{k}</span>
    <span className={good === undefined ? 'text-zinc-300' : good ? 'text-emerald-300' : 'text-rose-300'}>{v}</span>
  </div>
);
