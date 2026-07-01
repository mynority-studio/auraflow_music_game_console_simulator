import { describe, it, expect } from 'vitest';
import { generateMusicSync } from './MusicGenerationService';
import { musicalIRToMidiEvents, roomWetFor } from '../../audio/musicalIrToMidi';
import type { BandParticipantSelection } from './types';

// ============================================================
// ACG comp track 硬合同(acg_comp_track_hard_contract_directive.md,P0)
// ------------------------------------------------------------
// ACG = 钢琴写作模型:lead(旋律)+ comp(独立钢琴伴奏)+ bass。即便同 GM0 也必须是两条轨/两通道。
// Band Selection 不能删掉 comp;ACG 核心不含 drum(P0)。
// ============================================================

const acg = (bandParticipants?: BandParticipantSelection[]) =>
  generateMusicSync({ seed: 0, styleHint: 'acg', mood: 'build', targetDuration: 90, ...(bandParticipants ? { bandParticipants } : {}) });

const track = (r: ReturnType<typeof acg>, role: string) => r.ir!.tracks.find((t) => t.role === role);

describe('musicGeneration/acgCompHardContract · §6.1 默认 ACG 有独立 lead + comp', () => {
  it('8 seeds:lead/comp/bass 三轨齐;comp 有真实音符;同 program 0 但分轨', () => {
    for (let seed = 0; seed < 8; seed++) {
      const r = generateMusicSync({ seed, styleHint: 'acg', mood: 'build', targetDuration: 90 });
      const roles = new Set(r.ir!.tracks.map((t) => t.role));
      expect(roles.has('lead'), `seed ${seed} lead`).toBe(true);
      expect(roles.has('comp'), `seed ${seed} comp`).toBe(true);
      expect(roles.has('bass'), `seed ${seed} bass`).toBe(true);

      const lead = r.ir!.tracks.find((t) => t.role === 'lead')!;
      const comp = r.ir!.tracks.find((t) => t.role === 'comp')!;
      expect(lead.notes.length, `seed ${seed} lead notes`).toBeGreaterThan(0);
      expect(comp.notes.length, `seed ${seed} comp notes`).toBeGreaterThan(0);
      expect(lead.program, `seed ${seed} lead program`).toBe(0);
      expect(comp.program, `seed ${seed} comp program`).toBe(0);
      expect(lead.role).not.toBe(comp.role);
      expect(lead).not.toBe(comp); // 两个独立 TrackIR 对象
      // ACG 核心不含 drum(P0)
      expect(roles.has('drum'), `seed ${seed} 无 drum`).toBe(false);

      // §5.4:UI snapshot 把 lead / comp 作为各自独立 roster 行(即便都是 Acoustic Grand 也不合并)
      const rosterRoles = r.uiSnapshot.roster.map((p) => p.role);
      expect(rosterRoles).toContain('lead');
      expect(rosterRoles).toContain('comp');
    }
  });
});

describe('musicGeneration/acgCompHardContract · §6.2 Band Selection 不能删 ACG comp', () => {
  const cases: Record<string, BandParticipantSelection[]> = {
    'selected drummer': [{ role: 'drummer', state: 'selected' }],
    'keyboardist disabled': [{ role: 'keyboardist', state: 'disabled' }],
    'leadPlayer selected': [{ role: 'leadPlayer', state: 'selected' }],
    'only synthPlayer': [{ role: 'synthPlayer', state: 'selected' }],
  };
  for (const [name, participants] of Object.entries(cases)) {
    it(`${name} → 仍有 lead + comp + bass(comp 有音符)`, () => {
      const r = acg(participants);
      const roles = new Set(r.ir!.tracks.map((t) => t.role));
      expect(roles.has('lead'), `${name} lead`).toBe(true);
      expect(roles.has('comp'), `${name} comp`).toBe(true);
      expect(roles.has('bass'), `${name} bass`).toBe(true);
      expect(track(r, 'comp')!.notes.length, `${name} comp notes`).toBeGreaterThan(0);
    });
  }

  it('selected drummer → lead+comp+bass,P0 不产 drum(不塌成 drum+lead)', () => {
    const r = acg([{ role: 'drummer', state: 'selected' }]);
    const roles = new Set(r.ir!.tracks.map((t) => t.role));
    expect([...roles].sort()).toEqual(expect.arrayContaining(['bass', 'comp', 'lead']));
    expect(roles.has('drum'), 'P0:ACG 不加 drum').toBe(false);
  });
});

describe('musicGeneration/acgCompHardContract · §6.3 同钢琴 program 不合并 lead/comp', () => {
  it('lead noteOn→channel 1,comp noteOn→channel 2,均可 program 0,各自有 CC7', () => {
    const r = acg();
    const events = musicalIRToMidiEvents(r.ir!, roomWetFor('acg'));
    const noteOnCh = (ch: number) => events.filter((e) => e.type === 'noteOn' && e.channel === ch);
    const cc7Ch = (ch: number) => events.filter((e) => e.type === 'cc' && e.channel === ch && e.data1 === 7);
    const progCh = (ch: number) => events.filter((e) => e.type === 'programChange' && e.channel === ch);

    expect(noteOnCh(1).length, 'lead noteOn @ch1').toBeGreaterThan(0);
    expect(noteOnCh(2).length, 'comp noteOn @ch2').toBeGreaterThan(0);
    // 两通道都可用 program 0(同钢琴音色,不同轨)
    expect(progCh(1).every((e) => e.data1 === 0)).toBe(true);
    expect(progCh(2).every((e) => e.data1 === 0)).toBe(true);
    // 各自有独立 CC7 mix
    expect(cc7Ch(1).length, 'ch1 CC7').toBeGreaterThan(0);
    expect(cc7Ch(2).length, 'ch2 CC7').toBeGreaterThan(0);
  });
});

describe('musicGeneration/acgCompHardContract · §6.4 ACG texture 产 comp 非 lead', () => {
  it('comp 是伴奏织体(音符多/有和声厚度),lead 基本单音', () => {
    let sawRichComp = false;
    for (let seed = 0; seed < 6; seed++) {
      const r = generateMusicSync({ seed, styleHint: 'acg', mood: 'build', targetDuration: 90 });
      const lead = r.ir!.tracks.find((t) => t.role === 'lead')!;
      const comp = r.ir!.tracks.find((t) => t.role === 'comp')!;
      expect(comp.notes.length).toBeGreaterThan(4); // 伴奏织体非平凡
      if (comp.notes.length >= lead.notes.length) sawRichComp = true;

      // lead 基本单音:任一 startTick 上同时发声 ≤ 2(不塞多声部伴奏进 lead)
      const byTick = new Map<number, number>();
      for (const n of lead.notes) byTick.set(n.startTick as number, (byTick.get(n.startTick as number) ?? 0) + 1);
      const maxStack = Math.max(0, ...byTick.values());
      expect(maxStack, `seed ${seed} lead 单音性`).toBeLessThanOrEqual(2);
    }
    expect(sawRichComp, '至少一 seed comp 织体密度 ≥ lead').toBe(true);
  });
});
