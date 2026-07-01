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

interface LeadCompPolicy {
  targetRatio: number;
  minRatio: number;
  maxRatio: number;
  leadRange: [number, number];
  compRange: [number, number];
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

const POLICY: Record<string, LeadCompPolicy> = {
  pop:  { targetRatio: 1.15, minRatio: 0.75, maxRatio: 1.55, leadRange: [78, 100], compRange: [70, 90] },
  jazz: { targetRatio: 1.18, minRatio: 0.90, maxRatio: 1.60, leadRange: [80, 100], compRange: [72, 90] },
  lofi: { targetRatio: 1.00, minRatio: 0.70, maxRatio: 1.45, leadRange: [70, 96], compRange: [68, 94] },
  rnb:  { targetRatio: 1.00, minRatio: 0.75, maxRatio: 1.35, leadRange: [82, 100], compRange: [54, 78] },
  acg:  { targetRatio: 0.90, minRatio: 0.60, maxRatio: 1.35, leadRange: [68, 84], compRange: [80, 98] },
};

const DEFAULT_POLICY: LeadCompPolicy = {
  targetRatio: 1.15,
  minRatio: 0.80,
  maxRatio: 1.55,
  leadRange: [78, 100],
  compRange: [70, 92],
};

function policyFor(style: string): LeadCompPolicy {
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
    && (a.expression ?? -1) === (b.expression ?? -1);
}

function mixAt(track: TrackIR, tick: number): TrackMix | undefined {
  let out = track.mix;
  for (const mc of track.mixChanges ?? []) {
    if ((mc.atTick as number) <= tick) out = mc.mix;
    else break;
  }
  return out;
}

function boundaryTicks(tracks: readonly TrackIR[], ctx: RenderMixBalanceContext): number[] {
  const set = new Set<number>([0, ctx.durationTicks]);
  for (const t of ctx.sectionTicks ?? []) set.add(Math.max(0, Math.min(ctx.durationTicks, t)));
  for (const tr of tracks) {
    for (const mc of tr.mixChanges ?? []) set.add(Math.max(0, Math.min(ctx.durationTicks, mc.atTick as number)));
    for (const pc of tr.programChanges ?? []) set.add(Math.max(0, Math.min(ctx.durationTicks, pc.atTick as number)));
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
  let compVolume = clampInt(compMix.volume, policy.compRange[0], policy.compRange[1]);

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
  const bounds = boundaryTicks(tracks, ctx);
  const policy = policyFor(ctx.style);
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
    const adjusted = adjustLeadCompVolumes(leadMix, compMix, leadDry, compDry, policy);
    setMix(lo, 'lead', adjusted.lead);
    setMix(lo, 'comp', adjusted.comp);
  }

  return tracks.map((track) => {
    const required = mandatoryMixTicks(track);
    const initialMix = byTick.get(0)?.[track.role] ?? track.mix;
    if (!initialMix) return { ...track };

    const mixChanges: { atTick: ReturnType<typeof ticks>; mix: TrackMix }[] = [];
    let prev = initialMix;
    for (const tick of bounds.slice(1, -1)) {
      const mix = byTick.get(tick)?.[track.role];
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
