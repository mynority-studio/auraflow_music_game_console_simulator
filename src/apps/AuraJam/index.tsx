import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine, getAudioContext } from '../../core/audio/AudioEngine';
import { JamSessionManager, JamAppState } from './JamSessionManager';
import { ScaleEngine, ScaleState } from './ScaleEngine';

// --- Drum Map (same as AuraBar) ---
const DRUM_MAP: Record<string, number> = {
    '0-2': 38, '1-2': 38, '2-2': 42, '3-2': 36, '4-2': 36,
    '0-1': 41, '1-1': 45, '2-1': 48, '3-1': 46, '4-1': 49,
    '0-0': 39, '1-0': 37, '2-0': 54, '3-0': 56,
};

// --- Jam Melody Notes (from AuraBar) ---
function getJamMelodyNotes(chord: any, tonality: any, keyOffset: number): number[] {
    let scalePcs = [0, 2, 4, 7, 9];
    let rootPc = 0;

    if (chord) {
        const chordKeyOffset = chord.keyOffset !== undefined ? chord.keyOffset : keyOffset;
        rootPc = ((chord.root + chordKeyOffset) % 12 + 12) % 12;
        const q = chord.quality as string;
        if (q === 'Minor' || q === 'Diminished' || q === 'Minor7' || q === 'HalfDiminished' || q === 'Diminished7' || q === 'Minor9' || q === 'Minor11') {
            scalePcs = [0, 3, 5, 7, 10].map(i => (rootPc + i) % 12);
        } else {
            scalePcs = [0, 2, 4, 7, 9].map(i => (rootPc + i) % 12);
        }
    } else {
        rootPc = (keyOffset % 12 + 12) % 12;
        scalePcs = [0, 2, 4, 7, 9].map(i => (rootPc + i) % 12);
    }

    scalePcs.sort((a, b) => a - b);
    let rootIdx = scalePcs.indexOf(rootPc);
    if (rootIdx === -1) rootIdx = 0;

    const notes: number[] = [];
    let currentOctave = 5;
    let currentIdx = rootIdx;
    let baseNote = rootPc + 12 * currentOctave;
    if (baseNote < 55) baseNote += 12;
    if (baseNote > 67) baseNote -= 12;
    currentOctave = Math.floor(baseNote / 12);

    for (let i = 0; i < 14; i++) {
        notes.push(scalePcs[currentIdx] + 12 * currentOctave);
        currentIdx++;
        if (currentIdx >= scalePcs.length) { currentIdx = 0; currentOctave++; }
    }
    return notes;
}

interface AuraJamProps {
    activeKeys: Set<string>;
    onExit?: () => void;
}

