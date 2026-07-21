// ============================================================
// audio · POP five-track MIDI output guard
// ------------------------------------------------------------
// Hardware-only velocity guard for Dream 5504 playback. MusicalIR remains the
// authoritative, unmodified score; only outgoing Note On bytes are limited.
// ============================================================

import type { InstrumentRole } from '../generation/newEngine/ir/MusicalIR';
import type { MidiEvent } from './MidiScheduler';

const CHANNEL_ROLE: Readonly<Record<number, InstrumentRole>> = {
  1: 'lead',
  2: 'comp',
  3: 'bass',
  4: 'pad',
  9: 'drum',
};

export const POP_ROLE_VELOCITY_CAP: Readonly<Record<InstrumentRole, number>> = {
  lead: 108,
  comp: 104,
  bass: 108,
  pad: 72,
  drum: 112,
};

export const POP_ROLE_ONSET_VELOCITY_BUDGET: Readonly<Record<InstrumentRole, number>> = {
  lead: 108,
  comp: 220,
  bass: 108,
  pad: 144,
  drum: 300,
};

export function applyPopFiveTrackMidiGuard(events: readonly MidiEvent[], style: string): MidiEvent[] {
  if ((style ?? '').toLowerCase() !== 'pop') return [...events];

  const out = events.map((event) => ({ ...event }));
  const groups = new Map<string, { role: InstrumentRole; indices: number[] }>();

  out.forEach((event, index) => {
    const role = event.type === 'noteOn' && event.data2 > 0 ? CHANNEL_ROLE[event.channel] : undefined;
    if (!role) return;
    event.data2 = Math.max(1, Math.min(POP_ROLE_VELOCITY_CAP[role], Math.round(event.data2)));
    const key = `${event.ticks}:${event.channel}`;
    const group = groups.get(key) ?? { role, indices: [] };
    group.indices.push(index);
    groups.set(key, group);
  });

  for (const { role, indices } of groups.values()) {
    const budget = POP_ROLE_ONSET_VELOCITY_BUDGET[role];
    const sum = indices.reduce((total, index) => total + out[index].data2, 0);
    if (sum <= budget) continue;

    const scale = budget / sum;
    for (const index of indices) out[index].data2 = Math.max(1, Math.round(out[index].data2 * scale));
    let roundedSum = indices.reduce((total, index) => total + out[index].data2, 0);
    for (const index of [...indices].sort((a, b) => out[b].data2 - out[a].data2)) {
      if (roundedSum <= budget) break;
      if (out[index].data2 <= 1) continue;
      out[index].data2 -= 1;
      roundedSum -= 1;
    }
  }

  return out;
}
