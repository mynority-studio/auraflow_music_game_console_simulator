import { describe, it, expect } from 'vitest';
import { planEdges } from '../arranger/edgePlanner';
import { applyEnding, applyLeadIns } from './ending';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { createRandomContext, ticks } from '../foundation';
import type { Section, SectionFunctionTag, ArrangementPlan } from '../arranger/ArrangementPlan';
import type { EndingPlan } from '../instrumental/InstrumentationPlan';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';

// ============================================================
// 段落边界(2026-06-08):Arranger 下发 entryBySection(lead-in 衔接)+ endingStyle(收尾),
//   器配排 endingPlan(乐器进出),render(ending.ts)投影成手势。修 intro→verse 衔接 / outro 收尾。
// ============================================================

function sec(id: string, role: Section['role'], functionTag?: SectionFunctionTag): Section {
  return { id, role, functionTag, bars: 4, hookPolicy: 'none' };
}
const N = (startTick: number, velocity: number, durationTicks = 240): NoteIR => ({ pitch: 60 as never, startTick: ticks(startTick), durationTicks: ticks(durationTicks), velocity });

describe('arranger/edgePlanner · planEdges', () => {
  it('能量跃升 → lead-in(intro→verse / verse→chorus);平/降 → downbeat', () => {
    const sections = [sec('intro', 'intro', 'setup'), sec('v1', 'verse', 'story'), sec('c1', 'chorus', 'hook'), sec('v2', 'verse', 'story'), sec('out', 'outro', 'outro')];
    const energy = { intro: 0.32, v1: 0.52, c1: 0.80, v2: 0.52, out: 0.30 };
    const { entryBySection } = planEdges(sections, energy, 'pop');
    expect(entryBySection.intro).toBe('downbeat'); // 首段
    expect(entryBySection.v1).toBe('lead-in');     // setup→story +0.20
    expect(entryBySection.c1).toBe('lead-in');     // story→hook +0.28
    expect(entryBySection.v2).toBe('downbeat');    // hook→story 降
    expect(entryBySection.out).toBe('downbeat');   // 收尾降
  });

  it('endingStyle 按风格定制:pop=cold / rnb=fade / lofi=fade / jazz=tag / 其它=cold', () => {
    const s = [sec('a', 'verse', 'story')];
    const e = { a: 0.5 };
    expect(planEdges(s, e, 'pop').endingStyle).toBe('cold');
    expect(planEdges(s, e, 'rnb').endingStyle).toBe('fade');
    expect(planEdges(s, e, 'lofi').endingStyle).toBe('fade');
    expect(planEdges(s, e, 'jazz').endingStyle).toBe('tag');
    expect(planEdges(s, e, 'modal').endingStyle).toBe('cold');
  });

  it('lofi loop→loop 不跃升 → 全 downbeat(稳态,无突兀 build)', () => {
    const sections = [sec('li', 'intro', 'setup'), sec('l1', 'verse', 'loop'), sec('l2', 'verse', 'loop'), sec('of', 'outro', 'outro')];
    const energy = { li: 0.32, l1: 0.48, l2: 0.48, of: 0.30 };
    const { entryBySection } = planEdges(sections, energy, 'lofi');
    expect(entryBySection.l1).toBe('lead-in');  // setup→loop +0.16
    expect(entryBySection.l2).toBe('downbeat'); // loop→loop 0
  });
});

describe('arranger + 器配 · entryBySection / endingPlan', () => {
  const CASES: [string, 'cold' | 'fade' | 'tag'][] = [['pop', 'cold'], ['rnb', 'fade'], ['lofi', 'fade'], ['jazz', 'tag']];
  for (const [style, ending] of CASES) {
    it(`${style}:plan.endingStyle=${ending};endingPlan 一致;每段有 entry;首个内容段 lead-in`, () => {
      const seed = 20260608;
      const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
      const arrangement = buildArrangementPlan(band, { rng: createRandomContext(seed) });
      const instr = buildInstrumentationPlan(band, arrangement, createRandomContext(seed).substream('timbre'));

      expect(arrangement.endingStyle).toBe(ending);
      expect(instr.endingPlan.style).toBe(ending);
      for (const s of arrangement.sections) expect(['downbeat', 'lead-in']).toContain(arrangement.entryBySection[s.id]);
      // 至少一处 lead-in(intro→内容 或 verse→chorus)
      expect(Object.values(arrangement.entryBySection).includes('lead-in')).toBe(true);

      // endingPlan 标志位与风格一致
      const ep = instr.endingPlan;
      if (ending === 'fade') { expect(ep.fadeOut).toBe(true); expect(ep.holdFinalChord).toBe(false); expect(ep.coldStop).toBe(false); }
      if (ending === 'tag') { expect(ep.holdFinalChord).toBe(true); expect(ep.fadeOut).toBe(false); }
      if (ending === 'cold') { expect(ep.coldStop).toBe(true); expect(Object.keys(ep.exitBarByRole).length).toBe(0); }
    });
  }

  it('确定性:同 seed → 同 entryBySection + endingPlan', () => {
    const mk = () => {
      const band = buildBandSpec({ seed: 77, styleHint: 'rnb', mood: 'build', targetDuration: 120 });
      const arr = buildArrangementPlan(band, { rng: createRandomContext(77) });
      const instr = buildInstrumentationPlan(band, arr, createRandomContext(77).substream('timbre'));
      return JSON.stringify({ e: arr.entryBySection, p: instr.endingPlan });
    };
    expect(mk()).toBe(mk());
  });
});

