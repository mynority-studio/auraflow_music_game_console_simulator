import { describe, it, expect } from 'vitest';
import { ticks, midi } from '../foundation';
import type { TrackIR } from '../ir/MusicalIR';
import { generateSong } from '../generation/GenerationController';
import { applyRenderMixBalance, leadCompWetEnergyRatio } from './renderMixBalance';
import { auditRenderedMix } from './renderMixAudit';
import { DREAM5504_LOFI_CHANNEL_MIX } from '../knowledge/gmMixProfile';

const ctx = (style: string, durationTicks: number, sectionTicks: number[] = [0]) => ({
  style,
  ppq: 480,
  durationTicks,
  sectionTicks,
});

const isGuitarProgram = (program: number | undefined): boolean =>
  program !== undefined && program >= 24 && program <= 31;

describe('render/renderMixBalance — render 后处理混音', () => {
  it('不改音符/program/声像，并在 Dream 四风格出口恢复默认 CC7、清零空间', () => {
    const durationTicks = 1920;
    const tracks: TrackIR[] = [
      {
        role: 'lead',
        program: 4,
        mix: { volume: 95, pan: 64, reverb: 45, chorus: 48 },
        notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(240), velocity: 90 }],
      },
      {
        role: 'comp',
        program: 4,
        mix: { volume: 89, pan: 52, reverb: 43, chorus: 58 },
        notes: [
          { pitch: midi(60), startTick: ticks(0), durationTicks: ticks(960), velocity: 100 },
          { pitch: midi(64), startTick: ticks(0), durationTicks: ticks(960), velocity: 100 },
          { pitch: midi(67), startTick: ticks(960), durationTicks: ticks(960), velocity: 100 },
          { pitch: midi(71), startTick: ticks(960), durationTicks: ticks(960), velocity: 100 },
        ],
      },
    ];
    const beforeNotes = tracks.map((t) => t.notes);
    const beforePrograms = tracks.map((t) => t.program);
    const beforeRatio = leadCompWetEnergyRatio(tracks, ctx('rnb', durationTicks));
    const out = applyRenderMixBalance(tracks, ctx('rnb', durationTicks));
    const afterRatio = leadCompWetEnergyRatio(out, ctx('rnb', durationTicks));

    expect(out.map((t) => t.notes)).toEqual(beforeNotes);
    expect(out.map((t) => t.program)).toEqual(beforePrograms);
    expect(out.find((t) => t.role === 'lead')!.mix!.pan).toBe(64);
    expect(out.find((t) => t.role === 'comp')!.mix).toMatchObject({ reverb: 0, chorus: 0 });
    expect(afterRatio).not.toBe(beforeRatio);
    expect(out.find((t) => t.role === 'lead')!.mix!.volume).toBe(100);
    expect(out.find((t) => t.role === 'comp')!.mix!.volume).toBe(100);
  });

  it('代表 macro seed 的 lead/comp 有效响度落在可预览+可移植区间', () => {
    const cases = [
      { style: 'pop', seed: 7, lo: 0.70, hi: 1.85 },
      { style: 'jazz', seed: 8, lo: 0.85, hi: 2.30 },
      { style: 'lofi', seed: 7, lo: 0.70, hi: 1.80 },
      { style: 'rnb', seed: 7, lo: 0.70, hi: 1.65 },
      { style: 'acg', seed: 7, lo: 1.05, hi: 6.50 }, // ★ P2:ACG = melody-first;SF2-aware 后低频压住,lead/comp 留足预览响度。
    ];

    for (const c of cases) {
      const r = generateSong({ seed: c.seed, styleHint: c.style, mood: 'build', targetDuration: 90 });
      expect(r.ir, `${c.style}/${c.seed} no IR`).toBeTruthy();
      const ratio = leadCompWetEnergyRatio(r.ir!.tracks as TrackIR[], ctx(c.style, r.ir!.durationTicks as number));
      const comp = r.ir!.tracks.find((t) => t.role === 'comp') as TrackIR | undefined;
      if (isGuitarProgram(comp?.program)) {
        expect(comp!.mix!.volume, `${c.style}/${c.seed} guitar comp volume`).toBeLessThanOrEqual(58);
        expect(comp!.mix!.reverb, `${c.style}/${c.seed} guitar comp reverb`).toBeLessThanOrEqual(20);
        expect(comp!.mix!.delay, `${c.style}/${c.seed} guitar comp delay`).toBeUndefined();
        expect(Math.max(...comp!.notes.map((n) => n.durationTicks as number)), `${c.style}/${c.seed} guitar comp gate`).toBeLessThanOrEqual(163);
        continue;
      }
      if (c.style !== 'acg') {
        const lead = r.ir!.tracks.find((t) => t.role === 'lead')!;
        const compTrack = r.ir!.tracks.find((t) => t.role === 'comp')!;
        const expectedLead = c.style === 'lofi' ? DREAM5504_LOFI_CHANNEL_MIX.lead : { volume: 100, reverb: 0, chorus: 0 };
        const expectedComp = c.style === 'lofi' ? DREAM5504_LOFI_CHANNEL_MIX.comp : { volume: 100, reverb: 0, chorus: 0 };
        expect(lead.mix, `${c.style}/${c.seed}/lead`).toMatchObject(expectedLead);
        expect(compTrack.mix, `${c.style}/${c.seed}/comp`).toMatchObject(expectedComp);
        for (const track of r.ir!.tracks) {
          const expected = c.style === 'lofi'
            ? DREAM5504_LOFI_CHANNEL_MIX[track.role]
            : { volume: 100, reverb: 0, chorus: 0 };
          expect(track.mix, `${c.style}/${c.seed}/${track.role}`).toMatchObject(expected);
        }
        continue;
      }
      expect(ratio, `${c.style}/${c.seed} ratio`).toBeGreaterThanOrEqual(c.lo);
      expect(ratio, `${c.style}/${c.seed} ratio`).toBeLessThanOrEqual(c.hi);
    }
  });

  it('RNB seed=7 不再用 CC7 修正 comp/lead 的乐谱能量比', () => {
    const r = generateSong({ seed: 7, styleHint: 'rnb', mood: 'build', targetDuration: 90 });
    const ratio = leadCompWetEnergyRatio(r.ir!.tracks as TrackIR[], ctx('rnb', r.ir!.durationTicks as number));
    const lead = r.ir!.tracks.find((t) => t.role === 'lead')!;
    const comp = r.ir!.tracks.find((t) => t.role === 'comp')!;

    expect(ratio).toBeGreaterThan(0);
    if (isGuitarProgram(comp.program)) {
      expect(comp.mix!.volume).toBe(100);
      expect(comp.mix!.reverb).toBeLessThanOrEqual(20);
      expect(comp.mix!.delay).toBeUndefined();
      expect(Math.max(...comp.notes.map((n) => n.durationTicks as number))).toBeLessThanOrEqual(163);
    } else {
      expect(ratio).toBeLessThanOrEqual(1.35);
    }
    expect(lead.mix!.volume).toBe(100);
    expect(comp.mix!.volume).toBe(100);
  });

  it('JAZZ sax 保留 CC11 表情，但通道电平使用 Dream 默认值', () => {
    const r = generateSong({ seed: 7, styleHint: 'jazz', mood: 'build', targetDuration: 90 });
    const ratio = leadCompWetEnergyRatio(r.ir!.tracks as TrackIR[], ctx('jazz', r.ir!.durationTicks as number));
    const lead = r.ir!.tracks.find((t) => t.role === 'lead')!;
    const comp = r.ir!.tracks.find((t) => t.role === 'comp')!;
    const leadVolumes = [lead.mix!.volume, ...(lead.mixChanges ?? []).map((change) => change.mix.volume)];
    const expressionValues = (lead.ccEvents ?? []).filter((e) => e.controller === 11).map((e) => e.value);
    const avgExpression = expressionValues.reduce((sum, value) => sum + value, 0) / Math.max(1, expressionValues.length);

    expect(lead.program).toBe(66);
    expect(lead.mix!.volume).toBe(100);
    expect(new Set(leadVolumes)).toEqual(new Set([100]));
    expect(comp.mix!.volume).toBe(100);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThanOrEqual(3.80);
    expect(avgExpression).toBeGreaterThanOrEqual(70); // 管乐音符级包络(软起音)后均值合理下移;表情存在性由 ratio>0 保证
  });

  it('melodic roles 不把 CC7 推到 ESP32/浏览器容易炸的高位', () => {
    for (const style of ['pop', 'jazz', 'lofi', 'rnb', 'acg']) {
      for (const seed of [0, 1, 7, 11, 42]) {
        const r = generateSong({ seed, styleHint: style, mood: 'build', targetDuration: 90 });
        expect(r.ir, `${style}/${seed} no IR`).toBeTruthy();
        for (const t of r.ir!.tracks) {
          if (t.role === 'drum' || t.role === 'bass' || t.role === 'pad') continue;
          const vols = [t.mix?.volume, ...(t.mixChanges ?? []).map((m) => m.mix.volume)].filter((v): v is number => typeof v === 'number');
          for (const v of vols) expect(v, `${style}/${seed}/${t.role}`).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('ACG 三手钢琴为真实柱式抵达保留 top/middle 分层 CC7 余量，不改 PianoScore 的 NoteIR', () => {
    const durationTicks = 960;
    const tracks: TrackIR[] = [
      {
        role: 'lead',
        program: 0,
        mix: { volume: 100, pan: 64, reverb: 44, chorus: 8 },
        notes: [{ pitch: midi(76), startTick: ticks(0), durationTicks: ticks(480), velocity: 90 }],
      },
      {
        role: 'comp',
        program: 0,
        mix: { volume: 100, pan: 64, reverb: 44, chorus: 8 },
        notes: [{ pitch: midi(60), startTick: ticks(480), durationTicks: ticks(480), velocity: 56 }],
      },
      {
        role: 'bass',
        program: 0,
        mix: { volume: 74, pan: 64, reverb: 10, chorus: 2 },
        notes: [{ pitch: midi(40), startTick: ticks(0), durationTicks: ticks(960), velocity: 48 }],
      },
    ];
    const beforeNotes = tracks.map((track) => track.notes);
    const out = applyRenderMixBalance(tracks, ctx('acg', durationTicks, [0, 480]));

    expect(out.map((track) => track.notes)).toEqual(beforeNotes);
    expect(out.find((track) => track.role === 'lead')!.mix).toMatchObject({ volume: 92, pan: 64, reverb: 44, chorus: 8 });
    expect(out.find((track) => track.role === 'comp')!.mix).toMatchObject({ volume: 85, pan: 64, reverb: 44, chorus: 8 });
    // The left hand is the score's root/support carrier, so the upper-hand
    // headroom contract must not quietly pull it back.
    expect(out.find((track) => track.role === 'bass')!.mix!.volume).toBe(74);
  });

  it('ACG 活动中的四音中声部仍让 cantabile top line 保持有效响度优势', () => {
    const durationTicks = 960;
    const tracks: TrackIR[] = [
      {
        role: 'lead',
        program: 0,
        mix: { volume: 100, pan: 64, reverb: 44, chorus: 5 },
        notes: [{ pitch: midi(76), startTick: ticks(0), durationTicks: ticks(durationTicks), velocity: 90 }],
      },
      {
        role: 'comp',
        program: 0,
        // A real piano-score block: four inner voices sustain under the top
        // line. The policy floor, not a post-note carve, must preserve the
        // score's top/middle hierarchy here.
        mix: { volume: 80, pan: 64, reverb: 44, chorus: 8 },
        notes: [55, 55, 54, 54].map((velocity, index) => ({
          pitch: midi(55 + index * 4),
          startTick: ticks(0),
          durationTicks: ticks(durationTicks),
          velocity,
        })),
      },
    ];

    const out = applyRenderMixBalance(tracks, ctx('acg', durationTicks));
    const lead = out.find((track) => track.role === 'lead')!;
    const comp = out.find((track) => track.role === 'comp')!;

    expect(lead.mix!.volume).toBe(92);
    expect(comp.mix!.volume).toBe(74);
    expect(lead.mix!.volume).toBeGreaterThan(comp.mix!.volume);
    expect(leadCompWetEnergyRatio(out, ctx('acg', durationTicks))).toBeGreaterThanOrEqual(1.05);
  });

  it('ACG grammar dyads and overlapping cantabile notes stay below the hardware error ceiling', () => {
    // 3 is the reported dyad arrival; this compact deterministic sweep also
    // covers the later overlapping-melody and mixed-arrangement peaks.
    for (const seed of Array.from({ length: 64 }, (_, index) => index)) {
      const result = generateSong({ seed, styleHint: 'acg', mood: 'build', targetDuration: 90 });
      expect(result.ir, `acg/${seed} no IR`).toBeTruthy();
      const report = auditRenderedMix(result.ir!.tracks as TrackIR[], ctx('acg', result.ir!.durationTicks as number));
      expect(report.findings.filter((finding) => finding.code === 'master.outputClipRisk'), `acg/${seed}`).toEqual([]);
      for (const role of ['lead', 'comp'] as const) {
        const track = result.ir!.tracks.find((candidate) => candidate.role === role)!;
        const volumes = [track.mix?.volume, ...(track.mixChanges ?? []).map((change) => change.mix.volume)]
          .filter((volume): volume is number => typeof volume === 'number');
        expect(Math.max(...volumes), `acg/${seed}/${role} upper-hand CC7`).toBeLessThanOrEqual(94);
      }
    }
  });

  it('LOFI 保留 IR 中已经确定的吉他 COMP 混音，不做能量校平', () => {
    const durationTicks = 1920;
    const tracks: TrackIR[] = [
      {
        role: 'lead',
        program: 67,
        mix: { volume: 88, pan: 64, reverb: 58, chorus: 0 },
        notes: [{ pitch: midi(55), startTick: ticks(0), durationTicks: ticks(240), velocity: 80 }],
      },
      {
        role: 'comp',
        program: 25,
        mix: { volume: 94, pan: 52, reverb: 20, chorus: 2 },
        notes: [
          { pitch: midi(52), startTick: ticks(0), durationTicks: ticks(960), velocity: 100 },
          { pitch: midi(57), startTick: ticks(0), durationTicks: ticks(960), velocity: 100 },
          { pitch: midi(64), startTick: ticks(0), durationTicks: ticks(960), velocity: 100 },
        ],
      },
    ];
    const out = applyRenderMixBalance(tracks, ctx('lofi', durationTicks));
    const comp = out.find((t) => t.role === 'comp')!;
    expect(comp.mix).toMatchObject({ volume: 94, reverb: 20, chorus: 2 });
  });

  it('Dream 四风格不再为吉他 LEAD 做 CC7 校平', () => {
    const durationTicks = 1920;
    const tracks: TrackIR[] = [
      {
        role: 'lead',
        program: 25,
        mix: { volume: 98, pan: 64, reverb: 30, chorus: 0 },
        notes: [{ pitch: midi(64), startTick: ticks(0), durationTicks: ticks(240), velocity: 80 }],
      },
      {
        role: 'comp',
        program: 0,
        mix: { volume: 84, pan: 52, reverb: 44, chorus: 8 },
        notes: [
          { pitch: midi(52), startTick: ticks(0), durationTicks: ticks(960), velocity: 72 },
          { pitch: midi(57), startTick: ticks(0), durationTicks: ticks(960), velocity: 72 },
        ],
      },
    ];
    const out = applyRenderMixBalance(tracks, ctx('pop', durationTicks));
    const lead = out.find((t) => t.role === 'lead')!;
    expect(lead.mix!.volume).toBe(100);
    expect(lead.mix!.reverb).toBe(0);
    expect(lead.mix!.chorus).toBe(0);
  });

  it('Dream 四风格不再为卡林巴 LEAD 做 CC7 校平', () => {
    const durationTicks = 1920;
    const tracks: TrackIR[] = [
      {
        role: 'lead',
        program: 108,
        mix: { volume: 96, pan: 64, reverb: 18, chorus: 0 },
        notes: [{ pitch: midi(79), startTick: ticks(0), durationTicks: ticks(240), velocity: 100 }],
      },
      {
        role: 'comp',
        program: 0,
        mix: { volume: 84, pan: 52, reverb: 44, chorus: 8 },
        notes: [
          { pitch: midi(52), startTick: ticks(0), durationTicks: ticks(960), velocity: 72 },
          { pitch: midi(57), startTick: ticks(0), durationTicks: ticks(960), velocity: 72 },
        ],
      },
    ];
    const out = applyRenderMixBalance(tracks, ctx('pop', durationTicks));
    const lead = out.find((t) => t.role === 'lead')!;
    expect(lead.mix!.volume).toBe(100);
    expect(lead.mix!.reverb).toBe(0);
    expect(lead.mix!.chorus).toBe(0);
  });

  it('LOFI 保留 IR 中已经确定的 Electric Grand COMP 混音', () => {
    const durationTicks = 1920;
    const tracks: TrackIR[] = [
      {
        role: 'lead',
        program: 0,
        mix: { volume: 82, pan: 64, reverb: 44, chorus: 4 },
        notes: [{ pitch: midi(72), startTick: ticks(0), durationTicks: ticks(240), velocity: 78 }],
      },
      {
        role: 'comp',
        program: 5,
        mix: { volume: 94, pan: 52, reverb: 24, chorus: 18 },
        notes: [
          { pitch: midi(52), startTick: ticks(0), durationTicks: ticks(960), velocity: 100 },
          { pitch: midi(56), startTick: ticks(0), durationTicks: ticks(960), velocity: 100 },
          { pitch: midi(59), startTick: ticks(0), durationTicks: ticks(960), velocity: 100 },
          { pitch: midi(64), startTick: ticks(0), durationTicks: ticks(960), velocity: 100 },
        ],
      },
    ];
    const out = applyRenderMixBalance(tracks, ctx('lofi', durationTicks));
    const comp = out.find((t) => t.role === 'comp')!;
    expect(comp.mix).toMatchObject({ volume: 94, reverb: 24, chorus: 18 });
  });
});
