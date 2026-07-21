import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import {
  JAZZ_4_4_ARCHETYPE_ID,
  type JazzArrangementArchetypeId,
} from '../arranger/jazzArchetypePlanner';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderSongFull } from './renderCoordinator';
import { createTimebase, createRandomContext, beats } from '../foundation';

// ============================================================
// 重音对拍 / 复调对拍(2026-06-09):comp 在强拍位与 bass/drum 锁拍(原 comp 系统性晚 0.02-0.05 = flam/错拍)。
//   修:pocketizeBeat 强拍位锁紧 + comp 柱式块整拍硬锁 + roll/arp 首声部落格(去统一晚拍)。
//   验收:① comp 在整拍处平均偏移小(不系统性晚)② bar 下拍处 bass/drum/comp 同拍(spread 紧)。
// ============================================================

function compIntegerBeatStats(style: string, jazzArchetypeId?: JazzArrangementArchetypeId) {
  const offs: number[] = [];
  let spreadBad = 0, totalDb = 0;
  for (let seed = 0; seed < 25; seed++) {
    const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
    const arr = buildArrangementPlan(band, { rng: createRandomContext(seed), jazzArchetypeId });
    const instr = buildInstrumentationPlan(band, arr, createRandomContext(seed).substream('timbre'));
    const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
    const tb = createTimebase({ meter: { numerator: arr.meter.numerator, denominator: arr.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arr.tempoBpm }] });
    const { ir } = renderSongFull(band, arr, plan, instr, tb, createRandomContext(seed));
    const ppq = tb.ppq, bpb = arr.meter.numerator, barTicks = bpb * ppq;
    const byRole: Record<string, number[]> = {};
    for (const t of ir.tracks) byRole[t.role] = t.notes.map((n) => n.startTick as number);
    for (const n of byRole.comp ?? []) { const b = n / ppq; const d = b - Math.round(b); if (Math.abs(d) < 0.2) offs.push(d); }
    const bars = Math.round(arr.sections.reduce((x, s) => x + s.bars, 0));
    for (let bar = 1; bar < bars; bar++) {
      const D = bar * barTicks; const near: number[] = [];
      for (const r of ['bass', 'drum', 'comp']) { let best = Infinity; for (const x of byRole[r] ?? []) { const dd = x - D; if (Math.abs(dd) < 0.15 * ppq && Math.abs(dd) < Math.abs(best)) best = dd; } if (best !== Infinity) near.push(best / ppq); }
      if (near.length < 2) continue; totalDb++;
      if (Math.max(...near) - Math.min(...near) > 0.04) spreadBad++;
    }
  }
  const mean = offs.reduce((a, b) => a + b, 0) / offs.length;
  return {
    mean,
    multiRoleDownbeats: totalDb,
    spreadBadRate: totalDb > 0 ? spreadBad / totalDb : null,
  };
}

describe('render/accentAlignment · comp 强拍位锁拍', () => {
  for (const style of ['pop', 'rnb', 'lofi']) {
    it(`${style}:comp 整拍平均偏移小(不系统晚)+ 下拍多轨同拍`, () => {
      const { mean, spreadBadRate } = compIntegerBeatStats(style);
      expect(mean).toBeLessThanOrEqual(0.018);        // comp 不再系统性晚(原 jazz 0.046/pop 0.020)
      expect(spreadBadRate).not.toBeNull();
      expect(spreadBadRate!).toBeLessThanOrEqual(0.06); // 下拍处 bass/drum/comp spread>0.04 的占比低
    }, 15000); // 25 seed 端到端:并行负载下放宽超时
  }

  it('jazz 4/4:Bass+Comp 共存时仍保持下拍对齐', () => {
    const { mean, multiRoleDownbeats, spreadBadRate } = compIntegerBeatStats('jazz', JAZZ_4_4_ARCHETYPE_ID);
    expect(mean).toBeLessThanOrEqual(0.018);
    expect(multiRoleDownbeats).toBeGreaterThan(0);
    expect(spreadBadRate).not.toBeNull();
    expect(spreadBadRate!).toBeLessThanOrEqual(0.06);
  }, 15000);
});
