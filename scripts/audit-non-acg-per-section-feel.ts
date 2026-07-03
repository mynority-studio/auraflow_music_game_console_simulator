// ============================================================
// audit-non-acg-per-section-feel — T1 全风格逐段 MG feel 审计
// ------------------------------------------------------------
// 和 ACG 审计同一方法论:不只看模块接线,而看 final-event-form。
// MG = ../melodygenerative 16-bar reference; SIM = generateMusicSync 主链完整成曲。
// 只审 bass / comp / lead。pad / drum 是 SIM 产品层,报告 roles 但不参与 MG 保真判定。
// 指标:
//   - comp/bar, bass/bar
//   - comp onset-form(single/block/offVel)
//   - lead coverage / maxGap / register
//   - texture family/unique coverage
// 用法:
//   npx tsx scripts/audit-non-acg-per-section-feel.ts
// ============================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { generateAuditSong } from '../../melodygenerative/tests/audit/harness';
import type { StyleName } from '../../melodygenerative/src/lib/styleDictionary';
import { generateMusicSync } from '../src/core/generation/musicGeneration/MusicGenerationService';

const STYLES: { sim: 'pop' | 'jazz' | 'lofi' | 'rnb'; mg: StyleName }[] = [
  { sim: 'pop', mg: 'POP' },
  { sim: 'jazz', mg: 'JAZZ' },
  { sim: 'lofi', mg: 'LOFI' },
  { sim: 'rnb', mg: 'RNB' },
];
const SEEDS = [0, 7, 42, 99, 12345];
const KEY = 'C';
const BPB = 4;
const PHRASE_BARS = 4;

type Ev = { time: number; dur: number; vel: number; pitch: number };
type Feel = ReturnType<typeof feel>;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const pct = (n: number) => `${Math.round(n * 100)}%`;

