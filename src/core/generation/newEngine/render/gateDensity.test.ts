import { describe, it, expect } from 'vitest';
import { generateSong } from '../generation/GenerationController';
import { pc } from '../foundation';

const PPQ = 480;
const firstOnset = (notes: readonly { startTick: number }[]) =>
  notes.length ? Math.min(...notes.map((n) => n.startTick as number)) : Infinity;
const gen = (seed: number) => generateSong({ seed, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
const BAR = PPQ * 4;
const introEnd = BAR * 2;       // POP_FULL intro = 2 小节
// intro 主体(末小节之前)= Loop E lead-in pickup 区之前。留 ~微抖动容差:bar-1 pickup 下拍可能被
// humanize 拉前 1-2 tick 越过 bar 边界,不应被判成"intro 主体有音"。
const introBodyEnd = introEnd - BAR - 40;

describe('render · A2 编曲密度弧 gate', () => {
  const r = gen(3);
  const track = (res: typeof r, role: string) => res.ir!.tracks.find((t) => t.role === role);
  const before = (notes: readonly { startTick: number }[], t: number) => notes.filter((n) => (n.startTick as number) < t).length;
  const inRange = (notes: readonly { startTick: number }[], lo: number, hi: number) => notes.some((n) => (n.startTick as number) >= lo && (n.startTick as number) < hi);

  it('生成成功(密度弧不破坏成曲)', () => {
    expect(r.status).not.toBe('failed');
    expect(r.ir).toBeTruthy();
  });

  it('★ intro 主体无 drum,仅末小节 lead-in pickup(Loop E:鼓在边界预进入);bass/drum 后段回来', () => {
    const drum = track(r, 'drum')!.notes;
    expect(before(drum, introBodyEnd)).toBe(0);                  // intro 主体无鼓
    expect(inRange(drum, introBodyEnd, introEnd)).toBe(true);    // 末小节有 lead-in pickup(verse1 是 lead-in)
    expect(track(r, 'bass')!.notes.length).toBeGreaterThan(0);
    expect(drum.length).toBeGreaterThan(0);
  });

  it('★ intro 先行档多样性:pad-led intro(seed 391144)主体无 bass/drum、pad 先行(末小节可有 lead-in pickup)', () => {
    const r2 = gen(391144); // 该 seed → pad+lead 先行档
    expect(before(track(r2, 'bass')!.notes, introBodyEnd)).toBe(0); // intro 主体无 bass
    expect(before(track(r2, 'drum')!.notes, introBodyEnd)).toBe(0); // intro 主体无 drum
    const pad = track(r2, 'pad');
    if (pad) expect(firstOnset(pad.notes)).toBeLessThan(introEnd); // pad/伴奏织体先行
  });

  it('确定性:同 seed 两次 IR 逐音一致', () => {
    expect(gen(3).ir!.tracks).toEqual(r.ir!.tracks);
  });
});
