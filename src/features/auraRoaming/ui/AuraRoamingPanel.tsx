// ============================================================
// auraRoaming · AuraRoamingPanel(Q+L 开发面板)
// ------------------------------------------------------------
// 两个模式:
//   氛围漫游 — 即现有音乐生成,零设置,配置入口直通 Q+H;
//   Aura Key — 亮灯引导跟弹开关(runtime 单例),lead 不静音。
// 面板只订阅 store / 调 runtime 方法,不碰 scheduler。
// ============================================================

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Activity, Sparkles, X } from 'lucide-react';
import { toggleDevPanel, useDevPanelChannel } from '../../../components/devPanels';
import { setAuraKeyOn } from '../runtime/auraKeyRuntime';
import {
  getAuraRoamingSnapshot,
  patchAuraRoaming,
  subscribeAuraRoaming,
} from '../state/auraRoamingStore';

export const AuraRoamingPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState(getAuraRoamingSnapshot);

  useDevPanelChannel('auraRoam', open, setOpen);
  useEffect(() => subscribeAuraRoaming(setSnap), []);

  useEffect(() => {
    const held = new Set<string>();
    const isTyping = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      held.add(key);
      if (!open && held.has('q') && held.has('l') && !isTyping()) {
        event.preventDefault();
        setOpen(true);
      } else if (open && key === 'escape') {
        setOpen(false);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => held.delete(event.key.toLowerCase());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [open]);

  if (!open) return null;

  const { score } = snap;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed right-3 bottom-3 z-[70] w-[380px] max-w-[calc(100vw-1.5rem)] max-h-[92vh] overflow-auto rounded-2xl border border-violet-500/30
                 bg-zinc-950/95 text-zinc-200 shadow-[0_8px_40px_rgba(0,0,0,0.72)] backdrop-blur-md"
      style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <Sparkles size={15} className="text-violet-300" />
        <span className="text-[12px] font-semibold tracking-wide text-violet-200">光律漫游</span>
        <span className="text-[10px] text-zinc-500">Q+L</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${snap.auraKeyOn ? 'bg-violet-500/15 text-violet-200' : 'bg-zinc-800 text-zinc-500'}`}>
          {snap.auraKeyOn ? 'AURA KEY' : '氛围漫游'}
        </span>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto text-zinc-500 hover:text-zinc-200">
          <X size={15} />
        </button>
      </div>

      {/* 氛围漫游:即现有音乐生成,零设置 */}
      <div className="border-b border-zinc-900 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-zinc-300">氛围漫游</span>
          <span className="text-[10px] text-zinc-500">= 现有音乐生成,无需设置</span>
          <button
            type="button"
            onClick={() => toggleDevPanel('pipeline')}
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1 text-[11px] text-sky-200 hover:bg-zinc-700"
          >
            <Activity size={11} /> Q+H 生成设置
          </button>
        </div>
      </div>

      {/* Aura Key */}
      <div className="border-b border-zinc-900 px-3 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAuraKeyOn(!snap.auraKeyOn)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] text-white ${
              snap.auraKeyOn ? 'bg-violet-600 hover:bg-violet-500' : 'bg-zinc-700 hover:bg-zinc-600'
            }`}
          >
            <Sparkles size={13} />
            {snap.auraKeyOn ? '关闭 Aura Key' : '打开 Aura Key'}
          </button>
          <span className="text-[10px] leading-tight text-zinc-500">
            亮哪按哪 · lead 不静音<br />未亮的键也能自由弹
          </span>
        </div>

        {snap.auraKeyOn && (
          <>
            <div className="rounded-lg border border-zinc-900 bg-zinc-900/55 px-2 py-1.5 text-[11px]">
              {snap.songReady ? (
                <div className="space-y-0.5">
                  <div className="text-violet-200">
                    提示 {snap.cueTotal} 个 · 连击 {score.combo}(最高 {score.bestCombo})
                    {score.charging && <span className="ml-1 text-amber-300">⚡充能中</span>}
                  </div>
                  <div className="text-zinc-400">
                    Perfect {score.judged.perfect} · 普通 {score.judged.good} · 按偏 {score.judged.missAttempt} · 漏过 {score.judged.missIgnore}
                  </div>
                  <div className="text-zinc-400">
                    律光 ×{score.lux} · 律光音轨 ×{snap.trails}
                  </div>
                </div>
              ) : (
                <span className="text-amber-300/90">等待生成曲播放(Q+H 生成并播放后自动开始引导)</span>
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-zinc-500">输入延迟补偿</span>
              <input
                aria-label="Aura Key latency offset ms"
                type="number"
                step={10}
                min={-200}
                max={300}
                value={snap.latencyOffsetMs}
                onChange={(event) => patchAuraRoaming({ latencyOffsetMs: Number(event.target.value) || 0 })}
                className="w-16 rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-100"
              />
              <span className="text-zinc-500">ms</span>
              <span className="ml-auto text-[10px] text-zinc-500">{snap.midiStatus !== 'off' ? snap.midiStatus : 'MIDI 未连接'}</span>
            </div>
          </>
        )}
      </div>

      <div className="px-3 py-2 text-[10px] leading-relaxed text-zinc-500">
        判定:|Δt|≤60ms Perfect(律光+2)· ≤150ms 普通(+1)· ≤300ms 按偏(断律光音轨)· 完全没按=漏过(不断音轨,可 A→C 跨越)。
        亮灯键贴谱发声:阈值内早按声音推迟到 lead 正点,并按乐谱时值自动延音;未亮键即按即响。
        两次成功命中之间滑按过未亮键 → 律光音轨 ×1(相距 ≤8 拍)。MIDI 设备偏好与 Q+T 共享。
      </div>
    </motion.div>
  );
};
