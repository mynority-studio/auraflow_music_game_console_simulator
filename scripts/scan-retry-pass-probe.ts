// ============================================================
// scan-retry-pass-probe.ts — retry-then-pass 存在性探针（v3 遗留补账批2，2026-07-04）
// ------------------------------------------------------------
// 背景：标准 request 族（mood=calm-build/120s/allowModulation）scan-feature-seeds.ts
//   2000 seed×8 style=16000 组合：61 retry 全部 attempts=12→failed（lofi 40/acg 21），
//   attempts∈[2,11] 零出现。本探针换参数族（mood×duration）只扫 retry-prone 风格。
// ★ 结论（2026-07-04 实测）：300 seed×2 style×2 mood×3 dur=3600 组合，retry=66 仍全
//   failed，retry-then-pass=0。两轮合计 19600 组合 127 retry 零成功。
//   机理：阻塞 finding=bass avoid-long-exposure（error），根因在 plans 层和声×bassRole
//   anchor 结构；GenerationController 收敛环不重跑 plans（只换 render rng + voicingSafer
//   overlay/render-fallback）→ retry 修不掉 → retry-then-pass 结构性不可达。
//   盲区按 fallback B 闭账（不强造非产品参数 golden；白盒 fail-then-pass 控制流由
//   C 侧 test_ne_generation_control 覆盖）。
// ★ 重扫触发条件：若未来 ① plans/和声纳入 retry 收敛环，或 ② bass avoid-long-exposure
//   修复策略落地（bass renderer 感知 avoid），须重跑本探针 + scan-feature-seeds 重判。
// 用法: npx tsx scripts/scan-retry-pass-probe.ts [maxSeed=300]
// ============================================================
import { generateSong } from '../src/core/generation/newEngine/generation/GenerationController';
import type { GenerationRequest } from '../src/core/generation/newEngine/band/bandEngine';

const STYLES = ['lofi', 'acg'];
const MOODS = ['calm-build', 'build'];
const DURATIONS = [60, 96, 180];
const MAX = Number(process.argv[2] ?? 300);

let total = 0, retries = 0;
const passHits: string[] = [];
outer:
for (let seed = 0; seed < MAX; seed++) {
  for (const style of STYLES) for (const mood of MOODS) for (const dur of DURATIONS) {
    const req: GenerationRequest = { seed, styleHint: style, mood, targetDuration: dur, allowModulation: true };
    const r = generateSong(req);
    total++;
    if (r.attempts > 1) {
      retries++;
      if (r.status !== 'failed') {
        passHits.push(`seed=${seed} ${style} mood=${mood} dur=${dur} attempts=${r.attempts} status=${r.status}`);
        if (passHits.length >= 5) break outer;   // 早停：5 个候选够选例
      }
    }
  }
}
console.log(`probe: ${total} 组合，retry=${retries}，retry-then-pass=${passHits.length}`);
for (const h of passHits) console.log('  ' + h);
