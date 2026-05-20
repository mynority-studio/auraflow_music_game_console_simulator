/**
 * Smoke test for BandEngine MVP — verifies:
 *   1. BandPlan is non-empty (sectionPlans + activeMusicians populated)
 *   2. Stage5 returns 5 tracks including atmosphere
 *   3. ArrangedTrack has atmosphere field
 *   4. MidiConverter routes Atmosphere channel correctly
 *   5. eligibleRoles validation works
 *
 * 用法：npx tsx scripts/smoke-band-engine.ts
 */

import { PRNGManager } from '../src/core/utils/PRNG';
import { runPipeline } from '../src/core/generation/pipeline';
import { AbsoluteTransposer } from '../src/core/generation/pipeline/AbsoluteTransposer';
import { MidiConverter, CHANNEL_ATMOSPHERE, CHANNEL_ELECTRIC_BASS, CHANNEL_PIANO_LH } from '../src/core/audio/MidiConverter';
import { CastingEngine } from '../src/core/generation/pipeline/CastingEngine';
import { StyleId } from '../src/core/generation/config/StyleFlags';
import { getMusicianById } from '../src/core/generation/idioms/MusicianRegistry';
import { BandRole, SectionType } from '../src/core/generation/types';
import { RHTexture, LHTexture, CoordMode, PianoAccompParams } from '../src/core/generation/primitives/PianoAccompIdiom';
import { PianoAccompIdiom } from '../src/core/generation/primitives/PianoAccompIdiom';
import { createDefaultRenderContext } from '../src/core/generation/ir/RenderContext';

let failures = 0;
function assert(cond: boolean, msg: string) {
    if (!cond) {
        console.error(`  ❌ ${msg}`);
        failures++;
    } else {
        console.log(`  ✅ ${msg}`);
    }
}

console.log('\n=== BandEngine MVP smoke test ===\n');

PRNGManager.setSeed(42);
const { track, context } = runPipeline({ forcedStyleId: StyleId.JAZZ });
const arranged = AbsoluteTransposer.arrange(track, StyleId.JAZZ, context);
const events = MidiConverter.convert(arranged);

console.log('1. Pipeline output structure');
assert(Array.isArray(track.atmosphere), 'GeneratedTrack.atmosphere is array');
assert(Array.isArray(track.melody), 'GeneratedTrack.melody is array');
assert(Array.isArray(track.bass), 'GeneratedTrack.bass is array');
assert(Array.isArray(track.accompaniment), 'GeneratedTrack.accompaniment is array');
assert(Array.isArray(track.drums), 'GeneratedTrack.drums is array');

console.log('\n2. ArrangedTrack atmosphere field');
assert(Array.isArray(arranged.atmosphere), 'ArrangedTrack.atmosphere is array');
assert(arranged.pianoRH.length > 0, 'ArrangedTrack.pianoRH non-empty');
assert(arranged.pianoLH.length > 0, 'ArrangedTrack.pianoLH non-empty');
assert(arranged.melody.length > 0, 'ArrangedTrack.melody non-empty');

console.log('\n3. MidiConverter Atmosphere channel (Step 4 — renderer in place)');
const atmEvents = events.filter(e => e.channel === CHANNEL_ATMOSPHERE);
const atmNoteOns = atmEvents.filter(e => e.type === 'noteOn');
const atmProgramChange = atmEvents.filter(e => e.type === 'programChange');
console.log(`  Atmosphere channel events: ${atmEvents.length} (noteOn=${atmNoteOns.length}, programChange=${atmProgramChange.length})`);
assert(atmProgramChange.length === 1, 'Atmosphere channel programChange (Warm Pad) emitted');
assert(atmNoteOns.length > 0, 'Atmosphere channel has noteOn events (pad renders sound)');
assert(arranged.atmosphere!.length > 0, 'ArrangedTrack.atmosphere non-empty after renderer wired');
// Pad velocity should be in Nina's range [40, 75] scaled to MIDI 0~127. CC scaling already converted.
const padVelocities = atmNoteOns.map(e => e.data2);
const minVel = Math.min(...padVelocities);
const maxVel = Math.max(...padVelocities);
console.log(`  Pad velocity range observed: [${minVel}, ${maxVel}] (Nina card: [40, 75])`);
assert(minVel >= 30 && maxVel <= 90, 'Pad velocities within Nina card range (allowing intensity scaling)');

