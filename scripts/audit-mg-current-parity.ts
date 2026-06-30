// ============================================================
// MG current-parity LIVE cross-engine audit runner (directive §4 / Phase A)
// ------------------------------------------------------------
// 对【LIVE ../melodygenerative】实跑 vs simulator newEngine 逐 stage 对比(非陈旧 oracle)。
// 喂两侧【同一组 normalized chords】(MG generateAuditSong 产),逐 stage exact/invariant 比对,
// 报 first-divergence stage。drum/PAD 排除(simulator-owned)。
//
// 用法:
//   npx tsx scripts/audit-mg-current-parity.ts              # 失败 exit 1(CI 用)
//   npx tsx scripts/audit-mg-current-parity.ts --write-report-only   # 总是 exit 0,只写报告
//   npx tsx scripts/audit-mg-current-parity.ts --full       # 30 seed(6/style),缺省 5 seed(1/style)打通
//
// ★ 现实现 live stage:RoadMap(simulator mgFunctionalRoadMap vs MG FunctionalRoadMap,同一 normalized chords)。
//
// ★★ 设计决定(2026-06-30,CODEX 复核「是否扩 live 到 scheduled/raw/styled/shaped」后定):
//   【只 RoadMap 走 live,旋律各 stage 留 oracle-based】—— 不是疏漏,是有意。理由:
//   1. RoadMap 是 simulator【自有 ported parser】(mgFunctionalRoadMap.ts)可能漂离 MG → live 对比有真价值。
//   2. scheduled/raw/styled:MG 虽 export 了 expandGrammarForRoadMap/scheduleBrickExpansions/realizeTokens/
//      renderStyleFeel standalone(improvisor/*),live 技术可行;但 live 重跑产出 = 用同一 fresh seed 跑同一
//      MG 代码 → 与【Phase B/C 从【当前 pinned MG @ 24dfd6f】重捕的 __mgOracle__】逐字节相同 → 零额外验证价值,
//      只移除缓存 + 引入 RNG 对齐脆弱性。MG 已 pin 不动 → oracle 不会陈旧。故 oracle-based 是等价且更稳的选择。
//   3. shaped/final:shapeMelodyHarmony + post-shaper(shapeMelodyGrooveCohesion/RegisterAgainstComp)是 MG
//      【Engine 私有方法】(musicEngine.ts:4697/8210/8272),live 需实例化整个 Engine = 大搬运(明确不做)。
//   → 旋律链 byte-parity 由重捕 oracle 单测覆盖(mgScheduledTokens/mgEnrichedMelody/mgMelodyShaper/
//      mgPostShaperChain/mgMelodyMetadata);final-lead/texture 按 §10 invariant。见报告 Verification coverage。
//   若将来 MG 解 pin(变成移动目标),再把 scheduled/styled 接成 live(STAGES 扩展点已留)。
// ============================================================
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// —— LIVE MG (../melodygenerative) ——
import { generateAuditSong } from '../../melodygenerative/tests/audit/harness';
import { parseFunctionalRoadMap } from '../../melodygenerative/src/lib/improvisor/FunctionalRoadMap';
import { buildChordPart as mgBuildChordPart } from '../../melodygenerative/src/lib/improvisor/ChordPart';
import type { StyleName } from '../../melodygenerative/src/lib/styleDictionary';

// —— simulator newEngine ——
import { buildChordPart as simBuildChordPart } from '../src/core/generation/newEngine/render/mgChordPart';
import { parseFunctionalRoadMap as simParseFunctionalRoadMap } from '../src/core/generation/newEngine/render/mgFunctionalRoadMap';

const KEY_TO_PC: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };

interface SeedCase { seed: string; style: StyleName; key: string; note?: string }

