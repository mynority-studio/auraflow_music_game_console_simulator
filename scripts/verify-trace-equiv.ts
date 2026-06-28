// ============================================================
// verify-trace-equiv.ts — V3-P0 验收：trace on/off 深等价
// ------------------------------------------------------------
// codex plan-review 验收项（P0 最关键自证）：generateSong 传 trace 回调 与不传，
// 产物（ir/status/attempts）必须深等价 —— 证明 trace 是【只读旁路】，绝不改生产行为。
// 空回调 () => {} 仍触发 renderCoordinator 的 overlay?.trace?.(...) 全部 16 个调用点。
// 用法: npx tsx scripts/verify-trace-equiv.ts
// ============================================================
import { generateSong } from '../src/core/generation/newEngine/generation/GenerationController';
import type { GenerationRequest } from '../src/core/generation/newEngine/band/bandEngine';

const CASES: [number, string][] = [
  [12345, 'pop'], [7, 'jazz'], [42, 'acg'], [1001, 'rnb'],
  [3, 'modal'], [4, 'lofi'], [19, 'acg'], [20260612, 'default'],
];

let ok = 0;
let fail = 0;
for (const [seed, style] of CASES) {
  const req: GenerationRequest = { seed, styleHint: style, mood: 'calm-build', targetDuration: 120, allowModulation: true };
  const a = generateSong(req);                       // 不传 trace（生产路径）
  const b = generateSong(req, undefined, () => {});  // 传空 trace（触发全部 trace 点，只读）
  const eq =
    a.status === b.status &&
    a.attempts === b.attempts &&
    JSON.stringify(a.ir ?? null) === JSON.stringify(b.ir ?? null) &&
    JSON.stringify(a.report.findings) === JSON.stringify(b.report.findings);
  console.log(`  seed=${seed} ${style}: ${eq ? 'OK' : 'MISMATCH'} (status=${a.status} attempts=${a.attempts})`);
  if (eq) ok++; else fail++;
}
console.log(`\ntrace on/off 深等价: ${ok} OK / ${fail} MISMATCH`);
process.exit(fail ? 1 : 0);