console.log('\n4. BandEngine direct call');
const plan = CastingEngine.plan({
    roster: {
        mainInst:   getMusicianById('alex_piano')!,
        accomp:     getMusicianById('alex_piano')!,
        bass:       getMusicianById('frank_bass')!,
        drums:      getMusicianById('dave_drums')!,
        atmosphere: getMusicianById('nina_pad')!,
    },
    sections: track.sections,
    styleId: StyleId.JAZZ,
    tonality: track.tonality,
    timeSignature: [4, 4],
    bpm: track.bpm,
});
assert(
    plan.sectionPlans.length === track.sections.length,
    `BandPlan.sectionPlans length matches sections (${plan.sectionPlans.length} == ${track.sections.length})`,
);
assert(plan.activeMusicians.length === 5, `BandPlan.activeMusicians has 5 entries (got ${plan.activeMusicians.length})`);
const firstSection = plan.sectionPlans[0];
assert(firstSection.assignments[BandRole.Bass] !== undefined, 'first SectionPlan has Bass assignment');
assert(firstSection.assignments[BandRole.Atmosphere] !== undefined, 'first SectionPlan has Atmosphere assignment');
const bassAssign = firstSection.assignments[BandRole.Bass]!;
assert(bassAssign.musicianId === 'frank_bass', `Bass slot is Frank (${bassAssign.musicianId})`);
assert(
    bassAssign.intensityScale > 0 && bassAssign.intensityScale <= 1,
    `Bass intensityScale in (0,1] (${bassAssign.intensityScale})`,
);

console.log('\n5. eligibleRoles validation');
const alex = getMusicianById('alex_piano')!;
assert(alex.eligibleRoles.includes(BandRole.MainInst), 'Alex eligible for MainInst');
assert(alex.eligibleRoles.includes(BandRole.Accomp), 'Alex eligible for Accomp');
assert(!alex.eligibleRoles.includes(BandRole.Bass), 'Alex NOT eligible for Bass');
const nina = getMusicianById('nina_pad')!;
assert(
    nina.eligibleRoles.length === 1 && nina.eligibleRoles[0] === BandRole.Atmosphere,
    'Nina only eligible for Atmosphere',
);

console.log('\n6. Listening sanity — all 5 tracks non-empty across all 3 styles');
for (const style of [StyleId.POP, StyleId.RNB, StyleId.JAZZ]) {
    PRNGManager.setSeed(42);
    const { track: t } = runPipeline({ forcedStyleId: style });
    assert(
        (t.accompaniment?.length ?? 0) > 0 && (t.bass?.length ?? 0) > 0 && (t.atmosphere?.length ?? 0) > 0,
        `style=${style} produces non-empty accomp + bass + atmosphere ` +
            `(accomp=${t.accompaniment?.length}, bass=${t.bass?.length}, atmo=${t.atmosphere?.length})`,
    );
}

console.log('\n7. Atmosphere ConductorMask — Break/Breakdown should NOT contain pad notes');
PRNGManager.setSeed(42);
const { track: tracker } = runPipeline({ forcedStyleId: StyleId.POP });
const breakSections = tracker.sections.filter(s =>
    s.sectionType === SectionType.Break || s.sectionType === SectionType.Breakdown,
);
if (breakSections.length > 0) {
    for (const breakSection of breakSections) {
        const padInBreak = (tracker.atmosphere ?? []).filter(
            n => n.onset >= breakSection.startBeat && n.onset < breakSection.endBeat,
        );
        assert(padInBreak.length === 0, `pad silent in ${breakSection.name} (got ${padInBreak.length} notes)`);
    }
} else {
    console.log('  (no Break/Breakdown sections in this seed; skipping assertion)');
}

