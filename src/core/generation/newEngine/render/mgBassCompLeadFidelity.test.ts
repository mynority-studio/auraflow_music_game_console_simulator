import { describe, it, expect } from 'vitest';
import { generateMusicSync } from '../../musicGeneration/MusicGenerationService';
import { buildSongBundle } from '../generation/GenerationController';
import { instrumentInfo, isBassRoleProgram } from '../knowledge/instruments';

// ============================================================
// MG bass/comp/lead fidelity(directive §10.2)—— SIM 侧不变量(不依赖 live ../melodygenerative,任意 CI 可跑)。
// 跨引擎【密度/织体 vs MG】的实测对比在 scripts/audit-mg-bass-comp-lead-fidelity.ts(§5)。
// 本测锁:ACG PIANOSONG 的主织体按段稳定 + lead 近单音 + comp 密度不失控 + 家族合法。
// ============================================================

const acg = (seed: number) => generateMusicSync({ seed, styleHint: 'acg', mood: 'build', targetDuration: 90 });
const trk = (r: ReturnType<typeof acg>, role: string) => r.ir!.tracks.find((t) => t.role === role);
const bars = (r: ReturnType<typeof acg>) => r.uiSnapshot.sections.reduce((a, s) => a + s.bars, 0) || 1;
const texCases = (r: ReturnType<typeof acg>) => ((r.report as { textureCases?: string[] } | undefined)?.textureCases ?? []);
const maxStackAt = (notes: readonly { startTick: number }[]) => {
  const by = new Map<number, number>();
  for (const n of notes) by.set(n.startTick, (by.get(n.startTick) ?? 0) + 1);
  return Math.max(0, ...by.values());
};

const SEEDS = [0, 7, 42, 99, 12345];

const acgScore = (seed: number) => {
  const bundle = buildSongBundle({ seed, styleHint: 'acg', mood: 'build', targetDuration: 90 });
  expect(bundle.acgPianoScorePlan, `seed ${seed} PianoScorePlan`).toBeDefined();
  return bundle.acgPianoScorePlan!;
};

describe('render/mgBassCompLeadFidelity · ACG PIANOSONG 段级主织体', () => {
  it('ACG PianoScorePlan 保持受控的 3–6 个手型：中段有发展，但不逐 bar 无序拼贴', () => {
    for (const seed of SEEDS) {
      const cases = texCases(acg(seed));
      expect(cases.length, `seed ${seed} ACG 织体 [${cases.join(',')}]`).toBeGreaterThanOrEqual(3);
      expect(cases.length, `seed ${seed} ACG 织体 [${cases.join(',')}]`).toBeLessThanOrEqual(6);
    }
  });

  it('ACG 织体全部是 ACG 具名手势(comp 消费 MG 织体池)', () => {
    for (const seed of SEEDS) {
      for (const tc of texCases(acg(seed))) {
        expect(tc.startsWith('ACG_') || tc.startsWith('Piano_'), `seed ${seed} 非 ACG 织体 ${tc}`).toBe(true);
      }
    }
  });
});

