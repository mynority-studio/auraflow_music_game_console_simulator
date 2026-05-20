export type ChordProgression = string[];

import { StyleId } from './config/StyleFlags';

// CONSTITUTION CHAPTER I — 核心 IR 类型已迁移至 ./ir/index.ts。
// 此处保留 re-export 以兼容现有 callsite。新代码请直接从 './ir' 导入。
// 同时 import 以保证 types.ts 内部其他 interface（GeneratedTrack/ArrangedTrack 等）可继续引用。
import type { NoteData, GeneratedChord, SectionMetadata, MusicContext, VoicedPitch } from './ir';
import { VoiceRole } from './ir';
export type { NoteData, GeneratedChord, SectionMetadata, MusicContext, VoicedPitch };
export { VoiceRole };

// --- Phase 1 & 2: Decoupled Foundation & Macro Brain ---
export interface RhythmCell {
    durations: number[]; // e.g., [0.5, 0.5] for two 8th notes
    weight: number;      // Probability weight
    tags: string[];      // e.g., 'syncopated', 'straight', 'triplet'
}

export interface GrooveBankDef {
    name: string;               // 律动库名称（仅用于调试）
    cells: RhythmCell[];        // 节奏单元池
    syncopationWeight: number;  // 该律动库的特征切分率（影响全曲切分倾向）
}

// -------------------------------------------------------

// ============================================================
// 鼓组数据契约 — GrooveEngine 数据驱动改造（#1）
// ============================================================
// 鼓型完全外置到 StyleConfig.rhythm.drumPatterns，GrooveEngine 退化为纯渲染器。
// positions 是相对小节起点的拍位（4/4 下取 0~3.99，单位拍）；
// 时值 / 力度 全部数据化，零硬编码。
//
// 三类击点：
//   fixedHits     — 固定击点：每个 8 分网格上若 bInBar 命中 positions 必触发，无 PRNG。
//   densityHits   — 概率击点：8 分网格上 PRNG<density 才触发，velocity 在 range 中抽。
//   ghost         — 16 分鬼音：能量与密度双门槛 + 触发概率三层闸门，velocity 在 range 中抽。
//   crashOnSectionStart — 段落首拍 crash：deterministic，无 PRNG。

export interface DrumFixedHit {
    pitch: number;            // GM Drum Map 物理键位
    positions: number[];      // bInBar 触发位（4/4 拍下 [0,2] = 1 拍 + 3 拍）
    velocity: number;         // 确定性力度
    duration: number;         // 时长（拍）
}

export interface DrumDensityHit {
    pitch: number;
    positions: number[];      // 8 分网格触发位
    velocityRange: [number, number];
    duration: number;
}

export interface DrumGhostHit {
    pitch: number;
    positions: number[];      // 16 分缝隙位（[0.75, 1.25, 2.75, 3.25]）
    velocityRange: [number, number];
    duration: number;
    energyMin: number;        // 能量门槛（不达不触发）
    densityThreshold: number; // 密度门槛
    probability: number;      // PRNG 触发概率
}

export interface DrumCrash {
    pitch: number;
    velocity: number;
    duration: number;
}

export interface DrumPattern {
    energyMin: number;        // 能量段（含）
    energyMax: number;
    fixedHits: DrumFixedHit[];
    densityHits: DrumDensityHit[];
    ghost?: DrumGhostHit;
    crashOnSectionStart?: DrumCrash;
}

export interface DSPNodeConfig {
    type: BiquadFilterType; // 'highpass', 'lowpass', 'peaking', 'highshelf'
    frequency: number;
    Q: number;
    gain?: number;
}

export interface MasteringProfile {
    id: string;
    nodes: DSPNodeConfig[];
    masterCompressor: { threshold: number, ratio: number, attack: number, release: number };
    makeupGain: number;
}

export interface InstrumentBehavior {
    pitchRange: [number, number]; // e.g., [60, 84] (C4 to C6)
    velocityRange: [number, number]; // e.g., [90, 115] (明亮) vs [40, 70] (暗淡)
}

// 🌟 段落模板：单个段落的纯数据描述
export interface SectionTemplate {
    name: string;       // 段落显示名 (e.g., "Verse_1", "Chorus_Main")
    bars: number;       // 小节数
    energy: number;     // 原始能量值 1-10（会被 mood.energyCap 进一步约束）
    type?: SectionType; // 段落类型枚举（Phase 3 结构剥离新增）
}

/**
 * 风格层乐句长度配置 — 决定每个段落使用的 PhraseGroup 长度
 */
export interface PhraseLengthProfile {
    name: string;                                    // 'pop' | 'ballad' | 'dance' 等
    /** 各段落类型偏好的 group 长度（小节数 + 权重） */
    perSection: {
        verse?: { bars: number, weight: number }[];
        preChorus?: { bars: number, weight: number }[];
        chorus?: { bars: number, weight: number }[];
        bridge?: { bars: number, weight: number }[];
        intro?: { bars: number, weight: number }[];
        outro?: { bars: number, weight: number }[];
        default?: { bars: number, weight: number }[];
    };
    /** 子动机长度池（一般 1 或 2 小节） */
    subMotifBarsPool: { bars: number, weight: number }[];
}

// 🌟 结构模板：整曲段落序列的纯数据描述
// 取代 StructureEngine 中硬编码的 () => {...} 闭包
export interface StructureTemplate {
    id: string;                       // 模板标识，便于调试 (e.g., "standard-pop", "chorus-first")
    introBarsMultiplier?: number;     // 前奏小节数 = introBarsMultiplier × style.global.introBarsHighBpm（或 lowBpm）
    introBaseEnergy?: number;         // 前奏起始能量
    sections: SectionTemplate[];      // intro 之后的段落序列
}

