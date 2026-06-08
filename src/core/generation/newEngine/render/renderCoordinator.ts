// ============================================================
// newEngine · render · RenderCoordinator(Slice 0)
// ------------------------------------------------------------
// 架构定稿 Part 8 / 铁律4-5:accompaniment-first 编排。
// Slice 0 只走"伴奏 → IR → 只读 Auditor"前半;Motif/Anchor Prepass、Occupation、
// Melody、Resolver 后续 slice 接入。lead 轨先留空占位。
// ============================================================

import { beats, ticks, type RandomContext, type Timebase, type Ticks } from '../foundation';
import type { BandSpec } from '../band/BandSpec';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';
import { beatsPerBarOf } from '../arranger/phraseTiming';
import type { InstrumentationPlan } from '../instrumental/InstrumentationPlan';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import { freezeMusicalIR, type MusicalIR, type MusicalIRData, type TrackIR } from '../ir/MusicalIR';
import type { AuditReport } from '../ir/AuditReport';
import { renderAccompaniment } from './accompanimentRenderer';
import { renderBass } from './bassRenderer';
import { buildTextureSchedule } from './textureSchedule';
import { auditHarmony } from './readOnlyHarmonyAuditor';
import { auditMusicality } from './musicalityAuditor';
import { renderMgMelody } from './mgLeadRenderer';
import { buildOccupationMap } from './OccupationMap';
import { resolveInteractions } from './interactionResolver';
import { renderDrums } from './drumRenderer';
import { renderPad } from './padRenderer';
import { decidePadComp, type PadCompDecision } from './padCompPolicy';
import { applySwing } from './swing';
import { applyDynamics, type EnergyRange } from './dynamics';
import { applyEnding, applyLeadIns } from './ending';
import { humanizeVelocity, humanizeTiming } from './humanize';
import type { RenderOverlay } from './RenderOverlay';

export interface RenderResult {
  ir: MusicalIR;
  audit: AuditReport;
}

function totalDurationTicks(plan: HarmonicPlan, timebase: Timebase): number {
  let maxEnd = 0;
  for (const span of plan.chordTimeline) {
    const end = timebase.beatToTick(span.startBeat) + timebase.beatToTick(span.durationBeats);
    if (end > maxEnd) maxEnd = end;
  }
  return maxEnd;
}

// CC64 踏板的风格:POP/LOFI/RNB comp 踩踏板(音尾 ring,融合);JAZZ/BLUES 不踩(声部清晰)。
const PEDAL_STYLES = ['pop', 'lofi', 'rnb'];
// pad 铺法二选一:~40% 歌走 pedal anchor(整段长 pedal + 动声部),其余逐和弦选音。
const PAD_PEDAL_ANCHOR_PROB = 0.4;

/** 伴奏 ducking:comp 撞旋律(lead)时 ×factor(让旋律清晰;旋律留白处 comp 不动=满响)。 */
export function duckUnderLead(tracks: TrackIR[], factor: number): TrackIR[] {
  const lead = tracks.find((t) => t.role === 'lead');
  if (!lead || lead.notes.length === 0) return tracks;
  const iv = lead.notes
    .map((n) => [n.startTick as number, (n.startTick as number) + (n.durationTicks as number)] as const)
    .sort((a, b) => a[0] - b[0]);
  const hits = (s: number, e: number) => iv.some(([ls, le]) => s < le && e > ls);
  return tracks.map((t) => {
    if (t.role !== 'comp') return t;
    return {
      ...t,
      notes: t.notes.map((n) => {
        const s = n.startTick as number;
        return hits(s, s + (n.durationTicks as number)) ? { ...n, velocity: Math.max(1, Math.round(n.velocity * factor)) } : n;
      }),
    };
  });
}

