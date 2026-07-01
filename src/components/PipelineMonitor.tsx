import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, useDragControls } from 'motion/react';
import { Activity, Play, Square, X, Dice5, Piano } from 'lucide-react';
import { AudioEngine, startAudioContext } from '../core/audio/AudioEngine';
import { PartName } from '../core/audio/playbackTypes';
import { globalMidiScheduler } from '../core/audio/MidiScheduler';
import { PRNGManager } from '../core/utils/PRNG';
// MelodyEngine 已删(2026-05-24)
import { runPipeline } from '../core/generation/pipeline';
import {
    GeneratedChord,
    SectionMetadata,
    TonalityName,
    Tonality,
    InstrumentRole,
    ChordQuality,
    CHORD_SCALE_NAME,
} from '../core/generation/types';
// ★ Q+N 接管:旧 MusicianRegistry / GMSoundMap / BandSelectionStore / StyleFlags 已不再被本组件使用(Band Selection 走 Q+N)。
import { MusicGenerationStyleStore, MUSIC_GEN_STYLE_OPTIONS, type MusicGenStyle } from '../state/MusicGenerationStyleStore';
import { MusicGenerationKeyStore, MUSIC_GEN_KEY_OPTIONS, type MusicGenKey } from '../state/MusicGenerationKeyStore';
import { MusicGenerationSeedStore, hashSeedToInt } from '../state/MusicGenerationSeedStore';
import type { MusicGenerationResult, QnRole, BandParticipantRole, BandParticipantState } from '../core/generation/musicGeneration/types';
import { QnBandSelectionStore, QN_PARTICIPANT_ORDER, QN_PARTICIPANT_LABEL } from '../state/QnBandSelectionStore';
import { useDevPanelChannel } from './devPanels';
import { traceGeneration, type TraceSection } from '../core/generation/newEngine/generation';
import type { GenerationRequest } from '../core/generation/newEngine/band/bandEngine';
import { pc } from '../core/generation/newEngine/foundation';
import { buildPianoRoll, type PianoRoll } from '../core/generation/newEngine/sandbox/pianoRoll';
import { PianoRollWindow } from '../core/generation/newEngine/sandbox/PianoRollWindow';
import { musicalIRToSMF } from '../core/generation/newEngine/sandbox/midiFile';
import { compareTraces, type TraceComparison } from '../core/generation/newEngine/sandbox/traceDiff';
import { deriveLineupConstraint } from '../core/generation/musicGeneration/participantConstraint';
import { keyToPc } from '../core/generation/musicGeneration/qnUiProjection';
import {
    QnGenerationMonitorView,
    deriveQnMonitorReadout,
    type QnMonitorReadout,
} from './QnGenerationMonitorView';

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// 数值枚举索引到显示后缀（数组下标 = ChordQuality 枚举值）
const QUALITY_SUFFIX: string[] = [];
QUALITY_SUFFIX[ChordQuality.Major] = '';
QUALITY_SUFFIX[ChordQuality.Minor] = 'm';
QUALITY_SUFFIX[ChordQuality.Diminished] = 'dim';
QUALITY_SUFFIX[ChordQuality.Diminished7] = 'dim7';
QUALITY_SUFFIX[ChordQuality.Augmented] = 'aug';
QUALITY_SUFFIX[ChordQuality.Dominant7] = '7';
QUALITY_SUFFIX[ChordQuality.Minor7] = 'm7';
QUALITY_SUFFIX[ChordQuality.Major7] = 'maj7';
QUALITY_SUFFIX[ChordQuality.HalfDiminished] = 'm7b5';
QUALITY_SUFFIX[ChordQuality.Sus4] = 'sus4';
QUALITY_SUFFIX[ChordQuality.Dominant7Sus4] = '7sus4';
QUALITY_SUFFIX[ChordQuality.Add9] = 'add9';
QUALITY_SUFFIX[ChordQuality.Minor9] = 'm9';
QUALITY_SUFFIX[ChordQuality.Major9] = 'maj9';
QUALITY_SUFFIX[ChordQuality.Dominant9] = '9';
QUALITY_SUFFIX[ChordQuality.Minor11] = 'm11';
QUALITY_SUFFIX[ChordQuality.Dominant13] = '13';

type PlayState = 'IDLE' | 'GENERATING' | 'PLAYING';

// InstrumentRole（管道侧）↔ PartName（音频侧）映射
const ROLE_TO_PART_NAME: Record<InstrumentRole, PartName> = {
    melody: 'melody',
    vocal: 'vocal',
    chord: 'chord',
    bass: 'bass',
    drums: 'drums',
    counter: 'counterMelody',
    secondary: 'secondaryMelody',
};

function chordToAbsoluteName(chord: GeneratedChord): string {
    const offset = chord.keyOffset ?? 0;
    const absRoot = ((chord.root + offset) % 12 + 12) % 12;
    return KEY_NAMES[absRoot] + (QUALITY_SUFFIX[chord.quality] ?? '');
}

/** 完整和声色彩名 — root + quality + extensions + bass override(如 Dadd9/F#)*/
function chordToFullName(chord: GeneratedChord): string {
    const offset = chord.keyOffset ?? 0;
    const absRoot = ((chord.root + offset) % 12 + 12) % 12;
    const ext = (chord.extensions ?? []).join('');
    const bass = chord.bassOverride !== undefined
        ? '/' + KEY_NAMES[(((chord.bassOverride + offset) % 12) + 12) % 12]
        : '';
    return KEY_NAMES[absRoot] + (QUALITY_SUFFIX[chord.quality] ?? '') + ext + bass;
}

