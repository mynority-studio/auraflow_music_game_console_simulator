// ============================================================
// newEngine · render · Bass Density Floor(non_acg_mg_final_event_fidelity §3.3.C/§4.3.A/§5.3.A)
// ------------------------------------------------------------
// 问题:非 ACG 风格纹理 bass 每 span ~1 hit → SIM bass 1-2/bar,MG 2.6-3.8/bar(bass 是 groove/支撑角色,过稀不像 MG)。
// 修:render 层【地板】—— 主体段(非 intro/outro)的强拍位若无 bass event,补一个 root anchor(不删纹理 bass,不碰 comp/lead)。
//   低能量段由下游 dynamics/humanize 按 section energy 降 velocity(directive:降 velocity 不删 event)。
//   地板拍位由 finalEventProfile 按 style 派生(集中策略,不散 if)。ACG 不走这里(有 acgRenderProfile)。
// ============================================================

import { ticks, midi, type Ticks } from '../foundation';
import type { TrackIR, NoteIR } from '../ir/MusicalIR';
import type { HarmonicPlan, ChordSpan } from '../harmony/HarmonicPlan';
import { placeBassMidi } from '../knowledge/pitchPlacement';
import type { FinalEventStyleProfile } from '../knowledge/finalEventProfile';

const BASS_LOW = 28;
const BASS_HIGH = 55;

interface SectionLike { role: string; bars: number }

/** 主体段强拍补 root anchor 到 MG-like 支撑密度。bpb=每小节拍数。纹理 bass/comp/lead 全不动,只加 bass。 */
export function enforceBassDensityFloor(
  bass: TrackIR,
  plan: HarmonicPlan,
  sections: readonly SectionLike[],
  bpb: number,
  ppq: number,
  profile: FinalEventStyleProfile,
): TrackIR {
  const beats = profile.bassFloorBeats;
  if (beats.length === 0 || bass.notes.length === 0) return bass;
  const sortedFb = [...beats].sort((a, b) => a - b);
  const spanAt = (beat: number): ChordSpan | undefined =>
    plan.chordTimeline.find((s) => beat >= (s.startBeat as number) - 1e-6 && beat < (s.startBeat as number) + (s.durationBeats as number) - 1e-6);
  const existing = [...bass.notes].sort((a, b) => (a.startTick as number) - (b.startTick as number));
  // 已有 bass onset(含已补)在 0.4 拍内 → 视为已占,不补(避免撞纹理 bass / 重复补)。
  const onsets: number[] = existing.map((n) => n.startTick as number);
  const occupied = (tick: number) => onsets.some((o) => Math.abs(o - tick) < 0.4 * ppq);
  const added: NoteIR[] = [];
  let prevMidi = (existing[0].pitch as number);
  let secStartBar = 0;
  for (const s of sections) {
    const isFrame = s.role === 'intro' || s.role === 'outro';
    if (!isFrame) {
      for (let bar = 0; bar < s.bars; bar++) {
        const barStartBeat = (secStartBar + bar) * bpb;
        for (let i = 0; i < sortedFb.length; i++) {
          const fb = sortedFb[i];
          if (fb >= bpb) continue;
          const beat = barStartBeat + fb;
          const tick = Math.round(beat * ppq);
          if (occupied(tick)) continue;
          const span = spanAt(beat);
          if (!span) continue;
          const m = placeBassMidi(((span.rootPc as number) % 12 + 12) % 12, prevMidi, BASS_LOW, BASS_HIGH);
          prevMidi = m;
          const nextFb = i < sortedFb.length - 1 ? sortedFb[i + 1] : bpb;
          const durTicks = Math.max(1, Math.round((nextFb - fb) * ppq * 0.9));
          added.push({ pitch: midi(m), startTick: ticks(tick) as Ticks, durationTicks: ticks(durTicks) as Ticks, velocity: 70 });
          onsets.push(tick);
        }
      }
    }
    secStartBar += s.bars;
  }
  if (added.length === 0) return bass;
  return { ...bass, notes: [...bass.notes, ...added].sort((a, b) => (a.startTick as number) - (b.startTick as number) || (a.pitch as number) - (b.pitch as number)) };
}
