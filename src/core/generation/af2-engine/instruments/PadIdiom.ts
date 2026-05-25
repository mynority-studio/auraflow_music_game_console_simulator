// ============================================================
// PadIdiom v1.2 — AF2 氛围 pad idiom(W 阶段 2026-05-25:atmosphereOverrides 完整 wire)
// ============================================================
//
// v1.0 → v1.1 增强:
//   - **Voicing slice mode**:per sectionType 选择 pad voicing 切片
//   - **Attack pre-roll**:Sustained sections attack 提前 0.25 beat
//   - **Velocity ramp**:BuildUp 段 velocity 按 progress 渐强
//   - **Persona colorBias / sparsity 加权**
//
// v1.1 → v1.2(W 阶段):musician.personnel.atmosphereOverrides 5 字段全 wire
//   - voiceCount      限制 voicing 输出最多 N voice(默认 4)
//   - velocityRange   [lo, hi] MIDI 0-127 → 替换 0.3+energy×0.06 公式
//   - octaveLayering  true 时复制每 voice +12 octave 加厚
//   - attackSoftness  0-1 → preRoll 系数(0.5 = 默认,1.0 = 强 fade-in)
//   - releaseRatio    1.0+ → duration 系数(拖长尾)
//   - crossfade       暂未消费(需 chord 间 envelope,跳过)
//
// 物理约束(不变):
//   - GM Program 由 Facade per-mgStyle 决定(W2,POP=89/JAZZ=95/RNB=91/BLUES=89)
//   - 音域 C3-C6(MIDI 48-84)
//   - eligibleSlots: [Atmosphere]
//
// PRNG:**0**(完全决定性 hash on sectionIdx + chordIdxInSection)
// ============================================================

import type { NoteData, SectionMetadata } from '../../types';
import { BandRole, SectionType } from '../../types';
// C.3 → C.4:MusicianPlanInput 共享协议 + per-section role 查询
import type { MusicianPlanInput } from '../Conductor';
import { getMyRolesInSection, findSectionIdxForBeat } from '../Conductor';

/** Pad 物理参数 */
export const PAD_INSTRUMENT_SPEC = {
    /** GM 89 Warm Pad */
    gmProgram: 89,
    rangeLo: 48,             // C3
    rangeHi: 84,             // C6
    eligibleSlots: [BandRole.Atmosphere] as const,
} as const;

/** Pad 中心区 — 算法 §4.2 Step 2 的目标平均 pitch 范围 */
const PAD_CENTER_LO = 60;    // C4
const PAD_CENTER_HI = 72;    // C5

// ============================================================
// v1.1:Voicing slice mode
// ============================================================

enum PadSliceMode {
    LowCluster = 0,   // 取 voicing 低 2-3 + 整体八度下沉
    MidPad = 1,       // 取 voicing 中部(默认)
    HighPad = 2,      // 取 voicing 高 2-3 + 整体八度上提
}

const SECTION_SLICE_POOL: Partial<Record<SectionType, ReadonlyArray<PadSliceMode>>> = {
    [SectionType.Intro]:     [PadSliceMode.LowCluster, PadSliceMode.MidPad],
    [SectionType.Verse]:     [PadSliceMode.MidPad],
    [SectionType.PreChorus]: [PadSliceMode.MidPad, PadSliceMode.HighPad],
    [SectionType.Chorus]:    [PadSliceMode.HighPad, PadSliceMode.MidPad],
    [SectionType.Bridge]:    [PadSliceMode.LowCluster, PadSliceMode.MidPad],
    [SectionType.BuildUp]:   [PadSliceMode.HighPad],
    [SectionType.Drop]:      [PadSliceMode.HighPad, PadSliceMode.MidPad],
    [SectionType.Break]:     [PadSliceMode.LowCluster],
    [SectionType.Breakdown]: [PadSliceMode.LowCluster],
    [SectionType.Outro]:     [PadSliceMode.LowCluster, PadSliceMode.MidPad],
    [SectionType.PreOutro]:  [PadSliceMode.MidPad, PadSliceMode.LowCluster],
};
const DEFAULT_SLICE_POOL: ReadonlyArray<PadSliceMode> = [PadSliceMode.MidPad];

function pickSliceMode(
    sectionType: SectionType,
    chordIdxInSection: number,
    colorBias: number,
    sparsity: number,
): PadSliceMode {
    const pool = SECTION_SLICE_POOL[sectionType] ?? DEFAULT_SLICE_POOL;
    const h = (chordIdxInSection * 11 + (sectionType as number) * 13) & 0xff;
    let pick = pool[h % pool.length];
    // Persona 加权:colorBias 高 → 偏 HighPad / sparsity 高 → 偏 LowCluster
    const h2 = ((h * 31 + 17) & 0xff) / 255;
    if (h2 < sparsity * 0.5) pick = PadSliceMode.LowCluster;
    else if (h2 < sparsity * 0.5 + colorBias * 0.4) pick = PadSliceMode.HighPad;
    return pick;
}

