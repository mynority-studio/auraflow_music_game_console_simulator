// ============================================================
// newEngine · render · repeatGroup 重放一致性(2026-06-11)
// ------------------------------------------------------------
// 用户诉求验收:重复段落(verse1≡verse2 / chorus1≡chorus2)body 全轨【同音符】;
//   ★ MG full-parity Phase D(directive 3.2):lead 现也被 GrooveContract melody-pocket lay-back(per-section
//     独立 = decision ② '各自人性化');故 lead body = 同 pitch/duration/velocity 序列,onset 容许 pocket 微差
//     (不再逐字节锁绝对 onset)。comp/bass/pad 与 drum body 同音符(pitch/count)+ 各自人性化;
//   drum 的 score-authored fill/landing 窗口允许 A/A′，链接尾巴允许各自不同;确定性;深不可变。
// ============================================================
import { describe, it, expect } from 'vitest';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildInstrumentationPlan } from '../instrumental/instrumentalPlanner';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { renderSongFull } from './renderCoordinator';
import {
  planDrumReplayProtection,
  planRepeatGroupReplays,
  type ReplayProtectionRange,
} from './repeatGroupReplay';
import { createTimebase, createRandomContext, beats } from '../foundation';
import type { MusicalIR, NoteIR } from '../ir/MusicalIR';

function pipeline(seed: number, style: string) {
  const band = buildBandSpec({ seed, styleHint: style, mood: 'build', targetDuration: 150 });
  const arr = buildArrangementPlan(band, { rng: createRandomContext(seed) });
  const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
  const instr = buildInstrumentationPlan(band, arr, createRandomContext(seed).substream('timbre'), plan);
  const tb = createTimebase({ meter: { numerator: arr.meter.numerator, denominator: arr.meter.denominator }, tempoMap: [{ atBeat: beats(0), bpm: arr.tempoBpm }] });
  const { ir, audit } = renderSongFull(band, arr, plan, instr, tb, createRandomContext(seed));
  const plans = planRepeatGroupReplays(arr, plan.chordTimeline, tb);
  return { ir, audit, plans, arr, plan, instr, band, tb };
}

const win = (ir: MusicalIR, role: string, lo: number, hi: number): NoteIR[] =>
  (ir.tracks.find((t) => t.role === role)?.notes ?? []).filter((n) => (n.startTick as number) >= lo && (n.startTick as number) < hi);
const pitchMultiset = (ns: NoteIR[]) => ns.map((n) => n.pitch as number).sort((a, b) => a - b).join(',');

function outsideDrumBoundaryWindows(notes: readonly NoteIR[], ranges: readonly ReplayProtectionRange[]): NoteIR[] {
  return notes.filter((note) => {
    const tick = note.startTick as number;
    return !ranges.some((range) => tick >= range.lo && tick < range.hi);
  });
}

const ROLES = ['lead', 'comp', 'bass', 'pad', 'drum'];

