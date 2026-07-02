// ============================================================
// audit-acg-per-section-feel — ACG【逐段 MG feel】审计(用户 2026-07-02 靶心:整首像 MG = 逐段 feel 契约)
// ------------------------------------------------------------
// SIM 保留全曲编排(intro/verse/chorus/能量弧);MG 16-bar loop = 诊断标尺(拆 4-bar phrase 看 MG 自身范围)。
// 目标:把 whole-song 聚合指标【拆到 per-section】,看【哪一段】的 bass+comp+lead feel 不像 MG。
//   只审 bass/comp/lead(禁 pad/drum,ACG 现已无 pad)。
// 指标:comp onset-form(single/block/offVel)· comp/bass per-bar 密度 · lead coverage/maxGap/register。
// 用法:npx tsx scripts/audit-acg-per-section-feel.ts
// ============================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { generateAuditSong } from '../../melodygenerative/tests/audit/harness';
import { generateMusicSync } from '../src/core/generation/musicGeneration/MusicGenerationService';

const SEEDS = [0, 7, 42, 99, 12345];
const KEY = 'C';
const BPB = 4; // 4/4

type Ev = { time: number; dur: number; vel: number; pitch: number }; // time/dur in beats

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** onset-form:同 onset 组(起点在 tolBeat 内)→ singleRatio/blockRatio + offgrid 平均力度。 */
function onsetForm(evs: Ev[], tolBeat = 0.012): { single: number; block: number; offVel: number } {
  if (evs.length === 0) return { single: 0, block: 0, offVel: 0 };
  const sorted = [...evs].sort((a, b) => a.time - b.time);
  const groups: number[] = []; let cur = 0; let anchor = -1e9;
  for (const e of sorted) { if (e.time - anchor > tolBeat) { if (cur) groups.push(cur); cur = 1; anchor = e.time; } else cur++; }
  if (cur) groups.push(cur);
  const single = groups.filter((g) => g === 1).length; const block = groups.filter((g) => g >= 2).length;
  const off = evs.filter((e) => Math.abs(e.time - Math.round(e.time)) > 0.08);
  return { single: +(single / groups.length).toFixed(3), block: +(block / groups.length).toFixed(3), offVel: +(off.length ? mean(off.map((e) => e.vel)) : 0).toFixed(1) };
}

/** lead 在 [lo,hi) 窗内的覆盖率 + 最大静默空隙。 */
function covGap(lead: Ev[], lo: number, hi: number): { cov: number; maxGap: number } {
  const span = hi - lo;
  if (lead.length === 0 || span <= 0) return { cov: 0, maxGap: +span.toFixed(2) };
  const s = [...lead].sort((a, b) => a.time - b.time);
  const dur = s.reduce((acc, e) => acc + Math.max(0, Math.min(e.time + e.dur, hi) - Math.max(e.time, lo)), 0);
  let maxGap = s[0].time - lo; let prevEnd = s[0].time + s[0].dur;
  for (let i = 1; i < s.length; i++) { maxGap = Math.max(maxGap, s[i].time - prevEnd); prevEnd = Math.max(prevEnd, s[i].time + s[i].dur); }
  maxGap = Math.max(maxGap, hi - prevEnd);
  return { cov: +(dur / span).toFixed(3), maxGap: +maxGap.toFixed(2) };
}

/** 一段 [lo,hi) 的 feel 指标(comp/bass/lead 三轨)。 */
function feel(comp: Ev[], bass: Ev[], lead: Ev[], lo: number, hi: number) {
  const bars = Math.max(1, (hi - lo) / BPB);
  const inWin = (evs: Ev[]) => evs.filter((e) => e.time >= lo - 0.01 && e.time < hi - 0.01);
  const c = inWin(comp), b = inWin(bass), l = inWin(lead);
  const form = onsetForm(c);
  const { cov, maxGap } = covGap(l, lo, hi);
  return {
    compBar: +(c.length / bars).toFixed(2), bassBar: +(b.length / bars).toFixed(2),
    single: form.single, block: form.block, offVel: form.offVel,
    cov, maxGap, reg: +mean(l.map((e) => e.pitch)).toFixed(0), leadN: l.length,
  };
}

type Feel = ReturnType<typeof feel>;

