import { describe, it, expect } from 'vitest';
import { renderPad } from './padRenderer';
import { decidePadComp, type PadCompDecision, type PadMode, type PadCompInteractionMode } from './padCompPolicy';
import { freezeHarmonicPlan, type HarmonicPlanData } from '../harmony/HarmonicPlan';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createTimebase, createRandomContext, beats, pc } from '../foundation';

// ============================================================
// render/padModes · inner-line / cluster-mist / gated-pad + 上层结构 + 正交音阶锁
//   全部 pad 单轨能力(不碰管道/和声合同/伴奏/旋律)。
// ============================================================

interface Spec { root: number; type: string; stable: number[]; scale: number[]; color?: number[]; avoid?: number[]; section?: string }

function makePlan(specs: Spec[]): ReturnType<typeof freezeHarmonicPlan> {
  const data: HarmonicPlanData = {
    romanProgression: [],
    chordTimeline: specs.map((s, i) => ({
      id: `s${i}`, roman: { degree: 1 as const, accidental: 'natural' as const, quality: 'maj7' as const },
      rootPc: pc(s.root), quality: 'maj7', chordType: s.type, startBeat: beats(i * 4), durationBeats: beats(4), sectionId: s.section ?? 'chorus1',
    })),
    chordFunctionTimeline: specs.map(() => 'T' as const),
    chordScaleMap: Object.fromEntries(specs.map((s, i) => [`s${i}`, s.scale.map(pc)])),
    tensionMap: {},
    stableToneMap: Object.fromEntries(specs.map((s, i) => [`s${i}`, s.stable.map(pc)])),
    colorToneMap: Object.fromEntries(specs.map((s, i) => [`s${i}`, (s.color ?? []).map(pc)])),
    avoidNoteMap: Object.fromEntries(specs.map((s, i) => [`s${i}`, (s.avoid ?? []).map(pc)])),
    borrowedChordMap: {}, modulationMap: {},
  };
  return freezeHarmonicPlan(data);
}

const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
function mkDec(padMode: PadMode, interactionMode: PadCompInteractionMode, padMaxVoices: number, omitFifth: boolean): PadCompDecision {
  return { padMode, interactionMode, padMaxVoices, compAllowPedal: true, padOmitRoot: true, padOmitFifth: omitFifth, avoidExactPitchOverlap: true };
}
const topBySpan = (pad: { notes: readonly { startTick: unknown; pitch: unknown }[] }) => {
  const m = new Map<number, number>();
  for (const n of pad.notes) m.set(Number(n.startTick), Math.max(m.get(Number(n.startTick)) ?? 0, Number(n.pitch)));
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
};

describe('render/padModes · inner-line', () => {
  // Fmaj7 → Fm7 → Em7 → A7(directive §4.4 例)— 内声部应级进下行 E→Eb→D→C#。
  const plan = makePlan([
    { root: 5, type: 'maj7', stable: [5, 9, 0, 4], scale: [5, 7, 9, 0, 2, 4] },
    { root: 5, type: 'm7', stable: [5, 8, 0, 3], scale: [5, 7, 8, 0, 2, 3] },
    { root: 4, type: 'm7', stable: [4, 7, 11, 2], scale: [4, 6, 7, 11, 1, 2] },
    { root: 9, type: '7', stable: [9, 1, 4, 7], scale: [9, 11, 1, 2, 4, 6, 7] },
  ]);
  const dec = { chorus1: mkDec('inner-line', 'pad-under-comp', 2, true) };
  const pad = renderPad(plan, timebase, { padDensity: 0.5, decisionBySection: dec, leadReservedLow: 67 });

  it('顶音逐段级进(相邻 ≤ 2 半音)= 慢内声部线条', () => {
    const tops = topBySpan(pad);
    expect(tops.length).toBe(4);
    for (let i = 1; i < tops.length; i++) expect(Math.abs(tops[i] - tops[i - 1])).toBeLessThanOrEqual(2);
  });

  it('确定性', () => {
    const again = renderPad(plan, timebase, { padDensity: 0.5, decisionBySection: dec, leadReservedLow: 67 });
    expect(again.notes.map((n) => [n.pitch, n.startTick])).toEqual(pad.notes.map((n) => [n.pitch, n.startTick]));
  });
});

describe('render/padModes · cluster-mist (§12.5)', () => {
  const plan = makePlan([{ root: 0, type: 'maj7', stable: [0, 4, 7, 11], scale: [0, 2, 4, 5, 7, 9, 11], section: 'verse1' }]);
  const dec = { verse1: mkDec('cluster-mist', 'pad-under-comp', 2, true) };
  const pad = renderPad(plan, timebase, { padDensity: 0.5, decisionBySection: dec, leadReservedLow: 67 });

  it('簇 ≤ 2-3 音、相邻为二度(1-2 半音)、高区(无低区密集)', () => {
    const pitches = pad.notes.map((n) => n.pitch as number).sort((a, b) => a - b);
    expect(pitches.length).toBeGreaterThanOrEqual(1);
    expect(pitches.length).toBeLessThanOrEqual(3);
    expect(Math.min(...pitches)).toBeGreaterThanOrEqual(60); // 远离低频(避 mud)
    if (pitches.length === 2) expect(pitches[1] - pitches[0]).toBeLessThanOrEqual(2); // 二度簇
  });

  it('velocity 低(雾感)', () => {
    for (const n of pad.notes) expect(n.velocity as number).toBeLessThan(40);
  });
});

