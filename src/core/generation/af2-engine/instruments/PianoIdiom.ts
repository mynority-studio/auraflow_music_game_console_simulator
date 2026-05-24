// ============================================================
// PianoIdiom — AF2 钢琴乐器 idiom(Phase A:槽位 API split;Phase B:音区概率分布)
// ============================================================
//
// 在用户的三层架构里,本文件属于**"世界规则库" 之 "乐器 baseidiom"**子层
//(AF2 私有版本,Phase N 删 AF/MG 后可考虑提升到顶层 src/core/generation/instruments/)。
//
// Phase A 职责:按 role 拆 3 个 API(realizeMelody / realizeAccomp / realizeBass)。
// Phase B 职责:实装 95% 主区音区分布 + 5% 越界保留。
//
// Phase B 音区设计:
//   realizeMelody  主区 [C4=60, D6=86]    超主区音 95% 拉回 / 5% 越界保留
//   realizeAccomp  主区 [C3=48, B4=71]    超主区音 95% 拉回 / 5% 越界保留
//   realizeBass    主区 [A1=33, G3=55]    超主区音 95% 拉回 / 5% 越界保留
//
// 概率门用 deterministic hash(pitch + onset)— 不消耗 PRNG,可重现。
// 拉回 = 八度移调(±12 半音)直到落入主区。
//
// 与 mg 偏离声明:Phase B 是 AF2 主动改 pitch(八度移调),与 Phase 1 的"直通忠实
// mg"不一致。但 2026-05-21 reframe 后 AF2 ≠ MG bit-exact 已可接受,验收锚点改为
// "AF2 听感不输给 mg-standalone"。
//
// 物理声明(供 BandSelectionPanel 校验槽位):
//   - 音域:21-108(标准 88 键)
//   - 可放槽位:MainInst / Accomp / Bass(钢琴能独奏可主奏可伴奏可做低音)
//   - 不能放:Drums / Vocal(物理性质不同)
// ============================================================

import type { GeneratedChord, NoteData } from '../../types';
import { BandRole, ChordQuality } from '../../types';
// C.5:MusicianPlanInput 共享协议 + per-section role gate
import type { MusicianPlanInput, ConductorRole } from '../Conductor';
import { getMyRolesInSection, findSectionIdxForBeat } from '../Conductor';
import { generateAf2Melody } from '../Af2MelodyGen';

/** 钢琴物理参数(Phase 1 仅文档,Phase 2+ BandSelectionPanel 消费) */
export const PIANO_INSTRUMENT_SPEC = {
    /** GM program number(Grand Piano) */
    gmProgram: 0,
    /** 物理音域(MIDI) */
    rangeLo: 21,
    rangeHi: 108,
    /** 可放置的乐队槽位 */
    eligibleSlots: [BandRole.MainInst, BandRole.Accomp, BandRole.Bass] as const,
} as const;

/** 各 role 的主区(MIDI 边界,inclusive)。Phase B 实装,Phase C 可让 musician 卡覆盖。 */
export const PIANO_REGIONS = {
    melody: { lo: 60, hi: 86 },  // C4 - D6(soprano 主流域)
    accomp: { lo: 48, hi: 71 },  // C3 - B4(中低 comping 域)
    bass:   { lo: 33, hi: 55 },  // A1 - G3(piano LH / bass)
} as const;

/** 5% 越界保留概率(95% 拉回主区,musician 卡可覆盖) */
const ESCAPE_PROBABILITY = 0.05;

/**
 * Deterministic hash(pitch + onset)→ [0, 1) 浮点。
 * 用 32-bit Mulberry-like 混合 + 取低位,稳定可重现,不消耗 PRNG。
 */
function detHash01(pitch: number, onset: number): number {
    // mix integer pitch + onset (quantized to 1/16 beat) into 32-bit
    const seedInt = ((pitch & 0xff) << 16) ^ Math.floor(onset * 16) ^ 0x9e3779b9;
    let x = seedInt >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    return (x & 0xffffff) / 0x1000000;  // → [0, 1)
}

/**
 * 把单音 pitch 按"主区 + 越界概率"约束调整。
 *
 *   pitch 在 [lo, hi] 内:直通
 *   pitch 在主区外:
 *     - escape 命中(<escapeProb,默认 5%):保留越界 pitch(自然感)
 *     - 否则:八度移调到主区(±12 直到落入)
 *
 * 越界往主区折叠时优先选离原 pitch 最近的八度,保留 voice-leading 语义。
 */
