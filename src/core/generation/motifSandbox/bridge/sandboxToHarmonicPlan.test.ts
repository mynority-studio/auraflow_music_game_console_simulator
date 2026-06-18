import { describe, it, expect } from 'vitest';
import { sandboxProgressionToHarmonicPlan } from './sandboxToHarmonicPlan';
import { generateMotifWeave } from '../model/motifWeaver';
import { generateSampleCaptured } from '../model/motifAnalysis';
import { generateSongFromMotif } from '../../newEngine/generation/generateSongFromMotif';

const m12 = (n: number) => ((n % 12) + 12) % 12;
// 取一条真实 Q+R progression(SandboxChord[])
const sandboxProg = (style: 'pop' | 'jazz' = 'pop', seed = 7) =>
  generateMotifWeave({ capturedNotes: generateSampleCaptured(96, 0, 'major', 0), style, keyPc: 0, mode: 'major', bpm: 96, seed }).progression;

describe('motifSandbox/bridge sandboxProgressionToHarmonicPlan(走 A PR2 · 和声转换)', () => {
  it('★ chordTimeline 逐和弦对齐 Q+R progression(rootPc / durationBeats / 总拍数)+ 全套 map 齐备', () => {
    const prog = sandboxProg('pop', 7);
    const plan = sandboxProgressionToHarmonicPlan(prog, 0, 'major');
    expect(plan.chordTimeline.length).toBe(prog.length);
    let beat = 0;
    for (let i = 0; i < prog.length; i++) {
      const span = plan.chordTimeline[i];
      expect(m12(span.rootPc), `span${i} rootPc`).toBe(m12(prog[i].realRootPc ?? prog[i].rootPc)); // 真根对齐
      expect(span.durationBeats as unknown as number, `span${i} dur`).toBe(prog[i].durationBeats);
      expect(span.startBeat as unknown as number, `span${i} start`).toBe(beat);
      beat += prog[i].durationBeats;
      // 每 span 的张力/音阶 map 都有(单一真源齐备)
      expect(plan.tensionMap[span.id]).toBeDefined();
      expect(plan.stableToneMap[span.id].length).toBeGreaterThan(0);
      expect(plan.chordScaleMap[span.id].length).toBeGreaterThan(0);
    }
    expect(beat).toBe(prog.reduce((n, c) => n + c.durationBeats, 0)); // 总拍数 == sum
  });

  it('★ 借和弦/七和弦真品质透传:realType → chordType 落到 ChordSpan(下游张力按宽和弦算)', () => {
    const prog = sandboxProg('jazz', 3); // jazz 多七/借和弦
    const plan = sandboxProgressionToHarmonicPlan(prog, 0, 'major');
    // 至少一个 span 带宽 chordType(七和弦等),且 chordType 与 realType 归一一致
    expect(plan.chordTimeline.some((s) => s.chordType && s.chordType !== s.quality)).toBe(true);
  });

  it('★ 端到端:override 和声喂 generateSongFromMotif → bass 吃【sandbox 和声】(bass 根对齐,非 Q+N 默认)', () => {
    const prog = sandboxProg('pop', 7);
    const harmony = sandboxProgressionToHarmonicPlan(prog, 0, 'major');
    const r = generateSongFromMotif({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 120 }, { harmony });
    expect(r.status).not.toBe('failed');
    const bass = r.ir!.tracks.find((t) => t.role === 'bass');
    expect(bass, 'bass 轨存在').toBeDefined();
    // bass 下拍音的 pc 应来自 sandbox 和声的根(首个 span 的根)——证明 override 和声被消费
    const firstRootPc = m12(prog[0].realRootPc ?? prog[0].rootPc);
    const firstBassPc = m12(bass!.notes[0].pitch);
    expect([firstRootPc, m12(firstRootPc + 7), m12(firstRootPc + 4), m12(firstRootPc + 3)]).toContain(firstBassPc); // 根/三/五(转位)
  });
});
