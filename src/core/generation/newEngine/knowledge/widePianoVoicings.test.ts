// ============================================================
// newEngine · knowledge · WidePianoVoicings 测试
// ------------------------------------------------------------
// 锁 port 的分层铁律:外声部结构音 / 内声部紧凑色彩 cluster / 9≠2 不折回(声学摩擦)/
// 总 span ≤ 18 度 / 低区无 m2 / prev 共同音保留。
// ============================================================

import { describe, expect, it } from 'vitest';
import { buildWidePianoVoicing, isPianoProgram, pickSpreadMode, type SpreadPicker, type WidePianoOptions } from './widePianoVoicings';

// 确定性 picker:next 恒返回 fixed,pick 取第一个(tie 时可预测)
const picker = (fixed = 0.99): SpreadPicker => ({ next: () => fixed, pick: (xs) => xs[0] });

const opts = (over: Partial<WidePianoOptions> = {}): WidePianoOptions => ({
  includeRootInComp: true,
  colorLevel: 2,
  style: 'pop',
  spreadMode: 'wide',
  ...over,
});

describe('isPianoProgram', () => {
  it('钢琴家族 GM 0/1/2 → true,其它 → false', () => {
    expect(isPianoProgram(0)).toBe(true);
    expect(isPianoProgram(1)).toBe(true);
    expect(isPianoProgram(2)).toBe(true);
    expect(isPianoProgram(4)).toBe(false); // Rhodes
    expect(isPianoProgram(5)).toBe(false); // FM-EP
    expect(isPianoProgram(undefined)).toBe(false);
  });
});

describe('buildWidePianoVoicing — 分层铁律', () => {
  // C maj9:root=0 third=4 fifth=7 seventh=11 ninth=2
  const v = buildWidePianoVoicing({ rootPc: 0, chordType: 'maj9', bassMidi: 36, options: opts() });

  it('结构音齐全:root / 3 / 5 / 7 都在', () => {
    const roles = new Set(v.notes.map((n) => n.role));
    expect(roles.has('root')).toBe(true);
    expect(roles.has('third')).toBe(true);
    expect(roles.has('fifth')).toBe(true);
    expect(roles.has('seventh')).toBe(true);
  });

  it('色彩 9 进上层 = compound 高位,绝不折回 root 旁的 2(声学摩擦)', () => {
    const ninth = v.notes.find((n) => n.role === 'ninth');
    expect(ninth).toBeDefined();
    // 9 必须是真高位(inner_high 区 ~68-72),pc=2
    expect(ninth!.pc).toBe(2);
    expect(ninth!.midi).toBeGreaterThanOrEqual(62);
    // root 旁(同 ±2 半音)绝不能出现 pc=2 的低音(=折成 2 音的摩擦)
    const root = v.notes.find((n) => n.role === 'root')!;
    const frictionNear = v.notes.some((n) => n.pc === 2 && Math.abs(n.midi - root.midi) <= 2);
    expect(frictionNear).toBe(false);
  });

  it('总 span ≤ 29 半音(18 度)', () => {
    const midis = v.notes.map((n) => n.midi);
    expect(Math.max(...midis) - Math.min(...midis)).toBeLessThanOrEqual(29);
  });

  it('notes 升序(sanitize/compress 后允许偶发同 midi 重叠 = 源忠实行为)', () => {
    const midis = v.notes.map((n) => n.midi);
    for (let i = 1; i < midis.length; i++) expect(midis[i]).toBeGreaterThanOrEqual(midis[i - 1]);
  });

  it('低区(<E4=64)无相邻小二度(防浑浊)', () => {
    const sorted = v.notes.slice().sort((a, b) => a.midi - b.midi);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].midi < 64) expect(sorted[i].midi - sorted[i - 1].midi).not.toBe(1);
    }
  });

  it('innerLanes 只含 inner_* lane', () => {
    for (const n of v.innerLanes) expect(['inner_low', 'inner_mid', 'inner_high']).toContain(n.lane);
  });
});

describe('buildWidePianoVoicing — spreadMode 行为', () => {
  it('close 模式不放 low_outer 结构外声部(从 inner 起)', () => {
    const v = buildWidePianoVoicing({ rootPc: 0, chordType: 'maj7', bassMidi: 36, options: opts({ spreadMode: 'close' }) });
    expect(v.notes.some((n) => n.lane === 'low_outer')).toBe(false);
  });

  it('wide 模式给 upper_outer air voice', () => {
    const v = buildWidePianoVoicing({ rootPc: 0, chordType: 'maj9', bassMidi: 36, options: opts({ spreadMode: 'wide' }) });
    expect(v.notes.some((n) => n.lane === 'upper_outer')).toBe(true);
  });

  it('jazz 风(includeRootInComp=false)不在 comp 里放 root 外声部', () => {
    const v = buildWidePianoVoicing({ rootPc: 0, chordType: 'min9', bassMidi: 36, options: opts({ includeRootInComp: false }) });
    expect(v.notes.some((n) => n.role === 'root' && n.lane === 'low_outer')).toBe(false);
  });
});

