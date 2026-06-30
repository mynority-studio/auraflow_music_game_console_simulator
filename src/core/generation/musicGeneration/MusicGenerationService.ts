// ============================================================
// musicGeneration · MusicGenerationService(产品 ↔ Q+N 唯一边界;qn_main_engine_takeover §4)
// ------------------------------------------------------------
// generateMusic / generateMotifMusic 包 Q+N 正式生成核心(generateSong / generateSongFromMotif),
//   产 MusicalIR(正式音频合同)+ 结构化 uiSnapshot。Band Selection 三态(auto/selected/disabled)在此落地:
//   gmOverrides/selected → 覆盖最终 TrackIR.program;disabled → 该轨不出现在 IR。
// ★ 本层可 import Q+N;Q+N 核心【不得】反向 import 本层 / AudioEngine。播放由调用方交给 AudioEngine。
// ============================================================

import { buildSongBundle, generateSongFromBundle, type SongBundle } from '../newEngine/generation/GenerationController';
import { buildMotifSongBundle, generateSongFromMotifBundle, type MotifSongOverride } from '../newEngine/generation/generateSongFromMotif';
import type { GenerationRequest } from '../newEngine/band/bandEngine';
import { freezeMusicalIR, type MusicalIR, type MusicalIRData, type TrackIR } from '../newEngine/ir/MusicalIR';
import { buildUiSnapshot, keyToPc } from './qnUiProjection';
import type { MusicGenerationRequest, MusicGenerationResult, QnBandSelection, QnGmOverrides, QnRole } from './types';

/** MusicGenerationRequest → Q+N GenerationRequest(UI 字符串 key/mode 转 Q+N 类型)。 */
function toQnRequest(req: MusicGenerationRequest): GenerationRequest {
  const out: GenerationRequest = {
    seed: req.seed,
    styleHint: req.styleHint,
    mood: req.mood,
    targetDuration: req.targetDuration,
  };
  if (req.key) (out as { key?: number }).key = keyToPc(req.key);
  if (req.mode) (out as { mode?: string }).mode = req.mode.toLowerCase() === 'minor' ? 'minor' : 'major';
  return out;
}

/** Band Selection 三态落地:disabled → 丢轨;selected/gmOverride → 覆盖 TrackIR.program。无改动则原样返回。 */
function applyBandSelection(ir: MusicalIR, selection?: QnBandSelection, gmOverrides?: QnGmOverrides): MusicalIR {
  if (!selection && !gmOverrides) return ir;
  const kept = ir.tracks.filter((t) => selection?.[t.role as QnRole]?.kind !== 'disabled');
  const mapped = kept.map((t) => {
    const sel = selection?.[t.role as QnRole];
    const override = gmOverrides?.[t.role as QnRole] ?? (sel?.kind === 'selected' ? sel.program : undefined);
    return override !== undefined && override !== t.program ? { ...t, program: override } : t;
  });
  const changed = mapped.length !== ir.tracks.length || mapped.some((t, i) => t !== ir.tracks[i]);
  if (!changed) return ir;
  return freezeMusicalIR({ tracks: mapped as TrackIR[], timebase: ir.timebase, durationTicks: ir.durationTicks } as unknown as MusicalIRData);
}

function buildResult(req: MusicGenerationRequest, bundle: SongBundle, ir: MusicalIR | null, status: string, report: unknown, attempts: number): MusicGenerationResult {
  const finalIr = ir ? applyBandSelection(ir, req.bandSelection, req.gmOverrides) : null;
  return {
    status: status === 'failed' || !finalIr ? 'failed' : 'ok',
    ir: finalIr,
    bpm: bundle.arrangement.tempoBpm,
    seed: req.seed,
    styleHint: req.styleHint,
    report,
    attempts,
    uiSnapshot: buildUiSnapshot(bundle, finalIr, req.seed, req.bandSelection),
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
