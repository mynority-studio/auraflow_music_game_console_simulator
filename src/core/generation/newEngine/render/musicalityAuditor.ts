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
import { isBreathingTexture } from '../knowledge/textureProfiles';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import type { InstrumentationPlan } from '../instrumental/InstrumentationPlan';
import type { MusicalIR } from '../ir/MusicalIR';
import type { AuditFinding, AuditReport } from '../ir/AuditReport';
import type { Timebase } from '../foundation';

const COMP_GAP_BEATS: Record<string, number> = { pop: 1.5, rnb: 1.5, lofi: 2.5, jazz: 2.0, default: 2.0 };
const SPARSE_COMP_GAP_BEATS = 2.5; // 稀疏 rich 织体段:固有呼吸放宽到此(Loop 6)
const OPENING_RIFF_TEXTURES: ReadonlySet<string> = new Set(['pianoRiff', 'rhodesDust', 'bellMotif']);
const OPENING_RIFF_BREATH_TOLERANCE_BEATS = 0.1;
const ANCHOR_WINDOW_BEAT = 1.0; // 段起首拍内出现 anchor 即视为落地
const SWUNG_POS = 0.66;

function isGuitarProgram(program: number | undefined): boolean {
  return program !== undefined && program >= 24 && program <= 31;
}

/** 区间集合减去 holes(返回剩余子区间)。Loop 5:comp 应在场区间 − dense-melody 区间。 */
function subtractRanges(ranges: readonly { lo: number; hi: number }[], holes: readonly { lo: number; hi: number }[]): { lo: number; hi: number }[] {
  let out = ranges.map((r) => ({ ...r }));
  for (const h of holes) {
    const next: { lo: number; hi: number }[] = [];
    for (const r of out) {
      if (h.hi <= r.lo || h.lo >= r.hi) { next.push(r); continue; } // 不相交
      if (h.lo > r.lo) next.push({ lo: r.lo, hi: Math.min(h.lo, r.hi) }); // 左残段
      if (h.hi < r.hi) next.push({ lo: Math.max(h.hi, r.lo), hi: r.hi }); // 右残段
    }
    out = next;
  }
  return out.filter((r) => r.hi > r.lo);
}

