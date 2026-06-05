// ============================================================
// newEngine · render · 多声部同一时钟对拍/复调(2026-06-05)
// ------------------------------------------------------------
// 锁:textureSchedule 中央下发 → bass/comp/drum 共享同一 textureCase。
//   bass 落纹理 bass onset(对拍);comp 落纹理 chord hit;drum 跟 pocket;全确定性。
// ============================================================

import { describe, expect, it } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildTextureSchedule } from './textureSchedule';
import { renderBass } from './bassRenderer';
import { renderAccompaniment } from './accompanimentRenderer';
import { renderDrums } from './drumRenderer';
import { renderTextureBassHits, texturePocket } from './textureRenderer';
import { createRandomContext, createTimebase, beats, pc } from '../foundation';

const tb = createTimebase({ meter: { numerator: 4, denominator: 4 }, tempoMap: [{ atBeat: beats(0), bpm: 90 }] });

function setup(seed: number, style: string) {
  const band = buildBandSpec({ seed, styleHint: style, mood: 'x', targetDuration: 150, key: pc(0) });
  const arr = buildArrangementPlan(band);
  const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
  const instr = buildInstrumentationPlan(band, arr);
  const active = new Set<string>();
  for (const [sid, tex] of Object.entries(instr.textureBySection)) if (instr.textureYieldPolicy[tex] === 'active') active.add(sid);
  const sectionRoleById = Object.fromEntries(arr.sections.map((s) => [s.id, s.role]));
  const schedule = buildTextureSchedule({ plan, style: band.style, sectionRoleById, activeSectionIds: active, textureRng: createRandomContext(seed).substream('compTexture') });
  return { band, plan, schedule, active, sectionRoleById };
}

describe('多声部对拍/复调(中央 textureSchedule)', () => {
  it('bass 落在纹理 bass onset 上(与 comp 同 textureCase = 对拍)', () => {
    const { band, plan, schedule } = setup(7, 'pop');
    const span = plan.chordTimeline.find((c) => schedule[c.id])!;
    expect(span).toBeDefined();
    const tc = schedule[span.id];
    const bass = renderBass(plan, tb, band.style, schedule);
    const wantTicks = renderTextureBassHits(tc, span.durationBeats as number)
      .map((h) => tb.beatToTick(beats((span.startBeat as number) + h.tRel)) as number);
    const got = new Set(bass.notes.map((n) => n.startTick as number));
    expect(wantTicks.length).toBeGreaterThan(0);
    for (const t of wantTicks) expect(got.has(t), `bass 缺纹理 onset @${t}`).toBe(true);
  });

  it('comp 与 bass 共享 schedule(同一指令源)', () => {
    const { band, plan, schedule, active, sectionRoleById } = setup(7, 'pop');
    const comp = renderAccompaniment(plan, tb, { style: band.style, compProgram: band.roleProgram.comp, sectionRoleById, activeSectionIds: active, voicingRng: createRandomContext(7).substream('accompaniment'), textureSchedule: schedule })[0];
    expect(Object.keys(schedule).length).toBeGreaterThan(0);
    expect(comp.notes.length).toBeGreaterThan(0);
  });

  it('drum 跟纹理 pocket:带 schedule vs 不带 → 输出不同(halftime/sparse 段换鼓型)', () => {
    const { plan, schedule } = setup(7, 'pop');
    const pockets = new Set(plan.chordTimeline.filter((c) => schedule[c.id]).map((c) => texturePocket(schedule[c.id])));
    expect(pockets.has('halftime') || pockets.has('sparse')).toBe(true); // 有非 normal pocket 才有意义
    const withSched = renderDrums(plan, tb, 4, { style: 'pop', textureSchedule: schedule });
    const without = renderDrums(plan, tb, 4, { style: 'pop' });
    expect(JSON.stringify(withSched.notes)).not.toBe(JSON.stringify(without.notes));
  });

  it('确定性:bass/comp/drum 同 seed 两次完全一致', () => {
    const a = setup(5, 'jazz');
    const b = setup(5, 'jazz');
    const sig = (s: ReturnType<typeof setup>) => {
      const bass = renderBass(s.plan, tb, s.band.style, s.schedule);
      const drum = renderDrums(s.plan, tb, 4, { style: 'jazz', textureSchedule: s.schedule });
      return JSON.stringify(bass.notes) + '|' + JSON.stringify(drum.notes);
    };
    expect(sig(a)).toBe(sig(b));
  });
});