/** CC64 踏板序列:每和弦踩下、下一和弦前 ~50ms 抬起(comp 音尾 ring 但不糊下一和弦)。 */
function buildCompPedal(plan: HarmonicPlan, timebase: Timebase): { atTick: Ticks; down: boolean }[] {
  const lift = timebase.beatToTick(beats(0.06)) as number;
  const out: { atTick: Ticks; down: boolean }[] = [];
  for (const span of plan.chordTimeline) {
    const startT = timebase.beatToTick(span.startBeat) as number;
    const endT = startT + (timebase.beatToTick(span.durationBeats) as number);
    out.push({ atTick: ticks(startT), down: true });
    out.push({ atTick: ticks(Math.max(startT + 1, endT - lift)), down: false });
  }
  return out;
}

/**
 * 编曲密度弧 gate(A2):按 activeRolesBySection 丢掉【该 role 在该段不在场】的音(谁进/出)。
 *   段落 tick 区间从和声 timeline 聚合;落不到段(边界)→ 保留。lead 在密度表里恒含 → 不被丢(fork1)。
 *   纯过滤、确定性;在 occupation/auditor 之前施加 → 下游看到的是真实稀疏编曲。
 * ★ Loop E(2026-06-08):transition-aware —— lead-in 边界 prepBar 内、role∈pickupRoles 且 protectPickupFromGate
 *   的音=下一段【授权预进入】(drum pickup / fill),不被上一段 activeRoles 删除(directive §1.1)。
 */
function gateByDensity(
  tracks: TrackIR[],
  plan: HarmonicPlan,
  timebase: Timebase,
  activeRolesBySection: Record<string, readonly string[]>,
  pickupWindows: { lo: number; hi: number; roles: ReadonlySet<string> }[] = [],
): TrackIR[] {
  const byId = new Map<string, { start: number; end: number }>();
  for (const span of plan.chordTimeline) {
    const s = timebase.beatToTick(span.startBeat) as number;
    const e = s + (timebase.beatToTick(span.durationBeats) as number);
    const r = byId.get(span.sectionId);
    if (!r) byId.set(span.sectionId, { start: s, end: e });
    else { r.start = Math.min(r.start, s); r.end = Math.max(r.end, e); }
  }
  const ranges = [...byId.entries()].map(([id, r]) => ({ id, ...r }));
  const sectionAt = (tick: number) => ranges.find((r) => tick >= r.start && tick < r.end);
  const isPickup = (tick: number, role: string) => pickupWindows.some((w) => tick >= w.lo && tick < w.hi && w.roles.has(role));
  return tracks.map((t) => ({
    role: t.role,
    notes: t.notes.filter((n) => {
      const tick = n.startTick as number;
      if (isPickup(tick, t.role)) return true; // ★ Loop E:下一段授权 pickup → 保留
      const sec = sectionAt(tick);
      return sec ? (activeRolesBySection[sec.id] ?? []).includes(t.role) : true;
    }),
  }));
}

export function renderSong(plan: HarmonicPlan, timebase: Timebase): RenderResult {
  const bass = renderBass(plan, timebase, 'default');
  const accompaniment = renderAccompaniment(plan, timebase);
  // Slice 0:trivial 旋律占位,后续 slice 接 Prepass/MotifStore + MelodyRenderer
  const lead: TrackIR = { role: 'lead', notes: [] };
  const tracks = [bass, ...accompaniment, lead];

  const ir = freezeMusicalIR({
    tracks,
    timebase,
    durationTicks: ticks(totalDurationTicks(plan, timebase)),
  });

  const audit = auditHarmony(ir, plan, timebase);
  return { ir, audit };
}

/**
 * 完整 accompaniment-first 渲染:Prepass → 伴奏 → 旋律 → IR → 只读 Auditor。
 * (顶层 Request→FinalIR + retry 由 GenerationController 编排,后续接入。)
 */
