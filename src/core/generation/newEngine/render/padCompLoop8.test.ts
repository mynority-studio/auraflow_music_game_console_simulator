// ============================================================
// newEngine · render · Loop 8 验收 — pad/comp 分工保护(端到端,跨 legacy 织体)
// ------------------------------------------------------------
// musicgenerative_strict_newengine_migration_directive.md Loop 8。
// padComp 机制的单元正确性已由 padCompInteraction.test / padModes.test / padRenderer.test 在
//   golden fixture 上锁;★ 本测试补【端到端 × seeds × styles】—— Loop 6/7 把 legacy 织体加进 comp
//   选择池后,验证 pad/comp 分工(no-mud / comp 不空轨 / 无下拍空洞 / pad-only 有托底)仍成立。
// 验收(directive §Loop8):
//   ① pad+comp 同时 active 不出现【同音长铺】(同绝对音高 + 同起拍 + 同时值 = unison flam/mud)。
//   ② comp-only 段不因 delayed texture 造成下拍空洞(structural-comp-anchor-late 不触发)。
//   ③ pad-only 段必须有可听和声托底(outro-harmonic-support-missing 不触发 + 整曲和声非空)。
//   终止:pad/comp 不互相糊 · comp 不因 pad-aware 避让变成空轨。
// ============================================================

import { describe, it, expect } from 'vitest';
import { traceGeneration } from '../generation/trace';

const SEEDS = [633823, 64062, 7, 42, 100, 999];
const STYLES = ['pop', 'rnb', 'lofi', 'jazz']; // pop/rnb/lofi pad active;jazz pad silent(comp-only 验证)

type Note = { startTick: number; durationTicks: number; pitch: number };
const notesOf = (t: ReturnType<typeof traceGeneration>, role: string): Note[] =>
  (t.ir.tracks.find((x) => x.role === role)?.notes ?? []).map((n) => ({
    startTick: n.startTick as number, durationTicks: n.durationTicks as number, pitch: n.pitch as number,
  }));

describe('Loop 8 — pad/comp 分工(端到端 × legacy 织体)', () => {
  for (const seed of SEEDS) for (const style of STYLES) {
    it(`${seed}/${style}: no-mud · comp 不空 · 无下拍空洞 · 有和声托底`, () => {
      const t = traceGeneration({ seed, styleHint: style, mood: 'build', targetDuration: 120 } as never);
      const fids = t.audit.findings.map((f) => f.ruleId);
      const comp = notesOf(t, 'comp');
      const pad = notesOf(t, 'pad');

      // —— A4:生成不 failed ——
      expect(t.status, `${seed}/${style} status`).not.toBe('failed');

      // —— ① 同音长铺 = 0:comp/pad 无【同起拍 + 同绝对音高 + 同时值】对(unison flam/mud)。
      //   设计允许 comp 叠在【持续 pad】上加厚(pad 起拍更早、时值更长 → 不同 startTick/dur),
      //   只禁【逐和弦 pad 重新起音】与 comp 同拍同音同长(=padAvoid 应已消除)。
      const padKey = new Set(pad.map((p) => `${p.startTick}:${p.pitch}:${p.durationTicks}`));
      const mud = comp.filter((c) => padKey.has(`${c.startTick}:${c.pitch}:${c.durationTicks}`));
      expect(mud.length, `${seed}/${style} 同音长铺 ${mud.length} 对`).toBe(0);

      // —— 终止:comp 不因 pad-aware 避让变成空轨(comp 在 lineup 时必非空)。
      if (t.ir.tracks.some((x) => x.role === 'comp')) {
        expect(comp.length, `${seed}/${style} comp 空轨`).toBeGreaterThan(0);
      }

      // —— ② comp-only 段无下拍空洞(needsDownbeatCompAnchor 段下拍有 comp anchor)。
      expect(fids, `${seed}/${style} structural-comp-anchor-late`).not.toContain('structural-comp-anchor-late');

      // —— ③ pad-only 段有可听和声托底(收尾段 comp/pad 托底;整曲和声非空)。
      expect(fids, `${seed}/${style} outro-harmonic-support-missing`).not.toContain('outro-harmonic-support-missing');
      expect(comp.length + pad.length, `${seed}/${style} 整曲无和声层`).toBeGreaterThan(0);
    });
  }

  it('legacy 织体确实被选中(回归:Loop 6/7 生效,本测试有意义)', () => {
    // 633823/pop 在 Loop 6/7 里选中 Pop_Half_Arp_Sweep / Pop_Ballad_158_Sweep(legacy)。
    const t = traceGeneration({ seed: 633823, styleHint: 'pop', mood: 'build', targetDuration: 120 } as never);
    const richLine = t.lines.find((l) => /rich 织体/.test(l)) ?? '';
    expect(/Pop_(Half_Arp_Sweep|Ballad_158_Sweep|Anthem_Pulse|Wave_16ths|Alberti|Broken|Piano_Arp)|Block_Chord|Arpeggio_Flow/.test(richLine), richLine).toBe(true);
  });
});
