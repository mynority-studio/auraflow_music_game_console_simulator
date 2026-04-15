import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, useDragControls } from 'motion/react';
import { Sprout, Play, Square, Volume2, VolumeX, X, Dice5 } from 'lucide-react';
import { AudioEngine, startAudioContext } from '../core/audio/AudioEngine';
import { PartName } from '../core/audio/PlaybackEngine';
import { PRNGManager } from '../core/utils/PRNG';
import { MelodyEngine } from '../core/generation/MelodyEngine';
import { StyleId } from '../core/generation/config/StyleFlags';
import { globalMidiScheduler } from '../core/audio/MidiScheduler';

// 🌟 声部清单（顺序即 UI 显示顺序）
const PARTS: { name: PartName; label: string }[] = [
    { name: 'vocal',          label: 'Vocal' },
    { name: 'melody',         label: 'Melody' },
    { name: 'secondaryMelody', label: 'Second.' },
    { name: 'counterMelody',  label: 'Counter' },
    { name: 'chord',          label: 'Chord' },
    { name: 'bass',           label: 'Bass' },
    { name: 'drums',          label: 'Drums' },
];

// 复现 EndlessRadioManager 的 style 选择逻辑，让 seed 能 100% 复现 Radio 的任意歌曲
const RADIO_STYLE_POOL: StyleId[] = [StyleId.Default, StyleId.DarkSynthPop];

type PlayState = 'IDLE' | 'GENERATING' | 'PLAYING';

