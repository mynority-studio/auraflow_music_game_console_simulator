// ============================================================
// scan-feature-seeds.ts — 扫描 newEngine 特征 seed（P1b）
// ------------------------------------------------------------
// 标准 8×7=56 golden 矩阵不出现 timbre-switch / retry。本脚本扫 seed 空间，
// 沿用 golden 同 request 参数（mood=calm-build / duration=120 / allowModulation），
// 仅变 seed/style，统计：
//   - timbre-switch：任一轨 programChanges/mixChanges 非空（renderCoordinator 跨段音色切换）
//   - retry：attempts>1（GenerationController 因非-lead error finding rewind；唯一 error
//     规则 = readOnlyHarmonyAuditor R1 avoid-long-exposure）
// 用法: npx tsx scripts/scan-feature-seeds.ts [maxSeed=400]
// ============================================================
import { generateSong } from '../src/core/generation/newEngine/generation/GenerationController';
import type { GenerationRequest } from '../src/core/generation/newEngine/band/bandEngine';

const STYLES = ['pop', 'jazz', 'lofi', 'rnb', 'modal', 'default', '__unknown__'];
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
console.log(`timbre-switch 命中 ${timbreHits.length}:`);
for (const h of timbreHits.slice(0, 25)) console.log(`  seed=${h.seed} ${h.style} pc=${h.pc} mc=${h.mc}`);
console.log(`retry>1 命中 ${retryHits.length}:`);
for (const h of retryHits.slice(0, 25)) console.log(`  seed=${h.seed} ${h.style} attempts=${h.attempts} status=${h.status}`);
