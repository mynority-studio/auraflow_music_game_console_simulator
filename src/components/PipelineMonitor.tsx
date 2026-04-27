import React, { useEffect, useRef, useState } from 'react';
import { AudioEngine } from '../core/audio/AudioEngine';
import { PRNGManager } from '../core/utils/PRNG';
import {
    ArrangedTrack,
    GeneratedChord,
    MusicContext,
    SectionMetadata,
    TonalityName,
    Tonality,
    InstrumentRole,
    ConductorSectionPlan,
} from '../core/generation/types';
import { MoodRegistry } from '../core/generation/config/MoodFlags';
import { StyleIdName } from '../core/generation/config/StyleFlags';

const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const QUALITY_SUFFIX: Record<string, string> = {
    Major: '', Minor: 'm', Diminished: 'dim', Diminished7: 'dim7', Augmented: 'aug',
    Dominant7: '7', Minor7: 'm7', Major7: 'maj7', HalfDiminished: 'm7b5',
    Sus4: 'sus4', Dominant7Sus4: '7sus4', Add9: 'add9',
    Minor9: 'm9', Major9: 'maj9', Dominant9: '9', Minor11: 'm11', Dominant13: '13',
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
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        const keysPressed = new Set<string>();
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.repeat) return;
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

    const conductorPlanForCurrent = context?.conductorPlan?.sections.find(
        s => currentSection
            && s.sectionName === currentSection.name
            && Math.abs(s.startBeat - currentSection.startBeat) < 1e-6,
    ) ?? null;

    return (
        <div
            className="fixed z-50 right-4 top-4 flex bg-zinc-950/90 backdrop-blur-md rounded-2xl border border-zinc-800 shadow-[0_8px_30px_rgba(0,0,0,0.6)] overflow-hidden"
            style={{ width: '640px', maxHeight: '92vh', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
        >
            {/* close */}
            <button
                onClick={() => setIsVisible(false)}
                className="absolute top-2 right-2 z-10 text-zinc-600 hover:text-white text-xs px-1"
                title="Q+H 切换"
            >×</button>

            {/* 左栏：Stage 01-02 */}
            <div className="w-1/2 overflow-y-auto custom-pipeline-scroll border-r border-zinc-800/60">
                <Stage1MetaForm
                    bpm={arranged?.bpm}
                    keyName={arranged?.key}
                    tonality={context?.tonality}
                    seed={seed}
                    moodName={context?.moodId !== undefined ? MoodRegistry[context.moodId]?.name : undefined}
                    styleName={context?.style ? StyleIdName[context.style.id] : undefined}
                    trajectory={context?.trajectoryProfile}
                />
                <Stage2Harmony
                    chords={chords}
                    currentSection={currentSection}
                    currentChordIdx={currentChordIdx}
                />
            </div>

            {/* 右栏：Stage 03-05 */}
            <div className="w-1/2 overflow-y-auto custom-pipeline-scroll">
                <Stage3Structure
                    sections={sections}
                    currentSectionIdx={currentSectionIdx}
                    beatsPerBar={arranged?.timeSignature?.[0]}
                />
                <Stage4Conductor
                    plan={conductorPlanForCurrent}
                    globalRhythm={context?.conductorPlan?.globalRhythmProfile}
                />
                <Stage5Ensemble
                    palette={arranged?.palette}
                    plan={conductorPlanForCurrent}
                />
            </div>

            <style dangerouslySetInnerHTML={{ __html: `
                .custom-pipeline-scroll::-webkit-scrollbar { width: 4px; }
                .custom-pipeline-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.3); }
                .custom-pipeline-scroll::-webkit-scrollbar-thumb { background: rgba(82,82,91,0.5); border-radius: 2px; }
                .custom-pipeline-scroll::-webkit-scrollbar-thumb:hover { background: rgba(161,161,170,0.6); }
            `}} />
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
    moodName: string | undefined;
    styleName: string | undefined;
    trajectory: { sync: string; path: string } | undefined;
}

const Stage1MetaForm: React.FC<Stage1Props> = ({ bpm, keyName, tonality, seed, moodName, styleName, trajectory }) => {
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

            <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                    <FieldLabel>Seed</FieldLabel>
                    <div className="text-white text-xs break-all">{seed || '—'}</div>
                </div>
                <div>
                    <FieldLabel>Emotion</FieldLabel>
                    <div className="text-amber-400 text-sm font-bold uppercase">{moodName ?? '—'}</div>
                </div>
            </div>

            <div className="mt-3">
                <FieldLabel>Style Profile</FieldLabel>
                <div className="text-cyan-400 text-sm font-bold uppercase tracking-wide">{styleName ?? '—'}</div>
            </div>

            <div className="mt-3">
                <FieldLabel>Melody Scale</FieldLabel>
                <div className="text-white text-sm">{tonalityToHumanScale(tonality)}</div>
            </div>

            <div className="mt-3">
                <FieldLabel>Trajectory & Rhythm</FieldLabel>
                <div className="text-amber-400 text-xs leading-relaxed">
                    <div>Sync: {trajectory?.sync ?? '—'}</div>
                    <div>Path: {trajectory?.path ?? '—'}</div>
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

interface Stage4Props {
    plan: ConductorSectionPlan | null;
    globalRhythm: string | undefined;
}

const Stage4Conductor: React.FC<Stage4Props> = ({ plan, globalRhythm }) => {
    if (!plan) {
        return (
            <section className="px-4 pt-4 pb-3 border-b border-zinc-800/60">
                <StageBadge label="Stage 04: Conductor" color="rgb(168, 85, 247)" />
                <div className="mt-3 text-zinc-600 text-xs">— 无指挥计划 —</div>
            </section>
        );
    }
    return (
        <section className="px-4 pt-4 pb-3 border-b border-zinc-800/60">
            <StageBadge label="Stage 04: Conductor" color="rgb(168, 85, 247)" />
            <div className="mt-3 space-y-2 text-[11px]">
                <RoleRow label="Focus" roles={[plan.focusInstrument]} color="text-purple-300" />
                <RoleRow label="Support" roles={plan.supportInstruments} color="text-zinc-300" />
                <RoleRow label="Silent" roles={plan.silentInstruments} color="text-zinc-600" />
                <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                        <div className="text-[9px] uppercase tracking-widest text-zinc-500">Rhythm</div>
                        <div className="text-purple-300 text-xs">{plan.rhythmCenter}</div>
                    </div>
                    <div>
                        <div className="text-[9px] uppercase tracking-widest text-zinc-500">Global</div>
                        <div className="text-purple-300 text-xs">{globalRhythm ?? '—'}</div>
                    </div>
                </div>
                {plan.fillWindows.length > 0 && (
                    <div>
                        <div className="text-[9px] uppercase tracking-widest text-zinc-500">Fill @</div>
                        <div className="text-amber-400 text-xs">{plan.fillWindows.map(b => b.toFixed(1)).join(', ')}</div>
                    </div>
                )}
            </div>
        </section>
    );
};

const RoleRow: React.FC<{ label: string; roles: InstrumentRole[]; color: string }> = ({ label, roles, color }) => (
    <div className="flex items-baseline gap-2">
        <span className="text-[9px] uppercase tracking-widest text-zinc-500 w-14">{label}</span>
        <div className="flex flex-wrap gap-1">
            {roles.length === 0
                ? <span className="text-zinc-700 text-[11px]">—</span>
                : roles.map((r, i) => <span key={i} className={`text-[11px] ${color}`}>{r}</span>)}
        </div>
    </div>
);

interface Stage5Props {
    palette: ArrangedTrack['palette'] | undefined;
    plan: ConductorSectionPlan | null;
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

const Stage5Ensemble: React.FC<Stage5Props> = ({ palette, plan }) => {
    if (!palette) {
        return (
            <section className="px-4 pt-4 pb-4">
                <StageBadge label="Stage 05: Ensemble" color="rgb(244, 63, 94)" />
                <div className="mt-3 text-zinc-600 text-xs">— 未编制 —</div>
            </section>
        );
    }
    return (
        <section className="px-4 pt-4 pb-4">
            <StageBadge label="Stage 05: Ensemble" color="rgb(244, 63, 94)" />
            <div className="mt-3 space-y-1">
                {ALL_ROLES.map((role) => {
                    const key = ROLE_TO_PALETTE_KEY[role];
                    const sound = palette[key];
                    if (!sound) return null;
                    let status: 'focus' | 'support' | 'silent' | 'idle' = 'idle';
                    if (plan) {
                        if (plan.focusInstrument === role) status = 'focus';
                        else if (plan.supportInstruments.indexOf(role) >= 0) status = 'support';
                        else if (plan.silentInstruments.indexOf(role) >= 0) status = 'silent';
                    }
                    return (
                        <div
                            key={role}
                            className={
                                'flex items-center gap-2 px-2 py-1 rounded text-[11px] ' +
                                (status === 'focus' ? 'bg-rose-500/15 border border-rose-400/50'
                                    : status === 'silent' ? 'opacity-40 border border-transparent'
                                        : 'border border-transparent')
                            }
                        >
                            <span className={
                                'w-14 text-[9px] uppercase tracking-widest ' +
                                (status === 'focus' ? 'text-rose-300 font-bold' : 'text-zinc-500')
                            }>{role}</span>
                            <span className={
                                'flex-1 text-xs truncate ' +
                                (status === 'silent' ? 'text-zinc-600 line-through' : 'text-zinc-300')
                            }>{String(sound)}</span>
                            {status === 'focus' && <span className="text-[9px] text-rose-400">●</span>}
                            {status === 'support' && <span className="text-[9px] text-zinc-500">○</span>}
                        </div>
                    );
                })}
            </div>
        </section>
    );
};