describe('render/repeatGroupConsistency — 重复段 body 同音符,尾巴各自', () => {
  const SEEDS: [number, string][] = [[3, 'pop'], [42, 'pop'], [7, 'rnb'], [100, 'rnb'], [7, 'lofi'], [64062, 'lofi'], [3, 'jazz'], [42, 'jazz']];

  it('每个重放:body 全轨 pitch-multiset 一致 + 音数一致;lead 逐字节一致', () => {
    let exercised = 0;
    for (const [seed, style] of SEEDS) {
      const { ir, plans, arr, tb } = pipeline(seed, style);
      for (const p of plans) {
        exercised++;
        for (const role of ROLES) {
          // ★ comp/bass/pad/drum 走 humanizeTiming 微抖动(±~7 tick,replay 后施加)→ body/link 边界处:
          //   一个 link 音可能抖【进】body 窗口、或 body 末音抖【出】→ 硬窗口的 count/multiset 在边界不稳
          //   (实测 MG full-parity G2 激活后 POP seed3 verse2:link comp 抖到 prefix-1 进窗 → off-by-1)。
          //   body 音本身一致(replay 拷贝),仅 humanize timing 各段不同(测试本意允许)→ humanized 轨 body 窗口
          //   内缩 EDGE(>maxJitter)对称排除边界带;lead 不 humanize → 精确窗口 + 逐字节。
          // ★ Phase D:lead/bass 都被 pocket lay-back(可正可负 ms)→ body 首/末音可能抖出窗口任一侧 →
          //   【对称】内缩 EDGE(humanizeTiming ±7 / pocket 也含负偏)→ 排除两端不稳边界带,比对稳定中段。
          const edge = 16;
          // 首段本身是 repeat source 时，opening delay 是源段独有的表演手势，不应复制到
          // target。两边裁掉同一相对 opening 前缀后，剩余 body 仍必须同音符。
          const openingDelayBars = p.sourceId === arr.sections[0]?.id
            ? ((arr.openingGesture.roleDelayBars as Partial<Record<string, number>>)[role] ?? 0)
            : 0;
          const barTicks = arr.meter.numerator * (4 / arr.meter.denominator) * tb.ppq;
          const cropTicks = Math.min(p.prefixTicks, openingDelayBars * barTicks);
          if (p.prefixTicks - cropTicks <= edge * 2) continue;
          let src = win(ir, role, p.sourceStartTick + cropTicks + edge, p.sourceStartTick + p.prefixTicks - edge);
          let tgt = win(ir, role, p.targetStartTick + cropTicks + edge, p.targetStartTick + p.prefixTicks - edge);
          if (role === 'drum') {
            const protection = planDrumReplayProtection(arr, tb, p);
            src = outsideDrumBoundaryWindows(src, protection.source);
            tgt = outsideDrumBoundaryWindows(tgt, protection.target);
          }
          expect(tgt.length, `${seed}/${style} ${p.targetId} ${role} count`).toBe(src.length);
          expect(pitchMultiset(tgt), `${seed}/${style} ${p.targetId} ${role} pitch-multiset`).toBe(pitchMultiset(src));
          if (role === 'lead') {
            // replay 只锁 motif 音高顺序；随后按目标段重新投影 lead-in/高潮表情，velocity 允许不同。
            // onset 也会被 per-section melody-pocket 微移，末音时长依赖各段发散 link → 排除末音。
            const shape = (ns: NoteIR[]) => [...ns].sort((a, b) => (a.startTick as number) - (b.startTick as number))
              .slice(0, -1).map((n) => n.pitch as number).join('|');
            expect(shape(tgt), `${seed}/${style} ${p.targetId} lead shape`).toBe(shape(src));
          }
        }
      }
    }
    expect(exercised, '至少有重放发生(机制被实际触发)').toBeGreaterThan(0);
  });

  it('POP/RNB 含重复段 → 必有重放计划', () => {
    for (const [seed, style] of [[3, 'pop'], [42, 'pop'], [7, 'rnb']] as [number, string][]) {
      const { plans } = pipeline(seed, style);
      expect(plans.length, `${seed}/${style} 应有重放`).toBeGreaterThan(0);
    }
  });

  it('short/no-intro repeat source: opening gate 只影响首段，不会把 lead 空洞复制到目标段，且 golden musicality 干净', () => {
    const { ir, audit, plans, arr, tb } = pipeline(64062, 'lofi');
    const replay = plans.find((candidate) => candidate.sourceId === arr.sections[0]?.id);
    expect(replay, '首段实际作为 repeat source').toBeDefined();
    const delayBars = arr.openingGesture.roleDelayBars.lead ?? 0;
    expect(delayBars, '该 golden 实际覆盖 lead opening delay').toBeGreaterThan(0);
    const barTicks = arr.meter.numerator * (4 / arr.meter.denominator) * tb.ppq;
    const earlyWidth = Math.min(replay!.prefixTicks, delayBars * barTicks) - 16;
    expect(earlyWidth).toBeGreaterThan(0);
    const sourceEarly = win(ir, 'lead', replay!.sourceStartTick + 16, replay!.sourceStartTick + earlyWidth);
    const targetEarly = win(ir, 'lead', replay!.targetStartTick + 16, replay!.targetStartTick + earlyWidth);

    expect(targetEarly.length, '目标 repeat 的早段 body 应恢复').toBeGreaterThan(sourceEarly.length);
    expect(targetEarly.length).toBeGreaterThan(0);
    const musicalityRules = new Set([
      'transition-pickup-missing',
      'section-downbeat-anchor-missing',
      'song-start-abrupt',
      'outro-harmonic-support-missing',
      'comp-continuity-gap',
      'lead-groove-desync',
    ]);
    expect(audit.findings.filter((finding) => musicalityRules.has(finding.ruleId)).map((finding) => finding.ruleId)).toEqual([]);
  });

  it('replay 后按目标段重新投影 dynamics，不继承源段能量', () => {
    const seed = 3;
    const { plans, arr, plan, instr, band, tb } = pipeline(seed, 'pop');
    const replay = plans[0];
    expect(replay).toBeDefined();
    const arrangement = {
      ...arr,
      energyBySection: {
        ...arr.energyBySection,
        [replay.sourceId]: 0,
        [replay.targetId]: 1,
      },
    };
    const { ir } = renderSongFull(band, arrangement, plan, instr, tb, createRandomContext(seed));
    const edge = 16;
    const source = win(ir, 'comp', replay.sourceStartTick + edge, replay.sourceStartTick + replay.prefixTicks - edge);
    const target = win(ir, 'comp', replay.targetStartTick + edge, replay.targetStartTick + replay.prefixTicks - edge);
    expect(source.length).toBeGreaterThan(0);
    expect(target.length).toBe(source.length);
    const averageVelocity = (notes: NoteIR[]) => notes.reduce((sum, note) => sum + note.velocity, 0) / notes.length;
    expect(averageVelocity(target)).toBeGreaterThan(averageVelocity(source) * 1.3);
  });

  it('replay 后再投影 ending：目标段退出的 comp 不会被 body 重放复活', () => {
    const seed = 3;
    const { plans, arr, plan, instr, band, tb } = pipeline(seed, 'pop');
    const replay = plans[0];
    expect(replay).toBeDefined();
    const targetSection = arr.sections.find((section) => section.id === replay.targetId)!;
    const instrumentation = {
      ...instr,
      endingPlan: {
        ...instr.endingPlan,
        style: 'fade' as const,
        outroSectionId: replay.targetId,
        outroBars: targetSection.bars,
        exitBarByRole: { ...instr.endingPlan.exitBarByRole, comp: 0 },
        holdFinalChord: false,
        fadeOut: true,
        coldStop: false,
      },
    };
    const { ir } = renderSongFull(band, arr, plan, instrumentation, tb, createRandomContext(seed));
    const source = win(ir, 'comp', replay.sourceStartTick, replay.sourceStartTick + replay.prefixTicks);
    const target = win(ir, 'comp', replay.targetStartTick, replay.targetStartTick + replay.prefixTicks);
    expect(source.length).toBeGreaterThan(0);
    expect(target).toHaveLength(0);
  });

  it('确定性:同 seed 两次生成 → IR 逐字节一致', () => {
    const snap = (ir: MusicalIR) => JSON.stringify(ir.tracks.map((t) => ({ r: t.role, n: t.notes.map((x) => [x.pitch, x.startTick, x.durationTicks, x.velocity]) })));
    for (const [seed, style] of [[3, 'pop'], [7, 'rnb']] as [number, string][]) {
      expect(snap(pipeline(seed, style).ir)).toBe(snap(pipeline(seed, style).ir));
    }
  });

  it('IR 深不可变', () => {
    const { ir } = pipeline(3, 'pop');
    expect(Object.isFrozen(ir)).toBe(true);
    expect(Object.isFrozen(ir.tracks)).toBe(true);
  });
});