/** 切 voicing 子集 + octave 调整 — Composer 保证 voicing 已排序 */
function sliceAndShift(voicing: number[], mode: PadSliceMode): number[] {
    if (voicing.length === 0) return voicing;
    const sorted = voicing;  // Af2Composer.placeVoicingMidi 已输出排序
    let slice: number[];
    let octShift = 0;
    switch (mode) {
        case PadSliceMode.LowCluster:
            slice = sorted.slice(0, Math.max(2, Math.min(3, sorted.length)));
            octShift = -12;  // 下沉一个八度
            break;
        case PadSliceMode.HighPad:
            slice = sorted.slice(Math.max(0, sorted.length - 3));
            octShift = 12;   // 上提一个八度
            break;
        case PadSliceMode.MidPad:
        default: {
            const mid = Math.floor(sorted.length / 2);
            const start = Math.max(0, mid - 1);
            const end = Math.min(sorted.length, mid + 2);
            slice = sorted.slice(start, end);
            octShift = 0;
            break;
        }
    }
    return slice.map(m => m + octShift);
}

/** Attack pre-roll(slow fade-in 听感)— per sectionType */
function attackPreRoll(sectionType: SectionType): number {
    switch (sectionType) {
        case SectionType.Bridge:
        case SectionType.Break:
        case SectionType.Breakdown:
        case SectionType.Intro:
            return 0.25;
        case SectionType.BuildUp:
        case SectionType.Drop:
            return 0;
        default:
            return 0.1;
    }
}

/**
 * 根据 chord.startBeat 找它落在哪个段落,返回 energyLevel。
 * sections 应按 startBeat 升序且无 gap。
 */
function energyForBeat(beat: number, sections: ReadonlyArray<SectionMetadata>): number {
    if (sections.length === 0) return 5;  // 默认中等
    for (let i = 0; i < sections.length; i++) {
        if (beat < sections[i].endBeat) {
            return sections[i].energyLevel;
        }
    }
    return sections[sections.length - 1].energyLevel;
}

/**
 * 算法 Step 2:整体八度移动到 pad 中心区。
 * 直到 voicing 平均 pitch 落在 [PAD_CENTER_LO, PAD_CENTER_HI] 区间。
 */
function shiftToPadCenter(voicing: number[]): number[] {
    if (voicing.length === 0) return voicing;
    let shifted = voicing.slice();
    let avg = shifted.reduce((s, m) => s + m, 0) / shifted.length;

    // 防御性循环上限,避免数据异常导致死循环
    let guard = 16;
    while (avg > PAD_CENTER_HI && guard-- > 0) {
        shifted = shifted.map(m => m - 12);
        avg -= 12;
    }
    guard = 16;
    while (avg < PAD_CENTER_LO && guard-- > 0) {
        shifted = shifted.map(m => m + 12);
        avg += 12;
    }
    return shifted;
}

