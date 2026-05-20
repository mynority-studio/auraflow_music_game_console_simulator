// 改动 C verify — voicePattern 精化织体行为验证
//
// 对 Alberti / Montuno / Ragtime 三个新 recipe：
//   1. 击点节奏与 voicePattern 定义一致
//   2. 每 step 发出的 voice 数与 voicePattern[step].length 一致
//   3. Alberti 应输出单音琶音；Montuno onbeat 双音 / offbeat 单音；Ragtime 仅打 voice [1,2]

import { PRNGManager } from '../src/core/utils/PRNG';
import { runPipeline } from '../src/core/generation/pipeline';
import { StyleId } from '../src/core/generation/config/StyleFlags';
import {
    PianoAccompIdiom, LHTexture, RHTexture, CoordMode, PianoAccompParams,
} from '../src/core/generation/primitives/PianoAccompIdiom';
import {
    TextureRecipeId, PIANO_TEXTURE_RECIPES,
} from '../src/core/generation/data/PianoTextureRecipes';
import { createDefaultRenderContext } from '../src/core/generation/ir/RenderContext';

PRNGManager.setSeed(42);
const { track } = runPipeline({ forcedStyleId: StyleId.ChillJazz });

// 取一个 4-beat chord 做基准
const chord = track.chords.find(c => Math.abs((c.endBeat - c.startBeat) - 4) < 0.01);
if (!chord) { console.error('找不到 4-beat chord'); process.exit(1); }
console.log(`基准 chord: ${chord.numeral} (beat ${chord.startBeat}~${chord.endBeat})`);
console.log(`voicing (full): [${chord.voicing.join(', ')}]`);
const rhVoicing = chord.voicing.slice(1).filter((p: number) => p >= 48);
console.log(`rhVoicing (≥C3): [${rhVoicing.join(', ')}] → voice index 0=${rhVoicing[0]}, 1=${rhVoicing[1]}, 2=${rhVoicing[2]}\n`);

const recipesToTest: TextureRecipeId[] = [
    TextureRecipeId.AlbertiBass,
    TextureRecipeId.MontunoInner,
    TextureRecipeId.RagtimeUpperStab,
];

for (const recipeId of recipesToTest) {
    const recipe = PIANO_TEXTURE_RECIPES[recipeId];
    console.log(`=== ${recipe.name} (id=${recipeId}) ===`);
    console.log(`baseGrid:      [${recipe.baseGrid.join(',')}]`);
    if (recipe.voicePattern) {
        console.log(`voicePattern: [${recipe.voicePattern.map(c => c === null ? '·' : `[${c.join(',')}]`).join(' ')}]`);
    }

    const params: PianoAccompParams = {
        lhTexture: LHTexture.Tacit,  // 隔离观察 RH
        rhTexture: recipe.rhTexture,
        coordMode: CoordMode.M4_TacitWithComping,
        velocityRange: [55, 100],
        intensityScale: 0.6,
        recipeId,
    };
    const notes = PianoAccompIdiom.render({ chords: [chord], params, beatsPerBar: 4, context: createDefaultRenderContext() });

    // 按 onset 分组，统计每个击点弹了几个 voice + 哪个 pitch
    const byOnset = new Map<number, number[]>();
    for (const n of notes) {
        const key = Math.round(n.onset * 16) / 16;  // 16-grid 量化
        if (!byOnset.has(key)) byOnset.set(key, []);
        byOnset.get(key)!.push(n.pitch);
    }
    const onsetKeys = Array.from(byOnset.keys()).sort((a, b) => a - b);
    console.log(`总击点: ${onsetKeys.length}`);
    console.log(`每击点 voice 数 + pitch:`);
    for (const o of onsetKeys) {
        const pitches = byOnset.get(o)!.sort((a, b) => a - b);
        const step = Math.round((o - chord.startBeat) * 4);
        const expected = recipe.voicePattern ? recipe.voicePattern[step % 16] : null;
        const expectedStr = expected === null || expected === undefined ? '·' : `[${expected.join(',')}]`;
        console.log(`  step ${String(step).padStart(2)} (beat ${o.toFixed(2).padStart(5)}): ${pitches.length} voice → [${pitches.join(',')}]  | recipe says ${expectedStr}`);
    }
    console.log();
}

// 旧 recipe 不应受影响 — 跑 PopHeartbeat（无 voicePattern）确认 Block 行为
console.log('=== PopHeartbeat (id=3, 无 voicePattern) — 验证旧 recipe 不回归 ===');
const popParams: PianoAccompParams = {
    lhTexture: LHTexture.Tacit,
    rhTexture: RHTexture.Block,
    coordMode: CoordMode.M4_TacitWithComping,
    velocityRange: [55, 100],
    intensityScale: 0.6,
    recipeId: TextureRecipeId.PopHeartbeat,
};
const popNotes = PianoAccompIdiom.render({ chords: [chord], params: popParams, beatsPerBar: 4, context: createDefaultRenderContext() });
const popByOnset = new Map<number, number>();
for (const n of popNotes) {
    const key = Math.round(n.onset * 16) / 16;
    popByOnset.set(key, (popByOnset.get(key) ?? 0) + 1);
}
console.log(`PopHeartbeat 总击点: ${popByOnset.size}（无 voicePattern 走 Block 全 voicing 齐砸）`);
const multiVoiceOnsets = Array.from(popByOnset.values()).filter(v => v >= 2).length;
console.log(`其中多声部 onset (≥2 voice 齐砸): ${multiVoiceOnsets}（Block 期望 = 总击点）`);
