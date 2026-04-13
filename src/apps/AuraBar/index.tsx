import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AudioEngine } from '../../core/audio/AudioEngine';
import { getAudioContext } from '../../core/audio/SynthManager';
import { systemAudio } from '../../system/SystemAudio'; 
import { EndlessRadioManager, AppState } from './EndlessRadioManager';
import { ALL_BARS, BarConfig } from './BarData';
import { PRNGManager } from '../../core/utils/PRNG';
import { SmartDrumEngine } from '../shared/SmartDrumEngine';
// Old types: chord.quality is a string ('Minor', 'Diminished', etc.), tonality is a string

interface AuraBarProps {
  activeKeys: Set<string>;
  onExit?: () => void;
}

export function AuraBar({ activeKeys, onExit }: AuraBarProps) {
  const managerRef = useRef<EndlessRadioManager | null>(null);
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [bars, setBars] = useState<BarConfig[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  const [currentStyleName, setCurrentStyleName] = useState<string>('');

  const tapTimeout = useRef<NodeJS.Timeout | null>(null);
  const tapCount = useRef(0);
  const lastTapKey = useRef<{c: number, r: number} | null>(null);
  
  const longPressTimeout = useRef<NodeJS.Timeout | null>(null);
  
  const swipeState = useRef({
    path: [] as {c: number, r: number, time: number}[],
    lastActionTime: 0
  });

  const activeKeysRef = useRef<Set<string>>(activeKeys);
  const prevActiveKeysRef = useRef<Set<string>>(new Set());

  // Jam Mode State
  const arpStateRef = useRef({
    intervalId: null as NodeJS.Timeout | null,
    heldIndices: new Map<string, number>(),
    lastPlayedNote: -1,
    step: 0,
    centerIdx: -1,
    patternIdx: 0
  });
  const [aiAssist, setAiAssist] = useState(false);
  const aiKeyTimeout = useRef<NodeJS.Timeout | null>(null);
  const smartDrumRef = useRef(new SmartDrumEngine());

  // Initialize Bars
  useEffect(() => {
    // Randomly select 1~7 bars
    const numBars = Math.floor(PRNGManager.next() * 7) + 1;
    const shuffled = [...ALL_BARS].sort(() => PRNGManager.next() - 0.5);
    const selected = shuffled.slice(0, numBars);
    
    // Sort alphabetically by name
    selected.sort((a, b) => a.name.localeCompare(b.name));
    setBars(selected);
  }, []);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    const manager = new EndlessRadioManager();
    manager.onStateChange((newState) => {
      setAppState(newState);
    });
    manager.onStyleChange = (styleName) => {
      setCurrentStyleName(styleName);
    };
    managerRef.current = manager;

    return () => {
      manager.stopPlayback();
    };
  }, []);

  // P 键长按切换 AI 辅助模式（仅在接管模式下生效）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'p' || e.repeat) return;
      const isJamming = appState === 'JAMMING_DRUMS' || appState === 'JAMMING_MELODY';
      if (!isJamming) return;
      aiKeyTimeout.current = setTimeout(() => {
        const newVal = managerRef.current?.toggleAiAssist() ?? false;
        setAiAssist(newVal);
      }, 500);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'p') return;
      if (aiKeyTimeout.current) {
        clearTimeout(aiKeyTimeout.current);
        aiKeyTimeout.current = null;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (aiKeyTimeout.current) clearTimeout(aiKeyTimeout.current);
    };
  }, [appState]);

  useEffect(() => {
    activeKeysRef.current = activeKeys;
  }, [activeKeys]);

  useEffect(() => {
    return () => {
      if (managerRef.current) {
        managerRef.current.stopPlayback();
      }
      if (tapTimeout.current) clearTimeout(tapTimeout.current);
    };
  }, []);

  useEffect(() => {
    const isPlaying = appState !== 'IDLE' && appState !== 'GENERATING';
    AudioEngine.emitVisualEvent({ type: 'fn_key_active', active: isPlaying } as any);
    return () => {
      AudioEngine.emitVisualEvent({ type: 'fn_key_active', active: false } as any);
    };
  }, [appState]);

  // --- Jam Mode Helpers ---
  const DRUM_MAP: Record<string, number> = {
    '0-2': 38, '1-2': 38, '2-2': 42, '3-2': 36, '4-2': 36, // Bottom row: Snare, Snare, Closed Hat, Kick, Kick
    '0-1': 41, '1-1': 45, '2-1': 48, '3-1': 46, '4-1': 49, // Middle row: Low Tom, Mid Tom, High Tom, Open Hat, Crash
    '0-0': 39, '1-0': 37, '2-0': 54, '3-0': 56,            // Top row: Clap, Rimshot, Tambourine, Cowbell (4-0 is Function)
  };

  const getJamMelodyNotes = (chord: any, tonality: string, keyOffset: number) => {
    // We need 14 notes. To ensure it always sounds good (safe jamming),
    // we use the Pentatonic scale of the current chord or key.
    // Major Pentatonic: 1, 2, 3, 5, 6 (intervals: 0, 2, 4, 7, 9)
    // Minor Pentatonic: 1, b3, 4, 5, b7 (intervals: 0, 3, 5, 7, 10)
    
    let scalePcs = [0, 2, 4, 7, 9]; // Default C Major Pentatonic
    let rootPc = 0;
    
    if (chord) {
        const chordKeyOffset = chord.keyOffset !== undefined ? chord.keyOffset : keyOffset;
        rootPc = ((chord.root + chordKeyOffset) % 12 + 12) % 12;
        const q = chord.quality as string;
        if (q === 'Minor' || q === 'Diminished' || q === 'Minor7' || q === 'HalfDiminished' || q === 'Diminished7' || q === 'Minor9' || q === 'Minor11') {
            scalePcs = [0, 3, 5, 7, 10].map(i => (rootPc + i) % 12); // Minor Pentatonic
        } else {
            scalePcs = [0, 2, 4, 7, 9].map(i => (rootPc + i) % 12); // Major Pentatonic
        }
    } else {
        rootPc = (keyOffset % 12 + 12) % 12;
        if (tonality === 'Minor') {
            scalePcs = [0, 3, 5, 7, 10].map(i => (rootPc + i) % 12); // Minor Pentatonic
        } else {
            scalePcs = [0, 2, 4, 7, 9].map(i => (rootPc + i) % 12); // Major Pentatonic
        }
    }

    scalePcs.sort((a, b) => a - b);
    
    // Find the root in the sorted scale
    let rootIdx = scalePcs.indexOf(rootPc);
    if (rootIdx === -1) rootIdx = 0;

    // Build 14 notes starting from rootPc around MIDI 60
    const notes = [];
    let currentOctave = 5; // Start around C4 (60)
    let currentIdx = rootIdx;
    
    // We want the lowest note to be the root.
    let baseNote = rootPc + 12 * currentOctave;
    if (baseNote < 55) baseNote += 12;
    if (baseNote > 67) baseNote -= 12;
    
    // Re-calculate octave based on baseNote
    currentOctave = Math.floor(baseNote / 12);

    for (let i = 0; i < 14; i++) {
        notes.push(scalePcs[currentIdx] + 12 * currentOctave);
        currentIdx++;
        if (currentIdx >= scalePcs.length) {
            currentIdx = 0;
            currentOctave++;
        }
    }
    return notes;
  };

  // Handle Input (Swipe & Tap)
  useEffect(() => {
    const current = activeKeys;
    const prev = prevActiveKeysRef.current;

    const added = Array.from<string>(current).filter(k => !prev.has(k));
    const removed = Array.from<string>(prev).filter(k => !current.has(k));

    // Handle Jam Mode Note Off and Long Press Cancel
    removed.forEach(keyId => {
        const parts = keyId.split('-');
        if (parts.length === 3) {
            const c = parseInt(parts[1]);
            const r = parseInt(parts[2]);
            
            // Cancel long press if key released early
            if (current.has('key-4-0') || prev.has('key-4-0')) {
                if ((c === 0 && r === 0) || (c === 1 && r === 0) || (c === 4 && r === 0)) {
                    if (longPressTimeout.current) {
                        clearTimeout(longPressTimeout.current);
                        longPressTimeout.current = null;
                    }
                }
            }

            if (appState === 'JAMMING_MELODY') {
                const leadCh = managerRef.current?.getJamLeadChannel() ?? 0;
                if (aiAssist) {
                    // AI ASSIST: 琶音模式 noteOff
                    arpStateRef.current.heldIndices.delete(keyId);
                    if (arpStateRef.current.heldIndices.size === 0) {
                        if (arpStateRef.current.intervalId) {
                            clearInterval(arpStateRef.current.intervalId);
                            arpStateRef.current.intervalId = null;
                        }
                        if (arpStateRef.current.lastPlayedNote !== -1) {
                            AudioEngine.noteOff(leadCh, arpStateRef.current.lastPlayedNote);
                            arpStateRef.current.lastPlayedNote = -1;
                        }
                    } else {
                        const lastKey = Array.from(arpStateRef.current.heldIndices.keys()).pop();
                        if (lastKey) {
                            arpStateRef.current.centerIdx = arpStateRef.current.heldIndices.get(lastKey)!;
                        }
                    }
                } else {
                    // FREE SOLO: 直接 noteOff
                    const track = managerRef.current?.currentTrack;
                    if (track) {
                        const parts = keyId.split('-');
                        const pc = parseInt(parts[1]);
                        const pr = parseInt(parts[2]);
                        let idx = -1;
                        if (pr === 2) idx = pc;
                        else if (pr === 1) idx = 5 + pc;
                        else if (pr === 0 && pc < 4) idx = 10 + pc;
                        if (idx !== -1) {
                            const chord = managerRef.current?.getCurrentChord();
                            const notes = getJamMelodyNotes(chord, track.tonality, track.keyOffset);
                            if (notes[idx]) AudioEngine.noteOff(leadCh, notes[idx]);
                        }
                    }
                }
            }
        }
    });

    added.forEach(keyId => {
      const parts = keyId.split('-');
      if (parts.length === 3) {
        const c = parseInt(parts[1]);
        const r = parseInt(parts[2]);
        const now = performance.now();

        const ctx = getAudioContext();
        if (ctx.state !== 'running') {
          ctx.resume();
        }

        const isFnPressed = current.has('key-4-0');
        const isJamming = appState === 'JAMMING_DRUMS' || appState === 'JAMMING_MELODY' || appState === 'PREPARING_JAM';

        // --- Function Key Itself ---
        if (c === 4 && r === 0) {
            if (isJamming) {
                managerRef.current?.exitJam();
            }
            return; // Skip other interactions for the function key itself
        }

        // --- Jam Mode Trigger (Long Press) ---
        if (isFnPressed) {
            if (c === 0 && r === 0) {
                if (longPressTimeout.current) clearTimeout(longPressTimeout.current);
                longPressTimeout.current = setTimeout(() => {
                    if (appState === 'PLAYING') {
                        managerRef.current?.prepareJam('drums');
                    } else if (appState === 'JAMMING_DRUMS' || appState === 'JAMMING_MELODY') {
                        managerRef.current?.exitJam();
                    }
                }, 500); // 500ms long press
            } else if (c === 1 && r === 0) {
                if (longPressTimeout.current) clearTimeout(longPressTimeout.current);
                longPressTimeout.current = setTimeout(() => {
                    if (appState === 'PLAYING') {
                        managerRef.current?.prepareJam('melody');
                    } else if (appState === 'JAMMING_DRUMS' || appState === 'JAMMING_MELODY') {
                        managerRef.current?.exitJam();
                    }
                }, 500); // 500ms long press
            }
            return; // Skip other interactions when FN is held
        }

        // --- Jam Mode Playback ---
        if (appState === 'JAMMING_DRUMS') {
            if (aiAssist) {
                // AI GROOVE：用户随便按，SmartDrumEngine 生成合拍鼓点
                smartDrumRef.current.onUserPress(managerRef.current?.currentTrack?.sections);
            } else {
                // FREE PLAY：固定鼓音色映射
                const note = DRUM_MAP[`${c}-${r}`];
                if (note) {
                    AudioEngine.playNote(9, note, 127, 100);
                    AudioEngine.emitVisualEvent({ type: 'drums', midiNote: note, velocity: 127, source: 'gameplay' });
                    managerRef.current?.recordUserDrum(note, 127);
                }
            }
            return;
        } else if (appState === 'JAMMING_MELODY') {
            const track = managerRef.current?.currentTrack;
            const leadCh = managerRef.current?.getJamLeadChannel() ?? 0;
            if (track) {
                let idx = -1;
                if (r === 2) idx = c;
                else if (r === 1) idx = 5 + c;
                else if (r === 0 && c < 4) idx = 10 + c;

                if (idx !== -1) {
                    const chord = managerRef.current?.getCurrentChord();
                    const notes = getJamMelodyNotes(chord, track.tonality, track.keyOffset);
                    const note = notes[idx];

                    if (!aiAssist) {
                        // FREE SOLO: 直接发声，不做琶音
                        if (note) {
                            AudioEngine.noteOn(leadCh, note, 110);
                            AudioEngine.emitVisualEvent({ type: 'lead', midiNote: note, velocity: 110, source: 'gameplay' });
                        }
                    } else {
                        // AI ASSIST: 琶音辅助模式
                        arpStateRef.current.heldIndices.set(keyId, idx);
                        arpStateRef.current.centerIdx = idx;

                        if (arpStateRef.current.lastPlayedNote !== -1) {
                            AudioEngine.noteOff(leadCh, arpStateRef.current.lastPlayedNote);
                        }
                        if (note) {
                            AudioEngine.noteOn(leadCh, note, 110);
                            AudioEngine.emitVisualEvent({ type: 'lead', midiNote: note, velocity: 110, source: 'gameplay' });
                            arpStateRef.current.lastPlayedNote = note;
                            arpStateRef.current.step = 1;
                        }

                        if (!arpStateRef.current.intervalId) {
                            arpStateRef.current.intervalId = setInterval(() => {
                                const state = arpStateRef.current;
                                if (state.heldIndices.size === 0) return;
                                const t = managerRef.current?.currentTrack;
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
                                if (state.lastPlayedNote !== -1) AudioEngine.noteOff(leadCh, state.lastPlayedNote);
                                if (arpNote) {
                                    const vel = 90 + Math.floor(Math.random() * 30);
                                    AudioEngine.noteOn(leadCh, arpNote, vel);
                                    AudioEngine.emitVisualEvent({ type: 'lead', midiNote: arpNote, velocity: vel, source: 'gameplay' });
                                    state.lastPlayedNote = arpNote;
                                }
                                state.step++;
                            }, 180);
                        }
                    }
                }
            }
            return;
        }

        if (appState === 'PREPARING_JAM') {
            return; // Skip other interactions while preparing
        }

        // --- Swipe Detection ---
        let swiped = false;
        if (appState === 'IDLE') {
            if (now - swipeState.current.lastActionTime > 400) {
              swipeState.current.path = [];
            }
            swipeState.current.path.push({c, r, time: now});
            swipeState.current.lastActionTime = now;
            swipeState.current.path = swipeState.current.path.filter(p => now - p.time < 500);

            const path = swipeState.current.path;
            if (path.length >= 2) {
              const first = path[0];
              const last = path[path.length - 1];
              const dt = last.time - first.time;
              const dc = last.c - first.c;
              
              if (Math.abs(dc) >= 1 && dt < 500) {
                const safeDt = Math.max(dt, 10);
                const speed = Math.abs(dc) / (safeDt / 1000);
                const moveAmount = speed > 15 ? 2 : 1;

                const prevIdx = selectedIndexRef.current;
                let newIdx = prevIdx;
                if (dc < 0) { // Swipe left -> Next item
                  newIdx = Math.min(bars.length - 1, prevIdx + moveAmount);
                  systemAudio.triggerKick(0, 0.5); // subtle feedback
                } else { // Swipe right -> Previous item
                  newIdx = Math.max(0, prevIdx - moveAmount);
                  systemAudio.triggerKick(0, 0.5);
                }
                
                if (newIdx !== prevIdx) {
                  setSelectedIndex(newIdx);
                }
                swipeState.current.path = [];
                swiped = true;
              }
            }
        } else {
            // Clear swipe path if not IDLE
            swipeState.current.path = [];
        }

        // --- Tap Detection ---
        const isFunctionKey = c === 4 && r === 0;
        
        if (!swiped && !isFunctionKey && !isFnPressed) {
          if (lastTapKey.current && lastTapKey.current.c === c && lastTapKey.current.r === r) {
            tapCount.current += 1;
          } else {
            tapCount.current = 1;
            lastTapKey.current = { c, r };
          }

          if (tapTimeout.current) clearTimeout(tapTimeout.current);
          
          tapTimeout.current = setTimeout(() => {
            const count = tapCount.current;
            tapCount.current = 0;
            lastTapKey.current = null;

            systemAudio.triggerKick(0, 1);
            AudioEngine.emitVisualEvent({ type: 'confirm', midiNote: 60, velocity: 127 });

            if (count === 2) {
              // Double Tap
              if (appState === 'IDLE') {
                // Enter Bar
                const selectedBar = bars[selectedIndexRef.current];
                if (selectedBar && managerRef.current) {
                  managerRef.current.setAllowedStyles(selectedBar.styleIds);
                  managerRef.current.triggerGeneration();
                }
              } else {
                // Next Song
                managerRef.current?.playNext();
              }
            } else if (count >= 3) {
              // Triple Tap
              if (appState === 'IDLE') {
                // Exit App
                managerRef.current?.stopPlayback();
                if (onExit) onExit();
              } else {
                // Exit Bar (Return to IDLE)
                managerRef.current?.stopPlayback();
              }
            }
          }, 300);
        }
      }
    });

    prevActiveKeysRef.current = new Set(current);
  }, [activeKeys, appState, bars, onExit, aiAssist]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 811, h: 269 });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setDim({
          w: entries[0].contentRect.width,
          h: entries[0].contentRect.height
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Layout Constants (Responsive)
  const SCREEN_W = dim.w;
  const SCREEN_H = dim.h;
  const CARD_W = SCREEN_W * (458 / 811);
  const CARD_H = SCREEN_H * (200 / 269);
  const LEFT_MARGIN = SCREEN_W * 0.10; // 10%
  const SPACING = SCREEN_W * 0.15; // 15%
  
  // Image Width calculation:
  // Adjusted to give more space to the text content on the right
  const IMG_W = SCREEN_W * (200 / 811);
  const IMG_H = SCREEN_H * (174 / 269);

  const tapAreaContainer = document.getElementById('tap-area-container');

  // Cleanup arp interval when appState changes
  useEffect(() => {
    if (appState !== 'JAMMING_MELODY') {
      if (arpStateRef.current.intervalId) {
        clearInterval(arpStateRef.current.intervalId);
        arpStateRef.current.intervalId = null;
      }
      if (arpStateRef.current.lastPlayedNote !== -1) {
        const leadCh = managerRef.current?.getJamLeadChannel() ?? 0;
        AudioEngine.noteOff(leadCh, arpStateRef.current.lastPlayedNote);
        arpStateRef.current.lastPlayedNote = -1;
      }
      arpStateRef.current.heldIndices.clear();
    }
  }, [appState]);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-[#0A0A0A] text-white select-none font-sans">
      {/* Scanlines Effect */}
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px] z-50" />

      {/* Jam Mode Overlay */}
      <AnimatePresence>
        {(appState === 'PREPARING_JAM' || appState === 'JAMMING_DRUMS' || appState === 'JAMMING_MELODY') && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 pointer-events-none z-40 flex items-center justify-center"
          >
            <div className="absolute inset-0 border-4 border-red-500/50 rounded-lg animate-pulse" />
            <div className="absolute top-4 bg-red-500 text-white px-4 py-1 rounded-full text-xs font-bold tracking-widest uppercase shadow-[0_0_15px_rgba(239,68,68,0.5)]">
              {appState === 'PREPARING_JAM' ? 'GET READY...' :
               appState === 'JAMMING_DRUMS' ? 'DRUM SOLO' : 'MELODY SOLO'}
            </div>
            {(appState === 'JAMMING_DRUMS' || appState === 'JAMMING_MELODY') && (
              <div className={`absolute top-12 text-[10px] font-bold tracking-wider ${aiAssist ? 'text-green-400' : 'text-white/50'}`}>
                {appState === 'JAMMING_DRUMS'
                  ? (aiAssist ? 'AI GROOVE' : 'FREE PLAY')
                  : (aiAssist ? 'AI ASSIST' : 'FREE SOLO')}
                <span className="text-white/30 ml-2">P(hold):Toggle</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Carousel Container */}
      <AnimatePresence>
        {appState !== 'JAMMING_DRUMS' && appState !== 'JAMMING_MELODY' && appState !== 'PREPARING_JAM' && (
          <motion.div 
            className="absolute top-0 left-0 h-full flex items-center w-max"
            initial={{ opacity: 1 }}
            animate={{ x: -selectedIndex * (CARD_W + SPACING), opacity: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            style={{ paddingLeft: LEFT_MARGIN }}
          >
            {bars.map((bar, index) => {
              const isActive = index === selectedIndex;
              const isPlaying = isActive && appState !== 'IDLE';

              return (
                <motion.div
                  key={bar.id}
                  className="relative flex items-center overflow-hidden shrink-0"
                  style={{ 
                    width: CARD_W, 
                    height: CARD_H, 
                    marginRight: SPACING,
                    backgroundColor: isActive ? 'rgba(20, 20, 20, 0.8)' : 'transparent',
                    border: isActive ? '1px solid rgba(255,255,255,0.1)' : 'none',
                    borderRadius: SCREEN_H * (16 / 269)
                  }}
                  animate={{ 
                    opacity: isActive ? 1 : 0.6,
                    scale: isActive ? 1 : 0.95,
                    filter: isActive ? 'brightness(1)' : 'brightness(0.75)'
                  }}
                  transition={{ duration: 0.3 }}
                >
                  {/* Left Image */}
                  <div 
                    className="absolute left-0 flex items-center justify-start"
                    style={{ width: IMG_W, height: CARD_H, paddingLeft: SCREEN_W * (16 / 811) }}
                  >
                    <img 
                      src={bar.imagePath} 
                      alt={bar.name}
                      style={{ width: IMG_W - (SCREEN_W * (16 / 811)), height: IMG_H, objectFit: 'contain', objectPosition: 'left center' }}
                      className="drop-shadow-2xl"
                      referrerPolicy="no-referrer"
                    />
                  </div>

                  {/* Right Content */}
                  <div 
                    className="absolute flex flex-col justify-center"
                    style={{ 
                      left: IMG_W, 
                      width: CARD_W - IMG_W, 
                      height: CARD_H, 
                      paddingLeft: SCREEN_W * (16 / 811), 
                      paddingRight: SCREEN_W * (16 / 811) 
                    }}
                  >
                    <div 
                      className="uppercase tracking-widest text-yellow-400 mb-1 font-bold bg-yellow-400/20 w-max rounded-sm"
                      style={{ 
                        fontSize: SCREEN_H * (10 / 269),
                        padding: `${SCREEN_H * (2 / 269)}px ${SCREEN_W * (8 / 811)}px`
                      }}
                    >
                      {isPlaying ? 'Live Now' : 'Just Opened'}
                    </div>
                    <h2 
                      className="font-black tracking-wider uppercase leading-tight mb-2 whitespace-nowrap"
                      style={{ fontSize: SCREEN_H * (24 / 269) }}
                    >
                      {bar.name}
                    </h2>
                    
                    <div className="flex flex-col gap-1">
                      <span 
                        className="text-gray-400 uppercase tracking-widest whitespace-nowrap"
                        style={{ fontSize: SCREEN_H * (12 / 269) }}
                      >
                        Now Live:
                      </span>
                      <span 
                        className={`font-bold uppercase tracking-wider whitespace-nowrap truncate ${isPlaying ? 'text-red-500 animate-pulse' : 'text-gray-600'}`}
                        style={{ fontSize: SCREEN_H * (14 / 269) }}
                      >
                        {isPlaying ? currentStyleName : '---'}
                      </span>
                    </div>

                    {/* Equalizer Animation when playing */}
                    {isPlaying && (
                      <div 
                        className="absolute flex items-end gap-1"
                        style={{ 
                          bottom: SCREEN_H * (16 / 269), 
                          right: SCREEN_W * (16 / 811),
                          height: SCREEN_H * (16 / 269)
                        }}
                      >
                        {[1, 2, 3, 4].map((i) => (
                          <motion.div
                            key={i}
                            className="bg-red-500 rounded-t-sm"
                            style={{ width: SCREEN_W * (4 / 811) }}
                            animate={{ height: ['20%', '100%', '40%', '80%', '20%'] }}
                            transition={{ duration: 0.5 + i * 0.1, repeat: Infinity, ease: 'linear' }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generating Overlay */}
      <AnimatePresence>
        {appState === 'GENERATING' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-40"
          >
            <div 
              className="text-cyan-400 font-bold tracking-widest animate-pulse"
              style={{ fontSize: SCREEN_H * (20 / 269) }}
            >
              ENTERING BAR...
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Light Show Overlay */}
      <AnimatePresence>
        {(appState === 'JAMMING_DRUMS' || appState === 'JAMMING_MELODY') && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 pointer-events-none z-40 flex items-center justify-center"
          >
            <div className="absolute inset-0 bg-gradient-to-t from-cyan-900/40 to-transparent mix-blend-screen" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.3)_0%,transparent_70%)]" />
            
            {/* Dynamic Light Beams */}
            <motion.div 
              className="absolute inset-0"
              animate={{ 
                background: [
                  'conic-gradient(from 0deg at 50% 50%, rgba(6,182,212,0) 0%, rgba(6,182,212,0.2) 10%, rgba(6,182,212,0) 20%)',
                  'conic-gradient(from 360deg at 50% 50%, rgba(6,182,212,0) 0%, rgba(6,182,212,0.2) 10%, rgba(6,182,212,0) 20%)'
                ]
              }}
              transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