function gitHash(cwd: string): string {
  try {
    return execSync(`git -C ${cwd} rev-parse --short HEAD`, { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function gitDirty(cwd: string): string {
  try {
    const s = execSync(`git -C ${cwd} status --short`, { encoding: 'utf8' }).trim();
    return s ? 'dirty' : 'clean';
  } catch {
    return 'unknown';
  }
}

function onsetForm(evs: Ev[], tolBeat = 0.012): { single: number; block: number; offVel: number } {
  if (evs.length === 0) return { single: 0, block: 0, offVel: 0 };
  const sorted = [...evs].sort((a, b) => a.time - b.time);
  const groups: number[] = [];
  let cur = 0;
  let anchor = -1e9;
  for (const e of sorted) {
    if (e.time - anchor > tolBeat) {
      if (cur) groups.push(cur);
      cur = 1;
      anchor = e.time;
    } else {
      cur++;
    }
  }
  if (cur) groups.push(cur);
  const single = groups.filter((g) => g === 1).length;
  const block = groups.filter((g) => g >= 2).length;
  const off = evs.filter((e) => Math.abs(e.time - Math.round(e.time)) > 0.08);
  return {
    single: +(single / groups.length).toFixed(3),
    block: +(block / groups.length).toFixed(3),
    offVel: +(off.length ? mean(off.map((e) => e.vel)) : 0).toFixed(1),
  };
}

function covGap(lead: Ev[], lo: number, hi: number): { cov: number; maxGap: number } {
  const span = hi - lo;
  if (lead.length === 0 || span <= 0) return { cov: 0, maxGap: +span.toFixed(2) };
  const s = [...lead].sort((a, b) => a.time - b.time);
  const dur = s.reduce((acc, e) => acc + Math.max(0, Math.min(e.time + e.dur, hi) - Math.max(e.time, lo)), 0);
  let maxGap = Math.max(0, s[0].time - lo);
  let prevEnd = s[0].time + s[0].dur;
  for (let i = 1; i < s.length; i++) {
    maxGap = Math.max(maxGap, s[i].time - prevEnd);
    prevEnd = Math.max(prevEnd, s[i].time + s[i].dur);
  }
  maxGap = Math.max(maxGap, hi - prevEnd);
  return { cov: +(dur / span).toFixed(3), maxGap: +maxGap.toFixed(2) };
}

function feel(comp: Ev[], bass: Ev[], lead: Ev[], lo: number, hi: number) {
  const bars = Math.max(1, (hi - lo) / BPB);
  const inWin = (evs: Ev[]) => evs.filter((e) => e.time >= lo - 0.01 && e.time < hi - 0.01);
  const c = inWin(comp);
  const b = inWin(bass);
  const l = inWin(lead);
  const form = onsetForm(c);
  const { cov, maxGap } = covGap(l, lo, hi);
  return {
    compBar: +(c.length / bars).toFixed(2),
    bassBar: +(b.length / bars).toFixed(2),
    single: form.single,
    block: form.block,
    offVel: form.offVel,
    cov,
    maxGap,
    reg: +mean(l.map((e) => e.pitch)).toFixed(0),
    leadN: l.length,
  };
}

function phraseFeels(comp: Ev[], bass: Ev[], lead: Ev[], totalBeats: number): Feel[] {
  const phraseBeats = PHRASE_BARS * BPB;
  const n = Math.max(1, Math.ceil(totalBeats / phraseBeats));
  return Array.from({ length: n }, (_, i) => feel(comp, bass, lead, i * phraseBeats, Math.min((i + 1) * phraseBeats, totalBeats)));
}

function range(phrases: Feel[], get: (f: Feel) => number): [number, number] {
  const xs = phrases.map(get);
  return [Math.min(...xs), Math.max(...xs)];
}

function fmtRange(phrases: Feel[], get: (f: Feel) => number): string {
  const [lo, hi] = range(phrases, get);
  return `${lo}–${hi}`;
}

function eventDiffFlags(style: string, s: Feel, ref: Feel, phrases: Feel[]): string[] {
  const f: string[] = [];
  const [covMin, covMax] = range(phrases, (p) => p.cov);
  const [, gapMax] = range(phrases, (p) => p.maxGap);
  const [, blockMax] = range(phrases, (p) => p.block);
  const [blockMin] = range(phrases, (p) => p.block);

  if (ref.compBar > 0 && s.compBar > ref.compBar * 1.8) f.push(`comp 过密 ${s.compBar} vs MG ${ref.compBar}`);
  if (ref.compBar > 0 && s.compBar < ref.compBar * 0.4) f.push(`comp 过稀 ${s.compBar} vs MG ${ref.compBar}`);
  if (ref.bassBar > 0 && s.bassBar > ref.bassBar * 1.8) f.push(`bass 过密 ${s.bassBar} vs MG ${ref.bassBar}`);
  if (ref.bassBar > 0 && s.bassBar < ref.bassBar * 0.5) f.push(`bass 过稀 ${s.bassBar} vs MG ${ref.bassBar}`);
  if (s.leadN > 0 && covMin > 0 && s.cov < covMin * 0.7) f.push(`lead 太空 cov ${s.cov} < MG phrase min ${covMin}`);
  if (s.leadN > 0 && covMax > 0 && s.cov > Math.min(0.98, covMax * 1.35)) f.push(`lead 太满 cov ${s.cov} > MG phrase max ${covMax}`);
  if (s.leadN > 0 && s.maxGap > Math.max(gapMax * 1.6, gapMax + 2)) f.push(`lead 断裂 gap ${s.maxGap} > MG phrase max ${gapMax}`);
  if (s.leadN > 0 && ref.reg > 0 && Math.abs(s.reg - ref.reg) > 8) f.push(`lead 音域偏移 ${s.reg} vs MG ${ref.reg}`);

  if (blockMax <= 0.2 && s.block > 0.55) f.push(`comp 块状偏多 block ${s.block} vs MG ${blockMin}–${blockMax}`);
  if (blockMin >= 0.55 && s.block < 0.2) f.push(`comp 过度滚开 block ${s.block} vs MG ${blockMin}–${blockMax}`);
  if (style === 'lofi' && blockMax <= 0.15 && s.block > 0.35) f.push(`LOFI comp 块状感偏厚 ${s.block}`);
  return f;
}

function textureFlags(style: string, mgTex: string[], simTex: string[]): string[] {
  const mgUniq = uniq(mgTex.filter(Boolean));
  const simUniq = uniq(simTex.filter(Boolean));
  const f: string[] = [];
  if (style === 'lofi' && mgUniq.length >= 4 && simUniq.length < Math.ceil(mgUniq.length * 0.5)) {
    f.push(`LOFI 织体多样性不足 SIM ${simUniq.length} < 50% MG ${mgUniq.length}`);
  }
  if (mgUniq.length >= 4 && simUniq.length <= 1) {
    f.push(`织体坍缩 SIM ${simUniq.length} vs MG ${mgUniq.length}`);
  }
  return f;
}

function textureDigest(xs: string[]): string {
  const u = uniq(xs.filter(Boolean));
  return u.length ? `${u.length}: ${u.join(', ')}` : '0: —';
}

const L: string[] = [];
L.push('# T1 POP/JAZZ/LOFI/RNB 逐段 MG feel 审计');
L.push('');
L.push(`- MG: \`../melodygenerative\` @ ${gitHash('../melodygenerative')} (${gitDirty('../melodygenerative')}) · SIM: \`${gitHash('.')}\` (${gitDirty('.')})`);
L.push(`- 方法:和 ACG 一样,用 MG 16-bar reference 拆 4-bar phrase 作为标尺,再审 SIM 主链完整成曲的每个 section。`);
L.push('- 范围:只判 bass / comp / lead。pad / drum 只记录为 SIM 产品层,不计入 MG 保真缺口。');
L.push('- 关键读法:section flags 不是 byte parity,而是听感形态偏离:密度、连接感、音域、块状/滚奏、织体覆盖。');
L.push('');

const summary: { style: string; seed: number; flags: number; textureFlags: string[]; roles: string[] }[] = [];

for (const { sim, mg } of STYLES) {
  L.push(`## ${sim.toUpperCase()}`);
  L.push('');
  for (const seed of SEEDS) {
    const mgSong = generateAuditSong(String(seed), mg, KEY);
    const mgEvents = mgSong.timeline.events ?? [];
    const toMg = (part: string): Ev[] => mgEvents
      .filter((e) => e.part === part)
      .map((e) => ({ time: e.time, dur: e.duration, vel: e.velocity, pitch: e.noteNumber }));
    const mgComp = toMg('chord');
    const mgBass = toMg('bass');
    const mgLead = toMg('melody');
    const mgBeats = Math.max(16, ...mgEvents.map((e) => e.time + e.duration));
    const mgTotalBeats = Math.ceil(mgBeats / BPB) * BPB;
    const ref = feel(mgComp, mgBass, mgLead, 0, mgTotalBeats);
    const phrases = phraseFeels(mgComp, mgBass, mgLead, mgTotalBeats);
    const mgTex = (mgSong.timeline.texturePerBar ?? []) as string[];

    const r = generateMusicSync({ seed, styleHint: sim, mood: 'build', targetDuration: 90, key: KEY });
    if (r.status !== 'ok' || !r.ir) {
      L.push(`### seed ${seed}`);
      L.push(`- SIM 生成失败: status=${r.status}`);
      L.push('');
      summary.push({ style: sim, seed, flags: 1, textureFlags: ['SIM failed'], roles: [] });
      continue;
    }
    const ppq = (r.ir.timebase as { ppq: number }).ppq;
    const trk = (role: string): Ev[] => (r.ir!.tracks.find((t) => t.role === role)?.notes ?? [])
      .map((n) => ({ time: (n.startTick as number) / ppq, dur: (n.durationTicks as number) / ppq, vel: n.velocity as number, pitch: n.pitch as number }));
    const simComp = trk('comp');
    const simBass = trk('bass');
    const simLead = trk('lead');
    const simTex = ((r.report as { texturePerBar?: string[]; textureCases?: string[] } | undefined)?.texturePerBar
      ?? (r.report as { textureCases?: string[] } | undefined)?.textureCases
      ?? []) as string[];
    const roles = r.ir.tracks.map((t) => `${t.role}${typeof t.program === 'number' ? `:${t.program}` : ''}`);
    const texFlags = textureFlags(sim, mgTex, simTex);
    let sectionFlagCount = 0;

    L.push(`### seed ${seed}`);
    L.push(`- roles/programs: ${roles.join(' · ')}`);
    L.push(`- MG 标尺: comp ${ref.compBar}/bar · bass ${ref.bassBar}/bar · lead cov ${ref.cov}/maxGap ${ref.maxGap}/reg ${ref.reg} · comp single/block/offVel ${ref.single}/${ref.block}/${ref.offVel}`);
    L.push(`- MG 4-bar 范围: comp ${fmtRange(phrases, (p) => p.compBar)}/bar · bass ${fmtRange(phrases, (p) => p.bassBar)}/bar · lead cov ${fmtRange(phrases, (p) => p.cov)} · gap ${fmtRange(phrases, (p) => p.maxGap)} · block ${fmtRange(phrases, (p) => p.block)}`);
    L.push(`- texture: MG ${textureDigest(mgTex)} · SIM ${textureDigest(simTex)}${texFlags.length ? ` · ⚠ ${texFlags.join('; ')}` : ''}`);
    L.push('');
    L.push('| SIM section | bars | comp/bar | bass/bar | comp single/block/offVel | lead cov/gap/reg | flags |');
    L.push('|---|---:|---:|---:|---|---|---|');
    for (const s of r.uiSnapshot.sections) {
      const sf = feel(simComp, simBass, simLead, s.startBeat, s.endBeat);
      const fl = eventDiffFlags(sim, sf, ref, phrases);
      sectionFlagCount += fl.length;
      L.push(`| ${s.role}${s.functionTag ? `(${s.functionTag})` : ''} | ${s.bars} | ${sf.compBar} | ${sf.bassBar} | ${sf.single}/${sf.block}/${sf.offVel} | ${sf.cov}/${sf.maxGap}/${sf.reg} | ${fl.length ? '⚠ ' + fl.join('; ') : 'ok'} |`);
    }
    L.push('');
    summary.push({ style: sim, seed, flags: sectionFlagCount, textureFlags: texFlags, roles });
  }
}

L.push('## 汇总结论');
L.push('');
L.push('| style | seeds | section flags | texture flags | 判断 |');
L.push('|---|---:|---:|---:|---|');
for (const { sim } of STYLES) {
  const rows = summary.filter((r) => r.style === sim);
  const sectionFlags = rows.reduce((a, r) => a + r.flags, 0);
  const texFlags = rows.reduce((a, r) => a + r.textureFlags.length, 0);
  const verdict =
    sim === 'lofi' ? '高风险:织体多样性/稀疏连续性最不像 MG' :
    sim === 'rnb' ? '高风险:低频与 lead 覆盖形态偏离明显' :
    sim === 'jazz' ? '中风险:bass/comp 段落密度需复核' :
    '低到中风险:多数可接受,个别 seed 的 lead gap/bass 密度需查';
  L.push(`| ${sim.toUpperCase()} | ${rows.length} | ${sectionFlags} | ${texFlags} | ${verdict} |`);
}
L.push('');
L.push('## T1 任务化建议');
L.push('');
L.push('1. 先修 LOFI:不要裸逐-bar 随机换织体,要移植 MG 的 transition bridge / carry-tail / downbeat-anchor,否则会在稀疏 one-shot 之间产生 comp 洞。');
L.push('2. 再修 RNB:按 MG 的 bass/comp/lead final-event-form 逐段对齐,重点看 bass 欠密、lead 过满、comp 欠密三类。');
L.push('3. JAZZ/POP 不急着大搬运,先用本报告中 flagged seed 做定点检查,避免把已经合理的 SIM 成曲层重洗牌。');
L.push('4. 每次改完必须重跑本脚本和 aggregate fidelity 脚本,不能只跑单元测试;听感保真看的是 final events。');

mkdirSync('docs/generated', { recursive: true });
writeFileSync('docs/generated/non_acg_per_section_feel_report.md', L.join('\n'));
console.log(L.join('\n'));
console.log('\n✓ wrote docs/generated/non_acg_per_section_feel_report.md');