function applyRegionProbability(
    notes: NoteData[],
    region: { lo: number; hi: number },
    escapeProb: number = ESCAPE_PROBABILITY,
): NoteData[] {
    return notes.map(n => {
        if (n.pitch >= region.lo && n.pitch <= region.hi) return { ...n };
        const escape = detHash01(n.pitch, n.onset) < escapeProb;
        if (escape) return { ...n };
        // 95% 路径:八度移调拉回主区
        let p = n.pitch;
        while (p < region.lo) p += 12;
        while (p > region.hi) p -= 12;
        // p 现在在 [region.lo - 11, region.hi] 内,clamp 保险
        if (p < region.lo) p = region.lo;
        if (p > region.hi) p = region.hi;
        return { ...n, pitch: p };
    });
}

/**
 * 内部 helper:per-section role gate + Phase B region clamp。
 *
 * 1. 从 input.notes[role] 取本 role 的原料 events
 * 2. 每 note 查 sectionIdx → getMyRolesInSection → 不含 role 则 skip
 * 3. 通过的 notes 走 Phase B 音区概率分布
 */
function planForRole(
    input: MusicianPlanInput,
    role: ConductorRole,
    defaultRegion: { lo: number; hi: number },
): NoteData[] {
    const raw = input.notes?.[role] ?? [];
    if (raw.length === 0) return [];
    const filtered: NoteData[] = [];
    for (const n of raw) {
        const sectionIdx = findSectionIdxForBeat(n.onset, input.score.sections);
        if (sectionIdx < 0) continue;
        const myRoles = getMyRolesInSection(input, sectionIdx);
        if (!myRoles.includes(role)) continue;  // Conductor 让我这段 silent for this role
        filtered.push(n);
    }
    // Musician 卡 Layer 1/2 overrides
    const overrides = input.musician?.af2Overrides;
    const region = (role === 'melody' || role === 'accomp' || role === 'bass')
        ? (overrides?.regions?.[role] ?? defaultRegion)
        : defaultRegion;
    const escapeProb = overrides?.escapeProbability ?? ESCAPE_PROBABILITY;
    return applyRegionProbability(filtered, region, escapeProb);
}

// ============================================================
// Add11 人手物理(原 Reconciler.applyAdd11HandPhysics,Phase C → C.5 下沉)
// ============================================================
//
// 物理场景:钢琴 accomp 出 add11 柱式时,11音(root + 17 半音)超左手按宽,
// 需"借右手"按 11音,但右手不能再去高音区按 melody — 否则跟 accomp 顶部
// 11音组成 add 20+(色彩破坏)。所以 melody 物理只能在 11音附近游走。
//
// 触发条件:chord.quality ∈ ELEVEN_FAMILY AND chord.voicing 实际含 11音 PC
// 概率门:60% 触发(deterministic detHash01,与 D-5 兼容,不消耗 PRNG)
// 调整:melody 八度移调到 11音 ±12 半音内最近位置
//
// C.5 下沉理由:Reconciler 现是 velocity 层 + 全局动态层,pitch 层 cross-track
// 协调应内化到 musician.plan()。planMelody 已能看到 input.score.chords → 自给
// 自足,不需要 Reconciler 兜底。
// ============================================================

const ELEVEN_FAMILY: ReadonlySet<ChordQuality> = new Set([
    ChordQuality.Minor11,
    ChordQuality.Dominant11,
    ChordQuality.Dominant13,  // 13 includes natural 11
    ChordQuality.Major13,
]);

const ADD11_GATE_PROBABILITY = 0.60;
const ADD11_MAX_DIST = 12;

interface ElevenWindow {
    startBeat: number;
    endBeat: number;
    elevenMidi: number;  // 11音 voicing 中最高 midi(borrowed-hand 顶音)
}

function findElevenWindows(chords: ReadonlyArray<GeneratedChord>): ElevenWindow[] {
    const out: ElevenWindow[] = [];
    for (const chord of chords) {
        if (!ELEVEN_FAMILY.has(chord.quality)) continue;
        const elevenPc = ((chord.root + 5) % 12 + 12) % 12;
        const matched = chord.voicing
            .filter(p => (((p % 12) + 12) % 12) === elevenPc)
            .sort((a, b) => b - a);
        if (matched.length === 0) continue;
        out.push({
            startBeat: chord.startBeat,
            endBeat: chord.endBeat,
            elevenMidi: matched[0],
        });
    }
    return out;
}

