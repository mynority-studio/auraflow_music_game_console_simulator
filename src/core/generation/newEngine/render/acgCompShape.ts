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

// 一架钢琴的声部所有权：bass 拿低根，comp 只在中部活动，lead 是有旋律 bar 的最高语义声部。
// 这些不是 renderer 的硬裁音高（那会破坏和弦合法性），而是按八度把既有和弦音搬回正确手区。
const ACG_COMP_MIDDLE_FLOOR = 48;
const ACG_COMP_WITH_LEAD_CEILING = 67;
const ACG_COMP_LEAD_REST_CEILING = 72;

function leadNotesTouchingBar(ctx: Ctx, bar: number): NoteIR[] {
  const lo = bar * ctx.barTicks;
  const hi = lo + ctx.barTicks;
  // Keep this overlap rule identical to the final piano-score contract.  A lead
  // tail that enters a bar by even one tick still owns that bar's top voice;
  // otherwise the comp planner may approve a high arpeggio that the contract
  // (and the listener at the boundary) correctly treats as a second topline.
  return ctx.lead.notes.filter((n) => st(n) < hi && st(n) + du(n) > lo);
}

/**
 * lead 在本 bar 出现时，comp 的整个手型都保持在旋律下方；lead 留白 bar 才允许轻微上探，
 * 让琶音能呼吸/回应，但仍不占顶声部。取该 bar 最低 lead 是为了长跳旋律落回低点时，
 * 之前的高 air 不会反过来成为“另一条旋律”。
 */
function compCeilingForBar(ctx: Ctx, bar: number): number {
  const leadInBar = leadNotesTouchingBar(ctx, bar);
  if (leadInBar.length === 0) return ACG_COMP_LEAD_REST_CEILING;
  const lowestLead = Math.min(...leadInBar.map(pit));
  return Math.max(
    ACG_COMP_MIDDLE_FLOOR,
    Math.min(ACG_COMP_WITH_LEAD_CEILING, lowestLead - 3),
  );
}

/** 保留原 pitch class，只通过八度换位放进中部；没有合法八度就删该冗余声部，绝不半音硬钳。 */
function revoiceIntoRange(pitch: number, floor: number, ceiling: number): number | null {
  let best: number | null = null;
  for (let octave = -4; octave <= 4; octave++) {
    const candidate = pitch + octave * 12;
    if (candidate < floor || candidate > ceiling) continue;
    if (best === null || Math.abs(candidate - pitch) < Math.abs(best - pitch)) best = candidate;
  }
  return best;
}

/**
 * 把 comp 维持为中部琶音，而不是在 lead 已入场时再添一条高音线。
 * 优先 octave revoice，因而保留已有的上/下行节奏与和弦色彩；仅在该音级无法落入手区时才让它留白。
 */
function keepCompInMiddleRegister(compNotes: NoteIR[], ctx: Ctx): NoteIR[] {
  const out: NoteIR[] = [];
  for (const event of compNotes) {
    const bar = Math.max(0, Math.floor(st(event) / ctx.barTicks));
    const ceiling = compCeilingForBar(ctx, bar);
    const revoiced = revoiceIntoRange(pit(event), ACG_COMP_MIDDLE_FLOOR, ceiling);
    if (revoiced === null) continue;
    out.push(revoiced === pit(event)
      ? event
      : { ...event, pitch: midi(revoiced) });
  }
  return out;
}

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

