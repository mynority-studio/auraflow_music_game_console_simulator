// Walking voice-leading + walk pattern 差异化验证
//
// 改动 A：跨 chord 边界 voice-leading 连贯
// 改动 B：按 mood × style 路由不同 WalkPattern（Pedal / HalfNote / JazzQuarter / Stride / LatinTumbao）

import { PRNGManager } from '../src/core/utils/PRNG';
import { runPipeline } from '../src/core/generation/pipeline';
import { StyleId } from '../src/core/generation/config/StyleFlags';
import {
    PianoAccompIdiom, LHTexture, CoordMode, PianoAccompParams,
} from '../src/core/generation/primitives/PianoAccompIdiom';
import { CastingEngine } from '../src/core/generation/pipeline/CastingEngine';
import { getMusicianById } from '../src/core/generation/idioms/MusicianRegistry';
import { BandRole } from '../src/core/generation/types';
import { WalkPatternId, WALK_PATTERNS } from '../src/core/generation/data/BassWalkPatterns';
import { MoodName } from '../src/core/generation/pipeline/MoodRouter';
import { createDefaultRenderContext } from '../src/core/generation/ir/RenderContext';

PRNGManager.setSeed(42);
const { track } = runPipeline({ forcedStyleId: StyleId.JAZZ });

// Solo Piano 模式（无 Bass）才会走 LH WalkingTenths
const plan = CastingEngine.plan({
    roster: {
        mainInst:   getMusicianById('alex_piano')!,
        accomp:     getMusicianById('alex_piano')!,
        bass:       null,
        drums:      getMusicianById('dave_drums')!,
        atmosphere: getMusicianById('nina_pad')!,
    },
    sections: track.sections,
    styleId: StyleId.JAZZ,
    tonality: track.tonality,
    timeSignature: [4, 4],
    bpm: track.bpm,
});

console.log('=== Walking Pattern 路由（Solo Piano + ChillJazz）===\n');
let patternIdsObserved = new Set<WalkPatternId>();
for (let i = 0; i < plan.sectionPlans.length; i++) {
    const sp = plan.sectionPlans[i];
    const params = sp.assignments[BandRole.Accomp]?.instrumentSpecificParams as PianoAccompParams | undefined;
    const section = track.sections[i];
    const sectionName = section.name ?? `section_${i}`;
    if (params?.lhTexture === LHTexture.WalkingTenths) {
        const patternId = params.walkPatternId;
        const patternName = patternId !== undefined ? WALK_PATTERNS[patternId].name : '(legacy)';
        const moodName = params.mood !== undefined ? MoodName[params.mood] : '?';
        if (patternId !== undefined) patternIdsObserved.add(patternId);
        console.log(`  ${sectionName.padEnd(20)} mood=${moodName.padEnd(14)} → ${patternName} (id=${patternId})`);
    } else if (params?.coordMode === CoordMode.M5_TwoHandedVoicing) {
        console.log(`  ${sectionName.padEnd(20)} (M5 spread chord, no walking)`);
    } else if (params?.coordMode === CoordMode.M6_OomPahBounce) {
        console.log(`  ${sectionName.padEnd(20)} (M6 bounce, no walking)`);
    }
}
console.log(`\n→ 观察到 ${patternIdsObserved.size} 种不同 WalkPattern: ${Array.from(patternIdsObserved).map(id => WALK_PATTERNS[id].name).join(', ')}`);

// 取第一个 walking section，跑前 16 拍 bass pitch + 击点密度
console.log('\n=== 第一个 walking section 前 16 拍 bass pitch 序列 ===\n');
const firstWalkingIdx = plan.sectionPlans.findIndex(sp => {
    const p = sp.assignments[BandRole.Accomp]?.instrumentSpecificParams as PianoAccompParams | undefined;
    return p?.lhTexture === LHTexture.WalkingTenths;
});

