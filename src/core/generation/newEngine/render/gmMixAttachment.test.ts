import { describe, it, expect } from 'vitest';
import { renderSongFull } from './renderCoordinator';
import { generateSong } from '../generation/GenerationController';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createTimebase, createRandomContext } from '../foundation';
import { musicalIRToMidiEvents, ROLE_CHANNEL } from '../../../audio/musicalIrToMidi';

describe('render/gmMixAttachment — 混音落 IR(端到端)', () => {
  const band = buildBandSpec({ seed: 11, styleHint: 'pop', mood: 'build', targetDuration: 120 });
  const arrangement = buildArrangementPlan(band);
  const instrumentation = buildInstrumentationPlan(band, arrangement);
  const plan = buildHarmonicPlanFromArrangement(band, arrangement, createRandomContext(11));
  const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
  const { ir } = renderSongFull(band, arrangement, plan, instrumentation, timebase, createRandomContext(11));

  it('renderSongFull 给【每条轨】挂上 mix(CC7/10/91/93 全整数 0..127)', () => {
    expect(ir.tracks.length).toBeGreaterThan(0);
    for (const t of ir.tracks) {
      expect(t.mix, `${t.role} 缺 mix`).toBeDefined();
      for (const v of [t.mix!.volume, t.mix!.pan, t.mix!.reverb, t.mix!.chorus]) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(127);
      }
    }
  });

  it('Dream 默认通道不变量：所有轨 CC7=100、CC91/93=0，bass 居中', () => {
    const bass = ir.tracks.find((t) => t.role === 'bass')!.mix!;
    const comp = ir.tracks.find((t) => t.role === 'comp')?.mix;
    const pad = ir.tracks.find((t) => t.role === 'pad')?.mix;
    expect(bass.reverb).toBe(0);
    expect(bass.pan).toBe(64);
    for (const track of ir.tracks) {
      expect(track.mix!.volume, track.role).toBe(100);
      expect(track.mix!.reverb, track.role).toBe(0);
      expect(track.mix!.chorus, track.role).toBe(0);
    }
    if (comp && pad) expect(pad.reverb).toBe(comp.reverb);
  });

  it('原声钢琴 CC11 计划保留在 TrackIR，但硬件播放保持 Firm5504 默认 expression', () => {
    const seed = 1662;
    const pianoBand = buildBandSpec({ seed, styleHint: 'pop', mood: 'build', targetDuration: 90 });
    const pianoArrangement = buildArrangementPlan(pianoBand);
    const pianoInstrumentation = buildInstrumentationPlan(pianoBand, pianoArrangement);
    expect(pianoInstrumentation.roleProgram.comp).toBe(0);
    const pianoHarmony = buildHarmonicPlanFromArrangement(pianoBand, pianoArrangement, createRandomContext(seed));
    const pianoTimebase = createTimebase({ meter: pianoArrangement.meter });
    const rendered = renderSongFull(pianoBand, pianoArrangement, pianoHarmony, pianoInstrumentation, pianoTimebase, createRandomContext(seed)).ir;
    const compTrack = rendered.tracks.find((track) => track.role === 'comp');
    expect(compTrack).toBeDefined();
    const cc11 = (compTrack?.ccEvents ?? []).filter((event) => event.controller === 11);
    expect(cc11.length).toBeGreaterThan(0);
    expect(cc11.map((event) => event.value).every((value) => [60, 70, 80, 90, 100].includes(value))).toBe(true); // 乐句弧新增 60
    expect(cc11.map((event) => event.value)).toEqual(expect.arrayContaining([70, 90]));

    const outgoing = musicalIRToMidiEvents(rendered).filter((event) => event.type === 'cc' && event.data1 === 11);
    expect(outgoing).toEqual([]);
  });
});

