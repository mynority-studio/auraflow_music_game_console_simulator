import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, useDragControls } from 'motion/react';
import { Activity, Play, Square, X, Dice5, Volume2, VolumeX } from 'lucide-react';
import { AudioEngine, startAudioContext } from '../core/audio/AudioEngine';
import { PartName } from '../core/audio/PlaybackEngine';
import { globalMidiScheduler } from '../core/audio/MidiScheduler';
import { PRNGManager } from '../core/utils/PRNG';
import { MelodyEngine } from '../core/generation/MelodyEngine';
import {
    ArrangedTrack,
    GeneratedChord,
    MusicContext,
    SectionMetadata,
    TonalityName,
    Tonality,
    InstrumentRole,
    ChordQuality,
} from '../core/generation/types';
import { StyleId, StyleIdName } from '../core/generation/config/StyleFlags';

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

// 复现 EndlessRadioManager 的 style 选择逻辑，让 seed 100% 复现 Radio 的任意歌曲
const RADIO_STYLE_POOL: StyleId[] = [StyleId.ModernPop, StyleId.ChillJazz, StyleId.NeoSoul];

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

interface FrameSnapshot {
    arranged: ArrangedTrack | null;
    context: MusicContext | null;
    beat: number;
    seed: number;
}

export const PipelineMonitor: React.FC = () => {
    const [isVisible, setIsVisible] = useState(true);
    const [frame, setFrame] = useState<FrameSnapshot>({
        arranged: null, context: null, beat: 0, seed: 0,
    });
    const [seedInput, setSeedInput] = useState('42');
    const [currentSeed, setCurrentSeed] = useState<number | null>(null);
    const [playState, setPlayState] = useState<PlayState>('IDLE');
    const [mutedParts, setMutedParts] = useState<Set<PartName>>(new Set());
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

        // 让 UI 先渲染一次
        await new Promise(resolve => setTimeout(resolve, 50));

        // 复现 EndlessRadioManager.triggerGeneration 的 PRNG 消耗顺序
        PRNGManager.setSeed(seed);
        PRNGManager.recordSnapshot('A');
        const styleId = RADIO_STYLE_POOL[Math.floor(PRNGManager.next() * RADIO_STYLE_POOL.length)];

        const melodyEngine = new MelodyEngine();
        const { track, context } = melodyEngine.generateFullSong(styleId);

        // 检查 seed 是否被抢占
        if (activeSeedRef.current !== seed) return;

        await AudioEngine.playSong(track, styleId, context, melodyEngine);
        setPlayState('PLAYING');

        // 应用 mute 到新分配的 channel
        reapplyMutes();

        // 监听播放结束 → 同 seed 循环
        globalMidiScheduler.onTrackEnd(() => {
            if (activeSeedRef.current === seed && playStateRef.current === 'PLAYING') {
                playSeed(seed);
            }
        });
    }, [reapplyMutes]);

    const handlePlay = useCallback(async () => {
        const seed = parseInt(seedInput, 10);
        if (isNaN(seed) || seed < 0) return;
        await playSeed(seed >>> 0);
    }, [seedInput, playSeed]);

    const handleStop = useCallback(() => {
        activeSeedRef.current = null;
        AudioEngine.stop();
        setPlayState('IDLE');
    }, []);

    const handleRandom = useCallback(() => {
        const newSeed = (Date.now() ^ Math.floor(Math.random() * 1000000)) >>> 0;
        setSeedInput(String(newSeed));
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

            {/* Seed Lab：种子输入 + Play/Stop/Random（原 Q+S 整合） */}
            <div className="px-4 py-2.5 border-b border-zinc-800/80 bg-zinc-900/40 shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-[9px] uppercase tracking-widest text-emerald-400/80 font-bold w-12 shrink-0">Seed</span>
                    <input
                        type="text"
                        value={seedInput}
                        onChange={(e) => setSeedInput(e.target.value.replace(/[^0-9]/g, ''))}
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
            </div>

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
}

const Stage1MetaForm: React.FC<Stage1Props> = ({ bpm, keyName, tonality, seed, styleName }) => {
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
                <div className="text-white text-sm">{tonalityToHumanScale(tonality)}</div>
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
                        return (
                            <div
                                key={idx}
                                title={chord.numeral}
                                className={
                                    'px-3 py-2 rounded-lg border text-base font-bold ' +
                                    (isCurrent
                                        ? 'border-emerald-400 text-white bg-black/60 ring-1 ring-emerald-400/40'
                                        : 'border-zinc-700 text-zinc-300 bg-black/30')
                                }
                            >
                                {chordToAbsoluteName(chord)}
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
    const leadName = roster?.lead?.name;
    const compingName = roster?.comping?.name;
    return (
        <section className="px-4 pt-4 pb-4">
            <StageBadge label="Stage 04: Ensemble" color="rgb(244, 63, 94)" />
            {(leadName || compingName) && (
                <div className="mt-2 text-[10px] text-zinc-500 leading-relaxed">
                    {leadName && <div>Lead: <span className="text-emerald-300">{leadName}</span></div>}
                    {compingName && <div>Comping: <span className="text-amber-300">{compingName}</span></div>}
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
