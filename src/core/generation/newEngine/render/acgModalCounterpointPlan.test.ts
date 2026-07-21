import { describe, expect, it } from 'vitest';
import { beats, midi, pc, ticks } from '../foundation';
import type { ChordSpan } from '../harmony/HarmonicPlan';
import type { ChordQuality } from '../knowledge/chords';
import type { TrackIR } from '../ir/MusicalIR';
import {
  applyAcgModalCounterpointPlan,
  overlapsAcgProtectedRest,
  planAcgModalCounterpoint,
  planAndApplyAcgModalCounterpoint,
} from './acgModalCounterpointPlan';

const PPQ = 480;
const BAR = PPQ * 4;

function span(
  id: string,
  startBeat: number,
  rootPc: number,
  quality: ChordQuality,
  chordType = quality,
  effectiveFunc?: 'T' | 'S' | 'D',
): ChordSpan {
  return {
    id,
    roman: { degree: 1, accidental: 'natural', quality },
    rootPc: pc(rootPc),
    quality,
    chordType,
    startBeat: beats(startBeat),
    durationBeats: beats(4),
    sectionId: 'test',
    effectiveFunc,
  };
}

function lead(notes: Array<[pitch: number, startTick: number, durationTicks?: number]>): TrackIR {
  return {
    role: 'lead',
    notes: notes.map(([pitch, startTick, durationTicks = 240]) => ({
      pitch: midi(pitch),
      startTick: ticks(startTick),
      durationTicks: ticks(durationTicks),
      velocity: 82,
    })),
  };
}

function planInput(track: TrackIR, timeline: readonly ChordSpan[], seed: number | string = 17) {
  return { seed, lead: track, timeline, ppq: PPQ, barTicks: BAR, keyRootPc: 0 };
}

