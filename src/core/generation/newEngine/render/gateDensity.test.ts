import { describe, it, expect } from 'vitest';
import { buildSongBundle, generateSong } from '../generation/GenerationController';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import { pc } from '../foundation';

const firstOnset = (notes: readonly { startTick: number }[]) =>
  notes.length ? Math.min(...notes.map((n) => n.startTick as number)) : Infinity;
const request = (seed: number) => ({ seed, styleHint: 'pop', mood: 'x', targetDuration: 120, key: pc(0) } as const);
const gen = (seed: number) => generateSong(request(seed));
const openingBounds = (seed: number) => {
  const bundle = buildSongBundle(request(seed));
  const opening = bundle.arrangement.sections[0];
  const barTicks = bundle.timebase.ppq * beatsPerBarOf(bundle.arrangement.meter);
  return {
    openingEnd: opening.bars * barTicks,
    gesture: bundle.arrangement.openingGesture,
  };
};

describe('render · A2 编曲密度弧 gate', () => {
  // seed7 的 duration-aware form 保留 4-bar intro；入场导演为 pad/drum 先行。
  const r = gen(7);
  const opening = openingBounds(7);
  const track = (res: typeof r, role: string) => res.ir!.tracks.find((t) => t.role === role);
  const inRange = (notes: readonly { startTick: number }[], lo: number, hi: number) => notes.some((n) => (n.startTick as number) >= lo && (n.startTick as number) < hi);

  it('生成成功(密度弧不破坏成曲)', () => {
    expect(r.status).not.toBe('failed');
    expect(r.ir).toBeTruthy();
  });

  it('★ 首段边界来自 bundle；drumsFirst 在首段入场且后续继续承托', () => {
    expect(opening.gesture.mode).toBe('drumsFirst');
    const drum = track(r, 'drum')!.notes;
    expect(inRange(drum, 0, opening.openingEnd)).toBe(true);
    expect(drum.some((note) => (note.startTick as number) >= opening.openingEnd)).toBe(true);
  });

  it('★ padSwell 先行：pad 在首段边界内发声', () => {
    expect(opening.gesture.textureEntry).toBe('padSwell');
    const pad = track(r, 'pad');
    expect(pad).toBeDefined();
    expect(firstOnset(pad!.notes)).toBeLessThan(opening.openingEnd);
  });

  it('确定性:同 seed 两次 IR 逐音一致', () => {
    expect(gen(7).ir!.tracks).toEqual(r.ir!.tracks);
  });
});
