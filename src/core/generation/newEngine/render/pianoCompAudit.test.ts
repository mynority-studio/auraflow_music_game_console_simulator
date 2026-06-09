// ============================================================
// newEngine · render · 钢琴 comp 宽排列 —— 只读 Auditor 验证「不新增 error」
// ------------------------------------------------------------
// 用户门控:伴奏乐器=钢琴时切宽排列,先验证端到端 Auditor 不冒出无法收敛的 error。
// 跑 seeds × {jazz,pop,modal}(comp 含钢琴 GM 0/1/2)端到端 generateSong:
//   - status 不为 'failed'(error 都能收敛 / 根本不产生)
//   - 终检 report 无 error severity
//   - 至少真的命中过钢琴 comp 路径(否则等于没测)
// ============================================================

import { describe, expect, it } from 'vitest';
import { generateSong } from '../generation/GenerationController';
import { buildBandSpec, type GenerationRequest } from '../band/bandEngine';
import { isPianoProgram } from '../knowledge/widePianoVoicings';

describe('钢琴 comp 宽排列 · 只读 Auditor 不新增 error', () => {
  it('seeds × {jazz,pop,modal} 端到端:无 failed、无 error,且确实走过钢琴路径', () => {
    const styles = ['jazz', 'pop', 'modal'];
    let pianoComp = 0;
    let nonPianoComp = 0;
    const failures: string[] = [];

    for (const styleHint of styles) {
      for (let seed = 1; seed <= 24; seed++) {
        const req: GenerationRequest = { seed, styleHint, mood: 'build', targetDuration: 120 };
        const band = buildBandSpec(req);
        const compInLineup = band.instrumentPool.includes('comp');
        const isPiano = compInLineup && isPianoProgram(band.roleProgram.comp);
        if (isPiano) pianoComp++; else if (compInLineup) nonPianoComp++;

        const res = generateSong(req);
        if (res.status === 'failed') failures.push(`${styleHint}#${seed}: failed`);
        const errs = res.report.findings.filter((f) => f.severity === 'error');
        if (errs.length > 0) failures.push(`${styleHint}#${seed}: ${errs.length} error (${errs.map((e) => e.ruleId).join(',')})`);
      }
    }

    expect(failures).toEqual([]);
    expect(pianoComp).toBeGreaterThan(0);   // 真的演练过钢琴宽排列
    expect(nonPianoComp).toBeGreaterThan(0); // 也演练过通用排列(Rhodes/EP)
  }, 15000); // 多 seed×风格端到端:并行负载下放宽超时(单跑 ~4s)

  it('同 seed 钢琴 comp 可复现(确定性)', () => {
    const req: GenerationRequest = { seed: 5, styleHint: 'pop', mood: 'build', targetDuration: 120 };
    const a = generateSong(req);
    const b = generateSong(req);
    const comp = (r: typeof a) => r.ir.tracks.find((t) => t.role === 'comp')?.notes.map((n) => `${n.pitch}@${n.startTick}`).join('|');
    expect(comp(a)).toBe(comp(b));
  });
});