/** SIM section 偏离 MG 标尺 → flags。lead cov/maxGap 用【MG 4-bar phrase 范围】(whole-16bar maxGap 偏松,单个大空隙拉高)。 */
function flags(s: Feel, ref: Feel, phrases: Feel[]): string[] {
  const f: string[] = [];
  const covMin = Math.min(...phrases.map((p) => p.cov));
  const gapMax = Math.max(...phrases.map((p) => p.maxGap));
  if (s.single < 0.9) f.push(`块状床(single ${s.single})`);
  if (ref.compBar > 0 && (s.compBar > ref.compBar * 1.8 || s.compBar < ref.compBar * 0.4)) f.push(`comp 密度 ${s.compBar} vs MG ${ref.compBar}`);
  if (ref.bassBar > 0 && (s.bassBar > ref.bassBar * 1.8 || s.bassBar < ref.bassBar * 0.5)) f.push(`bass 密度 ${s.bassBar} vs MG ${ref.bassBar}`);
  if (s.leadN > 0 && covMin > 0 && s.cov < covMin * 0.7) f.push(`lead 覆盖 ${s.cov} < MG phrase min ${+covMin.toFixed(3)}`);
  if (s.leadN > 0 && s.maxGap > Math.max(gapMax * 1.6, gapMax + 2)) f.push(`lead 太空 gap ${s.maxGap} > MG phrase max ${+gapMax.toFixed(2)}`);
  if (s.leadN > 0 && s.reg > 0 && (s.reg < 68 || Math.abs(s.reg - ref.reg) > 7)) f.push(`lead 音域 ${s.reg} vs MG ${ref.reg}`);
  return f;
}

const L: string[] = ['# ACG 逐段 feel 审计(MG 16-bar 标尺 vs SIM 全曲逐段)', ''];
L.push('- 只审 bass/comp/lead(禁 pad/drum)。MG=16bar loop(拆 4-bar phrase 看自身范围);SIM=全曲逐段。');
L.push('- 指标:comp/bar · bass/bar · comp onset(single/block/offVel)· lead cov/maxGap/register。⚠=该段偏离 MG 标尺。', '');

for (const seed of SEEDS) {
  const mg = generateAuditSong(String(seed), 'ACG', KEY);
  const ev = mg.timeline.events;
  const toEv = (part: string): Ev[] => ev.filter((e) => e.part === part).map((e) => ({ time: e.time, dur: e.duration, vel: e.velocity, pitch: e.noteNumber }));
  const mgComp = toEv('chord'), mgBass = toEv('bass'), mgLead = toEv('melody');
  const mgBeats = Math.max(16, ...ev.map((e) => e.time + e.duration));
  const ref = feel(mgComp, mgBass, mgLead, 0, Math.ceil(mgBeats / BPB) * BPB);
  // MG 自身 4-bar phrase 范围(看 MG 是否也逐段变化)
  const nPhrase = Math.max(1, Math.round(mgBeats / (4 * BPB)));
  const phrases = Array.from({ length: nPhrase }, (_, i) => feel(mgComp, mgBass, mgLead, i * 4 * BPB, (i + 1) * 4 * BPB));
  const rng = (get: (f: Feel) => number) => `${Math.min(...phrases.map(get))}–${Math.max(...phrases.map(get))}`;

  const r = generateMusicSync({ seed, styleHint: 'acg', mood: 'build', targetDuration: 90, key: KEY });
  const ppq = (r.ir!.timebase as { ppq: number }).ppq;
  const trk = (role: string): Ev[] => (r.ir!.tracks.find((t) => t.role === role)?.notes ?? []).map((n) => ({ time: (n.startTick as number) / ppq, dur: (n.durationTicks as number) / ppq, vel: n.velocity as number, pitch: n.pitch as number }));
  const simComp = trk('comp'), simBass = trk('bass'), simLead = trk('lead');

  L.push(`## seed ${seed}`);
  L.push(`**MG 标尺(16bar):** comp ${ref.compBar}/bar · bass ${ref.bassBar}/bar · comp onset single ${ref.single}/block ${ref.block}/offVel ${ref.offVel} · lead cov ${ref.cov}/maxGap ${ref.maxGap}/reg ${ref.reg}`);
  L.push(`  MG 4-bar phrase 范围: comp/bar ${rng((f) => f.compBar)} · lead cov ${rng((f) => f.cov)} · lead maxGap ${rng((f) => f.maxGap)} · lead reg ${rng((f) => f.reg)}`);
  L.push('');
  L.push('| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | ⚠ |');
  L.push('|---|---|---|---|---|---|---|');
  for (const s of r.uiSnapshot.sections) {
    const sf = feel(simComp, simBass, simLead, s.startBeat, s.endBeat);
    const fl = flags(sf, ref, phrases);
    L.push(`| ${s.role}${s.functionTag ? `(${s.functionTag})` : ''} | ${s.bars} | ${sf.compBar} | ${sf.bassBar} | ${sf.single}/${sf.block}/${sf.offVel} | ${sf.cov}/${sf.maxGap}/${sf.reg} | ${fl.length ? '⚠ ' + fl.join('; ') : 'ok'} |`);
  }
  L.push('');
}

mkdirSync('docs/generated', { recursive: true });
writeFileSync('docs/generated/acg_per_section_feel_report.md', L.join('\n'));
console.log(L.join('\n'));