if (firstWalkingIdx >= 0) {
    const sp = plan.sectionPlans[firstWalkingIdx];
    const section = track.sections[firstWalkingIdx];
    const params = sp.assignments[BandRole.Accomp]!.instrumentSpecificParams as PianoAccompParams;
    const chordsInSection = track.chords.filter(c =>
        c.startBeat >= section.startBeat && c.endBeat <= section.endBeat,
    ).slice(0, 4);

    const notes = PianoAccompIdiom.render({ chords: chordsInSection, config: params, modulation: {}, beatsPerBar: 4, context: createDefaultRenderContext() });
    // 以"低于 RH 起始区"作为 walking 输出（包含 bass + 10th 双音，10th 可达 63 = D#4）
    // 由于 pattern 多 stepDur (0.5/1/2)，不能按 duration 过滤；改按 onset 分组取最低
    const lowNotes = notes.filter(n => n.pitch < 64);
    const byOnset = new Map<string, number>();
    for (const n of lowNotes) {
        const key = n.onset.toFixed(4);
        const prev = byOnset.get(key);
        if (prev === undefined || n.pitch < prev) byOnset.set(key, n.pitch);
    }
    const bass = Array.from(byOnset.entries())
        .map(([k, p]) => ({ onset: parseFloat(k), pitch: p }))
        .sort((a, b) => a.onset - b.onset)
        .filter(b => b.onset < section.startBeat + 16);

    console.log(`Section "${section.name}" | WalkPattern=${params.walkPatternId !== undefined ? WALK_PATTERNS[params.walkPatternId].name : 'legacy'}`);
    console.log(`Chord 序列:`);
    for (const c of chordsInSection) {
        console.log(`  beat ${c.startBeat.toFixed(2)}~${c.endBeat.toFixed(2)} : ${c.numeral}`);
    }
    let lastPitch: number | undefined = undefined;
    console.log(`\nBass pitch 序列:`);
    for (const n of bass) {
        const delta = lastPitch === undefined ? '' : ` (Δ=${n.pitch - lastPitch >= 0 ? '+' : ''}${n.pitch - lastPitch})`;
        console.log(`  beat ${n.onset.toFixed(2).padStart(6)} : pitch=${n.pitch}${delta}`);
        lastPitch = n.pitch;
    }
    const hitsPerBar = bass.length / 4; // 4 bars of 4 beats = 16 beats
    console.log(`\n击点密度: ${bass.length} 击 / ${(section.endBeat - section.startBeat > 16 ? 4 : (section.endBeat - section.startBeat) / 4).toFixed(1)} 小节 ≈ ${hitsPerBar.toFixed(2)} 击/小节`);
}

// 直接对比 4 个 pattern 在同一组 chord 上的击点密度（消除段落差异，纯看 pattern 自身）
console.log('\n=== 4 个 pattern 在同一段 chord 上的击点密度对比（4-chord × 4-beat = 16 beat）===\n');
const sampleChords = track.chords.slice(0, 4);
const samplePatterns: WalkPatternId[] = [
    WalkPatternId.JazzQuarter, WalkPatternId.HalfNote, WalkPatternId.Stride,
    WalkPatternId.Pedal, WalkPatternId.LatinTumbao, WalkPatternId.QuarterHalf,
    WalkPatternId.BebopWalk, WalkPatternId.ScaleClimb,
];
for (const pid of samplePatterns) {
    const params: PianoAccompParams = {
        lhTexture: LHTexture.WalkingTenths,
        rhTexture: 1 as any,  // RHTexture.Block；我们只看 LH
        coordMode: CoordMode.M1_SustainedRoot,
        velocityRange: [55, 100],
        intensityScale: 0.6,
        walkPatternId: pid,
    };
    const notes = PianoAccompIdiom.render({ chords: sampleChords, config: params, modulation: {}, beatsPerBar: 4, context: createDefaultRenderContext() });
    // 取 onset 簇 — pitch < 64 包含 bass+10th
    const lowNotes = notes.filter(n => n.pitch < 64);
    const distinctOnsets = new Set(lowNotes.map(n => n.onset.toFixed(4)));
    // 16 beats 总长，距离 = 击点数
    const hits = distinctOnsets.size;
    const sumDur = sampleChords.reduce((s, c) => s + (c.endBeat - c.startBeat), 0);
    console.log(`  ${WALK_PATTERNS[pid].name.padEnd(16)}: ${hits} 击点 / ${sumDur.toFixed(1)} beats ≈ ${(hits / sumDur * 4).toFixed(2)} 击/小节（pattern ${WALK_PATTERNS[pid].steps.length} steps × ${WALK_PATTERNS[pid].totalBeats} beats）`);
}
