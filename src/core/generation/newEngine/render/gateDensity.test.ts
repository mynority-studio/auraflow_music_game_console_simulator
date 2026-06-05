import { describe, it, expect } from 'vitest';
import { generateSong } from '../generation/GenerationController';
import { pc } from '../foundation';

const PPQ = 480;
const firstOnset = (notes: readonly { startTick: number }[]) =>
  notes.length ? Math.min(...notes.map((n) => n.startTick as number)) : Infinity;

describe('render · A2 编曲密度弧 gate', () => {
  // seed 3 pop → POP_FULL,intro 2 小节(setup:[pad,comp,lead],无 bass/drum)
  const r = generateSong({ seed: 3, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
  const track = (role: string) => r.ir!.tracks.find((t) => t.role === role);
  const introEnd = PPQ * 4 * 2; // 2 小节

  it('生成成功(密度弧不破坏成曲)', () => {
    expect(r.status).not.toBe('failed');
    expect(r.ir).toBeTruthy();
  });

  it('★ intro(前 2 小节)无 bass/drum:首个 bass/drum 音落在 intro 之后', () => {
    // 阈值留 jitter 余量(±7 tick):intro 边界 3840,用 3800 兜底
    expect(firstOnset(track('bass')!.notes)).toBeGreaterThanOrEqual(introEnd - 40);
    expect(firstOnset(track('drum')!.notes)).toBeGreaterThanOrEqual(introEnd - 40);
  });

  it('★ lead 全程(intro 就有音);bass/drum 进入后确实回来', () => {
    expect(firstOnset(track('lead')!.notes)).toBeLessThan(introEnd); // lead 在 intro 已出现
    expect(track('bass')!.notes.length).toBeGreaterThan(0);           // bass 后段回来
    expect(track('drum')!.notes.length).toBeGreaterThan(0);
  });

  it('确定性:同 seed 两次 IR 逐音一致', () => {
    const r2 = generateSong({ seed: 3, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) });
    expect(r2.ir!.tracks).toEqual(r.ir!.tracks);
  });
});
