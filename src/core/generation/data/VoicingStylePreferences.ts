// ============================================================
// VoicingStylePreferences — 钢琴 voicing 风格预设
// ============================================================
//
// 出处:Stage G refactor of melodygenerative — 5 个 voicing 风格的
// rootPolicy + density + addColorOnTriad 三维组合。原本 inline 散落
// 在各 sub-style 的 compingMode 判断里(if comping === 'rootless' ...),
// Stage G 提炼成数据驱动。
//
// 5 个预设的语义:
//   SHELL    — guide-tone 壳:root + 3 + 7。最稀薄,Bass + RH 之间留色彩空间。
//   ROOTLESS — Bill Evans A 位:删 root,3 + 7 + 9(三和弦补 9 度色彩)。
//   CLUSTER  — D'Angelo / Glasper 紧簇:3 + 5 + 7 + 9 一拳头堆四音。
//   FULL     — Pop 实弹:完整 chord type intervals(root + 3 + 5 + 7 + ...)。
//   BLUES    — Boogie 右手:保留 root + 3 + b7 三主干,LH walking 不抢功。
//
// 消费方(Batch 1 暂不接):
//   - Batch 3:VoicingProcessor.buildRootlessRH 接 dictId 路由
//   - Batch 5:config/styles/*.ts 直接 import 常量声明 style 偏好
//
// 零 PRNG。零依赖(自洽,不 import 任何 auraflow 模块)。
// ============================================================

/** Root 处理策略 */
export enum RootPolicy {
    /** 保留 root 在 voicing 中 */
    Include = 0,
    /** 删除 root(rootless / cluster 路线) */
    Omit    = 1,
}

/** 配套字典(数值与 PianoVoicingDictionary.VoicingDictId 同步,Batch 1 后接入) */
export enum VoicingDictRef {
    /** 无字典,纯算法 fallback */
    None         = -1,
    JazzRootless = 0,
    Pop          = 1,
    Rnb          = 2,
    Blues        = 3,
}

/** 单条 voicing 风格预设 */
export interface VoicingStylePreference {
    /** root 是否保留 */
    rootPolicy: RootPolicy;
    /** 目标 voice 数(3-6) */
    density: number;
    /**
     * 三和弦上是否补 9 度色彩(Bill Evans signature)。
     * true → 三和弦(如 Cmaj / Dm)voicing 末尾自动加 9,听感"现代"
     * false → 严格按 chord type 字面音
     */
    addColorOnTriad: boolean;
    /** 配套字典引用(供 Batch 3 接入时路由) */
    dictRef: VoicingDictRef;
}

// ============================================================
// 5 个预设(Object.freeze)
// ============================================================

/**
 * SHELL — guide tone 壳:root + 3 + 7。
 * 适合 Bass 在编 + 钢琴 LH 弹壳 的场景(auraflow CoordMode.M7_ShellWithComping)。
 */
export const STYLE_SHELL: VoicingStylePreference = Object.freeze({
    rootPolicy: RootPolicy.Include,
    density: 4,
    addColorOnTriad: false,
    dictRef: VoicingDictRef.None,
});

/**
 * ROOTLESS — Bill Evans A 位:3 + 7 + 9 + 13。
 * 删 root,让 bass / LH 自己声明 root,RH 专注色彩。
 */
export const STYLE_ROOTLESS: VoicingStylePreference = Object.freeze({
    rootPolicy: RootPolicy.Omit,
    density: 4,
    addColorOnTriad: true,
    dictRef: VoicingDictRef.JazzRootless,
});

/**
 * CLUSTER — D'Angelo / Glasper 紧簇:3 + 5 + 7 + 9 半音范围内堆 4 音。
 */
export const STYLE_CLUSTER: VoicingStylePreference = Object.freeze({
    rootPolicy: RootPolicy.Omit,
    density: 4,
    addColorOnTriad: true,
    dictRef: VoicingDictRef.Rnb,
});

/**
 * FULL — Pop 实弹:完整 chord type intervals。
 * 钢琴 RH 独立支撑和声(无 bass / 单乐器场景常用)。
 */
export const STYLE_FULL: VoicingStylePreference = Object.freeze({
    rootPolicy: RootPolicy.Include,
    density: 5,
    addColorOnTriad: false,
    dictRef: VoicingDictRef.Pop,
});

/**
 * BLUES — Boogie 右手:保留 root + 3 + b7 三主干。
 * 配合 LH boogie walking,RH 不抢低音功能。
 */
export const STYLE_BLUES: VoicingStylePreference = Object.freeze({
    rootPolicy: RootPolicy.Include,
    density: 4,
    addColorOnTriad: false,
    dictRef: VoicingDictRef.Blues,
});
