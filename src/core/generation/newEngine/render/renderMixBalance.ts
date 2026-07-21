// ============================================================
// newEngine · render · RenderMixBalance
// ------------------------------------------------------------
// Final render-stage mix pass: read the fully rendered notes + section mixes,
// then rebalance sparse TrackMix CC7 values for browser preview and ESP32 MIDI
// output. This pass is deterministic, integer-only at the output boundary, and
// never mutates notes, programs, pan, reverb, chorus, or CC automation.
// ============================================================

import { ticks } from '../foundation';
import type { InstrumentRole, TrackIR, TrackMix } from '../ir/MusicalIR';
import { DREAM5504_DEFAULT_CHANNEL_VOLUME, isDream5504DryBaselineStyle } from '../knowledge/gmMixProfile';

interface LeadCompPolicy {
  targetRatio: number;
  minRatio: number;
  maxRatio: number;
  leadRange: [number, number];
  compRange: [number, number];
  compWithoutLeadFloor?: number;
}

export interface RenderMixBalanceContext {
  style: string;
  ppq: number;
  durationTicks: number;
  sectionTicks?: readonly number[];
}

const EPS = 1e-9;
const MAX_SPLIT_SCALE = 1.38;
const MIN_SPLIT_SCALE = 1 / MAX_SPLIT_SCALE;
const GUITAR_COMP_VOLUME_CAP = 58;
const GUITAR_LEAD_VOLUME_CAP = 72;
const MALLET_LEAD_VOLUME_CAP = 74;
// ACG is one scored piano, not three independently amplified instruments.
// Keep a small fixed CC7 margin on the middle/top hands so a grammar-authored
// return dyad can arrive over its rolled comp and left-hand root without
// consuming the hardware drive margin.  Bass deliberately remains untouched:
// it is the piano score's harmonic root rather than an optional backing bus.
// This is a TrackMix/output contract only; it never rewrites PianoScorePlan
// NoteIR (pitch, timing, count, or duration).
// True score-authored blocks can now coincide with lead dyads.  Leave a
// little more CC7 margin than the old all-roll arrangement so that the same
// note score remains safe on the shared hardware output bus.
const ACG_PIANO_UPPER_HAND_HEADROOM_SCALE = 0.92;

const POLICY: Record<string, LeadCompPolicy> = {
  // YD3411 小喇叭中频效率高:让 comp+lead 做前景,利用钢琴/和声主体频段,而不是把能量交给鼓/pad。
  // 2026-07-13:Q+R 与 Q+H 同链路试听后,lead 需要再稍微站前一点。只抬前景比例和 lead 下限,
  // 不提高 CC7 上限,避免浏览器/ESP32 端进入削波;comp caps 仍在后面保护吉他和 GM5 电钢。
  pop:  { targetRatio: 1.14, minRatio: 0.88, maxRatio: 1.85, leadRange: [78, 100], compRange: [72, 94] },
  jazz: { targetRatio: 1.24, minRatio: 0.95, maxRatio: 2.45, leadRange: [86, 100], compRange: [78, 94] },
  lofi: { targetRatio: 1.14, minRatio: 0.92, maxRatio: 1.90, leadRange: [78, 100], compRange: [70, 94] },
  rnb:  { targetRatio: 1.14, minRatio: 0.92, maxRatio: 1.75, leadRange: [86, 100], compRange: [64, 84] },
  // ★ P2 mg fidelity:ACG = melody-first(旋律浮上,comp 是空气 pp)。旧策略 comp-forward(0.90/comp CC7 80-98)
  //   与 normalizeAcgDynamics(lead86/comp29)直接矛盾 → 会 boost comp CC7 抢回,抵消 pp 意图。改成 lead-forward:
  //   lead CC7 高、comp CC7 中(air 但仍可闻),ratio 允许强 lead-forward(velocity 秩序天然使 lead≫comp)。
  // ACG phrase scoring now permits a real vertical arrival under a lead dyad;
  // unlike the old all-roll bed, that can briefly stack several middle-hand
  // voices at the same tick.  Reserve output headroom by keeping the middle
  // hand below the top-line ceiling in dense sections.  This is CC7-only
  // hardware protection, not a NoteIR carve: the authored block still sounds
  // as a block and the lead remains the top piano hand.
  // The lower middle-hand bound is deliberately 80 (not 82): after the
  // shared-piano headroom trim that remains a 92/74 top/middle split.  It
  // keeps a sustained four-note middle block from overtaking an active
  // cantabile top line while remaining comfortably audible as the piano's
  // inner voice.
  acg:  { targetRatio: 1.40, minRatio: 1.05, maxRatio: 4.50, leadRange: [86, 100], compRange: [80, 92] },
};

