// ============================================================
// Af2AccompGen — AF2 自家伴奏生成器 MVP
// ============================================================
//
// 8 层架构 #6 "乐手 idiom" 内的 accomp 算法。当 musician 卡 af2Overrides.accompAlgorithm
// = 'af2' 时,PianoIdiom.planAccomp 调用本模块替代 mg.notes.accomp pass-through。
//
// 4 种 pattern,per chord 按 (sectionType, chordIdx) hash deterministic 选:
//
//   Block        整 voicing 在 chord 起点一击,持续整个 chord(柱式)
//   Arpeggiated  voicing 各音 quarter/eighth 逐个演奏(分解和弦)
//   Stab         per-beat 短促重复 voicing(comping rhythm)
//   Sustained    Block 的低速版本(轻 velocity,留空间给 melody)
//
// Per-sectionType 偏好(POP 默认):
//   Intro / Outro / PreOutro     Sustained / Block(留白)
//   Verse                        Block / Arp(平稳)
//   Chorus                       Arp / Stab(动起来)
//   PreChorus / BuildUp          Stab(节奏渐密)
//   Bridge                       Sustained / Arp
//   Drop                         Block(power punch)
//   Break / Breakdown            Sustained
//
// PRNG 消耗:**0**(hash deterministic)。
//
// 输入约束:
//   chord.voicing 应非空(Composer 输出已保证;空时 fallback 到 [root, root+3rd, root+5th])
//   voicing 在 RELATIVE 空间(AbsoluteTransposer 后期 +keyOffset)
//   不强制 clamp 到 accomp region(由 PianoIdiom.planAccomp 后续 applyRegionProbability 处理)
// ============================================================

import type { NoteData, SectionMetadata } from '../types';
import type { GeneratedChord } from '../ir';
import { SectionType } from '../types';
import type { MusicianPlanInput } from './Conductor';
import { getMyRolesInSection, findSectionIdxForBeat } from './Conductor';

const ACCOMP_BLOCK_VELOCITY = 0.62;
const ACCOMP_ARP_VELOCITY = 0.60;
const ACCOMP_STAB_VELOCITY = 0.55;
const ACCOMP_SUSTAINED_VELOCITY = 0.45;

// ============================================================
// Pattern enum + per-sectionType 偏好表
// ============================================================

enum AccompPattern {
    Block = 0,
    Arpeggiated = 1,
    Stab = 2,
    Sustained = 3,
}

const SECTION_ACCOMP_POOL: Partial<Record<SectionType, ReadonlyArray<AccompPattern>>> = {
    [SectionType.Intro]:     [AccompPattern.Sustained, AccompPattern.Block],
    [SectionType.Verse]:     [AccompPattern.Block, AccompPattern.Arpeggiated],
    [SectionType.PreChorus]: [AccompPattern.Stab, AccompPattern.Arpeggiated],
    [SectionType.Chorus]:    [AccompPattern.Arpeggiated, AccompPattern.Stab, AccompPattern.Block],
    [SectionType.Bridge]:    [AccompPattern.Sustained, AccompPattern.Arpeggiated],
    [SectionType.BuildUp]:   [AccompPattern.Stab],
    [SectionType.Drop]:      [AccompPattern.Block],
    [SectionType.Break]:     [AccompPattern.Sustained],
    [SectionType.Breakdown]: [AccompPattern.Sustained],
    [SectionType.Outro]:     [AccompPattern.Sustained, AccompPattern.Block],
    [SectionType.PreOutro]:  [AccompPattern.Block, AccompPattern.Sustained],
};

const DEFAULT_POOL: ReadonlyArray<AccompPattern> = [AccompPattern.Block, AccompPattern.Arpeggiated];

/**
 * Pattern 选择 — 默认 pool hash 均分;persona 加权:
 *   - sparsityTendency 高 → 偏 Sustained(留白)
 *   - syncopationAssault 高 → 偏 Stab(切分密集)
 */
function pickPattern(
    sectionType: SectionType,
    chordIdxInSection: number,
    sparsity: number = 0,
    syncopation: number = 0,
): AccompPattern {
    const pool = SECTION_ACCOMP_POOL[sectionType] ?? DEFAULT_POOL;
    const h = (chordIdxInSection * 11 + (sectionType as number) * 13) & 0xff;
    let pick = pool[h % pool.length];
    const h2 = ((h * 31 + 17) & 0xff) / 255;
    if (h2 < sparsity * 0.6) pick = AccompPattern.Sustained;
    else if (h2 < sparsity * 0.6 + syncopation * 0.5) pick = AccompPattern.Stab;
    return pick;
}

// fallbackVoicing 已删(Composer 保证 voicing 非空)— 直接用 chord.voicing

// ============================================================
// Pattern 渲染器
// ============================================================

function renderBlock(chord: GeneratedChord, voicing: number[]): NoteData[] {
    const dur = chord.endBeat - chord.startBeat;
    return voicing.map(p => ({
        pitch: p,
        onset: chord.startBeat,
        duration: dur * 0.98,
        velocity: ACCOMP_BLOCK_VELOCITY,
    }));
}

