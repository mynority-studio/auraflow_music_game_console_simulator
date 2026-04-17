import { PRNGManager } from '../../utils/PRNG';
import { NoteData, GeneratedChord, SectionMetadata, StyleConfig, MusicContext, Tonality, SectionType, PhraseGroup, SubMotifSlot, CadenceType, HookPlan, PhraseLengthProfile } from '../types';
import { HarmonyCore } from './HarmonyCore';
import { MusicTheoryRules } from './MusicTheoryRules';
import { GrooveEngine } from './GrooveEngine';
import { GlobalContext } from '../GlobalContext';
import { ENERGY } from '../config/EnergyThresholds';
import { isOnDownbeat, isOnGrid } from '../utils/BeatMath';
import { AcousticEnvelope, InstrumentProfiles, getInstrumentIdByName } from '../config/InstrumentFlags';
import { AnchorDecisionStage } from './AnchorDecisionStage';
import { getRandomRhythmCell, PopRhythmCells, FunkRhythmCells, JazzRhythmCells, BossaNovaRhythmCells } from '../melody/RhythmCells';
import { PhraseContourPlanner, TensionEnvelope } from './PhraseContourPlanner';
import { AnchorBackbone, SectionSkeleton, PhraseSkeleton } from './AnchorBackbone';

type Contour = 'Ascending' | 'Descending' | 'Arch' | 'Bowl' | 'Static' | 'Wandering';
type PhraseForm = string[]; // e.g., ['A', 'A', 'B', 'A']

/**
 * MotifMap — C 可移植的字符串→MotifTemplate 字典
 *
 * 取代 Map<string, MotifTemplate>，用 struct array + 线性扫描实现，
 * C 移植时直接翻译为 `{ const char* key; MotifTemplate value; } entries[N]; int count;`。
 *
 * 接口与 ES Map 兼容（get/set/has/forEach/size），call site 无需大改。
 * 实测 motif 字典最多 ~10 个 key（A/B/C/A_prime/B_prime/A_ret 等），线性扫描足够。
 */
class MotifMap {
    private entries: { key: string; value: MotifTemplate }[] = [];

    get(key: string): MotifTemplate | undefined {
        for (let i = 0; i < this.entries.length; i++) {
            if (this.entries[i].key === key) return this.entries[i].value;
        }
        return undefined;
    }

    set(key: string, value: MotifTemplate): void {
        for (let i = 0; i < this.entries.length; i++) {
            if (this.entries[i].key === key) {
                this.entries[i].value = value;
                return;
            }
        }
        this.entries.push({ key, value });
    }

    has(key: string): boolean {
        for (let i = 0; i < this.entries.length; i++) {
            if (this.entries[i].key === key) return true;
        }
        return false;
    }

    forEach(cb: (value: MotifTemplate, key: string) => void): void {
        for (let i = 0; i < this.entries.length; i++) {
            cb(this.entries[i].value, this.entries[i].key);
        }
    }

    get size(): number { return this.entries.length; }
}

type PickupShape = 'ascending' | 'descending' | 'held' | 'zigzag';

interface MotifTemplate {
    rhythm?: { pickup: number[]; body: number[]; tail: number[]; pickupShape?: PickupShape };
    anchors?: { bodyStartPitch?: number; bodyEndPitch?: number; };
    isMutated?: boolean;
    rhythmOffsets: number[];     // 包含 pickup(负值) + body + tail 的完整 onset 序列
    relativePitches?: number[];  // 预计算的相对音高序列（相对于 targetCenter 的偏移量），确保同一 motif 多次实现时形状一致
    contour: Contour;
    noteCount: number;
    phraseLengthBeats: number;
    pickupShape?: PickupShape;  // 弱起轮廓，realizeMotif 用于决定 pickup 音高走向
}

import { MoodId, MoodRegistry } from '../config/MoodFlags';

// ============================================================
// 🌟 PhraseGroupPlanner — 大乐句骨架规划器
// ============================================================
//
// 在生成具体音符之前，先决定整个段落的"句式骨架"：
//   1. 大乐句长度（4/8/16 小节）— 来自 style.melody.phraseLengthProfile
//   2. 子动机布局（AABA / ABAB' / ABAC' / longform）— 根据 group 长度和段落类型
//   3. 句式终止类型（open/closed）— 偶数 group open，奇数 group closed
//   4. Hook 计划（仅 Chorus）— peak slot、爬升曲线
//
// 这个 planner 不消耗音符级 PRNG，只消耗"骨架级" PRNG，因此对生成顺序影响最小。

class PhraseGroupPlanner {
    /**
     * 加权抽签：从 [{ bars, weight }] 池中选一个 bars 值
     */
    private static weightedPickBars(pool: { bars: number, weight: number }[]): number {
        if (!pool || pool.length === 0) return 4;
        let total = 0;
        for (let i = 0; i < pool.length; i++) total += pool[i].weight;
        let roll = PRNGManager.next() * total;
        for (let i = 0; i < pool.length; i++) {
            roll -= pool[i].weight;
            if (roll <= 0) return pool[i].bars;
        }
        return pool[pool.length - 1].bars;
    }

    /**
     * 根据段落类型和 profile 选择 group 长度（小节数）
     */
    private static pickGroupBars(profile: PhraseLengthProfile, secType: SectionType | undefined): number {
        const per = profile.perSection;
        let pool = per.default || [{ bars: 4, weight: 1 }];
        if (secType === SectionType.Verse && per.verse) pool = per.verse;
        else if (secType === SectionType.PreChorus && per.preChorus) pool = per.preChorus;
        else if (secType === SectionType.Chorus && per.chorus) pool = per.chorus;
        else if ((secType === SectionType.Bridge || secType === SectionType.Solo_Bridge) && per.bridge) pool = per.bridge;
        else if (secType === SectionType.Intro && per.intro) pool = per.intro;
        else if ((secType === SectionType.Outro || secType === SectionType.PreOutro) && per.outro) pool = per.outro;
        return this.weightedPickBars(pool);
    }

    /**
     * 根据子动机数量和段落类型决定布局
     *
     * 经典 4-slot 布局（每 slot = 2-bar，组成 8-bar 大乐句）：
     *   AABA   = ['M', 'M', 'N', 'M_prime']           // Bruno Mars 经典
     *   ABAB'  = ['M', 'N', 'M_prime', 'N_prime']     // 双主题对话
     *   ABAC'  = ['M', 'N', 'M', 'O_resolve']         // 收束变化
     *   longform = ['M', 'M_dev1', 'M_dev2', 'M_resolve'] // 单主题发展（小雨型）
     *
     * 2-slot 布局（4-bar 短乐句）：
     *   AB    = ['M', 'M_resolve']
     *   AA'   = ['M', 'M_prime']
     */
    private static pickLayout(slotCount: number, secType: SectionType | undefined, isLongform: boolean): SubMotifSlot[] {
        const slots: SubMotifSlot[] = [];

        if (slotCount === 1) {
            slots.push({ label: 'M', role: 'statement', lengthBars: 0 });
            return slots;
        }

        if (slotCount === 2) {
            // 4-bar group: 2 slots
            const isAAprime = PRNGManager.next() < 0.6;
            slots.push({ label: 'M', role: 'statement', lengthBars: 0 });
            slots.push({
                label: isAAprime ? 'M_prime' : 'M_resolve',
                role: isAAprime ? 'vary' : 'resolve',
                lengthBars: 0,
            });
            return slots;
        }

        if (slotCount === 4) {
            // 8-bar group: 4 slots
            const roll = PRNGManager.next();

            // longform 模式：单主题贯穿发展（小雨型）
            if (isLongform || roll < 0.2) {
                slots.push({ label: 'M', role: 'statement', lengthBars: 0 });
                slots.push({ label: 'M_dev1', role: 'vary', lengthBars: 0 });
                slots.push({ label: 'M_dev2', role: 'vary', lengthBars: 0, isPeak: secType === SectionType.Chorus });
                slots.push({ label: 'M_resolve', role: 'resolve', lengthBars: 0 });
                return slots;
            }

            // AABA：副歌最常见
            if (roll < 0.55) {
                slots.push({ label: 'M', role: 'statement', lengthBars: 0 });
                slots.push({ label: 'M', role: 'repeat', lengthBars: 0 });
                slots.push({ label: 'N', role: 'contrast', lengthBars: 0, isPeak: secType === SectionType.Chorus });
                slots.push({ label: 'M_prime', role: 'resolve', lengthBars: 0 });
                return slots;
            }

            // ABAB'：双主题对话
            if (roll < 0.8) {
                slots.push({ label: 'M', role: 'statement', lengthBars: 0 });
                slots.push({ label: 'N', role: 'contrast', lengthBars: 0 });
                slots.push({ label: 'M_prime', role: 'vary', lengthBars: 0, isPeak: secType === SectionType.Chorus });
                slots.push({ label: 'N_prime', role: 'resolve', lengthBars: 0 });
                return slots;
            }

            // ABAC'：收束变化
            slots.push({ label: 'M', role: 'statement', lengthBars: 0 });
            slots.push({ label: 'N', role: 'contrast', lengthBars: 0 });
            slots.push({ label: 'M', role: 'repeat', lengthBars: 0, isPeak: secType === SectionType.Chorus });
            slots.push({ label: 'O_resolve', role: 'resolve', lengthBars: 0 });
            return slots;
        }

        if (slotCount === 8) {
            // 16-bar group: 8 slots — 两个 8-bar AABA 大乐句拼接
            const layout1 = this.pickLayout(4, secType, isLongform);
            const layout2 = this.pickLayout(4, secType, isLongform);
            // 第二组的 label 加 _2 后缀，避免与第一组共享同一 motif（保留对比）
            for (let i = 0; i < layout2.length; i++) {
                layout2[i].label = layout2[i].label + '_2';
            }
            return [...layout1, ...layout2];
        }

        // Fallback：回退为简单 statement-resolve 序列
        for (let i = 0; i < slotCount; i++) {
            slots.push({
                label: i === 0 ? 'M' : (i === slotCount - 1 ? 'M_resolve' : `M_dev${i}`),
                role: i === 0 ? 'statement' : (i === slotCount - 1 ? 'resolve' : 'vary'),
                lengthBars: 0,
            });
        }
        return slots;
    }

    /**
     * 为 Chorus PhraseGroup 生成 Hook 主动架构
     * 选择 peak slot（通常是黄金分割位 ≈ 0.6 处）
     */
    private static buildHookPlan(slots: SubMotifSlot[]): HookPlan | undefined {
        if (slots.length === 0) return undefined;

        // 寻找已被标记为 isPeak 的 slot；若无则强制将黄金分割位设为 peak
        let peakIdx = slots.findIndex(s => s.isPeak);
        if (peakIdx < 0) {
            // 黄金分割：4-slot → idx 2；8-slot → idx 5
            peakIdx = Math.floor(slots.length * 0.618);
            if (peakIdx >= slots.length) peakIdx = slots.length - 1;
            slots[peakIdx].isPeak = true;
        }

        // 爬升曲线由 PRNG 决定
        const climbRoll = PRNGManager.next();
        let climbCurve: 'gradual' | 'steep' | 'plateau';
        if (climbRoll < 0.5) climbCurve = 'gradual';   // 4 slots 慢慢爬
        else if (climbRoll < 0.8) climbCurve = 'steep'; // 一上来就高
        else climbCurve = 'plateau';                    // 平台式停留

        return {
            peakSlotIndex: peakIdx,
            climbCurve,
            reinforceCount: PRNGManager.next() < 0.6 ? 2 : 1, // 60% 概率峰值砸两次
        };
    }

    /**
     * 主入口：为整个段落生成 PhraseGroup 序列
     */
    public static planSection(
        section: SectionMetadata,
        beatsPerBar: number,
        style: StyleConfig
    ): PhraseGroup[] {
        const groups: PhraseGroup[] = [];
        const profile = style.melody.phraseLengthProfile;
        const secType = section.sectionType;
        const sectionLengthBeats = section.endBeat - section.startBeat;
        const sectionLengthBars = sectionLengthBeats / beatsPerBar;

        let currentBeat = section.startBeat;
        let groupIndex = 0;
        let remainingBars = sectionLengthBars;

        while (remainingBars > 0) {
            // 选 group 长度（小节）
            let groupBars: number;
            if (profile) {
                groupBars = this.pickGroupBars(profile, secType);
            } else {
                groupBars = 4; // fallback
            }
            // clamp 到剩余空间
            if (groupBars > remainingBars) groupBars = remainingBars;
            if (groupBars < 1) groupBars = 1;

            // 选子动机长度
            const subMotifBars = profile
                ? this.weightedPickBars(profile.subMotifBarsPool || [{ bars: 2, weight: 1 }])
                : 2;
            const slotCount = Math.max(1, Math.floor(groupBars / subMotifBars));

            // 生成布局
            const isLongform = subMotifBars >= groupBars; // 单 motif 占满整个 group
            const slots = this.pickLayout(slotCount, secType, isLongform);
            // 回填每个 slot 的实际长度
            const actualSubMotifBars = groupBars / slots.length;
            for (let i = 0; i < slots.length; i++) {
                slots[i].lengthBars = actualSubMotifBars;
            }

            // 句式终止：偶数 group open，奇数 group closed（对仗）
            // 但段落最后一个 group 强制 closed
            const isLastGroup = (remainingBars - groupBars) <= 0;
            const cadenceType: CadenceType = isLastGroup
                ? CadenceType.Closed
                : (groupIndex % 2 === 0 ? CadenceType.Open : CadenceType.Closed);

            // Hook 计划：仅 Chorus group
            const hookPlan = secType === SectionType.Chorus
                ? this.buildHookPlan(slots)
                : undefined;

            groups.push({
                startBeat: currentBeat,
                lengthBeats: groupBars * beatsPerBar,
                subMotifs: slots,
                cadenceType,
                hookPlan,
                formLabel: slots.map(s => s.label).join('-'),
            });

            currentBeat += groupBars * beatsPerBar;
            remainingBars -= groupBars;
            groupIndex++;
        }

        return groups;
    }
}

export class ToplineEngine {
    
    // 🌟 提取并简化副歌 Hook 作为前奏旋律 (Thematic Foreshadowing)
    public static extractForeshadowingIntro(chorusMotif: NoteData[], targetInstrument: number = 10 /* 10: Music Box */, introStartBeat: number = 0, chorusStartBeat: number = 0): NoteData[] {
        const introMelody: NoteData[] = [];
        
        // Find the start beat of the chorus to calculate relative positions
        if (chorusMotif.length === 0) return introMelody;
        const referenceBeat = chorusStartBeat > 0 ? chorusStartBeat : chorusMotif[0].onset;
        
        for (let note of chorusMotif) {
            // 规则 1：过滤掉短于 1/8 音符的装饰音 (去除油腻感)
            if (note.duration < 0.5) continue; 
            
            // 规则 2：只保留落在强拍或次强拍上的音 (例如 4/4 拍的 1, 1.5, 2, 2.5, 3, 3.5 拍)
            const relativeBeat = note.onset - referenceBeat;
            if (relativeBeat < 0) continue; // Prevent pickup notes from playing over wrong chords
            
            const isOnBeat = isOnGrid(relativeBeat, 0.5);
            
            if (isOnBeat) {
                introMelody.push({
                    pitch: note.pitch,       // 保持原音高
                    onset: introStartBeat + relativeBeat,
                    duration: note.duration * 1.5, // 延长时值，增加连音(Legato)和空灵感
                    velocity: 60            // 降低力度，表现克制
                });
            }
        }
        return introMelody;
    }
    
    // 🌟 动机碎裂引擎：让副歌旋律在 Outro 中如记忆般消散
    public static generateFadingEchoOutro(chorusHook: NoteData[], outroStartBeat: number, outroBars: number, beatsPerBar: number): NoteData[] {
        const fragmentedNotes: NoteData[] = [];
        if (chorusHook.length === 0) return fragmentedNotes;

        const chorusStartBeat = chorusHook[0].onset;
        const outroLengthBeats = outroBars * beatsPerBar;

        // 只截取 Hook 前 2 小节
        const coreMotif: NoteData[] = [];
        for (let ni = 0; ni < chorusHook.length; ni++) {
            if ((chorusHook[ni].onset - chorusStartBeat) < (beatsPerBar * 2)) {
                coreMotif.push(chorusHook[ni]);
            }
        }

        // 🌟 基于音乐重要度的细胞消散
        // 强拍和弦音高存活率，弱拍经过音低存活率，随时间递减
        for (let ni = 0; ni < coreMotif.length; ni++) {
            const note = coreMotif[ni];
            const relativeBeat = note.onset - chorusStartBeat;
            const progress = relativeBeat / (beatsPerBar * 2); // 0→1

            // epsilon 浮点安全的强拍判断
            const isOnBeat = Math.abs(relativeBeat - Math.round(relativeBeat)) < 1e-6;

            // 存活概率：强拍高（0.9→0.5），弱拍低（0.4→0.1）
            const survivalProb = isOnBeat
                ? 0.9 - progress * 0.4
                : 0.4 - progress * 0.3;

            if (PRNGManager.next() < survivalProb) {
                const noteOnset = outroStartBeat + relativeBeat;
                // 防止超出 Outro 范围
                if (noteOnset >= outroStartBeat + outroLengthBeats - 1e-6) continue;

                fragmentedNotes.push({
                    pitch: note.pitch,
                    onset: noteOnset, // 精确网格对齐，不加随机偏移
                    duration: note.duration * 2.0, // 延长制造空灵感
                    velocity: Math.max(0.08, 0.4 * (1.0 - progress * 0.7)) // 从 0.4 渐弱到 0.12
                });
            }
        }

        return fragmentedNotes;
    }

