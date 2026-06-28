// ============================================================
// scan-feature-seeds.ts — 扫描 newEngine 特征 seed（P1b / V3-P0 F4）
// ------------------------------------------------------------
// 标准 golden 矩阵不出现 timbre-switch / retry。本脚本扫 seed 空间，
// 沿用 golden 同 request 参数（mood=calm-build / duration=120 / allowModulation），
// 仅变 seed/style，统计：
//   - timbre-switch：任一轨 programChanges/mixChanges 非空（renderCoordinator 跨段音色切换）
//   - retry：attempts>1（GenerationController 因非-lead error finding rewind）
// 用法: npx tsx scripts/scan-feature-seeds.ts [maxSeed=400]
// ★ V3-P0 F4 适配：STYLES 加 'acg'（v3 新风格），在 v3 引擎上重扫特征 seed。
// ============================================================
import { generateSong } from '../src/core/generation/newEngine/generation/GenerationController';
import type { GenerationRequest } from '../src/core/generation/newEngine/band/bandEngine';

const STYLES = ['pop', 'jazz', 'lofi', 'rnb', 'acg', 'modal', 'default', '__unknown__'];
const MAX = Number(process.argv[2] ?? 400);

const timbreHits: { seed: number; style: string; pc: number; mc: number }[] = [];
const retryHits: { seed: number; style: string; attempts: number; status: string }[] = [];

for (let seed = 0; seed < MAX; seed++) {
  for (const style of STYLES) {
    const req: GenerationRequest = { seed, styleHint: style, mood: 'calm-build', targetDuration: 120, allowModulation: true };
    const r = generateSong(req);
    if (r.attempts > 1) retryHits.push({ seed, style, attempts: r.attempts, status: r.status });
    if (r.ir) {
      let pc = 0;
      let mc = 0;
      for (const t of r.ir.tracks) {
        pc += t.programChanges?.length ?? 0;
        mc += t.mixChanges?.length ?? 0;
      }
      if (pc || mc) timbreHits.push({ seed, style, pc, mc });
    }
  }
}

console.log(`扫描 ${MAX} seed × ${STYLES.length} style = ${MAX * STYLES.length} 组合`);
const byStyle: Record<string, { timbre: number; retry: number; maxT?: { seed: number; pc: number; mc: number } }> = {};
for (const s of STYLES) byStyle[s] = { timbre: 0, retry: 0 };
for (const h of timbreHits) {
  const b = byStyle[h.style];
  b.timbre++;
  if (!b.maxT || h.pc + h.mc > b.maxT.pc + b.maxT.mc) b.maxT = { seed: h.seed, pc: h.pc, mc: h.mc };
}
for (const h of retryHits) byStyle[h.style].retry++;
console.log('per-style  timbre-switch / retry / 最强 timbre case:');
for (const s of STYLES) {
  const b = byStyle[s];
  console.log(`  ${s.padEnd(12)} timbre=${String(b.timbre).padStart(3)} retry=${String(b.retry).padStart(2)} maxTimbre=${b.maxT ? `seed${b.maxT.seed} pc=${b.maxT.pc} mc=${b.maxT.mc}` : 'none'}`);
}
console.log(`全部 retry (${retryHits.length}):`);
for (const h of retryHits) console.log(`  seed=${h.seed} ${h.style} attempts=${h.attempts} status=${h.status}`);