describe('buildWidePianoVoicing — rolePcs 整合接缝', () => {
  it('给 rolePcs(窄三和弦真实音)→ 不幻觉七音(纯三和弦 root/3/5 铺开)', () => {
    // 'maj' 走 getChordRolePcs 会被 startsWith("maj") 误加七音;用 rolePcs override 喂真实三和弦音
    const triad = { root: 0, third: 4, fifth: 7 }; // C 大三
    const v = buildWidePianoVoicing({ rootPc: 0, chordType: 'maj', bassMidi: 36, options: opts({ colorLevel: 0 }), rolePcs: triad });
    const pcs = new Set(v.notes.map((n) => n.pc));
    expect(pcs.has(11)).toBe(false); // 绝不出现 maj7 的导音(pc 11)
    expect(pcs.has(0)).toBe(true);
    expect(pcs.has(4)).toBe(true);
    expect(pcs.has(7)).toBe(true);
    // 只含三和弦三个 pc,无第四种音级
    for (const p of pcs) expect([0, 4, 7]).toContain(p);
  });

  it('rolePcs 含 seventh → 七音进 inner_mid(宽铺开但不加 9/13)', () => {
    const v = buildWidePianoVoicing({ rootPc: 0, chordType: '7', bassMidi: 36, options: opts({ colorLevel: 0 }), rolePcs: { root: 0, third: 4, fifth: 7, seventh: 10 } });
    const pcs = new Set(v.notes.map((n) => n.pc));
    expect(pcs.has(10)).toBe(true);             // b7 在
    expect(pcs.has(2)).toBe(false);             // 不加 9
    for (const p of pcs) expect([0, 4, 7, 10]).toContain(p);
  });
});

describe('pickSpreadMode — 段落/功能驱动的 spread 选择', () => {
  it('硬规则:末和弦 / 乐句尾 → close', () => {
    expect(pickSpreadMode({ func: 'D', cellRole: 'lift', sectionFunction: 'CHORUS', isPhraseEnd: false, isLast: true, random: picker() })).toBe('close');
    expect(pickSpreadMode({ func: 'D', cellRole: 'lift', sectionFunction: 'CHORUS', isPhraseEnd: true, isLast: false, random: picker() })).toBe('close');
  });

  it('INTRO/OUTRO:random<0.7→close,否则 half_wide', () => {
    expect(pickSpreadMode({ func: 'T', cellRole: 'establish', sectionFunction: 'INTRO', isPhraseEnd: false, isLast: false, random: picker(0.3) })).toBe('close');
    expect(pickSpreadMode({ func: 'T', cellRole: 'establish', sectionFunction: 'OUTRO', isPhraseEnd: false, isLast: false, random: picker(0.9) })).toBe('half_wide');
  });

  it('CHORUS + lift + D → wide(开)', () => {
    expect(pickSpreadMode({ func: 'D', cellRole: 'lift', sectionFunction: 'CHORUS', isPhraseEnd: false, isLast: false, random: picker() })).toBe('wide');
  });

  it('BRIDGE + D + establish → drop2_wide 占优(drop2 5 > wide 3 > half 3)', () => {
    expect(pickSpreadMode({ func: 'D', cellRole: 'establish', sectionFunction: 'BRIDGE', isPhraseEnd: false, isLast: false, random: picker() })).toBe('drop2_wide');
  });

  it('VERSE establish T → half_wide 基线(中庸)', () => {
    expect(pickSpreadMode({ func: 'T', cellRole: 'establish', sectionFunction: 'VERSE', isPhraseEnd: false, isLast: false, random: picker() })).toBe('half_wide');
  });

  it('PRECHORUS 被处理(wide/drop2 偏置),返回合法 mode', () => {
    const m = pickSpreadMode({ func: 'D', cellRole: 'lift', sectionFunction: 'PRECHORUS', isPhraseEnd: false, isLast: false, random: picker() });
    expect(['close', 'half_wide', 'wide', 'drop2_wide']).toContain(m);
    expect(m).toBe('wide'); // lift(wide+3,drop2+1)+D(wide+2,drop2+2)+PRECHORUS(wide+1,drop2+1)=wide6 > drop2 4
  });
});

describe('buildWidePianoVoicing — prev 声部进行', () => {
  it('给 prev → 共同音 midi 保留(最小动量)', () => {
    const c = buildWidePianoVoicing({ rootPc: 0, chordType: 'maj9', bassMidi: 36, options: opts() });
    // 同和弦重复:传 prev 后各 voice 应贴回原 midi(共同音全保留)
    const c2 = buildWidePianoVoicing({ rootPc: 0, chordType: 'maj9', bassMidi: 36, options: opts(), prev: c });
    const set1 = new Set(c.notes.map((n) => n.midi));
    const overlap = c2.notes.filter((n) => set1.has(n.midi)).length;
    expect(overlap).toBeGreaterThanOrEqual(Math.floor(c.notes.length * 0.6));
  });
});
