// 改动 E verify — Drop-2 触发场景下 enforceHandSeparation 是否推开撞音 voice
// 直接看 voicing 转换链：raw → Drop-2 → enforceHandSeparation → 实际 RH 输出

import { PRNGManager } from '../src/core/utils/PRNG';
import { runPipeline } from '../src/core/generation/pipeline';
import { StyleId } from '../src/core/generation/config/StyleFlags';
import {
    PianoAccompIdiom, LHTexture, RHTexture, CoordMode, PianoAccompParams,
} from '../src/core/generation/primitives/PianoAccompIdiom';
import { getDrop2Voicing } from '../src/core/generation/data/ScaleHelpers';
import { createDefaultRenderContext } from '../src/core/generation/ir/RenderContext';

PRNGManager.setSeed(42);
const { track } = runPipeline({ forcedStyleId: StyleId.ChillJazz });

const MIN_HAND_SEPARATION = 3;
const RH_MIN_PITCH = 48;

console.log('=== M1 + Sustained + voicingSpan=0.9 (强制 Drop-2) 的双手撞音前后对比 ===\n');

// 过滤掉短 passing chord — RH grid 可能在 <1 拍内无 hit，误判
const sampleChords = track.chords.filter(c => c.voicing && c.voicing.length >= 4 && (c.endBeat - c.startBeat) >= 1).slice(0, 6);

let beforeViolations = 0;
let afterViolations = 0;

for (const chord of sampleChords) {
    const lhPitch = chord.voicing[0];
    const floor = lhPitch + MIN_HAND_SEPARATION;

    // Step 1: raw rhVoicing (voicing.slice(1).filter >= 48)
    const rhRaw = chord.voicing.slice(1).filter((p: number) => p >= RH_MIN_PITCH);
    // Step 2: Drop-2
    const rhDrop2 = rhRaw.length >= 3 ? getDrop2Voicing(rhRaw) : rhRaw.slice();
    // Step 3: 跑实际 render，取所有 RH note 的 pitch（排除已知 LH sustain）
    const params: PianoAccompParams = {
        lhTexture: LHTexture.Sustained,
        rhTexture: RHTexture.Block,
        coordMode: CoordMode.M1_SustainedRoot,
        velocityRange: [55, 100],
        intensityScale: 0.6,
        voicingSpan: 0.9,
    };
    const notes = PianoAccompIdiom.render({ chords: [chord], config: params, modulation: {}, beatsPerBar: 4, context: createDefaultRenderContext() });
    // LH sustain：duration === chord 总长 (4) + pitch === voicing[0]
    const chordDur = chord.endBeat - chord.startBeat;
    const rhActualNotes = notes.filter(n => !(n.pitch === lhPitch && Math.abs(n.duration - chordDur) < 0.01));
    const rhActualPitches = Array.from(new Set(rhActualNotes.map(n => n.pitch))).sort((a, b) => a - b);

    const drop2Min = Math.min(...rhDrop2);
    const actualMin = rhActualPitches.length > 0 ? rhActualPitches[0] : Infinity;
    const beforeViolation = drop2Min < floor;
    const afterViolation = actualMin < floor;
    if (beforeViolation) beforeViolations++;
    if (afterViolation) afterViolations++;

    console.log(`${chord.numeral.padEnd(12)} LH=${lhPitch}, floor=${floor}`);
    console.log(`  raw rhVoicing:    [${rhRaw.join(', ')}]`);
    console.log(`  after Drop-2:     [${rhDrop2.join(', ')}]  最低=${drop2Min} ${beforeViolation ? '❌ < floor' : '✓'}`);
    console.log(`  after enforce E:  [${rhActualPitches.join(', ')}]  最低=${actualMin} ${afterViolation ? '❌ < floor' : '✓'}`);
    console.log();
}

console.log(`=== 统计 ===`);
console.log(`Drop-2 后 floor 违规: ${beforeViolations} / ${sampleChords.length}`);
console.log(`enforceHandSeparation 后 floor 违规: ${afterViolations} / ${sampleChords.length}`);
console.log(`期望: 0 ✓`);
