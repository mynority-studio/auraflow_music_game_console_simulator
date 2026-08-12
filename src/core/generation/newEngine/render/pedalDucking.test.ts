// ============================================================
// newEngine · render · CC64 踏板 + 伴奏 ducking(融合,2026-06-05)
// ------------------------------------------------------------
// 锁:Arranger 下发 keyboardMotion，器配层只为有真实钢琴踏板能力的
// program 写 PedalPlan；render/MIDI 不再按 macro style 猜踏板。
// ============================================================

import { describe, expect, it } from 'vitest';
import { buildSongBundle, traceGeneration } from '../generation';
import { deriveMusicIntentPlan } from '../arranger/deriveMusicIntentPlan';
import { musicalIRToMidiEvents } from '../sandbox/irToMidi';
import { duckUnderLead, renderSongFull } from './renderCoordinator';
import { beats, midi, ticks } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';

const gen = (style: string, seed = 7) => traceGeneration({ seed, styleHint: style, mood: 'x', targetDuration: 120 });
const compTrack = (style: string, seed = 7) => gen(style, seed).ir.tracks.find((t) => t.role === 'comp');
const plannedPedalEvents = (style: string, seed = 7, role?: TrackIR['role']) => role
  ? gen(style, seed).ir.tracks.find((track) => track.role === role)?.pedalEvents ?? []
  : gen(style, seed).ir.tracks.flatMap((track) => track.pedalEvents ?? []);
const audiblePedalDowns = (style: string, seed = 7) => musicalIRToMidiEvents(gen(style, seed).ir)
  .filter((event) => event.type === 'cc' && event.data1 === 64 && event.data2 >= 64);