export interface StyleConfig {
    id: StyleId; name: string; description?: string;
    // ============================================================
    // 参考架构字段（ALL_SOURCE_CODE.md 移植）— 给 Idiom 引擎消费
    // ============================================================
    /** 七和弦扩展上限：9=Pop / 11=ChillJazz / 13=NeoSoul（IdiomUtils 用 degree>tensionLimits 剔除） */
    tensionLimits?: number;
    /** 全曲基准密度：0.4=ChillJazz / 0.5=NeoSoul / 0.6=Pop（PianoBaseIdiom 消费） */
    densityBaseline?: number;
    /** 经过和弦注入概率：0.2=Pop / 0.5=ChillJazz / 0.6=NeoSoul */
    passingChordProb?: number;
    /** 离调（chromatic）经过和弦比例 — PassingChordEngine 路由到 D/E 派系（平行滑移 / SubV7）：0.3=Pop / 0.5=ChillJazz / 0.7=NeoSoul */
    chromaticPassingProb?: number;
    /** 抢拍/推拍概率：0.3=Pop / 0.6=ChillJazz / 0.7=NeoSoul */
    anticipationProb?: number;
    /** Swing 比例：未设=直拍 / 0.55=ChillJazz 微 swing / 0.6=NeoSoul 中 swing */
    swingRatio?: number;
    global: {
        bpmRange: [number, number];
        timeSignaturePool: Array<{ signature:[number, number], weight: number }>;
        tonalityPool: Array<{ tonality: Tonality, weight: number }>;
        // 🌟 结构模板池：StructureEngine 从中等概率选取
        structureTemplates?: StructureTemplate[];
        // 🌟 BPM 驱动的前奏长度配置
        introBarsLowBpm?: number;       // 慢曲（bpm < introBarsBpmThreshold）使用的前奏小节数，默认 8
        introBarsHighBpm?: number;      // 快曲使用的前奏小节数，默认 4
        introBarsBpmThreshold?: number; // 慢/快曲分界 BPM，默认 90
        outroBars?: number;             // 尾奏小节数，默认 4
    };
    /**
     * 罗马数字进行池（双模式 × 段落键），参考架构 StyleHarmonyConfig 形状。
     * 段落键使用小写：'intro'/'verse'/'preChorus'/'chorus'/'bridge'/'outro'。
     * HarmonyCore 按 tonality 选 major/minor 池，按 sec.name.toLowerCase() 查段落。
     */
    harmony: {
        major: Record<string, string[][]>;
        minor: Record<string, string[][]>;
    };
    harmonyRules?: {
        maxDissonanceTolerance?: number;
        passingChords?: Array<'SecondaryDominant' | 'Diminished7' | 'TritoneSub' | 'Chromatic' | 'DescendingDiminished' | 'SharpFourHalfDim'>;
        allowTritoneSub?: boolean;
        reharmProbability?: number;
        melodyDrivenReharmProbability?: number; // 🌟 新增：旋律引导的和声替换概率
        borrowedChords?: Array<'ModalMixture' | 'Neapolitan' | 'SecondaryDominant' | 'TritoneSubstitution'>;
        voicingStyle?: 'standard' | 'neo-soul' | 'jazz' | 'jpop' | 'edm' | 'pop-rock';
        globalProgressionProbability?: number; // 🌟 新增：全曲共用一套和弦的概率
        genreBendingProbability?: number; // 🌟 新增：段落发生风格突变的概率
        genreBendingOverrides?: StyleId[]; // 🌟 新增：段落发生风格突变时的备选曲风
        preferJPopProgressions?: boolean; // 🌟 新增：是否偏好 J-Pop 和声进行
        sectionTransitionPassingProb?: number; // 🌟 HC-2：段落交界经过和弦概率（默认 0.45）
        maxBorrowedChords?: number;            // 🌟 HC-5：全曲借调和弦上限（默认 2，作为"高光时刻"不滥用）
        extensionProbability?: number;         // 和弦扩展着色概率。0.4=Pop, 0.6=EDM, 0.8=JPop, 1.0=Jazz/Neo-Soul
    };
    rhythm: { densityBase?: [number, number]; syncopationWeight?: number; restProbability?: number; disruptionProbability?: number; humanize?: number; swingRatio?: number; swingSubdivision?: 0.5 | 0.25; strictGrid?: boolean; grooveTemplate?: RhythmCell[]; approachNoteProb?: number; grooveBankPool?: GrooveBankDef[]; chordAnticipation?: number; drumPatterns?: DrumPattern[]; };
    melody?: {
        stepwiseRatio?: number;
        maxJumpInterval?: number;
        tensionTolerance?: number;
        mutationProbability?: number;
        mutationPool?: Array<'inversion' | 'augmentation' | 'truncation' | 'retrograde' | 'diminution'>;
        pentatonicPreference?: number;
        extensionPreference?: number;
        chromaticPassingProbability?: number;
        chromaticApproachProbability?: number;   // 强拍半音趋近概率（默认 0.15）
        passingToneChainProbability?: number;    // 大音程经过音填充概率（默认 0.12）
        harmonicGravityStrength?: number;        // 和弦功能引力强度 0-1（默认 0.3）
        leapResolutionThreshold?: number; // 🌟 新增：多大的音程被视为大跳并需要反向解决
        hookLeapChance?: number; // 🌟 d1 实验：downbeat 主动触发 hook leap 的概率（0~1，默认 0.4）— AuraRadio 移植
        syncopationResolution?: 'strict' | 'loose';
        inflectionProbability?: number;
        pentatonicShiftProbability?: number;
        anchorProbability?: number; // 🌟 新增：同音反复的概率
        riffDrivenProbability?: number; // 🌟 新增：段落由 Riff 驱动的概率
        sectionalRegisterProfile?: {
            verse: [number, number]; // e.g., [60, 72] (C4 to C5)
            preChorus: [number, number];
            chorus: [number, number];
            solo: [number, number];
        };
        breathingRoomProbability?: number; // 🌟 新增：强制休止符/呼吸空间的概率
        callAndResponseProbability?: number; // 🌟 新增：使用呼应手法的概率
        // 🌟 层级动机系统：PhraseGroup 长度配置
        phraseLengthProfile?: PhraseLengthProfile;
        motifRecipes?: {
            pickup: number[][];
            body: number[][];
            tail: number[][];
        };
        // --- 旋律技法插槽 (Vocal Techniques Slot) ---
        laidBackTimingMax?: number;       // 拖拍最大偏移量（拍）。0=精准，0.12=重度拖拍(R&B)，负值=抢拍(Punk)
        extensionTargeting?: boolean;     // 靶向延伸音(9/11)。true=R&B/Neo-Soul，false=流行/摇滚
        melismaProbability?: number;      // 转音瀑布触发概率。0=禁止，0.35=R&B高频
        sequenceFreezeRhythm?: boolean;   // vary/resolve 变奏时冻结节奏DNA仅做音程模进
        chordMelodyProbability?: number;  // ChordMelody 织体触发概率。0=不使用，0.7=Lo-fi/Neo-Soul
    };
    contrast?: { versePitchOffset: number; verseDensityMultiplier: number; chorusPitchOffset?: number; };
    modulation?: { probability: number; targetSection: 'Ending_Verse' | 'Final_Chorus' | 'Chorus'; intervalPool: number[]; };
    orchestration: {
        melodyInstruments: string[];
        chordInstruments: string[];
        bassInstruments: string[];
        drumInstruments: string[];
        counterMelodyInstruments: string[];
        texturePool?: Array<'Block' | 'Arpeggio' | 'Pulsing' | 'WalkingBass' | 'Guitar_Strum' | 'Rhythmic' | 'Pad' | 'Riff' | 'Octave_Melody_Bass' | 'String_Ostinato' | 'Water_Arpeggio' | 'ChordMelody'>;
        drumProbability?: number; // 🌟 新增：鼓组出场率，彻底解耦
        counterMelodyProbability?: number; // 副旋律出场率
        fillStyle?: 'micro' | 'standard' | 'heavy' | 'electronic'; // 🌟 新增：加花风格
        vocalProbability?: number; // 🌟 新增：主唱出场率
        outroRingOutProbability?: number; // 🌟 新增：尾奏使用 BigRingOut 的概率
        allowTradingFours?: boolean; // 🌟 新增：是否允许乐器对话 (Trading Fours)
        allowIntroRiffs?: boolean; // 🌟 新增：是否允许前奏 Riff
        allowRitardando?: boolean; // 🌟 新增：是否允许结尾渐慢
        allowDrumless?: boolean; // 🌟 新增：是否允许无鼓编制
        allowBassless?: boolean; // 🌟 新增：是否允许无贝斯编制
        grooveRatio?: { foundation: number; comping: number; color: number; }; // 🌟 新增：律动比例控制器
        idiomPreferences?: {
            counterMelodyStyle?: 'sustained' | 'melodic' | 'rhythmic' | 'arpeggiated';
            pianoStyle?: 'block-chord' | 'arpeggiated' | 'rhythmic' | 'sparse';
            drumStyle?: 'steady' | 'syncopated' | 'sparse' | 'high-energy' | 'acoustic-swing';
            bassStyle?: 'steady' | 'syncopated' | 'melodic' | 'sparse' | 'riff-driven';
            riffStyle?: 'melodic' | 'rhythmic' | 'arpeggiated' | 'chordal' | 'default';
            vocalStyle?: 'pop' | 'ballad' | 'neosoul' | 'rnb' | 'gospel' | 'choir';
        };
        mixingPreferences?: {
            requireSidechain?: boolean;
            melody?: MixingConfig;
            secondaryMelody?: MixingConfig;
            vocal?: MixingConfig;
            chord?: MixingConfig;
            bass?: MixingConfig;
            drums?: MixingConfig;
            counterMelody?: MixingConfig;
            chorusDepth?: number;
        };
        instrumentBehaviors?: {
            melody?: InstrumentBehavior;
            chord?: InstrumentBehavior;
            bass?: InstrumentBehavior;
            counterMelody?: InstrumentBehavior;
            secondaryMelody?: InstrumentBehavior;
        };
    };
    performance?: { allowedPersonas: string[]; };
    masteringProfileId?: string;
}

