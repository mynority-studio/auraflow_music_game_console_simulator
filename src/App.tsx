import React, { useState, useCallback } from 'react';
import { LedMatrix } from './core/hardware/LedMatrix';
import { TapArea } from './core/hardware/TapArea';
import { AuraSystem } from './system/AuraSystem';
import { APPS } from './apps/AppRegistry';
import { AudioEngine } from './core/audio/AudioEngine';
import { startAudioContext } from './core/audio/SynthManager';
import { VolumeController } from './components/VolumeController';
import { PipelineMonitor } from './components/PipelineMonitor';
import { ImproCorePanel } from './core/generation/improCore/sandbox';
import { MotifCorePanel } from './core/generation/motifCore';

export default function App() {
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const [deviceState, setDeviceState] = useState<string>('SYSTEM_MENU');

  const handleKeyDown = useCallback((c: number, r: number) => {
    startAudioContext();
    setActiveKeys(prev => new Set(prev).add(`key-${c}-${r}`));
  }, []);

  const handleKeyUp = useCallback((c: number, r: number) => {
    setActiveKeys(prev => {
      const next = new Set(prev);
      next.delete(`key-${c}-${r}`);
      return next;
    });
  }, []);

  const handleAppSelect = useCallback((appId: string) => {
    setDeviceState(appId);
  }, []);

  const ActiveApp = APPS.find(app => app.id === deviceState)?.component;

  return (
    <div className="min-h-screen bg-black flex items-center justify-center overflow-hidden">
      <VolumeController />
      <PipelineMonitor />
      {/* ImproCore 移植沙盒 — 同时按 Q+I 调出,独立于主系统 */}
      <ImproCorePanel />
      {/* motifCore 听感沙盒 — 同时按 Q+M 调出,平行 improCore */}
      <MotifCorePanel />
      {/* Device Container */}
      <div 
        className="relative w-full max-w-[70vh] translate-y-[5vh]"
        style={{ aspectRatio: '1537 / 1410' }}
      >
        {/* Layer 1: Device Base (Z-index: 1) */}
        <div 
          className="absolute inset-0 z-10"
          style={{
            backgroundImage: 'url(https://auraflow-studio-hk.oss-cn-hongkong.aliyuncs.com/simulator/img/1QyK-bv3TC2OZRiAxhUvfzzxaR6RYIFEB.png)',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
          }}
        />

        {/* Tap Area Image */}
        <img 
          src="https://auraflow-studio-hk.oss-cn-hongkong.aliyuncs.com/simulator/img/%E5%8E%8B%E5%8A%9B%E5%9E%AB.png"
          alt="Silicone Tap Area"
          className="absolute z-20 pointer-events-none opacity-85 mix-blend-screen"
          style={{
            left: 'calc(17 / 1537 * 100%)',
            top: 'calc(388 / 1410 * 100%)',
            width: 'calc(1503 / 1537 * 100%)',
          }}
        />

        {/* Screen */}
        <div 
          id="screen"
          className="absolute z-30 bg-[#111] overflow-hidden flex items-center justify-center rounded-sm"
          style={{
            left: 'calc(363 / 1537 * 100%)',
            top: 'calc(66 / 1410 * 100%)',
            width: 'calc(811 / 1537 * 100%)',
            height: 'calc(269 / 1410 * 100%)',
            containerType: 'size'
          }}
        >
          {deviceState === 'SYSTEM_MENU' ? (
            <AuraSystem activeKeys={activeKeys} onAppSelect={handleAppSelect} />
          ) : (
            <div className="w-full h-full animate-[fadeIn_0.5s_ease-out]">
              {ActiveApp ? <ActiveApp activeKeys={activeKeys} onExit={() => setDeviceState('SYSTEM_MENU')} /> : null}
            </div>
          )}
        </div>

        {/* LeftKnob: Circular Home Button */}
        <div 
          className="absolute z-30 cursor-pointer rounded-full"
          style={{
            left: 'calc(97 / 1537 * 100%)',
            top: 'calc(118 / 1410 * 100%)',
            width: 'calc(164 / 1537 * 100%)',
            height: 'calc(164 / 1410 * 100%)',
            touchAction: 'manipulation'
          }}
          onPointerDown={() => {
            AudioEngine.stop();
            setDeviceState('SYSTEM_MENU');
          }}
        />

        {/* Layer 2: LED Matrix (Z-index: 35) */}
        <div 
          className="absolute z-35 mix-blend-screen pointer-events-none"
          style={{
            left: 'calc(102 / 1537 * 100%)',
            top: 'calc(442 / 1410 * 100%)',
            width: 'calc(1333 / 1537 * 100%)',
            height: 'calc(780 / 1410 * 100%)',
          }}
        >
          <LedMatrix activeKeys={activeKeys} appMode={deviceState} />
        </div>

        {/* Interactive Grid Overlay (Z-index: 4) */}
        <div 
          id="tap-area-container"
          className="absolute z-40"
          style={{
            left: 'calc(90 / 1537 * 100%)',
            top: 'calc(427 / 1410 * 100%)',
            width: 'calc(1358 / 1537 * 100%)',
            height: 'calc(811 / 1410 * 100%)',
          }}
        >
          <TapArea onKeyDown={handleKeyDown} onKeyUp={handleKeyUp} />
        </div>
      </div>
    </div>
  );
}
