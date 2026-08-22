// ============================================================
// auraRoaming · AuraStarHud(屏幕 🌟 反馈层)
// ------------------------------------------------------------
// 挂在设备容器内,絶对定位覆盖屏幕区,pointer-events-none:
//   · 主🌟:每次成功命中晃一下;连击 ≥5 高能颤抖 + 随机喷射渐暗光斑;
//     右侧 ×N = 累计律光;
//   · 异色🌟(hue 旋转成青色):每记一条律光音轨晃一下,×M 计数;
//   · 判定瞬时字(PERFECT/GOOD/MISS)淡出。
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { getAuraRoamingSnapshot, subscribeAuraRoaming } from '../state/auraRoamingStore';
import type { AuraJudgementKind } from '../types';

interface Spark {
  id: number;
  dx: number;
  dy: number;
  hue: number;
  duration: number;
}

const JUDGE_LABEL: Record<AuraJudgementKind, { text: string; className: string }> = {
  perfect: { text: 'PERFECT', className: 'text-amber-300' },
  good: { text: 'GOOD', className: 'text-teal-300' },
  missAttempt: { text: 'MISS', className: 'text-rose-300' },
  missIgnore: { text: '·', className: 'text-zinc-600' },
};

export const AuraStarHud: React.FC = () => {
  const [snap, setSnap] = useState(getAuraRoamingSnapshot);
  const [sparks, setSparks] = useState<Spark[]>([]);
  const sparkSeq = useRef(0);

  useEffect(() => subscribeAuraRoaming(setSnap), []);

  // 充能态:持续喷射光斑;每次成功命中再补一撮
  useEffect(() => {
    if (!snap.charging) return;
    const spawn = (count: number) => {
      setSparks((prev) => [
        ...prev.slice(-20),
        ...Array.from({ length: count }, () => ({
          id: sparkSeq.current++,
          dx: (Math.random() * 2 - 1) * 48,
          dy: (Math.random() * 2 - 1) * 34 - 10,
          hue: 38 + Math.random() * 55,
          duration: 0.55 + Math.random() * 0.5,
        })),
      ]);
    };
    spawn(6);
    const timer = window.setInterval(() => spawn(3), 380);
    return () => window.clearInterval(timer);
  }, [snap.charging, snap.starPulse]);

  if (!snap.auraKeyOn) return null;

  const judgement = snap.lastJudgement;

  return (
    <div
      className="absolute z-[45] pointer-events-none"
      style={{
        left: 'calc(363 / 1537 * 100%)',
        top: 'calc(66 / 1410 * 100%)',
        width: 'calc(811 / 1537 * 100%)',
        height: 'calc(269 / 1410 * 100%)',
      }}
    >
      <div className="absolute right-2 top-1 flex items-start gap-3" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        {/* 主🌟 + 律光计数 */}
        <div className="relative flex items-center gap-1">
          <motion.div
            animate={snap.charging ? { x: [0, -1.6, 1.6, -1.1, 1.1, 0], y: [0, 1.1, -1.1, 1.6, -0.8, 0] } : { x: 0, y: 0 }}
            transition={snap.charging ? { repeat: Infinity, duration: 0.16 } : { duration: 0.1 }}
          >
            <motion.span
              key={snap.starPulse}
              className="inline-block text-[15px] leading-none drop-shadow-[0_0_6px_rgba(251,191,36,0.75)]"
              animate={{ rotate: [0, -16, 13, -9, 6, 0], scale: [1, 1.28, 1.05, 1] }}
              transition={{ duration: 0.45 }}
            >
              🌟
            </motion.span>
          </motion.div>
          <span className="text-[11px] font-semibold text-amber-200">×{snap.score.lux}</span>

          {/* 充能光斑喷射 */}
          {sparks.map((spark) => (
            <motion.span
              key={spark.id}
              className="absolute left-1.5 top-1.5 h-1 w-1 rounded-full"
              style={{ background: `hsl(${spark.hue}, 95%, 68%)`, boxShadow: `0 0 5px hsl(${spark.hue}, 95%, 60%)` }}
              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              animate={{ x: spark.dx, y: spark.dy, opacity: 0, scale: 0.35 }}
              transition={{ duration: spark.duration, ease: 'easeOut' }}
              onAnimationComplete={() => setSparks((prev) => prev.filter((s) => s.id !== spark.id))}
            />
          ))}
        </div>

        {/* 异色🌟(律光音轨) */}
        <div className="flex items-center gap-1">
          <motion.span
            key={snap.trailPulse}
            className="inline-block text-[15px] leading-none"
            style={{ filter: 'hue-rotate(165deg) saturate(1.6) drop-shadow(0 0 6px rgba(45,212,191,0.7))' }}
            animate={snap.trailPulse > 0 ? { rotate: [0, 15, -12, 8, 0], scale: [1, 1.3, 1] } : {}}
            transition={{ duration: 0.5 }}
          >
            🌟
          </motion.span>
          <span className="text-[11px] font-semibold text-teal-200">×{snap.trails}</span>
        </div>

        {/* 判定瞬时字 */}
        {judgement && judgement.kind !== 'missIgnore' && (
          <motion.span
            key={`${judgement.kind}-${judgement.atMs}`}
            className={`text-[10px] font-bold tracking-widest ${JUDGE_LABEL[judgement.kind].className}`}
            initial={{ opacity: 1, y: 0 }}
            animate={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.9, ease: 'easeOut' }}
          >
            {JUDGE_LABEL[judgement.kind].text}
          </motion.span>
        )}
      </div>
    </div>
  );
};
