// ============================================================
// newEngine · knowledge · 乐器演奏能力(单音/多音 + 持续/衰减)+ comp 能力 guard(2026-06-10)
// ------------------------------------------------------------
// 用户:器配层要理解哪些乐器单音/多音;管风琴(持续/无 velocity)不能做衰减节奏 comp 吹三音(脱离现实)。
// 联网核对:① 只有多音乐器能 comp ② Hammond 持续+无 velocity+少音 → 不适合我们的衰减节奏 comp。
// 锁:能力分类正确 · comp 池只含可 comp 乐器 · 管风琴归 pad · guard 修不可 comp 的 comp · 959571 不再管风琴 comp。
// ============================================================

import { describe, it, expect } from 'vitest';
import { isPolyphonic, isSustainedInstrument, canPlayComp, repairCompCapability, getInstrumentCatalog, gmName } from './instruments';
import { buildBandSpec } from '../band/bandEngine';

describe('乐器演奏能力分类', () => {
  it('单音 vs 多音:管乐/铜管/萨克斯/独奏弓弦=单音;键盘/吉他/木琴/管风琴=多音', () => {
    for (const mono of [56, 60, 66, 73, 40, 42]) expect(isPolyphonic(mono), `${gmName(mono)} 应单音`).toBe(false); // 小号/长号/萨克斯/长笛/小提/大提
    for (const poly of [0, 4, 16, 24, 25, 11, 89]) expect(isPolyphonic(poly), `${gmName(poly)} 应多音`).toBe(true); // 钢琴/电钢/管风琴/吉他/颤音/pad
  });

  it('持续 vs 衰减:管风琴/合奏弦/合成 pad=持续;钢琴/电钢/吉他/木琴=衰减', () => {
    for (const sus of [16, 48, 49, 89, 94]) expect(isSustainedInstrument(sus), `${gmName(sus)} 应持续`).toBe(true);
    for (const dec of [0, 4, 24, 25, 26, 11, 12]) expect(isSustainedInstrument(dec), `${gmName(dec)} 应衰减`).toBe(false);
  });

  it('★ canPlayComp:多音+非持续才行 —— 钢琴/电钢/吉他/木琴 ✓;管风琴/弦/pad ✗;萨克斯 ✗', () => {
    for (const ok of [0, 1, 4, 5, 24, 25, 26, 11, 12]) expect(canPlayComp(ok), `${gmName(ok)} 应可 comp`).toBe(true);
    for (const no of [16, 48, 89, 94, 66, 73]) expect(canPlayComp(no), `${gmName(no)} 不应 comp`).toBe(false); // 管风琴/弦/pad/萨克斯/长笛
  });
});

describe('comp 池只含可 comp 乐器;管风琴归 pad', () => {
  it('所有 style 的 comp 候选都 canPlayComp', () => {
    for (const s of getInstrumentCatalog())
      for (const r of s.roles) if (r.role === 'comp') for (const p of r.programs) expect(canPlayComp(p), `${s.style} comp ${gmName(p)} 不可 comp`).toBe(true);
  });
  it('管风琴(16)不在任何主动器配池;暖 Pad 承担持续垫', () => {
    const cat = getInstrumentCatalog();
    for (const s of cat) for (const r of s.roles) expect(r.programs.includes(16), `${s.style} ${r.role} 不该有管风琴`).toBe(false);
    const pads = new Set<number>();
    for (const s of cat) for (const r of s.roles) if (r.role === 'pad') for (const p of r.programs) pads.add(p);
    expect([...pads].sort((a, b) => a - b)).toEqual([89]);
  });
});

describe('repairCompCapability — guard 修不可 comp 的 comp', () => {
  it('comp=管风琴(16,持续)→ 换成可 comp;comp=萨克斯(67,单音)→ 换成可 comp', () => {
    const a = repairCompCapability({ lead: 4, comp: 16, bass: 33, pad: 89, drum: 0 }, 'rnb');
    expect(canPlayComp(a.comp)).toBe(true);
    const b = repairCompCapability({ lead: 4, comp: 67, bass: 33, pad: 89, drum: 0 }, 'jazz');
    expect(canPlayComp(b.comp)).toBe(true);
  });
  it('comp 本就可 comp(电钢)→ 原对象返回(不乱改)', () => {
    const rp = { lead: 4, comp: 4, bass: 33, pad: 89, drum: 0 };
    expect(repairCompCapability(rp, 'pop')).toBe(rp);
  });
});

describe('★ 959571:rnb/jazz comp 不再是管风琴(端到端)', () => {
  it('comp 是可 comp 乐器(键盘),非管风琴', () => {
    for (const style of ['rnb', 'jazz']) {
      const band = buildBandSpec({ seed: 959571, styleHint: style, mood: 'build', targetDuration: 120 });
      const comp = (band.roleProgram as Record<string, number>).comp;
      expect(comp, `${style} comp=${gmName(comp)}`).not.toBe(16); // 不是管风琴
      expect(canPlayComp(comp), `${style} comp ${gmName(comp)} 应可 comp`).toBe(true);
    }
  });
});
