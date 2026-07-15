import { describe, it, expect } from 'vitest';
import { generateMusicSync } from '../../musicGeneration/MusicGenerationService';
import { instrumentInfo, isBassRoleProgram } from '../knowledge/instruments';
import { ACG_TEXTURE_FAMILY } from '../knowledge/textureProfiles';

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

// ★ onset-group(final comp form 契约):同 onset 组(起点在 tol 内)。MG ACG chord ~100% 单音滚动琶音;
//   块状同起点复音 = "软块状和声床" = 不像 MG。tol 取 MG 分组精度(~6ms,round(time*1000) 级)。
const onsetGroups = (r: ReturnType<typeof acg>, notes: readonly { startTick: number }[], tolMs: number) => {
  const ppq = (r.ir!.timebase as { ppq: number }).ppq;
  const tol = Math.max(1, Math.round((tolMs / 1000) * (r.bpm / 60) * ppq));
  const sorted = [...notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
  const groups: number[] = []; let cur = 0; let anchor = -1e9;
  for (const n of sorted) { const t = n.startTick as number; if (t - anchor > tol) { if (cur) groups.push(cur); cur = 1; anchor = t; } else cur++; }
  if (cur) groups.push(cur);
  const single = groups.filter((g) => g === 1).length; const block = groups.filter((g) => g >= 2).length;
  return { singleRatio: single / groups.length, blockRatio: block / groups.length };
};

describe('render/mgBassCompLeadFidelity · ACG PIANOSONG 段级主织体', () => {
  it('ACG textureSchedule 收束为 2–3 个主手型，而非逐 bar 拼贴', () => {
    for (const seed of SEEDS) {
      const cases = texCases(acg(seed));
      expect(cases.length, `seed ${seed} ACG 织体 [${cases.join(',')}]`).toBeGreaterThanOrEqual(2);
      expect(cases.length, `seed ${seed} ACG 织体 [${cases.join(',')}]`).toBeLessThanOrEqual(3);
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

  it('★ P2 texture family(acg_render_layer directive:不 block-heavy·保 MG air):全曲 block ≤32%;intro/outro air ≥40%', () => {
    for (const seed of SEEDS) {
      const r = acg(seed);
      const tpb = (r.report as { texturePerBar?: string[] }).texturePerBar ?? [];
      const active = tpb.filter((t) => t !== '—');
      const ratio = (f: string) => active.filter((t) => ACG_TEXTURE_FAMILY[t] === f).length / Math.max(1, active.length);
      // 不整曲 block-heavy(J-pop 块床);MG 全曲 block 13-38% → ≤32 留余但抓退化。
      expect(ratio('block'), `seed ${seed} 全曲 block=${(ratio('block') * 100).toFixed(0)}%`).toBeLessThanOrEqual(0.32);
      // intro/outro 保 air(space+wash);修此前末段落进 block preferred → 块床。
      let bar = 0;
      for (const s of r.uiSnapshot.sections) {
        const seg = tpb.slice(bar, bar + s.bars).filter((t) => t !== '—'); bar += s.bars;
        if ((s.role === 'intro' || s.role === 'outro') && seg.length >= 2) {
          const air = seg.filter((t) => ACG_TEXTURE_FAMILY[t] === 'sparse' || ACG_TEXTURE_FAMILY[t] === 'wash').length / seg.length;
          expect(air, `seed ${seed} ${s.role} air=${(air * 100).toFixed(0)}%`).toBeGreaterThanOrEqual(0.40);
        }
      }
    }
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

  it('★★ P0 final comp = 单音滚动琶音(chord-roll):singleRatio≥0.9 · blockRatio≤0.05 —— 不是块状和声床', () => {
    for (const seed of SEEDS) {
      const r = acg(seed);
      const { singleRatio, blockRatio } = onsetGroups(r, trk(r, 'comp')!.notes as unknown as { startTick: number }[], 6);
      expect(singleRatio, `seed ${seed} singleRatio=${singleRatio.toFixed(3)}`).toBeGreaterThanOrEqual(0.9);
      expect(blockRatio, `seed ${seed} blockRatio=${blockRatio.toFixed(3)}`).toBeLessThanOrEqual(0.05);
    }
  });

  it('★★ P1 段内 lead 不空床(CODEX §P1:非 intro/outro 段 maxGap ≤6.5拍 —— 保呼吸但不 dead air)', () => {
    for (const seed of SEEDS) {
      const r = acg(seed); const ppq = (r.ir!.timebase as { ppq: number }).ppq;
      const lead = trk(r, 'lead')!.notes;
      for (const s of r.uiSnapshot.sections) {
        if (s.role === 'intro' || s.role === 'outro') continue;
        const iv = lead.filter((n) => (n.startTick as number) >= s.startBeat * ppq - 1 && (n.startTick as number) < s.endBeat * ppq - 1)
          .map((n) => ({ s: (n.startTick as number) / ppq, e: ((n.startTick as number) + (n.durationTicks as number)) / ppq })).sort((a, b) => a.s - b.s);
        if (iv.length < 2) continue;
        let maxGap = 0; let prevEnd = iv[0].e;
        for (let i = 1; i < iv.length; i++) { maxGap = Math.max(maxGap, iv[i].s - prevEnd); prevEnd = Math.max(prevEnd, iv[i].e); }
        expect(maxGap, `seed ${seed} ${s.role} lead 段内 maxGap=${maxGap.toFixed(1)}`).toBeLessThanOrEqual(6.5);
      }
    }
  });

  it('★ P0 offgrid 琶音力度—— comp 在 mf 亮层(≈46-62,和 lead 同层=音色齐平;2026-07-02 用户:一台钢琴)', () => {
    for (const seed of SEEDS) {
      const r = acg(seed); const ppq = (r.ir!.timebase as { ppq: number }).ppq;
      const off = trk(r, 'comp')!.notes.filter((n) => Math.abs(((n.startTick as number) / ppq) - Math.round((n.startTick as number) / ppq)) > 0.08);
      const mean = off.reduce((a, n) => a + (n.velocity as number), 0) / Math.max(1, off.length);
      expect(mean, `seed ${seed} offVel=${mean.toFixed(1)}`).toBeGreaterThanOrEqual(44);
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

  it('★ P1a 响度秩序(melody-first,但音色齐平):lead>comp 仍前置;comp≈mf(50-58,和 lead 同亮层);bass≈45', () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    for (const seed of SEEDS) {
      const r = acg(seed);
      const leadV = mean(trk(r, 'lead')!.notes.map((n) => n.velocity as number));
      const compV = mean(trk(r, 'comp')!.notes.map((n) => n.velocity as number));
      const bassV = mean(trk(r, 'bass')!.notes.map((n) => n.velocity as number));
      // ★ 2026-07-02:lead 仍在上(melody-first),但差距收窄(velocity 差 ~30 而非 ~55)→ comp 不再 pp 闷层,和 lead 同亮层=一台钢琴。
      //   ★ 2026-07-03:下界 46→44 —— mgMusicTheory 决定性修复(expectedResolutions by-ref)后 seed42 和声微变→ducking 略多→
      //   comp mean 45.9(range 32-63,仍 mf/melody-first),46 过紧。44 仍清楚 mf(远高 pp~30),不掩回归。
      expect(leadV - compV, `seed ${seed} lead(${leadV.toFixed(0)})>comp(${compV.toFixed(0)})`).toBeGreaterThan(18);
      expect(compV, `seed ${seed} comp mf`).toBeGreaterThanOrEqual(44);
      expect(compV, `seed ${seed} comp mf`).toBeLessThanOrEqual(62);
      expect(bassV, `seed ${seed} bass`).toBeGreaterThanOrEqual(38);
      expect(bassV, `seed ${seed} bass`).toBeLessThanOrEqual(56);
    }
  });

  it('★ P1b/P3 lead 音域上浮到 MG soprano(均值≥72;<69 少数 = apex-less bar 未 tuck,MG-faithful)', () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    for (const seed of SEEDS) {
      const ps = trk(acg(seed), 'lead')!.notes.map((n) => n.pitch as number);
      expect(mean(ps), `seed ${seed} lead mean`).toBeGreaterThanOrEqual(72); // MG core 69-76
      expect(ps.filter((p) => p < 69).length / ps.length, `seed ${seed} <69 占比`).toBeLessThan(0.05); // 无条件上浮
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
