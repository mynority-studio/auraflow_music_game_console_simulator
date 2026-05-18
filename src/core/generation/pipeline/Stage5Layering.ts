/**
 * Stage5Layering — 多轨织体层叠（Phase 5 配置剥离版）
 *
 * 职责：消费 Stage 1~3 的输出（chords + voicings + sections + styleId），
 * 按 ConductorPlan 决定每段哪些角色发声，输出 4 轨 NoteData[]：
 *
 *   melody         — Lead 主旋律（FractalStructureEngine + PCFGGrammarEngine 驱动）
 *   accompaniment  — Comping 伴奏（RhythmMutator + TextureMapper 驱动）
 *   bass           — 低音锚定（极简 Layer 1：每和弦起拍 root，长和弦中位补一击）
 *   drums          — 打击乐（DrumIdiom 16-step grid 驱动）— Phase 5 新增
 *
 * 关键设计决策（与 .claude/rules/music_generation_pipeline_rule.md 对齐）：
 *
 *   1. Pitch Space 三空间（K-1 / K-2 / K-7 / K-8）：
 *      - melody / accompaniment / bass: RELATIVE — 由 Orchestrator.applyOffset 转 ABSOLUTE
 *      - drums:                          GM Drum Map (K-8 第三空间) — 全程透传不加 keyOffset
 *
 *   2. 确定性（D-1 / D-5）：
 *      遍历顺序：sections ASC → role [Bass, AccompInst, Drums, Lead] → chordIdx ASC。
 *      Bass 零 PRNG 消耗；DrumIdiom 按 step 升序遍历，每 step 固定 3 次 gate PRNG。
 *
 *   3. AccompInst 掐头（混音物理约束）：
 *      Comping 用 chord.voicing.slice(1)，把 voicing[0]（bass voice）让给 Bass 轨，
 *      避免低频堆叠（CLAUDE.md "Bass E1-B2 / PianoRH ≥ C3"）。
 *
 *   4. **配置剥离**（Phase 5）：
 *      Personas / Fractal / Grammar / Drum Grid 全部下沉到 config/styles/*.ts 的
 *      StyleStage5Bundle。本文件零硬编码风格参数，仅保留：
 *        - Pitch Space 锚（BASS_ANCHOR / ACCOMP_MIN / LEAD_ANCHOR）— 跨风格物理常量
 *        - ConductorMask（段落类型 → 角色启停）— 与风格无关的音乐物理
 *
 *   5. 错误处理（S-7）：非法输入抛 Stage5LayeringError，runPipeline 入口统一 catch。
 *
 * @author AuraFlow Tap! Phase 5 Stage 5
 */

import {
    GeneratedChord, MusicianPersona, NoteData,
    SectionMetadata, SectionType, Tonality,
} from '../types';
import { StyleId } from '../config/StyleFlags';
import { getStyleStage5Bundle } from '../config/styles';
import { RhythmMutator } from '../primitives/RhythmMutator';
import { TextureMapper } from '../primitives/TextureMapper';
import {
    FractalStructureEngine, FractalBlock, FractalConfig,
} from '../primitives/FractalStructureEngine';
import {
    PCFGGrammarEngine, GrammarConfig,
} from '../primitives/PCFGGrammarEngine';
import { DrumIdiom } from '../primitives/DrumIdiom';
import { BassIdiom } from '../primitives/BassIdiom';
import { ToplineEngine } from './ToplineEngine';
import { TopologyMutator } from '../primitives/TopologyMutator';
import { PRNGManager } from '../../utils/PRNG';

const EPSILON = 1e-6;
const STEPS_PER_BEAT = 4;
const FRACTAL_ITERATIONS = 3;

// Pitch Space anchors — melody/accomp/bass 全 RELATIVE
// Phase 6 The Walker: BASS_ANCHOR 下移到 C1 (24)，配合 BassIdiom 单八度运行
// 与 MidiConverter MIX_PIANO_LH (volume 95 / reverb 0) 共同实现"沉到底层 + 干净 attack"。
const ACCOMP_MIN_PITCH = 48;    // C3 — 混音约束下界（PianoRH ≥ C3）
const LEAD_ANCHOR_PITCH = 72;   // C5 — 主旋律高音区
const LEAD_RANGE_LO = 60;       // C4 — ToplineEngine 主旋律下界
const LEAD_RANGE_HI = 84;       // C6 — ToplineEngine 主旋律上界

