// ============================================================
// Intent Family Audit(mg_intent_planning_layer_migration §8.1 / Phase 3)
// ------------------------------------------------------------
// 报告:逐段【意图 family】(arranger 派生,report.intent)vs【实际 texture case 的 family】(texturePerBar 映射到段)。
//   + actual case ∈ intended family? + family match rate。observe:只报告,不改输出。
// 用途:让 texture family 可见可审计 —— enforce 前看现选择与意图的对齐度,gap 指导 Phase 3 enforce/resolver。
// ============================================================

import { generateMusicSync } from '../src/core/generation/musicGeneration/MusicGenerationService';
import { textureCaseFamily } from '../src/core/generation/newEngine/knowledge/textureFamilyMap';
import { writeFileSync, mkdirSync } from 'fs';

interface IntentSec { sectionRole: string; startBeat: number; bars: number; textureFamily?: string }
const L: string[] = ['# Intent Family Audit(Phase 3 observe)', '', '意图 family(arranger 派生)vs 实际 texture case family。actual∈intended? + match rate。', ''];
const CASES: [number, string][] = [[0, 'acg'], [42, 'acg'], [7, 'pop'], [42, 'rnb'], [99, 'lofi'], [3, 'jazz'], [42, 'jazz']];
let totalMatch = 0, totalN = 0;

for (const [seed, style] of CASES) {
  const r = generateMusicSync({ seed, styleHint: style, mood: 'build', targetDuration: 90 });
  const intent = (r.report as { intent?: { sections: IntentSec[] } })?.intent;
  const tpb = ((r.report as { texturePerBar?: string[] })?.texturePerBar) ?? [];
  if (!intent) { L.push(`## ${seed}/${style}: 无 intent`); continue; }
  L.push(`## ${seed}/${style}`);
  L.push('| section | intended | actual cases → families | match |');
  L.push('|---|---|---|---|');
  let bar = 0;
  for (const s of intent.sections) {
    const seg = tpb.slice(bar, bar + s.bars).filter((t) => t !== '—'); bar += s.bars;
    const fams = seg.map((c) => textureCaseFamily(c));
    const match = fams.filter((f) => f === s.textureFamily).length;
    const rate = fams.length ? match / fams.length : 1;
    totalMatch += match; totalN += fams.length;
    const cases = [...new Set(seg)].map((c) => `${c.slice(0, 16)}→${textureCaseFamily(c)}`).join(', ');
    L.push(`| ${s.sectionRole} | ${s.textureFamily} | ${cases || '(空)'} | ${(rate * 100).toFixed(0)}%${rate < 1 ? ' ⚠' : ''} |`);
  }
  L.push('');
}
L.push(`## 汇总:family match rate = ${totalN ? (totalMatch / totalN * 100).toFixed(1) : 0}% (${totalMatch}/${totalN})`);
L.push('- observe 阶段:mismatch 不改输出,只揭示"现 texture 选择"与"arranger family 意图"的对齐 gap。');
L.push('- enforce(Phase 3 后续,待签字):resolver 在意图 family 内选 case → match rate 应 →100%(enforced slots)。');
mkdirSync('docs/generated', { recursive: true });
writeFileSync('docs/generated/mg_intent_family_audit_report.md', L.join('\n'));
console.log(L.join('\n'));