export function AuraJam({ activeKeys, onExit }: AuraJamProps) {
    const managerRef = useRef<JamSessionManager | null>(null);
    const [appState, setAppState] = useState<JamAppState>('SCALE_VIEW');
    const [scaleState, setScaleState] = useState<ScaleState | null>(null);
    const [recordingInfo, setRecordingInfo] = useState({ eventCount: 0, elapsedMs: 0 });

    const prevActiveKeysRef = useRef<Set<string>>(new Set());
    const fnTapCount = useRef(0);
    const fnTapTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Arp state (same as AuraBar)
    const arpStateRef = useRef({
        heldIndices: new Map<string, number>(),
        centerIdx: 0,
        step: 0,
        patternIdx: 0,
        intervalId: null as ReturnType<typeof setInterval> | null,
        lastPlayedNote: -1
    });

    // Initialize
    useEffect(() => {
        const mgr = new JamSessionManager();
        mgr.onStateChange(setAppState);
        managerRef.current = mgr;
        setScaleState(mgr.getScaleState());
        return () => {
            mgr.stopPlayback();
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        };
    }, []);

    // Recording timer update
    useEffect(() => {
        if (appState === 'RECORDING') {
            recordingTimerRef.current = setInterval(() => {
                if (managerRef.current) {
                    setRecordingInfo(managerRef.current.getRecordingInfo());
                }
            }, 100);
        } else {
            if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
                recordingTimerRef.current = null;
            }
        }
    }, [appState]);

    // --- Input Handling ---
    useEffect(() => {
        const current = activeKeys;
        const prev = prevActiveKeysRef.current;
        const added = Array.from<string>(current).filter(k => !prev.has(k));
        const removed = Array.from<string>(prev).filter(k => !current.has(k));

        // --- Key Up ---
        removed.forEach(keyId => {
            const parts = keyId.split('-');
            if (parts.length !== 3) return;
            const c = parseInt(parts[1]);
            const r = parseInt(parts[2]);

            // Cancel long press
            if (current.has('key-4-0') || prev.has('key-4-0')) {
                if ((c === 0 && r === 0) || (c === 1 && r === 0) || (c === 4 && r === 0)) {
                    if (longPressTimeout.current) {
                        clearTimeout(longPressTimeout.current);
                        longPressTimeout.current = null;
                    }
                }
            }

            // Recording noteOff
            if (appState === 'RECORDING') {
                const idx = ScaleEngine.padIndex(c, r);
                if (idx >= 0 && scaleState) {
                    const note = scaleState.noteMap[idx];
                    AudioEngine.noteOff(0, note);
                    managerRef.current?.recordNoteOff(idx);
                }
            }

            // Jam melody noteOff
            if (appState === 'JAMMING_MELODY') {
                arpStateRef.current.heldIndices.delete(keyId);
                if (arpStateRef.current.heldIndices.size === 0) {
                    if (arpStateRef.current.intervalId) {
                        clearInterval(arpStateRef.current.intervalId);
                        arpStateRef.current.intervalId = null;
                    }
                    if (arpStateRef.current.lastPlayedNote !== -1) {
                        AudioEngine.noteOff(0, arpStateRef.current.lastPlayedNote);
                        arpStateRef.current.lastPlayedNote = -1;
                    }
                } else {
                    const lastKey = Array.from(arpStateRef.current.heldIndices.keys()).pop();
                    if (lastKey) {
                        arpStateRef.current.centerIdx = arpStateRef.current.heldIndices.get(lastKey)!;
                    }
                }
            }
        });

        // --- Key Down ---
        added.forEach(keyId => {
            const parts = keyId.split('-');
            if (parts.length !== 3) return;
            const c = parseInt(parts[1]);
            const r = parseInt(parts[2]);

            const ctx = getAudioContext();
            if (ctx.state !== 'running') ctx.resume();

            const isFnPressed = current.has('key-4-0');
            const isJamming = appState === 'JAMMING_DRUMS' || appState === 'JAMMING_MELODY' || appState === 'PREPARING_JAM';

            // --- FN Key ---
            if (c === 4 && r === 0) {
                if (isJamming) {
                    managerRef.current?.exitJam();
                    return;
                }

                fnTapCount.current++;
                if (fnTapTimeout.current) clearTimeout(fnTapTimeout.current);
                fnTapTimeout.current = setTimeout(() => {
                    const count = fnTapCount.current;
                    fnTapCount.current = 0;

                    if (count === 1) {
                        if (appState === 'SCALE_VIEW') {
                            const newScale = managerRef.current?.refreshScale();
                            if (newScale) setScaleState(newScale);
                        }
                    } else if (count === 2) {
                        if (appState === 'SCALE_VIEW') {
                            managerRef.current?.startRecording();
                        } else if (appState === 'RECORDING') {
                            managerRef.current?.stopRecordingAndGenerate();
                        }
                    } else if (count >= 3) {
                        if (appState === 'RECORDING') {
                            managerRef.current?.cancelRecording();
                        } else if (appState === 'PLAYING') {
                            managerRef.current?.stopPlayback();
                        } else if (appState === 'SCALE_VIEW') {
                            onExit?.();
                        }
                    }
                }, 300);
                return;
            }

            // --- FN + combo for Jam ---
            if (isFnPressed) {
                if (c === 0 && r === 0 && appState === 'PLAYING') {
                    if (longPressTimeout.current) clearTimeout(longPressTimeout.current);
                    longPressTimeout.current = setTimeout(() => managerRef.current?.prepareJam('drums'), 500);
                } else if (c === 1 && r === 0 && appState === 'PLAYING') {
                    if (longPressTimeout.current) clearTimeout(longPressTimeout.current);
                    longPressTimeout.current = setTimeout(() => managerRef.current?.prepareJam('melody'), 500);
                }
                return;
            }

            // --- SCALE_VIEW: audition notes ---
            if (appState === 'SCALE_VIEW' && scaleState) {
                const idx = ScaleEngine.padIndex(c, r);
                if (idx >= 0) {
                    const note = scaleState.noteMap[idx];
                    AudioEngine.playNote(0, note, 100, 300);
                }
                return;
            }

            // --- RECORDING: play + record ---
            if (appState === 'RECORDING' && scaleState) {
                const idx = ScaleEngine.padIndex(c, r);
                if (idx >= 0) {
                    const note = scaleState.noteMap[idx];
                    AudioEngine.noteOn(0, note, 100);
                    managerRef.current?.recordNoteOn(idx, note, 100);
                }
                return;
            }

            // --- JAMMING_DRUMS ---
            if (appState === 'JAMMING_DRUMS') {
                const note = DRUM_MAP[`${c}-${r}`];
                if (note) {
                    AudioEngine.playNote(9, note, 127, 100);
                    AudioEngine.emitVisualEvent({ type: 'drums', midiNote: note, velocity: 127, source: 'gameplay' });
                    managerRef.current?.recordUserDrum(note, 127);
                }
                return;
            }

            // --- JAMMING_MELODY ---
            if (appState === 'JAMMING_MELODY') {
                const track = managerRef.current?.currentSong;
                if (track) {
                    let idx = -1;
                    if (r === 2) idx = c;
                    else if (r === 1) idx = 5 + c;
                    else if (r === 0 && c < 4) idx = 10 + c;

                    if (idx !== -1) {
                        arpStateRef.current.heldIndices.set(keyId, idx);
                        arpStateRef.current.centerIdx = idx;

                        const chord = managerRef.current?.getCurrentChord();
                        const notes = getJamMelodyNotes(chord, track.tonality, track.keyOffset);
                        const note = notes[idx];

                        if (arpStateRef.current.lastPlayedNote !== -1) {
                            AudioEngine.noteOff(0, arpStateRef.current.lastPlayedNote);
                        }
                        if (note) {
                            AudioEngine.noteOn(0, note, 100);
                            AudioEngine.emitVisualEvent({ type: 'melody', midiNote: note, velocity: 100, source: 'gameplay' });
                            arpStateRef.current.lastPlayedNote = note;
                            arpStateRef.current.step = 1;
                        }

                        if (!arpStateRef.current.intervalId) {
                            arpStateRef.current.intervalId = setInterval(() => {
                                const state = arpStateRef.current;
                                if (state.heldIndices.size === 0) return;
                                const t = managerRef.current?.currentSong;
                                if (!t) return;
                                const ch = managerRef.current?.getCurrentChord();
                                const ns = getJamMelodyNotes(ch, t.tonality, t.keyOffset);
                                const patterns = [
                                    [0, 1, 2, 3, 2, 1, 0, -1, -2, -1],
                                    [0, 2, 1, 3, 2, 0, -1, -2, -1, 1],
                                    [0, -1, -2, -3, -2, -1, 0, 1, 2, 1],
                                    [0, 1, 0, 2, 0, -1, 0, -2]
                                ];
                                if (state.step % 8 === 0) {
                                    state.patternIdx = Math.floor(Math.random() * patterns.length);
                                }
                                const activePattern = patterns[state.patternIdx || 0];
                                const offset = activePattern[state.step % activePattern.length];
                                let targetIdx = Math.max(0, Math.min(13, state.centerIdx + offset));
                                const arpNote = ns[targetIdx];
                                if (state.lastPlayedNote !== -1) AudioEngine.noteOff(0, state.lastPlayedNote);
                                if (arpNote) {
                                    const vel = 80 + Math.floor(Math.random() * 30);
                                    AudioEngine.noteOn(0, arpNote, vel);
                                    AudioEngine.emitVisualEvent({ type: 'melody', midiNote: arpNote, velocity: vel, source: 'gameplay' });
                                    state.lastPlayedNote = arpNote;
                                }
                                state.step++;
                            }, 180);
                        }
                    }
                }
                return;
            }

            if (appState === 'PREPARING_JAM') return;
        });

        prevActiveKeysRef.current = new Set(current);
    }, [activeKeys, appState, scaleState, onExit]);

    // --- Render ---
    const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

    return (
        <div className="w-full h-full relative overflow-hidden bg-[#0A0A0A] text-white font-mono">
            {/* Scanlines */}
            <div className="absolute inset-0 pointer-events-none opacity-10"
                style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)' }} />

            {/* Header */}
            <div className="absolute top-2 left-3 right-3 flex items-center justify-between">
                <div className="text-[10px] text-amber-400/80 tracking-widest uppercase">
                    Aura Jam
                </div>
                <div className="text-[9px] text-white/40">
                    {appState === 'SCALE_VIEW' && 'FN:Refresh  2×FN:Record  3×FN:Exit'}
                    {appState === 'RECORDING' && '2×FN:Generate  3×FN:Cancel'}
                    {appState === 'GENERATING' && 'Generating...'}
                    {appState === 'PLAYING' && 'FN+Q:Drums  FN+W:Melody  3×FN:Stop'}
                    {(appState === 'JAMMING_DRUMS' || appState === 'JAMMING_MELODY') && 'FN:Exit Jam'}
                    {appState === 'PREPARING_JAM' && 'Count-in...'}
                </div>
            </div>

            {/* Scale Info (SCALE_VIEW / RECORDING) */}
            {(appState === 'SCALE_VIEW' || appState === 'RECORDING') && scaleState && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                    <div className="text-3xl font-bold text-amber-300" style={{ textShadow: '0 0 20px rgba(245,158,11,0.5)' }}>
                        {scaleState.keyName}
                    </div>
                    <div className="text-sm text-amber-200/60 mt-1">
                        {scaleState.tonalityName.replace(/_/g, ' ')}
                    </div>
                    {scaleState.noteMap.length > 0 && (
                        <div className="text-[9px] text-white/30 mt-2 tracking-wider">
                            {scaleState.noteMap.map(n => NOTE_NAMES[n % 12]).join(' ')}
                        </div>
                    )}
                </div>
            )}

            {/* Recording Indicator */}
            {appState === 'RECORDING' && (
                <div className="absolute inset-0 pointer-events-none border-2 border-red-500/60 animate-pulse rounded" />
            )}
            {appState === 'RECORDING' && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-center">
                    <div className="text-red-400 text-xs animate-pulse">
                        REC {Math.floor(recordingInfo.elapsedMs / 1000)}s
                        <span className="text-white/50 ml-2">{recordingInfo.eventCount} notes</span>
                    </div>
                </div>
            )}

            {/* Generating Overlay */}
            {appState === 'GENERATING' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <div className="text-center">
                        <div className="text-amber-400 text-lg animate-pulse">Generating</div>
                        <div className="text-white/40 text-xs mt-1">Building your song from motif...</div>
                    </div>
                </div>
            )}

            {/* Playing State */}
            {appState === 'PLAYING' && managerRef.current?.currentSong && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                    <div className="text-2xl font-bold text-green-400" style={{ textShadow: '0 0 20px rgba(34,197,94,0.4)' }}>
                        Playing
                    </div>
                    <div className="text-xs text-white/50 mt-1">
                        {managerRef.current.currentSong.key} | {managerRef.current.currentSong.bpm} BPM
                    </div>
                </div>
            )}

            {/* Jam Mode Indicator */}
            {appState === 'PREPARING_JAM' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <div className="text-yellow-400 text-xl animate-bounce">Count-in...</div>
                </div>
            )}
            {appState === 'JAMMING_DRUMS' && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                    <div className="text-2xl font-bold text-orange-400" style={{ textShadow: '0 0 20px rgba(251,146,60,0.5)' }}>
                        DRUM JAM
                    </div>
                </div>
            )}
            {appState === 'JAMMING_MELODY' && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                    <div className="text-2xl font-bold text-cyan-400" style={{ textShadow: '0 0 20px rgba(34,211,238,0.5)' }}>
                        MELODY JAM
                    </div>
                </div>
            )}
        </div>
    );
}