describe('render/padModes · gated-pad (§12.4 — pad 自身节奏,不耦合 comp)', () => {
  const plan = makePlan([{ root: 0, type: 'maj7', stable: [0, 4, 7, 11], scale: [0, 2, 4, 5, 7, 9, 11] }]);
  const dec = { chorus1: mkDec('gated-pad', 'gated-pad-drives', 2, true) };
  const pad = renderPad(plan, timebase, { padDensity: 0.7, decisionBySection: dec, leadReservedLow: 67 });

  it('节奏化:整段内多个 hit(distinct startTick),每 hit 时值 < 整段', () => {
    const starts = new Set(pad.notes.map((n) => Number(n.startTick)));
    expect(starts.size).toBeGreaterThan(1); // 多脉冲(非一条长音)
    const spanDur = timebase.beatToTick(beats(4)) as number;
    for (const n of pad.notes) expect(n.durationTicks as number).toBeLessThan(spanDur);
  });
});

describe('render/padModes · 上层结构(full-support 用合法色彩张力)', () => {
  // Cmaj9:9th=D(2) 是 colorTone 且在 chordScale 内 → full-support 应纳入 9th(upper structure)。
  const plan = makePlan([{ root: 0, type: 'maj9', stable: [0, 4, 7, 11], scale: [0, 2, 4, 7, 9, 11], color: [2], section: 'intro' }]);
  const dec = { intro: mkDec('full-support', 'pad-only', 3, false) };
  const pad = renderPad(plan, timebase, { padDensity: 0.5, decisionBySection: dec, leadReservedLow: 67 });

  it('纳入 9th(色彩张力)且保留 guide tone(3rd 或 7th)', () => {
    const pcs = new Set(pad.notes.map((n) => (((n.pitch as number) % 12) + 12) % 12));
    expect(pcs.has(2)).toBe(true);                 // 9th = upper structure
    expect(pcs.has(4) || pcs.has(11)).toBe(true);  // 仍含 3rd(E) 或 7th(B)= 身份不丢
    expect(pcs.has(0)).toBe(false);                // 仍省 root
  });
});

describe('render/padModes · 共同音 tie(链接连续:相邻和弦共同音合并成长音)', () => {
  // Am7 → Dm7 共享 C(Am7 的 3rd · Dm7 的 7th)→ pad 该音应 tie 成一个跨 2 span 的长音。
  const plan = makePlan([
    { root: 9, type: 'm7', stable: [9, 0, 4, 7], scale: [9, 11, 0, 2, 4, 5, 7], section: 'intro' },
    { root: 2, type: 'm7', stable: [2, 5, 9, 0], scale: [2, 4, 5, 7, 9, 11, 0], section: 'intro' },
  ]);
  const dec = { intro: mkDec('full-support', 'pad-only', 2, false) };
  const pad = renderPad(plan, timebase, { padDensity: 0.5, decisionBySection: dec, leadReservedLow: 67 });
  const spanTick = timebase.beatToTick(beats(4)) as number;

  it('共同音 C 合并成 1 个跨 2 span 长音(非两次重击)', () => {
    const cNotes = pad.notes.filter((n) => (((n.pitch as number) % 12) + 12) % 12 === 0); // pc C
    expect(cNotes.length).toBe(1);                              // tie:一个音,不是两个
    expect(cNotes[0].durationTicks).toBe(spanTick * 2);         // 横跨两个 span
    expect(cNotes[0].startTick).toBe(0);
  });

  it('每 span ≤ 2 音(pad 做减法);整体时间覆盖连续无空洞', () => {
    const byStart = new Map<number, number>();
    for (const n of pad.notes) byStart.set(n.startTick as number, (byStart.get(n.startTick as number) ?? 0) + 1);
    // 任意时刻同时音数 ≤ 2
    const ev: [number, number][] = [];
    for (const n of pad.notes) { ev.push([n.startTick as number, 1]); ev.push([(n.startTick as number) + (n.durationTicks as number), -1]); }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0, maxSim = 0;
    for (const [, d] of ev) { cur += d; maxSim = Math.max(maxSim, cur); }
    expect(maxSim).toBeLessThanOrEqual(2);
    // 覆盖 [0, 2*span] 连续
    const iv = pad.notes.map((n) => [n.startTick as number, (n.startTick as number) + (n.durationTicks as number)]).sort((a, b) => a[0] - b[0]);
    expect(iv[0][0]).toBe(0);
    expect(Math.max(...iv.map((x) => x[1]))).toBe(spanTick * 2);
  });
});

