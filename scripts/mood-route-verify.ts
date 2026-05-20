// 改动 D verify — 跑 3 个 style，看每段命中的 recipe 名（验证 AlbertiBass / MontunoInner 被实际触发）

import { PRNGManager } from '../src/core/utils/PRNG';
import { runPipeline } from '../src/core/generation/pipeline';
import { StyleId } from '../src/core/generation/config/StyleFlags';
import { CastingEngine } from '../src/core/generation/pipeline/CastingEngine';
import { getMusicianById } from '../src/core/generation/idioms/MusicianRegistry';
import { BandRole } from '../src/core/generation/types';
import {
    PianoAccompParams,
} from '../src/core/generation/primitives/PianoAccompIdiom';
import { PIANO_TEXTURE_RECIPES, TextureRecipeId } from '../src/core/generation/data/PianoTextureRecipes';
import { MoodName } from '../src/core/generation/pipeline/MoodRouter';

const styles: { id: StyleId; name: string }[] = [
    { id: StyleId.ModernPop, name: 'ModernPop' },
    { id: StyleId.ChillJazz, name: 'ChillJazz' },
    { id: StyleId.NeoSoul,   name: 'NeoSoul'   },
];

const recipeHitCount: Record<number, number> = {};

for (const style of styles) {
    PRNGManager.setSeed(42);
    const { track } = runPipeline({ forcedStyleId: style.id });
    const plan = CastingEngine.plan({
        roster: {
            mainInst:   getMusicianById('alex_piano')!,
            accomp:     getMusicianById('alex_piano')!,
            bass:       getMusicianById('frank_bass')!,
            drums:      getMusicianById('dave_drums')!,
            atmosphere: getMusicianById('nina_pad')!,
        },
        sections: track.sections,
        styleId: style.id,
        tonality: track.tonality,
        timeSignature: [4, 4],
        bpm: track.bpm,
    });

    console.log(`\n=== ${style.name} (seed=42) ===`);
    for (let i = 0; i < plan.sectionPlans.length; i++) {
        const sp = plan.sectionPlans[i];
        const params = sp.assignments[BandRole.Accomp]?.instrumentSpecificParams as PianoAccompParams | undefined;
        const section = track.sections[i];
        if (params?.recipeId === undefined) continue;
        const recipe = PIANO_TEXTURE_RECIPES[params.recipeId];
        const moodName = params.mood !== undefined ? MoodName[params.mood] : '?';
        const marker = recipe.voicePattern ? ' ★' : '';
        console.log(`  ${(section.name ?? '?').padEnd(20)} mood=${moodName.padEnd(14)} → ${recipe.name}${marker}`);
        recipeHitCount[params.recipeId] = (recipeHitCount[params.recipeId] ?? 0) + 1;
    }
}

// 顺便试 NeoSoul + Marcus persona (syncopationAssault 高) — 看 Groovy 是否被触发
console.log(`\n=== NeoSoul + Marcus (高 syncopationAssault，期望 Groovy mood 触发) ===`);
PRNGManager.setSeed(42);
const { track: nsTrack } = runPipeline({ forcedStyleId: StyleId.NeoSoul });
const nsPlan = CastingEngine.plan({
    roster: {
        mainInst:   getMusicianById('marcus_neosoul_piano')!,
        accomp:     getMusicianById('marcus_neosoul_piano')!,
        bass:       getMusicianById('frank_bass')!,
        drums:      getMusicianById('dave_drums')!,
        atmosphere: getMusicianById('nina_pad')!,
    },
    sections: nsTrack.sections,
    styleId: StyleId.NeoSoul,
    tonality: nsTrack.tonality,
    timeSignature: [4, 4],
    bpm: nsTrack.bpm,
});
for (let i = 0; i < nsPlan.sectionPlans.length; i++) {
    const sp = nsPlan.sectionPlans[i];
    const params = sp.assignments[BandRole.Accomp]?.instrumentSpecificParams as PianoAccompParams | undefined;
    const section = nsTrack.sections[i];
    if (params?.recipeId === undefined) continue;
    const recipe = PIANO_TEXTURE_RECIPES[params.recipeId];
    const moodName = params.mood !== undefined ? MoodName[params.mood] : '?';
    const marker = recipe.voicePattern ? ' ★' : '';
    console.log(`  ${(section.name ?? '?').padEnd(20)} mood=${moodName.padEnd(14)} → ${recipe.name}${marker}`);
    recipeHitCount[params.recipeId] = (recipeHitCount[params.recipeId] ?? 0) + 1;
}

console.log(`\n=== Recipe 命中统计（★ = voicePattern 精化织体）===`);
const ids = Object.keys(recipeHitCount).map(Number).sort((a, b) => a - b);
for (const id of ids) {
    const recipe = PIANO_TEXTURE_RECIPES[id as TextureRecipeId];
    const marker = recipe.voicePattern ? ' ★' : '';
    console.log(`  ${recipe.name.padEnd(20)} : ${recipeHitCount[id]} sections${marker}`);
}

const vpHits = ids.filter(id => PIANO_TEXTURE_RECIPES[id as TextureRecipeId].voicePattern !== undefined)
                  .reduce((s, id) => s + recipeHitCount[id], 0);
const totalHits = ids.reduce((s, id) => s + recipeHitCount[id], 0);
console.log(`\n→ voicePattern 精化织体命中: ${vpHits} / ${totalHits} sections (${(vpHits / totalHits * 100).toFixed(1)}%)`);

// 扫多 seed 找 Alberti 命中
console.log(`\n=== 多 seed 扫描 — AlbertiBass 命中情况 ===`);
let albertiSeeds: { seed: number; style: string; section: string; mood: string }[] = [];
const styleNamesByEnum: Record<number, string> = { 0: 'ModernPop', 1: 'ChillJazz', 2: 'NeoSoul' };
for (let seed = 1; seed <= 200; seed++) {
    for (const style of [StyleId.ModernPop, StyleId.ChillJazz, StyleId.NeoSoul]) {
        PRNGManager.setSeed(seed);
        const { track } = runPipeline({ forcedStyleId: style });
        const plan = CastingEngine.plan({
            roster: {
                mainInst:   getMusicianById('alex_piano')!,
                accomp:     getMusicianById('alex_piano')!,
                bass:       getMusicianById('frank_bass')!,
                drums:      getMusicianById('dave_drums')!,
                atmosphere: getMusicianById('nina_pad')!,
            },
            sections: track.sections,
            styleId: style,
            tonality: track.tonality,
            timeSignature: [4, 4],
            bpm: track.bpm,
        });
        for (let i = 0; i < plan.sectionPlans.length; i++) {
            const params = plan.sectionPlans[i].assignments[BandRole.Accomp]?.instrumentSpecificParams as PianoAccompParams | undefined;
            if (params?.recipeId === TextureRecipeId.AlbertiBass) {
                albertiSeeds.push({
                    seed,
                    style: styleNamesByEnum[style],
                    section: track.sections[i].name ?? '?',
                    mood: params.mood !== undefined ? MoodName[params.mood] : '?',
                });
            }
        }
    }
}
console.log(`AlbertiBass 在 [1, 200] seed 范围内命中 ${albertiSeeds.length} 次：`);
for (const hit of albertiSeeds.slice(0, 10)) {
    console.log(`  seed=${hit.seed} ${hit.style} ${hit.section} mood=${hit.mood}`);
}
if (albertiSeeds.length > 10) console.log(`  ... (省略 ${albertiSeeds.length - 10} 项)`);
