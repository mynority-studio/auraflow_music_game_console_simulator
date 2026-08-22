import React, { useState, useCallback, useEffect } from 'react';
import { LedMatrix } from './core/hardware/LedMatrix';
import { TapArea } from './core/hardware/TapArea';
import { AuraSystem } from './system/AuraSystem';
import { APPS } from './apps/AppRegistry';
import { AudioEngine } from './core/audio/AudioEngine';
import { startAudioContext } from './core/audio/AudioEngine';
import { PipelineMonitor } from './components/PipelineMonitor';
import { MotifWeaverSandboxPanel } from './core/generation/motifSandbox';
import { MidiOutSandboxPanel } from './core/generation/midiOutSandbox';
import { LeadTakeoverSandboxPanel } from './core/generation/leadTakeoverSandbox';
import { emitTakeoverPadInput } from './core/generation/leadTakeoverSandbox/takeoverInputBus';
import { DevDock } from './components/DevDock';
import { SoundFontSelector } from './components/SoundFontSelector';
import { MidiAnalysisMonitorPanel } from './components/MidiAnalysisMonitorPanel';
import { AuraRoamingPanel, AuraStarHud, subscribeAuraRoaming } from './features/auraRoaming';

const EMPTY_ACTIVE_KEYS = new Set<string>();

export default function App() {
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const [deviceState, setDeviceState] = useState<string>('SYSTEM_MENU');
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [auraKeyOn, setAuraKeyOn] = useState(false);
  // Aura Key 引导模式与 Q+T 一样接管 pad 输入,不再喂给屏幕内 app
  useEffect(() => subscribeAuraRoaming((snapshot) => setAuraKeyOn(snapshot.auraKeyOn)), []);
  const appActiveKeys = takeoverOpen || auraKeyOn ? EMPTY_ACTIVE_KEYS : activeKeys;

  const handleKeyDown = useCallback((c: number, r: number) => {
    startAudioContext();
    emitTakeoverPadInput('down', c, r);
    setActiveKeys(prev => new Set(prev).add(`key-${c}-${r}`));
  }, []);

  const handleKeyUp = useCallback((c: number, r: number) => {
    emitTakeoverPadInput('up', c, r);
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
      {/* 左侧 DevDock:音乐生成(Q+H)+ Motif 沙盒(Q+R)+ 用户接管沙盒(Q+T)的可见菜单入口 */}
      <DevDock />
      <SoundFontSelector />
      <PipelineMonitor />
      <MotifWeaverSandboxPanel />
      <MidiOutSandboxPanel />
      <MidiAnalysisMonitorPanel />
      <AuraRoamingPanel />
      {/* Device Container */}
      <div 
        className="relative w-full max-w-[70vh] translate-y-[5vh]"
        style={{ aspectRatio: '1537 / 1410' }}
      >
        <LeadTakeoverSandboxPanel activeKeys={activeKeys} onOpenChange={setTakeoverOpen} />
        {/* 光律漫游 🌟 HUD:覆盖屏幕区,仅 Aura Key 打开时可见 */}
        <AuraStarHud />
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
            <AuraSystem activeKeys={appActiveKeys} onAppSelect={handleAppSelect} />
          ) : (
            <div className="w-full h-full animate-[fadeIn_0.5s_ease-out]">
              {ActiveApp ? <ActiveApp activeKeys={appActiveKeys} onExit={() => setDeviceState('SYSTEM_MENU')} /> : null}
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