export const PadGenerator = {
    /**
     * C.4:plan(MusicianPlanInput) — per-section role-aware Pad 生成。
     *
     * 每 chord:
     *   1. 查 chord.startBeat 落在哪个 section
     *   2. 查本 musician 在该 section 的 roles
     *   3. 仅 roles 含 'pad' 时,emit pad notes for this chord
     *   4. 否则 → 跳过(Conductor 让我这段 silent)
     *
     * DynamicConductor 可让 pad 在 Verse/Chorus 进入,Outro 单独保留 pad,
     * Break/Breakdown 期间退场(无 pad role 分配)等。
     *
     * peers 当前不消费(Pad 不需 cross-track 协调);保留作未来 melody/accomp
     * 改造后看 pad notes 用。
     */
    plan(input: MusicianPlanInput): NoteData[] {
        void input.peers;
        const { score } = input;
        const chords = score.chords;
        const sections = score.sections;
        const out: NoteData[] = [];

        // Persona 消费
        const persona = input.musician?.persona;
        const colorBias = persona?.colorBias ?? 0;
        const sparsity = persona?.sparsityTendency ?? 0;

        // W 阶段:personnel.atmosphereOverrides 完整 wire(若 musician 卡有)
        const atmos = input.musician?.personnel?.atmosphereOverrides;
        const voiceCount = atmos?.voiceCount ?? 4;
        const velocityRange: [number, number] = atmos?.velocityRange ?? [40, 90];  // MIDI 0-127
        const octaveLayering = atmos?.octaveLayering ?? false;
        const attackSoftness = atmos?.attackSoftness ?? 0.5;  // 0-1
        const releaseRatio = atmos?.releaseRatio ?? 1.0;       // 1.0 = default,>1 = 拖长尾

        // 累计 chord idx + total per section(给 velocity ramp 用)
        const sectionTotals = new Map<number, number>();
        for (const ch of chords) {
            const si = findSectionIdxForBeat(ch.startBeat, sections);
            if (si >= 0) sectionTotals.set(si, (sectionTotals.get(si) ?? 0) + 1);
        }
        const sectionChordIdx = new Map<number, number>();

        for (let i = 0; i < chords.length; i++) {
            const chord = chords[i];

            // C.4:查本 musician 在该 chord 所在 section 的 roles
            const sectionIdx = findSectionIdxForBeat(chord.startBeat, sections);
            if (sectionIdx < 0) continue;
            const chordIdxInSection = sectionChordIdx.get(sectionIdx) ?? 0;
            sectionChordIdx.set(sectionIdx, chordIdxInSection + 1);
            const myRoles = getMyRolesInSection(input, sectionIdx);
            if (!myRoles.includes('pad')) continue;

            // Step 1: 取 voicing(Composer 已 voice-leading + 排序)
            if (!chord.voicing || chord.voicing.length < 2) continue;
            let voicing = chord.voicing.slice();  // shift() 会 mutate,故 slice

            // Step 2: 去最低音(bass)
            voicing.shift();
            if (voicing.length === 0) continue;

            // Step 3: 整体八度移动到 pad 中心区(先 normalize)
            voicing = shiftToPadCenter(voicing);

            // Step 3.5: v1.1 — Slice mode 选择 + octave 调整
            const sectionType = sections[sectionIdx].sectionType;
            const sliceMode = pickSliceMode(sectionType, chordIdxInSection, colorBias, sparsity);
            voicing = sliceAndShift(voicing, sliceMode);

            // Step 4: 边界 clamp 到 [PAD_RANGE_LO, PAD_RANGE_HI]
            voicing = voicing.filter(
                m => m >= PAD_INSTRUMENT_SPEC.rangeLo && m <= PAD_INSTRUMENT_SPEC.rangeHi,
            );
            if (voicing.length === 0) continue;

            // Step 4.5: W 阶段 — voiceCount 限制(从 atmos.voiceCount;默认 4)
            //   超出 voiceCount → 取低 voiceCount 个(保 bass 区,丢 top 色彩音)
            if (voicing.length > voiceCount) {
                voicing = voicing.slice(0, voiceCount);
            }

            // Step 4.6: W 阶段 — octaveLayering(若 true 则复制每 voice +12)
            //   加厚听感,但保 PAD_RANGE 边界
            if (octaveLayering) {
                const layered = voicing.map(p => p + 12).filter(p => p <= PAD_INSTRUMENT_SPEC.rangeHi);
                voicing = voicing.concat(layered).sort((a, b) => a - b);
            }

            // Step 5: energy → velocity(W 阶段:用 atmos.velocityRange 映射,
            //   而非旧固定公式 0.3 + energy × 0.06)
            //   energy 1-10 → ratio 0-1 → lerp(velocityRange[0], velocityRange[1])
            //   BuildUp 段仍走 progress ramp(覆盖 energy 公式)
            const energy = energyForBeat(chord.startBeat, sections);
            const velLoFloat = velocityRange[0] / 127;
            const velHiFloat = velocityRange[1] / 127;
            const energyRatio = Math.max(0, Math.min(1, (energy - 1) / 9));  // 1→0, 10→1
            let velocityRaw = velLoFloat + (velHiFloat - velLoFloat) * energyRatio;
            if (sectionType === SectionType.BuildUp) {
                const total = sectionTotals.get(sectionIdx) ?? 1;
                const progress = total > 1 ? chordIdxInSection / (total - 1) : 0.5;
                // BuildUp 渐强:velLo → velHi by progress(尊重 atmos.velocityRange)
                velocityRaw = velLoFloat + (velHiFloat - velLoFloat) * progress;
            }
            const velocity = Math.max(velLoFloat, Math.min(velHiFloat, velocityRaw));

            // Step 6: v1.1 — Attack pre-roll(slow fade-in 听感)
            //   W 阶段:乘 attackSoftness × 2 系数(0.5 默认 = 1.0×,1.0 = 2×强 fade-in,0 = 无 pre-roll)
            const preRoll = attackPreRoll(sectionType) * attackSoftness * 2;
            const onset = Math.max(0, chord.startBeat - preRoll);
            // W 阶段:duration 乘 releaseRatio(1.0 默认,>1 拖长尾)
            const duration = ((chord.endBeat - chord.startBeat) + preRoll) * releaseRatio;
            if (duration <= 0) continue;

            // Step 7: 每 voice 一条 NoteData
            for (const pitch of voicing) {
                out.push({
                    pitch,
                    onset,
                    duration,
                    velocity,
                });
            }
        }

        // 输出排序(onset 升序,同 onset 按 pitch 升序)
        out.sort((a, b) => a.onset - b.onset || a.pitch - b.pitch);
        return out;
    },
};

export const PadIdiom = {
    realize(notes: NoteData[]): NoteData[] {
        return notes.map(n => ({ ...n }));
    },

    getGmProgram(): number {
        return PAD_INSTRUMENT_SPEC.gmProgram;
    },
};