/**
 * Phrase Contour — section 级旋律弧线 hint。
 *
 * 由 PhraseContourPlanner 消费，向 TerminalSymbol 注入 targetDegree / contourDir，
 * 让 ToplineEngine 在更大尺度上沿一条规划好的弧线展开旋律。
 *
 * 决策优先级（PhraseContourPlanner.resolvePlan）：
 *   1. section.contour 显式提供 → 完全采用（含 intensity）
 *   2. 仅 section.sectionType 有 → 走内部 DEFAULT_CONTOUR_BY_SECTION 表
 *   3. 两者皆无 → 退化为 'flat'（实质 no-op）
 *
 * intensity 缺省 → energyLevel / 10（[0, 1] 钳制）。
 */
export type ContourArchetype = 'flat' | 'ascent' | 'descent' | 'arch' | 'wave';

export interface ContourSpec {
    archetype: ContourArchetype;
    /** arch 专用：峰位 ∈ [0, 1]。其他 archetype 忽略。默认 0.5。
     *  Chorus 默认 0.6（峰偏后）；Drop 默认 0.1（峰立刻落地）。 */
    peakAt?: number;
    /** wave 专用：完整周期数。其他 archetype 忽略。默认 1。 */
    cycles?: number;
    /** 注入强度 ∈ [0, 1]。缺省时由 section.energyLevel / 10 决定。
     *  0 = 不注入任何 hint（planner 透明）；1 = 每个结构音都注入。 */
    intensity?: number;
}

// CONSTITUTION CHAPTER I — SectionMetadata 已迁移至 ./ir/index.ts（顶部统一 re-export）。

export interface MixingConfig {
    pan?: number; // -1 (left) to 1 (right)
    reverb?: number; // 0 to 1 (send level)
    volume?: number; // dB offset (e.g., -6 to +6)
    delay?: number; // 0 to 1 (send level)
    chorus?: number; // 0 to 127 (MIDI CC 93)
}

export interface EnsembleDraft {
    vocalSound?: string;
    melodySound: string;
    secondaryMelodySound?: string | null;
    chordSound: string | null;
    bassSound: string | null;
    drumSound: string | null;
    counterMelodySound: string | null;
    filterSweep?: string;
    mixing?: {
        vocal?: MixingConfig;
        melody?: MixingConfig;
        secondaryMelody?: MixingConfig;
        chord?: MixingConfig;
        bass?: MixingConfig;
        drums?: MixingConfig;
        counterMelody?: MixingConfig;
    };
    roster?: BandRoster; // 🌟 虚拟乐队具体名单（每个槽位的乐手智能体）
}

// --- 乐器语汇约束 (Instrument Idiom) ---
// 抽离乐器的物理/演奏限制为纯数据，让生成引擎通过查表而非 if/switch 写死偏见。
// 同一乐器在主奏(Lead)与伴奏(Comping)时演奏法完全不同，因此拆成两个子接口。
//
// LeadIdiom — 旋律层：呼吸换气 + 拟人化（力度抖动 / 踏板感连奏 / 倚音）
//   驱动 ToplineEngine：管乐/人声 needsBreathing；钢琴 humanizeVelocity + pianoPedalRatio + graceNoteProbability
// CompingIdiom — 伴奏层：扫弦延迟 / 切分 pattern / Drop-2 开放排列
//   驱动 TextureMapper 的 voicing 排列与切分律动。
export interface LeadIdiom {
    // 呼吸约束（管乐/人声）
    needsBreathing: boolean;
    breathPhraseLength?: number;
    breathTriggerBeat?: number;
    breathProbability?: number;
    // 拟人化与演奏技法（钢琴/吉他）
    humanizeVelocity?: number;     // 力度随机微调幅度（如 0.05 / 0.1）
    /** 阻尼器踏板系数 — 仅钢琴族裔生效（0=干 / 1=自然踏板 / >1=过踏被和弦边界硬钳）。 */
    pianoPedalRatio?: number;
    graceNoteProbability?: number; // 大跳时插入倚音（装饰音）的概率
    octaveDoubling?: boolean;      // 允许主奏在重音/高能段开启下方八度叠置
}

export interface CompingIdiom {
    strumDelay: number;
    compingPatterns: number[][];   // Pattern 池：TextureMapper 按小节索引轮换，消除机械重复
    arpeggioPatterns?: (number | null)[][]; // 支持带休止符(null)的琶音音型轨迹
    compingDuration: number;
    allowDrop2: boolean;
    textureType?: 'block' | 'arpeggio' | 'mixed' | 'comping';
    textureProbabilities?: { block: number, arpeggio: number, comping: number };
}

// AtmosphereConfig — 氛围层：长音 pad / 合唱 / 弦乐铺底的演奏特性
//   驱动 AtmosphereConfig 渲染器（Phase 1 MVP）：长持续 voicing + 软起音 + 力度偏弱
export interface AtmosphereConfig {
    /** 起音软度（0 = 瞬发 / 1 = 极慢淡入，约 1 拍） */
    attackSoftness: number;
    /** 拖尾长度比例（相对和弦持续时长；1 = 整段持续；>1 = 过踏延至下一和弦 head） */
    releaseRatio: number;
    /** 同时发声的 voice 数（pad 典型 3~5） */
    voiceCount: number;
    /** 力度范围（pad 偏弱，典型 [40, 80]） */
    velocityRange: [number, number];
    /** 是否在和弦切换时做交叉淡入淡出（避免硬切） */
    crossfade: boolean;
    /** 八度叠加：true = root 下方加一个八度（厚度感） */
    octaveLayering?: boolean;
}

export interface InstrumentIdiom {
    id: string;
    lead: LeadIdiom;
    comping: CompingIdiom;
    /** 氛围层（仅 Pad/Strings/EP 等氛围类乐器配置；其他乐器留空） */
    atmosphere?: AtmosphereConfig;
}

// ============================================================
// 🎸 虚拟乐队架构 (Virtual Band Architecture)
// ============================================================
// Lead 乐手的 genre 具有"全曲定调权"；其余 4 个槽位的乐手仅贡献个性微操。
// PANGEA = 乐器物理底线（无曲风偏见），Musician = 乐器底线 + 擅长曲风 + 个人特质。
// assembleActiveIdiom() 把基底 + 特质 deep merge 成最终图纸传给生成引擎。

// 1. 乐队槽位 — 见下方 BandRole enum（6 个职能位置：Vocal/MainInst/Accomp/Bass/Drums/Atmosphere）

// 2. 个性化特质 (Personnel Traits) — 用于叠加和覆盖 Pangea 基底
export interface PersonnelTraits {
    leadOverrides?: Partial<LeadIdiom>;             // 作为主奏时的微操习惯
    compingOverrides?: Partial<CompingIdiom>;       // 作为伴奏时的微操习惯
    atmosphereOverrides?: Partial<AtmosphereConfig>; // 作为氛围乐手时的微操习惯
}

// 3. 盘古乐器基底 (Pangea Instrument) — 定义物理底线
export interface PangeaInstrument {
    id: string;
    baseLead: LeadIdiom;
    baseComping: CompingIdiom;
    baseAtmosphere?: AtmosphereConfig;  // 仅 Pad / Strings / EP 等氛围类乐器配置
}

