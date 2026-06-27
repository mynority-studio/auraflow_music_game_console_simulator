import { describe, it, expect } from 'vitest';
import { renderTextureChordHits } from './textureRenderer';
import { renderAccompaniment } from './accompanimentRenderer';
import { buildBandSpec } from '../band/bandEngine';
import { buildArrangementPlan } from '../arranger/arranger';
import { buildHarmonicPlanFromArrangement } from '../harmony/harmonyEngine';
import { createRandomContext, createTimebase, beats, pc } from '../foundation';

// 强制 ACG case 上每个 span,piano comp,可选 needsDownbeat → 测 §5.2/§5.3 集成行为。
function acgComp(seed: number, forceCase: string, needsDownbeat: boolean) {
  const band = buildBandSpec({ seed, styleHint: 'acg', mood: 'build', targetDuration: 96, key: pc(0), mode: 'major' });
  const arr = buildArrangementPlan(band, { rng: createRandomContext(seed) });
  const plan = buildHarmonicPlanFromArrangement(band, arr, createRandomContext(seed));
  const tb = createTimebase({ meter: arr.meter, tempoMap: [{ atBeat: beats(0), bpm: 78 }] });
  const sectionRoleById = Object.fromEntries(arr.sections.map((s) => [s.id, s.role]));
  const schedule: Record<string, string> = {};
  for (const span of plan.chordTimeline) schedule[span.id] = forceCase;
  const needs: Record<string, boolean> = {};
  if (needsDownbeat) for (const s of arr.sections) needs[s.id] = true;
  return renderAccompaniment(plan, tb, {
    style: 'acg', compProgram: 0, sectionRoleById,
    voicingRng: createRandomContext(seed).substream('accompaniment'),
    textureSchedule: schedule, needsDownbeatCompAnchorBySection: needs, melodyFloorMidi: 67,
  })[0];
}

// ============================================================
// ACG comp air — acg_music_fidelity_repair_directive §2.5(★ 2026-06-28 用户按 B:恢复 MG 高空气,反 round1)
// ------------------------------------------------------------
// 设计(MG 久石让钢琴):ACG 织体 = bass gesture + 高位色音/air(>67)+ 软力度 + 有意留白。
// ★ round1(af103f4)曾因「听不见 + 打架」反转成钳到旋律下方 + 大音量;但 fidelity directive §0/§2.5 指出
//   那是【掩盖】上游错配(family/grammar/contract),且 round1 在 D/E/F 修上游【之前】做的。
// ★ 现按 B 恢复:生产 accompanimentRenderer 走【未钳 air voicing】+ 传真和弦 acgCtx(高位色音)+ 软力度;
//   听得见靠 register/mix 分离(soft air halo)非大音量(若仍埋 → ACG 专属 mix 分离,留耳朵复核)。
//   端到端(§5.1)验:ACG comp 保 > 67 高位色音 air;§2.5 非 ACG case 不受影响(门控 isAcgTextureCase)。
// ============================================================

const DUR = 4;
const LOW_VOICED = [48, 52, 55, 59, 62]; // 故意低排(模拟被钳过的 voicing)→ 靠 ctx 出 air
const AIR_CASES = ['Piano_TopVoice_Planing', 'ACG_Quartal_Arp_Wave', 'ACG_Open_Broken_10th', 'ACG_Pedal_Wash_Color_Drops'];
const EXTENDED = [
  { chordType: 'maj9', rootPc: 0 },
  { chordType: 'm9', rootPc: 2 },
  { chordType: '13sus4', rootPc: 7 },
  { chordType: '6/9', rootPc: 0 },
];

const maxMidi = (hits: { midis: number[] }[]) => Math.max(...hits.flatMap((h) => h.midis));

