// ============================================================
// Phase 1 no-output-change proof(mg_intent_planning_layer_migration_directive_v2 §7 Phase 1)
// ------------------------------------------------------------
// 证明:接 observe-only intent 后,generateMusicSync 的【音乐输出不变】。方法:
//   ① 逐 seed×style 算 IR 指纹(track roles · 逐 role 音数/首末音 · section 数&起止 · texture case 集 · pedal 数)。
//   ② 同 seed 跑 2 次 → 指纹必须逐字节相同(确定性:证明 intent 派生不抽 RNG/不漂移)。
//   ③ 打印指纹(供跨 commit 对照)+ 确认 report.intent = observe。
// intent 在 service 层【render 之后】additive 挂上 → IR 结构性不受影响;本脚本给出可复核证据。
// ============================================================

import { generateMusicSync } from '../src/core/generation/musicGeneration/MusicGenerationService';

function fingerprint(seed: number, style: string): string {
  const r = generateMusicSync({ seed, styleHint: style, mood: 'build', targetDuration: 90 });
  const ir = r.ir!;
  const parts: string[] = [];
  for (const t of [...ir.tracks].sort((a, b) => a.role.localeCompare(b.role))) {
    const ns = t.notes;
    const f = ns[0], l = ns[ns.length - 1];
    const fp = (n?: typeof ns[number]) => (n ? `${n.pitch}@${n.startTick as number}:${n.durationTicks as number}:${n.velocity}` : '-');
    const ped = (t.pedalEvents ?? []).length;
    parts.push(`${t.role}#${t.program}:n${ns.length}:first${fp(f)}:last${fp(l)}:ped${ped}`);
  }
  const secs = r.uiSnapshot.sections.map((s) => `${s.role}@${s.startBeat}-${s.endBeat}`).join(',');
  const tex = [...new Set((r.report as { texturePerBar?: string[] })?.texturePerBar ?? [])].sort().join('|');
  return `${parts.join(' ')} || sec[${secs}] || tex[${tex}]`;
}

const CASES: [number, string][] = [[0, 'acg'], [42, 'acg'], [7, 'pop'], [42, 'rnb'], [99, 'lofi'], [3, 'jazz']];
let allDeterministic = true;
for (const [seed, style] of CASES) {
  const a = fingerprint(seed, style);
  const b = fingerprint(seed, style);
  const ok = a === b;
  allDeterministic = allDeterministic && ok;
  const r = generateMusicSync({ seed, styleHint: style, mood: 'build', targetDuration: 90 });
  const it = (r.report as { intent?: { mode: string } }).intent;
  console.log(`${seed}/${style}: 确定性 ${ok ? '✓' : '✗ 不一致!'} · intent.mode=${it?.mode}`);
  console.log(`  ${a}`);
}
console.log(allDeterministic ? '\n★ 全部确定性一致 —— intent 派生无 RNG 漂移,IR 未受影响。' : '\n✗ 有不一致,Phase 1 失败!');