// 4. 乐手智能体 (The Musician) — 参考架构移植：等价于 MusicianProfile 的精简表示
//    用于 BandRoster / EnsembleDraft.roster；MUSICIAN_POOL 中数据兼容 Profile 形状。
export interface Musician {
    id: string;                   // 如 'accomp_alex_pop'
    name: string;                 // 显示名称
    genre: StyleId;               // 擅长曲风（坐在 Lead 槽位时具有全曲定调权）= styleId
    instrumentRef: string;        // 指向 Pangea 字典中基础乐器的 ID（旧字段，过渡期保留）
    /**
     * 乐器族裔 — 决定 ToplineEngine Pass 3 的 sustain 策略（damper pedal / monophonic legato / pad envelope）。
     * 必填：新乐手卡上岗前必须显式声明族裔，避免 pedal 物理被错套到管乐/人声/吉他上。
     */
    instrumentFamily: InstrumentFamily;
    defaultSound: string;         // 默认挂载的 GM 音色名（如 'Acoustic_Grand'）
    /**
     * B3：可选 GM 程式号显式覆盖（0~127）。
     * 设置时优先于 defaultSound → GM 的查表映射；UI 端 forcedGmPrograms 又会进一步覆盖此字段。
     * 主要用例：同一 musician card 在不同曲风下挂不同音色（暂未启用，预留）。
     */
    gmProgramOverride?: number;
    personnel: PersonnelTraits;   // 旧形状：作主奏/伴奏时的微操偏好（驱动 TextureMapper）

    // 🌟 参考架构 Persona 字段（驱动未来 Idiom 引擎）
    role: BandRole;               // 主要角色（默认上岗位置）
    /**
     * 能胜任的所有职能（BandEngine 用于 roster 验证 / 动态升降）。
     * 例：钢琴手 = [MainInst, Accomp]；电钢琴手 = [MainInst, Accomp, Atmosphere]；
     *     贝斯手 = [Bass]；鼓手 = [Drums]；Pad 乐手 = [Atmosphere]
     * 必须包含 role 字段值（约束："主要角色"必然在能胜任清单内）。
     */
    eligibleRoles: BandRole[];
    instrumentId: number;         // InstrumentRegistry key (0=GrandPiano / 1=EPiano / 2=EBass / 3=Drums / 4=Pad)
    persona: MusicianPersona;
    description?: string;
}

// 5. 乐队阵容名单 (Band Roster)
//    全部槽位可选；缺槽 = null/undefined（BandEngine + UI 按此判断）
//    字段名与 BandRole enum 对齐（mainInst / accomp / atmosphere 替代旧 lead / comping / 无）
export interface BandRoster {
    vocal?: Musician | null;
    mainInst?: Musician | null;
    accomp?: Musician | null;
    bass?: Musician | null;
    drums?: Musician | null;
    atmosphere?: Musician | null;
}

// 6. BandEngine 编曲输出 — Stage5Layering 的输入契约
// ============================================================
//
// 设计哲学（与用户决议对齐）：
//   - **乐器透明化**：每个乐器（钢琴/贝斯/鼓/Pad）的具体演奏参数（左右手织体 /
//     walking 模式 / pad 长度等）由各自 Idiom 模块自行解释 instrumentSpecificParams: unknown，
//     BandEngine 不感知乐器实现细节。新增乐器只需扩对应 Idiom 的 *Params 内部 interface，
//     无需改 types.ts 或 BandEngine。
//   - **段落级粒度**：sectionPlans[] 与 sections[] 平行索引，每段可独立决策织体 / 协作模式。
//   - **角色升降显性化**：ActiveMusician.assignedRole 可能与 card.role 不同（如钢琴 Accomp
//     在无 Vocal 时升格 MainInst），由 BandEngine.Pass B 决定。
// ============================================================

/**
 * RoleAssignment — 单段单职能的演奏决策
 *
 * 每职能的具体参数由乐器自己解释 instrumentSpecificParams（unknown 强制类型守卫），
 * 渲染器消费时做 `as PianoAccompParams` / `as BassParams` 等向下转型。
 */
export interface RoleAssignment {
    /** 上岗乐手 ID（指向 MUSICIAN_POOL 卡牌） */
    musicianId: string;
    /** 段落能量乘子（来自 section.energyLevel 归一化到 [0, 1]），渲染器用于力度缩放 */
    intensityScale: number;
    /** 乐器特定参数（钢琴 = PianoAccompParams / 贝斯 = BassParams / 鼓 = DrumsParams / Pad = AtmosphereParams） */
    instrumentSpecificParams: unknown;
}

/**
 * SectionPlan — 单段落的全职能演奏分配
 *
 * assignments 用 Partial<Record<BandRole, ...>>：本段未发声的职能不出现在 map 里
 * （由 ConductorMask 决定 — Intro 没鼓 → drums key 不存在）。
 */
export interface SectionPlan {
    sectionIdx: number;
    assignments: Partial<Record<BandRole, RoleAssignment>>;
}

/**
 * ActiveMusician — 实际上岗的乐手快照
 *
 * roster 里非 null 且通过 eligibleRoles 验证的乐手会进这个列表。
 * assignedRole 可能与 card.role 不同（钢琴 Accomp 升格 MainInst 等）。
 */
export interface ActiveMusician {
    card: Musician;
    assignedRole: BandRole;
    /** 标记是否从 Accomp 升格为 MainInst（影响伴奏 ↔ 主奏的行为切换） */
    promotedFromAccomp?: boolean;
}

/**
 * BandPlan — BandEngine 的最终输出
 *
 * Stage5Layering 消费此结构，按 sectionPlans[sectionIdx].assignments[role]
 * 决定每段每职能调用哪个 Idiom + 传什么参数。
 */
export interface BandPlan {
    /** 全曲段落级演奏决策矩阵（长度 === sections.length） */
    sectionPlans: SectionPlan[];
    /** 实际上线的乐手（roster 里非 null 且通过 eligibleRoles 验证的） */
    activeMusicians: ActiveMusician[];
}

export interface GeneratedTrack {
    chords: GeneratedChord[]; vocal?: NoteData[]; melody: NoteData[]; counterMelody?: NoteData[]; drums?: NoteData[]; bpm: number; key: string;
    keyOffset: number; tonality: Tonality; timeSignature: [number, number]; sections: SectionMetadata[];
    blockIndex: number; absoluteStartBeat: number; hasIntro: boolean;
    preSelectedPalette?: EnsembleDraft;
    globalRiff?: NoteData[]; // 全局核心 Riff (Option A)
    processedUserMotif?: NoteData[];
    motifRole?: 'Foreground' | 'Middleground' | 'Background';
    /** Comping / 伴奏织体轨（Phase 3 Stage 5 输出）— Pitch Space: RELATIVE。
     *  AbsoluteTransposer 后续映射到 ArrangedTrack.pianoRH，加 keyOffset 后送 MIDI。 */
    accompaniment?: NoteData[];
    /** 低音轨（Phase 3 Stage 5 输出）— Pitch Space: RELATIVE。
     *  AbsoluteTransposer 后续映射到 ArrangedTrack.pianoLH（或独立电贝斯轨），加 keyOffset 后送 MIDI。 */
    bass?: NoteData[];
    /** 氛围轨（Phase 1 BandEngine 输出）— Pitch Space: RELATIVE。
     *  Pad / Strings / Choir 长音铺底，AbsoluteTransposer 映射到 ArrangedTrack.atmosphere。 */
    atmosphere?: NoteData[];
}

export type InstrumentRole =
    | 'melody'
    | 'vocal'
    | 'chord'
    | 'bass'
    | 'drums'
    | 'counter'
    | 'secondary';

// CONSTITUTION CHAPTER I — MusicContext 已迁移至 ./ir/index.ts（顶部统一 re-export）。