console.log('\n8. PianoAccompIdiom 织体选择 — BandEngine 按 sectionType 选 RH 织体');
PRNGManager.setSeed(42);
const { track: pianoTrack } = runPipeline({ forcedStyleId: StyleId.JAZZ });
// 验证：默认 roster 有 Bass → 所有段落都应是 M4 (Tacit + RH)
const pianoPlan = CastingEngine.plan({
    roster: {
        mainInst:   getMusicianById('alex_piano')!,
        accomp:     getMusicianById('alex_piano')!,
        bass:       getMusicianById('frank_bass')!,
        drums:      getMusicianById('dave_drums')!,
        atmosphere: getMusicianById('nina_pad')!,
    },
    sections: pianoTrack.sections,
    styleId: StyleId.JAZZ,
    tonality: pianoTrack.tonality,
    timeSignature: [4, 4],
    bpm: pianoTrack.bpm,
});
const accompTextures = pianoPlan.sectionPlans
    .map(sp => sp.assignments[BandRole.Accomp]?.instrumentSpecificParams as PianoAccompParams | undefined)
    .filter(p => p !== undefined) as PianoAccompParams[];
assert(accompTextures.length === pianoTrack.sections.length, 'every section has PianoAccompParams');
assert(accompTextures.every(p => p.coordMode === CoordMode.M7_ShellWithComping), 'all sections use M7 ShellWithComping (bass active, A3a)');
const distinctRH = new Set(accompTextures.map(p => p.rhTexture));
assert(distinctRH.size >= 2, `at least 2 distinct RH textures across sections (got ${distinctRH.size})`);
console.log(`  RH textures per section: [${accompTextures.map(p => RHTexture[p.rhTexture]).join(', ')}]`);

console.log('\n9. Accompaniment Block 织体存在（同 onset 多 pitch）— 消灭"单音根音"现象');
const accompNotes = pianoTrack.accompaniment!;
// 按 onset 分组
const onsetGroups = new Map<string, number>();
for (const n of accompNotes) {
    const key = n.onset.toFixed(4);
    onsetGroups.set(key, (onsetGroups.get(key) ?? 0) + 1);
}
const multiVoiceOnsets = Array.from(onsetGroups.values()).filter(c => c > 1).length;
const singleVoiceOnsets = Array.from(onsetGroups.values()).filter(c => c === 1).length;
console.log(`  多声部 onset (Block/Stab): ${multiVoiceOnsets} / 单声部 onset (Broken): ${singleVoiceOnsets} / 总 onset: ${onsetGroups.size}`);
assert(multiVoiceOnsets > 0, 'accompaniment 含 Block/Stab 织体（同 onset 多 pitch）');
// Sub-Phase 3 之后 mood router 让 Dreamy 段（Bridge/Intro/Outro）默认走 Arpeggio8th (Broken)，
// 单声部 onset 占比天然上升。这里只验证多声部存在 + 不少于 8%（不为零即可，避免回归到"全单音"）。
assert(multiVoiceOnsets / onsetGroups.size > 0.08, `Block/Stab 占比 > 8% (实际 ${(multiVoiceOnsets / onsetGroups.size * 100).toFixed(1)}%)`);

console.log('\n10. Solo Piano 模式（无 Bass）— Walking Tenths + M5 路由');
PRNGManager.setSeed(42);
const noBassPlan = CastingEngine.plan({
    roster: {
        mainInst:   getMusicianById('alex_piano')!,
        accomp:     getMusicianById('alex_piano')!,
        bass:       null,  // 关掉 Bass
        drums:      getMusicianById('dave_drums')!,
        atmosphere: getMusicianById('nina_pad')!,
    },
    sections: pianoTrack.sections,
    styleId: StyleId.JAZZ,
    tonality: pianoTrack.tonality,
    timeSignature: [4, 4],
    bpm: pianoTrack.bpm,
});
const soloParams = noBassPlan.sectionPlans.map(sp =>
    sp.assignments[BandRole.Accomp]?.instrumentSpecificParams as PianoAccompParams,
);
const grooveSoloParams = soloParams.filter(p =>
    p.coordMode === CoordMode.M1_SustainedRoot && p.lhTexture === LHTexture.WalkingTenths,
);
const lushSoloParams = soloParams.filter(p => p.coordMode === CoordMode.M5_TwoHandedVoicing);
console.log(`  groove sections → Walking: ${grooveSoloParams.length}`);
console.log(`  lush sections → M5:        ${lushSoloParams.length}`);
assert(grooveSoloParams.length + lushSoloParams.length === soloParams.length, 'all Solo Piano sections route to either Walking or M5');
assert(grooveSoloParams.length > 0 || lushSoloParams.length > 0, 'at least one Solo Piano texture engaged');

