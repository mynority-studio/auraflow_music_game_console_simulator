// ============================================================
// MgEngineFacade — melodygenerative Engine 包装层(Phase 1 Step 2)
// ============================================================
//
// 出处:plan §3 Phase 1 + §2 决策 1-3。把 auraflow 的输入参数(numeric seed +
// StyleId enum + keyRootPc + Tonality)翻译成 mg.GenerationConfig(string seed +
// StyleName + key string + mode string),调用 mg.Engine 三大入口,输出 ChordDef[]
// + NoteEvent[] 等结果。
//
// 设计决策(plan §2):
//   - 决策 1:facade 放 pipeline/(对接 runPipeline);mg 代码放 mg-engine/
//   - 决策 2:不改 mg 代码,facade 是单向"翻译进 + 翻译出"层
//   - 决策 3:**PRNG 隔离** — facade 内部传 `${seed}::mg` 字符串子流,
//     mg.Engine 用自己的 Random 实例,完全不消费 PRNGManager。这是 Phase 1
//     验收锚点的关键(同 seed → mg 输出 = melodygenerative-standalone 输出)。
//
// 不消费 PRNGManager(facade 内部 0 次 .next() 调用)— 保证 D-5 隔离。
//
// 后续 Phase:
//   - Phase 2:bass/atmosphere/drums 通过 ChordDef → GeneratedChord adapter 接和声
//   - Phase 3:mg 内部 Random 删,改调 PRNGManager;facade 简化(seed 转换 + 调用)
//
// 依赖:仅依赖 mg-engine/*(不依赖 auraflow ir/ 或 pipeline/ 其他模块,符合
// §10 模块依赖规则 — pipeline 可消费 primitives,但 facade 是 leaf-call,
// 不引入循环依赖)。
//
// Cross-sync:Phase 1 期间无关联组(facade 不接 runPipeline);Phase 1 Step 3
// 起 runPipeline 调用 facade 时需要登记新 cross-sync 条目(facade input/output
// 契约 ↔ runPipeline Stage 3)。
// ============================================================

import {
    Engine,
    Random,
    ChordDef,
    NoteEvent,
    MusicTimeline,
    GenerationConfig,
    ResolvedGenerationContext,
} from '../mg-engine/musicEngine';
import type { StyleName } from '../mg-engine/styleDictionary';
import type { Emotion } from '../mg-engine/musicTheory';

// ============================================================
// 输入 / 输出接口
// ============================================================

/**
 * Facade 输入 — 由 runPipeline 在 Stage 3 调用前准备。
 *
 * seed:auraflow 主 seed(numeric)。facade 内部拼接成
 * `${seed}::mg` 字符串作为 mg 的 seed(字符串 fork 子流,跟 auraflow
 * PRNGManager 完全隔离)。
 *
 * styleId:auraflow StyleId 数值枚举(0=ModernPop / 1=ChillJazz / 2=NeoSoul)。
 * facade 通过 STYLE_MAPPING 映射到 mg StyleName('POP' / 'JAZZ' / 'RNB')。
 *
 * keyRootPc:[0, 11] 调中心 pitch class。facade 通过 KEY_NAMES 数组映射到
 * mg key 字符串('C' / 'Db' / ... / 'B')。
 *
 * isMinor:true → mg.mode = 'Minor';false → 'Major'。其他 mode(Dorian /
 * Lydian / 等)需要 caller 显式传 modeOverride。
 */
export interface MgFacadeInput {
    /** auraflow 主 seed(numeric)。facade 内部派生 `${seed}::mg` 子流 */
    seed: number;
    /** auraflow StyleId enum(0=ModernPop / 1=ChillJazz / 2=NeoSoul) */
    styleId: number;
    /** 调中心 PC [0, 11] */
    keyRootPc: number;
    /** true=Minor / false=Major(主流 mode 派生) */
    isMinor: boolean;
    /** 可选:mode 显式覆盖('Dorian' / 'Lydian' / 'Mixolydian' / 等) */
    modeOverride?: string;
    /** 可选:emotion 覆盖(默认 'auto' 让 mg 内部 forked Random 决定 bright/sad) */
    emotion?: 'auto' | Emotion;
    /** 可选:meter 覆盖(默认走 mg style.timeSignature) */
    meter?: [number, number];
}

/**
 * Facade 输出 — 由 runPipeline 在 Stage 3 之后消费。
 *
 * chords:ChordDef[] 原样透传(供 Phase 2 ChordDef→GeneratedChord adapter 用)
 *
 * events / melody / chordTexture / bass:整条 mg 输出 + 按 part 拆分。
 * runPipeline 直接用 melody 喂钢琴 melody 轨,chordTexture 喂钢琴 RH comping,
 * bass 喂 mg 内部 bassline(可选丢弃,用 auraflow BassRealizer 取代)。
 *
 * resolved:诊断信息(emotion / mode / motifStrategy / basslineRule / 等)。
 */
export interface MgFacadeOutput {
    chords: ChordDef[];
    events: NoteEvent[];
    melody: NoteEvent[];
    chordTexture: NoteEvent[];
    bass: NoteEvent[];
    resolved: ResolvedGenerationContext;
    /** mg 原始 timeline(visuals / phraseSegments 等高级字段透传) */
    timeline: MusicTimeline;
}

// ============================================================
// 映射表
// ============================================================

/**
 * auraflow StyleId → mg StyleName 映射。
 *
 * auraflow 当前 3 个 style:0=ModernPop / 1=ChillJazz / 2=NeoSoul
 * mg 4 个 macro:POP / JAZZ / BLUES / RNB
 *
 * BLUES 暂无 auraflow 对应(可以通过 styleId 越界扩展,但目前不映射)。
 *
 * Cross-sync §1.6:StyleId 数值变动时需同步本表。
 */