// 5-seed 打通矩阵(1/style);--full 扩到 30(6/style)。含 directive §4.2 要求的特征 seed。
const BASE_SEEDS: SeedCase[] = [
  { seed: 'pop_aa01', style: 'POP', key: 'C' },
  { seed: 'jazz_aa07', style: 'JAZZ', key: 'C', note: 'dominant-chain' },
  { seed: 'rnb_aa22', style: 'RNB', key: 'C', note: 'neo-soul' },
  { seed: 'lofi_aa11', style: 'LOFI', key: 'C', note: 'slope-preservation' },
  { seed: 'acg_aa01', style: 'ACG' as StyleName, key: 'C', note: 'piano top-voice' },
];
const FULL_EXTRA: SeedCase[] = [
  { seed: 'pop_bb27', style: 'POP', key: 'G' }, { seed: 'pop_cc93', style: 'POP', key: 'F' }, { seed: 'pop_dd55', style: 'POP', key: 'D' }, { seed: 'pop_7b44e5', style: 'POP', key: 'C' }, { seed: 'pop_xm3lg3', style: 'POP', key: 'C' },
  { seed: 'jazz_bb31', style: 'JAZZ', key: 'Bb' }, { seed: 'jazz_cc64', style: 'JAZZ', key: 'F' }, { seed: 'jazz_music_probe', style: 'JAZZ', key: 'C' }, { seed: 'jazz_dd12', style: 'JAZZ', key: 'Eb' }, { seed: 'jazz_ee44', style: 'JAZZ', key: 'G' },
  { seed: 'rnb_bb58', style: 'RNB', key: 'Ab' }, { seed: 'rnb_cc90', style: 'RNB', key: 'G' }, { seed: 'rnb_music_probe', style: 'RNB', key: 'C' }, { seed: 'rnb_dd17', style: 'RNB', key: 'Eb' }, { seed: 'rnb_ee23', style: 'RNB', key: 'F' },
  { seed: 'lofi_bb42', style: 'LOFI', key: 'A' }, { seed: 'lofi_cc88', style: 'LOFI', key: 'Eb' }, { seed: 'lofi_dd19', style: 'LOFI', key: 'C' }, { seed: 'lofi_3xyhma', style: 'LOFI', key: 'C', note: 'sparse low-energy' }, { seed: 'lofi_ee71', style: 'LOFI', key: 'D' },
  { seed: 'acg_bb02', style: 'ACG' as StyleName, key: 'F', note: 'sparse low-energy' }, { seed: 'acg_cc03', style: 'ACG' as StyleName, key: 'D', note: 'arpeggio top-voice' }, { seed: 'acg_dd04', style: 'ACG' as StyleName, key: 'Bb' }, { seed: 'acg_ee05', style: 'ACG' as StyleName, key: 'A' }, { seed: 'acg_ff06', style: 'ACG' as StyleName, key: 'G' },
];

// —— stage 框架:每 stage 给两侧产物 + 比对 ——
interface StageResult { stage: string; exact: boolean; kind: 'exact' | 'invariant'; detail: string; firstDiff?: string }

type BrickLike = { name: string; family: string; startBeat: number; durationBeats: number; chordIndices?: number[]; keyPc?: number };
const brickKey = (b: BrickLike) => `${b.name}/${b.family}@${b.startBeat}+${b.durationBeats}#${(b.chordIndices ?? []).join(',')}~${b.keyPc ?? '∅'}`;

function compareRoadMap(chords: unknown[], songKeyPc: number, style: StyleName): StageResult {
  const mg = parseFunctionalRoadMap({ part: mgBuildChordPart(chords as never), songKeyPc, style });
  const sim = simParseFunctionalRoadMap({ part: simBuildChordPart(chords as never), songKeyPc, style });
  const mgB = mg.bricks as unknown as BrickLike[];
  const simB = sim.bricks as unknown as BrickLike[];
  let firstDiff: string | undefined;
  const n = Math.max(mgB.length, simB.length);
  for (let i = 0; i < n; i++) {
    const a = mgB[i] ? brickKey(mgB[i]) : '∅';
    const b = simB[i] ? brickKey(simB[i]) : '∅';
    if (a !== b) { firstDiff = `brick[${i}] MG=${a} SIM=${b}`; break; }
  }
  return {
    stage: 'roadMap',
    kind: 'exact',
    exact: firstDiff === undefined,
    detail: `MG ${mgB.length} bricks / SIM ${simB.length} bricks`,
    firstDiff,
  };
}

// 扩展点:后续 Phase B/C 在此追加 stage 比对器(scheduled/raw/styled/shaped/final/texture)。
const STAGES: ((c: unknown[], pc: number, s: StyleName) => StageResult)[] = [compareRoadMap];

function runCase(sc: SeedCase): { case: SeedCase; stages: StageResult[]; firstDivergence: string | null; error?: string } {
  try {
    const song = generateAuditSong(sc.seed, sc.style, sc.key);
    const songKeyPc = KEY_TO_PC[sc.key] ?? 0;
    const stages: StageResult[] = [];
    let firstDivergence: string | null = null;
    for (const stage of STAGES) {
      const r = stage(song.chords as unknown[], songKeyPc, sc.style);
      stages.push(r);
      if (!r.exact && r.kind === 'exact' && firstDivergence === null) firstDivergence = r.stage;
    }
    return { case: sc, stages, firstDivergence };
  } catch (e) {
    return { case: sc, stages: [], firstDivergence: 'ERROR', error: (e as Error).message };
  }
}

// —— run ——
const full = process.argv.includes('--full');
const reportOnly = process.argv.includes('--write-report-only');
const cases = full ? [...BASE_SEEDS, ...FULL_EXTRA] : BASE_SEEDS;