export interface GenerationOptions {
    styleId?: StyleId;
    seed?: number;
    length?: 'short' | 'medium' | 'long';
    userMotifRoot?: number;
    processedUserMotif?: any[];
    motifRole?: 'Foreground' | 'Middleground' | 'Background';
    detectedTimeSignature?: [number, number];
    detectedTonality?: Tonality;
}
export interface TempoCurve {
    startTick: number;
    endTick: number;
    startBpm: number;
    endBpm: number;
    curveType: 'linear' | 'exponential';
}

export interface ArrangedTrack {
    bpm: number; key: string; absoluteStartBeat: number; timeSignature?: [number, number];
    styleId?: StyleId;
    vocal?: NoteData[]; melody: NoteData[]; secondaryMelody?: NoteData[]; pianoLH: NoteData[]; pianoRH: NoteData[]; drums?: NoteData[]; counterMelody?: NoteData[]; userMotif?: NoteData[];
    /** 氛围轨（Pad/Strings/Choir）— MidiConverter 路由到 CHANNEL_ATMOSPHERE */
    atmosphere?: NoteData[];
    /** V5.3 — 独立电贝斯轨（Bass musician 输出）— MidiConverter 路由到 CHANNEL_ELECTRIC_BASS */
    electricBass?: NoteData[];
    palette?: EnsembleDraft;
    sections?: SectionMetadata[];
    globalRiff?: NoteData[]; // 全局核心 Riff (Option A)
    chords?: GeneratedChord[]; // 全曲和弦进行
    tempoCurves?: TempoCurve[]; // 渐慢/渐快曲线
    introFilterSweep?: boolean; // 🌟 ST-3: Intro 低通涌动标记，PlaybackEngine 读取后注入 CC74 渐变
    /**
     * B3：动态 GM 程式覆盖（0~127）。每个 key 对应 MidiConverter 内一条轨。
     * AbsoluteTransposer 由 context.gmProgramOverrides 透传过来。
     * MidiConverter 读取后用 override 覆盖文件级 GM_PROGRAM_* 默认。
     * 缺省 / 字段缺失 → 走默认（保 V5.x 行为零回归）。
     */
    gmProgramOverrides?: {
        melody?: number;
        pianoRH?: number;
        pianoLH?: number;
        drums?: number;
        atmosphere?: number;
        electricBass?: number;
    };
}

// ============================================================
// 数值枚举 & 查找表（Phase 1 cherry-pick：类型安全基础设施）
// 当前阶段仅添加定义，不修改现有代码的类型签名。
// Phase 4 将逐步把 string 类型迁移到这些枚举。
// ============================================================

// --- Tonality 数值枚举 ---
// Harmonic_Minor / Phrygian：DarkSynth / Metal / Flamenco / Neoclassical 常用调式扩展。
export enum Tonality {
    Major = 0, Minor = 1, Major_Pentatonic = 2, Minor_Pentatonic = 3,
    Blues = 4, Dorian = 5, Mixolydian = 6, Melodic_Minor = 7, Lydian = 8,
    Harmonic_Minor = 9, Phrygian = 10
}

export const TonalityName: string[] = [];
TonalityName[Tonality.Major] = 'Major';
TonalityName[Tonality.Minor] = 'Minor';
TonalityName[Tonality.Major_Pentatonic] = 'Major_Pentatonic';
TonalityName[Tonality.Minor_Pentatonic] = 'Minor_Pentatonic';
TonalityName[Tonality.Blues] = 'Blues';
TonalityName[Tonality.Dorian] = 'Dorian';
TonalityName[Tonality.Mixolydian] = 'Mixolydian';
TonalityName[Tonality.Melodic_Minor] = 'Melodic_Minor';
TonalityName[Tonality.Lydian] = 'Lydian';
TonalityName[Tonality.Harmonic_Minor] = 'Harmonic_Minor';
TonalityName[Tonality.Phrygian] = 'Phrygian';

/** 音阶音程查找表：SCALE_INTERVALS[tonality] → number[] (半音间隔) */
export const SCALE_INTERVALS: number[][] = [];
SCALE_INTERVALS[Tonality.Major]            = [0, 2, 4, 5, 7, 9, 11];
SCALE_INTERVALS[Tonality.Minor]            = [0, 2, 3, 5, 7, 8, 10];
SCALE_INTERVALS[Tonality.Major_Pentatonic] = [0, 2, 4, 7, 9];
SCALE_INTERVALS[Tonality.Minor_Pentatonic] = [0, 3, 5, 7, 10];
SCALE_INTERVALS[Tonality.Blues]            = [0, 3, 5, 6, 7, 10];
SCALE_INTERVALS[Tonality.Dorian]           = [0, 2, 3, 5, 7, 9, 10];
SCALE_INTERVALS[Tonality.Mixolydian]       = [0, 2, 4, 5, 7, 9, 10];
SCALE_INTERVALS[Tonality.Melodic_Minor]    = [0, 2, 3, 5, 7, 9, 11];
SCALE_INTERVALS[Tonality.Lydian]           = [0, 2, 4, 6, 7, 9, 11];
SCALE_INTERVALS[Tonality.Harmonic_Minor]   = [0, 2, 3, 5, 7, 8, 11];
SCALE_INTERVALS[Tonality.Phrygian]         = [0, 1, 3, 5, 7, 8, 10];

// --- ChordQuality 数值枚举 ---
export enum ChordQuality {
    Major = 0, Minor = 1, Diminished = 2, Diminished7 = 3, Augmented = 4,
    Dominant7 = 5, Minor7 = 6, Major7 = 7, HalfDiminished = 8,
    Sus4 = 9, Dominant7Sus4 = 10, Add9 = 11, Minor9 = 12, Major9 = 13,
    Dominant9 = 14, Minor11 = 15, Dominant13 = 16
}

export const ChordQualityName: string[] = [];
ChordQualityName[ChordQuality.Major] = 'Major';
ChordQualityName[ChordQuality.Minor] = 'Minor';
ChordQualityName[ChordQuality.Diminished] = 'Diminished';
ChordQualityName[ChordQuality.Diminished7] = 'Diminished7';
ChordQualityName[ChordQuality.Augmented] = 'Augmented';
ChordQualityName[ChordQuality.Dominant7] = 'Dominant7';
ChordQualityName[ChordQuality.Minor7] = 'Minor7';
ChordQualityName[ChordQuality.Major7] = 'Major7';
ChordQualityName[ChordQuality.HalfDiminished] = 'HalfDiminished';
ChordQualityName[ChordQuality.Sus4] = 'Sus4';
ChordQualityName[ChordQuality.Dominant7Sus4] = 'Dominant7Sus4';
ChordQualityName[ChordQuality.Add9] = 'Add9';
ChordQualityName[ChordQuality.Minor9] = 'Minor9';
ChordQualityName[ChordQuality.Major9] = 'Major9';
ChordQualityName[ChordQuality.Dominant9] = 'Dominant9';
ChordQualityName[ChordQuality.Minor11] = 'Minor11';
ChordQualityName[ChordQuality.Dominant13] = 'Dominant13';

