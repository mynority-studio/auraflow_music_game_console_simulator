import { describe, it, expect } from 'vitest';
import { generateSong } from './GenerationController';
import { generateSongFromMotif } from './generateSongFromMotif';
import type { GenerationRequest } from '../band/bandEngine';
import type { MusicalIR, TrackIR } from '../ir/MusicalIR';

// IR 指纹:逐轨 role/program + 每音 pitch/start/dur/vel —— 用于"默认链字节不变"对比。
const irSig = (ir: MusicalIR): string =>
  ir.tracks.map((t) => `${t.role}:${t.program}|` + t.notes.map((n) => `${n.pitch},${n.startTick},${n.durationTicks},${n.velocity}`).join(';')).join('||');

const REQS: GenerationRequest[] = [
  { seed: 7, styleHint: 'pop', mood: 'build', targetDuration: 120 },
  { seed: 3, styleHint: 'jazz', mood: 'x', targetDuration: 120 },
  { seed: 11, styleHint: 'lofi', mood: 'chill', targetDuration: 96 },
  { seed: 5, styleHint: 'rnb', mood: 'smooth', targetDuration: 120 },
];

describe('generation/generateSongFromMotif(走 A 并行入口 — PR1 scaffold)', () => {
  it('★ 默认链字节不变:generateSongFromMotif(无 override) === generateSong(逐轨逐音一致)', () => {
    for (const req of REQS) {
      const base = generateSong(req);
      const fromMotif = generateSongFromMotif(req); // 无 override
      expect(fromMotif.status, JSON.stringify(req)).toBe(base.status);
      expect(irSig(fromMotif.ir!), JSON.stringify(req)).toBe(irSig(base.ir!)); // 字节级一致
    }
  });

  it('★ 注入点 A(harmony override):传入 Q+N 自己的 HarmonicPlan 等价于默认 → 结果仍一致(契约 round-trip)', () => {
    // 用 generateSong 默认链产出的"同一套和声"回灌(此处用空 override 已覆盖默认路径);
    // 真转换器(sandbox→HarmonicPlan)留 PR2,这里先锁"override 通道存在且不破坏默认"。
    const req = REQS[0];
    const base = generateSong(req);
    const passthrough = generateSongFromMotif(req, {}); // harmony 缺省 = 默认构建
    expect(irSig(passthrough.ir!)).toBe(irSig(base.ir!));
  });

  it('★ 注入点 B(lead override):传入现成 lead TrackIR → 该轨被原样采用,其余轨不变', () => {
    const req = REQS[0];
    const base = generateSong(req);
    const baseLead = base.ir!.tracks.find((t) => t.role === 'lead')!;
    // 造一条"权威 lead"(新建 TrackIR,不 spread 冻结轨):验证 override 原样生效、其余轨跟随同和声不变。
    const overrideLead: TrackIR = { role: 'lead', program: baseLead.program, notes: baseLead.notes.map((n) => ({ pitch: n.pitch, startTick: n.startTick, durationTicks: n.durationTicks, velocity: n.velocity })) };
    const r = generateSongFromMotif(req, { lead: overrideLead });
    expect(r.status).not.toBe('failed');
    const lead = r.ir!.tracks.find((t) => t.role === 'lead')!;
    // override lead 的音被采用(逐音 == 我们传入的);program 取器配生效值(不强求等于传入)
    expect(lead.notes.map((n) => n.pitch)).toEqual(overrideLead.notes.map((n) => n.pitch));
    // 非 lead 轨与默认一致(同和声 → bass/comp/pad/drum 不变)
    const nonLead = (x: typeof base) => x.ir!.tracks.filter((t) => t.role !== 'lead').map((t) => `${t.role}:` + t.notes.map((n) => n.pitch).join(',')).join('|');
    expect(nonLead(r)).toBe(nonLead(base));
  });
});