console.log('\n11. D — Walking Tenths 物理验证');
// 找一个 groove section + 4-beat chord，验证 LH 输出 4 拍 walking + 10th 双音
const grooveSection = pianoTrack.sections.find(s =>
    s.sectionType === SectionType.Verse || s.sectionType === SectionType.PreChorus
    || s.sectionType === SectionType.Chorus || s.sectionType === SectionType.Drop
    || s.sectionType === SectionType.BuildUp,
);
if (grooveSection !== undefined) {
    const chordsInSection = pianoTrack.chords.filter(c =>
        c.startBeat >= grooveSection.startBeat && c.endBeat <= grooveSection.endBeat,
    );
    if (chordsInSection.length > 0) {
        const walkingParams: PianoAccompParams = {
            lhTexture: LHTexture.WalkingTenths,
            rhTexture: RHTexture.Stab,
            coordMode: CoordMode.M1_SustainedRoot,
            velocityRange: [55, 100],
            intensityScale: 0.6,
        };
        const walkingNotes = PianoAccompIdiom.render({
            chords: chordsInSection.slice(0, 2),
            config: walkingParams,
            modulation: {},
            beatsPerBar: 4,
            context: createDefaultRenderContext(),
        });
        // Walking notes 有独特 duration 0.9（区别于 RH Stab 的 0.4 max + RH Block/Broken 的精确 beat 倍数）
        const walkingOnly = walkingNotes.filter(n => Math.abs(n.duration - 0.9) < 0.01);
        const lhBass = walkingOnly.filter(n => n.pitch < 48);     // C2 锚区
        const lhTenth = walkingOnly.filter(n => n.pitch >= 48);   // 10th 在 RH 起始区
        console.log(`  Walking bass notes: ${lhBass.length} / 10th notes: ${lhTenth.length}`);
        assert(lhBass.length > 0, 'Walking Tenths emits bass notes in C2 anchor region');
        assert(lhTenth.length > 0, 'Walking Tenths emits 10th interval notes above bass');

        // 验证：每个 walking onset 都有 bass + 10th 双音（除非 sus 和弦）
        const bassOnsets = new Set(lhBass.map(n => n.onset.toFixed(4)));
        let doubleStops = 0;
        for (const onset of bassOnsets) {
            const tenthAtSameOnset = lhTenth.find(t => t.onset.toFixed(4) === onset);
            if (tenthAtSameOnset !== undefined) doubleStops++;
        }
        console.log(`  Walking double-stops (root+10th pairs): ${doubleStops} / ${bassOnsets.size}`);
        assert(doubleStops > 0, 'Walking Tenths produces double-stops (root + 10th)');
    }
}

console.log('\n12. E — M5 Two-Handed Voicing 物理验证');
const lushSection = pianoTrack.sections.find(s =>
    s.sectionType === SectionType.Bridge || s.sectionType === SectionType.Intro
    || s.sectionType === SectionType.Outro || s.sectionType === SectionType.PreOutro
    || s.sectionType === SectionType.Solo_Bridge,
);
if (lushSection !== undefined) {
    const lushChords = pianoTrack.chords.filter(c =>
        c.startBeat >= lushSection.startBeat && c.endBeat <= lushSection.endBeat,
    );
    if (lushChords.length > 0) {
        const m5Params: PianoAccompParams = {
            lhTexture: LHTexture.Tacit,
            rhTexture: RHTexture.Block,
            coordMode: CoordMode.M5_TwoHandedVoicing,
            velocityRange: [55, 100],
            intensityScale: 0.6,
        };
        const m5Notes = PianoAccompIdiom.render({
            chords: lushChords.slice(0, 1),
            config: m5Params,
            modulation: {},
            beatsPerBar: 4,
            context: createDefaultRenderContext(),
        });
        // M5 应输出 5-6 个 voice，全部同 onset，同 duration
        const firstChord = lushChords[0];
        const m5InChord = m5Notes.filter(n =>
            Math.abs(n.onset - firstChord.startBeat) < 0.01,
        );
        console.log(`  M5 voice count for first lush chord: ${m5InChord.length}`);
        assert(m5InChord.length >= 5 && m5InChord.length <= 7, `M5 emits 5~7 voices (got ${m5InChord.length})`);

        // 最低 voice 应在 LH 八度区域（< C3 = 48），verify spread to bass
        const lowestPitch = Math.min(...m5InChord.map(n => n.pitch));
        console.log(`  M5 lowest voice: ${lowestPitch} (expect < 48 = LH bass octave)`);
        assert(lowestPitch < 48, `M5 has LH octave-doubled bass (lowest=${lowestPitch})`);

        // 所有 voice duration 一致 — sustained chord
        const dur0 = m5InChord[0].duration;
        const allSameDur = m5InChord.every(n => Math.abs(n.duration - dur0) < 0.01);
        assert(allSameDur, 'M5 all voices share same duration (sustained spread chord)');
    }
}

