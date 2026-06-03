import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, useDragControls } from 'motion/react';
import { Activity, Play, Square, X, Dice5, Volume2, VolumeX } from 'lucide-react';
import { AudioEngine, startAudioContext } from '../core/audio/AudioEngine';
import { PartName } from '../core/audio/PlaybackEngine';
import { globalMidiScheduler } from '../core/audio/MidiScheduler';
import { PRNGManager } from '../core/utils/PRNG';
// MelodyEngine 已删(2026-05-24)
import { runPipeline } from '../core/generation/pipeline';
import {
    ArrangedTrack,
    GeneratedChord,
    MusicContext,
    SectionMetadata,
    TonalityName,
    Tonality,
    InstrumentRole,
    ChordQuality,
    BandRole,
    Musician,
    CHORD_SCALE_NAME,
} from '../core/generation/types';
import { StyleId, StyleIdName } from '../core/generation/config/StyleFlags';
import { MUSICIAN_POOL, getMusiciansByRole, getMusicianById } from '../core/generation/idioms/MusicianRegistry';
import { getInstrumentFamily, GMSlotOption } from '../core/generation/data/GMSoundMap';
import { BandSelectionStore } from '../state/BandSelectionStore';
import { MgStyleStore, MG_STYLE_OPTIONS, type MgStyle } from '../state/MgStyleStore';
import { MgKeyStore, MG_KEY_OPTIONS, type MgKey } from '../state/MgKeyStore';
import { MgSeedStore, hashSeedToInt } from '../state/MgSeedStore';
import { useDevPanelChannel } from './devPanels';

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
    arranged: ArrangedTrack | null;
    context: MusicContext | null;
    beat: number;
    seed: number;
}

// 6 个 BandRole 槽位顺序（Q+H BandSelection 面板按此顺序渲染）
const BAND_SLOT_ORDER: { role: BandRole; label: string }[] = [
    { role: BandRole.Vocal,      label: 'Vocal' },
    { role: BandRole.MainInst,   label: 'Main Inst' },
    { role: BandRole.Accomp,     label: 'Accomp' },
    { role: BandRole.Bass,       label: 'Bass' },
    { role: BandRole.Drums,      label: 'Drums' },
    { role: BandRole.Atmosphere, label: 'Atmosphere' },
];

type BandSelection = Partial<Record<BandRole, string | null>>;
/** B2：每 BandRole 的乐器(GM program number)选择。undefined = 用 BandEngine 默认 */
type InstrumentSelection = Partial<Record<BandRole, number>>;

/**
 * B2：BandRole → 默认 musician id（与 pipeline/index.ts buildDefaultRoster 一致）。
 *   UI 侧需要这个映射来：当用户没选 musician（默认状态）时，依然能根据
 *   "系统将使用的默认 musician 的 instrumentRef" 给 Instr. 下拉提供合适选项。
 *
 * 若 buildDefaultRoster 默认值变更，本表需同步更新。
 */
const DEFAULT_MUSICIAN_BY_ROLE: Partial<Record<BandRole, string>> = {
    [BandRole.MainInst]: 'alex_piano',
    [BandRole.Accomp]:   'chloe_piano',
    // 2026-05-27 mgEngine:Bass / Drums / Atmosphere 槽位无对应 musician,下拉自动空
};

