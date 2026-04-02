import React, { useEffect, useRef, useState } from 'react';
import { AudioEngine } from '../../core/audio/AudioEngine';
import { getAudioContext } from '../../core/audio/SynthManager';
import { systemAudio } from '../../system/SystemAudio'; 
import { EndlessRadioManager, AppState } from './EndlessRadioManager';

interface AuraRadioProps {
  activeKeys: Set<string>;
  onExit?: () => void;
}

export function AuraRadio({ activeKeys, onExit }: AuraRadioProps) {
  const managerRef = useRef<EndlessRadioManager | null>(null);
  const [appState, setAppState] = useState<AppState>('IDLE');

  const tapTimeout = useRef<NodeJS.Timeout | null>(null);
  const tapCount = useRef(0);
  const activeKeysRef = useRef<Set<string>>(activeKeys);
  const prevActiveKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const manager = new EndlessRadioManager();
    manager.onStateChange((newState) => {
      setAppState(newState);
    });
    managerRef.current = manager;

    return () => {
      manager.stopPlayback();
    };
  }, []);

  useEffect(() => {
    activeKeysRef.current = activeKeys;
  }, [activeKeys]);

  // 组件卸载时停止音乐
  useEffect(() => {
    return () => {
      if (managerRef.current) {
        managerRef.current.stopPlayback();
      }
      if (tapTimeout.current) clearTimeout(tapTimeout.current);
    };
  }, []);

  // 监听按键输入
  useEffect(() => {
    const current = activeKeys;
    const prev = prevActiveKeysRef.current;

    const added = Array.from<string>(current).filter(k => !prev.has(k));

    added.forEach(keyId => {
      const parts = keyId.split('-');
      if (parts.length === 3) {
        const ctx = getAudioContext();
        if (ctx.state !== 'running') {
          ctx.resume();
        }

        tapCount.current += 1;
        if (tapTimeout.current) clearTimeout(tapTimeout.current);
        
        tapTimeout.current = setTimeout(() => {
          const count = tapCount.current;
          tapCount.current = 0;

          systemAudio.triggerKick(0, 1);
          AudioEngine.emitVisualEvent({ type: 'confirm', midiNote: 60, velocity: 127 });

          if (appState === 'IDLE') {
            if (count === 2) {
              managerRef.current?.triggerGeneration();
            }
          } else if (appState === 'PLAYING' || appState === 'GENERATING') {
            if (count === 1) {
              managerRef.current?.playNext();
            } else if (count === 2) {
              managerRef.current?.playPrevious();
            } else if (count >= 3) {
              managerRef.current?.stopPlayback();
            }
          }
        }, 300);
      }
    });

    prevActiveKeysRef.current = new Set(current);
  }, [activeKeys, appState]);

  return (
    <div className="w-full h-full flex items-center justify-center relative overflow-hidden bg-black text-white select-none">
      {/* Scanlines Effect */}
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px] z-50" />

      {appState === 'IDLE' && (
        <div className="text-[8cqh] text-cyan-400 drop-shadow-[0_0_1cqw_rgba(34,211,238,0.8)] animate-pulse z-10">
          DOUBLE TAP TO START RADIO
        </div>
      )}

      {appState === 'GENERATING' && (
        <div className="text-[10cqh] text-yellow-400 drop-shadow-[0_0_2cqw_rgba(250,204,21,0.8)] animate-pulse z-10">
          COMPOSING DNA...
        </div>
      )}

      {appState === 'PLAYING' && (
        <div className="w-full h-full flex flex-row items-center justify-center relative z-10 gap-[6cqw]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.2)_0%,rgba(0,0,0,0.8)_100%)] pointer-events-none" />
          
          <style>
            {`
              @keyframes steamUp {
                0% { transform: translateY(0px) scale(1); opacity: 0.8; }
                50% { transform: translateY(-4px) scale(1.1); opacity: 0.4; }
                100% { transform: translateY(-8px) scale(1.2); opacity: 0; }
              }
              .steam-1 { animation: steamUp 2s infinite linear; }
              .steam-2 { animation: steamUp 2s infinite linear 1s; }
              .steam-3 { animation: steamUp 2s infinite linear 0.5s; }
            `}
          </style>

          {/* Pixel Art Coffee Cup */}
          <svg viewBox="0 0 24 24" className="w-[20cqh] h-[20cqh] text-emerald-400 drop-shadow-[0_0_1cqw_rgba(52,211,153,0.8)] z-10" fill="currentColor" style={{ shapeRendering: 'crispEdges' }}>
            {/* Cup Body */}
            <rect x="6" y="10" width="10" height="8" />
            <rect x="7" y="18" width="8" height="1" />
            <rect x="8" y="19" width="6" height="1" />
            {/* Handle */}
            <rect x="16" y="11" width="2" height="1" />
            <rect x="17" y="12" width="1" height="4" />
            <rect x="16" y="16" width="2" height="1" />
            
            {/* Steam 1 */}
            <g className="steam-1">
              <rect x="8" y="6" width="2" height="2" opacity="0.8" />
              <rect x="7" y="4" width="2" height="2" opacity="0.5" />
            </g>
            {/* Steam 2 */}
            <g className="steam-2">
              <rect x="12" y="7" width="2" height="2" opacity="0.8" />
              <rect x="13" y="5" width="2" height="2" opacity="0.5" />
            </g>
            {/* Steam 3 */}
            <g className="steam-3">
              <rect x="10" y="4" width="2" height="2" opacity="0.6" />
              <rect x="9" y="2" width="2" height="2" opacity="0.3" />
            </g>
          </svg>

          {/* Text */}
          <div className="text-[10cqh] text-emerald-400 drop-shadow-[0_0_2cqw_rgba(52,211,153,0.8)] font-mono tracking-widest z-10 animate-pulse" style={{ animationDuration: '3s' }}>
            NOW ENJOY
          </div>
        </div>
      )}
    </div>
  );
}