const DEFAULT_POLICY: LeadCompPolicy = {
  targetRatio: 1.14,
  minRatio: 0.90,
  maxRatio: 1.80,
  leadRange: [84, 100],
  compRange: [74, 94],
};

const JAZZ_SAX_POLICY: LeadCompPolicy = {
  targetRatio: 1.45,
  minRatio: 0.95,
  maxRatio: 3.80,
  // YD3411 小喇叭目标实测:GM67 五音 CC84≈-32dBFS RMS,CC64≈-34.4dBFS RMS。
  // sax 仍是 jazz lead,但不再强制 CC100；旋律进来后允许 comp 自动退到实测 CC64，
  // opening/尾奏没有 sax 时仍保留原始 comp CC7，不把钢琴床一起压没。
  leadRange: [84, 88],
  compRange: [64, 94],
  compWithoutLeadFloor: 78,
};

function isSaxProgram(program: number | undefined): boolean {
  return program !== undefined && program >= 64 && program <= 67;
}

function policyFor(style: string, leadProgram?: number): LeadCompPolicy {
  if ((style ?? '').toLowerCase() === 'jazz' && isSaxProgram(leadProgram)) return JAZZ_SAX_POLICY;
  return POLICY[(style ?? '').toLowerCase()] ?? DEFAULT_POLICY;
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function sameMix(a: TrackMix | undefined, b: TrackMix | undefined): boolean {
  return !!a && !!b
    && a.volume === b.volume
    && a.pan === b.pan
    && a.reverb === b.reverb
    && a.chorus === b.chorus
    && (a.expression ?? -1) === (b.expression ?? -1)
    && (a.delay ?? -1) === (b.delay ?? -1);
}

function mixAt(track: TrackIR, tick: number): TrackMix | undefined {
  let out = track.mix;
  for (const mc of track.mixChanges ?? []) {
    if ((mc.atTick as number) <= tick) out = mc.mix;
    else break;
  }
  return out;
}

function programAt(track: TrackIR, tick: number): number | undefined {
  let out = track.program;
  for (const pc of track.programChanges ?? []) {
    if ((pc.atTick as number) <= tick) out = pc.program;
    else break;
  }
  return out;
}

function isGuitarProgram(program: number | undefined): boolean {
  return program !== undefined && program >= 24 && program <= 31;
}

function isMalletLeadProgram(program: number | undefined): boolean {
  return program === 11 || program === 12 || program === 107 || program === 108;
}

function capMixForTrack(track: TrackIR, tick: number, mix: TrackMix, style: string): TrackMix {
  if (isDream5504DryBaselineStyle(style)) {
    return {
      ...mix,
      volume: DREAM5504_DEFAULT_CHANNEL_VOLUME,
      reverb: 0,
      chorus: 0,
      ...(mix.delay === undefined ? {} : { delay: 0 }),
    };
  }
  let out = mix;
  if ((style ?? '').toLowerCase() === 'acg' && (track.role === 'comp' || track.role === 'lead')) {
    out = { ...out, volume: clampInt(out.volume * ACG_PIANO_UPPER_HAND_HEADROOM_SCALE, 0, 127) };
  }
  if (track.role !== 'comp' && track.role !== 'lead') return out;
  const program = programAt(track, tick);
  if (track.role === 'lead' && isGuitarProgram(program)) {
    const volume = Math.min(out.volume, GUITAR_LEAD_VOLUME_CAP);
    return volume === out.volume ? out : { ...out, volume };
  }
  if (track.role === 'lead' && isMalletLeadProgram(program)) {
    const volume = Math.min(out.volume, MALLET_LEAD_VOLUME_CAP);
    return volume === out.volume ? out : { ...out, volume };
  }
  if (track.role !== 'comp') return out;
  const cap = isGuitarProgram(program) ? GUITAR_COMP_VOLUME_CAP : undefined;
  if (cap === undefined) return out;
  const volume = Math.min(out.volume, cap);
  return volume === out.volume ? out : { ...out, volume };
}

function boundaryTicks(tracks: readonly TrackIR[], ctx: RenderMixBalanceContext): number[] {
  const set = new Set<number>([0, ctx.durationTicks]);
  for (const t of ctx.sectionTicks ?? []) set.add(Math.max(0, Math.min(ctx.durationTicks, t)));
  for (const tr of tracks) {
    for (const mc of tr.mixChanges ?? []) set.add(Math.max(0, Math.min(ctx.durationTicks, mc.atTick as number)));
    for (const pc of tr.programChanges ?? []) set.add(Math.max(0, Math.min(ctx.durationTicks, pc.atTick as number)));
    // Lead/comp 的真实出入场也属于稀疏 CC7 边界。否则 opening 里只有 comp 的数拍会和
    // 后续 lead+comp 共用一个音量，既无法保住前奏，也无法在主奏进入时让伴奏后退。
    if ((ctx.style ?? '').toLowerCase() === 'jazz' && (tr.role === 'lead' || tr.role === 'comp') && tr.notes.length > 0) {
      const first = Math.min(...tr.notes.map((note) => note.startTick as number));
      const last = Math.max(...tr.notes.map((note) => (note.startTick as number) + (note.durationTicks as number)));
      set.add(Math.max(0, Math.min(ctx.durationTicks, first)));
      set.add(Math.max(0, Math.min(ctx.durationTicks, last)));
    }
  }
  return [...set].filter((t) => t >= 0 && t <= ctx.durationTicks).sort((a, b) => a - b);
}

function mandatoryMixTicks(track: TrackIR): Set<number> {
  return new Set((track.programChanges ?? []).map((pc) => pc.atTick as number));
}

function dryEnergyPerBeat(track: TrackIR, loTick: number, hiTick: number, ppq: number): number {
  const segBeats = Math.max(EPS, (hiTick - loTick) / ppq);
  let sum = 0;
  for (const n of track.notes) {
    const ns = n.startTick as number;
    const ne = ns + (n.durationTicks as number);
    const lo = Math.max(loTick, ns);
    const hi = Math.min(hiTick, ne);
    if (hi <= lo) continue;
    const durBeats = (hi - lo) / ppq;
    sum += Math.pow(n.velocity / 127, 2) * durBeats;
  }
  return sum / segBeats;
}

function wetEnergyFromDry(dryEnergy: number, volume: number): number {
  return dryEnergy * Math.pow(volume / 127, 2);
}

function adjustLeadCompVolumes(
  leadMix: TrackMix,
  compMix: TrackMix,
  leadDry: number,
  compDry: number,
  policy: LeadCompPolicy,
): { lead: TrackMix; comp: TrackMix } {
  let leadVolume = clampInt(leadMix.volume, policy.leadRange[0], policy.leadRange[1]);
  const compFloor = leadDry <= EPS && policy.compWithoutLeadFloor !== undefined
    ? Math.max(policy.compRange[0], policy.compWithoutLeadFloor)
    : policy.compRange[0];
  let compVolume = clampInt(compMix.volume, compFloor, policy.compRange[1]);

  const leadEnergy = wetEnergyFromDry(leadDry, leadVolume);
  const compEnergy = wetEnergyFromDry(compDry, compVolume);
  const ratio = leadEnergy / Math.max(EPS, compEnergy);

  if (leadDry > EPS && compDry > EPS && (ratio < policy.minRatio || ratio > policy.maxRatio)) {
    const splitScale = clampInt(Math.pow(policy.targetRatio / Math.max(EPS, ratio), 0.25) * 1000, Math.round(MIN_SPLIT_SCALE * 1000), Math.round(MAX_SPLIT_SCALE * 1000)) / 1000;
    leadVolume = clampInt(leadVolume * splitScale, policy.leadRange[0], policy.leadRange[1]);
    compVolume = clampInt(compVolume / splitScale, policy.compRange[0], policy.compRange[1]);
  }

  return {
    lead: { ...leadMix, volume: leadVolume },
    comp: { ...compMix, volume: compVolume },
  };
}

export function trackWetEnergyPerBeat(track: TrackIR | undefined, ctx: RenderMixBalanceContext): number {
  if (!track || !track.mix) return 0;
  const bounds = boundaryTicks([track], ctx);
  let sum = 0;
  let beats = 0;
  for (let i = 0; i < bounds.length - 1; i++) {
    const lo = bounds[i], hi = bounds[i + 1];
    if (hi <= lo) continue;
    const mix = mixAt(track, lo);
    if (!mix) continue;
    const segBeats = (hi - lo) / ctx.ppq;
    sum += wetEnergyFromDry(dryEnergyPerBeat(track, lo, hi, ctx.ppq), mix.volume) * segBeats;
    beats += segBeats;
  }
  return beats > 0 ? sum / beats : 0;
}

export function leadCompWetEnergyRatio(tracks: readonly TrackIR[], ctx: RenderMixBalanceContext): number {
  const lead = tracks.find((t) => t.role === 'lead');
  const comp = tracks.find((t) => t.role === 'comp');
  return trackWetEnergyPerBeat(lead, ctx) / Math.max(EPS, trackWetEnergyPerBeat(comp, ctx));
}

export function applyRenderMixBalance(tracks: readonly TrackIR[], ctx: RenderMixBalanceContext): TrackIR[] {
  // Dream 四个正式多轨风格不做音色/角色 CC7 校平：每次音色进入通道都明确
  // 恢复 Firm5504-EK 默认 CC7=100。这里只保留 tick 0 和真正 Program Change
  // 同拍的刷新；段落表情由力度与 CC11 承担，杜绝通道推子随段落跳变。
  if (isDream5504DryBaselineStyle(ctx.style)) {
    return tracks.map((track) => {
      const initialRaw = mixAt(track, 0) ?? track.mix;
      const initialMix = initialRaw ? capMixForTrack(track, 0, initialRaw, ctx.style) : undefined;
      if (!initialMix) return { ...track };

      const mixChanges = (track.programChanges ?? [])
        .filter((change) => (change.atTick as number) > 0 && (change.atTick as number) < ctx.durationTicks)
        .map((change) => {
          const tick = change.atTick as number;
          const exactMix = track.mixChanges?.find((mixChange) => (mixChange.atTick as number) === tick)?.mix;
          const rawMix = exactMix ?? mixAt(track, tick) ?? initialMix;
          return { atTick: ticks(tick), mix: capMixForTrack(track, tick, rawMix, ctx.style) };
        });

      return {
        ...track,
        mix: initialMix,
        mixChanges: mixChanges.length ? mixChanges : undefined,
      };
    });
  }

  const bounds = boundaryTicks(tracks, ctx);
  const lead = tracks.find((t) => t.role === 'lead');
  const comp = tracks.find((t) => t.role === 'comp');
  const byTick = new Map<number, Partial<Record<InstrumentRole, TrackMix>>>();

  const setMix = (tick: number, role: InstrumentRole, mix: TrackMix | undefined) => {
    if (!mix) return;
    const row = byTick.get(tick) ?? {};
    row[role] = mix;
    byTick.set(tick, row);
  };

  for (let i = 0; i < bounds.length - 1; i++) {
    const lo = bounds[i], hi = bounds[i + 1];
    if (hi <= lo) continue;
    for (const track of tracks) setMix(lo, track.role, mixAt(track, lo));

    const leadMix = lead ? mixAt(lead, lo) : undefined;
    const compMix = comp ? mixAt(comp, lo) : undefined;
    if (!lead || !comp || !leadMix || !compMix) continue;

    const leadDry = dryEnergyPerBeat(lead, lo, hi, ctx.ppq);
    const compDry = dryEnergyPerBeat(comp, lo, hi, ctx.ppq);
    const adjusted = adjustLeadCompVolumes(leadMix, compMix, leadDry, compDry, policyFor(ctx.style, programAt(lead, lo)));
    setMix(lo, 'lead', adjusted.lead);
    setMix(lo, 'comp', adjusted.comp);
  }

  return tracks.map((track) => {
    const required = mandatoryMixTicks(track);
    const initialMixRaw = byTick.get(0)?.[track.role] ?? track.mix;
    const initialMix = initialMixRaw ? capMixForTrack(track, 0, initialMixRaw, ctx.style) : undefined;
    if (!initialMix) return { ...track };

    const mixChanges: { atTick: ReturnType<typeof ticks>; mix: TrackMix }[] = [];
    let prev = initialMix;
    for (const tick of bounds.slice(1, -1)) {
      const rawMix = byTick.get(tick)?.[track.role];
      const mix = rawMix ? capMixForTrack(track, tick, rawMix, ctx.style) : undefined;
      if (!mix) continue;
      if (required.has(tick) || !sameMix(mix, prev)) {
        mixChanges.push({ atTick: ticks(tick), mix });
        prev = mix;
      }
    }

    return {
      ...track,
      mix: initialMix,
      mixChanges: mixChanges.length ? mixChanges : undefined,
    };
  });
}
