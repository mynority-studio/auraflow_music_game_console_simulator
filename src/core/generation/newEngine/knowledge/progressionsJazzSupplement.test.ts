// ============================================================
// newEngine · knowledge · 联网补足 jazz prototype 验证(2026-06-05)
// ------------------------------------------------------------
// 锁:web 研究加的 3 条权威 jazz 进行(rhythm bridge / autumn leaves / jazz blues)
//   可被 picker 选到、和声形状正确、且端到端 Auditor 不 failed。
// ============================================================

import { describe, expect, it } from 'vitest';
import { listProgressionPrototypes, PROGRESSION_POOL } from './progressions';
import { generateSong } from '../generation/GenerationController';
import { pc } from '../foundation';

const byId = (id: string) => PROGRESSION_POOL.find((p) => p.id === id)!;

describe('联网补足 jazz prototype · 可达性', () => {
  it('rhythm bridge:JAZZ/Major/bridge/8 能选到', () => {
    const ids = listProgressionPrototypes({ style: 'JAZZ', mode: 'Major', functionRole: 'bridge', maxBars: 8 }).map((p) => p.id);
    expect(ids).toContain('jazz_rhythm_bridge_8');
  });
  it('autumn leaves:JAZZ/Minor/verse/8 能选到', () => {
    const ids = listProgressionPrototypes({ style: 'JAZZ', mode: 'Minor', functionRole: 'verse', maxBars: 8 }).map((p) => p.id);
    expect(ids).toContain('jazz_autumn_leaves_8');
  });
  it('jazz blues:JAZZ/Major/verse/12 能选到', () => {
    const ids = listProgressionPrototypes({ style: 'JAZZ', mode: 'Major', functionRole: 'verse', maxBars: 12 }).map((p) => p.id);
    expect(ids).toContain('jazz_blues_12');
  });
});

describe('联网补足 jazz prototype · 和声形状', () => {
  it('rhythm bridge = 五度循环属链:全部副属/属 + 末 V(III7→VI7→II7→V7,各2槽)', () => {
    const s = byId('jazz_rhythm_bridge_8').slots;
    expect(s).toHaveLength(8);
    expect(s.every((x) => x.type.startsWith('7') || x.type.includes('9') || x.type.includes('13'))).toBe(true);
    // 前6槽是副属(secondary_dominant),末2槽是 home V
    expect(s.slice(0, 6).every((x) => x.borrowedSource === 'secondary_dominant')).toBe(true);
    expect(s.slice(6).every((x) => x.scaleDegree === 5)).toBe(true);
    // rootOffset 链:III(4)→VI(9)→II(2)→V(7)
    expect([s[0].rootOffset, s[2].rootOffset, s[4].rootOffset, s[6].rootOffset]).toEqual([4, 9, 2, 7]);
  });
  it('autumn leaves = ii-V-I(关系大调)+ ii-V-i(小调):含 m7b5 的 ii + 小调 i', () => {
    const s = byId('jazz_autumn_leaves_8').slots;
    expect(s).toHaveLength(8);
    expect(s.some((x) => x.type === 'm7b5')).toBe(true); // 小调 iiø
    expect(s.some((x) => x.scaleDegree === 1 && x.type.startsWith('m'))).toBe(true); // 小调 i
    expect(s.some((x) => x.rootOffset === 3 && x.type.startsWith('maj'))).toBe(true); // bIII 关系大调 Imaj7
  });
  it('jazz blues = 12 bar,I7 开头,含 ii-V turnaround', () => {
    const s = byId('jazz_blues_12').slots;
    expect(s).toHaveLength(12);
    expect(s[0].scaleDegree).toBe(1);
    expect(s.some((x) => x.scaleDegree === 2 && x.type.startsWith('m')) && s.some((x) => x.scaleDegree === 5)).toBe(true);
  });
});

describe('联网补足 jazz prototype · 端到端 Auditor 不 failed', () => {
  it('jazz seed 0-23 全曲都能收敛(新 prototype 的半音/alt 和弦不让 Auditor 崩)', () => {
    for (let seed = 0; seed < 24; seed++) {
      const r = generateSong({ seed, styleHint: 'jazz', mood: 'x', targetDuration: 150, key: pc(0) });
      expect(r.status).not.toBe('failed');
    }
  }, 15_000);
});