// ============================================================
// ★ chord-roll(忠实 port MG shapeTopVoicePianoTouch 7021-7057)—— ACG final comp 的【承重契约】:
//   MG ACG comp chord onset ~100% 单音(琶音滚动/透明/呼吸),不是同起点块状和声床。此 pass 把任何【同起点 ≥2 音组】
//   按音高升序【滚开】(cumulative ms 偏移:近音 5-13ms / 宽音 42-70ms)→ 单音错开起点 + 位置力度(cluster 22-32 /
//   top 52-62 / mid 42-54,normalize 后定级)。放全 comp 塑形【最后】,保证 final comp 单音比 ≥0.9、块状 ≤0.05。
// ============================================================
function chordRoll(notes: readonly NoteIR[], ctx: Ctx): NoteIR[] {
  // ★ 容差分组:同一 onset【组】= 起点在 tol 窗内的音(humanize 可能把原本同起点的块状音散开几 tick → 用容差抓回)。
  //   tol 取 0.09 拍(> humanize 抖动,< 真琶音最小间隔 ~0.2 拍),防真琶音被误并。
  const tol = B(ctx, 0.09);
  const bySt = [...notes].sort((a, b) => st(a) - st(b) || pit(a) - pit(b));
  const groups: NoteIR[][] = [];
  let cur: NoteIR[] = []; let anchor = -Infinity;
  for (const n of bySt) {
    if (st(n) - anchor > tol) { if (cur.length) groups.push(cur); cur = [n]; anchor = st(n); }
    else cur.push(n);
  }
  if (cur.length) groups.push(cur);
  const out: NoteIR[] = [];
  for (const group of groups) {
    if (group.length < 2) { out.push(...group); continue; }
    const sorted = [...group].sort((a, b) => pit(a) - pit(b));
    const baseTime = Math.min(...group.map(st)); // 组内重排:从最早起点【干净滚开】(替 humanize 散开)
    const roll = stableUnit(`acg-roll|${ctx.seed}|${baseTime}|${sorted.map(pit).join(',')}`);
    let cumMs = 0;
    sorted.forEach((n, i) => {
      const lowerGap = i > 0 ? pit(n) - pit(sorted[i - 1]) : Infinity;
      const upperGap = i < sorted.length - 1 ? pit(sorted[i + 1]) - pit(n) : Infinity;
      const isCluster = lowerGap <= 2 || upperGap <= 2;
      // ★ T2.1(acg_t2_quick_close):近音簇 stagger 从 5-13ms 抬到 16-26ms —— 5ms 在 ACG 慢速(~70-100bpm)下 < 审计 0.012 拍
      //   容差 → 仍算同 onset(块床,single<0.9)。16ms 保证拆开过审计容差,又是自然快滚(非过量化)。远音琶音不变。
      if (i > 0) { const gap = pit(n) - pit(sorted[i - 1]); cumMs += gap <= 2 ? 16 + roll * 10 : 42 + roll * 28; }
      const offset = MS(ctx, cumMs);
      const vel = isCluster ? Math.round(22 + roll * 10) : i === sorted.length - 1 ? Math.round(52 + roll * 10) : Math.round(42 + roll * 12);
      out.push(mkNote(pit(n), baseTime + offset, Math.max(B(ctx, 0.18), du(n) - offset), vel));
    });
  }
  return out.sort((a, b) => st(a) - st(b) || pit(a) - pit(b));
}

// ★ T2.1(acg_t2_quick_close):chordRoll 组内滚开后,某组【前推】的音可能撞到下一组 onset(跨组碰撞 → 同起点块床,
//   section single<0.9)。最终保证任两音起点间距 > 审计容差:撞的音前推到 lastT+0.02 拍(0.02 > 0.012 容差)。
//   真琶音(已 >0.02 拍)不动 → 不过量化,只清残余同起点簇。
function deCollideOnsets(notes: readonly NoteIR[], ctx: Ctx): NoteIR[] {
  const MINGAP = B(ctx, 0.02);
  const sorted = [...notes].sort((a, b) => st(a) - st(b) || pit(a) - pit(b));
  const out: NoteIR[] = [];
  let lastT = -Infinity;
  for (const n of sorted) {
    let t = st(n);
    if (t - lastT < MINGAP) t = lastT + MINGAP;
    lastT = t;
    out.push(t === st(n) ? n : mkNote(pit(n), t, Math.max(B(ctx, 0.15), du(n) - (t - st(n))), n.velocity as number));
  }
  return out;
}

/** ACG comp melody-first cantabile 塑形:inner voice → carve → 中部换位 → floor → chord-roll(承重:单音滚动)→ de-collide。只 ACG。 */
export function shapeAcgComp(comp: TrackIR, lead: TrackIR, timeline: readonly ChordSpan[], barTicks: number, ppq: number, bpm: number, seed: number): TrackIR {
  if (lead.notes.length === 0) {
    const ctx0: Ctx = { lead, timeline, barTicks, ppq, bpm, seed, nBars: 1 };
    const notes = keepCompInMiddleRegister(comp.notes, ctx0);
    return { ...comp, notes: deCollideOnsets(chordRoll(notes, ctx0), ctx0) };
  }
  const nBars = Math.max(1, Math.ceil(Math.max(0, ...comp.notes.map(st), ...lead.notes.map(st)) / barTicks) + 1);
  const ctx: Ctx = { lead, timeline, barTicks, ppq, bpm, seed, nBars };
  let notes = addInnerVoice(comp.notes, ctx);
  notes = carve(notes, ctx);
  notes = harmonyFloor(notes, ctx);
  // floor/inner voice 都可能带入高色音；统一在 roll 前收回中部，保住实际琶音而非靠删除变空。
  notes = keepCompInMiddleRegister(notes, ctx);
  notes = notes.filter((n) => du(n) > B(ctx, 0.03));
  notes = chordRoll(notes, ctx); // ★ 承重:最后把所有同起点块状 → 单音滚动琶音
  notes = deCollideOnsets(notes, ctx); // ★ T2.1:清跨组滚开碰撞(残余同起点)
  return { ...comp, notes: notes.sort((a, b) => st(a) - st(b) || pit(a) - pit(b)) };
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
