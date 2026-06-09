// ============================================================
// newEngine · render · MusicalityAuditor(Loop H,2026-06-08)
// ------------------------------------------------------------
// CODEX directive Loop H:只读音乐性审计,findings 追加进 AuditReport。全部 severity='warning'
//   → GenerationController 仅 error/fatal 重跑(controller.ts:52),warning 接受不重跑、不改控制环语义。
//   不修改 IR。规则:transition-pickup / section-anchor / song-start-abrupt / outro-support /
//   comp-continuity-gap / lead-groove-desync。
// ============================================================

import { beatsPerBarOf } from '../arranger/phraseTiming';
import { measureCompGaps } from './compContinuity';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import type { InstrumentationPlan } from '../instrumental/InstrumentationPlan';
import type { MusicalIR } from '../ir/MusicalIR';
import type { AuditFinding, AuditReport } from '../ir/AuditReport';
import type { Timebase } from '../foundation';

const COMP_GAP_BEATS: Record<string, number> = { pop: 1.5, rnb: 1.5, lofi: 2.5, jazz: 2.0, default: 2.0 };
const ANCHOR_WINDOW_BEAT = 1.0; // 段起首拍内出现 anchor 即视为落地
const SWUNG_POS = 0.66;

export function auditMusicality(
  ir: MusicalIR,
  arrangement: ArrangementPlan,
  instrumentation: InstrumentationPlan,
  timebase: Timebase,
  style: string,
): AuditReport {
  const findings: AuditFinding[] = [];
  const ppq = timebase.ppq;
  const bpb = beatsPerBarOf(arrangement.meter);
  const barTicks = bpb * ppq;
  const warn = (trackRole: string, startTick: number, ruleId: string, reason: string): void => {
    findings.push({ severity: 'warning', location: { trackRole, startTick }, ruleId, reason, suggestedReturnPoint: 'render-fallback' });
  };

  // onsets / sounding 索引
  const onsets: Record<string, number[]> = {};
  const spans: Record<string, { s: number; e: number }[]> = {};
  for (const t of ir.tracks) {
    onsets[t.role] = t.notes.map((n) => n.startTick as number).sort((a, b) => a - b);
    spans[t.role] = t.notes.map((n) => ({ s: n.startTick as number, e: (n.startTick as number) + (n.durationTicks as number) }));
  }
  const onsetIn = (role: string, lo: number, hi: number) => (onsets[role] ?? []).some((t) => t >= lo && t < hi);
  const soundingIn = (role: string, lo: number, hi: number) => (spans[role] ?? []).some((n) => n.s < hi && n.e > lo);

  // 段落起始小节 / tick
  const startBar: number[] = [];
  let cum = 0;
  for (const s of arrangement.sections) { startBar.push(cum); cum += s.bars; }
  const songEnd = cum * barTicks;
  const sectionStartTick = (i: number) => startBar[i] * barTicks;
  const tp = instrumentation.transitionPlan;

  // —— Rule 1: transition-pickup-missing —— lead-in prepBar 无任何 pickup 起音。
  for (const b of tp.boundaries) {
    if (b.entry !== 'lead-in' || b.pickupRoles.length === 0) continue;
    const lo = b.prepBar * barTicks;
    if (!b.pickupRoles.some((r) => onsetIn(r, lo, lo + barTicks))) {
      warn('drum', lo, 'transition-pickup-missing', `lead-in→${b.toSectionId} prepBar 无 pickup 起音(${b.pickupRoles.join('/')})`);
    }
  }

  // —— Rule 2: section-downbeat-anchor-missing —— 新段起首拍无 anchor 起音/延留覆盖。
  for (let i = 1; i < arrangement.sections.length; i++) {
    const anchors = tp.boundaries[i - 1]?.downbeatAnchorRoles ?? [];
    if (anchors.length === 0) continue;
    const st = sectionStartTick(i);
    const ok = anchors.some((r) => onsetIn(r, st, st + ANCHOR_WINDOW_BEAT * ppq) || soundingIn(r, st, st + 1));
    if (!ok) warn(anchors[0], st, 'section-downbeat-anchor-missing', `${arrangement.sections[i].id} 下拍无 anchor 落地(${anchors.join('/')})`);
  }

  // —— Rule 3: song-start-abrupt —— 无 intro 且首小节核心角色同时高力度硬切。
  if (tp.songEntry.mode === 'staged-first-bar') {
    const at0 = ir.tracks.filter((t) => t.role !== 'lead' && t.notes.some((n) => (n.startTick as number) < ppq * 0.1 && n.velocity >= 96));
    if (at0.length >= 3) warn(at0[0].role, 0, 'song-start-abrupt', `无 intro 首小节 ${at0.length} 个角色同时高力度硬切(应 staged/anchor 进入)`);
  }

  // —— Rule 4: outro-harmonic-support-missing —— 收尾末 2 小节缺 comp/pad,且非 cold button。
  const lastIdx = arrangement.sections.length - 1;
  const last = arrangement.sections[lastIdx];
  if (last && !instrumentation.endingPlan.coldStop) {
    const finalLo = sectionStartTick(lastIdx) + Math.max(0, last.bars - 2) * barTicks;
    if (!(soundingIn('comp', finalLo, songEnd) || soundingIn('pad', finalLo, songEnd))) {
      warn('comp', finalLo, 'outro-harmonic-support-missing', `${last.id} 末 2 小节缺 comp/pad 和声支撑(非 cold)`);
    }
  }

  // —— Rule 5: comp-continuity-gap —— comp 应在场区间内空隙超阈值。
  const compNotes = ir.tracks.find((t) => t.role === 'comp')?.notes ?? [];
  if (compNotes.length) {
    const activeRanges: { lo: number; hi: number }[] = [];
    arrangement.sections.forEach((s, i) => {
      const roles = (instrumentation.activeRolesBySection[s.id] as readonly string[] | undefined) ?? [];
      const tex = instrumentation.textureBySection[s.id];
      const busy = roles.includes('comp') && instrumentation.textureYieldPolicy[tex] === 'active';
      if (busy) activeRanges.push({ lo: sectionStartTick(i), hi: sectionStartTick(i) + s.bars * barTicks });
    });
    if (activeRanges.length) {
      const thresh = COMP_GAP_BEATS[style.toLowerCase()] ?? COMP_GAP_BEATS.default;
      const rep = measureCompGaps(compNotes.map((n) => ({ startTick: n.startTick as number, durationTicks: n.durationTicks as number })), activeRanges, ppq);
      const big = rep.gaps.find((g) => g.gapBeats > thresh);
      if (big) warn('comp', Math.round(big.startBeat * ppq), 'comp-continuity-gap', `comp active 区间空洞 ${big.gapBeats.toFixed(2)} 拍 > ${thresh}`);
    }
  }

  // —— Rule 6: lead-groove-desync —— swing 风格里 lead 完全不摆而伴奏摆(timing owner 不一致)。
  const s = style.toLowerCase();
  if (s === 'jazz' || s === 'blues') {
    const nearSwung = (role: string) => {
      const xs = onsets[role] ?? [];
      if (!xs.length) return -1;
      return xs.filter((t) => { const f = (t / ppq) % 1; return Math.abs(f - SWUNG_POS) < 0.06; }).length / xs.length;
    };
    const lead = nearSwung('lead'), comp = nearSwung('comp');
    if (lead >= 0 && comp > 0.15 && lead < 0.03) warn('lead', 0, 'lead-groove-desync', `swing 风格 lead 几乎不摆(${(lead * 100).toFixed(0)}%)而 comp 摆(${(comp * 100).toFixed(0)}%)`);
  }

  // —— Loop I.4: texture-clock-drift —— LOFI comp【柱式块】【系统性】离 8 分格 > 0.055(roll 单音豁免;
  //   按比例判,容个别 off-grid span 锚点 → 只在 dusty chop 整体漂[如原 0.58]时报)。
  if (s === 'lofi') {
    const blockTick: Record<number, number> = {};
    for (const n of ir.tracks.find((t) => t.role === 'comp')?.notes ?? []) blockTick[n.startTick as number] = (blockTick[n.startTick as number] ?? 0) + 1;
    const blocks = Object.entries(blockTick).filter(([, c]) => c >= 2);
    const drift = blocks.filter(([tickStr]) => { const b = Number(tickStr) / ppq; return Math.abs(b - Math.round(b * 2) / 2) > 0.055; });
    if (blocks.length >= 4 && drift.length / blocks.length > 0.15) {
      warn('comp', Number(drift[0][0]), 'texture-clock-drift', `LOFI comp 柱式块 ${(100 * drift.length / blocks.length).toFixed(0)}% 离 8 分格 > 0.055(系统性漂)`);
    }
  }

  // —— Loop I.4: structural-comp-anchor-late —— no-pad comp 支撑段,section 下拍 0.08 拍内无 comp 起音/延留。
  for (let i = 0; i < arrangement.sections.length; i++) {
    const sec = arrangement.sections[i];
    if (!instrumentation.needsDownbeatCompAnchorBySection[sec.id]) continue;
    const st = sectionStartTick(i);
    const eps = 0.08 * ppq;
    if (!(onsetIn('comp', st - eps, st + eps) || soundingIn('comp', st, st + 1))) {
      warn('comp', st, 'structural-comp-anchor-late', `${sec.id} no-pad comp 支撑但下拍 0.08 拍内无 comp anchor`);
    }
  }

  return { findings };
}