// ---- render/ending 手势(合成轨,bpb=4 ppq=480 → barTicks=1920;outro 段 [3840,7680)) ----
const arr2 = { sections: [{ id: 'v', bars: 2 }, { id: 'o', bars: 2 }] } as unknown as ArrangementPlan;
const PPQ = 480, BPB = 4, OUTRO_START = 3840, OUTRO_END = 7680, BAR = 1920;

describe('render/ending · applyEnding', () => {
  it('fade:outro 力度随位置渐弱 + 节奏件按 exitBar 退出', () => {
    const plan: EndingPlan = { style: 'fade', outroSectionId: 'o', outroBars: 2, exitBarByRole: { drum: 1 }, holdFinalChord: false, fadeOut: true, coldStop: false };
    const pad: TrackIR = { role: 'pad', notes: [N(OUTRO_START, 100), N(OUTRO_START + BAR, 100), N(OUTRO_END - 192, 100)] };
    const drum: TrackIR = { role: 'drum', notes: [N(OUTRO_START, 100), N(OUTRO_START + BAR, 100)] };
    const [outPad, outDrum] = applyEnding([pad, drum], arr2, plan, PPQ, BPB);
    const v = outPad.notes.map((n) => n.velocity);
    expect(v[0]).toBeGreaterThan(v[1]); // 渐弱
    expect(v[1]).toBeGreaterThan(v[2]);
    // drum exit=1 → 第 2 小节(>=5760)的鼓丢弃
    expect(outDrum.notes.length).toBe(1);
    expect(outDrum.notes[0].startTick).toBe(OUTRO_START);
  });

  it('tag:末和弦(comp/pad)延留到曲末 + 节奏件末小节退出', () => {
    const plan: EndingPlan = { style: 'tag', outroSectionId: 'o', outroBars: 2, exitBarByRole: { drum: 1, bass: 1 }, holdFinalChord: true, fadeOut: false, coldStop: false };
    const comp: TrackIR = { role: 'comp', notes: [N(OUTRO_START + BAR, 80, 240)] }; // 末小节一个和弦 hit
    const bass: TrackIR = { role: 'bass', notes: [N(OUTRO_START + BAR, 80)] };
    const [outComp, outBass] = applyEnding([comp, bass], arr2, plan, PPQ, BPB);
    expect((outComp.notes[0].durationTicks as number)).toBe(OUTRO_END - (OUTRO_START + BAR)); // 延留到末
    expect(outBass.notes.length).toBe(0); // bass 末小节退出
  });

  it('cold:末小节 button 重音 + 干净停(不越界)', () => {
    const plan: EndingPlan = { style: 'cold', outroSectionId: 'o', outroBars: 2, exitBarByRole: {}, holdFinalChord: false, fadeOut: false, coldStop: true };
    const comp: TrackIR = { role: 'comp', notes: [N(OUTRO_START, 80), N(OUTRO_START + BAR, 80, 9999)] };
    const [out] = applyEnding([comp], arr2, plan, PPQ, BPB);
    expect(out.notes[1].velocity).toBeGreaterThan(out.notes[0].velocity); // 末小节重音
    expect((out.notes[1].startTick as number) + (out.notes[1].durationTicks as number)).toBeLessThanOrEqual(OUTRO_END); // 不越界
  });

  it('无 outroSectionId → 原样返回', () => {
    const plan: EndingPlan = { style: 'cold', outroSectionId: null, outroBars: 0, exitBarByRole: {}, holdFinalChord: false, fadeOut: false, coldStop: true };
    const t: TrackIR = { role: 'comp', notes: [N(0, 80)] };
    expect(applyEnding([t], arr2, plan, PPQ, BPB)[0].notes[0].velocity).toBe(80);
  });
});

describe('render/ending · applyLeadIns', () => {
  it('leadInBars 内 crescendo(末小节越靠下拍越响);bar 外不变', () => {
    const t: TrackIR = { role: 'comp', notes: [N(0, 100), N(1440, 100), N(BAR, 100)] }; // bar0: 0/1440;bar1: 1920
    const [out] = applyLeadIns([t], new Set([0]), PPQ, BPB);
    expect(out.notes[0].velocity).toBeLessThan(out.notes[1].velocity); // bar0 内 crescendo
    expect(out.notes[2].velocity).toBe(100); // bar1 不在 leadInBars
  });

  it('空 leadInBars → 原样', () => {
    const t: TrackIR = { role: 'comp', notes: [N(0, 100)] };
    expect(applyLeadIns([t], new Set(), PPQ, BPB)[0].notes[0].velocity).toBe(100);
  });
});
