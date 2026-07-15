// ============================================================
// motifSandbox · ui · Q+R Motif 续写沙盒面板
// ------------------------------------------------------------
// 录(MIDI,后接)/ 注入示例 motif → 分析归一化 → motif/brick 续写 → Q+N 正式播放。
// 播放共享 globalMidiScheduler(与新引擎面板互斥,先 stop 再 play)。
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { Piano, X } from 'lucide-react';
import { useDevPanelChannel } from '../../../../components/devPanels';
import { analyzeAndNormalize, analyzeHiddenGridMotif, generateSampleCaptured, fitRecordingToBars, MotifAnalysisError, type AnalyzeResult, type MotifTimingAnalysis } from '../model/motifAnalysis';
import { LEAD_PROGRAM_BY_STYLE, MIDI_INPUT_PROGRAM } from '../model/leadOnlyIr';
import { buildUserMotifBrickSongOverride } from '../bridge/sandboxToOverride';
// ★ Q+N 主链路(qn_main_engine_takeover §10):播放走 service + AudioEngine.playMusicGeneration;
//   pad/MIDI 单音录入反馈仍留 sandbox audition。
import { generateMotifMusic } from '../../musicGeneration/MusicGenerationService';
import { musicalIRToSMF } from '../../newEngine/sandbox/midiFile';
import type { MusicGenerationResult } from '../../musicGeneration/types';
import { AudioEngine } from '../../../audio/AudioEngine';
import { MUSIC_GEN_STYLE_OPTIONS, MusicGenerationStyleStore, musicGenStyleLabel, type MusicGenStyle } from '../../../../state/MusicGenerationStyleStore';
import { MusicGenerationSeedStore } from '../../../../state/MusicGenerationSeedStore';
import { SANDBOX_TONALITIES, TONALITY_LABEL, tonalityParentMode, scaleNoteMap, snapMidiToTonality, isBluesTonality, type SandboxTonality } from '../model/sandboxScales';
import { createHiddenGridContext, capturedToGridNotes, msPerBeat, type HiddenGridCaptureContext, type GridCapturedNote } from '../capture/hiddenGridClock';
import type { CapturedMidiNote, MotifWeaverResult, SandboxStyle, UserMotif, HealingMode } from '../model/types';
import { auditionNoteOn, auditionNoteOff, auditionControlChange, playClick, playCue, ensureAudio, getAudioLatencyMs, setSandboxAuditionMaster } from '../../newEngine/sandbox/audioOut';
import { requestMidiAccess, type MidiAccessHandle, type MidiDeviceInfo, type MidiSupport, type ParsedMidiMessage } from '../midi/webMidi';
import { MidiMotifRecorder } from '../capture/MidiMotifRecorder';
import { PadKeyboard } from './PadKeyboard';

type RecordPhase = 'idle' | 'count-in' | 'recording' | 'analyzing' | 'ready';

const STYLES: SandboxStyle[] = MUSIC_GEN_STYLE_OPTIONS.map((s) => s.toLowerCase() as SandboxStyle);
const isSandboxStyle = (style: string): style is SandboxStyle => (STYLES as readonly string[]).includes(style);
const qnStyleToSandbox = (style: string): SandboxStyle => {
  const candidate = style.toLowerCase();
  return isSandboxStyle(candidate) ? candidate : STYLES[0];
};
const sandboxToQnStyle = (style: SandboxStyle): MusicGenStyle => style.toUpperCase() as MusicGenStyle;
const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const HIDDEN_GRID_MAX_MS = 60000; // 持续录音安全上限(节拍器不停;录到手动 ■ 停,超 60s 自动收尾)
const FREE_FALLBACK_CAPTURE_BPM = 96; // 内部 raw-ms→beat 参考值;不暴露为用户生成参数。
const currentQhSeed = (): number => MusicGenerationSeedStore.getSeedNumber();

