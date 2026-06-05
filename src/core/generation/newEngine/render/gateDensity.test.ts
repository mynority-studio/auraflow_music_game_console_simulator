import { describe, it, expect } from 'vitest';
import { generateSong } from '../generation/GenerationController';
import { pc } from '../foundation';

const PPQ = 480;
const firstOnset = (notes: readonly { startTick: number }[]) =>
  notes.length ? Math.min(...notes.map((n) => n.startTick as number)) : Infinity;
const gen = (seed: number) => generateSong({ seed, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
const introEnd = PPQ * 4 * 2; // POP_FULL intro = 2 小节

describe('render · A2 编曲密度弧 gate', () => {
  const r = gen(3);
  const track = (res: typeof r, role: string) => res.ir!.tracks.find((t) => t.role === role);

  it('生成成功(密度弧不破坏成曲)', () => {
    expect(r.status).not.toBe('failed');
    expect(r.ir).toBeTruthy();
  });

  it('★ intro 无 drum(先行档不含鼓 → 鼓在 intro 之后才进);bass/drum 后段确实回来', () => {
    expect(firstOnset(track(r, 'drum')!.notes)).toBeGreaterThanOrEqual(introEnd - 40); // intro 无鼓
    expect(track(r, 'bass')!.notes.length).toBeGreaterThan(0); // bass 整曲有音
    expect(track(r, 'drum')!.notes.length).toBeGreaterThan(0);
  });

  it('★ intro 先行档多样性:pad-led intro(seed 391144)无 bass/drum、pad 先行(不再恒定 bass)', () => {
    const r2 = gen(391144); // 该 seed → pad+lead 先行档
    expect(firstOnset(track(r2, 'bass')!.notes)).toBeGreaterThanOrEqual(introEnd - 40); // intro 无 bass
    expect(firstOnset(track(r2, 'drum')!.notes)).toBeGreaterThanOrEqual(introEnd - 40);
    const pad = track(r2, 'pad');
    if (pad) expect(firstOnset(pad.notes)).toBeLessThan(introEnd); // pad/伴奏织体先行
  });

  it('确定性:同 seed 两次 IR 逐音一致', () => {
    expect(gen(3).ir!.tracks).toEqual(r.ir!.tracks);
  });
});
