import { describe, it, expect } from 'vitest';
import { generateSong } from './GenerationController';
import { generateSongFromMotif, type MotifLeadNote } from './generateSongFromMotif';
import type { GenerationRequest } from '../band/bandEngine';
import type { MusicalIR } from '../ir/MusicalIR';

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

  it('★ 注入点 B(lead override · beats 制):传入权威 lead → 该轨原样采用(音高/顺序),其余轨不变', () => {
    const req = REQS[0];
    const base = generateSong(req);
    // 权威 lead(beats):一段简单上行,验证 override 生效、其余轨跟随同和声不变。
    const lead: MotifLeadNote[] = [
      { pitch: 67, onsetBeat: 0, durationBeat: 1, velocity: 100 },
      { pitch: 69, onsetBeat: 1, durationBeat: 1, velocity: 96 },
      { pitch: 72, onsetBeat: 2, durationBeat: 2, velocity: 104 },
      { pitch: 71, onsetBeat: 4, durationBeat: 1, velocity: 92 },
    ];
    const r = generateSongFromMotif(req, { lead });
    expect(r.status).not.toBe('failed');
    const leadTrack = r.ir!.tracks.find((t) => t.role === 'lead')!;
    // lead 被 tile 满全曲;首份逐音原样采用(motif lead 权威,renderMgMelody 让位)
    expect(leadTrack.notes.length).toBeGreaterThanOrEqual(lead.length);
    expect(leadTrack.notes.slice(0, lead.length).map((n) => n.pitch)).toEqual(lead.map((n) => n.pitch));
    // 非 lead 轨仍齐备(编曲会【响应】override lead:ducking/避撞/comp 让位旋律区 = 走 A 期望,不强求字节不变)
    const baseRoles = base.ir!.tracks.filter((t) => t.role !== 'lead').map((t) => t.role);
    const rRoles = r.ir!.tracks.filter((t) => t.role !== 'lead').map((t) => t.role);
    expect(rRoles).toEqual(baseRoles); // 同样的伴奏编制
  });

  // ★ 走 A jazz 律动一致(2026-06-23,用户:整编缺 jazz 感、试听有)。根因=override lead 是直拍 motif,而全局
  //   applySwing 跳过 lead(假设 MG 已摆)→ 整编里旋律不摆、压在摇摆节奏上。修=override lead 预摆动(对齐
  //   comp/bass/drum 同摆),快速 run 保护笔直。
  it('★ 走 A jazz:override lead 预摆动 —— 八分反拍 onset 后移(>0.58);pop 保持直拍(~0.5);只改 onset 不改音高', () => {
    const eighths: MotifLeadNote[] = Array.from({ length: 16 }, (_, i) => ({ pitch: 60 + (i % 5), onsetBeat: i * 0.5, durationBeat: 0.5, velocity: 96 })); // span=8.0 拍(整数)→ tile 不漂移
    const offPhases = (style: string): number[] => {
      const r = generateSongFromMotif({ seed: 9, styleHint: style, mood: 'build', targetDuration: 48 }, { lead: eighths });
      const lead = r.ir!.tracks.find((t) => t.role === 'lead')!;
      const ppq = r.ir!.timebase.ppq;
      return lead.notes.map((n) => (((n.startTick as number) / ppq) % 1 + 1) % 1).filter((ph) => ph > 0.3 && ph < 0.95);
    };
    const jazzOff = offPhases('jazz');
    const popOff = offPhases('pop');
    expect(jazzOff.filter((p) => p > 0.58).length / Math.max(1, jazzOff.length), 'jazz 反拍多数被摆动').toBeGreaterThan(0.5);
    expect(popOff.filter((p) => Math.abs(p - 0.5) < 0.08).length / Math.max(1, popOff.length), 'pop 反拍多数保持直拍').toBeGreaterThan(0.6);
    // 音高序列不被摆动改变(只移 onset)
    const rj = generateSongFromMotif({ seed: 9, styleHint: 'jazz', mood: 'build', targetDuration: 48 }, { lead: eighths });
    const lj = rj.ir!.tracks.find((t) => t.role === 'lead')!;
    expect(lj.notes.slice(0, eighths.length).map((n) => n.pitch)).toEqual(eighths.map((n) => n.pitch));
  });

  it('★ 快速 16 分 run 不被预摆动(jazz_16th_run_grid_owner):连续 .25 IOI 的 .5 相位保持笔直', () => {
    // 连续 16 分(IOI 0.25)= 快速 run → isInProtectedFastRun 命中 → 不摆;其中落 .5 相位的音应仍 ≈ .5
    const run: MotifLeadNote[] = Array.from({ length: 16 }, (_, i) => ({ pitch: 60 + (i % 4), onsetBeat: i * 0.25, durationBeat: 0.25, velocity: 92 })); // span=4.0 拍(整数)→ tile 不漂移
    const r = generateSongFromMotif({ seed: 9, styleHint: 'jazz', mood: 'build', targetDuration: 48 }, { lead: run });
    const lead = r.ir!.tracks.find((t) => t.role === 'lead')!;
    const ppq = r.ir!.timebase.ppq;
    const halfPhase = lead.notes.map((n) => (((n.startTick as number) / ppq) % 1 + 1) % 1).filter((ph) => Math.abs(ph - 0.5) < 0.12);
    // run 内的 .5 不应被摆到 .66(否则与 .75 挤成 micro-IOI)
    expect(halfPhase.every((p) => p < 0.6), '快速 run 内 .5 保持笔直').toBe(true);
  });
});
