/**
 * PianoTextureEnums — 钢琴织体相关枚举（纯类型）
 *
 * 把 LHTexture / RHTexture / CoordMode 三个枚举从 PianoAccompIdiom.ts 抽出，
 * 让 data/PianoTextureRecipes.ts 可以引用而不形成循环依赖。
 *
 * PianoAccompIdiom.ts 仍 re-export 这些枚举，外部调用方（BandEngine / smoke 测试）
 * 的 import 语句保持不变，无破坏性。
 *
 * 约束遵从：
 *   T-1：数值枚举（C 移植直接当 uint8_t）
 *   P-1：纯类型文件，无运行时数据
 *
 * @author AuraFlow Tap! Piano Texture Renaissance — Sub-Phase 1
 */

/** 左手织体 */
export enum LHTexture {
    /** L1 — 长持续根音（每和弦 1 音，duration = chord 时长） */
    Sustained = 1,
    /**
     * L2 — Shell Voicing：guide tone 壳和弦（3+7 / 3+7+9 / root+3+7 三种变体确定性切换）。
     * 用于"有独立 Bass 乐手"场景：bass 已锚定根音，钢琴左手让出根音区间，
     * 改弹 [E3, F4] 区间的 guide tone shell，给 RH 留出 ≥ C4 的色彩音空间。
     * 配套 CoordMode.M7_ShellWithComping。变体由 chordIndex + barInPhrase + colorBias 确定性选择。
     */
    ShellVoicing = 2,
    /** L4 — Walking Tenths：每拍 1 击点（root/5/root/approach） + 10th 双音 — 爵士 solo piano 标志 */
    WalkingTenths = 4,
    /** L8 — 不弹（让位给独立 Bass 轨） */
    Tacit = 8,
}

/** 右手织体 */
export enum RHTexture {
    /** R1 — 柱式齐砸：每拍 1 击点，全部 voicing 同时发声 */
    Block = 1,
    /** R2 — 分解和弦：8 分音符循环 voicing，每击点 1 音 */
    Broken = 2,
    /** R3 — 切分塞音：syncopated 强拍 + 反拍组合，全 voicing 短 stab */
    Stab = 3,
}

/** 左右手协作模式 */
export enum CoordMode {
    /** M1 — LH 主动（Sustained / Walking + RH 织体）：用于无独立 Bass 乐手时 */
    M1_SustainedRoot = 1,
    /** M4 — LH 让位（Tacit + RH 织体）：用于有独立 Bass 乐手时 */
    M4_TacitWithComping = 4,
    /** M5 — 双手齐砸 spread voicing：5~6 voice 横跨 LH+RH，每和弦 1 击点 sustain — Bill Evans / Mehldau 风 */
    M5_TwoHandedVoicing = 5,
    /** M6 — Oom-Pah Bounce：LH 强拍 root/5 交替 + RH 反拍 chord stab — Lemon Tree / boogie / ragtime 共用 */
    M6_OomPahBounce = 6,
    /**
     * M7 — Shell + Comping：用于"有独立 Bass 乐手"场景。
     * LH 弹 guide tone 壳和弦（替代旧的 M4 Tacit "整段静音"），RH 走 comping 织体并主动
     * 监听 LH 占用的 PC 集合避免 1 octave 内同音堆叠（"listen" 协同）。
     */
    M7_ShellWithComping = 7,
}