/** Backbone 音名 — chord 骨干(root + 3 + 5 + 7 if present) */
function computeBackboneNames(chord: GeneratedChord): string[] {
    const offset = chord.keyOffset ?? 0;
    const absRoot = ((chord.root + offset) % 12 + 12) % 12;
    const q = chord.quality;
    const isMinor3 = q === ChordQuality.Minor || q === ChordQuality.Minor7
        || q === ChordQuality.Minor9 || q === ChordQuality.Minor11
        || q === ChordQuality.Diminished || q === ChordQuality.Diminished7
        || q === ChordQuality.HalfDiminished;
    const isDim5 = q === ChordQuality.Diminished || q === ChordQuality.Diminished7
        || q === ChordQuality.HalfDiminished;
    const isAug = q === ChordQuality.Augmented;
    const isSus = q === ChordQuality.Sus4 || q === ChordQuality.Dominant7Sus4;
    const third = isSus ? 5 : (isMinor3 ? 3 : 4);
    const fifth = isDim5 ? 6 : (isAug ? 8 : 7);
    let seventh: number | null = null;
    if (q === ChordQuality.Major7 || q === ChordQuality.Major9) seventh = 11;
    else if (q === ChordQuality.Dominant7 || q === ChordQuality.Dominant7Sus4
        || q === ChordQuality.Dominant9 || q === ChordQuality.Dominant13
        || q === ChordQuality.Minor7 || q === ChordQuality.Minor9
        || q === ChordQuality.Minor11 || q === ChordQuality.HalfDiminished) seventh = 10;
    else if (q === ChordQuality.Diminished7) seventh = 9;
    const pcs = [absRoot, (absRoot + third) % 12, (absRoot + fifth) % 12];
    if (seventh !== null) pcs.push((absRoot + seventh) % 12);
    return pcs.map(pc => KEY_NAMES[pc]!);
}