function renderArpeggiated(chord: GeneratedChord, voicing: number[], chordIdxInSection: number): NoteData[] {
    const beats = chord.endBeat - chord.startBeat;
    // Af2Composer.placeVoicingMidi 已输出排序,直接消费(无 spread + sort 开销)
    const sorted = voicing;
    // numNotes ~ beats(每拍 1 个 arp 音),clamp [2, 8]
    const numNotes = Math.max(2, Math.min(8, Math.round(beats * 2)));  // 8th-note arp 密度
    const stepDur = beats / numNotes;
    // Direction:up / down by hash
    const goUp = ((chordIdxInSection * 7) & 1) === 0;
    return Array.from({ length: numNotes }, (_, i) => {
        const idx = goUp ? i % sorted.length : (sorted.length - 1 - (i % sorted.length));
        return {
            pitch: sorted[idx],
            onset: chord.startBeat + i * stepDur,
            duration: stepDur * 0.9,
            velocity: ACCOMP_ARP_VELOCITY,
        };
    });
}

function renderStab(chord: GeneratedChord, voicing: number[]): NoteData[] {
    const beats = chord.endBeat - chord.startBeat;
    // Stab per beat,clamp [2, 8]
    const stabs = Math.max(2, Math.min(8, Math.round(beats)));
    const stabSpacing = beats / stabs;
    const stabDur = stabSpacing * 0.4;  // 短促 staccato
    const out: NoteData[] = [];
    for (let i = 0; i < stabs; i++) {
        for (const p of voicing) {
            out.push({
                pitch: p,
                onset: chord.startBeat + i * stabSpacing,
                duration: stabDur,
                velocity: ACCOMP_STAB_VELOCITY,
            });
        }
    }
    return out;
}

function renderSustained(chord: GeneratedChord, voicing: number[]): NoteData[] {
    const dur = chord.endBeat - chord.startBeat;
    return voicing.map(p => ({
        pitch: p,
        onset: chord.startBeat,
        duration: dur,                                    // 完整持续(无 0.98 gap)
        velocity: ACCOMP_SUSTAINED_VELOCITY,
    }));
}

// ============================================================
// 主入口
// ============================================================

export function generateAf2Accomp(
    chords: ReadonlyArray<GeneratedChord>,
    sections: ReadonlyArray<SectionMetadata>,
    input: MusicianPlanInput,
): NoteData[] {
    const out: NoteData[] = [];
    const sectionChordIdx = new Map<number, number>();

    // Persona 消费
    const persona = input.musician?.persona;
    const sparsity = persona?.sparsityTendency ?? 0;
    const syncopation = persona?.syncopationAssault ?? 0;
    const dynamicLo = (persona?.dynamicRange?.[0] ?? 55) / 127;
    const dynamicHi = (persona?.dynamicRange?.[1] ?? 100) / 127;
    const dynamicMid = (dynamicLo + dynamicHi) / 2;

    for (const chord of chords) {
        const sectionIdx = findSectionIdxForBeat(chord.startBeat, sections);
        if (sectionIdx < 0) continue;

        const myRoles = getMyRolesInSection(input, sectionIdx);
        if (!myRoles.includes('accomp')) {
            // 仍要 increment idx 保持 deterministic
            sectionChordIdx.set(sectionIdx, (sectionChordIdx.get(sectionIdx) ?? 0) + 1);
            continue;
        }

        const chordIdxInSection = sectionChordIdx.get(sectionIdx) ?? 0;
        sectionChordIdx.set(sectionIdx, chordIdxInSection + 1);

        const sectionType = sections[sectionIdx].sectionType;
        const pattern = pickPattern(sectionType, chordIdxInSection, sparsity, syncopation);
        const voicing = chord.voicing ?? [];
        if (voicing.length === 0) continue;

        let notes: NoteData[];
        switch (pattern) {
            case AccompPattern.Block:       notes = renderBlock(chord, voicing); break;
            case AccompPattern.Arpeggiated: notes = renderArpeggiated(chord, voicing, chordIdxInSection); break;
            case AccompPattern.Stab:        notes = renderStab(chord, voicing); break;
            case AccompPattern.Sustained:   notes = renderSustained(chord, voicing); break;
            default:                        notes = renderBlock(chord, voicing);
        }
        // Velocity 重映射到 persona.dynamicRange + 各 note 微浮动(±10%)
        for (let i = 0; i < notes.length; i++) {
            const n = notes[i];
            const velH = ((sectionIdx * 7 + chordIdxInSection * 19 + i * 23) & 0xff) / 255;
            const vel = dynamicMid + (velH - 0.5) * (dynamicHi - dynamicLo) * 0.4;
            notes[i] = { ...n, velocity: Math.max(0.1, Math.min(1, vel * (n.velocity / 0.6))) };
        }
        out.push(...notes);
    }
    return out;
}