export const MotifWeaverSandboxPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<SandboxStyle>(() => qnStyleToSandbox(MusicGenerationStyleStore.getStyleHint()));
  const [keyPc, setKeyPc] = useState(0);
  const [tonality, setTonality] = useState<SandboxTonality>('major');
  const [motifSeed, setMotifSeed] = useState<number | null>(null);
  const [healingMode, setHealingMode] = useState<HealingMode>('beginner'); // 新手修饰(默认开;高级用户可关)
  const [captured, setCaptured] = useState<CapturedMidiNote[]>([]);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [result, setResult] = useState<MotifWeaverResult | null>(null);
  const [generatedSong, setGeneratedSong] = useState<MusicGenerationResult | null>(null);
  const [generating, setGenerating] = useState(false);
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
  const liveCfg = useRef({ keyPc, tonality, style, healingMode });
  liveCfg.current = { keyPc, tonality, style, healingMode };

  useDevPanelChannel('motif', open, setOpen);

  useEffect(() => {
    if (!open) return;
    const synced = qnStyleToSandbox(MusicGenerationStyleStore.getStyleHint());
    if (style === synced) return;
    setStyle(synced);
    setResult(null);
    setGeneratedSong(null);
  }, [open, style]);

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

  const stopPlayback = useCallback(() => { AudioEngine.stop(); setPlaying(false); }, []);

  // 录到/注入 raw → 用内部捕获参考值识别整 bar → 走完整 analyze(不绕过 analyzer)。
  const applyCaptured = useCallback((cap: CapturedMidiNote[], label: string) => {
    setCaptured(cap);
    setResult(null);
    setGeneratedSong(null);
    if (cap.length === 0) { setAnalysis(null); setStatus('未录到音符'); return; }
    const { keyPc: k, tonality: t } = liveCfg.current;
    const s = currentQhSeed();
    setMotifSeed(s);
    const b = FREE_FALLBACK_CAPTURE_BPM;
    const fit = fitRecordingToBars(cap, b);
    try {
      const a = analyzeAndNormalize(cap, k, tonalityParentMode(t), fit.adjustedBpm, s, t, liveCfg.current.healingMode); // 吸到选定音阶(保 blues/五声特征)+ 新手治愈
      setAnalysis(a);
      setStatus(`${label}:识别 ${fit.targetBars} bar(${fit.rawBars.toFixed(2)})· capture ${fit.adjustedBpm}BPM · raw ${a.rawCount}→norm ${a.normalizedCount}`);
    } catch (err) { setAnalysis(null); setStatus(err instanceof MotifAnalysisError ? err.message : '分析失败'); }
  }, []);

  // —— Web MIDI 接入 ——
  const enableMidi = useCallback(async () => {
    await ensureAudio(); // 点击是手势 → 解锁 AudioContext,之后 MIDI 输入即时发声
    setAudioLat(getAudioLatencyMs()); // 诊断:audio 系统延迟(base=worklet / output=OS 缓冲含蓝牙)
    const onMessage = (m: ParsedMidiMessage) => {
      if (m.type === 'noteOn') {
        const { keyPc: k, tonality: t } = liveCfg.current;
        if (snapMidiToTonality(m.note, k, t) === m.note) { // 在选定音阶内(= 3×5 词汇)→ 1:1 原音高发声 + 记录
          void auditionNoteOn(m.note, MIDI_INPUT_PROGRAM, m.velocity); // ★ MIDI 录入默认音色 = 大钢琴(随踏板延音);先发声=最低延迟
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
      } else if (m.type === 'controlChange') {
        auditionControlChange(m.note, m.velocity); // 踏板 CC64 等 → 大钢琴随延音踏板(m.note=controller,m.velocity=value)
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
    applyCaptured(notes, '录制'); // 据长度识别整 bar;BPM 仅为内部捕获换算元数据
  }, [applyCaptured]);

  const startRecord = useCallback(() => {
    stopPlayback();
    recorder.current.start(); // 手动起止,不固定秒数(30s 安全上限)。MIDI 或 3×5 键盘都可录
    setRecording(true); setElapsed(0); setCaptured([]); setResult(null); setGeneratedSong(null); setMotifSeed(currentQhSeed());
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
      const { motif, timing: tm, snapChanges: sc } = analyzeHiddenGridMotif(g, ctx, { healingMode: liveCfg.current.healingMode }); // 默认切头对齐(allowPickup=false)+ 新手治愈
      setHiddenMotif(motif); setTiming(tm); setSnapChanges(sc);
      setAnalysis({ motif, rawCount: cap.length, normalizedCount: motif.notes.length });
      setRecordPhase('ready');
      setStatus(`隐形时钟:${tm.captureBars}bar @ BPM ${tm.bpm} · ${motif.notes.length}音 · 量化误差 ${tm.quantizeErrorMean.toFixed(2)}拍 · 吸附改 ${sc}`);
    } catch (err) { setRecordPhase('idle'); setStatus(err instanceof MotifAnalysisError ? err.message : '分析失败'); }
  }, [clearRecTimers]);

  const startHiddenGridRecord = useCallback(async () => {
    stopPlayback(); clearRecTimers();
    const { keyPc: k, tonality: t } = liveCfg.current;
    const s = currentQhSeed();
    setMotifSeed(s);
    const ctx = createHiddenGridContext({ seed: s, keyPc: k, scaleMode: tonalityParentMode(t), tonality: t, style, startMs: 0, countInBars: 1, desiredBars: 4 });
    ctxRef.current = ctx;
    setHiddenMotif(null); setTiming(null); setResult(null); setGeneratedSong(null); setCaptured([]); setAnalysis(null); setAlignFirst(true); // 新录默认切头对齐
    setRecording(true); setRecordPhase('count-in'); setElapsed(0);
    setStatus(`◔ 数拍预备(1 小节 · BPM ${ctx.bpm})…暖音频中`);
    // ★ 先把音频时钟暖起来:否则首拍 click 因 AudioContext 启动晚响 → 用户跟着晚弹 → 整段偏后。
    await ensureAudio();
    // ★ 持续录音(用户:节拍器不停 → 改持续记录):录到【手动 ■ 停】;HIDDEN_GRID_MAX_MS 安全上限兜底。
    recorder.current.start({ maxMs: HIDDEN_GRID_MAX_MS });
    setStatus(`◔ 数拍(BPM ${ctx.bpm})…第 4 下后进;抢早 1 拍内会保留`);
    const mpb = msPerBeat(ctx);
    const beatsPerBar = ctx.beatsPerBar;
    // ★ 连续节拍器(数拍 + 演奏全程不停):drift-corrected 调度 —— 每拍按【绝对目标 beat×mpb(相对 record start)】
    //   重算延迟,不累积漂移 → click 永远锁在隐形网格上(用户跟着弹不偏)。下拍重音,其余轻;停止/上限时自然结束。
    void playClick(true); // 第 0 拍(数拍 beat0)立即响,与 recorder.start 同源
    const scheduleBeat = (beatIndex: number): void => {
      const delay = Math.max(0, beatIndex * mpb - recorder.current.elapsedMs());
      recTimers.current.push(window.setTimeout(() => {
        if (!recorder.current.isActive()) return;          // 已停/到上限 → 不再响
        void playClick(beatIndex % beatsPerBar === 0);      // 下拍重音
        scheduleBeat(beatIndex + 1);
      }, delay));
    };
    scheduleBeat(1); // beat0 已立即响,从 beat1 起滚动调度(到停止前一直响)
    // 数拍结束 → 进演奏(★ 不再自动停;用户点 ■ 停)
    recTimers.current.push(window.setTimeout(() => { setRecordPhase('recording'); setStatus(`● 演奏中…(节拍器持续;motif 取前 ${ctx.captureBars} 小节;弹完点 ■ 停)`); }, ctx.captureStartMs));
    // 过了 4 小节捕获窗:★ 给个【三角铁提示音】(区别于 wood block click)标边界 + 节拍器继续响、可继续弹(但 motif 只取这前 4 小节)
    recTimers.current.push(window.setTimeout(() => {
      if (!recorder.current.isActive()) return; // 已手动停 → 不响
      void playCue();
      setRecordPhase('recording');
      setStatus(`● 已满 ${ctx.captureBars} 小节(motif 取这前 ${ctx.captureBars} 小节);节拍器继续,弹完点 ■ 停`);
    }, ctx.captureEndMs));
    timer.current = window.setInterval(() => {
      setElapsed(recorder.current.elapsedMs());
      if (!recorder.current.isActive()) finishHiddenGridRecord(); // 到安全上限 → 自动收尾分析
    }, 80);
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
    const { keyPc: k, tonality: t } = liveCfg.current;
    const s = currentQhSeed();
    setMotifSeed(s);
    if (captureMode === 'hiddenGrid') {
      const ctx = createHiddenGridContext({ seed: s, keyPc: k, scaleMode: tonalityParentMode(t), tonality: t, style, startMs: 0, countInBars: 1, desiredBars: 4 });
      ctxRef.current = ctx; setResult(null); setGeneratedSong(null); setAlignFirst(true);
      const raw = generateSampleCaptured(ctx.bpm, k, tonalityParentMode(t), (s % 4 + 4) % 4).map((n) => ({ ...n, onsetMs: n.onsetMs + ctx.captureStartMs }));
      try {
        const g = capturedToGridNotes(raw, ctx);
        gridRef.current = { g, ctx };
        const { motif, timing: tm, snapChanges: sc } = analyzeHiddenGridMotif(g, ctx, { healingMode: liveCfg.current.healingMode });
        setHiddenMotif(motif); setTiming(tm); setSnapChanges(sc); setCaptured([]);
        setAnalysis({ motif, rawCount: raw.length, normalizedCount: motif.notes.length });
        setRecordPhase('ready');
        setStatus(`注入(隐形时钟):${tm.captureBars}bar @ BPM ${tm.bpm} · ${motif.notes.length}音`);
      } catch (err) { setStatus(err instanceof MotifAnalysisError ? err.message : '分析失败'); }
    } else {
      setHiddenMotif(null);
      applyCaptured(generateSampleCaptured(FREE_FALLBACK_CAPTURE_BPM, k, tonalityParentMode(t), (s % 4 + 4) % 4), '注入示例');
    }
  }, [captureMode, style, applyCaptured, stopPlayback]);

  // pickup 开关:重跑分析(切头 vs 保留前导休止);motif 由数据层产出,不在 generate() 再对齐。
  const togglePickup = useCallback(() => {
    setAlignFirst((prev) => {
      const nextAlign = !prev;
      const last = gridRef.current;
      if (last) {
        try {
          const { motif, timing: tm, snapChanges: sc } = analyzeHiddenGridMotif(last.g, last.ctx, { allowPickup: !nextAlign, healingMode: liveCfg.current.healingMode });
          setHiddenMotif(motif); setTiming(tm); setSnapChanges(sc);
          setAnalysis((a0) => (a0 ? { ...a0, motif, normalizedCount: motif.notes.length } : a0));
        } catch { /* 保留旧分析 */ }
      }
      return nextAlign;
    });
  }, []);

  // 新手修饰开关:切换 beginner/off,并对已录入的 grid motif 立即重分析(补短断点/护同音断奏)。
  const toggleHealing = useCallback(() => {
    setHealingMode((prev) => {
      const next: HealingMode = prev === 'beginner' ? 'off' : 'beginner';
      const last = gridRef.current;
      if (last) {
        try {
          const { motif, timing: tm, snapChanges: sc } = analyzeHiddenGridMotif(last.g, last.ctx, { allowPickup: !alignFirst, healingMode: next });
          setHiddenMotif(motif); setTiming(tm); setSnapChanges(sc);
          setAnalysis((a0) => (a0 ? { ...a0, motif, normalizedCount: motif.notes.length } : a0));
        } catch { /* 保留旧分析 */ }
      }
      return next;
    });
  }, [alignFirst]);

  const generate = useCallback(async () => {
    const motif = captureMode === 'hiddenGrid' ? hiddenMotif : analysis?.motif ?? null; // 数据层已切头对齐(allowPickup 控制)
    if (!motif) { setStatus('先录入/注入 motif'); return; }
    stopPlayback();
    setResult(null);
    setGeneratedSong(null);
    setGenerating(true);
    try {
      const s = motifSeed ?? currentQhSeed();
      if (motifSeed == null) setMotifSeed(s);
      setAnalysis((prev) => prev ?? { motif, rawCount: captured.length, normalizedCount: motif.notes.length });
      const mode = tonalityParentMode(tonality);
      const override = buildUserMotifBrickSongOverride(motif, { style, seed: s, keyPc, mode, inputTonality: tonality });
      const quoteBars = ((override.userBrick?.quoteBeats ?? motif.lengthBeats) / 4).toFixed(1).replace(/\.0$/, '');
      setStatus(`Q+N 生成中 · motif→brick quote ${quoteBars} bar…`);
      const song = await generateMotifMusic({
        seed: s,
        styleHint: style,
        mood: 'build',
        targetDuration: 96,
      }, override);
      if (song.status === 'failed' || !song.ir) { setStatus('Q+N 生成失败(audit)'); return; }
      setGeneratedSong(song);
      const roles = song.ir.tracks.map((t) => t.role).join('+');
      setStatus(`生成完成 · Q+N ${roles} · BPM ${song.bpm} · motif brick ${quoteBars} bar`);
    } catch (err) { setStatus(err instanceof MotifAnalysisError ? err.message : err instanceof Error ? `生成失败:${err.message}` : '生成失败'); }
    finally { setGenerating(false); }
  }, [captureMode, hiddenMotif, analysis, captured.length, style, keyPc, tonality, motifSeed, stopPlayback]);

  // ⬇ MIDI:下载 generate 阶段产出的这首（与播放同源 IR=同一首,不重生成）。
  const downloadMidi = useCallback(() => {
    if (!generatedSong?.ir) { setStatus('先生成'); return; }
    try {
      const smf = musicalIRToSMF(generatedSong.ir, generatedSong.bpm, generatedSong.styleHint ?? style);
      const blob = new Blob([smf as BlobPart], { type: 'audio/midi' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `motif-${generatedSong.styleHint ?? style}-seed${motifSeed ?? MusicGenerationSeedStore.getSeedNumber()}.mid`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('⬇ 已导出 .mid');
    } catch (err) { setStatus(err instanceof Error ? `导出失败:${err.message}` : '导出失败'); }
  }, [generatedSong, style, motifSeed]);

  // ★ 播放:只播放 generate 阶段产出的唯一 Q+N song,不再临时跑第二条 sandbox/override 声音链路。
  const play = useCallback(async () => {
    if (!generatedSong?.ir) { setStatus('先生成'); return; }
    AudioEngine.stop();
    try {
      const roles = generatedSong.ir.tracks.map((t) => t.role).join('+');
      setPlaying(true);
      setStatus(`▶ 播放(${generatedSong.status} · ${roles} · BPM ${generatedSong.bpm})…`);
      await AudioEngine.playMusicGeneration(generatedSong); // Q+N 正式播放
    } catch (err) { setStatus(err instanceof Error ? `播放出错:${err.message}` : '播放出错'); }
  }, [generatedSong]);

  if (!open) return null;

  const sel = 'bg-zinc-800 text-zinc-100 rounded px-1.5 py-0.5 text-[11px] border border-zinc-700';
  const a = analysis;
  const canGenerate = captureMode === 'hiddenGrid' ? Boolean(hiddenMotif) : Boolean(analysis?.motif);

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
        <div className="text-[10px] text-zinc-600">{captureMode === 'hiddenGrid' ? '点 pad/弹 MIDI 试听;数拍后演奏 → 对着隐形时钟落格(不猜 BPM)。' : 'free 回退:停止后按内部捕获时钟识别整 bar(时序置信较低)。'}底行低音 → 顶行高音。</div>
      </div>

      {/* Generate */}
      <div className="px-3 py-2 border-b border-zinc-900 space-y-1.5">
        <div className="text-[10px] uppercase tracking-widest text-zinc-500">Generate</div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <label>风格<select className={sel} value={style} onChange={(e) => {
            const next = e.target.value as SandboxStyle;
            setStyle(next);
            MusicGenerationStyleStore.setStyle(sandboxToQnStyle(next));
            setResult(null);
            setGeneratedSong(null);
          }}>{STYLES.map((s) => <option key={s} value={s}>{musicGenStyleLabel(s.toUpperCase() as MusicGenStyle)}</option>)}</select></label>
          <span className="text-zinc-500">{KEY_NAMES[keyPc]} {TONALITY_LABEL[tonality]} → 母调 {tonalityParentMode(tonality)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-zinc-500">seed 来自 Q+H{motifSeed == null ? '' : ` · ${motifSeed}`}</span>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          <button type="button" onClick={generate} disabled={generating || !canGenerate} className="rounded-lg bg-emerald-600/80 hover:bg-emerald-500 disabled:opacity-40 px-2.5 py-1 text-[12px] text-white">{generating ? '生成中…' : '生成'}</button>
          {!playing
            ? <button type="button" onClick={play} disabled={!generatedSong || generating} title="motif → user brick → Q+N 续写成曲" className="rounded-lg bg-violet-600/80 hover:bg-violet-500 disabled:opacity-40 px-2.5 py-1 text-[12px] text-white">▶ 播放</button>
            : <button type="button" onClick={stopPlayback} className="rounded-lg bg-rose-600/80 hover:bg-rose-500 px-2.5 py-1 text-[12px] text-white">■ 停止</button>}
          <button type="button" onClick={downloadMidi} disabled={!generatedSong?.ir} title="下载当前生成这首为 .mid（与播放同源 IR=同一首）" className="rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 px-2.5 py-1 text-[12px] text-zinc-300">⬇ MIDI</button>
          <button type="button" onClick={toggleHealing} title="新手修饰:补意外短断点 + 护同音断奏(Phase 2 软化重复刺耳摩擦);高级用户可关" className={`rounded-lg px-2 py-1 text-[11px] border ${healingMode === 'beginner' ? 'bg-emerald-600/30 border-emerald-500/50 text-emerald-200' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>修饰 {healingMode === 'beginner' ? 'on' : 'off'}</button>
          <span className="ml-auto text-[10px] text-zinc-500">pad=GM{LEAD_PROGRAM_BY_STYLE[style]}</span>
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
            <Row k="离调(全 / 不证成)" v={`${result.audit.chromaticRatio.toFixed(2)} / 不证成 ${result.audit.unjustifiedChromatic}`} good={result.audit.unjustifiedChromatic === 0 || style === 'jazz' || isBluesTonality(tonality)} />
            <Row k="maxLeap / jazziness" v={`${result.audit.maxLeap} 半音 · ${result.audit.jazzinessScore.toFixed(2)}`} good={result.audit.jazzinessScore < 0.35 || style === 'jazz'} />
            <Row k="合同(强不支持/弱/quote)" v={`${result.audit.structuralUnsupported} / ${result.audit.weakUnsupported} / ${result.audit.quoteStructuralUnsupported} · 通过 ${(result.audit.contractPassRatio * 100).toFixed(0)}%`} good={result.audit.structuralUnsupported === 0} />
            {isBluesTonality(tonality) && <Row k="布鲁斯(调味和弦/结构蓝音落地)" v={`${result.audit.bluesSeasonedChordCount} 和弦 · ${result.audit.blueColorStructuralSupported} 蓝音`} good={result.audit.bluesSeasonedChordCount > 0} />}
            <Row k="修饰(补连/断奏 · 摩擦修/护quote)" v={`补 ${result.audit.articulationGapsHealed} · 断奏 ${result.audit.intentionalRepeatStaccatoCount} · 摩擦修 ${result.audit.frictionPairsRepaired}/${result.audit.frictionPairsFlagged} · 护quote ${result.audit.protectedQuoteFrictionCount}`} good />
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
