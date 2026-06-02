// ============================================================
// approach-probe — 验证 vocab.ts 的 (approach …) 解析 + 移调访问器
// 跑法:npx tsx src/core/generation/improCore/engine/__harness__/approach-probe.ts
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PITCH_CLASSES } from '../pitch';
import { parseVocab, setActiveVocab, getChordForm } from '../vocab';

const here = dirname(fileURLToPath(import.meta.url));
setActiveVocab(parseVocab(readFileSync(join(here, '../vocab/My.voc'), 'utf8')));

const pcName = (pc: number) => PITCH_CLASSES[pc]?.name ?? `?${pc}`;

for (const name of ['Cm7', 'CM7', 'C7']) {
    const cf = getChordForm(name);
    if (!cf) { console.log(`${name}: (no chord form)`); continue; }
    console.log(`\n=== ${name} (root C) ===`);
    console.log('getApproachPCs:', cf.getApproachPCs('C').map(pcName).join(' '));
    console.log('getApproachMap:');
    for (const { targetPc, approachPcs } of cf.getApproachMap('C')) {
        console.log(`   target ${pcName(targetPc).padEnd(2)} <- ${approachPcs.map(pcName).join(' ')}`);
    }
}

// 移调一致性抽查:Gm7 应是 Cm7 整体 +7
console.log('\n=== Gm7 (root G) — transposition check ===');
const gm7 = getChordForm('Gm7');
if (gm7) {
    console.log('getApproachPCs:', gm7.getApproachPCs('G').map(pcName).join(' '));
    for (const { targetPc, approachPcs } of gm7.getApproachMap('G')) {
        console.log(`   target ${pcName(targetPc).padEnd(2)} <- ${approachPcs.map(pcName).join(' ')}`);
    }
}