// ============================================================
// Role 枚举（本地）— 与 RoleType 字符串无关，避免 T-1 字符串分类
// 索引必须与 config/styles/index.ts StyleStage5Bundle.personas 对齐
// ============================================================
const ROLE_BASS = 0;
const ROLE_ACCOMP = 1;
const ROLE_LEAD = 2;
const ROLE_DRUMS = 3;
const ROLE_COUNT = 4;

const MASK_BASS = 1 << ROLE_BASS;
const MASK_ACCOMP = 1 << ROLE_ACCOMP;
const MASK_LEAD = 1 << ROLE_LEAD;
const MASK_DRUMS = 1 << ROLE_DRUMS;
const MASK_ALL = MASK_BASS | MASK_ACCOMP | MASK_LEAD | MASK_DRUMS;

// ============================================================
// Conductor Mask — sectionType → bit 掩码（与风格无关，音乐物理）
// ============================================================
//
// 设计：
//   - Intro / Outro / PreOutro: Bass + Accomp（**不出鼓** — 渐入/淡出感）
//   - Verse/PreChorus/Chorus/Bridge/Drop/Solo_Bridge: ALL（全开）
//   - BuildUp: Bass + Accomp + Drums（积累张力，旋律未进）
//   - Break / Breakdown: Bass + Drums（"Rhythm Section Breakdown" — 清空中高频）
//
// 未列出的 sectionType 走 MASK_ALL 兜底。
// ============================================================

const CONDUCTOR_MASK_BY_SECTION_TYPE: number[] = (() => {
    const m: number[] = new Array(12);
    m[SectionType.Intro]       = MASK_BASS | MASK_ACCOMP;
    m[SectionType.Verse]       = MASK_ALL;
    m[SectionType.PreChorus]   = MASK_ALL;
    m[SectionType.Chorus]      = MASK_ALL;
    m[SectionType.Bridge]      = MASK_ALL;
    m[SectionType.Outro]       = MASK_BASS | MASK_ACCOMP;
    m[SectionType.Break]       = MASK_BASS | MASK_DRUMS;
    m[SectionType.Breakdown]   = MASK_BASS | MASK_DRUMS;
    m[SectionType.BuildUp]     = MASK_BASS | MASK_ACCOMP | MASK_DRUMS;
    m[SectionType.Drop]        = MASK_ALL;
    m[SectionType.PreOutro]    = MASK_BASS | MASK_ACCOMP;
    m[SectionType.Solo_Bridge] = MASK_ALL;
    return m;
})();

function getConductorMask(sectionType: SectionType | undefined): number {
    if (sectionType === undefined) return MASK_ALL;
    const m = CONDUCTOR_MASK_BY_SECTION_TYPE[sectionType];
    return m === undefined ? MASK_ALL : m;
}

function getPersona(personas: MusicianPersona[], role: number): MusicianPersona {
    const p = personas[role];
    if (p === undefined) {
        throw new Stage5LayeringError(
            'no Persona at role index',
            { role, personasLength: personas.length },
        );
    }
    return p;
}

// ============================================================
// 公开 API
// ============================================================

export interface Stage5LayeringInput {
    chords: GeneratedChord[];     // 已带 voicing（HarmonyCore 输出）
    sections: SectionMetadata[];
    styleId: StyleId;
    /** 调式 — 由 Stage 2 决定，ToplineEngine 用于色彩音/调内邻音判定（Phase 6 新增） */
    tonality: Tonality;
    /** 拍号 — 决定 RhythmMutator / TextureMapper 的 stepsPerBar */
    timeSignature: [number, number];
    /** Phase 2: 用户动机（RELATIVE pitch space），用于 Lead 的片段拼接（Direct Splice） */
    userMotif?: NoteData[];
}

export interface Stage5LayeringResult {
    melody: NoteData[];
    accompaniment: NoteData[];
    bass: NoteData[];
    /** Pitch Space: GM Drum Map (K-8 第三空间) — 不参与 Orchestrator.applyOffset */
    drums: NoteData[];
}