/** 和弦音程查找表：CHORD_INTERVALS[quality] → number[] */
export const CHORD_INTERVALS: number[][] = [];
CHORD_INTERVALS[ChordQuality.Major]          = [0, 4, 7];
CHORD_INTERVALS[ChordQuality.Minor]          = [0, 3, 7];
CHORD_INTERVALS[ChordQuality.Diminished]     = [0, 3, 6];
CHORD_INTERVALS[ChordQuality.Diminished7]    = [0, 3, 6, 9];
CHORD_INTERVALS[ChordQuality.Augmented]      = [0, 4, 8];
CHORD_INTERVALS[ChordQuality.Dominant7]      = [0, 4, 7, 10];
CHORD_INTERVALS[ChordQuality.Minor7]         = [0, 3, 7, 10];
CHORD_INTERVALS[ChordQuality.Major7]         = [0, 4, 7, 11];
CHORD_INTERVALS[ChordQuality.HalfDiminished] = [0, 3, 6, 10];
CHORD_INTERVALS[ChordQuality.Sus4]           = [0, 5, 7];
CHORD_INTERVALS[ChordQuality.Dominant7Sus4]  = [0, 5, 7, 10];
CHORD_INTERVALS[ChordQuality.Add9]           = [0, 2, 4, 7];
CHORD_INTERVALS[ChordQuality.Minor9]         = [0, 3, 7, 10, 14];
CHORD_INTERVALS[ChordQuality.Major9]         = [0, 4, 7, 11, 14];
CHORD_INTERVALS[ChordQuality.Dominant9]      = [0, 4, 7, 10, 14];
CHORD_INTERVALS[ChordQuality.Minor11]        = [0, 3, 7, 10, 14, 17];
CHORD_INTERVALS[ChordQuality.Dominant13]     = [0, 4, 7, 10, 14, 21];

/** 位掩码：快速分类检查 */
export const CQ_IS_MINOR = (1 << ChordQuality.Minor) | (1 << ChordQuality.Minor7) | (1 << ChordQuality.Minor9) | (1 << ChordQuality.Minor11);
export const CQ_IS_MAJOR = (1 << ChordQuality.Major) | (1 << ChordQuality.Major7) | (1 << ChordQuality.Major9);
export const CQ_IS_DOM   = (1 << ChordQuality.Dominant7) | (1 << ChordQuality.Dominant7Sus4) | (1 << ChordQuality.Dominant9) | (1 << ChordQuality.Dominant13);
export const CQ_IS_DIM   = (1 << ChordQuality.Diminished) | (1 << ChordQuality.Diminished7) | (1 << ChordQuality.HalfDiminished);

// ============================================================
// Chord-Scale Theory（Phase 6.3.5）
// ============================================================
// 把每个 ChordQuality 映射到伯克利体系下的"局部特征音阶"。
// ToplineEngine.colorPcMask 用这张表（替代原先生搬全局 SCALE_INTERVALS[tonality]
// 取交集的写法），从根本上规避借用/副属和弦时与全局调内自然音的 Minor 9th 撞音。
//
// 数据组织：纯数组、索引 = ChordQuality 数值、值为半音步长 — 与 CHORD_INTERVALS
// 完全同构，C 移植直接复制即可，无哈希 / 无运行期解析。
//
// 映射依据（爵士/流行实践）：
//   Major / Major7 / Add9 / Major9         → Ionian      [0,2,4,5,7,9,11]
//   Minor / Minor7 / Minor9 / Minor11      → Dorian      [0,2,3,5,7,9,10]
//   Dominant7 / Dominant9 / Dominant13 /
//     Dominant7Sus4                        → Mixolydian  [0,2,4,5,7,9,10]
//   HalfDiminished                         → Locrian     [0,1,3,5,6,8,10]
//   Diminished / Diminished7               → 全半减音阶  [0,2,3,5,6,8,9,11]
//   Sus4 / Augmented（未明确归类）         → Ionian 兜底
//
// 注意：本表里的步长是相对 chord.root 的，ToplineEngine 会做
//       (chord.root + step) % 12 转换到 PC，禁止预补偿 keyOffset（K-2）。
export const CHORD_SCALE_INTERVALS: number[][] = [];
CHORD_SCALE_INTERVALS[ChordQuality.Major]          = [0, 2, 4, 5, 7, 9, 11];
CHORD_SCALE_INTERVALS[ChordQuality.Minor]          = [0, 2, 3, 5, 7, 9, 10];
CHORD_SCALE_INTERVALS[ChordQuality.Diminished]     = [0, 2, 3, 5, 6, 8, 9, 11];
CHORD_SCALE_INTERVALS[ChordQuality.Diminished7]    = [0, 2, 3, 5, 6, 8, 9, 11];
CHORD_SCALE_INTERVALS[ChordQuality.Augmented]      = [0, 2, 4, 5, 7, 9, 11];
CHORD_SCALE_INTERVALS[ChordQuality.Dominant7]      = [0, 2, 4, 5, 7, 9, 10];
CHORD_SCALE_INTERVALS[ChordQuality.Minor7]         = [0, 2, 3, 5, 7, 9, 10];
CHORD_SCALE_INTERVALS[ChordQuality.Major7]         = [0, 2, 4, 5, 7, 9, 11];
CHORD_SCALE_INTERVALS[ChordQuality.HalfDiminished] = [0, 1, 3, 5, 6, 8, 10];
CHORD_SCALE_INTERVALS[ChordQuality.Sus4]           = [0, 2, 4, 5, 7, 9, 11];
CHORD_SCALE_INTERVALS[ChordQuality.Dominant7Sus4]  = [0, 2, 4, 5, 7, 9, 10];
CHORD_SCALE_INTERVALS[ChordQuality.Add9]           = [0, 2, 4, 5, 7, 9, 11];
CHORD_SCALE_INTERVALS[ChordQuality.Minor9]         = [0, 2, 3, 5, 7, 9, 10];
CHORD_SCALE_INTERVALS[ChordQuality.Major9]         = [0, 2, 4, 5, 7, 9, 11];
CHORD_SCALE_INTERVALS[ChordQuality.Dominant9]      = [0, 2, 4, 5, 7, 9, 10];
CHORD_SCALE_INTERVALS[ChordQuality.Minor11]        = [0, 2, 3, 5, 7, 9, 10];
CHORD_SCALE_INTERVALS[ChordQuality.Dominant13]     = [0, 2, 4, 5, 7, 9, 10];

/** quality → 局部音阶可读名（UI / 调试用，索引 = ChordQuality 数值） */
export const CHORD_SCALE_NAME: string[] = [];
CHORD_SCALE_NAME[ChordQuality.Major]          = 'Ionian';
CHORD_SCALE_NAME[ChordQuality.Minor]          = 'Dorian';
CHORD_SCALE_NAME[ChordQuality.Diminished]     = 'Whole-Half Diminished';
CHORD_SCALE_NAME[ChordQuality.Diminished7]    = 'Whole-Half Diminished';
CHORD_SCALE_NAME[ChordQuality.Augmented]      = 'Ionian';
CHORD_SCALE_NAME[ChordQuality.Dominant7]      = 'Mixolydian';
CHORD_SCALE_NAME[ChordQuality.Minor7]         = 'Dorian';
CHORD_SCALE_NAME[ChordQuality.Major7]         = 'Ionian';
CHORD_SCALE_NAME[ChordQuality.HalfDiminished] = 'Locrian';
CHORD_SCALE_NAME[ChordQuality.Sus4]           = 'Ionian';
CHORD_SCALE_NAME[ChordQuality.Dominant7Sus4]  = 'Mixolydian';
CHORD_SCALE_NAME[ChordQuality.Add9]           = 'Ionian';
CHORD_SCALE_NAME[ChordQuality.Minor9]         = 'Dorian';
CHORD_SCALE_NAME[ChordQuality.Major9]         = 'Ionian';
CHORD_SCALE_NAME[ChordQuality.Dominant9]      = 'Mixolydian';
CHORD_SCALE_NAME[ChordQuality.Minor11]        = 'Dorian';
CHORD_SCALE_NAME[ChordQuality.Dominant13]     = 'Mixolydian';

// --- SectionType 数值枚举 ---
export enum SectionType {
    Intro = 0, Verse = 1, PreChorus = 2, Chorus = 3, Bridge = 4,
    Outro = 5, Break = 6, Breakdown = 7, BuildUp = 8, Drop = 9,
    PreOutro = 10, Solo_Bridge = 11
}