/**
 * Add11 人手物理:在 add11 窗口内 gateProb 概率把 melody 移到 11音最近 octave。
 */
function applyAdd11HandPhysics(
    notes: NoteData[],
    chords: ReadonlyArray<GeneratedChord>,
    gateProb: number = ADD11_GATE_PROBABILITY,
): NoteData[] {
    if (notes.length === 0 || chords.length === 0) return notes;
    const windows = findElevenWindows(chords);
    if (windows.length === 0) return notes;

    return notes.map(n => {
        let window: ElevenWindow | undefined;
        for (const w of windows) {
            if (n.onset >= w.startBeat && n.onset < w.endBeat) { window = w; break; }
        }
        if (!window) return n;
        // 概率门(gateProb 触发 / 1-gateProb 保留)
        if (detHash01(n.pitch, n.onset) >= gateProb) return n;
        // 触发:把 melody 移到最近 11音 octave(保留 PC)
        const melodyPc = (((n.pitch % 12) + 12) % 12);
        const targetOctave = Math.floor(window.elevenMidi / 12);
        let best = n.pitch;
        let bestDist = Math.abs(n.pitch - window.elevenMidi);
        for (const oct of [targetOctave - 1, targetOctave, targetOctave + 1]) {
            const cand = melodyPc + 12 * oct;
            const dist = Math.abs(cand - window.elevenMidi);
            if (dist <= ADD11_MAX_DIST && dist < bestDist) {
                bestDist = dist;
                best = cand;
            }
        }
        return { ...n, pitch: best };
    });
}

export const PianoIdiom = {
    /**
     * C.5:plan melody role(MainInst 槽 + Conductor 给本 musician 分 'melody' role 的 sections)。
     *
     * 流程:
     *   1. input.notes.melody 是 mg 原料 → per-section role gate(planForRole)
     *   2. Phase B 主区 [C4, D6] 音区概率分布(95% 拉回 / 5% 越界)
     *   3. Phase C add11 人手物理(下沉自 Reconciler):11音家族窗口内 60%
     *      melody 八度移调到 11音附近(cross-track 协调内化到乐手层)
     *
     * Phase D+ 计划:melody 技巧(legato/staccato/装饰音/passing tones)
     */
    planMelody(input: MusicianPlanInput): NoteData[] {
        const algo = input.musician?.af2Overrides?.melodyAlgorithm ?? 'mg';
        const melodyRegion = input.musician?.af2Overrides?.regions?.melody ?? PIANO_REGIONS.melody;

        let melody: NoteData[];
        if (algo === 'af2') {
            // AF2 自家 chord-tone melody(MVP)— 替代 mg.notes.melody pass-through
            melody = generateAf2Melody(
                input.score.chords, input.score.sections, input,
                melodyRegion.lo, melodyRegion.hi,
            );
        } else {
            // mg pass-through(默认行为)
            melody = planForRole(input, 'melody', PIANO_REGIONS.melody);
        }
        const add11Gate = input.musician?.af2Overrides?.add11GateProbability ?? ADD11_GATE_PROBABILITY;
        return applyAdd11HandPhysics(melody, input.score.chords, add11Gate);
    },

    /**
     * C.5:plan accomp role(Accomp 槽 + Conductor 给本 musician 分 'accomp' role 的 sections)。
     *
     * Phase B 主区 [C3, B4],超出 95% 拉回 / 5% 越界保留。
     * Phase D+ 计划:柱式 / 分解 / smart omit + add11 hand-spread 约束
     */
    planAccomp(input: MusicianPlanInput): NoteData[] {
        return planForRole(input, 'accomp', PIANO_REGIONS.accomp);
    },

    /**
     * C.5:plan bass role(钢琴占 Bass 槽时,无电贝斯)。
     *
     * Phase B 主区 [A1, G3],超出 95% 拉回 / 5% 越界保留。
     * Phase D+ 计划:walking / stride / boogie 技巧
     */
    planBass(input: MusicianPlanInput): NoteData[] {
        return planForRole(input, 'bass', PIANO_REGIONS.bass);
    },

    /**
     * 取 GM program number(供 MusicContext.gmProgramOverrides 装配)。
     */
    getGmProgram(): number {
        return PIANO_INSTRUMENT_SPEC.gmProgram;
    },
};