describe('render/gmMixAttachment — programChanges ⟹ mixChanges(同 tick 耦合)', () => {
  // pop seed=3:lead 轨有段落音色切换(programChanges)→ 必带对应 mixChanges。
  const res = generateSong({ seed: 3, styleHint: 'pop', mood: 'build', targetDuration: 120 });

  it('有 programChanges 的轨 → 必有 mixChanges,且每个 program 切换 tick 都有 mix 刷新', () => {
    const switched = res.ir!.tracks.filter((t) => t.programChanges && t.programChanges.length);
    expect(switched.length).toBeGreaterThan(0); // 该 seed 确有切换(防回归静默)
    for (const t of switched) {
      expect(t.mixChanges, `${t.role} 有 pc 无 mc`).toBeDefined();
      const mcTicks = new Set((t.mixChanges ?? []).map((m) => m.atTick as number));
      for (const pc of t.programChanges!) {
        expect(mcTicks.has(pc.atTick as number), `pc@${pc.atTick} 无匹配 mixChange`).toBe(true);
      }
    }
  });

  it('programChanges 不伪造 EP CC72/74；原生输出只允许钢琴安全 CC64 与 CC11', () => {
    const isEp = (p: number | undefined) => p === 4 || p === 5;
    const switched = res.ir!.tracks.filter((t) => (t.programChanges ?? []).some((pc) => isEp(t.program) !== isEp(pc.program)));
    expect(switched.length).toBeGreaterThan(0);
    const midi = musicalIRToMidiEvents(res.ir!);
    for (const t of switched) {
      for (const pc of t.programChanges ?? []) {
        const tick = pc.atTick as number;
        expect((t.ccEvents ?? []).some((e) => (e.atTick as number) === tick && (e.controller === 72 || e.controller === 74)), `${t.role} pc@${tick} 不自动写 CC72/74`).toBe(false);
        const outgoingCC = midi.filter((event) => event.ticks === tick && event.channel === ROLE_CHANNEL[t.role] && event.type === 'cc');
        expect(outgoingCC.every((event) => [0, 11, 64].includes(event.data1)), `${t.role} pc@${tick} 只允许 CC0/钢琴 CC11/CC64`).toBe(true);
      }
    }
  });
});

describe('render/gmMixAttachment — Dream GM128 banked variations', () => {
  it('RNB 不把 St.FM 同时分给 lead/comp；完整地址按角色发送，鼓组不发 bank', () => {
    const res = generateSong({ seed: 0, styleHint: 'rnb', mood: 'build', targetDuration: 90 });
    const lead = res.ir!.tracks.find((t) => t.role === 'lead')!;
    const comp = res.ir!.tracks.find((t) => t.role === 'comp')!;
    const drum = res.ir!.tracks.find((t) => t.role === 'drum')!;
    expect(lead).toMatchObject({ program: 0, bank: 0 });
    expect(comp).toMatchObject({ program: 5, bank: 16 });
    expect(drum.bank).toBeUndefined();

    const events = musicalIRToMidiEvents(res.ir!);
    const leadBankMsb = events.findIndex((e) => e.type === 'cc' && e.channel === 1 && e.ticks === 0 && e.data1 === 0 && e.data2 === 0);
    const leadBankLsb = events.findIndex((e) => e.type === 'cc' && e.channel === 1 && e.ticks === 0 && e.data1 === 32);
    const leadPc = events.findIndex((e) => e.type === 'programChange' && e.channel === 1 && e.ticks === 0 && e.data1 === 0);
    const compBankMsb = events.findIndex((e) => e.type === 'cc' && e.channel === 2 && e.ticks === 0 && e.data1 === 0 && e.data2 === 16);
    const compBankLsb = events.findIndex((e) => e.type === 'cc' && e.channel === 2 && e.ticks === 0 && e.data1 === 32);
    const compPc = events.findIndex((e) => e.type === 'programChange' && e.channel === 2 && e.ticks === 0 && e.data1 === 5);
    const drumBankMsb = events.findIndex((e) => e.type === 'cc' && e.channel === 9 && e.ticks === 0 && e.data1 === 0);
    const drumBankLsb = events.findIndex((e) => e.type === 'cc' && e.channel === 9 && e.ticks === 0 && e.data1 === 32);
    const drumPc = events.findIndex((e) => e.type === 'programChange' && e.channel === 9 && e.ticks === 0 && e.data1 === drum.program);
    expect(leadBankMsb).toBeGreaterThanOrEqual(0);
    expect(leadBankLsb).toBe(-1);
    expect(leadPc).toBeGreaterThan(leadBankMsb);
    expect(compBankMsb).toBeGreaterThanOrEqual(0);
    expect(compBankLsb).toBe(-1);
    expect(compPc).toBeGreaterThan(compBankMsb);
    expect(drumBankMsb).toBe(-1);
    expect(drumBankLsb).toBe(-1);
    expect(drumPc).toBeGreaterThanOrEqual(0);
  });
});

describe('render/gmMixAttachment — lead 事件不受混音影响', () => {
  // 不比较/不改 lead 音符内容(parity 由 mgFinalLeadParity 守);此处只验证混音附加是【确定性、无副作用】的:
  // 同输入两次渲染 → lead 音符逐一致(混音挂载没碰 lead note 事件)。
  it('lead 音符在重复渲染下逐字节一致(混音挂载无副作用)', () => {
    const a = generateSong({ seed: 3, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    const b = generateSong({ seed: 3, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    const lead = (r: typeof a) => r.ir!.tracks.find((t) => t.role === 'lead')!.notes;
    expect(lead(a)).toEqual(lead(b));
    // lead 同样挂了 mix(参与混音),但 note 事件与混音正交
    expect(a.ir!.tracks.find((t) => t.role === 'lead')!.mix).toBeDefined();
  });
});