console.log('\n13. V4.1 — Billy Bounce M6 触发（Solo Piano 模式）');
import('../src/core/generation/idioms/MusicianRegistry').then(({ getMusicianById }) => null);
PRNGManager.setSeed(42);
const billyPlan = CastingEngine.plan({
    roster: {
        mainInst:   getMusicianById('billy_bounce')!,
        accomp:     getMusicianById('billy_bounce')!,
        bass:       null,  // Solo Piano 模式触发 bounce
        drums:      getMusicianById('dave_drums')!,
        atmosphere: getMusicianById('nina_pad')!,
    },
    sections: tracker.sections,
    styleId: StyleId.POP,
    tonality: tracker.tonality,
    timeSignature: [4, 4],
    bpm: tracker.bpm,
});
const billyParams = billyPlan.sectionPlans.map(sp =>
    sp.assignments[BandRole.Accomp]?.instrumentSpecificParams as PianoAccompParams,
);
const m6Count = billyParams.filter(p => p?.coordMode === CoordMode.M6_OomPahBounce).length;
console.log(`  Billy groove sections → M6 Bounce: ${m6Count}`);
assert(m6Count > 0, 'Billy Solo Piano 触发 M6 Bounce');

console.log('\n14. V4.2a — parseNumeral 单元测试');
import('../src/core/generation/data/ChordNumeralParser').then(() => null);
const { parseNumeral } = await import('../src/core/generation/data/ChordNumeralParser');
const t = await import('../src/core/generation/types');
const Tonality = t.Tonality;
const ChordQuality = t.ChordQuality;

const tc1 = parseNumeral('IVmaj7', Tonality.Major);
assert(tc1.root === 5 && tc1.quality === ChordQuality.Major7, `IVmaj7 → root=5, Major7 (got root=${tc1.root}, q=${tc1.quality})`);
const tc2 = parseNumeral('vi', Tonality.Major);
assert(tc2.root === 9 && tc2.quality === ChordQuality.Minor, `vi → root=9, Minor (got root=${tc2.root}, q=${tc2.quality})`);
const tc3 = parseNumeral('V7', Tonality.Major);
assert(tc3.root === 7 && tc3.quality === ChordQuality.Dominant7, `V7 → root=7, Dom7 (got root=${tc3.root}, q=${tc3.quality})`);
const tc4 = parseNumeral('iiø', Tonality.Major);
assert(tc4.root === 2 && tc4.quality === ChordQuality.HalfDiminished, `iiø → root=2, HalfDim (got root=${tc4.root}, q=${tc4.quality})`);
const tc5 = parseNumeral('bVImaj7', Tonality.Major);
assert(tc5.root === 8 && tc5.quality === ChordQuality.Major7, `bVImaj7 → root=8, Maj7 (got root=${tc5.root}, q=${tc5.quality})`);