/** TSD 功能 — 从 roman 推 Tonic/Subdominant/Dominant */
function tsdFromRoman(roman: string): 'T' | 'S' | 'D' {
    if (!roman) return 'T';
    if (roman.includes('/')) return 'D';   // secondary dominant
    const stripped = roman.replace(/^[b#n]+/, '');
    const m = stripped.match(/^[IVivXx]+/);
    const base = m ? m[0].toUpperCase() : '';
    if (base === 'V' || base === 'VII') return 'D';
    if (base === 'IV' || base === 'II') return 'S';
    return 'T';   // I / III / VI / 等
}

/** TSD 颜色 tag */
const TSD_STYLE: Record<'T' | 'S' | 'D', string> = {
    T: 'text-emerald-300 bg-emerald-900/40 border-emerald-500/40',
    S: 'text-amber-300 bg-amber-900/40 border-amber-500/40',
    D: 'text-rose-300 bg-rose-900/40 border-rose-500/40',
};

function tonalityToHumanScale(tonality: Tonality | undefined): string {
    if (tonality === undefined) return '—';
    const raw = TonalityName[tonality] ?? 'Unknown';
    return raw.replace(/_/g, ' ');
}

function tonalityToShortMode(tonality: Tonality | undefined): string {
    if (tonality === undefined) return '';
    if (tonality === Tonality.Major || tonality === Tonality.Major_Pentatonic) return 'Major';
    return 'Minor';
}

/**
 * Phase 6.3.5 — Chord-Scale Theory UI 联动。
 *
 * 把当前激活和弦 + 全局 tonality 映射到"绝对根音名 + 局部音阶名"（如 "D Mixolydian"、
 * "A Dorian"）。chord === null（段落起拍前 / 段落末尾间隙）时回落到全局音阶名。
 *
 * Pitch Space: chord.root 是 RELATIVE PC，本函数把它过 keyOffset 转到 ABSOLUTE
 * 显示空间（与 chordToAbsoluteName 同套路），不破坏 K-2。
 */
function getLocalScaleName(
    chord: GeneratedChord | null,
    tonality: Tonality | undefined,
): string {
    if (chord === null) return tonalityToHumanScale(tonality);
    const offset = chord.keyOffset ?? 0;
    const absRoot = ((chord.root + offset) % 12 + 12) % 12;
    const rootName = KEY_NAMES[absRoot];
    const scaleName = CHORD_SCALE_NAME[chord.quality] ?? 'Ionian';
    return `${rootName} ${scaleName}`;
}

interface FrameSnapshot {
    musicGen: MusicGenerationResult | null; // ★ Q+N:UI 显示唯一真源(uiSnapshot)
    beat: number;
    seed: number;
}

// ★ Q+N 接管(qn_main_engine_takeover §8):旧 BandRole 槽位顺序 / BandSelection 类型 / DEFAULT_MUSICIAN_BY_ROLE
//   已删(Band Selection 改走 QnBandSelectionStore + QnBandPanel,见下)。

// ★ Band Selection 面板(qn_takeover_followup §3):选「参与乐手/职能」,**不选 GM 音色**。
//   每个乐手三态:自动(Q+N 默认)/ 参与(白名单)/ 禁用。具体音色由 Q+N 器配层按 style/seed 随机决定。
const PARTICIPANT_STATES: { value: BandParticipantState; label: string; cls: string }[] = [
    { value: 'auto', label: '自动', cls: 'text-zinc-400 border-zinc-700' },
    { value: 'selected', label: '参与', cls: 'text-fuchsia-300 border-fuchsia-500/60 bg-fuchsia-500/10' },
    { value: 'disabled', label: '禁用', cls: 'text-zinc-500 border-zinc-800 line-through' },
];
const QnBandPanel: React.FC<{
    states: Partial<Record<BandParticipantRole, BandParticipantState>>;
    onSet: (role: BandParticipantRole, state: BandParticipantState) => void;
}> = ({ states, onSet }) => (
    <div className="px-4 py-2 border-b border-zinc-800/60">
        <span className="text-[9px] uppercase tracking-widest text-fuchsia-400/80 font-bold">Band Selection · 参与乐手</span>
        <span className="ml-2 text-[8px] text-zinc-600">音色由器配层随机决定</span>
        <div className="mt-2 grid grid-cols-1 gap-1">
            {QN_PARTICIPANT_ORDER.map((role) => {
                const cur = states[role] ?? 'auto';
                return (
                    <div key={role} className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-mono text-zinc-400 w-16">{QN_PARTICIPANT_LABEL[role]}</span>
                        <div className="flex gap-1">
                            {PARTICIPANT_STATES.map((s) => (
                                <button
                                    key={s.value}
                                    onClick={() => onSet(role, s.value)}
                                    className={`px-2 py-0.5 rounded text-[9px] font-mono border transition-colors ${cur === s.value ? s.cls : 'text-zinc-600 border-zinc-800/60 hover:border-zinc-700'}`}
                                >
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    </div>
);

export const PipelineMonitor: React.FC = () => {
    const [isVisible, setIsVisible] = useState(true);
    // 左侧 DevDock 入口(点击切换 + 高亮同步);Q+H 键盘逻辑仍保留
    useDevPanelChannel('pipeline', isVisible, setIsVisible);
    const [frame, setFrame] = useState<FrameSnapshot>({
        musicGen: null, beat: 0, seed: 0,
    });
    const [seedInput, setSeedInput] = useState('42');
    const [currentSeed, setCurrentSeed] = useState<number | null>(null);
    const [musicStyle, setMusicStyleState] = useState<MusicGenStyle>(() => MusicGenerationStyleStore.getStyle());
    const switchMusicStyle = useCallback((next: MusicGenStyle) => {
        MusicGenerationStyleStore.setStyle(next);
        setMusicStyleState(next);
    }, []);
    const [musicKey, setMusicKeyState] = useState<MusicGenKey>(() => MusicGenerationKeyStore.getKey());
    const switchMusicKey = useCallback((next: MusicGenKey) => {
        MusicGenerationKeyStore.setKey(next);
        setMusicKeyState(next);
    }, []);
    const [playState, setPlayState] = useState<PlayState>('IDLE');
    const [mutedParts, setMutedParts] = useState<Set<PartName>>(new Set());
    // ★ Band Selection 参与乐手三态(QnBandSelectionStore;立即生效,下次 Play 用)。
    const [qnParticipants, setQnParticipants] = useState<Partial<Record<BandParticipantRole, BandParticipantState>>>(() => QnBandSelectionStore.getStates());
    const setQnParticipant = useCallback((role: BandParticipantRole, state: BandParticipantState) => {
        QnBandSelectionStore.setState(role, state);
        setQnParticipants(QnBandSelectionStore.getStates());
    }, []);
    // 错误提示
    const [playError, setPlayError] = useState<string | null>(null);
    const [monitorStatus, setMonitorStatus] = useState('就绪');
    const [monitorReadout, setMonitorReadout] = useState<QnMonitorReadout | null>(null);
    const [monitorRoll, setMonitorRoll] = useState<PianoRoll | null>(null);
    const [monitorLogLines, setMonitorLogLines] = useState<string[]>([]);
    const [monitorSections, setMonitorSections] = useState<TraceSection[]>([]);
    const [monitorIr, setMonitorIr] = useState<MusicGenerationResult['ir']>(null);
    const [rollWinOpen, setRollWinOpen] = useState(false);
    // ★ Debug/Diagnostics 区(诊断能力从旧 NewEnginePanel 收口进 Q+H):A/B seed diff · MIDI 导出 · 音轨视图。
    const [showDebug, setShowDebug] = useState(false);
    const [abCmp, setAbCmp] = useState<TraceComparison | null>(null);
    const rafRef = useRef<number | null>(null);
    const dragControls = useDragControls();
    const playStateRef = useRef<PlayState>('IDLE');
    playStateRef.current = playState;
    const activeSeedRef = useRef<number | null>(null);

    // Q+H 快捷键 — 输入框聚焦时不触发
    useEffect(() => {
        const keysPressed = new Set<string>();
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.repeat) return;
            const target = e.target as HTMLElement;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
            keysPressed.add(e.key.toLowerCase());
            if (keysPressed.has('q') && keysPressed.has('h')) setIsVisible((v) => !v);
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            keysPressed.delete(e.key.toLowerCase());
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    useEffect(() => {
        if (!isVisible) return;
        const tick = () => {
            const musicGen = AudioEngine.getCurrentMusicGeneration();
            const beat = AudioEngine.getCurrentBeat();
            const seed = PRNGManager.getInitialSeed();
            setFrame((prev) => {
                if (prev.musicGen === musicGen
                    && Math.abs(prev.beat - beat) < 0.01
                    && prev.seed === seed) {
                    return prev;
                }
                return { musicGen, beat, seed };
            });
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        };
    }, [isVisible]);

    // ==========================================================
    // Seed 播放控制（原 SeedController 整合进来）
    // ==========================================================

    // 重新应用 mute 状态 —— 新歌曲 load 后 channel 可能变，需要重新 mute
    const reapplyMutes = useCallback(() => {
        for (const partName of Object.values(ROLE_TO_PART_NAME)) {
            AudioEngine.setPartMute(partName as PartName, mutedParts.has(partName as PartName));
        }
    }, [mutedParts]);

    // ★ 与 playSeed 同源的 Q+N 生成请求(seed + 当前 style/key + participant 约束);诊断/监控/A-B 共用。
    const buildTraceRequest = useCallback((seed: number): GenerationRequest => {
        const bandConstraint = deriveLineupConstraint(QnBandSelectionStore.getParticipants());
        const req: GenerationRequest = {
            seed,
            styleHint: MusicGenerationStyleStore.getStyleHint(),
            mood: 'build',
            targetDuration: 120,
            key: pc(keyToPc(MusicGenerationKeyStore.getKey())),
        };
        if (bandConstraint) req.bandConstraint = bandConstraint;
        return req;
    }, []);

    const refreshQnMonitor = useCallback((result: MusicGenerationResult, seed: number) => {
        if (!result.ir) return;
        const fallbackStatus = result.status === 'failed' ? 'failed' : 'pass';
        const fallback = () => {
            setMonitorIr(result.ir);
            setMonitorReadout(deriveQnMonitorReadout({
                ir: result.ir!,
                status: fallbackStatus,
                attempts: result.attempts,
                bpm: result.bpm,
            }));
            setMonitorRoll(buildPianoRoll(result.ir!, { width: 512, height: 168 }));
            setMonitorSections([]);
        };

        try {
            const trace = traceGeneration(buildTraceRequest(seed));
            setMonitorIr(trace.ir);
            setMonitorReadout(deriveQnMonitorReadout({
                ir: trace.ir,
                status: trace.status,
                attempts: trace.attempts,
                bpm: trace.bpm,
            }));
            setMonitorRoll(buildPianoRoll(trace.ir, { width: 512, height: 168 }));
            setMonitorLogLines(trace.lines);
            setMonitorSections(trace.sections);
            // eslint-disable-next-line no-console
            console.log('%c[newEngine] 生成流程日志（逐层节点）\n%s', 'color:#34d399;font-weight:bold', trace.lines.join('\n'));
        } catch (err) {
            fallback();
            const msg = err instanceof Error ? err.message : String(err);
            setMonitorLogLines([`■ MONITOR    traceGeneration failed: ${msg}`]);
            console.warn('[PipelineMonitor] Q+N trace monitor failed:', err);
        }
    }, [buildTraceRequest]);

    const playSeed = useCallback(async (seed: number) => {
        await startAudioContext();
        AudioEngine.stop();
        activeSeedRef.current = seed;
        setPlayState('GENERATING');
        setMonitorStatus('播放中…');
        setCurrentSeed(seed);
        setPlayError(null);

        await new Promise(resolve => setTimeout(resolve, 50));

        try {
            // pipeline rule §1.4：setSeed → runPipeline → AbsoluteTransposer(in playSong) → MidiConverter
            PRNGManager.setSeed(seed);
            PRNGManager.recordSnapshot('A');

            // ★ Q+N 主链路:runPipeline 现是 Q+N 服务外观,返回完整 MusicGenerationResult(Band Selection 走 QnBandSelectionStore)。
            //   真正播放走 AudioEngine.playMusicGeneration(result)(MusicalIR 正式音频合同),不再 playSong(mg track)。
            const { result } = runPipeline({});

            if (activeSeedRef.current !== seed) return;
            if (result.status === 'failed' || !result.ir) throw new Error('音乐生成失败(audit fatal)');

            refreshQnMonitor(result, seed);
            await AudioEngine.playMusicGeneration(result);
            reapplyMutes();
            setPlayState('PLAYING');
            setMonitorStatus('▶ 播放中');

            globalMidiScheduler.onTrackEnd(() => {
                if (activeSeedRef.current === seed && playStateRef.current === 'PLAYING') {
                    playSeed(seed);
                }
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('[playSeed] pipeline failed:', e);
            setPlayError(msg);
            setMonitorStatus(`音频启动失败:${msg}`);
            setPlayState('IDLE');
            activeSeedRef.current = null;
        }
    }, [reapplyMutes, refreshQnMonitor]);

    const handlePlay = useCallback(async () => {
        // ★ Q+N:把字符串 seed 写 MusicGenerationSeedStore → runPipeline 内部 getSeedNumber() 哈希成 number 喂 Q+N。
        MusicGenerationSeedStore.setSuffix(seedInput || '0');
        const numHash = hashSeedToInt(seedInput || '0');
        await playSeed(numHash);
    }, [seedInput, playSeed]);

    const handleStop = useCallback(() => {
        activeSeedRef.current = null;
        AudioEngine.stop();
        setPlayState('IDLE');
        setMonitorStatus('已停止');
    }, []);

    const handleRandom = useCallback(() => {
        // 对齐 mg App.tsx 的 randomTail(6 字符 base36 hex 串,如 `4f9a2b`)
        const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
        let out = '';
        for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
        setSeedInput(out);
    }, []);

    const togglePartMute = useCallback((partName: PartName) => {
        setMutedParts(prev => {
            const next = new Set(prev);
            const muted = !next.has(partName);
            if (muted) next.add(partName);
            else next.delete(partName);
            AudioEngine.setPartMute(partName, muted);
            return next;
        });
    }, []);

    // ==========================================================
    // Debug/Diagnostics — 诊断能力收口进 Q+H(不另开播放入口:播放仍走上方 Play=playMusicGeneration)
    // ==========================================================
    const effectiveSeed = useCallback(() => currentSeed ?? hashSeedToInt(seedInput || '0'), [currentSeed, seedInput]);

    // ⬇ MIDI:导出当前 seed/style 的成曲为 .mid(与播放同源 traceGeneration → 同一首)。
    const exportMidi = useCallback(() => {
        try {
            const s = effectiveSeed();
            const trace = traceGeneration(buildTraceRequest(s));
            const smf = musicalIRToSMF(trace.ir, trace.bpm, MusicGenerationStyleStore.getStyleHint());
            const blob = new Blob([smf as BlobPart], { type: 'audio/midi' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `qh-${MusicGenerationStyleStore.getStyleHint()}-seed${s}.mid`;
            a.click();
            URL.revokeObjectURL(url);
            setMonitorStatus('⬇ 已导出 .mid');
        } catch (err) {
            setMonitorStatus(`导出失败:${err instanceof Error ? err.message : String(err)}`);
        }
    }, [effectiveSeed, buildTraceRequest]);

    // ⇄ A/B:同 style/key 下 seed vs seed+1 的结构化 trace diff(诊断确定性/多样性)。
    const compareAB = useCallback(() => {
        try {
            const s = effectiveSeed();
            const a = traceGeneration(buildTraceRequest(s));
            const b = traceGeneration(buildTraceRequest(s + 1));
            setAbCmp(compareTraces(a, b));
            setMonitorStatus(`⇄ A/B seed ${s} vs ${s + 1}`);
        } catch (err) {
            setMonitorStatus(`A/B 失败:${err instanceof Error ? err.message : String(err)}`);
        }
    }, [effectiveSeed, buildTraceRequest]);

    // 🎹 音轨视图:没生成过先跑一次 trace 填充,再开窗。
    const openRollWindow = useCallback(() => {
        if (!monitorIr) {
            try {
                const trace = traceGeneration(buildTraceRequest(effectiveSeed()));
                setMonitorIr(trace.ir);
                setMonitorSections(trace.sections);
            } catch { /* 空窗兜底 */ }
        }
        setRollWinOpen(true);
    }, [monitorIr, effectiveSeed, buildTraceRequest]);

    if (!isVisible) return null;

    const { beat, seed, musicGen } = frame;
    const ui = musicGen?.uiSnapshot ?? null;

    // ★ Q+N:展示数据来自 uiSnapshot(结构化投影),转成现有 Stage 组件期望的 GeneratedChord/SectionMetadata 形状。
    const bpb = ui?.timeSignature?.[0] ?? 4;
    const sections: SectionMetadata[] = (ui?.sections ?? []).map((s) => ({
        name: s.role, label: s.functionTag ?? s.role, role: s.role,
        startBeat: s.startBeat, endBeat: s.startBeat + s.bars * bpb, bars: s.bars,
    } as unknown as SectionMetadata));
    const chords: GeneratedChord[] = (ui?.chords ?? []).map((c) => ({
        root: c.rootPc, keyOffset: 0,
        extensions: [c.label.replace(/^[A-G][b#x]?/, '')].filter(Boolean),
        numeral: c.roman, startBeat: c.startBeat, endBeat: c.startBeat + c.durationBeats,
    } as unknown as GeneratedChord));

    let currentSectionIdx = -1;
    for (let i = 0; i < sections.length; i++) {
        if (beat + 1e-6 >= sections[i].startBeat && beat < sections[i].endBeat - 1e-6) {
            currentSectionIdx = i; break;
        }
    }
    const currentSection = currentSectionIdx >= 0 ? sections[currentSectionIdx] : null;

    let currentChordIdx = -1;
    for (let i = 0; i < chords.length; i++) {
        if (beat + 1e-6 >= chords[i].startBeat && beat < chords[i].endBeat - 1e-6) {
            currentChordIdx = i; break;
        }
    }
    const currentChord: GeneratedChord | null = currentChordIdx >= 0 ? chords[currentChordIdx] : null;

    return (
        <>
        <motion.div
            drag
            dragControls={dragControls}
            dragListener={false}
            dragMomentum={false}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed z-50 top-4 right-4 flex flex-col bg-zinc-950/90 backdrop-blur-md rounded-2xl border border-zinc-800 shadow-[0_8px_30px_rgba(0,0,0,0.6)] overflow-hidden"
            style={{
                width: 640,
                height: 'min(92vh, 820px)',
                minWidth: 420,
                minHeight: 360,
                resize: 'both',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
        >
            {/* Header (Draggable) */}
            <div
                className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/80 cursor-grab active:cursor-grabbing bg-gradient-to-b from-zinc-900/80 to-transparent shrink-0"
                onPointerDown={(e) => dragControls.start(e)}
            >
                <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-zinc-400" />
                    <h3 className="text-zinc-300 font-bold tracking-widest text-xs uppercase">
                        音乐生成
                    </h3>
                </div>
                <button
                    onClick={() => setIsVisible(false)}
                    className="text-zinc-500 hover:text-white transition-colors"
                    title="Q+H 切换"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Engine slot — mg 唯一引擎 */}
            <div className="px-4 py-2 border-b border-zinc-800/80 bg-zinc-900/50 shrink-0 flex items-center gap-3">
                <span className="text-[9px] uppercase tracking-widest text-orange-400/80 font-bold w-12 shrink-0">Engine</span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400">Q+N</span>
                <span className="text-[9px] uppercase tracking-wider text-zinc-500">style</span>
                <select
                    value={musicStyle}
                    onChange={(e) => switchMusicStyle(e.target.value as MusicGenStyle)}
                    className="bg-black/60 border border-cyan-500/30 rounded px-2 py-1 text-[10px] font-mono text-cyan-300 focus:outline-none focus:border-cyan-400/60"
                    title="风格选择 — 下次 Play 生效"
                >
                    {MUSIC_GEN_STYLE_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                    ))}
                </select>
                <span className="text-[9px] uppercase tracking-wider text-zinc-500 ml-1">key</span>
                <select
                    value={musicKey}
                    onChange={(e) => switchMusicKey(e.target.value as MusicGenKey)}
                    className="bg-black/60 border border-purple-500/30 rounded px-2 py-1 text-[10px] font-mono text-purple-300 focus:outline-none focus:border-purple-400/60"
                    title="key 选择 — 下次 Play 生效"
                >
                    {MUSIC_GEN_KEY_OPTIONS.map((k) => (
                        <option key={k} value={k}>{k}</option>
                    ))}
                </select>
            </div>

            {/* Seed Lab：种子输入 + Play/Stop/Random（原 Q+S 整合） */}
            <div className="px-4 py-2.5 border-b border-zinc-800/80 bg-zinc-900/40 shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-[9px] uppercase tracking-widest text-emerald-400/80 font-bold w-12 shrink-0">Seed</span>
                    <input
                        type="text"
                        value={seedInput}
                        onChange={(e) => setSeedInput(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handlePlay();
                        }}
                        placeholder="e.g. 2332053069"
                        className="flex-1 bg-black/50 border border-emerald-500/20 rounded px-2 py-1 text-[11px] font-mono text-emerald-300 placeholder-zinc-600 focus:outline-none focus:border-emerald-400/60"
                    />
                    <button
                        onClick={handleRandom}
                        title="Random seed"
                        className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-white/5 rounded text-zinc-300 transition-colors"
                    >
                        <Dice5 className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={handlePlay}
                        disabled={playState === 'GENERATING'}
                        title="Play (Enter)"
                        className={`px-2 py-1 rounded transition-all ${
                            playState === 'GENERATING'
                                ? 'bg-zinc-700 text-zinc-500 cursor-wait'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                    >
                        <Play className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={handleStop}
                        disabled={playState === 'IDLE'}
                        title="Stop"
                        className={`px-2 py-1 rounded transition-all ${
                            playState === 'IDLE'
                                ? 'bg-zinc-800/40 text-zinc-600 cursor-not-allowed'
                                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-white/10'
                        }`}
                    >
                        <Square className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={() => setRollWinOpen(true)}
                        disabled={!monitorIr}
                        title="音轨视图"
                        className={`px-2 py-1 rounded transition-all ${
                            !monitorIr
                                ? 'bg-zinc-800/40 text-zinc-600 cursor-not-allowed'
                                : 'bg-zinc-800 hover:bg-zinc-700 text-sky-300 border border-sky-500/30'
                        }`}
                    >
                        <Piano className="w-3.5 h-3.5" />
                    </button>
                </div>
                {/* Status row */}
                <div className="flex items-center gap-2 mt-1.5 text-[9px] font-mono">
                    <div className={`w-1.5 h-1.5 rounded-full ${
                        playState === 'PLAYING' ? 'bg-emerald-400 animate-pulse' :
                        playState === 'GENERATING' ? 'bg-yellow-400 animate-pulse' :
                        'bg-zinc-600'
                    }`} />
                    <span className="text-zinc-500 uppercase tracking-wider">{playState}</span>
                    {playState === 'PLAYING' && <span className="text-zinc-600">↻ loop</span>}
                    {currentSeed !== null && (
                        <span className="text-zinc-600 ml-auto">
                            now: <span className="text-emerald-300">{currentSeed}</span>
                        </span>
                    )}
                </div>
                {/* MG 模式 stub 错误提示 */}
                {playError !== null && (
                    <div className="mt-1.5 px-2 py-1 bg-red-950/40 border border-red-500/30 rounded text-[9px] font-mono text-red-300 break-words">
                        ⚠ {playError}
                    </div>
                )}
            </div>

            {/* ★ Band Selection(qn_takeover_followup §3):选「参与乐手/职能」,不选 GM 音色。
                立即写 QnBandSelectionStore,下次 Play 生效(auto=Q+N 默认 · selected=白名单参与 · disabled=不生成)。 */}
            <QnBandPanel states={qnParticipants} onSet={setQnParticipant} />

            {/* Q+N 原监控视图 + Q+H stage 读数 */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-pipeline-scroll">
                <div className="space-y-4 px-4 py-3 border-b border-zinc-800/60">
                    <QnGenerationMonitorView
                        status={monitorStatus}
                        readout={monitorReadout}
                        roll={monitorRoll}
                        logLines={monitorLogLines}
                    />
                </div>

                {/* ★ Debug/Diagnostics(诊断能力从旧 NewEnginePanel 收口进 Q+H;播放仍走上方 Play=playMusicGeneration)*/}
                <div className="px-4 py-2 border-b border-zinc-800/60">
                    <button
                        type="button"
                        onClick={() => setShowDebug((v) => !v)}
                        className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-sky-400/80 font-bold hover:text-sky-300"
                    >
                        <span>{showDebug ? '▾' : '▸'}</span> Debug · 诊断
                    </button>
                    {showDebug && (
                        <div className="mt-2 space-y-2">
                            <div className="flex flex-wrap gap-1.5">
                                <button type="button" onClick={openRollWindow} title="逐轨看音符(独立窗口)"
                                    className="rounded border border-sky-500/40 px-2 py-1 text-[10px] text-sky-300 hover:bg-sky-500/10">🎹 音轨视图</button>
                                <button type="button" onClick={exportMidi} title="导出当前 seed/style 成曲为 .mid"
                                    className="rounded border border-sky-500/40 px-2 py-1 text-[10px] text-sky-300 hover:bg-sky-500/10">⬇ MIDI</button>
                                <button type="button" onClick={compareAB} title="seed vs seed+1 结构化 trace diff"
                                    className="rounded border border-violet-500/40 px-2 py-1 text-[10px] text-violet-300 hover:bg-violet-500/10">⇄ A/B</button>
                            </div>
                            {abCmp && (
                                <div className="rounded border border-violet-500/20 bg-black/50">
                                    <div className="flex items-center justify-between border-b border-white/5 px-2 py-1 text-[9px] uppercase tracking-widest text-violet-300/70">
                                        <span>A/B diff</span>
                                        <span className="text-zinc-400">{abCmp.changedCount} 行差异</span>
                                    </div>
                                    <div className="grid grid-cols-4 gap-x-2 gap-y-0.5 px-2 py-1.5 text-[9px] text-zinc-400">
                                        {([['bpm', abCmp.metrics.bpm], ['小节', abCmp.metrics.bars], ['音符', abCmp.metrics.notes], ['状态', abCmp.metrics.status]] as const).map(([k, v]) => (
                                            <div key={k} className={v.equal ? '' : 'text-amber-300'}>
                                                {k} <span className="text-zinc-200">{String(v.a)}</span>{v.equal ? '' : ` → ${String(v.b)}`}
                                            </div>
                                        ))}
                                    </div>
                                    <div className="max-h-40 overflow-auto border-t border-white/5 px-2 py-1 font-mono text-[9px] leading-snug">
                                        {abCmp.rows.map((r, i) => (
                                            <div key={i} className={`grid grid-cols-2 gap-2 ${r.same ? 'text-zinc-500' : 'bg-amber-500/10 text-amber-200'}`}>
                                                <span className="truncate" title={r.left}>{r.left ?? ''}</span>
                                                <span className="truncate" title={r.right}>{r.right ?? ''}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* 双栏内容区 */}
                <div className="grid grid-cols-2">
                    {/* 左栏：Stage 01-02 */}
                    <div className="min-w-0 border-r border-zinc-800/60">
                        <Stage1MetaForm
                            bpm={ui?.bpm}
                            keyName={ui?.key}
                            tonalityLabel={ui?.tonality}
                            seed={seed}
                            styleName={ui?.styleHint?.toUpperCase()}
                            currentChord={currentChord}
                        />
                        <Stage2Harmony
                            chords={chords}
                            currentSection={currentSection}
                            currentChordIdx={currentChordIdx}
                        />
                    </div>

                    {/* 右栏：Stage 03 + Ensemble */}
                    <div className="min-w-0">
                        <Stage3Structure
                            sections={sections}
                            currentSectionIdx={currentSectionIdx}
                            beatsPerBar={ui?.timeSignature?.[0]}
                        />
                        <Stage5Ensemble qnRoster={ui?.roster} />
                    </div>
                </div>
            </div>

            {/* 右下 resize 提示 */}
            <div className="absolute bottom-1 right-1 w-3 h-3 cursor-se-resize opacity-30 pointer-events-none text-zinc-400">
                <svg viewBox="0 0 10 10" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 10V8H10V10H8ZM5 10V8H7V10H5ZM8 7V5H10V7H8ZM2 10V8H4V10H2ZM5 7V5H7V7H5ZM8 4V2H10V4H8Z" />
                </svg>
            </div>

            <style dangerouslySetInnerHTML={{ __html: `
                .custom-pipeline-scroll::-webkit-scrollbar { width: 4px; }
                .custom-pipeline-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.3); }
                .custom-pipeline-scroll::-webkit-scrollbar-thumb { background: rgba(82,82,91,0.5); border-radius: 2px; }
                .custom-pipeline-scroll::-webkit-scrollbar-thumb:hover { background: rgba(161,161,170,0.6); }
            `}} />
        </motion.div>
        <PianoRollWindow
            ir={monitorIr ?? undefined}
            sections={monitorSections}
            open={rollWinOpen}
            onClose={() => setRollWinOpen(false)}
            title={`${musicStyle.toLowerCase()} · seed ${currentSeed ?? musicGen?.seed ?? seedInput}`}
        />
        </>
    );
};


const StageBadge: React.FC<{ label: string; color: string }> = ({ label, color }) => (
    <div
        className="inline-block px-2 py-0.5 rounded border text-[10px] font-bold tracking-widest uppercase"
        style={{ borderColor: color, color }}
    >
        {label}
    </div>
);

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="text-[9px] uppercase tracking-widest text-zinc-500 mb-1">{children}</div>
);

interface Stage1Props {
    bpm: number | undefined;
    keyName: string | undefined;
    tonality?: Tonality; // legacy enum 降级(仅无 chord 的局部音阶名兜底);Q+N 主显示走 tonalityLabel
    tonalityLabel?: string; // ★ Q+N:uiSnapshot.tonality 字符串('major'|'minor'|教会调式)— 优先直显,不走 enum 降级
    seed: number;
    styleName: string | undefined;
    currentChord: GeneratedChord | null;
}

const capWord = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

const Stage1MetaForm: React.FC<Stage1Props> = ({ bpm, keyName, tonality, tonalityLabel, seed, styleName, currentChord }) => {
    const tonicLabel = keyName ?? '—';
    const modeLabel = tonalityLabel ? capWord(tonalityLabel) : tonalityToShortMode(tonality);
    return (
        <section className="px-4 pt-4 pb-3 border-b border-zinc-800/60">
            <StageBadge label="Stage 01: Meta & Form" color="rgb(45, 212, 191)" />
            <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="bg-black/40 rounded-lg p-3 border border-zinc-800 relative overflow-hidden">
                    <div className="absolute inset-0 flex justify-around items-stretch opacity-20 pointer-events-none">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="w-px bg-emerald-500/40" />
                        ))}
                    </div>
                    <div className="relative text-center">
                        <span className="text-[10px] text-zinc-500 mr-1">BPM:</span>
                        <span className="text-emerald-300 text-2xl font-bold">{bpm ?? '—'}</span>
                    </div>
                </div>
                <div className="bg-black/40 rounded-lg p-3 border border-zinc-800 text-center">
                    <div className="text-[9px] uppercase tracking-widest text-zinc-500">Key</div>
                    <div className="text-white text-lg font-bold mt-1">
                        {tonicLabel} {modeLabel}
                    </div>
                </div>
            </div>

            <div className="mt-3">
                <FieldLabel>Seed</FieldLabel>
                <div className="text-white text-xs break-all">{seed || '—'}</div>
            </div>

            <div className="mt-3">
                <FieldLabel>Style Profile</FieldLabel>
                <div className="text-cyan-400 text-sm font-bold uppercase tracking-wide">{styleName ?? '—'}</div>
            </div>

            <div className="mt-3">
                <FieldLabel>Melody Scale</FieldLabel>
                <div className="text-white text-sm">
                    {tonalityLabel ? `${tonicLabel} ${capWord(tonalityLabel)}` : tonalityToHumanScale(tonality)}
                    {currentChord !== null && (
                        <span className="text-zinc-500 ml-2">
                            (Local: <span className="text-cyan-300">{getLocalScaleName(currentChord, tonality)}</span>)
                        </span>
                    )}
                </div>
            </div>
        </section>
    );
};

interface Stage2Props {
    chords: GeneratedChord[];
    currentSection: SectionMetadata | null;
    currentChordIdx: number;
}

const Stage2Harmony: React.FC<Stage2Props> = ({ chords, currentSection, currentChordIdx }) => {
    let windowChords: { chord: GeneratedChord; idx: number }[] = [];
    if (currentSection) {
        for (let i = 0; i < chords.length; i++) {
            const c = chords[i];
            if (c.startBeat + 1e-6 >= currentSection.startBeat
                && c.startBeat < currentSection.endBeat - 1e-6) {
                windowChords.push({ chord: c, idx: i });
            }
        }
    }
    if (windowChords.length === 0 && chords.length > 0) {
        windowChords = chords.slice(0, 4).map((c, i) => ({ chord: c, idx: i }));
    }

    return (
        <section className="px-4 pt-4 pb-3 border-b border-zinc-800/60">
            <StageBadge label="Stage 02: Harmony" color="rgb(251, 146, 60)" />
            <div className="mt-3 flex flex-wrap gap-2">
                {windowChords.length === 0 ? (
                    <div className="text-zinc-600 text-xs">— 无和声 —</div>
                ) : (
                    windowChords.map(({ chord, idx }) => {
                        const isCurrent = idx === currentChordIdx;
                        const fullName = chordToFullName(chord);
                        const backbone = computeBackboneNames(chord);
                        const tsd = tsdFromRoman(chord.numeral);
                        return (
                            <div
                                key={idx}
                                className={
                                    'px-3 py-2.5 rounded-lg border min-w-[110px] flex flex-col items-center gap-1.5 transition-all ' +
                                    (isCurrent
                                        ? 'border-emerald-400 bg-black/70 ring-2 ring-emerald-400/40 scale-105'
                                        : 'border-zinc-700 bg-black/30')
                                }
                            >
                                <div className={
                                    'text-lg font-bold leading-tight ' +
                                    (isCurrent ? 'text-white' : 'text-orange-200')
                                }>
                                    {fullName}
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-mono text-cyan-300/90 px-1 py-0.5 rounded bg-cyan-950/40 border border-cyan-700/30">
                                        {chord.numeral}
                                    </span>
                                    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${TSD_STYLE[tsd]}`}>
                                        {tsd}
                                    </span>
                                </div>
                                <div className="text-[10px] font-mono text-zinc-500 tracking-wider">
                                    {backbone.join(' ')}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </section>
    );
};

interface Stage3Props {
    sections: SectionMetadata[];
    currentSectionIdx: number;
    beatsPerBar: number | undefined;
}

const Stage3Structure: React.FC<Stage3Props> = ({ sections, currentSectionIdx, beatsPerBar }) => (
    <section className="px-4 pt-4 pb-3 border-b border-zinc-800/60">
        <StageBadge label="Stage 03: Structure" color="rgb(34, 211, 238)" />
        <div className="mt-3 space-y-1">
            {sections.length === 0 ? (
                <div className="text-zinc-600 text-xs">— 无段落 —</div>
            ) : (
                sections.map((s, i) => {
                    const isCurrent = i === currentSectionIdx;
                    const bars = beatsPerBar ? Math.round((s.endBeat - s.startBeat) / beatsPerBar) : 0;
                    return (
                        <div
                            key={i}
                            className={
                                'flex items-center gap-2 px-2 py-1 rounded text-[11px] ' +
                                (isCurrent ? 'bg-cyan-500/15 border border-cyan-400/40' : 'border border-transparent')
                            }
                        >
                            <span className={isCurrent ? 'text-cyan-300 font-bold' : 'text-zinc-400'}>
                                {s.name}
                            </span>
                            <span className="flex-1 text-zinc-600 text-[10px]">{bars}b</span>
                            <EnergyBar level={s.energyLevel} active={isCurrent} />
                        </div>
                    );
                })
            )}
        </div>
    </section>
);

const EnergyBar: React.FC<{ level: number; active: boolean }> = ({ level, active }) => {
    const pct = Math.max(0, Math.min(10, level)) * 10;
    return (
        <div className="w-12 h-1 bg-zinc-800 rounded overflow-hidden">
            <div
                className={'h-full ' + (active ? 'bg-cyan-400' : 'bg-zinc-600')}
                style={{ width: `${pct}%` }}
            />
        </div>
    );
};

interface Stage5Props {
    qnRoster?: import('../core/generation/musicGeneration/types').UiPlayer[]; // ★ Q+N ensemble/roster
}

const QN_ROLE_LABEL: Record<string, string> = { lead: 'Lead', comp: 'Comping', bass: 'Bass', pad: 'Atmosphere', drum: 'Drum' };
const QN_ROLE_COLOR: Record<string, string> = { lead: 'text-emerald-300', comp: 'text-amber-300', bass: 'text-blue-300', pad: 'text-violet-300', drum: 'text-fuchsia-300' };

const Stage5Ensemble: React.FC<Stage5Props> = ({ qnRoster }) => {
    // ★ Q+N ensemble:有 qnRoster 时直接展示乐手/乐器/状态(取代旧 palette 路径)。
    if (qnRoster && qnRoster.length > 0) {
        return (
            <section className="px-4 pt-4 pb-4">
                <StageBadge label="Stage 04: Ensemble" color="rgb(244, 63, 94)" />
                <div className="mt-3 space-y-1.5">
                    {qnRoster.map((p) => (
                        <div key={p.role} className="flex items-center justify-between text-xs">
                            <span className={QN_ROLE_COLOR[p.role] ?? 'text-zinc-300'}>{QN_ROLE_LABEL[p.role] ?? p.role}</span>
                            {/* 音色只读(器配层随机选);标 参与/自动补位 */}
                            <span className="font-mono text-zinc-400">{p.instrumentName}
                                {p.autoFilled && <span className="ml-1 text-[9px] text-amber-500/80">(自动补位)</span>}
                                {!p.autoFilled && p.state === 'selected' && <span className="ml-1 text-[9px] text-fuchsia-400/70">(参与)</span>}
                            </span>
                        </div>
                    ))}
                </div>
            </section>
        );
    }
    // 无 Q+N roster(未生成)→ 空态。旧 palette/roster(BandRoster/ArrangedTrack)编制路径已随旧数据结构删除。
    return (
        <section className="px-4 pt-4 pb-4">
            <StageBadge label="Stage 04: Ensemble" color="rgb(244, 63, 94)" />
            <div className="mt-3 text-zinc-600 text-xs">— 未编制 —</div>
        </section>
    );
};