    public static generateTrackMelody(
        sections: SectionMetadata[], chords: GeneratedChord[], style: StyleConfig,
        tonality: Tonality, instrumentName: string = 'Acoustic_Grand',
        userMotif?: NoteData[], isSecondary: boolean = false, context?: MusicContext
    ): NoteData[] {
        const fullMelody: NoteData[] = [];
        const beatsPerBar = GlobalContext.currentTimeSignature[0];

        // 🌟 P6b: 全曲张力封套（一次性构建，全 section 共享）
        const tensionEnv: TensionEnvelope = PhraseContourPlanner.buildForSong(sections);

        // 🌟 Phase 1: Global Groove Strategy (Now decoupled per section)
        const verseDensityMult = style.contrast.verseDensityMultiplier || 1.0;
        
        sections.forEach(section => {
            // Use decoupled groove parameters from section
            const density = isSecondary ? (section.groove?.density ?? 0.5) * 0.5 : (section.groove?.density ?? 0.5);
            const syncopationProb = section.groove?.syncopationProb ?? 0.2;
            
            section.grooveDNA = GrooveEngine.generateRhythmFingerprint(
                density,
                syncopationProb,
                beatsPerBar,
                userMotif
            );
        });

        // 🌟 Phase 2: Chorus Motif + Layout Extraction
        // PR #6: 同时提取 firstChorus 的 phraseGroups layout，后续 Chorus 段落直接复用
        // 这是修复"Chorus_1 和 Chorus_Main 听起来像两首歌"的核心
        const chorusMotifs = new MotifMap();
        let chorusPhraseGroups: PhraseGroup[] | null = null;
        let chorusLengthBeats = 0;
        const firstChorus = sections.find(s => s.sectionType === SectionType.Chorus);
        if (firstChorus) {
            const chorusChords = chords.filter(c => c.startBeat >= firstChorus.startBeat && c.startBeat < firstChorus.endBeat);
            if (chorusChords.length === 0) chorusChords.push(chords[0]);
            // Generate motifs only, don't realize notes yet (no tensionEnv needed in motif-only mode)
            const result = this.generateSectionMelody(firstChorus, chorusChords, style, tonality, instrumentName, beatsPerBar, userMotif, undefined, null, true, 0, isSecondary, 0, context, undefined, undefined);
            result.motifs.forEach((val, key) => chorusMotifs.set(key, val));
            // 🌟 PR #6: 保存第一个 Chorus 的 phraseGroups 供后续 Chorus 复用
            chorusPhraseGroups = result.phraseGroups ?? null;
            chorusLengthBeats = firstChorus.endBeat - firstChorus.startBeat;
        }

        // 🌟 Phase 3: Chronological Generation with Pitch Continuity
        // C 可移植：用 index-aligned 数组取代 Map<number, NoteData[]>，section 索引即数组索引
        const sectionMelodies: (NoteData[] | undefined)[] = new Array(sections.length);
        let currentPreviousPitch: number | null = null;
        let globalUnresolvedCount = 0; // 🌟 新增：跨段落追踪未解决的乐句数量
        let maxPitchBeforeChorus = 0; // 🌟 新增：追踪副歌前的最高音，用于制造 Detonator 爆发

        sections.forEach((section, index) => {
            let providedMotifs: MotifMap | undefined = undefined;
            let providedPhraseGroups: PhraseGroup[] | undefined = undefined;

            // 🌟 PR #6: 修复 'A' → 'M' bug
            // PhraseGroupPlanner 生成的 slot.label 都是 'M/N/O' 开头（line 135-186），
            // 所以 baseLabel = split('_')[0] 产生的 key 是 'M/N/O'，不是 'A'。
            // 旧版代码用 chorusMotifs.get('A') 永远 undefined → Verse/PreChorus 传承完全失效。
            const primaryMotifKey = 'M';

            if (section.sectionType === SectionType.Chorus) {
                // 🌟 PR #6 克隆锁：Chorus 段落完全复用 firstChorus 的 motifs + layout
                providedMotifs = chorusMotifs;
                // 仅当段落长度与 firstChorus 相同时才复用 layout（不同长度会导致 slot 数不匹配）
                const thisLengthBeats = section.endBeat - section.startBeat;
                if (chorusPhraseGroups && Math.abs(thisLengthBeats - chorusLengthBeats) < 1e-6) {
                    // 🌟 P5d 修复：chorusPhraseGroups 里 group.startBeat 仍是 firstChorus 的绝对拍（如 0, 8, 16...），
                    // 不能直接复用（否则 Chorus_Main/Epic 的音 onset 全落在 firstChorus 区间导致"空段"）。
                    // 克隆并按 section.startBeat 相对 firstChorus.startBeat 的差值平移 group.startBeat。
                    const firstChorusStartBeat = chorusPhraseGroups[0]?.startBeat ?? 0;
                    // 用第一个 group 的 startBeat 推算 firstChorus 的起始（通常等于 firstChorus.startBeat）
                    // 但更稳的做法：firstChorus 就是 sections.find(Chorus)，它已经在外层作用域里
                    const anchorStart = firstChorus!.startBeat; // firstChorus 一定存在（前面生成过）
                    const deltaBeat = section.startBeat - anchorStart;
                    providedPhraseGroups = [];
                    for (let gi = 0; gi < chorusPhraseGroups.length; gi++) {
                        const src = chorusPhraseGroups[gi];
                        // 浅克隆 group（保留 subMotifs 引用即可，slot 本身不含 startBeat）
                        providedPhraseGroups.push({
                            startBeat: src.startBeat + deltaBeat,
                            lengthBeats: src.lengthBeats,
                            subMotifs: src.subMotifs,
                            cadenceType: src.cadenceType,
                            hookPlan: src.hookPlan,
                            formLabel: src.formLabel,
                        });
                    }
                }
            } else if (chorusMotifs.size > 0 && section.sectionType === SectionType.PreChorus) {
                // 🌟 PreChorus 使用动机插值器 (Motif Morpher)，平滑过渡到副歌
                const motifA = chorusMotifs.get(primaryMotifKey);
                if (motifA) {
                    const sectionDensity = isSecondary ? (section.groove?.density ?? 0.5) * 0.5 : (section.groove?.density ?? 0.5);
                    const morphed = this.morphMotifs(
                        this.downgradeMotif(motifA, section.name, sectionDensity),
                        motifA,
                        2
                    );
                    providedMotifs = new MotifMap();
                    if (morphed.length > 0) {
                        providedMotifs.set(primaryMotifKey, morphed[morphed.length - 1]);
                    }
                }
            } else if (chorusMotifs.size > 0 && section.sectionType === SectionType.Verse) {
                // 🌟 PR #6: Verse 复用概率 0.5 → 0.8，增强主歌/副歌的"同源感"
                if (PRNGManager.next() < 0.8) {
                    providedMotifs = new MotifMap();
                    const motifA = chorusMotifs.get(primaryMotifKey);
                    if (motifA) {
                        const sectionDensity = isSecondary ? (section.groove?.density ?? 0.5) * 0.5 : (section.groove?.density ?? 0.5);
                        providedMotifs.set(primaryMotifKey, this.downgradeMotif(motifA, section.name, sectionDensity));
                    }
                }
            } else if (chorusMotifs.size > 0 && (section.sectionType === SectionType.Bridge || section.sectionType === SectionType.Break)) {
                // 🌟 PR #6: Bridge/Break 也参与传承（降级版本，避免和 Chorus 太像）
                if (PRNGManager.next() < 0.6) {
                    providedMotifs = new MotifMap();
                    const motifA = chorusMotifs.get(primaryMotifKey);
                    if (motifA) {
                        const sectionDensity = isSecondary ? (section.groove?.density ?? 0.5) * 0.5 : (section.groove?.density ?? 0.5);
                        providedMotifs.set(primaryMotifKey, this.downgradeMotif(motifA, section.name, sectionDensity));
                    }
                }
            }

            const sectionChords = chords.filter(c => c.startBeat >= section.startBeat && c.startBeat < section.endBeat);
            if (sectionChords.length === 0) sectionChords.push(chords[0]);

            // 🌟 提案一：主题回响 (Motif Fragmentation)
            // 如果是 Outro，且不是 hard_stop，尝试使用副歌动机进行碎裂化处理
            if (section.sectionType === SectionType.Outro && section.endingType !== 'hard_stop' && !isSecondary) {
                const chorusIndex = sections.findIndex(s => s.sectionType === SectionType.Chorus);
                if (chorusIndex !== -1 && sectionMelodies[chorusIndex] !== undefined) {
                    const chorusNotes = sectionMelodies[chorusIndex]!;
                    if (chorusNotes.length > 0) {
                        const outroBars = (section.endBeat - section.startBeat) / beatsPerBar;
                        const outroNotes = this.generateFadingEchoOutro(chorusNotes, section.startBeat, outroBars, beatsPerBar);

                        sectionMelodies[index] = outroNotes;
                        if (outroNotes.length > 0) {
                            currentPreviousPitch = outroNotes[outroNotes.length - 1].pitch;
                        }
                        globalUnresolvedCount = 0;
                        return; // 跳过常规的 generateSectionMelody
                    }
                }
            }

            const result = this.generateSectionMelody(section, sectionChords, style, tonality, instrumentName, beatsPerBar, userMotif, providedMotifs, currentPreviousPitch, false, globalUnresolvedCount, isSecondary, maxPitchBeforeChorus, context, providedPhraseGroups, tensionEnv);
            
            sectionMelodies[index] = result.notes;
            currentPreviousPitch = result.lastPitch; // Pass the last pitch to the next section!
            globalUnresolvedCount = result.unresolvedCount; // 更新未解决计数
            
            // 🌟 记录副歌前的最高音
            if (section.sectionType !== SectionType.Chorus && result.notes.length > 0) {
                const sectionMax = Math.max(...result.notes.map(n => n.pitch));
                if (sectionMax > maxPitchBeforeChorus) {
                    maxPitchBeforeChorus = sectionMax;
                }
            }
        });

        // Assemble full melody in order
        sections.forEach((section, index) => {
            const notes = sectionMelodies[index];
            if (notes) {
                fullMelody.push(...notes);
            }
        });

        return fullMelody;
    }

    /**
     * 动机插值器 (Motif Morpher) — 数学版 MusicVAE 潜在空间插值
     * 给定动机 A 和 B，生成 N 个中间过渡动机
     * 不使用 Set（P-1 兼容），使用 indexOf 去重
     * // max ~20 notes per morphed motif (bounded by motifA + motifB note counts)
     */
    private static morphMotifs(motifA: MotifTemplate, motifB: MotifTemplate, steps: number = 3): MotifTemplate[] {
        const morphed: MotifTemplate[] = [];

        for (let s = 1; s <= steps; s++) {
            const ratio = s / (steps + 1); // 0.25, 0.5, 0.75 for steps=3

            // 1. 节奏插值：按比例混合 A 和 B 的发声点
            const mergedOffsets: number[] = [];
            // 保留 A 中比例内的音（强拍优先保留）
            for (let i = 0; i < motifA.rhythmOffsets.length; i++) {
                const onset = motifA.rhythmOffsets[i];
                const isStrongBeat = Math.abs(onset % 1) < 1e-6;
                if (isStrongBeat || PRNGManager.next() > ratio) {
                    if (mergedOffsets.indexOf(onset) === -1) mergedOffsets.push(onset);
                }
            }
            // 混入 B 中比例内的音
            for (let i = 0; i < motifB.rhythmOffsets.length; i++) {
                const onset = motifB.rhythmOffsets[i];
                if (PRNGManager.next() < ratio) {
                    if (mergedOffsets.indexOf(onset) === -1) mergedOffsets.push(onset);
                }
            }
            mergedOffsets.sort((a, b) => a - b);

            // 2. 轮廓插值：过渡前半用 A 轮廓，后半用 B 轮廓
            const newContour = ratio > 0.5 ? motifB.contour : motifA.contour;

            // 3. 乐句长度取两者加权平均
            const avgLength = motifA.phraseLengthBeats * (1 - ratio) + motifB.phraseLengthBeats * ratio;

            morphed.push({
                rhythmOffsets: mergedOffsets,
                contour: newContour,
                noteCount: mergedOffsets.length,
                phraseLengthBeats: Math.round(avgLength * 2) / 2, // 量化到 0.5 拍
                isMutated: true
            });
        }
        return morphed;
    }

    private static transformMotif(motif: MotifTemplate, transform: { isInv?: boolean, isRet?: boolean, isAug?: boolean, isSwitcheroo?: boolean, isSplit?: boolean, isMerge?: boolean, isShift?: boolean }): MotifTemplate {
        let { rhythmOffsets, contour, noteCount, phraseLengthBeats } = motif;
        // 🌟 同步变换 relativePitches，保持音高轮廓与节奏/contour 一致
        let relativePitches = motif.relativePitches ? [...motif.relativePitches] : undefined;

        if (transform.isInv) {
            const invMap: Record<Contour, Contour> = {
                'Ascending': 'Descending',
                'Descending': 'Ascending',
                'Arch': 'Bowl',
                'Bowl': 'Arch',
                'Static': 'Static',
                'Wandering': 'Wandering'
            };
            contour = invMap[contour];
            // relativePitches 镜像翻转
            if (relativePitches) {
                relativePitches = relativePitches.map(rp => -rp);
            }
        }

        if (transform.isRet) {
            if (rhythmOffsets.length > 0) {
                const lastOffset = rhythmOffsets[rhythmOffsets.length - 1];
                rhythmOffsets = rhythmOffsets.map(r => lastOffset - r).reverse();
            }
            const retMap: Record<Contour, Contour> = {
                'Ascending': 'Descending',
                'Descending': 'Ascending',
                'Arch': 'Arch',
                'Bowl': 'Bowl',
                'Static': 'Static',
                'Wandering': 'Wandering'
            };
            contour = retMap[contour];
            // relativePitches 逆行
            if (relativePitches) {
                relativePitches = [...relativePitches].reverse();
            }
        }

        if (transform.isAug) {
            // 节奏放大 (Rhythmic Augmentation)
            const origLen = rhythmOffsets.length;
            rhythmOffsets = rhythmOffsets.map(r => r * 2.0).filter(r => r < phraseLengthBeats);

            // 如果放大后音符太少（比如只有一个），尝试在中间插入一个音
            if (rhythmOffsets.length === 1 && phraseLengthBeats > 2) {
                rhythmOffsets.push(rhythmOffsets[0] + 1.0);
            }

            // relativePitches 截断到新长度（放大后被过滤掉的尾部音符对应的 pitch 也丢弃）
            if (relativePitches) {
                relativePitches = relativePitches.slice(0, rhythmOffsets.length);
                // 如果 rhythmOffsets 因兜底插入而多了一个，补充最后一个值
                while (relativePitches.length < rhythmOffsets.length) {
                    relativePitches.push(relativePitches.length > 0 ? relativePitches[relativePitches.length - 1] : 0);
                }
            }

            noteCount = rhythmOffsets.length;
        }

        if (transform.isSwitcheroo && rhythmOffsets.length > 1) {
            // 🌟 Switcheroo (移位/镜像技巧)
            const switchMap: Record<Contour, Contour> = {
                'Ascending': 'Arch',
                'Descending': 'Bowl',
                'Arch': 'Ascending',
                'Bowl': 'Descending',
                'Static': 'Wandering',
                'Wandering': 'Static'
            };
            contour = switchMap[contour];

            // 节奏上，把最后一个音符提前到第一个音符之前（切分预期）
            const lastOffset = rhythmOffsets.pop()!;
            rhythmOffsets.unshift(rhythmOffsets[0] - 0.5);

            // relativePitches 同步：把最后一个 pitch 移到最前面
            if (relativePitches && relativePitches.length > 1) {
                const lastRp = relativePitches.pop()!;
                relativePitches.unshift(lastRp);
            }

            // 归一化，确保不出现负数时间
            const minOffset = Math.min(...rhythmOffsets);
            if (minOffset < 0) {
                rhythmOffsets = rhythmOffsets.map(r => r - minOffset);
            }
        }

        if (transform.isSplit && rhythmOffsets.length > 0) {
            // 🌟 Split (分裂): 随机选择一个音符，将其分裂为两个
            const splitIdx = Math.floor(PRNGManager.next() * rhythmOffsets.length);
            const onset = rhythmOffsets[splitIdx];
            const nextOnset = splitIdx < rhythmOffsets.length - 1 ? rhythmOffsets[splitIdx + 1] : phraseLengthBeats;
            const duration = nextOnset - onset;
            if (duration >= 1.0) {
                rhythmOffsets.splice(splitIdx + 1, 0, onset + duration / 2);
                // relativePitches 同步：在 split 点插入原值与下一个值的中间值
                if (relativePitches) {
                    const curRp = relativePitches[splitIdx];
                    const nextRp = splitIdx + 1 < relativePitches.length ? relativePitches[splitIdx + 1] : curRp;
                    relativePitches.splice(splitIdx + 1, 0, (curRp + nextRp) / 2);
                }
                noteCount++;
            }
        }

        if (transform.isMerge && rhythmOffsets.length > 1) {
            // 🌟 Merge (合并): 随机选择两个相邻的音符，合并为一个
            const mergeIdx = Math.floor(PRNGManager.next() * (rhythmOffsets.length - 1));
            rhythmOffsets.splice(mergeIdx + 1, 1);
            // relativePitches 同步：移除被合并的音符
            if (relativePitches && mergeIdx + 1 < relativePitches.length) {
                relativePitches.splice(mergeIdx + 1, 1);
            }
            noteCount--;
        }

        if (transform.isShift && rhythmOffsets.length > 0) {
            // 🌟 Shift (移位): 整体平移或局部平移
            const shiftAmount = PRNGManager.next() > 0.5 ? 0.5 : -0.5;
            // 记录哪些 index 会被保留（用于同步 relativePitches）
            const keepIndices: number[] = [];
            const shiftedOffsets: number[] = [];
            for (let si = 0; si < rhythmOffsets.length; si++) {
                const shifted = rhythmOffsets[si] + shiftAmount;
                if (shifted >= 0 && shifted < phraseLengthBeats) {
                    shiftedOffsets.push(shifted);
                    keepIndices.push(si);
                }
            }
            rhythmOffsets = shiftedOffsets;
            if (rhythmOffsets.length === 0) {
                rhythmOffsets.push(0);
                keepIndices.push(0);
            }
            // relativePitches 同步：只保留未被过滤掉的元素
            if (relativePitches) {
                const newRp: number[] = [];
                for (let ki = 0; ki < keepIndices.length; ki++) {
                    const idx = keepIndices[ki];
                    newRp.push(idx < relativePitches.length ? relativePitches[idx] : 0);
                }
                relativePitches = newRp;
            }
            noteCount = rhythmOffsets.length;
        }

        return { rhythm: motif.rhythm, anchors: motif.anchors, isMutated: true, rhythmOffsets, relativePitches, contour, noteCount, phraseLengthBeats };
    }

    private static downgradeMotif(motif: MotifTemplate, sectionName: string, density: number): MotifTemplate {
        let newRhythm = [...motif.rhythmOffsets];
        let newRelativePitches = motif.relativePitches ? [...motif.relativePitches] : undefined;
        let newContour = motif.contour;

        if (sectionName.includes('Verse')) {
            // Sparser rhythm: drop some off-beats, 同步过滤 relativePitches
            const keepIndices: number[] = [];
            const filteredRhythm: number[] = [];
            for (let di = 0; di < newRhythm.length; di++) {
                if (isOnDownbeat(newRhythm[di]) || PRNGManager.next() < density) {
                    filteredRhythm.push(newRhythm[di]);
                    keepIndices.push(di);
                }
            }
            newRhythm = filteredRhythm;
            if (newRhythm.length === 0) {
                newRhythm.push(0);
                keepIndices.push(0);
            }
            if (newRelativePitches) {
                const filteredRp: number[] = [];
                for (let ki = 0; ki < keepIndices.length; ki++) {
                    const idx = keepIndices[ki];
                    filteredRp.push(idx < newRelativePitches.length ? newRelativePitches[idx] : 0);
                }
                newRelativePitches = filteredRp;
            }
        } else if (sectionName.includes('PreChorus')) {
            // Build-up contour — relativePitches 保持不变，realizeMotif 会 fallback 到 contour 计算
            newContour = 'Ascending';
            // PreChorus 改变 contour 后 relativePitches 已不匹配，清除让 realizeMotif fallback
            newRelativePitches = undefined;
        }

        return {
            rhythm: motif.rhythm, anchors: motif.anchors, isMutated: true,
            rhythmOffsets: newRhythm,
            relativePitches: newRelativePitches,
            contour: newContour,
            noteCount: newRhythm.length,
            phraseLengthBeats: motif.phraseLengthBeats
        };
    }

