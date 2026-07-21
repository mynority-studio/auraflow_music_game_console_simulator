import { describe, it, expect } from 'vitest';
import { generateMusicSync } from './MusicGenerationService';
import { musicalIRToMidiEvents, roomWetFor } from '../../audio/musicalIrToMidi';
import { ACG_PIANOSONG_PIANO_VOICES } from '../../sound/GMBK5X128Voices';
import type { BandParticipantSelection } from './types';

// ============================================================
// ACG comp track 硬合同(acg_comp_track_hard_contract_directive.md,P0)
// ------------------------------------------------------------
// ACG = 键盘写作模型:lead(旋律)+ comp(独立键盘伴奏)+ bass。即便同 GM program 也必须是两条轨/两通道。
// Band Selection 不能删掉 comp;ACG 核心不含 drum(P0)。
// ============================================================

const acg = (bandParticipants?: BandParticipantSelection[]) =>
  generateMusicSync({ seed: 0, styleHint: 'acg', mood: 'build', targetDuration: 90, ...(bandParticipants ? { bandParticipants } : {}) });

const track = (r: ReturnType<typeof acg>, role: string) => r.ir!.tracks.find((t) => t.role === role);
const acgPianoAddresses = new Set(ACG_PIANOSONG_PIANO_VOICES.map((voice) => `${voice.bank}/${voice.program}`));
const addressOf = (t: { bank?: number; program?: number }) => `${t.bank ?? 0}/${t.program ?? -1}`;

describe('musicGeneration/acgCompHardContract · §6.1 默认 ACG 有独立 lead + comp', () => {
  it('UI 默认 120 秒请求的已失败 seed 都能产出可播放 IR', () => {
    // PipelineMonitor → runPipeline 的生产参数就是 targetDuration=120。
    // 这些 seed 曾因 return lift-riff 的 pickup/approach 落在强拍或跨和弦
    // 而被 lead harmony audit fail-close，UI 因此显示“音乐生成失败”。
    for (const seed of [2, 8, 23, 33, 46, 54, 63, 69, 93, 100]) {
      const result = generateMusicSync({ seed, styleHint: 'acg', mood: 'build', targetDuration: 120 });
      expect(result.status, `seed ${seed} generation`).not.toBe('failed');
      expect(result.ir, `seed ${seed} IR`).toBeDefined();
    }
  });

  it('8 seeds:lead/comp/bass 三轨齐;comp 有真实音符;三轨同属同一架白名单钢琴但分轨', () => {
    const selectedAddresses = new Set<string>();
    // 覆盖四个现代 GM 权重槽：0/0、0/1、0/2、8/4。
    for (const seed of [0, 1, 2, 7, 11, 14, 21, 27]) {
      const r = generateMusicSync({ seed, styleHint: 'acg', mood: 'build', targetDuration: 90 });
      expect(r.status, `seed ${seed} generation`).not.toBe('failed');
      const roles = new Set(r.ir!.tracks.map((t) => t.role));
      expect(roles.has('lead'), `seed ${seed} lead`).toBe(true);
      expect(roles.has('comp'), `seed ${seed} comp`).toBe(true);
      expect(roles.has('bass'), `seed ${seed} bass`).toBe(true);

      const lead = r.ir!.tracks.find((t) => t.role === 'lead')!;
      const comp = r.ir!.tracks.find((t) => t.role === 'comp')!;
      const bass = r.ir!.tracks.find((t) => t.role === 'bass')!;
      expect(lead.notes.length, `seed ${seed} lead notes`).toBeGreaterThan(0);
      expect(comp.notes.length, `seed ${seed} comp notes`).toBeGreaterThan(0);
      const address = addressOf(lead);
      expect(acgPianoAddresses.has(address), `seed ${seed} ACG voice ${address}`).toBe(true);
      expect(addressOf(comp), `seed ${seed} comp`).toBe(address);
      expect(addressOf(bass), `seed ${seed} bass`).toBe(address);
      expect(lead.programChanges ?? [], `seed ${seed} lead 不段间切琴`).toHaveLength(0);
      expect(comp.programChanges ?? [], `seed ${seed} comp 不段间切琴`).toHaveLength(0);
      expect(bass.programChanges ?? [], `seed ${seed} bass 不段间切琴`).toHaveLength(0);
      selectedAddresses.add(address);
      expect(lead.role).not.toBe(comp.role);
      expect(lead).not.toBe(comp); // 两个独立 TrackIR 对象
      // ACG 核心不含 drum(P0)
      expect(roles.has('drum'), `seed ${seed} 无 drum`).toBe(false);

      // §5.4:UI snapshot 把 lead / comp 作为各自独立 roster 行(即便都是 Acoustic Grand 也不合并)
      const rosterRoles = r.uiSnapshot.roster.map((p) => p.role);
      expect(rosterRoles).toContain('lead');
      expect(rosterRoles).toContain('comp');
    }
    expect(selectedAddresses.size, '至少应选到一个现代 GM 钢琴颜色').toBeGreaterThan(0);
    for (const address of selectedAddresses) expect(acgPianoAddresses.has(address), address).toBe(true);
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

describe('musicGeneration/acgCompHardContract · §6.3 同钢琴 program 不合并 lead/comp/bass', () => {
  it('lead/comp/bass 分通道，但同一 CC0+program 的钢琴且只复位默认控制器', () => {
    // seed 27 命中 CC0=8 / PC4 Soft Electric Piano，直接验证非零 bank 被发到 MIDI。
    const r = generateMusicSync({ seed: 27, styleHint: 'acg', mood: 'build', targetDuration: 90 });
    const events = musicalIRToMidiEvents(r.ir!, roomWetFor('acg'), 'acg');
    const noteOnCh = (ch: number) => events.filter((e) => e.type === 'noteOn' && e.channel === ch);
    const cc0Ch = (ch: number) => events.filter((e) => e.type === 'cc' && e.channel === ch && e.data1 === 0);
    const progCh = (ch: number) => events.filter((e) => e.type === 'programChange' && e.channel === ch);
    const lead = track(r, 'lead')!;
    const comp = track(r, 'comp')!;
    const bass = track(r, 'bass')!;

    expect(noteOnCh(1).length, 'lead noteOn @ch1').toBeGreaterThan(0);
    expect(noteOnCh(2).length, 'comp noteOn @ch2').toBeGreaterThan(0);
    expect(noteOnCh(3).length, 'piano left hand noteOn @ch3').toBeGreaterThan(0);
    expect(addressOf(lead)).toBe(addressOf(comp));
    expect(addressOf(bass)).toBe(addressOf(lead));
    expect(addressOf(lead)).toBe('8/4');
    expect(progCh(1).every((e) => e.data1 === lead.program)).toBe(true);
    expect(progCh(2).every((e) => e.data1 === comp.program)).toBe(true);
    expect(progCh(3).every((e) => e.data1 === bass.program)).toBe(true);
    expect(cc0Ch(1).some((e) => e.data2 === (lead.bank ?? 0))).toBe(true);
    expect(cc0Ch(2).some((e) => e.data2 === (comp.bank ?? 0))).toBe(true);
    expect(cc0Ch(3).some((e) => e.data2 === (bass.bank ?? 0))).toBe(true);
    expect(events.filter((e) => e.type === 'cc' && e.channel === 1).every((e) => [0, 121].includes(e.data1))).toBe(true);
    expect(events.filter((e) => e.type === 'cc' && e.channel === 2).every((e) => [0, 121].includes(e.data1))).toBe(true);
    expect(events.filter((e) => e.type === 'cc' && e.channel === 3).every((e) => [0, 121].includes(e.data1))).toBe(true);
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
