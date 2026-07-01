// ============================================================
// audit-mg-bass-comp-lead-fidelity — LIVE MG vs simulator 主链路 bass/comp/lead 保真审计
// ------------------------------------------------------------
// directive: docs/mg_bass_comp_lead_fidelity_directive.md §5。
// 【非 byte parity】(MG=string seed / SIM=numeric seed;曲长各自曲式决定)→ 比【per-bar 密度】+ 织体多样性。
//   MG   : ../melodygenerative tests/audit/harness.generateAuditSong → timeline(part melody/chord/bass)+ texturePerBar。
//   SIM  : generateMusicSync → ir.tracks(role lead/comp/bass)+ uiSnapshot.sections(bars)。
// 忽略 pad/drum(simulator-owned)。写 docs/generated + tmp json。
// 用法:npx tsx scripts/audit-mg-bass-comp-lead-fidelity.ts [--full] [--write-report-only]
// ============================================================

import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

// —— LIVE MG ——
import { generateAuditSong } from '../../melodygenerative/tests/audit/harness';
import type { StyleName } from '../../melodygenerative/src/lib/styleDictionary';

// —— simulator 主链路 ——
import { generateMusicSync } from '../src/core/generation/musicGeneration/MusicGenerationService';

const STYLES: { sim: string; mg: StyleName }[] = [
  { sim: 'acg', mg: 'ACG' },
  { sim: 'pop', mg: 'POP' },
  { sim: 'jazz', mg: 'JAZZ' },
  { sim: 'lofi', mg: 'LOFI' },
  { sim: 'rnb', mg: 'RNB' },
];
const SEEDS = [0, 7, 42, 99, 12345];
const KEY = 'C';

const uniq = (xs: string[]) => [...new Set(xs)];
const ratio = (a: number, b: number) => (b > 0 ? +(a / b).toFixed(2) : a > 0 ? Infinity : 0);
const perBar = (count: number, bars: number) => (bars > 0 ? +(count / bars).toFixed(2) : 0);

interface Row {
  style: string; seed: number;
  mgBars: number; simBars: number;
  mgBass: number; simBass: number; mgComp: number; simComp: number; mgLead: number; simLead: number;
  mgTexUniq: number; mgTexList: string[];
  simTexUniq: number; simTexList: string[];
  compRatioPerBar: number; bassRatioPerBar: number; leadRatioPerBar: number;
  programs: { simLead?: number; simComp?: number; simBass?: number };
  warnings: string[];
  error?: string;
}

function auditOne(sim: string, mg: StyleName, seed: number): Row {
  const warnings: string[] = [];
  // —— MG ——
  const mgSong = generateAuditSong(String(seed), mg, KEY);
  const ev = mgSong.timeline.events ?? [];
  const mgBass = ev.filter((e) => e.part === 'bass').length;
  const mgComp = ev.filter((e) => e.part === 'chord').length;
  const mgLead = ev.filter((e) => e.part === 'melody').length;
  const mgTex = (mgSong.timeline.texturePerBar ?? []) as string[];
  const mgBars = mgTex.length || Math.max(1, mgSong.chords?.length ?? 1);
  const mgTexList = mgTex;

  // —— SIM ——
  const r = generateMusicSync({ seed, styleHint: sim, mood: 'build', targetDuration: 90, key: KEY });
  if (r.status !== 'ok' || !r.ir) {
    return { style: sim, seed, mgBars, simBars: 0, mgBass, simBass: 0, mgComp, simComp: 0, mgLead, simLead: 0,
      mgTexUniq: uniq(mgTexList).length, mgTexList, simTexUniq: 0, simTexList: [], compRatioPerBar: 0, bassRatioPerBar: 0, leadRatioPerBar: 0,
      programs: {}, warnings, error: `SIM 生成失败 status=${r.status}` };
  }
  const simTexList = ((r.report as { textureCases?: string[] } | undefined)?.textureCases ?? []);
  const trk = (role: string) => r.ir!.tracks.find((t) => t.role === role);
  const simBars = r.uiSnapshot.sections.reduce((a, s) => a + s.bars, 0) || 1;
  const simBass = trk('bass')?.notes.length ?? 0;
  const simComp = trk('comp')?.notes.length ?? 0;
  const simLead = trk('lead')?.notes.length ?? 0;

  const compRatioPerBar = ratio(perBar(simComp, simBars), perBar(mgComp, mgBars));
  const bassRatioPerBar = ratio(perBar(simBass, simBars), perBar(mgBass, mgBars));
  const leadRatioPerBar = ratio(perBar(simLead, simBars), perBar(mgLead, mgBars));

  const mgTexUniq = uniq(mgTexList).length;
  const simTexUniq = uniq(simTexList).length;
  // —— 阈值(directive §6/§7,按 per-bar 比率;§4 织体多样性)——
  if (sim === 'acg') {
    if (simComp === 0) warnings.push('ACG comp 空(硬合同违背)');
    if (compRatioPerBar > 3) warnings.push(`ACG comp per-bar 密度 ${compRatioPerBar}x MG (>3x)`);
    if (bassRatioPerBar > 2.5) warnings.push(`ACG bass per-bar 密度 ${bassRatioPerBar}x MG (>2.5x)`);
    if (mgTexUniq >= 5 && simTexUniq < mgTexUniq * 0.5) warnings.push(`ACG 织体多样性 SIM ${simTexUniq} < 50% MG ${mgTexUniq}(§4 逐-bar 未生效)`);
  }

  return {
    style: sim, seed, mgBars, simBars, mgBass, simBass, mgComp, simComp, mgLead, simLead,
    mgTexUniq, mgTexList, simTexUniq, simTexList,
    compRatioPerBar, bassRatioPerBar, leadRatioPerBar,
    programs: { simLead: trk('lead')?.program, simComp: trk('comp')?.program, simBass: trk('bass')?.program },
    warnings,
  };
}