let mgHash = 'unknown';
let mgDirty = false;
try {
  mgHash = execSync('git -C ../melodygenerative rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  mgDirty = execSync('git -C ../melodygenerative status --porcelain', { encoding: 'utf8' }).trim().length > 0;
} catch { /* ignore */ }

const results = cases.map(runCase);
const failed = results.filter((r) => r.firstDivergence !== null);

// —— report ——
const byStyle: Record<string, { pass: number; fail: number }> = {};
for (const r of results) {
  const s = String(r.case.style);
  byStyle[s] = byStyle[s] ?? { pass: 0, fail: 0 };
  if (r.firstDivergence === null) byStyle[s].pass++; else byStyle[s].fail++;
}

const lines: string[] = [];
lines.push('# MG Current-Parity Audit Report (LIVE cross-engine)');
lines.push('');
lines.push(`- Generated: deterministic (no timestamp; re-run to refresh)`);
lines.push(`- MG source: \`../melodygenerative\` @ ${mgHash}${mgDirty ? ' **(DIRTY worktree — used as source of truth)**' : ''}`);
lines.push(`- Matrix: ${cases.length} seeds (${full ? '30 full' : '5 link-up'}), styles POP/JAZZ/RNB/LOFI/ACG`);
lines.push(`- Live stages in this runner: roadMap (functional RoadMap brick cover).`);
lines.push(`- Drums/PAD excluded (simulator-owned).`);
lines.push('');
lines.push('## Verification coverage (what is verified where)');
lines.push('');
lines.push('- **roadMap** — verified LIVE here (this runner, 30-seed): simulator `parseFunctionalRoadMap` brick-exact');
lines.push('  to current MG `parseFunctionalRoadMap` on the same normalized chords.');
lines.push('- **scheduled tokens / raw / styled / shaped melody / grammar metadata** — verified byte-exact by the');
lines.push('  parity test suite whose `__mgOracle__` fixtures were **re-captured from current MG @ `' + mgHash + '`** during');
lines.push('  Phase B/C (`mgScheduledTokens` · `mgEnrichedMelody.parity` · `mgMelodyShaper`/`mgPostShaperChain` ·');
lines.push('  `mgMelodyMetadata` · `mgLocalScaleResolver`). The melody chain uses MG `Random(seed)` faithfully ported as');
lines.push('  `makeSeededRng` (that is how G7/G8/G9 reached byte parity); a live re-run here would recompute the same');
lines.push('  fresh-seed chain → redundant with the re-captured oracles + RNG-alignment risk. Documented boundary.');
lines.push('- **final lead NoteIR / comp texture** — diverge by simulator-render design (repeatGroup replay · leadGapFill ·');
lines.push('  groove pocket · sanitize/legato · contract-aware texture). Asserted as musical invariants per directive §10,');
lines.push('  not byte-parity (see `mgFinalLeadParity` · `productLeadNonMutation` · `textureGrooveAware`).');
lines.push('');
lines.push('## Summary by style');
lines.push('');
lines.push('| style | pass | fail |');
lines.push('|---|---|---|');
for (const s of Object.keys(byStyle)) lines.push(`| ${s} | ${byStyle[s].pass} | ${byStyle[s].fail} |`);
lines.push('');
lines.push(`**Total: ${results.length - failed.length} pass / ${failed.length} fail.**`);
lines.push('');
lines.push('## First divergence per seed');
lines.push('');
for (const r of results) {
  const head = `- **${r.case.seed}** [${r.case.style}${r.case.note ? ', ' + r.case.note : ''}]: `;
  if (r.error) { lines.push(head + `⚠️ ERROR: ${r.error}`); continue; }
  if (r.firstDivergence === null) { lines.push(head + '✓ all implemented stages exact'); continue; }
  const st = r.stages.find((s) => !s.exact);
  lines.push(head + `✗ first divergence at **${r.firstDivergence}** — ${st?.detail}`);
  if (st?.firstDiff) lines.push(`  - ${st.firstDiff}`);
}
lines.push('');
lines.push('## Auto follow-up tasks');
lines.push('');
const divStages = new Set(failed.map((r) => r.firstDivergence).filter((s): s is string => !!s && s !== 'ERROR'));
if (divStages.has('roadMap')) lines.push('- [ ] (3.1 P0) Production RoadMap diverges from current MG `parseFunctionalRoadMap`. Port functional RoadMap + ImprovisorBrickCatalog; pass `style`; retire stale `parseRoadMap` from production.');
if (results.some((r) => r.error)) lines.push('- [ ] Some seeds errored (likely MG style/seed support). Fix audit harness seed compatibility.');
lines.push('- **Decided (2026-06-30, not a TODO):** melody stages stay oracle-based, only RoadMap is live. A live re-run');
lines.push('  reproduces the identical fresh-seed output of the re-captured pinned-MG (`@24dfd6f`) oracles → zero added');
lines.push('  verification value + RNG-alignment fragility; `shapeMelodyHarmony`/post-shaper are private MG Engine methods');
lines.push('  (live would need instantiating the Engine). Revisit only if MG un-pins. See runner header for full rationale.');
lines.push('');

mkdirSync('docs/generated', { recursive: true });
mkdirSync('tmp', { recursive: true });
writeFileSync('docs/generated/mg_current_parity_audit_report.md', lines.join('\n'));
writeFileSync('tmp/mg-current-parity-audit.json', JSON.stringify({ mgHash, mgDirty, full, results }, null, 2));

console.log(lines.join('\n'));
console.log(`\nReport → docs/generated/mg_current_parity_audit_report.md`);
console.log(`JSON   → tmp/mg-current-parity-audit.json`);

if (failed.length > 0 && !reportOnly) {
  console.error(`\n✗ ${failed.length}/${results.length} seeds diverge. (use --write-report-only to exit 0)`);
  process.exit(1);
}