export function renderSongFull(
  band: BandSpec,
  arrangement: ArrangementPlan,
  plan: HarmonicPlan,
  instrumentation: InstrumentationPlan,
  timebase: Timebase,
  rng: RandomContext,
  overlay?: RenderOverlay,
): RenderResult {
  // ★ 2026-06-07 退役 Motif 旋律子系统(backlog D-1/c):旋律走 MG 链,不再跑 Prepass/MotifStore/
  //   candidateSwap。撞音消解只剩 voicingSafer(comp 瘦身)+ 兜底重掷(advance melody 子流)。
  const voicingSaferSpans = overlay?.voicingSafer ? new Set(Object.keys(overlay.voicingSafer)) : undefined;

  // 让位上下文:active 织体段 + 主 hook 锚点拍(melody-aware accompaniment-first)
  // ★ comp 渲染段 = active 织体段 ∪【器配授权 comp 托底的 floating 段】(Loop D 已把 comp 写进 activeRolesBySection)。
  //   即:floating 段(pad/sustained-block)里若 comp active 且 pad 不在场 → comp 在此渲染和声(authority 来自器配,非 render 偷渲染)。
  const activeSectionIds = new Set<string>();
  for (const [sid, tex] of Object.entries(instrumentation.textureBySection)) {
    const rolesHere = ((instrumentation.activeRolesBySection[sid] as readonly string[] | undefined) ?? []);
    const compFallback = rolesHere.includes('comp') && !rolesHere.includes('pad'); // Loop D 授权的 floating 托底
    if (instrumentation.textureYieldPolicy[tex] === 'active' || compFallback) activeSectionIds.add(sid);
  }
  const anchorBeats = new Set<number>();
  for (const slot of instrumentation.melodyReservationPlan.hookAnchorSlots) {
    if (slot.anchorRequired) anchorBeats.add(slot.beatSlot);
  }

  // 段落转折 fill:每段(除末段)最后一小节。lead-in 边界(下一段=能量跃升 entry='lead-in')额外标记 → 更大 fill + crescendo。
  const fillBars = new Set<number>();
  const leadInBars = new Set<number>(); // 跃升段【前一段末小节】绝对序号(衔接推进)
  let barCursor = 0;
  for (let s = 0; s < arrangement.sections.length; s++) {
    barCursor += arrangement.sections[s].bars;
    const next = arrangement.sections[s + 1];
    if (next) {
      fillBars.add(barCursor - 1);
      if (arrangement.entryBySection[next.id] === 'lead-in') leadInBars.add(barCursor - 1);
    }
  }

  // ★ pad 改为独立常驻轨(全段落铺底,见 padRenderer);不再与 comp 二选一(去掉 floating XOR)。

  // ★ 多声部节奏【中央下发】:纹理 schedule 一次性建好,bass/comp/drum 共享同一 textureCase →
  //   同一时钟对拍/复调(纹理全权,忠实 mg)。需 harmony(dominant-chain)→ 在此协调层算。
  const sectionRoleById = Object.fromEntries(arrangement.sections.map((s) => [s.id, s.role]));
  const textureSchedule = buildTextureSchedule({ plan, style: band.style, sectionRoleById, activeSectionIds, textureRng: rng.substream('compTexture'), richTextureBySection: instrumentation.richTextureBySection, richTextureSwitchBySection: instrumentation.richTextureSwitchBySection });

  // ★ 只渲染 lineup 内的角色(编制可变 2–5;lead 必有)
  const inLineup = (r: string) => band.instrumentPool.includes(r as never);

  // ★ pad-comp 分工(docs/pad_comp_interaction_directive.md):每段算 PadCompDecision。
  //   pad 不再复制完整和弦 → comp active 段退成 guide-tone/drone(thin),pad-only 段才 full-support。
  //   render 顺序:bass → pad → comp(comp 拿 pad 占用音高避同绝对音)→ drum → lead。lead > bass > comp > pad。
  const reservedReg = instrumentation.melodyReservationPlan.reservedRegister;
  const activeRoles = instrumentation.activeRolesBySection;
  const roleInArr = (sid: string, role: string) => ((activeRoles[sid] as readonly string[] | undefined)?.includes(role) ?? true);
  const padDecisionBySection: Record<string, PadCompDecision> = {};
  for (const s of arrangement.sections) {
    padDecisionBySection[s.id] = decidePadComp({
      style: band.style,
      sectionId: s.id,
      sectionRole: s.role,
      padDensity: band.styleProfile.padDensity,
      padActive: inLineup('pad') && roleInArr(s.id, 'pad'),
      compActive: inLineup('comp') && activeSectionIds.has(s.id) && roleInArr(s.id, 'comp'),
      bassActive: inLineup('bass') && roleInArr(s.id, 'bass'),
      leadReservedLow: reservedReg.lowMidi,
      leadReservedHigh: reservedReg.highMidi,
    });
  }

  // pad 先于 comp【渲染】:收每 span 占用绝对音高 → comp 据此让位(避 unison)。
  //   但【输出轨序】仍为 bass/comp/pad/drum/lead(顺序仅装饰,通道按 role 分配)。
  const padOccupiedPitchesBySpan: Record<string, number[]> = {};
  let padTrack: TrackIR | undefined;
  if (inLineup('pad')) {
    // ★ pad 铺法二选一(一首一掷,确定性):~40% 走 pedal anchor(整段共同音/主音长 pedal + 动声部),
    //   ~60% 现有逐和弦选音。padStyle 子流独立 → 不扰其它决策。
    const pedalAnchor = rng.substream('padStyle').next() < PAD_PEDAL_ANCHOR_PROB;
    padTrack = renderPad(plan, timebase, { padDensity: band.styleProfile.padDensity, decisionBySection: padDecisionBySection, leadReservedLow: reservedReg.lowMidi, pedalAnchor, tonicPc: band.key as number });
    // ★ comp 避同绝对音高:只针对 pad 的【逐和弦音】(覆盖正好 1 span,会随和弦重新起音 → 可能与 comp hit 撞 unison)。
    //   一切【持续音】(tie 共同音 / pedal anchor,覆盖 ≥2 span)不让 comp 避——软持续 pad 上叠 comp 是加厚不是
    //   mud,且强行避会让 comp 整段/稀疏段丢掉该音高 = 过稀(实测 intro pedal 掏空 comp)。
    const spanRanges = plan.chordTimeline.map((span) => {
      const lo = timebase.beatToTick(span.startBeat) as number;
      return { id: span.id, lo, hi: lo + (timebase.beatToTick(span.durationBeats) as number) };
    });
    for (const n of padTrack.notes) {
      const ns = n.startTick as number;
      const ne = ns + (n.durationTicks as number);
      const covered = spanRanges.filter((r) => ns < r.hi && ne > r.lo);
      if (covered.length === 1) (padOccupiedPitchesBySpan[covered[0].id] ??= []).push(n.pitch as number); // 仅逐和弦音
    }
  }

  const tracks: TrackIR[] = [];
  if (inLineup('bass')) tracks.push(renderBass(plan, timebase, band.style, textureSchedule));
  if (inLineup('comp')) tracks.push(...renderAccompaniment(plan, timebase, { style: band.style, anchorBeats, activeSectionIds, voicingSaferSpans, compProgram: band.roleProgram.comp, sectionRoleById, voicingRng: rng.substream('accompaniment'), textureSchedule, melodyFloorMidi: reservedReg.lowMidi, padCompDecisionBySection: padDecisionBySection, padOccupiedPitchesBySpan }));
  if (padTrack) tracks.push(padTrack);
  if (inLineup('drum')) tracks.push(renderDrums(plan, timebase, beatsPerBarOf(arrangement.meter), { style: band.style, fillBars, bigFillBars: leadInBars, textureSchedule, patternBySection: instrumentation.drumPatternBySection }));
  // ★ lead 主链 = MG 旋律链(decision C/B/1);读冻结 HarmonicPlan,走独立 'melody' 子流(确定性)。
  //   多轨层(gateByDensity/ducking/CC7)原样包住。
  tracks.push(renderMgMelody(plan, band, timebase, rng.substream('melody'))); // lead 必有(MG 链)

  // ★ A2 编曲密度弧:按 activeRolesBySection 丢掉非在场段的音(intro 稀疏 / chorus 全员 / breakdown 抽离)。
  //   在 occupation/auditor 之前 → 下游看到真实稀疏编曲。lead 恒在场不被丢。
  // ★ Loop E:transitionPlan 的 lead-in pickup → prepBar 内授权角色保护窗口(不被上一段 gate 删除)。
  const barTicksGate = beatsPerBarOf(arrangement.meter) * timebase.ppq;
  const pickupWindows = instrumentation.transitionPlan.boundaries
    .filter((b) => b.protectPickupFromGate && b.pickupRoles.length > 0)
    .map((b) => ({ lo: b.prepBar * barTicksGate, hi: (b.prepBar + 1) * barTicksGate, roles: new Set<string>(b.pickupRoles as readonly string[]) }));
  const gatedTracks = gateByDensity(tracks, plan, timebase, instrumentation.activeRolesBySection, pickupWindows);

  // Accompaniment → OccupationMap → Resolver(best-effort)→ 单点 freeze → Auditor
  const reserved = {
    lowMidi: instrumentation.melodyReservationPlan.reservedRegister.lowMidi,
    highMidi: instrumentation.melodyReservationPlan.reservedRegister.highMidi,
  };
  const occupation = buildOccupationMap(gatedTracks, reserved);
  const draft: MusicalIRData = {
    tracks: gatedTracks,
    timebase,
    durationTicks: ticks(totalDurationTicks(plan, timebase)),
  };
  const resolved = resolveInteractions(draft, occupation);

  // dynamics:力度随段落能量(chorus 强 / intro 弱 / 高潮峰)
  const energyRanges: EnergyRange[] = [];
  let dynCursor = 0;
  const bpbDyn = beatsPerBarOf(arrangement.meter);
  for (const s of arrangement.sections) {
    energyRanges.push({ lo: dynCursor, hi: dynCursor + s.bars * bpbDyn, energy: arrangement.energyBySection[s.id] ?? 0.5 });
    dynCursor += s.bars * bpbDyn;
  }
  // ★ 伴奏 ducking:comp 撞旋律时【极轻压 ×0.9】(只给旋律一点空间,不把 comp 压下去)。
  //   用户要 lead/伴奏均衡 → ducking 放轻(重压会和'均衡'相反);均衡主要靠 CC7 推子压平。
  const duckedTracks = duckUnderLead(resolved.data.tracks, 0.9);
  const dynamicTracks = applyDynamics(duckedTracks, energyRanges, timebase.ppq);

  // ★ 段落边界手势(Arranger 下发 → 器配 endingPlan / entryBySection 投影):
  //   收尾 cold button / fade 渐弱+错退 / tag 末和弦延留;lead-in 跃升段前末小节 crescendo 推进下拍。
  const bpbEdge = beatsPerBarOf(arrangement.meter);
  const endedTracks = applyEnding(dynamicTracks, arrangement, instrumentation.endingPlan, timebase.ppq, bpbEdge);
  const ledTracks = applyLeadIns(endedTracks, leadInBars, timebase.ppq, bpbEdge);

  // 人性化(5.3):力度 metric accent + 微随机(鼓除外,保 groove)→ swing → 微时序抖动
  const bpbHuman = beatsPerBarOf(arrangement.meter);
  const humanRng = rng.substream('humanize');
  const accentedTracks = humanizeVelocity(ledTracks, timebase.ppq, bpbHuman, humanRng);

  // feel:swing 落地(全轨统一 onset warp;直则原样)
  const swungTracks = applySwing(accentedTracks, timebase.ppq, arrangement.feel.swingRatio);

  // ★ 和声审计在【微时序之前】:Auditor 判和声落点用乐句网格起音,微抖动属网格下层、
  //   不应被和声判定(±少量 tick 跨和弦边界会误暴露 avoid)。审计过后再施加抖动产出可听 IR。
  const auditedIR = freezeMusicalIR({ tracks: swungTracks, timebase, durationTicks: resolved.data.durationTicks });
  const audit = auditHarmony(auditedIR, plan, timebase, {
    keyRootPc: band.key,
    globalMode: band.mode,
    isModalContext: band.tonalityKind === 'modal',
    scaleName: band.modalModeName,
    tonalCharacter: band.tonalityKind === 'modal' ? 'modal' : 'tonal',
  });

  // ★ Loop F 结构锚点:段落起始 tick + 曲首 0 + 末主音下拍(末和弦起) → humanizeTiming 对这些 tick 不做负向 jitter。
  const anchorTicks = new Set<number>([0]);
  let anchorCursor = 0;
  for (const s of arrangement.sections) {
    anchorTicks.add(timebase.beatToTick(beats(anchorCursor)) as number);
    anchorCursor += s.bars * bpbHuman;
  }
  if (plan.chordTimeline.length) anchorTicks.add(timebase.beatToTick(plan.chordTimeline[plan.chordTimeline.length - 1].startBeat) as number);

  // 微时序抖动:swing/审计之后,人手不踩死网格(±少量 tick)→ 最终可听 IR
  // ★ 槽位共享 + metric 缩放:同 tick 跨声部同偏移(对拍不散)、下拍近锚定(重心稳)。结构锚点不负偏(Loop F)。
  const humanizedTracks = humanizeTiming(swungTracks, timebase.ppq, bpbHuman, humanRng, undefined, anchorTicks);
  // ★ 末步挂乐器音色:按器配的 programByRoleSection 落 program(初始)+ programChanges(段落切换)。
  //   段落起始 tick(累加 bars),变化点才发 programChange(同 channel = 同一乐手换声音)。
  const bpbProg = beatsPerBarOf(arrangement.meter);
  const sectionTicks: { id: string; tick: number }[] = [];
  let secBeatCursor = 0;
  for (const s of arrangement.sections) {
    sectionTicks.push({ id: s.id, tick: timebase.beatToTick(beats(secBeatCursor)) as number });
    secBeatCursor += s.bars * bpbProg;
  }
  // ★ CC64 踏板:POP/LOFI/RNB 的 comp 每和弦踩(音尾 ring 融合);其它风格不踩(清晰)。
  const compPedal = PEDAL_STYLES.includes(band.style.toLowerCase()) ? buildCompPedal(plan, timebase) : undefined;
  const finalTracks = humanizedTracks.map((t) => {
    const bySection = instrumentation.programByRoleSection[t.role];
    const fallback = band.roleProgram[t.role];
    const pedalEvents = t.role === 'comp' ? compPedal : undefined;
    if (!bySection) return { ...t, program: fallback, pedalEvents };
    let initial = fallback;
    let prev: number | undefined;
    const changes: { atTick: Ticks; program: number }[] = [];
    for (const { id, tick } of sectionTicks) {
      const prog = bySection[id] ?? fallback;
      if (prev === undefined) { initial = prog; prev = prog; }
      else if (prog !== prev) { changes.push({ atTick: ticks(tick), program: prog }); prev = prog; }
    }
    return { ...t, program: initial, programChanges: changes.length ? changes : undefined, pedalEvents };
  });
  const ir = freezeMusicalIR({ tracks: finalTracks, timebase, durationTicks: resolved.data.durationTicks });
  // ★ Loop H:音乐性审计(只读 warning)追加进 audit。GenerationController 仅 error/fatal 重跑 → warning 接受不重跑。
  const musicality = auditMusicality(ir, arrangement, instrumentation, timebase, band.style);
  return { ir, audit: { findings: [...audit.findings, ...musicality.findings] } };
}