    private static generateSectionMelody(
        section: SectionMetadata, chords: GeneratedChord[], style: StyleConfig,
        tonality: Tonality, instrumentName: string,
        beatsPerBar: number, userMotif?: NoteData[],
        providedMotifs?: MotifMap,
        incomingPreviousPitch: number | null = null,
        generateMotifsOnly: boolean = false,
        incomingUnresolvedCount: number = 0,
        isSecondary: boolean = false,
        maxPitchBeforeChorus: number = 0,
        context?: MusicContext,
        providedPhraseGroups?: PhraseGroup[],  // 🌟 PR #6: 外部注入的 phrase layout，用于 Chorus 克隆
        tensionEnv?: TensionEnvelope  // 🌟 P6b: 张力封套（不传时 generateMotifsOnly=true 模式跳过）
    ): { notes: NoteData[], motifs: MotifMap, lastPitch: number | null, unresolvedCount: number, phraseGroups?: PhraseGroup[] } {
        const sectionDensity = section.groove?.density ?? 0.5;
        const sectionSyncopation = section.groove?.syncopationProb ?? 0.2;
        
        // 🌟 修复：如果主奏乐器不是人声，说明这是一首纯器乐曲，主旋律应该具有 Solo 的表现力
        const isVocal = instrumentName.includes('Voice') || instrumentName.includes('Choir') || instrumentName.includes('Vocal') || instrumentName.includes('Synth_Voice') || instrumentName.includes('Marimba');
        const isInstrumental = !isVocal;
        const isLead = !isSecondary;
        let isSolo = false;

        // 🌟 乐器包络感知：Sustained 乐器（管乐/弦乐）旋律偏好长音、低密度
        // 避免生成"钢琴式"的密集短音给管乐演奏
        let instrumentDensityMult = 1.0;
        const instId = getInstrumentIdByName(instrumentName);
        const instEnvelope = InstrumentProfiles[instId]?.envelope;
        if (instEnvelope === AcousticEnvelope.Sustained) {
            instrumentDensityMult = 0.6; // 管乐/弦乐降低 40% 密度
        }
        
        let isIntro = false;
        let isOutro = false;
        
        let pitchOffset = style.contrast.versePitchOffset;

        const secType = section.sectionType;
        if (secType === SectionType.Chorus) {
            pitchOffset = style.contrast.chorusPitchOffset || 5;
        } else if (secType === SectionType.Solo_Bridge) {
            pitchOffset = 12;
            isSolo = true;
        } else if (secType === SectionType.Intro) {
            pitchOffset = 12;
            isIntro = true;
            // 🌟 如果是人声（非器乐），则在前奏期间不唱歌
            if (!isInstrumental) {
                return { notes: [], motifs: new MotifMap(), lastPitch: null, unresolvedCount: incomingUnresolvedCount };
            }
        } else if (secType === SectionType.Outro || secType === SectionType.PreOutro) {
            pitchOffset = 12;
            isOutro = true;
            if (!isInstrumental && PRNGManager.next() > 0.5) {
                return { notes: [], motifs: new MotifMap(), lastPitch: null, unresolvedCount: incomingUnresolvedCount };
            }
        } else if (secType === SectionType.Break || secType === SectionType.Breakdown) {
            pitchOffset = 0;
        }

        const sectionGroove = section.grooveDNA || GrooveEngine.generateRhythmFingerprint(sectionDensity, sectionSyncopation, beatsPerBar, userMotif);
        // 🌟 修复：将生成的 groove 保存回 section，确保 Orchestrator 生成伴奏时使用完全相同的律动骨架！
        section.grooveDNA = sectionGroove;
        GlobalContext.updateCurrentSlice(section, chords[0], sectionGroove);

        const melodyGroove = GrooveEngine.generateInverseGroove(sectionGroove, beatsPerBar, sectionDensity);

        const secStart = section.startBeat;
        const sectionMelody: NoteData[] = [];
        let currentPreviousPitch = incomingPreviousPitch;
        
        // 🌟 戛然而止 (Hard Stop) 逻辑：只在第一拍弹奏一个强有力的主音，然后结束
        if (section.endingType === 'hard_stop') {
            const firstChord = chords[0];
            const rootPitch = HarmonyCore.getChordTones(firstChord, 60)[0];
            const pitch = rootPitch + pitchOffset;
            sectionMelody.push({
                pitch: pitch,
                onset: secStart,
                duration: beatsPerBar * 2, // 延音两小节
                velocity: 0.7 // 适中力度（不爆音）
            });
            return { notes: sectionMelody, motifs: new MotifMap(), lastPitch: pitch, unresolvedCount: 0 };
        }

        let motifUsage: 'None' | 'LiteralRiff' | 'RhythmOnly' | 'BrokenDown' = 'None';
        if (userMotif && userMotif.length > 0) {
            if (secType === SectionType.Intro) {
                motifUsage = 'LiteralRiff';
            } else if (secType === SectionType.Chorus) {
                motifUsage = 'LiteralRiff';
            } else if (secType === SectionType.Verse) {
                motifUsage = PRNGManager.next() > 0.5 ? 'BrokenDown' : 'RhythmOnly';
            } else {
                motifUsage = 'None';
            }
        }

        if (motifUsage === 'LiteralRiff' && userMotif) {
            if (generateMotifsOnly) {
                return { notes: [], motifs: new MotifMap(), lastPitch: null, unresolvedCount: incomingUnresolvedCount };
            }

            let maxMotifOnset = 0;
            userMotif.forEach(n => { if (n.onset > maxMotifOnset) maxMotifOnset = n.onset; });
            const motifLengthBeats = Math.ceil((maxMotifOnset + 1) / beatsPerBar) * beatsPerBar;
            let currentBeat = secStart;
            
            const octaveOffset = Math.round(pitchOffset / 12) * 12;

            while (currentBeat + motifLengthBeats <= section.endBeat) {
                userMotif.forEach(n => {
                    const onset = currentBeat + n.onset;
                    const activeChord = chords.find(c => onset >= c.startBeat && onset < c.endBeat) || chords[0];
                    
                    let pitch = n.pitch + octaveOffset;
                    
                    // 🌟 优化方向 2：和声宽容度 (Dissonance Tolerance)
                    // 判断是否在强拍 (距离 0.5 拍的网格点很近，例如 0, 0.5, 1.0, 1.5...)
                    const beatOffset = onset % 0.5;
                    const isStrongBeat = beatOffset < 0.1 || beatOffset > 0.4;
                    
                    // Skip snapToScale to preserve the exact user motif
                    
                    sectionMelody.push({
                        ...n,
                        onset: onset,
                        pitch: pitch,
                        isUserMotif: true
                    });
                });
                currentBeat += motifLengthBeats;
            }
            // Use raw melody directly (no SingerPersona post-processing)
            const humanizedMelody = sectionMelody;
            
            let lastPitch = currentPreviousPitch;
            if (humanizedMelody.length > 0) {
                lastPitch = humanizedMelody[humanizedMelody.length - 1].pitch;
            }
            
            return { notes: humanizedMelody, motifs: new MotifMap(), lastPitch, unresolvedCount: 0 };
        }

        // ============================================================
        // 🌟 层级动机生成（Hierarchical Motif Generation）
        // ============================================================
        // 取代原本的"phrase = 2 小节 + 概率轮询"扁平模型，
        // 现在按 PhraseGroup（4/8/16 小节大乐句）→ SubMotifSlot（1-2 小节子动机）两层迭代。
        const isActualSoloSection = section.sectionType === SectionType.Solo_Bridge;
        const moodId = GlobalContext.currentMoodId || MoodId.Neutral;
        const mood = MoodRegistry[moodId] || MoodRegistry[MoodId.Neutral];

        // 🌟 PhraseGroupPlanner 决定大乐句骨架
        // 🌟 PR #6: 如果有外部注入的 layout（Chorus_1 → Chorus_Main 克隆），直接复用，
        // 跳过 PhraseGroupPlanner.planSection 的 PRNG 随机 layout 选择，消除根因 1。
        const phraseGroups = providedPhraseGroups ?? PhraseGroupPlanner.planSection(section, beatsPerBar, style);

        // 计算总 slot 数，用于 Outro fade 进度
        let totalSlotsAcrossGroups = 0;
        for (let g = 0; g < phraseGroups.length; g++) {
            totalSlotsAcrossGroups += phraseGroups[g].subMotifs.length;
        }
        if (totalSlotsAcrossGroups === 0) totalSlotsAcrossGroups = 1;

        // 🌟 P6a: 构建 anchor 骨架（per group），realizeMotif 接住作 Bresenham 插值
        // motifs-only 模式（generateMotifsOnly=true）跳过：此时不生成实际音符
        // 无 tensionEnv 时也跳过（如 hardStop / userMotif 路径）
        let sectionSkeleton: SectionSkeleton | undefined = undefined;
        if (!generateMotifsOnly && tensionEnv) {
            // 取乐器 safeRange（绝对空间）作为 anchor 范围参考
            const skInstId = getInstrumentIdByName(instrumentName);
            const skProfile = InstrumentProfiles[skInstId];
            const skRangeMin = skProfile?.safeRange?.[0] ?? 48;
            const skRangeMax = skProfile?.safeRange?.[1] ?? 84;
            // 主旋律 Plucked 上限按 F4 规则降到 79
            const skMaxAdjusted = (skProfile?.envelope === AcousticEnvelope.Plucked && !isVocal)
                ? Math.min(skRangeMax, 79) : skRangeMax;
            // 扣 keyOffset 进入相对空间
            const skKeyOffset = GlobalContext.currentKeyOffset || 0;
            const relRange: [number, number] = [skRangeMin - skKeyOffset, skMaxAdjusted - skKeyOffset];

            // 🌟 F-APR1: Persona 偏好（从 style 读 extensionTargeting / pentatonicShiftProbability 推断）
            const persExt = (style.melody?.extensionTargeting === true)
                || ((style.melody?.pentatonicShiftProbability ?? 0) > 0.2);
            sectionSkeleton = AnchorBackbone.buildForSection(
                section,
                phraseGroups,
                chords,
                tonality,
                tensionEnv,
                incomingPreviousPitch,
                60 + (style.contrast.versePitchOffset || 0),
                relRange,
                persExt,
            );
        }

        const motifs = new MotifMap();
        if (providedMotifs) {
            providedMotifs.forEach((val, key) => motifs.set(key, val));
        }

        let consecutiveUnresolved = incomingUnresolvedCount;
        let currentLabelCode = 65; // 'A' — 仅 Solo 段落使用，每 slot 一个新动机
        const generatedForm: string[] = [];

        // 🌟 Schenkerian Macro-Targets
        let macroTargetDegree: number | undefined;
        if (secType === SectionType.Chorus) {
            macroTargetDegree = PRNGManager.next() > 0.5 ? 1 : 3;
        } else if (secType === SectionType.Verse) {
            macroTargetDegree = PRNGManager.next() > 0.5 ? 5 : 3;
        } else if (secType === SectionType.PreChorus) {
            macroTargetDegree = PRNGManager.next() > 0.5 ? 5 : 2;
        }

        let globalSlotIdx = 0;

        for (let groupIdx = 0; groupIdx < phraseGroups.length; groupIdx++) {
            const group = phraseGroups[groupIdx];
            const slotCount = group.subMotifs.length;
            const isLastGroup = groupIdx === phraseGroups.length - 1;
            let slotOffsetBeats = 0;

            // 🌟 F-Groove1: 每个 PhraseGroup 用变体律动（在 sectionGroove 基础上 1-2 step 扰动）
            // 第一个 group 不扰动（保留段落锚点感），后续 group 引入节奏变化
            const variedSectionGroove = GrooveEngine.varyGrooveForPhrase(sectionGroove, beatsPerBar, groupIdx);
            const variedMelodyGroove = GrooveEngine.generateInverseGroove(variedSectionGroove, beatsPerBar, sectionDensity);

            for (let slotIdx = 0; slotIdx < slotCount; slotIdx++) {
                const slot = group.subMotifs[slotIdx];
                const slotLengthBeats = slot.lengthBars * beatsPerBar;
                const isLastSlotOfGroup = slotIdx === slotCount - 1;
                const isLastSlotOfSection = isLastGroup && isLastSlotOfGroup;

                // ─── motif 存储 key（baseLabel）─────────────
                // Solo 段落：每个 slot 都是新动机（保留 wandering 行为）
                // 非 Solo：使用 slot.label 的根部分（'M_prime' → 'M'）
                let baseLabel: string;
                if (isActualSoloSection) {
                    baseLabel = String.fromCharCode(currentLabelCode++);
                } else {
                    baseLabel = slot.label.split('_')[0];
                }
                generatedForm.push(slot.label);

                // ─── 答句判定（M-5 句式架构）──────────────
                // 1. resolve 角色 → 强制答句
                // 2. group 末尾且 closed cadence → 答句（句号）
                // 3. 段落末尾 slot → 强制答句
                // 4. 连续 2 句未解决 → 安全网强制答句
                const isResolveRole = slot.role === 'resolve';
                let isAnswer =
                    isResolveRole ||
                    (isLastSlotOfGroup && group.cadenceType === CadenceType.Closed) ||
                    isLastSlotOfSection;

                let forceStrongResolution = false;
                if (!isAnswer && consecutiveUnresolved >= 2) {
                    isAnswer = true;
                    forceStrongResolution = true;
                }
                if (isAnswer) consecutiveUnresolved = 0;
                else consecutiveUnresolved++;

                // ─── 变奏标志（来自 slot.role）───────────────
                // statement / repeat / contrast：原型，不变奏
                // vary / resolve：随机选一个 transform tag
                //
                // 🌟 PR #6: 如果当前 baseLabel 已经在 providedMotifs 里（克隆模式），
                // 跳过 transform 随机 —— 保持和第一次实例的 motif 完全一致。
                //
                // 🌟 PR #7: 克隆模式豁免 `_seq`（音程模进）
                // Blinding Lights 式的 "I've been tryna call" → "I've been on my own"
                // 就是相同节奏型向下三度平移，这是流行金曲"洗脑密码"的核心之一。
                // 克隆模式下允许 `_seq`（仅音程偏移，节奏 100% 保持），禁用其他 transform。
                // 这让"重复感"和"发展感"共存，而不是 100% 机械复印。
                const isClonedMotif = providedMotifs !== undefined && providedMotifs.has(baseLabel);

                let isInv = false, isRet = false, isAug = false, isSwitcheroo = false;
                let isSplit = false, isMerge = false, isShift = false, isSeq = false;
                if (slot.role === 'vary' || slot.role === 'resolve') {
                    // 🌟 sequenceFreezeRhythm: 冻结节奏DNA，只允许音程模进
                    const freezeRhythm = style?.melody?.sequenceFreezeRhythm ?? false;
                    let variations: string[];
                    if (isClonedMotif) {
                        // 🌟 PR #7: 克隆模式只允许 _prime (原型) 和 _seq (音程模进)
                        // _seq 仅修改 pitchShift (line 1150)，不改 template，节奏完全保留
                        variations = ['_prime', '_seq', '_prime', '_seq'];
                    } else if (freezeRhythm) {
                        variations = ['_prime', '_seq', '_prime', '_seq'];
                    } else {
                        variations = ['_prime', '_seq', '_inv', '_switch', '_split', '_merge', '_shift'];
                    }
                    const pick = variations[Math.floor(PRNGManager.next() * variations.length)];
                    if (pick === '_seq') isSeq = true;
                    else if (pick === '_inv') isInv = true;
                    else if (pick === '_switch') isSwitcheroo = true;
                    else if (pick === '_split') isSplit = true;
                    else if (pick === '_merge') isMerge = true;
                    else if (pick === '_shift') isShift = true;
                    // _prime 走默认路径（保留原 motif）
                }

                // ─── Hook 主动架构标志（M-6）─────────────────
                const isPeakSlot = !!(group.hookPlan && slot.isPeak);

                // ─── 创建 motif（若 baseLabel 首次出现）─────
                if (!motifs.has(baseLabel)) {
                    // 🌟 段落感知的密度乘数：Solo 需要华丽跑动，Chorus 需要能量爆发
                    const isChorus = secType === SectionType.Chorus;
                    let densityMultiplier = 1.0;
                    if (isSolo) {
                        densityMultiplier = 3.0;    // Solo：快速跑动，远高于主歌
                    } else if (isChorus) {
                        densityMultiplier = 1.5;    // Chorus：比主歌更密集，推动力
                    } else if (isInstrumental && isLead) {
                        densityMultiplier = 1.2;
                    }
                    const avgNotesPerBeat = densityMultiplier * sectionDensity * instrumentDensityMult;
                    let minNotes = Math.max(isOutro ? 1 : 3, Math.floor(slotLengthBeats * avgNotesPerBeat * 0.6));
                    let maxNotes = Math.max(minNotes + 1, Math.floor(slotLengthBeats * avgNotesPerBeat * 1.5));

                    // 🌟 Solo/Chorus 最小音符地板：防止旋律过于稀疏
                    if (isSolo) {
                        minNotes = Math.max(minNotes, Math.floor(slotLengthBeats * 1.5)); // ≥1.5 notes/beat
                        maxNotes = Math.max(maxNotes, Math.floor(slotLengthBeats * 3.5)); // ≤3.5 notes/beat
                    } else if (isChorus) {
                        minNotes = Math.max(minNotes, Math.floor(slotLengthBeats * 0.8)); // Chorus 不能太空
                    }

                    if (isIntro) {
                        minNotes = Math.max(3, Math.floor(minNotes * 0.8));
                        maxNotes = Math.max(minNotes + 1, Math.floor(maxNotes * 0.8));
                    }

                    const noteCount = Math.floor(PRNGManager.next() * (maxNotes - minNotes + 1)) + minNotes;

                    let contours: Contour[] = ['Ascending', 'Descending', 'Arch', 'Bowl', 'Static', 'Wandering'];
                    if (isOutro) {
                        const isHopeful = PRNGManager.next() > 0.5;
                        contours = isHopeful ? ['Ascending', 'Arch'] : ['Descending', 'Bowl', 'Static'];
                    }
                    // 🌟 Hook 主动架构：peak slot 必须用 Arch（中间出现高音）
                    if (isPeakSlot) {
                        contours = ['Arch'];
                    }

                    const contour = contours[Math.floor(PRNGManager.next() * contours.length)];

                    let rhythm3D = this.generateMotifRhythm(
                        variedMelodyGroove, noteCount, slotLengthBeats, sectionDensity,  // 🌟 F-Groove1: 用变体律动
                        (isIntro || isOutro) && globalSlotIdx === 0, !isSolo && !isLead, style, context
                    );
                    let rhythmOffsets = [...rhythm3D.pickup, ...rhythm3D.body, ...rhythm3D.tail];

                    // 用户 motif 节奏覆盖：仅在生成第一个 motif 时（即整段第一个 slot）
                    if (userMotif && (motifUsage === 'RhythmOnly' || motifUsage === 'BrokenDown') && motifs.size === 0) {
                        let motifRhythm = userMotif.map(n => n.onset);
                        if (motifUsage === 'BrokenDown') {
                            const halfLength = Math.ceil(motifRhythm.length / 2);
                            motifRhythm = motifRhythm.slice(0, halfLength);
                        }
                        motifRhythm = motifRhythm.filter(onset => onset < slotLengthBeats);
                        if (motifRhythm.length > 0) {
                            rhythmOffsets = motifRhythm;
                        }
                    }

                    // 🌟 预计算相对音高序列：确保同一 motif 多次实现时音高轮廓一致
                    // max ~30 notes for a 4-bar phrase at high density
                    const rpRange = isVocal ? 12 : (isSolo ? 19 : (isLead ? 14 : 12));
                    const relativePitches: number[] = [];
                    for (let ri = 0; ri < rhythmOffsets.length; ri++) {
                        const rp = rhythmOffsets.length > 1 ? ri / (rhythmOffsets.length - 1) : 0;
                        let rpVal = 0;
                        switch (contour) {
                            case 'Ascending': rpVal = -rpRange / 2 + rp * rpRange; break;
                            case 'Descending': rpVal = rpRange / 2 - rp * rpRange; break;
                            case 'Arch': rpVal = -rpRange / 2 + Math.sin(rp * Math.PI) * rpRange; break;
                            case 'Bowl': rpVal = rpRange / 2 - Math.sin(rp * Math.PI) * rpRange; break;
                            case 'Static': rpVal = 0; break;
                            case 'Wandering': rpVal = PRNGManager.next() * rpRange - rpRange / 2; break;
                        }
                        relativePitches.push(rpVal);
                    }

                    motifs.set(baseLabel, {
                        rhythm: rhythm3D,
                        rhythmOffsets,
                        relativePitches,
                        contour,
                        noteCount: rhythmOffsets.length,
                        phraseLengthBeats: slotLengthBeats,
                        isMutated: false,
                        pickupShape: rhythm3D.pickupShape,
                    });
                }

                if (generateMotifsOnly) {
                    slotOffsetBeats += slotLengthBeats;
                    globalSlotIdx++;
                    continue;
                }

                let template = motifs.get(baseLabel)!;

                // 🌟 应用 motif 变换
                if (isInv || isRet || isAug || isSwitcheroo || isSplit || isMerge || isShift) {
                    template = this.transformMotif(template, { isInv, isRet, isAug, isSwitcheroo, isSplit, isMerge, isShift });
                }

                // 🌟 Call/Response Contour 调整
                let currentContour = template.contour;
                if (isAnswer && !isInv && !isRet) {
                    // 解决 (Response)：倾向下行或平稳解决
                    if (currentContour === 'Ascending') currentContour = 'Arch';
                    else if (currentContour === 'Arch') currentContour = 'Descending';
                    else if (currentContour === 'Wandering') currentContour = 'Descending';
                    template = { ...template, contour: currentContour };
                } else if (!isAnswer && !isInv && !isRet) {
                    // 提出 (Call)：倾向上扬或悬念
                    if (currentContour === 'Descending') currentContour = 'Bowl';
                    else if (currentContour === 'Static') currentContour = 'Ascending';
                    else if (currentContour === 'Bowl') currentContour = 'Ascending';
                    template = { ...template, contour: currentContour };
                }

                // 🌟 Hook 主动架构：peak slot 强制 Arch（覆盖 call/response 调整）
                if (isPeakSlot) {
                    template = { ...template, contour: 'Arch' };
                }

                // ─── 计算 phrase 起点 ──────────────────────
                const phraseStart = group.startBeat + slotOffsetBeats;

                // ─── 音高偏移 ────────────────────────────
                let currentPitchShift = pitchOffset;
                if (isSeq) {
                    const shiftOptions = [2, 4, 5, 7, -2, -4, -5, -7];
                    currentPitchShift += shiftOptions[Math.floor(PRNGManager.next() * shiftOptions.length)];
                }
                // 🌟 Hook 主动架构：peak slot 提升 5 半音让 Arch 顶点更高
                if (isPeakSlot) {
                    currentPitchShift += 5;
                }

                // 🌟 M-5 句式架构：PhraseGroup 末尾 slot 使用专属 cadence 度数，覆盖段落级 macroTarget
                // - closed cadence (group 末尾) → 落在 1 度（主音，"句号"）或 3 度（中音，更柔）
                // - open cadence (group 末尾)   → 落在 5 度（属音，"逗号"，问句感）或 2 度（上主音，悬念）
                // - 中间 slot → 沿用段落级 macroTargetDegree（已在前面设置）
                let slotMacroTargetDegree = macroTargetDegree;
                if (isLastSlotOfGroup) {
                    if (group.cadenceType === CadenceType.Closed) {
                        // 闭合：1 度或 3 度，主音解决感
                        slotMacroTargetDegree = PRNGManager.next() < 0.7 ? 1 : 3;
                    } else {
                        // 开放：5 度或 2 度，属音/上主音的"未完成"感
                        slotMacroTargetDegree = PRNGManager.next() < 0.7 ? 5 : 2;
                    }
                }

                const isLastSlotOfIntro = isIntro && isLastSlotOfSection;
                // 🌟 isClimax 扩展：除 Chorus hookPlan 外，Solo 段落的黄金分割位置也触发高潮
                const soloClimaxSlot = isSolo && totalSlotsAcrossGroups > 2
                    && globalSlotIdx === Math.floor(totalSlotsAcrossGroups * 0.618);
                const isClimaxSlot = isPeakSlot || soloClimaxSlot;
                const phraseResult = this.realizeMotif(
                    template, phraseStart, chords, tonality, isAnswer, currentPitchShift,
                    isSolo, isInstrumental, isLead, instrumentName, isLastSlotOfIntro, section.name, style,
                    currentPreviousPitch, forceStrongResolution, isClimaxSlot, maxPitchBeforeChorus, false, slotMacroTargetDegree,
                    isClonedMotif,  // 🌟 PR #6: 克隆锁，传入 realizeMotif 内部关闭随机源
                    sectionSkeleton ? sectionSkeleton[groupIdx] : undefined,  // 🌟 P6a: anchor 骨架
                    tensionEnv,                                                  // 🌟 P6b: 张力封套
                    group.lengthBeats,                                          // 🌟 P6: phrase 总长度
                );

                currentPreviousPitch = phraseResult.lastPitch;
                const phraseNotes = phraseResult.notes;

                // 🌟 F-APR2: phrase 末位（isLastSlotOfGroup && isAnswer）按 PRNG 选 3 种 resolution 形态
                if (isLastSlotOfGroup && isAnswer && phraseNotes.length >= 2 && !isOutro && !isClonedMotif) {
                    const resolveRoll = PRNGManager.next();
                    const lastNote = phraseNotes[phraseNotes.length - 1];
                    if (resolveRoll < 0.5) {
                        // A 长音延留（50%）：末音延长 1.6 倍（最常见）
                        lastNote.duration = Math.min(lastNote.duration * 1.6, group.lengthBeats - (lastNote.onset - group.startBeat));
                    } else if (resolveRoll < 0.8) {
                        // B 级进回落（30%）：末音前插入 3 个调内下行级进音（4-3-2-1 感）
                        const lastChord = chords.find(c => lastNote.onset >= c.startBeat && lastNote.onset < c.endBeat) || chords[chords.length - 1];
                        const lastSafeScale = HarmonyCore.getSafeScalePitches(lastChord, tonality);
                        const stepDur = 0.25;
                        const totalLeadIn = stepDur * 3;
                        if (lastNote.duration > totalLeadIn + 0.25) {
                            const originalDur = lastNote.duration;
                            const originalOnset = lastNote.onset;
                            // 限制 walkPitch 不超过当前音域上限（防止 shiftDiatonic 推高超出 79/84 范围）
                            // 用 +1 度起步而非 +3 度，避免越界刺耳
                            const walkStartShift = 1;
                            let walkPitch = HarmonyCore.shiftDiatonic(lastNote.pitch, lastSafeScale, walkStartShift);
                            // 安全 clamp：不超过 lastNote.pitch + 4 半音（pure 3rd 上限）
                            if (walkPitch - lastNote.pitch > 4) walkPitch = lastNote.pitch + 4;
                            lastNote.onset = originalOnset + totalLeadIn;
                            lastNote.duration = originalDur - totalLeadIn;
                            for (let s = 0; s < 3; s++) {
                                let stepPitch = HarmonyCore.shiftDiatonic(walkPitch, lastSafeScale, -s);
                                // 二次 clamp：每个级进音也不超过 lastNote.pitch + 4
                                if (stepPitch - lastNote.pitch > 4) stepPitch = lastNote.pitch + 4 - s;
                                phraseNotes.splice(phraseNotes.length - 1, 0, {
                                    pitch: Math.floor(stepPitch),
                                    onset: originalOnset + s * stepDur,
                                    duration: stepDur,
                                    velocity: lastNote.velocity * 0.7,
                                });
                            }
                        }
                    } else {
                        // C 休止断带（20%）：末音切短一半，后半留 rest（R&B 突切感）
                        lastNote.duration = Math.max(0.25, lastNote.duration * 0.5);
                    }
                }

                // 🌟 P0 AnchorDecisionStage 已挪到 MelodyEngine.generateFullSong 的 reviewed 之后（全局一次性）
                // 这样 anchor 能对齐最终 chord（含 reharmonize + GlobalReviewer Phase 1 修改）。
                // 这里仅保留 willBeAnchor 预判（line 1670+）供装饰音守卫使用。

                if (isOutro) {
                    const fadeOutFactor = 1.0 - (globalSlotIdx / totalSlotsAcrossGroups) * 0.6;
                    phraseNotes.forEach(n => { n.velocity *= fadeOutFactor; });
                }

                sectionMelody.push(...phraseNotes);

                slotOffsetBeats += slotLengthBeats;
                globalSlotIdx++;
            }
        }

        if (generateMotifsOnly) {
            // 🌟 PR #6: 把 phraseGroups 一起返回，Phase 2 保存给后续 Chorus 复用
            return { notes: [], motifs, lastPitch: null, unresolvedCount: consecutiveUnresolved, phraseGroups };
        }

        if (secType === SectionType.Chorus && sectionMelody.length > 0) {
            let maxPitch = -1;
            sectionMelody.forEach(n => {
                if (n.pitch > maxPitch) maxPitch = n.pitch;
            });

            const maxNotes = sectionMelody.filter(n => n.pitch === maxPitch);
            if (maxNotes.length > 1) {
                maxNotes.sort((a, b) => {
                    const aStrong = isOnDownbeat(a.onset) ? 1 : 0;
                    const bStrong = isOnDownbeat(b.onset) ? 1 : 0;
                    if (aStrong !== bStrong) return bStrong - aStrong;
                    return b.duration - a.duration;
                });

                const goldenNote = maxNotes[0];

                sectionMelody.forEach(n => {
                    if (n.pitch === maxPitch && n !== goldenNote) {
                        const activeChord = chords.find(c => n.onset >= c.startBeat && n.onset < c.endBeat) || chords[0];
                        const safeScalePcs = HarmonyCore.getSafeScalePitches(activeChord, tonality);
                        n.pitch = HarmonyCore.shiftDiatonic(n.pitch, safeScalePcs, -1);
                    }
                });

                goldenNote.velocity = Math.min(1.0, goldenNote.velocity * 1.2);
                goldenNote.duration = Math.max(goldenNote.duration, 1.0);
            }
        }

        // Use raw melody directly (no SingerPersona post-processing)
        return { notes: sectionMelody, motifs, lastPitch: currentPreviousPitch, unresolvedCount: consecutiveUnresolved };
    }