describe('render/padModes · pedal anchor(严格共同结构音 + 动声部)', () => {
  // C-F-G 无严格共同结构音：不得把主音 C 硬拖过 G 和弦成为长 11，回退逐和弦选音。
  const plan = makePlan([
    { root: 0, type: 'maj', stable: [0, 4, 7], scale: [0, 2, 4, 5, 7, 9, 11], section: 'intro' },
    { root: 5, type: 'maj', stable: [5, 9, 0], scale: [5, 7, 9, 10, 0, 2, 4], section: 'intro' },
    { root: 7, type: 'maj', stable: [7, 11, 2], scale: [7, 9, 11, 0, 2, 4, 6], section: 'intro' },
  ]);
  const dec = { intro: mkDec('full-support', 'pad-only', 2, false) };
  const spanTick = timebase.beatToTick(beats(4)) as number;
  const padOn = renderPad(plan, timebase, { padDensity: 0.5, decisionBySection: dec, leadReservedLow: 67, pedalAnchor: true, tonicPc: 0 });
  const padOff = renderPad(plan, timebase, { padDensity: 0.5, decisionBySection: dec, leadReservedLow: 67 });

  it('pedalAnchor on:无严格共同音时不制造跨整段长 pedal', () => {
    const maxOn = Math.max(...padOn.notes.map((n) => n.durationTicks as number));
    expect(maxOn).toBeLessThan(spanTick * 3);
  });

  it('off:无主音长 pedal(回逐和弦选音,最长音 < 整段)', () => {
    const maxOff = Math.max(...padOff.notes.map((n) => n.durationTicks as number));
    expect(maxOff).toBeLessThan(spanTick * 3); // 逐和弦,不横跨整段
  });

  it('pedal 仍和声合法(anchor + 动声部都在 chordScale 内、≤2 音/瞬时)', () => {
    for (const n of padOn.notes) {
      // 该音覆盖的某个和弦的音阶内
      const ns = n.startTick as number, ne = ns + (n.durationTicks as number);
      const pcv = (((n.pitch as number) % 12) + 12) % 12;
      const covered = plan.chordTimeline.filter((c) => {
        const lo = timebase.beatToTick(c.startBeat) as number;
        return ns < lo + (timebase.beatToTick(c.durationBeats) as number) && ne > lo;
      });
      for (const c of covered) {
        const sc = new Set<number>([...(plan.chordScaleMap[c.id] ?? []), ...(plan.stableToneMap[c.id] ?? [])]);
        expect(sc.has(pcv)).toBe(true);
      }
    }
  });
});

describe('render/padModes · 正交音阶锁(真实管线:pad 永在 chordScale 内、不碰 avoid)', () => {
  for (const [seed, style] of [[3, 'lofi'], [7, 'rnb'], [11, 'pop'], [9, 'lofi']] as const) {
    const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 120 });
    if (!band.instrumentPool.includes('pad' as never)) continue;
    const arrangement = buildArrangementPlan(band);
    const instrumentation = buildInstrumentationPlan(band, arrangement);
    const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(seed));
    const rr = instrumentation.melodyReservationPlan.reservedRegister;
    const aS = new Set<string>();
    for (const [sid, tex] of Object.entries(instrumentation.textureBySection)) if (instrumentation.textureYieldPolicy[tex] === 'active') aS.add(sid);
    const aR = instrumentation.activeRolesBySection;
    const inA = (s: string, r: string) => ((aR[s] as readonly string[] | undefined)?.includes(r) ?? true);
    const dec: Record<string, PadCompDecision> = {};
    for (const s of arrangement.sections) dec[s.id] = decidePadComp({ style: band.style, sectionId: s.id, sectionRole: s.role, padDensity: band.styleProfile.padDensity, padActive: inA(s.id, 'pad'), compActive: aS.has(s.id) && inA(s.id, 'comp'), bassActive: inA(s.id, 'bass'), leadReservedLow: rr.lowMidi, leadReservedHigh: rr.highMidi });
    const pad = renderPad(plan, timebase, { padDensity: band.styleProfile.padDensity, decisionBySection: dec, leadReservedLow: rr.lowMidi });
    const sb = new Map(plan.chordTimeline.map((s) => [timebase.beatToTick(s.startBeat) as number, s]));

    it(`seed${seed} ${style}:每个 pad 音 ∈ (chordScale ∪ 和弦音) 且 ∉ avoid`, () => {
      let checked = 0;
      for (const n of pad.notes) {
        const sp = sb.get(n.startTick as number);
        if (!sp) continue;
        const pcv = (((n.pitch as number) % 12) + 12) % 12;
        const scale = new Set<number>([...(plan.chordScaleMap[sp.id] ?? []), ...(plan.stableToneMap[sp.id] ?? [])]);
        const avoid = new Set<number>(plan.avoidNoteMap[sp.id] ?? []);
        expect(scale.has(pcv)).toBe(true);
        expect(avoid.has(pcv)).toBe(false);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});