/**
 * Pitch Space:
 *   - melody / accompaniment / bass: RELATIVE
 *   - drums: GM Drum Map (ABSOLUTE 物理键位) — K-8 第三空间
 *
 * PRNG 消耗（按 role 拆分）：
 *   - Bass: 0
 *   - AccompInst: 每和弦 ≈ totalSteps - 1 (Phase A) + ≤ 40 (Phase B) + ≤ 2 × hits (Random contour)
 *   - Drums: 每段 ≈ 3 × totalSteps（无条件 gate PRNG）+ Σ hits（条件 velocity PRNG）
 *   - Lead: 每段 ≈ Fractal(树深度 × 3) + PCFG(每非终止符 1)
 *
 * 调用方应在调用前 recordSnapshot('D')，本函数不主动记 snapshot 以保接口纯净。
 */
export function layerInstruments(input: Stage5LayeringInput): Stage5LayeringResult {
    validateInput(input);

    const melody: NoteData[] = [];
    const accompaniment: NoteData[] = [];
    const bass: NoteData[] = [];

    const bundle = getStyleStage5Bundle(input.styleId);

    // Drums 按段落过滤后整体交给 DrumIdiom（PRNG 消耗在 sections 升序遍历内完成）
    const drumSections = collectDrumSections(input.sections);
    const drums: NoteData[] = drumSections.length > 0
        ? DrumIdiom.render({ sections: drumSections, grid: bundle.drum })
        : [];

    for (let sIdx = 0; sIdx < input.sections.length; sIdx++) {
        const section = input.sections[sIdx];
        const mask = getConductorMask(section.sectionType);

        const sectionChords = collectChordsInSection(input.chords, section);
        if (sectionChords.length === 0) continue;

        // 固定顺序：Bass → Accomp → Drums → Lead
        //   Drums 由 DrumIdiom 整体处理（已在循环外完成），此处仅 Bass/Accomp/Lead 三轨
        //   Bass 必须先于 Accomp/Lead — Phase 6 后 BassIdiom 在 Jazz/NeoSoul 消耗 PRNG，
        //   PRNG 顺序锁定为 Bass → Accomp → Lead（D-5）
        if ((mask & MASK_BASS) !== 0) {
            const bassNotes = BassIdiom.render({
                chords: sectionChords,
                styleId: input.styleId,
                tonality: input.tonality,
                persona: getPersona(bundle.personas, ROLE_BASS),
            });
            for (let k = 0; k < bassNotes.length; k++) bass.push(bassNotes[k]);
        }
        if ((mask & MASK_ACCOMP) !== 0) {
            renderAccompaniment(
                accompaniment, sectionChords,
                getPersona(bundle.personas, ROLE_ACCOMP),
                input.timeSignature,
            );
        }
        if ((mask & MASK_LEAD) !== 0) {
            renderLead(
                melody, section, sectionChords,
                getPersona(bundle.personas, ROLE_LEAD),
                bundle.fractal, bundle.grammar,
                input.tonality, bundle.approachDownProb,
                input.userMotif,
            );
        }
    }

    // D-3：全局排序 — onset ASC, pitch ASC
    sortNotesInPlace(melody);
    sortNotesInPlace(accompaniment);
    sortNotesInPlace(bass);
    // drums 已在 DrumIdiom 内部排序，无需再排

    return { melody, accompaniment, bass, drums };
}

// ============================================================
// Drums section 过滤
// ============================================================
//
// Conductor mask 决定哪些段落出鼓；过滤后整段交给 DrumIdiom。
// 注意：DrumIdiom 内部按 startBeat ASC 遍历段落，PRNG 消耗顺序锁定。
//
// **关键确定性约束**：drum sections 收集必须发生在 Bass/Accomp/Lead 渲染**之前**，
// 因为 DrumIdiom 在 layerInstruments() 入口立即消耗 PRNG（全曲段落遍历）。
// 后续 Bass/Accomp/Lead 渲染按 sections 升序消耗 PRNG，与 Drums 解耦。

function collectDrumSections(sections: SectionMetadata[]): SectionMetadata[] {
    const out: SectionMetadata[] = [];
    for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        const mask = getConductorMask(s.sectionType);
        if ((mask & MASK_DRUMS) !== 0) {
            out.push(s);
        }
    }
    return out;
}

// ============================================================
// AccompInst 渲染（RhythmMutator + TextureMapper）
// ============================================================
// Bass 渲染已下沉到 primitives/BassIdiom.ts（Phase 6 The Walker）