describe('render/acgCompAir(ACG comp air 回归修复)', () => {
  it('★ §3.3:扩展和弦 + 和弦语境 → ACG air case 至少 1 个 chord 音 > 67(高空气恢复)', () => {
    for (const ch of EXTENDED) {
      for (const tc of AIR_CASES) {
        const hits = renderTextureChordHits(tc, LOW_VOICED, DUR, ch);
        expect(hits.length, `${tc}/${ch.chordType}`).toBeGreaterThan(0);
        expect(maxMidi(hits), `${tc}/${ch.chordType} 高 air`).toBeGreaterThan(67);
      }
    }
  });

  it('★ 稀疏色音 drop 仍是单音/小 dyad(不被填成密块)', () => {
    const hits = renderTextureChordHits('ACG_Pedal_Wash_Color_Drops', LOW_VOICED, DUR, { rootPc: 0, chordType: 'maj9' });
    const drops = hits.filter((h) => h.tRel >= 1.5); // 后段色音 drops
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) expect(d.midis.length, '色音 drop 单音/小').toBeLessThanOrEqual(2);
  });

  it('★ 无和弦语境 = 向后兼容(不崩、仍产 hit;走 voicing 顶部取)', () => {
    for (const tc of AIR_CASES) {
      const hits = renderTextureChordHits(tc, [60, 64, 67, 71, 74], DUR); // 无 ctx
      expect(hits.length, tc).toBeGreaterThan(0);
    }
  });

  it('★ 确定性:同输入(含 ctx)两次一致', () => {
    const gen = () => JSON.stringify(renderTextureChordHits('ACG_Quartal_Arp_Wave', LOW_VOICED, DUR, { rootPc: 0, chordType: 'maj9' }));
    expect(gen()).toBe(gen());
  });

  it('★ §5.2:ACG 稀疏织体 needsDownbeat 不注入 shell(有无 needsDownbeat 输出一致)', () => {
    const withN = JSON.stringify(acgComp(7, 'Piano_TopVoice_Planing', true).notes);
    const without = JSON.stringify(acgComp(7, 'Piano_TopVoice_Planing', false).notes);
    expect(withN).toBe(without); // §3.5:ACG 跳 shell 注入 → needsDownbeat 无影响
  });

  it('★ §5.3:ACG comp 软但【可听】(max vel ∈ [40,96]:airy 软于 generic,又不被 lead/bass 埋)', () => {
    const comp = acgComp(7, 'ACG_Pedal_Wash_Color_Drops', false);
    expect(comp.notes.length).toBeGreaterThan(0);
    const maxVel = Math.max(...comp.notes.map((n) => n.velocity as number));
    expect(maxVel, '可听:不被 lead/bass(vel 80-90)埋').toBeGreaterThanOrEqual(40);
    expect(maxVel, '仍软:generic comp 可到 100-120').toBeLessThanOrEqual(96);
  });

  it('★ §5.1 端到端(§2.5 fidelity directive B):ACG comp 保高位色音 air(含 > 67 的高 air,不全钳到旋律下方)', () => {
    // ★ 2026-06-28 fidelity directive B(反 round1):ACG 走【未钳】air voicing + 真和弦 acgCtx 上方色音 →
    //   高位色音 halo 在旋律区/之上(MG 久石让钢琴的空气感),不再坐旋律地板下。端到端断言:comp 含 > 67 高 air 音。
    const comp = acgComp(7, 'ACG_Quartal_Arp_Wave', false);
    expect(comp.notes.length).toBeGreaterThan(0);
    const maxPitch = Math.max(...comp.notes.map((n) => n.pitch as number));
    expect(maxPitch, 'ACG comp 保高位色音 air(> 67),不全坐旋律下方').toBeGreaterThan(67);
  });

  it('★ §2.5:air 改动【只影响 ACG 织体 case】—— 非 ACG case(同 setup)仍走 clamp,顶低于 ACG air', () => {
    // 守 directive §2.5 bullet 5「keep generic band-comp unchanged for non-ACG」:air voicing 由 isAcgTextureCase(tc)
    //   门控(键 texture case,非 band style)→ 非 ACG 织体 case 仍走 clampUnder 路径,顶不冲到 ACG 高位色音区。
    const acgTop = Math.max(...acgComp(7, 'ACG_Quartal_Arp_Wave', false).notes.map((n) => n.pitch as number));
    const nonAcg = acgComp(7, 'Piano_Lofi_Late_Chord_Answer', false); // 非 ACG case → isAcgTextureCase=false → clamp
    expect(nonAcg.notes.length).toBeGreaterThan(0);
    const nonAcgTop = Math.max(...nonAcg.notes.map((n) => n.pitch as number));
    expect(nonAcgTop, '非 ACG 织体 case 不走 air voicing → 顶低于 ACG air').toBeLessThan(acgTop);
  });

  it('★ 三和弦(无写入扩展)允许无 >67 air(不强造色音)', () => {
    // C 大三和弦 pcs={0,4,7};acgUpperColorMidis 仍可取 5/3/root,但若 voicing+ctx 都低也不报错。
    const hits = renderTextureChordHits('ACG_Quartal_Arp_Wave', LOW_VOICED, DUR, { rootPc: 0, chordType: 'maj' });
    expect(hits.length).toBeGreaterThan(0); // 不崩即可(三和弦不在 §3.3 强制 air 列)
  });
});