export const SeedController: React.FC = () => {
    const [isVisible, setIsVisible] = useState(false);
    const [seedInput, setSeedInput] = useState('42');
    const [currentSeed, setCurrentSeed] = useState<number | null>(null);
    const [playState, setPlayState] = useState<PlayState>('IDLE');
    const [mutedParts, setMutedParts] = useState<Set<PartName>>(new Set());
    const dragControls = useDragControls();
    // 用 ref 存 playState 供 onTrackEnd 回调（避免闭包陈旧）
    const playStateRef = useRef<PlayState>('IDLE');
    playStateRef.current = playState;
    // 当前要循环的 seed（避免用户输入新 seed 后还循环旧的）
    const activeSeedRef = useRef<number | null>(null);

    // Q+S 快捷键
    useEffect(() => {
        const keysPressed = new Set<string>();
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.repeat) return;
            // 在输入框里按键不触发快捷键
            const target = e.target as HTMLElement;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
            keysPressed.add(e.key.toLowerCase());
            if (keysPressed.has('q') && keysPressed.has('s')) {
                setIsVisible(prev => !prev);
            }
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

    // 重新应用 mute 状态 —— 新歌曲 load 后 channel 可能变，需要重新 mute
    const reapplyMutes = useCallback(() => {
        for (const { name } of PARTS) {
            AudioEngine.setPartMute(name, mutedParts.has(name));
        }
    }, [mutedParts]);

    // 用指定 seed 生成并播放
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

        // 检查 seed 是否被抢占（用户在生成中途又点了其他 seed）
        if (activeSeedRef.current !== seed) return;

        await AudioEngine.playSong(track, styleId, context, melodyEngine);
        setPlayState('PLAYING');

        // 应用 mute 状态到新分配的 channel
        reapplyMutes();

        // 监听播放结束 → 同 seed 循环
        globalMidiScheduler.onTrackEnd(() => {
            if (activeSeedRef.current === seed && playStateRef.current === 'PLAYING') {
                // 递归复用同一 seed
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
            // 立即应用到当前播放的 channel
            AudioEngine.setPartMute(partName, muted);
            return next;
        });
    }, []);

    if (!isVisible) return null;

    return (
        <motion.div
            drag
            dragControls={dragControls}
            dragListener={false}
            dragMomentum={false}
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed z-50 top-20 left-5 flex flex-col"
            style={{ width: 260 }}
        >
            <div className="flex flex-col bg-zinc-900/95 backdrop-blur-2xl rounded-2xl border border-emerald-500/30 shadow-[0_20px_50px_rgba(0,0,0,0.6)] overflow-hidden">

                {/* Header (Draggable) */}
                <div
                    className="flex items-center justify-between px-4 py-3 border-b border-emerald-500/20 cursor-grab active:cursor-grabbing bg-gradient-to-b from-zinc-800/60 to-transparent"
                    onPointerDown={(e) => dragControls.start(e)}
                >
                    <div className="flex items-center gap-2">
                        <Sprout className="w-4 h-4 text-emerald-400" />
                        <h3 className="text-emerald-400 font-bold tracking-widest text-xs uppercase">
                            Seed Lab
                        </h3>
                    </div>
                    <button
                        onClick={() => setIsVisible(false)}
                        className="text-zinc-400 hover:text-white transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 flex flex-col gap-4">

                    {/* Seed Input + Random */}
                    <div>
                        <label className="text-[10px] text-emerald-400/70 uppercase tracking-wider font-bold mb-1.5 block">
                            Seed
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={seedInput}
                                onChange={(e) => setSeedInput(e.target.value.replace(/[^0-9]/g, ''))}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handlePlay();
                                }}
                                placeholder="e.g. 2332053069"
                                className="flex-1 bg-black/50 border border-emerald-500/20 rounded px-2 py-1.5 text-xs font-mono text-emerald-300 placeholder-zinc-600 focus:outline-none focus:border-emerald-400/60"
                            />
                            <button
                                onClick={handleRandom}
                                title="Random seed"
                                className="px-2 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-white/5 rounded text-zinc-300 transition-colors"
                            >
                                <Dice5 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                        {currentSeed !== null && (
                            <div className="mt-1.5 text-[10px] text-zinc-500 font-mono">
                                now playing: <span className="text-emerald-300">{currentSeed}</span>
                            </div>
                        )}
                    </div>

                    {/* Play / Stop */}
                    <div className="flex gap-2">
                        <button
                            onClick={handlePlay}
                            disabled={playState === 'GENERATING'}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-bold uppercase tracking-wider transition-all ${
                                playState === 'GENERATING'
                                    ? 'bg-zinc-700 text-zinc-500 cursor-wait'
                                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_4px_12px_rgba(16,185,129,0.3)]'
                            }`}
                        >
                            <Play className="w-3.5 h-3.5" />
                            {playState === 'GENERATING' ? 'Gen...' : 'Play'}
                        </button>
                        <button
                            onClick={handleStop}
                            disabled={playState === 'IDLE'}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-bold uppercase tracking-wider transition-all ${
                                playState === 'IDLE'
                                    ? 'bg-zinc-800/50 text-zinc-600 cursor-not-allowed'
                                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-white/10'
                            }`}
                        >
                            <Square className="w-3.5 h-3.5" />
                            Stop
                        </button>
                    </div>

                    {/* Play State Indicator */}
                    <div className="flex items-center gap-2 text-[10px] font-mono">
                        <div className={`w-1.5 h-1.5 rounded-full ${
                            playState === 'PLAYING' ? 'bg-emerald-400 animate-pulse' :
                            playState === 'GENERATING' ? 'bg-yellow-400 animate-pulse' :
                            'bg-zinc-600'
                        }`} />
                        <span className="text-zinc-500 uppercase tracking-wider">{playState}</span>
                        {playState === 'PLAYING' && (
                            <span className="text-zinc-600 ml-auto">↻ loop</span>
                        )}
                    </div>

                    {/* Mute Grid */}
                    <div>
                        <label className="text-[10px] text-emerald-400/70 uppercase tracking-wider font-bold mb-1.5 block">
                            Focus Mute
                        </label>
                        <div className="grid grid-cols-2 gap-1.5">
                            {PARTS.map(({ name, label }) => {
                                const isMuted = mutedParts.has(name);
                                return (
                                    <button
                                        key={name}
                                        onClick={() => togglePartMute(name)}
                                        className={`flex items-center justify-between px-2 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${
                                            isMuted
                                                ? 'bg-red-900/40 border border-red-500/50 text-red-300'
                                                : 'bg-zinc-800 border border-white/5 text-zinc-300 hover:bg-zinc-700'
                                        }`}
                                    >
                                        <span>{label}</span>
                                        {isMuted
                                            ? <VolumeX className="w-3 h-3" />
                                            : <Volume2 className="w-3 h-3" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Tip */}
                    <div className="text-[9px] text-zinc-600 leading-snug border-t border-white/5 pt-2">
                        Q+S 切换 · 拖拽标题栏移动 · Enter 直接播放
                    </div>
                </div>
            </div>
        </motion.div>
    );
};
