import { describe, it, expect } from 'vitest';
import { buildBandSpec } from './bandEngine';
import { pc } from '../foundation';
import { instrumentInfo } from '../knowledge/instruments';
import type { InstrumentRoleName } from './BandSpec';

describe('band/bandEngine', () => {
  it('已知 style 取对应 styleProfile', () => {
    const spec = buildBandSpec({ seed: 1, styleHint: 'lofi', mood: 'calm', targetDuration: 100 });
    expect(spec.style).toBe('lofi');
    expect(spec.styleProfile.padDensity).toBe(0.6);
    expect(spec.tonalityKind).toBe('tonal');
  });

  it('未知 style → default', () => {
    const spec = buildBandSpec({ seed: 1, styleHint: 'unknown-xyz', mood: 'x', targetDuration: 60 });
    expect(spec.style).toBe('default');
  });

  it('key/mode 缺省 → seed 派生(确定性 + 合法范围);显式 request 永远覆盖', () => {
    const a = buildBandSpec({ seed: 1, styleHint: 'pop', mood: 'x', targetDuration: 60 });
    expect(a.key).toBeGreaterThanOrEqual(0);
    expect(a.key).toBeLessThan(12);             // 12 调之一
    expect(['major', 'minor']).toContain(a.mode);
    // 确定性:同 seed 两次一致
    const a2 = buildBandSpec({ seed: 1, styleHint: 'pop', mood: 'x', targetDuration: 60 });
    expect(a2.key).toBe(a.key);
    expect(a2.mode).toBe(a.mode);
    // 显式覆盖
    const b = buildBandSpec({ seed: 1, styleHint: 'pop', mood: 'x', targetDuration: 60, key: pc(7), mode: 'minor' });
    expect(b.key).toBe(7);
    expect(b.mode).toBe('minor');
  });

  it('不同 seed 出不同 key(seed 派生 → 调性多样)', () => {
    const keys = new Set<number>();
    for (let s = 0; s < 24; s++) keys.add(buildBandSpec({ seed: s, styleHint: 'pop', mood: 'x', targetDuration: 60 }).key);
    expect(keys.size).toBeGreaterThanOrEqual(6); // 24 seed 至少出 6 个不同调
  });

  it('编制可变(2–5 件):必含 lead + ≥1 和声(comp/pad/bass);每件有 GM program', () => {
    const spec = buildBandSpec({ seed: 1, styleHint: 'jazz', mood: 'x', targetDuration: 60 });
    expect(spec.instrumentPool.length).toBeGreaterThanOrEqual(2);
    expect(spec.instrumentPool.length).toBeLessThanOrEqual(5);
    expect(spec.instrumentPool).toContain('lead'); // 旋律必有
    expect(spec.instrumentPool.some((r) => r === 'comp' || r === 'pad' || r === 'bass')).toBe(true); // 和声承载
    for (const r of spec.instrumentPool) expect(typeof spec.roleProgram[r]).toBe('number'); // 每件选了乐器
  });

  it('LOFI 固定含 bass,避免 bass:required texture 被分轨丢失', () => {
    for (let seed = 0; seed < 32; seed++) {
      const spec = buildBandSpec({ seed, styleHint: 'lofi', mood: 'x', targetDuration: 60 });
      expect(spec.instrumentPool).toContain('bass');
    }
  });

  it('POP/RNB/LOFI/JAZZ 默认都有 drum(鼓手打法交给 DrumPerformanceContract)', () => {
    for (const style of ['pop', 'rnb', 'lofi', 'jazz']) {
      for (let seed = 0; seed < 32; seed++) {
        const spec = buildBandSpec({ seed, styleHint: style, mood: 'x', targetDuration: 60 });
        expect(spec.instrumentPool, `${style} seed ${seed}`).toContain('drum');
      }
    }
  });

  it('不同 style/seed → 编制大小或乐器不同(乐器要素随 seed)', () => {
    const sig = (s: number, style: string) => { const b = buildBandSpec({ seed: s, styleHint: style, mood: 'x', targetDuration: 60 }); return `${b.instrumentPool.join(',')}|${b.instrumentPool.map((r) => b.roleProgram[r]).join(',')}`; };
    const sigs = new Set<string>();
    for (let s = 0; s < 12; s++) { sigs.add(sig(s, 'jazz')); sigs.add(sig(s, 'lofi')); }
    expect(sigs.size).toBeGreaterThanOrEqual(6); // 编制/乐器有多样性
    expect(sig(3, 'jazz')).toBe(sig(3, 'jazz')); // 确定性
  });
});