    // 🌟 核心升级 2 实现：基于分形理论 (Fractal Rhythm) 生成具体节奏点
    private static generateMotifRhythm(baseGroove: number[], targetNoteCount: number, phraseLengthBeats: number, sectionDensity: number, isIntroFirstPhrase: boolean = false, isVocal: boolean = false, style?: StyleConfig, context?: MusicContext): { pickup: number[], body: number[], tail: number[], pickupShape?: PickupShape } {
        const activeSection = GlobalContext.getActiveSection();
        const energyLevel = activeSection?.energyLevel || 5;

        let sparsityScore = 0;
        if (context?.ensemble) {
            sparsityScore =
                (context.ensemble.drumSound ? 0 : 0.5) +
                (context.ensemble.bassSound ? 0 : 0.5);
        }
        const finalDensity = sectionDensity * (1.0 - 0.5 * sparsityScore);
        const syncopation = energyLevel >= ENERGY.HIGH_MIN ? 0.4 : 0.2;

        // 🌟 A2: RhythmCells 激活 — 30% 概率用风格化 RhythmCells 替代分形细分
        // subgenre 选 cellPool（Funk/Jazz/Bossa/RnB），让旋律节奏有风格特征
        const subgenreForCells = GlobalContext.getActiveSection()?.subgenre || 'Pop';
        const useCellPool = PRNGManager.next() < 0.3;
        if (useCellPool) {
            let cellPool = PopRhythmCells;
            if (subgenreForCells === 'Funk') cellPool = FunkRhythmCells;
            else if (subgenreForCells === 'Lo-fi') cellPool = JazzRhythmCells;
            else if (subgenreForCells === 'Latin') cellPool = BossaNovaRhythmCells;

            // 用 cell pool 铺满 body
            const cellBody: number[] = [0];
            let cellOffset = 0;
            let safetyCounter = 0;
            while (cellOffset < phraseLengthBeats - 0.25 && safetyCounter < 64) {
                const cell = getRandomRhythmCell(cellPool, energyLevel, isVocal);
                for (let ci = 0; ci < cell.length; ci++) {
                    cellOffset += cell[ci];
                    if (cellOffset < phraseLengthBeats - 1e-6) {
                        cellBody.push(cellOffset);
                    }
                }
                safetyCounter++;
            }
            return { pickup: [], body: cellBody, tail: [] };
        }

        // 1. 分形细分 (Fractal Subdivision)
        // 🌟 PR #4 修订：恢复 16 分音符密度 + 加三连音 + 安全检查
        //
        // PR#3 用 `> MIN * 2` 阈值矫枉过正，把所有 16 分音符（0.25）赶尽杀绝 →
        // 主旋律变成"低密度伴奏"。本版恢复 `> MIN` 阈值，但加"细分前安全检查"：
        // 候选子音必须全部 ≥ MIN 才接受，否则跳过该次细分。这样既杜绝 0.11/0.15
        // 短音，又允许 0.5 拍正常细分到 0.25 + 0.25。
        //
        // 同时新增三连音分支（8 分三连音：1/3 + 1/3 + 1/3 of noteLen），
        // 解决 PR#3 后"节奏太方正"的问题。
        const MIN_NOTE_LENGTH = 0.25;
        const TRIPLET_MIN = 0.25 * 3; // 三连音需要至少 0.75 拍才能切到 0.25 三个
        let currentGrid = [phraseLengthBeats];
        const maxDepth = Math.max(1, Math.floor(Math.log2(phraseLengthBeats / MIN_NOTE_LENGTH)));

        for (let depth = 0; depth < maxDepth; depth++) {
            let nextGrid: number[] = [];
            for (let i = 0; i < currentGrid.length; i++) {
                let noteLen = currentGrid[i];

                // 🌟 PR #4: > MIN_NOTE_LENGTH（即 > 0.25）允许细分，下方做安全检查
                if (noteLen > MIN_NOTE_LENGTH + 1e-6 && PRNGManager.next() < finalDensity) {
                    const rand = PRNGManager.next();
                    let candidate: number[];

                    if (noteLen >= TRIPLET_MIN && rand < syncopation * 0.3) {
                        // 🌟 PR #4 新增：三连音分支 (1/3 + 1/3 + 1/3) — 触发 R&B/Soul 律动
                        const triplet = noteLen / 3.0;
                        candidate = [triplet, triplet, triplet];
                    } else if (noteLen >= 1.0 && rand < syncopation * 0.5 + 0.3) {
                        // 附点 (Dotted: 3/4 + 1/4)
                        candidate = [noteLen * 0.75, noteLen * 0.25];
                    } else if (noteLen >= 1.0 && rand < syncopation + 0.3) {
                        // 反向附点 (Reverse Dotted: 1/4 + 3/4)
                        candidate = [noteLen * 0.25, noteLen * 0.75];
                    } else if (noteLen >= 1.0 && rand < syncopation + 0.4) {
                        // 切分 (Syncopated: 1/4 + 1/2 + 1/4)
                        candidate = [noteLen * 0.25, noteLen * 0.5, noteLen * 0.25];
                    } else {
                        // 均匀 (Even: 1/2 + 1/2)
                        candidate = [noteLen / 2.0, noteLen / 2.0];
                    }

                    // 🌟 PR #4: 安全检查 —— 候选子音必须全部 ≥ MIN_NOTE_LENGTH
                    // 例如 noteLen=0.5 走附点会产生 0.375+0.125，0.125 < 0.25，整体不接受
                    if (candidate.every(c => c >= MIN_NOTE_LENGTH - 1e-6)) {
                        for (const c of candidate) nextGrid.push(c);
                    } else {
                        nextGrid.push(noteLen); // 不安全细分，保持原样
                    }
                } else {
                    nextGrid.push(noteLen);
                }
            }
            currentGrid = nextGrid;
        }

        // 兜底过滤：理论上不会触发（安全检查已挡住），保留作为防御
        currentGrid = currentGrid.filter(d => d >= MIN_NOTE_LENGTH - 1e-6);
        
        // 2. 节奏合并 (Rhythmic Merging / Tie) 制造切分
        let finalSeed: number[] = [];
        for (let i = 0; i < currentGrid.length; i++) {
            if (i < currentGrid.length - 1 && PRNGManager.next() < syncopation * 0.8) {
                finalSeed.push(currentGrid[i] + currentGrid[i+1]);
                i++; // 跳过下一个音符
            } else {
                finalSeed.push(currentGrid[i]);
            }
        }
        
        // 3. 呼吸空间 (Breathing Room)
        // 根据风格配置决定是否强制休止
        const breathingProb = context?.style?.melody?.breathingRoomProbability ?? 0.2;
        const breathingRoom = PRNGManager.next() < breathingProb ? (energyLevel >= ENERGY.HIGH_MIN ? 0.5 : 1.0) : 0;
        const maxBeats = Math.max(1.0, phraseLengthBeats - breathingRoom);
        
        // 4. 映射到时间轴 (Onset Mapping)
        let interference: number[] = [];
        let currentOnset = 0;
        for (let dur of finalSeed) {
            if (currentOnset < maxBeats) {
                interference.push(currentOnset);
            }
            currentOnset += dur;
        }

        // ─── 5. 真正的弱起 (Anacrusis) 生成 ──────────────────────
        // 弱起 = phrase 开始**之前**的 1-4 个音，onset 为**负值**
        // 区别于旧版"把 body 第一拍标记为 pickup"的伪弱起
        const pickup: number[] = [];
        let pickupShape: PickupShape = 'ascending';

        const secType = activeSection?.sectionType;

        // 弱起概率：段落类型 + 能量驱动
        // PreChorus/BuildUp 过渡段高概率弱起（增加紧迫感）
        // Intro 首句绝对强起（开场宣言）
        // Outro 弱起少（渐消不抢拍）
        let pickupProb = 0.45;
        if (isIntroFirstPhrase) {
            pickupProb = 0;
        } else if (secType === SectionType.PreChorus || secType === SectionType.BuildUp) {
            pickupProb = 0.75;
        } else if (secType === SectionType.Chorus) {
            pickupProb = 0.5;
        } else if (secType === SectionType.Outro || secType === SectionType.PreOutro) {
            pickupProb = 0.3;
        } else if (energyLevel >= ENERGY.HIGH_MIN) {
            pickupProb = 0.6;
        }

        const hasPickup = PRNGManager.next() < pickupProb;

        if (hasPickup && interference.length > 2) {
            // 提前拍数：高能→短弱起（冲刺感），低能→长弱起（预备感）
            const anticipationPool = energyLevel >= ENERGY.HIGH_MIN
                ? [0.25, 0.25, 0.5, 0.5, 1.0]               // 高能：偏短
                : [0.5, 0.5, 1.0, 1.0, 1.5, 2.0];           // 低能：偏长
            const anticipation = anticipationPool[Math.floor(PRNGManager.next() * anticipationPool.length)];

            // 弱起音数：由提前拍数决定（≤0.25→1音，≤0.5→1~2音，≤1.0→1~3音，>1→1~4音）
            let maxNotes: number;
            if (anticipation <= 0.25) maxNotes = 1;
            else if (anticipation <= 0.5) maxNotes = 2;
            else if (anticipation <= 1.0) maxNotes = 3;
            else maxNotes = 4;

            const noteCount = 1 + Math.floor(PRNGManager.next() * Math.min(maxNotes, interference.length - 1));
            const stepDur = anticipation / noteCount;

            // 生成负 onset 序列（从远到近，逐步接近 phrase 起始点 beat 0）
            for (let n = 0; n < noteCount; n++) {
                pickup.push(-(anticipation - n * stepDur));
            }

            // 弱起轮廓
            if (noteCount <= 1) {
                pickupShape = 'held'; // 单音弱起：预备式
            } else {
                const shapeRoll = PRNGManager.next();
                if (shapeRoll < 0.45) pickupShape = 'ascending';        // 爬进强拍（do-re-mi↑）
                else if (shapeRoll < 0.70) pickupShape = 'descending';  // 落进强拍（sol-fa-mi↓）
                else if (shapeRoll < 0.85) pickupShape = 'zigzag';      // 折线（do-mi-re↑）
                else pickupShape = 'held';                              // 同音反复预备
            }
        } else {
            // 无弱起时消耗等量 PRNG 保持序列稳定
            PRNGManager.next(); // anticipation slot
            PRNGManager.next(); // noteCount slot
            PRNGManager.next(); // shape slot
        }

        // ─── 6. Body & Tail 拆分 ──────────────────────────────
        // body = interference 全部 onset(≥0) 音符；tail = 概率取最后一个单独标记
        const body: number[] = [];
        const tail: number[] = [];

        let bodyEndIdx = interference.length - 1;
        if (interference.length > 1 && PRNGManager.next() > 0.3) {
            tail.push(interference[interference.length - 1]);
            bodyEndIdx = interference.length - 2;
        }

        for (let i = 0; i <= bodyEndIdx; i++) {
            body.push(interference[i]);
        }

        // 首句处理：确保强拍进入（不加弱起，body 第一拍 ≥ 1.0）
        if (isIntroFirstPhrase) {
            if (body.length > 0 && body[0] < 1.0) {
                body.shift();
            }
            if (body.length === 0) body.push(1.0); // 兜底
        }

        return { pickup, body, tail, pickupShape };
    }