export const PipelineMonitor: React.FC = () => {
    const [isVisible, setIsVisible] = useState(true);
    // 左侧 DevDock 入口(点击切换 + 高亮同步);Q+H 键盘逻辑仍保留
    useDevPanelChannel('pipeline', isVisible, setIsVisible);
    const [frame, setFrame] = useState<FrameSnapshot>({
        arranged: null, context: null, beat: 0, seed: 0,
    });
    const [seedInput, setSeedInput] = useState('42');
    const [currentSeed, setCurrentSeed] = useState<number | null>(null);
    const [mgStyle, setMgStyleState] = useState<MgStyle>(() => MgStyleStore.getStyle());
    const switchMgStyle = useCallback((next: MgStyle) => {
        MgStyleStore.setStyle(next);
        setMgStyleState(next);
    }, []);
    const [mgKey, setMgKeyState] = useState<MgKey>(() => MgKeyStore.getKey());
    const switchMgKey = useCallback((next: MgKey) => {
        MgKeyStore.setKey(next);
        setMgKeyState(next);
    }, []);
    const [playState, setPlayState] = useState<PlayState>('IDLE');
    const [mutedParts, setMutedParts] = useState<Set<PartName>>(new Set());
    // Pending(UI 编辑中)— 用户在下拉框选乐手时即时变,但**不影响 Play**
    // 初值从 BandSelectionStore 拿(Phase A 后 store 含 DEFAULT_BAND,保证不是全空)
    const [bandSelection, setBandSelection] = useState<BandSelection>(() => ({ ...BandSelectionStore.getBand() }));
    const [instrumentSelection, setInstrumentSelection] = useState<InstrumentSelection>(() => ({ ...BandSelectionStore.getInstruments() }));
    // Committed(Apply 后)— Play / Tap 实际消费的快照
    const [committedBand, setCommittedBand] = useState<BandSelection>(() => ({ ...BandSelectionStore.getBand() }));
    const [committedInstruments, setCommittedInstruments] = useState<InstrumentSelection>(() => ({ ...BandSelectionStore.getInstruments() }));
    // 2026-05-24 删 AF/MG 后:engine 常量 'AF2'(保留变量名供后续 JSX 引用,
    // 但不再有切换 UI)
    // POP-only(2026-05-25 删 JAZZ/BLUES/RNB)— mgStyle 选择 UI 移除
    // 错误提示(MG 模式抛错时显示)
    const [playError, setPlayError] = useState<string | null>(null);
    const rafRef = useRef<number | null>(null);
    const dragControls = useDragControls();
    const playStateRef = useRef<PlayState>('IDLE');
    playStateRef.current = playState;
    const activeSeedRef = useRef<number | null>(null);
    // refs 指向 **committed**(不是 pending),Play / Tap 通过 ref 拿乐队
    const bandSelectionRef = useRef<BandSelection>({});
    bandSelectionRef.current = committedBand;
    const instrumentSelectionRef = useRef<InstrumentSelection>({});
    instrumentSelectionRef.current = committedInstruments;

    // dirty 检测 — pending !== committed 时按钮高亮提示
    const isBandDirty = useMemo(() => {
        return JSON.stringify(bandSelection) !== JSON.stringify(committedBand)
            || JSON.stringify(instrumentSelection) !== JSON.stringify(committedInstruments);
    }, [bandSelection, instrumentSelection, committedBand, committedInstruments]);

    // Apply 按钮:pending → committed 一次性提交
    // 同步写到全局 BandSelectionStore — AuraBar TapArea 双击触发也读这个
    const applyBandSelection = useCallback(() => {
        setCommittedBand({ ...bandSelection });
        setCommittedInstruments({ ...instrumentSelection });
        BandSelectionStore.setBand(bandSelection, instrumentSelection);
    }, [bandSelection, instrumentSelection]);

    // 2026-05-25 大瘦身后:POP-only,mgStyle 选择/UI 全部移除

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
            const arranged = AudioEngine.getCurrentArrangedTrack();
            const context = AudioEngine.getCurrentContext();
            const beat = AudioEngine.getCurrentBeat();
            const seed = PRNGManager.getInitialSeed();
            setFrame((prev) => {
                if (prev.arranged === arranged
                    && prev.context === context
                    && Math.abs(prev.beat - beat) < 0.01
                    && prev.seed === seed) {
                    return prev;
                }
                return { arranged, context, beat, seed };
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

    const playSeed = useCallback(async (seed: number) => {
        await startAudioContext();
        AudioEngine.stop();
        activeSeedRef.current = seed;
        setPlayState('GENERATING');
        setCurrentSeed(seed);
        setPlayError(null);

        await new Promise(resolve => setTimeout(resolve, 50));

        try {
            // pipeline rule §1.4：setSeed → runPipeline → AbsoluteTransposer(in playSong) → MidiConverter
            PRNGManager.setSeed(seed);
            PRNGManager.recordSnapshot('A');

            // [TEMP DIAG] 诊断 forcedBand / forcedGmPrograms 是否真传到 runPipeline
            console.log('[playSeed] seed=', seed,
                ' forcedBand=', JSON.parse(JSON.stringify(bandSelectionRef.current)),
                ' forcedGmPrograms=', JSON.parse(JSON.stringify(instrumentSelectionRef.current)));

            // 2026-05-27 mgEngine 接管:runPipeline 调 mg.Engine.generateArrangement,
            // forcedBand 决定 melody / accompaniment 哪个轨剪掉(null = 该槽空)。
            const { track, context } = runPipeline({
                forcedBand: bandSelectionRef.current,
                forcedGmPrograms: instrumentSelectionRef.current,
            });
            console.log('[playSeed] melody.length=', track.melody?.length,
                ' first=', track.melody?.[0]?.pitch, '@', track.melody?.[0]?.onset);

            if (activeSeedRef.current !== seed) return;

            const styleId = context.style?.id ?? StyleId.ModernPop;
            await AudioEngine.playSong(track, styleId, context);
            reapplyMutes();
            setPlayState('PLAYING');

            globalMidiScheduler.onTrackEnd(() => {
                if (activeSeedRef.current === seed && playStateRef.current === 'PLAYING') {
                    playSeed(seed);
                }
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('[playSeed] pipeline failed:', e);
            setPlayError(msg);
            setPlayState('IDLE');
            activeSeedRef.current = null;
        }
    }, [reapplyMutes]);

    const handlePlay = useCallback(async () => {
        // mg 接受 alphanumeric seed(`42` / `4f9a2b` / `mySeed01`)。把原字符串写
        // MgSeedStore → runPipeline 内部按 style 拼 `pop_42` 喂 mg。
        // PRNGManager 仍要 numeric,用 djb2 hash 转 uint32 给它消费(只影响我们
        // 内部 snapshot 机制,不影响 mg 输出)。
        MgSeedStore.setSuffix(seedInput || '0');
        const numHash = hashSeedToInt(seedInput || '0');
        await playSeed(numHash);
    }, [seedInput, playSeed]);

    const handleStop = useCallback(() => {
        activeSeedRef.current = null;
        AudioEngine.stop();
        setPlayState('IDLE');
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

    if (!isVisible) return null;

    const { arranged, context, beat, seed } = frame;

    const sections: SectionMetadata[] = arranged?.sections ?? [];
    const chords: GeneratedChord[] = arranged?.chords ?? [];

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
                        Pipeline Monitor
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
                <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400">mg</span>
                <span className="text-[9px] uppercase tracking-wider text-zinc-500">style</span>
                <select
                    value={mgStyle}
                    onChange={(e) => switchMgStyle(e.target.value as MgStyle)}
                    className="bg-black/60 border border-cyan-500/30 rounded px-2 py-1 text-[10px] font-mono text-cyan-300 focus:outline-none focus:border-cyan-400/60"
                    title="mg 风格选择 — 下次 Play 生效"
                >
                    {MG_STYLE_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                    ))}
                </select>
                <span className="text-[9px] uppercase tracking-wider text-zinc-500 ml-1">key</span>
                <select
                    value={mgKey}
                    onChange={(e) => switchMgKey(e.target.value as MgKey)}
                    className="bg-black/60 border border-purple-500/30 rounded px-2 py-1 text-[10px] font-mono text-purple-300 focus:outline-none focus:border-purple-400/60"
                    title="mg key 选择 — 下次 Play 生效"
                >
                    {MG_KEY_OPTIONS.map((k) => (
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

            {/* BandSelection — 6 BandRole 槽位(Vocal/MainInst/Accomp/Bass/Drums/Atmosphere)+ 各自 Instr 下拉。
                MG 模式:整面板 disable(无乐手概念)。
                AF2 模式(Phase 2a):仅 Vocal 单槽 disable(mg 不生成 vocal)。
                Drums / Atmosphere 已解锁 — AF2 端 PadGenerator / DrumGenerator 自生成。 */}
            <BandSelectionPanel
                selection={bandSelection}
                onChange={setBandSelection}
                instrumentSelection={instrumentSelection}
                onInstrumentChange={setInstrumentSelection}
                isDirty={isBandDirty}
                onApply={applyBandSelection}
                disabled={false}
                disabledSlots={[BandRole.Vocal]}
            />

            {/* 双栏内容区（按 header 之外的剩余空间分配） */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
                {/* 左栏：Stage 01-02 */}
                <div className="w-1/2 overflow-y-auto custom-pipeline-scroll border-r border-zinc-800/60">
                    <Stage1MetaForm
                        bpm={arranged?.bpm}
                        keyName={arranged?.key}
                        tonality={context?.tonality}
                        seed={seed}
                        styleName={context?.style ? StyleIdName[context.style.id] : undefined}
                        currentChord={currentChord}
                    />
                    <Stage2Harmony
                        chords={chords}
                        currentSection={currentSection}
                        currentChordIdx={currentChordIdx}
                    />
                </div>

                {/* 右栏：Stage 03 + Ensemble */}
                <div className="w-1/2 overflow-y-auto custom-pipeline-scroll">
                    <Stage3Structure
                        sections={sections}
                        currentSectionIdx={currentSectionIdx}
                        beatsPerBar={arranged?.timeSignature?.[0]}
                    />
                    <Stage5Ensemble
                        palette={arranged?.palette}
                        roster={context?.ensemble?.roster}
                        mutedParts={mutedParts}
                        onToggleMute={togglePartMute}
                    />
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
    );
};

// ============================================================
// BandSelection — 6 BandRole 下拉，PRNG 抽随机为兜底
// ============================================================
interface BandSelectionPanelProps {
    selection: BandSelection;
    onChange: (next: BandSelection) => void;
    /** B2：per-role GM program 选择（来自 Instr. 下拉） */
    instrumentSelection: InstrumentSelection;
    onInstrumentChange: (next: InstrumentSelection) => void;
    /** 编辑状态与已 apply 状态有差异时高亮 Apply 按钮 */
    isDirty: boolean;
    /** Apply 按钮点击 — 把当前编辑提交为 committed,Play 才会用 */
    onApply: () => void;
    /** Engine === 'MG' 时整面板灰显 disable(MG 无乐手概念) */
    disabled?: boolean;
    /**
     * 单槽位 disable 列表。Engine === 'AF2' 时把 Vocal/Drums/Atmosphere 加入
     * 此列表 — AF2 Phase 1 这 3 个槽位无效(mg 不生成 vocal/drums/atmosphere)。
     */
    disabledSlots?: ReadonlyArray<BandRole>;
}

/** B1 哨兵值：UI dropdown "— 留空 —" 选项的 value，区别于"使用默认乐手"（value=""） */
const BAND_SLOT_EMPTY_VALUE = '__empty__';

const BandSelectionPanel: React.FC<BandSelectionPanelProps> = ({
    selection, onChange, instrumentSelection, onInstrumentChange, isDirty, onApply,
    disabled: panelDisabled = false,
    disabledSlots,
}) => {
    const isSlotDisabled = (role: BandRole): boolean =>
        disabledSlots != null && disabledSlots.includes(role);
    const totalPersonas = MUSICIAN_POOL.length;
    return (
        <div className={`px-4 py-2 border-b border-zinc-800/80 bg-zinc-900/30 shrink-0 ${panelDisabled ? 'opacity-40 pointer-events-none select-none' : ''}`}>
            <div className="flex items-baseline justify-between mb-1">
                <div className="flex items-center gap-2">
                    <span className="text-[9px] uppercase tracking-widest text-fuchsia-400/80 font-bold">Band Selection</span>
                    {/* Apply 按钮:dirty 时高亮提示用户"有未应用变更",clean 时灰色 */}
                    <button
                        type="button"
                        onClick={onApply}
                        disabled={!isDirty || panelDisabled}
                        className={`text-[9px] uppercase tracking-widest font-bold px-2 py-0.5 rounded transition-all ${
                            isDirty && !panelDisabled
                                ? 'bg-fuchsia-500/80 text-white hover:bg-fuchsia-400 shadow-[0_0_8px_rgba(217,70,239,0.5)] animate-pulse'
                                : 'bg-zinc-800 text-zinc-600 cursor-default'
                        }`}
                        title={panelDisabled ? 'MG 引擎无乐手概念,Band Selection 不可用' : (isDirty ? '应用本次乐队选择,下次 Play / Tap 将使用' : '当前选择已应用')}
                    >
                        {isDirty ? '⚡ Apply' : '✓ Applied'}
                    </button>
                </div>
                <span className="text-[9px] text-zinc-600">
                    {panelDisabled
                        ? 'MG mode · band disabled'
                        : `${totalPersonas} personas · 🎲 default · ⊘ empty`}
                </span>
            </div>
            <div className="grid grid-cols-6 gap-1.5">
                {BAND_SLOT_ORDER.map(({ role, label }) => {
                    const candidates: Musician[] = getMusiciansByRole(role);
                    // B1：三态显示 — undefined/缺省 → ""；null（留空）→ '__empty__'；string → 该 id
                    const cur = selection[role];
                    const value = cur === null ? BAND_SLOT_EMPTY_VALUE : (cur ?? '');
                    const slotForcedEmpty = isSlotDisabled(role);
                    const disabled = candidates.length === 0 || slotForcedEmpty;
                    // AF2 模式下 Vocal/Drums/Atmosphere 强制视为空槽(实际生成时也会被忽略)
                    const slotEmpty = value === BAND_SLOT_EMPTY_VALUE || slotForcedEmpty;

                    // B2：定位 "活动 musician" 用于推 instrumentRef
                    //   string id → 该乐手；undefined → DEFAULT_MUSICIAN_BY_ROLE[role]；null → 无
                    let activeMusicianId: string | undefined;
                    if (typeof cur === 'string') activeMusicianId = cur;
                    else if (cur === undefined) activeMusicianId = DEFAULT_MUSICIAN_BY_ROLE[role];
                    // null → activeMusicianId undefined → instr dropdown disabled
                    const activeMusician = activeMusicianId ? getMusicianById(activeMusicianId) : undefined;
                    const instrOptions: ReadonlyArray<GMSlotOption> = activeMusician
                        ? getInstrumentFamily(activeMusician.instrumentRef)
                        : [];
                    const instrValue = instrumentSelection[role];
                    const instrDropdownDisabled = disabled || slotEmpty || instrOptions.length === 0;

                    return (
                        <div key={role} className="flex flex-col gap-0.5">
                            <span className="text-[8px] uppercase tracking-wider text-zinc-500 mb-0.5">{label}</span>
                            {/* Musician 下拉 */}
                            <select
                                value={value}
                                disabled={disabled}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    const next: BandSelection = { ...selection };
                                    if (v === BAND_SLOT_EMPTY_VALUE) next[role] = null;
                                    else if (v === '') delete next[role];
                                    else next[role] = v;
                                    onChange(next);
                                    // musician 切换 → 清掉旧 instr override（家族可能不同）
                                    if (instrumentSelection[role] !== undefined) {
                                        const nextInstr: InstrumentSelection = { ...instrumentSelection };
                                        delete nextInstr[role];
                                        onInstrumentChange(nextInstr);
                                    }
                                }}
                                className={
                                    'bg-black/60 border rounded px-1 py-1 text-[10px] font-mono ' +
                                    (disabled
                                        ? 'border-zinc-800 text-zinc-700 cursor-not-allowed'
                                        : slotEmpty
                                            ? 'border-amber-500/40 text-amber-300'
                                            : value
                                                ? 'border-fuchsia-500/40 text-fuchsia-300'
                                                : 'border-zinc-700 text-zinc-400')
                                }
                            >
                                <option value="">{disabled ? '—' : '🎲 Default'}</option>
                                <option value={BAND_SLOT_EMPTY_VALUE}>⊘ Empty</option>
                                {candidates.map((m) => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                            {/* B2：Instrument 下拉（基于 active musician 的 instrumentRef） */}
                            <select
                                value={instrValue !== undefined ? String(instrValue) : ''}
                                disabled={instrDropdownDisabled}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    const next: InstrumentSelection = { ...instrumentSelection };
                                    if (v === '') delete next[role];
                                    else next[role] = parseInt(v, 10);
                                    onInstrumentChange(next);
                                }}
                                title={activeMusician ? `${activeMusician.name} · ${activeMusician.instrumentRef}` : ''}
                                className={
                                    'bg-black/60 border rounded px-1 py-0.5 text-[9px] font-mono ' +
                                    (instrDropdownDisabled
                                        ? 'border-zinc-800 text-zinc-700 cursor-not-allowed'
                                        : instrValue !== undefined
                                            ? 'border-cyan-500/40 text-cyan-300'
                                            : 'border-zinc-700/60 text-zinc-500')
                                }
                            >
                                <option value="">Instr. default</option>
                                {instrOptions.map((opt) => (
                                    <option key={opt.id} value={opt.id}>{opt.name}</option>
                                ))}
                            </select>
                        </div>
                    );
                })}
            </div>
        </div>
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
    tonality: Tonality | undefined;
    seed: number;
    styleName: string | undefined;
    currentChord: GeneratedChord | null;
}

const Stage1MetaForm: React.FC<Stage1Props> = ({ bpm, keyName, tonality, seed, styleName, currentChord }) => {
    const tonicLabel = keyName ?? '—';
    const modeLabel = tonalityToShortMode(tonality);
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
                    {tonalityToHumanScale(tonality)}
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
    palette: ArrangedTrack['palette'] | undefined;
    roster: import('../core/generation/types').BandRoster | undefined;
    mutedParts: Set<PartName>;
    onToggleMute: (partName: PartName) => void;
}

const ROLE_TO_PALETTE_KEY: Record<InstrumentRole, keyof NonNullable<ArrangedTrack['palette']>> = {
    melody: 'melodySound',
    vocal: 'vocalSound',
    chord: 'chordSound',
    bass: 'bassSound',
    drums: 'drumSound',
    counter: 'counterMelodySound',
    secondary: 'secondaryMelodySound',
};

const ALL_ROLES: InstrumentRole[] = ['melody', 'vocal', 'chord', 'bass', 'drums', 'counter', 'secondary'];

const Stage5Ensemble: React.FC<Stage5Props> = ({ palette, roster, mutedParts, onToggleMute }) => {
    if (!palette) {
        return (
            <section className="px-4 pt-4 pb-4">
                <StageBadge label="Stage 04: Ensemble" color="rgb(244, 63, 94)" />
                <div className="mt-3 text-zinc-600 text-xs">— 未编制 —</div>
            </section>
        );
    }
    const rosterRows: { label: string; name: string | undefined; color: string }[] = [
        { label: 'Vocal',   name: roster?.vocal?.name,   color: 'text-pink-300' },
        { label: 'Lead',    name: roster?.lead?.name,    color: 'text-emerald-300' },
        { label: 'Comping', name: roster?.comping?.name, color: 'text-amber-300' },
        { label: 'Bass',    name: roster?.bass?.name,    color: 'text-blue-300' },
        { label: 'Drum',    name: roster?.drum?.name,    color: 'text-fuchsia-300' },
    ];
    const anyRosterFilled = rosterRows.some(r => r.name);
    return (
        <section className="px-4 pt-4 pb-4">
            <StageBadge label="Stage 04: Ensemble" color="rgb(244, 63, 94)" />
            {anyRosterFilled && (
                <div className="mt-2 text-[10px] text-zinc-500 leading-relaxed">
                    {rosterRows.map(r => (
                        <div key={r.label}>
                            {r.label}: {r.name
                                ? <span className={r.color}>{r.name}</span>
                                : <span className="text-zinc-700">—</span>}
                        </div>
                    ))}
                </div>
            )}
            <div className="mt-3 space-y-1">
                {ALL_ROLES.map((role) => {
                    const key = ROLE_TO_PALETTE_KEY[role];
                    const sound = palette[key];
                    if (!sound) return null;
                    const partName = ROLE_TO_PART_NAME[role];
                    const isMuted = mutedParts.has(partName);
                    return (
                        <div
                            key={role}
                            className={
                                'flex items-center gap-2 px-2 py-1 rounded text-[11px] ' +
                                (isMuted ? 'bg-red-900/20 border border-red-500/30'
                                    : 'border border-transparent')
                            }
                        >
                            <span className="w-14 text-[9px] uppercase tracking-widest text-zinc-500">{role}</span>
                            <span className={
                                'flex-1 text-xs truncate ' +
                                (isMuted ? 'text-zinc-600 line-through' : 'text-zinc-300')
                            }>{String(sound)}</span>
                            <button
                                onClick={() => onToggleMute(partName)}
                                title={isMuted ? `Unmute ${role}` : `Mute ${role}`}
                                className={
                                    'p-0.5 rounded transition-colors shrink-0 ' +
                                    (isMuted ? 'text-red-400 hover:text-red-300' : 'text-zinc-500 hover:text-zinc-200')
                                }
                            >
                                {isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                            </button>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};
