// ============================================================
// auraRoaming · store(模块单例 + listener Set,工程惯用模式)
// ------------------------------------------------------------
// UI(面板/星星 HUD/App)只订阅这里;runtime 是唯一写方。
// starPulse/trailPulse 是单调递增的动画 key:每次成功/成轨 +1,
// UI 用 key 变化触发 🌟 晃动,不需要事件总线。
// ============================================================

import {
  INITIAL_SCORE_STATE,
  applyJudgement,
  isSuccessJudgement,
  type AuraScoreState,
} from '../judge/judgement';
import type { AuraJudgementKind } from '../types';

export interface AuraRoamingSnapshot {
  auraKeyOn: boolean;
  /** 有生成曲在播放且提示计划就绪。 */
  songReady: boolean;
  cueTotal: number;
  score: AuraScoreState;
  trails: number;
  starPulse: number;
  trailPulse: number;
  lastJudgement: { kind: AuraJudgementKind; atMs: number } | null;
  latencyOffsetMs: number;
  midiStatus: string;
}

const state: AuraRoamingSnapshot = {
  auraKeyOn: false,
  songReady: false,
  cueTotal: 0,
  score: INITIAL_SCORE_STATE,
  trails: 0,
  starPulse: 0,
  trailPulse: 0,
  lastJudgement: null,
  latencyOffsetMs: 0,
  midiStatus: 'off',
};

const listeners = new Set<(snapshot: AuraRoamingSnapshot) => void>();

export function getAuraRoamingSnapshot(): AuraRoamingSnapshot {
  return { ...state, score: { ...state.score, judged: { ...state.score.judged } } };
}

export function subscribeAuraRoaming(listener: (snapshot: AuraRoamingSnapshot) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  const snapshot = getAuraRoamingSnapshot();
  for (const listener of listeners) listener(snapshot);
}

export function patchAuraRoaming(partial: Partial<Pick<AuraRoamingSnapshot,
  'auraKeyOn' | 'songReady' | 'cueTotal' | 'midiStatus' | 'latencyOffsetMs'>>): void {
  Object.assign(state, partial);
  notify();
}

export function recordAuraJudgement(kind: AuraJudgementKind): void {
  state.score = applyJudgement(state.score, kind);
  if (isSuccessJudgement(kind)) state.starPulse += 1;
  state.lastJudgement = { kind, atMs: typeof performance !== 'undefined' ? performance.now() : Date.now() };
  notify();
}

export function recordAuraTrail(): void {
  state.trails += 1;
  state.trailPulse += 1;
  notify();
}

/** 新歌/重开 Aura Key 时清空本局计分(latency 偏好保留)。 */
export function resetAuraSession(): void {
  state.score = INITIAL_SCORE_STATE;
  state.trails = 0;
  state.lastJudgement = null;
  notify();
}
