// ============================================================
// Comp Onset-Form Intent Audit(mg_intent_planning_layer_migration §8 / Phase 4)
// ------------------------------------------------------------
// 报告:逐段【comp onset-form 意图】(intent) vs 【实际 comp onset 形态】(single/block ratio)。
//   rollHeavy→single 应高;blockHeavy→block 应高;sparseAnswer→密度不超。enforced slot 必须满足,observe 只报告。
// onset-form metric:同起点(tol 0.012 beat)分组 → 1 音组=single,≥2 音组=block。
// ============================================================

import { generateMusicSync } from '../src/core/generation/musicGeneration/MusicGenerationService';
import { writeFileSync, mkdirSync } from 'fs';

interface IntentSec { sectionRole: string; startBeat: number; bars: number; compOnsetForm?: string; mode?: string }
const TOL = 0.012;

function onsetRatios(notes: { startTick: number }[], ppq: number, startBeat: number, endBeat: number): { single: number; block: number; n: number } {
  const inSec = notes.filter((n) => { const b = (n.startTick as number) / ppq; return b >= startBeat - 1e-6 && b < endBeat - 1e-6; });
  const beats = inSec.map((n) => (n.startTick as number) / ppq).sort((a, b) => a - b);
  const groups: number[] = []; let i = 0;
  while (i < beats.length) { let j = i + 1; while (j < beats.length && beats[j] - beats[i] < TOL) j++; groups.push(j - i); i = j; }
  const single = groups.filter((g) => g === 1).length, block = groups.filter((g) => g >= 2).length;
  const tot = groups.length || 1;
  return { single: single / tot, block: block / tot, n: groups.length };
}

const L: string[] = ['# Comp Onset-Form Intent Audit(Phase 4)', '', '意图 comp onset-form vs 实际 single/block ratio。enforced(ACG rollHeavy)须满足,observe 只报告。', ''];
const CASES: [number, string][] = [[0, 'acg'], [42, 'acg'], [7, 'pop'], [42, 'rnb'], [99, 'lofi'], [3, 'jazz']];
let enforcedChecked = 0, enforcedOk = 0;

for (const [seed, style] of CASES) {
  const r = generateMusicSync({ seed, styleHint: style, mood: 'build', targetDuration: 90, key: 'C' });
  const intent = (r.report as { intent?: { sections: IntentSec[] } })?.intent;
  const comp = r.ir!.tracks.find((t) => t.role === 'comp');
  const ppq = r.ir!.timebase.ppq as number;
  if (!intent || !comp) { L.push(`## ${seed}/${style}: 无 intent/comp`); continue; }
  L.push(`## ${seed}/${style}`); L.push('| section | intended form | actual single/block | ok |'); L.push('|---|---|---|---|');
  for (const s of intent.sections) {
    const { single, block, n } = onsetRatios(comp.notes as { startTick: number }[], ppq, s.startBeat, s.startBeat + s.bars * 4);
    let ok = '—';
    if (s.compOnsetForm === 'rollHeavy') { // ACG rollHeavy = enforce(chordRoll 实现)
      enforcedChecked++; const pass = single >= 0.6 || n === 0; if (pass) enforcedOk++; ok = pass ? '✓' : '✗';
    }
    L.push(`| ${s.sectionRole} | ${s.compOnsetForm}${s.compOnsetForm === 'rollHeavy' ? '(E)' : ''} | ${single.toFixed(2)}/${block.toFixed(2)} (n${n}) | ${ok} |`);
  }
  L.push('');
}
L.push(`## 汇总:enforced(ACG rollHeavy)slot ${enforcedOk}/${enforcedChecked} 满足 single≥0.6。observe slot 只报告不判。`);
mkdirSync('docs/generated', { recursive: true });
writeFileSync('docs/generated/mg_comp_onset_intent_report.md', L.join('\n'));
console.log(L.join('\n'));
