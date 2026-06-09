// ============================================================
// newEngine · render · MG 织体 comp 严格 dry 渲染(Gap B,2026-06-09;用户:只 comp/chord,不碰 pad/drum)
// ------------------------------------------------------------
// CODEX musicgenerative_remaining_strict_migration_gaps.md Gap B:legacy 织体此前走 family interpreter
//   (产品手感,非 MG dry parity)。本模块用【MG oracle】(由 ../melodygenerative applyTexture 真跑 dump,
//   见 __mgTextureOracle__/comp_cmaj7.json)驱动 comp/chord 的 dry 语义:onset 栅格 / 时值策略 / 力度比 /
//   每击音数(arp-1音 / block-多音 / roll-密集单音)。pitch 用【我们的】voicing(Option B),故对齐
//   语义(tRel/duration/velRatio/cardinality)而非 bit pitch。
// dry(此模块)= MG 精确语义(可含 off-grid);product handfeel(贴格/pocket)在 renderTextureChordHits 之后叠。
// ============================================================

import oracle from './__mgTextureOracle__/comp_cmaj7.json';
import type { TextureChordHit } from './textureRenderer';

interface MgOnset { t: number; n: number; d: number; vr: number }
interface MgProfile { onsetCount: number; chordNoteTotal: number; onsets: MgOnset[] }
const DUR4 = oracle.dur4 as unknown as Record<string, MgProfile>;
const DUR8 = oracle.dur8 as unknown as Record<string, MgProfile>;

const BAR = 4;
// comp 力度区间(velRatio 0..1 → 此区间;保 MG 相对重音,整体落舒缓伴奏档,downstream 再映射 0..127)。
const VEL_LO = 0.30, VEL_HI = 0.48;

/** 该 textureCase 是否有 MG comp/chord dry 语义(否则 bass-only / 无 profile)。 */
export function hasMgCompProfile(textureCase: string): boolean {
  const p = DUR4[textureCase];
  return !!p && p.onsets.length > 0;
}

/** MG comp dry 语义的【onset 栅格】(供 product 端贴格判定 + 测试)。 */
export function mgCompOnsets(textureCase: string, span: 4 | 8 = 4): readonly MgOnset[] {
  return (span === 8 ? DUR8 : DUR4)[textureCase]?.onsets ?? [];
}

/**
 * MG 严格 dry comp 渲染:按 oracle 的 onset/duration/velRatio/cardinality 投影我们的 voicing。
 *   - n≤1 → 单音(arp 散布 / roll 密集 —— 都用 voicing 循环取一音,忠实 MG 每击单音)。
 *   - n≥2 → 柱式块(用我们整组 voicing;MG 的 block = 全和弦,音数随 voicing)。
 *   - 时值 d、力度比 vr 忠实 MG;> 4 拍 span 按小节平铺 dur4 profile(MG 多数织体逐小节循环)。
 */
export function renderTextureCompDryStrictMg(textureCase: string, voicedRaw: readonly number[], durationBeats: number): TextureChordHit[] {
  // ★ 按 span 选 MG 实采 profile:≥6 拍用 dur8(MG 对长 span 的真实行为,部分织体延音而非平铺),否则 dur4。
  const useDur8 = durationBeats >= 6 && (DUR8[textureCase]?.onsets.length ?? 0) > 0;
  const prof = useDur8 ? DUR8[textureCase] : DUR4[textureCase];
  if (!prof || prof.onsets.length === 0) return [];
  const baseSpan = useDur8 ? 8 : BAR;
  const cM = [...voicedRaw].sort((a, b) => a - b);
  if (cM.length === 0) return [];
  const dur = durationBeats;
  const hits: TextureChordHit[] = [];
  const bars = Math.max(1, Math.ceil(dur / baseSpan)); // > baseSpan 的 span 按 baseSpan 平铺
  let arpIdx = 0;
  for (let bar = 0; bar < bars; bar++) {
    const off = bar * baseSpan;
    for (const o of prof.onsets) {
      const t = off + o.t;
      if (t >= dur) break;
      const d = Math.max(0.05, Math.min(o.d, dur - t));
      const vel = VEL_LO + o.vr * (VEL_HI - VEL_LO);
      const midis = o.n <= 1 ? [cM[arpIdx++ % cM.length]] : cM.slice(0, Math.min(Math.max(o.n, 2), cM.length));
      if (midis.length) hits.push({ tRel: t, dur: d, midis, vel });
    }
  }
  return hits;
}
