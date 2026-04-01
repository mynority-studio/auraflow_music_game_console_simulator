import React, { useState, useCallback, useEffect, useRef } from 'react';
import { AudioEngine } from '../core/audio/AudioEngine';
import { startAudioContext } from '../core/audio/SynthManager';
import { systemLeadSynth, systemAudio } from './SystemAudio';
import { APPS } from '../apps/AppRegistry';

interface AuraSystemProps {
  activeKeys: Set<string>;
  onAppSelect: (appId: string) => void;
}

export function AuraSystem({ activeKeys, onAppSelect }: AuraSystemProps) {
  const [menuIndex, setMenuIndex] = useState(0);
  const menuIndexRef = useRef(0);
  useEffect(() => { menuIndexRef.current = menuIndex; }, [menuIndex]);
  const [isExiting, setIsExiting] = useState(false);

  // Swipe and Tap State Refs
  const swipeState = useRef({
    path: [] as {c: number, r: number, time: number}[],
    lastActionTime: 0
  });
  const tapTimeout = useRef<NodeJS.Timeout | null>(null);
  const tapCount = useRef(0);
  const lastTapKey = useRef<{c: number, r: number} | null>(null);

  // Long Press Arpeggiator Refs
  const longPressTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const isArpMode = useRef(false);
  const arpNoteQueue = useRef<number[]>([]);
  const arpModeGraceTimeout = useRef<NodeJS.Timeout | null>(null);
  const arpInterval = useRef<NodeJS.Timeout | null>(null);
  const arpGraceTimeout = useRef<NodeJS.Timeout | null>(null);
  const arpIndex = useRef(0);

  const activeKeysRef = useRef<Set<string>>(activeKeys);
  const prevActiveKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    activeKeysRef.current = activeKeys;
  }, [activeKeys]);

  // --- LIFECYCLE CLEANUP (防止内存泄漏与声音残留) ---
  useEffect(() => {
    return () => {
      // 当退出系统菜单（进入 App）时，必须清理所有正在运行的系统级琶音和定时器
      if (arpInterval.current) {
        clearInterval(arpInterval.current);
        arpInterval.current = null;
      }
      longPressTimeouts.current.forEach(timeout => clearTimeout(timeout));
      longPressTimeouts.current.clear();
      if (arpModeGraceTimeout.current) clearTimeout(arpModeGraceTimeout.current);
      if (arpGraceTimeout.current) clearTimeout(arpGraceTimeout.current);
      if (tapTimeout.current) clearTimeout(tapTimeout.current);
    };
  }, []);

  const updateArpeggiator = useCallback(() => {
    const uniqueNotes = Array.from(new Set(arpNoteQueue.current)).sort((a: number, b: number) => a - b);

    if (uniqueNotes.length > 0) {
      if (arpGraceTimeout.current) {
        clearTimeout(arpGraceTimeout.current);
        arpGraceTimeout.current = null;
      }

      if (!arpInterval.current) {
        // Start a simple interval-based arpeggiator
        arpIndex.current = 0;
        arpInterval.current = setInterval(() => {
            if (arpNoteQueue.current.length === 0) return;
            const notes = Array.from(new Set<number>(arpNoteQueue.current)).sort((a, b) => a - b);
            const note = notes[arpIndex.current % notes.length];
            if (note !== undefined && !isNaN(note as number)) {
                systemLeadSynth.triggerAttackRelease(note as number, '16n', 0, 0.5);
            }
            arpIndex.current++;
        }, 125); // ~16th note at 120bpm
      }
    } else {
      // Grace period
      if (!arpGraceTimeout.current && arpInterval.current) {
        arpGraceTimeout.current = setTimeout(() => {
          if (arpInterval.current) {
            clearInterval(arpInterval.current);
            arpInterval.current = null;
          }
        }, 100);
      }
    }
  }, []);

  const triggerSoulFlourish = useCallback((midiNotes: number[]) => {
    midiNotes.forEach((midi, index) => {
      if (midi !== undefined && !isNaN(midi)) {
        systemLeadSynth.triggerAttackRelease(midi, '8n', index * 0.06, 0.5);
      }
    });
  }, []);

  // Detect key down and key up from activeKeys changes
  useEffect(() => {
    const current = activeKeys;
    const prev = prevActiveKeysRef.current;

    const added = Array.from<string>(current).filter(k => !prev.has(k));
    const removed = Array.from<string>(prev).filter(k => !current.has(k));

    added.forEach(keyId => {
      const parts = keyId.split('-');
      if (parts.length === 3) {
        const c = parseInt(parts[1]);
        const r = parseInt(parts[2]);

        startAudioContext();

        if (arpModeGraceTimeout.current) {
          clearTimeout(arpModeGraceTimeout.current);
          arpModeGraceTimeout.current = null;
        }

        if (isArpMode.current) {
          // We are dragging while Arp is active!
          const pentatonic = [60, 62, 64, 67, 69]; // C4, D4, E4, G4, A4
          const pitch = pentatonic[c] !== undefined ? pentatonic[c] + (2 - r) * 12 : 60;
          
          if (!isNaN(pitch)) {
            arpNoteQueue.current.push(pitch);
            if (arpNoteQueue.current.length > 8) {
              arpNoteQueue.current.shift();
            }
            updateArpeggiator();
          }
          return;
        }

        // 2.1 单次点击 (Ethereal Touch Sound)
        const pentatonic = [60, 62, 64, 67, 69]; // C4, D4, E4, G4, A4
        const pitch = pentatonic[c] !== undefined ? pentatonic[c] + (2 - r) * 12 : 60;
        if (!isNaN(pitch)) {
          systemLeadSynth.triggerAttackRelease(pitch, '8n', 0, 0.15);
        }

        // 2.4 长按琶音 (Long Press Arpeggiator)
        const timeout = setTimeout(() => {
          isArpMode.current = true;
          
          const basePitch = 48 + c * 4 + (2 - r) * 7;
          const isMajor = Math.random() > 0.5;
          const intervals = (Math.random() > 0.5) 
            ? (isMajor ? [0, 4, 7] : [0, 3, 7]) 
            : (isMajor ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10]);
          const notes = intervals.map(i => basePitch + i);
          
          arpNoteQueue.current = [...notes];
          updateArpeggiator();
        }, 1200);
        longPressTimeouts.current.set(keyId, timeout);

        const now = performance.now();

        // --- Swipe Detection ---
        if (now - swipeState.current.lastActionTime > 400) {
          swipeState.current.path = [];
        }
        swipeState.current.path.push({c, r, time: now});
        swipeState.current.lastActionTime = now;

        // Keep only recent path items to prevent dt from growing indefinitely
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

            const prevIdx = menuIndexRef.current;
            let newIdx = prevIdx;
            if (dc < 0) { // Swipe left -> Next item
              triggerSoulFlourish([72, 76, 79]); // C5, E5, G5
              newIdx = Math.min(APPS.length - 1, prevIdx + moveAmount);
            } else { // Swipe right -> Previous item
              triggerSoulFlourish([79, 76, 72]); // G5, E5, C5
              newIdx = Math.max(0, prevIdx - moveAmount);
            }
            setMenuIndex(newIdx);
            swipeState.current.path = [];
          }
        }

        // --- Multi-tap Detection ---
        if (lastTapKey.current && lastTapKey.current.c === c && lastTapKey.current.r === r) {
          tapCount.current += 1;
        } else {
          tapCount.current = 1;
          lastTapKey.current = {c, r};
        }

        if (tapTimeout.current) clearTimeout(tapTimeout.current);

        if (tapCount.current === 3) {
          // Triple tap -> Cancel/Return
          tapCount.current = 0;
          lastTapKey.current = null;
          // console.log('Triple tap: Cancel/Return');
          systemAudio.triggerKick(0, 0.8);
          systemLeadSynth.triggerAttackRelease(["G3", "Bb3", "D4"], '2n', 0, 0.5);
        } else {
          tapTimeout.current = setTimeout(() => {
            if (tapCount.current === 2) {
              // Double tap -> Confirm
              const currentIndex = menuIndexRef.current;
              const selectedApp = APPS[currentIndex];
              // console.log(`Selected app: ${selectedApp.name}, id: ${selectedApp.id}`);
              systemAudio.triggerKick(0, 1);
              systemLeadSynth.triggerAttackRelease(["C4", "E4", "G4", "C5"], '8n', 0, 0.6);
              AudioEngine.emitVisualEvent({ type: 'confirm', midiNote: 60, velocity: 127 });
              setIsExiting(true);
              setTimeout(() => {
                onAppSelect(selectedApp.id);
              }, 500);
            }
            tapCount.current = 0;
            lastTapKey.current = null;
          }, 300);
        }
      }
    });

    removed.forEach(keyId => {
      const isLastKey = current.size === 0 && prev.has(keyId);

      if (isLastKey) {
        swipeState.current.path = [];
      }

      if (isArpMode.current) {
        if (isLastKey) {
          arpModeGraceTimeout.current = setTimeout(() => {
            if (activeKeysRef.current.size === 0) {
              isArpMode.current = false;
              arpNoteQueue.current = [];
              updateArpeggiator();
            }
          }, 50);
        }
        return;
      }

      const timeout = longPressTimeouts.current.get(keyId);
      if (timeout) {
        clearTimeout(timeout);
        longPressTimeouts.current.delete(keyId);
      }
    });

    prevActiveKeysRef.current = new Set(current);
  }, [activeKeys, triggerSoulFlourish, updateArpeggiator, onAppSelect]);

  return (
    <div className={`@container w-full h-full flex items-center justify-center relative transition-all duration-500 ${isExiting ? 'scale-50 opacity-0' : 'scale-100 opacity-100'}`}>
      <div 
        className="flex transition-transform duration-300 ease-out h-full items-center absolute left-0"
        style={{
          transform: `translateX(calc(50cqw - ${menuIndex * 30 + 15}cqw))`
        }}
      >
        {APPS.map((app, idx) => {
          const isSelected = idx === menuIndex;
          return (
            <div 
              key={app.id}
              className={`flex flex-col items-center justify-center transition-all duration-300 ${isSelected ? 'opacity-100 scale-125' : 'opacity-40 scale-75'}`}
              style={{ width: '30cqw' }}
            >
              <div 
                style={{ 
                  width: '12cqh', 
                  height: '12cqh', 
                  marginBottom: '2cqh', 
                  color: isSelected ? '#34d399' : '#52525b',
                  filter: isSelected ? 'drop-shadow(0 0 1cqw rgba(52,211,153,0.8))' : 'none'
                }}
              >
                {app.icon}
              </div>
              <div 
                className={`tracking-widest ${isSelected ? 'text-emerald-400 drop-shadow-[0_0_1cqw_rgba(52,211,153,0.8)]' : 'text-zinc-600'}`} 
                style={{ fontSize: '6cqh' }}
              >
                {app.name}
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="absolute bottom-[10cqh] flex gap-[2cqw]">
        {APPS.map((_, idx) => (
          <div 
            key={idx} 
            className={`transition-colors duration-300 ${idx === menuIndex ? 'bg-emerald-400 shadow-[0_0_1cqw_rgba(52,211,153,0.8)]' : 'bg-zinc-700'}`}
            style={{ width: '2cqw', height: '2cqw' }}
          />
        ))}
      </div>
    </div>
  );
}