export function auditMusicality(
  ir: MusicalIR,
  arrangement: ArrangementPlan,
  instrumentation: InstrumentationPlan,
  timebase: Timebase,
  style: string,
  compGapExclude: readonly { lo: number; hi: number }[] = [], // ★ Loop 5:LOFI dense 区间 comp 被有意删,排除出 comp-continuity
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
  const coverageRatio = (role: string, lo: number, hi: number): number => {
    if (hi <= lo) return 0;
    const clipped = (spans[role] ?? [])
      .map((n) => ({ s: Math.max(lo, n.s), e: Math.min(hi, n.e) }))
      .filter((n) => n.e > n.s)
      .sort((a, b) => a.s - b.s);
    let covered = 0;
    let cur: { s: number; e: number } | undefined;
    for (const n of clipped) {
      if (!cur) { cur = { ...n }; continue; }
      if (n.s <= cur.e) cur.e = Math.max(cur.e, n.e);
      else { covered += cur.e - cur.s; cur = { ...n }; }
    }
    if (cur) covered += cur.e - cur.s;
    return covered / (hi - lo);
  };

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

  // —— Rule 5: comp-continuity-gap —— comp 应在场区间内空隙超阈值(★ per-section 阈值:稀疏织体放宽)。
  const compTrack = ir.tracks.find((t) => t.role === 'comp');
  const compNotes = compTrack?.notes ?? [];
  const compIsGuitar = isGuitarProgram(compTrack?.program)
    && (compTrack?.programChanges ?? []).every((pc) => isGuitarProgram(pc.program));
  if (compNotes.length && !compIsGuitar) {
    const baseThresh = COMP_GAP_BEATS[style.toLowerCase()] ?? COMP_GAP_BEATS.default;
    const compTicks = compNotes.map((n) => ({ startTick: n.startTick as number, durationTicks: n.durationTicks as number }));
    for (let i = 0; i < arrangement.sections.length; i++) {
      const s = arrangement.sections[i];
      const roles = (instrumentation.activeRolesBySection[s.id] as readonly string[] | undefined) ?? [];
      const tex = instrumentation.textureBySection[s.id];
      const busy = roles.includes('comp') && instrumentation.textureYieldPolicy[tex] === 'active';
      if (!busy) continue;
      const sectionStart = sectionStartTick(i);
      const sectionEnd = sectionStart + s.bars * barTicks;
      const opening = arrangement.openingGesture;
      const isOpeningSection = i === 0 && opening?.sectionId === s.id;
      const plannedCompDelayBars = isOpeningSection ? opening.roleDelayBars.comp : undefined;
      const plannedCompEntry = plannedCompDelayBars === undefined
        ? sectionStart
        : Math.min(sectionEnd, sectionStart + Math.max(0, plannedCompDelayBars) * barTicks);
      let ranges: { lo: number; hi: number }[] = [{ lo: plannedCompEntry, hi: sectionEnd }];
      // ★ Loop 5:从 comp 应在场区间里【减去 dense-melody 区间】(那里 comp 被有意删,不算断层)。
      if (compGapExclude.length) ranges = subtractRanges(ranges, compGapExclude);
      if (!ranges.length) continue;
      // ★ Loop 6:固有呼吸型 rich 织体(稀疏 Lyrical_Felt/Ambient,或单音 arp/roll + pad 让位)的
      //   设计内间隙是作者意图 → 放宽阈值(段内任一织体呼吸即放宽整段:密集那半本就不会断)。
      const breathing = isBreathingTexture(instrumentation.richTextureBySection?.[s.id])
        || isBreathingTexture(instrumentation.richTextureSwitchBySection?.[s.id]?.toTexture);
      const openingRiff = isOpeningSection && OPENING_RIFF_TEXTURES.has(opening.textureEntry);
      const thresh = Math.max(
        baseThresh,
        breathing ? SPARSE_COMP_GAP_BEATS : 0,
        openingRiff ? bpb + OPENING_RIFF_BREATH_TOLERANCE_BEATS : 0,
      );
      const rep = measureCompGaps(compTicks, ranges, ppq);
      const next = arrangement.sections[i + 1];
      const gaps = rep.gaps.filter((g) => {
        const startTick = Math.round(g.startBeat * ppq);
        const endTick = Math.round(g.endBeat * ppq);
        const padCarriesHarmony = roles.includes('pad') && coverageRatio('pad', startTick, endTick) >= 0.8;
        if (padCarriesHarmony) return false;
        const trailingBoundaryBreath = !!next
          && Math.abs(endTick - sectionEnd) <= 1
          && g.gapBeats <= bpb + 0.5;
        return !trailingBoundaryBreath;
      });
      const big = gaps.find((g) => g.gapBeats > thresh);
      if (big) { warn('comp', Math.round(big.startBeat * ppq), 'comp-continuity-gap', `comp active 区间空洞 ${big.gapBeats.toFixed(2)} 拍 > ${thresh}`); break; }
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
  //   ★ Loop 8:若段下拍落在 dense-melody 区间(LOFI comp 被 applyMgLofiDenseMelodyComping 有意删、bass 兜 root)→
  //     不报(comp 缺席是设计内,和 comp-continuity-gap 同样排除;此处旋律密集+bass 已托住下拍)。
  const inExclude = (tick: number) => compGapExclude.some((r) => tick >= r.lo && tick < r.hi);
  for (let i = 0; i < arrangement.sections.length; i++) {
    const sec = arrangement.sections[i];
    if (!instrumentation.needsDownbeatCompAnchorBySection[sec.id]) continue;
    const st = sectionStartTick(i);
    if (inExclude(st)) continue; // dense-melody 段下拍 comp 被有意删 → bass+melody 托底,不报
    const eps = 0.08 * ppq;
    if (!(onsetIn('comp', st - eps, st + eps) || soundingIn('comp', st, st + 1))) {
      warn('comp', st, 'structural-comp-anchor-late', `${sec.id} no-pad comp 支撑但下拍 0.08 拍内无 comp anchor`);
    }
  }

  return { findings };
}
