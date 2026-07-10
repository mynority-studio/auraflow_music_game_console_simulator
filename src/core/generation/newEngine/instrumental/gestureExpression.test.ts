import { describe, it, expect } from 'vitest';
import { createTimebase, midi, ticks } from '../foundation';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import { traceGeneration } from '../generation/trace';
import {
  applyGestureExpressionToTrack,
  buildGestureExpressionByRole,
  buildPipeWindBreathCcEvents,
  gestureExpressionForProgram,
  isPipeWindProgram,
} from './gestureExpression';
import { GESTURE_EVIDENCE_SOURCES } from './gestureEvidence';
import { SAX_CC } from './saxExpression';

const tb = createTimebase({ meter: { numerator: 4, denominator: 4 } });
const note = (start: number, dur: number, pitch = 60, velocity = 90): NoteIR => ({
  pitch: midi(pitch),
  startTick: ticks(start),
  durationTicks: ticks(dur),
  velocity,
});

describe('instrumental/gestureExpression', () => {
  it('器配层把 lead sax 映射到 sax-breath-legato 手势计划', () => {
    const plan = gestureExpressionForProgram('lead', 67);
    expect(plan.kind).toBe('sax-breath-legato');
    expect(plan.family).toBe('sax');
    expect(plan.continuity).toBe('legato-flow');
    expect(plan.articulationScope).toBe('direction');
    expect(plan.triggerPolicy).toBe('cc-lane');
    expect(plan.phrasePolicy).toBe('breath-group');
    expect(plan.breathModel).toBe('reed-continuous');
    expect(plan.noteShape).toBe('keyed-legato');
    expect(plan.ccControllers).toEqual([
      SAX_CC.expression,
      SAX_CC.breath,
    ]);
    expect(plan.tailPolicy).toBe('wind-breath');
    expect(plan.evidenceRefs).toEqual(expect.arrayContaining(['sax-jazz-legato-tonguing', 'sax-light-airflow-tonguing', 'midi-cc-table']));
  });

  it('pipe wind 只在 lead 上生成气口计划,非 lead 不做吹奏表情', () => {
    expect(isPipeWindProgram(75)).toBe(true);
    expect(gestureExpressionForProgram('lead', 75).kind).toBe('pipe-wind-breath');
    expect(gestureExpressionForProgram('comp', 75).kind).toBe('none');
  });

  it('buildGestureExpressionByRole 跟随器配最终 roleProgram', () => {
    const byRole = buildGestureExpressionByRole(['lead', 'comp', 'bass'], { lead: 67, comp: 4, bass: 32 }, 'jazz');
    expect(byRole.lead.kind).toBe('sax-breath-legato');
    expect(byRole.comp.kind).toBe('keyboard-touch');
    expect(byRole.comp.pedalPolicy).toBe('none');
    expect(byRole.bass.kind).toBe('bass-walk');
    expect(byRole.bass.bassTechniques).toContain('walking');
  });

  it('键盘/鼓/bass 按风格下发不同手势', () => {
    const pop = buildGestureExpressionByRole(['comp', 'drum', 'bass'], { comp: 5, drum: 0, bass: 33 }, 'pop');
    expect(pop.comp.kind).toBe('keyboard-touch');
    expect(pop.comp.pedalPolicy).toBe('none');
    expect(pop.comp.continuity).toBe('connected');
    expect(pop.comp.triggerPolicy).toBe('velocity-gate');
    expect(pop.drum.kind).toBe('drum-rudiment');
    expect(pop.drum.continuity).toBe('staccato');
    expect(pop.drum.rudimentPolicy).toBe('backbeat-ghost');
    expect(pop.drum.hiHatPolicy).toBe('closed-open-lift');
    expect(pop.bass.kind).toBe('bass-pluck-legato');

    const lofi = buildGestureExpressionByRole(['comp', 'drum', 'bass'], { comp: 7, drum: 25, bass: 39 }, 'lofi');
    expect(lofi.comp.pedalPolicy).toBe('light-syncopated');
    expect(lofi.comp.continuity).toBe('pedal-legato');
    expect(lofi.drum.rudimentPolicy).toBe('lofi-dusty');
    expect(lofi.bass.kind).toBe('bass-muted');
    expect(lofi.bass.continuity).toBe('staccato');
  });

  it('所有非 none 手势都必须带联网核验 source id', () => {
    const cases = [
      gestureExpressionForProgram('lead', 67, 'jazz'),
      gestureExpressionForProgram('lead', 5, 'pop'),
      gestureExpressionForProgram('lead', 11, 'pop'),
      gestureExpressionForProgram('comp', 5, 'pop'),
      gestureExpressionForProgram('comp', 25, 'rnb'),
      gestureExpressionForProgram('bass', 32, 'jazz'),
      gestureExpressionForProgram('bass', 38, 'lofi'),
      gestureExpressionForProgram('drum', 0, 'pop'),
      gestureExpressionForProgram('pad', 89, 'rnb'),
    ];
    for (const plan of cases) {
      expect(plan.kind).not.toBe('none');
      expect(plan.evidenceRefs.length, `${plan.kind} source refs`).toBeGreaterThan(0);
      for (const ref of plan.evidenceRefs) {
        expect(GESTURE_EVIDENCE_SOURCES[ref], `${plan.kind}:${ref}`).toBeDefined();
      }
    }
  });

  it('执行 sax 手势计划会改变连吹音符并生成连续气息,但不发 portamento/pitch-bend/CC1', () => {
    const track: TrackIR = { role: 'lead', notes: [note(0, 120, 60), note(240, 960, 62)], program: 67 };
    const out = applyGestureExpressionToTrack(track, gestureExpressionForProgram('lead', 67), tb);
    expect(out.notes[0].durationTicks as number).toBeGreaterThan(240);
    expect(out.notes[0].durationTicks as number).toBeLessThanOrEqual(250);
    expect(out.notes[1].velocity).toBeLessThan(track.notes[1].velocity);
    const controllers = new Set((out.ccEvents ?? []).map((e) => e.controller));
    expect(controllers.has(SAX_CC.expression)).toBe(true);
    expect(controllers.has(SAX_CC.breath)).toBe(true);
    expect(controllers.has(SAX_CC.portamentoOn)).toBe(false);
    expect(controllers.has(SAX_CC.portamentoTime)).toBe(false);
    expect(controllers.has(SAX_CC.portamentoControl)).toBe(false);
    expect(controllers.has(SAX_CC.modulation)).toBe(false);
    expect(out.pitchBendEvents).toBeUndefined();
  });

  it('sax-breath-legato 不会误作用到 comp/bass/drum 轨', () => {
    const plan = gestureExpressionForProgram('lead', 67, 'jazz');
    const tracks: TrackIR[] = [
      { role: 'comp', notes: [note(0, 480, 60, 80)], program: 0 },
      { role: 'bass', notes: [note(0, 480, 40, 88)], program: 32 },
      { role: 'drum', notes: [note(0, 120, 38, 96)], program: 0 },
    ];
    for (const track of tracks) {
      const out = applyGestureExpressionToTrack(track, plan, tb);
      expect(out.notes).toBe(track.notes);
      expect(out.ccEvents).toBeUndefined();
      expect(out.pitchBendEvents).toBeUndefined();
    }
  });

  it('keyboard-touch 消费 gate/velocity,但不改 grammar 音高与起点', () => {
    const track: TrackIR = { role: 'comp', notes: [note(0, 480, 60, 70), note(480, 480, 64, 62)], program: 5 };
    const out = applyGestureExpressionToTrack(track, gestureExpressionForProgram('comp', 5, 'pop'), tb);
    expect(out.notes.map((n) => [n.pitch, n.startTick])).toEqual(track.notes.map((n) => [n.pitch, n.startTick]));
    expect(out.notes.map((n) => n.durationTicks)).toEqual([ticks(432), ticks(432)]);
    expect(out.notes.some((n, i) => n.velocity !== track.notes[i].velocity)).toBe(true);
  });

  it('mallet-strike 只塑形 gate/velocity,不发任何会造成跑音的 MIDI 表情', () => {
    for (const program of [11, 12, 108]) {
      const plan = gestureExpressionForProgram('comp', program, 'pop');
      const track: TrackIR = { role: 'comp', notes: [note(0, 480, 60, 70), note(480, 480, 64, 62)], program };
      const out = applyGestureExpressionToTrack(track, plan, tb);
      expect(plan.kind).toBe('mallet-strike');
      expect(plan.ccControllers).toEqual([]);
      expect(out.notes.map((n) => [n.pitch, n.startTick])).toEqual(track.notes.map((n) => [n.pitch, n.startTick]));
      expect((out.ccEvents ?? []).some((cc) => cc.controller === SAX_CC.modulation)).toBe(false);
      expect(out.ccEvents).toBeUndefined();
      expect(out.pitchBendEvents).toBeUndefined();
    }
  });

  it('guitar-pick-voice 消费 gate/velocity,但不改 grammar 音高与起点', () => {
    const plan = gestureExpressionForProgram('comp', 25, 'rnb');
    expect(plan.kind).toBe('guitar-pick-voice');
    expect(plan.family).toBe('guitar');
    expect(plan.continuity).toBe('connected');
    expect(plan.phrasePolicy).toBe('pick-voice');
    expect(plan.tailPolicy).toBe('pluck-short');
    const track: TrackIR = { role: 'comp', notes: [note(0, 480, 52, 76), note(480, 480, 59, 70)], program: 25 };
    const out = applyGestureExpressionToTrack(track, plan, tb);
    expect(out.notes.map((n) => [n.pitch, n.startTick])).toEqual(track.notes.map((n) => [n.pitch, n.startTick]));
    expect(out.notes.map((n) => n.durationTicks)).toEqual([ticks(163), ticks(163)]);
    expect(out.notes.some((n, i) => n.velocity !== track.notes[i].velocity)).toBe(true);
  });

  it('guitar COMP 长和弦扫拨会短门限+限速,避免进混响后多重叠加', () => {
    const plan = gestureExpressionForProgram('comp', 24, 'lofi');
    const track: TrackIR = {
      role: 'comp',
      program: 24,
      notes: [
        note(0, 960, 52, 96),
        note(0, 960, 57, 94),
        note(0, 960, 64, 92),
        note(480, 960, 55, 90),
        note(480, 960, 60, 88),
      ],
    };
    const out = applyGestureExpressionToTrack(track, plan, tb);
    expect(out.notes.map((n) => [n.pitch, n.startTick])).toEqual(track.notes.map((n) => [n.pitch, n.startTick]));
    expect(Math.max(...out.notes.map((n) => n.durationTicks as number))).toBeLessThanOrEqual(135);
    expect(Math.max(...out.notes.map((n) => n.velocity))).toBeLessThanOrEqual(84);
  });

  it('lead guitar 手势只下发元数据,不改 MG lead 音符', () => {
    const track: TrackIR = { role: 'lead', notes: [note(0, 480, 64, 92), note(480, 240, 67, 88)], program: 25 };
    const out = applyGestureExpressionToTrack(track, gestureExpressionForProgram('lead', 25, 'pop'), tb);
    expect(out.notes).toBe(track.notes);
    expect(out.ccEvents).toBeUndefined();
  });

  it('bass 手势消费 muted/ghost/gate,保留原始 bass 结构音与数量', () => {
    const track: TrackIR = { role: 'bass', notes: [note(0, 480, 40, 90), note(960, 480, 43, 84)], program: 39 };
    const out = applyGestureExpressionToTrack(track, gestureExpressionForProgram('bass', 39, 'lofi'), tb);
    expect(out.notes.length).toBe(track.notes.length);
    const first = out.notes.find((n) => n.startTick === ticks(0) && n.pitch === midi(40));
    const second = out.notes.find((n) => n.startTick === ticks(960) && n.pitch === midi(43));
    expect(first?.durationTicks).toBe(ticks(346));
    expect(second).toBeDefined();
    expect(second!.velocity).toBeLessThan(track.notes[1].velocity);
  });

  it('drum rudiment/hat 手势塑形已有 ghost/offbeat,但不删除段落 fill 命中的原始鼓点', () => {
    const track: TrackIR = {
      role: 'drum',
      notes: [
        note(0, 120, 36, 108),
        note(360, 120, 38, 54), // 已有 ghost/snare pickup:手势只塑形,不新增
        note(480, 120, 38, 96),
        note(1440, 120, 38, 100),
        note(1680, 120, 47, 110), // 模拟 fill tom:必须保留
        note(240, 120, 42, 58),
        note(720, 120, 46, 52),
      ],
      program: 0,
    };
    const out = applyGestureExpressionToTrack(track, gestureExpressionForProgram('drum', 0, 'pop'), tb);
    expect(out.notes.length).toBe(track.notes.length);
    expect(out.notes.some((n) => n.pitch === midi(47) && n.startTick === ticks(1680))).toBe(true);
    expect(out.notes.some((n) => n.pitch === midi(38) && n.startTick === ticks(360) && n.velocity < 40)).toBe(true);
    const openHat = out.notes.find((n) => n.pitch === midi(46));
    expect(openHat?.velocity).toBeGreaterThan(52);
  });

  it('pipe wind 复用表情层生成 CC11 气口渐弱', () => {
    const cc = buildPipeWindBreathCcEvents([note(0, 1920, 72)], tb);
    expect(cc[0]).toEqual({ atTick: ticks(0), controller: 11, value: 112 });
    expect(cc.length).toBeGreaterThan(1);
    expect(cc[cc.length - 1].value).toBeLessThan(112);
  });

  it('端到端:render 消费器配下发的 sax 手势计划,生成 CC 和连吹 overlap', () => {
    const trace = traceGeneration({ seed: 4, styleHint: 'jazz', mood: 'build', targetDuration: 90 });
    expect(trace.lines.some((line) => line.includes('lead:sax GM67:sax-breath-legato'))).toBe(true);
    const lead = trace.ir.tracks.find((track) => track.role === 'lead')!;
    expect(lead.program).toBe(67);
    expect((lead.ccEvents?.length ?? 0)).toBeGreaterThan(0);
    expect(lead.pitchBendEvents).toBeUndefined();
    const ordered = [...lead.notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
    const legatoPair = ordered.find((n, i) => {
      const next = ordered[i + 1];
      return !!next && n.pitch !== next.pitch && (n.startTick as number) + (n.durationTicks as number) > (next.startTick as number);
    });
    expect(legatoPair).toBeDefined();
  });
});
