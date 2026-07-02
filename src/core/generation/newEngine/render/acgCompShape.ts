// ============================================================
// newEngine · render · ACG comp 塑形(melody-first cantabile)—— port MG ACG shaping 流水线
//   addAcgCantabileInnerVoice(7339-7413) → carveAcgMelodySpace(7420-7520) → ensureAcgCantabileHarmonyFloor(7524-7570)
// ------------------------------------------------------------
// ACG 第一原则 = melody-first + 歌唱内声部:
//   ① inner voice:旋律落点下方八度加【极软歌唱内声部】(vel 20-26)→ 电影钢琴的"厚度/歌唱感"。
//   ② carve:comp 高位色音挡旋律就让路(删/缩/减力度)→ 旋律清晰浮上。
//   ③ floor:carve 后仍稀疏的 bar 补【低位和声托底】(vel 16-18)→ 每个旋律落点都有和声支撑。
// SIM lead/comp 分轨:此 pass 读 lead(旋律落点)+ chordTimeline(合法音)改 comp。忠实 MG 阈值(beat→tick,ms→tick)。
// 力度归一在其后(normalizeAcgDynamics)—— 这里的 vel 是【相对】塑形,最终均值由 normalize 定。
// ============================================================

import { ticks, midi, type Ticks } from '../foundation';
import type { TrackIR, NoteIR } from '../ir/MusicalIR';
import type { ChordSpan } from '../harmony/HarmonicPlan';
import { chordToneIntervals, chordTypeIntervals, isKnownChordType, type ChordQuality } from '../knowledge/chords';

const st = (n: NoteIR) => n.startTick as number;
const du = (n: NoteIR) => n.durationTicks as number;
const pit = (n: NoteIR) => n.pitch as number;
const mkNote = (pitch: number, startT: number, durT: number, vel: number): NoteIR =>
  ({ pitch: midi(Math.round(pitch)), startTick: ticks(Math.max(0, Math.round(startT))) as Ticks, durationTicks: ticks(Math.max(1, Math.round(durT))) as Ticks, velocity: Math.round(vel) });

/** 确定性 [0,1)(替 MG stableUnitInterval;非 byte-match,只需确定+按 bar 变化)。 */
function stableUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

