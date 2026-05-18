// 改动 F verify — 验证 'C' / 'S' 在不同 chord 上抽不同 PC（确定性 hash 多样性）

import { PRNGManager } from '../src/core/utils/PRNG';
import { runPipeline } from '../src/core/generation/pipeline';
import { StyleId } from '../src/core/generation/config/StyleFlags';
import {
    PianoAccompIdiom, LHTexture, RHTexture, CoordMode, PianoAccompParams,
} from '../src/core/generation/primitives/PianoAccompIdiom';
import { WalkPatternId, WALK_PATTERNS } from '../src/core/generation/data/BassWalkPatterns';

PRNGManager.setSeed(42);
const { track } = runPipeline({ forcedStyleId: StyleId.ChillJazz });
const chords = track.chords.slice(0, 8);

console.log('=== BebopWalk (B C 5 A) — 验证 C step PC 多样性 ===\n');
console.log('Chord 序列:');
for (let i = 0; i < chords.length; i++) {
    console.log(`  [${i}] ${chords[i].numeral} (root PC=${chords[i].root})`);
}

const params: PianoAccompParams = {
    lhTexture: LHTexture.WalkingTenths,
    rhTexture: RHTexture.Stab,
    coordMode: CoordMode.M1_SustainedRoot,
    velocityRange: [55, 100],
    intensityScale: 0.6,
    walkPatternId: WalkPatternId.BebopWalk,
};

const notes = PianoAccompIdiom.render({ chords, params, beatsPerBar: 4 });
// 提取 LH bass — 按 onset 取最低 pitch（去除 10th）
const lowNotes = notes.filter(n => n.pitch < 64 && n.duration < 1.5);
const byOnset = new Map<string, number>();
for (const n of lowNotes) {
    const key = n.onset.toFixed(4);
    const prev = byOnset.get(key);
    if (prev === undefined || n.pitch < prev) byOnset.set(key, n.pitch);
}
const bass = Array.from(byOnset.entries())
    .map(([k, p]) => ({ onset: parseFloat(k), pitch: p }))
    .sort((a, b) => a.onset - b.onset);

console.log(`\n每 chord 第 2 拍（C step）抽到的 bass pitch + PC:`);
for (let i = 0; i < chords.length; i++) {
    const c = chords[i];
    // C step 在 BebopWalk 是 step 1（duration=1 起步，第 2 拍开始）
    const cStepNote = bass.find(b => Math.abs(b.onset - (c.startBeat + 1)) < 0.01);
    if (cStepNote) {
        const pc = ((cStepNote.pitch % 12) + 12) % 12;
        const intervalFromRoot = ((pc - c.root) % 12 + 12) % 12;
        const tagMap: Record<number, string> = { 0: 'root', 2: '9th', 3: 'm3', 4: 'M3', 5: '4th', 7: '5th', 8: 'b6/m6', 9: '6th/13', 10: 'm7', 11: 'M7' };
        const tag = tagMap[intervalFromRoot] ?? `+${intervalFromRoot}`;
        console.log(`  chord ${i} (${c.numeral}, root=${c.root}) → pitch=${cStepNote.pitch}, PC=${pc} = ${tag}`);
    } else {
        console.log(`  chord ${i} (${c.numeral}) → (no C step found at beat ${c.startBeat + 1})`);
    }
}

console.log(`\n=== ScaleClimb (B S S A) — 验证 S step 走 scale tone 池（含 9/6 色彩音）===\n`);
const paramsScale: PianoAccompParams = { ...params, walkPatternId: WalkPatternId.ScaleClimb };
const notesScale = PianoAccompIdiom.render({ chords, params: paramsScale, beatsPerBar: 4 });
const lowScale = notesScale.filter(n => n.pitch < 64 && n.duration < 1.5);
const byOnsetScale = new Map<string, number>();
for (const n of lowScale) {
    const key = n.onset.toFixed(4);
    const prev = byOnsetScale.get(key);
    if (prev === undefined || n.pitch < prev) byOnsetScale.set(key, n.pitch);
}
const bassScale = Array.from(byOnsetScale.entries())
    .map(([k, p]) => ({ onset: parseFloat(k), pitch: p }))
    .sort((a, b) => a.onset - b.onset);

console.log(`每 chord 第 2/3 拍（S step）抽到的 PC + 距 root 的音程:`);
for (let i = 0; i < chords.length; i++) {
    const c = chords[i];
    for (const beatOffset of [1, 2]) {
        const sStepNote = bassScale.find(b => Math.abs(b.onset - (c.startBeat + beatOffset)) < 0.01);
        if (sStepNote) {
            const pc = ((sStepNote.pitch % 12) + 12) % 12;
            const intervalFromRoot = ((pc - c.root) % 12 + 12) % 12;
            const tagMap: Record<number, string> = { 0: 'root', 2: '9th', 3: 'm3', 4: 'M3', 5: '4th', 7: '5th', 8: 'b6/m6', 9: '6th/13', 10: 'm7', 11: 'M7' };
            const tag = tagMap[intervalFromRoot] ?? `+${intervalFromRoot}`;
            console.log(`  chord ${i} ${c.numeral} beat +${beatOffset} → pitch=${sStepNote.pitch}, PC=${pc} = ${tag}`);
        }
    }
}
