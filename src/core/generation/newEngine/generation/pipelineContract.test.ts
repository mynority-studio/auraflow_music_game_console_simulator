import { describe, it, expect } from 'vitest';
import { generateSong } from './GenerationController';
import { pc } from '../foundation';

// ============================================================
// CODEX directive §4.1 No Pipeline Change Guard(Loop H 接入后):
//   - generateSong 仍产出 IR、status ∈ pass/warning/failed。
//   - warning(含 Loop H 音乐性 warning)不触发 retry(attempts 不因 warning 增加)。
//   - golden seeds 端到端不 failed。
// ============================================================

describe('pipeline contract · warning 不重跑', () => {
  it('只含 warning 的歌:status=warning/pass 且 attempts=1(不重跑)', () => {
    // 633823/lofi 实测产出 chromatic-exposure 等 warning(非 error)→ 应带警告通过、不重跑。
    const r = generateSong({ seed: 633823, styleHint: 'lofi', mood: 'build', targetDuration: 120, key: pc(0) });
    expect(r.status).not.toBe('failed');
    if (r.status === 'warning') expect(r.attempts).toBe(1); // warning 不触发收敛重跑
  });

  it('golden seeds 端到端不 failed,且产出 IR', () => {
    const golden: [number, string][] = [[3, 'pop'], [3, 'rnb'], [3, 'lofi'], [3, 'jazz'], [7, 'pop'], [42, 'pop'], [77, 'jazz'], [64062, 'pop'], [633823, 'pop'], [633823, 'lofi'], [361134, 'pop']];
    for (const [seed, styleHint] of golden) {
      const r = generateSong({ seed, styleHint, mood: 'build', targetDuration: 120, key: pc(0) });
      expect(r.status, `${seed}/${styleHint}`).not.toBe('failed');
      expect(r.ir, `${seed}/${styleHint}`).toBeTruthy();
    }
  });

  it('status 取值集合受控(pass/warning/failed)', () => {
    const r = generateSong({ seed: 3, styleHint: 'pop', mood: 'build', targetDuration: 120, key: pc(0) });
    expect(['pass', 'warning', 'failed']).toContain(r.status);
  });
});
