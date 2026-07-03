// ============================================================
// Phase 2 等价证明:applyBassPatternSchedule(intent 源)=== enforceBassDensityFloor(finalEventProfile 源)
// ------------------------------------------------------------
// 证明 enforce 翻转【安全】:schedule 路径与现行 floor 逐字节相同。两处共用 addRootAnchorFloor 核心,只 floorBeats 来源不同;
// 本测锁 ① family→beats 映射 == finalEventProfile.bassFloorBeats ② 同 rawBass 下两函数输出逐字节相同。
// ============================================================

import { describe, it, expect } from 'vitest';
import { enforceBassDensityFloor, type SectionLike } from './bassDensityFloor';
import { applyBassPatternSchedule, FAMILY_FLOOR_BEATS } from './bassPatternSchedule';
import { deriveMusicIntentPlan } from '../arranger/deriveMusicIntentPlan';
import { finalEventProfile } from '../knowledge/finalEventProfile';
import { bassFamilyFromFloorBeats } from '../knowledge/styleIntentProfiles';
import { midi, ticks } from '../foundation';
import type { NoteIR, TrackIR } from '../ir/MusicalIR';
import type { HarmonicPlan } from '../harmony/HarmonicPlan';
import type { ArrangementPlan } from '../arranger/ArrangementPlan';

const PPQ = 480, BPB = 4;
const ev = (ns: readonly NoteIR[]) => ns.map((n) => `${n.pitch as number}@${n.startTick as number}:${n.durationTicks as number}:${n.velocity}`).join('|');

const sections: SectionLike[] = [{ role: 'intro', bars: 2 }, { role: 'verse', bars: 4 }, { role: 'chorus', bars: 4 }, { role: 'outro', bars: 2 }];
const TOTAL_BARS = 12;
const plan = {
  chordTimeline: Array.from({ length: TOTAL_BARS }, (_, b) => ({ id: `s${b}`, rootPc: (b * 5) % 12, startBeat: b * BPB, durationBeats: BPB })),
} as unknown as HarmonicPlan;
// 稀疏 rawBass:每小节头一个音(模拟纹理 bass ~1/bar)。
const rawBass = {
  role: 'bass', program: 33,
  notes: Array.from({ length: TOTAL_BARS }, (_, b) => ({ pitch: midi(40), startTick: ticks(b * BPB * PPQ), durationTicks: ticks(PPQ), velocity: 80 })),
} as unknown as TrackIR;
// deriveMusicIntentPlan 只读 meter/sections(id,role,bars)/energyBySection/songGrooveContractId。
const arrangement = {
  meter: { numerator: 4, denominator: 4 },
  sections: [{ id: 'i', role: 'intro', bars: 2 }, { id: 'v', role: 'verse', bars: 4 }, { id: 'c', role: 'chorus', bars: 4 }, { id: 'o', role: 'outro', bars: 2 }],
  energyBySection: { i: 0.3, v: 0.6, c: 0.9, o: 0.3 },
  songGrooveContractId: 'test',
} as unknown as ArrangementPlan;

const STYLES = ['lofi', 'rnb', 'jazz', 'pop'] as const;

describe('Phase 2 · bass pattern schedule 等价(enforce 翻转安全性)', () => {
  it('① family→floorBeats 映射 === finalEventProfile.bassFloorBeats(逐 style)', () => {
    for (const style of STYLES) {
      const fam = bassFamilyFromFloorBeats(style);
      expect([...FAMILY_FLOOR_BEATS[fam]], `${style}/${fam}`).toEqual([...finalEventProfile(style).bassFloorBeats]);
    }
  });

  it('② applyBassPatternSchedule 输出 === enforceBassDensityFloor(同 rawBass 逐字节)', () => {
    for (const style of STYLES) {
      const intent = deriveMusicIntentPlan(style, arrangement);
      const viaFloor = enforceBassDensityFloor(rawBass, plan, sections, BPB, PPQ, finalEventProfile(style));
      const viaSchedule = applyBassPatternSchedule(rawBass, plan, sections, intent, BPB, PPQ);
      expect(viaSchedule.notes.length, `${style} count`).toBe(viaFloor.notes.length);
      expect(ev(viaSchedule.notes), `${style} events`).toBe(ev(viaFloor.notes));
    }
  });
});
