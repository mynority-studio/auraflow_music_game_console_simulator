// lstm-gen harness — 加载 CliffordBrown connectome,在 CM7 Am7 Dm7 G7 上生成一条
//   旋律,检查:音都在 [48,84]、时长是 10 的倍数、有起伏、跟随和弦(命中和弦音比例)。
//   跑:npx tsx src/core/generation/improCore/engine/__harness__/lstm-gen.ts

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseVocab, setActiveVocab, parseScales, setActiveScales } from '../vocab';
import { ChordPart } from '../chordpart';
import { loadModel, type ModelManifest } from '../lstm/q8';
import { generateLstmMelody } from '../lstm/lstm-gen';
import { LSTM_LOW_BOUND, LSTM_HIGH_BOUND } from '../lstm/poex-model';

const here = dirname(fileURLToPath(import.meta.url));
const vocText = readFileSync(join(here, '../vocab/My.voc'), 'utf8');
setActiveVocab(parseVocab(vocText));
setActiveScales(parseScales(vocText));
const modelDir = join(here, '..', 'lstm', 'models', 'CliffordBrown');

const manifest = JSON.parse(readFileSync(join(modelDir, 'manifest.json'), 'utf8')) as ModelManifest;
const blob = new Uint8Array(readFileSync(join(modelDir, 'model.q8.bin')));
const model = loadModel(manifest, blob);

console.log('arch:', model.arch);

const chords = ChordPart.fromTokens(['CM7', 'Am7', 'Dm7', 'G7']);
const spans = chords.getSpans();

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? '  ' + extra : ''}`);
    ok ? pass++ : fail++;
};

const notes = generateLstmMelody(spans, model, { seed: 12345 });

const pitched = notes.filter((n) => n.pitch >= 0);
const rests = notes.filter((n) => n.pitch < 0);
console.log(`\n生成 ${notes.length} 个事件(${pitched.length} 音 + ${rests.length} 休止)`);
console.log('前 24 个:', notes.slice(0, 24).map((n) => (n.pitch < 0 ? `R/${n.durationSlots}` : `${n.pitch}/${n.durationSlots}`)).join(' '));

// 1) 音域
const inRange = pitched.every((n) => n.pitch >= LSTM_LOW_BOUND && n.pitch < LSTM_HIGH_BOUND);
const lo = Math.min(...pitched.map((n) => n.pitch));
const hi = Math.max(...pitched.map((n) => n.pitch));
check('所有音落在 [48,84]', inRange, `实际 [${lo}, ${hi}]`);

// 2) 时长合法(>0 且 10 的倍数)
const durOk = notes.every((n) => n.durationSlots > 0 && n.durationSlots % 10 === 0);
check('时长均为 10 的正倍数', durOk);

// 3) 总时长 = 4 bar = 1920 slot
const totalDur = notes.reduce((s, n) => s + n.durationSlots, 0);
check('总时长 = 1920 slot(4 小节)', totalDur === 1920, `实际 ${totalDur}`);

// 4) startSlot 连续无缝
let cursor = 0, seamless = true;
for (const n of notes) { if (n.startSlot !== cursor) seamless = false; cursor += n.durationSlots; }
check('startSlot 连续无缝', seamless);

// 5) 有旋律起伏(不是一个音卡死)
const distinct = new Set(pitched.map((n) => n.pitch)).size;
check('旋律有起伏(≥5 个不同音高)', distinct >= 5, `${distinct} 个不同音`);

// 6) 跟随和弦:命中当前和弦音的比例(粗略 —— 用每个音起点所在 bar 的和弦)
const chordTonePCs = spans.map((s) => new Set(s.chord.getSpellMIDIarray().map((m) => ((m % 12) + 12) % 12)));
let hit = 0;
for (const n of pitched) {
    const bar = Math.min(3, Math.floor(n.startSlot / 480));
    if (chordTonePCs[bar]!.has(((n.pitch % 12) + 12) % 12)) hit++;
}
const hitRate = hit / pitched.length;
check('命中和弦音比例 ≥ 30%(跟随和声)', hitRate >= 0.3, `${(hitRate * 100).toFixed(0)}%`);

// 7) 全部乐手 connectome 都能加载 + 产出非空旋律(容忍留白:换种子重试)
const modelsRoot = join(here, '..', 'lstm', 'models');
const allNames = readdirSync(modelsRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
console.log(`\n— 全乐手冒烟测试(${allNames.length} 个 connectome)—`);
for (const name of allNames) {
    const dir = join(modelsRoot, name);
    const man = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as ModelManifest;
    const m = loadModel(man, new Uint8Array(readFileSync(join(dir, 'model.q8.bin'))));
    let pitched: typeof notes = [];
    for (let s = 1; s <= 8 && pitched.length === 0; s++) pitched = generateLstmMelody(spans, m, { seed: s }).filter((n) => n.pitch >= 0);
    const ok = m.arch.input === 50 && m.arch.output === 27 && pitched.length > 0 && pitched.every((n) => n.pitch >= LSTM_LOW_BOUND && n.pitch < LSTM_HIGH_BOUND);
    check(`${name} 加载+生成`, ok, `${pitched.length} 音`);
}

console.log(`\n${fail === 0 ? '🟢 全绿' : '🔴 有失败'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