    // 🌟 核心升级 4 & 5 实现：结合和弦、线型、起承转合生成音高
    private static realizeMotif(
        template: MotifTemplate, phraseStart: number, chords: GeneratedChord[],
        tonality: Tonality, isAnswer: boolean, pitchShift: number, isSolo: boolean, isInstrumental: boolean, isLead: boolean, instrumentName: string, isLastPhraseOfIntro: boolean = false, sectionName: string = '', style?: StyleConfig,
        incomingPreviousPitch: number | null = null,
        forceStrongResolution: boolean = false,
        isClimax: boolean = false,
        maxPitchBeforeChorus: number = 0,
        isUserMotif: boolean = false,
        macroTargetDegree?: number,
        isClonedMotif: boolean = false,  // 🌟 PR #6: 克隆锁，true 时关闭 anticipation / restChance 等随机源
        phraseSkeleton?: PhraseSkeleton,  // 🌟 P6a: 当前 phrase 的 anchor 骨架
        tensionEnv?: TensionEnvelope,     // 🌟 P6b: 张力封套（用于 velocity/timing 调制）
        phraseLengthBeats: number = 4,    // 🌟 P6: phrase 总长度（用于 phraseLevel 张力计算）
    ): { notes: NoteData[], lastPitch: number | null } {
        const notes: NoteData[] = [];
        let targetCenter = 60 + pitchShift;

        // 🌟 Tessitura Catapult（音区弹射）：Chorus 整体音区动态提升
        // 根据 Chorus 前各段落的最高音，将 Chorus 基础中心音高拉高，制造爆发感
        if (sectionName.includes('Chorus') && maxPitchBeforeChorus > 0) {
            if (targetCenter < maxPitchBeforeChorus + 2) {
                targetCenter = maxPitchBeforeChorus + 2; // 至少比之前最高音高一个大二度
            }
            // 🌟 PR #5: catapultCap 用 instrument profile 查表，并预留 6 半音的"上方挥洒空间"
            // 旧版硬编码 84 对 Vibraphone 来说就是物理上限，导致旋律"贴着天花板跳不下来"
            // 新版让 targetCenter 至少比物理上限低 6 半音（一个三全音），保证后续选音能往上有余量
            const catCapInstId = getInstrumentIdByName(instrumentName);
            const catCapProfile = InstrumentProfiles[catCapInstId];
            const catCapProfileMax = catCapProfile?.safeRange?.[1] ?? 84;
            const catapultCap = isInstrumental ? Math.max(60, catCapProfileMax - 6) : 76;
            if (targetCenter > catapultCap) targetCenter = catapultCap;
        }

        const activeSection = GlobalContext.getActiveSection();
        // Default melody rules (no style grammar system)
        const melodyRules = {
            anticipationProbability: 0.15,
            pentatonicGapProbability: 0.3,
            tailResolution: true
        };
        let currentTension = 0;

        const { rhythmOffsets, contour, rhythm, anchors } = template;
        const pickupLen = rhythm?.pickup?.length || 0;
        const bodyLen = rhythm?.body?.length || rhythmOffsets.length;
        const tailLen = rhythm?.tail?.length || 0;
        
        // 记录上一个音高，用于迈尔跳进定律 (Meyer's Leap Rule)
        let previousPitch: number | null = incomingPreviousPitch;
        
        let consecutiveNotes = 0;
        let consecutiveDuration = 0;

        // 🌟 Rhythmic Displacement & Anticipation (The "4-AND" Rule)
        // 🌟 PR #6: 克隆模式下完全跳过 anticipation —— 保证节奏型与第一次实例 byte-for-byte 一致
        // 这是"根因 2: Anticipation 破坏节奏"的修复
        let adjustedOffsets = [...rhythmOffsets];
        if (!isClonedMotif) {
            for (let i = 0; i < adjustedOffsets.length; i++) {
                if (PRNGManager.next() < melodyRules.anticipationProbability) {
                    // Anticipate by an 8th note (0.5 beats) or 16th note (0.25 beats)
                    const anticipationAmount = PRNGManager.next() > 0.5 ? 0.5 : 0.25;
                    const newOnset = adjustedOffsets[i] - anticipationAmount;
                    // Ensure it doesn't overlap with the previous note
                    if (i === 0 || newOnset > adjustedOffsets[i - 1]) {
                        adjustedOffsets[i] = newOnset;
                    }
                }
            }
        }
        
        for (let i = 0; i < adjustedOffsets.length; i++) {
            const onset = phraseStart + adjustedOffsets[i];

            // 🌟 安全防护：弱起音的 onset 可能为负（phrase 前），
            // 如果绝对时间 < 0（歌曲开始之前），跳过该音
            if (onset < -1e-6) continue;

            let duration = i < adjustedOffsets.length - 1 ? (adjustedOffsets[i+1] - adjustedOffsets[i]) : (isAnswer ? 2.0 : 1.0);

            // 🌟 智能呼吸感 (Intelligent Breathing & Phrasing) - Rule 3
            const isPhraseEnd = i === adjustedOffsets.length - 1;

            // 强制插入"呼吸窗口"（Rest Window）
            // 🌟 PR #6: 克隆模式下 restChance 全部置 0 —— 保证音符数与第一次实例一致
            // 这是"根因 4: RestChance 随机吃音"的修复
            let restChance = isClonedMotif ? 0 : (isSolo ? 0.02 : (!isInstrumental ? 0.08 : 0.05));

            if (!isClonedMotif && (consecutiveDuration > 6.0 || consecutiveNotes > 8)) {
                restChance = 0.90; // 90% 概率休止
            }

            if (isPhraseEnd) {
                if (isClonedMotif) {
                    // 克隆模式：不休止，保持音符数不变
                    restChance = 0;
                } else if (duration < 1.0) {
                    restChance = 0.5; // 50% 概率休止（原 100%）
                } else {
                    restChance = isSolo ? 0.05 : (!isInstrumental ? 0.15 : 0.10);
                }
                if (!isLastPhraseOfIntro && PRNGManager.next() < restChance) {
                    consecutiveNotes = 0;
                    consecutiveDuration = 0;
                    continue;
                }
            } else if (PRNGManager.next() < restChance) {
                consecutiveNotes = 0;
                consecutiveDuration = 0;
                continue; // 概率吃掉这个音，变成休止符
            }

            consecutiveNotes++;
            consecutiveDuration += duration;

            // 🌟 修复点：强制节奏量化 (Rhythm Quantization)
            // 抛弃 0.85, 0.125 这种非标时值，强制对齐到白名单
            const validDurations = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 4.0];
            let closestDuration = validDurations[0];
            let minDiff = Math.abs(duration - validDurations[0]);
            for (const vd of validDurations) {
                const diff = Math.abs(duration - vd);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestDuration = vd;
                }
            }
            duration = closestDuration;

            // 偶尔制造断奏感，但必须是干净的网格
            if (duration >= 1.0 && PRNGManager.next() > 0.8) {
                duration -= 0.25; // 缩短一个十六分音符，留出干净的休止
            } else if (duration === 0.5 && PRNGManager.next() > 0.8) {
                duration = 0.25; // 八分音符变十六分音符
            }

            const activeChord = chords.find(c => onset >= c.startBeat && onset < c.endBeat) || chords[0];
            const chordTones = HarmonyCore.getChordTones(activeChord, targetCenter);
            let safeScalePcs = HarmonyCore.getSafeScalePitches(activeChord, tonality);

            // 🌟 和弦边界前瞻：检测是否临近和弦切换点（≤1 拍 / ≤0.5 拍）
            const nextChordIdx = chords.indexOf(activeChord) + 1;
            const nextChordLookahead = nextChordIdx < chords.length ? chords[nextChordIdx] : null;
            const nextNextChordLookahead = (nextChordIdx + 1) < chords.length ? chords[nextChordIdx + 1] : null;
            const beatsToChordEnd = activeChord.endBeat - onset;
            const isNearChordBoundary = nextChordLookahead !== null && beatsToChordEnd <= 1.0 && beatsToChordEnd > 1e-6;
            const isVeryNearChordBoundary = nextChordLookahead !== null && beatsToChordEnd <= 0.5 && beatsToChordEnd > 1e-6;
            const nextChordFunction = nextChordLookahead ? MusicTheoryRules.getChordFunction(nextChordLookahead.numeral) : null;

            // 🌟 法则四：五声音阶的”留白”艺术 (The Pentatonic Gap)
            // 强制跳过音阶中的 4 音和 7 音（大调），直接跳到下一个五声音阶内的音
            const pentatonicGapProb = melodyRules.pentatonicGapProbability ?? 0.3;
            if (PRNGManager.next() < pentatonicGapProb) {
                const isMajor = tonality === Tonality.Major || tonality === Tonality.Major_Pentatonic;
                // 🌟 修复：safeScalePcs 现在是相对空间（主音=0），不需要加 keyOffset
                const avoidPcs = isMajor ? [5, 11] : [2, 8]; // Major: 避开4音(F)和7音(B)；Minor: 避开2音和6音
                safeScalePcs = safeScalePcs.filter(pc => !avoidPcs.includes(pc));
            }

            // 🌟 Neo-Soul / Advanced: Pentatonic Shifts
            const pentatonicShiftProb = style?.melody?.pentatonicShiftProbability ?? 0;
            if (pentatonicShiftProb > 0 && PRNGManager.next() < pentatonicShiftProb) {
                if (activeChord.quality === 'Minor7' || activeChord.quality === 'Minor9') {
                    // Minor pentatonic built on the 5th
                    safeScalePcs = HarmonyCore.getScalePitches(Tonality.Minor_Pentatonic).map(p => (activeChord.root + 7 + p) % 12);
                } else if (activeChord.quality === 'Major7' || activeChord.quality === 'Add9') {
                    // Major pentatonic built on the 5th
                    safeScalePcs = HarmonyCore.getScalePitches(Tonality.Major_Pentatonic).map(p => (activeChord.root + 7 + p) % 12);
                } else if (activeChord.quality === 'Dominant7') {
                    // Minor pentatonic built on b3 (Altered sound)
                    safeScalePcs = HarmonyCore.getScalePitches(Tonality.Minor_Pentatonic).map(p => (activeChord.root + 3 + p) % 12);
                }
            }

            // 🌟 Dynamic Melody Simplification: Give complex chords space
            // PR #3 修订：旧版"复杂和弦弱拍 30% 概率跳过"在 PR#2 后变成高频触发
            // （Viterbi 大量选 maj9/add9/sus4/m7），导致旋律高频出现"洞"。
            // 新版仅在"距离当前 chord 末尾 < 0.5 拍"（复用上面的 isVeryNearChordBoundary）的
            // 弱拍上触发，让 chord 尾音得到呼吸，而 chord 中段的弱拍照常发音。
            const isStrongBeat = isOnDownbeat(onset);
            const isLongNote = duration >= 1.0;
            const isComplexChord = ['Minor9', 'Add9', 'Dominant7Sus4', 'HalfDiminished', 'Major9', 'Major7', 'Minor7', 'Sus4'].includes(activeChord.quality);
            if (isComplexChord && isVeryNearChordBoundary && !isStrongBeat && !isLongNote && PRNGManager.next() < 0.25) {
                continue; // 仅在复杂和弦的尾部弱拍跳过，避免中段被掏空
            }

            // 🌟 P0 AnchorDecisionStage 预判：该音"将会被 annotate() 标为 anchor"吗？
            // 装饰音（grace/neighbor）守卫使用此预判 —— 只在关键音上挂装饰音（教程要求）。
            // 口径对齐 AnchorDecisionStage 的规则 1/2/5/6/7 + isClimax（局部极值规则 3 和大跳规则 4 无法预判，略）。
            // 🌟 P6a: 加入 phraseSkeleton anchor 命中判定，让装饰音优先挂前置 anchor
            let isPreBuiltAnchorPredict = false;
            if (phraseSkeleton) {
                for (let pk = 0; pk < phraseSkeleton.anchorOnsets.length; pk++) {
                    if (Math.abs(onset - phraseSkeleton.anchorOnsets[pk]) < 0.3) {
                        isPreBuiltAnchorPredict = true;
                        break;
                    }
                }
            }
            const willBeAnchor = isPreBuiltAnchorPredict || isStrongBeat || isLongNote || isPhraseEnd || isClimax || i === 0;

            const progress = adjustedOffsets.length > 1 ? i / (adjustedOffsets.length - 1) : 0; // 0.0 to 1.0

            // 🌟 计算目标线型音高 (Contour Target)
            let idealPitch = targetCenter;
            const isVocal = !isInstrumental;
            const range = isVocal ? 12 : (isSolo ? 19 : (isLead ? 14 : 12)); // 旋律起伏跨度

            const isPickup = i < pickupLen;
            const isBody = i >= pickupLen && i < pickupLen + bodyLen;
            const isTail = i >= pickupLen + bodyLen;

            if (isTail || i === adjustedOffsets.length - 1) {
                // Tail / phrase 末尾：macroTarget 解决
                // 先从 relativePitches 获取基础轮廓音高，再与 macroTarget 融合
                let contourIdeal = targetCenter;
                if (template.relativePitches && i < template.relativePitches.length) {
                    contourIdeal = targetCenter + template.relativePitches[i];
                }

                if (macroTargetDegree !== undefined) {
                    // 🌟 修复：在相对空间中计算（主音=0），与 getChordTones/getSafeScalePitches 一致
                    const rootPc = 0;
                    const scalePcs = HarmonyCore.getScalePitches(tonality);
                    const degreeIdx = (macroTargetDegree - 1) % scalePcs.length;
                    const targetPc = (rootPc + scalePcs[degreeIdx]) % 12;
                    // 找最接近 contourIdeal 的目标音级八度位置
                    let minDiff2 = 100;
                    let macroIdeal = contourIdeal;
                    for (let oct = -2; oct <= 2; oct++) {
                        const p = targetPc + (Math.floor(contourIdeal / 12) + oct) * 12;
                        const diff = Math.abs(p - contourIdeal);
                        if (diff < minDiff2) { minDiff2 = diff; macroIdeal = p; }
                    }
                    // 加权融合：70% macroTarget + 30% contour，平滑过渡而非粗暴跳转
                    idealPitch = macroIdeal * 0.7 + contourIdeal * 0.3;
                } else {
                    idealPitch = contourIdeal;
                }
            } else if (isPickup && template.pickupShape) {
                // 🌟 弱起音高引导：基于 pickupShape 决定 pickup 音符走向
                const pickupProgress = pickupLen > 1 ? i / (pickupLen - 1) : 0;
                const bodyApproxStart = targetCenter - range * 0.25;
                const pickupRange = 7;

                switch (template.pickupShape) {
                    case 'ascending':
                        idealPitch = bodyApproxStart - pickupRange * (1 - pickupProgress);
                        break;
                    case 'descending':
                        idealPitch = bodyApproxStart + pickupRange * (1 - pickupProgress);
                        break;
                    case 'held':
                        idealPitch = bodyApproxStart;
                        break;
                    case 'zigzag':
                        const zigAmp = pickupRange * (1 - pickupProgress * 0.6);
                        idealPitch = bodyApproxStart + (i % 2 === 0 ? -zigAmp : zigAmp * 0.6);
                        break;
                }
            } else if (isBody && i === pickupLen && anchors?.bodyStartPitch !== undefined) {
                idealPitch = anchors.bodyStartPitch;
            } else if (template.relativePitches && i < template.relativePitches.length) {
                // 🌟 优先使用预计算的 relativePitches：同一 motif 多次实现时形状严格一致
                idealPitch = targetCenter + template.relativePitches[i];
            } else {
                // Fallback：无 relativePitches 时按 contour 实时计算（兼容旧模板 / 变换后长度变化）
                const safeProgress = Math.max(0, Math.min(1, progress));
                switch (contour) {
                    case 'Ascending':
                        idealPitch = targetCenter - range / 2 + safeProgress * range;
                        break;
                    case 'Descending':
                        idealPitch = targetCenter + range / 2 - safeProgress * range;
                        break;
                    case 'Arch':
                        idealPitch = targetCenter - range / 2 + Math.sin(safeProgress * Math.PI) * range;
                        break;
                    case 'Bowl':
                        idealPitch = targetCenter + range / 2 - Math.sin(safeProgress * Math.PI) * range;
                        break;
                    case 'Static':
                        idealPitch = targetCenter;
                        break;
                    case 'Wandering':
                        idealPitch = targetCenter + (PRNGManager.next() * range - range / 2);
                        break;
                }
            }