function renderAccompaniment(
    out: NoteData[],
    chords: GeneratedChord[],
    persona: MusicianPersona,
    timeSignature: [number, number],
): void {
    const beatsPerBar = timeSignature[0];
    for (let i = 0; i < chords.length; i++) {
        const c = chords[i];
        const dur = c.endBeat - c.startBeat;
        if (dur < EPSILON) continue;
        if (!c.voicing || c.voicing.length < 2) continue;

        // 掐头：去掉 voicing[0]（bass voice）
        const compVoicing: number[] = [];
        for (let v = 1; v < c.voicing.length; v++) {
            if (c.voicing[v] >= ACCOMP_MIN_PITCH) {
                compVoicing.push(c.voicing[v]);
            }
        }
        if (compVoicing.length === 0) continue;

        const grid = RhythmMutator.generate({
            totalBeats: dur,
            stepsPerBeat: STEPS_PER_BEAT,
            beatsPerBar,
            sparsityTendency: persona.sparsityTendency,
            syncopationAssault: persona.syncopationAssault,
        });

        const notes = TextureMapper.render({
            chord: c,
            voicing: compVoicing,
            grid,
            stepsPerBeat: STEPS_PER_BEAT,
            beatsPerBar,
            contour: persona.contourPreference,
            velocityRange: persona.dynamicRange,
        });

        for (let k = 0; k < notes.length; k++) {
            out.push(notes[k]);
        }
    }
}

// ============================================================
// Lead 渲染（FractalStructureEngine + PCFGGrammarEngine + ToplineEngine）
// ============================================================
//
// Pitch Space: RELATIVE — 全程不加 keyOffset。
//
// Phase 6 重构：
//   - PCFG 吐出抽象 TerminalSymbol（kind + duration，不含 pitch）
//   - ToplineEngine 跟随和弦 + 调式做 pitch 实例化（chord/color 0 PRNG；approach ×1 PRNG）
//   - LEAD_ANCHOR_PITCH 作为 cursor 初值传给 ToplineEngine（72 = C5，RELATIVE 空间）
//
// PRNG 消耗（每段，按 block ASC）：
//   - FractalStructureEngine: 树深度 × 3
//   - PCFG.expand: 每非终止符 ×1
//   - ToplineEngine.render: 每 approach ×1（block 内 approach 个数依赖 grammar 抽样结果）

