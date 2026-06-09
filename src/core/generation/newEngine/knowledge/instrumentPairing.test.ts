// ============================================================
// newEngine · knowledge · 暖路线调色板扩充 + lead↔comp 配对一致性(2026-06-09)
// ------------------------------------------------------------
// 锁:① 暖 GM 乐器进池(吉他/哈蒙德/大提琴/暖 pad/古筝/卡林巴)+ 有 INFO/NAME/SOURCE;
//   ② coherentLeadComp 修不搭对(马林巴+电钢→电钢配电钢 / 解绑),已和谐保留;③ 不破坏风格世界守卫。
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  instrumentInfo, gmName, timbreSource, leadCompCompatible, coherentLeadComp,
  getInstrumentCatalog, worldMismatches, classifyTimbreWorld,
} from './instruments';

const WARM_META = [16, 24, 26, 27, 42, 88, 94, 107, 108]; // 全部新增暖乐器(有元数据)
const WARM_POOLED = [16, 26, 88, 94, 107, 108]; // 实际进 style 池的(吉他/弦在 comp 需 voicing 升级,暂留元数据)
const WARM_ADDED = WARM_META;

describe('暖路线 GM 调色板扩充', () => {
  it('新增暖乐器都有 family/range + 中文名 + 音色来源(无 GM n 兜底)', () => {
    for (const p of WARM_ADDED) {
      expect(instrumentInfo(p).family, `${p} family`).not.toBe('other');
      expect(gmName(p), `${p} name`).not.toMatch(/^GM /);
      expect(['acoustic', 'electric', 'synth']).toContain(timbreSource(p));
    }
  });

  it('family 分类正确(吉他=guitar / 哈蒙德=keyboard / 大提琴=strings / 卡林巴&古筝=mallet / 暖pad=pad)', () => {
    expect(instrumentInfo(24).family).toBe('guitar');
    expect(instrumentInfo(26).family).toBe('guitar');
    expect(instrumentInfo(16).family).toBe('keyboard'); // 管风琴可 voice 和弦色彩
    expect(instrumentInfo(42).family).toBe('strings');
    expect(instrumentInfo(108).family).toBe('mallet');
    expect(instrumentInfo(107).family).toBe('mallet');
    expect(instrumentInfo(88).family).toBe('pad');
    expect(instrumentInfo(94).family).toBe('pad');
  });

  it('调色板确实变宽:用到的 GM program 数 ≥ 22(暖扩生效)', () => {
    const used = new Set<number>();
    for (const s of getInstrumentCatalog()) for (const r of s.roles) for (const p of r.programs) used.add(p);
    expect(used.size).toBeGreaterThanOrEqual(22);
    for (const p of WARM_POOLED) expect(used.has(p), `${p} 应进某 style 池`).toBe(true);
  });

  it('不加铜管/萨克斯/合成 lead(守"不刺耳")', () => {
    const used = new Set<number>();
    for (const s of getInstrumentCatalog()) for (const r of s.roles) for (const p of r.programs) used.add(p);
    for (const harsh of [56, 57, 60, 61, 64, 65, 66, 67, 80, 81, 82]) expect(used.has(harsh), `${harsh} 不应入池`).toBe(false);
  });
});

describe('leadCompCompatible — 配对判据', () => {
  it('同族相配(电钢 lead + 电钢 comp / 木琴+木琴 / 吉他+吉他)', () => {
    expect(leadCompCompatible(4, 5)).toBe(true);   // Rhodes + FM-EP(keyboard)
    expect(leadCompCompatible(11, 12)).toBe(true); // 颤音+马林巴(mallet)
    expect(leadCompCompatible(24, 26)).toBe(true); // 尼龙+爵士(guitar)
  });
  it('原声钢琴 comp = 百搭(马林巴/吉他 lead 在其上 OK)', () => {
    expect(leadCompCompatible(12, 0)).toBe(true);  // 马林巴 + 大钢琴
    expect(leadCompCompatible(24, 1)).toBe(true);  // 吉他 + 亮钢琴
  });
  it('同音色来源相配(都 acoustic:马林巴+尼龙吉他)', () => {
    expect(leadCompCompatible(12, 24)).toBe(true); // 木琴(acoustic) + 尼龙(acoustic)
  });
  it('★ 跨族跨源不搭:马林巴(acoustic) lead + 电钢(electric) comp', () => {
    expect(leadCompCompatible(12, 4)).toBe(false); // 用户抱怨的"死绑"组合
    expect(leadCompCompatible(12, 5)).toBe(false);
  });
});

describe('coherentLeadComp — 器配层修不搭对', () => {
  it('★ 电钢 comp 配电钢 lead:lofi 马林巴 lead + Rhodes comp → Rhodes lead + Rhodes comp', () => {
    const out = coherentLeadComp({ lead: 12, comp: 4, bass: 33, pad: 89, drum: 0 }, 'lofi');
    expect(out.lead).toBe(4);  // 改成 Rhodes(池里有 4)→ 电钢配电钢
    expect(out.comp).toBe(4);  // comp 不动
    expect(leadCompCompatible(out.lead, out.comp)).toBe(true);
  });
  it('★ 马林巴 + 尼龙吉他(同 acoustic)→ 保留(本就搭,不乱改)', () => {
    const rp = { lead: 12, comp: 24, bass: 33, pad: 89, drum: 0 };
    expect(coherentLeadComp(rp, 'lofi')).toBe(rp); // 同对象返回(已和谐)
  });
  it('已和谐对(电钢 lead + 电钢 comp)→ 原样', () => {
    const rp = { lead: 4, comp: 5, bass: 33, pad: 89, drum: 0 };
    expect(coherentLeadComp(rp, 'rnb')).toBe(rp);
  });
  it('modal 马林巴 lead + Rhodes comp → 修成相配(键盘 lead 或保马林巴换暖 comp)', () => {
    const out = coherentLeadComp({ lead: 12, comp: 4, bass: 32, pad: 89, drum: 0 }, 'modal');
    expect(leadCompCompatible(out.lead, out.comp), `${out.lead}+${out.comp}`).toBe(true);
  });
  it('缺 lead 或 comp → 原样(fail-open)', () => {
    const rp = { lead: 4, bass: 33, pad: 89, drum: 0 } as never;
    expect(coherentLeadComp(rp, 'pop')).toBe(rp);
  });
  it('确定性:同输入两次同结果', () => {
    const a = coherentLeadComp({ lead: 12, comp: 4, bass: 33, pad: 89, drum: 0 }, 'lofi');
    const b = coherentLeadComp({ lead: 12, comp: 4, bass: 33, pad: 89, drum: 0 }, 'lofi');
    expect(a).toEqual(b);
  });
});

describe('风格世界守卫无回归(暖扩后)', () => {
  it('新增乐器不触发 worldMismatch(jazz/lofi 池仍守住)', () => {
    expect(worldMismatches({ comp: 16, bass: 32, pad: 49 }, 'jazz')).toEqual([]); // 哈蒙德 comp OK
    expect(worldMismatches({ comp: 24, bass: 33, pad: 89 }, 'lofi')).toEqual([]); // 尼龙 comp OK
    expect(classifyTimbreWorld({ comp: 16, bass: 32 }, 'jazz')).toBe('jazzCombo');
  });
});