            // 🌟 P6a Bresenham 覆盖（保持 PRNG 序列不变，只覆盖 body 段的 idealPitch 值）
            // 设计理由：原 contour 计算保留所有 PRNG 消耗（如 Wandering 分支），
            // 这里在 body 段叠加"骨架引力"，让旋律有"目的地驱动"的全局意图。
            // pickup/tail 段保留原逻辑（pickup 有 pickupShape，tail 有 macroTarget 强解决）。
            if (phraseSkeleton && tensionEnv && isBody) {
                const skOnsets = phraseSkeleton.anchorOnsets;
                const skPitches = phraseSkeleton.anchorPitches;

                // 找当前 onset 所在 segment（线性扫描，max ~6 anchors）
                let beforeIdx = 0;
                let afterIdx = 1;
                for (let k = 0; k < skOnsets.length - 1; k++) {
                    if (onset >= skOnsets[k] - 1e-6 && onset < skOnsets[k + 1] - 1e-6) {
                        beforeIdx = k;
                        afterIdx = k + 1;
                        break;
                    }
                }
                // onset 在末 anchor 之后 → 用末两个 anchor 做外推
                if (onset >= skOnsets[skOnsets.length - 1] - 1e-6 && skOnsets.length >= 2) {
                    beforeIdx = skOnsets.length - 2;
                    afterIdx = skOnsets.length - 1;
                }

                const o0 = skOnsets[beforeIdx];
                const o1 = skOnsets[afterIdx];
                const p0 = skPitches[beforeIdx];
                const p1 = skPitches[afterIdx];
                let segT = (o1 - o0) > 1e-6 ? (onset - o0) / (o1 - o0) : 0;
                if (segT < 0) segT = 0;
                if (segT > 1) segT = 1;

                // Bresenham 线性插值（实质 lerp）
                const linearPitch = p0 + (p1 - p0) * segT;

                // 弧度叠加：按 contour 类型 + 张力调制幅度
                const tensionAt = tensionEnv.at(onset, phraseStart, phraseLengthBeats);
                let arcAmp = 0;
                if (contour === 'Arch') arcAmp = +5 * tensionAt;
                else if (contour === 'Bowl') arcAmp = -5 * tensionAt;
                else if (contour === 'Wandering') arcAmp = ((i % 3) - 1) * 2 * tensionAt;
                // Ascending / Descending / Static：anchor 渐进已表达走向，不叠弧度

                const bowedPitch = linearPitch + Math.sin(Math.PI * segT) * arcAmp;

                // 70% Bresenham + 30% 原 contour 融合（保留 motif 特征，让骨架不死板）
                idealPitch = bowedPitch * 0.7 + idealPitch * 0.3;
            }

            // 🌟 和声引力偏置 (Harmonic Gravity)
            // 靠近 Dominant → 微升（蓄力），靠近 Tonic → 微降（准备解决）
            const gravityStr = style?.melody?.harmonicGravityStrength ?? 0.3;
            if (gravityStr > 0 && nextChordFunction !== null && previousPitch !== null && !isPhraseEnd) {
                if (nextChordFunction === 'Dominant' && beatsToChordEnd <= 2.0) {
                    idealPitch += gravityStr * 2;
                } else if (nextChordFunction === 'Tonic' && beatsToChordEnd <= 2.0) {
                    idealPitch -= gravityStr * 2;
                }
            }

            // 🌟 锚定音高 (Pitch Anchoring) & 不和谐音控制
            let currentPitch = idealPitch;
            
