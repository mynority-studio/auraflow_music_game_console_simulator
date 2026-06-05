// ============================================================
// newEngine · render · comp rich-texture 接线集成测试(2026-06-05 第一刀)
// ------------------------------------------------------------
// 锁:POP/RNB/JAZZ/LOFI 的 comp 走 rich textureCase 渲染(节奏来自 texture,
//   voicing 仍是真 voicing);确定性;端到端 Auditor 不 failed;BLUES 走老 compPattern。
// ============================================================

import { describe, expect, it } from 'vitest';
import { renderAccompaniment } from './accompanimentRenderer';
import { buildTextureSchedule } from './textureSchedule';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { generateSong } from '../generation/GenerationController';
import { createRandomContext, createTimebase, beats, pc } from '../foundation';

function compFor(seed: number, style: string, withTexture = true) {
  const band = buildBandSpec({ seed, styleHint: style, mood: 'x', targetDuration: 150, key: pc(0) });
  const arr = buildArrangementPlan(band);
  const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
  const tb = createTimebase({ meter: { numerator: 4, denominator: 4 }, tempoMap: [{ atBeat: beats(0), bpm: 90 }] });
  const sectionRoleById = Object.fromEntries(arr.sections.map((s) => [s.id, s.role]));
  const instr = buildInstrumentationPlan(band, arr);
  const active = new Set<string>();
  for (const [sid, tex] of Object.entries(instr.textureBySection)) if (instr.textureYieldPolicy[tex] === 'active') active.add(sid);
  const schedule = withTexture
    ? buildTextureSchedule({ plan, style: band.style, sectionRoleById, activeSectionIds: active, textureRng: createRandomContext(seed).substream('compTexture') })
    : undefined;
  const ctx: Parameters<typeof renderAccompaniment>[2] = {
    style: band.style, compProgram: band.roleProgram.comp, sectionRoleById, activeSectionIds: active,
    voicingRng: createRandomContext(seed).substream('accompaniment'),
    textureSchedule: schedule,
  };
  return renderAccompaniment(plan, tb, ctx)[0];
}

describe('comp rich-texture 接线', () => {
  it('LOFI comp 走 texture:出音 + 落在 texture 的 off-grid 位置(非整拍网格)', () => {
    const comp = compFor(3, 'lofi');
    expect(comp.notes.length).toBeGreaterThan(0);
    // texture hit 落 0.05/0.66/2.15 等 → tick 不全在整拍上(compPattern 只落整数/半拍网格)
    const tb = createTimebase({ meter: { numerator: 4, denominator: 4 }, tempoMap: [{ atBeat: beats(0), bpm: 90 }] });
    const quarter = tb.beatToTick(beats(1)) as number;
    const offGrid = comp.notes.some((n) => ((n.startTick as number) % (quarter / 2)) !== 0);
    expect(offGrid).toBe(true);
  });

  it('确定性:同 seed 两次 comp 完全一致', () => {
    const a = JSON.stringify(compFor(7, 'pop').notes);
    const b = JSON.stringify(compFor(7, 'pop').notes);
    expect(a).toBe(b);
  });

  it('texture 路 vs 老 compPattern 路 → 输出不同(确实接上了 texture)', () => {
    const tex = JSON.stringify(compFor(5, 'pop', true).notes);
    const old = JSON.stringify(compFor(5, 'pop', false).notes);
    expect(tex).not.toBe(old);
  });

  it('POP/RNB/JAZZ/LOFI comp 都能出 texture 音', () => {
    for (const s of ['pop', 'rnb', 'jazz', 'lofi']) {
      expect(compFor(2, s).notes.length, s).toBeGreaterThan(0);
    }
  });

  it('端到端:lofi/pop/jazz seed 0-15 全收敛(texture 不让 Auditor failed)', () => {
    for (const style of ['lofi', 'pop', 'jazz']) {
      for (let seed = 0; seed < 16; seed++) {
        const r = generateSong({ seed, styleHint: style, mood: 'x', targetDuration: 150, key: pc(0) });
        expect(r.status, `${style}#${seed}`).not.toBe('failed');
      }
    }
  });
});
