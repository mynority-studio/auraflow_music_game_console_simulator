import { describe, it, expect } from 'vitest';
import { auditHarmony } from './readOnlyHarmonyAuditor';
import { buildHarmonicPlan } from '../harmony/harmonyEngine';
import { freezeMusicalIR, type TrackIR } from '../ir/MusicalIR';
import { createTimebase, midi, ticks, pc, beats } from '../foundation';

// C 大调 I-IV-V-I,每和弦 1 小节(4 拍),ppq 480
const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
const plan = buildHarmonicPlan({
  key: pc(0), beatsPerBar: 4,
  progression: [
    { degree: 1, quality: 'maj7', bars: 1 },
    { degree: 4, quality: 'maj7', bars: 1 },
    { degree: 5, quality: '7', bars: 1 },
    { degree: 1, quality: 'maj7', bars: 1 },
  ],
});
const mkIR = (tracks: TrackIR[]) => freezeMusicalIR({ tracks, timebase, durationTicks: ticks(timebase.beatToTick(beats(16)) as number) });
const ids = (r: ReturnType<typeof auditHarmony>) => r.findings.map((f) => f.ruleId);

describe('render · Auditor 扩规则 (P1-2)', () => {
  it('干净:lead 全落和弦音 → 无 finding', () => {
    // Cmaj7 上长音 C / Fmaj7 上 F …(都在 chord-scale 内、非 avoid)
    const lead: TrackIR = { role: 'lead', notes: [
      { pitch: midi(72), startTick: ticks(0), durationTicks: ticks(1920), velocity: 90 },    // C over Cmaj7
      { pitch: midi(77), startTick: ticks(1920), durationTicks: ticks(1920), velocity: 90 }, // F over Fmaj7
    ] };
    expect(auditHarmony(mkIR([lead]), plan, timebase).findings).toEqual([]);
  });

  it('★ 持续离调音(≥2 拍)→ chromatic-exposure(warning)', () => {
    // C#(61→73)在 Cmaj7 的 chord-scale 外,持续 2 拍
    const lead: TrackIR = { role: 'comp', notes: [
      { pitch: midi(73), startTick: ticks(0), durationTicks: ticks(960), velocity: 90 }, // C# 2拍
    ] };
    const r = auditHarmony(mkIR([lead]), plan, timebase);
    expect(ids(r)).toContain('chromatic-exposure');
    expect(r.findings.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('1 拍走音不报(经过/walking 豁免门槛)', () => {
    const lead: TrackIR = { role: 'comp', notes: [
      { pitch: midi(73), startTick: ticks(0), durationTicks: ticks(480), velocity: 90 }, // C# 仅 1 拍
    ] };
    expect(ids(auditHarmony(mkIR([lead]), plan, timebase))).not.toContain('chromatic-exposure');
  });

  it('短强拍非合约音报结构交集错误，短弱拍经过音保留', () => {
    const strong: TrackIR = { role: 'lead', notes: [
      { pitch: midi(65), startTick: ticks(0), durationTicks: ticks(120), velocity: 90 }, // F:Cmaj7 avoid
    ] };
    const weak: TrackIR = { role: 'lead', notes: [
      { pitch: midi(65), startTick: ticks(240), durationTicks: ticks(120), velocity: 82 },
    ] };
    expect(ids(auditHarmony(mkIR([strong]), plan, timebase))).toContain('structural-tone-outside-intersection');
    expect(ids(auditHarmony(mkIR([weak]), plan, timebase))).not.toContain('structural-tone-outside-intersection');
  });

  it('★ lead 与 comp 实际小二度同响 → dissonant-vertical-clash(warning)', () => {
    const lead: TrackIR = { role: 'lead', notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(480), velocity: 90 }] };
    const comp: TrackIR = { role: 'comp', notes: [{ pitch: midi(71), startTick: ticks(0), durationTicks: ticks(480), velocity: 70 }] }; // 与 lead 差 1 半音
    expect(ids(auditHarmony(mkIR([lead, comp]), plan, timebase))).toContain('dissonant-vertical-clash');
  });

  it('lead 与 comp 隔八度以上不算撞音(实际音程,非 pc 类)', () => {
    const lead: TrackIR = { role: 'lead', notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(480), velocity: 90 }] };
    const comp: TrackIR = { role: 'comp', notes: [{ pitch: midi(59), startTick: ticks(0), durationTicks: ticks(480), velocity: 70 }] }; // pc 差 1 但隔 13 半音=小九度? 59 vs 72 = 13 → m9 算撞
    const comp2: TrackIR = { role: 'comp', notes: [{ pitch: midi(47), startTick: ticks(0), durationTicks: ticks(480), velocity: 70 }] }; // 72-47=25,非 1/13 → 不算
    expect(ids(auditHarmony(mkIR([lead, comp2]), plan, timebase))).not.toContain('dissonant-vertical-clash');
    expect(ids(auditHarmony(mkIR([lead, comp]), plan, timebase))).toContain('dissonant-vertical-clash'); // m9 仍算
  });

  it('R1 avoid 长暴露仍是 error(触发纠错环);warning 不阻断', () => {
    // F(65) over Cmaj7 = 4 度 avoid,持续 1 拍 → error
    const lead: TrackIR = { role: 'lead', notes: [{ pitch: midi(65), startTick: ticks(0), durationTicks: ticks(480), velocity: 90 }] };
    const r = auditHarmony(mkIR([lead]), plan, timebase);
    expect(r.findings.some((f) => f.ruleId === 'avoid-long-exposure' && f.severity === 'error')).toBe(true);
  });
});