// 数值枚举 → 字符串名映射，仅供需要 hashmap key 的旧代码使用
// 新代码应直接用 SectionType.X 数值比较
export const SectionTypeName: Record<SectionType, string> = {
    [SectionType.Intro]: 'Intro',
    [SectionType.Verse]: 'Verse',
    [SectionType.PreChorus]: 'PreChorus',
    [SectionType.Chorus]: 'Chorus',
    [SectionType.Bridge]: 'Bridge',
    [SectionType.Outro]: 'Outro',
    [SectionType.Break]: 'Break',
    [SectionType.Breakdown]: 'Breakdown',
    [SectionType.BuildUp]: 'BuildUp',
    [SectionType.Drop]: 'Drop',
    [SectionType.PreOutro]: 'PreOutro',
    [SectionType.Solo_Bridge]: 'Solo_Bridge',
};

// ============================================================
// 🎸 参考架构移植：Persona / Idiom / 演奏数据契约（ALL_SOURCE_CODE.md）
// ============================================================
// 与现有 Pangea+Personnel（Musician/InstrumentIdiom/LeadIdiom/CompingIdiom）并存：
//   - 新形状（MusicianProfile + Persona）专供 Idiom 引擎（Phase 3 移植后）消费
//   - 旧形状（Musician + Personnel）继续给 TextureMapper 提供 chordIdiom 兼容
//   - assembleActiveIdiom() 同时认两种入参（等 Phase 3 后切换）
// ============================================================

/** Persona 演奏轮廓偏好 */
export enum ContourType {
    Upward = 0,
    Downward = 1,
    Alternating = 2,
    Random = 3,
}

/** Bass 左手角色（PianoMotifDNA 消费） */
export enum LHRole {
    Anchor = 0,
    Stride = 1,
    Comp = 2,
    Arp = 3,
    Walking = 4,
}

/** Comping 右手角色（PianoMotifDNA 消费） */
export enum RHRole {
    Block = 0,
    Arp = 1,
    Linear = 2,
    Sparse = 3,
    Comp = 4,
}

/** 段落收尾策略（AbsoluteTransposer 后处理） */
export enum OutroStrategy {
    FadeOut = 0,
    Ritardando = 1,
    SuddenStop = 2,
    MotifDecay = 3,
    Unresolved = 4,
}

/**
 * BandRole — 乐队职能枚举（BandEngine 统一抽象）
 *
 * 6 个职能位置：
 *   Vocal       — 人声主唱（V1 保留接口，暂不实现）
 *   MainInst    — 主奏乐器（旋律）
 *   Accomp      — 伴奏乐器（和声/comping）
 *   Bass        — 低音线
 *   Drums       — 打击乐
 *   Atmosphere  — 氛围声部（Pad/合唱/弦乐铺底）
 *
 * 历史命名兼容：旧 `RoleType.AccompInst` → 新 `BandRole.Accomp`；旧 `BandSlot` 字符串 union 已废弃。
 */
export enum BandRole {
    Vocal = 'vocal',
    MainInst = 'mainInst',
    Accomp = 'accomp',
    Bass = 'bass',
    Drums = 'drums',
    Atmosphere = 'atmosphere',
}

/**
 * 乐器族裔 — 决定 ToplineEngine Pass 3 的 sustain 后处理策略。
 *
 *   - Piano:       真•阻尼器踏板（chord-aware sustain + rest 透明）。pianoPedalRatio 生效。
 *   - Wind / Voice / Guitar / Strings:
 *                  单声部 legato（next-onset 钳 + rest 不透明 — 气息/换弓尊重休止符）。legatoOverlap 生效。
 *   - Pad:         自带 ADSR envelope，跳过 Pass 3（AtmosphereRenderer 单独处理）。
 *   - Bass / Percussion:
 *                  不走 ToplineEngine（BassIdiom / DrumIdiom 自渲染）；占位以便 Musician 卡填字段。
 *   - Other:       未分类，默认跳过 Pass 3（保 grammar 原 duration）。
 *
 * 新增乐器时：先定族裔，再决定 sustain 策略 — 严禁把 pianoPedalRatio 套到非 Piano 族裔上。
 */
export enum InstrumentFamily {
    Piano = 'piano',
    Wind = 'wind',
    Voice = 'voice',
    Guitar = 'guitar',
    Strings = 'strings',
    Pad = 'pad',
    Bass = 'bass',
    Percussion = 'percussion',
    Other = 'other',
}

/** 音乐角色（GlobalVoicer 用，决定每个 pitch class 在和弦内的功能） */
export enum MusicalRole {
    Lead = 'lead',
    Accomp = 'accomp',
    Bass = 'bass',
    Percussion = 'percussion',
    CounterMelody = 'counterMelody',
}

/** Idiom 类型（IdiomDispatcher 路由 key） */
export enum IdiomType {
    PopPiano = 0,
    GenericPiano = 4,
}

/** 乐器物理参数 + 能力声明（参考 InstrumentConfig） */
export interface InstrumentConfig {
    id: number;
    name: string;
    minPitch: number;
    maxPitch: number;
    maxPolyphony: number;
    /** 反浑浊阈值：低于此 pitch 的多音和弦需要 fold 八度 */
    antiMudThreshold: number;
    supportsPitchBend: boolean;
    supportsSlide: boolean;
    isMonophonic: boolean;
    capabilities: MusicalRole[];
}

/** Persona 灵魂卡牌（演奏微操偏好） */
export interface MusicianPersona {
    /** 色彩倾向：0=只用三和弦 / 0.9=狂用 9/11/13 扩展 */
    colorBias: number;
    /** 稀疏倾向：0=密集弹满 / 0.8=只点关键拍位 */
    sparsityTendency: number;
    /** 旋律轮廓偏好（向上/向下/交替/随机） */
    contourPreference: ContourType;
    /** 切分攻击性：0=正拍 / 1=完全反拍 */
    syncopationAssault: number;
    /** 力度区间 [min, max]（0~127） */
    dynamicRange: [number, number];
    /**
     * 钢琴阻尼器踏板系数 — **仅当乐手 instrumentFamily === Piano** 时由 ToplineEngine Pass 3 消费。
     *   0  = 干（grammar duration 不变）
     *   1  = 自然踏板（延音至下一个发声音或和弦边界；rest 透明 — 阻尼器下落需时间）
     *   >1 = 过踏（仍被和弦边界硬钳制）
     * 未设置回落 1.0。其他族裔忽略本字段（请用 legatoOverlap）。零 PRNG 消耗。
     */
    pianoPedalRatio?: number;
    /**
     * 单声部 legato 重叠系数 — 当乐手 instrumentFamily ∈ {Wind, Voice, Guitar, Strings} 时
     * 由 ToplineEngine Pass 3 消费。
     *   0  = 干（grammar duration 不变 — 偏 staccato）
     *   1  = 完全 slur（延音至下一个 slot onset；rest 不透明 — 气息/换弓必须断开）
     *   >1 = 过头（仍被下一个 slot onset 钳）
     * 未设置回落 1.0（默认连贯）。钢琴族裔忽略本字段（请用 pianoPedalRatio）。零 PRNG 消耗。
     */
    legatoOverlap?: number;
    /** 触发签名乐句的概率 */
    signatureLickProb?: number;
    /** V4.1：Oom-Pah Bounce 偏好（0-1）。仅 Solo Piano 模式（bassActive=false）下生效；
     *  0.0=从不 bounce / 0.5=偶尔 / 0.8=Billy 风格大量 bounce */
    bouncePreference?: number;
    /** Phase 2: 大师经典 Licks 库 (RELATIVE pitch space) */
    lickPool?: NoteData[][];
    /** 角色的专属拓扑变异概率（算法折叠核心） */
    topologyConfig?: TopologyConfig;
    /**
     * Master 引用 — 指向 flash/personas 编译产物中的大师 manifest id（如 'BillEvans'）。
     * 配合 masterMode 决定大师 grammar 的接入深度。
     *
     * 未设置 → 走原 PCFGGrammarEngine.expand 路径（风格层提供的 GrammarConfig），与本字段无关。
     */
    masterId?: string;
    /**
     * Master 接入模式（仅当 masterId 非空时生效）：
     *
     *   - 'takeover'（默认）：整段旋律的 TerminalSymbol[] 流由 MasterPhraseRenderer
     *                          从 COMMON_GRAMMAR_ROOTS 抽样产出，**绕过** PCFGGrammarEngine。
     *                          风格层 grammar 静默，大师腔调全程主导。
     *   - 'lick-only'：       PCFGGrammarEngine 正常运行（风格 grammar 是底色），但
     *                          persona.lickPool 预编译自大师 grammar，触发 signatureLickProb
     *                          时拼接进去 — 大师作为"招牌乐句"偶尔甩出来。
     *
     * 缺省 = 'takeover'（向后兼容 v1：仅 masterId 字段引入时即为 takeover 行为）。
     */
    masterMode?: 'takeover' | 'lick-only';
    /**
     * A1：Bass / 钢琴 LH walking 默认 pattern。
     *
     * Bass 角色 (BassIdiom)：未设置 → 退化到 Layer 1（每和弦头 1 击 root + sustain，兼容原行为）。
     * 钢琴 LH (PianoAccompIdiom)：BandEngine 由 MoodRouter.pickWalkPattern 注入，
     *   本字段作为 musician 偏好的兜底（如某位 bass 手习惯 Stride，永远走 Stride）。
     *
     * 值为 WalkPatternId 数值枚举（HalfNote=1 / Stride=2 / Pedal=3 / LatinTumbao=4 等）。
     * 不强类型 import WalkPatternId 是因为 types.ts 不能依赖 data/ 层（架构分层）。
     */
    walkPatternId?: number;
}

