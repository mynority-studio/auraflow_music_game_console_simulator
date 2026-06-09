// ============================================================
// newEngine · render · Gap B 织体 dry 语义 parity(MG oracle 比对)
// ------------------------------------------------------------
// CODEX Gap B:legacy comp 走 MG 严格 dry。oracle = ../melodygenerative applyTexture 真跑 dump
//   (__mgTextureOracle__/comp_cmaj7.json),非 newEngine 自比。对每个 chord-producing textureCase 断言
//   语义等价:onset 栅格 / 每击音数(arp 单音 vs block 多音)/ 时值策略 / 力度比策略。
//   pitch 用我们的 voicing(Option B)→ 比 cardinality 而非 bit pitch。pad/drum 不在范围。
// ============================================================

import { describe, it, expect } from 'vitest';
import { renderTextureChordHits } from './textureRenderer';
import { renderTextureCompDryStrictMg } from './mgTextureCompDry';
import oracle from './__mgTextureOracle__/comp_cmaj7.json';

const VOICED = [60, 64, 67, 71]; // 与 oracle 同 Cmaj7
const MODERN_LOFI = new Set(['Lyrical_Felt_Piano_Sparse', 'Lyrical_10th_Broken', 'Ambient_Pad_Breath', 'Ambient_Reverse_Swell', 'Soft_Guitar_Pluck_8ths', 'Piano_Question_Answer', 'Low_Pedal_Color_Wash', 'HalfTime_Emotional_Pulse', 'Piano_Lofi_OneShot_Space', 'Piano_Lofi_Late_Chord_Answer', 'Piano_Emo_Broken_10th', 'Piano_Ambient_Sustain_Wash', 'Piano_HalfTime_Soft_Pulse', 'Piano_Lofi_Dusty_Chops', 'Piano_Lofi_Tape_Wobble_Arp', 'Piano_Wide_Color_Motion', 'Piano_CommonTone_Soft_Roll']);

type Onset = { t: number; n: number; d: number; vr: number };
const dur4 = oracle.dur4 as Record<string, { onsetCount: number; onsets: Onset[] }>;
const dur8 = oracle.dur8 as Record<string, { onsetCount: number; onsets: Onset[] }>;

describe('Gap B — legacy comp 严格 dry parity(MG oracle)', () => {
  // 遍历所有【legacy + chord-producing】case:strict-dry 渲染语义 == MG dur4 oracle。
  const legacyChordCases = Object.entries(dur4).filter(([tc, p]) => !MODERN_LOFI.has(tc) && p.onsets.length > 0);

  for (const [tc, p] of legacyChordCases) {
    it(`${tc}: strict-dry 语义 == MG oracle(onset 栅格/音数/时值/力度比)`, () => {
      const hits = renderTextureCompDryStrictMg(tc, VOICED, 4);
      // ① onset 栅格:逐 onset 时间忠实 MG
      expect(hits.map((h) => +h.tRel.toFixed(3))).toEqual(p.onsets.map((o) => +o.t.toFixed(3)));
      // ② 每击音数策略:MG n≤1 → 单音(arp/roll);n≥2 → 多音(block)
      hits.forEach((h, i) => {
        if (p.onsets[i].n <= 1) expect(h.midis.length, `${tc}@${i} 应单音`).toBe(1);
        else expect(h.midis.length, `${tc}@${i} 应多音`).toBeGreaterThan(1);
      });
      // ③ 时值策略:逐 onset 时值 == MG(capped 到 span)
      hits.forEach((h, i) => expect(h.dur).toBeCloseTo(Math.min(p.onsets[i].d, 4 - p.onsets[i].t), 1));
      // ④ 力度比策略:vr 最大的 onset → vel 最大(相对重音保留)
      const maxVrIdx = p.onsets.reduce((mi, o, i, a) => (o.vr > a[mi].vr ? i : mi), 0);
      const maxVelIdx = hits.reduce((mi, h, i, a) => (h.vel > a[mi].vel ? i : mi), 0);
      expect(hits[maxVelIdx].vel).toBeCloseTo(hits[maxVrIdx].vel, 5); // 同 vr 的 vel 相等(并列最大)
    });
  }

  it('dur8:长 span 用 MG dur8 profile(部分织体延音,非平铺)', () => {
    for (const tc of ['Block_Chord', 'Pop_Anthem_Pulse', 'Jazz_Comping']) {
      if (!dur8[tc]?.onsets.length) continue;
      const hits = renderTextureCompDryStrictMg(tc, VOICED, 8);
      expect(hits.map((h) => +h.tRel.toFixed(2)), tc).toEqual(dur8[tc].onsets.map((o) => +o.t.toFixed(2)));
    }
  });

  it('modern/lofi(忠实手港):renderTextureChordHits onset 数与 MG oracle 一致(±1 容贴格)', () => {
    for (const tc of MODERN_LOFI) {
      const o = dur4[tc]; if (!o || o.onsets.length === 0) continue;
      const ne = renderTextureChordHits(tc, VOICED, 4);
      const neOnsets = new Set(ne.map((h) => Math.round(h.tRel * 100) / 100)).size;
      // Wide_Color_Motion 是 roll(MG 聚成 1 onset-time,我们展开声部)→ 宽容
      if (tc === 'Piano_Wide_Color_Motion') { expect(ne.length).toBeGreaterThan(0); continue; }
      expect(Math.abs(neOnsets - o.onsets.length), `${tc} onset ${neOnsets} vs MG ${o.onsets.length}`).toBeLessThanOrEqual(1);
    }
  });

  it('bass-only 织体:comp/chord 渲染为空(MG comp=0,和声交 bass)', () => {
    for (const [tc, p] of Object.entries(dur4)) {
      if (p.onsets.length === 0) expect(renderTextureChordHits(tc, VOICED, 4).length, `${tc} 应空`).toBe(0);
    }
  });

  it('确定性:同输入两次一致', () => {
    expect(renderTextureCompDryStrictMg('RnB_Gospel_Triplets', VOICED, 4)).toEqual(renderTextureCompDryStrictMg('RnB_Gospel_Triplets', VOICED, 4));
  });
});