// —— run ——
const rows: Row[] = [];
for (const { sim, mg } of STYLES) {
  for (const seed of SEEDS) {
    try { rows.push(auditOne(sim, mg, seed)); }
    catch (e) { rows.push({ style: sim, seed, mgBars: 0, simBars: 0, mgBass: 0, simBass: 0, mgComp: 0, simComp: 0, mgLead: 0, simLead: 0, mgTexUniq: 0, mgTexList: [], simTexUniq: 0, simTexList: [], compRatioPerBar: 0, bassRatioPerBar: 0, leadRatioPerBar: 0, programs: {}, warnings: [], error: e instanceof Error ? e.message : String(e) }); }
  }
}

let mgHash = 'unknown';
try { mgHash = execSync('git -C ../melodygenerative rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { /* ignore */ }

// —— report ——
const L: string[] = [];
L.push('# MG ↔ Simulator bass/comp/lead fidelity report');
L.push('');
L.push(`- MG source: \`../melodygenerative\` @ ${mgHash} (string seed) · SIM 主链路 generateMusicSync (numeric seed)`);
L.push(`- 方法:per-bar 密度比较(非 byte parity);忽略 pad/drum。styles=${STYLES.map((s) => s.sim).join('/')} seeds=${SEEDS.join('/')} key=${KEY}`);
L.push('- 列:count(总)· /bar(per-bar 密度)· SIM/MG per-bar 比率。texUniq=MG texturePerBar 唯一织体数。');
L.push('');
L.push('| style | seed | bars MG/SIM | bass MG/SIM(/bar → x) | comp MG/SIM(/bar → x) | lead MG/SIM(/bar → x) | texUniq MG/SIM | SIM prog L/C/B | ⚠ |');
L.push('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  if (r.error) { L.push(`| ${r.style} | ${r.seed} | — | — | — | — | — | — | ❌ ${r.error} |`); continue; }
  const cell = (mg: number, sim: number, mgB: number, simB: number, x: number) => `${mg}/${sim} (${perBar(mg, mgB)}→${perBar(sim, simB)} = ${x}x)`;
  L.push(`| ${r.style} | ${r.seed} | ${r.mgBars}/${r.simBars} | ${cell(r.mgBass, r.simBass, r.mgBars, r.simBars, r.bassRatioPerBar)} | ${cell(r.mgComp, r.simComp, r.mgBars, r.simBars, r.compRatioPerBar)} | ${cell(r.mgLead, r.simLead, r.mgBars, r.simBars, r.leadRatioPerBar)} | ${r.mgTexUniq}/${r.simTexUniq} | ${r.programs.simLead}/${r.programs.simComp}/${r.programs.simBass} | ${r.warnings.length ? '⚠ ' + r.warnings.join('; ') : 'ok'} |`);
}
L.push('');
// —— ACG texturePerBar 详列(§5 要求)——
L.push('## ACG texturePerBar(MG 逐 bar 织体 vs SIM textureSchedule 用到的 case 集)');
for (const r of rows.filter((x) => x.style === 'acg' && !x.error)) {
  L.push(`- seed ${r.seed}: MG(${r.mgTexUniq}) = [${uniq(r.mgTexList).join(', ')}] · SIM(${r.simTexUniq}) = [${r.simTexList.join(', ')}]`);
}
L.push('');
const warnRows = rows.filter((r) => r.warnings.length || r.error);
L.push(`## 汇总:${rows.length} 例,${warnRows.length} 例有 warning/error。`);

const outDir = 'docs/generated';
mkdirSync(outDir, { recursive: true });
mkdirSync('tmp', { recursive: true });
writeFileSync(`${outDir}/mg_bass_comp_lead_fidelity_report.md`, L.join('\n'));
writeFileSync('tmp/mg-bass-comp-lead-fidelity.json', JSON.stringify(rows, null, 2));
console.log(L.join('\n'));
console.log(`\n✓ wrote ${outDir}/mg_bass_comp_lead_fidelity_report.md + tmp/mg-bass-comp-lead-fidelity.json`);
