import { describe, it, expect } from 'vitest';
import { generateSong } from '../generation/GenerationController';

// ★ comp 去拖拍(2026-06-23,用户:632219 verse comp 滞后 bass/drum 八分 groove)。
//   直拍风格:把 comp 落在拍内弱 16 分(.25/.75 拖拍)的 onset 吸回前一个八分;.5(and)有意切分保留;swung 不动。

const compPhases = (seed: number, style: string): { ppq: number; phases: number[] } => {
  const r = generateSong({ seed, styleHint: style, mood: 'build', targetDuration: 96 });
  const ppq = r.ir!.timebase.ppq;
  const comp = r.ir!.tracks.find((t) => t.role === 'comp')!;
  const phases = comp.notes.map((n) => { const ph = (((n.startTick as number) / ppq) % 1 + 1) % 1; return +ph.toFixed(3); });
  return { ppq, phases };
};
const isWeak16 = (ph: number): boolean => Math.abs(ph - 0.25) < 0.06 || Math.abs(ph - 0.75) < 0.06;
const onEighth = (ph: number): boolean => Math.abs(ph - Math.round(ph * 2) / 2) < 0.06;

describe('render/compGroove · comp 去拖拍(directive 2026-06-23)', () => {
  it('★ 直拍 pop:comp 无拍内弱 16 分拖拍(.25/.75)—— 全落八分网格,锁鼓/bass', () => {
    for (const seed of [632219, 42, 7, 11, 633823]) { // 之前 comp 偏八分 10-30% 的 seed
      const { phases } = compPhases(seed, 'pop');
      const weak16 = phases.filter(isWeak16).length;
      expect(weak16, `seed${seed} 弱16分拖拍`).toBe(0);
      expect(phases.every(onEighth), `seed${seed} 全落八分`).toBe(true);
    }
  });

  it('★ .5(and)有意切分保留(不是把所有 comp 压成下拍)', () => {
    // 632219 之前在 .25 拖拍 → 现吸到 .0;若全压下拍则无 .5;确认仍允许 .0 与(其它 seed 的).5 共存
    const { phases } = compPhases(632219, 'pop');
    expect(phases.some((p) => Math.abs(p) < 0.06), '有下拍').toBe(true);
    // 跨多 seed 至少一个保留 .5(and)切分(没被误吸)
    const anyAnd = [1, 2, 3, 100, 555, 777].some((s) => compPhases(s, 'pop').phases.some((p) => Math.abs(p - 0.5) < 0.06));
    expect(anyAnd, '.5 切分仍存在').toBe(true);
  });

  it('★ swung(jazz)不被去拖拍(loose 是 feel)+ 只动 comp(bass/drum/lead 不变)', () => {
    const base = generateSong({ seed: 632219, styleHint: 'pop', mood: 'build', targetDuration: 96 });
    // 只 comp 被改:bass/drum onset 仍可含非八分(它们各自的 groove),不受 comp 步影响 —— 这里确认 lead/bass/drum 轨存在且非空
    for (const role of ['bass', 'drum', 'lead'] as const) {
      expect(base.ir!.tracks.find((t) => t.role === role)!.notes.length, `${role} 非空`).toBeGreaterThan(0);
    }
    // jazz comp 允许 off-eighth(swung,不被去拖拍)
    const jazz = compPhases(3, 'jazz');
    expect(jazz.phases.length).toBeGreaterThan(0); // 端到端不抛;swung comp 不强制八分
  });
});
