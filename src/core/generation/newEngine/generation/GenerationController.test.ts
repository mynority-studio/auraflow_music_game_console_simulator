import { describe, it, expect } from 'vitest';
import { generateSong, runGenerationControl, type RenderFn } from './GenerationController';
import { nextRetryContext } from './RetryPolicy';
import { freezeMusicalIR } from '../ir/MusicalIR';
import type { AuditReport } from '../ir/AuditReport';
import { createRandomContext, createTimebase, ticks } from '../foundation';

const timebase = createTimebase({ meter: { numerator: 4, denominator: 4 } });
const fakeIR = freezeMusicalIR({ tracks: [], timebase, durationTicks: ticks(0) });
const PASS: AuditReport = { findings: [] };
const ERROR: AuditReport = {
  findings: [{ severity: 'error', location: { trackRole: 'lead', startTick: 0 }, ruleId: 'x', reason: 'r', suggestedReturnPoint: 'rewind-melody' }],
};
const WARN: AuditReport = {
  findings: [{ severity: 'warning', location: { trackRole: 'comp', startTick: 0 }, ruleId: 'w', reason: 'r', suggestedReturnPoint: 'rewind-resolver' }],
};

describe('generation/RetryPolicy · nextRetryContext', () => {
  it('每次推进对应 stage 子流(rng 变化)', () => {
    const seed = createRandomContext(1);
    const a = nextRetryContext(undefined, ERROR, seed);
    const b = nextRetryContext(a, ERROR, seed);
    expect(a.rng.substream('melody').next()).not.toBe(b.rng.substream('melody').next());
    expect(a.returnPoint).toBe('rewind-melody');
  });
});

describe('generation/GenerationController · runGenerationControl', () => {
  const rng = createRandomContext(1);

  it('立即通过 → pass,1 次', () => {
    const r = runGenerationControl(() => ({ ir: fakeIR, audit: PASS }), rng);
    expect(r.status).toBe('pass');
    expect(r.attempts).toBe(1);
  });

  it('失败两次后通过 → pass,3 次', () => {
    let calls = 0;
    const render: RenderFn = () => { calls += 1; return { ir: fakeIR, audit: calls < 3 ? ERROR : PASS }; };
    const r = runGenerationControl(render, rng);
    expect(r.status).toBe('pass');
    expect(r.attempts).toBe(3);
  });

  it('始终失败 → failed,用尽 wholeSong 预算', () => {
    const r = runGenerationControl(() => ({ ir: fakeIR, audit: ERROR }), rng, { perBinding: 2, perPhrase: 3, wholeSong: 3 });
    expect(r.status).toBe('failed');
    expect(r.attempts).toBe(3);
    expect(r.ir).toBeUndefined(); // 绝不静默输出非法结果
  });

  it('仅 warning → 带 warning 通过,不重跑', () => {
    const r = runGenerationControl(() => ({ ir: fakeIR, audit: WARN }), rng);
    expect(r.status).toBe('warning');
    expect(r.attempts).toBe(1);
    expect(r.ir).toBeDefined();
  });
});

describe('generation/generateSong (顶层 Request→FinalIR 端到端)', () => {
  it('真实管线 → 非 failed,产出可变编制(含 lead,2–5 轨,渲染顺序规范)', () => {
    const r = generateSong({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    expect(r.status).not.toBe('failed');
    const roles = r.ir!.tracks.map((t) => t.role);
    expect(roles).toContain('lead');
    expect(roles.length).toBeGreaterThanOrEqual(2);
    expect(roles.length).toBeLessThanOrEqual(5);
    // 仅出 lineup 内的轨,且按渲染顺序(bass,comp,pad,drum,lead)
    const order = ['bass', 'comp', 'pad', 'drum', 'lead'];
    expect(roles).toEqual(order.filter((o) => (roles as string[]).includes(o)));
    // 每轨挂了乐器 program
    for (const t of r.ir!.tracks) expect(typeof t.program).toBe('number');
  });

  it('确定性:同 request → 同 lead 音高', () => {
    const a = generateSong({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    const b = generateSong({ seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 120 });
    const lead = (r: typeof a) => r.ir!.tracks.find((t) => t.role === 'lead')!.notes.map((n) => n.pitch);
    expect(lead(a)).toEqual(lead(b));
  });

  it('★ seed 真生效:不同 seed → 不同 lead 旋律', () => {
    const lead = (seed: number) =>
      generateSong({ seed, styleHint: 'pop', mood: 'build', targetDuration: 120 })
        .ir!.tracks.find((t) => t.role === 'lead')!.notes.map((n) => n.pitch);
    expect(lead(7)).not.toEqual(lead(8));
    expect(lead(7)).not.toEqual(lead(123));
  });
});
