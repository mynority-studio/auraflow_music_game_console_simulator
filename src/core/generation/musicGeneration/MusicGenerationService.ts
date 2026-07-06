// ============================================================
// musicGeneration · MusicGenerationService(产品 ↔ Q+N 唯一边界;qn_main_engine_takeover §4)
// ------------------------------------------------------------
// generateMusic / generateMotifMusic 包 Q+N 正式生成核心(generateSong / generateSongFromMotif),
//   产 MusicalIR(正式音频合同)+ 结构化 uiSnapshot。
// ★ Band Selection 新语义(qn_takeover_followup §3/§4):req.bandParticipants(选「参与乐手/职能」)
//   → deriveLineupConstraint → Q+N band 层 bandConstraint(限 lineup/role/家族)。
//   【禁止】生成后后处理覆盖 TrackIR.program(§5.3):音色一律由器配层按 style/seed/音色世界 rng 决定。
// ★ 本层可 import Q+N;Q+N 核心【不得】反向 import 本层 / AudioEngine。播放由调用方交给 AudioEngine。
// ============================================================

import { buildSongBundle, generateSongFromBundle, type SongBundle } from '../newEngine/generation/GenerationController';
import { deriveMusicIntentPlan, summarizeMusicIntent } from '../newEngine/arranger/deriveMusicIntentPlan';
import type { AuditReport } from '../newEngine/ir/AuditReport';
import { buildMotifSongBundle, generateSongFromMotifBundle, type MotifSongOverride } from '../newEngine/generation/generateSongFromMotif';
import type { GenerationRequest } from '../newEngine/band/bandEngine';
import type { MusicalIR } from '../newEngine/ir/MusicalIR';
import { buildUiSnapshot, keyToPc } from './qnUiProjection';
import { deriveLineupConstraint } from './participantConstraint';
import type { MusicGenerationRequest, MusicGenerationResult } from './types';

/** MusicGenerationRequest → Q+N GenerationRequest(UI 字符串 key/mode 转 Q+N 类型;participant → 约束)。 */
function toQnRequest(req: MusicGenerationRequest): GenerationRequest {
  const out: GenerationRequest = {
    seed: req.seed,
    styleHint: req.styleHint,
    mood: req.mood,
    targetDuration: req.targetDuration,
  };
  if (req.key) (out as { key?: number }).key = keyToPc(req.key);
  if (req.mode) (out as { mode?: string }).mode = req.mode.toLowerCase() === 'minor' ? 'minor' : 'major';
  const constraint = deriveLineupConstraint(req.bandParticipants);
  if (constraint) (out as { bandConstraint?: unknown }).bandConstraint = constraint;
  return out;
}

function buildResult(req: MusicGenerationRequest, bundle: SongBundle, ir: MusicalIR | null, status: string, report: unknown, attempts: number): MusicGenerationResult {
  // ★ 不再后处理覆盖 program:IR 直用,音色已是器配层最终真源。
  // ★ Phase 7:优先用 render 已挂的【完整】intent(含 ACG bar-family enforce,准确反映所有权);缺省(理论不发生)才服务层派生 fallback。
  //   消除服务层重派生(旧:无 active sections → 不含 acgBarFamilyBySpan)。musicGeneration 只【暴露】intent,不拥有(#4)。
  const rpt = (report && typeof report === 'object') ? (report as AuditReport) : undefined;
  const reportWithIntent = rpt
    ? { ...rpt, intent: rpt.intent ?? summarizeMusicIntent(deriveMusicIntentPlan(bundle.band.style, bundle.arrangement)) }
    : report;
  return {
    status: status === 'failed' || !ir ? 'failed' : 'ok',
    ir,
    bpm: bundle.arrangement.tempoBpm,
    seed: req.seed,
    styleHint: req.styleHint,
    report: reportWithIntent,
    attempts,
    uiSnapshot: buildUiSnapshot(bundle, ir, req.seed, req.bandParticipants),
  };
}

/** 普通音乐生成(同步核心)。Q+N 生成本就同步;async 版只是包装,供 await 调用方。 */
export function generateMusicSync(request: MusicGenerationRequest): MusicGenerationResult {
  const bundle = buildSongBundle(toQnRequest(request));
  const result = generateSongFromBundle(bundle);
  return buildResult(request, bundle, result.ir ?? null, result.status, result.report, result.attempts);
}

/** Motif 续写成曲(同步核心)。 */
export function generateMotifMusicSync(request: MusicGenerationRequest, override: MotifSongOverride): MusicGenerationResult {
  const mb = buildMotifSongBundle(toQnRequest(request), override);
  const result = generateSongFromMotifBundle(mb);
  return buildResult(request, mb.bundle, result.ir ?? null, result.status, result.report, result.attempts);
}

/** 普通音乐生成(主链路核心入口)。 */
export async function generateMusic(request: MusicGenerationRequest): Promise<MusicGenerationResult> {
  return generateMusicSync(request);
}

/** Motif 续写成曲入口(完整成曲必走此,不用 leadOnlyIr)。 */
export async function generateMotifMusic(request: MusicGenerationRequest, override: MotifSongOverride): Promise<MusicGenerationResult> {
  return generateMotifMusicSync(request, override);
}