describe('render/acgModalCounterpointPlan', () => {
  it('只在 IV 支撑的 Dorian-6 与 V→i 支撑的 harmonic-7 上改写，并保留级进解决', () => {
    // C minor: F major 的 A 是 Dorian ♮6；G major 的 B 是 harmonic-minor ♮7 → C。
    const timeline = [
      span('iv-dorian', 0, 5, 'maj'),
      span('i', 4, 0, 'min'),
      span('V', 8, 7, 'maj', 'maj', 'D'),
      span('return-i', 12, 0, 'min'),
    ];
    const track = lead([
      [67, 1440], // G → 改为 A，随后回 G（Dorian 6→5）
      [67, 1920],
      [70, 5520], // A# → 改为 B，随后 C（leading tone→tonic）
      [72, 5760],
    ]);

    const plan = planAcgModalCounterpoint(planInput(track, timeline));
    expect(plan.events.map((event) => event.kind)).toEqual(['Dorian-6', 'harmonic-7']);
    expect(plan.events.map((event) => event.targetPitch)).toEqual([69, 71]);
    for (const event of plan.events) {
      expect(event.resolution.semitones).toBeLessThanOrEqual(2);
      expect(event.resolution.semitones).toBeGreaterThanOrEqual(1);
      expect(event.range.startTick).toBeLessThanOrEqual(event.sourceStartTick);
      expect(event.range.endTick).toBeGreaterThan(event.sourceStartTick);
    }

    const applied = applyAcgModalCounterpointPlan(track, plan);
    expect(applied.notes.map((note) => note.pitch as number)).toEqual([69, 67, 71, 72]);
    // 输入不可变，方便 coordinator 在不同晚期 pass 中复用。
    expect(track.notes.map((note) => note.pitch as number)).toEqual([67, 67, 70, 72]);
  });

  it('Phrygian-b2 只可作为句尾 ♭II→i 的下行解决，且不会与同句的其他 modal 色彩叠加', () => {
    const timeline = [
      span('iv-dorian-candidate', 0, 5, 'maj'),
      span('i-a', 4, 0, 'min'),
      span('bII', 8, 1, 'maj'),
      span('i-end', 12, 0, 'min'),
    ];
    const track = lead([
      [67, 1440], // 合法 Dorian 候选；应让位给本句的 ♭II 阴影
      [67, 1920],
      [72, 5520], // C → Db → C
      [72, 5760],
    ]);

    const plan = planAcgModalCounterpoint(planInput(track, timeline));
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]).toMatchObject({
      kind: 'Phrygian-b2',
      harmonicSupport: 'phrygian-flat-ii',
      colorPc: 1,
      targetPitch: 73,
      resolution: { direction: 'down', pitch: 72, semitones: 1 },
    });
    expect(plan.events[0].range.barIndex).toBeGreaterThanOrEqual(2);
  });

  it('没有和声支撑或不能级进解决时，不会硬塞 Dorian / harmonic / Phrygian 色彩', () => {
    const timeline = [
      span('iv-minor-not-dorian', 0, 5, 'min'), // 没有 A natural
      span('i', 4, 0, 'min'),
      span('V', 8, 7, 'maj', 'maj', 'D'),
      span('not-tonic-resolution', 12, 2, 'min'),
    ];
    const track = lead([
      [67, 1440],
      [67, 1920],
      [70, 5520],
      [74, 5760], // B 不会级进解到主音 C；且下一和弦不是 i
    ]);

    const plan = planAcgModalCounterpoint(planInput(track, timeline));
    expect(plan.events.find((event) => event.kind === 'Dorian-6')).toBeUndefined();
    expect(plan.events.find((event) => event.kind === 'harmonic-7')).toBeUndefined();
    expect(plan.events.find((event) => event.kind === 'Phrygian-b2')).toBeUndefined();
  });

  it('在没有借用色彩的短语中，pentatonic-filter 只把既有过渡音收向和弦支持的五声性音', () => {
    const timeline = [
      span('i', 0, 0, 'min'),
      span('iv', 4, 5, 'min'),
      span('i-return', 8, 0, 'min'),
      span('i-coda', 12, 0, 'min'),
    ];
    const track = lead([
      [62, 1680], // D → Eb；Eb 是 C minor 的五声性／和弦音，随后级进到 F
      [65, 1920],
    ]);

    const plan = planAcgModalCounterpoint(planInput(track, timeline));
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0]).toMatchObject({
      kind: 'pentatonic-filter',
      harmonicSupport: 'pentatonic-chord-tone',
      colorPc: 3,
      targetPitch: 63,
      resolution: { pitch: 65, semitones: 2 },
    });
    expect(applyAcgModalCounterpointPlan(track, plan).notes[0].pitch as number).toBe(63);
  });

  it('从现有静默导出可供 gap repair 查询的 protected rest window，且 apply 从不在留白中插音', () => {
    const timeline = [
      span('i-a', 0, 0, 'min'),
      span('i-b', 4, 0, 'min'),
      span('i-c', 8, 0, 'min'),
      span('i-d', 12, 0, 'min'),
    ];
    const track = lead([
      [72, 0, 240],
      [75, 3840, 240], // bar 1 是完整、内部自然留白
    ]);
    const result = planAndApplyAcgModalCounterpoint(planInput(track, timeline));
    expect(result.plan.plannedRestBars).toContain(1);
    expect(overlapsAcgProtectedRest(BAR, BAR * 2, result.plan.protectedRestWindows)).toBe(true);
    expect(result.lead.notes).toHaveLength(track.notes.length);
    expect(result.lead.notes.some((note) => (note.startTick as number) >= BAR && (note.startTick as number) < BAR * 2)).toBe(false);
  });

  it('自动留白最多保留句尾一个 bar；更长的空档不会被误当成整段空床保护', () => {
    const timeline = [
      span('i-a', 0, 0, 'min'),
      span('i-b', 4, 0, 'min'),
      span('i-c', 8, 0, 'min'),
      span('i-d', 12, 0, 'min'),
    ];
    const track = lead([
      [72, 0, 240],
      [75, BAR * 4 - 240, 240], // 内部 15 拍 gap，只保留最后一小节作为 release。
    ]);
    const plan = planAcgModalCounterpoint(planInput(track, timeline));
    const natural = plan.protectedRestWindows.find((window) => window.source === 'natural-silence')!;
    expect(natural.endTick - natural.startTick).toBeLessThanOrEqual(BAR);
    expect(natural.endTick).toBe(BAR * 4 - 240);
  });

  it('同一 seed/输入计划完全确定；seed 仅在合法候选中选位，不改变约束', () => {
    const timeline = [
      span('iv-a', 0, 5, 'maj'),
      span('i-a', 4, 0, 'min'),
      span('iv-b', 8, 5, 'maj'),
      span('i-b', 12, 0, 'min'),
    ];
    const track = lead([
      [67, 1440], [67, 1920],
      [67, 5280], [67, 5760],
    ]);
    const first = planAcgModalCounterpoint(planInput(track, timeline, 91));
    const second = planAcgModalCounterpoint(planInput(track, timeline, 91));
    expect(second).toEqual(first);
    // 两个 IV 在同一短语也只会安排一次 Dorian-6。
    expect(first.events.filter((event) => event.kind === 'Dorian-6')).toHaveLength(1);
  });
});