function legalPcsForSpan(span: ChordSpan): { rootPc: number; pcs: Set<number> } {
  const ivs = span.chordType && isKnownChordType(span.chordType) ? chordTypeIntervals(span.chordType) : chordToneIntervals(span.quality as ChordQuality);
  const rootPc = ((span.rootPc as number) % 12 + 12) % 12;
  return { rootPc, pcs: new Set(ivs.map((iv) => (rootPc + iv) % 12)) };
}
function spanForBeat(timeline: readonly ChordSpan[], beat: number): ChordSpan | null {
  return timeline.find((s) => beat >= (s.startBeat as number) - 0.001 && beat < (s.startBeat as number) + (s.durationBeats as number) - 0.001) ?? null;
}
function snapMidiToPcSet(target: number, pcs: Set<number>): number {
  if (pcs.size === 0) return target;
  let best = target, bestD = Infinity;
  for (let m = target - 12; m <= target + 12; m++) {
    if (!pcs.has(((m % 12) + 12) % 12)) continue;
    const d = Math.abs(m - target); if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

/** bar 内主落点(结构音):bar 内 lead,长音(≥0.45拍)优先,否则首音。 */
function primaryLandingInBar(lead: TrackIR, barStart: number, barEnd: number, ppq: number): NoteIR | null {
  const inBar = lead.notes.filter((n) => st(n) >= barStart - 1 && st(n) < barEnd - 1).sort((a, b) => st(a) - st(b) || du(b) - du(a));
  if (inBar.length === 0) return null;
  return inBar.find((n) => du(n) >= 0.45 * ppq) ?? inBar[0];
}

interface Ctx { lead: TrackIR; timeline: readonly ChordSpan[]; barTicks: number; ppq: number; bpm: number; seed: number; nBars: number }
const B = (ctx: Ctx, beat: number) => beat * ctx.ppq;
const MS = (ctx: Ctx, ms: number) => (ms * ctx.bpm / 60000) * ctx.ppq;

// ① inner voice:旋律落点下方加软歌唱内声部(+ breath 高时补 answer 声部)。
function addInnerVoice(compNotes: NoteIR[], ctx: Ctx): NoteIR[] {
  const out = [...compNotes];
  const hasNearbyChord = (t: number, m: number) => out.some((e) => Math.abs(st(e) - t) <= B(ctx, 0.055) && Math.abs(pit(e) - m) <= 1);
  for (let bar = 0; bar < ctx.nBars; bar++) {
    const barStart = bar * ctx.barTicks, barEnd = barStart + ctx.barTicks;
    const landing = primaryLandingInBar(ctx.lead, barStart, barEnd, ctx.ppq); if (!landing) continue;
    const span = spanForBeat(ctx.timeline, st(landing) / ctx.ppq); if (!span) continue;
    const { rootPc, pcs: legal } = legalPcsForSpan(span); if (legal.size === 0) continue;
    const lp = pit(landing), landingPc = ((lp % 12) + 12) % 12;
    const colorLanding = [2, 6, 9, 10, 11].includes((landingPc - rootPc + 12) % 12);
    const breath = stableUnit(`inner|${ctx.seed}|${bar}|${lp}`);
    if (legal.has(landingPc) && (colorLanding || breath > 0.36)) {
      let inner = lp - 12;
      while (inner < 60 && inner + 12 <= lp - 8) inner += 12;
      while (inner > lp - 8 && inner - 12 >= 55) inner -= 12;
      const t = Math.max(barStart + B(ctx, 0.10), st(landing) - MS(ctx, 92 + breath * 24));
      if (inner >= 55 && inner <= lp - 8 && !hasNearbyChord(t, inner)) {
        out.push(mkNote(inner, t, Math.max(B(ctx, 0.28), Math.min(B(ctx, 0.72), barEnd - t - B(ctx, 0.12))), colorLanding ? 26 : 20));
      }
    }
    // answer 内声部(breath 足够 + 落点后有空)
    const nextMel = ctx.lead.notes.filter((n) => st(n) > st(landing) + B(ctx, 0.18) && st(n) < barEnd - 1).sort((a, b) => st(a) - st(b))[0] ?? null;
    const answerEnd = nextMel ? st(nextMel) - B(ctx, 0.12) : barEnd - B(ctx, 0.20);
    if (breath < 0.42 || answerEnd - st(landing) < B(ctx, 0.86)) continue;
    const answerPcs = new Set([...legal].filter((pc) => pc !== landingPc)); if (answerPcs.size === 0) continue;
    const a1 = snapMidiToPcSet(lp - 4, answerPcs), a2 = snapMidiToPcSet(lp - 7, answerPcs);
    [...new Set([a1, a2])].filter((m) => m >= 60 && m <= lp - 3).slice(0, 2).forEach((m, idx) => {
      const t = st(landing) + B(ctx, 0.54) + idx * B(ctx, 0.28);
      if (t >= answerEnd || hasNearbyChord(t, m)) return;
      out.push(mkNote(m, t, Math.min(B(ctx, 0.34), answerEnd - t), 18 - idx * 2));
    });
  }
  return out;
}

// ② carve:comp 让旋律(port MG carveAcgMelodySpace)。
function carve(compNotes: NoteIR[], ctx: Ctx): NoteIR[] {
  const melody = [...ctx.lead.notes].sort((a, b) => st(a) - st(b) || pit(b) - pit(a));
  if (melody.length === 0) return compNotes;
  const barEndFor = (t: number) => (Math.floor(t / ctx.barTicks) + 1) * ctx.barTicks;
  const activeAt = (t: number, pad: number) => melody.filter((m) => st(m) <= t + pad && st(m) + du(m) > t - pad).sort((a, b) => pit(b) - pit(a))[0] ?? null;
  const nextAfter = (t: number, h: number) => melody.find((m) => st(m) > t && st(m) - t <= h) ?? null;
  const recentLandingAt = (t: number) => melody.filter((m) => du(m) >= B(ctx, 0.70) && st(m) < t && t < barEndFor(st(m)) - B(ctx, 0.04)).sort((a, b) => st(b) - st(a))[0] ?? null;
  const nearestEdge = (n: NoteIR, h: number) => {
    let best: { m: NoteIR; gap: number } | null = null;
    for (const m of melody) {
      const gap = st(n) + du(n) < st(m) ? st(m) - (st(n) + du(n)) : st(m) + du(m) < st(n) ? st(n) - (st(m) + du(m)) : 0;
      if (gap > h) continue; if (!best || gap < best.gap) best = { m, gap };
    }
    return best?.m ?? null;
  };
  const carved: NoteIR[] = [];
  for (const event of compNotes) {
    let dur = du(event), vel = event.velocity; const t = st(event), p = pit(event);
    const active = activeAt(t, B(ctx, 0.055));
    const nearAttack = melody.find((m) => Math.abs(st(m) - t) <= B(ctx, 0.18)) ?? null;
    const upcoming = nextAfter(t, B(ctx, 0.62));
    const nearbyEdge = nearestEdge(event, B(ctx, 0.24));
    const recentLanding = recentLandingAt(t);
    const reference = active ?? nearAttack ?? upcoming ?? nearbyEdge;
    if (!reference) { if (recentLanding && p >= pit(recentLanding) - 12 && p >= 64) continue; carved.push(event); continue; }
    const isUpperRH = p >= 68, entersSpace = p >= pit(reference) - 7, closeUnder = p >= pit(reference) - 11;
    const overlaps = !!upcoming && t < st(upcoming) && t + dur > st(upcoming) - B(ctx, 0.035);
    if ((active || nearAttack) && isUpperRH && entersSpace) continue;
    if (recentLanding && p >= pit(recentLanding) - 12 && p >= 64) continue;
    if (nearbyEdge && isUpperRH && entersSpace) continue;
    if (overlaps && isUpperRH && closeUnder) {
      const rel = st(upcoming!) - t - MS(ctx, 42); if (rel < B(ctx, 0.16)) continue; dur = Math.min(dur, rel); vel = Math.round(vel * 0.72);
    } else if (overlaps && upcoming && p >= pit(upcoming) - 2 && p >= 64) {
      const rel = st(upcoming) - t - MS(ctx, 42); if (rel < B(ctx, 0.16)) continue; dur = Math.min(dur, rel); vel = Math.round(vel * 0.62);
    } else if (active && isUpperRH) { dur = Math.min(dur, B(ctx, 0.24)); vel = Math.round(vel * 0.62); }
    if (dur > B(ctx, 0.08) && vel > 0) carved.push({ ...event, durationTicks: ticks(Math.max(1, Math.round(dur))) as Ticks, velocity: vel });
  }
  return carved;
}

// ③ floor:carve 后仍稀疏(<2 comp)的 bar 补低位和声托底(port ensureAcgCantabileHarmonyFloor)。
function harmonyFloor(compNotes: NoteIR[], ctx: Ctx): NoteIR[] {
  const out = [...compNotes];
  for (let bar = 0; bar < ctx.nBars; bar++) {
    const barStart = bar * ctx.barTicks, barEnd = barStart + ctx.barTicks;
    if (out.filter((e) => st(e) >= barStart - 1 && st(e) < barEnd - 1).length >= 2) continue;
    const landing = primaryLandingInBar(ctx.lead, barStart, barEnd, ctx.ppq); if (!landing) continue;
    const span = spanForBeat(ctx.timeline, st(landing) / ctx.ppq); if (!span) continue;
    const { rootPc, pcs: legal } = legalPcsForSpan(span);
    const lp = pit(landing);
    const preferred = [4, 3, 11, 10, 2, 9, 7, 0].map((iv) => (rootPc + iv) % 12).filter((pc) => legal.has(pc));
    const midis = [...new Set(preferred.map((pc) => {
      let m = snapMidiToPcSet(lp - 12, new Set([pc]));
      while (m >= lp - 7 && m - 12 >= 52) m -= 12;
      while (m < 55 && m + 12 <= lp - 8) m += 12;
      return m;
    }).filter((m) => m >= 52 && m <= lp - 8))].slice(0, 2);
    midis.forEach((m, idx) => {
      const t = Math.max(barStart + B(ctx, 0.10), st(landing) - MS(ctx, 84 + idx * 22));
      out.push(mkNote(m, t, Math.max(B(ctx, 0.28), Math.min(B(ctx, 0.74), barEnd - t - B(ctx, 0.12))), 18 - idx * 2));
    });
  }
  return out;
}

/** ACG comp melody-first cantabile 塑形:inner voice → carve → floor(忠实 MG 顺序)。只 ACG。 */
export function shapeAcgComp(comp: TrackIR, lead: TrackIR, timeline: readonly ChordSpan[], barTicks: number, ppq: number, bpm: number, seed: number): TrackIR {
  if (lead.notes.length === 0) return comp;
  const nBars = Math.max(1, Math.ceil(Math.max(0, ...comp.notes.map(st), ...lead.notes.map(st)) / barTicks) + 1);
  const ctx: Ctx = { lead, timeline, barTicks, ppq, bpm, seed, nBars };
  let notes = addInnerVoice(comp.notes, ctx);
  notes = carve(notes, ctx);
  notes = harmonyFloor(notes, ctx);
  notes = notes.filter((n) => du(n) > B(ctx, 0.03)).sort((a, b) => st(a) - st(b) || pit(a) - pit(b));
  return { ...comp, notes };
}

// ============================================================
// spaceAcgBassGesture 忠实 port(musicEngine.ts:7280-7337)—— bass 瘦身到 anchor(bar 头,长音)+ 1-2 支撑(对齐旋律落点)。
//   删多余 bass → 干净稀疏低音(MG ~2.5/bar),给旋律留空间。力度 anchor≤54/support≤28(相对;normalize 后定级)。
// ============================================================
export function spaceAcgBass(bass: TrackIR, lead: TrackIR, barTicks: number, ppq: number, seed: number): TrackIR {
  if (bass.notes.length === 0) return bass;
  const B = (beat: number) => beat * ppq;
  const nBars = Math.max(1, Math.ceil(Math.max(0, ...bass.notes.map(st)) / barTicks) + 1);
  const remove = new Set<NoteIR>();
  const reshaped = new Map<NoteIR, { t: number; d: number; velCap: number }>();
  for (let bar = 0; bar < nBars; bar++) {
    const barStart = bar * barTicks, barEnd = barStart + barTicks;
    const bassEv = bass.notes.filter((n) => du(n) > 0 && st(n) >= barStart - 1 && st(n) < barEnd - 1).sort((a, b) => st(a) - st(b) || pit(a) - pit(b));
    if (bassEv.length <= 1) continue;
    const landing = primaryLandingInBar(lead, barStart, barEnd, ppq);
    const breath = stableUnit(`acg-bass-gesture|${seed}|${bar}`);
    const lt = landing ? st(landing) : null;
    const supportTargets = lt !== null
      ? [barStart + Math.max(B(0.84), Math.min(B(1.42), lt - barStart - B(0.46))), Math.min(barEnd - B(0.62), lt + B(1.04) + breath * B(0.18))]
      : [barStart + B(1.20) + breath * B(0.22), barStart + B(2.64) + breath * B(0.18)];
    const barKeep = new Map<NoteIR, number | null>();
    barKeep.set(bassEv[0], null); // anchor(bar 头)
    const maxSupports = barTicks >= B(3.6) ? 2 : 1;
    for (const target of supportTargets.slice(0, maxSupports)) {
      if (target <= barStart + B(0.34) || target >= barEnd - B(0.28)) continue;
      const cand = bassEv.slice(1).filter((e) => !barKeep.has(e)).sort((a, b) => Math.abs(st(a) - target) - Math.abs(st(b) - target))[0];
      if (cand) barKeep.set(cand, target);
    }
    for (const e of bassEv) {
      if (!barKeep.has(e)) { remove.add(e); continue; }
      const target = barKeep.get(e)!;
      if (target === null) reshaped.set(e, { t: barStart, d: Math.max(B(0.68), barEnd - barStart - B(0.10)), velCap: 54 });
      else reshaped.set(e, { t: target, d: Math.min(Math.max(B(0.32), barEnd - target - B(0.16)), B(0.58)), velCap: 28 });
    }
  }
  const out = bass.notes.filter((n) => !remove.has(n)).map((n) => {
    const r = reshaped.get(n); if (!r) return n;
    return { pitch: n.pitch, startTick: ticks(Math.max(0, Math.round(r.t))) as Ticks, durationTicks: ticks(Math.max(1, Math.round(r.d))) as Ticks, velocity: Math.min(n.velocity, r.velCap) };
  });
  return { ...bass, notes: out };
}