            if (isAnswer && i >= adjustedOffsets.length - 2) {
                // 解决 (Resolution)：乐句结尾，趋向稳定
                if (i === adjustedOffsets.length - 1) {
                    // 🌟 "Forward-Looking" Melody Logic: 
                    // 如果当前和弦是紧张的经过和弦（如 vii°, V7/vi, sus4）且持续时间短，
                    // 旋律应该“穿透”它，直接解决到下一个稳定和弦的音上。
                    // 🌟 PR #4: 移除未使用的 targetChord 变量（TS 警告清理）
                    let targetChordTones = chordTones;

                    const isTensePassingChord = (
                        activeChord.numeral.includes('°') ||
                        activeChord.numeral.includes('dim') ||
                        activeChord.numeral.includes('aug') ||
                        activeChord.numeral.includes('/') ||
                        activeChord.numeral === 'VII7' ||
                        activeChord.numeral === 'III7' ||
                        activeChord.numeral.includes('sus')
                    ) && (activeChord.endBeat - activeChord.startBeat <= 2);

                    if (isTensePassingChord) {
                        const nextChord = chords.find(c => c.startBeat >= activeChord.endBeat);
                        if (nextChord) {
                            targetChordTones = HarmonyCore.getChordTones(nextChord, targetCenter);
                        }
                    }

                    let targetTones: number[] = [];
                    if (forceStrongResolution || melodyRules.tailResolution) {
                        // 🌟 强制强解决：回到和弦根音(1)或三音(3)
                        targetTones = [targetChordTones[0]]; 
                        if (targetChordTones[1] !== undefined) targetTones.push(targetChordTones[1]); // 三音
                    } else {
                        // 最后一个音：现代流行更倾向于解决到三音(3)或根音(1)，偶尔五音(5)
                        targetTones = [targetChordTones[0]]; // 根音
                        if (targetChordTones[1] !== undefined) targetTones.push(targetChordTones[1]); // 三音
                        if (targetChordTones[2] !== undefined) targetTones.push(targetChordTones[2]); // 五音
                        
                        // 只有在极少数情况（如爵士或 Neo-Soul）且容忍度高时，才允许七音作为半解决
                        const maxDissonance = style?.harmonyRules?.maxDissonanceTolerance ?? 0.6;
                        if (maxDissonance > 0.6 && targetChordTones.length > 3 && PRNGManager.next() > 0.8) {
                            targetTones.push(targetChordTones[3]); // 七音
                        }
                    }
                    
                    const selectedTarget = targetTones[Math.floor(PRNGManager.next() * targetTones.length)];
                    currentPitch = this.getNearestOctave(selectedTarget, idealPitch); 
                } else {
                    // 倒数第二个音：导音或经过音，引导向解决
                    currentPitch = safeScalePcs.reduce((prev, curr) => {
                        const prevDist = Math.abs(this.getNearestOctave(prev, idealPitch) - idealPitch);
                        const currDist = Math.abs(this.getNearestOctave(curr, idealPitch) - idealPitch);
                        return currDist < prevDist ? curr : prev;
                    });
                    currentPitch = this.getNearestOctave(currentPitch, idealPitch);
                }
            } else if (!isAnswer && i >= adjustedOffsets.length - 2) {
                // 提出 (Question)：乐句结尾，制造悬念
                if (i === adjustedOffsets.length - 1) {
                    // 最后一个音：停在五音、三音，或者音阶的 2/4/6/7 级（不稳定音）
                    // 现代流行喜欢悬浮感，多用 7音 或 9音(2级)
                    const unstableTones = [chordTones[1], chordTones[2], safeScalePcs[1], safeScalePcs[3], safeScalePcs[5], safeScalePcs[6]].filter(t => t !== undefined);
                    if (chordTones.length > 3) unstableTones.push(chordTones[3]); // 七音
                    const targetTone = unstableTones.length > 0 ? unstableTones[Math.floor(PRNGManager.next() * unstableTones.length)] : (chordTones[1] !== undefined ? chordTones[1] : chordTones[0]);
                    currentPitch = this.getNearestOctave(targetTone, idealPitch);
                    // 确保提出的音高有上扬的语感（Questioning inflection）
                    if (previousPitch !== null && currentPitch < previousPitch && PRNGManager.next() > 0.3) {
                        currentPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, 1);
                    }
                } else {
                    // 倒数第二个音：引导向上扬
                    currentPitch = safeScalePcs.reduce((prev, curr) => {
                        const prevDist = Math.abs(this.getNearestOctave(prev, idealPitch) - idealPitch);
                        const currDist = Math.abs(this.getNearestOctave(curr, idealPitch) - idealPitch);
                        return currDist < prevDist ? curr : prev;
                    });
                    currentPitch = this.getNearestOctave(currentPitch, idealPitch);
                }
            } else if (isStrongBeat || isLongNote) {
                // 强拍或长音：吸附到最近的和弦内音 (Chord Tones)
                // 现代流行偏爱三音和七音
                let preferredChordTones = [...chordTones];
                if (PRNGManager.next() > 0.3 && chordTones.length >= 2) {
                    preferredChordTones = [chordTones[1]];
                    if (chordTones.length > 3) preferredChordTones.push(chordTones[3]);
                    if (PRNGManager.next() > 0.5 && chordTones[2] !== undefined) preferredChordTones.push(chordTones[2]);
                }
                // 🌟 延伸音靶向 (Extension Targeting) — 由 StyleConfig 驱动
                const extPref = style?.melody?.extensionPreference ?? 0;
                const extTarget = style?.melody?.extensionTargeting ?? false;
                if (extPref > 0 || extTarget) {
                    const extRoll = PRNGManager.next();
                    if (extTarget && chordTones.length > 4) {
                        preferredChordTones = [chordTones[1], chordTones[3]];
                        preferredChordTones.push(chordTones[4]);
                    } else if (extPref > 0 && chordTones.length > 4 && extRoll < extPref) {
                        preferredChordTones.push(chordTones[4]);
                    }
                }
                currentPitch = preferredChordTones.reduce((prev, curr) => {
                    const prevDist = Math.abs(this.getNearestOctave(prev, idealPitch) - idealPitch);
                    const currDist = Math.abs(this.getNearestOctave(curr, idealPitch) - idealPitch);
                    return currDist < prevDist ? curr : prev;
                });
                currentPitch = this.getNearestOctave(currentPitch, idealPitch);

                // 🌟 和弦边界趋近音：临近切换时偏向共同音或最近的下一和弦音（移动 ≤5 半音）
                if (isNearChordBoundary && nextChordLookahead) {
                    const nextCT = HarmonyCore.getChordTones(nextChordLookahead, targetCenter);
                    const curPc = currentPitch % 12;
                    let alreadyCommon = false;
                    for (let nci = 0; nci < nextCT.length; nci++) {
                        if ((nextCT[nci] % 12) === curPc) { alreadyCommon = true; break; }
                    }
                    if (!alreadyCommon) {
                        // 优先：搜索当前和弦与下一和弦的共同音
                        let bestP = currentPitch, bestD = 999;
                        for (let nci = 0; nci < nextCT.length; nci++) {
                            for (let ci = 0; ci < chordTones.length; ci++) {
                                if ((nextCT[nci] % 12) === (chordTones[ci] % 12)) {
                                    const cand = this.getNearestOctave(chordTones[ci], idealPitch);
                                    const d = Math.abs(cand - currentPitch);
                                    if (d < bestD && d <= 5) { bestD = d; bestP = cand; }
                                }
                            }
                        }
                        // 🌟 Fallback：无共同音时（如 vi→bVII7），移向下一和弦中距离最近的音（≤4半音）
                        if (bestD >= 999) {
                            for (let nci = 0; nci < nextCT.length; nci++) {
                                const cand = this.getNearestOctave(nextCT[nci] % 12, currentPitch);
                                const d = Math.abs(cand - currentPitch);
                                if (d < bestD && d <= 4) { bestD = d; bestP = cand; }
                            }
                        }
                        if (bestD < 999) currentPitch = bestP;
                    }
                }

                // 🌟 Common-tone Pivot：当前和弦与 next-next 和弦共享音时，偏向该锚点
                if (isNearChordBoundary && nextNextChordLookahead && nextChordLookahead) {
                    const pivotPcs = HarmonyCore.getCommonTonePcs(activeChord, nextNextChordLookahead);
                    if (pivotPcs.length > 0) {
                        const curPc = currentPitch % 12;
                        let onPivot = false;
                        for (let pi = 0; pi < pivotPcs.length; pi++) {
                            if (pivotPcs[pi] === curPc) { onPivot = true; break; }
                        }
                        if (!onPivot) {
                            let bestPivot = currentPitch, bestPivotD = 999;
                            for (let pi = 0; pi < pivotPcs.length; pi++) {
                                const cand = this.getNearestOctave(pivotPcs[pi], currentPitch);
                                const d = Math.abs(cand - currentPitch);
                                if (d < bestPivotD && d <= 4) { bestPivotD = d; bestPivot = cand; }
                            }
                            if (bestPivotD < 999) {
                                // 仅当 pivot 音也是当前和弦音时才采用
                                let inCurrentChord = false;
                                for (let ci = 0; ci < chordTones.length; ci++) {
                                    if ((chordTones[ci] % 12) === (bestPivot % 12)) { inCurrentChord = true; break; }
                                }
                                if (inCurrentChord) currentPitch = bestPivot;
                            }
                        }
                    }
                }

                // 🌟 倚音法则 (Appoggiatura / Tension & Release)
                // 在强拍上故意唱一个非和弦音（如上方大二度），制造紧张感
                const useAppoggiatura = PRNGManager.next() < 0.15; // 15% 概率触发
                if (useAppoggiatura && i < adjustedOffsets.length - 1) {
                    // 向上偏移一个音阶级数（Diatonic Step）
                    currentPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, 1);
                    // 标记我们需要在下一个音符解决它
                    currentTension = -1; // 负数表示下一个音需要向下级进解决
                }
            } else {
                // 弱拍或短音：吸附到最近的音阶安全音 (Scale Tones)
                if (currentTension !== 0 && previousPitch !== null) {
                    // 🌟 解决倚音 (Resolve Appoggiatura)
                    currentPitch = HarmonyCore.shiftDiatonic(previousPitch, safeScalePcs, currentTension);
                    currentTension = 0;
                } else {
                    // 🌟 不和谐音控制 (Dissonance Control)
                const isEmotionalCore = sectionName.includes('Intro') || sectionName.includes('Chorus') || sectionName.includes('Outro');
                // 🌟 PR #4: style 是可选参数（style?: StyleConfig），加 ?. 防 undefined
                const maxDissonance = style?.harmonyRules?.maxDissonanceTolerance ?? 0.6;
                
                // 根据 maxDissonanceTolerance 动态计算使用和弦内音的概率
                // 容忍度越高，使用和弦内音的概率越低（允许更多音阶音/延伸音）
                let chordToneProb = 1.0 - (maxDissonance * 0.7); 
                if (isEmotionalCore) {
                    chordToneProb = Math.min(1.0, chordToneProb + 0.3); // 情绪核心段落更倾向于协和
                }
                
                const useChordTone = PRNGManager.next() < chordToneProb;
                
                if (useChordTone) {
                    currentPitch = chordTones.reduce((prev, curr) => {
                        const prevDist = Math.abs(this.getNearestOctave(prev, idealPitch) - idealPitch);
                        const currDist = Math.abs(this.getNearestOctave(curr, idealPitch) - idealPitch);
                        return currDist < prevDist ? curr : prev;
                    });
                } else {
                    currentPitch = safeScalePcs.reduce((prev, curr) => {
                        const prevDist = Math.abs(this.getNearestOctave(prev, idealPitch) - idealPitch);
                        const currDist = Math.abs(this.getNearestOctave(curr, idealPitch) - idealPitch);
                        return currDist < prevDist ? curr : prev;
                    });
                }
                currentPitch = this.getNearestOctave(currentPitch, idealPitch);

                // 🌟 PR #7: Avoid Note 过滤 — 精化为"仅拦截真冲突"
                //
                // 旧 PR #4 版本：任何 ≥0.5 拍的 non-chord-tone 都强制降级 → 彻底消灭了
                // 流行金曲的"和声张力脉冲"（Bruno Mars "Talking to the **moon**" 的 9 度
                // tension / The Weeknd "Save your **tears**" 的 maj7 tension）。
                //
                // 新版只拦截与 chord tone **相差半音** 的音（真冲突），保留全音差距的
                // 漂亮 tension（9/11/13）。例如：
                //   - Iadd9 (C E G D) + F → |5-4|=1 半音相撞 → 降级
                //   - Iadd9 (C E G D) + A → |9-7|=2 全音 → 保留（漂亮的 13 音）
                //   - Cmaj7 (C E G B) 上的 F → |5-4|=1 → 降级
                //   - G7 (G B D F) 上的 E → |4-5|=1 → 降级
                const isLongEnoughToHurt = duration >= 0.5;
                if (isLongEnoughToHurt) {
                    const chordPcs = chordTones.map(p => ((p % 12) + 12) % 12);
                    const currentPc = ((currentPitch % 12) + 12) % 12;
                    if (!chordPcs.includes(currentPc)) {
                        // 检测与任何 chord tone 的最短 pitch class 距离
                        let minSemitoneDist = 12;
                        for (let pci = 0; pci < chordPcs.length; pci++) {
                            const diff = Math.abs(currentPc - chordPcs[pci]);
                            const circular = diff > 6 ? 12 - diff : diff;
                            if (circular < minSemitoneDist) minSemitoneDist = circular;
                        }
                        // 仅当存在半音相撞（距离=1）时降级，其他情况保留 tension
                        if (minSemitoneDist === 1) {
                            currentPitch = chordTones.reduce((prev, curr) => {
                                const prevDist = Math.abs(this.getNearestOctave(prev, currentPitch) - currentPitch);
                                const currDist = Math.abs(this.getNearestOctave(curr, currentPitch) - currentPitch);
                                return currDist < prevDist ? curr : prev;
                            });
                            currentPitch = this.getNearestOctave(currentPitch, idealPitch);
                        }
                    }
                }
                }
            }
            
            // 🎷 物理限制：乐器绝对音域与"困难音"避让
            // 🌟 PR #5: 用 InstrumentProfiles.safeRange 查表替代硬编码 88
            // 旧版固定 maxPitch=88 (E6) 对所有非人声乐器一刀切，
            // 但 Vibraphone 的物理上限是 84 (F6)，Flute 是 84，Acoustic_Grand 是 84 等等
            // 用 instrument profile 查实际值，硬编码作为 fallback
            const instId = getInstrumentIdByName(instrumentName);
            const profile = InstrumentProfiles[instId];
            const profileMin = profile?.safeRange?.[0] ?? (isSolo ? 48 : 52);
            const profileMax = profile?.safeRange?.[1] ?? (isSolo ? 96 : 88);

            let maxPitch = profileMax;
            let minPitch = profileMin;
            if (isVocal) {
                // 人声特殊规则：主歌中下区，副歌中上区
                maxPitch = Math.min(profileMax, 72); // C5 上限
                minPitch = Math.max(profileMin, 55); // G3 下限
                // 🌟 法则五：Tessitura (音区) 管理
                // 主歌的最高音，必须比副歌的最高音低至少一个纯四度（5个半音）
                if (sectionName.includes('Verse') || sectionName.includes('PreChorus')) {
                    maxPitch -= 5;
                }
            } else {
                // 🌟 F4: 按乐器包络类型限制主旋律音域上限
                // Plucked 类乐器（钢琴/电钢/吉他/Vibes）在 B5+ 的长音只有"叮"的敲击感，缺乏表现力，
                // 听感廉价。限制到 G5(79) 绝对空间上限，Plucked 主旋律的高潮音留在温暖的中高音区。
                // Sustained 类（弦乐/木管/Pad）在 B5+ 仍有长弓/吹气的表现力，保留 profile 默认上限。
                const isPluckedEnvelope = profile?.envelope === AcousticEnvelope.Plucked;
                if (isPluckedEnvelope) {
                    maxPitch = Math.min(profileMax, 79); // G5 绝对空间上限
                }
            }
            
            // K-5 合规：用 chord.keyOffset 调整相对空间的音域边界（applyOffset 后不超出绝对音域）
            // K-5 明文允许"音域限制（clamp to range）的边界调整"读取 GlobalContext.currentKeyOffset 作为 fallback —
            // 否则 chord.keyOffset 未设时 fallback=0，会让 applyOffset 后的绝对 pitch 超出乐器 safeRange 一整个 keyOffset
            // 之多（如 G 调 keyOffset=7，EP1 safeRange=[48,79]，没 fallback 时相对 pitch 可到 79 → 绝对 86 D6 刺耳）。
            const chordKeyOffset = activeChord.keyOffset !== undefined ? activeChord.keyOffset : (GlobalContext.currentKeyOffset || 0);
            maxPitch -= chordKeyOffset;
            minPitch -= chordKeyOffset;
            if (currentPitch > maxPitch) currentPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, -2);
            while (currentPitch > maxPitch) currentPitch -= 12;
            if (currentPitch < minPitch) currentPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, 2);
            while (currentPitch < minPitch) currentPitch += 12;

            // 🌟 迈尔跳进定律 (Meyer's Leap Rule) & 音程惩罚 (Interval Penalty)
            if (previousPitch !== null) {
                // 现代流行乐 (R&B/Rap影响) 喜欢同音反复，制造“念白感”或“律动感”
                // 🌟 数据驱动的旋律锚定 (Melody Anchoring)
                // 🌟 降低同音反复概率，避免旋律呆板无聊（原 vocal:0.35 / inst:0.15 过高）
                const anchorProb = style?.melody?.anchorProbability ?? (isVocal ? 0.15 : 0.05);
                const isConversational = !isSolo && PRNGManager.next() < anchorProb;
                if (isConversational && duration < 1.0) {
                    currentPitch = previousPitch;
                }

                let interval = currentPitch - previousPitch;
                let absInterval = Math.abs(interval);

                // 🌟 Rule 2: Interval Safety — 信任 motif 形状，只拦截极端跳跃
                // 移除了原先 70% 强制级进的惩罚逻辑，该逻辑会摧毁 motif 的轮廓形状
                const maxJump = style?.melody?.maxJumpInterval ?? 12; // 默认一个八度

                if (absInterval > maxJump) {
                    // 极端跳跃：缩小到 maxJump 范围内
                    const direction = interval > 0 ? 1 : -1;
                    let targetPitch = previousPitch + direction * maxJump;

                    // 找最近的音阶音
                    let bestPc = safeScalePcs[0];
                    let minDistance = 999;
                    for (const pc of safeScalePcs) {
                        const p = this.getNearestOctave(pc, targetPitch);
                        const dist = Math.abs(p - targetPitch);
                        if (dist < minDistance) {
                            minDistance = dist;
                            bestPc = pc;
                        }
                    }
                    currentPitch = this.getNearestOctave(bestPc, targetPitch);
                    // 🌟 P5a fallback: getNearestOctave 可能仍落在 maxJump 外（例如 safeScale 里最近音 pc
                    // 跨越八度后离 previousPitch 更远）。用 shiftDiatonic 从 previousPitch 级进 ±2 度兜底。
                    if (Math.abs(currentPitch - previousPitch) > maxJump) {
                        currentPitch = HarmonyCore.shiftDiatonic(previousPitch, safeScalePcs, direction * 2);
                        // 最后保险：若还超 maxJump，直接 clamp 到 previousPitch ± maxJump（无 scale 约束）
                        if (Math.abs(currentPitch - previousPitch) > maxJump) {
                            currentPitch = previousPitch + direction * maxJump;
                        }
                    }
                } else if (notes.length >= 2) {
                    // 🌟 柔性 Leap Compensation：大跳后有 45% 概率反向级进（非 100% 强制）
                    const prevPrevPitch = notes[notes.length - 2].pitch;
                    const prevInterval = previousPitch - prevPrevPitch;
                    const leapThreshold = style?.melody?.leapResolutionThreshold ?? 5;
                    if (Math.abs(prevInterval) >= leapThreshold && PRNGManager.next() < 0.45) {
                        const gapDirection = prevInterval > 0 ? -1 : 1;
                        let targetPitch = previousPitch + gapDirection * (PRNGManager.next() > 0.5 ? 1 : 2);

                        let bestPc = safeScalePcs[0];
                        let minDistance = 999;
                        for (const sc of safeScalePcs) {
                            const p = this.getNearestOctave(sc, targetPitch);
                            const dist = Math.abs(p - targetPitch);
                            if (dist < minDistance) {
                                minDistance = dist;
                                bestPc = sc;
                            }
                        }
                        currentPitch = this.getNearestOctave(bestPc, targetPitch);
                    }
                }
                
                // 🌟 和弦边界半音导入：≤0.5 拍时向下一和弦 root/3rd 半音级进
                if (isVeryNearChordBoundary && nextChordLookahead && previousPitch !== null && !isPhraseEnd) {
                    const nextCT = HarmonyCore.getChordTones(nextChordLookahead, targetCenter);
                    // 目标：下一和弦的 root 或 3rd
                    let bestTarget = this.getNearestOctave(nextCT[0] % 12, previousPitch);
                    let bestDist = Math.abs(bestTarget - previousPitch);
                    if (nextCT.length > 1) {
                        const cand = this.getNearestOctave(nextCT[1] % 12, previousPitch);
                        const d = Math.abs(cand - previousPitch);
                        if (d < bestDist && d > 0) { bestDist = d; bestTarget = cand; }
                    }
                    // 半音级进趋近（一次一个半音），但须避免与当前和弦产生小九度
                    let chromLeadPitch = previousPitch;
                    if (bestDist > 1) {
                        const dir = bestTarget > previousPitch ? 1 : -1;
                        chromLeadPitch = previousPitch + dir;
                    } else if (bestDist > 1e-6) {
                        chromLeadPitch = bestTarget;
                    }
                    // 小九度安全检测：chromLeadPitch 与任一和弦音相差 1 半音 → 放弃
                    let hasM9Clash = false;
                    const leadPc = chromLeadPitch % 12;
                    for (let ci = 0; ci < chordTones.length; ci++) {
                        const diff = ((leadPc - (chordTones[ci] % 12)) + 12) % 12;
                        if (diff === 1 || diff === 11) { hasM9Clash = true; break; }
                    }
                    if (!hasM9Clash) currentPitch = chromLeadPitch;
                }

                // 🌟 P5a final maxJump clamp：chord-boundary chromatic lead、peakSlot pitchShift 等
                // 后处理可能让相邻音程跨越 maxJump。先强制 clamp，再做 pitch range clamp。
                if (previousPitch !== null) {
                    const maxJumpFinal = style?.melody?.maxJumpInterval ?? 12;
                    const gapFinal = currentPitch - previousPitch;
                    if (Math.abs(gapFinal) > maxJumpFinal) {
                        const dirFinal = gapFinal > 0 ? 1 : -1;
                        currentPitch = HarmonyCore.shiftDiatonic(previousPitch, safeScalePcs, dirFinal * 2);
                        if (Math.abs(currentPitch - previousPitch) > maxJumpFinal) {
                            currentPitch = previousPitch + dirFinal * maxJumpFinal;
                        }
                    }
                }

                // 🌟 F4 final clamp：Meyer's Leap / anchor prob / chord boundary approach 等后处理
                // 可能把 currentPitch 推出 line 2063 的 maxPitch 边界。这里再 clamp 一次确保
                // 装饰音分支和主音 push 都在 safeRange 内（否则 EP1 主旋律相对 79 → 绝对 86 D6 刺耳）。
                if (currentPitch > maxPitch) {
                    while (currentPitch > maxPitch) currentPitch -= 12;
                }
                if (currentPitch < minPitch) {
                    while (currentPitch < minPitch) currentPitch += 12;
                }

                // 重新计算 interval 以供后续逻辑使用
                interval = currentPitch - previousPitch;
                absInterval = Math.abs(interval);

                if (absInterval === 1 || absInterval === 2) {
                    // 🌟 级进时，有概率加入倚音 (Grace Note) / 幽灵音过度
                    // 大幅降低倚音频率，避免过于密集和烦人。使用方法论：一小节最多出现一次，或者只在长音前出现
                    const maxGraceNotesPerPhrase = isSolo ? 2 : 1;
                    let graceNotesInPhrase = notes.filter(n => (n as any).isGraceNote).length;
                    
                    const graceChance = style?.melody?.inflectionProbability ?? (isSolo ? 0.08 : (isInstrumental ? 0.04 : 0.02)); // 大幅降低倚音频率
                    // 🌟 P0 willBeAnchor 守卫：装饰音只挂在关键音上（教程要求，装饰非关键音会造成听觉混乱）
                    if (PRNGManager.next() < graceChance && willBeAnchor && notes.length > 0 && !isPhraseEnd && graceNotesInPhrase < maxGraceNotesPerPhrase) {
                        const lastNote = notes[notes.length - 1];
                        // 只有当上一个音足够长，且当前音在强拍或次强拍时，才加倚音，增加“高级感”
                        const isTargetStrongBeat = isOnDownbeat(onset) || (isOnGrid(onset, 0.5) && PRNGManager.next() < 0.3);
                        
                        if (onset - lastNote.onset >= 0.5 && isTargetStrongBeat) {
                            // 倚音 (Grace Note) - 极短的音符，紧贴在当前音符之前
                            // 引入微小的时值随机性
                            const graceDuration = 0.0625 + (PRNGManager.next() * 0.02); // 64分音符左右
                            const graceOnset = onset - graceDuration;
                            
                            // 倚音音高通常是目标音的上方或下方二度
                            let gracePitch: number;
                            
                            // 🌟 爵士/R&B 技巧：4度到3度，或者2度到3度的滑音 (Pentatonic Slides)
                            // 如果目标音是和弦的三音，有概率使用 4->3 或 2->3 的倚音
                            const isThird = (currentPitch % 12) === ((chordTones[1] || chordTones[0]+4) % 12);
                            const shiftProb = style?.melody?.pentatonicShiftProbability ?? 0.4;
                            if (isThird && PRNGManager.next() < shiftProb) {
                                const slideFrom4 = PRNGManager.next() > 0.5;
                                gracePitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, slideFrom4 ? 1 : -1);
                            } else if (isSolo && PRNGManager.next() < (style?.melody?.chromaticPassingProbability ?? 0.2)) {
                                // 🌟 Bebop 技巧：半音包围 (Chromatic Enclosure)
                                // 在目标音之前加入上方半音或下方半音的经过音
                                const encloseFromAbove = PRNGManager.next() > 0.5;
                                gracePitch = currentPitch + (encloseFromAbove ? 1 : -1);
                            } else {
                                const graceDirection = PRNGManager.next() > 0.5 ? 1 : -1;
                                gracePitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, graceDirection);
                            }
                            
                            // 确保倚音不与上一个音重叠，且在音域范围内，并且不与当前音高相同
                            if (graceOnset >= lastNote.onset + lastNote.duration * 0.5 && gracePitch >= minPitch && gracePitch <= maxPitch && gracePitch !== currentPitch) {
                                // 缩短上一个音，为倚音腾出空间
                                lastNote.duration = Math.min(lastNote.duration, graceOnset - lastNote.onset);
                                
                                notes.push({
                                    pitch: Math.floor(gracePitch),
                                    onset: graceOnset,
                                    duration: graceDuration * 1.5, // 稍微延长一点点发音时间
                                    // 倚音力度极弱
                                    velocity: Math.max(0.1, lastNote.velocity * (0.2 + PRNGManager.next() * 0.15)),
                                    isGraceNote: true
                                } as any);
                            }
                        }
                    }
                } else if (interval === 0 && notes.length > 0) {
                    // 🌟 辅助音 (Neighbor Tone)
                    // 当音高重复时，有概率将前一个音拆分，加入一个上方或下方的辅助音
                    const isEmotionalCore = sectionName.includes('Intro') || sectionName.includes('Chorus') || sectionName.includes('Outro');
                    const neighborChance = isEmotionalCore ? 0.15 : 0.05;
                    // 🌟 P0 willBeAnchor 守卫：同 grace，辅助音只分裂关键音
                    if (PRNGManager.next() < neighborChance && willBeAnchor) {
                        const lastNote = notes[notes.length - 1];
                        if (lastNote.duration >= 0.5) {
                            const neighborDuration = Math.min(lastNote.duration * 0.5, 0.25);
                            lastNote.duration -= neighborDuration;
                            
                            // 决定是上方还是下方辅助音
                            const isUpper = PRNGManager.next() > 0.5;
                            const neighborPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, isUpper ? 1 : -1);
                            
                            if (neighborPitch >= minPitch && neighborPitch <= maxPitch) {
                                notes.push({
                                    pitch: Math.floor(neighborPitch),
                                    onset: lastNote.onset + lastNote.duration,
                                    duration: neighborDuration,
                                    velocity: Math.max(0.2, lastNote.velocity * 0.6)
                                });
                            } else {
                                lastNote.duration += neighborDuration; // 恢复
                            }
                        }
                    }
                }
            }
            
            if (currentPitch > maxPitch) currentPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, -2);
            while (currentPitch > maxPitch) currentPitch -= 12;
            if (currentPitch < minPitch) currentPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, 2);
            while (currentPitch < minPitch) currentPitch += 12;

            // 🌟 真实人类演奏的轻重音 (Humanized Accents & Dynamics)
            const beatsPerBar = GlobalContext.currentTimeSignature[0];
            const beatInBar = onset % beatsPerBar; 
            const is68 = beatsPerBar === 6;
            
            let metricAccent = 0.6; // 默认弱拍
            if (beatInBar === 0) {
                metricAccent = 1.0; // 强拍 (Downbeat)
                // 乐句开头或结尾的强拍更重
                if (i === 0 || i === adjustedOffsets.length - 1) metricAccent = 1.05;
            }
            else if (is68 && beatInBar === 3) metricAccent = 0.85; // 6/8 次强拍
            else if (!is68 && beatInBar === 2 && beatsPerBar === 4) metricAccent = 0.8; // 4/4 次强拍
            else if (isOnDownbeat(beatInBar)) metricAccent = 0.75; // 正拍
            else if (isOnGrid(beatInBar, 0.5)) metricAccent = 0.6; // 8分音符反拍
            else metricAccent = 0.5; // 16分音符反拍
            
            // 引入一点力度随机性，结合音高起伏
            // 音高越高，通常力度越大
            const pitchAccent = (currentPitch - 60) / 40; // 归一化音高影响
            let humanVelocity = metricAccent * (0.85 + PRNGManager.next() * 0.2) + pitchAccent * 0.1;

            // 🌟 P6b: 张力封套调制 velocity（高张力 = 更强；低张力 = 更弱）
            // 系数 0.4 是"动态范围"，可调；保留 PRNG 序列不变
            if (tensionEnv) {
                const tNow = tensionEnv.at(onset, phraseStart, phraseLengthBeats);
                humanVelocity *= (0.6 + 0.4 * tNow);
            }
            
            if (isSolo) humanVelocity *= 1.15; 
            else if (isLead && isInstrumental) humanVelocity *= 1.05;
            
            // 🌟 针对特定乐器的力度调整：Lo-Fi 钢琴和 EP 需要更轻柔的触键，避免触发高力度采样（太亮）
            if (instrumentName.includes('Lofi_Piano') || instrumentName.includes('Warm_EP')) {
                humanVelocity *= 0.7; // 整体降低力度，保持温暖、慵懒的音色
            }

            // 🌟 Velocity 天花板 0.85（不触发 SoundFont 高力度刺耳采样层）
            humanVelocity = Math.max(0.15, Math.min(0.85, humanVelocity));

            // 🌟 高音力度衰减（Pitch-Velocity Inverse Scaling）
            // 真实乐手演奏高音时因穿透力强会收力。pitch>72(C5)每高一半音，力度递减 0.012
            if (currentPitch > 72) {
                const overPitch = currentPitch - 72;
                humanVelocity = Math.max(0.25, humanVelocity - overPitch * 0.012);
            }

            // 🌟 弹性速度 (Rubato) & Humanized Timing
            // 乐句开头稍微抢拍，乐句结尾稍微拖拍 (Ritardando)
            let rubatoShift = 0;
            if (i === 0 && !isStrongBeat) {
                rubatoShift = -0.02; // 抢拍
            } else if (i === adjustedOffsets.length - 1) {
                rubatoShift = 0.04; // 拖拍
            }
            
            // 🌟 Laid-back Timing（拖拍律动）— 由 StyleConfig.melody.laidBackTimingMax 驱动
            const laidBack = style?.melody?.laidBackTimingMax ?? 0;
            let timingJitter: number;
            if (laidBack > 1e-6) {
                // 拖拍：强拍拖更狠，弱拍稍轻（R&B/Neo-Soul/Lo-fi）
                const laidBackAmount = isStrongBeat ? laidBack : (laidBack * 0.5);
                timingJitter = laidBackAmount + (PRNGManager.next() * 0.04) + rubatoShift;
            } else if (laidBack < -1e-6) {
                // 抢拍：均匀向前冲（Punk/EDM）
                timingJitter = laidBack + (PRNGManager.next() * 0.02) + rubatoShift;
            } else {
                // 默认：原有微小 rubato
                timingJitter = (PRNGManager.next() * 0.04 - 0.02) * (1.1 - metricAccent) + rubatoShift;
            }
            // 🌟 P6b: 张力封套调制 jitter（高张力 = 节奏更精准；低张力 = 摇摆感更强）
            if (tensionEnv) {
                const tNow = tensionEnv.at(onset, phraseStart, phraseLengthBeats);
                timingJitter *= (1.1 - tNow * 0.8); // 张力 0 → 1.1×，张力 1 → 0.3×
            }
            // 🌟 P5e: humanize 总偏移 cap 到 ±0.05 拍（≈ 25ms @ 120 BPM），保持网格感
            // laidBack 风格的时间感受 cap 的保护，但总偏移不超过 0.08 拍避免延迟感
            if (Math.abs(laidBack) < 1e-6) {
                timingJitter = Math.max(-0.05, Math.min(0.05, timingJitter));
            } else {
                timingJitter = Math.max(-0.08, Math.min(0.08, timingJitter));
            }
            const finalOnset = Math.max(0, onset + timingJitter);

            // Rule 1.2: 拖拍和弦重算——如果 finalOnset 跨越和弦边界，检查小九度冲突并修正
            if (Math.abs(finalOnset - onset) > 1e-6) {
                const realChord = chords.find(c => finalOnset >= c.startBeat && finalOnset < c.endBeat);
                if (realChord && realChord !== activeChord) {
                    const realCT = HarmonyCore.getChordTones(realChord, targetCenter);
                    const curPc = currentPitch % 12;
                    let hasClash = false;
                    for (let ci = 0; ci < realCT.length; ci++) {
                        if (((curPc - (realCT[ci] % 12)) + 12) % 12 === 1) { hasClash = true; break; }
                    }
                    if (hasClash) {
                        const realSafe = HarmonyCore.getSafeScalePitches(realChord, tonality);
                        let bestP = currentPitch, bestD = 999;
                        for (let si = 0; si < realSafe.length; si++) {
                            const c = this.getNearestOctave(realSafe[si], currentPitch);
                            const d = Math.abs(c - currentPitch);
                            if (d < bestD) { bestD = d; bestP = c; }
                        }
                        currentPitch = bestP;
                    }
                }
            }

            let legatoDuration = duration;
            if (instrumentName === 'Marimba') {
                // Vocal synths might need a tiny bit of overlap to trigger legato, but keep it minimal
                legatoDuration = duration * 1.05;
            }

            // 🌟 幽灵音 (Ghost Note) / 律动推进
            // 在音符之前加入极短、极弱的同音高或八度音，增加律动感和推进力
            const ghostChance = isSolo ? 0.1 : (isInstrumental ? 0.05 : 0.02);
            if (PRNGManager.next() < ghostChance && i > 0 && duration >= 0.5) {
                const prevOffset = rhythmOffsets[i - 1];
                const spaceBefore = rhythmOffsets[i] - prevOffset;
                if (spaceBefore >= 0.5) {
                    const ghostOnset = finalOnset - 0.125; // 32分音符提前量
                    if (ghostOnset > phraseStart + prevOffset + 0.25) { // 确保不与上一个音重叠太严重
                        notes.push({
                            pitch: Math.floor(currentPitch),
                            onset: ghostOnset,
                            duration: 0.1,
                            velocity: humanVelocity * 0.15 // 极弱的力度
                        });
                    }
                }
            }

            // 🌟 Melisma 转音瀑布 — 由 StyleConfig.melody.melismaProbability 驱动
            const melismaProb = style?.melody?.melismaProbability ?? 0;
            if (melismaProb > 0 && isLongNote && isPhraseEnd && PRNGManager.next() < melismaProb) {
                const runCount = 3 + Math.floor(PRNGManager.next() * 3); // 3-5 个 32 分音符
                const runSpeed = 0.125;
                const pentatonicPcs = HarmonyCore.getScalePitches(
                    tonality === Tonality.Major || tonality === Tonality.Major_Pentatonic
                        ? Tonality.Major_Pentatonic : Tonality.Minor_Pentatonic
                );
                let runPitch = currentPitch;
                let runOnset = finalOnset;
                for (let r = 0; r < runCount; r++) {
                    notes.push({
                        pitch: Math.floor(runPitch), onset: runOnset,
                        duration: runSpeed * 1.5,
                        velocity: humanVelocity * (1.0 - r * 0.12)
                    });
                    runPitch = HarmonyCore.shiftDiatonic(runPitch, pentatonicPcs, -1);
                    // 🌟 PR #5: melisma 是递减瀑布，理论上不会超出 maxPitch，但要防止穿透 minPitch
                    while (runPitch < minPitch) runPitch += 12;
                    while (runPitch > maxPitch) runPitch -= 12;
                    runOnset += runSpeed;
                }
                const remaining = legatoDuration - (runCount * runSpeed);
                if (remaining > 0.1) {
                    notes.push({ pitch: Math.floor(runPitch), onset: runOnset, duration: remaining, velocity: humanVelocity * 0.45 });
                }
                previousPitch = Math.floor(runPitch);
                continue;
            }

            // 🌟 装饰音 (Ornaments): 颤音 (Trill)
            // 如果是长音，且是乐句结尾或强拍，有概率加入颤音
            const trillChance = isSolo ? 0.1 : (isInstrumental && isLead ? 0.05 : 0.01);
            if (isLongNote && (isPhraseEnd || isStrongBeat) && PRNGManager.next() < trillChance) {
                // 🌟 PR #4: 移除未使用的 trillInterval（trillPitch 用 shiftDiatonic 直接取调内邻音）
                // 保留 PRNGManager.next() 调用以维持序列对齐
                PRNGManager.next();
                const trillPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, 1); // 上方邻音
                
                if (trillPitch <= maxPitch) {
                    // 将长音分割成快速交替的音符
                    const trillSpeed = isSolo ? 0.125 : 0.25; // 32分音符或16分音符速度
                    const numTrillNotes = Math.floor(Math.min(duration * 0.5, 1.0) / trillSpeed); // 颤音持续时间不超过原音符一半或1拍
                    
                    let currentTrillOnset = finalOnset;
                    for (let t = 0; t < numTrillNotes; t++) {
                        const p = t % 2 === 0 ? currentPitch : trillPitch;
                        const v = humanVelocity * (0.4 + PRNGManager.next() * 0.15); // 颤音力度极弱且有起伏
                        notes.push({ pitch: Math.floor(p), onset: currentTrillOnset, duration: trillSpeed * 1.2, velocity: v });
                        currentTrillOnset += trillSpeed;
                    }
                    
                    // 剩余时间保持主音
                    const remainingDuration = legatoDuration - (numTrillNotes * trillSpeed);
                    if (remainingDuration > 0) {
                        notes.push({ pitch: Math.floor(currentPitch), onset: currentTrillOnset, duration: remainingDuration, velocity: humanVelocity * 0.9 });
                    }
                } else {
                    // 如果颤音超出音域，正常添加音符
                    notes.push({ pitch: Math.floor(currentPitch), onset: finalOnset, duration: legatoDuration, velocity: humanVelocity });
                }
            } else {
                // 🌟 强拍半音趋近音 (Chromatic Approach from Below)
                let didChromaticApproach = false;
                const chromApproachProb = style?.melody?.chromaticApproachProbability ?? 0.15;
                if (isStrongBeat && previousPitch !== null && i > 0 && notes.length > 0) {
                    const chromRoll = PRNGManager.next(); // 始终消耗 PRNG 保持确定性
                    let targetIsChordTone = false;
                    const curPc = currentPitch % 12;
                    for (let ci = 0; ci < chordTones.length; ci++) {
                        if ((chordTones[ci] % 12) === curPc) { targetIsChordTone = true; break; }
                    }
                    if (targetIsChordTone && chromRoll < chromApproachProb) {
                        const approachPitch = currentPitch - 1;
                        // 安全检测：趋近音不能与其他和弦音产生小九度（与目标音差 1 是预期的）
                        let approachSafe = true;
                        const apPc = approachPitch % 12;
                        for (let ci = 0; ci < chordTones.length; ci++) {
                            const ctPc = chordTones[ci] % 12;
                            if (ctPc === curPc) continue; // 跳过目标和弦音本身
                            const diff = ((apPc - ctPc) + 12) % 12;
                            if (diff === 1 || diff === 11) { approachSafe = false; break; }
                        }
                        if (approachSafe && approachPitch >= minPitch && Math.abs(approachPitch - previousPitch) < 12) {
                            const lastNote = notes[notes.length - 1];
                            const approachDuration = 0.25; // 16th note
                            const approachOnset = finalOnset - approachDuration;
                            if (approachOnset > lastNote.onset + lastNote.duration * 0.5) {
                                // 缩短前音为趋近音腾出空间
                                lastNote.duration = Math.min(lastNote.duration, approachOnset - lastNote.onset);
                                notes.push({
                                    pitch: Math.floor(approachPitch),
                                    onset: approachOnset,
                                    duration: approachDuration,
                                    velocity: humanVelocity * 0.6
                                });
                                didChromaticApproach = true;
                            }
                        }
                    }
                }

                // 🌟 强拍倚音 (Appoggiatura) — 与半音趋近互斥
                const isEmotionalCore = sectionName.includes('Intro') || sectionName.includes('Chorus') || sectionName.includes('Outro');
                const appoggiaturaChance = isEmotionalCore ? 0.1 : 0.05;
                if (!didChromaticApproach && isStrongBeat && duration >= 0.5 && PRNGManager.next() < appoggiaturaChance) {
                    // 强拍上的非和弦音，随后解决到和弦音
                    const isUpper = PRNGManager.next() > 0.5;
                    const appPitch = HarmonyCore.shiftDiatonic(currentPitch, safeScalePcs, isUpper ? 1 : -1);
                    
                    // 确保 appPitch 不是和弦内音，以产生张力
                    if (!chordTones.some(ct => (ct % 12) === (appPitch % 12)) && appPitch >= minPitch && appPitch <= maxPitch) {
                        const appDuration = Math.min(duration * 0.5, 0.25); // 占据一半时值或最多16分音符
                        
                        notes.push({
                            pitch: Math.floor(appPitch),
                            onset: finalOnset,
                            duration: appDuration,
                            velocity: humanVelocity * 1.1 // 强拍倚音通常带有重音
                        });
                        
                        // 解决音（原本的 currentPitch）延迟出现
                        notes.push({ 
                            pitch: Math.floor(currentPitch), 
                            onset: finalOnset + appDuration, 
                            duration: Math.max(0.1, legatoDuration - appDuration), 
                            velocity: humanVelocity * 0.7 
                        });
                        
                        previousPitch = currentPitch;
                        continue; // 跳过后面的正常添加
                    }
                }

                // 🌟 P5a Push-time maxJump 强制拦截：装饰音（grace/trill/appoggiatura/chromatic approach）
                // 生成过程中可能改变 previousPitch 与 currentPitch 的相对距离，这里是 push 主音前的最后保险。
                // 如果主音相对上一个"非装饰音"跨度超过 maxJump，强制拉回。
                if (notes.length > 0) {
                    const maxJumpPush = style?.melody?.maxJumpInterval ?? 12;
                    // 找上一个非装饰音（isGraceNote !== true）作为参考
                    let refPitch: number | null = null;
                    for (let k = notes.length - 1; k >= 0; k--) {
                        if (notes[k].isGraceNote !== true) { refPitch = notes[k].pitch; break; }
                    }
                    if (refPitch !== null) {
                        const gapPush = currentPitch - refPitch;
                        if (Math.abs(gapPush) > maxJumpPush) {
                            const dirPush = gapPush > 0 ? 1 : -1;
                            let snapped = HarmonyCore.shiftDiatonic(refPitch, safeScalePcs, dirPush * 3); // 向 ref 方向级进 3 度
                            if (Math.abs(snapped - refPitch) > maxJumpPush) {
                                snapped = refPitch + dirPush * maxJumpPush;
                            }
                            currentPitch = snapped;
                        }
                    }
                }

                // 🌟 P6a 标记（只读不写）：如果当前 onset 对齐 phraseSkeleton 的某个 anchor，标 isPreBuiltAnchor。
                // 关键：**不改 currentPitch**（避免改变 previousPitch 链，破坏后续 PRNG 序列）。
                // P6a 的核心音乐性来自 Bresenham 覆盖 idealPitch，已在 line 1827+ 生效；
                // 这里仅做下游识别用，让 AnchorDecisionStage 知道"这个音是骨架的一部分"。
                let isPreBuilt = false;
                if (phraseSkeleton) {
                    for (let k = 0; k < phraseSkeleton.anchorOnsets.length; k++) {
                        if (Math.abs(finalOnset - phraseSkeleton.anchorOnsets[k]) < 0.3) {
                            isPreBuilt = true;
                            break;
                        }
                    }
                }

                // 正常添加音符
                const noteData: NoteData = { pitch: Math.floor(currentPitch), onset: finalOnset, duration: legatoDuration, velocity: humanVelocity };
                if (isPreBuilt) {
                    noteData.isPreBuiltAnchor = true;
                    noteData.isAnchor = true;
                }
                notes.push(noteData);

                // 🌟 全音阶经过音链 (Diatonic Passing Tone Chain)
                // 当前后两音间隔 ≥3 半音时，缩短前音尾部填入经过音
                const passingProb = style?.melody?.passingToneChainProbability ?? 0.12;
                if (previousPitch !== null && notes.length >= 2) {
                    const justPushed = notes[notes.length - 1];
                    const prevNote = notes[notes.length - 2];
                    const gap = justPushed.pitch - prevNote.pitch;
                    const absGap = Math.abs(gap);
                    const passingRoll = PRNGManager.next(); // 始终消耗 PRNG 保持确定性
                    if (absGap >= 3 && absGap <= 7 && prevNote.duration >= 0.5 && passingRoll < passingProb) {
                        const dir = gap > 0 ? 1 : -1;
                        const stepsNeeded = Math.min(absGap - 1, 3); // max 3 passing tones
                        const passingDur = 0.25;
                        const totalPassingTime = stepsNeeded * passingDur;
                        if (prevNote.duration > totalPassingTime + 0.25) {
                            const originalDur = prevNote.duration;
                            prevNote.duration = originalDur - totalPassingTime;
                            let passingPitch = prevNote.pitch;
                            let passingOnset = prevNote.onset + prevNote.duration;
                            for (let s = 0; s < stepsNeeded; s++) {
                                passingPitch = HarmonyCore.shiftDiatonic(passingPitch, safeScalePcs, dir);
                                // 小九度安全检测：经过音不能与当前和弦音产生小九度
                                let passSafe = true;
                                const ppPc = passingPitch % 12;
                                for (let ci = 0; ci < chordTones.length; ci++) {
                                    const diff = ((ppPc - (chordTones[ci] % 12)) + 12) % 12;
                                    if (diff === 1 || diff === 11) { passSafe = false; break; }
                                }
                                if (passSafe && passingPitch >= minPitch && passingPitch <= maxPitch) {
                                    // 插入到最后一个音之前
                                    notes.splice(notes.length - 1, 0, {
                                        pitch: Math.floor(passingPitch),
                                        onset: passingOnset,
                                        duration: passingDur,
                                        velocity: humanVelocity * 0.55
                                    });
                                }
                                passingOnset += passingDur;
                            }
                            // 更新最后一个音的 onset（被经过音推迟了）
                            justPushed.onset = passingOnset;
                            justPushed.duration = Math.max(0.1, legatoDuration - totalPassingTime);
                        }
                    }
                }
            }

            // 🌟 不谐和度张力反馈：非和弦音累积张力→下一个音级进解决
            if (notes.length >= 2 && !isPhraseEnd) {
                const lastNote = notes[notes.length - 1];
                const lastPc = lastNote.pitch % 12;
                let isLastCT = false;
                for (let ci = 0; ci < chordTones.length; ci++) {
                    if ((chordTones[ci] % 12) === lastPc) { isLastCT = true; break; }
                }
                if (!isLastCT) {
                    let hasM9 = false;
                    for (let ci = 0; ci < chordTones.length; ci++) {
                        if (((lastPc - (chordTones[ci] % 12)) + 12) % 12 === 1) { hasM9 = true; break; }
                    }
                    if (hasM9) {
                        currentTension = Math.max(currentTension - 2, -3);
                    } else if (lastNote.duration >= 0.5) {
                        currentTension = Math.max(currentTension - 1, -3);
                    }
                }
            }

            previousPitch = currentPitch;
        }

        // 🌟 法则五：黄金分割高潮 (The Golden Ratio Climax)
        if (isClimax && notes.length > 0) {
            let climaxNote = notes[0];
            let maxScore = -1;
            for (const note of notes) {
                const isStrong = isOnDownbeat(note.onset);
                const score = (isStrong ? 10 : 0) + note.duration;
                if (score > maxScore) {
                    maxScore = score;
                    climaxNote = note;
                }
            }

            const activeChord = chords.find(c => climaxNote.onset >= c.startBeat && climaxNote.onset < c.endBeat) || chords[0];
            const safeScalePcs = HarmonyCore.getSafeScalePitches(activeChord, tonality);

            let targetPitch = climaxNote.pitch + 12;

            // 🌟 PR #5: 用 InstrumentProfiles.safeRange 替代硬编码 absoluteMax
            // 旧版 absoluteMax = isInstrumental ? 92 : 76，但 Vibraphone 实际 safeRange=[60,84]
            // climax 路径之前不查表 → climaxNote.pitch + 12 可以飙到 D7(98)
            const climaxInstId = getInstrumentIdByName(instrumentName);
            const climaxProfile = InstrumentProfiles[climaxInstId];
            const profileMax = climaxProfile?.safeRange?.[1] ?? 88;
            const absoluteMax = !isInstrumental
                ? Math.min(76, profileMax)
                : (isSolo ? Math.min(100, profileMax) : profileMax);
            if (targetPitch > absoluteMax) {
                targetPitch = absoluteMax;
            }

            let bestPc = safeScalePcs[0];
            let minDistance = 999;
            for (const pc of safeScalePcs) {
                const p = this.getNearestOctave(pc, targetPitch);
                const dist = Math.abs(p - targetPitch);
                if (dist < minDistance) {
                    minDistance = dist;
                    bestPc = pc;
                }
            }
            climaxNote.pitch = this.getNearestOctave(bestPc, targetPitch);

            // 🌟 PR #5: getNearestOctave 可能返回略高于 absoluteMax 的八度等价音 → 强 clamp
            while (climaxNote.pitch > absoluteMax) climaxNote.pitch -= 12;

            climaxNote.velocity = Math.min(1.0, climaxNote.velocity * 1.3);
            climaxNote.duration = Math.max(climaxNote.duration, 1.0);
        }

        // 🌟 Enforce monophonic behavior for vocals (prevent overlap)
        if (instrumentName.includes('Vocal') || instrumentName.includes('Voice') || instrumentName.includes('Choir')) {
            notes.sort((a, b) => {
                if (Math.abs(a.onset - b.onset) < 0.01) return b.pitch - a.pitch;
                return a.onset - b.onset;
            });
            
            const monophonicNotes: NoteData[] = [];
            let currentNote: NoteData | null = null;
            
            for (const note of notes) {
                if (!currentNote) {
                    currentNote = { ...note };
                    continue;
                }
                
                if (Math.abs(note.onset - currentNote.onset) < 0.01) {
                    continue; // Skip notes that start at the same time
                }
                
                if (currentNote.onset + currentNote.duration > note.onset) {
                    currentNote.duration = Math.max(0.01, note.onset - currentNote.onset - 0.02);
                }
                
                monophonicNotes.push(currentNote);
                currentNote = { ...note };
            }
            
            if (currentNote) {
                monophonicNotes.push(currentNote);
            }
            return { notes: monophonicNotes, lastPitch: previousPitch };
        }

        return { notes, lastPitch: previousPitch };
    }

    private static getNearestOctave(pc: number, target: number): number {
        const octave = Math.floor(target / 12);
        let pitch = (pc % 12) + octave * 12;
        if (Math.abs(pitch + 12 - target) < Math.abs(pitch - target)) pitch += 12;
        if (Math.abs(pitch - 12 - target) < Math.abs(pitch - target)) pitch -= 12;
        return pitch;
    }
}