function renderLead(
    out: NoteData[],
    section: SectionMetadata,
    chords: GeneratedChord[],
    persona: MusicianPersona,
    fractalCfg: FractalConfig,
    grammar: GrammarConfig,
    tonality: Tonality,
    approachDownProb: number,
    userMotif?: NoteData[],
): void {
    const sectionDur = section.endBeat - section.startBeat;
    if (sectionDur < EPSILON) return;
    if (chords.length === 0) return;

    const blocks: FractalBlock[] = FractalStructureEngine.expand(
        sectionDur, fractalCfg, FRACTAL_ITERATIONS,
    );

    for (let b = 0; b < blocks.length; b++) {
        const block = blocks[b];
        if (block.isRest) continue;
        if (block.duration < EPSILON) continue;

        const blockOnset = section.startBeat + block.startBeat;

        const terminals = PCFGGrammarEngine.expand(block.duration, grammar);
        if (terminals.length === 0) continue;

        // Ghost Rendering: 无论是否拼接 Lick，都先真实跑一遍 ToplineEngine，强制消耗随机数
        const generatedNotes = ToplineEngine.render({
            terminals, chords, startBeat: blockOnset, tonality,
            velocityRange: persona.dynamicRange, pitchRange: [LEAD_RANGE_LO, LEAD_RANGE_HI],
            anchorPitch: LEAD_ANCHOR_PITCH, approachDownProb, legatoRatio: persona.legatoRatio,
        });

        // 恒定消耗判断拼接的 PRNG（无视条件，坚决放在 if 外部）
        const spliceRoll = PRNGManager.next();
        const lickIdxRoll = PRNGManager.next();
        const topoRolls = [PRNGManager.next(), PRNGManager.next(), PRNGManager.next(), PRNGManager.next(), PRNGManager.next(), PRNGManager.next()];
        let topoIdx = 0;

        const lickProb = persona.signatureLickProb ?? 0.0;
        const hasLicks = persona.lickPool && persona.lickPool.length > 0;
        const useUserMotif = userMotif !== undefined && userMotif.length > 0;

        let spliced = false;

        // 仅在能量较高，且概率命中，并且 duration >= 1 时进行乐句替换
        if (section.energyLevel >= 6 && block.duration >= 1.0 && ((useUserMotif && spliceRoll < 0.5) || (hasLicks && spliceRoll < lickProb))) {

            let rawLick: NoteData[];
            if (useUserMotif && spliceRoll < 0.5) {
                rawLick = userMotif!;
            } else {
                const lickIdx = Math.floor(lickIdxRoll * persona.lickPool!.length);
                rawLick = persona.lickPool![lickIdx];
            }

            const mutatedLick = TopologyMutator.applyTopologyChain(
                rawLick,
                persona.topologyConfig ?? { probInvert: 0, probReverse: 0, probExpand: 0, probSideSlip: 0, sideSlipRange: 0, colorBias: 0 },
                () => topoRolls[topoIdx++ % topoRolls.length],
                (min, max) => {
                    const r = topoRolls[topoIdx++ % topoRolls.length];
                    return Math.floor(r * (max - min + 1)) + min;
                }
            );

            // 缩放 Lick 时长以适应 block.duration
            let maxOnset = 0;
            for (let k = 0; k < mutatedLick.length; k++) {
                const end = mutatedLick[k].onset + mutatedLick[k].duration;
                if (end > maxOnset) maxOnset = end;
            }
            const scale = maxOnset > EPSILON ? block.duration / maxOnset : 1.0;

            let scaledLick = mutatedLick;
            if (Math.abs(scale - 1.0) > EPSILON) {
                scaledLick = TopologyMutator.expand(mutatedLick, scale);
            }

            // 找寻当前时间段和弦，用作 K-2 相对平移基准
            let targetChord = chords[0];
            for (let c = 0; c < chords.length; c++) {
                if (chords[c].startBeat <= blockOnset && chords[c].endBeat > blockOnset) {
                    targetChord = chords[c];
                    break;
                }
            }
            const rootPc = targetChord ? ((targetChord.root % 12) + 12) % 12 : 0;

            for (let k = 0; k < scaledLick.length; k++) {
                const n = scaledLick[k];
                let p = n.pitch + rootPc;
                // 防御性钳位，确保落在合理音域
                while (p < LEAD_RANGE_LO) p += 12;
                while (p > LEAD_RANGE_HI) p -= 12;

                out.push({
                    pitch: p,
                    onset: blockOnset + n.onset * scale,
                    duration: n.duration * scale,
                    velocity: n.velocity,
                    isUserMotif: true,
                    motifName: 'MasterSplice'
                });
            }
            spliced = true;
        }

        if (!spliced) {
            // 如果不拼接，则装载 Ghost Rendering 跑出来的原生音符
            for (let k = 0; k < generatedNotes.length; k++) {
                out.push(generatedNotes[k]);
            }
        }
    }
}

// ============================================================
// 辅助
// ============================================================

function collectChordsInSection(
    chords: GeneratedChord[],
    section: SectionMetadata,
): GeneratedChord[] {
    const out: GeneratedChord[] = [];
    const sStart = section.startBeat;
    const sEnd = section.endBeat;
    for (let i = 0; i < chords.length; i++) {
        const c = chords[i];
        if (c.startBeat >= sStart - EPSILON && c.endBeat <= sEnd + EPSILON) {
            out.push(c);
        }
    }
    return out;
}

function sortNotesInPlace(notes: NoteData[]): void {
    notes.sort((a, b) => {
        const d = a.onset - b.onset;
        if (Math.abs(d) > EPSILON) return d;
        return a.pitch - b.pitch;
    });
}

function validateInput(input: Stage5LayeringInput): void {
    if (!Array.isArray(input.chords)) {
        throw new Stage5LayeringError('chords must be an array', {
            actual: typeof input.chords,
        });
    }
    if (!Array.isArray(input.sections)) {
        throw new Stage5LayeringError('sections must be an array', {
            actual: typeof input.sections,
        });
    }
    // styleId 合法性由 getStyleStage5Bundle 兜底（未知 ID 回落到 Pop）
}

export class Stage5LayeringError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'Stage5LayeringError';
        this.context = context;
    }
}