// ★ 阶段2-A:Band Selection「参与乐手/职能」→ lineup/家族约束(音色仍器配层 rng 选)
describe('band/bandEngine · participant lineup 约束', () => {
  const roleSet = (...rs: InstrumentRoleName[]) => new Set<InstrumentRoleName>(rs);

  it('allowedRoles 只保留被选职能(贝斯手+鼓手 → 无 lead/comp → 自动补 lead)', () => {
    for (let seed = 0; seed < 16; seed++) {
      const spec = buildBandSpec({
        seed, styleHint: 'pop', mood: 'x', targetDuration: 60,
        bandConstraint: { allowedRoles: roleSet('bass', 'drum') },
      });
      // 只含 bass / drum / 自动补的 lead —— comp / pad 永不出现
      for (const r of spec.instrumentPool) expect(['bass', 'drum', 'lead']).toContain(r);
      expect(spec.instrumentPool).toContain('bass');
      // 没有任何旋律/和声 role 被选 → §4.4 自动补 lead
      expect(spec.instrumentPool).toContain('lead');
      expect(spec.autoFilledRoles).toEqual(['lead']);
    }
  });

  it('★ requiredRoles → 该 role 必须出现(默认 lineup 没随机到也补上;P1 修复)', () => {
    // participant 约束下 requiredRoles 仍是硬要求:即便 allowedRoles 缩窄,被选中的职责也必须出声。
    for (let seed = 0; seed < 32; seed++) {
      const spec = buildBandSpec({
        seed, styleHint: 'pop', mood: 'x', targetDuration: 60,
        bandConstraint: { allowedRoles: roleSet('comp', 'bass', 'drum'), requiredRoles: roleSet('comp', 'bass', 'drum') },
      });
      expect(spec.instrumentPool, `seed ${seed} 必含 drum`).toContain('drum');
      expect(spec.instrumentPool).toContain('bass');
      expect(spec.instrumentPool).toContain('comp');
    }
  });

  it('★ requiredRoles 只含 drum + 自动补 lead(仅选鼓手场景)', () => {
    for (let seed = 0; seed < 16; seed++) {
      const spec = buildBandSpec({
        seed, styleHint: 'pop', mood: 'x', targetDuration: 60,
        bandConstraint: { allowedRoles: roleSet('drum'), requiredRoles: roleSet('drum') },
      });
      expect(spec.instrumentPool).toContain('drum');     // 鼓手一定有鼓
      expect(spec.instrumentPool).toContain('lead');     // §4.4 自动补旋律
      expect(spec.autoFilledRoles).toEqual(['lead']);
      for (const r of spec.instrumentPool) expect(['drum', 'lead']).toContain(r);
    }
  });

  it('选中 comp(键盘手)时不自动补位:lineup ⊆ 被选职能,autoFilledRoles 为空', () => {
    for (let seed = 0; seed < 16; seed++) {
      const spec = buildBandSpec({
        seed, styleHint: 'pop', mood: 'x', targetDuration: 60,
        bandConstraint: { allowedRoles: roleSet('comp', 'bass', 'drum') },
      });
      for (const r of spec.instrumentPool) expect(['comp', 'bass', 'drum']).toContain(r);
      expect(spec.instrumentPool).toContain('comp'); // 键盘手在场
      expect(spec.autoFilledRoles).toBeUndefined();  // 有 comp → 不补位
    }
  });

  it('familyByRole 限定候选家族(lead=mallet → 只木琴;音色仍 rng 在家族内选)', () => {
    // pop lead 候选跨 keyboard/mallet/wind;约束到 mallet → 家族恒为 mallet
    for (let seed = 0; seed < 24; seed++) {
      const spec = buildBandSpec({
        seed, styleHint: 'pop', mood: 'x', targetDuration: 60,
        bandConstraint: { familyByRole: { lead: ['mallet'] } },
      });
      expect(instrumentInfo(spec.roleProgram.lead).family).toBe('mallet');
    }
  });

  it('空交集家族 → 回退不过滤(仍出合法音色,不致 lineup 失声)', () => {
    // pop lead 无 strings 家族候选 → 回退全候选,程序仍合法
    const spec = buildBandSpec({
      seed: 5, styleHint: 'pop', mood: 'x', targetDuration: 60,
      bandConstraint: { familyByRole: { lead: ['strings'] } },
    });
    expect(typeof spec.roleProgram.lead).toBe('number');
    expect(spec.instrumentPool).toContain('lead');
  });

  it('无约束 → 与不传 bandConstraint 字节一致(确定性不被约束机制扰动)', () => {
    const sig = (req: Parameters<typeof buildBandSpec>[0]) => {
      const b = buildBandSpec(req);
      return `${b.instrumentPool.join(',')}|${b.instrumentPool.map((r) => b.roleProgram[r]).join(',')}`;
    };
    for (let seed = 0; seed < 12; seed++) {
      const base = { seed, styleHint: 'pop', mood: 'x', targetDuration: 60 } as const;
      expect(sig({ ...base, bandConstraint: {} })).toBe(sig(base));
    }
  });
});