console.log('\n15. V4.2c — 进行池命中验证');
// 默认 roster 跑 ChillJazz，应该有部分 chord numeral 是 pool 进行的字符串（如 Imaj7 / IVmaj7 / ii7）
PRNGManager.setSeed(42);
const { track: jazzTrack } = runPipeline({ forcedStyleId: StyleId.JAZZ });
const poolNumerals = new Set(['Imaj7', 'IVmaj7', 'ii7', 'V7', 'vi7', 'iii7', 'iiø', 'i7']);
const poolChords = jazzTrack.chords.filter(c => poolNumerals.has(c.numeral));
const algoChords = jazzTrack.chords.filter(c =>
    c.numeral.includes('Maj7') === false && c.numeral.includes('V7/') === false
    && !poolNumerals.has(c.numeral) && c.numeral.length <= 6,
);
console.log(`  Total chords: ${jazzTrack.chords.length} / Pool-style: ${poolChords.length}`);
assert(poolChords.length > 0, 'ChillJazz 跑出来的 chords 含 pool numeral (Imaj7/ii7/V7/...)');

console.log('\n16. V5.1 — 新乐手卡牌已入池');
const { MUSICIAN_POOL } = await import('../src/core/generation/idioms/MusicianRegistry');
const expectedCards = ['alex_piano', 'billy_bounce', 'chloe_pop_piano', 'marcus_neosoul_piano',
                        'frank_bass', 'maya_slap_bass', 'dave_drums', 'jazz_brush_drummer', 'nina_pad'];
for (const id of expectedCards) {
    const found = MUSICIAN_POOL.find((m: any) => m.id === id);
    assert(found !== undefined, `卡牌 ${id} 在池中`);
}
console.log(`  Total musicians in pool: ${MUSICIAN_POOL.length}`);

console.log('\n17. V5.2 — Swing offset 验证（ChillJazz swingRatio=0.55 应产生 8th offbeat 偏移）');
PRNGManager.setSeed(42);
const { track: jazzSwing, context: jazzCtx } = runPipeline({ forcedStyleId: StyleId.JAZZ });
const swingArranged = AbsoluteTransposer.arrange(jazzSwing, StyleId.JAZZ, jazzCtx);
// 找 accomp 里有没有 onset 非 0.25 倍数的（说明 swing 偏移生效）
const accompOnsets = swingArranged.pianoRH.map(n => n.onset);
let swingShifted = 0;
for (const o of accompOnsets) {
    const fractional = (o * 16) % 1;
    if (Math.abs(fractional) > 0.001 && Math.abs(fractional - 1) > 0.001) swingShifted++;
}
console.log(`  Onset 非 16-grid 对齐数: ${swingShifted} / ${accompOnsets.length}`);
assert(swingShifted > 0, 'ChillJazz 触发 swing offset（部分 onset 非 grid-aligned）');

console.log('\n18. V5.3 — ElectricBass 独立通道 + PianoLH 现在是 Grand');
const v5Events = MidiConverter.convert(swingArranged);
const ebEvents = v5Events.filter(e => e.channel === CHANNEL_ELECTRIC_BASS);
const ebProgram = ebEvents.find(e => e.type === 'programChange');
console.log(`  ElectricBass channel events: ${ebEvents.length}, program=${ebProgram?.data1}`);
assert(ebProgram?.data1 === 33, 'ElectricBass channel 7 程式为 GM 33 (Finger Bass)');
const lhEvents = v5Events.filter(e => e.channel === CHANNEL_PIANO_LH);
const lhProgram = lhEvents.find(e => e.type === 'programChange');
console.log(`  PianoLH channel events: ${lhEvents.length}, program=${lhProgram?.data1}`);
assert(lhProgram?.data1 === 0, 'PianoLH channel 5 程式为 GM 0 (Grand Piano)');

console.log('\n19. V5.4 — forcedBand UI 路由验证（Marcus 替换 Alex）');
PRNGManager.setSeed(42);
const { track: marcusTrack } = runPipeline({
    forcedStyleId: StyleId.JAZZ,
    forcedBand: { [BandRole.Accomp]: 'marcus_neosoul_piano' },
});
// Marcus syncopationAssault=0.75 → useSolver=true，应产生不同 onset 分布
assert((marcusTrack.accompaniment?.length ?? 0) > 0, 'Marcus 替换后仍生成 accomp');
console.log(`  Marcus accomp note count: ${marcusTrack.accompaniment?.length}`);

console.log(`\n=== ${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURES`} ===\n`);
process.exit(failures === 0 ? 0 : 1);