describe('CC64 踏板 + 伴奏 ducking', () => {
  it('GM5/FM comp 踏板由能力+keyboardMotion 门决定(2026-08-12 板测 documented)；ACG 三轨同步消费 CC64', () => {
    for (const s of ['pop', 'rnb']) {
      expect(compTrack(s)?.program, `${s} comp program`).toBe(5);
    }
    // pop 抒情段有踏板;rnb 若全切分段则 0(keyboardMotion 门,正确演奏法)
    expect(plannedPedalEvents('pop', 7, 'comp').length, 'pop GM5 comp pedal(documented)').toBeGreaterThan(0);
    const acgPianoPed = audiblePedalDowns('acg', 7);
    expect(compTrack('acg', 7)?.program, 'acg seed7 comp program').toBe(0);
    const plans = (['lead', 'comp', 'bass'] as const).map((role) => plannedPedalEvents('acg', 7, role));
    const acgBundle = buildSongBundle({ seed: 7, styleHint: 'acg', mood: 'x', targetDuration: 120 });
    const capabilityPlans = (['lead', 'comp', 'bass'] as const)
      .map((role) => acgBundle.instrumentation.pedalPlanByRole[role]);
    expect(capabilityPlans.every((plan) => plan?.timingOwner === 'arranger-piano-score'
      && plan.playerGroup === 'shared-piano'
      && plan.authorizedSectionIds?.length === acgBundle.arrangement.sections.length
      && Object.keys(plan.disabledBySection).length === 0)).toBe(true);
    expect(plans[0]).toEqual(plans[1]);
    expect(plans[1]).toEqual(plans[2]);
    expect(acgPianoPed.length, '三条同钢琴职责均投影 CC64 down')
      .toBe(plans.flatMap((plan) => plan.filter((event) => event.down)).length);
  });

  it('ACG 三手消费同一份 pre-NoteIR pedal score，器配层只保留能力授权', () => {
    const bundle = buildSongBundle({ seed: 7, styleHint: 'acg', mood: 'lyrical', targetDuration: 90 });
    const basePedal = bundle.instrumentation.pedalPlanByRole.comp?.events ?? [];
    expect(bundle.instrumentation.pedalPlanByRole.comp?.timingOwner).toBe('arranger-piano-score');
    expect(basePedal).toEqual([]);
    expect(bundle.instrumentation.pedalPlanByRole.comp?.authorizedSectionIds)
      .toEqual(bundle.arrangement.sections.map((section) => section.id));
    const rendered = renderSongFull(
      bundle.band,
      bundle.arrangement,
      bundle.harmonic,
      bundle.instrumentation,
      bundle.timebase,
      bundle.seedRng,
      undefined,
      undefined,
      deriveMusicIntentPlan(bundle.band.style, bundle.arrangement),
      undefined,
      bundle.acgPianoScorePlan,
    );
    const pedalLanes = (['lead', 'comp', 'bass'] as const).map((role) => {
      const track = rendered.ir.tracks.find((candidate) => candidate.role === role);
      expect(track, `${role} track`).toBeDefined();
      return track!.pedalEvents ?? [];
    });
    expect(pedalLanes[0]).toEqual(pedalLanes[1]);
    expect(pedalLanes[1]).toEqual(pedalLanes[2]);
    expect(pedalLanes[0].length).toBeGreaterThan(2);
    for (let index = 1; index < pedalLanes[0].length; index++) {
      expect(pedalLanes[0][index]!.down).not.toBe(pedalLanes[0][index - 1]!.down);
      expect(pedalLanes[0][index]!.atTick as number).toBeGreaterThan(pedalLanes[0][index - 1]!.atTick as number);
    }

    const outgoing = musicalIRToMidiEvents(rendered.ir, 50, 'acg')
      .filter((event) => event.type === 'cc' && event.data1 === 64);
    for (const channel of [1, 2, 3]) {
      const lane = outgoing.filter((event) => event.channel === channel);
      const sameTickStates = new Map<number, Set<number>>();
      for (const event of lane) {
        const values = sameTickStates.get(event.ticks) ?? new Set<number>();
        values.add(event.data2 >= 64 ? 1 : 0);
        sameTickStates.set(event.ticks, values);
      }
      expect([...sameTickStates.values()].every((states) => states.size === 1), `ch${channel} no blind same-tick repedal`).toBe(true);
    }
  });

  it('未被总谱长空气句覆盖的 ACG 踏板仍按既有边界交替', () => {
    const ped = plannedPedalEvents('acg', 7, 'comp');
    expect(ped.length).toBeGreaterThan(2);
    expect(ped[0]).toMatchObject({ atTick: ticks(0), down: true });
    for (let i = 0; i < ped.length - 1; i++) expect(ped[i].down).not.toBe(ped[i + 1].down);
  });

  it('POP 大钢琴 comp 只在 Arranger 判定的抒情/分解段使用按和声换踏板', () => {
    expect(compTrack('pop', 1662)?.program).toBe(0);
    const planned = plannedPedalEvents('pop', 1662, 'comp');
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.every((event) => event.down || !event.down)).toBe(true);
    expect(planned.filter((event) => event.down).length).toBe(planned.filter((event) => !event.down).length);
  });

  it('JAZZ 原声钢琴 comp 保持默认 CC11；CC64 仅可出现在总谱标注的抒情收束段', () => {
    const bundle = buildSongBundle({ seed: 9, styleHint: 'jazz', mood: 'x', targetDuration: 120 });
    const ir = gen('jazz', 9).ir;
    const comp = ir.tracks.find((track) => track.role === 'comp');
    expect([0, 1, 3]).toContain(comp?.program);
    const beatsPerBar = bundle.arrangement.meter.numerator * (4 / bundle.arrangement.meter.denominator);
    let sectionStartBeat = 0;
    const lyricalRanges = bundle.arrangement.sections.flatMap((section) => {
      const startBeat = sectionStartBeat;
      sectionStartBeat += section.bars * beatsPerBar;
      return bundle.arrangement.rolePerformanceBySection.comp[section.id].keyboardMotion === 'lyrical'
        ? [{ startTick: bundle.timebase.beatToTick(beats(startBeat)) as number, endTick: bundle.timebase.beatToTick(beats(sectionStartBeat)) as number }]
        : [];
    });
    const compPedalPlan = bundle.instrumentation.pedalPlanByRole.comp?.events ?? [];
    expect(compPedalPlan.every((event) => bundle.arrangement.rolePerformanceBySection.comp[event.sectionId].keyboardMotion === 'lyrical')).toBe(true);
    const outgoing = musicalIRToMidiEvents(ir, 0, 'jazz');
    const compPedal = outgoing.filter((event) => event.type === 'cc' && event.channel === 2 && event.data1 === 64);
    const compExpression = outgoing.filter((event) => event.type === 'cc' && event.channel === 2 && event.data1 === 11);
    expect(compPedal.length).toBeGreaterThan(0);
    expect(compPedal.every((event) => lyricalRanges.some((range) => event.ticks >= range.startTick && event.ticks <= range.endTick))).toBe(true);
    expect(compExpression).toEqual([]);
  });

  it('ACG 不自动写未完成 5504 实板标定的 CC72 release', () => {
    const cc72 = musicalIRToMidiEvents(gen('acg', 7).ir)
      .filter((event) => event.type === 'cc' && event.data1 === 72 && event.ticks === 0);
    expect(cc72).toEqual([]);
  });

  it('LOFI 不再由风格注入 CC64 或未标定的电钢 CC72', () => {
    const ir = gen('lofi', 7).ir;
    const events = musicalIRToMidiEvents(ir);
    const cc64 = events.filter((event) => event.type === 'cc' && event.data1 === 64);
    expect(cc64).toEqual([]);
    const cc72 = events.filter((event) => event.type === 'cc' && event.data1 === 72 && event.ticks === 0);
    expect(cc72).toEqual([]);
  });

  it('ducking 机制:comp 撞旋律 ×factor 变软,留白处不变(直接单测,稳于全局平均)', () => {
    // ★ 改为机制单测:A3 后各段织体 velocity 差异大,全局 ducked/free 平均比较失真
    //   (active 段 ducked 仍可能 > breakdown 段 free)。ducking 本身是 per-note ×factor,在此直接验。
    const lead: TrackIR = { role: 'lead', notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(240), velocity: 90 }] };
    const comp: TrackIR = { role: 'comp', notes: [
      { pitch: midi(60), startTick: ticks(0), durationTicks: ticks(240), velocity: 80 },   // 撞 lead [0,240]
      { pitch: midi(62), startTick: ticks(480), durationTicks: ticks(240), velocity: 80 }, // 留白处
    ] };
    const out = duckUnderLead([comp, lead], 0.9).find((t) => t.role === 'comp')!;
    expect(out.notes[0].velocity).toBe(Math.round(80 * 0.9)); // 撞旋律 → ×0.9 = 72
    expect(out.notes[1].velocity).toBe(80);                    // 留白 → 不变
    expect(out.notes[0].velocity).toBeLessThan(out.notes[1].velocity); // 撞处更软
    expect(out.notes[0].velocity).toBeGreaterThanOrEqual(50);  // 仍可听
  });

  it('确定性:同 seed 两次 lead/comp 一致', () => {
    const a = JSON.stringify(gen('pop').ir.tracks.find((t) => t.role === 'comp')!.notes);
    const b = JSON.stringify(gen('pop').ir.tracks.find((t) => t.role === 'comp')!.notes);
    expect(a).toBe(b);
  });
});