// --- 抽象职能与极限压缩结构 (Zero-Copy C-Portability) ---

export enum TerminalKind {
    Rest = 0,
    ChordTone = 1,
    ColorTone = 2,
    ApproachTone = 3
}

/** 对应 C: struct { uint8_t kind:2; uint8_t duration:6; int8_t contourDir:2; uint8_t targetDegree:6; } */
export interface AbstractToken {
    kind: TerminalKind;
    /** 映射为 1~63 的时间切片倍数 */
    duration: number;
    contourDir: 1 | -1 | 0;
    targetDegree: number;
}

export interface GrammarRoot {
    id: number;
    baseWeight: number;
    tokens: AbstractToken[];
}

export interface TopologyConfig {
    /** 倒影概率 0.0 - 1.0 */
    probInvert: number;
    /** 逆行概率 0.0 - 1.0 */
    probReverse: number;
    /** 时值扩展概率 0.0 - 1.0 */
    probExpand: number;
    /** 半音侧滑概率 0.0 - 1.0 */
    probSideSlip: number;
    /** 侧滑幅度（半音，如 -2 到 2） */
    sideSlipRange: number;
    /** 色彩倾向（将 ChordTone 强制提升为 ColorTone 的概率） */
    colorBias: number;
    /** 抢拍/拖拍概率 0.0 - 1.0 */
    probTimeShift?: number;
    /** 抢拍/拖拍的幅度（单位：拍），如 0.25 或 0.5 */
    timeShiftBeats?: number;
}

/**
 * PersonaManifest — Flash 区 Persona 卡牌（模拟 ESP32 XIP 文件系统）
 *
 * 由 scripts/compile-grammars.mjs 离线编译 Impro-Visor 大师语法生成。
 * 写入 flash/personas/<id>.json，运行时 IdiomDispatcher 按需加载。
 *
 * 与 SRAM 区 COMMON_GRAMMAR_ROOTS 的关系：
 *   PersonaManifest 不内联 token 序列，而是通过 customRootIds 引用公共根字典。
 *   多个大师共享同一段骨架时，SRAM 只存一份；persona 仅在 ID 列表里加一个引用。
 *   这是参考 ESP32 SRAM/Flash 隔离的极限压缩策略。
 */
export interface PersonaManifest {
    /** 唯一 ID（也是 JSON 文件名），如 'CharlieParker' */
    id: string;
    /** 显示名 */
    name: string;
    /** 描述（风格简介，仅供 UI / 调试） */
    description?: string;
    /** 引用 COMMON_GRAMMAR_ROOTS 中的 root id 数组，按该 persona 使用频次降序排列 */
    customRootIds: number[];
    /** 派生的拓扑变异参数 — 驱动 TopologyMutator.applyTopologyChain */
    topologyConfig: TopologyConfig;
    /** 原始 (parameter ...) 抽取的全局参数 — 调试与未来扩展（音域 / 律动倾向等） */
    params?: Record<string, number | string | boolean>;
    /** 派生统计指标 — 供 Q+H 监控面板与未来的特征驱动流派融合使用 */
    stats?: {
        totalRules: number;
        totalRoots: number;
        chordToneRatio: number;
        colorToneRatio: number;
        restRatio: number;
    };
}

/** 乐手 Profile（移植自参考 MusicianProfile） */
export interface MusicianProfile {
    id: string;
    name: string;
    role: BandRole;
    styleId: StyleId;
    instrumentId: number;
    persona: MusicianPersona;
    description: string;
}

/** 运行时招募的乐手（精简 Profile） */
export interface BandMusician {
    id: string;
    role: BandRole;
    styleId: StyleId;
    instrumentId: number;
    persona: MusicianPersona;
}

/** 钢琴动机 DNA（BaseAccompIdiom 消费） */
export interface PianoMotifDNA {
    voicingPreference: number;   // 0~1
    rhythmicAnchor: number;      // 0~1
    contour: ContourType;
    densityBaseline: number;     // 0~1
    lhRole: LHRole;
    rhRole: RHRole;
    interlock: number;           // 0~1
}

/** 律动 DNA（参考 GrooveDNA 接口；与本工程现存 SectionMetadata.grooveDNA: number[] 同名不同形）*/
export interface RefGrooveDNA {
    anchors: number[];
    density: number;
    intensity: number;
    pianoMotifDNA?: PianoMotifDNA;
}

/** GlobalVoicer 输出：每个和弦的"音功能分配" */
export interface ToneAllocation {
    pitchClass: number;     // 0~11
    role: MusicalRole;
    isEssential: boolean;
    isTension: boolean;
}

export interface GlobalHarmonicFrame {
    startBeat: number;
    endBeat: number;
    chord: GeneratedChord;
    toneAllocations: ToneAllocation[];
    pitchScale: number[];
}

// ============================================================
// 全曲结构规划器数据契约（ConductorPlanner 消费）
// ============================================================
// C 移植目标：定长结构体数组，MAX_SECTIONS = 16。
// 复用上方 SectionType 数值枚举（已包含 Intro/Verse/PreChorus/Chorus/Bridge/Outro
// 以及 EDM 模板所需的 BuildUp/Drop/Break），无需重复定义。

/** 对应 C: struct { uint8_t type; uint8_t energyLevel; uint8_t barLength; uint16_t startBar; } */
export interface SectionBlock {
    type: SectionType;
    /** 情绪能量：1 - 10 */
    energyLevel: number;
    /** 段落小节长度（如 4 或 8） */
    barLength: number;
    /** 绝对起始小节位置（由规划器计算填充） */
    startBar: number;
}

export interface SongTimeline {
    sections: SectionBlock[];
    totalBars: number;
}