const STYLE_MAPPING: ReadonlyArray<StyleName> = Object.freeze([
    'POP',   // auraflow ModernPop (0)
    'JAZZ',  // auraflow ChillJazz (1)
    'RNB',   // auraflow NeoSoul   (2)
]);

/**
 * 调名映射:keyRootPc [0, 11] → mg key 字符串。
 *
 * 与 mg.musicEngine.KEYS 数组顺序一致(C/Db/D/Eb/E/F/Gb/G/Ab/A/Bb/B)。
 */
const KEY_NAMES: ReadonlyArray<string> = Object.freeze([
    'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
]);

// ============================================================
// MgEngineFacade 主类
// ============================================================

export class MgEngineFacadeError extends Error {
    public readonly context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'MgEngineFacadeError';
        this.context = context;
    }
}

export class MgEngineFacade {
    /**
     * 主入口 — 一站式生成 mg 整曲输出。
     *
     * 内部调用顺序(顺序固定,跟 mg 原 API 一致):
     *   1. new Engine()
     *   2. engine.resolveGeneration(config) → ResolvedGenerationContext
     *   3. engine.generateProgressions(config) → ChordDef[]
     *   4. engine.generateArrangement(chords, config) → MusicTimeline
     *
     * PRNG 消耗:0(PRNGManager 不被触碰)— mg 内部用自己的 Random(子流 seed)。
     *
     * 不持久化 Engine 实例:每次 generate 创建新 Engine(mg 设计为 stateless,
     * config 决定一切)。
     */
    public static generate(input: MgFacadeInput): MgFacadeOutput {
        const config = MgEngineFacade.buildMgConfig(input);

        // 关键:Engine 需要 Random 实例(其 constructor 接受 Random)。
        // 字符串 fork 子流:同 mgSeed → mg 输出完全一致(决策 3 隔离 PRNG 锚点)。
        const random = new Random(config.seed);
        const engine = new Engine(random);
        const resolved = engine.resolveGeneration(config);
        const chords = engine.generateProgressions(config);
        const timeline = engine.generateArrangement(chords, config);

        // 按 part 拆分 events,方便 runPipeline 分轨消费
        const melody: NoteEvent[] = [];
        const chordTexture: NoteEvent[] = [];
        const bass: NoteEvent[] = [];
        for (let i = 0; i < timeline.events.length; i++) {
            const ev = timeline.events[i];
            if (ev.part === 'melody') melody.push(ev);
            else if (ev.part === 'chord') chordTexture.push(ev);
            else if (ev.part === 'bass') bass.push(ev);
        }

        return {
            chords,
            events: timeline.events,
            melody,
            chordTexture,
            bass,
            resolved,
            timeline,
        };
    }

    // ============================================================
    // 内部:输入翻译
    // ============================================================

    /**
     * 把 MgFacadeInput 翻译成 mg.GenerationConfig。
     *
     * 关键转换:
     *   numeric seed → `${seed}::mg` 子流字符串(PRNG 隔离)
     *   StyleId enum → StyleName('POP' / 'JAZZ' / 'RNB')
     *   keyRootPc → KEY_NAMES[pc]('C' / 'Db' / 等)
     *   isMinor → mode 'Major' / 'Minor'(modeOverride 优先)
     */
    private static buildMgConfig(input: MgFacadeInput): GenerationConfig {
        if (input.styleId < 0 || input.styleId >= STYLE_MAPPING.length) {
            throw new MgEngineFacadeError(
                'styleId out of range — auraflow StyleId 当前仅支持 0/1/2',
                { styleId: input.styleId, validRange: [0, STYLE_MAPPING.length - 1] },
            );
        }
        const style = STYLE_MAPPING[input.styleId];

        // K-2 铁律对齐 — facade 总传 key='C',让 mg 输出在 RELATIVE 空间(C 调)。
        // 真实 keyOffset 由 auraflow AbsoluteTransposer.arrange 在下游加(K-2 唯一加点)。
        // input.keyRootPc 暂保留为接口字段供未来扩展(Phase 3 壳化时可能用 mg 真实 key
        // 让某些 scale-aware 推演更精准),但 Phase 1+2 始终在 C 调推演。
        const pcNorm = (((input.keyRootPc | 0) % 12) + 12) % 12;
        if (KEY_NAMES[pcNorm] === undefined) {
            throw new MgEngineFacadeError(
                'invalid keyRootPc',
                { keyRootPc: input.keyRootPc, pcNorm },
            );
        }
        const key = 'C';  // 强制 RELATIVE 空间(K-2 铁律)

        const mode = input.modeOverride !== undefined
            ? input.modeOverride
            : (input.isMinor ? 'Minor' : 'Major');

        // PRNG 隔离 — 字符串子流 seed,跟 PRNGManager 完全独立
        const mgSeed = `${input.seed}::mg`;

        const config: GenerationConfig = {
            seed: mgSeed,
            style,
            key,
            mode,
            emotion: input.emotion ?? 'auto',
        };
        if (input.meter !== undefined) config.meter = input.meter;

        return config;
    }

    // ============================================================
    // 调试 / 诊断 helpers
    // ============================================================

    /**
     * 把 StyleId 数值翻译成 mg StyleName 字符串(诊断面板用)。
     */
    public static getMgStyleName(styleId: number): StyleName | null {
        if (styleId < 0 || styleId >= STYLE_MAPPING.length) return null;
        return STYLE_MAPPING[styleId];
    }

    /**
     * 把 keyRootPc 翻译成 mg key 字符串(诊断面板用)。
     */
    public static getMgKeyName(keyRootPc: number): string {
        const pcNorm = (((keyRootPc | 0) % 12) + 12) % 12;
        return KEY_NAMES[pcNorm];
    }
}