describe('render/mgBassCompLeadFidelity · lead/comp/bass 结构', () => {
  it('ACG 恒 lead+comp+bass;comp 有音符(硬合同)', () => {
    for (const seed of SEEDS) {
      const r = acg(seed);
      const roles = new Set(r.ir!.tracks.map((t) => t.role));
      expect(roles.has('lead') && roles.has('comp') && roles.has('bass'), `seed ${seed}`).toBe(true);
      expect(trk(r, 'comp')!.notes.length, `seed ${seed} comp notes`).toBeGreaterThan(0);
    }
  });

  it('ACG lead 近单音(任一 onset 同时 ≤2),不塞 comp 织体进 lead', () => {
    for (const seed of SEEDS) {
      const lead = trk(acg(seed), 'lead')!;
      expect(maxStackAt(lead.notes as unknown as { startTick: number }[]), `seed ${seed}`).toBeLessThanOrEqual(2);
    }
  });

  it('★ P2 Arranger 总谱分配多种句法；柱式只作抵达手势，不能退化成整曲块状和声床', () => {
    const allGestures = new Set<string>();
    for (const seed of SEEDS) {
      const score = acgScore(seed);
      const spans = Object.values(score.spanById);
      const audible = spans.filter((span) => span.comp.gesture !== 'tacet');
      const gestures = new Set(audible.map((span) => span.comp.gesture));
      const blocks = audible.filter((span) => span.comp.gesture === 'block');

      expect(audible.length, `seed ${seed} audible score spans`).toBeGreaterThan(0);
      // A piano cue may use literal vertical blocks, but they are cadence colour,
      // never the default accompaniment bed.
      expect(blocks.length / audible.length, `seed ${seed} block-bed ratio`).toBeLessThanOrEqual(0.35);
      expect(gestures.size, `seed ${seed} score gesture variety`).toBeGreaterThanOrEqual(2);
      expect(audible.some((span) => span.comp.gesture !== 'block'), `seed ${seed} has non-block accompaniment`).toBe(true);
      for (const span of spans) {
        expect(span.comp.gesture === 'tacet' ? span.comp.events.length === 0 : span.comp.events.length > 0,
          `seed ${seed} ${span.spanId} score event contract`).toBe(true);
        allGestures.add(span.comp.gesture);
      }
    }
    expect(allGestures.size, 'fixed seed set should exercise the internal score vocabulary').toBeGreaterThanOrEqual(5);
  });

  it('★ P2 ACG comp 密度 MG-aligned(carve 让路后不过密;MG≈3.8-6.2/bar)', () => {
    for (const seed of SEEDS) {
      const r = acg(seed);
      const compPerBar = trk(r, 'comp')!.notes.length / bars(r);
      expect(compPerBar, `seed ${seed} comp/bar=${compPerBar.toFixed(1)}`).toBeLessThanOrEqual(8);
    }
  });

  it('★ P2 ACG comp 有低位 cantabile 托底(inner voice/floor 在旋律下方)', () => {
    for (const seed of SEEDS) {
      const comp = trk(acg(seed), 'comp')!;
      expect(comp.notes.some((n) => (n.pitch as number) < 64), `seed ${seed} comp 低位支撑`).toBe(true);
    }
  });

  it('★★ P1 三轨钢琴连续性：lead 长呼吸必须由中音 COMP 或低音根基承接', () => {
    for (const seed of SEEDS) {
      const r = acg(seed); const ppq = (r.ir!.timebase as { ppq: number }).ppq;
      const lead = trk(r, 'lead')!.notes;
      const lowerHands = [
        ...trk(r, 'comp')!.notes,
        ...trk(r, 'bass')!.notes,
      ].map((note) => ({
        s: (note.startTick as number) / ppq,
        e: ((note.startTick as number) + (note.durationTicks as number)) / ppq,
      }));
      for (const s of r.uiSnapshot.sections) {
        if (s.role === 'intro' || s.role === 'outro') continue;
        const iv = lead.filter((n) => (n.startTick as number) >= s.startBeat * ppq - 1 && (n.startTick as number) < s.endBeat * ppq - 1)
          .map((n) => ({ s: (n.startTick as number) / ppq, e: ((n.startTick as number) + (n.durationTicks as number)) / ppq })).sort((a, b) => a.s - b.s);
        if (iv.length < 2) continue;
        let prevEnd = iv[0].e;
        for (let i = 1; i < iv.length; i++) {
          const nextStart = iv[i].s;
          if (nextStart - prevEnd > 6.5) {
            expect(lowerHands.some((support) =>
              support.s < nextStart - 1e-4 && support.e > prevEnd + 1e-4),
            `seed ${seed} ${s.role} lead breath ${prevEnd.toFixed(2)}..${nextStart.toFixed(2)} has lower-hand support`)
              .toBe(true);
          }
          prevEnd = Math.max(prevEnd, iv[i].e);
        }
      }
    }
  });

  it('★ P0 offgrid 琶音力度—— comp 在可听 mf 亮层(≈40-62,和 lead 同层=音色齐平;中部换位后不靠高 air 撑均值)', () => {
    for (const seed of SEEDS) {
      const r = acg(seed); const ppq = (r.ir!.timebase as { ppq: number }).ppq;
      const off = trk(r, 'comp')!.notes.filter((n) => Math.abs(((n.startTick as number) / ppq) - Math.round((n.startTick as number) / ppq)) > 0.08);
      const mean = off.reduce((a, n) => a + (n.velocity as number), 0) / Math.max(1, off.length);
      expect(mean, `seed ${seed} offVel=${mean.toFixed(1)}`).toBeGreaterThanOrEqual(40);
      expect(mean, `seed ${seed} offVel=${mean.toFixed(1)}`).toBeLessThanOrEqual(62);
    }
  });

  it('★ P0-1:ACG comp pedal 按音色:大钢琴保留,软/FGM 电钢禁用以避免多音糊', () => {
    for (const seed of SEEDS) {
      const comp = trk(acg(seed), 'comp');
      const ped = comp?.pedalEvents ?? [];
      if (comp?.program === 4 || comp?.program === 5) {
        expect(ped.length, `seed ${seed} ACG electric piano comp 不踩踏板`).toBe(0);
        continue;
      }
      expect(ped.length, `seed ${seed} ACG comp 踏板`).toBeGreaterThan(0);
      expect(ped.some((p) => p.down), `seed ${seed} 有踩下`).toBe(true);
      expect(ped.some((p) => !p.down), `seed ${seed} 有抬起`).toBe(true);
    }
  });

  it('★ P1a 响度秩序(melody-first,但音色齐平):lead>comp 仍前置;comp 保持可听 mf; bass≈45', () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    for (const seed of SEEDS) {
      const r = acg(seed);
      const leadV = mean(trk(r, 'lead')!.notes.map((n) => n.velocity as number));
      const compV = mean(trk(r, 'comp')!.notes.map((n) => n.velocity as number));
      const bassV = mean(trk(r, 'bass')!.notes.map((n) => n.velocity as number));
      // ★ 2026-07-02:lead 仍在上(melody-first),但差距收窄(velocity 差 ~30 而非 ~55)→ comp 不再 pp 闷层,和 lead 同亮层=一台钢琴。
      //   中部换位后不再以高 air 维持亮度，个别 seed 的平均值会轻微下降；≥42 仍是可听 mf，
      //   远高于 pp~30，也不以抢 lead 的高音换响度。
      expect(leadV - compV, `seed ${seed} lead(${leadV.toFixed(0)})>comp(${compV.toFixed(0)})`).toBeGreaterThan(18);
      expect(compV, `seed ${seed} comp mf`).toBeGreaterThanOrEqual(42);
      expect(compV, `seed ${seed} comp mf`).toBeLessThanOrEqual(62);
      expect(bassV, `seed ${seed} bass`).toBeGreaterThanOrEqual(38);
      expect(bassV, `seed ${seed} bass`).toBeLessThanOrEqual(56);
    }
  });

  it('★ P1b/P3 lead 保持最高声部：均值≥72，且整轨严格位于中音 COMP 之上', () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    for (const seed of SEEDS) {
      const result = acg(seed);
      const ps = trk(result, 'lead')!.notes.map((n) => n.pitch as number);
      const compTop = Math.max(...trk(result, 'comp')!.notes.map((n) => n.pitch as number));
      expect(mean(ps), `seed ${seed} lead mean`).toBeGreaterThanOrEqual(72); // MG core 69-76
      expect(Math.min(...ps), `seed ${seed} lead/COMP lane order`).toBeGreaterThan(compTop);
    }
  });

  it('家族合法:ACG lead/comp=keyboard,bass=真实贝斯或钢琴左手', () => {
    for (const seed of SEEDS) {
      const r = acg(seed);
      for (const role of ['lead', 'comp'] as const) {
        const t = trk(r, role); if (t) expect(instrumentInfo(t.program).family, `seed ${seed} ${role}`).toBe('keyboard');
      }
      const b = trk(r, 'bass'); if (b) expect(isBassRoleProgram(b.program), `seed ${seed} bass`).toBe(true);
    }
  });
});
